import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceJourney, createJourneyPlan } from '../src/game-state/journey.ts'
import { createGameStateMachine } from '../src/game-state/state-machine.ts'

const start = new Date(2026, 8, 29, 12).getTime()
const stationIds = new Set(['L06', 'L05', 'L03'])
const trip = {
  tripId: 'L-trip', routeId: 'L', headsign: '8 Av', stopSequence: 1,
  arrivalGameTimeMs: start, departureGameTimeMs: start + 30_000,
  serviceDateMs: new Date(2026, 8, 29).getTime(),
}
const stops = [
  { tripId: 'L-trip', stopId: 'L06N', stopSequence: 1, arrivalGameTimeMs: start, departureGameTimeMs: start },
  { tripId: 'L-trip', stopId: 'L05N', stopSequence: 2, arrivalGameTimeMs: start + 120_000, departureGameTimeMs: start + 120_000 },
  { tripId: 'L-trip', stopId: 'L03N', stopSequence: 3, arrivalGameTimeMs: start + 240_000, departureGameTimeMs: start + 240_000 },
]

function waitingJourney() {
  const plan = createJourneyPlan(trip, stops, 'L06', stationIds)
  const machine = createGameStateMachine('L06')
  machine.send('ENTER_STATION')
  machine.send({ type: 'WAIT_FOR_TRIP', tripId: trip.tripId })
  return { machine, progress: { plan, stopIndex: plan.boardingIndex } }
}

test('copies a schedule and maps platform stops only through known parent stations', () => {
  const plan = createJourneyPlan(trip, [...stops].reverse(), 'L06', stationIds)
  assert.equal(plan.boardingIndex, 0)
  assert.deepEqual(plan.stops.map((stop) => stop.stationId), ['L06', 'L05', 'L03'])
  assert.deepEqual(plan.stops.map((stop) => stop.stopId), ['L06N', 'L05N', 'L03N'])
  assert.equal(plan.stops[0].departureGameTimeMs, start + 30_000)
  assert.equal(stops[0].departureGameTimeMs, start, 'input data is unchanged')
  assert.notEqual(plan.stops[0], stops[0])
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.stops) && Object.isFrozen(plan.stops[0]))
})

test('preserves trip direction for the map without inferring missing directions', () => {
  for (const directionId of [0, 1, null, undefined, '0', 2]) {
    const plan = createJourneyPlan({ ...trip, directionId }, stops, 'L06', stationIds)
    assert.equal(plan.directionId, directionId === 0 || directionId === 1 ? directionId : null)
  }
})

test('uses exact catalog IDs before considering N/S suffixes', () => {
  const known = new Set(['L06N', 'L05N', 'L03N'])
  const plan = createJourneyPlan(trip, stops, 'L06N', known)
  assert.deepEqual(plan.stops.map((stop) => stop.stationId), ['L06N', 'L05N', 'L03N'])
  const south = stops.map((stop) => ({ ...stop, stopId: stop.stopId.replace(/N$/, 'S') }))
  assert.equal(createJourneyPlan(trip, south, 'L06', stationIds).stops[0].stationId, 'L06')
})

test('rejects unknown parents and unsupported platform suffixes instead of inventing station IDs', () => {
  assert.throws(() => createJourneyPlan(trip, stops, 'L06', new Set(['L06', 'L05'])), /L03N/)
  assert.throws(() => createJourneyPlan(trip, [{ ...stops[0], stopId: 'L06X' }], 'L06', stationIds), /L06X/)
  assert.throws(() => createJourneyPlan(trip, stops, 'L06N', stationIds), /valid trip/)
})

test('finds the boarding stop by sequence even when a trip visits the same station twice', () => {
  const loopingStops = [...stops, { ...stops[0], stopSequence: 4, arrivalGameTimeMs: start + 360_000, departureGameTimeMs: start + 360_000 }]
  const plan = createJourneyPlan({ ...trip, stopSequence: 4 }, loopingStops, 'L06', stationIds)
  assert.equal(plan.boardingIndex, 3)
  assert.throws(() => createJourneyPlan({ ...trip, stopSequence: 4 }, loopingStops, 'L05', stationIds), /does not stop/)
  assert.throws(() => createJourneyPlan({ ...trip, stopSequence: 5 }, loopingStops, 'L06', stationIds), /does not stop/)
})

test('normalizes each dwell to 30 seconds and delays overlapping arrivals', () => {
  const packed = stops.map((stop, index) => ({
    ...stop, arrivalGameTimeMs: start + index * 10_000,
    departureGameTimeMs: start + index * 10_000 + 5_000,
  }))
  const plan = createJourneyPlan(trip, packed, 'L06', stationIds)
  assert.deepEqual(plan.stops.map((stop) => stop.arrivalGameTimeMs - start), [0, 30_000, 60_000])
  assert.deepEqual(plan.stops.map((stop) => stop.departureGameTimeMs - start), [30_000, 60_000, 90_000])
})

test('keeps absolute next-day service timestamps intact', () => {
  const offset = 24 * 60 * 60 * 1000
  const tomorrowStops = stops.map((stop) => ({ ...stop,
    arrivalGameTimeMs: stop.arrivalGameTimeMs + offset,
    departureGameTimeMs: stop.departureGameTimeMs + offset,
  }))
  const plan = createJourneyPlan({ ...trip,
    arrivalGameTimeMs: trip.arrivalGameTimeMs + offset,
    departureGameTimeMs: trip.departureGameTimeMs + offset,
  }, tomorrowStops, 'L06', stationIds)
  assert.equal(plan.stops[2].arrivalGameTimeMs, start + offset + 240_000)
})

test('rejects malformed or mismatched schedules before a journey starts', () => {
  for (const malformed of [
    [],
    [{ ...stops[0], tripId: 'other-trip' }],
    [{ ...stops[0], arrivalGameTimeMs: NaN }],
    [{ ...stops[0], departureGameTimeMs: start - 1 }],
    [{ ...stops[0], stopSequence: -1 }],
    [stops[0], { ...stops[1], stopSequence: 1 }],
    [stops[0], { ...stops[1], arrivalGameTimeMs: start - 1 }],
  ]) {
    assert.throws(() => createJourneyPlan(trip, malformed, 'L06', stationIds))
  }
})

test('waits, boards, departs, arrives, and gets off at the terminus using game time', () => {
  const { machine, progress } = waitingJourney()
  assert.equal(advanceJourney(machine, progress, start - 1), progress)
  assert.equal(machine.getSnapshot().state, 'waiting_for_trip')
  assert.equal(advanceJourney(machine, progress, start), progress)
  assert.deepEqual(machine.getSnapshot(), { state: 'on_trip_in_station', tripId: 'L-trip', stopArrivalGameTimeMs: start })
  assert.equal(advanceJourney(machine, progress, start + 29_999), progress)
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
  assert.equal(advanceJourney(machine, progress, start + 30_000), progress)
  assert.equal(machine.getSnapshot().state, 'in_transit')
  assert.equal(advanceJourney(machine, progress, start + 119_999), progress)
  const second = advanceJourney(machine, progress, start + 120_000)
  assert.equal(second.stopIndex, 1)
  assert.equal(second.plan, progress.plan)
  assert.equal(machine.getSnapshot().stopArrivalGameTimeMs, start + 120_000)
  assert.equal(advanceJourney(machine, second, start + 150_000), second)
  assert.equal(machine.getSnapshot().state, 'in_transit')
  const third = advanceJourney(machine, second, start + 240_000)
  assert.equal(third.stopIndex, 2)
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
  assert.equal(advanceJourney(machine, third, start + 269_999), third)
  assert.equal(advanceJourney(machine, third, start + 270_000), null)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: 'L03', nextTrips: [] })
})

test('a requested exit enters the next parent station and ends the journey', () => {
  const { machine, progress } = waitingJourney()
  advanceJourney(machine, progress, start + 30_000)
  assert.equal(machine.send({ type: 'REQUEST_EXIT', nextStopId: 'L05N' }), true)
  assert.equal(advanceJourney(machine, progress, start + 119_999), progress)
  assert.equal(machine.getSnapshot().state, 'in_transit_off_at_next_station')
  assert.equal(advanceJourney(machine, progress, start + 120_000), null)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: 'L05', nextTrips: [] })
})

test('cancelling an exit remains on the trip when the next station arrives', () => {
  const { machine, progress } = waitingJourney()
  advanceJourney(machine, progress, start + 30_000)
  machine.send({ type: 'REQUEST_EXIT', nextStopId: 'L05N' })
  machine.send('CANCEL_EXIT')
  const next = advanceJourney(machine, progress, start + 120_000)
  assert.equal(next.stopIndex, 1)
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
})

test('manual get-off clears journey tracking without boarding again', () => {
  const { machine, progress } = waitingJourney()
  advanceJourney(machine, progress, start)
  machine.send({ type: 'GET_OFF_TRIP', stationId: 'L06' })
  const snapshot = machine.getSnapshot()
  assert.equal(advanceJourney(machine, progress, start + 1_000_000), null)
  assert.equal(machine.getSnapshot(), snapshot)
})

test('game over ends journey tracking without processing any scheduled events', () => {
  for (const elapsed of [-1, 0, 30_000, 120_000]) {
    const { machine, progress } = waitingJourney()
    const current = advanceJourney(machine, progress, start + elapsed)
    assert.ok(current)
    assert.equal(machine.send('GAME_OVER'), true)
    const ended = machine.getSnapshot()
    let eventCount = 0
    const trackingMachine = {
      getSnapshot: machine.getSnapshot,
      send(event) {
        eventCount += 1
        return machine.send(event)
      },
    }
    assert.equal(advanceJourney(trackingMachine, current, start + 1_000_000), null)
    assert.equal(eventCount, 0)
    assert.equal(machine.getSnapshot(), ended)
    assert.deepEqual(ended, { state: 'game_over' })
  }
})

test('cancelling a wait or leaving the station ends journey tracking', () => {
  const { machine, progress } = waitingJourney()
  machine.send('CANCEL_WAIT')
  assert.equal(advanceJourney(machine, progress, start), null)
  machine.send('LEAVE_STATION')
  assert.equal(advanceJourney(machine, progress, start), null)
  assert.equal(machine.getSnapshot().state, 'outside')
})

test('large clock jumps process every elapsed event without losing arrival indexes', () => {
  const { machine, progress } = waitingJourney()
  const next = advanceJourney(machine, progress, start + 245_000)
  assert.equal(next.stopIndex, 2)
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
  assert.equal(machine.getSnapshot().stopArrivalGameTimeMs, start + 240_000)
  assert.equal(advanceJourney(machine, next, start + 270_000), null)
  assert.equal(machine.getSnapshot().stationId, 'L03')
})

test('a single clock jump can complete a trip and still honors a requested intermediate exit', () => {
  const complete = waitingJourney()
  assert.equal(advanceJourney(complete.machine, complete.progress, start + 1_000_000), null)
  assert.equal(complete.machine.getSnapshot().stationId, 'L03')
  const exiting = waitingJourney()
  advanceJourney(exiting.machine, exiting.progress, start + 30_000)
  exiting.machine.send({ type: 'REQUEST_EXIT', nextStopId: 'L05N' })
  assert.equal(advanceJourney(exiting.machine, exiting.progress, start + 1_000_000), null)
  assert.equal(exiting.machine.getSnapshot().stationId, 'L05')
})

test('boarding after the scheduled arrival retains the original dwell deadline', () => {
  const { machine, progress } = waitingJourney()
  advanceJourney(machine, progress, start + 25_000)
  assert.equal(machine.getSnapshot().stopArrivalGameTimeMs, start)
  advanceJourney(machine, progress, start + 30_000)
  assert.equal(machine.getSnapshot().state, 'in_transit')
})

test('one-stop journeys get off after the terminal dwell', () => {
  const { machine } = waitingJourney()
  const plan = createJourneyPlan(trip, [stops[0]], 'L06', stationIds)
  const progress = { plan, stopIndex: 0 }
  advanceJourney(machine, progress, start)
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
  assert.equal(advanceJourney(machine, progress, start + 30_000), null)
  assert.equal(machine.getSnapshot().stationId, 'L06')
})

test('stale journey plans do not advance a different selected trip', () => {
  const { machine, progress } = waitingJourney()
  machine.send('CANCEL_WAIT')
  machine.send({ type: 'WAIT_FOR_TRIP', tripId: 'different-trip' })
  const before = machine.getSnapshot()
  assert.equal(advanceJourney(machine, progress, start + 1_000_000), null)
  assert.equal(machine.getSnapshot(), before)
})

test('mismatched stop state and exit targets cannot silently move the player', () => {
  const { machine, progress } = waitingJourney()
  machine.send({ type: 'BOARD_TRIP', stopArrivalGameTimeMs: start + 1 })
  const stopped = machine.getSnapshot()
  assert.equal(advanceJourney(machine, progress, start + 1_000_000), null)
  assert.equal(machine.getSnapshot(), stopped)

  const exiting = waitingJourney()
  advanceJourney(exiting.machine, exiting.progress, start + 30_000)
  exiting.machine.send({ type: 'REQUEST_EXIT', nextStopId: 'L03N' })
  const transit = exiting.machine.getSnapshot()
  assert.equal(advanceJourney(exiting.machine, exiting.progress, start + 1_000_000), null)
  assert.equal(exiting.machine.getSnapshot(), transit)
})

test('rejected FSM events preserve the journey position for a later attempt', () => {
  const { machine, progress } = waitingJourney()
  const rejecting = { getSnapshot: machine.getSnapshot, send: () => false }
  assert.equal(advanceJourney(rejecting, progress, start + 1_000_000), progress)
  assert.equal(machine.getSnapshot().state, 'waiting_for_trip')
  advanceJourney(machine, progress, start + 30_000)
  assert.equal(advanceJourney(rejecting, progress, start + 1_000_000), progress)
  assert.equal(machine.getSnapshot().state, 'in_transit')
})

test('invalid progress and timestamps leave the state unchanged', () => {
  const { machine, progress } = waitingJourney()
  const before = machine.getSnapshot()
  for (const stopIndex of [-1, 3, NaN, 0.5]) {
    assert.equal(advanceJourney(machine, { ...progress, stopIndex }, start), null)
  }
  for (const time of [NaN, Infinity, 'invalid']) {
    assert.throws(() => advanceJourney(machine, progress, time), RangeError)
  }
  assert.equal(machine.getSnapshot(), before)
})
