import {
  AC_LEVEL,
  BOARD_SIZE,
  GENERATED_SHAPES,
  VERDICTS,
} from '../data/verdicts'
import type {
  BoardPiece,
  Direction,
  GameState,
  MessageTone,
  PieceMotion,
  ProblemBoard,
  SubtaskDefinition,
  VerdictPiece,
} from './types'

interface RandomContext {
  rngState: number
  nextId: number
}

const BOARD_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']
const SUBTASK_SCORES = [10, 20, 30, 40, 50, 60, 70, 80, 90]

function hashSeed(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function nextRandom(context: RandomContext) {
  context.rngState = (context.rngState + 0x6d2b79f5) >>> 0
  let value = context.rngState
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

function uid(context: RandomContext, prefix: string) {
  context.nextId += 1
  return `${prefix}-${context.nextId}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function shuffle<T>(items: T[], context: RandomContext) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(nextRandom(context) * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function setMessage(
  state: GameState,
  message: string,
  tone: MessageTone = 'neutral',
) {
  state.message = message
  state.messageTone = tone
  state.eventId += 1
}

function getSubtask(board: ProblemBoard, piece: VerdictPiece) {
  return board.subtasks.find((item) => item.id === piece.subtaskId)!
}

function getPieceSize(board: ProblemBoard, piece: BoardPiece) {
  return piece.kind === 'o2'
    ? { rows: 1, cols: 1 }
    : getSubtask(board, piece)
}

export function pieceScore(board: ProblemBoard, piece: BoardPiece) {
  if (piece.kind === 'o2') return 0
  const subtask = getSubtask(board, piece)
  const score = subtask.maxScore * VERDICTS[piece.verdictLevel].multiplier
  return Math.round(score * 10) / 10
}

export function piecesOverlap(
  board: ProblemBoard,
  left: BoardPiece,
  right: BoardPiece,
) {
  const leftSize = getPieceSize(board, left)
  const rightSize = getPieceSize(board, right)
  return !(
    left.col + leftSize.cols <= right.col ||
    right.col + rightSize.cols <= left.col ||
    left.row + leftSize.rows <= right.row ||
    right.row + rightSize.rows <= left.row
  )
}

function isInsideBoard(board: ProblemBoard, piece: BoardPiece) {
  const size = getPieceSize(board, piece)
  return (
    piece.row >= 0 &&
    piece.col >= 0 &&
    piece.row + size.rows <= BOARD_SIZE &&
    piece.col + size.cols <= BOARD_SIZE
  )
}

export function crossSectionFits(
  board: ProblemBoard,
  moving: BoardPiece,
  target: BoardPiece,
  direction: Direction,
) {
  const movingSize = getPieceSize(board, moving)
  const targetSize = getPieceSize(board, target)
  if (direction === 'left' || direction === 'right') {
    return (
      target.row <= moving.row &&
      target.row + targetSize.rows >= moving.row + movingSize.rows
    )
  }
  return (
    target.col <= moving.col &&
    target.col + targetSize.cols >= moving.col + movingSize.cols
  )
}

function availablePlacements(
  board: ProblemBoard,
  subtask: SubtaskDefinition,
) {
  const placements: Array<{ row: number; col: number }> = []
  for (let row = 0; row <= BOARD_SIZE - subtask.rows; row += 1) {
    for (let col = 0; col <= BOARD_SIZE - subtask.cols; col += 1) {
      const candidate: BoardPiece = {
        kind: 'verdict',
        id: 'candidate',
        subtaskId: subtask.id,
        verdictLevel: 0,
        row,
        col,
      }
      if (!board.pieces.some((piece) => piecesOverlap(board, candidate, piece))) {
        placements.push({ row, col })
      }
    }
  }
  return placements
}

function availableO2Placements(board: ProblemBoard) {
  const placements: Array<{ row: number; col: number }> = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const candidate: BoardPiece = {
        kind: 'o2',
        id: 'candidate-o2',
        row,
        col,
      }
      if (!board.pieces.some((piece) => piecesOverlap(board, candidate, piece))) {
        placements.push({ row, col })
      }
    }
  }
  return placements
}

function chooseSpawnSubtask(board: ProblemBoard, context: RandomContext) {
  const roll = nextRandom(context)
  if (roll < 0.8) return board.subtasks[0]
  if (roll < 0.985) {
    const middle = board.subtasks.slice(1, -1)
    return middle[Math.floor(nextRandom(context) * middle.length)]
  }
  return board.subtasks.at(-1)!
}

function spawnPiece(
  board: ProblemBoard,
  context: RandomContext,
  forcedSubtask?: SubtaskDefinition,
) {
  if (!forcedSubtask && nextRandom(context) < 0.05) {
    const placements = availableO2Placements(board)
    if (placements.length > 0) {
      const placement = placements[Math.floor(nextRandom(context) * placements.length)]
      const piece: BoardPiece = {
        kind: 'o2',
        id: uid(context, 'o2'),
        ...placement,
      }
      board.pieces.push(piece)
      return piece.id
    }
  }

  const preferred = forcedSubtask ?? chooseSpawnSubtask(board, context)
  const fallback = [...board.subtasks].sort(
    (left, right) => left.rows * left.cols - right.rows * right.cols,
  )
  const subtasks = [preferred, ...fallback.filter((item) => item.id !== preferred.id)]

  for (const subtask of subtasks) {
    const placements = availablePlacements(board, subtask)
    if (placements.length === 0) continue
    const placement = placements[Math.floor(nextRandom(context) * placements.length)]
    const verdictLevel = nextRandom(context) < 0.88 ? 0 : 1
    const piece: BoardPiece = {
      kind: 'verdict',
      id: uid(context, 'piece'),
      subtaskId: subtask.id,
      verdictLevel,
      ...placement,
    }
    board.pieces.push(piece)
    return piece.id
  }
  return undefined
}

function generateSubtasks(boardId: string, context: RandomContext) {
  const generatedShapes = shuffle(GENERATED_SHAPES, context).slice(0, 3)
  const scores = shuffle(SUBTASK_SCORES, context).slice(0, 4)
  const shapes = [
    { rows: 1, cols: 1 },
    ...generatedShapes,
    { rows: 3, cols: 3 },
  ]
  return shapes.map((shape, index): SubtaskDefinition => ({
    id: `${boardId}-subtask-${index + 1}`,
    rows: shape.rows,
    cols: shape.cols,
    maxScore: index === shapes.length - 1 ? 100 : scores[index],
  }))
}

function createBoard(label: string, context: RandomContext): ProblemBoard {
  const id = `problem-${label}`
  const board: ProblemBoard = {
    id,
    label,
    status: 'active',
    subtasks: generateSubtasks(id, context),
    pieces: [],
    currentScore: 0,
  }
  spawnPiece(board, context, board.subtasks[0])
  spawnPiece(board, context, board.subtasks[0])
  return board
}

export function startGame(seed = 'AKNOI'): GameState {
  const normalizedSeed = seed.trim() || 'AKNOI'
  const context: RandomContext = {
    rngState: hashSeed(normalizedSeed),
    nextId: 0,
  }
  const boards = BOARD_LABELS.map((label) => createBoard(label, context))
  return {
    screen: 'playing',
    seed: normalizedSeed,
    rngState: context.rngState,
    nextId: context.nextId,
    boards,
    motion: [],
    spawnedPieceIds: [],
    contestScore: 0,
    moves: 0,
    mergeCount: 0,
    message: '六题同时评测；可以随时提交任意题目。',
    messageTone: 'neutral',
    eventId: 0,
    lastEvent: 'none',
  }
}

function movementDelta(direction: Direction) {
  if (direction === 'up') return { row: -1, col: 0 }
  if (direction === 'down') return { row: 1, col: 0 }
  if (direction === 'left') return { row: 0, col: -1 }
  return { row: 0, col: 1 }
}

function orderPieces(board: ProblemBoard, direction: Direction) {
  return [...board.pieces].sort((left, right) => {
    const leftSize = getPieceSize(board, left)
    const rightSize = getPieceSize(board, right)
    if (direction === 'left') return left.col - right.col || left.row - right.row
    if (direction === 'right') {
      return right.col + rightSize.cols - (left.col + leftSize.cols) || left.row - right.row
    }
    if (direction === 'up') return left.row - right.row || left.col - right.col
    return right.row + rightSize.rows - (left.row + leftSize.rows) || left.col - right.col
  })
}

interface MoveResult {
  pieces: BoardPiece[]
  motion: Omit<PieceMotion, 'boardId'>[]
  changed: boolean
  merges: number
}

// Front-to-back compaction: each block travels to its final position exactly once.
// Only already-settled blocks can stop it, so collision order is deterministic.
function simulateMove(board: ProblemBoard, direction: Direction): MoveResult {
  const originalPieces = clone(board.pieces)
  const settled: BoardPiece[] = []
  const mergedIds = new Set<string>()
  const removedDestinations = new Map<string, { row: number; col: number }>()
  const delta = movementDelta(direction)
  let changed = false
  let merges = 0

  for (const original of orderPieces(board, direction)) {
    let moving = clone(original)
    let collisions: BoardPiece[] = []
    let collisionPosition: BoardPiece | undefined

    while (true) {
      const proposed: BoardPiece = {
        ...moving,
        row: moving.row + delta.row,
        col: moving.col + delta.col,
      }
      if (!isInsideBoard(board, proposed)) break
      collisions = settled.filter((target) => piecesOverlap(board, proposed, target))
      if (collisions.length > 0) {
        collisionPosition = proposed
        break
      }
      moving = proposed
    }

    const target = collisions.length === 1 ? collisions[0] : undefined
    const fitsTarget = Boolean(
      target &&
      collisionPosition &&
      !mergedIds.has(target.id) &&
      crossSectionFits(board, moving, target, direction),
    )
    const o2Merge = Boolean(
      fitsTarget &&
      moving.kind === 'o2' &&
      target?.kind === 'verdict' &&
      target.verdictLevel < AC_LEVEL,
    )
    const verdictMerge = Boolean(
      fitsTarget &&
      moving.kind === 'verdict' &&
      target?.kind === 'verdict' &&
      target.verdictLevel === moving.verdictLevel &&
      target.verdictLevel < AC_LEVEL,
    )

    if (target?.kind === 'verdict' && collisionPosition && (o2Merge || verdictMerge)) {
      target.verdictLevel += 1
      mergedIds.add(target.id)
      removedDestinations.set(original.id, {
        row: collisionPosition.row,
        col: collisionPosition.col,
      })
      changed = true
      merges += 1
      continue
    }

    if (moving.row !== original.row || moving.col !== original.col) changed = true
    settled.push(moving)
  }

  const motion: Omit<PieceMotion, 'boardId'>[] = []
  for (const original of originalPieces) {
    const survivor = settled.find((piece) => piece.id === original.id)
    const removedAt = removedDestinations.get(original.id)
    if (removedAt) {
      motion.push({
        piece: original,
        toRow: removedAt.row,
        toCol: removedAt.col,
        removed: true,
      })
    } else if (
      survivor &&
      (survivor.row !== original.row || survivor.col !== original.col)
    ) {
      motion.push({
        piece: original,
        toRow: survivor.row,
        toCol: survivor.col,
        removed: false,
      })
    }
  }

  return { pieces: settled, motion, changed, merges }
}

export function canMove(board: ProblemBoard, direction: Direction) {
  return simulateMove(board, direction).changed
}

export function hasAnyMove(board: ProblemBoard) {
  const directions: Direction[] = ['up', 'down', 'left', 'right']
  return directions.some((direction) => canMove(board, direction))
}

function isBoardFull(board: ProblemBoard) {
  return availablePlacements(board, board.subtasks[0]).length === 0
}

function refreshBoardScore(board: ProblemBoard) {
  if (board.status === 'submitted') return
  board.currentScore = board.pieces.reduce(
    (best, piece) => Math.max(best, pieceScore(board, piece)),
    0,
  )
}

function refreshContest(state: GameState) {
  state.contestScore = Math.round(
    state.boards.reduce(
      (sum, board) => sum + (board.submittedScore ?? board.currentScore),
      0,
    ) * 10,
  ) / 10
}

function finishIfComplete(state: GameState) {
  if (!state.boards.every((board) => board.status === 'submitted')) return
  state.screen = 'finished'
  state.lastEvent = 'finish'
  setMessage(state, `比赛结束：${state.contestScore} / 600。`, state.contestScore === 600 ? 'good' : 'warn')
}

export function finishAnimation(current: GameState): GameState {
  if (current.motion.length === 0 && current.spawnedPieceIds.length === 0) return current
  return { ...current, motion: [], spawnedPieceIds: [] }
}

export function moveBoard(current: GameState, direction: Direction): GameState {
  if (current.screen !== 'playing' || current.motion.length > 0) return current

  const plans = current.boards.map((board) =>
    board.status === 'active' ? simulateMove(board, direction) : undefined,
  )
  if (!plans.some((plan) => plan?.changed)) return current

  const state = clone(current)
  state.motion = []
  state.spawnedPieceIds = []
  state.moves += 1
  let totalMerges = 0
  const autoSubmitted: string[] = []

  state.boards.forEach((board, index) => {
    const plan = plans[index]
    if (!plan?.changed || board.status !== 'active') return

    board.pieces = plan.pieces
    state.mergeCount += plan.merges
    totalMerges += plan.merges
    state.motion.push(
      ...plan.motion.map((motion) => ({ ...motion, boardId: board.id })),
    )
    refreshBoardScore(board)

    const spawnedId = spawnPiece(board, state)
    if (spawnedId) state.spawnedPieceIds.push(spawnedId)
    refreshBoardScore(board)

    if (!spawnedId || isBoardFull(board) || !hasAnyMove(board)) {
      board.status = 'submitted'
      board.submittedScore = board.currentScore
      board.autoSubmitted = true
      autoSubmitted.push(board.label)
    }
  })

  refreshContest(state)
  state.lastEvent = totalMerges > 0 ? 'merge' : 'move'
  const parts: string[] = []
  if (totalMerges) parts.push(`合并 ${totalMerges} 次`)
  if (autoSubmitted.length) parts.push(`${autoSubmitted.join('、')} 题自动提交`)
  setMessage(
    state,
    parts.length ? parts.join('；') : '六题继续评测。',
    autoSubmitted.length ? 'warn' : totalMerges ? 'good' : 'neutral',
  )
  finishIfComplete(state)
  return state
}

export function submitBoard(current: GameState, boardId: string): GameState {
  if (current.screen !== 'playing' || current.motion.length > 0) return current
  const currentBoard = current.boards.find((board) => board.id === boardId)
  if (!currentBoard || currentBoard.status !== 'active') return current

  const state = clone(current)
  const board = state.boards.find((item) => item.id === boardId)!
  refreshBoardScore(board)
  board.status = 'submitted'
  board.submittedScore = board.currentScore
  board.autoSubmitted = false
  state.lastEvent = 'submit'
  refreshContest(state)
  setMessage(state, `${board.label} 题已提交：${board.submittedScore} 分。`, board.submittedScore > 0 ? 'good' : 'warn')
  finishIfComplete(state)
  return state
}
