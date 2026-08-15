import type { Direction, GameAction, GameState } from './types'

const SAVE_KEY = 'aknoi-save-v1'
const BEST_SCORE_KEY = 'aknoi-best-score'

export interface SavedGame {
  version: 1
  seed: string
  actions: GameAction[]
  savedAt: number
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function isDirection(value: unknown): value is Direction {
  return DIRECTIONS.includes(value as Direction)
}

/** Storage is user-editable and survives deploys, so every field is re-checked. */
function parseActions(value: unknown): GameAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  const actions: GameAction[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return undefined
    const action = entry as Record<string, unknown>
    if (action.type === 'move' && isDirection(action.direction)) {
      actions.push({ type: 'move', direction: action.direction })
    } else if (action.type === 'submit' && typeof action.boardId === 'string') {
      actions.push({ type: 'submit', boardId: action.boardId })
    } else {
      return undefined
    }
  }
  return actions
}

export function loadSavedGame(): SavedGame | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed?.version !== 1 || typeof parsed.seed !== 'string' || !parsed.seed) return undefined
    const actions = parseActions(parsed.actions)
    if (!actions) return undefined
    return {
      version: 1,
      seed: parsed.seed,
      actions,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    }
  } catch {
    return undefined
  }
}

export function saveGame(state: GameState) {
  try {
    const payload: SavedGame = {
      version: 1,
      seed: state.seed,
      actions: state.history,
      savedAt: Date.now(),
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload))
  } catch {
    // Saving is best effort; private mode and full quotas must not break play.
  }
}

export function clearSavedGame() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // Ignore: nothing to clean up when storage is unavailable.
  }
}

export function readBestScore() {
  try {
    const value = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function writeBestScore(score: number) {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(score))
  } catch {
    // Records are optional.
  }
}
