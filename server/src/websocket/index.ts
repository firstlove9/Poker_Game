import { Server, Socket } from 'socket.io';
import { RoomManager } from '../room/RoomManager';
import { handleRoomEvents, tryStartGame } from './handlers/roomHandler';
import { handleGameEvents } from './handlers/gameHandler';
import { ServerEvents } from '../types/events';
import { RoomStatus } from '../types/room';
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
    })),
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
          playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          isReconnection = false;
          console.log(`Player ${queryPlayerId} already has active socket, assigning new ID: ${playerId}`);
        } else {
          playerId = queryPlayerId;
          isReconnection = true;
          console.log(`Player reconnecting: ${playerId}`);
        }
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

            const hasPlayedBefore = room.players.some(p => p.hasPlayedHand);
            if (hasPlayedBefore && room.status !== RoomStatus.PLAYING) {
              const disconnectedPlayerId = playerId;
              setTimeout(() => {
                const currentRoom = roomManager.getRoom(roomId);
                if (!currentRoom || currentRoom.status === RoomStatus.PLAYING) return;
                const dp = currentRoom.players.find(p => p.id === disconnectedPlayerId);
                if (dp && !dp.isOnline && dp.disconnectedAt) {
                  tryStartGame(roomId, roomManager, io);
                }
              }, 31000);
            }
          }
        }
      }

      playerSocketMap.delete(playerId);
    });
  });
}
