import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { GameEngine } from '../../game/GameEngine';
import { ClientEvents, ServerEvents } from '../../types/events';
import { PlayerAction, GamePhase, RunItTwiceChoice } from '../../types/poker';
import { RoomStatus, PlayerRoomRole, RoomPlayer } from '../../types/room';
import { addActionLog, loadRoomLogs } from '../../room/ActionLogManager';
import { handlePlayerTurnWithAfk } from './roomHandler';

export const gameEngines: Map<string, GameEngine> = new Map();

function safeCallback(callback: any, response: any): void {
  if (typeof callback === 'function') {
    callback(response);
  }
}

function finishHand(roomId: string, room: any, gameEngine: GameEngine, winners: any[], potResults: any[], allHands: any[], finalGameState: any, io: any): void {
  const mergedWinners = (() => {
    const map = new Map<string, any>();
    for (const w of winners) {
      const existing = map.get(w.playerId);
      if (existing) {
        existing.winAmount += w.winAmount;
        if (w.potType === 'side') {
          existing.potType = 'both';
        }
      } else {
        map.set(w.playerId, { ...w });
      }
    }
    for (const [, mw] of map) {
      const allHand = allHands.find((h: any) => h.playerId === mw.playerId && h.isWinner);
      if (allHand && allHand.winAmount !== undefined) {
        mw.winAmount = allHand.winAmount;
      }
    }
    return Array.from(map.values()).filter((mw: any) => {
      const allHand = allHands.find((h: any) => h.playerId === mw.playerId);
      return allHand && allHand.isWinner;
    });
  })();

  room.status = RoomStatus.WAITING;

  const currentGamePlayers = gameEngine.getPlayers();
  const currentGamePlayerIds = new Set(currentGamePlayers.map(p => p.id));
  for (const p of room.players) {
    if (currentGamePlayerIds.has(p.id)) {
      p.isReady = false;
    }
  }

  for (const p of room.players) {
    if (p.playerRoomRole === PlayerRoomRole.SPECTATOR && !p.hasPlayedHand) {
      const usedSeats = new Set(room.players.filter((rp: RoomPlayer) => rp.seatIndex >= 0).map((rp: RoomPlayer) => rp.seatIndex));
      let seatIndex = 0;
      while (usedSeats.has(seatIndex)) {
        seatIndex++;
      }
      p.playerRoomRole = PlayerRoomRole.SEATED;
      p.seatIndex = seatIndex;
      p.chips = room.config.buyInMin;
      p.totalBuyIn = room.config.buyInMin;
    }
  }

  for (const p of room.players) {
    if (p.playerRoomRole === PlayerRoomRole.ACTIVE && p.chips <= 0) {
      p.playerRoomRole = PlayerRoomRole.BUSTED;
    }
  }

  const isRunItTwice = finalGameState.runItTwiceResults && finalGameState.runItTwiceResults.length > 0;

  io.to(roomId).emit(ServerEvents.SHOWDOWN, {
    winners: mergedWinners,
    potResults,
    allHands,
    communityCards: finalGameState.communityCards,
    gameState: sanitizeGameState(finalGameState),
    room: sanitizeRoom(room),
    ...(isRunItTwice ? {
      runItTwiceBoard: finalGameState.runItTwiceBoard,
      runItTwiceResults: finalGameState.runItTwiceResults,
    } : {}),
  });

  io.to(roomId).emit(ServerEvents.HAND_RESULT, {
    winners: mergedWinners,
    potResults,
    allHands,
    communityCards: finalGameState.communityCards,
    room: sanitizeRoom(room),
    ...(isRunItTwice ? {
      runItTwiceBoard: finalGameState.runItTwiceBoard,
      runItTwiceResults: finalGameState.runItTwiceResults,
    } : {}),
  });

  room.gameState = {
    ...room.gameState,
    currentBet: 0,
    minRaise: room.config?.bigBlind || 20,
    roundBets: {},
    pots: [],
    totalPot: 0,
    actions: [],
    communityCards: [],
    playerCards: {},
    playerStatus: {},
    playerRoles: {},
    lastRaiseIndex: -1,
    currentPlayerIndex: -1,
    currentPlayerId: '',
    isHeadsUpAllIn: false,
    runItTwiceChoices: {},
    runItTwiceDiceResult: null,
    runItTwiceDiceReady: {},
    runItTwiceBoard: [],
    runItTwiceResults: [],
    lastShowdownResult: {
      winners: mergedWinners,
      allHands,
      communityCards: finalGameState.communityCards,
      runItTwiceBoard: finalGameState.runItTwiceBoard || [],
      runItTwiceResults: finalGameState.runItTwiceResults || [],
    },
  };

  io.to(roomId).emit(ServerEvents.ROOM_UPDATED, {
    type: 'updated',
    room: sanitizeRoom(room),
  });
}

export function handleGameEvents(socket: Socket, io: Server, roomManager: RoomManager): void {
  socket.on(ClientEvents.PLAYER_ACTION, (data: { action: string; amount?: number }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (!roomId) {
        safeCallback(callback, { success: false, error: '你不在任何房间中' });
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        safeCallback(callback, { success: false, error: '房间不存在' });
        return;
      }

      let gameEngine = gameEngines.get(roomId);
      if (!gameEngine) {
        safeCallback(callback, { success: false, error: '游戏引擎未找到' });
        return;
      }

      const actionMap: Record<string, PlayerAction> = {
        'fold': PlayerAction.FOLD,
        'check': PlayerAction.CHECK,
        'call': PlayerAction.CALL,
        'raise': PlayerAction.RAISE,
        'all-in': PlayerAction.ALL_IN,
        'allin': PlayerAction.ALL_IN,
      };

      const playerAction = actionMap[data.action.toLowerCase()];
      if (!playerAction) {
        safeCallback(callback, { success: false, error: `无效操作: ${data.action}` });
        return;
      }

      const result = gameEngine.performAction(playerId, playerAction, data.amount);

      if (result.success) {
        const gameState = gameEngine.getState();
        room.gameState = gameState;

        syncPlayerChipsToRoom(gameEngine, room);

        const actor = room.players.find((p: any) => p.id === playerId);
        if (actor) {
          loadRoomLogs(roomId);
          addActionLog(roomId, gameState.handId || '', playerId, actor.name, data.action, data.amount, gameState.phase);
        }

        const isGameEnding = gameState.phase === GamePhase.SHOWDOWN || gameState.phase === GamePhase.ENDED;
        const isRunItTwiceChoice = gameState.phase === GamePhase.RUN_IT_TWICE_CHOICE;

        io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
          playerId,
          playerName: actor?.name || playerId,
          action: data.action,
          amount: data.amount,
          gameState: sanitizeGameState(gameState),
          ...(isGameEnding ? {} : { room: sanitizeRoom(room) }),
        });

        if (isRunItTwiceChoice) {
          const nonFoldedPlayers = room.players.filter((p: any) =>
            gameState.playerStatus?.[p.id] !== 'folded'
          );
          io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_ASK, {
            gameState: sanitizeGameState(gameState),
            players: nonFoldedPlayers.map((p: any) => ({ id: p.id, name: p.name })),
          });

          for (const p of nonFoldedPlayers) {
            if (p.isAfk) {
              const afkChoiceResult = gameEngine.submitRunItTwiceChoice(p.id, 'once');
              if (afkChoiceResult.success) {
                const afkActor = room.players.find((rp: any) => rp.id === p.id);
                io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_CHOICE_RESULT, {
                  playerId: p.id,
                  playerName: afkActor?.name || p.id,
                  choice: 'once',
                  gameState: sanitizeGameState(gameEngine.getState()),
                });

                if (afkChoiceResult.bothSubmitted) {
                  room.gameState = gameEngine.getState();
                  if (afkChoiceResult.needDice) {
                    io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_DICE_RESULT, {
                      gameState: sanitizeGameState(gameEngine.getState()),
                      needDice: true,
                      players: room.players
                        .filter((rp: any) => gameState.playerStatus?.[rp.id] !== 'folded')
                        .map((rp: any) => ({ id: rp.id, name: rp.name })),
                    });
                  } else {
                    const finalChoice = afkChoiceResult.finalChoice || 'once';
                    io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_EXECUTING, {
                      finalChoice,
                      gameState: sanitizeGameState(gameEngine.getState()),
                    });

                    const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
                    const finalGameState = gameEngine.getState();
                    room.gameState = finalGameState;
                    syncPlayerChipsToRoom(gameEngine, room);

                    for (const w of winners) {
                      const roomPlayer = room.players.find((rp: any) => rp.id === w.playerId);
                      if (roomPlayer) w.playerName = roomPlayer.name;
                    }
                    for (const h of allHands) {
                      const roomPlayer = room.players.find((rp: any) => rp.id === h.playerId);
                      if (roomPlayer) h.playerName = roomPlayer.name;
                    }

                    finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io);
                  }
                }
              }
            }
          }
        } else if (isGameEnding) {
          const { winners, potResults, allHands } = gameEngine.showdown();

          const finalGameState = gameEngine.getState();
          room.gameState = finalGameState;

          syncPlayerChipsToRoom(gameEngine, room);

          for (const w of winners) {
            const roomPlayer = room.players.find((p: any) => p.id === w.playerId);
            if (roomPlayer) {
              w.playerName = roomPlayer.name;
            }
          }
          for (const h of allHands) {
            const roomPlayer = room.players.find((p: any) => p.id === h.playerId);
            if (roomPlayer) {
              h.playerName = roomPlayer.name;
            }
          }

          finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io);
        } else {
          const currentPlayerId = gameEngine.getCurrentPlayerId();
          if (currentPlayerId) {
            handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
          } else {
            const playingPlayers = room.players.filter((p: any) =>
              gameState.playerStatus?.[p.id] === 'playing'
            );
            if (playingPlayers.length > 0) {
              const firstActive = playingPlayers[0];
              io.to(roomId).emit(ServerEvents.PLAYER_TURN, {
                playerId: firstActive.id,
                playerName: firstActive.name,
                timeout: 30,
                validActions: gameEngine.getValidActions(firstActive.id),
              });
            }
          }
        }

        safeCallback(callback, { success: true });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '执行动作失败' });
    }
  });

  socket.on(ClientEvents.RUN_IT_TWICE_CHOICE, (data: { choice: RunItTwiceChoice }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (!roomId) {
        safeCallback(callback, { success: false, error: '你不在任何房间中' });
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        safeCallback(callback, { success: false, error: '房间不存在' });
        return;
      }

      const gameEngine = gameEngines.get(roomId);
      if (!gameEngine) {
        safeCallback(callback, { success: false, error: '游戏引擎未找到' });
        return;
      }

      const result = gameEngine.submitRunItTwiceChoice(playerId, data.choice);

      if (!result.success) {
        safeCallback(callback, { success: false, error: result.error });
        return;
      }

      const gameState = gameEngine.getState();
      room.gameState = gameState;

      const actor = room.players.find((p: any) => p.id === playerId);

      io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_CHOICE_RESULT, {
        playerId,
        playerName: actor?.name || playerId,
        choice: data.choice,
        gameState: sanitizeGameState(gameState),
      });

      if (result.bothSubmitted) {
        if (result.needDice) {
          io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_DICE_RESULT, {
            gameState: sanitizeGameState(gameState),
            needDice: true,
            players: room.players
              .filter((p: any) => gameState.playerStatus?.[p.id] !== 'folded')
              .map((p: any) => ({ id: p.id, name: p.name })),
          });
        } else {
          const finalChoice = result.finalChoice || 'once';
          io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_EXECUTING, {
            finalChoice,
            gameState: sanitizeGameState(gameState),
          });

          const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
          const finalGameState = gameEngine.getState();
          room.gameState = finalGameState;
          syncPlayerChipsToRoom(gameEngine, room);

          for (const w of winners) {
            const roomPlayer = room.players.find((p: any) => p.id === w.playerId);
            if (roomPlayer) w.playerName = roomPlayer.name;
          }
          for (const h of allHands) {
            const roomPlayer = room.players.find((p: any) => p.id === h.playerId);
            if (roomPlayer) h.playerName = roomPlayer.name;
          }

          finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io);
        }
      }

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '选择失败' });
    }
  });

  socket.on(ClientEvents.RUN_IT_TWICE_ROLL_DICE, (_data: any, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (!roomId) {
        safeCallback(callback, { success: false, error: '你不在任何房间中' });
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        safeCallback(callback, { success: false, error: '房间不存在' });
        return;
      }

      const gameEngine = gameEngines.get(roomId);
      if (!gameEngine) {
        safeCallback(callback, { success: false, error: '游戏引擎未找到' });
        return;
      }

      const result = gameEngine.submitDiceRoll(playerId);

      if (!result.success) {
        safeCallback(callback, { success: false, error: result.error });
        return;
      }

      const actor = room.players.find((p: any) => p.id === playerId);
      const gameState = gameEngine.getState();

      io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_DICE_RESULT, {
        playerId,
        playerName: actor?.name || playerId,
        ready: true,
        diceReady: gameState.runItTwiceDiceReady,
        gameState: sanitizeGameState(gameState),
        needDice: true,
      });

      if (result.bothReady && result.diceResult) {
        const isTied = gameEngine.isDiceTied();

        io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_DICE_RESULT, {
          bothReady: true,
          diceResult: result.diceResult,
          isTied,
          finalChoice: result.diceResult.finalChoice,
          gameState: sanitizeGameState(gameState),
          needDice: true,
        });

        if (isTied) {
          setTimeout(() => {
            gameEngine.resetDiceForReroll();
            const updatedState = gameEngine.getState();
            room.gameState = updatedState;
            io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_DICE_RESULT, {
              reroll: true,
              gameState: sanitizeGameState(updatedState),
              needDice: true,
              players: room.players
                .filter((p: any) => updatedState.playerStatus?.[p.id] !== 'folded')
                .map((p: any) => ({ id: p.id, name: p.name })),
            });
          }, 2000);
        } else {
          setTimeout(() => {
            io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_EXECUTING, {
              finalChoice: result.diceResult!.finalChoice,
              gameState: sanitizeGameState(gameState),
            });

            const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
            const finalGameState = gameEngine.getState();
            room.gameState = finalGameState;
            syncPlayerChipsToRoom(gameEngine, room);

            for (const w of winners) {
              const roomPlayer = room.players.find((p: any) => p.id === w.playerId);
              if (roomPlayer) w.playerName = roomPlayer.name;
            }
            for (const h of allHands) {
              const roomPlayer = room.players.find((p: any) => p.id === h.playerId);
              if (roomPlayer) h.playerName = roomPlayer.name;
            }

            finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io);
          }, 2000);
        }
      }

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '掷骰子失败' });
    }
  });

  socket.on(ClientEvents.SEND_CHAT, (data: { message: string }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (!roomId) {
        safeCallback(callback, { success: false, error: '你不在任何房间中' });
        return;
      }

      const room = roomManager.getRoom(roomId);
      const player = room?.players.find(p => p.id === playerId);

      if (player) {
        io.to(roomId).emit(ServerEvents.CHAT_MESSAGE, {
          playerId,
          playerName: player.name,
          message: data.message,
          timestamp: Date.now(),
        });
      }

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '发送消息失败' });
    }
  });
}

function syncPlayerChipsToRoom(gameEngine: GameEngine, room: any): void {
  const enginePlayers = gameEngine.getPlayers();
  for (const ep of enginePlayers) {
    const roomPlayer = room.players.find((p: any) => p.id === ep.id);
    if (roomPlayer) {
      roomPlayer.chips = ep.chips;
    }
  }
}

function getAllHandsForShowdown(gameEngine: GameEngine, players: any[]): any[] {
  const state = gameEngine.getState();
  const allHands = [];

  for (const player of players) {
    const cards = gameEngine.getPlayerCards(player.id);
    if (cards && state.playerStatus[player.id] !== 'folded') {
      allHands.push({
        playerId: player.id,
        playerName: player.name,
        holeCards: cards,
      });
    }
  }

  return allHands;
}

function sanitizeGameState(gameState: any): any {
  const sanitized = JSON.parse(JSON.stringify(gameState));
  sanitized.playerCards = {};
  return sanitized;
}

function sanitizeRoom(room: any): any {
  return {
    config: room.config,
    status: room.status,
    players: room.players.map((p: any) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seatIndex: p.seatIndex,
      chips: p.chips,
      totalBuyIn: p.totalBuyIn,
      isReady: p.isReady,
      isOnline: p.isOnline,
      isAfk: p.isAfk,
      hasPlayedHand: p.hasPlayedHand,
      playerRoomRole: p.playerRoomRole,
    })),
  };
}

export function setGameEngine(roomId: string, gameEngine: GameEngine): void {
  gameEngines.set(roomId, gameEngine);
}
