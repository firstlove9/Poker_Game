import { motion } from 'framer-motion'
import { Card } from '../types'
import PokerCard from './PokerCard'

interface PlayerHandProps {
  cards: [Card, Card]
}

export default function PlayerHand({ cards }: PlayerHandProps) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="flex gap-3"
    >
      <motion.div
        initial={{ rotateY: 180 }}
        animate={{ rotateY: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <PokerCard card={cards[0]} size="lg" />
      </motion.div>
      <motion.div
        initial={{ rotateY: 180 }}
        animate={{ rotateY: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        <PokerCard card={cards[1]} size="lg" />
      </motion.div>
    </motion.div>
  )
}
