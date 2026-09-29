const DEFAULT_BASE_URL = 'https://subway-game-backend.rcdis.co'

export type RouteCoordinate = readonly [longitude: number, latitude: number]

export interface RouteShape {
  readonly routeId: string
  readonly directionId: 0 | 1 | null
  readonly coordinates: readonly RouteCoordinate[]
  readonly numPoints: number
}

export interface FetchRouteShapeOptions {
  baseUrl?: string
  signal?: AbortSignal
}

function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) &&
    value[0] >= -180 && value[0] <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) &&
    value[1] >= -90 && value[1] <= 90
}

export async function fetchRouteShape(
  routeId: string,
  directionId: 0 | 1 | null,
  { baseUrl = DEFAULT_BASE_URL, signal }: FetchRouteShapeOptions = {},
): Promise<RouteShape> {
  if (typeof routeId !== 'string' || !routeId.trim()) {
    throw new TypeError('A route ID is required to load its shape.')
  }
  signal?.throwIfAborted()
  const direction = directionId === 0 || directionId === 1 ? directionId : null
  const query = new URLSearchParams({ route_id: routeId, simplify: 'true' })
  if (direction !== null) query.set('direction_id', String(direction))

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/get_route_shape?${query}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) {
    throw new Error(`Unable to load route shape (HTTP ${response.status}).`)
  }
  const result: unknown = await response.json()
  signal?.throwIfAborted()
  if (typeof result !== 'object' || result === null) {
    throw new Error('Route service returned an invalid route shape.')
  }
  const shape = result as Record<string, unknown>
  const responseDirection = shape.direction_id === undefined ? null : shape.direction_id
  if (shape.route_id !== routeId || responseDirection !== direction) {
    throw new Error('Route service returned a shape for a different route or direction.')
  }
  if (!Array.isArray(shape.coordinates) || shape.coordinates.length < 2 ||
      !shape.coordinates.every(isCoordinate)) {
    throw new Error('Route service returned invalid route coordinates.')
  }
  const coordinates = Object.freeze(shape.coordinates.map((coordinate) =>
    Object.freeze([...coordinate]) as RouteCoordinate,
  ))
  return Object.freeze({
    routeId,
    directionId: direction,
    coordinates,
    // Geometry is authoritative even if the optional count is absent or stale.
    numPoints: coordinates.length,
  })
}
