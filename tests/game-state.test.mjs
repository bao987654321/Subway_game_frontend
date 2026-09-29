import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGameStateMachine,
  GAME_STATE_LABELS,
  getGameStateInfo,
} from '../src/game-state/state-machine.ts'

// Independent fixtures from the agreed FSM, not the implementation's table.
const expectedTransitions = {
  outside: { ENTER_STATION: 'in_station' },
  in_station: { LEAVE_STATION: 'outside', WAIT_FOR_TRIP: 'waiting_for_trip' },
  waiting_for_trip: { CANCEL_WAIT: 'in_station', BOARD_TRIP: 'on_trip_in_station' },
  on_trip_in_station: { GET_OFF_TRIP: 'in_station', DEPART_STATION: 'in_transit' },
  in_transit: {
    ARRIVE_AT_STATION: 'on_trip_in_station', REQUEST_EXIT: 'in_transit_off_at_next_station',
  },
  in_transit_off_at_next_station: { CANCEL_EXIT: 'in_transit', ARRIVE_AT_STATION: 'in_station' },
}

const now = new Date(2026, 8, 29, 12, 0, 0).getTime()
const nextTrips = [
  { tripId: 'trip-1', departureGameTimeMs: now + 60_000 },
  { tripId: 'trip-2', departureGameTimeMs: now + 120_000 },
]
const eventFixtures = {
  ENTER_STATION: { type: 'ENTER_STATION', nextTrips },
  LEAVE_STATION: 'LEAVE_STATION',
  WAIT_FOR_TRIP: { type: 'WAIT_FOR_TRIP', tripId: 'trip-1' },
  CANCEL_WAIT: 'CANCEL_WAIT',
  BOARD_TRIP: { type: 'BOARD_TRIP', stopArrivalGameTimeMs: now },
  GET_OFF_TRIP: { type: 'GET_OFF_TRIP', stationId: '101' },
  DEPART_STATION: 'DEPART_STATION',
  ARRIVE_AT_STATION: {
    type: 'ARRIVE_AT_STATION', stationId: '104', stopArrivalGameTimeMs: now + 120_000,
  },
  REQUEST_EXIT: { type: 'REQUEST_EXIT', nextStopId: '104S' },
  CANCEL_EXIT: 'CANCEL_EXIT',
}

const routesToState = {
  outside: [],
  in_station: ['ENTER_STATION'],
  waiting_for_trip: ['ENTER_STATION', 'WAIT_FOR_TRIP'],
  on_trip_in_station: ['ENTER_STATION', 'WAIT_FOR_TRIP', 'BOARD_TRIP'],
  in_transit: ['ENTER_STATION', 'WAIT_FOR_TRIP', 'BOARD_TRIP', 'DEPART_STATION'],
  in_transit_off_at_next_station: [
    'ENTER_STATION', 'WAIT_FOR_TRIP', 'BOARD_TRIP', 'DEPART_STATION', 'REQUEST_EXIT',
  ],
}

function createMachineAt(state) {
  const machine = createGameStateMachine('101')
  for (const name of routesToState[state]) {
    assert.equal(machine.send(eventFixtures[name]), true, `setup event ${name}`)
  }
  assert.equal(machine.getSnapshot().state, state)
  return machine
}

function assertRejected(machine, event) {
  const before = machine.getSnapshot()
  assert.equal(machine.send(event), false, JSON.stringify(event))
  assert.equal(machine.getSnapshot(), before, 'rejection preserves the snapshot')
}

test('starts outside with an optional station and the agreed labels', () => {
  assert.deepEqual(createGameStateMachine().getSnapshot(), { state: 'outside', stationId: null })
  assert.deepEqual(createGameStateMachine('101').getSnapshot(), { state: 'outside', stationId: '101' })
  assert.deepEqual(GAME_STATE_LABELS, {
    outside: 'Outside',
    in_station: 'In Station',
    waiting_for_trip: 'In Station (Waiting For Trip)',
    on_trip_in_station: 'On Trip In Station',
    in_transit: 'In Transit',
    in_transit_off_at_next_station: 'In Transit (Off At Next Station)',
  })
  for (const invalid of ['', '   ', 101]) {
    assert.throws(() => createGameStateMachine(invalid), TypeError)
  }
})

test('choosing a starting station stays outside and is available to the next event', () => {
  const machine = createGameStateMachine()
  const initial = machine.getSnapshot()

  assert.equal(machine.selectStartingStation('101'), true)
  const selected = machine.getSnapshot()
  assert.deepEqual(selected, { state: 'outside', stationId: '101' })
  assert.notEqual(selected, initial)
  assert.equal(Object.isFrozen(selected), true)
  assert.deepEqual(initial, { state: 'outside', stationId: null })

  assert.equal(machine.send('ENTER_STATION'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: '101', nextTrips: [] })
})

test('invalid starting stations preserve the unassigned state and allow retry', () => {
  const machine = createGameStateMachine()
  const initial = machine.getSnapshot()

  for (const stationId of ['', '   ', '\n\t', null, undefined, 101, {}]) {
    assert.equal(machine.selectStartingStation(stationId), false)
    assert.equal(machine.getSnapshot(), initial)
  }

  assert.equal(machine.selectStartingStation('201'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'outside', stationId: '201' })
})

test('starting station selection cannot replace a station or change an active journey', () => {
  const selected = createGameStateMachine()
  assert.equal(selected.selectStartingStation('101'), true)
  const initialSelection = selected.getSnapshot()
  assert.equal(selected.selectStartingStation('101'), false)
  assert.equal(selected.selectStartingStation('201'), false)
  assert.equal(selected.getSnapshot(), initialSelection)

  for (const state of Object.keys(expectedTransitions)) {
    const machine = createMachineAt(state)
    const before = machine.getSnapshot()
    assert.equal(machine.selectStartingStation('201'), false, state)
    assert.equal(machine.getSnapshot(), before)
  }

  assert.equal(selected.send('ENTER_STATION'), true)
  assert.equal(selected.send('LEAVE_STATION'), true)
  const returnedOutside = selected.getSnapshot()
  assert.equal(selected.selectStartingStation('201'), false)
  assert.equal(selected.getSnapshot(), returnedOutside)
})

// Covers all 60 combinations: 11 accepted transitions and 49 rejections.
for (const [state, transitions] of Object.entries(expectedTransitions)) {
  for (const [name, event] of Object.entries(eventFixtures)) {
    const nextState = transitions[name]
    test(`${state} + ${name}: ${nextState ?? 'rejected'}`, () => {
      const machine = createMachineAt(state)
      const before = machine.getSnapshot()
      const beforeValue = structuredClone(before)
      assert.equal(machine.send(event), nextState !== undefined)
      assert.equal(machine.getSnapshot().state, nextState ?? state)
      assert.deepEqual(before, beforeValue)
      if (nextState === undefined) assert.equal(machine.getSnapshot(), before)
      else assert.notEqual(machine.getSnapshot(), before)
    })
  }
}

test('entering requires a station and can select one when none is initialized', () => {
  const machine = createGameStateMachine()
  assertRejected(machine, 'ENTER_STATION')
  assertRejected(machine, { type: 'ENTER_STATION' })
  assert.equal(machine.send({ type: 'ENTER_STATION', stationId: '201' }), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: '201', nextTrips: [] })
  assert.equal(machine.send('LEAVE_STATION'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'outside', stationId: '201' })
  assert.equal(machine.send('ENTER_STATION'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: '201', nextTrips: [] })
})

test('consecutive journey events propagate only the fields belonging to each state', () => {
  const machine = createMachineAt('in_station')
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: '101', nextTrips })
  assert.equal(machine.send(eventFixtures.WAIT_FOR_TRIP), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'waiting_for_trip', stationId: '101', tripId: 'trip-1' })
  assert.equal(machine.send(eventFixtures.BOARD_TRIP), true)
  assert.deepEqual(machine.getSnapshot(), {
    state: 'on_trip_in_station', tripId: 'trip-1', stopArrivalGameTimeMs: now,
  })
  assert.equal(machine.send('DEPART_STATION'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_transit', tripId: 'trip-1' })
  assert.equal(machine.send(eventFixtures.REQUEST_EXIT), true)
  assert.deepEqual(machine.getSnapshot(), {
    state: 'in_transit_off_at_next_station', tripId: 'trip-1', nextStopId: '104S',
  })
  // Use the caller's parent station; never guess it by stripping a stop suffix.
  assert.equal(machine.send({ ...eventFixtures.ARRIVE_AT_STATION, stationId: 'station-complex', nextTrips }), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: 'station-complex', nextTrips })
  assert.equal(machine.send('LEAVE_STATION'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'outside', stationId: 'station-complex' })
})

test('getting off a stopped trip uses its supplied station and permits another trip', () => {
  const machine = createMachineAt('on_trip_in_station')
  assert.equal(machine.send({ type: 'GET_OFF_TRIP', stationId: 'new-station', nextTrips }), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: 'new-station', nextTrips })
  assert.equal(machine.send({ type: 'WAIT_FOR_TRIP', tripId: 'trip-2' }), true)
  assert.equal(machine.send({ type: 'BOARD_TRIP', stopArrivalGameTimeMs: now + 90_000 }), true)
  assert.deepEqual(machine.getSnapshot(), {
    state: 'on_trip_in_station', tripId: 'trip-2', stopArrivalGameTimeMs: now + 90_000,
  })
  assert.equal(machine.send(eventFixtures.GET_OFF_TRIP), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: '101', nextTrips: [] })
})

test('remaining aboard retains the trip and replaces arrival timing at every stop', () => {
  const machine = createMachineAt('on_trip_in_station')
  for (let stop = 1; stop <= 3; stop += 1) {
    const arrival = now + stop * 120_000
    assert.equal(machine.send('DEPART_STATION'), true)
    assert.deepEqual(machine.getSnapshot(), { state: 'in_transit', tripId: 'trip-1' })
    assert.equal(machine.send({
      type: 'ARRIVE_AT_STATION', stationId: `station-${stop}`, stopArrivalGameTimeMs: arrival,
    }), true)
    assert.deepEqual(machine.getSnapshot(), {
      state: 'on_trip_in_station', tripId: 'trip-1', stopArrivalGameTimeMs: arrival,
    })
  }
})

test('cancelling waiting restores the original station and full departures', () => {
  const machine = createMachineAt('in_station')
  const initial = machine.getSnapshot()
  assert.equal(machine.send(eventFixtures.WAIT_FOR_TRIP), true)
  assertRejected(machine, 'LEAVE_STATION')
  assert.equal(machine.send('CANCEL_WAIT'), true)
  assert.deepEqual(machine.getSnapshot(), initial)
  assert.deepEqual(getGameStateInfo(machine.getSnapshot(), now + 90_000).nextTrips, [nextTrips[1]])
  assert.deepEqual(machine.getSnapshot().nextTrips, nextTrips)
})

test('refreshing station trips replaces departures with an immutable copy', () => {
  const machine = createMachineAt('in_station')
  const initial = machine.getSnapshot()
  const updatedTrips = [{ tripId: 'updated', departureGameTimeMs: now + 180_000 }]

  assert.equal(machine.refreshStationTrips('101', updatedTrips), true)
  const refreshed = machine.getSnapshot()
  assert.deepEqual(refreshed, { state: 'in_station', stationId: '101', nextTrips: updatedTrips })
  assert.notEqual(refreshed, initial)
  assert.deepEqual(initial.nextTrips, nextTrips)
  assert.equal(Object.isFrozen(refreshed), true)
  assert.equal(Object.isFrozen(refreshed.nextTrips), true)
  assert.equal(Object.isFrozen(refreshed.nextTrips[0]), true)
  assert.equal(Object.isFrozen(updatedTrips), false)
  assert.equal(Object.isFrozen(updatedTrips[0]), false)
  updatedTrips[0].tripId = 'changed'
  updatedTrips.push({ tripId: 'added', departureGameTimeMs: now })
  assert.deepEqual(refreshed.nextTrips, [{ tripId: 'updated', departureGameTimeMs: now + 180_000 }])

  assert.equal(machine.refreshStationTrips('101', []), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_station', stationId: '101', nextTrips: [] })
})

test('station trip refresh rejects stale station responses and malformed data atomically', () => {
  const machine = createMachineAt('in_station')
  const initial = machine.getSnapshot()
  for (const stationId of ['201', '', '   ', null, undefined, 101, {}]) {
    assert.equal(machine.refreshStationTrips(stationId, nextTrips), false)
    assert.equal(machine.getSnapshot(), initial)
  }
  for (const trips of [
    undefined, null, {}, [null], [{}],
    [{ tripId: '', departureGameTimeMs: now }],
    [{ tripId: 'trip', departureGameTimeMs: NaN }],
    [{ tripId: 'trip', departureGameTimeMs: Infinity }],
    [{ tripId: 'trip', departureGameTimeMs: 9e15 }],
    [{ tripId: 'trip', departureGameTimeMs: '123' }],
    [nextTrips[0], { tripId: 'invalid', departureGameTimeMs: null }],
  ]) {
    assert.equal(machine.refreshStationTrips('101', trips), false)
    assert.equal(machine.getSnapshot(), initial)
  }
})

test('station trip refresh cannot change another game state', () => {
  for (const state of Object.keys(expectedTransitions).filter((state) => state !== 'in_station')) {
    const machine = createMachineAt(state)
    const initial = machine.getSnapshot()
    assert.equal(machine.refreshStationTrips('101', nextTrips), false, state)
    assert.equal(machine.getSnapshot(), initial)
  }
})

test('cancelling a wait restores refreshed departures and ignores late refreshes', () => {
  const machine = createMachineAt('in_station')
  const updatedTrips = [{ tripId: 'updated', departureGameTimeMs: now + 180_000 }]
  assert.equal(machine.refreshStationTrips('101', updatedTrips), true)
  const refreshed = machine.getSnapshot()
  assert.equal(machine.send({ type: 'WAIT_FOR_TRIP', tripId: 'updated' }), true)
  assert.equal(machine.refreshStationTrips('101', nextTrips), false)
  assert.equal(machine.send('CANCEL_WAIT'), true)
  assert.deepEqual(machine.getSnapshot(), refreshed)
  assert.equal(machine.getSnapshot().nextTrips, refreshed.nextTrips)
})

test('cancelling an exit removes its stop and preserves the trip on arrival', () => {
  const machine = createMachineAt('in_transit_off_at_next_station')
  assert.equal(machine.send('CANCEL_EXIT'), true)
  assert.deepEqual(machine.getSnapshot(), { state: 'in_transit', tripId: 'trip-1' })
  assert.equal(machine.send(eventFixtures.ARRIVE_AT_STATION), true)
  assert.deepEqual(machine.getSnapshot(), {
    state: 'on_trip_in_station', tripId: 'trip-1', stopArrivalGameTimeMs: now + 120_000,
  })
})

test('payload-free events also accept object form', () => {
  for (const [state, type] of [
    ['outside', 'ENTER_STATION'], ['in_station', 'LEAVE_STATION'],
    ['waiting_for_trip', 'CANCEL_WAIT'], ['on_trip_in_station', 'DEPART_STATION'],
    ['in_transit_off_at_next_station', 'CANCEL_EXIT'],
  ]) assert.equal(createMachineAt(state).send({ type }), true, type)
})

test('data-bearing events reject missing fields without changing state', () => {
  for (const [state, type] of [
    ['in_station', 'WAIT_FOR_TRIP'], ['waiting_for_trip', 'BOARD_TRIP'],
    ['on_trip_in_station', 'GET_OFF_TRIP'], ['in_transit', 'ARRIVE_AT_STATION'],
    ['in_transit', 'REQUEST_EXIT'], ['in_transit_off_at_next_station', 'ARRIVE_AT_STATION'],
  ]) {
    const machine = createMachineAt(state)
    assertRejected(machine, type)
    assertRejected(machine, { type })
  }
})

test('invalid station, trip, and next-stop IDs are rejected atomically', () => {
  for (const invalid of ['', '   ', null, 101]) {
    for (const [state, type, field] of [
      ['outside', 'ENTER_STATION', 'stationId'], ['in_station', 'WAIT_FOR_TRIP', 'tripId'],
      ['on_trip_in_station', 'GET_OFF_TRIP', 'stationId'],
      ['in_transit', 'ARRIVE_AT_STATION', 'stationId'], ['in_transit', 'REQUEST_EXIT', 'nextStopId'],
    ]) assertRejected(createMachineAt(state), { ...eventFixtures[type], type, [field]: invalid })
  }
})

test('invalid arrival timestamps are rejected for boarding and either arrival path', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, 9e15, '123']) {
    for (const [state, type] of [
      ['waiting_for_trip', 'BOARD_TRIP'], ['in_transit', 'ARRIVE_AT_STATION'],
      ['in_transit_off_at_next_station', 'ARRIVE_AT_STATION'],
    ]) assertRejected(createMachineAt(state), { ...eventFixtures[type], stopArrivalGameTimeMs: invalid })
  }
})

test('malformed departure lists reject entry and disembarkation without partial state', () => {
  const malformedLists = [
    null, {}, [null], [{}],
    [{ tripId: '', departureGameTimeMs: now }],
    [{ tripId: 'trip', departureGameTimeMs: NaN }],
    [{ tripId: 'trip', departureGameTimeMs: Infinity }],
    [{ tripId: 'trip', departureGameTimeMs: 9e15 }],
    [{ tripId: 'trip', departureGameTimeMs: '123' }],
  ]
  for (const list of malformedLists) {
    for (const [state, type] of [
      ['outside', 'ENTER_STATION'], ['on_trip_in_station', 'GET_OFF_TRIP'],
      ['in_transit_off_at_next_station', 'ARRIVE_AT_STATION'],
    ]) assertRejected(createMachineAt(state), { ...eventFixtures[type], nextTrips: list })
  }
})

test('snapshots and copied departures are immutable without freezing caller data', () => {
  const machine = createGameStateMachine('101')
  const initial = machine.getSnapshot()
  const callerTrips = [{ tripId: 'original', departureGameTimeMs: now }]
  assert.equal(machine.getSnapshot(), initial)
  assert.equal(Object.isFrozen(initial), true)
  assert.throws(() => { initial.stationId = 'changed' }, TypeError)
  assert.equal(machine.send({ type: 'ENTER_STATION', nextTrips: callerTrips }), true)
  const inStation = machine.getSnapshot()
  assert.equal(machine.getSnapshot(), inStation)
  assert.equal(Object.isFrozen(inStation), true)
  assert.equal(Object.isFrozen(inStation.nextTrips), true)
  assert.equal(Object.isFrozen(inStation.nextTrips[0]), true)
  assert.equal(Object.isFrozen(callerTrips), false)
  assert.equal(Object.isFrozen(callerTrips[0]), false)
  callerTrips[0].tripId = 'mutated'
  callerTrips.push({ tripId: 'added', departureGameTimeMs: now })
  assert.deepEqual(inStation.nextTrips, [{ tripId: 'original', departureGameTimeMs: now }])
  assert.throws(() => { inStation.nextTrips[0].tripId = 'changed' }, TypeError)
  assert.throws(() => { inStation.nextTrips.push({ tripId: 'x', departureGameTimeMs: now }) }, TypeError)
  assert.equal(machine.send(eventFixtures.WAIT_FOR_TRIP), true)
  assert.equal(machine.send('CANCEL_WAIT'), true)
  assert.deepEqual(machine.getSnapshot(), inStation)
  assert.deepEqual(initial, { state: 'outside', stationId: '101' })
})

test('upcoming trips use game time, include now, exclude next local midnight, and sort', () => {
  const midnight = new Date(2026, 8, 30, 0, 0, 0).getTime()
  const trips = [
    { tripId: 'last', departureGameTimeMs: midnight - 1 },
    { tripId: 'tomorrow', departureGameTimeMs: midnight },
    { tripId: 'past', departureGameTimeMs: now - 1 },
    { tripId: 'later', departureGameTimeMs: now + 100 },
    { tripId: 'now', departureGameTimeMs: now },
  ]
  const machine = createGameStateMachine('101')
  assert.equal(machine.send({ type: 'ENTER_STATION', nextTrips: trips }), true)
  const snapshot = machine.getSnapshot()
  assert.deepEqual(getGameStateInfo(snapshot, now), {
    state: 'in_station', stationId: '101', nextTrips: [trips[4], trips[3], trips[0]],
  })
  assert.deepEqual(getGameStateInfo(snapshot, now + 101).nextTrips, [trips[0]])
  assert.deepEqual(getGameStateInfo(snapshot, midnight).nextTrips, [trips[1]])
  assert.deepEqual(getGameStateInfo(snapshot, midnight + 1).nextTrips, [])
  assert.deepEqual(snapshot.nextTrips, trips, 'deriving information never sorts stored data in place')
  assert.equal(machine.getSnapshot(), snapshot)
})

test('the 30-second dwell uses original arrival when boarding partway through', () => {
  const machine = createMachineAt('waiting_for_trip')
  assert.equal(machine.send({ type: 'BOARD_TRIP', stopArrivalGameTimeMs: now }), true)
  const snapshot = machine.getSnapshot()
  for (const [elapsed, remaining] of [[-1000, 30_000], [0, 30_000], [12_500, 17_500], [30_000, 0], [60_000, 0]]) {
    assert.deepEqual(getGameStateInfo(snapshot, now + elapsed), {
      ...snapshot, remainingStopTimeMs: remaining,
    })
  }
  assert.equal(machine.getSnapshot(), snapshot, 'elapsed time alone does not trigger departure')
  assert.equal(snapshot.state, 'on_trip_in_station')
})

test('derived state preserves untimed fields without advancing the machine', () => {
  for (const state of ['outside', 'waiting_for_trip', 'in_transit', 'in_transit_off_at_next_station']) {
    const machine = createMachineAt(state)
    const snapshot = machine.getSnapshot()
    assert.deepEqual(getGameStateInfo(snapshot, now + 86_400_000), snapshot)
    assert.equal(machine.getSnapshot(), snapshot)
  }
})

test('independently created games do not share station or trip data', () => {
  const first = createMachineAt('in_station')
  const second = createGameStateMachine('201')
  const secondInitial = second.getSnapshot()
  assert.equal(first.send(eventFixtures.WAIT_FOR_TRIP), true)
  assert.equal(second.getSnapshot(), secondInitial)
  assert.equal(second.send('ENTER_STATION'), true)
  assert.deepEqual(first.getSnapshot(), { state: 'waiting_for_trip', stationId: '101', tripId: 'trip-1' })
  assert.deepEqual(second.getSnapshot(), { state: 'in_station', stationId: '201', nextTrips: [] })
})

test('unknown names, inherited names, and malformed events are rejected in every state', () => {
  for (const state of Object.keys(expectedTransitions)) {
    const machine = createMachineAt(state)
    for (const type of ['', 'UNKNOWN', 'enter_station', '__proto__', 'constructor', 'toString']) {
      assertRejected(machine, type)
      assertRejected(machine, { type })
    }
    for (const event of [null, undefined, 12, {}, { type: null }]) assertRejected(machine, event)
  }
})
