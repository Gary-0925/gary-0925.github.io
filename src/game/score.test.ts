import { describe, expect, it } from 'vitest'
import { finishAnimation, moveBoard, startGame, submitBoard } from './engine'
import { replayFileName, buildReplayFile } from './replayFile'
import {
  MAX_MACHINE_SCORE,
  MAX_TOTAL_SCORE,
  WRITTEN_EXAM_SCORE,
  formatScore,
  formatTotalScore,
  withWrittenExam,
} from './score'

describe('written exam bonus', () => {
  it('is 105 on top of the 600 point machine score', () => {
    expect(WRITTEN_EXAM_SCORE).toBe(105)
    expect(MAX_MACHINE_SCORE).toBe(600)
    expect(MAX_TOTAL_SCORE).toBe(705)
  })

  it('adds the bonus even to a zero score', () => {
    expect(withWrittenExam(0)).toBe(105)
    expect(formatTotalScore(0)).toBe('105')
  })

  it('keeps one decimal place without float noise', () => {
    // 0.1 + 0.2 style drift would show up here as 105.30000000000001.
    expect(withWrittenExam(12.3)).toBe(117.3)
    expect(formatTotalScore(12.3)).toBe('117.3')
    expect(withWrittenExam(299.5)).toBe(404.5)
  })

  it('drops the decimal point for whole numbers', () => {
    expect(formatScore(42)).toBe('42')
    expect(formatScore(42.5)).toBe('42.5')
    expect(formatTotalScore(MAX_MACHINE_SCORE)).toBe('705')
  })
})

describe('what the bonus does not touch', () => {
  it('leaves the engine score itself on the 0-600 scale', () => {
    let state = startGame('BONUS')
    for (let i = 0; i < 40; i += 1) {
      state = finishAnimation(moveBoard(state, i % 2 === 0 ? 'left' : 'down'))
    }
    expect(state.contestScore).toBeLessThanOrEqual(MAX_MACHINE_SCORE)
    // Every per-problem score stays raw: the bonus is a display-only total.
    const sum = state.boards.reduce((total, board) => total + board.currentScore, 0)
    expect(state.contestScore).toBeCloseTo(Math.round(sum * 10) / 10, 5)
  })

  it('stores the machine score in the .dat but names the file with the total', () => {
    let state = startGame('EXPORT')
    for (let i = 0; i < 30; i += 1) {
      state = finishAnimation(moveBoard(state, 'left'))
      state = finishAnimation(moveBoard(state, 'up'))
    }
    for (const board of state.boards) {
      state = finishAnimation(submitBoard(state, board.id))
    }

    const file = buildReplayFile(state)
    // The server recomputes this number, so it must stay unbonused.
    expect(file.score).toBe(state.contestScore)
    expect(file.score).toBeLessThanOrEqual(MAX_MACHINE_SCORE)

    expect(replayFileName(state)).toBe(
      `AKNOI-EXPORT-${formatTotalScore(state.contestScore)}.dat`,
    )
  })
})
