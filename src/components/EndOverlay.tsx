import { Award, RotateCcw, Skull, Trophy } from 'lucide-react'
import type { GameState } from '../game/types'

interface EndOverlayProps {
  state: GameState
  bestScore: number
  onRestart: () => void
}

export function EndOverlay({ state, bestScore, onRestart }: EndOverlayProps) {
  const won = state.screen === 'won'
  return (
    <div className="end-backdrop">
      <section className={`end-card ${won ? 'win' : 'loss'}`}>
        <div className="end-icon">{won ? <Trophy /> : <Skull />}</div>
        <p className="eyebrow">FINAL VERDICT</p>
        <h2>{won ? 'AK' : 'AFO'}</h2>
        <p>{won ? '四道题全部 Accepted。' : '评测队列已经无法接收剩余提交。'}</p>
        <div className="result-grid">
          <div><span>得分</span><b>{state.score.toLocaleString()}</b></div>
          <div><span>轮数</span><b>{state.round}</b></div>
          <div><span>AC</span><b>{state.solvedCount}/4</b></div>
          <div><span>合并</span><b>{state.mergeCount}</b></div>
        </div>
        <div className="record-line"><Award /> 本机最高分 {bestScore.toLocaleString()}</div>
        <button className="primary-button" onClick={onRestart}>
          <RotateCcw /> 再评一次
        </button>
      </section>
    </div>
  )
}
