import { v4 as uuidv4 } from 'uuid';
import { Room, RoomConfig, RoomStatus, RoomPlayer, CreateRoomRequest, JoinRoomRequest } from '../types/room';
import { GameEngine, GameConfig } from '../game/GameEngine';

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
    
    const config: RoomConfig = {
      roomId,
      roomName: request.roomName || `房间 ${roomId}`,
      hostId,
      createdAt: Date.now(),
      maxPlayers: Math.min(Math.max(request.maxPlayers || 9, 2), 12),
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
    };

    const room: Room = {
      config,
      status: RoomStatus.WAITING,
      players: [],
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
  joinRoom(roomId: string, request: JoinRoomRequest, playerId: string): { success: boolean; room?: Room; error?: string } {
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

    // 找到空座位
    const usedSeats = new Set(room.players.map(p => p.seatIndex));
    let seatIndex = 0;
    while (usedSeats.has(seatIndex)) {
      seatIndex++;
    }

    const player: RoomPlayer = {
      id: playerId,
      name: request.playerName || `玩家${room.players.length + 1}`,
      avatar: this.generateAvatar(playerId),
      seatIndex,
      chips: room.config.buyInMin,
      totalBuyIn: room.config.buyInMin,
      isReady: false,
      isOnline: true,
      joinedAt: Date.now(),
    };

    room.players.push(player);
    this.playerRooms.set(playerId, roomId);

    return { success: true, room };
  }

  // 离开房间
  leaveRoom(playerId: string): { success: boolean; roomId?: string; error?: string; shouldClose?: boolean } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, error: '你不在任何房间中' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRooms.delete(playerId);
      return { success: false, error: '房间不存在' };
    }

    if (room.status === RoomStatus.PLAYING) {
      return { success: false, error: '牌局进行中，请等待本局结束后退出' };
    }

    room.players = room.players.filter(p => p.id !== playerId);
    this.playerRooms.delete(playerId);

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return { success: true, roomId, shouldClose: true };
    }

    if (room.players.length < 3) {
      return { success: true, roomId, shouldClose: true };
    }

    if (room.config.hostId === playerId && room.players.length > 0) {
      room.config.hostId = room.players[0].id;
    }

    return { success: true, roomId };
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
  startVoteLeave(playerId: string): { success: boolean; error?: string; room?: Room } {
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

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: '玩家不在房间中' };
    }

    room.voteLeave = {
      initiatorId: playerId,
      initiatorName: player.name,
      votes: new Map(),
      approved: false,
    };

    room.voteLeave.votes.set(playerId, true);

    return { success: true, room };
  }

  // 响应投票
  voteLeaveResponse(playerId: string, approve: boolean): { success: boolean; error?: string; room?: Room; approved?: boolean; roomId?: string } {
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

    const allVoted = room.players.every(p => room.voteLeave!.votes.has(p.id));
    if (allVoted) {
      const approveCount = Array.from(room.voteLeave.votes.values()).filter(v => v).length;
      room.voteLeave.approved = approveCount === room.players.length;

      if (room.voteLeave.approved) {
        const wasPlaying = room.status === RoomStatus.PLAYING;
        for (const p of room.players) {
          this.playerRooms.delete(p.id);
        }
        this.rooms.delete(roomId);
        return { success: true, room, approved: true, roomId };
      } else {
        const result = { success: true, room, approved: false, roomId };
        room.voteLeave = undefined;
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
}
