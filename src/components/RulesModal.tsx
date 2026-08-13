import { ArrowRight, X } from 'lucide-react'
import { VERDICTS } from '../data/verdicts'

interface RulesModalProps {
  onClose: () => void
}

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭规则">
          <X />
        </button>
        <p className="eyebrow">README.md</p>
        <h2 id="rules-title">评测队列规则</h2>
        <ol className="rules-list">
          <li><b>选牌，再选队列。</b>每轮三张手牌必须全部处理，不能弃牌。</li>
          <li><b>相同状态合并。</b>仅队尾相邻的两张牌会升级，并可能产生连锁。</li>
          <li><b>四题 AK。</b>让 T1～T4 各产生一次 AC；队列上限为四张。</li>
          <li><b>第 6、12、18…轮有 Hack。</b>它会让队尾降一级，但有时也能制造合并。</li>
        </ol>
        <div className="verdict-chain">
          {VERDICTS.map((verdict, index) => (
            <div key={verdict.id}>
              <span style={{ background: verdict.color, color: verdict.ink }}>{verdict.label}</span>
              {index < VERDICTS.length - 1 && <ArrowRight />}
            </div>
          ))}
        </div>
        <div className="rule-note">
          <strong>算法工具不是装饰：</strong>
          回滚栈恢复上一状态；记忆化保存一张待处理牌；并查集合并两个相同队尾。合理保留思考点是后期不爆队列的关键。
        </div>
        <p className="keyboard-note">键盘：1/2/3 选牌 · Q/W/E/R 入队 · Z 回滚 · M 记忆化</p>
      </section>
    </div>
  )
}
