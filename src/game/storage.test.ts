import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finishAnimation, moveBoard, replayGame, startGame, submitBoard } from './engine'
import {
  clearSavedGame,
  loadSavedGame,
  readBestScore,
  saveGame,
  writeBestScore,
} from './storage'

function installStorage(impl?: Partial<Storage>) {
  const data = new Map<string, string>()
  const store: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    ...impl,
  }
  vi.stubGlobal('localStorage', store)
  return data
}

describe('save file', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    installStorage()
  })

  it('round trips a session and resumes exactly where it stopped', () => {
    let state = startGame('SAVE-ME')
    for (const direction of ['left', 'up', 'right', 'down', 'left'] as const) {
      state = finishAnimation(moveBoard(state, direction))
    }
    state = finishAnimation(submitBoard(state, state.boards[1].id))
    saveGame(state)

    const saved = loadSavedGame()!
    expect(saved.seed).toBe('SAVE-ME')
    expect(saved.actions).toEqual(state.history)
    expect(replayGame(saved.seed, saved.actions)).toEqual(state)
  })

  it('keeps growing the log across reload boundaries', () => {
    let state = finishAnimation(moveBoard(startGame('RESUME'), 'left'))
    saveGame(state)

    // Simulate a reload: rebuild from disk, then keep playing.
    const reloaded = replayGame(loadSavedGame()!.seed, loadSavedGame()!.actions)
    expect(reloaded).toEqual(state)

    state = finishAnimation(moveBoard(reloaded, 'down'))
    saveGame(state)
    expect(loadSavedGame()!.actions).toHaveLength(2)
    expect(replayGame('RESUME', loadSavedGame()!.actions)).toEqual(state)
  })

  it('discards corrupt, foreign or truncated save files', () => {
    const cases = [
      'not json',
      '{}',
      JSON.stringify({ version: 2, seed: 'X', actions: [] }),
      JSON.stringify({ version: 1, seed: '', actions: [] }),
      JSON.stringify({ version: 1, seed: 'X', actions: 'nope' }),
      JSON.stringify({ version: 1, seed: 'X', actions: [{ type: 'move', direction: 'sideways' }] }),
      JSON.stringify({ version: 1, seed: 'X', actions: [{ type: 'teleport' }] }),
      JSON.stringify({ version: 1, seed: 'X', actions: [{ type: 'submit' }] }),
    ]
    for (const raw of cases) {
      localStorage.setItem('aknoi-save-v1', raw)
      expect(loadSavedGame()).toBeUndefined()
    }
  })

  it('skips actions that no longer apply instead of throwing', () => {
    const state = replayGame('SKIP', [
      { type: 'submit', boardId: 'problem-DOES-NOT-EXIST' },
      { type: 'move', direction: 'left' },
    ])
    expect(state.history).toEqual([{ type: 'move', direction: 'left' }])
  })

  it('clears the save file when a new game starts', () => {
    saveGame(startGame('OLD'))
    expect(loadSavedGame()).toBeDefined()
    clearSavedGame()
    expect(loadSavedGame()).toBeUndefined()
  })

  it('never lets unavailable storage break the game', () => {
    installStorage({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => saveGame(startGame('PRIVATE'))).not.toThrow()
    expect(loadSavedGame()).toBeUndefined()
    expect(() => clearSavedGame()).not.toThrow()
    expect(readBestScore()).toBe(0)
    expect(() => writeBestScore(120)).not.toThrow()
  })

  it('reads back a best score and ignores junk values', () => {
    writeBestScore(431.5)
    expect(readBestScore()).toBe(431.5)
    localStorage.setItem('aknoi-best-score', 'NaN')
    expect(readBestScore()).toBe(0)
  })
})
