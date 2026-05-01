import { create } from 'zustand'
import { Room, RoomPlayer, Card, GameState, WinnerInfo } from '../types'

interface GameStore {
  // 当前房间
  currentRoom: Room | null
  setCurrentRoom: (room: Room | null) => void
  
  // 当前玩家
  currentPlayer: RoomPlayer | null
  setCurrentPlayer: (player: RoomPlayer | null) => void
  
  // 手牌
  myCards: [Card, Card] | null
  setMyCards: (cards: [Card, Card] | null) => void
  
  // 游戏状态
  gameState: GameState | null
  setGameState: (state: GameState | null) => void
  
  // 是否是当前玩家回合
  isMyTurn: boolean
  setIsMyTurn: (isMyTurn: boolean) => void
  
  // 有效动作
  validActions: string[]
  setValidActions: (actions: string[]) => void
  
  // 结算信息
  winners: WinnerInfo[] | null
  setWinners: (winners: WinnerInfo[] | null) => void
  
  // 聊天消息
  messages: { playerId: string; playerName: string; message: string; timestamp: number }[]
  addMessage: (message: { playerId: string; playerName: string; message: string; timestamp: number }) => void
  
  // 更新房间玩家
  updateRoomPlayer: (playerId: string, updates: Partial<RoomPlayer>) => void
  removeRoomPlayer: (playerId: string) => void
  
  // 重置
  reset: () => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentRoom: null,
  setCurrentRoom: (room) => set({ currentRoom: room }),
  
  currentPlayer: null,
  setCurrentPlayer: (player) => set({ currentPlayer: player }),
  
  myCards: null,
  setMyCards: (cards) => set({ myCards: cards }),
  
  gameState: null,
  setGameState: (state) => set({ gameState: state }),
  
  isMyTurn: false,
  setIsMyTurn: (isMyTurn) => set({ isMyTurn }),
  
  validActions: [],
  setValidActions: (actions) => set({ validActions: actions }),
  
  winners: null,
  setWinners: (winners) => set({ winners }),
  
  messages: [],
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),
  
  updateRoomPlayer: (playerId, updates) => {
    const { currentRoom } = get()
    if (!currentRoom) return
    
    const updatedPlayers = currentRoom.players.map(p => 
      p.id === playerId ? { ...p, ...updates } : p
    )
    
    set({ 
      currentRoom: { ...currentRoom, players: updatedPlayers } 
    })
  },
  
  removeRoomPlayer: (playerId) => {
    const { currentRoom } = get()
    if (!currentRoom) return
    
    const updatedPlayers = currentRoom.players.filter(p => p.id !== playerId)
    
    set({ 
      currentRoom: { ...currentRoom, players: updatedPlayers } 
    })
  },
  
  reset: () => set({
    currentRoom: null,
    currentPlayer: null,
    myCards: null,
    gameState: null,
    isMyTurn: false,
    validActions: [],
    winners: null,
    messages: [],
  }),
}))
