import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { RoomStatus, PlayerRoomRole } from '../../types/room';
import { GameVariant, GameModifier, VARIANT_RULES, MODIFIER_INFO } from '../../types/poker';
import { AICommand, AIRequest, AIResponse, AI_COMMAND_REGISTRY } from '../../types/ai';
import { gameEngines } from './gameHandler';
import { tryStartGame } from './roomHandler';

function ok(data?: any, log?: string, reqId?: string): AIResponse {
  return { ok: true, code: 0, data, log, reqId };
}

function fail(code: number, error: string, reqId?: string): AIResponse {
  return { ok: false, code, error, reqId };
}

function sanitizeGameState(gameState: any, playerId: string): any {
  if (!gameState) return null;
  const sanitized = JSON.parse(JSON.stringify(gameState));
  const myCards = sanitized.playerCards?.[playerId] || null;
  delete sanitized.playerCards;
  delete sanitized.deck;
  return { ...sanitized, myCards };
}

function sanitizeRoom(room: any): any {
  return {
    config: room.config,
    status: room.status,
    players: room.players.map((p: any) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seatIndex: p.seatIndex,
      chips: p.chips,
      totalBuyIn: p.totalBuyIn,
      isReady: p.isReady,
      isOnline: p.isOnline,
      playerRoomRole: p.playerRoomRole,
    })),
  };
}

export function handleAICommands(socket: Socket, io: Server, roomManager: RoomManager): void {
  const playerId = socket.data.playerId;

  socket.on('ai:cmd', (request: AIRequest, callback?: (response: AIResponse) => void) => {
    const respond = (response: AIResponse) => {
      response.reqId = request.reqId;
      if (typeof callback === 'function') {
        callback(response);
      } else {
        socket.emit('ai:response', response);
      }
    };

    const { cmd, args } = request;

    switch (cmd) {
      case AICommand.HELP:
        respond(handleHelp());
        break;

      case AICommand.LIST_ROOMS:
        respond(handleListRooms(roomManager));
        break;

      case AICommand.CREATE_ROOM:
        respond(handleCreateRoom(args, playerId, roomManager, io, socket));
        break;

      case AICommand.JOIN_ROOM:
        respond(handleJoinRoom(args, playerId, roomManager, io, socket));
        break;

      case AICommand.LEAVE_ROOM:
        respond(handleLeaveRoom(playerId, roomManager, io, socket));
        break;

      case AICommand.READY:
        respond(handleReady(args, playerId, roomManager, io));
        break;

      case AICommand.START_GAME:
        respond(handleStartGame(playerId, roomManager, io));
        break;

      case AICommand.GET_STATE:
        respond(handleGetState(playerId, roomManager));
        break;

      case AICommand.GET_ACTIONS:
        respond(handleGetActions(playerId, roomManager));
        break;

      case AICommand.ACTION:
        respond(handleAction(args, playerId, roomManager, io));
        break;

      case AICommand.GET_CHIPS:
        respond(handleGetChips(playerId, roomManager, io));
        break;

      case AICommand.DECLINE_REBUY:
        respond(handleDeclineRebuy(playerId, roomManager, io));
        break;

      case AICommand.CHAT:
        respond(handleChat(args, playerId, roomManager, io));
        break;

      case AICommand.LIST_VARIANTS:
        respond(handleListVariants());
        break;

      case AICommand.LIST_MODIFIERS:
        respond(handleListModifiers());
        break;

      case AICommand.RULES:
        respond(handleRules(args, playerId, roomManager));
        break;

      case AICommand.WHOAMI:
        respond(handleWhoami(playerId, roomManager));
        break;

      default:
        respond(fail(404, `Unknown command: ${cmd}. Type "help" to see available commands.`));
    }
  });
}

function handleHelp(): AIResponse {
  const commands = Object.values(AI_COMMAND_REGISTRY).map(def => {
    const params = def.params.map(p => {
      const required = p.required ? 'required' : 'optional';
      const defVal = p.default !== undefined ? `, default=${p.default}` : '';
      const enumVals = p.enum ? `, options=[${p.enum.join(',')}]` : '';
      return `    --${p.name} <${p.type}> [${required}${defVal}${enumVals}] ${p.description}`;
    }).join('\n');
    return `${def.name}\n  ${def.description}${params ? '\n' + params : ''}\n  Examples: ${def.examples.join(', ')}`;
  });

  return ok(
    { commands: Object.values(AI_COMMAND_REGISTRY) },
    `Available commands:\n\n${commands.join('\n\n')}`
  );
}

function handleListRooms(roomManager: RoomManager): AIResponse {
  const rooms = roomManager.getRoomList().map(room => ({
    roomId: room.config.roomId,
    roomName: room.config.roomName,
    status: room.status,
    playerCount: room.players.length,
    maxPlayers: room.config.maxPlayers,
    variant: room.config.gameVariant,
    modifier: room.config.gameModifier,
    isPrivate: room.config.isPrivate,
    smallBlind: room.config.smallBlind,
    bigBlind: room.config.bigBlind,
  }));

  return ok(
    { rooms, count: rooms.length },
    `${rooms.length} room(s) available`
  );
}

function handleCreateRoom(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server, socket: Socket): AIResponse {
  const variant = (args.variant || 'texas_nlhe') as GameVariant;
  const variantRule = VARIANT_RULES[variant];
  if (!variantRule) {
    return fail(400, `Invalid variant: ${variant}. Use "list-variants" to see available options.`);
  }

  const maxPlayers = Math.min(
    Math.max(args.maxPlayers || 9, 2),
    variantRule.maxPlayers
  );

  const room = roomManager.createRoom({
    roomName: args.name || `AI_Room_${Date.now().toString(36)}`,
    maxPlayers,
    gameVariant: variant,
    gameModifier: (args.modifier || 'none') as GameModifier,
    password: args.password,
    smallBlind: args.smallBlind || 10,
    bigBlind: args.bigBlind || 20,
    hostName: args.playerName || 'AI_Player',
  }, playerId);

  socket.join(room.config.roomId);

  const joinResult = roomManager.joinRoom(room.config.roomId, {
    roomId: room.config.roomId,
    playerName: args.playerName || 'AI_Player',
  }, playerId);

  if (joinResult.success && joinResult.room) {
    socket.data.roomId = room.config.roomId;

    io.emit('room:updated', {
      type: 'created',
      room: sanitizeRoom(joinResult.room),
    });

    return ok(
      {
        roomId: room.config.roomId,
        roomName: room.config.roomName,
        variant: room.config.gameVariant,
        modifier: room.config.gameModifier,
        maxPlayers: room.config.maxPlayers,
        smallBlind: room.config.smallBlind,
        bigBlind: room.config.bigBlind,
        players: joinResult.room.players.map((p: any) => ({ id: p.id, name: p.name, chips: p.chips })),
      },
      `Room created: ${room.config.roomName} (${room.config.roomId}), variant=${variant}, maxPlayers=${maxPlayers}`
    );
  }

  return fail(500, 'Failed to join created room');
}

function handleJoinRoom(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server, socket: Socket): AIResponse {
  const roomId = args.roomId;
  if (!roomId) {
    return fail(400, 'Missing required parameter: --roomId');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, `Room not found: ${roomId}`);
  }

  if (room.players.length >= room.config.maxPlayers) {
    return fail(409, `Room is full (${room.players.length}/${room.config.maxPlayers})`);
  }

  const result = roomManager.joinRoom(roomId, {
    roomId,
    playerName: args.name || 'AI_Player',
    password: args.password,
  }, playerId);

  if (result.success && result.room) {
    socket.join(roomId);
    socket.data.roomId = roomId;

    io.to(roomId).emit('room:player_joined', {
      player: result.room.players.find((p: any) => p.id === playerId),
      room: sanitizeRoom(result.room),
    });

    io.emit('room:updated', {
      type: 'updated',
      room: sanitizeRoom(result.room),
    });

    return ok(
      {
        roomId,
        roomName: result.room.config.roomName,
        variant: result.room.config.gameVariant,
        modifier: result.room.config.gameModifier,
        players: result.room.players.map((p: any) => ({ id: p.id, name: p.name, chips: p.chips, isReady: p.isReady })),
      },
      `Joined room: ${result.room.config.roomName} (${roomId})`
    );
  }

  return fail(400, result.error || 'Failed to join room');
}

function handleLeaveRoom(playerId: string, roomManager: RoomManager, io: Server, socket: Socket): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const result = roomManager.leaveRoom(playerId);
  if (result.success) {
    socket.leave(roomId);

    const updatedRoom = roomManager.getRoom(roomId);
    if (updatedRoom) {
      io.to(roomId).emit('room:player_left', {
        playerId,
        room: sanitizeRoom(updatedRoom),
      });
      io.emit('room:updated', {
        type: 'updated',
        room: sanitizeRoom(updatedRoom),
      });
    } else {
      io.emit('room:updated', { type: 'deleted', roomId });
    }

    socket.data.roomId = null;
    return ok(null, `Left room: ${roomId}`);
  }

  return fail(400, result.error || 'Failed to leave room');
}

function handleReady(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const ready = args.ready !== false;
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  if (room.status === RoomStatus.PLAYING) {
    return fail(409, 'Game is already in progress');
  }

  const result = roomManager.setPlayerReady(playerId, ready);
  if (result.success) {
    io.to(roomId).emit('room:player_ready_changed', {
      playerId,
      ready,
      room: sanitizeRoom(room),
    });

    if (ready) {
      const hasPlayedBefore = room.players.some(p =>
        p.playerRoomRole === PlayerRoomRole.ACTIVE || p.playerRoomRole === PlayerRoomRole.BUSTED
      );
      if (hasPlayedBefore) {
        tryStartGame(roomId, roomManager, io);
      }
    }

    return ok({ ready }, `Ready status: ${ready}`);
  }

  return fail(400, result.error || 'Failed to set ready status');
}

function handleStartGame(playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  if (room.config.hostId === playerId) {
    const host = room.players.find(p => p.id === playerId);
    if (host && !host.isReady && host.chips > 0) {
      host.isReady = true;
      io.to(roomId).emit('room:player_ready_changed', {
        playerId,
        ready: true,
        room: sanitizeRoom(room),
      });
    }
  }

  const started = tryStartGame(roomId, roomManager, io);
  if (started) {
    return ok(null, 'Game started!');
  }

  const currentRoom = roomManager.getRoom(roomId);
  if (currentRoom && currentRoom.status === RoomStatus.PLAYING) {
    return fail(409, 'Game is already in progress');
  }

  const readyPlayers = currentRoom?.players.filter(p => p.isReady && p.chips > 0) || [];
  return fail(400, `Cannot start: need at least ${currentRoom?.config.minPlayers || 2} ready players with chips (currently ${readyPlayers.length} ready)`);
}

function handleGetState(playerId: string, roomManager: RoomManager): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const gameEngine = gameEngines.get(roomId);
  const myCards = gameEngine?.getPlayerCards(playerId) || null;
  const isMyTurn = gameEngine?.getCurrentPlayerId() === playerId;
  const validActions = isMyTurn ? gameEngine!.getValidActions(playerId) : [];

  const stateData: any = {
    roomId,
    roomName: room.config.roomName,
    roomStatus: room.status,
    variant: room.config.gameVariant,
    modifier: room.config.gameModifier,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      isReady: p.isReady,
      isOnline: p.isOnline,
      status: room.gameState?.playerStatus?.[p.id] || null,
      role: room.gameState?.playerRoles?.[p.id] || null,
      roundBet: room.gameState?.roundBets?.[p.id] || 0,
    })),
    myCards,
    isMyTurn,
    validActions,
  };

  if (room.gameState) {
    stateData.phase = room.gameState.phase;
    stateData.communityCards = room.gameState.communityCards;
    stateData.pot = room.gameState.totalPot;
    stateData.currentBet = room.gameState.currentBet;
    stateData.minRaise = room.gameState.minRaise;
    stateData.dealerIndex = room.gameState.dealerIndex;
    stateData.currentPlayerId = room.gameState.currentPlayerId;
    stateData.pots = room.gameState.pots;
    stateData.handId = room.gameState.handId;
  }

  if (room.gameState?.lastShowdownResult) {
    stateData.lastResult = {
      winners: room.gameState.lastShowdownResult.winners,
      allHands: room.gameState.lastShowdownResult.allHands,
      communityCards: room.gameState.lastShowdownResult.communityCards,
    };
  }

  return ok(stateData, `Phase: ${stateData.phase || 'waiting'}, Your turn: ${isMyTurn}`);
}

function handleGetActions(playerId: string, roomManager: RoomManager): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room || room.status !== RoomStatus.PLAYING) {
    return fail(400, 'No active game');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const currentPlayerId = gameEngine.getCurrentPlayerId();
  if (currentPlayerId !== playerId) {
    return ok(
      { isMyTurn: false, currentPlayerId, validActions: [] },
      `Not your turn. Current player: ${currentPlayerId}`
    );
  }

  const validActions = gameEngine.getValidActions(playerId);
  const state = gameEngine.getState();
  const myBet = state.roundBets[playerId] || 0;
  const toCall = state.currentBet - myBet;
  const player = gameEngine.getPlayers().find(p => p.id === playerId);
  const maxRaise = gameEngine.getMaxRaise(playerId);

  return ok(
    {
      isMyTurn: true,
      validActions,
      toCall,
      currentBet: state.currentBet,
      myBet,
      myChips: player?.chips || 0,
      minRaise: state.minRaise,
      maxRaise: maxRaise === Infinity ? 'no-limit' : maxRaise,
      pot: state.totalPot,
    },
    `Your turn! Actions: ${validActions.join(', ')}${toCall > 0 ? `, toCall=${toCall}` : ''}`
  );
}

function handleAction(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const action = args.action;
  if (!action) {
    return fail(400, 'Missing required parameter: --action (fold|check|call|raise|all-in)');
  }

  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room || room.status !== RoomStatus.PLAYING) {
    return fail(400, 'No active game');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const currentPlayerId = gameEngine.getCurrentPlayerId();
  if (currentPlayerId !== playerId) {
    return fail(409, `Not your turn. Current player: ${currentPlayerId}`);
  }

  const actionMap: Record<string, any> = {
    'fold': 'fold',
    'check': 'check',
    'call': 'call',
    'raise': 'raise',
    'all-in': 'all-in',
    'allin': 'all-in',
  };

  const normalizedAction = actionMap[action.toLowerCase()];
  if (!normalizedAction) {
    return fail(400, `Invalid action: ${action}. Valid: fold, check, call, raise, all-in`);
  }

  const validActions = gameEngine.getValidActions(playerId);
  if (!validActions.includes(normalizedAction)) {
    return fail(400, `Action "${normalizedAction}" is not valid now. Available: ${validActions.join(', ')}`);
  }

  const { PlayerAction } = require('../../types/poker');
  const playerActionMap: Record<string, any> = {
    'fold': PlayerAction.FOLD,
    'check': PlayerAction.CHECK,
    'call': PlayerAction.CALL,
    'raise': PlayerAction.RAISE,
    'all-in': PlayerAction.ALL_IN,
  };

  const result = gameEngine.performAction(playerId, playerActionMap[normalizedAction], args.amount);

  if (result.success) {
    const gameState = gameEngine.getState();
    room.gameState = gameState;

    const enginePlayers = gameEngine.getPlayers();
    for (const ep of enginePlayers) {
      const roomPlayer = room.players.find((p: any) => p.id === ep.id);
      if (roomPlayer) roomPlayer.chips = ep.chips;
    }

    const actor = room.players.find((p: any) => p.id === playerId);
    const actorName = actor?.name || playerId;

    const { GamePhase } = require('../../types/poker');
    const isGameEnding = gameState.phase === GamePhase.SHOWDOWN || gameState.phase === GamePhase.ENDED;

    io.to(roomId).emit('game:action_result', {
      playerId,
      playerName: actorName,
      action: normalizedAction,
      amount: args.amount,
      gameState: { ...gameState, playerCards: {} },
      room: sanitizeRoom(room),
    });

    if (isGameEnding) {
      const { winners, potResults, allHands } = gameEngine.showdown();
      const finalGameState = gameEngine.getState();
      room.gameState = finalGameState;

      for (const ep of gameEngine.getPlayers()) {
        const roomPlayer = room.players.find((p: any) => p.id === ep.id);
        if (roomPlayer) roomPlayer.chips = ep.chips;
      }

      for (const w of winners) {
        const roomPlayer = room.players.find((p: any) => p.id === w.playerId);
        if (roomPlayer) w.playerName = roomPlayer.name;
      }
      for (const h of allHands) {
        const roomPlayer = room.players.find((p: any) => p.id === h.playerId);
        if (roomPlayer) h.playerName = roomPlayer.name;
      }

      room.status = RoomStatus.WAITING;
      for (const p of room.players) {
        const isInGame = gameEngine.getPlayers().some(gp => gp.id === p.id);
        if (isInGame) p.isReady = false;
      }

      io.to(roomId).emit('game:showdown', {
        winners,
        potResults,
        allHands,
        communityCards: finalGameState.communityCards,
        gameState: { ...finalGameState, playerCards: {} },
        room: sanitizeRoom(room),
      });

      io.to(roomId).emit('game:hand_result', {
        winners,
        potResults,
        allHands,
        communityCards: finalGameState.communityCards,
        room: sanitizeRoom(room),
      });

      room.gameState = {
        ...room.gameState,
        currentBet: 0,
        minRaise: room.config?.bigBlind || 20,
        roundBets: {},
        pots: [],
        totalPot: 0,
        actions: [],
        communityCards: [],
        playerCards: {},
        playerStatus: {},
        playerRoles: {},
        lastRaiseIndex: -1,
        currentPlayerIndex: -1,
        currentPlayerId: '',
        isHeadsUpAllIn: false,
        runItTwiceChoices: {},
        runItTwiceDiceResult: null,
        runItTwiceDiceReady: {},
        runItTwiceBoard: [],
        runItTwiceResults: [],
        lastShowdownResult: {
          winners,
          allHands,
          communityCards: finalGameState.communityCards,
          runItTwiceBoard: finalGameState.runItTwiceBoard || [],
          runItTwiceResults: finalGameState.runItTwiceResults || [],
        },
      };

      io.to(roomId).emit('room:updated', {
        type: 'updated',
        room: sanitizeRoom(room),
      });

      return ok(
        {
          action: normalizedAction,
          amount: args.amount,
          phase: 'showdown',
          winners: winners.map((w: any) => ({ id: w.playerId, name: w.playerName, amount: w.winAmount, hand: w.handDescription })),
          myCards: gameEngine.getPlayerCards(playerId),
        },
        `Action: ${normalizedAction}${args.amount ? ` ${args.amount}` : ''} → Showdown! Winner: ${winners.map((w: any) => w.playerName).join(', ')}`
      );
    }

    const nextPlayerId = gameEngine.getCurrentPlayerId();
    if (nextPlayerId) {
      const nextPlayer = room.players.find((p: any) => p.id === nextPlayerId);
      io.to(roomId).emit('game:player_turn', {
        playerId: nextPlayerId,
        playerName: nextPlayer?.name || nextPlayerId,
        timeout: 30,
        validActions: gameEngine.getValidActions(nextPlayerId),
      });
    }

    const isMyNextTurn = gameEngine.getCurrentPlayerId() === playerId;
    return ok(
      {
        action: normalizedAction,
        amount: args.amount,
        phase: gameState.phase,
        isMyTurn: isMyNextTurn,
        pot: gameState.totalPot,
        currentBet: gameState.currentBet,
      },
      `Action: ${normalizedAction}${args.amount ? ` ${args.amount}` : ''} → Phase: ${gameState.phase}${isMyNextTurn ? ' (your turn again!)' : ''}`
    );
  }

  return fail(400, result.error || 'Action failed');
}

function handleGetChips(playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const result = roomManager.replenishChips(playerId);
  if (result.success) {
    const roomId = roomManager.getPlayerRoomId(playerId);
    if (roomId) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        io.to(roomId).emit('system:chips_received', {
          playerId,
          amount: result.amount,
          room: sanitizeRoom(room),
        });
      }
    }
    return ok({ amount: result.amount }, `Chips replenished: ${result.amount}`);
  }
  return fail(400, result.error || 'Failed to get chips');
}

function handleDeclineRebuy(playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const player = room.players.find((p: any) => p.id === playerId);
  if (!player) {
    return fail(400, 'Player not found in room');
  }

  if (player.playerRoomRole !== PlayerRoomRole.BUSTED) {
    return fail(400, 'Only busted players can decline rebuy');
  }

  player.playerRoomRole = PlayerRoomRole.SPECTATOR;
  player.seatIndex = -1;
  player.chips = 0;
  player.isReady = false;

  io.to(roomId).emit('room:player_ready_changed', {
    playerId,
    ready: false,
    room: sanitizeRoom(room),
  });

  const activePlayers = room.players.filter((p: any) =>
    p.playerRoomRole !== PlayerRoomRole.SPECTATOR && p.chips > 0
  );
  if (activePlayers.length <= 1 && room.players.filter((p: any) => p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length <= 1) {
    const winner = activePlayers[0] || null;
    io.to(roomId).emit('game:game_over', {
      winner: winner ? { id: winner.id, name: winner.name, chips: winner.chips } : null,
      room: sanitizeRoom(room),
    });
  }

  return ok(null, 'Declined rebuy, now spectating');
}

function handleChat(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const message = args.message;
  if (!message) {
    return fail(400, 'Missing required parameter: --message');
  }

  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  const player = room?.players.find(p => p.id === playerId);

  if (player) {
    io.to(roomId).emit('chat:message', {
      playerId,
      playerName: player.name,
      message,
      timestamp: Date.now(),
    });
  }

  return ok(null, `Chat sent: "${message}"`);
}

function handleListVariants(): AIResponse {
  const variants = Object.entries(VARIANT_RULES).map(([key, rule]) => ({
    id: key,
    name: rule.name,
    icon: rule.icon,
    category: rule.category,
    shortDesc: rule.shortDesc,
    maxPlayers: rule.maxPlayers,
    holeCardCount: rule.holeCardCount,
    communityCardCount: rule.communityCardCount,
    isPotLimit: rule.isPotLimit,
    isFixedLimit: rule.isFixedLimit,
  }));

  return ok(
    { variants, count: variants.length },
    `${variants.length} variants available: ${variants.map(v => `${v.id}(${v.name})`).join(', ')}`
  );
}

function handleListModifiers(): AIResponse {
  const modifiers = Object.entries(MODIFIER_INFO).map(([key, info]) => ({
    id: key,
    name: info.name,
    icon: info.icon,
    shortDesc: info.shortDesc,
    needsBaseVariant: info.needsBaseVariant,
  }));

  return ok(
    { modifiers, count: modifiers.length },
    `${modifiers.length} modifiers available: ${modifiers.map(m => `${m.id}(${m.name})`).join(', ')}`
  );
}

function handleRules(args: Record<string, any>, playerId: string, roomManager: RoomManager): AIResponse {
  const variantKey = args.variant as GameVariant;

  if (variantKey) {
    const rule = VARIANT_RULES[variantKey];
    if (!rule) {
      return fail(404, `Variant not found: ${variantKey}. Use "list-variants" to see available options.`);
    }
    return ok({
      id: rule.id,
      name: rule.name,
      fullDesc: rule.fullDesc,
      specialRules: rule.specialRules,
      holeCardCount: rule.holeCardCount,
      communityCardCount: rule.communityCardCount,
      boardCount: rule.boardCount,
      isPotLimit: rule.isPotLimit,
      isFixedLimit: rule.isFixedLimit,
      maxPlayers: rule.maxPlayers,
      handRankOrder: rule.handRankOrder,
    });
  }

  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'Not in a room. Specify --variant or join a room first.');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const rule = VARIANT_RULES[room.config.gameVariant];
  if (!rule) {
    return fail(404, 'Current variant rules not found');
  }

  const modifierInfo = room.config.gameModifier !== GameModifier.NONE
    ? MODIFIER_INFO[room.config.gameModifier]
    : null;

  return ok({
    id: rule.id,
    name: rule.name,
    fullDesc: rule.fullDesc,
    specialRules: rule.specialRules,
    holeCardCount: rule.holeCardCount,
    communityCardCount: rule.communityCardCount,
    boardCount: rule.boardCount,
    isPotLimit: rule.isPotLimit,
    isFixedLimit: rule.isFixedLimit,
    maxPlayers: rule.maxPlayers,
    handRankOrder: rule.handRankOrder,
    modifier: modifierInfo ? {
      id: modifierInfo.id,
      name: modifierInfo.name,
      fullDesc: modifierInfo.fullDesc,
      specialRules: modifierInfo.specialRules,
    } : null,
  });
}

function handleWhoami(playerId: string, roomManager: RoomManager): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  let roomInfo = null;

  if (roomId) {
    const room = roomManager.getRoom(roomId);
    if (room) {
      const me = room.players.find(p => p.id === playerId);
      roomInfo = {
        roomId,
        roomName: room.config.roomName,
        isHost: room.config.hostId === playerId,
        variant: room.config.gameVariant,
        modifier: room.config.gameModifier,
        chips: me?.chips || 0,
        isReady: me?.isReady || false,
        playerCount: room.players.length,
        maxPlayers: room.config.maxPlayers,
      };
    }
  }

  return ok({
    playerId,
    roomId: roomId || null,
    room: roomInfo,
  });
}
