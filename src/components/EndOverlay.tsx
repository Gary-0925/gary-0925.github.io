import { RotateCcw, Trophy } from 'lucide-react'
import type { GameState } from '../game/types'

interface EndOverlayProps {
  state: GameState
  bestScore: number
  onRestart: () => void
}

function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

export function EndOverlay({ state, bestScore, onRestart }: EndOverlayProps) {
  return (
    <div className="end-backdrop">
      <section className="end-card">
        <div className="end-icon"><Trophy /></div>
        <p className="eyebrow">AKNOI FINAL SCORE</p>
        <h2>{formatScore(state.contestScore)}</h2>
        <p>{state.contestScore === 600 ? 'AK NOI！' : '六道题均已提交。'}</p>
        <div className="result-grid problem-results">
          {state.boards.map((board) => (
            <div key={board.id}>
              <span>{board.label}</span>
              <b>{formatScore(board.submittedScore ?? 0)}</b>
            </div>
          ))}
        </div>
        <p className="record-line">种子 {state.seed} · 纪录 {formatScore(bestScore)}/600 · {state.moves} 次操作</p>
        <button className="primary-button" onClick={onRestart}><RotateCcw /> 同种子再赛</button>
      </section>
    </div>
  )
}
