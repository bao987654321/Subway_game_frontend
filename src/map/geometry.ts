import type { RouteProgress } from '../game-state/journey.ts'

/** GeoJSON coordinate order, shared by route shapes and station markers. */
export type MapCoordinate = readonly [longitude: number, latitude: number]

export interface MapPoint {
  readonly x: number
  readonly y: number
}

export interface MapProjection {
  readonly width: number
  readonly height: number
  readonly padding: number
  project(coordinate: MapCoordinate): MapPoint | null
}

const MAX_MERCATOR_LATITUDE = 85.0511287798066
const RADIANS_PER_DEGREE = Math.PI / 180

function isCoordinate(value: unknown): value is MapCoordinate {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90
}

function toMercator(coordinate: MapCoordinate): MapPoint | null {
  if (!isCoordinate(coordinate)) return null
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(coordinate[1], MAX_MERCATOR_LATITUDE))
  return {
    x: coordinate[0] * RADIANS_PER_DEGREE,
    y: Math.asinh(Math.tan(latitude * RADIANS_PER_DEGREE)),
  }
}

export function getStationCoordinate(station: {
  readonly lat: number | null
  readonly lon: number | null
} | null | undefined): MapCoordinate | null {
  if (!station) return null
  const coordinate = [station.lon, station.lat]
  return isCoordinate(coordinate) ? Object.freeze(coordinate) : null
}

/** Fit all route and station coordinates once; SVG handles responsive scaling. */
export function createMapProjection(
  coordinates: readonly MapCoordinate[],
  width = 640,
  height = 480,
  padding = 32,
): MapProjection | null {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(padding) ||
    padding < 0 || width <= padding * 2 || height <= padding * 2
  ) throw new RangeError('Map dimensions must leave space inside the padding.')

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const coordinate of coordinates) {
    const point = toMercator(coordinate)
    if (!point) continue
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  if (minX === Infinity) return null

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const fitScale = Math.min(
    maxX > minX ? (width - padding * 2) / (maxX - minX) : Infinity,
    maxY > minY ? (height - padding * 2) / (maxY - minY) : Infinity,
  )
  // A single location has no span. Center it without dividing by zero.
  const scale = Number.isFinite(fitScale) ? fitScale : 1

  return Object.freeze({
    width,
    height,
    padding,
    project(coordinate: MapCoordinate): MapPoint | null {
      const point = toMercator(coordinate)
      return point ? Object.freeze({
        x: width / 2 + (point.x - centerX) * scale,
        // SVG's y axis increases downward; north belongs at the top.
        y: height / 2 - (point.y - centerY) * scale,
      }) : null
    },
  })
}

function isPoint(point: MapPoint | null): point is MapPoint {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)
}

/** Estimate travel between stations; merged route shapes are not trip-specific paths. */
export function getEstimatedPosition(
  progress: Pick<RouteProgress, 'phase' | 'segmentProgress'>,
  current: MapPoint | null,
  next: MapPoint | null,
): MapPoint | null {
  if (!isPoint(current)) return null
  if (progress.phase !== 'moving') return current
  if (!isPoint(next) || !Number.isFinite(progress.segmentProgress)) return null

  const fraction = Math.max(0, Math.min(progress.segmentProgress, 1))
  return Object.freeze({
    x: current.x + (next.x - current.x) * fraction,
    y: current.y + (next.y - current.y) * fraction,
  })
}
