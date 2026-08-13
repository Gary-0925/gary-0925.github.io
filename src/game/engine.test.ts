import { describe, expect, it } from 'vitest'
import { MAX_QUEUE_HEIGHT } from '../data/verdicts'
import {
  canPlaceCard,
  generateHand,
  placeCard,
  selectCard,
  startGame,
} from './engine'
import type { GameState, JudgeCard } from './types'

const fixedRandom = () => 0.2
let testId = 0

function card(rank: number): JudgeCard {
  testId += 1
  return { uid: `test-${testId}`, kind: 'verdict', rank }
}

function special(kind: Exclude<JudgeCard['kind'], 'verdict'>): JudgeCard {
  testId += 1
  return { uid: `test-${kind}-${testId}`, kind }
}

function play(state: GameState, cardUid: string, queueIndex = 0, random = fixedRandom) {
  return placeCard(state, cardUid, queueIndex, random)
}

describe('Judge Queue engine', () => {
  it('merges equal verdicts and supports a chain merge', () => {
    let state = startGame(fixedRandom)
    const [first, second, judging] = state.hand

    state = play(state, first.uid)
    state = play(state, second.uid)
    expect(state.queues[0].cards.map((item) => item.rank)).toEqual([1])

    state = play(state, judging.uid)
    expect(state.queues[0].cards.map((item) => item.rank)).toEqual([2])
    expect(state.mergeCount).toBe(2)
    expect(state.round).toBe(2)
  })

  it('keeps click selection while also allowing direct card placement', () => {
    const state = startGame(fixedRandom)
    const selected = selectCard(state, state.hand[0].uid)
    expect(selected.selectedId).toBe(state.hand[0].uid)

    const placed = placeCard(selected, state.hand[0].uid, 1, fixedRandom)
    expect(placed.queues[1].cards).toHaveLength(1)
    expect(placed.selectedId).toBeUndefined()
  })

  it('allows a full queue only when a verdict immediately merges', () => {
    const state = startGame(fixedRandom)
    state.queues[0].cards = Array.from(
      { length: MAX_QUEUE_HEIGHT },
      (_, rank) => card(rank),
    )
    const topRank = MAX_QUEUE_HEIGHT - 1

    expect(canPlaceCard(state, card(topRank), 0)).toBe(true)
    expect(canPlaceCard(state, card(topRank - 1), 0)).toBe(false)
    expect(canPlaceCard(state, special('gdb'), 0)).toBe(true)
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

  it('makes O2 risky for verdicts better than RE', () => {
    let state = startGame(fixedRandom)
    const o2 = special('o2')
    state.queues[0].cards = [card(4)]
    state.hand = [o2]

    state = play(state, o2.uid, 0, () => 0.1)
    expect(state.queues[0].cards[0].rank).toBe(2)
    expect(state.message).toContain('RE')

    const safeState = startGame(fixedRandom)
    const safeO2 = special('o2')
    safeState.queues[0].cards = [card(4)]
    safeState.hand = [safeO2]
    const promoted = play(safeState, safeO2.uid, 0, () => 0.9)
    expect(promoted.queues[0].cards[0].rank).toBe(5)
  })

  it('applies GDB, long long, and Subtask to their intended verdicts', () => {
    let gdbState = startGame(fixedRandom)
    const gdb = special('gdb')
    gdbState.queues[0].cards = [card(2)]
    gdbState.hand = [gdb]
    gdbState = play(gdbState, gdb.uid)
    expect(gdbState.queues[0].cards).toEqual([])

    let longState = startGame(fixedRandom)
    const longLong = special('longLong')
    longState.queues[0].cards = [card(5)]
    longState.hand = [longLong]
    longState = play(longState, longLong.uid)
    expect(longState.queues[0].cards[0].rank).toBe(6)

    let subtaskState = startGame(fixedRandom)
    const subtask = special('subtask')
    subtaskState.queues[0].cards = [card(4)]
    subtaskState.hand = [subtask]
    subtaskState = play(subtaskState, subtask.uid)
    expect(subtaskState.queues[0].cards[0].rank).toBe(6)
  })
})
