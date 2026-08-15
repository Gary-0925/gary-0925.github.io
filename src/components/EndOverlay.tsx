import { Download, RotateCcw, Trophy } from 'lucide-react'
import type { GameState } from '../game/types'
import {
  MAX_MACHINE_SCORE,
  MAX_TOTAL_SCORE,
  formatScore,
  formatTotalScore,
} from '../game/score'

interface EndOverlayProps {
  state: GameState
  bestScore: number
  onRestart: () => void
  onExport: () => void
}

export function EndOverlay({ state, bestScore, onRestart, onExport }: EndOverlayProps) {
  return (
    <div className="end-backdrop">
      <section className="end-card">
        <div className="end-icon"><Trophy /></div>
        <p className="eyebrow">AKNOI FINAL SCORE</p>
        <h2>{formatTotalScore(state.contestScore)}</h2>
        <p>{state.contestScore === MAX_MACHINE_SCORE ? 'AK NOI！' : '六道题均已提交。'}</p>
        <div className="result-grid problem-results">
          {state.boards.map((board) => (
            <div key={board.id}>
              <span>{board.label}</span>
              <b>{formatScore(board.submittedScore ?? 0)}</b>
            </div>
          ))}
        </div>
        <p className="record-line">含笔试 105 分 · 上机 {formatScore(state.contestScore)}/{MAX_MACHINE_SCORE}</p>
        <p className="record-line">种子 {state.seed} · 纪录 {formatTotalScore(bestScore)}/{MAX_TOTAL_SCORE} · {state.moves} 次操作</p>
        <div className="end-buttons">
          <button className="primary-button" onClick={onExport}><Download /> 导出 .dat</button>
          <button className="ghost-button" onClick={onRestart}><RotateCcw /> 同种子再赛</button>
        </div>
        <p className="end-hint">下载后到排行榜页面上传这个文件，服务器会重算分数。</p>
      </section>
    </div>
  )
}
