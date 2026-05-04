import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { ClientEvents, ServerEvents } from '../../types/events';
import { CreateRoomRequest, JoinRoomRequest, RoomStatus } from '../../types/room';
import { Card } from '../../types/poker';
import { GameEngine, GameConfig } from '../../game/GameEngine';
import { gameEngines } from './gameHandler';
import { cleanupRoomLogs } from '../../room/ActionLogManager';

function safeCallback(callback: any, response: any): void {
  if (typeof callback === 'function') {
    callback(response);
  }
}

function tryStartGame(roomId: string, roomManager: RoomManager, io: Server): boolean {
  const room = roomManager.getRoom(roomId);
  if (!room || room.status === RoomStatus.PLAYING) return false;

  const readyPlayers = room.players.filter(p => p.isReady && p.chips > 0);
  if (readyPlayers.length < room.config.minPlayers) return false;

  const gameConfig: GameConfig = {
    smallBlind: room.config.smallBlind,
    bigBlind: room.config.bigBlind,
    actionTimeout: room.config.actionTimeout,
  };

  const dealerIndex = room.gameState ? (room.gameState.dealerIndex + 1) % readyPlayers.length : 0;
  const gameEngine = new GameEngine(readyPlayers, dealerIndex, gameConfig);

  room.status = RoomStatus.PLAYING;
  room.gameState = gameEngine.start();

  syncPlayerChipsToRoom(gameEngine, room);

  for (const player of room.players) {
    const cards = gameEngine.getPlayerCards(player.id);
    if (cards) {
      player.hasPlayedHand = true;
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
    const currentPlayer = room.players.find(p => p.id === currentPlayerId);
    io.to(roomId).emit(ServerEvents.PLAYER_TURN, {
      playerId: currentPlayerId,
      playerName: currentPlayer?.name || currentPlayerId,
      timeout: 30,
      validActions: gameEngine.getValidActions(currentPlayerId),
    });
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
        if (room && room.status === RoomStatus.PLAYING) {
          const gameEngine = gameEngines.get(roomId);
          const isInCurrentGame = gameEngine?.getPlayers().some(p => p.id === playerId);
          if (isInCurrentGame) {
            safeCallback(callback, { success: false, error: '你正在游戏中，无需准备' });
            return;
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
            const hasPlayedBefore = room.players.some(p => p.hasPlayedHand);
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

      const started = tryStartGame(roomId, roomManager, io);
      if (started) {
        safeCallback(callback, { success: true });
      } else {
        const room = roomManager.getRoom(roomId);
        if (room && room.status === RoomStatus.PLAYING) {
          safeCallback(callback, { success: false, error: '游戏正在进行中' });
        } else {
          const readyPlayers = room?.players.filter(p => p.isReady && p.chips > 0) || [];
          safeCallback(callback, { success: false, error: `至少需要${room?.config.minPlayers || 2}名有筹码的玩家才能开始（当前${readyPlayers.length}人准备且有筹码）` });
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
        if (player && !player.hasPlayedHand) {
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
            });
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

          if (result.room.voteLeave && result.room.players.every(p => result.room!.voteLeave!.votes.has(p.id))) {
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
      hasPlayedHand: p.hasPlayedHand,
    })),
  };
}
