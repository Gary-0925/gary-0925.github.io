import { ArrowRight, Braces, GitMerge, Layers3 } from 'lucide-react'

interface CoverScreenProps {
  bestScore: number
  onStart: () => void
  onRules: () => void
}

export function CoverScreen({ bestScore, onStart, onRules }: CoverScreenProps) {
  return (
    <main className="cover-screen">
      <div className="cover-mark"><Braces /></div>
      <p className="eyebrow">NOI ONLINE JUDGE · CARD PUZZLE</p>
      <h1>评测队列</h1>
      <p className="cover-en">JUDGE QUEUE</p>
      <p className="cover-copy">
        把三张提交全部送进四道题的评测队列。<br />
        合并相同 Verdict，让 T1～T4 全部 AC。
      </p>
      <div className="cover-rule-row">
        <div><Layers3 /><span><b>三选次序</b><small>每张都必须入队</small></span></div>
        <div><GitMerge /><span><b>连锁合并</b><small>队尾相同才升级</small></span></div>
        <div className="mini-chain"><i>CE</i><em>→</em><i>RE</i><em>→</em><i>AC</i></div>
      </div>
      <button className="primary-button" onClick={onStart}>
        开始评测 <ArrowRight />
      </button>
      <button className="text-button" onClick={onRules}>先看完整规则</button>
      <div className="best-record">本机纪录 <b>{bestScore.toLocaleString()}</b></div>
      <p className="cover-footnote">规则简单，但生成 AK 通常需要 40 轮以上。</p>
    </main>
  )
}
