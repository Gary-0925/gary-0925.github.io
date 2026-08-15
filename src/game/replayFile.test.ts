import { describe, expect, it } from 'vitest'
import { finishAnimation, moveBoard, replayGame, startGame, submitBoard } from './engine'
import { buildReplayFile, replayFileName, serializeReplay } from './replayFile'
import type { Direction, GameAction } from './types'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Plays `steps` random moves, then submits everything so the run is finished. */
export function playFinishedGame(seed: string, rngSeed: number, steps = 200) {
  const random = makeRng(rngSeed)
  let state = startGame(seed)

  for (let index = 0; index < steps && state.screen === 'playing'; index += 1) {
    const direction = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)]
    state = finishAnimation(moveBoard(state, direction))
  }
  for (const board of state.boards) {
    if (board.status === 'active') state = finishAnimation(submitBoard(state, board.id))
  }
  return state
}

describe('replay file', () => {
  it('carries the seed and the full action history', () => {
    const state = playFinishedGame('EXPORT1', 4242)
    const file = buildReplayFile(state)

    expect(file.format).toBe('aknoi-replay')
    expect(file.version).toBe(1)
    expect(file.seed).toBe('EXPORT1')
    expect(file.score).toBe(state.contestScore)
    expect(file.moves).toBe(state.moves)
    expect(file.finished).toBe(true)
    expect(file.actions).toEqual(state.history)
    expect(file.actions.length).toBeGreaterThan(0)
    expect(Date.parse(file.exportedAt)).not.toBeNaN()
  })

  it('is enough on its own to reproduce the score', () => {
    const state = playFinishedGame('EXPORT2', 777)
    const file = JSON.parse(serializeReplay(state)) as { seed: string; actions: GameAction[] }

    // This is exactly what the server does with an uploaded .dat.
    const replayed = replayGame(file.seed, file.actions)
    expect(replayed.contestScore).toBe(state.contestScore)
    expect(replayed.moves).toBe(state.moves)
  })

  it('names the file after the seed and score', () => {
    const state = playFinishedGame('NAMED', 99)
    expect(replayFileName(state)).toMatch(/^AKNOI-NAMED-\d+(\.\d)?\.dat$/)
  })

  it('strips characters that are unsafe in a file name', () => {
    const state = startGame('  bad/name*?  ')
    expect(replayFileName(state)).toMatch(/^AKNOI-badname-\d+(\.\d)?\.dat$/)
  })

  it('falls back to SEED when nothing usable is left', () => {
    const state = startGame('///')
    expect(replayFileName(state)).toMatch(/^AKNOI-SEED-/)
  })

  it('serializes to compact JSON without board state', () => {
    const state = playFinishedGame('EXPORT3', 5)
    const text = serializeReplay(state)
    expect(text.startsWith('{')).toBe(true)
    expect(text).not.toContain('pieces')
    expect(text).not.toContain('subtasks')
  })
})
