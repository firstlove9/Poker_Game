// 扑克牌
export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string;
  code: string;
}

// 房间
export interface Room {
  config: {
    roomId: string;
    roomName: string;
    hostId: string;
    maxPlayers: number;
    smallBlind: number;
    bigBlind: number;
    buyInMin: number;
    buyInMax: number;
    isPrivate: boolean;
  };
  status: 'waiting' | 'playing' | 'ended';
  players: RoomPlayer[];
  gameState?: GameState;
}

// 房间中的玩家
export interface RoomPlayer {
  id: string;
  name: string;
  avatar: string;
  seatIndex: number;
  chips: number;
  totalBuyIn: number;
  isReady: boolean;
  isOnline: boolean;
  isNpc?: boolean;
}

// 游戏状态
export interface GameState {
  handId: string;
  phase: string;
  communityCards: Card[];
  pots: Pot[];
  currentPlayerIndex: number;
  currentPlayerId: string;
  currentBet: number;
  minRaise: number;
  roundBets: Record<string, number>;
  playerStatus: Record<string, string>;
  playerRoles: Record<string, string>;
}

// 底池
export interface Pot {
  id: string;
  amount: number;
}

// 赢家信息
export interface WinnerInfo {
  playerId: string;
  playerName: string;
  winAmount: number;
  handRank: string;
  handDescription: string;
  explanation: string;
  holeCards: Card[];
  winningCards: Card[];
}

// 所有玩家手牌信息
export interface PlayerHandInfo {
  playerId: string;
  playerName: string;
  holeCards: Card[];
  handRank: string;
  handDescription: string;
  isWinner: boolean;
  winAmount?: number;
}

// WebSocket事件
export enum ClientEvents {
  CREATE_ROOM = 'room:create',
  JOIN_ROOM = 'room:join',
  LEAVE_ROOM = 'room:leave',
  PLAYER_READY = 'room:ready',
  START_GAME = 'room:start',
  GET_CHIPS = 'room:get_chips',
  PLAYER_ACTION = 'game:action',
  SEND_CHAT = 'chat:send',
  VOTE_LEAVE = 'room:vote_leave',
  VOTE_LEAVE_RESPONSE = 'room:vote_leave_response',
}

export enum ServerEvents {
  CONNECTED = 'connection:connected',
  ROOM_CREATED = 'room:created',
  ROOM_JOINED = 'room:joined',
  ROOM_UPDATED = 'room:updated',
  PLAYER_JOINED = 'room:player_joined',
  PLAYER_LEFT = 'room:player_left',
  PLAYER_READY_CHANGED = 'room:player_ready_changed',
  GAME_STARTED = 'game:started',
  DEAL_CARDS = 'game:deal_cards',
  PLAYER_TURN = 'game:player_turn',
  ACTION_RESULT = 'game:action_result',
  SHOWDOWN = 'game:showdown',
  HAND_RESULT = 'game:hand_result',
  CHAT_MESSAGE = 'chat:message',
  CHIPS_RECEIVED = 'system:chips_received',
  ROOM_LEFT = 'room:left',
  VOTE_LEAVE_STARTED = 'room:vote_leave_started',
  VOTE_LEAVE_RESPONSE = 'room:vote_leave_response',
  VOTE_LEAVE_ENDED = 'room:vote_leave_ended',
  ROOM_CLOSED = 'room:closed',
}
