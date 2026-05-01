// 客户端 → 服务端 事件
export enum ClientEvents {
  // 连接相关
  JOIN_ROOM = 'room:join',
  LEAVE_ROOM = 'room:leave',
  CREATE_ROOM = 'room:create',
  
  // 游戏准备
  PLAYER_READY = 'room:ready',
  START_GAME = 'room:start',
  GET_CHIPS = 'room:get_chips',
  
  // 游戏动作
  PLAYER_ACTION = 'game:action',
  
  // 聊天
  SEND_CHAT = 'chat:send',
}

// 服务端 → 客户端 事件
export enum ServerEvents {
  // 连接相关
  CONNECTED = 'connection:connected',
  ERROR = 'connection:error',
  
  // 房间事件
  ROOM_CREATED = 'room:created',
  ROOM_JOINED = 'room:joined',
  ROOM_LEFT = 'room:left',
  ROOM_UPDATED = 'room:updated',
  PLAYER_JOINED = 'room:player_joined',
  PLAYER_LEFT = 'room:player_left',
  PLAYER_READY_CHANGED = 'room:player_ready_changed',
  
  // 游戏事件
  GAME_STARTED = 'game:started',
  GAME_ENDED = 'game:ended',
  DEAL_CARDS = 'game:deal_cards',
  COMMUNITY_CARDS = 'game:community_cards',
  PLAYER_TURN = 'game:player_turn',
  ACTION_RESULT = 'game:action_result',
  POT_UPDATED = 'game:pot_updated',
  SHOWDOWN = 'game:showdown',
  HAND_RESULT = 'game:hand_result',
  
  // 系统事件
  CHAT_MESSAGE = 'chat:message',
  SYSTEM_MESSAGE = 'system:message',
  CHIPS_RECEIVED = 'system:chips_received',
  ERROR_MESSAGE = 'system:error',
}

// WebSocket 消息格式
export interface WebSocketMessage<T = unknown> {
  event: string;
  payload: T;
  timestamp: number;
  messageId: string;
}

// 加入房间事件payload
export interface JoinRoomPayload {
  roomId: string;
  playerName: string;
  password?: string;
}

// 玩家动作payload
export interface PlayerActionPayload {
  roomId: string;
  action: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  amount?: number;
}

// 发牌payload
export interface DealCardsPayload {
  handId: string;
  cards: [import('./poker').Card, import('./poker').Card];
}

// 公共牌payload
export interface CommunityCardsPayload {
  phase: import('./poker').GamePhase;
  cards: import('./poker').Card[];
}

// 玩家回合payload
export interface PlayerTurnPayload {
  playerId: string;
  playerName: string;
  timeout: number;
  validActions: string[];
  callAmount: number;
  minRaise: number;
  maxRaise: number;
}

// 动作结果payload
export interface ActionResultPayload {
  playerId: string;
  playerName: string;
  action: string;
  amount?: number;
  currentBet: number;
  pot: number;
  nextPlayerId?: string;
}

// 聊天消息payload
export interface ChatMessagePayload {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

// 系统消息payload
export interface SystemMessagePayload {
  type: 'info' | 'warning' | 'success' | 'error';
  message: string;
  timestamp: number;
}
