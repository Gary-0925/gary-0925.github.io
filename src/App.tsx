import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrainCircuit,
  Grip,
  HelpCircle,
  MousePointerClick,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import { PROBLEM_QUEUES, VERDICTS } from './data/verdicts'
import { playSound, setSoundEnabled } from './game/audio'
import {
  canPlaceCard,
  createInitialState,
  placeCard,
  placeSelected,
  selectCard,
  startGame,
  turnsUntilHack,
} from './game/engine'
import type { GameState } from './game/types'
import { CoverScreen } from './components/CoverScreen'
import { EndOverlay } from './components/EndOverlay'
import { JudgeCardView } from './components/JudgeCardView'
import { QueueColumn } from './components/QueueColumn'
import { RulesModal } from './components/RulesModal'
import { SpecialGuide } from './components/SpecialGuide'

const BEST_SCORE_KEY = 'judge-queue-best-score'

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
  else if (next.lastEvent === 'ac') playSound('win')
  else if (next.lastEvent === 'hack' || next.lastEvent === 'afo') playSound('enemy')
  else if (next.lastEvent === 'special') playSound('ink')
  else playSound('paper')
}

export default function App() {
  const [state, setState] = useState<GameState>(createInitialState)
  const [showRules, setShowRules] = useState(false)
  const [soundEnabled, setSound] = useState(true)
  const [bestScore, setBestScore] = useState(readBestScore)
  const [draggingId, setDraggingId] = useState<string>()

  const apply = useCallback((action: (current: GameState) => GameState) => {
    setState((current) => {
      const next = action(current)
      soundForState(current, next)
      return next
    })
  }, [])

  const begin = useCallback(() => {
    playSound('paper')
    setDraggingId(undefined)
    setState(startGame())
  }, [])

  useEffect(() => {
    setSoundEnabled(soundEnabled)
  }, [soundEnabled])

  useEffect(() => {
    if (state.screen !== 'won' && state.screen !== 'lost') return
    if (state.score <= bestScore) return
    setBestScore(state.score)
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(state.score))
    } catch {
      // A private browsing context may reject storage.
    }
  }, [state.screen, state.score, bestScore])

  const selectedCard = useMemo(
    () => state.hand.find((card) => card.uid === state.selectedId),
    [state.hand, state.selectedId],
  )
  const draggingCard = useMemo(
    () => state.hand.find((card) => card.uid === draggingId),
    [state.hand, draggingId],
  )
  const activeCard = draggingCard ?? selectedCard

  const submitCard = useCallback(
    (cardUid: string, queueIndex: number) => {
      apply((current) => placeCard(current, cardUid, queueIndex))
      setDraggingId(undefined)
    },
    [apply],
  )

  const placeInQueue = useCallback(
    (index: number) => {
      if (state.selectedId) apply((current) => placeSelected(current, index))
    },
    [apply, state.selectedId],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showRules) {
        if (event.key === 'Escape') setShowRules(false)
        return
      }
      if (state.screen === 'cover' && event.key === 'Enter') {
        begin()
        return
      }
      if (state.screen !== 'playing') return

      const handIndex = ['1', '2', '3'].indexOf(event.key)
      if (handIndex >= 0 && state.hand[handIndex]) {
        apply((current) => selectCard(current, state.hand[handIndex].uid))
        return
      }
      const queueIndex = ['q', 'w', 'e', 'r'].indexOf(event.key.toLowerCase())
      if (queueIndex >= 0) {
        event.preventDefault()
        placeInQueue(queueIndex)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [apply, begin, placeInQueue, showRules, state.hand, state.screen])

  if (state.screen === 'cover') {
    return (
      <div className="app paper-bg">
        <CoverScreen bestScore={bestScore} onStart={begin} onRules={() => setShowRules(true)} />
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </div>
    )
  }

  const hackIn = turnsUntilHack(state.round)

  return (
    <div className="app paper-bg">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-bracket">{'{JQ}'}</span>
          <div><strong>评测队列</strong><small>Judge Queue</small></div>
        </div>
        <div className="top-stats">
          <div><span>得分</span><b>{state.score.toLocaleString()}</b></div>
          <div><span>纪录</span><b>{bestScore.toLocaleString()}</b></div>
          <div><span>轮次</span><b>#{state.round}</b></div>
          <div className="ak-stat"><span>进度</span><b>{state.solvedCount}/4 AC</b></div>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setShowRules(true)} aria-label="查看规则"><HelpCircle /></button>
          <button className="icon-button" onClick={() => setSound((value) => !value)} aria-label={soundEnabled ? '关闭声音' : '开启声音'}>
            {soundEnabled ? <Volume2 /> : <VolumeX />}
          </button>
          <button className="icon-button" onClick={begin} aria-label="重新开始"><RotateCcw /></button>
        </div>
      </header>

      <main className="game-layout">
        <section className="board-section" aria-label="四道题的评测队列">
          <div className="board-heading">
            <div>
              <p className="eyebrow">SUBMISSION PIPELINE</p>
              <h1>四题评测中</h1>
            </div>
            <div className={`judge-message ${state.messageTone}`} key={state.eventId}>
              <span className="terminal-caret">›</span> {state.message}
            </div>
          </div>

          <div className="queue-grid">
            {state.queues.map((queue, index) => {
              const valid = Boolean(activeCard && canPlaceCard(state, activeCard, index))
              return (
                <QueueColumn
                  key={PROBLEM_QUEUES[index].number}
                  queue={queue}
                  index={index}
                  active={Boolean(activeCard)}
                  valid={valid}
                  dragging={Boolean(draggingCard)}
                  onClick={() => placeInQueue(index)}
                  onDropCard={() => draggingCard && submitCard(draggingCard.uid, index)}
                />
              )
            })}
          </div>
        </section>

        <aside className="side-panel">
          <section className="contest-card">
            <div className="section-label"><span>本场目标</span><Trophy size={15} /></div>
            <div className="problem-checklist">
              {PROBLEM_QUEUES.map((problem, index) => (
                <div className={state.queues[index].solved ? 'done' : ''} key={problem.number}>
                  <span>{problem.number}</span>
                  <strong>{problem.algorithm}</strong>
                  <b>{state.queues[index].solved ? 'AC' : '—'}</b>
                </div>
              ))}
            </div>
            <div className={`hack-clock ${hackIn === 0 ? 'now' : ''}`}>
              <Zap />
              <span>{hackIn === 0 ? '本轮含 Hack 数据' : `距 Hack 还有 ${hackIn} 轮`}</span>
            </div>
          </section>

          <SpecialGuide />

          <section className="legend-section">
            <div className="section-label"><span>Verdict 合并表</span><BrainCircuit size={15} /></div>
            <div className="mini-legend">
              {VERDICTS.map((verdict) => (
                <div key={verdict.id} style={{ '--legend': verdict.color } as React.CSSProperties}>
                  <b>{verdict.label}</b><span>{verdict.value}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>

      <section className="hand-dock" aria-label="本轮手牌">
        <div className="hand-copy">
          <p className="eyebrow">WAITING · {state.hand.length}/3</p>
          <h2>待提交</h2>
          <span className="desktop-drag-hint"><Grip /> 可直接拖入队列</span>
        </div>
        <div className="hand-cards">
          {state.hand.map((card, index) => (
            <JudgeCardView
              key={card.uid}
              card={card}
              index={index}
              selected={state.selectedId === card.uid}
              onClick={() => apply((current) => selectCard(current, card.uid))}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', card.uid)
                setDraggingId(card.uid)
              }}
              onDragEnd={() => setDraggingId(undefined)}
            />
          ))}
          {Array.from({ length: 3 - state.hand.length }, (_, index) => (
            <div className="empty-hand-card" key={`empty-${index}`}>已处理</div>
          ))}
        </div>
        <div className={`quick-submit ${selectedCard ? 'visible' : ''}`}>
          <span><MousePointerClick /> {selectedCard ? '快速提交到' : '点选卡片后提交'}</span>
          <div>
            {PROBLEM_QUEUES.map((problem, index) => (
              <button
                key={problem.number}
                type="button"
                disabled={!selectedCard || !canPlaceCard(state, selectedCard, index)}
                onClick={() => selectedCard && submitCard(selectedCard.uid, index)}
              >
                {problem.number}
              </button>
            ))}
          </div>
        </div>
      </section>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {(state.screen === 'won' || state.screen === 'lost') && (
        <EndOverlay state={state} bestScore={Math.max(bestScore, state.score)} onRestart={begin} />
      )}
    </div>
  )
}
