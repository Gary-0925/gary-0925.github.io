import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Dices,
  HelpCircle,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { VERDICTS } from './data/verdicts'
import { EndOverlay } from './components/EndOverlay'
import { GameBoard } from './components/GameBoard'
import { RulesModal } from './components/RulesModal'
import { playSound, setSoundEnabled } from './game/audio'
import { finishAnimation, moveBoard, startGame, submitBoard } from './game/engine'
import type { Direction, GameState } from './game/types'

const BEST_SCORE_KEY = 'aknoi-best-score'

function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function freshSeed() {
  try {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return value[0].toString(36).toUpperCase().padStart(7, '0')
  } catch {
    return Date.now().toString(36).toUpperCase()
  }
}

function initialSeed() {
  try {
    const fromHash = decodeURIComponent(window.location.hash.slice(1)).trim()
    return fromHash || freshSeed()
  } catch {
    return freshSeed()
  }
}

function readBestScore() {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0)
  } catch {
    return 0
  }
}

function soundForState(previous: GameState, next: GameState) {
  if (next === previous || next.eventId === previous.eventId) return
  if (next.lastEvent === 'merge') playSound('chain')
  else if (next.lastEvent === 'finish' && next.contestScore === 600) playSound('win')
  else playSound('paper')
}

const DIRECTIONS: Array<{ direction: Direction; icon: typeof ArrowUp; label: string }> = [
  { direction: 'left', icon: ArrowLeft, label: '左' },
  { direction: 'up', icon: ArrowUp, label: '上' },
  { direction: 'down', icon: ArrowDown, label: '下' },
  { direction: 'right', icon: ArrowRight, label: '右' },
]

export default function App() {
  const [state, setState] = useState<GameState>(() => startGame(initialSeed()))
  const [seedInput, setSeedInput] = useState(() => state.seed)
  const [showRules, setShowRules] = useState(false)
  const [soundEnabled, setSound] = useState(true)
  const [bestScore, setBestScore] = useState(readBestScore)

  const apply = useCallback((action: (current: GameState) => GameState) => {
    setState((current) => {
      const next = action(current)
      soundForState(current, next)
      return next
    })
  }, [])

  const loadSeed = useCallback((seed: string) => {
    const next = startGame(seed)
    setState(next)
    setSeedInput(next.seed)
    window.location.hash = encodeURIComponent(next.seed)
    playSound('paper')
  }, [])

  const submitSeed = (event: FormEvent) => {
    event.preventDefault()
    loadSeed(seedInput)
  }

  const move = useCallback(
    (direction: Direction) => apply((current) => moveBoard(current, direction)),
    [apply],
  )

  useEffect(() => setSoundEnabled(soundEnabled), [soundEnabled])

  useEffect(() => {
    if (state.motion.length === 0 && state.spawnedPieceIds.length === 0) return
    const timer = window.setTimeout(() => {
      setState((current) => finishAnimation(current))
    }, 190)
    return () => window.clearTimeout(timer)
  }, [state.eventId, state.motion.length, state.spawnedPieceIds.length])

  useEffect(() => {
    if (state.screen !== 'finished' || state.contestScore <= bestScore) return
    setBestScore(state.contestScore)
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(state.contestScore))
    } catch {
      // Local records are optional.
    }
  }, [state.screen, state.contestScore, bestScore])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showRules) {
        if (event.key === 'Escape') setShowRules(false)
        return
      }
      if (state.screen !== 'playing') return
      const keys: Record<string, Direction> = {
        ArrowUp: 'up', w: 'up', W: 'up',
        ArrowDown: 'down', s: 'down', S: 'down',
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right',
      }
      const direction = keys[event.key]
      if (direction) {
        event.preventDefault()
        move(direction)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, showRules, state.screen])

  return (
    <div className="app">
      <main className="game-container">
        <header className="game-header">
          <div className="title-block">
            <h1>AKNOI</h1>
            <p>六题同步评测</p>
          </div>
          <div className="score-group">
            <div><span>总分</span><strong>{formatScore(state.contestScore)}</strong></div>
            <div><span>纪录</span><strong>{formatScore(bestScore)}</strong></div>
          </div>
        </header>

        <div className="game-intro">
          <p>同时移动 · 当前最高分 · 随时提交</p>
          <div className="game-actions">
            <button onClick={() => loadSeed(state.seed)}><RotateCcw />重开</button>
            <button onClick={() => setShowRules(true)}><HelpCircle />规则</button>
            <button onClick={() => setSound((value) => !value)} aria-label={soundEnabled ? '关闭声音' : '开启声音'}>
              {soundEnabled ? <Volume2 /> : <VolumeX />}
            </button>
          </div>
        </div>

        <details className="seed-panel">
          <summary>种子 <code>{state.seed}</code></summary>
          <form className="seed-control" onSubmit={submitSeed}>
            <input
              id="game-seed"
              aria-label="游戏种子"
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              maxLength={32}
              spellCheck={false}
            />
            <button type="submit">载入</button>
            <button type="button" onClick={() => loadSeed(freshSeed())}><Dices />新种子</button>
          </form>
        </details>

        <div className={`status-line ${state.messageTone}`} key={state.eventId}>
          {state.message}
        </div>

        <GameBoard
          state={state}
          onMove={move}
          onSubmit={(boardId) => apply((current) => submitBoard(current, boardId))}
        />

        <div className="direction-controls" aria-label="移动方向">
          {DIRECTIONS.map(({ direction, icon: Icon, label }) => (
            <button
              key={direction}
              type="button"
              onClick={() => move(direction)}
              disabled={state.motion.length > 0 || state.screen !== 'playing'}
              aria-label={`六题同时向${label}移动`}
            >
              <Icon />
            </button>
          ))}
        </div>
        <p className="play-note">方向键 / WASD / 在任意活动棋盘上滑动</p>

        <section className="verdict-section">
          <h2>评测结果</h2>
          <div className="verdict-list verdict-formula">
            {VERDICTS.map((verdict) => (
              <span
                key={verdict.id}
                style={{
                  '--verdict-color': verdict.color,
                  '--verdict-ink': verdict.ink,
                } as React.CSSProperties}
              >
                <b>{verdict.label}</b>
                <small>{verdict.multiplier === 0 ? '0 分' : `× ${verdict.multiplier}`}</small>
              </span>
            ))}
            <span style={{ '--verdict-color': '#34495e', '--verdict-ink': '#ffffff' } as React.CSSProperties}>
              <b>O2</b><small>目标 +1</small>
            </span>
          </div>
        </section>

        <p className="how-to-play">
          <b>计分：</b>块分数 = 子任务分值 × Verdict 系数；每题取当前最高，提交后锁定。
        </p>
      </main>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {state.screen === 'finished' && state.motion.length === 0 && (
        <EndOverlay state={state} bestScore={Math.max(bestScore, state.contestScore)} onRestart={() => loadSeed(state.seed)} />
      )}
    </div>
  )
}
