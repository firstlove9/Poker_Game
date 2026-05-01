import { GamePhase, PlayerStatus, PlayerRole } from './poker';
import { Card } from './poker';

// 房间配置
export interface RoomConfig {
  roomId: string;
  roomName: string;
  hostId: string;
  createdAt: number;
  
  // 游戏配置
  maxPlayers: number;
  minPlayers: number;
  smallBlind: number;
  bigBlind: number;
  buyInMin: number;
  buyInMax: number;
  
  // 时间配置
  actionTimeout: number;
  autoStart: boolean;
  autoStartDelay: number;
  
  // 房间设置
  isPrivate: boolean;
  password?: string;
  allowSpectate: boolean;
  allowChat: boolean;
}

// 房间状态
export enum RoomStatus {
  WAITING = 'waiting',
  PLAYING = 'playing',
  ENDED = 'ended',
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
  joinedAt: number;
}

// 房间信息
export interface Room {
  config: RoomConfig;
  status: RoomStatus;
  players: RoomPlayer[];
  gameState?: GameState;
  spectators: string[];
}

// 游戏状态
export interface GameState {
  handId: string;
  phase: GamePhase;
  deck: Card[];
  communityCards: Card[];
  pots: Pot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  lastRaiseIndex: number;
  currentBet: number;
  minRaise: number;
  roundBets: Map<string, number>;
  playerCards: Map<string, [Card, Card]>;
  playerStatus: Map<string, PlayerStatus>;
  playerRoles: Map<string, PlayerRole>;
  actions: PlayerActionRecord[];
  startTime: number;
}

// 底池
export interface Pot {
  id: string;
  amount: number;
  eligiblePlayers: string[];
}

// 玩家动作记录
export interface PlayerActionRecord {
  playerId: string;
  playerName: string;
  action: string;
  amount?: number;
  timestamp: number;
  phase: GamePhase;
}

// 手牌历史
export interface HandHistory {
  handId: string;
  roomId: string;
  startTime: number;
  endTime: number;
  players: string[];
  communityCards: Card[];
  playerHands: Record<string, [Card, Card]>;
  actions: PlayerActionRecord[];
  winners: WinnerInfo[];
  potResults: PotResult[];
}

// 赢家信息
export interface WinnerInfo {
  playerId: string;
  playerName: string;
  winAmount: number;
  potType: 'main' | 'side';
  handRank: string;
  handDescription: string;
  winningCards: Card[];
  holeCards: Card[];
  explanation: string;
}

// 底池结果
export interface PotResult {
  potId: string;
  amount: number;
  winners: string[];
  splitAmount: number;
}

// 创建房间请求
export interface CreateRoomRequest {
  roomName: string;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  buyInMin: number;
  buyInMax: number;
  isPrivate: boolean;
  password?: string;
  hostName: string;
}

// 加入房间请求
export interface JoinRoomRequest {
  roomId: string;
  password?: string;
  playerName: string;
}
