import { describe, expect, it } from 'vitest'
import { MAX_QUEUE_HEIGHT } from '../data/verdicts'
import {
  activateDsu,
  canPlaceCard,
  generateHand,
  placeSelected,
  selectCard,
  selectDsuQueue,
  startGame,
  useRollback,
} from './engine'
import type { GameState, JudgeCard } from './types'

const fixedRandom = () => 0.2
let testId = 0

function card(rank: number): JudgeCard {
  testId += 1
  return { uid: `test-${testId}`, kind: 'verdict', rank }
}

function play(state: GameState, cardUid: string, queueIndex = 0) {
  return placeSelected(selectCard(state, cardUid), queueIndex, fixedRandom)
}

describe('Judge Queue engine', () => {
  it('merges equal verdicts and supports a chain merge', () => {
    let state = startGame(fixedRandom)
    const [first, second, judging] = state.hand

    state = play(state, first.uid)
    state = play(state, second.uid)
    expect(state.queues[0].cards.map((item) => item.rank)).toEqual([1])
    expect(state.insight).toBe(1)

    state = play(state, judging.uid)
    expect(state.queues[0].cards.map((item) => item.rank)).toEqual([2])
    expect(state.mergeCount).toBe(2)
    expect(state.round).toBe(2)
  })

  it('allows a full queue only when the new card immediately merges', () => {
    const state = startGame(fixedRandom)
    state.queues[0].cards = Array.from(
      { length: MAX_QUEUE_HEIGHT },
      (_, rank) => card(rank),
    )
    const topRank = MAX_QUEUE_HEIGHT - 1

    expect(state.queues[0].cards).toHaveLength(MAX_QUEUE_HEIGHT)
    expect(canPlaceCard(state, card(topRank), 0)).toBe(true)
    expect(canPlaceCard(state, card(topRank - 1), 0)).toBe(false)
  })

  it('marks a problem solved and clears its queue when PC merges to AC', () => {
    let state = startGame(fixedRandom)
    const incoming = card(6)
    state.queues[2].cards = [card(6)]
    state.hand = [incoming]

    state = play(state, incoming.uid, 2)
    expect(state.queues[2].solved).toBe(true)
    expect(state.queues[2].cards).toEqual([])
    expect(state.solvedCount).toBe(1)
  })

  it('places one forced Hack card every sixth round', () => {
    const hand = generateHand(6, fixedRandom)
    expect(hand).toHaveLength(3)
    expect(hand.filter((item) => item.kind === 'hack')).toHaveLength(1)
  })

  it('rollback restores the board and hand before the last submission', () => {
    let state = startGame(fixedRandom)
    const [first, second] = state.hand
    state = play(state, first.uid)
    state = play(state, second.uid)
    expect(state.queues[0].cards[0].rank).toBe(1)
    expect(state.insight).toBe(1)

    state = useRollback(state)
    expect(state.queues[0].cards.map((item) => item.rank)).toEqual([0])
    expect(state.hand.some((item) => item.uid === second.uid)).toBe(true)
    expect(state.insight).toBe(0)
  })

  it('union merges matching tops across two queues', () => {
    let state = startGame(fixedRandom)
    state.queues[0].cards = [card(3)]
    state.queues[1].cards = [card(3)]
    state.insight = 4

    state = activateDsu(state)
    state = selectDsuQueue(state, 0)
    state = selectDsuQueue(state, 1)

    expect(state.queues[0].cards).toEqual([])
    expect(state.queues[1].cards.map((item) => item.rank)).toEqual([4])
    expect(state.insight).toBe(0)
  })
})
