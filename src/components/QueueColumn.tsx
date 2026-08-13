import { Check, LockKeyhole } from 'lucide-react'
import { MAX_QUEUE_HEIGHT, PROBLEM_QUEUES } from '../data/verdicts'
import type { QueueState } from '../game/types'
import { JudgeCardView } from './JudgeCardView'

interface QueueColumnProps {
  queue: QueueState
  index: number
  active: boolean
  valid: boolean
  dsuSource: boolean
  onClick: () => void
}

export function QueueColumn({
  queue,
  index,
  active,
  valid,
  dsuSource,
  onClick,
}: QueueColumnProps) {
  const problem = PROBLEM_QUEUES[index]
  const free = MAX_QUEUE_HEIGHT - queue.cards.length

  return (
    <div
      role="button"
      tabIndex={active ? 0 : -1}
      className={`queue-column ${active ? 'active' : ''} ${valid ? 'valid' : ''} ${dsuSource ? 'dsu-source' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      aria-label={`${problem.number} ${problem.title}，${queue.cards.length} 张牌`}
    >
      <header className="queue-header">
        <div>
          <span className="problem-number">{problem.number}</span>
          <strong>{problem.title}</strong>
        </div>
        {queue.solved ? (
          <span className="solved-badge"><Check size={13} /> AC</span>
        ) : (
          <span className="pending-dot">待通过</span>
        )}
      </header>

      <div className="problem-meta">
        <span>{problem.algorithm}</span>
        <code>{problem.complexity}</code>
      </div>

      <div className="queue-stack">
        <div className="queue-slots" aria-hidden="true">
          {Array.from({ length: MAX_QUEUE_HEIGHT }, (_, slot) => (
            <span key={slot}>{slot + 1}</span>
          ))}
        </div>
        <div className="queue-card-list">
          {queue.cards.map((card) => (
            <JudgeCardView key={card.uid} card={card} compact disabled />
          ))}
        </div>
        {queue.cards.length === 0 && (
          <div className="empty-queue">
            <LockKeyhole size={18} />
            <span>选择此队列</span>
          </div>
        )}
      </div>

      <footer className="queue-footer">
        <span>{queue.cards.length}/{MAX_QUEUE_HEIGHT}</span>
        <span>{free === 0 ? '队列已满' : `剩余 ${free} 格`}</span>
        <kbd>{['Q', 'W', 'E', 'R'][index]}</kbd>
      </footer>
    </div>
  )
}
