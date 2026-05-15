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
        gameVariant: room.config.gameVariant,
        gameModifier: room.config.gameModifier,
        mixedRotation: room.config.mixedRotation,
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
          isAfk: p.isAfk,
          hasPlayedHand: p.hasPlayedHand,
          playerRoomRole: p.playerRoomRole,
        })),
        gameState: room.gameState ? {
          handId: room.gameState.handId,
          phase: room.gameState.phase,
          communityCards: room.gameState.communityCards,
          boardCards: room.gameState.boardCards,
          pots: room.gameState.pots,
          totalPot: room.gameState.totalPot,
          currentPlayerIndex: room.gameState.currentPlayerIndex,
          currentPlayerId: room.gameState.currentPlayerId,
          dealerIndex: room.gameState.dealerIndex,
          smallBlindIndex: room.gameState.smallBlindIndex,
          bigBlindIndex: room.gameState.bigBlindIndex,
          lastRaiseIndex: room.gameState.lastRaiseIndex,
          currentBet: room.gameState.currentBet,
          minRaise: room.gameState.minRaise,
          roundBets: room.gameState.roundBets,
          totalBets: room.gameState.totalBets,
          playerStatus: room.gameState.playerStatus,
          playerRoles: room.gameState.playerRoles,
          actions: room.gameState.actions,
          isHeadsUpAllIn: room.gameState.isHeadsUpAllIn,
          runItTwiceChoices: room.gameState.runItTwiceChoices,
          runItTwiceDiceResult: room.gameState.runItTwiceDiceResult,
          runItTwiceDiceReady: room.gameState.runItTwiceDiceReady,
          runItTwiceBoard: room.gameState.runItTwiceBoard,
          runItTwiceResults: room.gameState.runItTwiceResults,
          lastShowdownResult: room.gameState.lastShowdownResult,
          showedCardsPlayers: room.gameState.showedCardsPlayers,
        } : undefined,
      }
    });
  });

  return router;
}
