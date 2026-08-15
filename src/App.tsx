import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Dices,
  Download,
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
import { downloadReplay } from './game/replayFile'
import { finishAnimation, moveBoard, replayGame, startGame, submitBoard } from './game/engine'
import {
  clearSavedGame,
  loadSavedGame,
  readBestScore,
  saveGame,
  writeBestScore,
} from './game/storage'
import type { Direction, GameState } from './game/types'
import { MAX_MACHINE_SCORE, formatTotalScore } from './game/score'

function freshSeed() {
  try {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return value[0].toString(36).toUpperCase().padStart(7, '0')
  } catch {
    return Date.now().toString(36).toUpperCase()
  }
}

function seedFromHash() {
  try {
    return decodeURIComponent(window.location.hash.slice(1)).trim()
  } catch {
    return ''
  }
}

/**
 * A URL seed always wins; otherwise the last session is replayed from its
 * recorded actions so the player continues exactly where they stopped.
 */
function initialState(): GameState {
  const hashSeed = seedFromHash()
  const saved = loadSavedGame()
  if (hashSeed && (!saved || saved.seed !== hashSeed)) return startGame(hashSeed)
  if (saved) {
    try {
      return replayGame(saved.seed, saved.actions)
    } catch {
      clearSavedGame()
    }
  }
  return startGame(hashSeed || freshSeed())
}

/**
 * True when the keyboard event belongs to an editable control, so the global
 * WASD shortcuts must stay out of the way.
 */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function soundForState(previous: GameState, next: GameState) {
  if (next === previous || next.eventId === previous.eventId) return
  if (next.lastEvent === 'merge') playSound('chain')
  else if (next.lastEvent === 'finish' && next.contestScore === MAX_MACHINE_SCORE) playSound('win')
  else playSound('paper')
}

const DIRECTIONS: Array<{ direction: Direction; icon: typeof ArrowUp; label: string }> = [
  { direction: 'left', icon: ArrowLeft, label: '左' },
  { direction: 'up', icon: ArrowUp, label: '上' },
  { direction: 'down', icon: ArrowDown, label: '下' },
  { direction: 'right', icon: ArrowRight, label: '右' },
]

export default function App() {
  const [state, setState] = useState<GameState>(initialState)
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
    clearSavedGame()
    setState(next)
    setSeedInput(next.seed)
    window.location.hash = encodeURIComponent(next.seed)
    playSound('paper')
  }, [])

  const exportReplay = useCallback(() => {
    if (state.history.length === 0) return
    const name = downloadReplay(state)
    setState((current) => ({
      ...current,
      message: `已导出 ${name}，可上传到排行榜。`,
      messageTone: 'good',
      eventId: current.eventId + 1,
    }))
    playSound('paper')
  }, [state])

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
    writeBestScore(state.contestScore)
  }, [state.screen, state.contestScore, bestScore])

  // Persist the action log after every accepted action so a reload resumes here.
  useEffect(() => {
    saveGame(state)
  }, [state.history, state.seed])

  useEffect(() => {
    if (seedFromHash() === state.seed) return
    window.location.hash = encodeURIComponent(state.seed)
  }, [state.seed])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showRules) {
        if (event.key === 'Escape') setShowRules(false)
        return
      }
      // Never steal keys from a text field: the seed box needs W/A/S/D too.
      if (isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
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
            <h3>可到 <a href="https://aknoi.page.gd/">https://aknoi.page.gd/</a> 上传成绩</h2>
          </div>
          <div className="score-group">
            <div><span>总分</span><strong>{formatTotalScore(state.contestScore)}</strong></div>
            <div><span>纪录</span><strong>{formatTotalScore(bestScore)}</strong></div>
          </div>
        </header>

        <div className="game-intro">
          <div className="game-actions">
            <button onClick={() => loadSeed(state.seed)} title="用同一种子重开" aria-label="用同一种子重开">
              <RotateCcw />
              <span>重开</span>
            </button>
            <button onClick={() => setShowRules(true)} title="查看规则" aria-label="查看规则">
              <HelpCircle />
              <span>规则</span>
            </button>
            <button
              onClick={exportReplay}
              disabled={state.history.length === 0}
              title="导出本局为 .dat 存档文件"
              aria-label="导出本局为 .dat 存档文件"
            >
              <Download />
              <span>导出</span>
            </button>
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
            <button type="submit" title="载入该种子" aria-label="载入该种子">载入</button>
            <button type="button" onClick={() => loadSeed(freshSeed())} title="随机新种子" aria-label="随机新种子">
              <Dices />
              <span>新种子</span>
            </button>
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
        <EndOverlay state={state} bestScore={Math.max(bestScore, state.contestScore)} onRestart={() => loadSeed(state.seed)} onExport={exportReplay} />
      )}
    </div>
  )
}
