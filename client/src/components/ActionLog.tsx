import { useRef, useEffect, useState } from 'react'

export interface ActionLogEntry {
  id: string
  playerName: string
  action: string
  amount?: number
  phase: string
  timestamp: number
}

export interface HandResultPlayer {
  playerName: string
  isWinner: boolean
  winAmount?: number
  holeCards: string
  handRank: string
}

export interface HandResultEntry {
  id: string
  players: HandResultPlayer[]
  communityCards: string
  timestamp: number
}

interface ActionLogProps {
  logs: ActionLogEntry[]
  handResults: HandResultEntry[]
}

const EMOJIS: Record<string, string> = {
  fold: '🛑',
  check: '✋',
  call: '📞',
  raise: '⬆️',
  allin: '🔥',
  all_in: '🔥',
  blind: '💰',
  deal: '🃏',
  flop: '🎴',
  turn: '🃏',
  river: '🃏',
  showdown: '🏆',
  win: '🎉',
}

const ACTION_NAMES: Record<string, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  allin: '全押',
  all_in: '全押',
  blind: '下盲注',
  deal: '发牌',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  win: '获胜',
}

const PHASE_NAMES: Record<string, string> = {
  'pre-flop': '翻牌前',
  'flop': '翻牌',
  'turn': '转牌',
  'river': '河牌',
  'showdown': '摊牌',
}

const HAND_RANK_ICONS: Record<string, string> = {
  '皇家同花顺': '👑',
  '同花顺': '🌈',
  '四条': '💎',
  '葫芦': '🏠',
  '同花': '🌸',
  '顺子': '🔗',
  '三条': '🎯',
  '两对': '✌️',
  '一对': '👫',
  '高牌': '🃏',
  '弃牌': '🛑',
}

const SUIT_SYMBOLS: Record<string, { symbol: string; color: string }> = {
  '♠': { symbol: '♠', color: 'text-white' },
  '♥': { symbol: '♥', color: 'text-red-400' },
  '♦': { symbol: '♦', color: 'text-red-400' },
  '♣': { symbol: '♣', color: 'text-white' },
  's': { symbol: '♠', color: 'text-white' },
  'h': { symbol: '♥', color: 'text-red-400' },
  'd': { symbol: '♦', color: 'text-red-400' },
  'c': { symbol: '♣', color: 'text-white' },
  'spades': { symbol: '♠', color: 'text-white' },
  'hearts': { symbol: '♥', color: 'text-red-400' },
  'diamonds': { symbol: '♦', color: 'text-red-400' },
  'clubs': { symbol: '♣', color: 'text-white' },
}

function parseCardStr(cardStr: string): { rank: string; suit: { symbol: string; color: string } } | null {
  if (!cardStr || cardStr.length < 2) return null
  const suitKeys = ['spades', 'hearts', 'diamonds', 'clubs']
  for (const key of suitKeys) {
    if (cardStr.endsWith(key)) {
      const rank = cardStr.slice(0, -key.length)
      const suit = SUIT_SYMBOLS[key]
      if (rank && suit) return { rank, suit }
    }
  }
  const rank = cardStr.slice(0, -1)
  const suitChar = cardStr.slice(-1)
  const suit = SUIT_SYMBOLS[suitChar]
  if (suit && rank) return { rank, suit }
  return null
}

function renderCommunityCards(text: string) {
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  const groups: { cards: string[]; label?: string }[] = []
  if (parts.length >= 3) {
    groups.push({ cards: parts.slice(0, 3), label: '翻牌' })
  }
  if (parts.length >= 4) {
    groups.push({ cards: [parts[3]], label: '转牌' })
  }
  if (parts.length >= 5) {
    groups.push({ cards: [parts[4]], label: '河牌' })
  }
  if (groups.length === 0) {
    groups.push({ cards: parts })
  }
  return (
    <span className="font-mono inline-flex items-center gap-1.5">
      {groups.map((g, gi) => (
        <span key={gi} className="inline-flex items-center gap-0.5">
          {gi > 0 && <span className="text-white/20 mx-0.5">|</span>}
          {g.cards.map((card, ci) => {
            const parsed = parseCardStr(card)
            if (parsed) {
              return <span key={ci} className={parsed.suit.color}>{parsed.rank}{parsed.suit.symbol}</span>
            }
            return <span key={ci}>{card}</span>
          })}
        </span>
      ))}
    </span>
  )
}

function renderCards(text: string) {
  const parts = text.split(/(\s+)/)
  return parts.map((part, i) => {
    if (part.trim() === '') return part
    const parsed = parseCardStr(part)
    if (parsed) {
      return <span key={i} className={parsed.suit.color}>{parsed.rank}{parsed.suit.symbol}</span>
    }
    return <span key={i}>{part}</span>
  })
}

type TabType = 'actions' | 'results'

export default function ActionLog({ logs, handResults }: ActionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<TabType>('actions')

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, handResults, activeTab])

  return (
    <div className="h-full flex flex-col bg-gray-900/90 border-r border-gray-700/50">
      <div className="flex border-b border-gray-700/50">
        <button
          onClick={() => setActiveTab('actions')}
          className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'actions' ? 'text-white border-b-2 border-blue-400 bg-white/5' : 'text-white/50 hover:text-white/70'}`}
        >
          📋 行动
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={`flex-1 px-3 py-2 text-xs font-bold transition-colors relative ${activeTab === 'results' ? 'text-white border-b-2 border-purple-400 bg-white/5' : 'text-white/50 hover:text-white/70'}`}
        >
          📊 牌局
          {handResults.length > 0 && (
            <span className="ml-1 px-1 py-0.5 text-[10px] bg-purple-500/30 text-purple-300 rounded-full">{handResults.length}</span>
          )}
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
        {activeTab === 'actions' ? (
          logs.length === 0 ? (
            <div className="text-white/30 text-center py-4">暂无行动记录</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start gap-1.5 py-1 px-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors">
                <span className="text-sm flex-shrink-0">{EMOJIS[log.action] || '📌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-white/90 font-medium truncate">{log.playerName}</span>
                    <span className="text-blue-300">{ACTION_NAMES[log.action] || log.action}</span>
                    {log.amount !== undefined && log.amount > 0 && (
                      <span className="text-yellow-300 font-bold">${log.amount}</span>
                    )}
                  </div>
                  <div className="text-white/30 text-[10px]">
                    {PHASE_NAMES[log.phase] || log.phase}
                  </div>
                </div>
              </div>
            ))
          )
        ) : (
          handResults.length === 0 ? (
            <div className="text-white/30 text-center py-4">暂无牌局结果</div>
          ) : (
            handResults.map((result) => (
              <div key={result.id} className="py-1.5 px-2 rounded border bg-white/5 border-white/10">
                {result.communityCards && (
                  <div className="text-[11px] mb-1 flex items-center gap-0.5">
                    <span className="text-white/40">公共牌:</span>
                    {renderCommunityCards(result.communityCards)}
                  </div>
                )}
                <div className="space-y-0.5">
                  {result.players.map((p, pi) => (
                    <div key={pi} className="flex items-center gap-1 flex-wrap">
                      <span className={`font-medium ${p.isWinner ? 'text-green-400' : 'text-white/60'}`}>
                        {p.isWinner ? '🏆' : '  '} {p.playerName}
                      </span>
                      {p.isWinner && p.winAmount !== undefined && p.winAmount > 0 && (
                        <span className="text-yellow-300 font-bold">+${p.winAmount}</span>
                      )}
                      {p.holeCards && (
                        <span className="font-mono text-[11px]">{renderCards(p.holeCards)}</span>
                      )}
                      <span className="text-sm" title={p.handRank}>{HAND_RANK_ICONS[p.handRank] || '🃏'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}
