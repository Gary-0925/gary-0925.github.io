import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from 'lucide-react'
import { VERDICTS } from '../data/verdicts'

interface RulesModalProps { onClose: () => void }

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="rules-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭"><X /></button>
        <p className="eyebrow">AKNOI RULES</p>
        <h2>六题同时评测，随时提交</h2>
        <ol className="rules-list">
          <li><b>移动：</b>一次操作控制所有未提交题目（D1T1–D2T3）；前方块先落位，后方块再依次碰撞。</li>
          <li><b>合并：</b>Verdict 相同且前方块完整覆盖移动块截面时升级；前方块保留子任务。</li>
          <li><b>O2：</b>1×1 的 O2 块撞入普通目标时直接使其 Verdict 升一级；AC 无法再优化。</li>
          <li><b>子任务：</b>每种形状对应一个分值；各题随机生成，100 分子任务固定为 3×3。</li>
          <li><b>计分：</b>块分数 = 子任务分值 × Verdict 系数；每题取区域内块的当前最高分。</li>
          <li><b>提交：</b>只能手动提交；提交后锁定当时分数并退出操作，六题全部提交即结束。</li>
        </ol>
        <div className="direction-demo"><ArrowUp /><ArrowDown /><ArrowLeft /><ArrowRight /><span>方向键、WASD、按钮或滑动</span></div>
        <div className="verdict-chain verdict-rule-chain">
          {VERDICTS.map((item, index) => (
            <span key={item.id} style={{ background: item.color, color: item.ink }}>
              <b>{item.label}</b>
              <small>{item.multiplier === 0 ? '0' : `×${item.multiplier}`}</small>
              {index < VERDICTS.length - 1 ? ' →' : ''}
            </span>
          ))}
        </div>
        <p className="rules-footnote">相同种子和相同操作序列会生成完全相同的比赛。</p>
      </section>
    </div>
  )
}
