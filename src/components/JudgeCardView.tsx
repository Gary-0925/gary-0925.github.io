import { Gauge, ShieldAlert, Sparkles } from 'lucide-react'
import { VERDICTS } from '../data/verdicts'
import type { JudgeCard } from '../game/types'

interface JudgeCardViewProps {
  card: JudgeCard
  selected?: boolean
  compact?: boolean
  disabled?: boolean
  index?: number
  onClick?: () => void
}

export function JudgeCardView({
  card,
  selected = false,
  compact = false,
  disabled = false,
  index,
  onClick,
}: JudgeCardViewProps) {
  if (card.kind === 'o2') {
    return (
      <button
        className={`judge-card special-card o2-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}
        onClick={onClick}
        disabled={disabled}
        type="button"
        aria-pressed={selected}
      >
        {!compact && index !== undefined && <span className="card-key">{index + 1}</span>}
        <Gauge aria-hidden="true" />
        <strong>O2</strong>
        <span>吸氧</span>
        {!compact && <small>队尾状态升一级</small>}
      </button>
    )
  }

  if (card.kind === 'hack') {
    return (
      <button
        className={`judge-card special-card hack-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}
        onClick={onClick}
        disabled={disabled}
        type="button"
        aria-pressed={selected}
      >
        {!compact && index !== undefined && <span className="card-key">{index + 1}</span>}
        <ShieldAlert aria-hidden="true" />
        <strong>Hack</strong>
        <span>加强数据</span>
        {!compact && <small>队尾状态降一级</small>}
      </button>
    )
  }

  const verdict = VERDICTS[card.rank ?? 0]
  return (
    <button
      className={`judge-card verdict-card rank-${card.rank ?? 0} ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}
      style={
        {
          '--card-bg': verdict.color,
          '--card-ink': verdict.ink,
        } as React.CSSProperties
      }
      onClick={onClick}
      disabled={disabled}
      type="button"
      aria-label={`${verdict.label}，${verdict.fullName}`}
      aria-pressed={selected}
    >
      {!compact && index !== undefined && <span className="card-key">{index + 1}</span>}
      {card.rank === VERDICTS.length - 1 && <Sparkles className="card-spark" aria-hidden="true" />}
      <strong>{verdict.label}</strong>
      {!compact && <span>{verdict.fullName}</span>}
      <small>#{verdict.value}</small>
    </button>
  )
}
