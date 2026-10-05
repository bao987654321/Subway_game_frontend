import { useState } from 'react'
import type { FormEvent } from 'react'
import { useGameClock } from '../game-clock/context'
import { useGameState } from '../game-state/context'
import { useGameControls } from '../game-state/controls-context'
import { useStationCatalog } from '../stations/context'
import { STOP_DURATION_MS } from '../game-state/state-machine'

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function TripChooser() {
  const { gameTimeMs } = useGameClock()
  const info = useGameState()
  const { stationTrips, choosingTrip, chooseTrip, refreshTrips } = useGameControls()
  const [selection, setSelection] = useState('')
  if (info.state !== 'in_station') return null
  if (stationTrips.stationId !== info.stationId || stationTrips.status === 'idle' ||
      stationTrips.status === 'loading') return <p role="status">Loading upcoming trips…</p>
  if (stationTrips.status === 'error') {
    return (
      <div>
        <p role="alert">{stationTrips.error}</p>
        <button type="button" onClick={refreshTrips}>Retry trips</button>
      </div>
    )
  }

  const trips = stationTrips.trips.filter((trip) => trip.arrivalGameTimeMs + STOP_DURATION_MS > gameTimeMs)
  if (trips.length === 0) {
    return (
      <div>
        <p role="status">No more trips from this station today.</p>
        <button type="button" onClick={refreshTrips}>Refresh trips</button>
      </div>
    )
  }
  const selected = trips.find((trip) => `${trip.tripId}:${trip.stopSequence}` === selection)

  function waitForTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selected) void chooseTrip(selected.tripId, selected.stopSequence)
  }

  return (
    <form onSubmit={waitForTrip}>
      <label htmlFor="next-trip">Choose next trip to take</label>
      <select
        id="next-trip"
        value={selected ? selection : ''}
        onChange={(event) => setSelection(event.target.value)}
        disabled={choosingTrip}
        required
      >
        <option value="" disabled>Choose a trip</option>
        {trips.map((trip) => (
          <option key={`${trip.tripId}:${trip.stopSequence}`} value={`${trip.tripId}:${trip.stopSequence}`}>
            {timeFormatter.format(trip.arrivalGameTimeMs)} · {trip.routeId} to {trip.headsign ?? trip.tripId}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!selected || choosingTrip}>
        {choosingTrip ? 'Loading trip…' : 'Wait for this trip'}
      </button>
    </form>
  )
}

export function GameControls() {
  const info = useGameState()
  const controls = useGameControls()
  const { byId } = useStationCatalog()
  const progress = controls.journey
  const stop = progress?.plan.stops[progress.stopIndex]
  const nextStop = progress?.plan.stops[progress.stopIndex + 1]

  return (
    <div className="game-controls" aria-label="Game controls">
      {controls.actionError && <p role="alert">{controls.actionError}</p>}
      {info.state === 'outside' && (
        <>
          <button type="button" onClick={controls.enterStation} disabled={info.stationId === null}>
            Enter Station
          </button>
          <button type="button" className="secondary-button" onClick={controls.quitGame}>Quit Game</button>
        </>
      )}
      {info.state === 'in_station' && (
        <>
          <TripChooser />
          <button type="button" className="secondary-button" onClick={controls.leaveStation}>Leave Station</button>
        </>
      )}
      {info.state === 'waiting_for_trip' && (
        <>
          <p>Waiting for your trip{stop ? ` at ${timeFormatter.format(stop.arrivalGameTimeMs)}` : ''}. You’ll board when it arrives.</p>
          <button type="button" onClick={controls.cancelWait}>Cancel waiting</button>
        </>
      )}
      {info.state === 'on_trip_in_station' && (
        <>
          {stop && <p>At {byId.get(stop.stationId)?.name ?? stop.stationId}.</p>}
          <button type="button" onClick={controls.getOff}>Get off</button>
        </>
      )}
      {(info.state === 'in_transit' || info.state === 'in_transit_off_at_next_station') && nextStop && (
        <p>Next stop: {byId.get(nextStop.stationId)?.name ?? nextStop.stationId}</p>
      )}
      {info.state === 'in_transit' && (
        <button type="button" onClick={controls.requestExit}>Get Off at Next Station</button>
      )}
      {info.state === 'in_transit_off_at_next_station' && (
        <button type="button" onClick={controls.cancelExit}>Cancel getting off</button>
      )}
    </div>
  )
}
