const DEFAULT_BASE_URL = 'https://subway-game-backend.rcdis.co'

export interface FetchAllStationsOptions {
  baseUrl?: string
  signal?: AbortSignal
}

export interface StationSummary {
  readonly id: string
  readonly name: string
  readonly onLines: readonly string[]
}

const MAX_CONCURRENT_REQUESTS = 6

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseStation(value: unknown): StationSummary {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Station service returned invalid station details.')
  }

  const station = value as Record<string, unknown>
  if (
    !isNonemptyString(station.id) ||
    !isNonemptyString(station.name) ||
    !Array.isArray(station.on_lines) ||
    !station.on_lines.every(isNonemptyString)
  ) {
    throw new Error('Station service returned invalid station details.')
  }

  return Object.freeze({
    id: station.id,
    name: station.name,
    onLines: Object.freeze([...new Set(station.on_lines as string[])]),
  })
}

async function fetchJson(path: string, { baseUrl = DEFAULT_BASE_URL, signal }: FetchAllStationsOptions) {
  signal?.throwIfAborted()
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) {
    throw new Error(`Unable to load station details (HTTP ${response.status}).`)
  }
  const result: unknown = await response.json()
  signal?.throwIfAborted()
  return result
}

function rethrowCancellation(error: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
    throw error
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  visit: (value: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  let failed = false

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, values.length) }, async () => {
      while (!failed && nextIndex < values.length) {
        signal?.throwIfAborted()
        const index = nextIndex++
        try {
          results[index] = await visit(values[index]!)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }),
  )

  return results
}

export async function fetchAllStations({
  baseUrl = DEFAULT_BASE_URL,
  signal,
}: FetchAllStationsOptions = {}): Promise<readonly string[]> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/all_stations`, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Unable to load stations (HTTP ${response.status}).`)
  }

  const stations: unknown = await response.json()
  if (
    !Array.isArray(stations) ||
    !stations.every((station) => typeof station === 'string' && station.trim().length > 0)
  ) {
    throw new Error('Station service returned an invalid station list.')
  }

  // The API orders IDs by station name. Keep that order for the starting choices.
  return Object.freeze([...new Set(stations as string[])])
}

export async function fetchStartingStations(
  options: FetchAllStationsOptions = {},
): Promise<readonly StationSummary[]> {
  options.signal?.throwIfAborted()
  const stationIds = await fetchAllStations(options)
  options.signal?.throwIfAborted()
  if (stationIds.length === 0) return Object.freeze([])

  // Route responses provide names in batches. Individual lookups cover stations
  // absent from those responses, including when route endpoints are unavailable.
  let routeIds: string[] = []
  try {
    const routes = await fetchJson('/all_routes', options)
    if (!Array.isArray(routes) || !routes.every(isNonemptyString)) {
      throw new Error('Station service returned an invalid route list.')
    }
    routeIds = [...new Set(routes as string[])]
  } catch (error) {
    rethrowCancellation(error, options.signal)
  }

  const routeStations = await mapWithConcurrency(routeIds, async (routeId) => {
    try {
      const stations = await fetchJson(
        `/get_route_stations?${new URLSearchParams({ route_id: routeId })}`,
        options,
      )
      if (!Array.isArray(stations)) {
        throw new Error('Station service returned invalid route station details.')
      }
      return stations.map(parseStation)
    } catch (error) {
      rethrowCancellation(error, options.signal)
      return []
    }
  }, options.signal)

  const byId = new Map<string, StationSummary>()
  for (const stations of routeStations) {
    for (const station of stations) {
      if (!byId.has(station.id)) byId.set(station.id, station)
    }
  }

  const missingIds = stationIds.filter((id) => !byId.has(id))
  const missingStations = await mapWithConcurrency(missingIds, async (stationId) => {
    const station = parseStation(await fetchJson(
      `/get_station?${new URLSearchParams({ station_id: stationId })}`,
      options,
    ))
    if (station.id !== stationId) {
      throw new Error('Station service returned details for a different station.')
    }
    return station
  }, options.signal)
  for (const station of missingStations) byId.set(station.id, station)

  options.signal?.throwIfAborted()
  // IDs, not display names, identify choices: different stations can share a name.
  return Object.freeze(stationIds.map((id) => byId.get(id)!))
}
