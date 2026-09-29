import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useGameState } from '../game-state/context'
import { useStationCatalog } from '../stations/context'

function StationOptions() {
  const { selectStartingStation } = useGameState()
  const { catalog, byId, retry } = useStationCatalog()
  const [selectedId, setSelectedId] = useState('')
  const options = useMemo(() => catalog.status === 'ready' && catalog.stations.map((station) => (
    <option key={station.id} value={station.id}>
      {station.name} — {station.onLines.length > 0 ? `${station.onLines.join(', ')} ` : ''}({station.id})
    </option>
  )), [catalog])

  function chooseStation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (catalog.status === 'ready' && byId.has(selectedId)) {
      selectStartingStation(selectedId)
    }
  }

  return (
    <section className="starting-station-card" aria-labelledby="starting-station-title">
      <h2 id="starting-station-title">Choose your starting station</h2>
      <p className="starting-station-note">You’ll begin outside the station you choose.</p>
      {catalog.status === 'loading' && <p role="status">Loading stations…</p>}
      {catalog.status === 'error' && (
        <div>
          <p role="alert">{catalog.message}</p>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}
      {catalog.status === 'ready' && (catalog.stations.length === 0 ? (
        <div>
          <p role="status">No starting stations are available right now.</p>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      ) : (
        <form onSubmit={chooseStation}>
          <label htmlFor="starting-station">Starting station</label>
          <select
            id="starting-station"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            aria-describedby="station-count"
            required
          >
            <option value="" disabled>Choose a station</option>
            {options}
          </select>
          <p id="station-count" className="starting-station-note" role="status">
            {catalog.stations.length} stations available
          </p>
          <button type="submit" disabled={!selectedId}>Start at this station</button>
        </form>
      ))}
    </section>
  )
}

export function StartingStationPicker() {
  const info = useGameState()
  return info.state === 'outside' && info.stationId === null ? <StationOptions /> : null
}
