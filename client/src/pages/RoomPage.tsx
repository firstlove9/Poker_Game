import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, Play, Check, X, Coins, HelpCircle } from 'lucide-react'
import { useSocketStore } from '../stores/socketStore'
import { useGameStore } from '../stores/gameStore'
import { useToastStore } from '../stores/toastStore'
import { ClientEvents, ServerEvents, GameVariant, GameModifier, VARIANT_RULES, MODIFIER_INFO } from '../types'
import PlayerSeat from '../components/PlayerSeat'

interface VoteInfo {
  initiatorId: string
  initiatorName: string
  votes: Record<string, boolean>
  totalPlayers: number
  votedPlayers: number
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { emit, on, off, isConnected, isReconnecting, playerId: socketPlayerId } = useSocketStore()
  const addToast = useToastStore((s) => s.addToast)
  const { currentRoom, currentPlayer, setCurrentRoom, setCurrentPlayer } = useGameStore()

  const [voteInfo, setVoteInfo] = useState<VoteInfo | null>(null)
  const [showVoteModal, setShowVoteModal] = useState(false)
  const [showRuleHelp, setShowRuleHelp] = useState(false)

  const getMyPlayerId = () => {
    try {
      return socketPlayerId || sessionStorage.getItem('poker_player_id')
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!roomId) return

    const handleRoomUpdated = (data: any) => {
      setCurrentRoom(data.room)
    }

    const handlePlayerJoined = (data: any) => {
      setCurrentRoom(data.room)
    }

    const handlePlayerLeft = (data: any) => {
      setCurrentRoom(data.room)
    }

    const handlePlayerReadyChanged = (data: any) => {
      setCurrentRoom(data.room)
    }

    const handleGameStarted = (data: any) => {
      setCurrentRoom(data.room)
      navigate(`/game/${roomId}`)
    }

    const handleVoteLeaveStarted = (data: VoteInfo) => {
      setVoteInfo(data)
      setShowVoteModal(true)
    }

    const handleVoteLeaveResponse = (data: any) => {
      setVoteInfo((prev: VoteInfo | null) => prev ? {
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
        navigate('/lobby')
      } else {
        addToast(`投票未通过！${data.approvedCount}/${data.totalPlayers} 人同意`, 'error')
      }
    }

    const handleRoomLeft = (data: any) => {
      if (data.reason === 'vote') {
        navigate('/lobby')
      }
    }

    on(ServerEvents.ROOM_UPDATED, handleRoomUpdated)
    on(ServerEvents.PLAYER_JOINED, handlePlayerJoined)
    on(ServerEvents.PLAYER_LEFT, handlePlayerLeft)
    on(ServerEvents.PLAYER_READY_CHANGED, handlePlayerReadyChanged)
    on(ServerEvents.GAME_STARTED, handleGameStarted)
    on(ServerEvents.VOTE_LEAVE_STARTED, handleVoteLeaveStarted)
    on(ServerEvents.VOTE_LEAVE_RESPONSE, handleVoteLeaveResponse)
    on(ServerEvents.VOTE_LEAVE_ENDED, handleVoteLeaveEnded)
    on(ServerEvents.ROOM_LEFT, handleRoomLeft)

    fetchRoomInfo()

    return () => {
      off(ServerEvents.ROOM_UPDATED, handleRoomUpdated)
      off(ServerEvents.PLAYER_JOINED, handlePlayerJoined)
      off(ServerEvents.PLAYER_LEFT, handlePlayerLeft)
      off(ServerEvents.PLAYER_READY_CHANGED, handlePlayerReadyChanged)
      off(ServerEvents.GAME_STARTED, handleGameStarted)
      off(ServerEvents.VOTE_LEAVE_STARTED, handleVoteLeaveStarted)
      off(ServerEvents.VOTE_LEAVE_RESPONSE, handleVoteLeaveResponse)
      off(ServerEvents.VOTE_LEAVE_ENDED, handleVoteLeaveEnded)
      off(ServerEvents.ROOM_LEFT, handleRoomLeft)
    }
  }, [roomId, on, off, setCurrentRoom, navigate, socketPlayerId, currentPlayer?.id])

  useEffect(() => {
    if (isConnected && roomId) {
      fetchRoomInfo()
    }
  }, [isConnected])

  const fetchRoomInfo = async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`)
      if (!response.ok) {
        addToast('房间不存在或已关闭', 'error')
        navigate('/lobby')
        return
      }
      const data = await response.json()
      if (data.success) {
        setCurrentRoom(data.room)
        const pid = getMyPlayerId()
        const player = data.room.players.find((p: any) => p.id === pid)
        if (player) {
          setCurrentPlayer(player)
        }
      } else {
        addToast('房间不存在或已关闭', 'error')
        navigate('/lobby')
      }
    } catch (error) {
      console.error('Failed to fetch room info:', error)
      addToast('无法连接服务器', 'error')
      navigate('/lobby')
    }
  }

  const handleLeaveRoom = async () => {
    const pid = getMyPlayerId()
    const myPlayer = currentRoom?.players.find((p: any) => p.id === pid)
    const role = myPlayer?.playerRoomRole
    const needVote = role === 'active'
      && currentRoom?.status === 'playing'
      && pid
      && currentRoom?.gameState?.playerStatus?.[pid] !== undefined
      && currentRoom?.gameState?.playerStatus?.[pid] !== 'folded'

    if (needVote) {
      try {
        await emit(ClientEvents.VOTE_LEAVE)
      } catch (error: any) {
        addToast(error.message || '发起投票失败', 'error')
      }
    } else {
      try {
        await emit(ClientEvents.LEAVE_ROOM)
        setCurrentRoom(null)
        navigate('/lobby')
      } catch (error: any) {
        addToast(error.message || '离开失败', 'error')
      }
    }
  }

  const handleVoteResponse = async (approve: boolean) => {
    try {
      await emit(ClientEvents.VOTE_LEAVE_RESPONSE, { approve })
    } catch (error: any) {
      addToast(error.message || '投票失败', 'error')
    }
  }

  const handleToggleReady = async () => {
    const pid = getMyPlayerId()
    const currentReady = currentRoom?.players.find((p: any) => p.id === pid)?.isReady ?? false
    try {
      await emit(ClientEvents.PLAYER_READY, !currentReady)
    } catch (error) {
      console.error('Failed to toggle ready:', error)
    }
  }

  const handleStartGame = async () => {
    try {
      const result = await emit(ClientEvents.START_GAME)
      if (!result?.success) {
        console.warn('无法开局：' + (result?.error || '未知原因'))
      }
    } catch (error: any) {
      console.warn('无法开局：' + (error.message || '未知原因'))
    }
  }

  if (!currentRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white text-xl">加载中...</div>
      </div>
    )
  }

  const myPid = getMyPlayerId()
  const myRoomPlayer = currentRoom.players.find((p: any) => p.id === myPid)
  const isHost = myPid === currentRoom.config.hostId
  const isReady = myRoomPlayer?.isReady ?? false
  const readyPlayers = currentRoom.players.filter(p => p.isReady).length
  const canStart = isHost && readyPlayers >= (currentRoom.config.minPlayers || 2)
  const isPlaying = currentRoom.status === 'playing'
  const isSpectator = myRoomPlayer?.playerRoomRole === 'spectator'

  return (
    <div className="min-h-screen p-4 md:p-8">
      {isReconnecting && (
        <div className="bg-red-600 text-white text-center py-2 text-sm font-bold animate-pulse mb-4 rounded-lg">
          ⚠ 连接断开，正在尝试重新连接...
        </div>
      )}
      {!isConnected && !isReconnecting && (
        <div className="bg-red-800 text-white text-center py-2 text-sm font-bold mb-4 rounded-lg">
          ❌ 连接已断开，请刷新页面
        </div>
      )}
      {/* 投票离开弹窗 */}
      {showVoteModal && voteInfo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="glass-panel w-full max-w-md p-6">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">
              离开房间投票
            </h2>
            <p className="text-white/80 text-center mb-6">
              <span className="text-gold font-bold">{voteInfo.initiatorName}</span> 发起离开投票
            </p>

            <div className="mb-6">
              <p className="text-white/60 text-sm mb-3">投票进度: {voteInfo.votedPlayers}/{voteInfo.totalPlayers}</p>
              <div className="space-y-2">
                {currentRoom.players.map(player => {
                  const vote = voteInfo.votes[player.id]
                  return (
                    <div key={player.id} className="flex justify-between items-center text-white/80">
                      <span>
                        {player.name}
                        {player.id === currentPlayer?.id && ' (我)'}
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

            {voteInfo.votes[currentPlayer?.id || ''] === undefined && (
              <div className="flex gap-3">
                <button
                  onClick={() => handleVoteResponse(true)}
                  className="flex-1 btn-poker-primary flex items-center justify-center gap-2"
                >
                  <Check className="w-5 h-5" />
                  同意离开
                </button>
                <button
                  onClick={() => handleVoteResponse(false)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <X className="w-5 h-5" />
                  拒绝离开
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 头部 */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="flex justify-between items-center">
          <button
            onClick={handleLeaveRoom}
            className="text-white/60 hover:text-white flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            {(() => {
              const pid = getMyPlayerId()
              const mp = currentRoom?.players.find((p: any) => p.id === pid)
              const role = mp?.playerRoomRole
              const needVote = role === 'active'
                && currentRoom?.status === 'playing'
                && pid
                && currentRoom?.gameState?.playerStatus?.[pid] !== undefined
                && currentRoom?.gameState?.playerStatus?.[pid] !== 'folded'
              if (role === 'spectator') return '观战中 · 返回大厅'
              if (needVote) return '投票离开'
              return '返回大厅'
            })()}
          </button>

          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">{currentRoom.config.roomName}</h1>
            <p className="text-white/40 text-sm">ID: {roomId}</p>
          </div>

          <div className="flex items-center gap-2 text-white/60">
            <Users className="w-5 h-5" />
            <span>{currentRoom.players.length}/{currentRoom.config.maxPlayers}</span>
          </div>
        </div>
      </div>

      {/* 房间信息 */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="glass-panel p-4">
          <div className="flex flex-wrap justify-center gap-6 text-sm">
            <div className="text-white/60 flex items-center gap-1">
              <span className="text-lg">{VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].icon}</span>
              <span className="text-gold font-bold">{VARIANT_RULES[currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE].name}</span>
              {currentRoom.config.gameModifier && currentRoom.config.gameModifier !== GameModifier.NONE && (
                <span className="text-red-400 font-bold text-xs">
                  + {MODIFIER_INFO[currentRoom.config.gameModifier].icon} {MODIFIER_INFO[currentRoom.config.gameModifier].name}
                </span>
              )}
              <button
                onClick={() => setShowRuleHelp(true)}
                className="text-white/40 hover:text-gold ml-1"
                title="查看规则"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
            <div className="text-white/60">
              小盲注: <span className="text-gold font-bold">{currentRoom.config.smallBlind}</span>
            </div>
            <div className="text-white/60">
              大盲注: <span className="text-gold font-bold">{currentRoom.config.bigBlind}</span>
            </div>
            <div className="text-white/60">
              买入: <span className="text-gold font-bold">{currentRoom.config.buyInMin}-{currentRoom.config.buyInMax}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 玩家座位 */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="relative">
          {/* 扑克桌 */}
          <div className="poker-table rounded-full aspect-[4/3] max-w-2xl mx-auto flex items-center justify-center">
            <div className="text-white/20 text-center">
              <p className="text-2xl font-bold mb-2">等待玩家</p>
              <p className="text-sm">{readyPlayers}/{currentRoom.players.length} 已准备</p>
            </div>
          </div>

          {/* 玩家座位 */}
          {(() => {
            const myIndex = currentRoom.players.findIndex(p => p.id === currentPlayer?.id)
            const reordered = myIndex < 0 ? currentRoom.players : [
              currentRoom.players[myIndex],
              ...currentRoom.players.slice(myIndex + 1),
              ...currentRoom.players.slice(0, myIndex),
            ]
            return reordered.map((player, index) => (
              <PlayerSeat
                key={player.id}
                player={player}
                index={index}
                totalPlayers={Math.max(currentRoom.players.length, 6)}
                isHost={player.id === currentRoom.config.hostId}
                isMe={player.id === currentPlayer?.id}
              />
            ))
          })()}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="max-w-4xl mx-auto mt-48 md:mt-0">
        <div className="glass-panel p-4">
          <div className="flex flex-wrap justify-center gap-4">
            {isSpectator ? (
              <div className="text-yellow-400 text-lg font-bold">
                👁️ 观战模式 — 牌局结束后可参与下一局
              </div>
            ) : isPlaying ? (
              <div className="text-gold text-lg font-bold animate-pulse">
                🎴 游戏进行中，请等待本局结束...
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-gold" />
                  <span className="text-white font-bold">{currentPlayer?.chips || 0}</span>
                </div>

                <button
                  onClick={handleToggleReady}
                  className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                    isReady
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isReady ? '取消准备' : '准备'}
                </button>

                {isHost && (
                  <button
                    onClick={handleStartGame}
                    disabled={!canStart}
                    className="btn-poker-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-5 h-5" />
                    开始游戏 ({readyPlayers}/{currentRoom.players.length})
                  </button>
                )}

                {!isHost && readyPlayers < currentRoom.players.length && (
                  <div className="text-white/60 text-sm">
                    等待房主开始游戏 ({readyPlayers}/{currentRoom.players.length} 已准备)
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 规则帮助弹窗 */}
      {showRuleHelp && (() => {
        const variant = currentRoom.config.gameVariant || GameVariant.TEXAS_NLHE
        const rule = VARIANT_RULES[variant]
        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="glass-panel w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <span className="text-2xl">{rule.icon}</span>
                  {rule.name}
                </h3>
                <button onClick={() => setShowRuleHelp(false)} className="text-white/60 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-white/80 text-sm leading-relaxed mb-4">
                {rule.fullDesc}
              </p>
              {rule.specialRules.length > 0 && (
                <div>
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
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-white/50">底牌数量</div>
                  <div className="text-white/90">{rule.holeCardCount} 张</div>
                  <div className="text-white/50">公共牌</div>
                  <div className="text-white/90">{rule.communityCardCount} 张</div>
                  <div className="text-white/50">下注方式</div>
                  <div className="text-white/90">{rule.isPotLimit ? '底池限注 (Pot-Limit)' : '无限注 (No-Limit)'}</div>
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
