import { Router, Request, Response } from 'express';
import { SinglePlayerGameEngine, SinglePlayerConfig, GameConfig } from '../game/SinglePlayerGameEngine';
import { PlayerAction, GameVariant, GameModifier } from '../types/poker';

const router = Router();

const games: Map<string, SinglePlayerGameEngine> = new Map();

const defaultGameConfig: GameConfig = {
  smallBlind: 10,
  bigBlind: 20,
  actionTimeout: 30,
  variant: GameVariant.TEXAS_NLHE,
};

function buildGameState(game: SinglePlayerGameEngine, playerId: string) {
  const state = game.getState();
  const humanCards = game.getPlayerCards(playerId);
  const isMyTurn = game.isHumanPlayerTurn();
  const winners = state.phase === 'showdown' ? game.getWinners() : [];
  const allHands = state.phase === 'showdown' ? game.getAllHands() : [];
  
  return {
    gameState: {
      players: game.getPlayers(),
      communityCards: state.communityCards,
      currentPlayerIndex: state.currentPlayerIndex,
      currentPlayerId: state.currentPlayerId,
      phase: state.phase,
      pot: game.getPotAmount(),
      currentBet: state.currentBet,
      minRaise: state.minRaise,
      playerStatus: state.playerStatus,
      playerRoles: state.playerRoles,
      roundBets: state.roundBets,
    },
    humanCards: humanCards || null,
    isMyTurn,
    winners,
    allHands,
  };
}

router.post('/start', (req: Request, res: Response) => {
  try {
    const { playerId, playerName, npcCount, buyIn, variant, modifier } = req.body;

    if (!playerId) {
      res.json({ success: false, error: '缺少玩家ID' });
      return;
    }

    const existingGame = games.get(playerId);
    if (existingGame) {
      existingGame.cleanup();
      games.delete(playerId);
    }

    const config: SinglePlayerConfig = {
      humanPlayerId: playerId,
      humanPlayerName: playerName || '玩家',
      npcCount: npcCount || 3,
      buyIn: buyIn || 1000,
    };

    const gameConfig: GameConfig = {
      ...defaultGameConfig,
      variant: variant || GameVariant.TEXAS_NLHE,
      modifier: modifier || GameModifier.NONE,
    };

    const game = new SinglePlayerGameEngine(config, gameConfig);
    game.start();

    games.set(playerId, game);

    res.json({
      success: true,
      ...buildGameState(game, playerId),
    });
  } catch (error: any) {
    console.error('Single player start error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/state', (req: Request, res: Response) => {
  try {
    const { playerId } = req.query;

    if (!playerId || typeof playerId !== 'string') {
      res.json({ success: false, error: '缺少玩家ID' });
      return;
    }

    const game = games.get(playerId);

    if (!game) {
      res.json({ success: false, error: '游戏不存在' });
      return;
    }

    res.json({
      success: true,
      ...buildGameState(game, playerId),
    });
  } catch (error: any) {
    console.error('Single player state error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/action', (req: Request, res: Response) => {
  try {
    const { playerId, action, amount } = req.body;

    if (!playerId || !action) {
      res.json({ success: false, error: '缺少参数' });
      return;
    }

    const game = games.get(playerId);

    if (!game) {
      res.json({ success: false, error: '游戏不存在' });
      return;
    }

    const actionMap: Record<string, PlayerAction> = {
      'fold': PlayerAction.FOLD,
      'check': PlayerAction.CHECK,
      'call': PlayerAction.CALL,
      'raise': PlayerAction.RAISE,
      'allin': PlayerAction.ALL_IN,
    };

    const playerAction = actionMap[action.toLowerCase()];
    if (!playerAction) {
      res.json({ success: false, error: `无效操作: ${action}` });
      return;
    }

    const result = game.executeAction(playerId, playerAction, amount);

    if (!result) {
      res.json({ success: false, error: '操作失败' });
      return;
    }

    res.json({
      success: true,
      ...buildGameState(game, playerId),
    });
  } catch (error: any) {
    console.error('Single player action error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/next', (req: Request, res: Response) => {
  try {
    const { playerId } = req.body;

    if (!playerId) {
      res.json({ success: false, error: '缺少玩家ID' });
      return;
    }

    const game = games.get(playerId);

    if (!game) {
      res.json({ success: false, error: '游戏不存在' });
      return;
    }

    game.nextHand();

    res.json({
      success: true,
      ...buildGameState(game, playerId),
    });
  } catch (error: any) {
    console.error('Single player next error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/rebuy', (req: Request, res: Response) => {
  try {
    const { playerId, amount } = req.body;

    if (!playerId) {
      res.json({ success: false, error: '缺少玩家ID' });
      return;
    }

    const game = games.get(playerId);

    if (!game) {
      res.json({ success: false, error: '游戏不存在' });
      return;
    }

    const rebuyAmount = amount || 1000;
    const humanPlayer = game.getPlayers().find(p => p.id === playerId);
    if (!humanPlayer) {
      res.json({ success: false, error: '玩家不存在' });
      return;
    }

    game.rebuy(playerId, rebuyAmount);

    res.json({
      success: true,
      ...buildGameState(game, playerId),
    });
  } catch (error: any) {
    console.error('Single player rebuy error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/end', (req: Request, res: Response) => {
  try {
    const { playerId } = req.body;

    if (!playerId) {
      res.json({ success: false, error: '缺少玩家ID' });
      return;
    }

    const game = games.get(playerId);

    if (game) {
      game.cleanup();
      games.delete(playerId);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Single player end error:', error);
    res.json({ success: false, error: error.message });
  }
});

export default router;
