export const GAME_STATE_LABELS = {
  outside: 'Outside',
  in_station: 'In Station',
  waiting_for_trip: 'In Station (Waiting For Trip)',
  on_trip_in_station: 'On Trip In Station',
  in_transit: 'In Transit',
  in_transit_off_at_next_station: 'In Transit (Off At Next Station)',
} as const

export type GameState = keyof typeof GAME_STATE_LABELS

export type GameEventType =
  | 'ENTER_STATION'
  | 'LEAVE_STATION'
  | 'WAIT_FOR_TRIP'
  | 'CANCEL_WAIT'
  | 'BOARD_TRIP'
  | 'GET_OFF_TRIP'
  | 'DEPART_STATION'
  | 'ARRIVE_AT_STATION'
  | 'REQUEST_EXIT'
  | 'CANCEL_EXIT'

export interface UpcomingTrip {
  readonly tripId: string
  /** Absolute departure timestamp in game-time epoch milliseconds. */
  readonly departureGameTimeMs: number
}

export type GameStateSnapshot =
  | Readonly<{ state: 'outside'; stationId: string | null; tripLetters: readonly string[] }>
  | Readonly<{
      state: 'in_station'
      stationId: string
      nextTrips: readonly UpcomingTrip[]
      tripLetters: readonly string[]
    }>
  | Readonly<{
      state: 'waiting_for_trip'
      stationId: string
      tripId: string
      tripLetters: readonly string[]
      routeLetter: string
    }>
  | Readonly<{
      state: 'on_trip_in_station'
      tripId: string
      stopArrivalGameTimeMs: number
      tripLetters: readonly string[]
    }>
  | Readonly<{ state: 'in_transit'; tripId: string; tripLetters: readonly string[] }>
  | Readonly<{
      state: 'in_transit_off_at_next_station'
      tripId: string
      nextStopId: string
      tripLetters: readonly string[]
    }>

export type GameStateInfo =
  | Exclude<GameStateSnapshot, { state: 'on_trip_in_station' }>
  | (Extract<GameStateSnapshot, { state: 'on_trip_in_station' }> & {
      readonly remainingStopTimeMs: number
    })

type SimpleGameEvent =
  | 'ENTER_STATION'
  | 'LEAVE_STATION'
  | 'CANCEL_WAIT'
  | 'DEPART_STATION'
  | 'CANCEL_EXIT'

type GameEventPayload =
  | { type: 'ENTER_STATION'; stationId?: string; nextTrips?: readonly UpcomingTrip[] }
  | { type: Exclude<SimpleGameEvent, 'ENTER_STATION'> }
  | { type: 'WAIT_FOR_TRIP'; tripId: string; tripLetter: string }
  | { type: 'BOARD_TRIP'; stopArrivalGameTimeMs: number }
  | { type: 'GET_OFF_TRIP'; stationId: string; nextTrips?: readonly UpcomingTrip[] }
  | {
      type: 'ARRIVE_AT_STATION'
      stationId: string
      stopArrivalGameTimeMs: number
      nextTrips?: readonly UpcomingTrip[]
    }
  | { type: 'REQUEST_EXIT'; nextStopId: string }

export type GameEvent = SimpleGameEvent | GameEventPayload

export const STOP_DURATION_MS = 30_000

const TRANSITIONS: Record<GameState, Partial<Record<GameEventType, GameState>>> = {
  outside: {
    ENTER_STATION: 'in_station',
  },
  in_station: {
    LEAVE_STATION: 'outside',
    WAIT_FOR_TRIP: 'waiting_for_trip',
  },
  waiting_for_trip: {
    CANCEL_WAIT: 'in_station',
    BOARD_TRIP: 'on_trip_in_station',
  },
  on_trip_in_station: {
    GET_OFF_TRIP: 'in_station',
    DEPART_STATION: 'in_transit',
  },
  in_transit: {
    ARRIVE_AT_STATION: 'on_trip_in_station',
    REQUEST_EXIT: 'in_transit_off_at_next_station',
  },
  in_transit_off_at_next_station: {
    CANCEL_EXIT: 'in_transit',
    ARRIVE_AT_STATION: 'in_station',
  },
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(new Date(value).getTime())
}

function copyTrips(trips: readonly UpcomingTrip[] | undefined): readonly UpcomingTrip[] | null {
  if (trips === undefined) return Object.freeze([])
  if (!Array.isArray(trips)) return null

  const copy: UpcomingTrip[] = []
  for (const trip of trips) {
    if (!trip || !isId(trip.tripId) || !isTimestamp(trip.departureGameTimeMs)) {
      return null
    }
    copy.push(Object.freeze({
      tripId: trip.tripId,
      departureGameTimeMs: trip.departureGameTimeMs,
    }))
  }
  return Object.freeze(copy)
}

/** Derive time-sensitive fields from the shared game clock, without advancing the FSM. */
export function getGameStateInfo(
  snapshot: GameStateSnapshot,
  gameTimeMs: number,
): GameStateInfo {
  if (!isTimestamp(gameTimeMs)) throw new RangeError('Invalid game timestamp.')

  if (snapshot.state === 'on_trip_in_station') {
    return Object.freeze({
      ...snapshot,
      remainingStopTimeMs: Math.max(0, Math.min(
        STOP_DURATION_MS,
        snapshot.stopArrivalGameTimeMs + STOP_DURATION_MS - gameTimeMs,
      )),
    })
  }

  if (snapshot.state === 'in_station') {
    const endOfDay = new Date(gameTimeMs)
    endOfDay.setHours(24, 0, 0, 0)
    const nextTrips = snapshot.nextTrips
      .filter((trip) => trip.departureGameTimeMs >= gameTimeMs &&
        trip.departureGameTimeMs < endOfDay.getTime())
      .sort((first, second) => first.departureGameTimeMs - second.departureGameTimeMs)
    return Object.freeze({ ...snapshot, nextTrips: Object.freeze(nextTrips) })
  }

  return snapshot
}

/** One frontend session. IDs and schedules are supplied by callers, not fetched here. */
export function createGameStateMachine(initialStationId: string | null = null) {
  if (initialStationId !== null && !isId(initialStationId)) {
    throw new TypeError('Initial station ID must be a non-empty string or null.')
  }

  let snapshot: GameStateSnapshot = Object.freeze({
    state: 'outside',
    stationId: initialStationId,
    tripLetters: Object.freeze([]),
  })
  // Retain the supplied departures while waiting so cancelling restores the station.
  let waitingTrips: readonly UpcomingTrip[] = Object.freeze([])

  return {
    getSnapshot: () => snapshot,
    selectStartingStation(stationId: string): boolean {
      if (snapshot.state !== 'outside' || snapshot.stationId !== null || !isId(stationId)) {
        return false
      }

      snapshot = Object.freeze({ state: 'outside', stationId, tripLetters: snapshot.tripLetters })
      return true
    },
    refreshStationTrips(stationId: string, trips: readonly UpcomingTrip[]): boolean {
      if (snapshot.state !== 'in_station' || !isId(stationId) ||
        snapshot.stationId !== stationId || !Array.isArray(trips)) {
        return false
      }

      const nextTrips = copyTrips(trips)
      if (nextTrips === null) return false

      snapshot = Object.freeze({ state: 'in_station', stationId, nextTrips, tripLetters: snapshot.tripLetters })
      return true
    },
    send(event: GameEvent): boolean {
      const input = (typeof event === 'string' ? { type: event } : event) as GameEventPayload
      if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'type')) return false

      const availableTransitions = TRANSITIONS[snapshot.state]
      if (!Object.hasOwn(availableTransitions, input.type)) return false

      let nextSnapshot: GameStateSnapshot
      const tripLetters = snapshot.tripLetters
      switch (input.type) {
        case 'ENTER_STATION': {
          if (snapshot.state !== 'outside') return false
          const stationId = input.stationId === undefined ? snapshot.stationId : input.stationId
          const nextTrips = copyTrips(input.nextTrips)
          if (!isId(stationId) || nextTrips === null) return false
          nextSnapshot = { state: 'in_station', stationId, nextTrips, tripLetters }
          break
        }
        case 'LEAVE_STATION':
          if (snapshot.state !== 'in_station') return false
          nextSnapshot = { state: 'outside', stationId: snapshot.stationId, tripLetters }
          break
        case 'WAIT_FOR_TRIP':
          if (snapshot.state !== 'in_station' || !isId(input.tripId) || !isId(input.tripLetter)) {
            return false
          }
          nextSnapshot = {
            state: 'waiting_for_trip',
            stationId: snapshot.stationId,
            tripId: input.tripId,
            tripLetters,
            routeLetter: input.tripLetter,
          }
          waitingTrips = snapshot.nextTrips
          break
        case 'CANCEL_WAIT':
          if (snapshot.state !== 'waiting_for_trip') return false
          nextSnapshot = {
            state: 'in_station',
            stationId: snapshot.stationId,
            nextTrips: waitingTrips,
            tripLetters,
          }
          break
        case 'BOARD_TRIP':
          if (snapshot.state !== 'waiting_for_trip' || !isTimestamp(input.stopArrivalGameTimeMs)) {
            return false
          }
          nextSnapshot = {
            state: 'on_trip_in_station',
            tripId: snapshot.tripId,
            stopArrivalGameTimeMs: input.stopArrivalGameTimeMs,
            tripLetters: Object.freeze([...tripLetters, snapshot.routeLetter]),
          }
          break
        case 'GET_OFF_TRIP': {
          if (!isId(input.stationId)) return false
          const nextTrips = copyTrips(input.nextTrips)
          if (nextTrips === null) return false
          nextSnapshot = { state: 'in_station', stationId: input.stationId, nextTrips, tripLetters }
          break
        }
        case 'DEPART_STATION':
          if (snapshot.state !== 'on_trip_in_station') return false
          nextSnapshot = { state: 'in_transit', tripId: snapshot.tripId, tripLetters }
          break
        case 'ARRIVE_AT_STATION': {
          if (!isId(input.stationId) || !isTimestamp(input.stopArrivalGameTimeMs)) return false
          const nextTrips = copyTrips(input.nextTrips)
          if (nextTrips === null) return false
          if (snapshot.state === 'in_transit') {
            nextSnapshot = {
              state: 'on_trip_in_station',
              tripId: snapshot.tripId,
              stopArrivalGameTimeMs: input.stopArrivalGameTimeMs,
              tripLetters,
            }
          } else if (snapshot.state === 'in_transit_off_at_next_station') {
            nextSnapshot = { state: 'in_station', stationId: input.stationId, nextTrips, tripLetters }
          } else {
            return false
          }
          break
        }
        case 'REQUEST_EXIT':
          if (snapshot.state !== 'in_transit' || !isId(input.nextStopId)) return false
          nextSnapshot = {
            state: 'in_transit_off_at_next_station',
            tripId: snapshot.tripId,
            nextStopId: input.nextStopId,
            tripLetters,
          }
          break
        case 'CANCEL_EXIT':
          if (snapshot.state !== 'in_transit_off_at_next_station') return false
          nextSnapshot = { state: 'in_transit', tripId: snapshot.tripId, tripLetters }
          break
        default:
          return false
      }

      snapshot = Object.freeze(nextSnapshot)
      if (snapshot.state !== 'waiting_for_trip') waitingTrips = Object.freeze([])
      return true
    },
  }
}
