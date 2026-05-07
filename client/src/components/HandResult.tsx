import { motion } from 'framer-motion'
import { Trophy, ChevronRight } from 'lucide-react'
import { WinnerInfo } from '../types'
import PokerCard from './PokerCard'

interface HandResultProps {
  winners: WinnerInfo[]
  onNextHand: () => void
}

export default function HandResult({ winners, onNextHand }: HandResultProps) {
  const mainWinner = winners[0]

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
      >
        {/* 标题 */}
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="inline-flex items-center justify-center w-20 h-20 bg-gold rounded-full mb-4"
          >
            <Trophy className="w-10 h-10 text-poker-green-dark" />
          </motion.div>
          <h2 className="text-3xl font-bold text-white mb-2">本局结算</h2>
          <p className="text-white/60">{mainWinner.explanation}</p>
        </div>

        {/* 主要赢家 */}
        <div className="bg-white/5 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-gold rounded-full flex items-center justify-center">
              <span className="text-3xl font-bold text-poker-green-dark">
                {mainWinner.playerName[0]}
              </span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gold">{mainWinner.playerName}</h3>
              <p className="text-white/60">赢得 {mainWinner.winAmount.toLocaleString()} 筹码</p>
            </div>
          </div>

          {/* 获胜牌型 */}
          <div className="border-t border-white/10 pt-4">
            <p className="text-white/60 text-sm mb-2">获胜牌型: <span className="text-gold font-bold">{mainWinner.handRank}</span></p>
            <p className="text-white/40 text-sm mb-3">{mainWinner.handDescription}</p>
            
            {/* 手牌展示 */}
            {mainWinner.holeCards && mainWinner.holeCards.length > 0 ? (
            <div className="flex gap-4 items-center">
              <div>
                <p className="text-white/40 text-xs mb-1">底牌</p>
                <div className="flex gap-2">
                  {mainWinner.holeCards.map((card, i) => (
                    <PokerCard key={i} card={card} size="sm" />
                  ))}
                </div>
              </div>
              <ChevronRight className="w-6 h-6 text-white/20" />
              <div>
                <p className="text-white/40 text-xs mb-1">获胜组合</p>
                <div className="flex gap-1">
                  {mainWinner.winningCards.slice(0, 5).map((card, i) => (
                    <PokerCard key={i} card={card} size="sm" />
                  ))}
                </div>
              </div>
            </div>
            ) : (
            <div className="text-white/40 text-sm italic">
              其他玩家弃牌
            </div>
            )}
          </div>
        </div>

        {/* 其他赢家（如果有边池） */}
        {winners.length > 1 && (
          <div className="mb-6">
            <h4 className="text-white font-bold mb-3">边池赢家</h4>
            <div className="space-y-2">
              {winners.slice(1).map((winner, index) => (
                <div key={index} className="flex justify-between items-center bg-white/5 p-3 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center">
                      <span className="text-gold font-bold">{winner.playerName[0]}</span>
                    </div>
                    <div>
                      <p className="text-white font-medium">{winner.playerName}</p>
                      <p className="text-white/40 text-sm">{winner.handRank}</p>
                    </div>
                  </div>
                  <span className="text-gold font-bold">+{winner.winAmount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onNextHand}
            className="flex-1 btn-poker-primary py-4 text-lg"
          >
            下一局
          </button>
        </div>
      </motion.div>
    </div>
  )
}
