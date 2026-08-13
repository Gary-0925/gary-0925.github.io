import { ArrowRight, Grip, X } from 'lucide-react'
import { SPECIAL_CARDS, VERDICTS } from '../data/verdicts'

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
          <li><b>提交全部手牌。</b>拖动卡片到队列；触屏可点牌后选择 T1～T4。不能弃牌。</li>
          <li><b>相同状态合并。</b>仅队尾相邻的两张 Verdict 会升级，并可能连锁。</li>
          <li><b>四题 AK。</b>让 T1～T4 各产生一次 AC；每条队列最多四张。</li>
          <li><b>特殊卡不占队列。</b>它们直接修改指定队尾；第 6、12、18…轮必有 Hack。</li>
        </ol>
        <div className="verdict-chain">
          {VERDICTS.map((verdict, index) => (
            <div key={verdict.id}>
              <span style={{ background: verdict.color, color: verdict.ink }}>{verdict.label}</span>
              {index < VERDICTS.length - 1 && <ArrowRight />}
            </div>
          ))}
        </div>
        <div className="special-rule-grid">
          {Object.values(SPECIAL_CARDS).map((card) => (
            <div key={card.kind}>
              <b>{card.label}</b>
              <span><strong>{card.name}</strong><small>{card.description}</small></span>
            </div>
          ))}
        </div>
        <div className="rule-note drag-note">
          <Grip />
          <span><strong>操作提示：</strong>桌面端直接拖放最快；点击手牌后，底部也会出现四个快速提交按钮。</span>
        </div>
        <p className="keyboard-note">键盘：1/2/3 选牌 · Q/W/E/R 入队</p>
      </section>
    </div>
  )
}
