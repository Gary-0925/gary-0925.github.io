import { describe, expect, it } from 'vitest'
import { VERDICTS } from '../data/verdicts'
import {
  crossSectionFits,
  finishAnimation,
  moveBoard,
  pieceScore,
  piecesOverlap,
  replayGame,
  startGame,
  submitBoard,
} from './engine'
import type { BoardPiece, GameState, O2Piece, SubtaskDefinition, VerdictPiece } from './types'

let id = 0

const TEST_SUBTASKS: SubtaskDefinition[] = [
  { id: 'single-50', rows: 1, cols: 1, maxScore: 50 },
  { id: 'wide-30', rows: 1, cols: 2, maxScore: 30 },
  { id: 'tall-60', rows: 2, cols: 1, maxScore: 60 },
  { id: 'wide4-80', rows: 1, cols: 4, maxScore: 80 },
  { id: 'full-100', rows: 3, cols: 3, maxScore: 100 },
]

function piece(
  subtaskId: string,
  verdictLevel: number,
  row: number,
  col: number,
): VerdictPiece {
  id += 1
  return { kind: 'verdict', id: `test-piece-${id}`, subtaskId, verdictLevel, row, col }
}

function o2(row: number, col: number): O2Piece {
  id += 1
  return { kind: 'o2', id: `test-o2-${id}`, row, col }
}

function isolatedState(pieces: BoardPiece[]): GameState {
  const state = startGame('ENGINE-TEST')
  state.boards.forEach((board, index) => {
    board.subtasks = structuredClone(TEST_SUBTASKS)
    board.pieces = index === 0 ? pieces : []
    board.status = index === 0 ? 'active' : 'submitted'
    board.currentScore = 0
    board.submittedScore = index === 0 ? undefined : 0
  })
  state.motion = []
  state.spawnedPieceIds = []
  state.contestScore = 0
  state.moves = 0
  state.mergeCount = 0
  return state
}

function activeBoard(state: GameState) {
  return state.boards[0]
}

describe('AKNOI seeded engine', () => {
  it('generates identical games from the same seed', () => {
    expect(startGame('SAME-SEED')).toEqual(startGame('SAME-SEED'))
    expect(startGame('OTHER-SEED').boards).not.toEqual(startGame('SAME-SEED').boards)
  })

  it('uses the seed for all later random outcomes as well', () => {
    let left = startGame('REPLAY-42')
    let right = startGame('REPLAY-42')
    for (const direction of ['left', 'down', 'right', 'up'] as const) {
      left = finishAnimation(moveBoard(left, direction))
      right = finishAnimation(moveBoard(right, direction))
    }
    expect(left).toEqual(right)
  })

  it('generates O2 blocks from the seeded random stream', () => {
    let state = startGame('O2-0')
    state = finishAnimation(moveBoard(state, 'left'))
    state = finishAnimation(moveBoard(state, 'down'))
    expect(state.boards.some((board) => board.pieces.some((item) => item.kind === 'o2'))).toBe(true)
  })

  it('generates unique subtask shapes and a 100-point jackpot per problem', () => {
    const state = startGame('SUBTASKS')
    for (const board of state.boards) {
      // T1 is the easy problem on both days: three tiers with a 2x2 jackpot.
      const easy = board.label.endsWith('T1')
      expect(board.subtasks).toHaveLength(easy ? 3 : 5)
      const shapes = board.subtasks.map((item) => `${item.rows}x${item.cols}`)
      expect(new Set(shapes).size).toBe(easy ? 3 : 5)
      expect(board.subtasks).toContainEqual(
        expect.objectContaining(
          easy ? { rows: 2, cols: 2, maxScore: 100 } : { rows: 3, cols: 3, maxScore: 100 },
        ),
      )
      expect(board.subtasks).toContainEqual(expect.objectContaining({ rows: 1, cols: 1 }))
    }
    const scoreSets = state.boards.map((board) => board.subtasks.map((item) => item.maxScore).join(','))
    expect(new Set(scoreSets).size).toBeGreaterThan(1)
  })

  it('gives both T1 problems three tiers and the harder problems five', () => {
    const state = startGame('TIERS')
    const byLabel = Object.fromEntries(state.boards.map((board) => [board.label, board]))
    expect(byLabel['D1T1'].subtasks).toHaveLength(3)
    expect(byLabel['D2T1'].subtasks).toHaveLength(3)
    for (const label of ['D1T2', 'D1T3', 'D2T2', 'D2T3']) {
      expect(byLabel[label].subtasks, label).toHaveLength(5)
    }
    for (const label of ['D1T1', 'D2T1']) {
      expect(byLabel[label].subtasks.at(-1), label).toMatchObject({ rows: 2, cols: 2, maxScore: 100 })
    }
  })

  it('uses the requested verdict score multipliers', () => {
    expect(VERDICTS.map((item) => [item.label, item.multiplier])).toEqual([
      ['CE', 0],
      ['RE', 0],
      ['UKE', 0.1],
      ['MLE', 0.2],
      ['TLE', 0.4],
      ['WA', 0.8],
      ['AC', 1],
    ])
    const state = isolatedState([])
    const board = activeBoard(state)
    expect(pieceScore(board, piece('single-50', 2, 0, 0))).toBe(5)
    expect(pieceScore(board, piece('single-50', 5, 0, 0))).toBe(40)
    expect(pieceScore(board, piece('single-50', 6, 0, 0))).toBe(50)
  })

  it('uses the Luogu-inspired verdict palette', () => {
    expect(VERDICTS.map((item) => item.color)).toEqual([
      '#f1c40f',
      '#9b59b6',
      '#4b3f92',
      '#205493',
      '#123f70',
      '#e74c3c',
      '#52c41a',
    ])
  })

  it('requires the entire moving cross-section to fit the front block', () => {
    const state = isolatedState([])
    const board = activeBoard(state)
    const tallMoving = piece('tall-60', 0, 0, 3)
    const shortFront = piece('single-50', 0, 0, 0)
    const tallFront = piece('tall-60', 0, 0, 0)
    expect(crossSectionFits(board, tallMoving, shortFront, 'left')).toBe(false)
    expect(crossSectionFits(board, tallMoving, tallFront, 'left')).toBe(true)

    const wideMoving = piece('wide4-80', 0, 2, 0)
    const narrowFront = piece('wide-30', 0, 0, 0)
    const wideFront = piece('wide4-80', 0, 0, 0)
    expect(crossSectionFits(board, wideMoving, narrowFront, 'up')).toBe(false)
    expect(crossSectionFits(board, wideMoving, wideFront, 'up')).toBe(true)
  })

  it('stops cleanly on partial contact without merging', () => {
    const front = piece('single-50', 0, 0, 0)
    const moving = piece('tall-60', 0, 0, 4)
    const state = moveBoard(isolatedState([front, moving]), 'left')
    expect(activeBoard(state).pieces.find((item) => item.id === front.id)).toMatchObject({ verdictLevel: 0 })
    expect(activeBoard(state).pieces.find((item) => item.id === moving.id)).toMatchObject({ col: 1, verdictLevel: 0 })
    expect(state.mergeCount).toBe(0)
  })

  it('compacts front-to-back with deterministic collision order', () => {
    const front = piece('single-50', 0, 0, 0)
    const middle = piece('single-50', 0, 0, 3)
    const back = piece('single-50', 0, 0, 5)
    const state = moveBoard(isolatedState([back, middle, front]), 'left')
    expect(activeBoard(state).pieces.find((item) => item.id === front.id)).toMatchObject({ col: 0, verdictLevel: 1 })
    expect(activeBoard(state).pieces.some((item) => item.id === middle.id)).toBe(false)
    expect(activeBoard(state).pieces.find((item) => item.id === back.id)).toMatchObject({ col: 1, verdictLevel: 0 })
  })

  it('preserves the settled front subtask after a legal merge', () => {
    const front = piece('tall-60', 1, 0, 0)
    const moving = piece('single-50', 1, 0, 4)
    const state = moveBoard(isolatedState([front, moving]), 'left')
    const survivor = activeBoard(state).pieces.find((item) => item.id === front.id)
    expect(survivor).toMatchObject({ subtaskId: 'tall-60', verdictLevel: 2 })
    expect(activeBoard(state).currentScore).toBe(6)
  })

  it.each([
    ['right', 0, 5, 0, 1],
    ['up', 0, 0, 4, 0],
    ['down', 5, 0, 1, 0],
  ] as const)('keeps the front block when moving %s', (direction, frontRow, frontCol, movingRow, movingCol) => {
    const front = piece('single-50', 0, frontRow, frontCol)
    const moving = piece('single-50', 0, movingRow, movingCol)
    const state = moveBoard(isolatedState([moving, front]), direction)
    expect(activeBoard(state).pieces.find((item) => item.id === front.id)).toMatchObject({ verdictLevel: 1 })
    expect(activeBoard(state).pieces.some((item) => item.id === moving.id)).toBe(false)
  })

  it('uses a moving O2 block to upgrade the front target directly', () => {
    const target = piece('single-50', 5, 0, 0)
    const optimizer = o2(0, 4)
    const state = moveBoard(isolatedState([target, optimizer]), 'left')
    expect(activeBoard(state).pieces.find((item) => item.id === target.id)).toMatchObject({
      kind: 'verdict',
      verdictLevel: 6,
    })
    expect(activeBoard(state).pieces.some((item) => item.id === optimizer.id)).toBe(false)
    expect(activeBoard(state).currentScore).toBe(50)
  })

  it('does not let O2 combine with AC or act as the stationary target', () => {
    const ac = piece('single-50', 6, 0, 0)
    const optimizer = o2(0, 4)
    const blocked = moveBoard(isolatedState([ac, optimizer]), 'left')
    expect(activeBoard(blocked).pieces.find((item) => item.id === ac.id)).toMatchObject({ verdictLevel: 6 })
    expect(activeBoard(blocked).pieces.find((item) => item.id === optimizer.id)).toMatchObject({ col: 1 })

    const frontOptimizer = o2(0, 0)
    const regular = piece('single-50', 0, 0, 4)
    const reversed = moveBoard(isolatedState([frontOptimizer, regular]), 'left')
    expect(activeBoard(reversed).pieces.some((item) => item.id === frontOptimizer.id)).toBe(true)
    expect(activeBoard(reversed).pieces.find((item) => item.id === regular.id)).toMatchObject({ col: 1, verdictLevel: 0 })
  })

  it('moves every unsubmitted problem while leaving submitted problems frozen', () => {
    const state = startGame('GLOBAL')
    state.boards.forEach((board, index) => {
      const unit = board.subtasks.find((item) => item.rows === 1 && item.cols === 1)!
      board.pieces = [piece(unit.id, 0, 3, 3)]
      if (index === 5) {
        board.status = 'submitted'
        board.submittedScore = 0
      }
    })
    const frozen = structuredClone(state.boards[5].pieces)
    const moved = moveBoard(state, 'left')
    expect(moved.boards.slice(0, 5).every((board) => board.pieces.some((item) => item.col === 0))).toBe(true)
    expect(moved.boards[5].pieces).toEqual(frozen)
  })

  it('uses the current board maximum instead of retaining a historical peak', () => {
    const front = piece('wide-30', 2, 0, 0)
    const moving = piece('single-50', 2, 0, 4)
    const state = isolatedState([front, moving])
    state.boards[0].subtasks.find((item) => item.id === 'single-50')!.maxScore = 90
    state.boards[0].currentScore = 9

    const moved = moveBoard(state, 'left')
    expect(activeBoard(moved).pieces.find((item) => item.id === front.id)).toMatchObject({ verdictLevel: 3 })
    expect(activeBoard(moved).currentScore).toBe(6)
    expect(moved.contestScore).toBe(6)
  })

  it('locks the current maximum when a problem is submitted', () => {
    const state = isolatedState([piece('single-50', 5, 3, 3)])
    state.boards[1].status = 'active'
    state.boards[1].pieces = [piece('single-50', 0, 3, 3)]
    const submitted = submitBoard(state, state.boards[0].id)
    expect(submitted.boards[0]).toMatchObject({
      status: 'submitted',
      currentScore: 40,
      submittedScore: 40,
    })
    const snapshot = structuredClone(submitted.boards[0].pieces)
    const moved = moveBoard(submitted, 'left')
    expect(moved.boards[0].pieces).toEqual(snapshot)
    expect(moved.boards[0].submittedScore).toBe(40)
  })

  it('never submits a board on its own, even when it fills up', () => {
    const pieces: BoardPiece[] = []
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        if (row === 5 && col === 3) continue
        pieces.push(piece('single-50', col % 3, row, col))
      }
    }
    const state = isolatedState(pieces)
    state.boards[0].currentScore = 5
    const moved = moveBoard(state, 'right')
    expect(activeBoard(moved)).toMatchObject({ status: 'active' })
    expect(activeBoard(moved).submittedScore).toBeUndefined()
    expect(moved.screen).toBe('playing')
  })

  it('keeps a locked board playable until the player submits it', () => {
    const pieces: BoardPiece[] = []
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        pieces.push(piece('single-50', 5 + ((row + col) % 2), row, col))
      }
    }
    const state = isolatedState(pieces)
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const moved = moveBoard(state, direction)
      expect(activeBoard(moved).status).toBe('active')
      expect(moved.screen).toBe('playing')
    }
    const submitted = submitBoard(state, state.boards[0].id)
    expect(submitted.boards[0]).toMatchObject({ status: 'submitted', submittedScore: 50 })
    expect(submitted.screen).toBe('finished')
  })

  it('sorts every problem subtask key from the lowest score to the highest', () => {
    for (const board of startGame('SORTED').boards) {
      const scores = board.subtasks.map((item) => item.maxScore)
      expect(scores).toEqual([...scores].sort((left, right) => left - right))
      expect(scores.at(-1)).toBe(100)
      expect(board.subtasks.at(-1)).toMatchObject(
        board.label.endsWith('T1') ? { rows: 2, cols: 2 } : { rows: 3, cols: 3 },
      )
    }
  })

  it('still spawns the 1x1 unit subtask once the key is score sorted', () => {
    const state = startGame('SPAWN-UNIT')
    for (const board of state.boards) {
      expect(board.pieces).toHaveLength(2)
      for (const item of board.pieces) {
        const subtask = board.subtasks.find(
          (candidate) => item.kind === 'verdict' && candidate.id === item.subtaskId,
        )!
        expect(subtask).toMatchObject({ rows: 1, cols: 1 })
      }
    }
  })

  it('labels the six problems D1T1 through D2T3', () => {
    expect(startGame('LABELS').boards.map((board) => board.label)).toEqual([
      'D1T1',
      'D1T2',
      'D1T3',
      'D2T1',
      'D2T2',
      'D2T3',
    ])
  })

  it('rebuilds an identical game from its seed and recorded actions', () => {
    let state = startGame('REPLAY-SAVE')
    for (const direction of ['left', 'down', 'right', 'up', 'left', 'up'] as const) {
      state = finishAnimation(moveBoard(state, direction))
    }
    state = finishAnimation(submitBoard(state, state.boards[2].id))
    state = finishAnimation(moveBoard(state, 'right'))

    expect(replayGame(state.seed, state.history)).toEqual(state)
  })

  it('records every accepted action and ignores rejected ones', () => {
    // One block already flush against the left wall: moving left is a no-op.
    let state = isolatedState([piece('single-50', 0, 0, 0)])
    expect(state.history).toEqual([])

    expect(moveBoard(state, 'left').history).toEqual([])

    state = finishAnimation(moveBoard(state, 'right'))
    expect(state.history).toEqual([{ type: 'move', direction: 'right' }])

    const boardId = state.boards[0].id
    state = finishAnimation(submitBoard(state, boardId))
    expect(state.history.at(-1)).toEqual({ type: 'submit', boardId })
    // Submitting an already submitted problem is rejected, so nothing is logged.
    expect(submitBoard(state, boardId).history).toEqual(state.history)
  })

  it('keeps all generated and moved pieces in bounds without overlap', () => {
    let state = startGame('GEOMETRY')
    for (const direction of ['left', 'down', 'right', 'up', 'left'] as const) {
      state = finishAnimation(moveBoard(state, direction))
      for (const board of state.boards) {
        for (let left = 0; left < board.pieces.length; left += 1) {
          const pieceLeft = board.pieces[left]
          const size = pieceLeft.kind === 'o2'
            ? { rows: 1, cols: 1 }
            : board.subtasks.find((item) => item.id === pieceLeft.subtaskId)!
          expect(pieceLeft.row).toBeGreaterThanOrEqual(0)
          expect(pieceLeft.col).toBeGreaterThanOrEqual(0)
          expect(pieceLeft.row + size.rows).toBeLessThanOrEqual(6)
          expect(pieceLeft.col + size.cols).toBeLessThanOrEqual(6)
          for (let right = left + 1; right < board.pieces.length; right += 1) {
            expect(piecesOverlap(board, pieceLeft, board.pieces[right])).toBe(false)
          }
        }
      }
    }
  })
})
