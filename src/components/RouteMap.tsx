import { memo, useMemo, useState } from 'react'
import { useGameClock } from '../game-clock/context'
import { useGameControls } from '../game-state/controls-context'
import { useGameState } from '../game-state/context'
import { getRouteProgress } from '../game-state/journey'
import type { JourneyProgress } from '../game-state/journey'
import type { GameState } from '../game-state/state-machine'
import { useStationCatalog } from '../stations/context'
import { createMapProjection, getEstimatedPosition, getStationCoordinate } from '../map/geometry'
import type { MapCoordinate, MapPoint } from '../map/geometry'
import { useRouteShape } from '../map/use-route-shape'
import './RouteMap.css'

interface MapStop {
  readonly name: string
  readonly stopSequence: number
  readonly point: MapPoint | null
}

interface MapDrawing {
  readonly path: string
  readonly stops: readonly MapStop[]
}

const MapTrack = memo(function MapTrack({ drawing, stopIndex, state }: {
  drawing: MapDrawing
  stopIndex: number
  state: GameState
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const activeIndex = hoveredIndex ?? selectedIndex ?? stopIndex
  const activeStop = drawing.stops[activeIndex]
  const waiting = state === 'waiting_for_trip'
  const moving = state === 'in_transit' || state === 'in_transit_off_at_next_station'
  const current = drawing.stops[stopIndex]!
  const next = drawing.stops[stopIndex + 1]

  return (
    <>
      <svg className="route-map-track" viewBox="0 0 640 480" aria-label="Route and stations">
        <path className="route-map-line" d={drawing.path} fill="none" />
        <g className="route-map-north" aria-hidden="true">
          <path d="M606 40V20m-5 6 5-6 5 6" />
          <text x="606" y="56" textAnchor="middle">N</text>
        </g>
        {drawing.stops.map((stop, index) => {
          if (!stop.point) return null
          const isCurrent = index === stopIndex
          const isNext = !waiting && index === stopIndex + 1
          const description = isCurrent ? waiting ? 'Board here' : moving ? 'Departed' : 'Current station'
            : isNext ? 'Next station' : `Stop ${index + 1}`
          return (
            <g
              key={stop.stopSequence}
              className={`route-map-stop${isCurrent ? ' route-map-stop-current' : ''}${isNext ? ' route-map-stop-next' : ''}`}
              transform={`translate(${stop.point.x} ${stop.point.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${stop.name}, ${description}`}
              aria-pressed={selectedIndex === index}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setSelectedIndex(index)}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedIndex(index)
                }
              }}
            >
              <title>{`${stop.name} · ${description}`}</title>
              <circle r="18" fill="transparent" />
              <circle className="route-map-stop-halo" r="12" opacity={activeIndex === index ? 1 : 0} />
              <circle className="route-map-stop-dot" r={isCurrent || isNext ? 8 : 5} />
            </g>
          )
        })}
      </svg>
      <div className="route-map-details">
        <p className="route-map-station-detail">
          <span>Station · {activeIndex + 1} of {drawing.stops.length}</span>
          <strong>{activeStop?.name ?? 'Station unavailable'}</strong>
        </p>
        <p className="route-map-location">
          {moving && next ? `Between ${current.name} and ${next.name}`
            : waiting ? `Waiting at ${current.name}` : `At ${current.name}`}
        </p>
      </div>
    </>
  )
})

function PlayerMarker({ drawing, journey, state }: {
  drawing: MapDrawing
  journey: JourneyProgress
  state: GameState
}) {
  const { gameTimeMs } = useGameClock()
  const progress = getRouteProgress(journey, state, gameTimeMs)
  const current = drawing.stops[journey.stopIndex]?.point ?? null
  const next = drawing.stops[journey.stopIndex + 1]?.point ?? null
  const point = getEstimatedPosition(progress, current, next)

  return (
    <>
      <svg className="route-map-player" viewBox="0 0 640 480" aria-hidden="true">
        {point && (
          <g transform={`translate(${point.x} ${point.y})`}>
            <circle className="route-map-player-halo" r="13" />
            <circle className="route-map-player-dot" r="7" />
            <path className="route-map-player-label" d="M-22-39H22V-17H5L0-12-5-17H-22Z" />
            <text x="0" y="-24" textAnchor="middle">You</text>
          </g>
        )}
      </svg>
      {!point && <p className="route-map-position-unavailable">Position unavailable</p>}
    </>
  )
}

function JourneyMap({ journey, state }: { journey: JourneyProgress; state: GameState }) {
  const { plan } = journey
  const { byId } = useStationCatalog()
  const result = useRouteShape(plan.routeId, plan.directionId)
  const shape = result.status === 'ready' ? result.shape : null
  const drawing = useMemo<MapDrawing | null>(() => {
    if (!shape) return null
    const stations = plan.stops.map((stop) => {
      const station = byId.get(stop.stationId)
      return {
        name: station?.name ?? stop.stationId,
        stopSequence: stop.stopSequence,
        coordinate: getStationCoordinate(station),
      }
    })
    const coordinates = stations.map((station) => station.coordinate)
      .filter((coordinate): coordinate is MapCoordinate => coordinate !== null)
    const projection = createMapProjection([...shape.coordinates, ...coordinates], 640, 480, 40)
    if (!projection) return null
    return {
      path: shape.coordinates.map((coordinate, index) => {
        const point = projection.project(coordinate)!
        return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
      }).join(' '),
      stops: stations.map((station) => ({
        name: station.name,
        stopSequence: station.stopSequence,
        point: station.coordinate ? projection.project(station.coordinate) : null,
      })),
    }
  }, [shape, plan, byId])

  return (
    <>
      <p className="route-map-service">
        <span className="route-map-badge" aria-label={`Line ${plan.routeId}`}>{plan.routeId}</span>
        <span>{plan.headsign ? `Toward ${plan.headsign}` : 'Your selected trip'}</span>
      </p>
      {result.status === 'loading' && <p className="route-map-message" role="status">Loading route map…</p>}
      {result.status === 'error' && (
        <div className="route-map-error">
          <p role="alert">{result.message}</p>
          <button type="button" onClick={result.retry}>Retry map</button>
        </div>
      )}
      {drawing && (
        <>
          <div className="route-map-drawing">
            <MapTrack drawing={drawing} stopIndex={journey.stopIndex} state={state} />
            <PlayerMarker drawing={drawing} journey={journey} state={state} />
          </div>
          <div className="route-map-legend" aria-label="Map legend">
            <span><i className="route-map-legend-you" />You</span>
            <span><i className="route-map-legend-current" />Current / departed</span>
            <span><i className="route-map-legend-next" />Next stop</span>
          </div>
          <p className="route-map-note">Position is estimated between stops. Select a station to see its name.</p>
        </>
      )}
    </>
  )
}

export function RouteMap() {
  const { journey } = useGameControls()
  const { state } = useGameState()
  const activeJourney = journey && state !== 'outside' && state !== 'in_station' ? journey : null
  return (
    <section className="route-map-card" aria-labelledby="route-map-title">
      <header className="route-map-header">
        <h2 id="route-map-title">Map</h2>
        {activeJourney && <span>Full route</span>}
      </header>
      {activeJourney
        ? <JourneyMap key={activeJourney.plan.tripId} journey={activeJourney} state={state} />
        : <p className="route-map-message">Choose a trip to see its map.</p>}
    </section>
  )
}
