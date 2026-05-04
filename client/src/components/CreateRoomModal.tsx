import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Lock, Unlock, HelpCircle, ChevronRight } from 'lucide-react'
import { validateRoomName } from '../utils/validation'
import {
  GameVariant,
  GameModifier,
  VARIANT_RULES,
  MODIFIER_INFO,
  MixedRotationConfig,
} from '../types'
import VariantSelectorModal from './VariantSelectorModal'

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
    gameVariant: GameVariant.TEXAS_NLHE,
    gameModifier: GameModifier.NONE,
    mixedRotation: null as MixedRotationConfig | null,
  })
  const [roomNameError, setRoomNameError] = useState('')
  const [showVariantSelector, setShowVariantSelector] = useState(false)
  const [showVariantHelp, setShowVariantHelp] = useState(false)

  const currentRule = VARIANT_RULES[config.gameVariant]
  const currentModifier = MODIFIER_INFO[config.gameModifier]
  const variantMaxPlayers = currentRule.maxPlayers

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
        className="glass-panel w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">创建房间</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm mb-2">玩法</label>
            <button
              type="button"
              onClick={() => setShowVariantSelector(true)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/20 bg-white/5 hover:border-gold/50 hover:bg-gold/5 transition-all text-left"
            >
              <span className="text-2xl">{currentRule.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-white">
                  {currentRule.name}
                  {config.gameModifier !== GameModifier.NONE && (
                    <span className="text-red-400 ml-1">+ {currentModifier.icon} {currentModifier.name}</span>
                  )}
                </div>
                <div className="text-xs text-white/50 truncate">
                  {currentRule.shortDesc}
                  {config.mixedRotation && (
                    <span className="text-blue-400 ml-1">
                      | 🔀 混合轮换({config.mixedRotation.variants.length}种×{config.mixedRotation.handsPerVariant}局)
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/30" />
            </button>
            <div className="flex gap-2 mt-1.5">
              {currentRule.isFixedLimit && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">限注</span>
              )}
              {currentRule.isPotLimit && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">底池限注</span>
              )}
              {currentRule.forceCombination === '2+3' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">强制2+3</span>
              )}
              {currentRule.boardCount > 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                  {currentRule.boardCount}板面
                </span>
              )}
              {config.gameModifier !== GameModifier.NONE && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                  {currentModifier.icon} {currentModifier.name}
                </span>
              )}
              {config.mixedRotation && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">混合轮换</span>
              )}
              <button
                type="button"
                onClick={() => setShowVariantHelp(true)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/40 hover:text-gold flex items-center gap-0.5"
              >
                <HelpCircle className="w-3 h-3" />
                规则
              </button>
            </div>
          </div>

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

          <div>
            <label className="block text-white/80 text-sm mb-2">最大人数: {config.maxPlayers} <span className="text-white/40 text-xs">（{variantMaxPlayers}人上限）</span></label>
            <input
              type="range"
              min="2"
              max={variantMaxPlayers}
              value={Math.min(config.maxPlayers, variantMaxPlayers)}
              onChange={(e) => setConfig({ ...config, maxPlayers: parseInt(e.target.value) })}
              className="w-full accent-gold"
            />
            <div className="flex justify-between text-white/40 text-xs">
              <span>2人</span>
              <span>{variantMaxPlayers}人</span>
            </div>
          </div>

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

      {showVariantSelector && (
        <VariantSelectorModal
          selectedVariant={config.gameVariant}
          selectedModifier={config.gameModifier}
          mixedRotation={config.mixedRotation}
          onVariantSelect={(variant) => {
            const rule = VARIANT_RULES[variant]
            const newMax = Math.min(config.maxPlayers, rule.maxPlayers)
            setConfig({ ...config, gameVariant: variant, maxPlayers: newMax })
          }}
          onModifierSelect={(modifier) => setConfig({ ...config, gameModifier: modifier })}
          onMixedRotationChange={(mr) => setConfig({ ...config, mixedRotation: mr })}
          onClose={() => setShowVariantSelector(false)}
        />
      )}

      {showVariantHelp && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-panel w-full max-w-md p-6"
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="text-2xl">{currentRule.icon}</span>
                {currentRule.name}
                {config.gameModifier !== GameModifier.NONE && (
                  <span className="text-base text-red-400">+ {currentModifier.icon} {currentModifier.name}</span>
                )}
              </h3>
              <button onClick={() => setShowVariantHelp(false)} className="text-white/60 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              {currentRule.fullDesc}
            </p>
            {currentRule.specialRules.length > 0 && (
              <div>
                <h4 className="text-white/90 font-semibold text-sm mb-2">基础规则</h4>
                <ul className="space-y-1">
                  {currentRule.specialRules.map((rule, i) => (
                    <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                      <span className="text-gold mt-0.5">•</span>
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {config.gameModifier !== GameModifier.NONE && currentModifier.specialRules.length > 0 && (
              <div className="mt-3">
                <h4 className="text-white/90 font-semibold text-sm mb-2 flex items-center gap-1">
                  <span>{currentModifier.icon}</span>
                  {currentModifier.name} 修饰规则
                </h4>
                <ul className="space-y-1">
                  {currentModifier.specialRules.map((rule, i) => (
                    <li key={i} className="text-red-300/80 text-sm flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span>
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-white/50">底牌数量</div>
                <div className="text-white/90">{currentRule.holeCardCount} 张</div>
                <div className="text-white/50">公共牌</div>
                <div className="text-white/90">{currentRule.communityCardCount} 张</div>
                <div className="text-white/50">板面数量</div>
                <div className="text-white/90">{currentRule.boardCount} 个</div>
                <div className="text-white/50">凑牌方式</div>
                <div className="text-white/90">
                  {currentRule.forceCombination === '2+3' ? '强制2+3' : currentRule.forceCombination === '3+2' ? '3+2自由' : '自由组合'}
                </div>
                <div className="text-white/50">下注方式</div>
                <div className="text-white/90">
                  {currentRule.isFixedLimit
                    ? '限注 (Fixed-Limit)'
                    : currentRule.isPotLimit
                    ? '底池限注 (Pot-Limit)'
                    : '无限注 (No-Limit)'}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowVariantHelp(false)}
              className="w-full mt-4 btn-poker-primary"
            >
              知道了
            </button>
          </motion.div>
        </div>
      )}
    </div>
  )
}
