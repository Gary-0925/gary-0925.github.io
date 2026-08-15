export type Direction = 'up' | 'down' | 'left' | 'right'
export type BoardStatus = 'active' | 'submitted'
export type GameScreen = 'playing' | 'finished'
export type MessageTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface SubtaskDefinition {
  id: string
  rows: number
  cols: number
  maxScore: number
}

interface PiecePosition {
  id: string
  row: number
  col: number
}

export interface VerdictPiece extends PiecePosition {
  kind: 'verdict'
  subtaskId: string
  verdictLevel: number
}

export interface O2Piece extends PiecePosition {
  kind: 'o2'
}

export type BoardPiece = VerdictPiece | O2Piece

export interface ProblemBoard {
  id: string
  label: string
  status: BoardStatus
  subtasks: SubtaskDefinition[]
  pieces: BoardPiece[]
  currentScore: number
  submittedScore?: number
}

export type GameAction =
  | { type: 'move'; direction: Direction }
  | { type: 'submit'; boardId: string }

export interface PieceMotion {
  boardId: string
  piece: BoardPiece
  toRow: number
  toCol: number
  removed: boolean
}

export interface GameState {
  screen: GameScreen
  seed: string
  rngState: number
  nextId: number
  boards: ProblemBoard[]
  /** Every accepted action, in order. Seed + history fully rebuilds this state. */
  history: GameAction[]
  motion: PieceMotion[]
  spawnedPieceIds: string[]
  contestScore: number
  moves: number
  mergeCount: number
  message: string
  messageTone: MessageTone
  eventId: number
  lastEvent: 'none' | 'move' | 'merge' | 'submit' | 'finish'
}
