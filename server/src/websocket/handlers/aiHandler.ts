import { Socket, Server } from 'socket.io';
import { RoomManager } from '../../room/RoomManager';
import { RoomStatus, PlayerRoomRole } from '../../types/room';
import { GameVariant, GameModifier, VARIANT_RULES, MODIFIER_INFO } from '../../types/poker';
import { AICommand, AIRequest, AIResponse, AI_COMMAND_REGISTRY } from '../../types/ai';
import { gameEngines, finishHand } from './gameHandler';
import { tryStartGame, handlePlayerTurnWithAfk } from './roomHandler';
import { addActionLog, loadRoomLogs } from '../../room/ActionLogManager';

const AI_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const aiLastActivity: Map<string, number> = new Map();

export function trackAIActivity(playerId: string): void {
  aiLastActivity.set(playerId, Date.now());
}

export function checkAIIdle(io: Server, roomManager: RoomManager): void {
  const now = Date.now();
  for (const [playerId, lastActivity] of aiLastActivity.entries()) {
    if (now - lastActivity > AI_IDLE_TIMEOUT_MS) {
      const roomId = roomManager.getPlayerRoomId(playerId);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          const player = room.players.find((p: any) => p.id === playerId);
          if (player && player.isOnline) {
            player.isOnline = false;
            player.disconnectedAt = Date.now();
            console.log(`[AI-IDLE] AI player ${player.name} (${playerId}) marked offline after 10min idle`);
            io.to(roomId).emit('room:player_left', {
              playerId,
              room: sanitizeRoom(room),
              isTemporary: true,
            });
          }
        }
      }
      aiLastActivity.delete(playerId);
    }
  }
}

export function checkRoomAutoClose(io: Server, roomManager: RoomManager): void {
  const ROOM_EMPTY_TIMEOUT_MS = 30 * 60 * 1000;
  const rooms = roomManager.getRoomList();
  for (const room of rooms) {
    const allOffline = room.players.length > 0 && room.players.every((p: any) => !p.isOnline);
    if (allOffline) {
      const earliestDisconnect = room.players.reduce((min: number, p: any) => {
        if (p.disconnectedAt && (!min || p.disconnectedAt < min)) return p.disconnectedAt;
        return min;
      }, 0);
      if (earliestDisconnect && Date.now() - earliestDisconnect > ROOM_EMPTY_TIMEOUT_MS) {
        const roomId = room.config.roomId;
        console.log(`[ROOM-AUTO-CLOSE] Room ${room.config.roomName} (${roomId}) closed: all players offline for 30min`);
        gameEngines.delete(roomId);
        roomManager.deleteRoom(roomId);
        io.emit('room:updated', { type: 'deleted', roomId });
      }
    }
  }
}

function isOnlyActivePlayerOnline(room: any, playerId: string): boolean {
  const otherPlayers = room.players.filter((p: any) => p.id !== playerId);
  const allOthersSpectatorOrOffline = otherPlayers.every((p: any) =>
    p.playerRoomRole === PlayerRoomRole.SPECTATOR || !p.isOnline
  );
  return allOthersSpectatorOrOffline && otherPlayers.length > 0;
}

function syncPlayerChipsToRoom(gameEngine: any, room: any): void {
  const enginePlayers = gameEngine.getPlayers();
  for (const ep of enginePlayers) {
    const roomPlayer = room.players.find((p: any) => p.id === ep.id);
    if (roomPlayer) {
      roomPlayer.chips = ep.chips;
    }
  }
}

function ok(data?: any, log?: string, reqId?: string): AIResponse {
  return { ok: true, code: 0, data, log, reqId };
}

function fail(code: number, error: string, reqId?: string): AIResponse {
  return { ok: false, code, error, reqId };
}

function sanitizeGameState(gameState: any, playerId?: string): any {
  if (!gameState) return null;
  const sanitized = JSON.parse(JSON.stringify(gameState));
  if (playerId) {
    sanitized.myCards = sanitized.playerCards?.[playerId] || null;
  }
  sanitized.playerCards = {};
  delete sanitized.deck;
  return sanitized;
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
      isAfk: p.isAfk,
      hasPlayedHand: p.hasPlayedHand,
      playerRoomRole: p.playerRoomRole,
    })),
    scoreboardEntries: room.scoreboardEntries || [],
    playerRebuyCounts: room.playerRebuyCounts || {},
    handCount: room.handCount || 0,
  };
}

export function handleAICommands(socket: Socket, io: Server, roomManager: RoomManager): void {
  const playerId = socket.data.playerId;
  trackAIActivity(playerId);

  socket.on('ai:cmd', (request: AIRequest, callback?: (response: AIResponse) => void) => {
    trackAIActivity(playerId);
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

      case AICommand.RUN_IT_TWICE_CHOICE:
        respond(handleRunItTwiceChoice(args, playerId, roomManager, io));
        break;

      case AICommand.ROLL_DICE:
        respond(handleRollDice(playerId, roomManager, io));
        break;

      case AICommand.VOTE_EXTEND_HANDS:
        respond(handleVoteExtendHands(args, playerId, roomManager, io, socket));
        break;

      case AICommand.DRAW:
        respond(handleDraw(args, playerId, roomManager, io));
        break;

      case AICommand.DISCARD:
        respond(handleDiscard(args, playerId, roomManager, io));
        break;

      case AICommand.SHOW_CARDS:
        respond(handleShowCards(playerId, roomManager, io));
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

  try {
    const room = roomManager.createRoom({
      roomName: args.name || `AI_Room_${Date.now().toString(36)}`,
      maxPlayers,
      gameVariant: variant,
      gameModifier: (args.modifier || 'none') as GameModifier,
      password: args.password,
      smallBlind: args.smallBlind || 10,
      bigBlind: args.bigBlind || 20,
      hostName: args.playerName || 'AI_Player',
      fixedHands: args.fixedHands,
      maxRebuyCount: args.maxRebuyCount,
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
  } catch (e: any) {
    return fail(400, e.message || 'Failed to create room');
  }
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

  const room = roomManager.getRoom(roomId);
  const wasOnlyActive = room ? isOnlyActivePlayerOnline(room, playerId) : false;

  let result = roomManager.leaveRoom(playerId);

  if (!result.success && room && wasOnlyActive) {
    result = roomManager.leaveRoom(playerId, true);
  }

  if (result.success) {
    socket.leave(roomId);

    if (wasOnlyActive) {
      gameEngines.delete(roomId);
      roomManager.deleteRoom(roomId);
      io.to(roomId).emit('room:player_left', { playerId, reason: 'only-active-left' });
      io.emit('room:updated', { type: 'deleted', roomId });
    } else {
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
    }

    socket.data.roomId = null;
    return ok({ roomClosed: wasOnlyActive }, `Left room: ${roomId}${wasOnlyActive ? ' (room closed - only active player)' : ''}`);
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
      playerRoomRole: p.playerRoomRole,
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
    stateData.boardCards = room.gameState.boardCards;
    stateData.targetSuit = room.gameState.targetSuit;
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

    syncPlayerChipsToRoom(gameEngine, room);

    const preActionState = gameEngine.getState();
    const preActionBet = preActionState.roundBets[playerId] || 0;
    const preActionChips = gameEngine.getPlayers().find((p: any) => p.id === playerId)?.chips || 0;

    let actualAmount = args.amount;
    if (normalizedAction === 'call') {
      actualAmount = Math.min(preActionState.currentBet - preActionBet, preActionChips);
    } else if (normalizedAction === 'all-in') {
      actualAmount = preActionChips;
    } else if (!actualAmount && normalizedAction !== 'fold' && normalizedAction !== 'check') {
      const postActionBet = gameState.roundBets[playerId] || 0;
      actualAmount = postActionBet - preActionBet;
    }

    const actor = room.players.find((p: any) => p.id === playerId);
    if (actor) {
      loadRoomLogs(roomId);
      addActionLog(roomId, gameState.handId || '', playerId, actor.name, normalizedAction, actualAmount, gameState.phase);
    }
    const actorName = actor?.name || playerId;

    const { GamePhase } = require('../../types/poker');
    const isGameEnding = gameState.phase === GamePhase.SHOWDOWN || gameState.phase === GamePhase.ENDED;
    const isRunItTwiceChoice = gameState.phase === GamePhase.RUN_IT_TWICE_CHOICE;

    io.to(roomId).emit('game:action_result', {
      playerId,
      playerName: actorName,
      action: normalizedAction,
      amount: actualAmount,
      gameState: sanitizeGameState(gameState),
      ...(isGameEnding ? {} : { room: sanitizeRoom(room) }),
    });

    if (isRunItTwiceChoice) {
      const nonFoldedPlayers = room.players.filter((p: any) =>
        gameState.playerStatus?.[p.id] !== 'folded'
      );

      const allAI = nonFoldedPlayers.length === 2 && nonFoldedPlayers.every((p: any) => p.id.startsWith('ai_'));
      if (allAI) {
        const autoResult = gameEngine.submitRunItTwiceChoice(nonFoldedPlayers[0].id, 'once');
        if (autoResult.success) {
          gameEngine.submitRunItTwiceChoice(nonFoldedPlayers[1].id, 'once');
        }
        room.gameState = gameEngine.getState();

        const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
        const { winners, potResults, allHands } = gameEngine.showdown();
        const finalGameState = gameEngine.getState();
        room.gameState = finalGameState;
        syncPlayerChipsToRoom(gameEngine, room);

        for (const w of winners) {
          const roomPlayer = room.players.find((rp: any) => rp.id === w.playerId);
          if (roomPlayer) w.playerName = roomPlayer.name;
        }
        for (const h of allHands) {
          const roomPlayer = room.players.find((rp: any) => rp.id === h.playerId);
          if (roomPlayer) h.playerName = roomPlayer.name;
        }

        finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);

        return ok(
          { action: normalizedAction, amount: args.amount, phase: 'showdown', autoSkipRIT: true },
          `Action: ${normalizedAction} → Both AI, skipped RIT (settled once)`
        );
      }

      io.to(roomId).emit('game:run_it_twice_ask', {
        gameState: sanitizeGameState(gameState),
        players: nonFoldedPlayers.map((p: any) => ({ id: p.id, name: p.name })),
      });

      for (const p of nonFoldedPlayers) {
        if (p.isAfk) {
          const afkChoiceResult = gameEngine.submitRunItTwiceChoice(p.id, 'once');
          if (afkChoiceResult.success) {
            const afkActor = room.players.find((rp: any) => rp.id === p.id);
            io.to(roomId).emit('game:run_it_twice_choice_result', {
              playerId: p.id,
              playerName: afkActor?.name || p.id,
              choice: 'once',
              gameState: sanitizeGameState(gameEngine.getState()),
            });

            if (afkChoiceResult.bothSubmitted) {
              room.gameState = gameEngine.getState();
              if (afkChoiceResult.needDice) {
                const onlineActivePlayer = nonFoldedPlayers.find((np: any) => np.id !== p.id && np.isOnline && !np.isAfk);
                if (onlineActivePlayer) {
                  const onlineChoice = gameEngine.getState().runItTwiceChoices?.[onlineActivePlayer.id] || 'once';
                  const finalChoice = onlineChoice as 'once' | 'twice';

                  gameEngine.getState().runItTwiceDiceResult = {
                    player1: { id: onlineActivePlayer.id, value: 6 },
                    player2: { id: p.id, value: 1 },
                    finalChoice,
                  };

                  io.to(roomId).emit('game:run_it_twice_executing', {
                    finalChoice,
                    gameState: sanitizeGameState(gameEngine.getState()),
                  });

                  const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
                  const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
                  const finalGameState = gameEngine.getState();
                  room.gameState = finalGameState;
                  syncPlayerChipsToRoom(gameEngine, room);

                  for (const w of winners) {
                    const roomPlayer = room.players.find((rp: any) => rp.id === w.playerId);
                    if (roomPlayer) w.playerName = roomPlayer.name;
                  }
                  for (const h of allHands) {
                    const roomPlayer = room.players.find((rp: any) => rp.id === h.playerId);
                    if (roomPlayer) h.playerName = roomPlayer.name;
                  }

                  finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);
                } else {
                  io.to(roomId).emit('game:run_it_twice_dice_result', {
                    gameState: sanitizeGameState(gameEngine.getState()),
                    needDice: true,
                    players: room.players
                      .filter((rp: any) => gameState.playerStatus?.[rp.id] !== 'folded')
                      .map((rp: any) => ({ id: rp.id, name: rp.name })),
                  });
                }
              } else {
                const finalChoice = afkChoiceResult.finalChoice || 'once';
                io.to(roomId).emit('game:run_it_twice_executing', {
                  finalChoice,
                  gameState: sanitizeGameState(gameEngine.getState()),
                });

                const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
                const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
                const finalGameState = gameEngine.getState();
                room.gameState = finalGameState;
                syncPlayerChipsToRoom(gameEngine, room);

                for (const w of winners) {
                  const roomPlayer = room.players.find((rp: any) => rp.id === w.playerId);
                  if (roomPlayer) w.playerName = roomPlayer.name;
                }
                for (const h of allHands) {
                  const roomPlayer = room.players.find((rp: any) => rp.id === h.playerId);
                  if (roomPlayer) h.playerName = roomPlayer.name;
                }

                finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);
              }
            }
          }
        }
      }

      return ok(
        {
          action: normalizedAction,
          amount: args.amount,
          phase: 'run-it-twice-choice',
        },
        `Action: ${normalizedAction}${args.amount ? ` ${args.amount}` : ''} → Run-it-twice choice needed!`
      );
    }

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

      finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager);

      return ok(
        {
          action: normalizedAction,
          amount: actualAmount,
          phase: 'showdown',
          winners: winners.map((w: any) => ({ id: w.playerId, name: w.playerName, amount: w.winAmount, hand: w.handDescription })),
          myCards: gameEngine.getPlayerCards(playerId),
        },
        `Action: ${normalizedAction}${actualAmount ? ` ${actualAmount}` : ''} → Showdown! Winner: ${winners.map((w: any) => w.playerName).join(', ')}`
      );
    }

    const nextPlayerId = gameEngine.getCurrentPlayerId();
    if (nextPlayerId) {
      handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
    }

    const isMyNextTurn = gameEngine.getCurrentPlayerId() === playerId;
    return ok(
      {
        action: normalizedAction,
        amount: actualAmount,
        phase: gameState.phase,
        isMyTurn: isMyNextTurn,
        pot: gameState.totalPot,
        currentBet: gameState.currentBet,
      },
      `Action: ${normalizedAction}${actualAmount ? ` ${actualAmount}` : ''} → Phase: ${gameState.phase}${isMyNextTurn ? ' (your turn again!)' : ''}`
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
        const gameEngine = gameEngines.get(roomId);
        if (gameEngine && room.status === RoomStatus.PLAYING) {
          gameEngine.recordRebuy(playerId, result.amount || 0);
          syncPlayerChipsToRoom(gameEngine, room);
        }

        const player = room.players.find((p: any) => p.id === playerId);
        if (player && !player.isReady && room.status !== RoomStatus.PLAYING) {
          player.isReady = true;
        }

        roomManager.syncScoreboard(roomId);

        io.to(roomId).emit('system:chips_received', {
          playerId,
          amount: result.amount,
          room: sanitizeRoom(room),
        });

        if (player && player.isReady) {
          io.to(roomId).emit('room:player_ready_changed', {
            playerId,
            ready: true,
            room: sanitizeRoom(room),
          });

          tryStartGame(roomId, roomManager, io);
        }
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
  } else {
    tryStartGame(roomId, roomManager, io);
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
    const chatData = {
      playerId,
      playerName: player.name,
      message,
      timestamp: Date.now(),
    };
    io.to(roomId).emit('chat:message', chatData);
    io.of('/ai').to(roomId).emit('chat:message', chatData);
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

function handleRunItTwiceChoice(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const choice = args.choice;
  if (!choice || (choice !== 'once' && choice !== 'twice')) {
    return fail(400, 'Missing or invalid parameter: --choice (must be "once" or "twice")');
  }

  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const gameState = gameEngine.getState();
  if (gameState.phase !== 'run-it-twice-choice') {
    return fail(409, `Not in run-it-twice-choice phase (current: ${gameState.phase})`);
  }

  const result = gameEngine.submitRunItTwiceChoice(playerId, choice as 'once' | 'twice');
  if (!result.success) {
    return fail(400, result.error || 'Failed to submit run-it-twice choice');
  }

  room.gameState = gameEngine.getState();

  const actor = room.players.find((p: any) => p.id === playerId);
  io.to(roomId).emit('game:run_it_twice_choice_result', {
    playerId,
    playerName: actor?.name || playerId,
    choice,
    gameState: sanitizeGameState(gameEngine.getState()),
  });

  if (result.bothSubmitted) {
    if (result.needDice) {
      const nonFoldedPlayers = room.players.filter((p: any) =>
        gameEngine.getState().playerStatus?.[p.id] !== 'folded'
      );
      const hasHuman = nonFoldedPlayers.some((p: any) => !p.id.startsWith('ai_'));
      const hasAI = nonFoldedPlayers.some((p: any) => p.id.startsWith('ai_'));

      if (hasHuman && hasAI && nonFoldedPlayers.length === 2) {
        const humanPlayer = nonFoldedPlayers.find((p: any) => !p.id.startsWith('ai_'))!;
        const aiPlayer = nonFoldedPlayers.find((p: any) => p.id.startsWith('ai_'))!;
        const humanChoice = gameEngine.getState().runItTwiceChoices?.[humanPlayer.id] || 'once';
        const finalChoice = humanChoice as 'once' | 'twice';

        gameEngine.getState().runItTwiceDiceResult = {
          player1: { id: humanPlayer.id, value: 6 },
          player2: { id: aiPlayer.id, value: 1 },
          finalChoice,
        };

        io.to(roomId).emit('game:run_it_twice_executing', {
          finalChoice,
          gameState: sanitizeGameState(gameEngine.getState()),
          humanDecided: true,
          humanPlayerId: humanPlayer.id,
          humanPlayerName: humanPlayer.name,
        });

        const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
        const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
        const finalGameState = gameEngine.getState();
        room.gameState = finalGameState;
        syncPlayerChipsToRoom(gameEngine, room);

        for (const w of winners) {
          const roomPlayer = room.players.find((rp: any) => rp.id === w.playerId);
          if (roomPlayer) w.playerName = roomPlayer.name;
        }
        for (const h of allHands) {
          const roomPlayer = room.players.find((rp: any) => rp.id === h.playerId);
          if (roomPlayer) h.playerName = roomPlayer.name;
        }

        finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);

        return ok(
          { choice, finalChoice, phase: 'showdown', humanDecided: true, humanPlayerId: humanPlayer.id },
          `Run-it-twice: AI choice overridden by human player (${humanPlayer.name}), settled as ${finalChoice}`
        );
      }

      io.to(roomId).emit('game:run_it_twice_dice_result', {
        gameState: sanitizeGameState(gameEngine.getState()),
        needDice: true,
        players: room.players
          .filter((p: any) => gameEngine.getState().playerStatus?.[p.id] !== 'folded')
          .map((p: any) => ({ id: p.id, name: p.name })),
      });
      return ok({ choice, needDice: true }, `Run-it-twice choice: ${choice}. Dice needed!`);
    }

    const finalChoice = result.finalChoice || 'once';
    io.to(roomId).emit('game:run_it_twice_executing', {
      finalChoice,
      gameState: sanitizeGameState(gameEngine.getState()),
    });

    const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
    const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
    const finalGameState = gameEngine.getState();
    room.gameState = finalGameState;
    syncPlayerChipsToRoom(gameEngine, room);

    for (const w of winners) {
      const roomPlayer = room.players.find((p: any) => p.id === w.playerId);
      if (roomPlayer) w.playerName = roomPlayer.name;
    }
    for (const h of allHands) {
      const roomPlayer = room.players.find((p: any) => p.id === h.playerId);
      if (roomPlayer) h.playerName = roomPlayer.name;
    }

    finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);

    const myCards = gameEngine.getPlayerCards(playerId);
    return ok(
      {
        choice,
        finalChoice,
        phase: 'showdown',
        winners: winners.map((w: any) => ({ id: w.playerId, name: w.playerName, amount: w.winAmount, hand: w.handDescription })),
        myCards,
      },
      `Run-it-twice choice: ${choice} → Final: ${finalChoice}, Winner: ${winners.map((w: any) => w.playerName).join(', ')}`
    );
  }

  return ok({ choice, waitingForOther: true }, `Run-it-twice choice: ${choice}, waiting for opponent`);
}

function handleRollDice(playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const gameState = gameEngine.getState();

  const nonFoldedPlayers = room.players.filter((p: any) =>
    gameState.playerStatus?.[p.id] !== 'folded'
  );
  const hasHuman = nonFoldedPlayers.some((p: any) => !p.id.startsWith('ai_'));
  const hasAI = nonFoldedPlayers.some((p: any) => p.id.startsWith('ai_'));

  if (hasHuman && hasAI && nonFoldedPlayers.length === 2 && playerId.startsWith('ai_')) {
    return fail(409, 'Dice not needed: human player decides the run-it-twice choice');
  }

  if (!gameState.runItTwiceDiceReady || gameState.runItTwiceDiceReady[playerId]) {
    return fail(409, 'Cannot roll dice now');
  }

  const result = gameEngine.submitDiceRoll(playerId);
  if (!result.success) {
    return fail(400, result.error || 'Failed to roll dice');
  }

  const actor = room.players.find((p: any) => p.id === playerId);
  const updatedState = gameEngine.getState();

  io.to(roomId).emit('game:run_it_twice_dice_result', {
    playerId,
    playerName: actor?.name || playerId,
    ready: true,
    diceReady: updatedState.runItTwiceDiceReady,
    gameState: sanitizeGameState(updatedState),
    needDice: true,
  });

  if (result.bothReady && result.diceResult) {
    const isTied = gameEngine.isDiceTied();

    io.to(roomId).emit('game:run_it_twice_dice_result', {
      bothReady: true,
      diceResult: result.diceResult,
      diceReady: updatedState.runItTwiceDiceReady,
      isTied,
      gameState: sanitizeGameState(updatedState),
      needDice: true,
    });

    if (isTied) {
      setTimeout(() => {
        gameEngine.resetDiceForReroll();
        const rerollState = gameEngine.getState();
        io.to(roomId).emit('game:run_it_twice_dice_result', {
          reroll: true,
          gameState: sanitizeGameState(rerollState),
          needDice: true,
          players: room.players
            .filter((p: any) => rerollState.playerStatus?.[p.id] !== 'folded')
            .map((p: any) => ({ id: p.id, name: p.name })),
        });
      }, 2000);
      return ok({ isTied: true }, 'Dice tied! Rerolling...');
    }

    const finalChoice = result.diceResult.finalChoice;
    io.to(roomId).emit('game:run_it_twice_executing', {
      finalChoice,
      gameState: sanitizeGameState(gameEngine.getState()),
    });

    setTimeout(() => {
      const preRunItTwiceCommunityCards = [...gameEngine.getState().communityCards];
      const { winners, potResults, allHands } = gameEngine.executeRunItTwice();
      const finalGameState = gameEngine.getState();
      room.gameState = finalGameState;
      syncPlayerChipsToRoom(gameEngine, room);

      for (const w of winners) {
        const roomPlayer = room.players.find((p: any) => p.id === w.playerId);
        if (roomPlayer) w.playerName = roomPlayer.name;
      }
      for (const h of allHands) {
        const roomPlayer = room.players.find((p: any) => p.id === h.playerId);
        if (roomPlayer) h.playerName = roomPlayer.name;
      }

      finishHand(roomId, room, gameEngine, winners, potResults, allHands, finalGameState, io, roomManager, preRunItTwiceCommunityCards);
    }, 2000);

    return ok({ finalChoice, diceResult: result.diceResult }, `Dice rolled! Final choice: ${finalChoice}`);
  }

  return ok({ waitingForOther: true }, 'Dice rolled, waiting for opponent');
}

function handleDiscard(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const cardIndex = parseInt(args.cardIndex);
  if (isNaN(cardIndex) || cardIndex < 0) {
    return fail(400, 'Invalid cardIndex parameter');
  }

  const result = gameEngine.discardCard(playerId, cardIndex);
  if (!result.success) {
    return fail(400, result.error || 'Failed to discard card');
  }

  const gameStateAfterDiscard = gameEngine.getState();
  room.gameState = gameStateAfterDiscard;

  const actor = room.players.find((p: any) => p.id === playerId);
  io.to(roomId).emit('game:action_result', {
    playerId,
    playerName: actor?.name || playerId,
    action: 'discard',
    amount: 0,
    gameState: sanitizeGameState(gameStateAfterDiscard),
    room: sanitizeRoom(room),
  });

  const newCards = gameEngine.getPlayerCards(playerId);
  const playerSockets = Array.from(io.sockets.sockets.values()).filter(
    (s: any) => s.data.playerId === playerId
  );
  for (const s of playerSockets) {
    s.emit('game:deal_cards', {
      handId: gameStateAfterDiscard.handId,
      playerId,
      cards: newCards,
    });
  }

  if (gameStateAfterDiscard.phase === 'pre-flop' || gameStateAfterDiscard.phase === 'discard') {
    const currentPlayerId = gameEngine.getCurrentPlayerId();
    if (currentPlayerId) {
      handlePlayerTurnWithAfk(roomId, room, gameEngine, io, roomManager);
    }
  }

  return ok(
    {
      action: 'discard',
      cardIndex,
      phase: gameStateAfterDiscard.phase,
    },
    `Discarded card at index ${cardIndex}, phase: ${gameStateAfterDiscard.phase}`
  );
}

function handleDraw(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const gameState = gameEngine.getState();
  if (gameState.phase !== 'draw') {
    return fail(409, `Not in draw phase (current: ${gameState.phase})`);
  }

  let indices: number[] = [];
  const rawIndices = args.indices;
  if (rawIndices === undefined || rawIndices === null || rawIndices === 'none' || rawIndices === '') {
    indices = [];
  } else if (typeof rawIndices === 'string') {
    if (rawIndices === 'none') {
      indices = [];
    } else {
      indices = rawIndices.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
    }
  } else if (Array.isArray(rawIndices)) {
    indices = rawIndices.map((n: any) => parseInt(n)).filter((n: number) => !isNaN(n));
  }

  const result = gameEngine.drawCards(playerId, indices);
  if (!result.success) {
    return fail(400, result.error || 'Failed to draw cards');
  }

  const updatedGameState = gameEngine.getState();
  room.gameState = updatedGameState;

  const actor = room.players.find((p: any) => p.id === playerId);
  io.to(roomId).emit('game:action_result', {
    playerId,
    playerName: actor?.name || playerId,
    action: 'draw',
    amount: indices.length,
    gameState: sanitizeGameState(updatedGameState),
    room: sanitizeRoom(room),
  });

  const newState = gameEngine.getState();
  if (newState.phase === 'post-draw') {
    io.to(roomId).emit('game:player_turn', {
      playerId: newState.currentPlayerId,
      playerName: room.players.find((p: any) => p.id === newState.currentPlayerId)?.name || newState.currentPlayerId,
      timeout: 30,
      validActions: gameEngine.getValidActions(newState.currentPlayerId),
    });
  }

  return ok(
    {
      action: 'draw',
      replacedCount: indices.length,
      newCards: result.newCards || [],
      phase: newState.phase,
    },
    `Drew cards: replaced ${indices.length} card(s), phase: ${newState.phase}`
  );
}

function handleShowCards(playerId: string, roomManager: RoomManager, io: Server): AIResponse {
  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  const gameEngine = gameEngines.get(roomId);
  if (!gameEngine) {
    return fail(404, 'Game engine not found');
  }

  const myCards = gameEngine.getPlayerCards(playerId);
  if (!myCards) {
    return fail(400, 'No cards to show');
  }

  return ok({ cards: myCards }, `Your cards: ${myCards.map((c: any) => c.code || c.rank + c.suit).join(', ')}`);
}

function handleVoteExtendHands(args: Record<string, any>, playerId: string, roomManager: RoomManager, io: Server, socket: Socket): AIResponse {
  const approve = args.approve;
  if (approve === undefined || approve === null) {
    return fail(400, 'Missing required parameter: --approve (true/false)');
  }

  const roomId = roomManager.getPlayerRoomId(playerId);
  if (!roomId) {
    return fail(400, 'You are not in any room');
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return fail(404, 'Room not found');
  }

  if (!room.config.fixedHands || room.config.fixedHands <= 0) {
    return fail(400, 'This room does not use fixed hands mode');
  }

  if (room.handCount < room.config.fixedHands) {
    return fail(400, `Fixed hands limit not reached yet (${room.handCount}/${room.config.fixedHands})`);
  }

  const player = room.players.find((p: any) => p.id === playerId);
  if (!player) {
    return fail(400, 'Player not in room');
  }

  if (!room.voteExtendHands) {
    room.voteExtendHands = {
      initiatorId: playerId,
      initiatorName: player.name,
      votes: new Map([[playerId, !!approve]]),
      approved: false,
      createdAt: Date.now(),
      extendCount: 10,
    };

    io.to(roomId).emit('room:vote_extend_hands_started', {
      initiatorId: playerId,
      initiatorName: player.name,
      votes: Object.fromEntries(room.voteExtendHands.votes),
      votedPlayers: room.voteExtendHands.votes.size,
      totalPlayers: room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length,
      createdAt: room.voteExtendHands.createdAt,
      extendCount: 10,
      room: sanitizeRoom(room),
    });

    return ok({ initiated: true, approve: !!approve }, `Vote extend hands initiated: ${approve ? 'approve' : 'reject'}`);
  }

  room.voteExtendHands.votes.set(playerId, !!approve);

  io.to(roomId).emit('room:vote_extend_hands_response', {
    playerId,
    approve: !!approve,
    votes: Object.fromEntries(room.voteExtendHands.votes),
    votedPlayers: room.voteExtendHands.votes.size,
    totalPlayers: room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== PlayerRoomRole.SPECTATOR).length,
    room: sanitizeRoom(room),
  });

  const eligiblePlayers = room.players.filter((p: any) => p.isOnline && p.playerRoomRole !== PlayerRoomRole.SPECTATOR);
  const approveCount = Array.from(room.voteExtendHands.votes.values()).filter((v: boolean) => v).length;
  const rejectCount = Array.from(room.voteExtendHands.votes.values()).filter((v: boolean) => !v).length;

  if (approveCount >= 2) {
    room.config.fixedHands! += room.voteExtendHands.extendCount;
    const extendCount = room.voteExtendHands.extendCount;
    room.voteExtendHands = undefined;

    for (const p of room.players) {
      if (p.playerRoomRole !== PlayerRoomRole.SPECTATOR && p.chips > 0 && p.isOnline && !p.isAfk) {
        p.isReady = true;
      }
    }

    io.to(roomId).emit('room:vote_extend_hands_ended', {
      approved: true,
      newFixedHands: room.config.fixedHands,
      extendCount,
      room: sanitizeRoom(room),
    });

    tryStartGame(roomId, roomManager, io);

    return ok({ approved: true, newFixedHands: room.config.fixedHands, extendCount }, `Vote approved! Fixed hands extended to ${room.config.fixedHands}`);
  } else if (rejectCount >= 1 && (eligiblePlayers.length - rejectCount) < 2) {
    room.voteExtendHands = undefined;

    io.to(roomId).emit('room:vote_extend_hands_ended', {
      approved: false,
      room: sanitizeRoom(room),
    });

    return ok({ approved: false }, 'Vote rejected: not enough approvals');
  } else if (room.voteExtendHands && room.players.every((p: any) => room.voteExtendHands!.votes.has(p.id) || !p.isOnline || p.playerRoomRole === PlayerRoomRole.SPECTATOR)) {
    if (approveCount >= 2) {
      room.config.fixedHands! += room.voteExtendHands.extendCount;
      const extendCount = room.voteExtendHands.extendCount;
      room.voteExtendHands = undefined;

      for (const p of room.players) {
        if (p.playerRoomRole !== PlayerRoomRole.SPECTATOR && p.chips > 0 && p.isOnline && !p.isAfk) {
          p.isReady = true;
        }
      }

      io.to(roomId).emit('room:vote_extend_hands_ended', {
        approved: true,
        newFixedHands: room.config.fixedHands,
        extendCount,
        room: sanitizeRoom(room),
      });

      tryStartGame(roomId, roomManager, io);

      return ok({ approved: true, newFixedHands: room.config.fixedHands, extendCount }, `Vote approved! Fixed hands extended to ${room.config.fixedHands}`);
    } else {
      room.voteExtendHands = undefined;

      io.to(roomId).emit('room:vote_extend_hands_ended', {
        approved: false,
        room: sanitizeRoom(room),
      });

      return ok({ approved: false }, 'Vote rejected: not enough approvals');
    }
  }

  return ok({ responded: true, approve: !!approve, waitingForMore: true }, `Vote recorded: ${approve ? 'approve' : 'reject'}. Waiting for more votes.`);
}
