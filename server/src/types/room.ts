import { GamePhase, PlayerStatus, PlayerRole, Card, RunItTwiceChoice, GameVariant, GameModifier, MixedRotationConfig } from './poker';

export interface CreateRoomRequest {
  roomName?: string;
  maxPlayers?: number;
  smallBlind?: number;
  bigBlind?: number;
  buyInMin?: number;
  buyInMax?: number;
  isPrivate?: boolean;
  password?: string;
  hostName?: string;
  gameVariant?: GameVariant;
  gameModifier?: GameModifier;
  mixedRotation?: MixedRotationConfig;
}

export interface JoinRoomRequest {
  roomId?: string;
  playerName: string;
  password?: string;
}

export interface RoomConfig {
  roomId: string;
  roomName: string;
  hostId: string;
  createdAt: number;
  maxPlayers: number;
  minPlayers: number;
  smallBlind: number;
  bigBlind: number;
  buyInMin: number;
  buyInMax: number;
  actionTimeout: number;
  autoStart: boolean;
  autoStartDelay: number;
  isPrivate: boolean;
  password?: string;
  allowSpectate: boolean;
  allowChat: boolean;
  gameVariant: GameVariant;
  gameModifier: GameModifier;
  mixedRotation?: MixedRotationConfig;
}

export enum RoomStatus {
  WAITING = 'waiting',
  PLAYING = 'playing',
  ENDED = 'ended',
}

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
  joinedAt: number;
  hasPlayedHand?: boolean;
  disconnectedAt?: number;
}

export interface Room {
  config: RoomConfig;
  status: RoomStatus;
  players: RoomPlayer[];
  gameState?: GameState;
  spectators: string[];
  voteLeave?: {
    initiatorId: string;
    initiatorName: string;
    votes: Map<string, boolean>;
    approved: boolean;
  };
  voteLeaveCooldowns?: Map<string, number>;
}

export interface RunItTwiceDiceResult {
  player1: { id: string; value: number };
  player2: { id: string; value: number };
  finalChoice: RunItTwiceChoice;
}

export interface RunItTwiceRoundResult {
  communityCards: Card[];
  winnerIds: string[];
  winAmount: number;
  potAmount: number;
  handRanks: Record<string, string>;
}

export interface GameState {
  handId: string;
  phase: GamePhase;
  deck: Card[];
  communityCards: Card[];
  boardCards: Card[][];
  pots: Pot[];
  totalPot: number;
  currentPlayerIndex: number;
  currentPlayerId: string;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  lastRaiseIndex: number;
  currentBet: number;
  minRaise: number;
  roundBets: Record<string, number>;
  playerCards: Record<string, Card[]>;
  playerStatus: Record<string, PlayerStatus>;
  playerRoles: Record<string, PlayerRole>;
  actions: PlayerActionRecord[];
  startTime: number;
  isHeadsUpAllIn: boolean;
  runItTwiceChoices: Record<string, RunItTwiceChoice>;
  runItTwiceDiceResult: RunItTwiceDiceResult | null;
  runItTwiceDiceReady: Record<string, boolean>;
  runItTwiceBoard: Card[][];
  runItTwiceResults: RunItTwiceRoundResult[];
  lastShowdownResult: {
    winners: WinnerInfo[];
    allHands: PlayerHandInfo[];
    communityCards: Card[];
    runItTwiceBoard: Card[][];
    runItTwiceResults: RunItTwiceRoundResult[];
  } | null;
}

export interface Pot {
  id: string;
  amount: number;
  eligiblePlayers: string[];
}

export interface PlayerActionRecord {
  playerId: string;
  playerName: string;
  action: string;
  amount?: number;
  timestamp: number;
  phase: GamePhase;
}

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

export interface PlayerHandInfo {
  playerId: string;
  playerName: string;
  holeCards: Card[];
  handRank: string;
  handDescription: string;
  isWinner: boolean;
  winAmount?: number;
  potType?: 'main' | 'side' | 'both';
  netWin?: number;
  roundHandRanks?: string[];
}

export interface PotResult {
  potId: string;
  amount: number;
  winners: string[];
  splitAmount: number;
  remainder: number;
}
