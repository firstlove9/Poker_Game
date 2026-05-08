import { useState, useRef, useEffect } from 'react'
import { Send, Smile } from 'lucide-react'
import { useSocketStore } from '../stores/socketStore'
import { useGameStore } from '../stores/gameStore'
import { ClientEvents, ServerEvents } from '../types'

const EMOJI_TABS = [
  {
    label: '😊',
    emojis: [
      '😊', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂',
      '😉', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪',
      '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨',
      '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒',
      '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯',
      '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😱', '😨',
      '😰', '😥', '😢', '😭', '😤', '😡', '🤬', '😈',
    ],
  },
  {
    label: '👋',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️',
      '🖖', '👋', '🤝', '🙏', '💪', '🦾', '👏', '🙌',
      '👐', '🤲', '🤝', '👊', '✊', '🤛', '🤜', '🫡',
      '🫶', '🫰', '🫱', '🫲', '🫳', '🫴', '🫵', '🫶',
    ],
  },
  {
    label: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗',
      '💖', '💘', '💝', '💟', '♥️', '💋', '🫂', '💑',
    ],
  },
  {
    label: '🎮',
    emojis: [
      '🔥', '⭐', '✨', '💫', '🌟', '💰', '💎', '🃏',
      '🎰', '🏆', '🎉', '🎊', '🍀', '🎲', '🎯', '👑',
      '🀄', '🧧', '💰', '💵', '💸', '💳', '🪙', '🧲',
      '🎮', '🕹️', '🃏', '🎴', '🀄', '🎱', '🪄', '🔮',
      '🧿', '🪬', '🧩', '🎭', '🎨', '🎬', '🎤', '🎧',
      '🎵', '🎶', '🎼', '🎹', '🥁', '🎸', '🎺', '🎷',
    ],
  },
  {
    label: '🍔',
    emojis: [
      '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙',
      '🧆', '🥗', '🥘', '🥫', '🍝', '🍜', '🍲', '🍛',
      '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘',
      '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦',
      '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫',
      '🍿', '🧈', '🥜', '🌰', '🫒', '🧂', '☕', '🍵',
      '🧃', '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🥃',
      '🍸', '🍹', '🧉', '🍾', '🫗', '🥛', '🍼', '🫖',
    ],
  },
]

export default function ChatBox() {
  const { emit, on, off, playerId: myPlayerId } = useSocketStore()
  const { messages, addMessage } = useGameStore()
  const [inputMessage, setInputMessage] = useState('')
  const [showEmojis, setShowEmojis] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const emojiPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleChatMessage = (data: any) => {
      addMessage(data)
    }

    on(ServerEvents.CHAT_MESSAGE, handleChatMessage)
    return () => off(ServerEvents.CHAT_MESSAGE, handleChatMessage)
  }, [on, off, addMessage])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!showEmojis) return
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(e.target as Node)) {
        setShowEmojis(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showEmojis])

  const handleSend = async () => {
    if (!inputMessage.trim()) return

    try {
      await emit(ClientEvents.SEND_CHAT, { message: inputMessage.trim() })
      setInputMessage('')
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const handleEmojiClick = (emoji: string) => {
    setInputMessage(prev => prev + emoji)
  }

  return (
    <div className="h-full bg-gray-900/95 border-l border-gray-700/50 flex flex-col relative">
      <div className="px-3 py-2 border-b border-gray-700/50">
        <h3 className="text-white font-bold text-sm">💬 聊天</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.length === 0 ? (
          <p className="text-white/40 text-center text-xs py-4">暂无消息</p>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.playerId === myPlayerId
            return (
              <div key={index} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${isMe ? 'order-1' : ''}`}>
                  {!isMe && (
                    <div className="text-yellow-300/70 text-[10px] mb-0.5 px-1">{msg.playerName}</div>
                  )}
                  <div className={`px-2.5 py-1.5 rounded-lg text-xs leading-relaxed break-words ${
                    isMe
                      ? 'bg-green-600/80 text-white rounded-tr-sm'
                      : 'bg-white/10 text-white/90 rounded-tl-sm'
                  }`}>
                    {msg.message}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {showEmojis && (
        <div
          ref={emojiPanelRef}
          className="border-t border-gray-700/50 bg-gray-800/95"
        >
          <div className="flex border-b border-gray-700/50">
            {EMOJI_TABS.map((tab, i) => (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`flex-1 py-1.5 text-base transition-colors ${
                  activeTab === i
                    ? 'bg-white/10 border-b-2 border-yellow-400'
                    : 'hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="p-1.5 max-h-36 overflow-y-auto">
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJI_TABS[activeTab].emojis.map((emoji, i) => (
                <button
                  key={i}
                  onClick={() => handleEmojiClick(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-lg hover:bg-white/15 rounded transition-colors active:scale-110"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="p-2 border-t border-gray-700/50">
        <div className="flex gap-1">
          <button
            onClick={() => { setShowEmojis(!showEmojis) }}
            className={`p-1.5 rounded-lg transition-colors ${
              showEmojis
                ? 'bg-yellow-600 text-white'
                : 'bg-white/10 text-white/60 hover:text-white hover:bg-white/20'
            }`}
          >
            <Smile className="w-3.5 h-3.5" />
          </button>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="输入消息..."
            className="flex-1 px-2 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-yellow-400 text-xs"
            maxLength={100}
          />
          <button
            onClick={handleSend}
            disabled={!inputMessage.trim()}
            className="p-1.5 bg-yellow-600 text-white rounded-lg disabled:opacity-50 hover:bg-yellow-700 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
