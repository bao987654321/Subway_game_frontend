import type { ScheduledTrip, TripStop } from '../api/trips.ts'
import { STOP_DURATION_MS, type GameEvent, type GameStateSnapshot } from './state-machine.ts'

export interface JourneyStop extends TripStop {
  readonly stationId: string
}

export interface JourneyPlan {
  readonly tripId: string
  readonly boardingIndex: number
  readonly stops: readonly JourneyStop[]
}

export interface JourneyProgress {
  readonly plan: JourneyPlan
  /** Current stop when stopped; the stop just departed when in transit. */
  readonly stopIndex: number
}

interface JourneyMachine {
  getSnapshot(): GameStateSnapshot
  send(event: GameEvent): boolean
}

function isTimestamp(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(new Date(value).getTime())
}

function isId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function stationForStop(stopId: string, knownStationIds: ReadonlySet<string>): string {
  if (knownStationIds.has(stopId)) return stopId
  if (/[NS]$/.test(stopId)) {
    const parent = stopId.slice(0, -1)
    if (knownStationIds.has(parent)) return parent
  }
  throw new Error(`Station information is unavailable for stop ${stopId}.`)
}

/** Copy the supplied schedule into a game journey, with exactly 30 game seconds per stop. */
export function createJourneyPlan(
  trip: ScheduledTrip,
  stops: readonly TripStop[],
  boardingStationId: string,
  knownStationIds: ReadonlySet<string>,
): JourneyPlan {
  if (
    !trip || !isId(trip.tripId) ||
    !Number.isSafeInteger(trip.stopSequence) || trip.stopSequence < 0 ||
    !isTimestamp(trip.arrivalGameTimeMs) || !isTimestamp(trip.departureGameTimeMs) ||
    trip.departureGameTimeMs < trip.arrivalGameTimeMs ||
    !isId(boardingStationId) || !knownStationIds.has(boardingStationId) ||
    !Array.isArray(stops) || stops.length === 0
  ) {
    throw new Error('A valid trip, boarding station, and stop schedule are required.')
  }

  const orderedStops = [...stops].sort((a, b) => a.stopSequence - b.stopSequence)
  const normalized: JourneyStop[] = []
  let previousRawArrival = -Infinity
  for (const stop of orderedStops) {
    const previous = normalized.at(-1)
    if (
      !stop || stop.tripId !== trip.tripId || !isId(stop.stopId) ||
      !Number.isSafeInteger(stop.stopSequence) || stop.stopSequence < 0 ||
      stop.stopSequence === previous?.stopSequence ||
      !isTimestamp(stop.arrivalGameTimeMs) || !isTimestamp(stop.departureGameTimeMs) ||
      stop.departureGameTimeMs < stop.arrivalGameTimeMs ||
      stop.arrivalGameTimeMs < previousRawArrival
    ) {
      throw new Error('The selected trip has an invalid stop schedule.')
    }

    const arrivalGameTimeMs = Math.max(
      stop.arrivalGameTimeMs,
      previous?.departureGameTimeMs ?? -Infinity,
    )
    const departureGameTimeMs = arrivalGameTimeMs + STOP_DURATION_MS
    if (!isTimestamp(departureGameTimeMs)) {
      throw new Error('The selected trip has an invalid stop time.')
    }
    normalized.push(Object.freeze({
      ...stop,
      stationId: stationForStop(stop.stopId, knownStationIds),
      arrivalGameTimeMs,
      departureGameTimeMs,
    }))
    previousRawArrival = stop.arrivalGameTimeMs
  }

  const boardingIndex = normalized.findIndex((stop) => stop.stopSequence === trip.stopSequence)
  if (boardingIndex < 0 || normalized[boardingIndex]!.stationId !== boardingStationId) {
    throw new Error('The selected trip does not stop at this boarding station.')
  }

  return Object.freeze({
    tripId: trip.tripId,
    boardingIndex,
    stops: Object.freeze(normalized),
  })
}

/** Apply every scheduled event reached by the shared clock, including large speed-driven jumps. */
export function advanceJourney(
  machine: JourneyMachine,
  progress: JourneyProgress,
  gameTimeMs: number,
): JourneyProgress | null {
  if (!isTimestamp(gameTimeMs)) throw new RangeError('Invalid game timestamp.')
  const { plan } = progress
  let current = progress
  if (
    !Number.isSafeInteger(current.stopIndex) ||
    current.stopIndex < plan.boardingIndex || current.stopIndex >= plan.stops.length
  ) return null

  // A trip has at most one boarding, one departure per stop, and one arrival per later stop.
  for (let eventCount = 0; eventCount < plan.stops.length * 2 + 2; eventCount++) {
    const snapshot = machine.getSnapshot()
    if (snapshot.state === 'outside' || snapshot.state === 'in_station') return null
    if (snapshot.tripId !== plan.tripId) return null

    const stop = plan.stops[current.stopIndex]!
    switch (snapshot.state) {
      case 'waiting_for_trip':
        if (current.stopIndex !== plan.boardingIndex || snapshot.stationId !== stop.stationId) {
          return null
        }
        if (gameTimeMs < stop.arrivalGameTimeMs) return current
        if (!machine.send({ type: 'BOARD_TRIP', stopArrivalGameTimeMs: stop.arrivalGameTimeMs })) {
          return current
        }
        break
      case 'on_trip_in_station':
        if (snapshot.stopArrivalGameTimeMs !== stop.arrivalGameTimeMs) return null
        if (gameTimeMs < stop.departureGameTimeMs) return current
        if (current.stopIndex === plan.stops.length - 1) {
          return machine.send({ type: 'GET_OFF_TRIP', stationId: stop.stationId }) ? null : current
        }
        if (!machine.send('DEPART_STATION')) return current
        break
      case 'in_transit':
      case 'in_transit_off_at_next_station': {
        const nextStop = plan.stops[current.stopIndex + 1]
        if (!nextStop) return null
        if (
          snapshot.state === 'in_transit_off_at_next_station' &&
          snapshot.nextStopId !== nextStop.stopId
        ) return null
        if (gameTimeMs < nextStop.arrivalGameTimeMs) return current
        if (!machine.send({
          type: 'ARRIVE_AT_STATION',
          stationId: nextStop.stationId,
          stopArrivalGameTimeMs: nextStop.arrivalGameTimeMs,
        })) return current
        current = Object.freeze({ plan, stopIndex: current.stopIndex + 1 })
        break
      }
    }
  }
  return current
}
