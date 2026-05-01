import { motion } from 'framer-motion'
import { Room, GameState } from '../types'
import PokerCard from './PokerCard'
import Chip from './Chip'

interface PokerTableProps {
  room: Room
  gameState: GameState
  currentPlayerId?: string
}

export default function PokerTable({ room, gameState, currentPlayerId }: PokerTableProps) {
  const totalPot = gameState.pots.reduce((sum, pot) => sum + pot.amount, 0)

  // 获取玩家座位位置
  const getSeatPosition = (index: number, total: number) => {
    const angle = (index / Math.max(total, 6)) * Math.PI * 2 - Math.PI / 2
    const radiusX = 40
    const radiusY = 30
    return {
      x: 50 + radiusX * Math.cos(angle),
      y: 50 + radiusY * Math.sin(angle),
    }
  }

  return (
    <div className="relative w-full max-w-4xl aspect-[16/10]">
      {/* 桌子 */}
      <div className="absolute inset-0 poker-table rounded-[50%] border-8 border-poker-felt shadow-2xl" />
      
      {/* 底池 */}
      {totalPot > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-1/4 left-1/2 transform -translate-x-1/2 z-10"
        >
          <div className="flex flex-col items-center">
            <div className="flex gap-1 mb-1">
              {gameState.pots.map((pot, i) => (
                <Chip key={i} amount={pot.amount} size="sm" />
              ))}
            </div>
            <div className="bg-black/50 px-4 py-1 rounded-full">
              <span className="text-gold font-bold text-lg">{totalPot.toLocaleString()}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* 公共牌 */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <div className="flex gap-2">
          {gameState.communityCards.map((card, index) => (
            <motion.div
              key={index}
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: index * 0.1 }}
            >
              <PokerCard card={card} size="md" />
            </motion.div>
          ))}
          {/* 占位牌位 */}
          {Array.from({ length: 5 - gameState.communityCards.length }).map((_, index) => (
            <div
              key={`empty-${index}`}
              className="w-16 h-24 border-2 border-white/10 rounded-lg"
            />
          ))}
        </div>
      </div>

      {/* 玩家座位 */}
      {room.players.map((player, index) => {
        const pos = getSeatPosition(player.seatIndex, room.config.maxPlayers)
        const isCurrentPlayer = gameState.currentPlayerIndex === index
        const playerRole = gameState.playerRoles?.[player.id]
        const playerStatus = gameState.playerStatus?.[player.id]

        return (
          <motion.div
            key={player.id}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute transform -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            {/* 当前玩家指示器 */}
            {isCurrentPlayer && (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="absolute -inset-2 border-4 border-gold rounded-full"
              />
            )}

            {/* 角色标记 */}
            {playerRole && playerRole !== 'none' && (
              <div className={`absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${playerRole === 'dealer' ? 'bg-white text-black' : 
                  playerRole === 'sb' ? 'bg-blue-500 text-white' : 
                  'bg-red-500 text-white'}`}>
                {playerRole === 'dealer' ? 'D' : playerRole === 'sb' ? 'SB' : 'BB'}
              </div>
            )}

            {/* 头像 */}
            <img
              src={player.avatar}
              alt={player.name}
              className={`w-14 h-14 rounded-full border-4 ${
                player.id === currentPlayerId ? 'border-gold' : 'border-white/30'
              } ${playerStatus === 'folded' ? 'grayscale opacity-50' : ''}`}
            />

            {/* 状态标记 */}
            {playerStatus === 'folded' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-black/70 text-white px-2 py-1 rounded text-xs font-bold">
                  弃牌
                </span>
              </div>
            )}
            {playerStatus === 'all-in' && (
              <div className="absolute -top-1 -right-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                ALL IN
              </div>
            )}

            {/* 名字和筹码 */}
            <div className="mt-1 text-center">
              <p className="text-white text-xs font-medium truncate max-w-[80px]">
                {player.name}
              </p>
              <p className="text-gold text-xs font-bold">
                {player.chips.toLocaleString()}
              </p>
            </div>

            {/* 下注额 */}
            {gameState.roundBets[player.id] > 0 && (
              <div className="absolute -top-8 left-1/2 transform -translate-x-1/2">
                <div className="flex items-center gap-1">
                  <Chip amount={gameState.roundBets[player.id]} size="xs" />
                  <span className="text-white text-xs font-bold">
                    {gameState.roundBets[player.id]}
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )
      })}

      {/* 游戏阶段指示 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
        <div className="bg-black/50 px-4 py-2 rounded-full">
          <span className="text-white/80 text-sm">
            {getPhaseText(gameState.phase)}
          </span>
        </div>
      </div>
    </div>
  )
}

function getPhaseText(phase: string): string {
  const phaseMap: Record<string, string> = {
    'pre-flop': '翻牌前',
    'flop': '翻牌',
    'turn': '转牌',
    'river': '河牌',
    'showdown': '摊牌',
    'ended': '已结束',
  }
  return phaseMap[phase] || phase
}
