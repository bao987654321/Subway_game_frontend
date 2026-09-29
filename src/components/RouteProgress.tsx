import { useGameClock } from '../game-clock/context'
import { useGameState } from '../game-state/context'
import { useGameControls } from '../game-state/controls-context'
import { getRouteProgress } from '../game-state/journey'
import { useStationCatalog } from '../stations/context'
import './RouteProgress.css'

function formatCountdown(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1_000)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${String(remainder).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(remainder).padStart(2, '0')}s`
  return `${remainder}s`
}

export function RouteProgress() {
  const { journey } = useGameControls()
  const { state } = useGameState()
  const { gameTimeMs } = useGameClock()
  const { byId } = useStationCatalog()
  const progress = journey && state !== 'outside' && state !== 'in_station'
    ? getRouteProgress(journey, state, gameTimeMs)
    : null

  if (!journey || !progress) {
    return (
      <section className="route-progress-card" aria-labelledby="route-progress-title">
        <h2 id="route-progress-title">Route progress</h2>
        <p className="route-progress-empty">
          Choose a trip in a station to see your route and time to the next stop.
        </p>
      </section>
    )
  }

  const { plan, stopIndex } = journey
  const { currentStop, nextStop, phase, remainingToNextStopMs, remainingDwellMs } = progress
  const stationName = (stationId: string) => byId.get(stationId)?.name ?? stationId
  const currentName = stationName(currentStop.stationId)
  const nextName = nextStop ? stationName(nextStop.stationId) : null
  const waiting = phase === 'waiting'
  const finished = phase === 'finished'
  const yourStops = plan.stops.slice(plan.boardingIndex)
  const countdown = finished ? remainingDwellMs : remainingToNextStopMs
  const countdownLabel = waiting ? 'Train arrives in' : finished ? 'Trip ends in' : 'Next stop in'

  return (
    <section className="route-progress-card" aria-labelledby="route-progress-title">
      <header className="route-progress-header">
        <h2 id="route-progress-title">Route progress</h2>
        <span className="route-progress-phase">
          {waiting ? 'Waiting for train' : finished ? 'Final stop' : phase === 'stopped' ? 'At a station' : 'In transit'}
        </span>
      </header>

      <p className="route-progress-service">
        <span className="route-progress-line" aria-label={`Line ${plan.routeId}`}>{plan.routeId}</span>
        <span>{plan.headsign ? `Toward ${plan.headsign}` : 'Your selected trip'}</span>
      </p>

      <div className="route-progress-stations">
        <div>
          <span className="route-progress-label">{waiting ? 'Board at' : phase === 'moving' ? 'From' : 'At'}</span>
          <strong>{currentName}</strong>
        </div>
        {!waiting && nextName && (
          <>
            <span className="route-progress-arrow" aria-hidden="true">→</span>
            <div>
              <span className="route-progress-label">Next stop</span>
              <strong>{nextName}</strong>
            </div>
          </>
        )}
      </div>

      {!waiting && !finished && nextName && (
        <progress
          className="route-progress-track"
          max={1}
          value={progress.segmentProgress}
          aria-label={`Travel progress from ${currentName} to ${nextName}`}
        >
          {Math.round(progress.segmentProgress * 100)}%
        </progress>
      )}

      {countdown !== null && (
        <div className="route-progress-countdown">
          <div>
            <span className="route-progress-label">{countdownLabel}</span>
            <strong>{formatCountdown(countdown)}</strong>
          </div>
          <span className="route-progress-time-unit">game time</span>
        </div>
      )}
      {phase === 'stopped' && remainingDwellMs !== null && (
        <p className="route-progress-note">
          Departs in {formatCountdown(remainingDwellMs)} of game time. Next-stop time includes this stop.
        </p>
      )}
      {finished && <p className="route-progress-note">This is the final stop. You’ll get off here.</p>}
      {state === 'in_transit_off_at_next_station' && nextName && (
        <p className="route-progress-exit">Getting off at {nextName}.</p>
      )}

      <details className="route-progress-itinerary">
        <summary>Your stops <span>({yourStops.length})</span></summary>
        <ol className="route-progress-stop-list">
          {yourStops.map((stop, index) => {
            const routeIndex = plan.boardingIndex + index
            const isCurrent = routeIndex === stopIndex
            const passed = routeIndex < stopIndex
            const isNext = !waiting && routeIndex === stopIndex + 1
            const marker = isCurrent
              ? waiting ? 'Board here' : phase === 'moving' ? 'Departed' : 'You are here'
              : passed ? 'Passed' : isNext ? 'Next' : null
            return (
              <li
                key={stop.stopSequence}
                className={`route-progress-stop${isCurrent ? ' route-progress-stop-current' : ''}${passed ? ' route-progress-stop-passed' : ''}`}
                aria-current={isCurrent && phase !== 'moving' ? 'location' : undefined}
              >
                <span className="route-progress-stop-dot" aria-hidden="true" />
                <span className="route-progress-stop-name">{stationName(stop.stationId)}</span>
                {marker && <span className="route-progress-stop-marker">{marker}</span>}
              </li>
            )
          })}
        </ol>
      </details>
    </section>
  )
}
