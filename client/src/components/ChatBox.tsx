import { useState, useRef, useEffect } from 'react'
import { Send, Smile } from 'lucide-react'
import { useSocketStore } from '../stores/socketStore'
import { useGameStore } from '../stores/gameStore'
import { ClientEvents, ServerEvents } from '../types'

const EMOJI_LIST = [
  '😀', '😂', '🤣', '😊', '😎', '🤔', '😱', '😤',
  '👍', '👎', '👏', '🙌', '🤝', '💪', '✌️', '🤞',
  '❤️', '💔', '🔥', '⭐', '💰', '💎', '🃏', '🎰',
  '🏆', '🎉', '🎊', '🍀', '🎲', '🎯', '👑', '🤑',
]

export default function ChatBox() {
  const { emit, on, off } = useSocketStore()
  const { messages, addMessage } = useGameStore()
  const [inputMessage, setInputMessage] = useState('')
  const [showEmojis, setShowEmojis] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  const handleSend = async () => {
    if (!inputMessage.trim()) return

    try {
      await emit(ClientEvents.SEND_CHAT, { message: inputMessage.trim() })
      setInputMessage('')
      setShowEmojis(false)
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const handleEmojiClick = (emoji: string) => {
    setInputMessage(prev => prev + emoji)
  }

  return (
    <div className="h-full bg-gray-900/95 border-l border-gray-700/50 flex flex-col">
      <div className="px-3 py-2 border-b border-gray-700/50">
        <h3 className="text-white font-bold text-sm">💬 聊天</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {messages.length === 0 ? (
          <p className="text-white/40 text-center text-xs py-4">暂无消息</p>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className="text-xs">
              <span className="text-yellow-300 font-medium">{msg.playerName}:</span>
              <span className="text-white/80 ml-1">{msg.message}</span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {showEmojis && (
        <div className="border-t border-gray-700/50 p-1">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_LIST.map((emoji, i) => (
              <button
                key={i}
                onClick={() => handleEmojiClick(emoji)}
                className="w-7 h-7 flex items-center justify-center text-sm hover:bg-white/10 rounded transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-2 border-t border-gray-700/50">
        <div className="flex gap-1">
          <button
            onClick={() => setShowEmojis(!showEmojis)}
            className={`p-1.5 rounded-lg transition-colors ${showEmojis ? 'bg-yellow-600 text-white' : 'bg-white/10 text-white/60 hover:text-white hover:bg-white/20'}`}
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
