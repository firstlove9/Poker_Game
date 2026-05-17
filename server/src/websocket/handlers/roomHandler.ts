import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { ClientEvents, ServerEvents } from '../../types/events';
import { CreateRoomRequest, JoinRoomRequest, RoomStatus, PlayerRoomRole } from '../../types/room';
import { Card, PlayerAction, PlayerStatus } from '../../types/poker';
import { GameEngine, GameConfig } from '../../game/GameEngine';
import { gameEngines } from './gameHandler';
import { addActionLog, cleanupRoomLogs, loadRoomLogs, getRoomLogs, getRoomHandResults } from '../../room/ActionLogManager';

function safeCallback(callback: any, response: any): void {
  if (typeof callback === 'function') {
    callback(response);
  }
}

export function tryStartGame(roomId: string, roomManager: RoomManager, io: Server): boolean {
  const room = roomManager.getRoom(roomId);
  if (!room || room.status === RoomStatus.PLAYING) return false;

  if (room.config.fixedHands && room.config.fixedHands > 0 && room.handCount >= room.config.fixedHands) {
    return false;
  }

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

    const hasBustedPending = room.players.some(p =>
      p.playerRoomRole === PlayerRoomRole.BUSTED && p.isOnline && !p.isAfk
    );
    if (hasBustedPending) return false;
  }

  const gameConfig: GameConfig = {
    smallBlind: room.config.smallBlind,
    bigBlind: room.config.bigBlind,
    actionTimeout: room.config.actionTimeout,
    variant: room.config.gameVariant,
    modifier: room.config.gameModifier,
  };

  let dealerIndex = 0;
  if (room.gameState) {
    const prevDealerId = Object.entries(room.gameState.playerRoles || {}).find(([, role]: [string, any]) => role === 'dealer')?.[0];
    if (prevDealerId) {
      const prevDealerIdx = readyPlayers.findIndex((p: any) => p.id === prevDealerId);
      if (prevDealerIdx >= 0) {
        dealerIndex = (prevDealerIdx + 1) % readyPlayers.length;
      } else {
        const prevDealerRoomIdx = room.players.findIndex((p: any) => p.id === prevDealerId);
        if (prevDealerRoomIdx >= 0) {
          for (let i = 1; i <= room.players.length; i++) {
            const candidate = room.players[(prevDealerRoomIdx + i) % room.players.length];
            const candidateIdx = readyPlayers.findIndex((p: any) => p.id === candidate.id);
            if (candidateIdx >= 0) {
              dealerIndex = candidateIdx;
              break;
            }
          }
        } else {
          dealerIndex = (room.gameState.dealerIndex + 1) % readyPlayers.length;
        }
      }
    } else {
      dealerIndex = (room.gameState.dealerIndex + 1) % readyPlayers.length;
    }
  }
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

  room.handCount++;

  const handId = room.gameState.handId;
  const gs = room.gameState;
  const enginePlayers = gameEngine.getPlayers();
  const sbPlayer = enginePlayers[gs.smallBlindIndex % enginePlayers.length];
  const bbPlayer = enginePlayers[gs.bigBlindIndex % enginePlayers.length];
  if (sbPlayer) {
    const sbAmount = gs.roundBets[sbPlayer.id] || 0;
    if (sbAmount > 0) {
      addActionLog(roomId, handId || '', sbPlayer.id, sbPlayer.name, 'small-blind', sbAmount, gs.phase);
    }
  }
  if (bbPlayer) {
    const bbAmount = gs.roundBets[bbPlayer.id] || 0;
    if (bbAmount > 0) {
      addActionLog(roomId, handId || '', bbPlayer.id, bbPlayer.name, 'big-blind', bbAmount, gs.phase);
    }
  }

  io.to(roomId).emit(ServerEvents.GAME_STARTED, {
    room: sanitizeRoom(room),
    gameState: sanitizeGameState(room.gameState),
  });

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

        loadRoomLogs(data.roomId);
        const existingLogs = getRoomLogs(data.roomId);
        const existingHandResults = getRoomHandResults(data.roomId);
        if (existingLogs.length > 0 || existingHandResults.length > 0) {
          socket.emit(ServerEvents.ACTION_LOG_SYNC, {
            actionLogs: existingLogs,
            handResults: existingHandResults,
          });
        }

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

            loadRoomLogs(data.roomId);
            const existingLogs = getRoomLogs(data.roomId);
            const existingHandResults = getRoomHandResults(data.roomId);
            if (existingLogs.length > 0 || existingHandResults.length > 0) {
              socket.emit(ServerEvents.ACTION_LOG_SYNC, {
                actionLogs: existingLogs,
                handResults: existingHandResults,
              });
            }

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
            const maxRebuy = room.config.maxRebuyCount;
            const currentRebuy = room.playerRebuyCounts[playerId] || 0;
            if (maxRebuy !== undefined && maxRebuy >= 0 && currentRebuy >= maxRebuy) {
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
              } else {
                tryStartGame(roomId, roomManager, io);
              }

              safeCallback(callback, { success: false, error: '补筹码次数已用完，已自动进入观战' });
              return;
            }
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
          if (gameEngine && room && room.status === RoomStatus.PLAYING) {
            gameEngine.recordRebuy(playerId, result.amount || 0);
            syncPlayerChipsToRoom(gameEngine, room);
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
      } else {
        tryStartGame(roomId, roomManager, io);
      }

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '操作失败' });
    }
  });

  socket.on(ClientEvents.VOTE_EXTEND_HANDS, (callback?: (response: any) => void) => {
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

      if (!room.config.fixedHands || room.config.fixedHands <= 0) {
        safeCallback(callback, { success: false, error: '该房间未启用固定局数' });
        return;
      }

      if (room.handCount < room.config.fixedHands) {
        safeCallback(callback, { success: false, error: '尚未到达固定局数' });
        return;
      }

      if (room.voteExtendHands) {
        safeCallback(callback, { success: false, error: '已有进行中的投票' });
        return;
      }

      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        safeCallback(callback, { success: false, error: '玩家不在房间中' });
        return;
      }

      room.voteExtendHands = {
        initiatorId: playerId,
        initiatorName: player.name,
        votes: new Map([[playerId, true]]),
        approved: false,
        createdAt: Date.now(),
        extendCount: 10,
      };

      io.to(roomId).emit(ServerEvents.VOTE_EXTEND_HANDS_STARTED, {
        initiatorId: playerId,
        initiatorName: player.name,
        votes: Object.fromEntries(room.voteExtendHands.votes),
        votedPlayers: room.voteExtendHands.votes.size,
        totalPlayers: room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length,
        createdAt: room.voteExtendHands.createdAt,
        extendCount: 10,
        room: sanitizeRoom(room),
      });

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '发起投票失败' });
    }
  });

  socket.on(ClientEvents.VOTE_EXTEND_HANDS_RESPONSE, (data: { approve: boolean }, callback?: (response: any) => void) => {
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

      if (!room.voteExtendHands) {
        safeCallback(callback, { success: false, error: '没有进行中的投票' });
        return;
      }

      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        safeCallback(callback, { success: false, error: '玩家不在房间中' });
        return;
      }

      room.voteExtendHands.votes.set(playerId, data.approve);

      io.to(roomId).emit(ServerEvents.VOTE_EXTEND_HANDS_RESPONSE, {
        playerId,
        approve: data.approve,
        votes: Object.fromEntries(room.voteExtendHands.votes),
        votedPlayers: room.voteExtendHands.votes.size,
        totalPlayers: room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length,
        room: sanitizeRoom(room),
      });

      const eligiblePlayers = room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== PlayerRoomRole.SPECTATOR);
      const approveCount = Array.from(room.voteExtendHands.votes.values()).filter(v => v).length;
      const rejectCount = Array.from(room.voteExtendHands.votes.values()).filter(v => !v).length;

      if (approveCount >= 2) {
        room.config.fixedHands! += room.voteExtendHands.extendCount;
        const extendCount = room.voteExtendHands.extendCount;
        room.voteExtendHands = undefined;

        io.to(roomId).emit(ServerEvents.VOTE_EXTEND_HANDS_ENDED, {
          approved: true,
          newFixedHands: room.config.fixedHands,
          extendCount,
          room: sanitizeRoom(room),
        });
      } else if (rejectCount >= 1 && (eligiblePlayers.length - rejectCount) < 2) {
        room.voteExtendHands = undefined;

        io.to(roomId).emit(ServerEvents.VOTE_EXTEND_HANDS_ENDED, {
          approved: false,
          room: sanitizeRoom(room),
        });
      } else if (room.voteExtendHands && room.players.every(p => room.voteExtendHands!.votes.has(p.id) || !p.isOnline || p.playerRoomRole === PlayerRoomRole.SPECTATOR)) {
        if (approveCount >= 2) {
          room.config.fixedHands! += room.voteExtendHands.extendCount;
          const extendCount = room.voteExtendHands.extendCount;
          room.voteExtendHands = undefined;

          io.to(roomId).emit(ServerEvents.VOTE_EXTEND_HANDS_ENDED, {
            approved: true,
            newFixedHands: room.config.fixedHands,
            extendCount,
            room: sanitizeRoom(room),
          });
        } else {
          room.voteExtendHands = undefined;

          io.to(roomId).emit(ServerEvents.VOTE_EXTEND_HANDS_ENDED, {
            approved: false,
            room: sanitizeRoom(room),
          });
        }
      }

      safeCallback(callback, { success: true });
    } catch (error) {
      safeCallback(callback, { success: false, error: '投票失败' });
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
            || role === PlayerRoomRole.BUSTED
            || (role === PlayerRoomRole.SEATED && !player.hasPlayedHand)
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
                const afkDecision = decideAfkAction(gameEngine, playerId);
                const { PlayerAction } = require('../../types/poker');
                const actionMap: Record<string, any> = {
                  'fold': PlayerAction.FOLD,
                  'check': PlayerAction.CHECK,
                  'call': PlayerAction.CALL,
                  'raise': PlayerAction.RAISE,
                  'all-in': PlayerAction.ALL_IN,
                };
                const playerAction = actionMap[afkDecision.action] || PlayerAction.FOLD;
                const actionResult = gameEngine.performAction(playerId, playerAction, afkDecision.amount);
                if (actionResult.success) {
                  room.gameState = gameEngine.getState();
                  syncPlayerChipsToRoom(gameEngine, room);

                  const actor = room.players.find(p => p.id === playerId);
                  io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
                    playerId,
                    playerName: actor?.name || playerId,
                    action: afkDecision.action,
                    amount: afkDecision.amount,
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
  delete sanitized.deck;
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
    playerRebuyCounts: room.playerRebuyCounts || {},
    handCount: room.handCount || 0,
  };
}

function decideAfkAction(gameEngine: GameEngine, playerId: string): { action: string; amount?: number } {
  const validActions = gameEngine.getValidActions(playerId);
  const gameState = gameEngine.getState();
  const myBet = gameState.roundBets[playerId] || 0;
  const toCall = gameState.currentBet - myBet;
  const player = gameEngine.getPlayers().find(p => p.id === playerId);
  const myChips = player?.chips || 0;
  const random = Math.random();

  const cards = gameEngine.getPlayerCards(playerId);
  const hasHighCard = cards && cards.length >= 2 && (
    cards[0].rank === 'A' || cards[0].rank === 'K' || cards[0].rank === 'Q' ||
    cards[1].rank === 'A' || cards[1].rank === 'K' || cards[1].rank === 'Q'
  );
  const isPair = cards && cards.length >= 2 && cards[0].rank === cards[1].rank;
  const bigBlind = gameState.minRaise || 20;

  const callAmount = Math.min(toCall, myChips);

  if (toCall === 0) {
    if (isPair && random < 0.4 && validActions.includes('raise') && myChips > bigBlind * 3) {
      return { action: 'raise', amount: Math.min(bigBlind * 3, myChips) };
    }
    if (hasHighCard && random < 0.2 && validActions.includes('raise') && myChips > bigBlind * 2) {
      return { action: 'raise', amount: Math.min(bigBlind * 2, myChips) };
    }
    if (validActions.includes('check')) {
      return { action: 'check' };
    }
    if (validActions.includes('fold')) {
      return { action: 'fold' };
    }
    return { action: validActions[0] || 'fold' };
  }

  if (isPair) {
    if (random < 0.6 && validActions.includes('call')) {
      return { action: 'call', amount: callAmount };
    }
    if (random < 0.8 && validActions.includes('raise') && myChips > toCall * 2) {
      return { action: 'raise', amount: Math.min(toCall * 2, myChips) };
    }
  }

  if (hasHighCard) {
    if (toCall <= myChips * 0.3 && random < 0.5 && validActions.includes('call')) {
      return { action: 'call', amount: callAmount };
    }
    if (random < 0.35 && validActions.includes('call')) {
      return { action: 'call', amount: callAmount };
    }
  }

  if (toCall > myChips * 0.5) {
    if (random < 0.15 && validActions.includes('call')) {
      return { action: 'call', amount: callAmount };
    }
    if (validActions.includes('fold')) {
      return { action: 'fold' };
    }
    if (validActions.includes('check')) {
      return { action: 'check' };
    }
    return { action: validActions[0] || 'fold' };
  }

  if (random < 0.35 && validActions.includes('call')) {
    return { action: 'call', amount: callAmount };
  }

  if (validActions.includes('fold')) {
    return { action: 'fold' };
  }
  if (validActions.includes('check')) {
    return { action: 'check' };
  }
  return { action: validActions[0] || 'fold' };
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

  if ((currentPlayer?.isAfk || !currentPlayer?.isOnline) && playerStatus === PlayerStatus.PLAYING) {
    setTimeout(() => {
      if (gameEngine.getCurrentPlayerId() !== currentPlayerId) return;
      if (!roomManager.getRoom(roomId)) return;

      const afkDecision = decideAfkAction(gameEngine, currentPlayerId);
      const { PlayerAction } = require('../../types/poker');
      const actionMap: Record<string, any> = {
        'fold': PlayerAction.FOLD,
        'check': PlayerAction.CHECK,
        'call': PlayerAction.CALL,
        'raise': PlayerAction.RAISE,
        'all-in': PlayerAction.ALL_IN,
      };
      const playerAction = actionMap[afkDecision.action] || PlayerAction.FOLD;
      const actionResult = gameEngine.performAction(currentPlayerId, playerAction, afkDecision.amount);
      if (actionResult.success) {
        room.gameState = gameEngine.getState();
        syncPlayerChipsToRoom(gameEngine, room);

        const actor = room.players.find((p: any) => p.id === currentPlayerId);
        io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
          playerId: currentPlayerId,
          playerName: actor?.name || currentPlayerId,
          action: afkDecision.action,
          amount: afkDecision.amount,
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
