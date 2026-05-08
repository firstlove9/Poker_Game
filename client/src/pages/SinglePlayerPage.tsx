import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, PlayerHandInfo } from '../types'
import ActionLog, { ActionLogEntry, HandResultEntry } from '../components/ActionLog'

interface PlayerInfo {
  id: string
  name: string
  chips: number
  totalBuyIn: number
  isNpc?: boolean
  seatIndex: number
}

interface GameInfo {
  players: PlayerInfo[]
  communityCards: Card[]
  currentPlayerIndex: number
  currentPlayerId: string
  phase: string
  pot: number
  currentBet: number
  minRaise: number
  playerStatus: Record<string, string>
  playerRoles: Record<string, string>
  roundBets: Record<string, number>
}

interface WinnerInfo {
  playerId: string
  playerName: string
  handRank: string
  handDescription: string
  winAmount: number
  explanation: string
}

export default function SinglePlayerPage() {
  const [gameState, setGameState] = useState<GameInfo | null>(null)
  const [humanPlayerId, setHumanPlayerId] = useState<string>('')
  const [humanCards, setHumanCards] = useState<[Card, Card] | null>(null)
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [winners, setWinners] = useState<WinnerInfo[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [raiseAmount, setRaiseAmount] = useState(0)
  const [showRaiseSlider, setShowRaiseSlider] = useState(false)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [initialChips] = useState(1000)
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([])
  const [handResults, setHandResults] = useState<HandResultEntry[]>([])
  const [showActionLog, setShowActionLog] = useState(() => window.innerWidth >= 768)
  const [allHands, setAllHands] = useState<PlayerHandInfo[]>([])
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const playerIdRef = useRef<string>('')
  const mountedRef = useRef(false)

  const addLog = useCallback((playerName: string, action: string, amount?: number, phase?: string) => {
    setActionLogs(prev => {
      const now = Date.now()
      const isDuplicate = prev.some(l =>
        l.playerName === playerName &&
        l.action === action &&
        l.amount === amount &&
        l.phase === (phase || '') &&
        now - l.timestamp < 1000
      )
      if (isDuplicate) return prev
      return [...prev, {
        id: `${now}_${Math.random().toString(36).slice(2, 6)}`,
        playerName,
        action,
        amount,
        phase: phase || '',
        timestamp: now,
      }]
    })
  }, [])

  const updateFromResponse = useCallback((data: any) => {
    if (data.gameState) {
      setGameState(prev => {
        if (prev) {
          const newPhase = data.gameState.phase
          const oldPhase = prev.phase
          if (newPhase !== oldPhase && newPhase !== 'waiting' && newPhase !== 'ended') {
            addLog('系统', newPhase === 'pre-flop' ? 'deal' : newPhase, undefined, newPhase)
          }
          if (data.gameState.playerStatus && prev.playerStatus) {
            for (const pid of Object.keys(data.gameState.playerStatus)) {
              if (data.gameState.playerStatus[pid] !== prev.playerStatus[pid]) {
                const player = data.gameState.players?.find((p: any) => p.id === pid)
                if (player && data.gameState.playerStatus[pid] === 'folded') {
                  addLog(player.name, 'fold', undefined, data.gameState.phase)
                }
              }
            }
          }
          if (data.gameState.roundBets && prev.roundBets) {
            for (const pid of Object.keys(data.gameState.roundBets)) {
              const newBet = data.gameState.roundBets[pid] || 0
              const oldBet = prev.roundBets[pid] || 0
              if (newBet > oldBet) {
                const player = data.gameState.players?.find((p: any) => p.id === pid)
                if (player) {
                  const diff = newBet - oldBet
                  addLog(player.name, data.gameState.currentBet === newBet && oldBet === 0 ? 'call' : 'raise', diff, data.gameState.phase)
                }
              }
            }
          }
        }
        return data.gameState
      })
    }
    if (data.humanCards) {
      setHumanCards(data.humanCards)
    }
    if (data.isMyTurn !== undefined) {
      setIsMyTurn(data.isMyTurn)
    }
    if (data.winners && data.winners.length > 0) {
      setWinners(data.winners)
      setShowResult(true)
      for (const w of data.winners) {
        addLog(w.playerName, 'win', w.winAmount, 'showdown')
      }
    }
    if (data.allHands && data.allHands.length > 0) {
      setAllHands(data.allHands)
      const communityCards = data.communityCards && data.communityCards.length > 0
        ? data.communityCards.map((c: Card) => `${c.rank}${c.suit}`).join(' ')
        : ''
      const players = data.allHands.map((h: PlayerHandInfo) => {
        const cardsStr = h.holeCards && h.holeCards.length > 0
          ? h.holeCards.map((c: Card) => `${c.rank}${c.suit}`).join(' ')
          : ''
        return {
          playerId: h.playerId,
          playerName: h.playerName,
          isWinner: h.isWinner,
          winAmount: h.isWinner ? h.winAmount : undefined,
          holeCards: cardsStr,
          handRank: h.handRank || '',
        }
      })
      const isRunItTwice = !!(data.runItTwiceBoard && data.runItTwiceBoard.length > 1)
      const runItTwiceRounds = isRunItTwice
        ? data.runItTwiceBoard.map((board: any[], roundIdx: number) => {
            const roundResult = data.runItTwiceResults?.[roundIdx]
            return {
              communityCards: board.map((c: Card) => `${c.rank}${c.suit}`).join(' '),
              winnerIds: roundResult?.winnerIds || [],
              winAmount: roundResult?.winAmount || 0,
              handRanks: roundResult?.handRanks || {},
            }
          })
        : undefined
      setHandResults(prev => [...prev, {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        players,
        communityCards,
        timestamp: Date.now(),
        isRunItTwice,
        runItTwiceRounds,
      }])
    }
  }, [addLog])

  const updateFromResponseRef = useRef<(data: any) => void>(() => {})

  useEffect(() => {
    updateFromResponseRef.current = updateFromResponse
  }, [updateFromResponse])

  useEffect(() => {
    mountedRef.current = true
    const playerId = `human_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setHumanPlayerId(playerId)
    playerIdRef.current = playerId

    const storedName = localStorage.getItem('playerName') || '玩家'
    let cancelled = false

    fetch('/api/single-player/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        playerName: storedName,
        npcCount: 3,
        buyIn: 1000,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.success) {
          updateFromResponseRef.current(data)
        } else {
          setMessage(data.error || '启动游戏失败')
        }
      })
      .catch(err => {
        if (cancelled) return
        setMessage('连接服务器失败: ' + err.message)
      })

    const pollId = setInterval(async () => {
      if (!playerIdRef.current || cancelled) return
      try {
        const res = await fetch(`/api/single-player/state?playerId=${playerIdRef.current}`)
        const data = await res.json()
        if (data.success && !cancelled) {
          updateFromResponseRef.current(data)
        }
      } catch {}
    }, 800)

    pollRef.current = pollId

    const handleUnload = () => {
      if (playerIdRef.current) {
        const blob = new Blob([JSON.stringify({ playerId: playerIdRef.current })], { type: 'application/json' })
        navigator.sendBeacon('/api/single-player/end', blob)
      }
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      cancelled = true
      mountedRef.current = false
      clearInterval(pollId)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])

  const handleAction = async (action: string, amount?: number) => {
    if (loading || !isMyTurn) return
    setLoading(true)
    setIsMyTurn(false)
    setShowRaiseSlider(false)

    const myName = gameState?.players.find(p => p.id === humanPlayerId)?.name || '你'
    addLog(myName, action, amount, gameState?.phase)

    try {
      const res = await fetch('/api/single-player/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: humanPlayerId,
          action,
          amount,
        }),
      })
      const data = await res.json()
      if (data.success) {
        updateFromResponse(data)
      } else {
        setMessage(data.error || '操作失败')
        setIsMyTurn(true)
      }
    } catch (err: any) {
      setMessage('操作失败: ' + err.message)
      setIsMyTurn(true)
    }
    setLoading(false)
  }

  const handleRebuy = async () => {
    try {
      const res = await fetch('/api/single-player/rebuy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: humanPlayerId, amount: 1000 }),
      })
      const data = await res.json()
      if (data.success) {
        updateFromResponse(data)
      } else {
        setMessage(data.error || '补充筹码失败')
      }
    } catch (err: any) {
      setMessage('补充筹码失败: ' + err.message)
    }
  }

  const handleNextHand = async () => {
    setLoading(true)
    setShowResult(false)
    setWinners([])
    setAllHands([])
    setActionLogs([])

    try {
      const res = await fetch('/api/single-player/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: humanPlayerId }),
      })
      const data = await res.json()
      if (data.success) {
        updateFromResponse(data)
      } else {
        setMessage(data.error || '开始下一局失败')
      }
    } catch (err: any) {
      setMessage('开始下一局失败: ' + err.message)
    }
    setLoading(false)
  }

  const renderCard = (card: Card | null | undefined) => {
    if (!card) return <div className="w-14 h-20 bg-white/10 rounded border border-white/20" />
    const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
    return (
      <div className={`w-14 h-20 bg-white rounded-lg border-2 border-gray-300 flex flex-col items-center justify-center shadow-md ${isRed ? 'text-red-600' : 'text-black'}`}>
        <span className="font-bold text-base leading-tight">{card.rank}</span>
        <span className="text-xl leading-tight">{suitSymbol[card.suit]}</span>
      </div>
    )
  }

  const getPhaseName = (phase: string) => {
    const map: Record<string, string> = {
      'waiting': '等待中',
      'pre-flop': '翻牌前',
      'flop': '翻牌',
      'turn': '转牌',
      'river': '河牌',
      'showdown': '摊牌',
      'ended': '已结束',
    }
    return map[phase] || phase
  }

  const getRoleName = (role: string) => {
    const map: Record<string, string> = {
      'dealer': '庄',
      'sb': '小盲',
      'bb': '大盲',
    }
    return map[role] || ''
  }

  if (!gameState) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-green-900 to-green-950 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">正在初始化游戏...</div>
      </div>
    )
  }

  const myBet = gameState.roundBets[humanPlayerId] || 0
  const toCall = gameState.currentBet - myBet
  const myChips = gameState.players.find(p => p.id === humanPlayerId)?.chips || 0
  const minRaise = gameState.minRaise || 20
  const maxRaise = myChips
  const totalPot = gameState.pot || 0

  const getPlayerPositions = (total: number) => {
    const positions = [
      { x: 50, y: 92 },
      { x: 15, y: 55 },
      { x: 30, y: 10 },
      { x: 70, y: 10 },
      { x: 85, y: 55 },
      { x: 50, y: 10 },
      { x: 10, y: 30 },
      { x: 90, y: 30 },
      { x: 10, y: 80 },
      { x: 90, y: 80 },
      { x: 30, y: 92 },
      { x: 70, y: 92 },
    ]
    return positions.slice(0, total)
  }

  const reorderedPlayers = (() => {
    const myIndex = gameState.players.findIndex(p => p.id === humanPlayerId)
    if (myIndex < 0) return gameState.players
    const before = gameState.players.slice(0, myIndex)
    const after = gameState.players.slice(myIndex + 1)
    return [gameState.players[myIndex], ...after, ...before]
  })()

  const positions = getPlayerPositions(reorderedPlayers.length)

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-green-900 to-green-950 select-none overflow-hidden">
      <div className="h-[100dvh] flex flex-col">
        <div className="flex justify-between items-center px-4 py-2 bg-black/30">
          <h1 className="text-lg font-bold text-white">单机练习模式</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowActionLog(!showActionLog)}
              className={`px-3 py-1 ${showActionLog ? 'bg-blue-500' : 'bg-blue-600'} text-white rounded hover:bg-blue-700 text-sm`}
            >
              📋日志
            </button>
            <button
              onClick={() => setShowScoreboard(!showScoreboard)}
              className="px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm"
            >
              记分牌
            </button>
            <button
              onClick={handleRebuy}
              className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            >
              +补充筹码
            </button>
            <button
              onClick={() => {
                if (confirm('确定退出？')) {
                  if (playerIdRef.current) {
                    fetch('/api/single-player/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: playerIdRef.current }) }).catch(() => {})
                  }
                  window.location.href = '/'
                }
              }}
              className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              退出
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {showActionLog && (
            <div className="w-56 flex-shrink-0">
              <ActionLog logs={actionLogs} handResults={handResults} />
            </div>
          )}
          <div className="flex-1 relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-full max-w-3xl aspect-[16/10]">
              <div className="absolute inset-[8%] bg-green-800/80 rounded-[50%] border-8 border-green-700 shadow-2xl">
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-yellow-300 font-bold text-lg mb-1">
                    {getPhaseName(gameState.phase)}
                  </div>
                  <div className="text-white font-bold text-xl mb-2">
                    底池: ${gameState.pot}
                  </div>
                  <div className="flex gap-1.5 mb-2">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i}>
                        {i < gameState.communityCards.length
                          ? renderCard(gameState.communityCards[i])
                          : <div className="w-14 h-20 border-2 border-dashed border-green-500/30 rounded-lg" />
                        }
                      </div>
                    ))}
                  </div>
                  {humanCards && gameState.currentBet > 0 && (
                    <div className="text-white/70 text-sm mt-1">当前注: ${gameState.currentBet}</div>
                  )}
                  {!humanCards && gameState.currentBet > 0 && (
                    <div className="text-white/70 text-sm">当前注: ${gameState.currentBet}</div>
                  )}
                </div>
              </div>

              {reorderedPlayers.map((player, idx) => {
                const pos = positions[idx]
                const isMe = player.id === humanPlayerId
                const isCurrentTurn = player.id === gameState.currentPlayerId
                const status = gameState.playerStatus[player.id]
                const role = gameState.playerRoles[player.id]
                const bet = gameState.roundBets[player.id] || 0
                const isFolded = status === 'folded'
                const isAllIn = status === 'all-in'

                return (
                  <div
                    key={player.id}
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${
                      isCurrentTurn && !isFolded ? 'scale-110' : ''
                    } ${isFolded ? 'opacity-40' : ''}`}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    <div className={`flex flex-col items-center ${isMe ? 'order-1' : ''}`}>
                      {bet > 0 && (
                        <div className="text-yellow-300 text-xs font-bold mb-1 bg-black/50 px-2 py-0.5 rounded">
                          ${bet}
                        </div>
                      )}
                      <div className={`relative ${isCurrentTurn && !isFolded ? 'ring-2 ring-yellow-400 rounded-full' : ''}`}>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                          isMe ? 'bg-green-600' : 'bg-gray-600'
                        }`}>
                          {player.name[0]}
                        </div>
                        {role && (
                          <div className="absolute -top-1 -left-1 w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                            {getRoleName(role)}
                          </div>
                        )}
                        {isAllIn && (
                          <div className="absolute -top-1 -right-1 bg-red-600 text-white text-[8px] px-1 rounded-full font-bold">
                            ALL IN
                          </div>
                        )}
                      </div>
                      <div className="text-center mt-0.5">
                        <div className="text-white text-[11px] font-bold truncate max-w-[70px]">
                          {player.name}{isMe ? '(你)' : ''}
                        </div>
                        <div className="text-yellow-300 text-[11px] font-bold">${player.chips}</div>
                        {isFolded && <div className="text-red-400 text-[10px]">弃牌</div>}
                        {isCurrentTurn && !isFolded && !isMe && (
                          <div className="text-yellow-400 text-[10px] animate-pulse">思考中</div>
                        )}
                      </div>
                      {isMe && humanCards && (
                        <div className="flex gap-1 mt-1">
                          {humanCards.map((card, ci) => {
                            const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                            const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                            return (
                              <div key={ci} className={`w-14 h-20 bg-white rounded-lg border-2 border-gray-300 flex flex-col items-center justify-center shadow-md ${isRed ? 'text-red-600' : 'text-black'}`}>
                                <span className="font-bold text-base leading-tight">{card.rank}</span>
                                <span className="text-xl leading-tight">{suitSymbol[card.suit]}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </div>
        </div>

        {message && (
          <div className="text-center text-red-400 text-sm py-1 bg-black/30">{message}</div>
        )}

        {isMyTurn && !showResult && (
          <div className="bg-gray-900/90 border-t border-gray-700 p-3">
            <div className="text-center text-white/60 text-sm mb-2">
              轮到你行动 {toCall > 0 ? `(需跟注 $${toCall})` : '(可以过牌)'}
            </div>
            <div className="flex justify-center gap-2 flex-wrap mb-2">
              <button
                onClick={() => handleAction('fold')}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold text-sm"
              >
                弃牌
              </button>
              {toCall === 0 ? (
                <button
                  onClick={() => handleAction('check')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold text-sm"
                >
                  过牌
                </button>
              ) : (
                <button
                  onClick={() => handleAction('call')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-bold text-sm"
                >
                  跟注 ${toCall}
                </button>
              )}
              <button
                onClick={() => {
                  setRaiseAmount(minRaise)
                  setShowRaiseSlider(!showRaiseSlider)
                }}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-bold text-sm"
              >
                加注
              </button>
              <button
                onClick={() => handleAction('allin')}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-bold text-sm"
              >
                全押 ${myChips}
              </button>
            </div>
            {showRaiseSlider && (
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 rounded-lg">
                <span className="text-yellow-300 font-bold text-sm min-w-[50px]">${raiseAmount}</span>
                <input
                  type="range"
                  min={minRaise}
                  max={maxRaise}
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(parseInt(e.target.value))}
                  className="flex-1 accent-yellow-400"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => setRaiseAmount(minRaise)}
                    className="px-2 py-1 bg-white/10 rounded text-white/80 text-xs hover:bg-white/20"
                  >
                    Min
                  </button>
                  <button
                    onClick={() => setRaiseAmount(Math.max(minRaise, Math.floor(totalPot / 2)))}
                    className="px-2 py-1 bg-white/10 rounded text-white/80 text-xs hover:bg-white/20"
                  >
                    1/2
                  </button>
                  <button
                    onClick={() => setRaiseAmount(Math.max(minRaise, totalPot))}
                    className="px-2 py-1 bg-white/10 rounded text-white/80 text-xs hover:bg-white/20"
                  >
                    满池
                  </button>
                  <button
                    onClick={() => setRaiseAmount(myChips)}
                    className="px-2 py-1 bg-purple-600/40 rounded text-white/80 text-xs hover:bg-purple-600/60"
                  >
                    All-in
                  </button>
                </div>
                <button
                  onClick={() => handleAction('raise', raiseAmount)}
                  className="px-4 py-1.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-sm"
                >
                  确认
                </button>
              </div>
            )}
          </div>
        )}

        {!isMyTurn && !showResult && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && (
          <div className="text-center text-white/40 text-sm py-3 bg-black/30">
            等待其他玩家行动...
          </div>
        )}

        {showResult && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 max-w-lg w-full mx-4 border border-gray-600 max-h-[85vh] overflow-y-auto">
              <h2 className="text-2xl font-bold text-white text-center mb-4">🏆 本局结束</h2>

              {allHands.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {allHands.map((hand, i) => {
                    const isMe = hand.playerId === humanPlayerId
                    return (
                      <div key={i} className={`p-3 rounded-lg border ${
                        hand.isWinner
                          ? 'bg-yellow-900/30 border-yellow-600/30'
                          : isMe
                            ? 'bg-green-900/20 border-green-600/20'
                            : 'bg-white/5 border-white/10'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {hand.isWinner && <span className="text-yellow-400">🏆</span>}
                            <span className={`font-bold ${hand.isWinner ? 'text-yellow-300' : 'text-white'}`}>
                              {hand.playerName} {isMe ? '(你)' : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${hand.isWinner ? 'text-yellow-300' : 'text-white/60'}`}>
                              {hand.handRank}
                            </span>
                            {hand.isWinner && hand.winAmount && (
                              <span className="text-green-400 font-bold text-sm">
                                +${hand.winAmount}
                              </span>
                            )}
                          </div>
                        </div>
                        {hand.holeCards && hand.holeCards.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-white/40 text-xs mr-1">手牌:</span>
                            {hand.holeCards.map((card, ci) => {
                              const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                              const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                              return (
                                <div key={ci} className={`w-10 h-14 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                                  <span className="font-bold text-xs">{card.rank}</span>
                                  <span className="text-sm">{suitSymbol[card.suit]}</span>
                                </div>
                              )
                            })}
                            {hand.handDescription && hand.handRank !== '弃牌' && hand.handRank !== '其他玩家弃牌' && (
                              <span className="text-white/50 text-xs ml-2">→ {hand.handDescription}</span>
                            )}
                          </div>
                        )}
                        {hand.handRank === '弃牌' && (
                          <div className="text-red-400/60 text-xs mt-1">弃牌</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  {winners.map((winner, i) => (
                    <div key={i} className="text-center mb-4 p-3 bg-yellow-900/30 rounded-lg border border-yellow-600/30">
                      <div className="text-xl font-bold text-yellow-300">{winner.playerName} 获胜！</div>
                      <div className="text-white/80 mt-1">{winner.handDescription}</div>
                      <div className="text-green-400 font-bold mt-1">赢得 ${winner.winAmount}</div>
                      {winner.explanation && (
                        <div className="text-white/60 text-sm mt-1">{winner.explanation}</div>
                      )}
                    </div>
                  ))}
                </>
              )}

              <div className="mb-4">
                <div className="text-white/60 text-sm mb-2 text-center">各玩家筹码</div>
                {gameState.players.map(p => {
                  const profit = p.chips - (p.totalBuyIn || initialChips)
                  return (
                    <div key={p.id} className="flex justify-between text-white text-sm py-1">
                      <span>{p.name} {p.id === humanPlayerId ? '(你)' : ''}</span>
                      <span>
                        <span className={p.chips >= (p.totalBuyIn || initialChips) ? 'text-green-400' : 'text-red-400'}>${p.chips}</span>
                        <span className={`ml-2 text-xs ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ({profit >= 0 ? '+' : ''}{profit})
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleNextHand}
                  className="flex-1 px-5 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-bold"
                >
                  下一局
                </button>
                <button
                  onClick={async () => {
                    if (playerIdRef.current) {
                      try { await fetch('/api/single-player/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: playerIdRef.current }) }) } catch {}
                    }
                    window.location.href = '/'
                  }}
                  className="flex-1 px-5 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-bold"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        )}

        {showScoreboard && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-600">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-white">记分牌</h2>
                <button
                  onClick={() => setShowScoreboard(false)}
                  className="text-white/60 hover:text-white text-xl"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2">
                {gameState.players
                  .slice()
                  .sort((a, b) => b.chips - a.chips)
                  .map((p, idx) => {
                    const profit = p.chips - (p.totalBuyIn || initialChips)
                    const rebuyCount = Math.max(0, Math.floor(((p.totalBuyIn || initialChips) - initialChips) / 1000))
                    return (
                      <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg ${
                        p.id === humanPlayerId ? 'bg-green-900/40 border border-green-600/30' : 'bg-white/5'
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className="text-white/40 font-bold w-6">#{idx + 1}</span>
                          <div>
                            <div className="text-white font-bold text-sm">
                              {p.name} {p.id === humanPlayerId ? '(你)' : ''}
                              {p.isNpc && <span className="text-gray-400 text-xs ml-1">NPC</span>}
                            </div>
                            <div className="text-white/40 text-xs">
                              总买入: ${p.totalBuyIn || initialChips}
                              {rebuyCount > 0 && <span className="text-orange-400 ml-1">补充{rebuyCount}次</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-yellow-300 font-bold">${p.chips}</div>
                          <div className={`text-xs font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {profit >= 0 ? '+' : ''}{profit}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
