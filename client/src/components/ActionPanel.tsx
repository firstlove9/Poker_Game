import { useState } from 'react'
import { motion } from 'framer-motion'
import { GameState } from '../types'

interface ActionPanelProps {
  gameState: GameState
  playerChips: number
  onAction: (action: string, amount?: number) => void
}

export default function ActionPanel({ gameState, playerChips, onAction }: ActionPanelProps) {
  const [raiseAmount, setRaiseAmount] = useState(gameState.minRaise)
  const [showRaiseSlider, setShowRaiseSlider] = useState(false)

  const callAmount = gameState.currentBet
  const canCheck = callAmount === 0
  const minRaise = Math.max(gameState.minRaise, gameState.currentBet * 2)
  const maxRaise = playerChips

  const handleRaise = () => {
    onAction('raise', raiseAmount)
    setShowRaiseSlider(false)
  }

  const handleAllIn = () => {
    onAction('all-in', playerChips)
  }

  return (
    <div className="glass-panel p-4 rounded-2xl">
      {/* 主要动作按钮 */}
      <div className="flex gap-3 mb-4">
        {/* 弃牌 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onAction('fold')}
          className="btn-poker-danger px-6 py-3 min-w-[100px]"
        >
          <div className="text-sm opacity-70">Fold</div>
          <div className="font-bold">弃牌</div>
        </motion.button>

        {/* 过牌/跟注 */}
        {canCheck ? (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onAction('check')}
            className="btn-poker-secondary px-6 py-3 min-w-[100px]"
          >
            <div className="text-sm opacity-70">Check</div>
            <div className="font-bold">过牌</div>
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onAction('call')}
            className="btn-poker-secondary px-6 py-3 min-w-[100px]"
          >
            <div className="text-sm opacity-70">Call</div>
            <div className="font-bold">跟注 {callAmount}</div>
          </motion.button>
        )}

        {/* 加注 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowRaiseSlider(!showRaiseSlider)}
          className="btn-poker-primary px-6 py-3 min-w-[100px]"
        >
          <div className="text-sm opacity-70">Raise</div>
          <div className="font-bold">加注</div>
        </motion.button>

        {/* 全押 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleAllIn}
          className="btn-poker bg-red-600 hover:bg-red-700 px-6 py-3 min-w-[100px]"
        >
          <div className="text-sm opacity-70">All-in</div>
          <div className="font-bold">全押</div>
        </motion.button>
      </div>

      {/* 加注滑块 */}
      {showRaiseSlider && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="border-t border-white/10 pt-4"
        >
          <div className="flex items-center gap-4">
            <span className="text-white/60 text-sm min-w-[60px]">
              {raiseAmount}
            </span>
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(parseInt(e.target.value))}
              className="flex-1 accent-gold"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRaiseAmount(minRaise)}
                className="px-3 py-1 bg-white/10 rounded text-white/80 text-sm hover:bg-white/20"
              >
                Min
              </button>
              <button
                onClick={() => setRaiseAmount(Math.floor(maxRaise / 2))}
                className="px-3 py-1 bg-white/10 rounded text-white/80 text-sm hover:bg-white/20"
              >
                1/2 Pot
              </button>
              <button
                onClick={() => setRaiseAmount(maxRaise)}
                className="px-3 py-1 bg-white/10 rounded text-white/80 text-sm hover:bg-white/20"
              >
                Max
              </button>
            </div>
            <button
              onClick={handleRaise}
              className="btn-poker-primary px-4 py-2"
            >
              确认
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
