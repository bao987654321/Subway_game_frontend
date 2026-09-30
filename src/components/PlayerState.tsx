import { useGameState } from '../game-state/context'
import { GAME_STATE_LABELS } from '../game-state/state-machine'
import { useStationCatalog } from '../stations/context'
import { GameControls } from './GameControls'

function StationField({ stationId }: { stationId: string | null }) {
  const { byId } = useStationCatalog()
  const station = stationId === null ? undefined : byId.get(stationId)

  return (
    <div>
      <dt>{station ? 'Station' : 'Station ID'}</dt>
      <dd>
        {station ? (
          <>
            <span>{station.name}</span>
            <span className="player-station-id">ID {station.id}</span>
          </>
        ) : stationId ?? 'Not selected'}
      </dd>
    </div>
  )
}

function PlayerStateDetails({ info }: { info: ReturnType<typeof useGameState> }) {
  switch (info.state) {
    case 'outside':
      return <StationField stationId={info.stationId} />
    case 'in_station':
      return (
        <>
          <StationField stationId={info.stationId} />
          <div>
            <dt>Trips remaining today</dt>
            <dd>{info.nextTrips.length}</dd>
          </div>
        </>
      )
    case 'waiting_for_trip':
      return (
        <>
          <StationField stationId={info.stationId} />
          <div>
            <dt>Waiting for trip</dt>
            <dd>{info.tripId}</dd>
          </div>
        </>
      )
    case 'on_trip_in_station':
    case 'in_transit':
      return (
        <div>
          <dt>Trip ID</dt>
          <dd>{info.tripId}</dd>
        </div>
      )
    case 'in_transit_off_at_next_station':
      return (
        <>
          <div>
            <dt>Trip ID</dt>
            <dd>{info.tripId}</dd>
          </div>
          <div>
            <dt>Next stop ID</dt>
            <dd>{info.nextStopId}</dd>
          </div>
        </>
      )
  }
}

export function PlayerState() {
  const info = useGameState()

  return (
    <section className="player-state-card" aria-labelledby="player-state-title">
      <header className="player-state-header">
        <h2 id="player-state-title">Player state</h2>
        <p className="player-state-value" role="status" aria-label="Current player state">
          {GAME_STATE_LABELS[info.state]}
        </p>
      </header>
      <div className="player-state-body">
        <dl className="player-state-details">
          <PlayerStateDetails info={info} />
        </dl>
        <GameControls />
      </div>
    </section>
  )
}
