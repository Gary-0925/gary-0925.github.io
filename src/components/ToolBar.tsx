import { Database, GitMerge, Undo2 } from 'lucide-react'
import type { GameState } from '../game/types'
import { JudgeCardView } from './JudgeCardView'

interface ToolBarProps {
  state: GameState
  onRollback: () => void
  onMemo: () => void
  onDsu: () => void
}

export function ToolBar({ state, onRollback, onMemo, onDsu }: ToolBarProps) {
  const memoCost = state.cache ? 1 : 2
  const topRanks = state.queues
    .map((queue) => queue.cards.at(-1)?.rank)
    .filter((rank): rank is number => rank !== undefined)
  const dsuAvailable = new Set(topRanks).size < topRanks.length
  return (
    <section className="tool-section" aria-labelledby="tool-title">
      <div className="section-label">
        <span id="tool-title">算法工具</span>
        <span className="insight-count">思考点 {state.insight}</span>
      </div>
      <div className="tool-grid">
        <button
          type="button"
          className="tool-card"
          disabled={state.insight < 1 || state.history.length === 0}
          onClick={onRollback}
          title="撤销上一次提交或工具操作"
        >
          <Undo2 />
          <span><strong>回滚栈</strong><small>撤销上步</small></span>
          <b>−1</b>
        </button>
        <button
          type="button"
          className="tool-card"
          disabled={!state.selectedId || state.insight < memoCost}
          onClick={onMemo}
          title="缓存选中的牌；缓存已有牌时与之交换"
        >
          <Database />
          <span><strong>记忆化</strong><small>{state.cache ? '交换缓存' : '暂存手牌'}</small></span>
          <b>−{memoCost}</b>
        </button>
        <button
          type="button"
          className={`tool-card ${state.toolMode === 'dsu' ? 'engaged' : ''}`}
          disabled={state.insight < 4 || !dsuAvailable}
          onClick={onDsu}
          title="选择两个队尾状态相同的队列，跨队合并"
        >
          <GitMerge />
          <span><strong>并查集</strong><small>跨队 Union</small></span>
          <b>−4</b>
        </button>
      </div>
      <div className="cache-slot">
        <span>memo[0]</span>
        {state.cache ? (
          <JudgeCardView card={state.cache} compact disabled />
        ) : (
          <em>empty</em>
        )}
      </div>
    </section>
  )
}
