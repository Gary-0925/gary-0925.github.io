export type CardKind = 'verdict' | 'o2' | 'hack'
export type GameScreen = 'cover' | 'playing' | 'won' | 'lost'
export type MessageTone = 'neutral' | 'good' | 'warn' | 'bad'
export type ToolMode = 'none' | 'dsu'

export interface JudgeCard {
  uid: string
  kind: CardKind
  rank?: number
}

export interface QueueState {
  cards: JudgeCard[]
  solved: boolean
}

export interface GameSnapshot {
  round: number
  score: number
  insight: number
  queues: QueueState[]
  hand: JudgeCard[]
  selectedId?: string
  cache?: JudgeCard
  solvedCount: number
  mergeCount: number
  maxRank: number
  message: string
  messageTone: MessageTone
}

export interface GameState {
  screen: GameScreen
  round: number
  score: number
  insight: number
  queues: QueueState[]
  hand: JudgeCard[]
  selectedId?: string
  cache?: JudgeCard
  solvedCount: number
  mergeCount: number
  maxRank: number
  message: string
  messageTone: MessageTone
  eventId: number
  lastEvent: 'none' | 'place' | 'merge' | 'ac' | 'hack' | 'tool' | 'afo'
  history: GameSnapshot[]
  toolMode: ToolMode
  dsuSource?: number
}
