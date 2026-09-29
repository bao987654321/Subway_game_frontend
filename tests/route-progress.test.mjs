import assert from 'node:assert/strict'
import test from 'node:test'
import { createJourneyPlan, getRouteProgress } from '../src/game-state/journey.ts'

const start = new Date(2026, 8, 29, 12).getTime()
const trip = {
  tripId: 'route-trip', routeId: 'L', headsign: '8 Av', stopSequence: 2,
  arrivalGameTimeMs: start + 120_000, departureGameTimeMs: start + 120_000,
  serviceDateMs: new Date(2026, 8, 29).getTime(),
}
const stops = ['L08N', 'L06N', 'L05N', 'L03N'].map((stopId, index) => ({
  tripId: trip.tripId, stopId, stopSequence: index + 1,
  arrivalGameTimeMs: start + index * 120_000,
  departureGameTimeMs: start + index * 120_000,
}))
const plan = createJourneyPlan(trip, stops, 'L06', new Set(['L08', 'L06', 'L05', 'L03']))
const progress = Object.freeze({ plan, stopIndex: plan.boardingIndex })

test('journey plans retain route names and optional destination metadata', () => {
  assert.equal(plan.routeId, 'L')
  assert.equal(plan.headsign, '8 Av')
  const withoutHeadsign = createJourneyPlan({ ...trip, headsign: null }, stops, 'L06', new Set(['L08', 'L06', 'L05', 'L03']))
  assert.equal(withoutHeadsign.headsign, null)
})

test('waiting points to the boarding stop and counts down to its arrival', () => {
  const result = getRouteProgress(progress, 'waiting_for_trip', start + 100_000)
  assert.equal(result.phase, 'waiting')
  assert.equal(result.currentStop, plan.stops[1])
  assert.equal(result.nextStop, plan.stops[1])
  assert.equal(result.remainingToNextStopMs, 20_000)
  assert.equal(result.remainingDwellMs, null)
  assert.equal(result.segmentProgress, 0)
  assert.equal(result.completedStops, 1)
  assert.equal(result.totalStops, 4)
})

test('waiting does not make its countdown negative after a delayed render', () => {
  const result = getRouteProgress(progress, 'waiting_for_trip', start + 1_000_000)
  assert.equal(result.remainingToNextStopMs, 0)
  assert.equal(result.phase, 'waiting')
  assert.equal(result.completedStops, 1)
})

test('a stopped train exposes remaining dwell separately from the following stop arrival', () => {
  const result = getRouteProgress(progress, 'on_trip_in_station', start + 130_000)
  assert.equal(result.phase, 'stopped')
  assert.equal(result.currentStop, plan.stops[1])
  assert.equal(result.nextStop, plan.stops[2])
  assert.equal(result.remainingDwellMs, 20_000)
  assert.equal(result.remainingToNextStopMs, 110_000)
  assert.equal(result.segmentProgress, 0)
  assert.equal(result.completedStops, 2)
})

test('moving progress measures the interval from departure to the next arrival', () => {
  const result = getRouteProgress(progress, 'in_transit', start + 195_000)
  assert.equal(result.phase, 'moving')
  assert.equal(result.currentStop, plan.stops[1])
  assert.equal(result.nextStop, plan.stops[2])
  assert.equal(result.remainingToNextStopMs, 45_000)
  assert.equal(result.remainingDwellMs, null)
  assert.equal(result.segmentProgress, 0.5)
  assert.equal(result.completedStops, 2)
  assert.equal(result.totalStops, 4)
})

test('requesting an exit keeps the same route location and arrival countdown', () => {
  assert.deepEqual(
    getRouteProgress(progress, 'in_transit_off_at_next_station', start + 195_000),
    getRouteProgress(progress, 'in_transit', start + 195_000),
  )
})

test('departure and arrival boundaries produce exact zero and full segment progress', () => {
  const departing = getRouteProgress(progress, 'in_transit', start + 150_000)
  assert.equal(departing.segmentProgress, 0)
  assert.equal(departing.remainingToNextStopMs, 90_000)
  const arriving = getRouteProgress(progress, 'in_transit', start + 240_000)
  assert.equal(arriving.segmentProgress, 1)
  assert.equal(arriving.remainingToNextStopMs, 0)
})

test('clock jumps clamp moving progress and every displayed countdown', () => {
  const before = getRouteProgress(progress, 'in_transit', start)
  assert.equal(before.segmentProgress, 0)
  const after = getRouteProgress(progress, 'in_transit', start + 1_000_000)
  assert.equal(after.segmentProgress, 1)
  assert.equal(after.remainingToNextStopMs, 0)
  const stopped = getRouteProgress(progress, 'on_trip_in_station', start + 1_000_000)
  assert.equal(stopped.remainingDwellMs, 0)
  assert.equal(stopped.remainingToNextStopMs, 0)
})

test('the terminal stop has a final dwell countdown with no next arrival', () => {
  const terminal = { plan, stopIndex: 3 }
  const result = getRouteProgress(terminal, 'on_trip_in_station', start + 370_000)
  assert.equal(result.phase, 'finished')
  assert.equal(result.currentStop, plan.stops[3])
  assert.equal(result.nextStop, null)
  assert.equal(result.remainingToNextStopMs, null)
  assert.equal(result.remainingDwellMs, 20_000)
  assert.equal(result.segmentProgress, 0)
  assert.equal(result.completedStops, 4)
  assert.equal(result.totalStops, 4)
})

test('zero-duration movement is finite before, on, and after a shared stop boundary', () => {
  const packedStops = stops.map((stop, index) => ({ ...stop,
    arrivalGameTimeMs: start + index * 10_000,
    departureGameTimeMs: start + index * 10_000,
  }))
  const packedPlan = createJourneyPlan(trip, packedStops, 'L06', new Set(['L08', 'L06', 'L05', 'L03']))
  const packedProgress = { plan: packedPlan, stopIndex: 1 }
  assert.equal(packedPlan.stops[1].departureGameTimeMs, packedPlan.stops[2].arrivalGameTimeMs)
  const boundary = packedPlan.stops[2].arrivalGameTimeMs
  assert.equal(getRouteProgress(packedProgress, 'in_transit', boundary - 1).segmentProgress, 0)
  assert.equal(getRouteProgress(packedProgress, 'in_transit', boundary).segmentProgress, 1)
  assert.equal(getRouteProgress(packedProgress, 'in_transit', boundary + 1).segmentProgress, 1)
})

test('an ended journey has no active arrival or dwell countdown', () => {
  for (const state of ['outside', 'in_station']) {
    const result = getRouteProgress(progress, state, start + 195_000)
    assert.equal(result.phase, 'finished')
    assert.equal(result.nextStop, null)
    assert.equal(result.remainingToNextStopMs, null)
    assert.equal(result.remainingDwellMs, null)
  }
})

test('route display calculations preserve journey state and schedule references', () => {
  const result = getRouteProgress(progress, 'in_transit', start + 195_000)
  assert.equal(progress.stopIndex, 1)
  assert.equal(progress.plan, plan)
  assert.equal(result.currentStop, plan.stops[1])
  assert.equal(result.currentStop.arrivalGameTimeMs, start + 120_000)
  assert.ok(Object.isFrozen(result))
})

test('invalid clocks and out-of-route indexes are rejected', () => {
  for (const time of [NaN, Infinity, -Infinity, '2026-09-29', null, 8.64e15 + 1]) {
    assert.throws(() => getRouteProgress(progress, 'in_transit', time), RangeError)
  }
  for (const stopIndex of [-1, 0, 4, NaN, 1.5]) {
    assert.throws(() => getRouteProgress({ plan, stopIndex }, 'in_transit', start), RangeError)
  }
})
