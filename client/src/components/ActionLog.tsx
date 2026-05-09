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
  playerId: string
  playerName: string
  isWinner: boolean
  winAmount?: number
  holeCards: string
  handRank: string
  netWin?: number
  initialChips?: number
}

export interface RunItTwiceRoundInfo {
  communityCards: string
  winnerIds: string[]
  winAmount: number
  handRanks: Record<string, string>
}

export interface HandResultEntry {
  id: string
  players: HandResultPlayer[]
  communityCards: string
  timestamp: number
  isRunItTwice?: boolean
  runItTwiceRounds?: RunItTwiceRoundInfo[]
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
  'pre-flop': '翻前',
  'flop': '翻牌',
  'turn': '转牌',
  'river': '河牌',
  'showdown': '摊牌',
  'run-it-twice-choice': '跑马选择',
  'run-it-twice-dice': '掷骰子',
}

const PHASE_COLORS: Record<string, string> = {
  'pre-flop': 'text-orange-400',
  'flop': 'text-blue-400',
  'turn': 'text-purple-400',
  'river': 'text-red-400',
  'showdown': 'text-yellow-400',
  'run-it-twice-choice': 'text-yellow-400',
  'run-it-twice-dice': 'text-purple-400',
}

const HAND_RANK_LABELS: Record<string, string> = {
  '皇家同花顺': '👑同花',
  '同花顺': '🌈顺子',
  '四条': '💎四条',
  '葫芦': '🏠葫芦',
  '同花': '🌸同花',
  '顺子': '🔗顺子',
  '三条': '🎯三条',
  '两对': '✌两对',
  '一对': '👫一对',
  '高牌': '🃏高牌',
  '弃牌': '🛑弃牌',
  '胜出': '🏆胜出',
}

function formatHandRank(handRank: string): string {
  if (!handRank) return '🃏高牌'
  if (handRank.includes(' / ')) {
    return handRank.split(' / ').map(r => HAND_RANK_LABELS[r] || r).join(' / ')
  }
  return HAND_RANK_LABELS[handRank] || '🃏高牌'
}

const SUIT_INFO: Record<string, { symbol: string; isRed: boolean }> = {
  '♠': { symbol: '♠', isRed: false },
  '♥': { symbol: '♥', isRed: true },
  '♦': { symbol: '♦', isRed: true },
  '♣': { symbol: '♣', isRed: false },
  's': { symbol: '♠', isRed: false },
  'h': { symbol: '♥', isRed: true },
  'd': { symbol: '♦', isRed: true },
  'c': { symbol: '♣', isRed: false },
  'spades': { symbol: '♠', isRed: false },
  'hearts': { symbol: '♥', isRed: true },
  'diamonds': { symbol: '♦', isRed: true },
  'clubs': { symbol: '♣', isRed: false },
}

function parseCardStr(cardStr: string): { rank: string; suit: { symbol: string; isRed: boolean } } | null {
  if (!cardStr || cardStr.length < 2) return null
  const suitKeys = ['spades', 'hearts', 'diamonds', 'clubs']
  for (const key of suitKeys) {
    if (cardStr.endsWith(key)) {
      const rank = cardStr.slice(0, -key.length)
      const suit = SUIT_INFO[key]
      if (rank && suit) return { rank, suit }
    }
  }
  const rank = cardStr.slice(0, -1)
  const suitChar = cardStr.slice(-1)
  const suit = SUIT_INFO[suitChar]
  if (suit && rank) return { rank, suit }
  return null
}

function MiniCard({ cardStr }: { cardStr: string }) {
  const parsed = parseCardStr(cardStr)
  if (!parsed) return <span>{cardStr}</span>
  return (
    <span className={`inline-flex items-center justify-center px-1 py-0.5 rounded bg-white/90 shadow-sm font-bold text-[11px] leading-none ${parsed.suit.isRed ? 'text-red-600' : 'text-gray-900'}`}>
      {parsed.rank}{parsed.suit.symbol}
    </span>
  )
}

function renderPokerCards(text: string) {
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((card, i) => <MiniCard key={i} cardStr={card} />)}
    </span>
  )
}

function renderCommunityCards(text: string) {
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  const groups: string[][] = []
  if (parts.length >= 3) groups.push(parts.slice(0, 3))
  if (parts.length >= 4) groups.push([parts[3]])
  if (parts.length >= 5) groups.push([parts[4]])
  if (groups.length === 0) groups.push(parts)
  return (
    <span className="inline-flex items-center gap-1">
      {groups.map((g, gi) => (
        <span key={gi} className="inline-flex items-center gap-0.5">
          {gi > 0 && <span className="text-white/20 mx-0.5">|</span>}
          {g.map((card, ci) => <MiniCard key={ci} cardStr={card} />)}
        </span>
      ))}
    </span>
  )
}

type TabType = 'actions' | 'results'

export default function ActionLog({ logs, handResults }: ActionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<TabType>('actions')

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto text-xs">
        {activeTab === 'actions' ? (
          logs.length === 0 ? (
            <div className="text-white/30 text-center py-4">暂无行动记录</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-white/40 border-b border-white/10">
                  <th className="text-left py-1.5 px-2 w-6"></th>
                  <th className="text-left py-1.5 px-1 w-14">阶段</th>
                  <th className="text-left py-1.5 px-1">玩家</th>
                  <th className="text-left py-1.5 px-1">行动</th>
                  <th className="text-right py-1.5 px-2 w-12">金额</th>
                </tr>
              </thead>
              <tbody>
                {[...logs].reverse().map((log) => (
                  <tr key={log.id} className="border-b border-white/5 hover:bg-white/10 transition-colors">
                    <td className="py-1 px-2"><span className="text-sm">{EMOJIS[log.action] || '📌'}</span></td>
                    <td className="py-1 px-1">
                      <span className={`${PHASE_COLORS[log.phase] || 'text-white/50'} font-medium`}>
                        {PHASE_NAMES[log.phase] || log.phase}
                      </span>
                    </td>
                    <td className="py-1 px-1 text-white/90 font-medium truncate max-w-[72px]" title={log.playerName}>{log.playerName}</td>
                    <td className="py-1 px-1 text-blue-300">{ACTION_NAMES[log.action] || log.action}</td>
                    <td className="py-1 px-2 text-right">
                      {log.amount !== undefined && log.amount > 0 ? (
                        <span className="text-yellow-300 font-bold">${log.amount}</span>
                      ) : (
                        <span className="text-white/20">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          handResults.length === 0 ? (
            <div className="text-white/30 text-center py-4">暂无牌局结果</div>
          ) : (
            <div className="p-2 space-y-2">
              {[...handResults].reverse().map((result) => (
                <div key={result.id} className="rounded border bg-white/5 border-white/10 overflow-hidden">
                  {result.communityCards && !result.isRunItTwice && (
                    <div className="px-2 py-1 bg-white/5 border-b border-white/10 flex items-center gap-1">
                      <span className="text-white/40 text-[10px]">公共牌</span>
                      {renderCommunityCards(result.communityCards)}
                    </div>
                  )}
                  {result.isRunItTwice && result.runItTwiceRounds ? (
                    <>
                      {result.runItTwiceRounds.map((round, ri) => (
                        <div key={ri} className={ri > 0 ? 'border-t border-white/10' : ''}>
                          <div className="px-2 py-0.5 bg-purple-500/10 flex items-center gap-1">
                            <span className="text-purple-300 font-bold text-[10px]">第{ri + 1}轮</span>
                            {round.communityCards && (
                              <span className="inline-flex items-center gap-0.5">{renderCommunityCards(round.communityCards)}</span>
                            )}
                          </div>
                          <table className="w-full">
                            <tbody>
                              {result.players.filter(p => round.handRanks[p.playerId]).map((p, pi) => {
                                const isRoundWinner = round.winnerIds.includes(p.playerId)
                                const rank = round.handRanks[p.playerId] || ''
                                return (
                                  <tr key={pi} className={`border-t border-white/5 ${isRoundWinner ? 'bg-green-500/10' : ''}`}>
                                    <td className="py-1 px-1.5 w-5 text-center">{isRoundWinner ? '🏆' : ''}</td>
                                    <td className="py-1 px-1">
                                      <div className={`font-medium ${isRoundWinner ? 'text-green-400' : 'text-white/60'}`}>{p.playerName}</div>
                                      {isRoundWinner && <div className="text-yellow-300 font-bold text-[10px]">+${round.winAmount}</div>}
                                    </td>
                                    <td className="py-1 px-1 text-right">
                                      <div className="flex flex-col items-end gap-0.5">
                                        {p.holeCards && renderPokerCards(p.holeCards)}
                                        {rank && <span className="text-cyan-300/80 text-[10px]">{HAND_RANK_LABELS[rank] || rank}</span>}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
                      <div className="border-t border-white/10">
                        <div className="px-2 py-0.5 bg-yellow-500/10 text-yellow-300 font-bold text-[10px]">总计</div>
                        <table className="w-full">
                          <tbody>
                            {result.players.map((p, pi) => (
                              <tr key={pi} className={`border-t border-white/5 ${p.isWinner ? 'bg-green-500/10' : ''}`}>
                                <td className="py-1 px-1.5 w-5 text-center">{p.isWinner ? '🏆' : ''}</td>
                                <td className="py-1 px-1">
                                  <div className={`font-medium ${p.isWinner ? 'text-green-400' : 'text-white/60'}`}>{p.playerName}</div>
                                  {p.initialChips !== undefined && (
                                    <div className="text-white/40 text-[9px]">带入 ${p.initialChips}</div>
                                  )}
                                </td>
                                <td className="py-1 px-1 text-right">
                                  <div className="flex flex-col items-end gap-0.5">
                                    {p.holeCards && renderPokerCards(p.holeCards)}
                                    <span className="text-cyan-300/80 text-[10px]" title={p.handRank}>{formatHandRank(p.handRank)}</span>
                                    {p.netWin !== undefined && p.netWin !== 0 && (
                                      <span className={`font-bold text-[10px] ${p.netWin > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {p.netWin > 0 ? '+' : ''}{p.netWin}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {result.players.map((p, pi) => (
                          <tr key={pi} className={`border-t border-white/5 ${p.isWinner ? 'bg-green-500/10' : ''}`}>
                            <td className="py-1 px-1.5 w-5 text-center">{p.isWinner ? '🏆' : ''}</td>
                            <td className="py-1 px-1">
                              <div className={`font-medium ${p.isWinner ? 'text-green-400' : 'text-white/60'}`}>{p.playerName}</div>
                              {p.initialChips !== undefined && (
                                <div className="text-white/40 text-[9px]">带入 ${p.initialChips}</div>
                              )}
                            </td>
                            <td className="py-1 px-1 text-right">
                              <div className="flex flex-col items-end gap-0.5">
                                {p.holeCards && renderPokerCards(p.holeCards)}
                                <span className="text-cyan-300/80 text-[10px]" title={p.handRank}>{formatHandRank(p.handRank)}</span>
                                {p.netWin !== undefined && p.netWin !== 0 && (
                                  <span className={`font-bold text-[10px] ${p.netWin > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {p.netWin > 0 ? '+' : ''}{p.netWin}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}