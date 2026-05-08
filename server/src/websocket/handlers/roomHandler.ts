import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { ClientEvents, ServerEvents } from '../../types/events';
import { CreateRoomRequest, JoinRoomRequest, RoomStatus, PlayerRoomRole } from '../../types/room';
import { Card, PlayerAction, PlayerStatus } from '../../types/poker';
import { GameEngine, GameConfig } from '../../game/GameEngine';
import { gameEngines } from './gameHandler';
import { cleanupRoomLogs } from '../../room/ActionLogManager';

function safeCallback(callback: any, response: any): void {
  if (typeof callback === 'function') {
    callback(response);
  }
}

export function tryStartGame(roomId: string, roomManager: RoomManager, io: Server): boolean {
  const room = roomManager.getRoom(roomId);
  if (!room || room.status === RoomStatus.PLAYING) return false;

  const readyPlayers = room.players.filter(p =>
    p.isReady && p.chips > 0 && p.playerRoomRole !== PlayerRoomRole.SPECTATOR && !p.isAfk
  );
  if (readyPlayers.length < room.config.minPlayers) return false;

  const hasPlayedBefore = room.players.some(p =>
    p.playerRoomRole === PlayerRoomRole.ACTIVE || p.playerRoomRole === PlayerRoomRole.BUSTED
  );
  if (hasPlayedBefore) {
    const DISCONNECT_TIMEOUT_MS = 120000;
    const now = Date.now();
    const playersNeedReady = room.players.filter(p => {
      if (p.chips <= 0) return false;
      if (p.isAfk) return false;
      if (!p.isOnline && p.disconnectedAt && (now - p.disconnectedAt) > DISCONNECT_TIMEOUT_MS) return false;
      return true;
    });
    const allReady = playersNeedReady.every(p => p.isReady);
    if (!allReady) return false;
  }

  const gameConfig: GameConfig = {
    smallBlind: room.config.smallBlind,
    bigBlind: room.config.bigBlind,
    actionTimeout: room.config.actionTimeout,
    variant: room.config.gameVariant,
    modifier: room.config.gameModifier,
  };

  const dealerIndex = room.gameState ? (room.gameState.dealerIndex + 1) % readyPlayers.length : 0;
  const gameEngine = new GameEngine(readyPlayers, dealerIndex, gameConfig);

  room.status = RoomStatus.PLAYING;
  room.gameState = gameEngine.start();

  syncPlayerChipsToRoom(gameEngine, room);
  roomManager.syncScoreboard(roomId);

  for (const player of room.players) {
    const cards = gameEngine.getPlayerCards(player.id);
    if (cards) {
      player.hasPlayedHand = true;
      if (player.playerRoomRole === PlayerRoomRole.SEATED) {
        player.playerRoomRole = PlayerRoomRole.ACTIVE;
      }
    }
  }

  gameEngines.set(roomId, gameEngine);

  io.to(roomId).emit(ServerEvents.GAME_STARTED, {
    room: sanitizeRoom(room),
    gameState: sanitizeGameState(room.gameState),
  });

  const handId = room.gameState.handId;
  setTimeout(() => {
    for (const player of room.players) {
      const cards = gameEngine.getPlayerCards(player.id);
      if (cards) {
        const playerSockets = Array.from(io.sockets.sockets.values()).filter(
          s => s.data.playerId === player.id
        );
        for (const s of playerSockets) {
          s.emit(ServerEvents.DEAL_CARDS, {
            handId,
            playerId: player.id,
            cards,
          });
        }
      }
    }
  }, 100);

  const currentPlayerId = gameEngine.getCurrentPlayerId();
  if (currentPlayerId) {
    handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
  }

  return true;
}

export function handleRoomEvents(socket: Socket, io: Server, roomManager: RoomManager): void {
  socket.on(ClientEvents.CREATE_ROOM, (data: CreateRoomRequest, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const room = roomManager.createRoom(data, playerId);
      socket.join(room.config.roomId);

      const joinResult = roomManager.joinRoom(room.config.roomId, {
        roomId: room.config.roomId,
        playerName: data.hostName || 'Player',
      }, playerId);

      if (joinResult.success && joinResult.room) {
        socket.emit(ServerEvents.ROOM_JOINED, {
          room: sanitizeRoom(joinResult.room),
          playerId,
        });

        io.to(room.config.roomId).emit(ServerEvents.PLAYER_JOINED, {
          player: joinResult.room.players.find(p => p.id === playerId),
          room: sanitizeRoom(joinResult.room),
        });

        io.emit(ServerEvents.ROOM_UPDATED, {
          type: 'created',
          room: sanitizeRoom(joinResult.room),
        });

        safeCallback(callback, { success: true, room: sanitizeRoom(joinResult.room), playerId });
      } else {
        safeCallback(callback, { success: false, error: joinResult.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '创建房间失败' });
    }
  });

  socket.on(ClientEvents.JOIN_ROOM, (data: JoinRoomRequest, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      if (!data.roomId) {
        safeCallback(callback, { success: false, error: '房间ID不能为空' });
        return;
      }

      const result = roomManager.joinRoom(data.roomId, data, playerId);

      if (result.success && result.room) {
        if (result.replacedPlayerId) {
          io.to(data.roomId).emit(ServerEvents.PLAYER_LEFT, {
            playerId: result.replacedPlayerId,
            room: sanitizeRoom(result.room),
            isTemporary: false,
          });
        }

        socket.join(data.roomId);
        socket.data.roomId = data.roomId;

        socket.emit(ServerEvents.ROOM_JOINED, {
          room: sanitizeRoom(result.room),
          playerId,
        });

        socket.to(data.roomId).emit(ServerEvents.PLAYER_JOINED, {
          player: result.room.players.find(p => p.id === playerId),
          room: sanitizeRoom(result.room),
        });

        io.emit(ServerEvents.ROOM_UPDATED, {
          type: 'updated',
          room: sanitizeRoom(result.room),
        });

        safeCallback(callback, { success: true, room: sanitizeRoom(result.room), playerId });
      } else if (result.error === '你已在该房间中') {
        const room = roomManager.getRoom(data.roomId);
        if (room) {
          const existingPlayer = room.players.find(p => p.id === playerId);
          if (existingPlayer) {
            existingPlayer.isOnline = true;
            existingPlayer.disconnectedAt = undefined;
            existingPlayer.name = data.playerName || existingPlayer.name;
            socket.join(data.roomId);
            socket.data.roomId = data.roomId;

            socket.emit(ServerEvents.ROOM_JOINED, {
              room: sanitizeRoom(room),
              playerId,
            });

            io.to(data.roomId).emit(ServerEvents.PLAYER_JOINED, {
              player: existingPlayer,
              room: sanitizeRoom(room),
            });

            io.emit(ServerEvents.ROOM_UPDATED, {
              type: 'updated',
              room: sanitizeRoom(room),
            });

            safeCallback(callback, { success: true, room: sanitizeRoom(room), playerId });
          } else {
            safeCallback(callback, { success: false, error: result.error });
          }
        } else {
          safeCallback(callback, { success: false, error: result.error });
        }
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '加入房间失败' });
    }
  });

  socket.on(ClientEvents.LEAVE_ROOM, (callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      const result = roomManager.leaveRoom(playerId);

      if (result.success) {
        if (roomId) {
          socket.leave(roomId);

          const updatedRoom = roomManager.getRoom(roomId);
          if (updatedRoom) {
            io.to(roomId).emit(ServerEvents.PLAYER_LEFT, {
              playerId,
              room: sanitizeRoom(updatedRoom),
            });
            io.emit(ServerEvents.ROOM_UPDATED, {
              type: 'updated',
              room: sanitizeRoom(updatedRoom),
            });
          } else {
            io.emit(ServerEvents.ROOM_UPDATED, {
              type: 'deleted',
              roomId,
            });
          }
        }

        socket.data.roomId = null;
        safeCallback(callback, { success: true });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '离开房间失败' });
    }
  });

  socket.on(ClientEvents.PLAYER_READY, (ready: boolean, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          const player = room.players.find(p => p.id === playerId);
          if (player && player.playerRoomRole === PlayerRoomRole.BUSTED) {
            safeCallback(callback, { success: false, error: '请先补筹码或选择不补' });
            return;
          }
          if (room.status === RoomStatus.PLAYING) {
            const gameEngine = gameEngines.get(roomId);
            const isInCurrentGame = gameEngine?.getPlayers().some(p => p.id === playerId);
            if (isInCurrentGame) {
              safeCallback(callback, { success: false, error: '你正在游戏中，无需准备' });
              return;
            }
          }
        }
      }

      const result = roomManager.setPlayerReady(playerId, ready);

      if (result.success) {
        if (roomId) {
          const room = roomManager.getRoom(roomId);
          io.to(roomId).emit(ServerEvents.PLAYER_READY_CHANGED, {
            playerId,
            ready,
            room: sanitizeRoom(room),
          });

          if (ready && room && room.status !== RoomStatus.PLAYING) {
            const hasPlayedBefore = room.players.some(p =>
              p.playerRoomRole === PlayerRoomRole.ACTIVE || p.playerRoomRole === PlayerRoomRole.BUSTED
            );
            if (hasPlayedBefore) {
              tryStartGame(roomId, roomManager, io);
            }
          }
        }
        safeCallback(callback, { success: true });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '设置准备状态失败' });
    }
  });

  socket.on(ClientEvents.START_GAME, (callback?: (response: any) => void) => {
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
      if (room && room.config.hostId === playerId) {
        const host = room.players.find(p => p.id === playerId);
        if (host && !host.isReady && host.chips > 0) {
          host.isReady = true;
          io.to(roomId).emit(ServerEvents.PLAYER_READY_CHANGED, {
            playerId,
            ready: true,
            room: sanitizeRoom(room),
          });
        }
      }

      const started = tryStartGame(roomId, roomManager, io);
      if (started) {
        safeCallback(callback, { success: true });
      } else {
        const currentRoom = roomManager.getRoom(roomId);
        if (currentRoom && currentRoom.status === RoomStatus.PLAYING) {
          safeCallback(callback, { success: false, error: '游戏正在进行中' });
        } else {
          const readyPlayers = currentRoom?.players.filter(p => p.isReady && p.chips > 0) || [];
          safeCallback(callback, { success: false, error: `至少需要${currentRoom?.config.minPlayers || 2}名有筹码的玩家才能开始（当前${readyPlayers.length}人准备且有筹码）` });
        }
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '开始游戏失败' });
    }
  });

  socket.on(ClientEvents.GET_CHIPS, (callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const result = roomManager.replenishChips(playerId);

      if (result.success) {
        const roomId = roomManager.getPlayerRoomId(playerId);
        if (roomId) {
          const room = roomManager.getRoom(roomId);

          const gameEngine = gameEngines.get(roomId);
          if (gameEngine && room) {
            const enginePlayers = gameEngine.getPlayers();
            const ep = enginePlayers.find(p => p.id === playerId);
            if (ep) {
              ep.chips += (result.amount || 0);
              syncPlayerChipsToRoom(gameEngine, room);
            }
          }

          roomManager.syncScoreboard(roomId);

          io.to(roomId).emit(ServerEvents.CHIPS_RECEIVED, {
            playerId,
            amount: result.amount,
            room: sanitizeRoom(room),
          });
        }
        safeCallback(callback, { success: true, amount: result.amount });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '补充筹码失败' });
    }
  });

  socket.on(ClientEvents.DECLINE_REBUY, (callback?: (response: any) => void) => {
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

      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        safeCallback(callback, { success: false, error: '玩家不在房间中' });
        return;
      }

      if (player.playerRoomRole !== PlayerRoomRole.BUSTED) {
        safeCallback(callback, { success: false, error: '只有破产玩家可以选择不补筹码' });
        return;
      }

      player.playerRoomRole = PlayerRoomRole.SPECTATOR;
      player.seatIndex = -1;
      player.chips = 0;
      player.isReady = false;

      io.to(roomId).emit(ServerEvents.PLAYER_READY_CHANGED, {
        playerId,
        ready: false,
        room: sanitizeRoom(room),
      });

      const activePlayers = room.players.filter((p: any) =>
        p.playerRoomRole !== PlayerRoomRole.SPECTATOR && p.chips > 0
      );
      if (activePlayers.length <= 1 && room.players.filter((p: any) => p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length <= 1) {
        const winner = activePlayers[0] || null;
        io.to(roomId).emit(ServerEvents.GAME_OVER, {
          winner: winner ? { id: winner.id, name: winner.name, chips: winner.chips } : null,
          room: sanitizeRoom(room),
        });
      }

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '操作失败' });
    }
  });

  socket.on(ClientEvents.VOTE_LEAVE, (callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        const player = room?.players.find(p => p.id === playerId);
        if (player && room) {
          const role = player.playerRoomRole;
          const canDirectLeave = role === PlayerRoomRole.SPECTATOR
            || role === PlayerRoomRole.SEATED
            || role === PlayerRoomRole.BUSTED
            || (role === PlayerRoomRole.ACTIVE && room.status !== RoomStatus.PLAYING)
            || (role === PlayerRoomRole.ACTIVE && room.status === RoomStatus.PLAYING
              && (room.gameState?.playerStatus?.[playerId] === undefined
                || room.gameState?.playerStatus?.[playerId] === 'folded'));
          if (canDirectLeave) {
            const leaveResult = roomManager.leaveRoom(playerId, true);
            if (leaveResult.success) {
              socket.leave(roomId);
              const updatedRoom = roomManager.getRoom(roomId);
              if (updatedRoom) {
                io.to(roomId).emit(ServerEvents.PLAYER_LEFT, {
                  playerId,
                  room: sanitizeRoom(updatedRoom),
                });
                io.emit(ServerEvents.ROOM_UPDATED, {
                  type: 'updated',
                  room: sanitizeRoom(updatedRoom),
                });
              } else {
                io.emit(ServerEvents.ROOM_UPDATED, {
                  type: 'deleted',
                  roomId,
                });
              }
              safeCallback(callback, { success: true, directLeave: true });
              return;
            }
          }
        }
      }

      const result = roomManager.startVoteLeave(playerId);

      if (result.success) {
        const roomId = roomManager.getPlayerRoomId(playerId);
        if (roomId && result.room) {
          if (result.room.voteLeave?.approved) {
            gameEngines.delete(roomId);
            cleanupRoomLogs(roomId);
            roomManager.deleteRoom(roomId);
            io.to(roomId).emit(ServerEvents.VOTE_LEAVE_ENDED, {
              approved: true,
              approvedCount: result.room.players.length,
              totalPlayers: result.room.players.length,
              initiatorId: playerId,
            });
            io.to(roomId).emit(ServerEvents.ROOM_LEFT, {
              reason: 'vote',
            });
            io.emit(ServerEvents.ROOM_UPDATED, {
              type: 'deleted',
              roomId,
            });
          } else {
            io.to(roomId).emit(ServerEvents.VOTE_LEAVE_STARTED, {
              initiatorId: result.room.voteLeave?.initiatorId,
              initiatorName: result.room.voteLeave?.initiatorName,
              votes: Object.fromEntries(result.room.voteLeave?.votes || new Map()),
              totalPlayers: result.room.players.length,
              votedPlayers: result.room.voteLeave?.votes?.size || 0,
              createdAt: result.room.voteLeave?.createdAt,
            });

            setTimeout(() => {
              const timeoutResult = roomManager.processVoteTimeout(roomId!);
              if (timeoutResult.success) {
                if (timeoutResult.approved) {
                  gameEngines.delete(roomId!);
                  cleanupRoomLogs(roomId!);
                  io.to(roomId!).emit(ServerEvents.VOTE_LEAVE_ENDED, {
                    approved: true,
                    approvedCount: timeoutResult.voteCounts!.approveCount,
                    totalPlayers: timeoutResult.voteCounts!.approveCount + timeoutResult.voteCounts!.rejectCount,
                  });
                  io.to(roomId!).emit(ServerEvents.ROOM_LEFT, {
                    reason: 'vote',
                  });
                  io.emit(ServerEvents.ROOM_UPDATED, {
                    type: 'deleted',
                    roomId: roomId!,
                  });
                } else {
                  io.to(roomId!).emit(ServerEvents.VOTE_LEAVE_ENDED, {
                    approved: false,
                    approvedCount: timeoutResult.voteCounts!.approveCount,
                    totalPlayers: timeoutResult.voteCounts!.approveCount + timeoutResult.voteCounts!.rejectCount,
                  });
                  const updatedRoom = roomManager.getRoom(roomId!);
                  if (updatedRoom) {
                    io.to(roomId!).emit(ServerEvents.ROOM_UPDATED, {
                      type: 'updated',
                      room: sanitizeRoom(updatedRoom),
                    });
                  }
                }
              }
            }, 15000);
          }
        }
        safeCallback(callback, { success: true });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '发起投票失败' });
    }
  });

  socket.on(ClientEvents.VOTE_LEAVE_RESPONSE, (data: { approve: boolean }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const result = roomManager.voteLeaveResponse(playerId, data.approve);

      if (result.success) {
        const roomId = result.roomId || roomManager.getPlayerRoomId(playerId);
        if (roomId && result.room) {
          io.to(roomId).emit(ServerEvents.VOTE_LEAVE_RESPONSE, {
            playerId,
            approve: data.approve,
            votes: Object.fromEntries(result.room.voteLeave?.votes || new Map()),
            totalPlayers: result.room.players.length,
            votedPlayers: result.room.voteLeave?.votes?.size || 0,
          });

          if (result.room.voteLeave && result.room.players.every(p => result.room!.voteLeave!.votes.has(p.id) || !p.isOnline)) {
            io.to(roomId).emit(ServerEvents.VOTE_LEAVE_ENDED, {
              approved: result.approved,
              approvedCount: Array.from(result.room.voteLeave.votes.values()).filter(v => v).length,
              totalPlayers: result.room.players.length,
            });

            if (result.approved) {
              gameEngines.delete(roomId);
              cleanupRoomLogs(roomId);
              roomManager.deleteRoom(roomId);

              io.to(roomId).emit(ServerEvents.ROOM_LEFT, {
                reason: 'vote',
              });

              io.emit(ServerEvents.ROOM_UPDATED, {
                type: 'deleted',
                roomId,
              });
            }
          }

          if (result.approved === false && result.voteCounts) {
            io.to(roomId).emit(ServerEvents.VOTE_LEAVE_ENDED, {
              approved: false,
              approvedCount: result.voteCounts.approveCount,
              totalPlayers: result.room.players.length,
              initiatorId: result.initiatorId,
            });
          }
        }

        if (result.approved && !result.room) {
          safeCallback(callback, { success: true, approved: true });
          return;
        }

        safeCallback(callback, { success: true, approved: result.approved });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '响应投票失败' });
    }
  });

  socket.on(ClientEvents.AFK, (data: { afk: boolean }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        safeCallback(callback, { success: false, error: '未登录' });
        return;
      }

      const afk = data.afk !== false;
      const result = roomManager.setPlayerAfk(playerId, afk);

      if (result.success && result.roomId && result.room) {
        const roomId = result.roomId;
        const room = result.room;

        io.to(roomId).emit(ServerEvents.AFK_STATUS_CHANGED, {
          playerId,
          isAfk: afk,
          room: sanitizeRoom(room),
        });

        if (afk && room.status === RoomStatus.PLAYING) {
          const gameEngine = gameEngines.get(roomId);
          if (gameEngine) {
            const gameState = gameEngine.getState();
            const playerStatus = gameState.playerStatus[playerId];

            if (playerStatus === PlayerStatus.PLAYING) {
              const currentPlayerId = gameEngine.getCurrentPlayerId();
              if (currentPlayerId === playerId) {
                const actionResult = gameEngine.performAction(playerId, PlayerAction.FOLD);
                if (actionResult.success) {
                  room.gameState = gameEngine.getState();
                  syncPlayerChipsToRoom(gameEngine, room);

                  const actor = room.players.find(p => p.id === playerId);
                  io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
                    playerId,
                    playerName: actor?.name || playerId,
                    action: 'fold',
                    gameState: sanitizeGameState(room.gameState),
                    room: sanitizeRoom(room),
                  });

                  const { GamePhase } = require('../../types/poker');
                  const isGameEnding = room.gameState.phase === GamePhase.SHOWDOWN || room.gameState.phase === GamePhase.ENDED;

                  if (!isGameEnding) {
                    const nextPlayerId = gameEngine.getCurrentPlayerId();
                    if (nextPlayerId) {
                      handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
                    }
                  } else {
                    finishHandFromAfk(roomId, room, gameEngine, io, roomManager);
                  }
                }
              }
            }
          }
        }

        safeCallback(callback, { success: true, isAfk: afk });
      } else {
        safeCallback(callback, { success: false, error: result.error });
      }
    } catch (error) {
      safeCallback(callback, { success: false, error: '设置AFK状态失败' });
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
  };
}

export function handlePlayerTurnWithAfk(roomId: string, room: any, gameEngine: GameEngine, io: Server, roomManager: RoomManager): void {
  const currentPlayerId = gameEngine.getCurrentPlayerId();
  if (!currentPlayerId) return;

  const currentPlayer = room.players.find((p: any) => p.id === currentPlayerId);
  const gameState = gameEngine.getState();
  const playerStatus = gameState.playerStatus[currentPlayerId];

  io.to(roomId).emit(ServerEvents.PLAYER_TURN, {
    playerId: currentPlayerId,
    playerName: currentPlayer?.name || currentPlayerId,
    timeout: 30,
    validActions: gameEngine.getValidActions(currentPlayerId),
  });

  if (currentPlayer?.isAfk && playerStatus === PlayerStatus.PLAYING) {
    setTimeout(() => {
      if (gameEngine.getCurrentPlayerId() !== currentPlayerId) return;
      if (!roomManager.getRoom(roomId)) return;

      const actionResult = gameEngine.performAction(currentPlayerId, PlayerAction.FOLD);
      if (actionResult.success) {
        room.gameState = gameEngine.getState();
        syncPlayerChipsToRoom(gameEngine, room);

        const actor = room.players.find((p: any) => p.id === currentPlayerId);
        io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
          playerId: currentPlayerId,
          playerName: actor?.name || currentPlayerId,
          action: 'fold',
          gameState: sanitizeGameState(room.gameState),
          room: sanitizeRoom(room),
        });

        const { GamePhase } = require('../../types/poker');
        const isGameEnding = room.gameState.phase === GamePhase.SHOWDOWN || room.gameState.phase === GamePhase.ENDED;

        if (!isGameEnding) {
          const nextPlayerId = gameEngine.getCurrentPlayerId();
          if (nextPlayerId) {
            handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
          }
        } else {
          finishHandFromAfk(roomId, room, gameEngine, io, roomManager);
        }
      }
    }, 1500);
  }
}

function finishHandFromAfk(roomId: string, room: any, gameEngine: GameEngine, io: Server, roomManager: RoomManager): void {
  const { winners, potResults, allHands } = gameEngine.showdown();
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
    if (p.playerRoomRole === PlayerRoomRole.ACTIVE && p.chips <= 0) {
      p.playerRoomRole = PlayerRoomRole.BUSTED;
    }
  }

  roomManager.syncScoreboard(roomId);

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
