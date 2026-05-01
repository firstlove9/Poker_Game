// 扑克牌定义
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  code: string; // 如 'AS' 表示黑桃A
}

// 牌型等级
export enum HandRank {
  HIGH_CARD = 1,
  ONE_PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
  ROYAL_FLUSH = 10,
}

// 牌型名称映射
export const HandRankNames: Record<HandRank, string> = {
  [HandRank.HIGH_CARD]: '高牌',
  [HandRank.ONE_PAIR]: '一对',
  [HandRank.TWO_PAIR]: '两对',
  [HandRank.THREE_OF_A_KIND]: '三条',
  [HandRank.STRAIGHT]: '顺子',
  [HandRank.FLUSH]: '同花',
  [HandRank.FULL_HOUSE]: '葫芦',
  [HandRank.FOUR_OF_A_KIND]: '四条',
  [HandRank.STRAIGHT_FLUSH]: '同花顺',
  [HandRank.ROYAL_FLUSH]: '皇家同花顺',
};

// 手牌评估结果
export interface HandEvaluation {
  rank: HandRank;
  rankName: string;
  cards: Card[]; // 组成牌型的5张牌
  holeCardsUsed: Card[]; // 使用的底牌
  communityCardsUsed: Card[]; // 使用的公共牌
  description: string; // 描述
  value: number; // 用于比较的数值
}

// 游戏阶段
export enum GamePhase {
  WAITING = 'waiting',       // 等待玩家
  PRE_FLOP = 'pre-flop',     // 发底牌后
  FLOP = 'flop',             // 翻牌
  TURN = 'turn',             // 转牌
  RIVER = 'river',           // 河牌
  SHOWDOWN = 'showdown',     // 摊牌
  ENDED = 'ended',           // 结束
}

// 玩家动作
export enum PlayerAction {
  FOLD = 'fold',
  CHECK = 'check',
  CALL = 'call',
  RAISE = 'raise',
  ALL_IN = 'all-in',
}

// 玩家座位状态
export enum PlayerStatus {
  EMPTY = 'empty',
  WAITING = 'waiting',
  PLAYING = 'playing',
  FOLDED = 'folded',
  ALL_IN = 'all-in',
  AWAY = 'away',
}

// 玩家座位角色
export enum PlayerRole {
  DEALER = 'dealer', // 庄家
  SB = 'sb',         // 小盲注
  BB = 'bb',         // 大盲注
  NONE = 'none',
}
