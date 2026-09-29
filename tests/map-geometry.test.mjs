import assert from 'node:assert/strict'
import test from 'node:test'
import { createJourneyPlan, getRouteProgress } from '../src/game-state/journey.ts'
import { createMapProjection, getEstimatedPosition, getStationCoordinate } from '../src/map/geometry.ts'

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} should equal ${expected}`)
}

test('station coordinates use longitude first and tolerate missing coordinate data', () => {
  assert.deepEqual(getStationCoordinate({ lat: 40.7, lon: -73.9 }), [-73.9, 40.7])
  assert.deepEqual(getStationCoordinate({ lat: 0, lon: 0 }), [0, 0])
  for (const station of [null, undefined, {}, { lat: null, lon: -73.9 }, { lat: 40.7, lon: null },
    { lat: NaN, lon: 0 }, { lat: 0, lon: Infinity }, { lat: 91, lon: 0 }, { lat: 0, lon: -181 }]) {
    assert.equal(getStationCoordinate(station), null)
  }
})

test('projection keeps north up and east to the right using GeoJSON axis order', () => {
  const southWest = [-74, 40.6]
  const northEast = [-73.8, 40.8]
  const projection = createMapProjection([southWest, northEast])
  const lowerLeft = projection.project(southWest)
  const upperRight = projection.project(northEast)
  assert.ok(lowerLeft.x < upperRight.x)
  assert.ok(lowerLeft.y > upperRight.y)
  assert.equal(projection.width, 640)
  assert.equal(projection.height, 480)
  assert.equal(projection.padding, 32)
})

test('projection preserves Mercator aspect ratio and centers the fitted extent', () => {
  const coordinates = [[-74, 40.6], [-73.8, 40.8]]
  const projection = createMapProjection(coordinates)
  const first = projection.project(coordinates[0])
  const last = projection.project(coordinates[1])
  const radians = Math.PI / 180
  const geographicWidth = (coordinates[1][0] - coordinates[0][0]) * radians
  const geographicHeight = Math.asinh(Math.tan(coordinates[1][1] * radians)) -
    Math.asinh(Math.tan(coordinates[0][1] * radians))
  close((last.x - first.x) / (first.y - last.y), geographicWidth / geographicHeight)
  close((first.x + last.x) / 2, 320)
  close((first.y + last.y) / 2, 240)
  close(last.y, 32)
  close(first.y, 448)
})

test('bounds include every trip station even when it lies outside the route shape', () => {
  const route = [[-74, 40.7], [-73.95, 40.75]]
  const stations = [[-74.2, 40.6], [-73.8, 40.9]]
  const projection = createMapProjection([...route, ...stations])
  for (const coordinate of [...route, ...stations]) {
    const point = projection.project(coordinate)
    assert.ok(point.x >= 32 - 1e-8 && point.x <= 608 + 1e-8)
    assert.ok(point.y >= 32 - 1e-8 && point.y <= 448 + 1e-8)
  }
})

test('a single point is centered and horizontal or vertical routes remain finite', () => {
  const point = [-74, 40.7]
  assert.deepEqual(createMapProjection([point, point]).project(point), { x: 320, y: 240 })

  const horizontal = [[-74, 40.7], [-73.8, 40.7]]
  const horizontalProjection = createMapProjection(horizontal)
  close(horizontalProjection.project(horizontal[0]).x, 32)
  close(horizontalProjection.project(horizontal[1]).x, 608)
  close(horizontalProjection.project(horizontal[0]).y, 240)

  const vertical = [[-74, 40.6], [-74, 40.8]]
  const verticalProjection = createMapProjection(vertical)
  close(verticalProjection.project(vertical[0]).x, 320)
  close(verticalProjection.project(vertical[0]).y, 448)
  close(verticalProjection.project(vertical[1]).y, 32)
})

test('invalid coordinates are excluded and an empty map has no projection', () => {
  const invalid = [[NaN, 40.7], [-74, Infinity], [181, 0], [0, -91], [], [0, 0, 0]]
  assert.equal(createMapProjection([]), null)
  assert.equal(createMapProjection(invalid), null)
  const projection = createMapProjection([...invalid, [-74, 40.7]])
  assert.deepEqual(projection.project([-74, 40.7]), { x: 320, y: 240 })
  for (const coordinate of invalid) assert.equal(projection.project(coordinate), null)
})

test('Mercator pole limits and custom dimensions produce finite positions', () => {
  const coordinates = [[-180, -90], [180, 90]]
  const projection = createMapProjection(coordinates, 300, 200, 10)
  for (const coordinate of coordinates) {
    const point = projection.project(coordinate)
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
    assert.ok(point.x >= 10 && point.x <= 290)
    assert.ok(point.y >= 10 && point.y <= 190)
  }
  assert.equal(projection.width, 300)
  assert.equal(projection.height, 200)
  assert.equal(projection.padding, 10)
})

test('invalid viewport dimensions fail without returning unusable geometry', () => {
  for (const [width, height, padding] of [
    [0, 480, 0], [640, -1, 0], [Infinity, 480, 32], [640, NaN, 32],
    [640, 480, -1], [640, 480, Infinity], [640, 480, 240],
  ]) assert.throws(() => createMapProjection([[0, 0]], width, height, padding), RangeError)
})

const current = Object.freeze({ x: 20, y: 80 })
const next = Object.freeze({ x: 100, y: 40 })

test('waiting, dwelling, and terminal markers remain at the current station', () => {
  for (const phase of ['waiting', 'stopped', 'finished']) {
    assert.deepEqual(getEstimatedPosition({ phase, segmentProgress: 0.75 }, current, next), current)
    assert.deepEqual(getEstimatedPosition({ phase, segmentProgress: 0 }, current, null), current)
  }
})

test('moving markers interpolate linearly and clamp delayed renders to the segment', () => {
  assert.deepEqual(getEstimatedPosition({ phase: 'moving', segmentProgress: 0 }, current, next), current)
  assert.deepEqual(getEstimatedPosition({ phase: 'moving', segmentProgress: 0.5 }, current, next), { x: 60, y: 60 })
  assert.deepEqual(getEstimatedPosition({ phase: 'moving', segmentProgress: 1 }, current, next), next)
  assert.deepEqual(getEstimatedPosition({ phase: 'moving', segmentProgress: -2 }, current, next), current)
  assert.deepEqual(getEstimatedPosition({ phase: 'moving', segmentProgress: 4 }, current, next), next)
})

test('missing required station coordinates hide the player marker', () => {
  for (const phase of ['waiting', 'stopped', 'moving', 'finished']) {
    assert.equal(getEstimatedPosition({ phase, segmentProgress: 0.5 }, null, next), null)
    assert.equal(getEstimatedPosition({ phase, segmentProgress: 0.5 }, { x: NaN, y: 0 }, next), null)
  }
  assert.equal(getEstimatedPosition({ phase: 'moving', segmentProgress: 0.5 }, current, null), null)
  assert.equal(getEstimatedPosition({ phase: 'moving', segmentProgress: NaN }, current, next), null)
})

test('estimated position follows the shared journey clock through a 200x jump', () => {
  const start = new Date(2026, 8, 29, 12).getTime()
  const trip = {
    tripId: 'map-trip', routeId: 'L', headsign: '8 Av', directionId: 0, stopSequence: 1,
    arrivalGameTimeMs: start, departureGameTimeMs: start,
    serviceDateMs: new Date(2026, 8, 29).getTime(),
  }
  const stops = ['L08N', 'L06N'].map((stopId, index) => ({
    tripId: trip.tripId, stopId, stopSequence: index + 1,
    arrivalGameTimeMs: start + index * 430_000,
    departureGameTimeMs: start + index * 430_000,
  }))
  const plan = createJourneyPlan(trip, stops, 'L08', new Set(['L08', 'L06']))
  const journey = { plan, stopIndex: 0 }
  const departure = plan.stops[0].departureGameTimeMs
  assert.deepEqual(getEstimatedPosition(getRouteProgress(journey, 'waiting_for_trip', start - 1000), current, next), current)
  assert.deepEqual(getEstimatedPosition(getRouteProgress(journey, 'on_trip_in_station', start + 1000), current, next), current)
  // One wall-clock second at 200x advances halfway through this 400-second segment.
  const moving = getRouteProgress(journey, 'in_transit', departure + 1000 * 200)
  assert.deepEqual(getEstimatedPosition(moving, current, next), { x: 60, y: 60 })
  const overshoot = getRouteProgress(journey, 'in_transit_off_at_next_station', departure + 5000 * 200)
  assert.deepEqual(getEstimatedPosition(overshoot, current, next), next)
  const terminal = getRouteProgress({ plan, stopIndex: 1 }, 'on_trip_in_station', start + 440_000)
  assert.equal(terminal.phase, 'finished')
  assert.deepEqual(getEstimatedPosition(terminal, next, null), next)
})
