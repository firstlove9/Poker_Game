import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { GameEngine } from '../../game/GameEngine';
import { ClientEvents, ServerEvents } from '../../types/events';
import { PlayerAction, GamePhase, RunItTwiceChoice } from '../../types/poker';
import { RoomStatus, PlayerRoomRole, RoomPlayer } from '../../types/room';
import { addActionLog, loadRoomLogs, addHandResult, getRoomHandResults } from '../../room/ActionLogManager';
import { handlePlayerTurnWithAfk, tryStartGame } from './roomHandler';

export const gameEngines: Map<string, GameEngine> = new Map();

function safeCallback(callback: any, response: any): void {
  if (typeof callback === 'function') {
    callback(response);
  }
}

function finishHand(roomId: string, room: any, gameEngine: GameEngine, winners: any[], potResults: any[], allHands: any[], finalGameState: any, io: any, roomManager: RoomManager, preRunItTwiceCommunityCards?: any[]): void {
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

  const bustedPlayers = room.players.filter((p: any) => p.playerRoomRole === PlayerRoomRole.BUSTED);
  if (bustedPlayers.length > 0) {
    setTimeout(() => {
      const currentRoom = roomManager.getRoom(roomId);
      if (!currentRoom || currentRoom.status === RoomStatus.PLAYING) return;

      for (const bp of bustedPlayers) {
        const currentPlayer = currentRoom.players.find(p => p.id === bp.id);
        if (currentPlayer && currentPlayer.playerRoomRole === PlayerRoomRole.BUSTED) {
          currentPlayer.playerRoomRole = PlayerRoomRole.SPECTATOR;
          currentPlayer.seatIndex = -1;
          currentPlayer.chips = 0;
          currentPlayer.isReady = false;
        }
      }

      io.to(roomId).emit(ServerEvents.PLAYER_READY_CHANGED, {
        playerId: 'system',
        ready: false,
        room: sanitizeRoom(currentRoom),
      });

      const activePlayers = currentRoom.players.filter((p: any) =>
        p.playerRoomRole !== PlayerRoomRole.SPECTATOR && p.chips > 0
      );
      if (activePlayers.length <= 1 && currentRoom.players.filter((p: any) => p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length <= 1) {
        const winner = activePlayers[0] || null;
        io.to(roomId).emit(ServerEvents.GAME_OVER, {
          winner: winner ? { id: winner.id, name: winner.name, chips: winner.chips } : null,
          room: sanitizeRoom(currentRoom),
        });
      } else {
        tryStartGame(roomId, roomManager, io);
      }
    }, 15000);
  }

  roomManager.syncScoreboard(roomId);

  const handResultForLog = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    players: allHands.map((h: any) => ({
      playerId: h.playerId,
      playerName: h.playerName,
      isWinner: h.isWinner,
      winAmount: h.isWinner ? h.winAmount : undefined,
      holeCards: '',
      handRank: h.handRank || '',
      netWin: h.netWin,
      initialChips: h.initialChips,
      position: h.position,
    })),
    communityCards: finalGameState.communityCards
      ? finalGameState.communityCards.map((c: any) => `${c.rank}${c.suit}`).join(' ')
      : '',
    timestamp: Date.now(),
    isRunItTwice: !!(finalGameState.runItTwiceBoard && finalGameState.runItTwiceBoard.length > 0),
    runItTwiceRounds: finalGameState.runItTwiceBoard && finalGameState.runItTwiceBoard.length > 0
      ? finalGameState.runItTwiceBoard.map((board: any[], roundIdx: number) => {
          const roundResult = finalGameState.runItTwiceResults?.[roundIdx];
          return {
            communityCards: board.map((c: any) => `${c.rank}${c.suit}`).join(' '),
            winnerIds: roundResult?.winnerIds || [],
            winAmount: roundResult?.winAmount || 0,
            handRanks: roundResult?.handRanks || {},
          };
        })
      : undefined,
  };
  addHandResult(roomId, handResultForLog);

  const isRunItTwice = finalGameState.runItTwiceResults && finalGameState.runItTwiceResults.length > 0;

  const sanitizedAllHands = isRunItTwice
    ? allHands.map((h: any) => ({ ...h, holeCards: [] }))
    : allHands;

  if (isRunItTwice) {
    const showdownHands = allHands.map((h: any) => ({
      playerId: h.playerId,
      playerName: h.playerName,
      holeCards: h.holeCards,
    }));
    const existingCount = (preRunItTwiceCommunityCards || []).length;
    const boards = finalGameState.runItTwiceBoard;
    const neededCards = 5 - existingCount;
    const DEAL_DELAY = 5000;
    const FINAL_DELAY = 3000;

    io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_SHOWDOWN, {
      allHands: showdownHands,
      communityCards: preRunItTwiceCommunityCards || [],
      rounds: boards.length,
    });

    const cardPositions: number[] = Array.from({ length: neededCards }, (_, i) => i);

    const remainingFlop = Math.max(0, 3 - existingCount);
    const groupedPositions: number[][] = [];
    let pos = 0;
    if (remainingFlop > 0) {
      groupedPositions.push(Array.from({ length: remainingFlop }, (_, i) => pos + i));
      pos += remainingFlop;
    }
    if (existingCount < 4) {
      groupedPositions.push([pos]);
      pos += 1;
    }
    if (existingCount < 5) {
      groupedPositions.push([pos]);
    }

    const dealSteps: { roundIndex: number; cardIndices: number[]; label: string }[] = [];
    for (let ri = 0; ri < boards.length; ri++) {
      for (let gi = 0; gi < groupedPositions.length; gi++) {
        const group = groupedPositions[gi];
        const label = gi === 0 && remainingFlop > 0 ? 'flop'
          : (gi === groupedPositions.length - 1 ? 'river' : 'turn');
        dealSteps.push({ roundIndex: ri, cardIndices: group, label });
      }
    }

    const scheduleDeal = (stepIndex: number) => {
      if (stepIndex >= dealSteps.length) {
        setTimeout(() => {
          io.to(roomId).emit(ServerEvents.SHOWDOWN, {
            winners: mergedWinners,
            potResults,
            allHands,
            communityCards: finalGameState.communityCards,
            gameState: sanitizeGameState(finalGameState),
            room: sanitizeRoom(room),
            runItTwiceBoard: finalGameState.runItTwiceBoard,
            runItTwiceResults: finalGameState.runItTwiceResults,
          });

          io.to(roomId).emit(ServerEvents.HAND_RESULT, {
            winners: mergedWinners,
            potResults,
            allHands,
            communityCards: finalGameState.communityCards,
            room: sanitizeRoom(room),
            runItTwiceBoard: finalGameState.runItTwiceBoard,
            runItTwiceResults: finalGameState.runItTwiceResults,
          });

          room.gameState = {
            ...room.gameState,
            currentBet: 0,
            minRaise: room.config?.bigBlind || 20,
            roundBets: {},
            totalBets: {},
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
              allHands: sanitizedAllHands,
              communityCards: finalGameState.communityCards,
              runItTwiceBoard: finalGameState.runItTwiceBoard || [],
              runItTwiceResults: finalGameState.runItTwiceResults || [],
            },
          };

          io.to(roomId).emit(ServerEvents.ROOM_UPDATED, {
            type: 'updated',
            room: sanitizeRoom(room),
          });
        }, FINAL_DELAY);
        return;
      }

      setTimeout(() => {
        const step = dealSteps[stepIndex];
        const roundCards: { roundIndex: number; card: any }[] = [];
        for (const ci of step.cardIndices) {
          const cardPos = existingCount + ci;
          if (cardPos < boards[step.roundIndex].length) {
            roundCards.push({ roundIndex: step.roundIndex, card: boards[step.roundIndex][cardPos] });
          }
        }

        const isLastStep = stepIndex === dealSteps.length - 1;
        const isLastStepOfRound = isLastStep ||
          dealSteps[stepIndex + 1].roundIndex !== step.roundIndex;

        io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_DEAL_CARD, {
          stepIndex,
          roundIndex: step.roundIndex,
          cardLabel: step.label,
          roundCards,
          countdown: isLastStep ? 0 : DEAL_DELAY / 1000,
        });

        if (isLastStepOfRound) {
          const roundResult = finalGameState.runItTwiceResults[step.roundIndex];
          if (roundResult) {
            io.to(roomId).emit(ServerEvents.RUN_IT_TWICE_ROUND_RESULT, {
              roundIndex: step.roundIndex,
              roundLabel: boards.length > 1 ? (step.roundIndex === 0 ? 'A轮' : 'B轮') : '跑马',
              winnerIds: roundResult.winnerIds,
              winAmount: roundResult.winAmount,
              potAmount: roundResult.potAmount,
              handRanks: roundResult.handRanks,
              communityCards: boards[step.roundIndex],
            });
          }
        }

        scheduleDeal(stepIndex + 1);
      }, DEAL_DELAY);
    };

    scheduleDeal(0);

    return;
  }

  io.to(roomId).emit(ServerEvents.SHOWDOWN, {
    winners: mergedWinners,
    potResults,
    allHands: sanitizedAllHands,
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
    allHands: sanitizedAllHands,
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
    totalBets: {},
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
      allHands: sanitizedAllHands,
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

      const preActionState = gameEngine.getState();
      const preActionBet = preActionState.roundBets[playerId] || 0;
      const preActionChips = gameEngine.getPlayers().find(p => p.id === playerId)?.chips || 0;

      const result = gameEngine.performAction(playerId, playerAction, data.amount);

      if (result.success) {
        const gameState = gameEngine.getState();
        room.gameState = gameState;

        syncPlayerChipsToRoom(gameEngine, room);

        let actualAmount = data.amount;
        if (data.action.toLowerCase() === 'call') {
          actualAmount = Math.min(preActionState.currentBet - preActionBet, preActionChips);
        } else if (data.action.toLowerCase() === 'all-in' || data.action.toLowerCase() === 'allin') {
          actualAmount = preActionChips;
        } else if (!actualAmount && data.action.toLowerCase() !== 'fold' && data.action.toLowerCase() !== 'check') {
          const postActionBet = gameState.roundBets[playerId] || 0;
          actualAmount = postActionBet - preActionBet;
        }

        const actor = room.players.find((p: any) => p.id === playerId);
        if (actor) {
          loadRoomLogs(roomId);
          addActionLog(roomId, gameState.handId || '', playerId, actor.name, data.action, actualAmount, gameState.phase);
        }

        const isGameEnding = gameState.phase === GamePhase.SHOWDOWN || gameState.phase === GamePhase.ENDED;
        const isRunItTwiceChoice = gameState.phase === GamePhase.RUN_IT_TWICE_CHOICE;

        io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
          playerId,
          playerName: actor?.name || playerId,
          action: data.action,
          amount: actualAmount,
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

                    const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
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

                    finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);
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

          finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager);
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

          const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
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

          finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);
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

            const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
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

            finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);
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

  socket.on(ClientEvents.SHOW_CARDS, (callback?: (response: any) => void) => {
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

      const lastResult = room.gameState?.lastShowdownResult;
      if (!lastResult) {
        safeCallback(callback, { success: false, error: '没有可秀牌的结果' });
        return;
      }

      const winnerHand = lastResult.allHands.find((h: any) => h.isWinner);
      if (!winnerHand) {
        safeCallback(callback, { success: false, error: '没有获胜者' });
        return;
      }

      if (winnerHand.playerId !== playerId) {
        safeCallback(callback, { success: false, error: '只有获胜者可以秀牌' });
        return;
      }

      const gameEngine = gameEngines.get(roomId);
      if (!gameEngine) {
        safeCallback(callback, { success: false, error: '游戏引擎未找到' });
        return;
      }

      const holeCards = gameEngine.getPlayerCards(playerId);
      if (!holeCards || holeCards.length === 0) {
        safeCallback(callback, { success: false, error: '没有手牌可秀' });
        return;
      }

      const winnerPlayer = room.players.find((p: any) => p.id === playerId);

      io.to(roomId).emit(ServerEvents.SHOW_CARDS_RESULT, {
        playerId,
        playerName: winnerPlayer?.name || playerId,
        holeCards,
        communityCards: lastResult.communityCards || [],
      });

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '秀牌失败' });
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
    scoreboardEntries: room.scoreboardEntries || [],
    handCount: room.handCount || 0,
    playerRebuyCounts: room.playerRebuyCounts || {},
    voteExtendHands: room.voteExtendHands ? {
      initiatorId: room.voteExtendHands.initiatorId,
      initiatorName: room.voteExtendHands.initiatorName,
      votes: Object.fromEntries(room.voteExtendHands.votes),
      votedPlayers: room.voteExtendHands.votes.size,
      totalPlayers: room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== 'spectator').length,
      createdAt: room.voteExtendHands.createdAt,
      extendCount: room.voteExtendHands.extendCount,
    } : undefined,
  };
}

export function setGameEngine(roomId: string, gameEngine: GameEngine): void {
  gameEngines.set(roomId, gameEngine);
}
