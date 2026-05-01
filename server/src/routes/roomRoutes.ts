import { Router, Request, Response } from 'express';
import { RoomManager } from '../room/RoomManager';

export function createRoomRoutes(roomManager: RoomManager): Router {
  const router = Router();

  // 获取房间列表
  router.get('/rooms', (req: Request, res: Response) => {
    const rooms = roomManager.getRoomList().map(room => ({
      config: {
        roomId: room.config.roomId,
        roomName: room.config.roomName,
        hostId: room.config.hostId,
        maxPlayers: room.config.maxPlayers,
        smallBlind: room.config.smallBlind,
        bigBlind: room.config.bigBlind,
        buyInMin: room.config.buyInMin,
        buyInMax: room.config.buyInMax,
        isPrivate: room.config.isPrivate,
      },
      status: room.status,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        seatIndex: p.seatIndex,
        chips: p.chips,
        isReady: p.isReady,
        isOnline: p.isOnline,
      })),
    }));
    res.json({ success: true, rooms });
  });

  // 获取房间详情
  router.get('/rooms/:roomId', (req: Request, res: Response) => {
    const { roomId } = req.params;
    const room = roomManager.getRoom(roomId);
    
    if (!room) {
      res.status(404).json({ success: false, error: '房间不存在' });
      return;
    }

    res.json({ 
      success: true, 
      room: {
        config: room.config,
        status: room.status,
        players: room.players.map(p => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          seatIndex: p.seatIndex,
          chips: p.chips,
          totalBuyIn: p.totalBuyIn,
          isReady: p.isReady,
          isOnline: p.isOnline,
        })),
        gameState: room.gameState ? {
          handId: room.gameState.handId,
          phase: room.gameState.phase,
          communityCards: room.gameState.communityCards,
          pots: room.gameState.pots,
          currentPlayerIndex: room.gameState.currentPlayerIndex,
          currentPlayerId: room.gameState.currentPlayerId,
          currentBet: room.gameState.currentBet,
          minRaise: room.gameState.minRaise,
          roundBets: room.gameState.roundBets,
          playerStatus: room.gameState.playerStatus,
          playerRoles: room.gameState.playerRoles,
        } : undefined,
      }
    });
  });

  return router;
}
