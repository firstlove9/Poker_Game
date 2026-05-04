export enum AICommand {
  HELP = 'help',
  LIST_ROOMS = 'list-rooms',
  CREATE_ROOM = 'create-room',
  JOIN_ROOM = 'join-room',
  LEAVE_ROOM = 'leave-room',
  READY = 'ready',
  START_GAME = 'start-game',
  GET_STATE = 'get-state',
  GET_ACTIONS = 'get-actions',
  ACTION = 'action',
  GET_CHIPS = 'get-chips',
  DECLINE_REBUY = 'decline-rebuy',
  CHAT = 'chat',
  LIST_VARIANTS = 'list-variants',
  LIST_MODIFIERS = 'list-modifiers',
  RULES = 'rules',
  WHOAMI = 'whoami',
}

export interface AICommandDefinition {
  name: AICommand;
  description: string;
  params: AIParamDefinition[];
  examples: string[];
}

export interface AIParamDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  default?: any;
  enum?: string[];
}

export interface AIRequest {
  cmd: AICommand;
  args: Record<string, any>;
  reqId?: string;
}

export interface AIResponse {
  ok: boolean;
  code: number;
  data?: any;
  error?: string;
  log?: string;
  reqId?: string;
}

export const AI_COMMAND_REGISTRY: Record<AICommand, AICommandDefinition> = {
  [AICommand.HELP]: {
    name: AICommand.HELP,
    description: 'Show all available commands and their usage',
    params: [],
    examples: ['help'],
  },
  [AICommand.LIST_ROOMS]: {
    name: AICommand.LIST_ROOMS,
    description: 'List all available rooms',
    params: [],
    examples: ['list-rooms'],
  },
  [AICommand.CREATE_ROOM]: {
    name: AICommand.CREATE_ROOM,
    description: 'Create a new poker room',
    params: [
      { name: 'name', type: 'string', required: false, description: 'Room name' },
      { name: 'maxPlayers', type: 'number', required: false, description: 'Max players (2-10, depends on variant)', default: 9 },
      { name: 'variant', type: 'string', required: false, description: 'Game variant', default: 'texas_nlhe', enum: Object.values(AICommand).length > 0 ? undefined : undefined },
      { name: 'modifier', type: 'string', required: false, description: 'Game modifier', default: 'none' },
      { name: 'password', type: 'string', required: false, description: 'Room password (optional)' },
      { name: 'smallBlind', type: 'number', required: false, description: 'Small blind amount', default: 10 },
      { name: 'bigBlind', type: 'number', required: false, description: 'Big blind amount', default: 20 },
    ],
    examples: ['create-room', 'create-room --name "My Room" --variant texas_plo', 'create-room --maxPlayers 6 --variant squid_holdem'],
  },
  [AICommand.JOIN_ROOM]: {
    name: AICommand.JOIN_ROOM,
    description: 'Join an existing room',
    params: [
      { name: 'roomId', type: 'string', required: true, description: 'Room ID to join' },
      { name: 'name', type: 'string', required: false, description: 'Your display name', default: 'AI_Player' },
      { name: 'password', type: 'string', required: false, description: 'Room password (if private)' },
    ],
    examples: ['join-room --roomId abc123', 'join-room --roomId abc123 --name "PokerBot"'],
  },
  [AICommand.LEAVE_ROOM]: {
    name: AICommand.LEAVE_ROOM,
    description: 'Leave current room',
    params: [],
    examples: ['leave-room'],
  },
  [AICommand.READY]: {
    name: AICommand.READY,
    description: 'Set ready status',
    params: [
      { name: 'ready', type: 'boolean', required: false, description: 'Ready or not', default: true },
    ],
    examples: ['ready', 'ready --ready false'],
  },
  [AICommand.START_GAME]: {
    name: AICommand.START_GAME,
    description: 'Start the game (host only, auto-ready if not ready)',
    params: [],
    examples: ['start-game'],
  },
  [AICommand.GET_STATE]: {
    name: AICommand.GET_STATE,
    description: 'Get current game state (includes your hole cards, community cards, pot, player statuses)',
    params: [],
    examples: ['get-state'],
  },
  [AICommand.GET_ACTIONS]: {
    name: AICommand.GET_ACTIONS,
    description: 'Get valid actions for current player (only when it is your turn)',
    params: [],
    examples: ['get-actions'],
  },
  [AICommand.ACTION]: {
    name: AICommand.ACTION,
    description: 'Execute a poker action',
    params: [
      { name: 'action', type: 'string', required: true, description: 'Action to perform', enum: ['fold', 'check', 'call', 'raise', 'all-in'] },
      { name: 'amount', type: 'number', required: false, description: 'Raise amount (required for raise action)' },
    ],
    examples: ['action --action fold', 'action --action call', 'action --action raise --amount 100', 'action --action all-in'],
  },
  [AICommand.GET_CHIPS]: {
    name: AICommand.GET_CHIPS,
    description: 'Replenish chips when busted (BUSTED→ACTIVE)',
    params: [],
    examples: ['get-chips'],
  },
  [AICommand.DECLINE_REBUY]: {
    name: AICommand.DECLINE_REBUY,
    description: 'Decline rebuy and become a spectator (BUSTED→SPECTATOR)',
    params: [],
    examples: ['decline-rebuy'],
  },
  [AICommand.CHAT]: {
    name: AICommand.CHAT,
    description: 'Send a chat message to the room',
    params: [
      { name: 'message', type: 'string', required: true, description: 'Chat message' },
    ],
    examples: ['chat --message "Nice hand!"'],
  },
  [AICommand.LIST_VARIANTS]: {
    name: AICommand.LIST_VARIANTS,
    description: 'List all available game variants with descriptions',
    params: [],
    examples: ['list-variants'],
  },
  [AICommand.LIST_MODIFIERS]: {
    name: AICommand.LIST_MODIFIERS,
    description: 'List all available game modifiers with descriptions',
    params: [],
    examples: ['list-modifiers'],
  },
  [AICommand.RULES]: {
    name: AICommand.RULES,
    description: 'Get rules for current or specified game variant',
    params: [
      { name: 'variant', type: 'string', required: false, description: 'Variant name to get rules for (defaults to current room variant)' },
    ],
    examples: ['rules', 'rules --variant texas_plo', 'rules --variant squid_holdem'],
  },
  [AICommand.WHOAMI]: {
    name: AICommand.WHOAMI,
    description: 'Show your player ID, name, current room, and status',
    params: [],
    examples: ['whoami'],
  },
};

export const AI_NAMESPACE = '/ai';
