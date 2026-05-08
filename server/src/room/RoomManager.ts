import { v4 as uuidv4 } from 'uuid';
import { Room, RoomConfig, RoomStatus, RoomPlayer, CreateRoomRequest, JoinRoomRequest, PlayerRoomRole } from '../types/room';
import { GameEngine, GameConfig } from '../game/GameEngine';
import { GameVariant, GameModifier, VARIANT_RULES } from '../types/poker';

const KEYBOARD_CHARS_REGEX = /^[a-zA-Z0-9\u4e00-\u9fff\s\~\!\@\#\$\%\^\&\*\(\)\-\_\=\+\[\]\{\}\|\\\;\:\'\"\,\.\/\<\>\?]+$/;

function getDisplayLength(str: string): number {
  let len = 0;
  for (const ch of str) {
    len += ch.charCodeAt(0) > 127 ? 2 : 1;
  }
  return len;
}

function validateName(name: string, maxLen: number, label: string): string | null {
  if (!name || name.trim().length === 0) return `${label}不能为空`;
  if (getDisplayLength(name.trim()) > maxLen) return `${label}长度超出限制`;
  if (!KEYBOARD_CHARS_REGEX.test(name.trim())) return `${label}包含不允许的字符`;
  return null;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRooms: Map<string, string> = new Map(); // playerId -> roomId

  // 生成房间ID
  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去除容易混淆的字符
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // 创建房间
  createRoom(request: CreateRoomRequest, hostId: string): Room {
    const roomId = this.generateRoomId();

    if (request.roomName) {
      const nameError = validateName(request.roomName, 16, '房间名称');
      if (nameError) {
        throw new Error(nameError);
      }
    }
    
    const config: RoomConfig = {
      roomId,
      roomName: request.roomName || `房间 ${roomId}`,
      hostId,
      createdAt: Date.now(),
      maxPlayers: (() => {
        const variantMax = request.gameVariant ? (VARIANT_RULES[request.gameVariant]?.maxPlayers || 10) : 10;
        return Math.min(Math.max(request.maxPlayers || 9, 2), variantMax);
      })(),
      minPlayers: 2,
      smallBlind: request.smallBlind || 10,
      bigBlind: request.bigBlind || 20,
      buyInMin: request.buyInMin || 1000,
      buyInMax: request.buyInMax || 10000,
      actionTimeout: 30,
      autoStart: false,
      autoStartDelay: 10,
      isPrivate: request.isPrivate || false,
      password: request.password,
      allowSpectate: true,
      allowChat: true,
      gameVariant: request.gameVariant || GameVariant.TEXAS_NLHE,
      gameModifier: request.gameModifier || GameModifier.NONE,
      mixedRotation: request.mixedRotation,
    };

    const room: Room = {
      config,
      status: RoomStatus.WAITING,
      players: [],
      scoreboardEntries: [],
      spectators: [],
    };

    this.rooms.set(roomId, room);
    return room;
  }

  // 获取房间
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      for (const p of room.players) {
        this.playerRooms.delete(p.id);
      }
      this.rooms.delete(roomId);
    }
  }

  // 加入房间
  joinRoom(roomId: string, request: JoinRoomRequest, playerId: string): { success: boolean; room?: Room; error?: string; replacedPlayerId?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    // 检查密码
    if (room.config.isPrivate && room.config.password !== request.password) {
      return { success: false, error: '房间密码错误' };
    }

    // 检查人数
    if (room.players.length >= room.config.maxPlayers) {
      return { success: false, error: '房间已满' };
    }

    // 检查是否已在房间中
    if (room.players.some(p => p.id === playerId)) {
      return { success: false, error: '你已在该房间中' };
    }

    // 检查是否在其他房间中
    const currentRoomId = this.playerRooms.get(playerId);
    if (currentRoomId && currentRoomId !== roomId) {
      return { success: false, error: '你已在其他房间中，请先离开当前房间' };
    }

    // 验证昵称
    const nameError = validateName(request.playerName, 12, '昵称');
    if (nameError) {
      return { success: false, error: nameError };
    }

    // 检查昵称是否重复
    const trimmedName = request.playerName.trim();
    let replacedPlayerId: string | undefined;
    const sameNamePlayer = room.players.find(p => p.name === trimmedName);
    if (sameNamePlayer) {
      if (!sameNamePlayer.isOnline) {
        replacedPlayerId = sameNamePlayer.id;
        const existingEntry = room.scoreboardEntries.find(e => e.id === sameNamePlayer.id);
        if (existingEntry) {
          existingEntry.chips = sameNamePlayer.chips;
          existingEntry.totalBuyIn = sameNamePlayer.totalBuyIn;
          existingEntry.leftAt = Date.now();
        } else {
          room.scoreboardEntries.push({
            id: sameNamePlayer.id,
            name: sameNamePlayer.name,
            chips: sameNamePlayer.chips,
            totalBuyIn: sameNamePlayer.totalBuyIn,
            leftAt: Date.now(),
          });
        }
        room.players = room.players.filter(p => p.id !== sameNamePlayer.id);
        this.playerRooms.delete(sameNamePlayer.id);
        if (room.config.hostId === sameNamePlayer.id && room.players.length > 0) {
          room.config.hostId = room.players[0].id;
        }
      } else {
        return { success: false, error: '该昵称已被使用，请更换' };
      }
    }

    const isSpectator = room.status === RoomStatus.PLAYING;

    let seatIndex: number;
    let chips: number;
    let playerRoomRole: PlayerRoomRole;

    if (isSpectator) {
      seatIndex = -1;
      chips = 0;
      playerRoomRole = PlayerRoomRole.SPECTATOR;
    } else {
      const usedSeats = new Set(room.players.map(p => p.seatIndex));
      seatIndex = 0;
      while (usedSeats.has(seatIndex)) {
        seatIndex++;
      }
      chips = room.config.buyInMin;
      playerRoomRole = PlayerRoomRole.SEATED;
    }

    const player: RoomPlayer = {
      id: playerId,
      name: request.playerName || `玩家${room.players.length + 1}`,
      avatar: this.generateAvatar(playerId),
      seatIndex,
      chips,
      totalBuyIn: isSpectator ? 0 : room.config.buyInMin,
      isReady: false,
      isOnline: true,
      isAfk: false,
      joinedAt: Date.now(),
      playerRoomRole,
    };

    room.players.push(player);
    this.playerRooms.set(playerId, roomId);
    this.syncScoreboard(roomId);

    return { success: true, room, replacedPlayerId };
  }

  // 离开房间
  leaveRoom(playerId: string, force?: boolean): { success: boolean; roomId?: string; error?: string; room?: Room } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRooms.delete(playerId);
      return { success: false, error: '房间不存在' };
    }

    if (!force && room.status === RoomStatus.PLAYING) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        const role = player.playerRoomRole;
        if (role === PlayerRoomRole.SPECTATOR || role === PlayerRoomRole.SEATED || role === PlayerRoomRole.BUSTED) {
          // 观战者、未参与牌局者、破产者可直接离开
        } else if (role === PlayerRoomRole.ACTIVE) {
          const playerStatus = room.gameState?.playerStatus?.[playerId];
          if (playerStatus === undefined) {
            // ACTIVE 但不在当前手牌中，可直接离开
          } else if (playerStatus === 'folded') {
            // 已弃牌，无利益牵涉，可直接离开
          } else {
            // 在手牌中且未弃牌（PLAYING / ALL_IN），需投票
            return { success: false, error: '牌局进行中，请发起投票离开' };
          }
        }
      }
    }

    const leavingPlayer = room.players.find(p => p.id === playerId);
    room.players = room.players.filter(p => p.id !== playerId);
    this.playerRooms.delete(playerId);

    if (leavingPlayer) {
      const existingEntry = room.scoreboardEntries.find(e => e.id === playerId);
      if (existingEntry) {
        existingEntry.chips = leavingPlayer.chips;
        existingEntry.totalBuyIn = leavingPlayer.totalBuyIn;
        existingEntry.leftAt = Date.now();
      } else {
        room.scoreboardEntries.push({
          id: leavingPlayer.id,
          name: leavingPlayer.name,
          chips: leavingPlayer.chips,
          totalBuyIn: leavingPlayer.totalBuyIn,
          leftAt: Date.now(),
        });
      }
    }

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return { success: true, roomId, room };
    }

    if (room.config.hostId === playerId && room.players.length > 0) {
      room.config.hostId = room.players[0].id;
    }

    return { success: true, roomId, room };
  }

  // 玩家准备
  setPlayerReady(playerId: string, ready: boolean): { success: boolean; error?: string } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: '玩家不在房间中' };
    }

    if (player.playerRoomRole === PlayerRoomRole.SPECTATOR) {
      return { success: false, error: '观战者无法准备' };
    }

    if (player.playerRoomRole === PlayerRoomRole.BUSTED) {
      return { success: false, error: '请先补筹码或选择不补' };
    }

    player.isReady = ready;
    return { success: true };
  }

  // 开始游戏
  startGame(playerId: string): { success: boolean; gameEngine?: GameEngine; error?: string } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    // 检查是否是房主
    if (room.config.hostId !== playerId) {
      return { success: false, error: '只有房主可以开始游戏' };
    }

    // 检查游戏状态
    if (room.status === RoomStatus.PLAYING) {
      return { success: false, error: '游戏正在进行中' };
    }

    // 检查人数
    const readyPlayers = room.players.filter(p => p.isReady);
    if (readyPlayers.length < room.config.minPlayers) {
      return { success: false, error: `至少需要 ${room.config.minPlayers} 名玩家准备才能开始` };
    }

    // 创建游戏引擎
    const gameConfig: GameConfig = {
      smallBlind: room.config.smallBlind,
      bigBlind: room.config.bigBlind,
      actionTimeout: room.config.actionTimeout,
      variant: room.config.gameVariant,
      modifier: room.config.gameModifier,
    };

    const dealerIndex = 0; // 第一局从0号位开始
    const gameEngine = new GameEngine(readyPlayers, dealerIndex, gameConfig);
    
    room.status = RoomStatus.PLAYING;
    room.gameState = gameEngine.start();

    return { success: true, gameEngine };
  }

  // 补充筹码
  replenishChips(playerId: string): { success: boolean; amount?: number; error?: string } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: '玩家不在房间中' };
    }

    const amount = room.config.buyInMin;
    player.chips += amount;
    player.totalBuyIn += amount;

    if (player.playerRoomRole === PlayerRoomRole.BUSTED && player.chips > 0) {
      player.playerRoomRole = PlayerRoomRole.ACTIVE;
    }

    if (player.playerRoomRole === PlayerRoomRole.SPECTATOR && player.chips > 0) {
      const usedSeats = new Set(room.players.filter(rp => rp.seatIndex >= 0 && rp.id !== playerId).map(rp => rp.seatIndex));
      let seatIndex = 0;
      while (usedSeats.has(seatIndex)) {
        seatIndex++;
      }
      player.seatIndex = seatIndex;
      player.playerRoomRole = PlayerRoomRole.ACTIVE;
    }

    return { success: true, amount };
  }

  // 获取玩家房间ID
  getPlayerRoomId(playerId: string): string | undefined {
    return this.playerRooms.get(playerId);
  }

  // 获取所有房间列表
  getRoomList(): Room[] {
    return Array.from(this.rooms.values());
  }

  // 生成头像URL
  private generateAvatar(playerId: string): string {
    // 使用 robohash 服务生成头像（避免跨域问题）
    // 使用 playerId 的哈希值生成头像ID
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = (hash << 5) - hash + playerId.charCodeAt(i);
      hash = hash & hash;
    }
    const avatarId = Math.abs(hash) % 100;
    return `https://robohash.org/${playerId}?set=set4&size=150x150`;
  }

  // 清理空房间
  cleanupEmptyRooms(): void {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.players.length === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  // 开始投票离开
  startVoteLeave(playerId: string): { success: boolean; error?: string; room?: Room; cooldownRemaining?: number } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    if (room.voteLeave) {
      return { success: false, error: '已有投票进行中' };
    }

    if (!room.voteLeaveCooldowns) {
      room.voteLeaveCooldowns = new Map();
    }

    const cooldownUntil = room.voteLeaveCooldowns.get(playerId);
    if (cooldownUntil && Date.now() < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      return { success: false, error: `投票冷却中，请等待${remaining}秒`, cooldownRemaining: remaining };
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: '玩家不在房间中' };
    }

    room.voteLeave = {
      initiatorId: playerId,
      initiatorName: player.name,
      votes: new Map(),
      approved: false,
      createdAt: Date.now(),
    };

    room.voteLeave.votes.set(playerId, true);

    for (const p of room.players) {
      if (p.id !== playerId && (!p.isOnline || p.isAfk)) {
        room.voteLeave.votes.set(p.id, true);
      }
    }

    if (room.voteLeave.votes.size === room.players.length) {
      room.voteLeave.approved = true;
    }

    return { success: true, room };
  }

  // 响应投票
  voteLeaveResponse(playerId: string, approve: boolean): { success: boolean; error?: string; room?: Room; approved?: boolean; roomId?: string; voteCounts?: { approveCount: number; rejectCount: number }; initiatorId?: string } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    if (!room.voteLeave) {
      return { success: false, error: '没有正在进行的投票' };
    }

    room.voteLeave.votes.set(playerId, approve);

    if (!approve) {
      const approveCount = Array.from(room.voteLeave.votes.values()).filter(v => v).length;
      const rejectCount = Array.from(room.voteLeave.votes.values()).filter(v => !v).length;
      const initiatorId = room.voteLeave.initiatorId;
      room.voteLeave = undefined;
      if (!room.voteLeaveCooldowns) {
        room.voteLeaveCooldowns = new Map();
      }
      room.voteLeaveCooldowns.set(initiatorId, Date.now() + 10000);
      return { success: true, room, approved: false, roomId, voteCounts: { approveCount, rejectCount }, initiatorId };
    }

    const allVoted = room.players.every(p =>
      room.voteLeave!.votes.has(p.id) || !p.isOnline || p.isAfk
    );
    if (allVoted) {
      for (const p of room.players) {
        if (!room.voteLeave!.votes.has(p.id) && (!p.isOnline || p.isAfk)) {
          room.voteLeave.votes.set(p.id, true);
        }
      }

      const approveCount = Array.from(room.voteLeave.votes.values()).filter(v => v).length;
      const rejectCount = Array.from(room.voteLeave.votes.values()).filter(v => !v).length;
      room.voteLeave.approved = approveCount === room.players.length;

      if (room.voteLeave.approved) {
        for (const p of room.players) {
          this.playerRooms.delete(p.id);
        }
        this.rooms.delete(roomId);
        return { success: true, room, approved: true, roomId, voteCounts: { approveCount, rejectCount } };
      } else {
        const initiatorId = room.voteLeave.initiatorId;
        const result = { success: true, room, approved: false, roomId, voteCounts: { approveCount, rejectCount }, initiatorId };
        room.voteLeave = undefined;
        if (!room.voteLeaveCooldowns) {
          room.voteLeaveCooldowns = new Map();
        }
        room.voteLeaveCooldowns.set(initiatorId, Date.now() + 10000);
        return result;
      }
    }

    return { success: true, room };
  }

  // 获取投票状态
  getVoteLeaveStatus(roomId: string): { inProgress: boolean; initiatorName?: string; votes?: Record<string, boolean>; totalPlayers?: number; votedPlayers?: number } {
    const room = this.rooms.get(roomId);
    if (!room || !room.voteLeave) {
      return { inProgress: false };
    }

    return {
      inProgress: true,
      initiatorName: room.voteLeave.initiatorName,
      votes: Object.fromEntries(room.voteLeave.votes),
      totalPlayers: room.players.length,
      votedPlayers: room.voteLeave.votes.size,
    };
  }

  processVoteTimeout(roomId: string): { success: boolean; room?: Room; approved?: boolean; roomId?: string; voteCounts?: { approveCount: number; rejectCount: number } } {
    const room = this.rooms.get(roomId);
    if (!room || !room.voteLeave) {
      return { success: false };
    }

    if (Date.now() - room.voteLeave.createdAt < 15000) {
      return { success: false };
    }

    for (const p of room.players) {
      if (!room.voteLeave.votes.has(p.id)) {
        room.voteLeave.votes.set(p.id, true);
      }
    }

    const approveCount = Array.from(room.voteLeave.votes.values()).filter(v => v).length;
    const rejectCount = Array.from(room.voteLeave.votes.values()).filter(v => !v).length;
    room.voteLeave.approved = approveCount === room.players.length;

    if (room.voteLeave.approved) {
      for (const p of room.players) {
        this.playerRooms.delete(p.id);
      }
      this.rooms.delete(roomId);
      return { success: true, room, approved: true, roomId, voteCounts: { approveCount, rejectCount } };
    } else {
      const initiatorId = room.voteLeave.initiatorId;
      room.voteLeave = undefined;
      if (!room.voteLeaveCooldowns) {
        room.voteLeaveCooldowns = new Map();
      }
      room.voteLeaveCooldowns.set(initiatorId, Date.now() + 10000);
      return { success: true, room, approved: false, roomId, voteCounts: { approveCount, rejectCount } };
    }
  }

  setPlayerAfk(playerId: string, afk: boolean): { success: boolean; error?: string; room?: Room; roomId?: string } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: '玩家不在房间中' };
    }

    if (player.playerRoomRole === PlayerRoomRole.SPECTATOR) {
      return { success: false, error: '观战者不能设置AFK' };
    }

    player.isAfk = afk;
    player.afkAt = afk ? Date.now() : undefined;

    if (afk) {
      player.isReady = false;
    }

    return { success: true, room, roomId };
  }

  syncScoreboard(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const p of room.players) {
      const existingEntry = room.scoreboardEntries.find(e => e.id === p.id);
      if (existingEntry) {
        existingEntry.chips = p.chips;
        existingEntry.totalBuyIn = p.totalBuyIn;
        existingEntry.leftAt = undefined;
      } else {
        room.scoreboardEntries.push({
          id: p.id,
          name: p.name,
          chips: p.chips,
          totalBuyIn: p.totalBuyIn,
        });
      }
    }
  }
}
