import { formatTotalScore } from './score'
import type { GameAction, GameState } from './types'

export const REPLAY_FILE_VERSION = 1
export const REPLAY_MIME = 'application/octet-stream'

/**
 * The payload written into a .dat file. It carries no board state at all:
 * seed + actions is enough for the server to replay the run and recompute
 * the score, which is exactly what makes server side validation possible.
 */
export interface ReplayFile {
  format: 'aknoi-replay'
  version: number
  seed: string
  /**
   * Claimed score, machine part only (0-600, no written exam bonus). The
   * server replays the actions and rejects mismatches, so this must stay on
   * the same scale the engine produces.
   */
  score: number
  moves: number
  finished: boolean
  actions: GameAction[]
  exportedAt: string
}

export function buildReplayFile(state: GameState): ReplayFile {
  return {
    format: 'aknoi-replay',
    version: REPLAY_FILE_VERSION,
    seed: state.seed,
    score: state.contestScore,
    moves: state.moves,
    finished: state.screen === 'finished',
    actions: state.history,
    exportedAt: new Date().toISOString(),
  }
}

/**
 * `AKNOI-<seed>-<score>.dat`, with anything filesystem hostile stripped out.
 * The name shows the score a human sees, i.e. including the written exam
 * bonus; the score stored inside the file stays on the engine scale.
 */
export function replayFileName(state: GameState) {
  const seed = state.seed.replace(/[^A-Za-z0-9_-]/g, '') || 'SEED'
  return `AKNOI-${seed}-${formatTotalScore(state.contestScore)}.dat`
}

export function serializeReplay(state: GameState) {
  return JSON.stringify(buildReplayFile(state))
}

/** Triggers the browser download. Returns the file name that was offered. */
export function downloadReplay(state: GameState) {
  const name = replayFileName(state)
  const blob = new Blob([serializeReplay(state)], { type: REPLAY_MIME })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  return name
}
