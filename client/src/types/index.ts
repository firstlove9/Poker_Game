export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string;
  code: string;
}

export type RunItTwiceChoice = 'once' | 'twice';

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

export interface Room {
  config: {
    roomId: string;
    roomName: string;
    hostId: string;
    maxPlayers: number;
    minPlayers: number;
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
  hasPlayedHand?: boolean;
}

export interface GameState {
  handId: string;
  phase: string;
  communityCards: Card[];
  pots: Pot[];
  totalPot: number;
  currentPlayerIndex: number;
  currentPlayerId: string;
  currentBet: number;
  minRaise: number;
  roundBets: Record<string, number>;
  playerStatus: Record<string, string>;
  playerRoles: Record<string, string>;
  isHeadsUpAllIn?: boolean;
  runItTwiceChoices?: Record<string, RunItTwiceChoice>;
  runItTwiceDiceResult?: RunItTwiceDiceResult | null;
  runItTwiceDiceReady?: Record<string, boolean>;
  runItTwiceBoard?: Card[][];
  runItTwiceResults?: RunItTwiceRoundResult[];
}

export interface Pot {
  id: string;
  amount: number;
}

export interface WinnerInfo {
  playerId: string;
  playerName: string;
  winAmount: number;
  handRank: string;
  handDescription: string;
  explanation: string;
  holeCards: Card[];
  winningCards: Card[];
  potType?: 'main' | 'side' | 'both';
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
  RUN_IT_TWICE_CHOICE = 'game:run_it_twice_choice',
  RUN_IT_TWICE_ROLL_DICE = 'game:run_it_twice_roll_dice',
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
  RUN_IT_TWICE_ASK = 'game:run_it_twice_ask',
  RUN_IT_TWICE_CHOICE_RESULT = 'game:run_it_twice_choice_result',
  RUN_IT_TWICE_DICE_RESULT = 'game:run_it_twice_dice_result',
  RUN_IT_TWICE_EXECUTING = 'game:run_it_twice_executing',
}
