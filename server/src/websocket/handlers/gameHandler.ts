import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { GameEngine } from '../../game/GameEngine';
import { ClientEvents, ServerEvents } from '../../types/events';
import { PlayerAction, GamePhase } from '../../types/poker';
import { RoomStatus } from '../../types/room';
import { addActionLog, loadRoomLogs } from '../../room/ActionLogManager';

export const gameEngines: Map<string, GameEngine> = new Map();

export function handleGameEvents(socket: Socket, io: Server, roomManager: RoomManager): void {
  socket.on(ClientEvents.PLAYER_ACTION, (data: { action: string; amount?: number }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        if (callback) callback({ success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (!roomId) {
        if (callback) callback({ success: false, error: '你不在任何房间中' });
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        if (callback) callback({ success: false, error: '房间不存在' });
        return;
      }

      let gameEngine = gameEngines.get(roomId);
      if (!gameEngine) {
        if (callback) callback({ success: false, error: '游戏引擎未找到' });
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
        if (callback) callback({ success: false, error: `无效操作: ${data.action}` });
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

        io.to(roomId).emit(ServerEvents.ACTION_RESULT, {
          playerId,
          action: data.action,
          amount: data.amount,
          gameState: sanitizeGameState(gameState),
          room: sanitizeRoom(room),
        });

        if (gameState.phase === GamePhase.SHOWDOWN || gameState.phase === GamePhase.ENDED) {
          const { winners, potResults, allHands } = gameEngine.showdown();

          const finalGameState = gameEngine.getState();
          room.gameState = finalGameState;

          syncPlayerChipsToRoom(gameEngine, room);

          autoRebuyBustedPlayers(room, io);

          io.to(roomId).emit(ServerEvents.SHOWDOWN, {
            winners,
            potResults,
            allHands,
            communityCards: finalGameState.communityCards,
            gameState: sanitizeGameState(finalGameState),
            room: sanitizeRoom(room),
          });

          io.to(roomId).emit(ServerEvents.HAND_RESULT, {
            winners,
            potResults,
            allHands,
            communityCards: finalGameState.communityCards,
            room: sanitizeRoom(room),
          });

          room.status = RoomStatus.WAITING;

          for (const p of room.players) {
            p.isReady = false;
          }

          io.to(roomId).emit(ServerEvents.ROOM_UPDATED, {
            type: 'updated',
            room: sanitizeRoom(room),
          });
        } else {
          const currentPlayerId = gameEngine.getCurrentPlayerId();
          if (currentPlayerId) {
            const currentPlayer = room.players.find(p => p.id === currentPlayerId);
            if (currentPlayer) {
              io.to(roomId).emit(ServerEvents.PLAYER_TURN, {
                playerId: currentPlayerId,
                playerName: currentPlayer.name,
                timeout: 30,
                validActions: gameEngine.getValidActions(currentPlayerId),
              });
            }
          }
        }

        if (callback) callback({ success: true });
      } else {
        if (callback) callback({ success: false, error: result.error });
      }
    } catch (error) {
      if (callback) callback({ success: false, error: '执行动作失败' });
    }
  });

  socket.on(ClientEvents.SEND_CHAT, (data: { message: string }, callback?: (response: any) => void) => {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        if (callback) callback({ success: false, error: '未登录' });
        return;
      }

      const roomId = roomManager.getPlayerRoomId(playerId);
      if (!roomId) {
        if (callback) callback({ success: false, error: '你不在任何房间中' });
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

      if (callback) callback({ success: true });
    } catch (error) {
      if (callback) callback({ success: false, error: '发送消息失败' });
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
  const sanitized = { ...gameState };
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
    })),
  };
}

function autoRebuyBustedPlayers(room: any, io: any): void {
  const buyInAmount = room.config.buyInMin;
  for (const player of room.players) {
    if (player.chips <= 0) {
      player.chips = buyInAmount;
      player.totalBuyIn += buyInAmount;
      io.to(room.config.roomId).emit(ServerEvents.CHIPS_RECEIVED, {
        playerId: player.id,
        amount: buyInAmount,
        autoRebuy: true,
        room: sanitizeRoom(room),
      });
    }
  }
}

export function setGameEngine(roomId: string, gameEngine: GameEngine): void {
  gameEngines.set(roomId, gameEngine);
}
