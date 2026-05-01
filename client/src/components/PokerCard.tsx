import { motion } from 'framer-motion'
import { Card } from '../types'

interface PokerCardProps {
  card?: Card
  hidden?: boolean
  size?: 'sm' | 'md' | 'lg'
  animate?: boolean
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const SIZE_CLASSES = {
  sm: 'w-10 h-14 text-sm',
  md: 'w-16 h-24 text-lg',
  lg: 'w-20 h-28 text-2xl',
}

export default function PokerCard({ card, hidden = false, size = 'md', animate = false }: PokerCardProps) {
  if (hidden || !card) {
    return (
      <motion.div
        initial={animate ? { rotateY: 180, scale: 0.5 } : false}
        animate={{ rotateY: 0, scale: 1 }}
        className={`${SIZE_CLASSES[size]} poker-card-back rounded-lg border-2 border-white/20`}
      />
    )
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
  const suitSymbol = SUIT_SYMBOLS[card.suit]

  return (
    <motion.div
      initial={animate ? { rotateY: 180, scale: 0.5 } : false}
      animate={{ rotateY: 0, scale: 1 }}
      transition={{ duration: 0.4, type: 'spring' }}
      className={`${SIZE_CLASSES[size]} poker-card ${isRed ? 'suit-red' : 'suit-black'}`}
    >
      <div className="absolute top-1 left-1 font-bold leading-none">
        {card.rank}
      </div>
      <div className="text-2xl">
        {suitSymbol}
      </div>
      <div className="absolute bottom-1 right-1 font-bold leading-none rotate-180">
        {card.rank}
      </div>
    </motion.div>
  )
}
