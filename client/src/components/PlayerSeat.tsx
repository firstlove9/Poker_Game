import { motion } from 'framer-motion'
import { Crown, Check } from 'lucide-react'
import { RoomPlayer } from '../types'

interface PlayerSeatProps {
  player: RoomPlayer
  index: number
  totalPlayers: number
  isHost: boolean
  isMe: boolean
}

const POSITIONS = [
  { x: 50, y: 85 },
  { x: 15, y: 55 },
  { x: 30, y: 10 },
  { x: 70, y: 10 },
  { x: 85, y: 55 },
  { x: 50, y: 10 },
  { x: 10, y: 30 },
  { x: 90, y: 30 },
  { x: 10, y: 75 },
  { x: 90, y: 75 },
  { x: 30, y: 85 },
  { x: 70, y: 85 },
]

export default function PlayerSeat({ player, index, isHost, isMe }: PlayerSeatProps) {
  const pos = POSITIONS[index] || { x: 50, y: 50 }

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: index * 0.1 }}
      className="absolute transform -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
    >
      <div className={`relative ${isMe ? 'ring-2 md:ring-4 ring-yellow-400 rounded-full' : ''}`}>
        <div className="relative">
          <div className={`w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white font-bold text-sm md:text-lg ${
            isMe ? 'bg-green-600' : 'bg-gray-600'
          } ${player.isReady ? 'border-2 md:border-4 border-green-500' : 'border-2 md:border-4 border-white/20'}`}>
            {player.name[0]}
          </div>

          {isHost && (
            <div className="absolute -top-1 -right-1 w-5 h-5 md:w-6 md:h-6 bg-yellow-500 rounded-full flex items-center justify-center">
              <Crown className="w-3 h-3 md:w-4 md:h-4 text-green-900" />
            </div>
          )}

          {player.isReady && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-green-500 rounded-full flex items-center justify-center">
              <Check className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" />
            </div>
          )}
        </div>

        <div className="mt-0.5 md:mt-1 text-center">
          <p className="text-white font-medium text-[10px] md:text-xs truncate max-w-[60px] md:max-w-[80px]">
            {player.name} {isMe && '(我)'}
          </p>
          {player.isAfk ? (
            <p className="text-orange-400 text-[10px] md:text-xs font-bold">
              ☕ AFK
            </p>
          ) : (
            <p className="text-yellow-300 text-[10px] md:text-xs font-bold">
              ${player.chips.toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
