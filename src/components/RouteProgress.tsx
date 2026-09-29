import { useCallback, useEffect, useRef } from 'react'
import { useGameClock } from '../game-clock/context'
import { useGameState } from '../game-state/context'
import { useGameControls } from '../game-state/controls-context'
import { getRouteProgress } from '../game-state/journey'
import type { JourneyProgress, RouteProgress as RouteInfo } from '../game-state/journey'
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

function RouteDiagram({ journey, progress, stationName }: {
  journey: JourneyProgress
  progress: RouteInfo
  stationName: (stationId: string) => string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const { plan, stopIndex } = journey
  const moving = progress.phase === 'moving'
  const waiting = progress.phase === 'waiting'

  const showStop = useCallback((index: number, smooth = false) => {
    const viewport = viewportRef.current
    const stop = viewport?.querySelector<HTMLElement>(`[data-stop-index="${index}"]`)
    if (!viewport || !stop) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewport.scrollTo({
      left: stop.offsetLeft + stop.offsetWidth / 2 - viewport.clientWidth / 2,
      behavior: smooth && !reduceMotion ? 'smooth' : 'auto',
    })
  }, [])

  // Follow stop changes, while leaving the user free to explore between arrivals.
  useEffect(() => { showStop(stopIndex) }, [plan.tripId, stopIndex, showStop])

  return (
    <div className="route-progress-itinerary">
      <div className="route-progress-itinerary-header">
        <h3>Full route <span>· {plan.stops.length} stops</span></h3>
        <span className="route-progress-position">Stop {stopIndex + 1} of {plan.stops.length}</span>
      </div>
      <div className="route-progress-navigation" aria-label="Explore the route">
        <button type="button" onClick={() => showStop(0, true)}>Start</button>
        <button type="button" onClick={() => showStop(stopIndex, true)}>Your position</button>
        <button type="button" onClick={() => showStop(plan.stops.length - 1, true)}>End</button>
      </div>
      <div
        ref={viewportRef}
        className="route-progress-scroll"
        role="region"
        aria-label="Full route stops, scroll horizontally to explore"
        tabIndex={0}
      >
        <ol className="route-progress-stop-list">
          {plan.stops.map((stop, index) => {
            const isCurrent = index === stopIndex
            const beforeBoarding = index < plan.boardingIndex
            const passed = index < stopIndex
            const isNext = !waiting && index === stopIndex + 1
            const marker = isCurrent
              ? waiting ? 'Board here' : moving ? 'Departed' : 'You are here'
              : beforeBoarding ? 'Before boarding' : passed ? 'Passed' : isNext ? 'Next'
              : index === plan.stops.length - 1 ? 'Final stop' : 'Upcoming'
            return (
              <li
                key={stop.stopSequence}
                data-stop-index={index}
                className={`route-progress-stop${isCurrent ? ' route-progress-stop-current' : ''}${passed ? ' route-progress-stop-passed' : ''}${beforeBoarding ? ' route-progress-stop-before' : ''}${isNext ? ' route-progress-stop-next' : ''}`}
                aria-current={isCurrent && !moving ? 'location' : undefined}
              >
                <div className="route-progress-rail" aria-hidden="true">
                  {index < plan.stops.length - 1 && (
                    <span className="route-progress-connector">
                      <span style={{ width: `${passed ? 100 : isCurrent && moving ? progress.segmentProgress * 100 : 0}%` }} />
                    </span>
                  )}
                  <span className="route-progress-stop-dot" />
                  {isCurrent && (
                    <span
                      className="route-progress-traveler"
                      style={{ left: `${50 + (moving ? progress.segmentProgress * 100 : 0)}%` }}
                    >You</span>
                  )}
                </div>
                <span className="route-progress-stop-name">{stationName(stop.stationId)}</span>
                <span className="route-progress-stop-marker">{marker}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <p className="route-progress-scroll-hint">Scroll sideways to see every stop.</p>
    </div>
  )
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

  const { plan } = journey
  const { currentStop, nextStop, phase, remainingToNextStopMs, remainingDwellMs } = progress
  const stationName = (stationId: string) => byId.get(stationId)?.name ?? stationId
  const currentName = stationName(currentStop.stationId)
  const nextName = nextStop ? stationName(nextStop.stationId) : null
  const waiting = phase === 'waiting'
  const finished = phase === 'finished'
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

      <RouteDiagram journey={journey} progress={progress} stationName={stationName} />
    </section>
  )
}
