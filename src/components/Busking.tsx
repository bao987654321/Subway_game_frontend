import type { BuskingPhase } from '../busking/busking'
import { useBusking } from '../busking/context'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const PHASE_LABELS: Record<BuskingPhase, string> = {
  setting_up: 'Setting up',
  busking: 'Busking',
  packing_up: 'Packing up for the train',
}

/** Shown only while waiting for a trip. */
export function Busking() {
  const busking = useBusking()
  if (!busking) return null

  return (
    <section className="busking-card" aria-labelledby="busking-title">
      <header className="player-state-header">
        <h2 id="busking-title">Busking</h2>
        <p className="player-state-value" role="status" aria-label="Busking phase">
          {PHASE_LABELS[busking.phase]}
        </p>
      </header>
      <dl className="player-state-details">
        <div>
          <dt>Minutes played</dt>
          <dd>
            {busking.paidMinutes} of {busking.minutes}
          </dd>
        </div>
        <div>
          <dt>Earned this wait</dt>
          <dd>{currencyFormatter.format(busking.earnedCents / 100)}</dd>
        </div>
      </dl>
    </section>
  )
}
