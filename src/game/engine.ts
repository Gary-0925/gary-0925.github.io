import {
  HAND_SIZE,
  MAX_QUEUE_HEIGHT,
  PROBLEM_QUEUES,
  VERDICTS,
} from '../data/verdicts'
import type {
  GameSnapshot,
  GameState,
  JudgeCard,
  MessageTone,
} from './types'

type RandomSource = () => number

let uidSequence = 0

function uid(prefix: string) {
  uidSequence += 1
  return `${prefix}-${uidSequence}`
}

function verdictCard(rank: number): JudgeCard {
  return { uid: uid('submission'), kind: 'verdict', rank }
}

function specialCard(kind: 'o2' | 'hack'): JudgeCard {
  return { uid: uid(kind), kind }
}

function clone(state: GameState): GameState {
  return structuredClone(state)
}

function takeSnapshot(state: GameState): GameSnapshot {
  return {
    round: state.round,
    score: state.score,
    insight: state.insight,
    queues: structuredClone(state.queues),
    hand: structuredClone(state.hand),
    selectedId: state.selectedId,
    cache: state.cache ? structuredClone(state.cache) : undefined,
    solvedCount: state.solvedCount,
    mergeCount: state.mergeCount,
    maxRank: state.maxRank,
    message: state.message,
    messageTone: state.messageTone,
  }
}

function pushHistory(state: GameState) {
  state.history = [...state.history, takeSnapshot(state)].slice(-12)
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

export function generateHand(
  round: number,
  random: RandomSource = Math.random,
): JudgeCard[] {
  if (round === 1) {
    return [verdictCard(0), verdictCard(0), verdictCard(1)]
  }

  const baseTier = Math.min(5, Math.floor((round - 1) / 8))
  const hand = Array.from({ length: HAND_SIZE }, () => {
    const roll = random()
    if (roll > 0.965) return specialCard('o2')

    let rank = baseTier
    if (roll > 0.62) rank += 1
    if (roll > 0.9) rank += 1
    return verdictCard(Math.min(rank, 6))
  })

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
    insight: 0,
    queues: PROBLEM_QUEUES.map(() => ({ cards: [], solved: false })),
    hand: [],
    solvedCount: 0,
    mergeCount: 0,
    maxRank: 0,
    message: '选择一张提交牌，再选择评测队列。',
    messageTone: 'neutral',
    eventId: 0,
    lastEvent: 'none',
    history: [],
    toolMode: 'none',
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
  state.toolMode = 'none'
  state.dsuSource = undefined
  if (state.selectedId) {
    setMessage(state, '已选中提交牌。现在选择 T1～T4 中的一条队列。')
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
  const top = queue.cards.at(-1)

  if (card.kind === 'o2') return Boolean(top)
  if (card.kind === 'hack') return Boolean(top) || queue.cards.length < MAX_QUEUE_HEIGHT
  if (queue.cards.length < MAX_QUEUE_HEIGHT) return true

  return Boolean(
    top &&
      top.kind === 'verdict' &&
      card.kind === 'verdict' &&
      top.rank === card.rank,
  )
}

function solveQueue(state: GameState, queueIndex: number) {
  const queue = state.queues[queueIndex]
  const firstSolve = !queue.solved
  queue.cards = []
  queue.solved = true
  state.insight += 2
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
    state.insight += 1
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
    setMessage(
      state,
      `合并为 ${VERDICTS[highestRank].label}${chain}，获得 ${merged} 点思考。`,
      'good',
    )
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

function applyO2(state: GameState, queueIndex: number) {
  const queue = state.queues[queueIndex]
  const top = queue.cards.at(-1)
  if (!top || top.kind !== 'verdict') return

  const nextRank = Math.min((top.rank ?? 0) + 1, VERDICTS.length - 1)
  queue.cards[queue.cards.length - 1] = verdictCard(nextRank)
  state.score += VERDICTS[nextRank].value
  state.maxRank = Math.max(state.maxRank, nextRank)
  state.lastEvent = 'merge'

  if (nextRank === VERDICTS.length - 1) {
    solveQueue(state, queueIndex)
    return
  }
  setMessage(state, `吸氧成功：队尾变为 ${VERDICTS[nextRank].label}。`, 'good')
  resolveQueue(state, queueIndex)
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
  queue.cards[queue.cards.length - 1] = verdictCard(nextRank)
  setMessage(
    state,
    `Hack 命中：${VERDICTS[top.rank ?? 0].label} 降为 ${VERDICTS[nextRank].label}。`,
    'bad',
  )
  resolveQueue(state, queueIndex)
}

function hasDsuPair(state: GameState) {
  for (let left = 0; left < state.queues.length; left += 1) {
    const leftTop = state.queues[left].cards.at(-1)
    if (!leftTop || leftTop.kind !== 'verdict') continue
    for (let right = left + 1; right < state.queues.length; right += 1) {
      const rightTop = state.queues[right].cards.at(-1)
      if (
        rightTop?.kind === 'verdict' &&
        leftTop.rank === rightTop.rank
      ) {
        return true
      }
    }
  }
  return false
}

function canCacheRescue(state: GameState) {
  if (state.insight < (state.cache ? 1 : 2)) return false
  if (!state.cache) return true
  return state.queues.some((_, index) => canPlaceCard(state, state.cache!, index))
}

function hasAnyMove(state: GameState) {
  const directMove = state.hand.some((card) =>
    state.queues.some((_, index) => canPlaceCard(state, card, index)),
  )
  if (directMove) return true
  if (state.history.length > 0 && state.insight >= 1) return true
  if (state.insight >= 4 && hasDsuPair(state)) return true
  return canCacheRescue(state)
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
  state.toolMode = 'none'
  state.dsuSource = undefined
  if (state.round % 6 === 0) {
    setMessage(state, `第 ${state.round} 轮：Hack 数据混入了手牌。`, 'warn')
  } else {
    setMessage(state, `第 ${state.round} 轮，三份新提交已进入等待区。`)
  }
  checkAfo(state)
}

export function placeSelected(
  current: GameState,
  queueIndex: number,
  random: RandomSource = Math.random,
): GameState {
  if (current.screen !== 'playing' || !current.selectedId) return current
  const card = current.hand.find((item) => item.uid === current.selectedId)
  if (!card || !canPlaceCard(current, card, queueIndex)) {
    const invalid = clone(current)
    setMessage(invalid, '该队列已满，且队尾无法与这张牌合并。', 'warn')
    return invalid
  }

  const state = clone(current)
  pushHistory(state)
  const cardIndex = state.hand.findIndex((item) => item.uid === state.selectedId)
  const [playedCard] = state.hand.splice(cardIndex, 1)
  state.selectedId = undefined

  if (playedCard.kind === 'verdict') applyVerdict(state, playedCard, queueIndex)
  if (playedCard.kind === 'o2') applyO2(state, queueIndex)
  if (playedCard.kind === 'hack') applyHack(state, queueIndex)

  advanceRound(state, random)
  checkAfo(state)
  return state
}

export function useRollback(current: GameState): GameState {
  if (
    current.screen !== 'playing' ||
    current.insight < 1 ||
    current.history.length === 0
  ) {
    return current
  }

  const state = clone(current)
  const snapshot = state.history.pop()
  if (!snapshot) return current

  state.round = snapshot.round
  state.score = snapshot.score
  state.insight = Math.max(0, snapshot.insight - 1)
  state.queues = snapshot.queues
  state.hand = snapshot.hand
  state.selectedId = snapshot.selectedId
  state.cache = snapshot.cache
  state.solvedCount = snapshot.solvedCount
  state.mergeCount = snapshot.mergeCount
  state.maxRank = snapshot.maxRank
  state.screen = 'playing'
  state.toolMode = 'none'
  state.dsuSource = undefined
  state.lastEvent = 'tool'
  setMessage(state, '回滚完成。刚才的提交从未发生。', 'good')
  return state
}

export function memoizeSelected(
  current: GameState,
  random: RandomSource = Math.random,
): GameState {
  if (current.screen !== 'playing' || !current.selectedId) return current
  const cost = current.cache ? 1 : 2
  if (current.insight < cost) return current

  const state = clone(current)
  pushHistory(state)
  const index = state.hand.findIndex((card) => card.uid === state.selectedId)
  if (index < 0) return current
  const selected = state.hand[index]
  state.insight -= cost

  if (state.cache) {
    const recalled = state.cache
    state.hand[index] = recalled
    state.cache = selected
    state.selectedId = recalled.uid
    setMessage(state, '记忆化命中：手牌与缓存完成交换。', 'good')
  } else {
    state.hand.splice(index, 1)
    state.cache = selected
    state.selectedId = undefined
    setMessage(state, '状态已写入记忆化缓存。', 'good')
  }
  state.lastEvent = 'tool'
  advanceRound(state, random)
  checkAfo(state)
  return state
}

export function activateDsu(current: GameState): GameState {
  if (current.screen !== 'playing' || current.insight < 4 || !hasDsuPair(current)) {
    return current
  }
  const state = clone(current)
  state.selectedId = undefined
  state.toolMode = state.toolMode === 'dsu' ? 'none' : 'dsu'
  state.dsuSource = undefined
  setMessage(
    state,
    state.toolMode === 'dsu'
      ? '并查集：依次选择两个队尾状态相同的队列。'
      : '已取消并查集。',
  )
  return state
}

export function selectDsuQueue(current: GameState, queueIndex: number): GameState {
  if (current.screen !== 'playing' || current.toolMode !== 'dsu') return current
  const top = current.queues[queueIndex]?.cards.at(-1)
  if (!top || top.kind !== 'verdict') return current

  if (current.dsuSource === undefined) {
    const state = clone(current)
    state.dsuSource = queueIndex
    setMessage(state, `已选 ${PROBLEM_QUEUES[queueIndex].number}；再选一个相同队尾。`)
    return state
  }

  if (current.dsuSource === queueIndex) return current
  const sourceTop = current.queues[current.dsuSource].cards.at(-1)
  if (sourceTop?.kind !== 'verdict' || sourceTop.rank !== top.rank) {
    const state = clone(current)
    setMessage(state, '两个队尾状态不同，无法 Union。', 'warn')
    return state
  }

  const state = clone(current)
  pushHistory(state)
  const source = state.dsuSource!
  state.queues[source].cards.pop()
  state.queues[queueIndex].cards.pop()
  state.insight -= 4
  const nextRank = (top.rank ?? 0) + 1
  state.score += VERDICTS[nextRank].value
  state.mergeCount += 1
  state.maxRank = Math.max(state.maxRank, nextRank)
  state.toolMode = 'none'
  state.dsuSource = undefined
  state.lastEvent = 'tool'

  if (nextRank >= VERDICTS.length - 1) {
    solveQueue(state, queueIndex)
  } else {
    state.queues[queueIndex].cards.push(verdictCard(nextRank))
    setMessage(
      state,
      `Union 完成：两个队尾合并为 ${VERDICTS[nextRank].label}。`,
      'good',
    )
    resolveQueue(state, queueIndex)
  }
  checkAfo(state)
  return state
}

export function getSelectedCard(state: GameState) {
  return state.hand.find((card) => card.uid === state.selectedId)
}

export function turnsUntilHack(round: number) {
  const remainder = round % 6
  return remainder === 0 ? 0 : 6 - remainder
}
