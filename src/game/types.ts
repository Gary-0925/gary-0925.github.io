export type CardKind =
  | 'verdict'
  | 'o2'
  | 'o3'
  | 'hack'
  | 'gdb'
  | 'longLong'
  | 'subtask'

export type GameScreen = 'cover' | 'playing' | 'won' | 'lost'
export type MessageTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface JudgeCard {
  uid: string
  kind: CardKind
  rank?: number
}

export interface QueueState {
  cards: JudgeCard[]
  solved: boolean
}

export interface GameState {
  screen: GameScreen
  round: number
  score: number
  queues: QueueState[]
  hand: JudgeCard[]
  selectedId?: string
  solvedCount: number
  mergeCount: number
  maxRank: number
  message: string
  messageTone: MessageTone
  eventId: number
  lastEvent: 'none' | 'place' | 'merge' | 'ac' | 'hack' | 'special' | 'afo'
}
