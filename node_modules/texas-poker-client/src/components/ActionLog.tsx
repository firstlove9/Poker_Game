import { useRef, useEffect } from 'react'

export interface ActionLogEntry {
  id: string
  playerName: string
  action: string
  amount?: number
  phase: string
  timestamp: number
}

interface ActionLogProps {
  logs: ActionLogEntry[]
  onClear: () => void
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

export default function ActionLog({ logs, onClear }: ActionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="h-full flex flex-col bg-gray-900/90 border-r border-gray-700/50">
      <div className="flex justify-between items-center px-3 py-2 border-b border-gray-700/50">
        <h3 className="text-white font-bold text-sm">📋 行动日志</h3>
        <button
          onClick={onClear}
          className="text-white/40 hover:text-white/80 text-xs px-2 py-0.5 rounded bg-white/5 hover:bg-white/10"
        >
          清除
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
        {logs.length === 0 ? (
          <div className="text-white/30 text-center py-4">暂无行动记录</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-1.5 py-1 px-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors">
              <span className="text-sm flex-shrink-0">{EMOJIS[log.action] || '📌'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
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
        )}
      </div>
    </div>
  )
}
