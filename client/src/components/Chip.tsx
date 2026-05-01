interface ChipProps {
  amount: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[8px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-12 h-12 text-xs',
  lg: 'w-16 h-16 text-sm',
}

const CHIP_COLORS = [
  { max: 10, color: 'bg-white text-gray-900 border-gray-300' },
  { max: 50, color: 'bg-red-600 text-white border-red-400' },
  { max: 100, color: 'bg-blue-600 text-white border-blue-400' },
  { max: 500, color: 'bg-green-600 text-white border-green-400' },
  { max: 1000, color: 'bg-purple-600 text-white border-purple-400' },
  { max: 5000, color: 'bg-yellow-500 text-black border-yellow-300' },
  { max: Infinity, color: 'bg-gray-800 text-white border-gray-600' },
]

export default function Chip({ amount, size = 'md' }: ChipProps) {
  const colorClass = CHIP_COLORS.find(c => amount <= c.max)?.color || CHIP_COLORS[CHIP_COLORS.length - 1].color

  return (
    <div className={`${SIZE_CLASSES[size]} chip ${colorClass}`}>
      <span className="font-bold">{formatAmount(amount)}</span>
    </div>
  )
}

function formatAmount(amount: number): string {
  if (amount >= 1000) {
    return (amount / 1000).toFixed(1) + 'k'
  }
  return amount.toString()
}
