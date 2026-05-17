import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSocketStore, saveRoomId, clearSavedRoom } from '../stores/socketStore'
import { useGameStore } from '../stores/gameStore'
import { useToastStore } from '../stores/toastStore'
import { ClientEvents, ServerEvents, Card, PlayerHandInfo, RunItTwiceChoice, RunItTwiceDiceResult, RunItTwiceRoundResult, GameVariant, GameModifier, VARIANT_RULES, MODIFIER_INFO, ScoreboardEntry } from '../types'
import ChatBox from '../components/ChatBox'
import ActionLog, { ActionLogEntry, HandResultEntry } from '../components/ActionLog'
import { HelpCircle, X } from 'lucide-react'

export default function GamePage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { emit, on, off, playerId: myPlayerId, isConnected, isReconnecting } = useSocketStore()
  const addToast = useToastStore((s) => s.addToast)
  const {
    currentRoom,
    currentPlayer,
    myCards,
    gameState,
    isMyTurn,
    winners,
    setMyCards,
    setGameState,
    setIsMyTurn,
    setWinners,
    setCurrentRoom,
    setCurrentPlayer,
    reset
  } = useGameStore()

  const [showResult, setShowResult] = useState(false)
  const [raiseAmount, setRaiseAmount] = useState(0)
  const [showRaiseSlider, setShowRaiseSlider] = useState(false)
  const [showScoreboard, setShowScoreboard] = useState(false)
  const [message, setMessage] = useState('')
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem(`poker_logs_${roomId}`)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [handResults, setHandResults] = useState<HandResultEntry[]>(() => {
    try {
      const saved = localStorage.getItem(`poker_results_${roomId}`)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [showActionLog, setShowActionLog] = useState(() => window.innerWidth >= 768)
  const [showMobileChat, setShowMobileChat] = useState(false)
  const [allHands, setAllHands] = useState<PlayerHandInfo[]>([])
  const [resultCommunityCards, setResultCommunityCards] = useState<Card[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isWaitingForStart, setIsWaitingForStart] = useState(false)
  const [rebuyCountdown, setRebuyCountdown] = useState(0)
  const rebuyCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [myHandStartChips, setMyHandStartChips] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const gameStartedDuringReadyRef = useRef(false)
  const [gameOverInfo, setGameOverInfo] = useState<{ winner: { id: string; name: string; chips: number } | null } | null>(null)
  const [isGameOver, setIsGameOver] = useState(false)
  const [voteInfo, setVoteInfo] = useState<{
    initiatorId: string
    initiatorName: string
    votes: Record<string, boolean>
    totalPlayers: number
    votedPlayers: number
    createdAt?: number
  } | null>(null)
  const [showVoteModal, setShowVoteModal] = useState(false)
  const [voteCooldownUntil, setVoteCooldownUntil] = useState<number>(0)
  const [voteCooldownRemaining, setVoteCooldownRemaining] = useState(0)
  const [voteCountdown, setVoteCountdown] = useState(15)

  const [voteExtendInfo, setVoteExtendInfo] = useState<{
    initiatorId: string
    initiatorName: string
    votes: Record<string, boolean>
    totalPlayers: number
    votedPlayers: number
    createdAt?: number
    extendCount: number
  } | null>(null)
  const [showVoteExtendModal, setShowVoteExtendModal] = useState(false)

  const [showCardsInfo, setShowCardsInfo] = useState<{
    playerId: string
    playerName: string
    holeCards: Card[]
    communityCards: Card[]
  } | null>(null)
  const [showedCardsPlayerIds, setShowedCardsPlayerIds] = useState<Set<string>>(new Set())

  const [showRunItTwiceDialog, setShowRunItTwiceDialog] = useState(false)
  const [runItTwiceMyChoice, setRunItTwiceMyChoice] = useState<RunItTwiceChoice | null>(null)
  const [runItTwiceOtherChoice, setRunItTwiceOtherChoice] = useState<RunItTwiceChoice | null>(null)
  const [runItTwiceOtherName, setRunItTwiceOtherName] = useState('')
  const [showDiceDialog, setShowDiceDialog] = useState(false)
  const [showRuleHelp, setShowRuleHelp] = useState(false)
  const [diceReady, setDiceReady] = useState<Record<string, boolean>>({})
  const [diceResult, setDiceResult] = useState<RunItTwiceDiceResult | null>(null)
  const [diceIsTied, setDiceIsTied] = useState(false)
  const [dicePlayers, setDicePlayers] = useState<{ id: string; name: string }[]>([])
  const [runItTwiceBoard, setRunItTwiceBoard] = useState<Card[][]>([])
  const [runItTwiceResults, setRunItTwiceResults] = useState<RunItTwiceRoundResult[]>([])
  const [isAfk, setIsAfk] = useState(false)
  const [runItTwiceShowdownHands, setRunItTwiceShowdownHands] = useState<{ playerId: string; playerName: string; holeCards: Card[] }[]>([])
  const [runItTwiceAnimActive, setRunItTwiceAnimActive] = useState(false)
  const [runItTwiceAnimCards, setRunItTwiceAnimCards] = useState<Card[][]>([])
  const [runItTwiceAnimCountdown, setRunItTwiceAnimCountdown] = useState(0)
  const [runItTwiceAnimPhase, setRunItTwiceAnimPhase] = useState<'waiting' | 'dealing' | 'done'>('waiting')
  const [runItTwiceAnimExistingCount, setRunItTwiceAnimExistingCount] = useState(0)
  const [runItTwiceRoundResults, setRunItTwiceRoundResults] = useState<{
    roundIndex: number
    roundLabel: string
    winnerIds: string[]
    winAmount: number
    potAmount: number
    handRanks: Record<string, string>
    communityCards: Card[]
  }[]>([])

  const addLog = useCallback((playerName: string, action: string, amount?: number, phase?: string) => {
    setActionLogs(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      playerName,
      action,
      amount,
      phase: phase || '',
      timestamp: Date.now(),
    }])
  }, [])

  const clearLogStorage = useCallback(() => {
    try {
      localStorage.removeItem(`poker_logs_${roomId}`)
      localStorage.removeItem(`poker_results_${roomId}`)
    } catch {}
  }, [roomId])

  useEffect(() => {
    try { localStorage.setItem(`poker_logs_${roomId}`, JSON.stringify(actionLogs)) } catch {}
  }, [actionLogs, roomId])

  useEffect(() => {
    try { localStorage.setItem(`poker_results_${roomId}`, JSON.stringify(handResults)) } catch {}
  }, [handResults, roomId])

  useEffect(() => {
    if (voteCooldownUntil <= 0) {
      setVoteCooldownRemaining(0)
      return
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((voteCooldownUntil - Date.now()) / 1000))
      setVoteCooldownRemaining(remaining)
      if (remaining <= 0) {
        setVoteCooldownUntil(0)
      }
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [voteCooldownUntil])

  useEffect(() => {
    if (!showVoteModal || !voteInfo?.createdAt) {
      setVoteCountdown(15)
      return
    }
    const update = () => {
      const elapsed = (Date.now() - voteInfo.createdAt!) / 1000
      const remaining = Math.max(0, Math.ceil(15 - elapsed))
      setVoteCountdown(remaining)
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [showVoteModal, voteInfo?.createdAt])

  useEffect(() => {
    if (!runItTwiceAnimActive || runItTwiceAnimCountdown <= 0) return
    const timer = setInterval(() => {
      setRunItTwiceAnimCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [runItTwiceAnimActive, runItTwiceAnimCountdown])

  useEffect(() => {
    if (!roomId) return

    const handleGameStarted = (data: any) => {
      gameStartedDuringReadyRef.current = true
      setCurrentRoom(data.room)
      setGameState(data.gameState)
      setShowResult(false)
      setWinners(null)
      setMyCards(null)
      setShowRaiseSlider(false)
      setAllHands([])
      setShowRunItTwiceDialog(false)
      setRunItTwiceMyChoice(null)
      setRunItTwiceOtherChoice(null)
      setRunItTwiceOtherName('')
      setShowDiceDialog(false)
      setDiceReady({})
      setDiceResult(null)
      setDiceIsTied(false)
      setDicePlayers([])
      setRunItTwiceBoard([])
      setRunItTwiceResults([])
      setRunItTwiceShowdownHands([])
      setRunItTwiceAnimActive(false)
      setRunItTwiceAnimCards([[], []])
      setRunItTwiceAnimCountdown(0)
      setRunItTwiceAnimPhase('waiting')
      setRunItTwiceAnimExistingCount(0)
      setRunItTwiceRoundResults([])
      const meInRoom = data.room?.players?.find((p: any) => p.id === myPlayerId)
      setIsReady(meInRoom?.isReady || false)
      if (meInRoom?.isAfk !== undefined) setIsAfk(meInRoom.isAfk)
      setIsWaitingForStart(false)
      setMyHandStartChips(meInRoom?.chips ?? null)
      setActionLogs([])
      setShowCardsInfo(null)
      setShowedCardsPlayerIds(new Set())
      addLog('系统', 'deal', undefined, data.gameState?.phase || 'pre-flop')
    }

    const handleDealCards = (data: { handId: string; playerId: string; cards: [Card, Card] }) => {
      if (myPlayerId && data.playerId === myPlayerId) {
        setMyCards(data.cards)
      }
    }

    const handlePlayerTurn = (data: { playerId: string; validActions?: string[] }) => {
      setIsMyTurn(data.playerId === myPlayerId)
    }

    const handleActionResult = (data: any) => {
      setGameState(data.gameState)
      if (data.room) {
        setCurrentRoom(data.room)
        const player = data.room.players?.find((p: any) => p.id === myPlayerId)
        if (player) {
          setCurrentPlayer(player)
        }
      }
      const actorName = data.playerName || '玩家'
      addLog(actorName, data.action, data.amount, data.gameState?.phase)
      if (data.gameState?.currentPlayerId) {
        setIsMyTurn(data.gameState.currentPlayerId === myPlayerId)
      }
    }

    const handleHandResult = (data: any) => {
      if (data.gameState) {
        setGameState(data.gameState)
      }
      if (data.room) {
        setCurrentRoom(data.room)
        const player = data.room.players?.find((p: any) => p.id === myPlayerId)
        if (player) {
          setCurrentPlayer(player)
        }
      }
    }

    const handleChipsReceived = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
        const player = data.room.players.find((p: any) => p.id === myPlayerId)
        if (player) {
          setCurrentPlayer(player)
        }
      }
      if (data.playerId && data.amount) {
        const playerName = currentRoom?.players?.find((p: any) => p.id === data.playerId)?.name || '玩家'
        addLog(playerName, 'rebuy', data.amount)
        if (data.playerId !== myPlayerId) {
          addToast(`${playerName} 补充筹码 $${data.amount}`, 'info')
        }
      }
    }

    const handleGameOver = (data: any) => {
      setGameOverInfo({ winner: data.winner })
      setIsGameOver(true)
      if (data.room) {
        setCurrentRoom(data.room)
      }
    }

    const handleAfkStatusChanged = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
      }
      if (data.playerId === myPlayerId) {
        setIsAfk(data.isAfk)
      }
    }

    const handleRoomUpdated = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
        const me = data.room.players?.find((p: any) => p.id === myPlayerId)
        if (me) {
          setIsReady(me.isReady || false)
          if (me.isAfk !== undefined) setIsAfk(me.isAfk)
        }
      }
    }

    const handlePlayerLeft = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
      }
      if (data.playerId === myPlayerId) {
        addToast('你已被移出房间', 'error')
        clearLogStorage()
        clearSavedRoom()
        reset()
        navigate('/lobby')
        return
      }
      if (data.isTemporary && data.playerId) {
        const playerName = data.room?.players?.find((p: any) => p.id === data.playerId)?.name || '玩家'
        addToast(`${playerName} 连接中断，正在尝试重连...`, 'info')
      }
    }

    const handlePlayerJoined = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
      }
      if (data.player && data.player.id !== myPlayerId) {
        const prevPlayer = currentRoom?.players?.find((p: any) => p.id === data.player.id)
        if (prevPlayer && !prevPlayer.isOnline) {
          addToast(`${data.player.name} 已重新连接`, 'success')
        }
      }
    }

    const handlePlayerReadyChanged = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
        const me = data.room.players?.find((p: any) => p.id === myPlayerId)
        if (me) {
          setIsReady(me.isReady || false)
        }
      }
    }

    const handleRoomClosed = (data: any) => {
      addToast(data.reason || '房间已关闭', 'error')
      clearLogStorage()
      clearSavedRoom()
      reset()
      navigate('/lobby')
    }

    const handleVoteLeaveStarted = (data: any) => {
      setVoteInfo(data)
      setShowVoteModal(true)
    }

    const handleVoteLeaveResponseEvent = (data: any) => {
      setVoteInfo((prev: any) => prev ? {
        ...prev,
        votes: data.votes,
        votedPlayers: data.votedPlayers,
      } : null)
    }

    const handleVoteLeaveEnded = (data: any) => {
      setShowVoteModal(false)
      setVoteInfo(null)
      if (data.approved) {
        addToast('所有玩家同意离开，房间已解散', 'info')
        clearLogStorage()
        clearSavedRoom()
        reset()
        navigate('/lobby')
      } else {
        addToast(`投票未通过！${data.approvedCount}/${data.totalPlayers} 人同意`, 'error')
        if (data.initiatorId === myPlayerId) {
          setVoteCooldownUntil(Date.now() + 10000)
        }
      }
    }

    const handleVoteExtendHandsStarted = (data: any) => {
      setVoteExtendInfo(data)
      setShowVoteExtendModal(true)
    }

    const handleVoteExtendHandsResponseEvent = (data: any) => {
      setVoteExtendInfo((prev: any) => prev ? {
        ...prev,
        votes: data.votes,
        votedPlayers: data.votedPlayers,
      } : null)
    }

    const handleVoteExtendHandsEnded = (data: any) => {
      setShowVoteExtendModal(false)
      setVoteExtendInfo(null)
      if (data.approved) {
        addToast(`投票通过！局数增加${data.extendCount}局，当前固定${data.newFixedHands}局`, 'info')
      } else {
        addToast('加局投票未通过，房间已结束', 'error')
      }
    }

    const handleShowCardsResult = (data: any) => {
      setShowCardsInfo({
        playerId: data.playerId,
        playerName: data.playerName,
        holeCards: data.holeCards,
        communityCards: data.communityCards || [],
      })
      setShowedCardsPlayerIds(prev => {
        const next = new Set(prev)
        next.add(data.playerId)
        return next
      })
      if (data.holeCards && data.holeCards.length > 0) {
        const cardsStr = data.holeCards.map((c: Card) => `${c.rank}${c.suit}`).join(' ')
        setHandResults(prev => {
          if (prev.length === 0) return prev
          const lastResult = prev[prev.length - 1]
          const updatedPlayers = lastResult.players.map((p: any) => {
            if (p.playerId === data.playerId) {
              return { ...p, holeCards: cardsStr, showedCards: true }
            }
            return p
          })
          return [...prev.slice(0, -1), { ...lastResult, players: updatedPlayers }]
        })
      }
    }

    const handleActionLogSync = (data: any) => {
      if (data.actionLogs && data.actionLogs.length > 0) {
        setActionLogs(prev => {
          const existingIds = new Set(prev.map(l => l.id))
          const newLogs = data.actionLogs.filter((l: any) => !existingIds.has(l.id))
          if (newLogs.length === 0) return prev
          const mapped = newLogs.map((l: any) => ({
            id: l.id,
            playerName: l.playerName,
            action: l.action,
            amount: l.amount,
            phase: l.phase || '',
            timestamp: l.timestamp,
          }))
          return [...prev, ...mapped].sort((a, b) => a.timestamp - b.timestamp)
        })
      }
      if (data.handResults && data.handResults.length > 0) {
        setHandResults(prev => {
          const existingIds = new Set(prev.map(r => r.id))
          const newResults = data.handResults.filter((r: any) => !existingIds.has(r.id))
          if (newResults.length === 0) return prev
          return [...prev, ...newResults].sort((a, b) => a.timestamp - b.timestamp)
        })
      }
    }

    const handleRoomLeft = (data: any) => {
      if (data.reason === 'vote') {
        clearLogStorage()
        clearSavedRoom()
        reset()
        navigate('/lobby')
      }
    }

    const handleRunItTwiceAsk = (data: any) => {
      if (data.gameState) {
        setGameState(data.gameState)
      }
      const myStatus = myPlayerId ? data.gameState?.playerStatus?.[myPlayerId] : undefined
      if (myStatus === 'folded') {
        setShowRunItTwiceDialog(false)
        setShowDiceDialog(false)
        return
      }
      setShowRunItTwiceDialog(true)
      setRunItTwiceMyChoice(null)
      setRunItTwiceOtherChoice(null)
      setRunItTwiceOtherName('')
      setShowDiceDialog(false)
      setDiceResult(null)
      setDiceIsTied(false)
      setRunItTwiceBoard([])
      setRunItTwiceResults([])
    }

    const handleRunItTwiceChoiceResult = (data: any) => {
      if (data.gameState) {
        setGameState(data.gameState)
      }
      if (data.playerId === myPlayerId) {
        setRunItTwiceMyChoice(data.choice)
      } else {
        setRunItTwiceOtherChoice(data.choice)
        setRunItTwiceOtherName(data.playerName || '对手')
      }
    }

    const handleRunItTwiceDiceResult = (data: any) => {
      if (data.gameState) {
        setGameState(data.gameState)
      }
      const myStatus = myPlayerId ? data.gameState?.playerStatus?.[myPlayerId] : undefined
      if (myStatus === 'folded') {
        setShowDiceDialog(false)
        return
      }
      if (data.reroll) {
        setDiceResult(null)
        setDiceIsTied(false)
        setDiceReady({})
        if (data.players) {
          setDicePlayers(data.players)
        }
        return
      }
      if (data.needDice && data.players && !data.playerId) {
        setShowDiceDialog(true)
        setShowRunItTwiceDialog(false)
        setDicePlayers(data.players)
        setDiceReady({})
        setDiceResult(null)
        setDiceIsTied(false)
        return
      }
      if (data.playerId) {
        setDiceReady(prev => ({ ...prev, [data.playerId]: true }))
      }
      if (data.diceReady) {
        setDiceReady(data.diceReady)
      }
      if (data.bothReady && data.diceResult) {
        setDiceResult(data.diceResult)
        setDiceIsTied(data.isTied || false)
        if (!data.isTied) {
          setTimeout(() => {
            setShowDiceDialog(false)
          }, 5000)
        }
      }
    }

    const handleRunItTwiceExecuting = (data: any) => {
      if (data.gameState) {
        setGameState(data.gameState)
      }
      setShowRunItTwiceDialog(false)
      setShowDiceDialog(false)
    }

    const handleRunItTwiceShowdown = (data: any) => {
      setShowDiceDialog(false)
      setShowRunItTwiceDialog(false)
      if (data.allHands) {
        setRunItTwiceShowdownHands(data.allHands)
      }
      const existingCards: Card[] = data.communityCards || []
      setResultCommunityCards(existingCards)
      const existingCount = existingCards.length
      const rounds = data.rounds || 2
      setRunItTwiceAnimExistingCount(existingCount)
      setRunItTwiceAnimActive(true)
      const initialCards = Array.from({ length: rounds }, () => existingCount > 0 ? existingCards.slice() : [])
      setRunItTwiceAnimCards(initialCards)
      setRunItTwiceAnimPhase('waiting')
      setRunItTwiceAnimCountdown(5)
    }

    const handleRunItTwiceDealCard = (data: any) => {
      const { roundCards, countdown } = data
      setRunItTwiceAnimPhase('dealing')
      setRunItTwiceAnimCards(prev => {
        const newCards = prev.map(round => [...round])
        for (const rc of roundCards) {
          if (newCards[rc.roundIndex]) {
            newCards[rc.roundIndex].push(rc.card)
          }
        }
        return newCards
      })
      if (countdown > 0) {
        setTimeout(() => {
          setRunItTwiceAnimPhase('waiting')
          setRunItTwiceAnimCountdown(countdown)
        }, 800)
      } else {
        setRunItTwiceAnimPhase('done')
        setRunItTwiceAnimCountdown(0)
      }
    }

    const handleRunItTwiceRoundResult = (data: any) => {
      setRunItTwiceRoundResults(prev => [...prev, {
        roundIndex: data.roundIndex,
        roundLabel: data.roundLabel,
        winnerIds: data.winnerIds,
        winAmount: data.winAmount,
        potAmount: data.potAmount,
        handRanks: data.handRanks,
        communityCards: data.communityCards,
      }])
    }

    const handleShowdownWithRunItTwice = (data: any) => {
      setWinners(data.winners)
      if (data.allHands) {
        setAllHands(data.allHands)
      }
      if (data.communityCards) {
        setResultCommunityCards(data.communityCards)
      }
      if (data.runItTwiceBoard) {
        setRunItTwiceBoard(data.runItTwiceBoard)
      }
      if (data.runItTwiceResults) {
        setRunItTwiceResults(data.runItTwiceResults)
      }
      if (data.gameState) {
        setGameState(data.gameState)
      }
      if (data.room) {
        setCurrentRoom(data.room)
        const player = data.room.players?.find((p: any) => p.id === myPlayerId)
        if (player) {
          setCurrentPlayer(player)
        }
      }
      setShowRunItTwiceDialog(false)
      setShowDiceDialog(false)
      addLog('系统', 'showdown', undefined, 'showdown')
      for (const w of data.winners) {
        addLog(w.playerName, 'win', w.winAmount, 'showdown')
      }
      if (data.allHands && data.allHands.length > 0) {
        const communityStr = data.communityCards && data.communityCards.length > 0
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
            netWin: h.netWin,
            initialChips: h.initialChips,
            rebuyAmount: h.rebuyAmount,
            position: h.position,
          }
        })
        const isRunItTwice = !!(data.runItTwiceBoard && data.runItTwiceBoard.length > 0)
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
          communityCards: communityStr,
          timestamp: Date.now(),
          isRunItTwice,
          runItTwiceRounds,
        }])
      }

      const isRunItTwice = !!(data.runItTwiceBoard && data.runItTwiceBoard.length > 0)
      if (isRunItTwice) {
        setRunItTwiceAnimActive(false)
        setRunItTwiceAnimCountdown(0)
      }
      setShowResult(true)
    }

    on(ServerEvents.GAME_STARTED, handleGameStarted)
    on(ServerEvents.DEAL_CARDS, handleDealCards)
    on(ServerEvents.PLAYER_TURN, handlePlayerTurn)
    on(ServerEvents.ACTION_RESULT, handleActionResult)
    on(ServerEvents.SHOWDOWN, handleShowdownWithRunItTwice)
    on(ServerEvents.HAND_RESULT, handleHandResult)
    on(ServerEvents.CHIPS_RECEIVED, handleChipsReceived)
    on(ServerEvents.ROOM_UPDATED, handleRoomUpdated)
    on(ServerEvents.PLAYER_LEFT, handlePlayerLeft)
    on(ServerEvents.PLAYER_JOINED, handlePlayerJoined)
    on(ServerEvents.PLAYER_READY_CHANGED, handlePlayerReadyChanged)
    on(ServerEvents.ROOM_CLOSED, handleRoomClosed)
    on(ServerEvents.VOTE_LEAVE_STARTED, handleVoteLeaveStarted)
    on(ServerEvents.VOTE_LEAVE_RESPONSE, handleVoteLeaveResponseEvent)
    on(ServerEvents.VOTE_LEAVE_ENDED, handleVoteLeaveEnded)
    on(ServerEvents.VOTE_EXTEND_HANDS_STARTED, handleVoteExtendHandsStarted)
    on(ServerEvents.VOTE_EXTEND_HANDS_RESPONSE, handleVoteExtendHandsResponseEvent)
    on(ServerEvents.VOTE_EXTEND_HANDS_ENDED, handleVoteExtendHandsEnded)
    on(ServerEvents.ROOM_LEFT, handleRoomLeft)
    on(ServerEvents.RUN_IT_TWICE_ASK, handleRunItTwiceAsk)
    on(ServerEvents.RUN_IT_TWICE_CHOICE_RESULT, handleRunItTwiceChoiceResult)
    on(ServerEvents.RUN_IT_TWICE_DICE_RESULT, handleRunItTwiceDiceResult)
    on(ServerEvents.RUN_IT_TWICE_EXECUTING, handleRunItTwiceExecuting)
    on(ServerEvents.RUN_IT_TWICE_SHOWDOWN, handleRunItTwiceShowdown)
    on(ServerEvents.RUN_IT_TWICE_DEAL_CARD, handleRunItTwiceDealCard)
    on(ServerEvents.RUN_IT_TWICE_ROUND_RESULT, handleRunItTwiceRoundResult)
    on(ServerEvents.GAME_OVER, handleGameOver)
    on(ServerEvents.AFK_STATUS_CHANGED, handleAfkStatusChanged)
    on(ServerEvents.SHOW_CARDS_RESULT, handleShowCardsResult)
    on(ServerEvents.ACTION_LOG_SYNC, handleActionLogSync)

    fetchGameState()

    return () => {
      off(ServerEvents.GAME_STARTED, handleGameStarted)
      off(ServerEvents.DEAL_CARDS, handleDealCards)
      off(ServerEvents.PLAYER_TURN, handlePlayerTurn)
      off(ServerEvents.ACTION_RESULT, handleActionResult)
      off(ServerEvents.SHOWDOWN, handleShowdownWithRunItTwice)
      off(ServerEvents.HAND_RESULT, handleHandResult)
      off(ServerEvents.CHIPS_RECEIVED, handleChipsReceived)
      off(ServerEvents.ROOM_UPDATED, handleRoomUpdated)
      off(ServerEvents.PLAYER_LEFT, handlePlayerLeft)
      off(ServerEvents.PLAYER_JOINED, handlePlayerJoined)
      off(ServerEvents.PLAYER_READY_CHANGED, handlePlayerReadyChanged)
      off(ServerEvents.ROOM_CLOSED, handleRoomClosed)
      off(ServerEvents.VOTE_LEAVE_STARTED, handleVoteLeaveStarted)
      off(ServerEvents.VOTE_LEAVE_RESPONSE, handleVoteLeaveResponseEvent)
      off(ServerEvents.VOTE_LEAVE_ENDED, handleVoteLeaveEnded)
      off(ServerEvents.VOTE_EXTEND_HANDS_STARTED, handleVoteExtendHandsStarted)
      off(ServerEvents.VOTE_EXTEND_HANDS_RESPONSE, handleVoteExtendHandsResponseEvent)
      off(ServerEvents.VOTE_EXTEND_HANDS_ENDED, handleVoteExtendHandsEnded)
      off(ServerEvents.ROOM_LEFT, handleRoomLeft)
      off(ServerEvents.RUN_IT_TWICE_ASK, handleRunItTwiceAsk)
      off(ServerEvents.RUN_IT_TWICE_CHOICE_RESULT, handleRunItTwiceChoiceResult)
      off(ServerEvents.RUN_IT_TWICE_DICE_RESULT, handleRunItTwiceDiceResult)
      off(ServerEvents.RUN_IT_TWICE_EXECUTING, handleRunItTwiceExecuting)
      off(ServerEvents.RUN_IT_TWICE_SHOWDOWN, handleRunItTwiceShowdown)
      off(ServerEvents.RUN_IT_TWICE_DEAL_CARD, handleRunItTwiceDealCard)
      off(ServerEvents.RUN_IT_TWICE_ROUND_RESULT, handleRunItTwiceRoundResult)
      off(ServerEvents.GAME_OVER, handleGameOver)
      off(ServerEvents.AFK_STATUS_CHANGED, handleAfkStatusChanged)
      off(ServerEvents.SHOW_CARDS_RESULT, handleShowCardsResult)
      off(ServerEvents.ACTION_LOG_SYNC, handleActionLogSync)
    }
  }, [roomId, myPlayerId])

  useEffect(() => {
    if (isConnected && roomId) {
      fetchGameState()
    }
  }, [isConnected])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && roomId) {
        if (!isConnected) {
          const { socket } = useSocketStore.getState()
          if (socket && !socket.connected) {
            socket.connect()
          }
        } else {
          fetchGameState()
        }
      }
    }
    const handleOnline = () => {
      if (roomId) {
        const { socket, isConnected: connected } = useSocketStore.getState()
        if (!connected && socket && !socket.connected) {
          socket.connect()
        } else if (connected) {
          fetchGameState()
        }
      }
    }
    const handleOffline = () => {
      console.log('Network offline')
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [roomId, isConnected])

  const fetchGameState = async (retryCount = 0) => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`)
      if (!response.ok) {
        addToast('房间不存在或已关闭', 'error')
        clearLogStorage()
        clearSavedRoom()
        reset()
        navigate('/lobby')
        return
      }
      const data = await response.json()
      if (data.success && data.room) {
        setCurrentRoom(data.room)
        saveRoomId(roomId!, 'playing')
        if (myPlayerId) {
          const player = data.room.players.find((p: any) => p.id === myPlayerId)
          if (player) {
            setCurrentPlayer(player)
            setIsReady(player.isReady || false)
          } else {
            addToast('你已不在房间中', 'error')
            clearLogStorage()
            clearSavedRoom()
            reset()
            navigate('/lobby')
            return
          }
          if (data.room.gameState) {
            setGameState(data.room.gameState)
            if (data.room.gameState.currentPlayerId) {
              setIsMyTurn(data.room.gameState.currentPlayerId === myPlayerId)
            }
            const lastResult = data.room.gameState.lastShowdownResult
            if (lastResult && lastResult.winners && lastResult.allHands) {
              setWinners(lastResult.winners)
              setAllHands(lastResult.allHands)
              setResultCommunityCards(lastResult.communityCards || [])
              if (lastResult.runItTwiceBoard && lastResult.runItTwiceBoard.length > 0) {
                setRunItTwiceBoard(lastResult.runItTwiceBoard)
              }
              if (lastResult.runItTwiceResults && lastResult.runItTwiceResults.length > 0) {
                setRunItTwiceResults(lastResult.runItTwiceResults)
              }
              setShowResult(true)
            }
          } else {
            setIsWaitingForStart(true)
          }
        }
      } else {
        addToast('房间不存在或已关闭', 'error')
        clearLogStorage()
        clearSavedRoom()
        reset()
        navigate('/lobby')
      }
    } catch (error) {
      console.error('Failed to fetch game state:', error)
      if (retryCount < 8) {
        const delay = Math.min(2000 * Math.pow(1.5, retryCount), 15000)
        setTimeout(() => fetchGameState(retryCount + 1), delay)
      } else {
        addToast('无法连接服务器，请刷新页面重试', 'error')
      }
    }
  }

  const handleLeaveGame = async () => {
    const myPlayer = currentRoom?.players?.find((p: any) => p.id === myPlayerId)
    const role = myPlayer?.playerRoomRole
    const hasPlayed = myPlayer?.hasPlayedHand === true
    const isFinal = isGameOver || (
      currentRoom?.config?.fixedHands
      && currentRoom.config.fixedHands > 0
      && (currentRoom.handCount || 0) >= currentRoom.config.fixedHands
    )
    const needVote = hasPlayed
      && role !== 'spectator'
      && role !== 'busted'
      && !isFinal

    if (needVote) {
      try {
        const result = await emit(ClientEvents.VOTE_LEAVE)
        if (result?.directLeave) {
          clearLogStorage()
          clearSavedRoom()
          reset()
          navigate('/lobby')
        }
      } catch (error: any) {
        addToast(error.message || '发起投票失败', 'error')
      }
    } else {
      try {
        await emit(ClientEvents.LEAVE_ROOM)
        clearLogStorage()
        clearSavedRoom()
        reset()
        navigate('/lobby')
      } catch (error: any) {
        addToast(error.message || '离开失败', 'error')
      }
    }
  }

  const handleLowChipRebuy = async () => {
    if (isSubmitting) return
    if (maxRebuyReached) return
    setIsSubmitting(true)
    try {
      const result = await emit(ClientEvents.GET_CHIPS)
      if (result?.success) {
        addToast(`补充筹码 $${result.amount}`, 'success')
      } else {
        addToast(result?.error || '补筹码失败', 'error')
      }
    } catch (error: any) {
      addToast(error.message || '补筹码失败', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRebuy = async () => {
    if (isSubmitting) return
    if (maxRebuyReached) {
      addToast('补筹码次数已用完，将进入观战状态', 'info')
      await handleDeclineRebuy()
      return
    }
    setIsSubmitting(true)
    try {
      const result = await emit(ClientEvents.GET_CHIPS)
      if (result?.success) {
        const readyResult = await emit(ClientEvents.PLAYER_READY, true)
        if (readyResult?.success) {
          setIsReady(true)
        } else {
          setIsReady(false)
          addToast(readyResult?.error || '准备失败，请手动准备', 'info')
        }
        setShowResult(false)
        setIsWaitingForStart(true)
      } else {
        addToast(result?.error || '补筹码失败', 'error')
      }
    } catch (error: any) {
      addToast(error.message || '补筹码失败', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeclineRebuy = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await emit(ClientEvents.DECLINE_REBUY)
      if (result?.success) {
        setIsReady(false)
        setShowResult(false)
        setIsWaitingForStart(true)
      } else {
        addToast(result?.error || '操作失败', 'error')
      }
    } catch (error: any) {
      addToast(error.message || '操作失败', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVoteResponse = async (approve: boolean) => {
    try {
      await emit(ClientEvents.VOTE_LEAVE_RESPONSE, { approve })
    } catch (error: any) {
      addToast(error.message || '投票失败', 'error')
    }
  }

  const handleAfk = async () => {
    try {
      const newAfk = !isAfk
      const result = await emit(ClientEvents.AFK, { afk: newAfk })
      if (result?.success) {
        setIsAfk(newAfk)
      } else {
        addToast(result?.error || '设置AFK状态失败', 'error')
      }
    } catch (error: any) {
      addToast(error.message || '设置AFK状态失败', 'error')
    }
  }

  const handleReady = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    gameStartedDuringReadyRef.current = false
    try {
      const result = await emit(ClientEvents.PLAYER_READY, true)
      if (result?.success) {
        if (gameStartedDuringReadyRef.current) {
          setIsReady(false)
          setIsWaitingForStart(false)
        } else {
          setIsReady(true)
          setShowResult(false)
          setIsMyTurn(false)
          setRunItTwiceAnimActive(false)
          setRunItTwiceAnimCards([[], []])
          setRunItTwiceAnimCountdown(0)
          setRunItTwiceAnimPhase('waiting')
          setRunItTwiceAnimExistingCount(0)
          setRunItTwiceRoundResults([])
          setRunItTwiceShowdownHands([])
          if (!gameState || gameState.phase === 'waiting' || gameState.phase === 'showdown' || gameState.phase === 'ended') {
            setIsWaitingForStart(true)
          }
        }
      }
    } catch (error: any) {
      setMessage(error.message || '准备失败')
      setTimeout(() => setMessage(''), 3000)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelReady = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await emit(ClientEvents.PLAYER_READY, false)
      if (result?.success) {
        setIsReady(false)
      }
    } catch (error: any) {
      setMessage(error.message || '取消准备失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAction = async (action: string, amount?: number) => {
    setIsMyTurn(false)
    setShowRaiseSlider(false)
    try {
      let finalAmount = amount
      if (action === 'raise' && amount !== undefined && variantRule.isPotLimit) {
        finalAmount = Math.min(amount, potLimitMaxRaise)
      }
      await emit(ClientEvents.PLAYER_ACTION, { action, amount: finalAmount })
    } catch (error: any) {
      if (gameState?.currentPlayerId === myPlayerId) {
        setIsMyTurn(true)
      }
      setMessage(error.message || '操作失败')
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const handleRunItTwiceChoice = async (choice: RunItTwiceChoice) => {
    try {
      setRunItTwiceMyChoice(choice)
      setShowRunItTwiceDialog(false)
      await emit(ClientEvents.RUN_IT_TWICE_CHOICE, { choice })
    } catch (error: any) {
      setMessage(error.message || '选择失败')
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const handleRollDice = async () => {
    try {
      await emit(ClientEvents.RUN_IT_TWICE_ROLL_DICE, {})
    } catch (error: any) {
      setMessage(error.message || '掷骰子失败')
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const renderCard = (card: Card | null | undefined, small?: boolean) => {
    const w = small ? 'w-8 h-12' : 'w-14 h-20'
    const fontSize = small ? 'text-xs' : 'text-base'
    const suitSize = small ? 'text-sm' : 'text-xl'
    if (!card) return <div className={`${w} bg-white/10 rounded border border-white/20`} />
    const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
    return (
      <div className={`${w} bg-white rounded-lg border-2 border-gray-300 flex flex-col items-center justify-center shadow-md ${isRed ? 'text-red-600' : 'text-black'}`}>
        <span className={`font-bold ${fontSize} leading-tight`}>{card.rank}</span>
        <span className={`${suitSize} leading-tight`}>{suitSymbol[card.suit]}</span>
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
      'run-it-twice-choice': '跑马选择',
      'run-it-twice-dice': '掷骰子',
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

  const getPlayerPositions = (total: number) => {
    const positions = [
      { x: 50, y: 88 },
      { x: 10, y: 42 },
      { x: 25, y: 8 },
      { x: 75, y: 8 },
      { x: 90, y: 42 },
      { x: 50, y: 8 },
      { x: 6, y: 22 },
      { x: 94, y: 22 },
      { x: 6, y: 58 },
      { x: 94, y: 58 },
      { x: 28, y: 88 },
      { x: 72, y: 88 },
    ]
    return positions.slice(0, total)
  }

  const isInVoteCooldown = voteCooldownRemaining > 0
  const myPlayer = currentRoom?.players?.find((p: any) => p.id === myPlayerId)
  const myPlayerRole = myPlayer?.playerRoomRole
  const isBusted = myPlayerRole === 'busted'
  const isSpectatorFromBust = myPlayerRole === 'spectator'

  useEffect(() => {
    if (isBusted && rebuyCountdown === 0) {
      setRebuyCountdown(15)
      if (rebuyCountdownRef.current) clearInterval(rebuyCountdownRef.current)
      rebuyCountdownRef.current = setInterval(() => {
        setRebuyCountdown(prev => {
          if (prev <= 1) {
            if (rebuyCountdownRef.current) clearInterval(rebuyCountdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    if (!isBusted && rebuyCountdown > 0) {
      setRebuyCountdown(0)
      if (rebuyCountdownRef.current) clearInterval(rebuyCountdownRef.current)
    }
  }, [isBusted])
  const isAfkSpectator = isAfk && (myPlayerRole === 'active' || myPlayerRole === 'seated' || myPlayerRole === 'busted')
  const showRebuyButton = isBusted && !isAfk
  const myRebuyCount = (currentRoom?.playerRebuyCounts && myPlayerId) ? (currentRoom.playerRebuyCounts[myPlayerId] || 0) : 0
  const maxRebuyReached = currentRoom?.config.maxRebuyCount !== undefined && currentRoom.config.maxRebuyCount >= 0 && myRebuyCount >= currentRoom.config.maxRebuyCount
  const isFinalSettlement = isGameOver || (
    currentRoom?.config?.fixedHands
    && currentRoom.config.fixedHands > 0
    && (currentRoom.handCount || 0) >= currentRoom.config.fixedHands
  )
  const myPlayerNeedVote = myPlayer?.hasPlayedHand === true
    && myPlayerRole !== 'spectator'
    && myPlayerRole !== 'busted'
    && !isFinalSettlement

  if (!currentRoom) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-green-900 to-green-950 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">加载游戏...</div>
      </div>
    )
  }

  if (!gameState) {
    return (
      <div className="h-[100dvh] bg-gradient-to-br from-green-900 to-green-950 select-none overflow-hidden">
        <div className="h-full flex flex-col md:flex-row">
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex justify-between items-center px-4 py-2 bg-black/30">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">{currentRoom.config.roomName}</h1>
                {currentRoom.config.fixedHands && currentRoom.config.fixedHands > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gold/20 text-gold font-medium">
                    {currentRoom.handCount || 0}/{currentRoom.config.fixedHands}局
                  </span>
                )}
                <span className="text-sm text-white/60">
                  {VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].icon}
                  {VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].name}
                  {currentRoom.config.gameModifier && currentRoom.config.gameModifier !== GameModifier.NONE && (
                    <span className="text-red-400">
                      +{MODIFIER_INFO[currentRoom.config.gameModifier].icon}{MODIFIER_INFO[currentRoom.config.gameModifier].name}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => setShowRuleHelp(true)}
                  className="text-white/40 hover:text-gold"
                  title="查看规则"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={isInVoteCooldown ? undefined : handleLeaveGame}
                  disabled={isInVoteCooldown}
                  className={`px-3 py-1 text-white rounded text-sm ${isInVoteCooldown ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-600 hover:bg-gray-700'}`}
                >
                  {isInVoteCooldown ? `冷却中 ${voteCooldownRemaining}s` : (myPlayerNeedVote ? '投票离开' : '离开')}
                </button>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-white text-2xl font-bold mb-4">等待玩家准备</div>
                <div className="text-white/60 text-sm mb-4">所有人准备好后自动开局</div>
                <div className="space-y-2 mb-6">
                  {currentRoom.players.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2 text-lg justify-center">
                      <span className={p.isReady ? 'text-green-400' : 'text-white/40'}>{p.isReady ? '✅' : '⏳'}</span>
                      <span className="text-white">{p.name}{p.id === myPlayerId ? '(你)' : ''}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 justify-center">
                  {currentRoom.config.fixedHands && currentRoom.config.fixedHands > 0 && (currentRoom.handCount || 0) >= currentRoom.config.fixedHands ? (
                    <button
                      onClick={async () => {
                        const result = await emit(ClientEvents.VOTE_EXTEND_HANDS)
                        if (!result?.success) {
                          addToast(result?.error || '发起投票失败', 'error')
                        }
                      }}
                      disabled={isSubmitting}
                      className={`px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      🎯 投票加10局
                    </button>
                  ) : !isReady ? (
                    <button
                      onClick={handleReady}
                      disabled={isSubmitting}
                      className={`px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      准备
                    </button>
                  ) : (
                    <button
                      onClick={handleCancelReady}
                      disabled={isSubmitting}
                      className={`px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      取消准备
                    </button>
                  )}
                  <button
                    onClick={isInVoteCooldown ? undefined : handleLeaveGame}
                    disabled={isInVoteCooldown}
                    className={`px-6 py-3 text-white rounded-lg font-bold text-lg ${isInVoteCooldown ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-red-700 hover:bg-red-800'}`}
                  >
                    {isInVoteCooldown ? `冷却中 ${voteCooldownRemaining}s` : (myPlayerNeedVote ? '投票离开' : '离开')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden md:block w-64 flex-shrink-0">
            <ChatBox />
          </div>
          {showMobileChat && (
            <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setShowMobileChat(false)}>
              <div className="absolute right-0 top-0 bottom-0 w-72" onClick={e => e.stopPropagation()}>
                <ChatBox />
              </div>
            </div>
          )}
        </div>
        {!showMobileChat && (
          <button
            onClick={() => setShowMobileChat(true)}
            className="md:hidden fixed right-2 bottom-20 z-30 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-700 active:scale-95"
          >
            💬
          </button>
        )}
      </div>
    )
  }

  const players = currentRoom.players
  const myBet = gameState.roundBets?.[myPlayerId || ''] || 0
  const toCall = (gameState.currentBet || 0) - myBet
  const myChips = currentPlayer?.chips || 0
  const minRaise = gameState.minRaise || currentRoom.config.bigBlind
  const totalPot = gameState.totalPot || 0
  const variantRule = VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE]
  const potLimitMaxRaise = variantRule.isPotLimit
    ? totalPot + toCall + (gameState.currentBet || 0)
    : myChips
  const maxRaise = variantRule.isPotLimit
    ? Math.min(myChips, potLimitMaxRaise)
    : myChips

  const activePlayers = players
  const amIInCurrentGame = myPlayerId ? gameState.playerStatus?.[myPlayerId] !== undefined : false

  const reorderedPlayers = (() => {
    const myIndex = activePlayers.findIndex(p => p.id === myPlayerId)
    if (myIndex < 0) return activePlayers
    const before = activePlayers.slice(0, myIndex)
    const after = activePlayers.slice(myIndex + 1)
    return [activePlayers[myIndex], ...after, ...before]
  })()

  const positions = getPlayerPositions(reorderedPlayers.length)
  const initialChips = currentRoom.config.buyInMin

  return (
    <div className="h-[100dvh] bg-gradient-to-br from-green-900 to-green-950 select-none overflow-hidden">
      {showVoteModal && voteInfo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md p-6">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">
              离开房间投票
            </h2>
            <p className="text-white/80 text-center mb-4">
              <span className="text-yellow-400 font-bold">{voteInfo.initiatorName}</span> 发起离开投票
            </p>
            {voteCountdown > 0 && (
              <p className="text-orange-400 text-center mb-4 font-bold text-lg">
                ⏱ {voteCountdown}秒后未投票将自动同意
              </p>
            )}

            <div className="mb-6">
              <p className="text-white/60 text-sm mb-3">投票进度: {voteInfo.votedPlayers}/{voteInfo.totalPlayers}</p>
              <div className="space-y-2">
                {currentRoom.players.map((player: any) => {
                  const vote = voteInfo.votes[player.id]
                  return (
                    <div key={player.id} className="flex justify-between items-center text-white/80">
                      <span>
                        {player.name}
                        {player.id === myPlayerId && ' (我)'}
                        {player.id === voteInfo.initiatorId && ' [发起者]'}
                      </span>
                      {vote === true && <span className="text-green-400">✓ 同意</span>}
                      {vote === false && <span className="text-red-400">✗ 拒绝</span>}
                      {vote === undefined && <span className="text-white/40">等待中{voteCountdown > 0 ? ` (${voteCountdown}s)` : '...'}</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {voteInfo.votes[myPlayerId || ''] === undefined && (
              <div className="flex gap-3">
                <button
                  onClick={() => handleVoteResponse(true)}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold transition-colors"
                >
                  ✓ 同意离开
                </button>
                <button
                  onClick={() => handleVoteResponse(false)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold transition-colors"
                >
                  ✗ 拒绝离开
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showVoteExtendModal && voteExtendInfo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md p-6">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">
              🎯 投票加局
            </h2>
            <p className="text-white/80 text-center mb-4">
              <span className="text-yellow-400 font-bold">{voteExtendInfo.initiatorName}</span> 发起增加 <span className="text-gold font-bold">{voteExtendInfo.extendCount}</span> 局投票
            </p>

            <div className="mb-6">
              <p className="text-white/60 text-sm mb-3">投票进度: {voteExtendInfo.votedPlayers}/{voteExtendInfo.totalPlayers}（至少2人同意）</p>
              <div className="space-y-2">
                {currentRoom.players.map((player: any) => {
                  const vote = voteExtendInfo.votes[player.id]
                  return (
                    <div key={player.id} className="flex justify-between items-center text-white/80">
                      <span>
                        {player.name}
                        {player.id === myPlayerId && ' (我)'}
                        {player.id === voteExtendInfo.initiatorId && ' [发起者]'}
                      </span>
                      {vote === true && <span className="text-green-400">✓ 同意</span>}
                      {vote === false && <span className="text-red-400">✗ 拒绝</span>}
                      {vote === undefined && <span className="text-white/40">等待中...</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {voteExtendInfo.votes[myPlayerId || ''] === undefined && (
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const result = await emit(ClientEvents.VOTE_EXTEND_HANDS_RESPONSE, { approve: true })
                    if (!result?.success) {
                      addToast(result?.error || '投票失败', 'error')
                    }
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold transition-colors"
                >
                  ✓ 同意加局
                </button>
                <button
                  onClick={async () => {
                    const result = await emit(ClientEvents.VOTE_EXTEND_HANDS_RESPONSE, { approve: false })
                    if (!result?.success) {
                      addToast(result?.error || '投票失败', 'error')
                    }
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold transition-colors"
                >
                  ✗ 拒绝加局
                </button>
              </div>
            )}
            {voteExtendInfo.votes[myPlayerId || ''] === false && (
              <p className="text-center text-red-400 text-sm">你已拒绝加局，可以离开房间或以观战身份继续</p>
            )}
            {voteExtendInfo.votes[myPlayerId || ''] === true && (
              <p className="text-center text-green-400 text-sm">你已同意加局，等待其他玩家投票...</p>
            )}
          </div>
        </div>
      )}

      {showCardsInfo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-black/80 backdrop-blur-md rounded-xl px-6 py-4 md:px-8 md:py-6 border border-purple-500/40 shadow-2xl max-w-md w-full">
            <div className="text-center mb-4">
              <span className="text-purple-300 font-bold text-lg md:text-xl">🃏 秀牌</span>
            </div>

            <div className="text-center mb-3">
              <span className="text-white/80 text-sm md:text-base">
                <span className="text-yellow-400 font-bold">{showCardsInfo.playerName}</span> 的手牌
              </span>
            </div>

            <div className="flex justify-center gap-2 md:gap-3 mb-4">
              {showCardsInfo.holeCards.map((card, ci) => {
                const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                return (
                  <div key={ci} className={`w-14 h-20 md:w-20 md:h-28 bg-white rounded-lg border-2 border-gray-300 flex flex-col items-center justify-center shadow-lg ${isRed ? 'text-red-600' : 'text-black'}`}>
                    <span className="font-bold text-lg md:text-2xl">{card.rank}</span>
                    <span className="text-xl md:text-3xl">{suitSymbol[card.suit]}</span>
                  </div>
                )
              })}
            </div>

            {showCardsInfo.communityCards.length > 0 && (
              <>
                <div className="text-center mb-2">
                  <span className="text-white/50 text-xs md:text-sm">公共牌</span>
                </div>
                <div className="flex items-center justify-center gap-1 mb-4">
                  {showCardsInfo.communityCards.slice(0, 3).map((card, i) => {
                    const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                    const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                    return (
                      <div key={i} className={`w-10 h-14 md:w-12 md:h-16 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                        <span className="font-bold text-xs md:text-sm">{card.rank}</span>
                        <span className="text-sm md:text-base">{suitSymbol[card.suit]}</span>
                      </div>
                    )
                  })}
                  {showCardsInfo.communityCards.length > 3 && <span className="text-white/30 mx-0.5 md:mx-1">|</span>}
                  {showCardsInfo.communityCards.length > 3 && showCardsInfo.communityCards.slice(3, 4).map((card, i) => {
                    const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                    const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                    return (
                      <div key={i + 3} className={`w-10 h-14 md:w-12 md:h-16 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                        <span className="font-bold text-xs md:text-sm">{card.rank}</span>
                        <span className="text-sm md:text-base">{suitSymbol[card.suit]}</span>
                      </div>
                    )
                  })}
                  {showCardsInfo.communityCards.length > 4 && <span className="text-white/30 mx-0.5 md:mx-1">|</span>}
                  {showCardsInfo.communityCards.length > 4 && showCardsInfo.communityCards.slice(4, 5).map((card, i) => {
                    const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                    const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                    return (
                      <div key={i + 4} className={`w-10 h-14 md:w-12 md:h-16 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                        <span className="font-bold text-xs md:text-sm">{card.rank}</span>
                        <span className="text-sm md:text-base">{suitSymbol[card.suit]}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div className="flex justify-center">
              <button
                onClick={() => setShowCardsInfo(null)}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-sm md:text-base"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-full flex flex-col">
        {isReconnecting && (
          <div className="bg-red-600 text-white text-center py-2 text-sm font-bold animate-pulse">
            ⚠ 连接断开，正在尝试重新连接...
          </div>
        )}
        {!isConnected && !isReconnecting && (
          <div className="bg-red-800 text-white text-center py-3 text-sm font-bold">
            ❌ 连接已断开，请刷新页面重新进入游戏
          </div>
        )}
        <div className="flex justify-between items-center px-2 md:px-4 py-1 md:py-2 bg-black/30">
          <div className="flex items-center gap-1 md:gap-2 min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-bold text-white truncate">{currentRoom.config.roomName}</h1>
            {currentRoom.config.fixedHands && currentRoom.config.fixedHands > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gold/20 text-gold font-medium whitespace-nowrap">
                {currentRoom.handCount || 0}/{currentRoom.config.fixedHands}局
              </span>
            )}
            <span className="text-xs md:text-sm text-white/60 whitespace-nowrap">
              {VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].icon}
              {VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].name}
              {currentRoom.config.gameModifier && currentRoom.config.gameModifier !== GameModifier.NONE && (
                <span className="text-red-400">
                  +{MODIFIER_INFO[currentRoom.config.gameModifier].icon}{MODIFIER_INFO[currentRoom.config.gameModifier].name}
                </span>
              )}
            </span>
            <span className="hidden md:inline text-white/40 text-xs truncate">
              {VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].shortDesc}
            </span>
            <button
              onClick={() => setShowRuleHelp(true)}
              className="text-white/40 hover:text-yellow-400 flex-shrink-0"
              title="查看规则"
            >
              <HelpCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>
          </div>
          <div className="flex gap-1 md:gap-2 flex-shrink-0">
            {isAfk ? (
              <button
                onClick={handleAfk}
                className="px-2 md:px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs md:text-sm font-bold"
              >
                🔄回来
              </button>
            ) : (
              <button
                onClick={handleAfk}
                className="px-2 md:px-3 py-1 bg-gray-600 text-white/70 rounded hover:bg-gray-500 text-xs md:text-sm"
              >
                ☕AFK
              </button>
            )}
            <button
              onClick={() => setShowActionLog(!showActionLog)}
              className={`px-2 md:px-3 py-1 ${showActionLog ? 'bg-blue-500' : 'bg-blue-600'} text-white rounded hover:bg-blue-700 text-xs md:text-sm`}
            >
              📋日志
            </button>
            <button
              onClick={() => setShowScoreboard(!showScoreboard)}
              className="px-2 md:px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-xs md:text-sm"
            >
              记分牌
            </button>
            <button
              onClick={isInVoteCooldown ? undefined : handleLeaveGame}
              disabled={isInVoteCooldown}
              className={`px-2 md:px-3 py-1 text-white rounded text-xs md:text-sm ${isInVoteCooldown ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-600 hover:bg-gray-700'}`}
            >
              {isInVoteCooldown ? `冷却${voteCooldownRemaining}s` : (myPlayerNeedVote ? '投票离开' : '离开')}
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden relative">
          {showActionLog && (
            <div className="hidden md:block w-56 flex-shrink-0">
              <ActionLog logs={actionLogs} handResults={handResults} />
            </div>
          )}
          {showActionLog && (
            <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setShowActionLog(false)}>
              <div className="absolute left-0 top-0 bottom-0 w-72" onClick={e => e.stopPropagation()}>
                <ActionLog logs={actionLogs} handResults={handResults} />
              </div>
            </div>
          )}
          <div className="flex-1 relative">
          <div className="absolute inset-0 flex items-center justify-center p-1 md:p-4">
            <div className="relative" style={{ aspectRatio: '16/10', maxWidth: '48rem', maxHeight: '100%', width: '100%', height: 'auto' }}>
              <div className="absolute inset-[8%] bg-green-800/80 rounded-[50%] border-8 border-green-700 shadow-2xl">
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="bg-black/40 rounded-lg px-3 py-1.5 md:px-5 md:py-2.5 backdrop-blur-sm border border-white/10 mb-1 md:mb-2">
                    <div className="flex items-center justify-center gap-2 md:gap-4">
                      <div className="flex flex-col items-center">
                        <span className="text-white/50 text-[8px] md:text-[10px]">阶段</span>
                        <span className="text-yellow-300 font-bold text-xs md:text-sm">{getPhaseName(gameState.phase)}</span>
                      </div>
                      <div className="w-px h-6 md:h-8 bg-white/20" />
                      <div className="flex flex-col items-center">
                        <span className="text-white/50 text-[8px] md:text-[10px]">底池</span>
                        <span className="text-white font-bold text-sm md:text-lg">${totalPot}</span>
                      </div>
                      {(gameState.currentBet || 0) > 0 && (
                        <>
                          <div className="w-px h-6 md:h-8 bg-white/20" />
                          <div className="flex flex-col items-center">
                            <span className="text-white/50 text-[8px] md:text-[10px]">当前注</span>
                            <span className="text-orange-300 font-bold text-xs md:text-sm">${gameState.currentBet}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {(() => {
                    const boardCount = variantRule.boardCount || 1
                    const boardCards = gameState.boardCards
                    const isMultiBoard = boardCount > 1 && boardCards && boardCards.length > 0
                    const boardLabels = ['A板', 'B板', 'C板']
                    if (isMultiBoard) {
                      return (
                        <div className="space-y-1 mb-1 md:mb-2">
                          {boardCards.map((board, bi) => (
                            <div key={bi} className="flex flex-col items-center">
                              <div className="text-white/40 text-[8px] md:text-[10px] mb-0.5">{boardLabels[bi]}</div>
                              <div className="flex gap-0.5 md:gap-1">
                                {[0, 1, 2, 3, 4].map(i => (
                                  <div key={i}>
                                    {i < board.length
                                      ? renderCard(board[i])
                                      : <div className="w-6 h-9 md:w-10 md:h-14 border border-dashed border-green-500/20 rounded" />
                                    }
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    }
                    return (
                      <div className="flex gap-1 md:gap-1.5 mb-1 md:mb-2">
                        {[0, 1, 2, 3, 4].map(i => (
                          <div key={i} className="md:hidden">
                            {i < (gameState.communityCards?.length || 0)
                              ? renderCard(gameState.communityCards[i], true)
                              : <div className="w-8 h-12 border-2 border-dashed border-green-500/30 rounded-lg" />
                            }
                          </div>
                        ))}
                        {[0, 1, 2, 3, 4].map(i => (
                          <div key={`md-${i}`} className="hidden md:block">
                            {i < (gameState.communityCards?.length || 0)
                              ? renderCard(gameState.communityCards[i])
                              : <div className="w-14 h-20 border-2 border-dashed border-green-500/30 rounded-lg" />
                            }
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {reorderedPlayers.map((player, idx) => {
                const pos = positions[idx]
                const isMe = player.id === myPlayerId
                const isCurrentTurn = player.id === gameState.currentPlayerId
                const status = gameState.playerStatus?.[player.id]
                const role = gameState.playerRoles?.[player.id]
                const totalBet = gameState.totalBets?.[player.id] || 0
                const isFolded = status === 'folded'
                const isAllIn = status === 'all-in'
                const isInGame = status !== undefined
                const playerRole = player.playerRoomRole
                const isBustedPlayer = playerRole === 'busted'
                const isSpectatorPlayer = playerRole === 'spectator'
                const isAfkPlayer = player.isAfk

                return (
                  <div
                    key={player.id}
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${
                      isCurrentTurn && !isFolded && isInGame ? 'scale-105 md:scale-110' : ''
                    } ${isFolded ? 'opacity-40' : ''} ${!isInGame ? 'opacity-50' : ''}`}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    <div className="flex flex-col items-center">
                      <div className="bg-black/40 backdrop-blur-sm rounded-lg px-1.5 py-1 md:px-2 md:py-1.5 border border-white/10">
                        <div className="flex items-center gap-1 md:gap-1.5">
                          <div className={`relative ${isCurrentTurn && !isFolded && isInGame ? 'ring-2 ring-yellow-400 rounded-full' : ''}`}>
                            <div className={`w-8 h-8 md:w-12 md:h-12 rounded-full flex items-center justify-center text-white font-bold text-xs md:text-sm ${
                              isMe ? 'bg-green-600' : isSpectatorPlayer ? 'bg-gray-500' : 'bg-gray-600'
                            }`}>
                              {player.name[0]}
                            </div>
                            {role && getRoleName(role) && (
                              <div className="absolute -top-1 -left-1 w-4 h-4 md:w-5 md:h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[8px] md:text-[10px] font-bold">
                                {getRoleName(role)}
                              </div>
                            )}
                            {isAllIn && (
                              <div className="absolute -top-1 -right-1 bg-red-600 text-white text-[6px] md:text-[8px] px-0.5 md:px-1 rounded-full font-bold">
                                ALL IN
                              </div>
                            )}
                            {isAfkPlayer && isInGame && (
                              <div className="absolute -top-1 -right-1 bg-orange-600 text-white text-[6px] md:text-[8px] px-0.5 md:px-1 rounded-full font-bold">
                                AFK
                              </div>
                            )}
                            {isWaitingForStart && player.isReady && (
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-green-500 text-white rounded-full flex items-center justify-center text-[8px] md:text-[10px] font-bold shadow">
                                ✓
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="text-white text-[9px] md:text-[11px] font-bold truncate max-w-[50px] md:max-w-[70px]">
                              {player.name}{isMe ? '(你)' : ''}
                            </div>
                            {!player.isOnline ? (
                              <div className="text-orange-400 text-[8px] md:text-[10px] font-bold">⚡断线</div>
                            ) : isBustedPlayer ? (
                              <div className="text-red-400 text-[8px] md:text-[10px] font-bold">💸破产</div>
                            ) : isSpectatorPlayer ? (
                              <div className="text-gray-400 text-[8px] md:text-[10px] font-bold">👁️观战</div>
                            ) : isAfkPlayer && !isInGame ? (
                              <div className="text-orange-400 text-[8px] md:text-[10px] font-bold">☕AFK</div>
                            ) : (
                              <div className="text-yellow-300 text-[9px] md:text-[11px] font-bold">${player.chips}</div>
                            )}
                            {isMe && !isBustedPlayer && !isSpectatorPlayer && player.isOnline && !isAfkPlayer && currentRoom?.config?.buyInMin && myHandStartChips !== null && myHandStartChips < currentRoom.config.buyInMin * 0.2 && player.chips < currentRoom.config.buyInMin * 0.2 && !maxRebuyReached && gameState.phase !== 'waiting' && (
                              <button
                                onClick={handleLowChipRebuy}
                                disabled={isSubmitting}
                                className={`text-[7px] md:text-[9px] font-bold px-1 md:px-1.5 py-0.5 rounded bg-green-600 hover:bg-green-700 text-white mt-0.5 ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                +补码
                              </button>
                            )}
                            {isInGame && totalBet > 0 && (
                              <div className="text-yellow-200 text-[8px] md:text-[10px] font-bold bg-yellow-600/30 px-1 rounded">
                                本局 ${totalBet}
                              </div>
                            )}
                            {isInGame && isFolded && <div className="text-red-400 text-[8px] md:text-[10px]">弃牌</div>}
                            {isInGame && !isFolded && !isCurrentTurn && player.isOnline && !isMe && !isAllIn && !isAfkPlayer && (
                              <div className="text-green-400/70 text-[7px] md:text-[9px]">在线</div>
                            )}
                            {isInGame && isAfkPlayer && !isCurrentTurn && (
                              <div className="text-orange-400/70 text-[7px] md:text-[9px]">🤖托管</div>
                            )}
                            {isInGame && isCurrentTurn && !isFolded && !isMe && !isAfkPlayer && (
                              <div className="text-yellow-400 text-[8px] md:text-[10px] animate-pulse">思考中</div>
                            )}
                            {isInGame && isCurrentTurn && !isFolded && isAfkPlayer && (
                              <div className="text-orange-400 text-[8px] md:text-[10px] animate-pulse">🤖托管中</div>
                            )}
                          </div>
                        </div>
                      </div>
                      {isMe && myCards && (
                        <div className="flex gap-0.5 md:gap-1 mt-0.5 md:mt-1">
                          {myCards.map((card, ci) => {
                            const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                            const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                            return (
                              <div key={ci} className={`w-8 h-12 md:w-14 md:h-20 bg-white rounded-lg border-2 border-gray-300 flex flex-col items-center justify-center shadow-md ${isRed ? 'text-red-600' : 'text-black'}`}>
                                <span className="font-bold text-xs md:text-base leading-tight">{card.rank}</span>
                                <span className="text-sm md:text-xl leading-tight">{suitSymbol[card.suit]}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {!isMe && (status === 'playing' || status === 'all-in') && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && !runItTwiceAnimActive && (
                        <div className="flex gap-0.5 md:gap-1 mt-0.5 md:mt-1">
                          {Array.from({ length: VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].holeCardCount }).map((_, ci) => (
                            <div key={ci} className="w-6 h-9 md:w-10 md:h-14 bg-gradient-to-br from-blue-700 to-blue-900 rounded-lg border border-blue-400 flex items-center justify-center shadow-md">
                              <span className="text-blue-300 text-[8px] md:text-sm">?</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {!isMe && runItTwiceAnimActive && (() => {
                        const handInfo = runItTwiceShowdownHands.find(h => h.playerId === player.id)
                        if (handInfo && handInfo.holeCards && handInfo.holeCards.length > 0) {
                          return (
                            <div className="flex gap-0.5 md:gap-1 mt-0.5 md:mt-1">
                              {handInfo.holeCards.map((card, ci) => {
                                const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                                const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                                return (
                                  <div key={ci} className={`w-6 h-9 md:w-10 md:h-14 bg-white rounded-lg border border-gray-300 flex flex-col items-center justify-center shadow-md ${isRed ? 'text-red-600' : 'text-black'}`}>
                                    <span className="font-bold text-[8px] md:text-xs leading-tight">{card.rank}</span>
                                    <span className="text-[10px] md:text-sm leading-tight">{suitSymbol[card.suit]}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        }
                        return null
                      })()}
                      {!isMe && !runItTwiceAnimActive && (gameState.phase === 'showdown' || gameState.phase === 'ended') && status !== 'folded' && isInGame && (
                        <div className="text-white/40 text-[7px] md:text-[9px] mt-0.5">已摊牌</div>
                      )}
                    </div>
                  </div>
                )
              })}
              {runItTwiceAnimActive && runItTwiceAnimCards.length >= 1 && (() => {
                const existingCount = runItTwiceAnimExistingCount
                const showdownHands = runItTwiceShowdownHands
                const roundResults = runItTwiceRoundResults
                const isMultiRound = runItTwiceAnimCards.length > 1
                return (
                  <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/70 backdrop-blur-md rounded-xl px-4 py-3 md:px-6 md:py-4 border border-yellow-500/40 shadow-2xl pointer-events-auto max-w-[95vw] max-h-[90vh] overflow-y-auto">
                      <div className="text-center mb-3">
                        <span className="text-yellow-300 font-bold text-base md:text-lg">🎲 跑马发牌</span>
                        {runItTwiceAnimCountdown > 0 && (
                          <div className="mt-2">
                            <div className="inline-flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full bg-yellow-500/20 border-2 border-yellow-400 animate-pulse">
                              <span className="text-yellow-300 font-bold text-xl md:text-2xl">{runItTwiceAnimCountdown}</span>
                            </div>
                            <div className="text-yellow-200/60 text-xs mt-1">
                              {runItTwiceAnimPhase === 'waiting' ? '即将发牌...' : runItTwiceAnimPhase === 'done' ? '发牌完成' : '发牌中...'}
                            </div>
                          </div>
                        )}
                      </div>

                      {showdownHands.length > 0 && (
                        <div className="mb-3">
                          <div className="text-white/50 text-xs mb-1 text-center">玩家手牌</div>
                          <div className="flex justify-center gap-4 flex-wrap">
                            {showdownHands.map(hand => {
                              const latestResult = roundResults[roundResults.length - 1]
                              return (
                                <div key={hand.playerId} className="text-center">
                                  <div className="text-white/80 text-xs mb-1">{hand.playerName}</div>
                                  <div className="flex gap-0.5 justify-center">
                                    {hand.holeCards.map((card, ci) => {
                                      const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                                      const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                                      return (
                                        <div key={ci} className={`w-8 h-12 md:w-10 md:h-14 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                                          <span className="font-bold text-xs">{card.rank}</span>
                                          <span className="text-sm">{suitSymbol[card.suit]}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  {latestResult && latestResult.handRanks && (
                                    <div className="text-yellow-300/80 text-xs mt-0.5">{latestResult.handRanks[hand.playerId]}</div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        {runItTwiceAnimCards.map((roundCards, roundIdx) => {
                          const sharedCards = roundCards.slice(0, existingCount)
                          const newCards = roundCards.slice(existingCount)
                          const roundLabel = isMultiRound ? (roundIdx === 0 ? 'A轮' : 'B轮') : 'A轮'
                          const roundResult = roundResults.find(r => r.roundIndex === roundIdx)
                          const neededCards = 5 - existingCount
                          const flopCount = existingCount < 3 ? 3 - existingCount : 0
                          const turnCount = existingCount < 4 ? 1 : 0
                          const riverCount = existingCount < 5 ? 1 : 0
                          const newFlop = newCards.slice(0, flopCount)
                          const newTurn = turnCount > 0 ? newCards.slice(flopCount, flopCount + 1) : []
                          const newRiver = riverCount > 0 ? newCards.slice(flopCount + turnCount, flopCount + turnCount + riverCount) : []
                          const flopDealt = newFlop.length > 0
                          const turnDealt = newTurn.length > 0
                          const riverDealt = newRiver.length > 0
                          const cardEl = (card: Card, key: string, highlight: boolean) => {
                            const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                            const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                            return (
                              <div key={key} className={`w-8 h-12 md:w-10 md:h-14 bg-white rounded ${highlight ? 'border-2 border-yellow-400 shadow-lg shadow-yellow-400/30 animate-[fadeIn_0.3s_ease-in]' : 'border border-gray-300'} flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                                <span className="font-bold text-xs">{card.rank}</span>
                                <span className="text-sm">{suitSymbol[card.suit]}</span>
                              </div>
                            )
                          }
                          const emptyEl = (key: string) => (
                            <div key={key} className="w-8 h-12 md:w-10 md:h-14 border-2 border-dashed border-white/20 rounded flex items-center justify-center">
                              <span className="text-white/20 text-sm">?</span>
                            </div>
                          )
                          return (
                            <div key={roundIdx} className="p-2 bg-purple-900/40 rounded-lg border border-purple-500/30">
                              <div className="text-white/60 text-xs mb-1 text-center font-bold">
                                {roundLabel}
                                {roundResult ? ` (底池 $${roundResult.potAmount})` : ''}
                              </div>
                              <div className="flex items-center justify-center gap-1">
                                {sharedCards.length > 0 && (
                                  <div className="flex gap-0.5">
                                    {sharedCards.map((card, i) => cardEl(card, `s${i}`, false))}
                                  </div>
                                )}
                                {flopCount > 0 && (
                                  <div className="flex gap-0.5 ml-2">
                                    {flopDealt
                                      ? newFlop.map((card, i) => cardEl(card, `f${i}`, true))
                                      : Array.from({ length: flopCount }).map((_, i) => emptyEl(`fe${i}`))
                                    }
                                  </div>
                                )}
                                {turnCount > 0 && (
                                  <div className="flex gap-0.5 ml-2">
                                    {turnDealt
                                      ? newTurn.map((card, i) => cardEl(card, `t${i}`, true))
                                      : emptyEl('te')
                                    }
                                  </div>
                                )}
                                {riverCount > 0 && (
                                  <div className="flex gap-0.5 ml-2">
                                    {riverDealt
                                      ? newRiver.map((card, i) => cardEl(card, `r${i}`, true))
                                      : emptyEl('re')
                                    }
                                  </div>
                                )}
                                {neededCards === 0 && roundCards.length === 0 && (
                                  <div className="flex gap-0.5">
                                    {Array.from({ length: 5 }).map((_, i) => emptyEl(`e${i}`))}
                                  </div>
                                )}
                              </div>
                              {roundResult && (
                                <div className="mt-2 p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                                  <div className="text-yellow-300 text-xs font-bold text-center mb-1">
                                    {roundResult.roundLabel}结算
                                  </div>
                                  <div className="text-white/80 text-xs text-center">
                                    {roundResult.winnerIds.map(wid => {
                                      const hand = showdownHands.find(h => h.playerId === wid)
                                      return hand ? hand.playerName : wid
                                    }).join(', ')} 赢得 ${roundResult.winAmount}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
          </div>
          <div className="hidden md:block w-64 flex-shrink-0">
            <ChatBox />
          </div>
          {showMobileChat && (
            <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setShowMobileChat(false)}>
              <div className="absolute right-0 top-0 bottom-0 w-72" onClick={e => e.stopPropagation()}>
                <ChatBox />
              </div>
            </div>
          )}
        </div>

        {!showMobileChat && (
          <button
            onClick={() => setShowMobileChat(true)}
            className="md:hidden fixed right-2 bottom-20 z-30 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-700 active:scale-95"
          >
            💬
          </button>
        )}

        {message && (
          <div className="text-center text-red-400 text-sm py-1 bg-black/30">{message}</div>
        )}

        {isMyTurn && !showResult && !isWaitingForStart && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && gameState.phase !== 'waiting' && gameState.phase !== 'run-it-twice-choice' && gameState.phase !== 'run-it-twice-dice' && (
          <div className="bg-gray-900/90 border-t border-gray-700 p-2 md:p-3">
            <div className="text-center text-white/60 text-xs md:text-sm mb-1 md:mb-2">
              轮到你行动 {toCall > 0 ? `(需跟注 $${toCall})` : '(可以过牌)'}
            </div>
            <div className="flex justify-center gap-1.5 md:gap-2 flex-wrap mb-1 md:mb-2">
              <button
                onClick={() => handleAction('fold')}
                className="px-3 md:px-4 py-1.5 md:py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold text-xs md:text-sm"
              >
                弃牌
              </button>
              {toCall === 0 ? (
                <button
                  onClick={() => handleAction('check')}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold text-xs md:text-sm"
                >
                  过牌
                </button>
              ) : toCall >= myChips ? (
                <button
                  onClick={() => handleAction('all-in')}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-bold text-xs md:text-sm"
                >
                  全押 ${myChips}
                </button>
              ) : (
                <button
                  onClick={() => handleAction('call')}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-bold text-xs md:text-sm"
                >
                  跟注 ${toCall}
                </button>
              )}
              {myChips > toCall && (
                <button
                  onClick={() => {
                    setRaiseAmount(minRaise)
                    setShowRaiseSlider(!showRaiseSlider)
                  }}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-bold text-xs md:text-sm"
                >
                  加注
                </button>
              )}
              {myChips > toCall && (
                <button
                  onClick={() => handleAction('all-in')}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-bold text-xs md:text-sm"
                >
                  全押 ${myChips}
                </button>
              )}
            </div>
            {showRaiseSlider && (
              <div className="px-2 md:px-4 py-2 md:py-2 bg-gray-800 rounded-lg">
                {variantRule.isPotLimit && (
                  <div className="text-center text-white/40 text-[10px] md:text-xs mb-1">
                    底池限注 · 最大加注 ${potLimitMaxRaise}
                  </div>
                )}
                <div className="flex items-center gap-2 md:gap-3">
                <span className="text-yellow-300 font-bold text-xs md:text-sm min-w-[40px] md:min-w-[50px]">${raiseAmount}</span>
                <input
                  type="range"
                  min={minRaise}
                  max={maxRaise}
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(parseInt(e.target.value))}
                  className="flex-1 accent-yellow-400 h-6 md:h-auto"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => setRaiseAmount(minRaise)}
                    className="px-2 md:px-2 py-1 md:py-1 bg-white/10 rounded text-white/80 text-xs md:text-xs hover:bg-white/20 min-w-[32px]"
                  >
                    Min
                  </button>
                  <button
                    onClick={() => setRaiseAmount(Math.max(minRaise, Math.floor(totalPot / 2)))}
                    className="px-2 md:px-2 py-1 md:py-1 bg-white/10 rounded text-white/80 text-xs md:text-xs hover:bg-white/20 min-w-[32px]"
                  >
                    1/2
                  </button>
                  <button
                    onClick={() => setRaiseAmount(Math.max(minRaise, totalPot))}
                    className="px-2 md:px-2 py-1 md:py-1 bg-white/10 rounded text-white/80 text-xs md:text-xs hover:bg-white/20 min-w-[32px]"
                  >
                    满池
                  </button>
                  <button
                    onClick={() => setRaiseAmount(myChips)}
                    className="px-2 md:px-2 py-1 md:py-1 bg-purple-600/40 rounded text-white/80 text-xs md:text-xs hover:bg-purple-600/60 min-w-[32px]"
                  >
                    All-in
                  </button>
                </div>
                <button
                  onClick={() => handleAction('raise', raiseAmount)}
                  className="px-3 md:px-4 py-1 md:py-1.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-xs md:text-sm"
                >
                  确认
                </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!isMyTurn && !showResult && !isWaitingForStart && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && gameState.phase !== 'waiting' && gameState.phase !== 'run-it-twice-choice' && gameState.phase !== 'run-it-twice-dice' && !amIInCurrentGame && (
          <div className="bg-gray-900/90 border-t border-gray-700 p-2 md:p-3">
            <div className="text-center text-yellow-300 text-xs md:text-sm">
              {isAfkSpectator ? '☕ 你处于AFK状态' : isSpectatorFromBust ? '👁️ 你正在观战' : '⏳ 当前局进行中，请等待本局结束后加入'}
            </div>
            <div className="flex justify-center gap-2 md:gap-3 mt-1.5 md:mt-2">
              {isAfkSpectator ? (
                <button
                  onClick={handleAfk}
                  className="px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs md:text-sm"
                >
                  🔄 回来
                </button>
              ) : isSpectatorFromBust ? (
                <>
                  {maxRebuyReached ? (
                    <span className="text-orange-400 text-xs md:text-sm">🔒 补筹码次数已用完</span>
                  ) : (
                    <button
                      onClick={handleRebuy}
                      disabled={isSubmitting}
                      className={`px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      补筹码
                    </button>
                  )}
                </>
              ) : !isReady ? (
                <button
                  onClick={handleReady}
                  disabled={isSubmitting}
                  className={`px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  准备下一局
                </button>
              ) : (
                <span className="text-green-400 text-xs md:text-sm">✅ 已准备，等待本局结束...</span>
              )}
            </div>
          </div>
        )}
        {!isMyTurn && !showResult && !isWaitingForStart && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && gameState.phase !== 'waiting' && gameState.phase !== 'run-it-twice-choice' && gameState.phase !== 'run-it-twice-dice' && amIInCurrentGame && !isAfk && (
          <div className="flex items-center justify-center gap-2 py-2 md:py-3 bg-black/30">
            <span className="text-white/40 text-xs md:text-sm">等待其他玩家行动...</span>
          </div>
        )}
        {!isMyTurn && !showResult && !isWaitingForStart && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && gameState.phase !== 'waiting' && gameState.phase !== 'run-it-twice-choice' && gameState.phase !== 'run-it-twice-dice' && amIInCurrentGame && isAfk && (
          <div className="flex items-center justify-center gap-2 py-2 md:py-3 bg-black/30">
            <span className="text-yellow-300 text-xs md:text-sm">☕ 你处于AFK状态</span>
          </div>
        )}

        {isWaitingForStart && (
          <div className="bg-gray-900/90 border-t border-gray-700 p-2 md:p-3">
            <div className="flex items-center justify-between gap-2 md:gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 md:gap-2 overflow-x-auto">
                {currentRoom.players.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-1 text-xs md:text-sm whitespace-nowrap">
                    <span className={p.isReady ? 'text-green-400' : 'text-white/40'}>
                      {p.isReady ? '✅' : '⏳'}
                    </span>
                    <span className="text-white/80">{p.name}{p.id === myPlayerId ? '(你)' : ''}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 md:gap-2">
                {isGameOver ? (
                  <span className="text-yellow-400 text-xs md:text-sm self-center">🏆 游戏已结束</span>
                ) : isAfkSpectator ? (
                  <button
                    onClick={handleAfk}
                    className="px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs md:text-sm"
                  >
                    🔄 回来
                  </button>
                ) : showRebuyButton || isSpectatorFromBust ? (
                  <>
                    {rebuyCountdown > 0 && (
                      <span className="text-orange-400 text-xs md:text-sm self-center font-bold">⏱ {rebuyCountdown}s</span>
                    )}
                    {(showRebuyButton || isSpectatorFromBust) && !maxRebuyReached && (
                      <button
                        onClick={handleRebuy}
                        disabled={isSubmitting}
                        className={`px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        补筹码
                      </button>
                    )}
                    {maxRebuyReached && (showRebuyButton || isSpectatorFromBust) && (
                      <span className="text-orange-400 text-xs md:text-sm self-center">🔒 补筹码次数已用完({myRebuyCount}/{currentRoom.config.maxRebuyCount})</span>
                    )}
                    {isBusted && !isAfk && (
                      <button
                        onClick={handleDeclineRebuy}
                        disabled={isSubmitting}
                        className={`px-3 md:px-4 py-1.5 md:py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        不补（观战）
                      </button>
                    )}
                  </>
                ) : isReady ? (
                  <button
                    onClick={handleCancelReady}
                    disabled={isSubmitting}
                    className={`px-3 md:px-4 py-1.5 md:py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    取消准备
                  </button>
                ) : currentRoom.config.fixedHands && currentRoom.config.fixedHands > 0 && (currentRoom.handCount || 0) >= currentRoom.config.fixedHands ? (
                  <button
                    onClick={async () => {
                      const result = await emit(ClientEvents.VOTE_EXTEND_HANDS)
                      if (!result?.success) {
                        addToast(result?.error || '发起投票失败', 'error')
                      }
                    }}
                    disabled={isSubmitting}
                    className={`px-3 md:px-4 py-1.5 md:py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    🎯 投票加10局
                  </button>
                ) : (
                  <button
                    onClick={handleReady}
                    disabled={isSubmitting}
                    className={`px-3 md:px-4 py-1.5 md:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs md:text-sm ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    准备下一局
                  </button>
                )}
                <button
                  onClick={isInVoteCooldown ? undefined : handleLeaveGame}
                  disabled={isInVoteCooldown}
                  className={`px-3 md:px-4 py-1.5 md:py-2 text-white rounded-lg font-bold text-xs md:text-sm ${isInVoteCooldown ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-red-700 hover:bg-red-800'}`}
                >
                  {isInVoteCooldown ? `冷却中 ${voteCooldownRemaining}s` : (myPlayerNeedVote ? '投票离开' : '离开')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showRunItTwiceDialog && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 md:p-4">
            <div className="bg-gray-800 rounded-xl p-4 md:p-6 max-w-md w-full mx-2 md:mx-4 border border-yellow-600/50">
              <h2 className="text-xl md:text-2xl font-bold text-yellow-300 text-center mb-2 md:mb-3">🎲 双人 All-In!</h2>
              <p className="text-white/80 text-center text-sm md:text-base mb-3 md:mb-4">
                选择跑一轮还是跑两轮？
              </p>

              {runItTwiceMyChoice ? (
                <div className="text-center space-y-2 md:space-y-3">
                  <div className="text-white/60 text-xs md:text-sm">
                    你选择了：<span className={runItTwiceMyChoice === 'once' ? 'text-blue-400 font-bold' : 'text-yellow-400 font-bold'}>
                      {runItTwiceMyChoice === 'once' ? '跑一轮' : '跑两轮'}
                    </span>
                  </div>
                  {runItTwiceOtherChoice ? (
                    <div className="text-white/60 text-xs md:text-sm">
                      {runItTwiceOtherName}选择了：<span className={runItTwiceOtherChoice === 'once' ? 'text-blue-400 font-bold' : 'text-yellow-400 font-bold'}>
                        {runItTwiceOtherChoice === 'once' ? '跑一轮' : '跑两轮'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-white/40 text-xs md:text-sm animate-pulse">
                      等待对手选择...
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-3 md:gap-4">
                  <button
                    onClick={() => handleRunItTwiceChoice('once')}
                    className="flex-1 py-3 md:py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-bold text-base md:text-lg"
                  >
                    跑一轮
                  </button>
                  <button
                    onClick={() => handleRunItTwiceChoice('twice')}
                    className="flex-1 py-3 md:py-4 bg-yellow-600 text-white rounded-xl hover:bg-yellow-700 transition-colors font-bold text-base md:text-lg"
                  >
                    跑两轮
                  </button>
                </div>
              )}

              <div className="mt-3 md:mt-4 text-white/30 text-[10px] md:text-xs text-center">
                跑两轮：底池平分两半，各发一套公共牌分别摊牌
              </div>
            </div>
          </div>
        )}

        {showDiceDialog && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 md:p-4">
            <div className="bg-gray-800 rounded-xl p-4 md:p-6 max-w-md w-full mx-2 md:mx-4 border border-purple-600/50">
              <h2 className="text-xl md:text-2xl font-bold text-purple-300 text-center mb-2 md:mb-3">🎲 掷骰子决定</h2>
              <p className="text-white/80 text-center text-xs md:text-sm mb-3 md:mb-4">
                两人选择不同，掷骰子决定！点数大者的选择生效
              </p>

              <div className="flex justify-center gap-4 md:gap-6 mb-3 md:mb-4">
                {dicePlayers.map((p, i) => {
                  const isMe = p.id === myPlayerId
                  const hasRolled = diceReady[p.id]
                  const diceValue = i === 0 ? diceResult?.player1?.value : diceResult?.player2?.value
                  return (
                    <div key={p.id} className="flex flex-col items-center gap-1.5 md:gap-2">
                      <div className="text-white font-bold text-xs md:text-sm">
                        {p.name}{isMe ? '(你)' : ''}
                      </div>
                      <div className={`w-14 h-14 md:w-16 md:h-16 rounded-xl flex items-center justify-center text-2xl md:text-3xl font-bold border-2 transition-all duration-300 ${
                        hasRolled
                          ? 'bg-purple-700 border-purple-400 text-white scale-110'
                          : 'bg-gray-700 border-gray-500 text-gray-400'
                      }`}>
                        {diceValue || '?'}
                      </div>
                      {hasRolled ? (
                        <span className="text-green-400 text-[10px] md:text-xs">已掷骰</span>
                      ) : isMe ? (
                        <button
                          onClick={handleRollDice}
                          className="px-3 md:px-4 py-1.5 md:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-bold text-xs md:text-sm animate-pulse"
                        >
                          掷骰子
                        </button>
                      ) : (
                        <span className="text-white/40 text-[10px] md:text-xs animate-pulse">等待中...</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {diceResult && !diceIsTied && (
                <div className="text-center">
                  <div className="text-yellow-300 font-bold text-sm md:text-base mb-1">
                    {diceResult.finalChoice === 'once' ? '跑一轮' : '跑两轮'}！
                  </div>
                  <div className="text-white/50 text-[10px] md:text-xs">
                    {diceResult.player1.value > diceResult.player2.value
                      ? dicePlayers[0]?.name
                      : dicePlayers[1]?.name
                    }点数更大，选择生效
                  </div>
                </div>
              )}

              {diceIsTied && (
                <div className="text-center">
                  <div className="text-red-400 font-bold text-sm md:text-base animate-pulse">
                    平局！重新掷骰子...
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showResult && allHands && allHands.length > 0 && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 md:p-4">
            <div className="bg-gray-800 rounded-xl p-3 md:p-6 max-w-lg w-full mx-2 md:mx-4 border border-gray-600 max-h-[90vh] md:max-h-[85vh] flex flex-col">
              <h2 className="text-xl md:text-2xl font-bold text-white text-center mb-2 md:mb-3">🏆 本局结束</h2>

              {(() => {
                const winnerHand = allHands.find((h: any) => h.isWinner)
                const isFoldWin = winnerHand?.handDescription === '其他玩家弃牌'
                const myHand = allHands.find((h: any) => h.playerId === myPlayerId)
                const alreadyShown = showedCardsPlayerIds.has(myPlayerId || '')
                const canShowCards = isFoldWin && !!myHand && !alreadyShown
                return canShowCards ? (
                  <div className="flex justify-center mb-2 md:mb-3">
                    <button
                      onClick={async () => {
                        const result = await emit(ClientEvents.SHOW_CARDS)
                        if (!result?.success) {
                          addToast(result?.error || '秀牌失败', 'error')
                        }
                      }}
                      disabled={isSubmitting}
                      className={`px-4 md:px-6 py-1.5 md:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-bold text-sm md:text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      🃏 秀牌
                    </button>
                  </div>
                ) : null
              })()}

              <div className="flex gap-2 md:gap-3 mb-3 md:mb-4">
                {isGameOver ? (
                  <span className="text-yellow-400 text-sm md:text-lg self-center">🏆 游戏已结束</span>
                ) : showRebuyButton || isSpectatorFromBust ? (
                  <>
                    {rebuyCountdown > 0 && (
                      <span className="text-orange-400 text-sm md:text-lg self-center font-bold">⏱ {rebuyCountdown}s</span>
                    )}
                    {(showRebuyButton || isSpectatorFromBust) && !maxRebuyReached && (
                      <button
                        onClick={handleRebuy}
                        disabled={isSubmitting}
                        className={`flex-1 px-3 md:px-6 py-2 md:py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-sm md:text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        补筹码
                      </button>
                    )}
                    {maxRebuyReached && (showRebuyButton || isSpectatorFromBust) && (
                      <span className="text-orange-400 text-sm md:text-lg self-center">🔒 补筹码次数已用完({myRebuyCount}/{currentRoom.config.maxRebuyCount})</span>
                    )}
                    {isBusted && !isAfk && (
                      <button
                        onClick={handleDeclineRebuy}
                        disabled={isSubmitting}
                        className={`flex-1 px-3 md:px-6 py-2 md:py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-sm md:text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        不补（观战）
                      </button>
                    )}
                  </>
                ) : currentRoom.config.fixedHands && currentRoom.config.fixedHands > 0 && (currentRoom.handCount || 0) >= currentRoom.config.fixedHands ? (
                  <>
                    <button
                      onClick={async () => {
                        const result = await emit(ClientEvents.VOTE_EXTEND_HANDS)
                        if (!result?.success) {
                          addToast(result?.error || '发起投票失败', 'error')
                        }
                      }}
                      disabled={isSubmitting}
                      className={`flex-1 px-3 md:px-6 py-2 md:py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-sm md:text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      🎯 投票加10局
                    </button>
                    <button
                      onClick={() => { setShowResult(false); setShowActionLog(true) }}
                      className={`px-3 md:px-6 py-2 md:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm md:text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      📋 牌局记录
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleReady}
                    disabled={isSubmitting}
                    className={`flex-1 px-3 md:px-6 py-2 md:py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-sm md:text-lg ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    准备下一局
                  </button>
                )}
                <button
                  onClick={isInVoteCooldown ? undefined : handleLeaveGame}
                  disabled={isInVoteCooldown}
                  className={`px-3 md:px-6 py-2 md:py-3 text-white rounded-lg font-bold text-sm md:text-lg ${isInVoteCooldown ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-600 hover:bg-gray-700'}`}
                >
                  {isInVoteCooldown ? `冷却中 ${voteCooldownRemaining}s` : (myPlayerNeedVote ? '投票离开' : '离开')}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">

              {resultCommunityCards.length > 0 && !(runItTwiceBoard && runItTwiceBoard.length === 2) && (
                <div className="mb-3 md:mb-4 p-2 md:p-3 bg-blue-900/30 rounded-lg border border-blue-600/30">
                  <p className="text-white/60 text-[10px] md:text-xs mb-1 md:mb-2 text-center">公共牌</p>
                  <div className="flex gap-1 md:gap-1.5 justify-center items-center">
                    {(() => {
                      const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                      const renderResultCard = (card: Card, idx: number) => {
                        const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                        return (
                          <div key={idx} className={`w-8 h-12 md:w-11 md:h-16 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                            <span className="font-bold text-[10px] md:text-sm">{card.rank}</span>
                            <span className="text-xs md:text-base">{suitSymbol[card.suit]}</span>
                          </div>
                        )
                      }
                      const cards = resultCommunityCards
                      return (
                        <>
                          {cards.slice(0, 3).map((c, i) => renderResultCard(c, i))}
                          {cards.length > 3 && <span className="text-white/30 mx-0.5 md:mx-1">|</span>}
                          {cards.length > 3 && cards.slice(3, 4).map((c, i) => renderResultCard(c, i + 3))}
                          {cards.length > 4 && <span className="text-white/30 mx-0.5 md:mx-1">|</span>}
                          {cards.length > 4 && cards.slice(4, 5).map((c, i) => renderResultCard(c, i + 4))}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}

              {runItTwiceBoard && runItTwiceBoard.length === 2 && (() => {
                return (
                  <div className="mb-3 md:mb-4 space-y-3 md:space-y-4">
                    <p className="text-yellow-300/80 text-[10px] md:text-xs text-center font-bold">🎲 跑两轮结果</p>
                    {runItTwiceBoard.map((_board, boardIdx) => {
                      const roundResult = runItTwiceResults?.[boardIdx]
                      const roundWinnerIds = roundResult?.winnerIds || []
                      return (
                        <div key={boardIdx} className="p-2 md:p-3 bg-purple-900/30 rounded-lg border border-purple-600/30">
                          <p className="text-white/60 text-[10px] md:text-xs mb-1.5 md:mb-2 text-center">
                            第{boardIdx + 1}轮 {roundResult ? `(底池 $${roundResult.potAmount})` : ''}
                          </p>
                          {roundResult && roundWinnerIds.length > 0 && (
                            <div className="space-y-0.5 md:space-y-1">
                              {allHands.filter(h => h.roundHandRanks && h.roundHandRanks.length === 2).map(h => {
                                const isRoundWinner = roundWinnerIds.includes(h.playerId)
                                const isTie = roundWinnerIds.length > 1 && isRoundWinner
                                const roundLabel = isTie ? '平局' : (isRoundWinner ? '胜' : '负')
                                const labelColor = isTie ? 'text-blue-300' : (isRoundWinner ? 'text-green-400' : 'text-red-400/70')
                                return (
                                  <div key={h.playerId} className={`flex items-center justify-center gap-1 md:gap-1.5 text-[9px] md:text-xs ${isRoundWinner ? 'text-yellow-300' : 'text-white/50'}`}>
                                    <span className="font-bold">{h.playerName}</span>
                                    <span className={isRoundWinner ? 'text-yellow-400 font-bold' : 'text-white/40'}>
                                      {h.roundHandRanks![boardIdx]}
                                    </span>
                                    <span className={`${labelColor} font-bold`}>{roundLabel}</span>
                                    {isRoundWinner && <span className="text-green-400/80">+${roundResult.winAmount}</span>}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {allHands.length > 0 ? (
                <div className="space-y-1.5 md:space-y-2 mb-3 md:mb-4">
                  {allHands.map((hand, i) => {
                    const isMe = hand.playerId === myPlayerId
                    const wasAllIn = currentRoom?.gameState?.playerStatus?.[hand.playerId] === 'all-in'
                    const profit = hand.netWin !== undefined ? hand.netWin : 0
                    return (
                      <div key={i} className={`p-2 md:p-3 rounded-lg border ${
                        hand.isWinner
                          ? 'bg-yellow-900/30 border-yellow-600/30'
                          : isMe
                            ? 'bg-green-900/20 border-green-600/20'
                            : 'bg-white/5 border-white/10'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 md:gap-2">
                            {hand.isWinner && <span className="text-yellow-400">🏆</span>}
                            <span className={`font-bold text-xs md:text-sm ${hand.isWinner ? 'text-yellow-300' : 'text-white'}`}>
                              {hand.playerName} {isMe ? '(你)' : ''}
                            </span>
                            {wasAllIn && (
                              <span className="text-[8px] md:text-[10px] px-1 py-0.5 rounded bg-red-600/60 text-red-200 font-bold border border-red-500/40">
                                ALL IN
                              </span>
                            )}
                            {hand.isWinner && hand.potType && hand.potType !== 'main' && (
                              <span className="text-[8px] md:text-xs px-1 md:px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-600/30">
                                {hand.potType === 'both' ? '主池+边池' : '边池'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 md:gap-2">
                            {hand.roundHandRanks && hand.roundHandRanks.length === 2 ? (
                              <div className="flex items-center gap-1 md:gap-1.5">
                                {hand.roundHandRanks.map((rank, ri) => {
                                  const rr = runItTwiceResults?.[ri]
                                  const isWinner = rr?.winnerIds.includes(hand.playerId)
                                  const isTie = rr && rr.winnerIds.length > 1 && isWinner
                                  const label = isTie ? '平' : (isWinner ? '胜' : '负')
                                  const labelColor = isTie ? 'text-blue-300' : (isWinner ? 'text-green-400' : 'text-red-400/70')
                                  const bg = ri === 0 ? 'bg-blue-900/50 border-blue-500/30' : 'bg-yellow-900/50 border-yellow-500/30'
                                  return (
                                    <span key={ri} className={`text-[9px] md:text-xs font-bold px-1 md:px-1.5 py-0.5 rounded border ${bg} ${hand.isWinner ? 'text-yellow-300' : 'text-white/70'}`}>
                                      R{ri + 1}: {rank} <span className={labelColor}>{label}</span>
                                    </span>
                                  )
                                })}
                              </div>
                            ) : (
                              <span className={`text-[10px] md:text-sm font-bold ${hand.isWinner ? 'text-yellow-300' : 'text-white/60'}`}>
                                {hand.handRank}
                              </span>
                            )}
                            {profit !== 0 && (
                              <span className={`font-bold text-[10px] md:text-sm ${profit > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {profit > 0 ? '+' : ''}{profit}
                              </span>
                            )}
                          </div>
                        </div>
                        {hand.holeCards && hand.holeCards.length > 0 && (
                          <div className="flex items-center gap-1 md:gap-1.5 mt-1 md:mt-2">
                            <span className="text-white/40 text-[9px] md:text-xs mr-0.5 md:mr-1">手牌:</span>
                            {hand.holeCards.map((card, ci) => {
                              const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                              const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                              return (
                                <div key={ci} className={`w-7 h-10 md:w-10 md:h-14 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                                  <span className="font-bold text-[9px] md:text-xs">{card.rank}</span>
                                  <span className="text-[10px] md:text-sm">{suitSymbol[card.suit]}</span>
                                </div>
                              )
                            })}
                            {hand.roundHandRanks && hand.roundHandRanks.length === 2 ? (
                              <span className="text-white/70 text-[10px] md:text-sm font-bold ml-1 md:ml-2">
                                → {hand.handDescription}
                              </span>
                            ) : hand.handDescription && hand.handRank !== '弃牌' && hand.handRank !== '其他玩家弃牌' ? (
                              <span className="text-white/70 text-[10px] md:text-sm font-bold ml-1 md:ml-2">→ {hand.handDescription}</span>
                            ) : null}
                          </div>
                        )}
                        {hand.handRank === '弃牌' && (
                          <div className="text-red-400/60 text-[9px] md:text-xs mt-0.5 md:mt-1">弃牌</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  {winners && winners.map((winner, i) => (
                    <div key={i} className="text-center mb-4 p-3 bg-yellow-900/30 rounded-lg border border-yellow-600/30">
                      <div className="text-xl font-bold text-yellow-300">
                        {winner.playerName} 获胜！
                        {winner.potType && winner.potType !== 'main' && (
                          <span className="text-sm ml-2 px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-600/30">
                            {winner.potType === 'both' ? '主池+边池' : '边池'}
                          </span>
                        )}
                      </div>
                      <div className="text-white/80 mt-1">{winner.handDescription || winner.handRank}</div>
                      <div className="text-green-400 font-bold mt-1">赢得 ${winner.winAmount}</div>
                      {winner.explanation && (
                        <div className="text-white/60 text-sm mt-1">{winner.explanation}</div>
                      )}
                    </div>
                  ))}
                </>
              )}

              <div className="mb-3 md:mb-4">
                <div className="text-white/60 text-xs md:text-sm mb-1 md:mb-2 text-center">本局盈亏</div>
                {players.map(p => {
                  const handInfo = allHands.find((h: any) => h.playerId === p.id)
                  const profit = handInfo?.netWin !== undefined ? handInfo.netWin : 0
                  return (
                    <div key={p.id} className="flex justify-between text-white text-xs md:text-sm py-0.5 md:py-1">
                      <span>{p.name} {p.id === myPlayerId ? '(你)' : ''}</span>
                      <span>
                        <span className="text-yellow-300">${p.chips}</span>
                        <span className={`ml-1 md:ml-2 ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ({profit >= 0 ? '+' : ''}{profit})
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>

              </div>
            </div>
          </div>
        )}

        {gameOverInfo && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 md:p-4">
            <div className="bg-gray-800 rounded-xl p-4 md:p-8 max-w-lg w-full mx-2 md:mx-4 border border-yellow-500/50 text-center">
              <div className="text-4xl md:text-6xl mb-3 md:mb-4">🏆</div>
              <h2 className="text-2xl md:text-3xl font-bold text-yellow-300 mb-2 md:mb-3">游戏结束</h2>
              {gameOverInfo.winner ? (
                <div className="mb-4 md:mb-6">
                  <p className="text-white text-lg md:text-xl mb-2">
                    <span className="text-yellow-300 font-bold">{gameOverInfo.winner.name}</span> 获得最终胜利！
                  </p>
                  <p className="text-white/60 text-sm md:text-base">
                    最终筹码: <span className="text-yellow-300 font-bold">${gameOverInfo.winner.chips}</span>
                  </p>
                </div>
              ) : (
                <p className="text-white/60 text-lg mb-4 md:mb-6">所有玩家均已破产</p>
              )}
              <div className="flex flex-col gap-2 md:gap-3">
                <button
                  onClick={isInVoteCooldown ? undefined : handleLeaveGame}
                  disabled={isInVoteCooldown}
                  className="w-full px-4 md:px-6 py-2 md:py-3 bg-red-700 hover:bg-red-800 text-white rounded-lg font-bold text-sm md:text-lg transition-colors"
                >
                  退出房间
                </button>
                <div className="flex gap-2 md:gap-3">
                  <button
                    onClick={() => { setGameOverInfo(null); setShowActionLog(true) }}
                    className="flex-1 px-3 md:px-4 py-2 md:py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold text-xs md:text-sm transition-colors"
                  >
                    📋 牌局日志
                  </button>
                  <button
                    onClick={() => { setGameOverInfo(null); setShowScoreboard(true) }}
                    className="flex-1 px-3 md:px-4 py-2 md:py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold text-xs md:text-sm transition-colors"
                  >
                    📊 记分牌
                  </button>
        </div>
              </div>
            </div>
          </div>
        )}

        {showScoreboard && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 md:p-4">
            <div className="bg-gray-800 rounded-xl p-3 md:p-6 max-w-md w-full mx-2 md:mx-4 border border-gray-600">
              <div className="flex justify-between items-center mb-3 md:mb-4">
                <h2 className="text-xl md:text-2xl font-bold text-white">记分牌</h2>
                <button
                  onClick={() => setShowScoreboard(false)}
                  className="text-white/60 hover:text-white text-xl"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5 md:space-y-2">
                {(currentRoom?.scoreboardEntries || [...players] as ScoreboardEntry[])
                  .sort((a: ScoreboardEntry, b: ScoreboardEntry) => b.chips - a.chips)
                  .map((p: ScoreboardEntry, idx: number) => {
                    const profit = p.chips - (p.totalBuyIn || initialChips)
                    const rebuyCount = Math.max(0, Math.floor(((p.totalBuyIn || initialChips) - initialChips) / initialChips))
                    const hasLeft = !!p.leftAt
                    return (
                      <div key={p.id} className={`flex items-center justify-between p-2 md:p-3 rounded-lg ${
                        p.id === myPlayerId ? 'bg-green-900/40 border border-green-600/30' : hasLeft ? 'bg-white/[0.02]' : 'bg-white/5'
                      }`}>
                        <div className="flex items-center gap-2 md:gap-3">
                          <span className="text-white/40 font-bold w-5 md:w-6 text-xs md:text-sm">#{idx + 1}</span>
                          <div>
                            <div className={`font-bold text-xs md:text-sm ${hasLeft ? 'text-white/40' : 'text-white'}`}>
                              {p.name} {p.id === myPlayerId ? '(你)' : ''} {hasLeft ? '(已离开)' : ''}
                            </div>
                            <div className="text-white/40 text-[10px] md:text-xs">
                              总买入: ${p.totalBuyIn || initialChips}
                              {rebuyCount > 0 && <span className="text-orange-400 ml-1">补充{rebuyCount}次</span>}
                              {currentRoom.config.maxRebuyCount !== undefined && currentRoom.config.maxRebuyCount >= 0 && (
                                <span className="text-white/30 ml-1">({currentRoom.playerRebuyCounts?.[p.id] || 0}/{currentRoom.config.maxRebuyCount})</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold text-xs md:text-sm ${hasLeft ? 'text-yellow-300/50' : 'text-yellow-300'}`}>${p.chips}</div>
                          <div className={`text-[10px] md:text-xs font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'} ${hasLeft ? 'opacity-50' : ''}`}>
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

      {/* 规则帮助弹窗 */}
      {showRuleHelp && currentRoom && (() => {
        const variant = currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE
        const rule = VARIANT_RULES[variant]
        const modifier = currentRoom.config.gameModifier
        const modifierInfo = modifier && modifier !== GameModifier.NONE ? MODIFIER_INFO[modifier] : null
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="glass-panel w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <span className="text-2xl">{rule.icon}</span>
                  {rule.name}
                  {modifierInfo && (
                    <span className="text-base text-red-400 flex items-center gap-1">
                      +{modifierInfo.icon}{modifierInfo.name}
                    </span>
                  )}
                </h3>
                <button onClick={() => setShowRuleHelp(false)} className="text-white/60 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-white/80 text-sm leading-relaxed mb-4">
                {rule.fullDesc}
              </p>
              {rule.specialRules.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-white/90 font-semibold text-sm mb-2">特殊规则</h4>
                  <ul className="space-y-1">
                    {rule.specialRules.map((r, i) => (
                      <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                        <span className="text-gold mt-0.5">•</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {modifierInfo && (
                <div className="mb-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                  <h4 className="text-red-400 font-semibold text-sm mb-2 flex items-center gap-1">
                    {modifierInfo.icon} {modifierInfo.name}
                  </h4>
                  <p className="text-white/70 text-xs leading-relaxed mb-2">{modifierInfo.fullDesc}</p>
                  {modifierInfo.specialRules.length > 0 && (
                    <ul className="space-y-1">
                      {modifierInfo.specialRules.map((r, i) => (
                        <li key={i} className="text-white/60 text-xs flex items-start gap-2">
                          <span className="text-red-400 mt-0.5">•</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-2 pt-4 border-t border-white/10">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-white/50">底牌数量</div>
                  <div className="text-white/90">{rule.holeCardCount} 张</div>
                  <div className="text-white/50">公共牌</div>
                  <div className="text-white/90">{rule.communityCardCount} 张</div>
                  <div className="text-white/50">下注方式</div>
                  <div className="text-white/90">{rule.isFixedLimit ? '固定限注 (Fixed-Limit)' : rule.isPotLimit ? '底池限注 (Pot-Limit)' : '无限注 (No-Limit)'}</div>
                </div>
              </div>
              <button
                onClick={() => setShowRuleHelp(false)}
                className="w-full mt-4 btn-poker-primary"
              >
                知道了
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
