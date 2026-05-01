import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSocketStore } from '../stores/socketStore'
import { useGameStore } from '../stores/gameStore'
import { ClientEvents, ServerEvents, Card, WinnerInfo, PlayerHandInfo } from '../types'
import ChatBox from '../components/ChatBox'
import ActionLog, { ActionLogEntry } from '../components/ActionLog'

export default function GamePage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { emit, on, off, playerId: myPlayerId, isConnected, isReconnecting } = useSocketStore()
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
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([])
  const [showActionLog, setShowActionLog] = useState(true)
  const [allHands, setAllHands] = useState<PlayerHandInfo[]>([])
  const [resultCommunityCards, setResultCommunityCards] = useState<Card[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isWaitingForStart, setIsWaitingForStart] = useState(false)
  const [voteInfo, setVoteInfo] = useState<{
    initiatorId: string
    initiatorName: string
    votes: Record<string, boolean>
    totalPlayers: number
    votedPlayers: number
  } | null>(null)
  const [showVoteModal, setShowVoteModal] = useState(false)

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

  const clearLogs = useCallback(() => {
    setActionLogs([])
  }, [])

  useEffect(() => {
    if (!roomId) return

    const handleGameStarted = (data: any) => {
      setCurrentRoom(data.room)
      setGameState(data.gameState)
      setShowResult(false)
      setWinners(null)
      setMyCards(null)
      setShowRaiseSlider(false)
      setAllHands([])
      setIsReady(false)
      setIsWaitingForStart(false)
      clearLogs()
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
        const actor = data.room.players?.find((p: any) => p.id === data.playerId)
        if (actor) {
          addLog(actor.name, data.action, data.amount, data.gameState?.phase)
        }
      }
      if (data.gameState?.currentPlayerId) {
        setIsMyTurn(data.gameState.currentPlayerId === myPlayerId)
      }
    }

    const handleShowdown = (data: { winners: WinnerInfo[]; allHands?: PlayerHandInfo[]; communityCards?: Card[]; gameState: any; room?: any }) => {
      setWinners(data.winners)
      setShowResult(true)
      if (data.allHands) {
        setAllHands(data.allHands)
      }
      if (data.communityCards) {
        setResultCommunityCards(data.communityCards)
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
      addLog('系统', 'showdown', undefined, 'showdown')
      for (const w of data.winners) {
        addLog(w.playerName, 'win', w.winAmount, 'showdown')
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
    }

    const handleRoomUpdated = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
        const me = data.room.players?.find((p: any) => p.id === myPlayerId)
        if (me) {
          setIsReady(me.isReady || false)
        }
      }
    }

    const handlePlayerLeft = (data: any) => {
      if (data.room) {
        setCurrentRoom(data.room)
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
      alert(data.reason || '房间已关闭')
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
        alert('所有玩家同意离开，房间已解散')
        reset()
        navigate('/lobby')
      } else {
        alert(`投票未通过！${data.approvedCount}/${data.totalPlayers} 人同意`)
      }
    }

    const handleRoomLeft = (data: any) => {
      if (data.reason === 'vote') {
        reset()
        navigate('/lobby')
      }
    }

    on(ServerEvents.GAME_STARTED, handleGameStarted)
    on(ServerEvents.DEAL_CARDS, handleDealCards)
    on(ServerEvents.PLAYER_TURN, handlePlayerTurn)
    on(ServerEvents.ACTION_RESULT, handleActionResult)
    on(ServerEvents.SHOWDOWN, handleShowdown)
    on(ServerEvents.HAND_RESULT, handleHandResult)
    on(ServerEvents.CHIPS_RECEIVED, handleChipsReceived)
    on(ServerEvents.ROOM_UPDATED, handleRoomUpdated)
    on(ServerEvents.PLAYER_LEFT, handlePlayerLeft)
    on(ServerEvents.PLAYER_READY_CHANGED, handlePlayerReadyChanged)
    on(ServerEvents.ROOM_CLOSED, handleRoomClosed)
    on(ServerEvents.VOTE_LEAVE_STARTED, handleVoteLeaveStarted)
    on(ServerEvents.VOTE_LEAVE_RESPONSE, handleVoteLeaveResponseEvent)
    on(ServerEvents.VOTE_LEAVE_ENDED, handleVoteLeaveEnded)
    on(ServerEvents.ROOM_LEFT, handleRoomLeft)

    fetchGameState()

    return () => {
      off(ServerEvents.GAME_STARTED, handleGameStarted)
      off(ServerEvents.DEAL_CARDS, handleDealCards)
      off(ServerEvents.PLAYER_TURN, handlePlayerTurn)
      off(ServerEvents.ACTION_RESULT, handleActionResult)
      off(ServerEvents.SHOWDOWN, handleShowdown)
      off(ServerEvents.HAND_RESULT, handleHandResult)
      off(ServerEvents.CHIPS_RECEIVED, handleChipsReceived)
      off(ServerEvents.ROOM_UPDATED, handleRoomUpdated)
      off(ServerEvents.PLAYER_LEFT, handlePlayerLeft)
      off(ServerEvents.PLAYER_READY_CHANGED, handlePlayerReadyChanged)
      off(ServerEvents.ROOM_CLOSED, handleRoomClosed)
      off(ServerEvents.VOTE_LEAVE_STARTED, handleVoteLeaveStarted)
      off(ServerEvents.VOTE_LEAVE_RESPONSE, handleVoteLeaveResponseEvent)
      off(ServerEvents.VOTE_LEAVE_ENDED, handleVoteLeaveEnded)
      off(ServerEvents.ROOM_LEFT, handleRoomLeft)
    }
  }, [roomId, myPlayerId])

  const fetchGameState = async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`)
      const data = await response.json()
      if (data.success && data.room) {
        setCurrentRoom(data.room)
        if (myPlayerId) {
          const player = data.room.players.find((p: any) => p.id === myPlayerId)
          if (player) {
            setCurrentPlayer(player)
            setIsReady(player.isReady || false)
          }
          if (data.room.gameState) {
            setGameState(data.room.gameState)
            if (data.room.gameState.currentPlayerId) {
              setIsMyTurn(data.room.gameState.currentPlayerId === myPlayerId)
            }
          } else {
            setIsWaitingForStart(true)
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch game state:', error)
    }
  }

  const handleLeaveGame = async () => {
    if (currentRoom && currentRoom.players.length > 1) {
      try {
        await emit(ClientEvents.VOTE_LEAVE)
      } catch (error: any) {
        alert(error.message || '发起投票失败')
      }
    } else {
      try {
        await emit(ClientEvents.LEAVE_ROOM)
        reset()
        navigate('/lobby')
      } catch (error: any) {
        alert(error.message || '离开失败')
      }
    }
  }

  const handleVoteResponse = async (approve: boolean) => {
    try {
      await emit(ClientEvents.VOTE_LEAVE_RESPONSE, { approve })
    } catch (error: any) {
      alert(error.message || '投票失败')
    }
  }

  const handleReady = async () => {
    try {
      const result = await emit(ClientEvents.PLAYER_READY, true)
      if (result?.success) {
        setIsReady(true)
        setShowResult(false)
        setIsWaitingForStart(true)
      }
    } catch (error: any) {
      setMessage(error.message || '准备失败')
    }
  }

  const handleCancelReady = async () => {
    try {
      const result = await emit(ClientEvents.PLAYER_READY, false)
      if (result?.success) {
        setIsReady(false)
      }
    } catch (error: any) {
      setMessage(error.message || '取消准备失败')
    }
  }

  const handleStartGame = async () => {
    try {
      const result = await emit(ClientEvents.START_GAME)
      if (!result?.success) {
        alert('无法开局：' + (result?.error || '未知原因'))
      }
    } catch (error: any) {
      alert('无法开局：' + (error.message || '未知原因'))
    }
  }

  const handleAction = async (action: string, amount?: number) => {
    setIsMyTurn(false)
    setShowRaiseSlider(false)
    try {
      await emit(ClientEvents.PLAYER_ACTION, { action, amount })
    } catch (error: any) {
      setMessage(error.message || '操作失败')
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const handleRebuy = async () => {
    try {
      await emit(ClientEvents.GET_CHIPS)
      setMessage('补充筹码成功！')
      setTimeout(() => setMessage(''), 2000)
    } catch (error: any) {
      setMessage(error.message || '补充筹码失败')
    }
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

  const isHost = currentRoom ? currentRoom.config.hostId === myPlayerId : false
  const readyCount = currentRoom ? currentRoom.players.filter((p: any) => p.isReady).length : 0
  const canStartGame = currentRoom ? readyCount >= 3 : false

  if (!currentRoom) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-950 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">加载游戏...</div>
      </div>
    )
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-950 select-none overflow-hidden">
        <div className="h-screen flex flex-col">
          <div className="flex justify-between items-center px-4 py-2 bg-black/30">
            <h1 className="text-lg font-bold text-white">{currentRoom.config.roomName}</h1>
            <div className="flex gap-2">
              <button
                onClick={handleLeaveGame}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
              >
                {currentRoom && currentRoom.players.length > 1 ? '投票离开' : '离开'}
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-white text-2xl font-bold mb-4">等待庄家开始游戏</div>
              <div className="text-white/60 text-sm mb-4">已准备 {readyCount}/3+ 人即可开局</div>
              <div className="space-y-2 mb-6">
                {currentRoom.players.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 text-lg justify-center">
                    <span className={p.isReady ? 'text-green-400' : 'text-white/40'}>{p.isReady ? '✅' : '⏳'}</span>
                    <span className="text-white">{p.name}{p.id === myPlayerId ? '(你)' : ''}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 justify-center">
                {!isReady && (
                  <button
                    onClick={handleReady}
                    className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-lg"
                  >
                    准备
                  </button>
                )}
                {isReady && (
                  <button
                    onClick={handleCancelReady}
                    className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-lg"
                  >
                    取消准备
                  </button>
                )}
                {isHost && canStartGame && (
                  <button
                    onClick={handleStartGame}
                    className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-lg animate-pulse"
                  >
                    🎲 开局
                  </button>
                )}
                <button
                  onClick={handleLeaveGame}
                  className="px-6 py-3 bg-red-700 text-white rounded-lg hover:bg-red-800 font-bold text-lg"
                >
                  {currentRoom && currentRoom.players.length > 1 ? '投票离开' : '离开'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const players = currentRoom.players
  const myBet = gameState.roundBets?.[myPlayerId || ''] || 0
  const toCall = (gameState.currentBet || 0) - myBet
  const myChips = currentPlayer?.chips || 0
  const minRaise = gameState.minRaise || currentRoom.config.bigBlind
  const maxRaise = myChips
  const totalPot = (gameState.pots || []).reduce((sum: number, pot: any) => sum + (pot.amount || 0), 0)

  const activePlayers = players.filter(p => gameState.playerStatus?.[p.id] !== undefined)

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
    <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-950 select-none overflow-hidden">
      {showVoteModal && voteInfo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md p-6">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">
              离开房间投票
            </h2>
            <p className="text-white/80 text-center mb-6">
              <span className="text-yellow-400 font-bold">{voteInfo.initiatorName}</span> 发起离开投票
            </p>

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
                      {vote === undefined && <span className="text-white/40">等待中...</span>}
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
      <div className="h-screen flex flex-col">
        {isReconnecting && (
          <div className="bg-red-600 text-white text-center py-2 text-sm font-bold animate-pulse">
            ⚠ 连接断开，正在尝试重新连接...
          </div>
        )}
        {!isConnected && !isReconnecting && (
          <div className="bg-red-800 text-white text-center py-2 text-sm font-bold">
            ❌ 连接已断开，请刷新页面
          </div>
        )}
        <div className="flex justify-between items-center px-4 py-2 bg-black/30">
          <h1 className="text-lg font-bold text-white">{currentRoom.config.roomName}</h1>
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
              onClick={handleLeaveGame}
              className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              {currentRoom && currentRoom.players.length > 1 ? '投票离开' : '离开'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {showActionLog && (
            <div className="w-56 flex-shrink-0">
              <ActionLog logs={actionLogs} onClear={clearLogs} />
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
                    底池: ${totalPot}
                  </div>
                  <div className="flex gap-1.5 mb-2">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i}>
                        {i < (gameState.communityCards?.length || 0)
                          ? renderCard(gameState.communityCards[i])
                          : <div className="w-14 h-20 border-2 border-dashed border-green-500/30 rounded-lg" />
                        }
                      </div>
                    ))}
                  </div>
                  {(gameState.currentBet || 0) > 0 && (
                    <div className="text-white/70 text-sm">当前注: ${gameState.currentBet}</div>
                  )}
                </div>
              </div>

              {reorderedPlayers.map((player, idx) => {
                const pos = positions[idx]
                const isMe = player.id === myPlayerId
                const isCurrentTurn = player.id === gameState.currentPlayerId
                const status = gameState.playerStatus?.[player.id]
                const role = gameState.playerRoles?.[player.id]
                const bet = gameState.roundBets?.[player.id] || 0
                const isFolded = status === 'folded'
                const isAllIn = status === 'all_in'

                return (
                  <div
                    key={player.id}
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${
                      isCurrentTurn && !isFolded ? 'scale-110' : ''
                    } ${isFolded ? 'opacity-40' : ''}`}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    <div className="flex flex-col items-center">
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
                        {role && getRoleName(role) && (
                          <div className="absolute -top-1 -left-1 w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                            {getRoleName(role)}
                          </div>
                        )}
                        {isAllIn && (
                          <div className="absolute -top-1 -right-1 bg-red-600 text-white text-[8px] px-1 rounded-full font-bold">
                            ALL IN
                          </div>
                        )}
                        {isWaitingForStart && player.isReady && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold shadow">
                            ✓
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
                      {isMe && myCards && (
                        <div className="flex gap-1 mt-1">
                          {myCards.map((card, ci) => {
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
                      {!isMe && status === 'playing' && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && (
                        <div className="flex gap-1 mt-1">
                          <div className="w-14 h-20 bg-gradient-to-br from-blue-700 to-blue-900 rounded-lg border-2 border-blue-400 flex items-center justify-center shadow-md">
                            <span className="text-blue-300 text-lg">?</span>
                          </div>
                          <div className="w-14 h-20 bg-gradient-to-br from-blue-700 to-blue-900 rounded-lg border-2 border-blue-400 flex items-center justify-center shadow-md">
                            <span className="text-blue-300 text-lg">?</span>
                          </div>
                        </div>
                      )}
                      {!isMe && (gameState.phase === 'showdown' || gameState.phase === 'ended') && status !== 'folded' && (
                        <div className="text-white/40 text-[9px] mt-0.5">已摊牌</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </div>
          <div className="w-64 flex-shrink-0">
            <ChatBox />
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
              ) : toCall >= myChips ? (
                <button
                  onClick={() => handleAction('all-in')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-bold text-sm"
                >
                  全押 ${myChips}
                </button>
              ) : (
                <button
                  onClick={() => handleAction('call')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-bold text-sm"
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
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-bold text-sm"
                >
                  加注
                </button>
              )}
              {toCall > 0 && toCall < myChips && (
                <button
                  onClick={() => handleAction('all-in')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-bold text-sm"
                >
                  全押 ${myChips}
                </button>
              )}
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
                    onClick={() => setRaiseAmount(Math.floor(maxRaise / 2))}
                    className="px-2 py-1 bg-white/10 rounded text-white/80 text-xs hover:bg-white/20"
                  >
                    1/2
                  </button>
                  <button
                    onClick={() => setRaiseAmount(maxRaise)}
                    className="px-2 py-1 bg-white/10 rounded text-white/80 text-xs hover:bg-white/20"
                  >
                    Max
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

        {!isMyTurn && !showResult && !isWaitingForStart && gameState.phase !== 'showdown' && gameState.phase !== 'ended' && gameState.phase !== 'waiting' && (
          <div className="text-center text-white/40 text-sm py-3 bg-black/30">
            等待其他玩家行动...
          </div>
        )}

        {isWaitingForStart && (
          <div className="bg-gray-900/90 border-t border-gray-700 p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {currentRoom.players.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-1 text-sm">
                    <span className={p.isReady ? 'text-green-400' : 'text-white/40'}>
                      {p.isReady ? '✅' : '⏳'}
                    </span>
                    <span className="text-white/80">{p.name}{p.id === myPlayerId ? '(你)' : ''}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                {isReady && (
                  <button
                    onClick={handleCancelReady}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-sm"
                  >
                    取消准备
                  </button>
                )}
                {!isReady && (
                  <button
                    onClick={handleReady}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-sm"
                  >
                    准备下一局
                  </button>
                )}
                {isHost && canStartGame && (
                  <button
                    onClick={handleStartGame}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-bold text-sm animate-pulse"
                  >
                    🎲 开局
                  </button>
                )}
                <button
                  onClick={handleLeaveGame}
                  className="px-4 py-2 bg-red-700 text-white rounded-lg hover:bg-red-800 font-bold text-sm"
                >
                  {currentRoom && currentRoom.players.length > 1 ? '投票离开' : '离开'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showResult && winners && winners.length > 0 && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 max-w-lg w-full mx-4 border border-gray-600 max-h-[85vh] overflow-y-auto">
              <h2 className="text-2xl font-bold text-white text-center mb-4">🏆 本局结束</h2>

              {resultCommunityCards.length > 0 && (
                <div className="mb-4 p-3 bg-blue-900/30 rounded-lg border border-blue-600/30">
                  <p className="text-white/60 text-xs mb-2 text-center">公共牌</p>
                  <div className="flex gap-1.5 justify-center">
                    {resultCommunityCards.map((card, i) => {
                      const suitSymbol: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
                      const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
                      return (
                        <div key={i} className={`w-11 h-16 bg-white rounded border border-gray-300 flex flex-col items-center justify-center ${isRed ? 'text-red-600' : 'text-black'}`}>
                          <span className="font-bold text-sm">{card.rank}</span>
                          <span className="text-base">{suitSymbol[card.suit]}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {allHands.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {allHands.map((hand, i) => {
                    const isMe = hand.playerId === myPlayerId
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
                      <div className="text-white/80 mt-1">{winner.handDescription || winner.handRank}</div>
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
                {players.map(p => {
                  const profit = p.chips - (p.totalBuyIn || initialChips)
                  return (
                    <div key={p.id} className="flex justify-between text-white text-sm py-1">
                      <span>{p.name} {p.id === myPlayerId ? '(你)' : ''}</span>
                      <span>
                        <span className="text-yellow-300">${p.chips}</span>
                        <span className={`ml-2 ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ({profit >= 0 ? '+' : ''}{profit})
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleReady}
                  className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-lg"
                >
                  准备下一局
                </button>
                <button
                  onClick={handleLeaveGame}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-lg"
                >
                  {currentRoom && currentRoom.players.length > 1 ? '投票离开' : '离开'}
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
                {[...players]
                  .sort((a, b) => b.chips - a.chips)
                  .map((p, idx) => {
                    const profit = p.chips - (p.totalBuyIn || initialChips)
                    const rebuyCount = Math.max(0, Math.floor(((p.totalBuyIn || initialChips) - initialChips) / initialChips))
                    return (
                      <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg ${
                        p.id === myPlayerId ? 'bg-green-900/40 border border-green-600/30' : 'bg-white/5'
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className="text-white/40 font-bold w-6">#{idx + 1}</span>
                          <div>
                            <div className="text-white font-bold text-sm">
                              {p.name} {p.id === myPlayerId ? '(你)' : ''}
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
