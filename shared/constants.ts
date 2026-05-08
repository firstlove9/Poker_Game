// 游戏常量

// 座位配置
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;

// 默认游戏配置
export const DEFAULT_ROOM_CONFIG = {
  maxPlayers: 9,
  minPlayers: 2,
  smallBlind: 10,
  bigBlind: 20,
  buyInMin: 2000,
  buyInMax: 20000,
  actionTimeout: 30,
  autoStart: false,
  autoStartDelay: 10,
  allowSpectate: true,
  allowChat: true,
};

// 牌面配置
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

// 花色符号
export const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

// 花色颜色
export const SUIT_COLORS: Record<string, string> = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black',
};

// 房间ID长度
export const ROOM_ID_LENGTH = 6;

// 默认初始筹码
export const DEFAULT_INITIAL_CHIPS = 1000;

// 补充筹码数量
export const REPLENISH_CHIPS_AMOUNT = 1000;
