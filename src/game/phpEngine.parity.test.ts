/**
 * Differential test: the PHP port of the engine must produce exactly the same
 * score as the TypeScript engine, otherwise honest players get flagged as
 * cheaters (or cheaters slip through) by api/verify.php.
 *
 * This boots a real PHP 8.3 runtime through php-wasm and replays the same
 * random games on both sides.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PHP, ProcessIdAllocator } from '@php-wasm/universal'
import { loadNodeRuntime } from '@php-wasm/node'
import { beforeAll, describe, expect, it } from 'vitest'
import { finishAnimation, moveBoard, replayGame, startGame, submitBoard } from './engine'
import type { Direction, GameAction, GameState } from './types'

const ENGINE_PHP = fileURLToPath(new URL('../../api/engine.php', import.meta.url))

let php: PHP

async function runPhp(code: string) {
  const result = await php.run({ code })
  if (result.errors) throw new Error(`PHP error: ${result.errors}`)
  return result.text
}

/** Replays a game inside PHP and returns its verification summary. */
async function phpVerify(seed: string, actions: GameAction[]) {
  const payload = JSON.stringify({ seed, actions })
  const code = `<?php
require '/engine.php';
$input = json_decode(<<<'JSON'
${payload}
JSON, true);
echo json_encode(aknoi_verify_replay($input['seed'], $input['actions']));
`
  return JSON.parse(await runPhp(code)) as {
    score: number
    moves: number
    finished: boolean
    boards: Record<string, number>
  }
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

/** Deterministic generator so failures are reproducible. */
function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Plays a pseudo-random game, mixing moves with occasional submits. */
function playRandomGame(seed: string, rng: () => number, steps: number) {
  let state = startGame(seed)
  const actions: GameAction[] = []

  for (let index = 0; index < steps; index += 1) {
    if (state.screen !== 'playing') break

    const active = state.boards.filter((board) => board.status === 'active')
    if (active.length > 0 && rng() < 0.06) {
      const board = active[Math.floor(rng() * active.length)]
      const next = finishAnimation(submitBoard(state, board.id))
      if (next !== state) actions.push({ type: 'submit', boardId: board.id })
      state = next
      continue
    }

    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const next = finishAnimation(moveBoard(state, direction))
    if (next !== state) actions.push({ type: 'move', direction })
    state = next
  }

  return { state, actions }
}

function boardScores(state: GameState) {
  return Object.fromEntries(
    state.boards.map((board) => [board.label, board.submittedScore ?? board.currentScore]),
  )
}

describe('PHP engine parity', () => {
  beforeAll(async () => {
    const allocator = new ProcessIdAllocator()
    const runtime = await loadNodeRuntime('8.3', {
      emscriptenOptions: { processId: allocator.claim() },
    })
    php = new PHP(runtime)
    php.writeFile('/engine.php', readFileSync(ENGINE_PHP, 'utf8'))
  }, 120000)

  it('matches the seed hash and RNG stream', async () => {
    const out = await runPhp(`<?php
require '/engine.php';
$context = ['rngState' => aknoi_hash_seed('AKNOI'), 'nextId' => 0];
$values = [aknoi_hash_seed('AKNOI'), aknoi_hash_seed('K3X9ZQ1'), aknoi_hash_seed('测试种子')];
for ($i = 0; $i < 5; $i++) { $values[] = aknoi_next_random($context); }
echo json_encode($values);
`)
    const phpValues = JSON.parse(out) as number[]

    // Mirror of hashSeed / nextRandom from engine.ts.
    const hash = (seed: string) => {
      let value = 2166136261
      for (let index = 0; index < seed.length; index += 1) {
        value ^= seed.charCodeAt(index)
        value = Math.imul(value, 16777619)
      }
      return value >>> 0
    }

    expect(phpValues[0]).toBe(hash('AKNOI'))
    expect(phpValues[1]).toBe(hash('K3X9ZQ1'))
    expect(phpValues[2]).toBe(hash('测试种子'))

    const rng = makeRng(hash('AKNOI'))
    for (let index = 0; index < 5; index += 1) {
      expect(phpValues[3 + index]).toBeCloseTo(rng(), 12)
    }
  })

  it('generates identical opening boards', async () => {
    const state = startGame('OPENING1')
    const out = await runPhp(`<?php
require '/engine.php';
$state = aknoi_start_game('OPENING1');
$boards = [];
foreach ($state['boards'] as $board) {
  $subtasks = [];
  foreach ($board['subtasks'] as $s) { $subtasks[] = [$s['id'], $s['rows'], $s['cols'], $s['maxScore']]; }
  $pieces = [];
  foreach ($board['pieces'] as $p) {
    $pieces[] = [$p['kind'], $p['id'], $p['row'], $p['col'], $p['kind'] === 'verdict' ? $p['subtaskId'] : '', $p['kind'] === 'verdict' ? $p['verdictLevel'] : -1];
  }
  $boards[] = ['label' => $board['label'], 'subtasks' => $subtasks, 'pieces' => $pieces];
}
echo json_encode($boards);
`)
    const phpBoards = JSON.parse(out) as Array<{
      label: string
      subtasks: Array<[string, number, number, number]>
      pieces: Array<[string, string, number, number, string, number]>
    }>

    expect(phpBoards.map((board) => board.label)).toEqual(state.boards.map((b) => b.label))

    state.boards.forEach((board, index) => {
      expect(phpBoards[index].subtasks).toEqual(
        board.subtasks.map((s) => [s.id, s.rows, s.cols, s.maxScore]),
      )
      expect(phpBoards[index].pieces).toEqual(
        board.pieces.map((p) => [
          p.kind,
          p.id,
          p.row,
          p.col,
          p.kind === 'verdict' ? p.subtaskId : '',
          p.kind === 'verdict' ? p.verdictLevel : -1,
        ]),
      )
    })
  })

  it('agrees on the score across many random games', async () => {
    const seeds = ['AKNOI', 'K3X9ZQ1', 'ZZZ', '2026', 'a-b_c', 'LONGSEEDVALUE99']

    for (const [index, seed] of seeds.entries()) {
      const rng = makeRng(0x9e3779b9 + index * 7919)
      const { state, actions } = playRandomGame(seed, rng, 220)

      const verified = await phpVerify(seed, actions)

      expect(verified.moves, `moves for ${seed}`).toBe(state.moves)
      expect(verified.score, `score for ${seed}`).toBeCloseTo(state.contestScore, 6)
      expect(verified.finished, `finished for ${seed}`).toBe(state.screen === 'finished')

      for (const [label, score] of Object.entries(boardScores(state))) {
        expect(verified.boards[label], `${seed} / ${label}`).toBeCloseTo(score, 6)
      }
    }
  }, 120000)

  it('agrees on fully finished games', async () => {
    // Submit every board so the run ends, which is the case that matters most
    // for the leaderboard.
    const seed = 'FINISHED42'
    const rng = makeRng(20260815)
    let { state, actions } = playRandomGame(seed, rng, 120)

    for (const board of state.boards) {
      if (board.status !== 'active') continue
      const next = finishAnimation(submitBoard(state, board.id))
      if (next !== state) actions.push({ type: 'submit', boardId: board.id })
      state = next
    }

    expect(state.screen).toBe('finished')

    const verified = await phpVerify(seed, actions)
    expect(verified.finished).toBe(true)
    expect(verified.score).toBeCloseTo(state.contestScore, 6)
    expect(verified.score).toBe(replayGame(seed, actions).contestScore)
  }, 120000)

  it('skips invalid actions the same way the client does', async () => {
    const seed = 'SKIPME'
    const actions: GameAction[] = [
      { type: 'submit', boardId: 'problem-NOPE' },
      { type: 'move', direction: 'left' },
      { type: 'submit', boardId: 'problem-D1T1' },
      { type: 'submit', boardId: 'problem-D1T1' },
      { type: 'move', direction: 'down' },
    ]

    const expected = replayGame(seed, actions)
    const verified = await phpVerify(seed, actions)

    expect(verified.score).toBeCloseTo(expected.contestScore, 6)
    expect(verified.moves).toBe(expected.moves)
  }, 60000)
})
