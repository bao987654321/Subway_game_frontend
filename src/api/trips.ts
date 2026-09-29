const DEFAULT_BASE_URL = 'https://subway-game-backend.rcdis.co'

export interface FetchTripsOptions {
  baseUrl?: string
  signal?: AbortSignal
}

export interface ScheduledTrip {
  readonly tripId: string
  readonly routeId: string
  readonly headsign: string | null
  readonly stopSequence: number
  readonly arrivalGameTimeMs: number
  readonly departureGameTimeMs: number
  readonly serviceDateMs: number
}

export interface TripStop {
  readonly tripId: string
  readonly stopId: string
  readonly stopSequence: number
  readonly arrivalGameTimeMs: number
  readonly departureGameTimeMs: number
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function serviceDate(timeMs: number): Date {
  if (typeof timeMs !== 'number' || !Number.isFinite(new Date(timeMs).getTime())) {
    throw new TypeError('A valid game time is required to load trips.')
  }
  const date = new Date(timeMs)
  date.setHours(0, 0, 0, 0)
  return date
}

function parseTime(value: unknown, date: Date): number {
  const match = typeof value === 'string' && /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value)
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    throw new Error('Trip service returned an invalid schedule time.')
  }
  // GTFS hours can exceed 23: 24:10:00 belongs to the following calendar day.
  // Use local calendar arithmetic, matching the shared game clock.
  const time = new Date(date)
  time.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0)
  if (!Number.isFinite(time.getTime())) {
    throw new Error('Trip service returned an invalid schedule time.')
  }
  return time.getTime()
}

function parseSchedule(value: unknown, date: Date) {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Trip service returned invalid trip details.')
  }
  const row = value as Record<string, unknown>
  if (
    !isNonemptyString(row.trip_id) ||
    !Number.isSafeInteger(row.stop_sequence) ||
    (row.stop_sequence as number) < 0
  ) {
    throw new Error('Trip service returned invalid trip details.')
  }
  const arrivalGameTimeMs = parseTime(row.arrival_time, date)
  const departureGameTimeMs = parseTime(row.departure_time, date)
  if (departureGameTimeMs < arrivalGameTimeMs) {
    throw new Error('Trip service returned departure before arrival.')
  }
  return {
    row,
    tripId: row.trip_id,
    stopSequence: row.stop_sequence as number,
    arrivalGameTimeMs,
    departureGameTimeMs,
  }
}

async function fetchJson(path: string, options: FetchTripsOptions): Promise<unknown> {
  const { baseUrl = DEFAULT_BASE_URL, signal } = options
  signal?.throwIfAborted()
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) {
    throw new Error(`Unable to load trips (HTTP ${response.status}).`)
  }
  const result: unknown = await response.json()
  signal?.throwIfAborted()
  return result
}

export async function fetchNextTrips(
  stationId: string,
  gameTimeMs: number,
  options: FetchTripsOptions = {},
): Promise<readonly ScheduledTrip[]> {
  if (!isNonemptyString(stationId)) {
    throw new TypeError('A station ID is required to load trips.')
  }
  const date = serviceDate(gameTimeMs)
  const now = new Date(gameTimeMs)
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0')).join(':')
  const day = now.getDay() === 0 ? 'sunday' : now.getDay() === 6 ? 'saturday' : 'weekday'
  const query = new URLSearchParams({ station_id: stationId, time, day })
  // Omitting limit requests all remaining departures, as documented by the API.
  const result = await fetchJson(`/get_next_trips?${query}`, options)
  if (!Array.isArray(result)) {
    throw new Error('Trip service returned an invalid trip list.')
  }
  const nextMidnight = new Date(date)
  nextMidnight.setDate(nextMidnight.getDate() + 1)
  const trips = result.map((value): ScheduledTrip => {
    const { row, ...schedule } = parseSchedule(value, date)
    if (
      !isNonemptyString(row.route_id) ||
      (row.trip_headsign !== undefined && row.trip_headsign !== null && typeof row.trip_headsign !== 'string')
    ) {
      throw new Error('Trip service returned invalid trip details.')
    }
    return Object.freeze({
      ...schedule,
      routeId: row.route_id,
      headsign: typeof row.trip_headsign === 'string' && row.trip_headsign.trim() ? row.trip_headsign : null,
      serviceDateMs: date.getTime(),
    })
  }).filter((trip) => trip.departureGameTimeMs >= gameTimeMs && trip.departureGameTimeMs < nextMidnight.getTime())
    .sort((a, b) => a.departureGameTimeMs - b.departureGameTimeMs || a.stopSequence - b.stopSequence)
  return Object.freeze(trips)
}

export async function fetchTripStops(
  tripId: string,
  serviceDateMs: number,
  options: FetchTripsOptions = {},
): Promise<readonly TripStop[]> {
  if (!isNonemptyString(tripId)) {
    throw new TypeError('A trip ID is required to load its stops.')
  }
  const date = serviceDate(serviceDateMs)
  const query = new URLSearchParams({ trip_id: tripId })
  const result = await fetchJson(`/get_trip_stoptimes?${query}`, options)
  if (!Array.isArray(result)) {
    throw new Error('Trip service returned an invalid stop list.')
  }
  const stops = result.map((value): TripStop => {
    const { row, ...schedule } = parseSchedule(value, date)
    if (schedule.tripId !== tripId || !isNonemptyString(row.stop_id)) {
      throw new Error('Trip service returned invalid trip stop details.')
    }
    return Object.freeze({ ...schedule, stopId: row.stop_id })
  }).sort((a, b) => a.stopSequence - b.stopSequence)
  for (let index = 1; index < stops.length; index++) {
    const previous = stops[index - 1]!
    const current = stops[index]!
    if (current.stopSequence === previous.stopSequence) {
      throw new Error('Trip service returned duplicate stop sequences.')
    }
    if (current.arrivalGameTimeMs < previous.departureGameTimeMs) {
      throw new Error('Trip service returned stops out of time order.')
    }
  }
  return Object.freeze(stops)
}
