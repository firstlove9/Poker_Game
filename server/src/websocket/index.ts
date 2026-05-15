import { Server, Socket } from 'socket.io';
import { RoomManager } from '../room/RoomManager';
import { handleRoomEvents, tryStartGame } from './handlers/roomHandler';
import { handleGameEvents } from './handlers/gameHandler';
import { handleAICommands } from './handlers/aiHandler';
import { ServerEvents } from '../types/events';
import { RoomStatus, PlayerRoomRole } from '../types/room';
import { AI_NAMESPACE, AICommand, AI_COMMAND_REGISTRY } from '../types/ai';
import { gameEngines } from './handlers/gameHandler';

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
      playerRoomRole: p.playerRoomRole,
    })),
    scoreboardEntries: room.scoreboardEntries || [],
  };
}

const playerSocketMap: Map<string, string> = new Map();

export function setupWebSocket(io: Server, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    const queryPlayerId = socket.handshake.query.playerId as string | undefined;

    let playerId: string;
    let isReconnection = false;

    if (queryPlayerId && roomManager.getPlayerRoomId(queryPlayerId)) {
      const previousSocketId = playerSocketMap.get(queryPlayerId);
      if (previousSocketId) {
        const previousSocket = io.sockets.sockets.get(previousSocketId);
        if (previousSocket && previousSocket.connected) {
          console.log(`Player ${queryPlayerId} has stale socket ${previousSocketId}, forcing disconnect`);
          previousSocket.data.replaced = true;
          previousSocket.disconnect(true);
        }
        playerId = queryPlayerId;
        isReconnection = true;
        console.log(`Player reconnecting: ${playerId}`);
      } else {
        playerId = queryPlayerId;
        isReconnection = true;
        console.log(`Player reconnecting: ${playerId}`);
      }
    } else {
      playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    socket.data.playerId = playerId;
    playerSocketMap.set(playerId, socket.id);

    socket.emit(ServerEvents.CONNECTED, {
      playerId,
      message: isReconnection ? '重新连接成功' : '连接成功',
    });

    if (isReconnection) {
      const roomId = roomManager.getPlayerRoomId(playerId);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          socket.join(roomId);
          socket.data.roomId = roomId;

          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.isOnline = true;
            player.disconnectedAt = undefined;
          }

          socket.emit(ServerEvents.ROOM_JOINED, {
            room: sanitizeRoom(room),
            playerId,
          });

          io.to(roomId).emit(ServerEvents.PLAYER_JOINED, {
            player,
            room: sanitizeRoom(room),
          });

          if (room.gameState) {
            const gameEngine = gameEngines.get(roomId);
            socket.emit(ServerEvents.GAME_STARTED, {
              room: sanitizeRoom(room),
              gameState: {
                ...room.gameState,
                playerCards: {},
                deck: undefined,
              },
            });

            if (gameEngine) {
              const cards = gameEngine.getPlayerCards(playerId);
              if (cards) {
                socket.emit(ServerEvents.DEAL_CARDS, {
                  handId: room.gameState.handId,
                  playerId,
                  cards,
                });
              }

              const currentPlayerId = gameEngine.getCurrentPlayerId();
              if (currentPlayerId) {
                const currentPlayer = room.players.find(p => p.id === currentPlayerId);
                if (currentPlayer) {
                  socket.emit(ServerEvents.PLAYER_TURN, {
                    playerId: currentPlayerId,
                    playerName: currentPlayer.name,
                    timeout: 30,
                    validActions: gameEngine.getValidActions(currentPlayerId),
                  });
                } else {
                  socket.emit(ServerEvents.PLAYER_TURN, {
                    playerId: currentPlayerId,
                    playerName: currentPlayerId,
                    timeout: 30,
                    validActions: gameEngine.getValidActions(currentPlayerId),
                  });
                }
              }
            }
          }
        }
      }
    }

    handleRoomEvents(socket, io, roomManager);

    handleGameEvents(socket, io, roomManager);

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);

      if (socket.data.replaced) {
        playerSocketMap.delete(playerId);
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.isOnline = false;
            player.disconnectedAt = Date.now();
            if (room.status === RoomStatus.PLAYING && !player.isAfk) {
              player.isAfk = true;
              const { GamePhase } = require('../types/poker');
              if (room.gameState && room.gameState.currentPlayerId === playerId &&
                  room.gameState.phase !== GamePhase.SHOWDOWN && room.gameState.phase !== GamePhase.ENDED) {
                const gameEngine = gameEngines.get(roomId);
                if (gameEngine) {
                  const { handlePlayerTurnWithAfk } = require('./handlers/roomHandler');
                  handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
                }
              }
              io.to(roomId).emit(ServerEvents.PLAYER_READY_CHANGED, {
                playerId,
                ready: player.isReady,
                room: sanitizeRoom(room),
              });
            }
            io.to(roomId).emit(ServerEvents.PLAYER_LEFT, {
              playerId,
              room: sanitizeRoom(room),
              isTemporary: true,
            });

            const disconnectedPlayerId = playerId;
            setTimeout(() => {
              const currentRoom = roomManager.getRoom(roomId);
              if (!currentRoom) return;
              if (currentRoom.status === RoomStatus.PLAYING) {
                return;
              }
              const dp = currentRoom.players.find(p => p.id === disconnectedPlayerId);
              if (dp && !dp.isOnline && dp.disconnectedAt) {
                roomManager.leaveRoom(disconnectedPlayerId, true);
                const updatedRoom = roomManager.getRoom(roomId);
                if (updatedRoom) {
                  io.to(roomId).emit(ServerEvents.PLAYER_LEFT, {
                    playerId: disconnectedPlayerId,
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
            }, 120000);
          }
        }
      }

      playerSocketMap.delete(playerId);
    });
  });

  const aiNamespace = io.of(AI_NAMESPACE);
  aiNamespace.on('connection', (socket: Socket) => {
    console.log(`[AI] AI client connected: ${socket.id}`);

    const queryPlayerId = socket.handshake.query.playerId as string | undefined;
    const queryName = (socket.handshake.query.name as string) || 'AI_Player';

    let playerId: string;
    if (queryPlayerId) {
      playerId = queryPlayerId;
    } else {
      playerId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    socket.data.playerId = playerId;
    socket.data.isAI = true;

    socket.emit('ai:connected', {
      ok: true,
      code: 0,
      data: {
        playerId,
        namespace: AI_NAMESPACE,
        protocol: '1.0',
        commands: Object.values(AI_COMMAND_REGISTRY),
      },
      log: `Connected as ${playerId}. Type "help" to see available commands.`,
    });

    handleAICommands(socket, io, roomManager);

    socket.on('disconnect', () => {
      console.log(`[AI] AI client disconnected: ${socket.id} (playerId=${playerId})`);

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.isOnline = false;
            player.disconnectedAt = Date.now();
            io.to(roomId).emit(ServerEvents.PLAYER_LEFT, {
              playerId,
              room: sanitizeRoom(room),
              isTemporary: true,
            });
          }
        }
      }
    });
  });
}
