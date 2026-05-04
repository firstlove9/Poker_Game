import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Lock, Unlock } from 'lucide-react'
import { validateRoomName } from '../utils/validation'

interface CreateRoomModalProps {
  onClose: () => void
  onCreate: (config: any) => void
}

export default function CreateRoomModal({ onClose, onCreate }: CreateRoomModalProps) {
  const [config, setConfig] = useState({
    roomName: '',
    maxPlayers: 9,
    smallBlind: 10,
    bigBlind: 20,
    buyInMin: 1000,
    buyInMax: 10000,
    isPrivate: false,
    password: '',
  })
  const [roomNameError, setRoomNameError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (config.roomName.trim()) {
      const validation = validateRoomName(config.roomName)
      if (!validation.valid) {
        setRoomNameError(validation.error || '房间名称无效')
        return
      }
    }
    setRoomNameError('')
    onCreate(config)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-panel w-full max-w-md p-6"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">创建房间</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 房间名称 */}
          <div>
            <label className="block text-white/80 text-sm mb-2">房间名称</label>
            <input
              type="text"
              value={config.roomName}
              onChange={(e) => { setConfig({ ...config, roomName: e.target.value }); setRoomNameError('') }}
              placeholder="输入房间名称"
              className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg 
                         text-white placeholder-white/40 focus:outline-none focus:border-gold"
              required
            />
            {roomNameError && (
              <p className="text-red-400 text-xs mt-1">{roomNameError}</p>
            )}
          </div>

          {/* 人数 */}
          <div>
            <label className="block text-white/80 text-sm mb-2">最大人数: {config.maxPlayers}</label>
            <input
              type="range"
              min="2"
              max="12"
              value={config.maxPlayers}
              onChange={(e) => setConfig({ ...config, maxPlayers: parseInt(e.target.value) })}
              className="w-full accent-gold"
            />
            <div className="flex justify-between text-white/40 text-xs">
              <span>2人</span>
              <span>12人</span>
            </div>
          </div>

          {/* 盲注 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white/80 text-sm mb-2">小盲注</label>
              <select
                value={config.smallBlind}
                onChange={(e) => {
                  const sb = parseInt(e.target.value)
                  setConfig({ ...config, smallBlind: sb, bigBlind: sb * 2 })
                }}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg 
                           text-white focus:outline-none focus:border-gold"
              >
                <option value={5} className="bg-gray-800 text-white">5</option>
                <option value={10} className="bg-gray-800 text-white">10</option>
                <option value={25} className="bg-gray-800 text-white">25</option>
                <option value={50} className="bg-gray-800 text-white">50</option>
                <option value={100} className="bg-gray-800 text-white">100</option>
              </select>
            </div>
            <div>
              <label className="block text-white/80 text-sm mb-2">大盲注</label>
              <input
                type="text"
                value={config.bigBlind}
                disabled
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg 
                           text-white/60"
              />
            </div>
          </div>

          {/* 买入 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white/80 text-sm mb-2">最小买入</label>
              <input
                type="number"
                value={config.buyInMin}
                onChange={(e) => setConfig({ ...config, buyInMin: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg 
                           text-white focus:outline-none focus:border-gold"
                min={100}
                step={100}
              />
            </div>
            <div>
              <label className="block text-white/80 text-sm mb-2">最大买入</label>
              <input
                type="number"
                value={config.buyInMax}
                onChange={(e) => setConfig({ ...config, buyInMax: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg 
                           text-white focus:outline-none focus:border-gold"
                min={config.buyInMin}
                step={100}
              />
            </div>
          </div>

          {/* 私密房间 */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.isPrivate}
                onChange={(e) => setConfig({ ...config, isPrivate: e.target.checked })}
                className="w-5 h-5 accent-gold"
              />
              <span className="text-white/80 flex items-center gap-2">
                {config.isPrivate ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                私密房间
              </span>
            </label>
          </div>

          {/* 密码 */}
          {config.isPrivate && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
            >
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({ ...config, password: e.target.value })}
                placeholder="设置房间密码"
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg 
                           text-white placeholder-white/40 focus:outline-none focus:border-gold"
                required={config.isPrivate}
              />
            </motion.div>
          )}

          {/* 按钮 */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-poker-secondary"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 btn-poker-primary"
            >
              创建
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
