import { Beaker, ShieldAlert } from 'lucide-react'
import { SPECIAL_CARDS } from '../data/verdicts'

export function SpecialGuide() {
  const cards = Object.values(SPECIAL_CARDS)
  return (
    <section className="special-guide" aria-labelledby="special-guide-title">
      <div className="section-label">
        <span id="special-guide-title">特殊卡</span>
        <Beaker size={15} />
      </div>
      <div className="special-guide-list">
        {cards.map((card) => (
          <div key={card.kind} className={`guide-item ${card.tone}`}>
            <b>{card.label}</b>
            <span><strong>{card.name}</strong><small>{card.description}</small></span>
            {card.kind === 'hack' && <ShieldAlert />}
          </div>
        ))}
      </div>
    </section>
  )
}
