import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_EARNINGS_CENTS,
  MIN_EARNINGS_CENTS,
  MINUTE_MS,
  createBusker,
  getBuskingMinutes,
  getBuskingPhase,
  sampleEarningsCents,
} from '../src/busking/busking.ts'

const start = new Date(2026, 8, 29, 12, 0, 0).getTime()
const minutes = (count) => count * MINUTE_MS

test('earnings stay within 25 cents and $5.00 at both ends of the random range', () => {
  assert.equal(sampleEarningsCents(() => 0), MIN_EARNINGS_CENTS)
  assert.equal(sampleEarningsCents(() => 1 - Number.EPSILON), MAX_EARNINGS_CENTS)
})

test('earnings are whole cents that never decrease as the random draw grows', () => {
  let previous = 0
  for (let step = 0; step < 10_000; step += 1) {
    const cents = sampleEarningsCents(() => step / 10_000)
    assert.equal(Number.isInteger(cents), true)
    assert.ok(cents >= MIN_EARNINGS_CENTS && cents <= MAX_EARNINGS_CENTS, `${cents}`)
    assert.ok(cents >= previous)
    previous = cents
  }
})

test('earnings are long-tailed around a mean near $1.50', () => {
  const samples = Array.from({ length: 100_000 }, (_, step) => sampleEarningsCents(() => step / 100_000))
  const mean = samples.reduce((sum, cents) => sum + cents, 0) / samples.length
  const median = samples[samples.length / 2]

  // Truncating the tail at $5.00 pulls the mean below the untruncated 150 cents (about 139).
  assert.ok(mean > 135 && mean < 145, `mean ${mean}`)
  assert.ok(median < mean - 15, `median ${median} is below the mean ${mean}`)
  assert.ok(samples.filter((cents) => cents > 400).length > 0, 'big tips do happen')
})

test('earnings consume exactly one random draw', () => {
  let draws = 0
  sampleEarningsCents(() => {
    draws += 1
    return 0.5
  })
  assert.equal(draws, 1)
})

test('a wait leaves a minute to set up and a minute to pack up', () => {
  for (const [wait, expected] of [
    [-1, 0], [0, 0], [1, 0], [2, 0], [2.99, 0], [3, 1], [4, 2], [5, 3], [5.5, 3], [6, 4], [62, 60],
  ]) {
    assert.equal(getBuskingMinutes(start, start + minutes(wait)), expected, `${wait} minute wait`)
  }
})

test('the phase follows set up, busking, then packing up', () => {
  const busker = createBusker(() => 0)
  busker.start(start, start + minutes(5))
  const session = busker.getSnapshot()

  for (const [elapsed, phase] of [
    [0, 'setting_up'], [0.99, 'setting_up'], [1, 'busking'], [3.99, 'busking'],
    [4, 'packing_up'], [5, 'packing_up'], [9, 'packing_up'],
  ]) {
    assert.equal(getBuskingPhase(session, start + minutes(elapsed)), phase, `${elapsed} minutes in`)
  }
})

test('a wait too short to busk goes straight from setting up to packing up', () => {
  const busker = createBusker(() => 0)
  busker.start(start, start + minutes(2))
  const session = busker.getSnapshot()

  assert.equal(session.minutes, 0)
  assert.equal(getBuskingPhase(session, start + minutes(0.5)), 'setting_up')
  assert.equal(getBuskingPhase(session, start + minutes(1)), 'packing_up')
  assert.equal(busker.settle(start + minutes(2)), 0)
})

test('each completed busking minute pays once, and setting up pays nothing', () => {
  const busker = createBusker(() => 0) // always the 25 cent minimum
  busker.start(start, start + minutes(5)) // three busking minutes

  assert.equal(busker.settle(start), 0)
  assert.equal(busker.settle(start + minutes(1.99)), 0)
  assert.equal(busker.settle(start + minutes(2)), 25)
  assert.equal(busker.settle(start + minutes(2)), 0, 'settling the same time again pays nothing')
  assert.equal(busker.settle(start + minutes(2.5)), 0)
  assert.equal(busker.settle(start + minutes(3)), 25)
  assert.equal(busker.settle(start + minutes(4)), 25)
  assert.equal(busker.settle(start + minutes(5)), 0, 'packing up pays nothing')
  assert.equal(busker.getSnapshot().earnedCents, 75)
  assert.equal(busker.getSnapshot().paidMinutes, 3)
})

test('a long jump in game time pays every minute passed, but not more than the wait allows', () => {
  const draws = [10, 20, 30]
  const busker = createBusker(() => draws.shift() / 1000)
  busker.start(start, start + minutes(5))

  const earned = busker.settle(start + minutes(500))
  assert.ok(earned > 0)
  assert.equal(busker.getSnapshot().paidMinutes, 3)
  assert.equal(draws.length, 0, 'one draw per busking minute')
  assert.equal(busker.settle(start + minutes(600)), 0)
})

test('stopping keeps nothing running, and a new wait starts fresh', () => {
  const busker = createBusker(() => 0)
  assert.equal(busker.stop(), false)
  assert.equal(busker.start(start, start + minutes(5)), true)
  assert.equal(busker.start(start, start + minutes(9)), false, 'already busking')
  busker.settle(start + minutes(2))

  assert.equal(busker.stop(), true)
  assert.equal(busker.getSnapshot(), null)
  assert.equal(busker.settle(start + minutes(4)), 0)

  assert.equal(busker.start(start + minutes(10), start + minutes(15)), true)
  assert.deepEqual(busker.getSnapshot(), {
    startMs: start + minutes(10),
    departureMs: start + minutes(15),
    minutes: 3,
    paidMinutes: 0,
    earnedCents: 0,
  })
})

test('invalid times are rejected without starting a session', () => {
  const busker = createBusker(() => 0)
  for (const [from, to] of [[NaN, start], [start, NaN], [Infinity, start], [start, -Infinity]]) {
    assert.equal(busker.start(from, to), false)
    assert.equal(busker.getSnapshot(), null)
  }
  busker.start(start, start + minutes(5))
  assert.equal(busker.settle(NaN), 0)
  assert.equal(busker.getSnapshot().paidMinutes, 0)
})

test('subscribers hear about every change and nothing else', () => {
  const busker = createBusker(() => 0)
  let calls = 0
  const unsubscribe = busker.subscribe(() => {
    calls += 1
  })

  busker.start(start, start + minutes(5)) // 1
  busker.start(start, start + minutes(9)) // rejected
  busker.settle(start + minutes(1)) // nothing due
  busker.settle(start + minutes(2)) // 2
  busker.stop() // 3
  busker.stop() // already stopped
  assert.equal(calls, 3)

  unsubscribe()
  busker.start(start, start + minutes(5))
  assert.equal(calls, 3)
})

test('snapshots are immutable and only change when something is paid', () => {
  const busker = createBusker(() => 0)
  busker.start(start, start + minutes(5))
  const before = busker.getSnapshot()

  assert.equal(Object.isFrozen(before), true)
  assert.equal(busker.settle(start + minutes(1)), 0)
  assert.equal(busker.getSnapshot(), before)

  busker.settle(start + minutes(2))
  assert.notEqual(busker.getSnapshot(), before)
  assert.equal(before.paidMinutes, 0)
})
