import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, HelpCircle, ChevronRight, ArrowLeft, Plus, Minus, Shuffle } from 'lucide-react'
import {
  GameVariant,
  GameModifier,
  VARIANT_RULES,
  VARIANT_CATEGORIES,
  MODIFIER_INFO,
  VariantRuleInfo,
  ModifierInfo,
  MixedRotationConfig,
} from '../types'

type TabType = 'variant' | 'modifier' | 'mixed'

interface VariantSelectorModalProps {
  selectedVariant: GameVariant
  selectedModifier: GameModifier
  mixedRotation: MixedRotationConfig | null
  onVariantSelect: (variant: GameVariant) => void
  onModifierSelect: (modifier: GameModifier) => void
  onMixedRotationChange: (config: MixedRotationConfig | null) => void
  onClose: () => void
}

export default function VariantSelectorModal({
  selectedVariant,
  selectedModifier,
  mixedRotation,
  onVariantSelect,
  onModifierSelect,
  onMixedRotationChange,
  onClose,
}: VariantSelectorModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('variant')
  const [detailVariant, setDetailVariant] = useState<GameVariant | null>(null)
  const [detailModifier, setDetailModifier] = useState<GameModifier | null>(null)

  const categories = Object.entries(VARIANT_CATEGORIES) as [string, string][]
  const modifiers = Object.values(MODIFIER_INFO) as ModifierInfo[]
  const activeModifiers = modifiers.filter((m) => m.id !== GameModifier.NONE)

  const handleVariantSelect = (variant: GameVariant) => {
    onVariantSelect(variant)
  }

  const handleModifierSelect = (modifier: GameModifier) => {
    onModifierSelect(modifier)
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'variant', label: '基础玩法', icon: <span className="text-sm">🤠</span> },
    { key: 'modifier', label: '特殊修饰', icon: <span className="text-sm">💣</span> },
    { key: 'mixed', label: '混合轮换', icon: <Shuffle className="w-4 h-4" /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-panel w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">玩法配置</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex gap-1 mb-4 bg-white/5 rounded-lg p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-gold/20 text-gold'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'variant' && (
          <div className="space-y-5">
            {categories.map(([catKey, catName]) => {
              const variants = (Object.values(VARIANT_RULES) as VariantRuleInfo[]).filter(
                (v) => v.category === catKey
              )
              if (variants.length === 0) return null
              return (
                <div key={catKey}>
                  <div className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                    {catName}
                  </div>
                  <div className="space-y-2">
                    {variants.map((rule) => {
                      const isSelected = selectedVariant === rule.id
                      return (
                        <button
                          key={rule.id}
                          type="button"
                          onClick={() => handleVariantSelect(rule.id)}
                          className={`relative w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                            isSelected
                              ? 'border-gold bg-gold/10 text-white'
                              : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/8'
                          }`}
                        >
                          <span className="text-2xl flex-shrink-0">{rule.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{rule.name}</div>
                            <div className="text-xs opacity-60 truncate">{rule.shortDesc}</div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isSelected && (
                              <span className="text-gold text-xs font-medium mr-1">已选</span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDetailVariant(rule.id)
                              }}
                              className="text-white/30 hover:text-gold p-1"
                            >
                              <HelpCircle className="w-4 h-4" />
                            </button>
                            <ChevronRight className="w-4 h-4 text-white/20" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'modifier' && (
          <div className="space-y-5">
            <div className="text-white/50 text-xs mb-3">
              特殊修饰可与基础玩法组合使用，改变翻前行动规则
            </div>

            <button
              type="button"
              onClick={() => handleModifierSelect(GameModifier.NONE)}
              className={`relative w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                selectedModifier === GameModifier.NONE
                  ? 'border-gold bg-gold/10 text-white'
                  : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/8'
              }`}
            >
              <span className="text-2xl flex-shrink-0">➖</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">无修饰</div>
                <div className="text-xs opacity-60">按基础玩法规则进行</div>
              </div>
              {selectedModifier === GameModifier.NONE && (
                <span className="text-gold text-xs font-medium">已选</span>
              )}
            </button>

            <div className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
              特殊修饰
            </div>
            <div className="space-y-2">
              {activeModifiers.map((mod) => {
                const isSelected = selectedModifier === mod.id
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => handleModifierSelect(mod.id)}
                    className={`relative w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                      isSelected
                        ? 'border-gold bg-gold/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/8'
                    }`}
                  >
                    <span className="text-2xl flex-shrink-0">{mod.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{mod.name}</div>
                      <div className="text-xs opacity-60 truncate">{mod.shortDesc}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isSelected && (
                        <span className="text-gold text-xs font-medium mr-1">已选</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDetailModifier(mod.id)
                        }}
                        className="text-white/30 hover:text-gold p-1"
                      >
                        <HelpCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === 'mixed' && (
          <MixedRotationPanel
            mixedRotation={mixedRotation}
            onChange={onMixedRotationChange}
          />
        )}

        <div className="mt-5 pt-4 border-t border-white/10">
          <div className="text-white/50 text-xs mb-2">当前配置</div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gold/15 text-gold text-xs font-medium">
              {VARIANT_RULES[selectedVariant].icon} {VARIANT_RULES[selectedVariant].name}
            </span>
            {selectedModifier !== GameModifier.NONE && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/15 text-red-400 text-xs font-medium">
                {MODIFIER_INFO[selectedModifier].icon} {MODIFIER_INFO[selectedModifier].name}
              </span>
            )}
            {mixedRotation && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 text-blue-400 text-xs font-medium">
                🔀 混合轮换({mixedRotation.variants.length}种×{mixedRotation.handsPerVariant}局)
              </span>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {detailVariant && (
          <DetailOverlay onClose={() => setDetailVariant(null)}>
            <VariantDetail
              variant={detailVariant}
              onBack={() => setDetailVariant(null)}
              onSelect={() => {
                handleVariantSelect(detailVariant)
                setDetailVariant(null)
              }}
            />
          </DetailOverlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailModifier && (
          <DetailOverlay onClose={() => setDetailModifier(null)}>
            <ModifierDetail
              modifier={detailModifier}
              onBack={() => setDetailModifier(null)}
              onSelect={() => {
                handleModifierSelect(detailModifier)
                setDetailModifier(null)
              }}
            />
          </DetailOverlay>
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailOverlay({ children }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-panel w-full max-w-md p-6"
      >
        {children}
      </motion.div>
    </div>
  )
}

function VariantDetail({
  variant,
  onBack,
  onSelect,
}: {
  variant: GameVariant
  onBack: () => void
  onSelect: () => void
}) {
  const rule = VARIANT_RULES[variant]
  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-2xl">{rule.icon}</span>
          {rule.name}
        </h3>
        <button onClick={onBack} className="text-white/60 hover:text-white">
          <X className="w-6 h-6" />
        </button>
      </div>
      <p className="text-white/80 text-sm leading-relaxed mb-4">{rule.fullDesc}</p>
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
          <div className="text-white/50">板面数量</div>
          <div className="text-white/90">{rule.boardCount} 个</div>
          <div className="text-white/50">凑牌方式</div>
          <div className="text-white/90">
            {rule.forceCombination === '2+3'
              ? '强制2+3'
              : rule.forceCombination === '3+2'
              ? '3+2自由'
              : '自由组合'}
          </div>
          <div className="text-white/50">下注方式</div>
          <div className="text-white/90">
            {rule.isFixedLimit
              ? '限注 (Fixed-Limit)'
              : rule.isPotLimit
              ? '底池限注 (Pot-Limit)'
              : '无限注 (No-Limit)'}
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-4">
        <button onClick={onBack} className="flex-1 btn-poker-secondary flex items-center justify-center gap-1">
          <ArrowLeft className="w-4 h-4" />
          返回选择
        </button>
        <button onClick={onSelect} className="flex-1 btn-poker-primary">
          选择此玩法
        </button>
      </div>
    </>
  )
}

function ModifierDetail({
  modifier,
  onBack,
  onSelect,
}: {
  modifier: GameModifier
  onBack: () => void
  onSelect: () => void
}) {
  const info = MODIFIER_INFO[modifier]
  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-2xl">{info.icon}</span>
          {info.name}
        </h3>
        <button onClick={onBack} className="text-white/60 hover:text-white">
          <X className="w-6 h-6" />
        </button>
      </div>
      <p className="text-white/80 text-sm leading-relaxed mb-4">{info.fullDesc}</p>
      {info.specialRules.length > 0 && (
        <div>
          <h4 className="text-white/90 font-semibold text-sm mb-2">特殊规则</h4>
          <ul className="space-y-1">
            {info.specialRules.map((r, i) => (
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
          <div className="text-white/50">需要基础玩法</div>
          <div className="text-white/90">{info.needsBaseVariant ? '是' : '否'}</div>
        </div>
      </div>
      <div className="flex gap-3 mt-4">
        <button onClick={onBack} className="flex-1 btn-poker-secondary flex items-center justify-center gap-1">
          <ArrowLeft className="w-4 h-4" />
          返回选择
        </button>
        <button onClick={onSelect} className="flex-1 btn-poker-primary">
          选择此修饰
        </button>
      </div>
    </>
  )
}

function MixedRotationPanel({
  mixedRotation,
  onChange,
}: {
  mixedRotation: MixedRotationConfig | null
  onChange: (config: MixedRotationConfig | null) => void
}) {
  const allVariants = Object.values(VARIANT_RULES) as VariantRuleInfo[]

  const toggleMixed = () => {
    if (mixedRotation) {
      onChange(null)
    } else {
      onChange({ variants: [], handsPerVariant: 6 })
    }
  }

  const addVariant = (variant: GameVariant) => {
    if (!mixedRotation) return
    if (mixedRotation.variants.includes(variant)) return
    onChange({
      ...mixedRotation,
      variants: [...mixedRotation.variants, variant],
    })
  }

  const removeVariant = (variant: GameVariant) => {
    if (!mixedRotation) return
    onChange({
      ...mixedRotation,
      variants: mixedRotation.variants.filter((v) => v !== variant),
    })
  }

  const setHandsPerVariant = (n: number) => {
    if (!mixedRotation) return
    onChange({ ...mixedRotation, handsPerVariant: Math.max(1, Math.min(100, n)) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-white font-semibold text-sm">混合轮换模式</div>
          <div className="text-white/50 text-xs">按顺序轮换不同玩法，每种玩法打固定局数</div>
        </div>
        <button
          type="button"
          onClick={toggleMixed}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            mixedRotation ? 'bg-gold' : 'bg-white/20'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              mixedRotation ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {mixedRotation && (
        <>
          <div>
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
              每种玩法局数
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHandsPerVariant(mixedRotation.handsPerVariant - 1)}
                className="w-8 h-8 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 flex items-center justify-center"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-white font-bold text-lg w-8 text-center">
                {mixedRotation.handsPerVariant}
              </span>
              <button
                type="button"
                onClick={() => setHandsPerVariant(mixedRotation.handsPerVariant + 1)}
                className="w-8 h-8 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 flex items-center justify-center"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {mixedRotation.variants.length > 0 && (
            <div>
              <div className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                轮换顺序
              </div>
              <div className="flex flex-wrap gap-1.5">
                {mixedRotation.variants.map((v, i) => (
                  <span
                    key={`${v}-${i}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gold/15 text-gold text-xs font-medium"
                  >
                    {i + 1}. {VARIANT_RULES[v].icon} {VARIANT_RULES[v].name}
                    <button
                      type="button"
                      onClick={() => removeVariant(v)}
                      className="text-gold/50 hover:text-red-400 ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
              添加玩法
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {allVariants
                .filter((v) => !mixedRotation.variants.includes(v.id))
                .map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => addVariant(rule.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-white/5 bg-white/3 text-white/60 hover:border-white/20 hover:bg-white/8 transition-all text-left"
                  >
                    <span className="text-lg">{rule.icon}</span>
                    <span className="text-sm">{rule.name}</span>
                    <span className="text-xs text-white/30 ml-auto">{rule.shortDesc}</span>
                    <Plus className="w-3.5 h-3.5 text-white/30" />
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
