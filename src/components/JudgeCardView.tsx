import type { DragEvent } from 'react'
import {
  Binary,
  BugOff,
  Gauge,
  PieChart,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'
import { SPECIAL_CARDS, VERDICTS } from '../data/verdicts'
import type { CardKind, JudgeCard } from '../game/types'

interface JudgeCardViewProps {
  card: JudgeCard
  selected?: boolean
  compact?: boolean
  disabled?: boolean
  index?: number
  onClick?: () => void
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
}

const SPECIAL_ICONS: Record<Exclude<CardKind, 'verdict'>, typeof Gauge> = {
  o2: Gauge,
  o3: Zap,
  hack: ShieldAlert,
  gdb: BugOff,
  longLong: Binary,
  subtask: PieChart,
}

export function JudgeCardView({
  card,
  selected = false,
  compact = false,
  disabled = false,
  index,
  onClick,
  onDragStart,
  onDragEnd,
}: JudgeCardViewProps) {
  if (card.kind !== 'verdict') {
    const definition = SPECIAL_CARDS[card.kind]
    const Icon = SPECIAL_ICONS[card.kind]
    return (
      <button
        className={`judge-card special-card ${definition.tone}-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}
        onClick={onClick}
        disabled={disabled}
        type="button"
        aria-pressed={selected}
        draggable={!compact && Boolean(onDragStart)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {!compact && index !== undefined && <span className="card-key">{index + 1}</span>}
        <Icon aria-hidden="true" />
        <strong>{definition.label}</strong>
        <span>{definition.name}</span>
        {!compact && <small>{definition.description}</small>}
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
      draggable={!compact && Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {!compact && index !== undefined && <span className="card-key">{index + 1}</span>}
      {card.rank === VERDICTS.length - 1 && <Sparkles className="card-spark" aria-hidden="true" />}
      <strong>{verdict.label}</strong>
      {!compact && <span>{verdict.fullName}</span>}
      <small>#{verdict.value}</small>
    </button>
  )
}
