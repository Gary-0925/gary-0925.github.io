import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { BOARD_SIZE, VERDICTS } from '../data/verdicts'
import { pieceScore } from '../game/engine'
import { formatScore } from '../game/score'
import type { BoardPiece, Direction, GameState, ProblemBoard } from '../game/types'

interface GameBoardProps {
  state: GameState
  onMove: (direction: Direction) => void
  onSubmit: (boardId: string) => void
}

interface Point { x: number; y: number }
interface DisplayPiece { piece: BoardPiece; ghost: boolean }

function piecePositionStyle(piece: BoardPiece, rows: number, cols: number) {
  const unit = 100 / BOARD_SIZE
  return {
    top: `calc(${piece.row * unit}% + ${5 - piece.row}px)`,
    left: `calc(${piece.col * unit}% + ${5 - piece.col}px)`,
    width: `calc(${cols * unit}% - ${cols + 4}px)`,
    height: `calc(${rows * unit}% - ${rows + 4}px)`,
  }
}

function ProblemBoardView({
  board,
  state,
  onMove,
  onSubmit,
}: {
  board: ProblemBoard
  state: GameState
  onMove: (direction: Direction) => void
  onSubmit: (boardId: string) => void
}) {
  const pointerStart = useRef<Point | undefined>(undefined)
  const boardMotion = state.motion.filter((motion) => motion.boardId === board.id)
  const displayPieces: DisplayPiece[] = [
    ...board.pieces.map((piece) => ({ piece, ghost: false })),
    ...boardMotion.filter((motion) => motion.removed).map((motion) => ({
      piece: { ...motion.piece, row: motion.toRow, col: motion.toCol },
      ghost: true,
    })),
  ]

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (board.status !== 'active' || state.motion.length) return
    pointerStart.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    pointerStart.current = undefined
    if (!start || board.status !== 'active' || state.motion.length) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
    if (Math.abs(dx) > Math.abs(dy)) onMove(dx > 0 ? 'right' : 'left')
    else onMove(dy > 0 ? 'down' : 'up')
  }

  return (
    <section className={`problem-board status-${board.status}`}>
      <header>
        <b>{board.label}</b>
        <div>
          <span>{formatScore(board.submittedScore ?? board.currentScore)} 分</span>
          <button
            type="button"
            onClick={() => onSubmit(board.id)}
            disabled={board.status !== 'active' || state.motion.length > 0}
          >
            {board.status === 'active' ? '提交' : '已交'}
          </button>
        </div>
      </header>
      <div className="subtask-key" aria-label={`${board.label} 子任务，按分值排序`}>
        {board.subtasks.map((subtask) => (
          <span
            key={subtask.id}
            title={`${subtask.rows}×${subtask.cols} 子任务，满分 ${subtask.maxScore}`}
            aria-label={`${subtask.rows}乘${subtask.cols}，${subtask.maxScore} 分`}
          >
            <b>{subtask.maxScore}</b>
            <i>{subtask.rows}×{subtask.cols}</i>
          </span>
        ))}
      </div>
      <div
        className={`poly-board ${boardMotion.length ? 'animating' : ''}`}
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
        role="group"
        aria-label={`${board.label}，当前最高 ${formatScore(board.currentScore)} 分`}
      >
        <div className="board-cells" aria-hidden="true">
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => <span key={index} />)}
        </div>
        {displayPieces.map(({ piece, ghost }) => {
          const motionClasses = `${ghost ? 'merge-ghost' : ''} ${state.spawnedPieceIds.includes(piece.id) ? 'spawned' : ''}`
          if (piece.kind === 'o2') {
            const style = {
              ...piecePositionStyle(piece, 1, 1),
              '--piece-color': '#34495e',
              '--piece-ink': '#ffffff',
            } as CSSProperties
            return (
              <div
                key={piece.id}
                className={`board-piece o2-piece area-1 ${motionClasses}`}
                style={style}
                aria-label="O2 优化块；碰撞后使前方目标 Verdict 升一级"
              >
                <strong>O2</strong>
              </div>
            )
          }

          const subtask = board.subtasks.find((item) => item.id === piece.subtaskId)!
          const verdict = VERDICTS[piece.verdictLevel]
          const score = pieceScore(board, piece)
          const style = {
            ...piecePositionStyle(piece, subtask.rows, subtask.cols),
            '--piece-color': verdict.color,
            '--piece-ink': verdict.ink,
          } as CSSProperties
          return (
            <div
              key={piece.id}
              className={`board-piece area-${subtask.rows * subtask.cols} ${motionClasses}`}
              style={style}
              aria-label={`${subtask.maxScore} 分子任务，${verdict.label}，当前 ${formatScore(score)} 分`}
            >
              <span className="piece-subtask">{subtask.maxScore}</span>
              <strong>{verdict.label}</strong>
              <small>{formatScore(score)}</small>
            </div>
          )
        })}
        {board.status === 'submitted' && (
          <div className="board-result">
            <strong>已提交</strong>
            <span>{formatScore(board.submittedScore ?? 0)} 分</span>
          </div>
        )}
      </div>
    </section>
  )
}

export function GameBoard(props: GameBoardProps) {
  return (
    <div className="boards-grid">
      {props.state.boards.map((board) => (
        <ProblemBoardView key={board.id} board={board} {...props} />
      ))}
    </div>
  )
}
