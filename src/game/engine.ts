import {
  HAND_SIZE,
  MAX_QUEUE_HEIGHT,
  PROBLEM_QUEUES,
  VERDICTS,
} from '../data/verdicts'
import type { GameState, JudgeCard, MessageTone } from './types'

type RandomSource = () => number

let uidSequence = 0

function uid(prefix: string) {
  uidSequence += 1
  return `${prefix}-${uidSequence}`
}

function verdictCard(rank: number): JudgeCard {
  return { uid: uid('submission'), kind: 'verdict', rank }
}

function specialCard(kind: Exclude<JudgeCard['kind'], 'verdict'>): JudgeCard {
  return { uid: uid(kind), kind }
}

function clone(state: GameState): GameState {
  return structuredClone(state)
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

function drawRandomCard(round: number, random: RandomSource) {
  const specialRoll = random()
  if (specialRoll < 0.055) return specialCard('o2')
  if (specialRoll < 0.075) return specialCard('o3')
  if (specialRoll < 0.11) return specialCard('gdb')
  if (specialRoll < 0.135) return specialCard('longLong')
  if (specialRoll < 0.15) return specialCard('subtask')

  const baseTier = Math.min(5, Math.floor((round - 1) / 8))
  const rankRoll = random()
  let rank = baseTier
  if (rankRoll > 0.62) rank += 1
  if (rankRoll > 0.9) rank += 1
  return verdictCard(Math.min(rank, 6))
}

export function generateHand(
  round: number,
  random: RandomSource = Math.random,
): JudgeCard[] {
  if (round === 1) {
    return [verdictCard(0), verdictCard(0), verdictCard(1)]
  }

  const hand = Array.from({ length: HAND_SIZE }, () =>
    drawRandomCard(round, random),
  )

  if (round % 6 === 0) {
    hand[Math.floor(random() * HAND_SIZE)] = specialCard('hack')
  }
  return hand
}

function baseState(screen: GameState['screen']): GameState {
  return {
    screen,
    round: 1,
    score: 0,
    queues: PROBLEM_QUEUES.map(() => ({ cards: [], solved: false })),
    hand: [],
    solvedCount: 0,
    mergeCount: 0,
    maxRank: 0,
    message: '拖动卡片到队列，或点选卡片后快速提交。',
    messageTone: 'neutral',
    eventId: 0,
    lastEvent: 'none',
  }
}

export function createInitialState(): GameState {
  return baseState('cover')
}

export function startGame(random: RandomSource = Math.random): GameState {
  const state = baseState('playing')
  state.hand = generateHand(1, random)
  return state
}

export function selectCard(current: GameState, cardUid: string): GameState {
  if (current.screen !== 'playing') return current
  if (!current.hand.some((card) => card.uid === cardUid)) return current
  const state = clone(current)
  state.selectedId = state.selectedId === cardUid ? undefined : cardUid
  if (state.selectedId) {
    setMessage(state, '选择下方 T1～T4，或直接点击发光的队列。')
  }
  return state
}

export function canPlaceCard(
  state: GameState,
  card: JudgeCard,
  queueIndex: number,
) {
  const queue = state.queues[queueIndex]
  if (!queue) return false

  // Special cards modify the queue instead of occupying a slot.
  if (card.kind !== 'verdict') return true
  if (queue.cards.length < MAX_QUEUE_HEIGHT) return true

  const top = queue.cards.at(-1)
  return Boolean(top?.kind === 'verdict' && top.rank === card.rank)
}

function solveQueue(state: GameState, queueIndex: number) {
  const queue = state.queues[queueIndex]
  const firstSolve = !queue.solved
  queue.cards = []
  queue.solved = true
  state.score += firstSolve ? 1000 : 256
  state.maxRank = VERDICTS.length - 1
  state.lastEvent = 'ac'

  if (firstSolve) {
    state.solvedCount += 1
    setMessage(
      state,
      `${PROBLEM_QUEUES[queueIndex].number} Accepted！还差 ${PROBLEM_QUEUES.length - state.solvedCount} 题。`,
      'good',
    )
  } else {
    setMessage(state, '这道题已经 AC；重复提交被清空了。', 'warn')
  }

  if (state.solvedCount === PROBLEM_QUEUES.length) {
    state.screen = 'won'
    state.score += Math.max(0, 5000 - state.round * 50)
    setMessage(state, '四题全部通过。AK！', 'good')
  }
}

function resolveQueue(state: GameState, queueIndex: number) {
  const queue = state.queues[queueIndex]
  let merged = 0
  let highestRank = -1

  while (queue.cards.length >= 2) {
    const top = queue.cards.at(-1)
    const below = queue.cards.at(-2)
    if (
      !top ||
      !below ||
      top.kind !== 'verdict' ||
      below.kind !== 'verdict' ||
      top.rank !== below.rank
    ) {
      break
    }

    queue.cards.pop()
    queue.cards.pop()
    const nextRank = (top.rank ?? 0) + 1
    merged += 1
    highestRank = Math.max(highestRank, nextRank)
    state.mergeCount += 1
    state.score += VERDICTS[nextRank].value
    state.maxRank = Math.max(state.maxRank, nextRank)

    if (nextRank >= VERDICTS.length - 1) {
      solveQueue(state, queueIndex)
      return
    }
    queue.cards.push(verdictCard(nextRank))
  }

  if (merged > 0) {
    state.lastEvent = 'merge'
    const chain = merged > 1 ? `，连锁 ×${merged}` : ''
    setMessage(state, `合并为 ${VERDICTS[highestRank].label}${chain}。`, 'good')
  }
}

function applyVerdict(state: GameState, card: JudgeCard, queueIndex: number) {
  state.queues[queueIndex].cards.push(card)
  state.maxRank = Math.max(state.maxRank, card.rank ?? 0)
  state.lastEvent = 'place'
  setMessage(
    state,
    `${PROBLEM_QUEUES[queueIndex].number} 返回 ${VERDICTS[card.rank ?? 0].label}。`,
  )
  resolveQueue(state, queueIndex)
}

function setTopRank(
  state: GameState,
  queueIndex: number,
  rank: number,
): 'none' | 'merge' | 'ac' {
  const queue = state.queues[queueIndex]
  const mergesBefore = state.mergeCount
  const solvedBefore = state.solvedCount
  queue.cards[queue.cards.length - 1] = verdictCard(rank)
  state.maxRank = Math.max(state.maxRank, rank)
  if (rank >= VERDICTS.length - 1) {
    solveQueue(state, queueIndex)
  } else {
    resolveQueue(state, queueIndex)
  }
  if (state.solvedCount > solvedBefore || state.lastEvent === 'ac') return 'ac'
  if (state.mergeCount > mergesBefore) return 'merge'
  return 'none'
}

function applyOptimization(
  state: GameState,
  queueIndex: number,
  steps: number,
  risk: number,
  riskStartsAt: number,
  label: 'O2' | 'O3',
  random: RandomSource,
) {
  const top = state.queues[queueIndex].cards.at(-1)
  state.lastEvent = 'special'
  if (!top || top.kind !== 'verdict') {
    setMessage(state, `${label} 找不到可优化的提交，白吸了。`, 'warn')
    return
  }

  const currentRank = top.rank ?? 0
  if (currentRank >= riskStartsAt && random() < risk) {
    setTopRank(state, queueIndex, 2)
    state.lastEvent = 'hack'
    setMessage(
      state,
      `${label} 优化破坏了未定义行为：${VERDICTS[currentRank].label} → RE。`,
      'bad',
    )
    return
  }

  const nextRank = Math.min(currentRank + steps, VERDICTS.length - 1)
  state.score += VERDICTS[nextRank].value
  const outcome = setTopRank(state, queueIndex, nextRank)
  if (state.screen === 'playing' && outcome === 'none') {
    state.lastEvent = 'special'
    setMessage(state, `${label} 生效：队尾变为 ${VERDICTS[nextRank].label}。`, 'good')
  }
}

function applyHack(state: GameState, queueIndex: number) {
  const queue = state.queues[queueIndex]
  const top = queue.cards.at(-1)
  state.lastEvent = 'hack'

  if (!top || top.kind !== 'verdict') {
    queue.cards.push(verdictCard(0))
    setMessage(state, 'Hack 数据制造了一张 CE。', 'bad')
    return
  }

  const nextRank = Math.max(0, (top.rank ?? 0) - 1)
  const outcome = setTopRank(state, queueIndex, nextRank)
  if (outcome === 'none') {
    state.lastEvent = 'hack'
    setMessage(
      state,
      `Hack 命中：${VERDICTS[top.rank ?? 0].label} 降为 ${VERDICTS[nextRank].label}。`,
      'bad',
    )
  }
}

function applyGdb(state: GameState, queueIndex: number) {
  const queue = state.queues[queueIndex]
  const top = queue.cards.at(-1)
  state.lastEvent = 'special'
  if (top?.kind === 'verdict' && (top.rank ?? 0) <= 2) {
    queue.cards.pop()
    state.score += 10
    setMessage(state, `GDB 定位并删除了 ${VERDICTS[top.rank ?? 0].label}。`, 'good')
  } else {
    setMessage(state, 'GDB 没找到 CE、Judging 或 RE，断点落空。', 'warn')
  }
}

function applyLongLong(state: GameState, queueIndex: number) {
  const top = state.queues[queueIndex].cards.at(-1)
  state.lastEvent = 'special'
  if (top?.kind === 'verdict' && (top.rank === 2 || top.rank === 5)) {
    const nextRank = top.rank + 1
    const outcome = setTopRank(state, queueIndex, nextRank)
    if (outcome === 'none') {
      state.lastEvent = 'special'
      setMessage(
        state,
        `long long 修复了 ${VERDICTS[top.rank].label}，现在是 ${VERDICTS[nextRank].label}。`,
        'good',
      )
    }
  } else {
    setMessage(state, '这里的问题不是 int 溢出，long long 没有作用。', 'warn')
  }
}

function applySubtask(state: GameState, queueIndex: number) {
  const top = state.queues[queueIndex].cards.at(-1)
  state.lastEvent = 'special'
  if (
    top?.kind === 'verdict' &&
    top.rank !== undefined &&
    top.rank >= 3 &&
    top.rank <= 5
  ) {
    const oldRank = top.rank
    const outcome = setTopRank(state, queueIndex, 6)
    if (outcome === 'none') {
      state.lastEvent = 'special'
      setMessage(
        state,
        `Subtask 生效：${VERDICTS[oldRank].label} → PC。`,
        'good',
      )
    }
  } else {
    setMessage(state, '当前状态不满足部分分条件。', 'warn')
  }
}

function hasAnyMove(state: GameState) {
  return state.hand.some((card) =>
    state.queues.some((_, index) => canPlaceCard(state, card, index)),
  )
}

function checkAfo(state: GameState) {
  if (state.screen !== 'playing' || state.hand.length === 0) return
  if (hasAnyMove(state)) return
  state.screen = 'lost'
  state.lastEvent = 'afo'
  setMessage(state, '所有提交都无法入队：AFO。', 'bad')
}

function advanceRound(state: GameState, random: RandomSource) {
  if (state.screen !== 'playing' || state.hand.length > 0) return
  state.round += 1
  state.hand = generateHand(state.round, random)
  state.selectedId = undefined
  if (state.round % 6 === 0) {
    state.message = `${state.message} 下一组含 Hack 数据。`
    state.messageTone = 'warn'
  }
  checkAfo(state)
}

export function placeCard(
  current: GameState,
  cardUid: string,
  queueIndex: number,
  random: RandomSource = Math.random,
): GameState {
  if (current.screen !== 'playing') return current
  const card = current.hand.find((item) => item.uid === cardUid)
  if (!card || !canPlaceCard(current, card, queueIndex)) {
    const invalid = clone(current)
    setMessage(invalid, '队列已满，队尾也无法与这张牌合并。', 'warn')
    return invalid
  }

  const state = clone(current)
  const cardIndex = state.hand.findIndex((item) => item.uid === cardUid)
  const [playedCard] = state.hand.splice(cardIndex, 1)
  state.selectedId = undefined

  if (playedCard.kind === 'verdict') applyVerdict(state, playedCard, queueIndex)
  if (playedCard.kind === 'o2') applyOptimization(state, queueIndex, 1, 0.3, 3, 'O2', random)
  if (playedCard.kind === 'o3') applyOptimization(state, queueIndex, 2, 0.45, 2, 'O3', random)
  if (playedCard.kind === 'hack') applyHack(state, queueIndex)
  if (playedCard.kind === 'gdb') applyGdb(state, queueIndex)
  if (playedCard.kind === 'longLong') applyLongLong(state, queueIndex)
  if (playedCard.kind === 'subtask') applySubtask(state, queueIndex)

  advanceRound(state, random)
  checkAfo(state)
  return state
}

export function placeSelected(
  current: GameState,
  queueIndex: number,
  random: RandomSource = Math.random,
): GameState {
  if (!current.selectedId) return current
  return placeCard(current, current.selectedId, queueIndex, random)
}

export function turnsUntilHack(round: number) {
  const remainder = round % 6
  return remainder === 0 ? 0 : 6 - remainder
}
