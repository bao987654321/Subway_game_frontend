import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameClock } from '../src/game-clock/clock.ts'

const initialGameTimeMs = Date.parse('2026-09-29T12:00:00.000Z')

test('starts from the supplied game time at normal speed', () => {
  const clock = createGameClock(initialGameTimeMs, 250)

  assert.deepEqual(clock.getSnapshot(), {
    gameTimeMs: initialGameTimeMs,
    speed: 1,
  })
  assert.equal(clock.tick(1_250).gameTimeMs, initialGameTimeMs + 1_000)
})

for (const speed of [0.5, 1, 20, 200]) {
  test(`one real second advances by ${speed} game seconds at ${speed}x`, () => {
    const clock = createGameClock(initialGameTimeMs, 100)
    clock.setSpeed(speed, 100)

    assert.deepEqual(clock.tick(1_100), {
      gameTimeMs: initialGameTimeMs + 1_000 * speed,
      speed,
    })
  })
}

test('irregular frames and a delayed frame preserve all elapsed time', () => {
  const regular = createGameClock(initialGameTimeMs, 0)
  const irregular = createGameClock(initialGameTimeMs, 0)
  const delayed = createGameClock(initialGameTimeMs, 0)
  for (const clock of [regular, irregular, delayed]) clock.setSpeed(3, 0)

  for (let nowMs = 100; nowMs <= 10_000; nowMs += 100) regular.tick(nowMs)
  for (const nowMs of [7, 34, 333, 1_019, 6_002, 10_000]) irregular.tick(nowMs)
  delayed.tick(10_000)

  const expected = { gameTimeMs: initialGameTimeMs + 30_000, speed: 3 }
  assert.deepEqual(regular.getSnapshot(), expected)
  assert.deepEqual(irregular.getSnapshot(), expected)
  assert.deepEqual(delayed.getSnapshot(), expected)
})

test('speed changes between frames account for each interval at its old speed', () => {
  const clock = createGameClock(initialGameTimeMs, 0)
  clock.tick(80)

  assert.equal(clock.setSpeed(4, 125).gameTimeMs, initialGameTimeMs + 125)
  assert.equal(clock.tick(325).gameTimeMs, initialGameTimeMs + 925)
  assert.equal(clock.setSpeed(0.5, 400).gameTimeMs, initialGameTimeMs + 1_225)
  assert.equal(clock.tick(600).gameTimeMs, initialGameTimeMs + 1_325)
})

test('accepts a speed between slider steps', () => {
  const clock = createGameClock(initialGameTimeMs, 0)
  clock.setSpeed(1.25, 0)

  assert.deepEqual(clock.tick(1_000), {
    gameTimeMs: initialGameTimeMs + 1_250,
    speed: 1.25,
  })
})

test('pauses at the visibility event and resumes without hidden-time catch-up', () => {
  const clock = createGameClock(initialGameTimeMs, 100)
  clock.tick(1_100)

  assert.equal(clock.pause(1_600).gameTimeMs, initialGameTimeMs + 1_500)
  assert.deepEqual(clock.setSpeed(20, 6_600), {
    gameTimeMs: initialGameTimeMs + 1_500,
    speed: 20,
  })
  assert.equal(clock.tick(106_600).gameTimeMs, initialGameTimeMs + 1_500)
  assert.equal(clock.resume(206_600).gameTimeMs, initialGameTimeMs + 1_500)
  assert.equal(clock.tick(206_650).gameTimeMs, initialGameTimeMs + 2_500)
})

test('repeated pause and resume calls do not add hidden time or lose running time', () => {
  const clock = createGameClock(initialGameTimeMs, 0)

  clock.pause(100)
  assert.equal(clock.pause(200).gameTimeMs, initialGameTimeMs + 100)
  clock.resume(1_000)
  clock.resume(1_100)
  assert.equal(clock.tick(1_200).gameTimeMs, initialGameTimeMs + 300)
})

test('advances the calendar date when game time crosses midnight', () => {
  const clock = createGameClock(Date.parse('2026-09-29T23:59:59.500Z'), 0)
  clock.setSpeed(20, 0)

  assert.equal(
    new Date(clock.tick(100).gameTimeMs).toISOString(),
    '2026-09-30T00:00:01.500Z',
  )
})

test('rejects invalid speeds without changing the clock or its elapsed-time baseline', () => {
  for (const speed of [0, -1, 0.49, 200.01, NaN, Infinity, -Infinity]) {
    const clock = createGameClock(initialGameTimeMs, 0)
    clock.tick(100)
    const before = clock.getSnapshot()

    assert.throws(() => clock.setSpeed(speed, 500), RangeError)
    assert.deepEqual(clock.getSnapshot(), before)
    assert.deepEqual(clock.tick(600), {
      gameTimeMs: initialGameTimeMs + 600,
      speed: 1,
    })
  }
})

test('returns stable snapshots and leaves previously published snapshots unchanged', () => {
  const clock = createGameClock(initialGameTimeMs, 0)
  const initial = clock.getSnapshot()
  assert.equal(clock.getSnapshot(), initial)

  const advanced = clock.tick(100)
  assert.notEqual(advanced, initial)
  assert.equal(clock.getSnapshot(), advanced)
  assert.deepEqual(initial, { gameTimeMs: initialGameTimeMs, speed: 1 })

  const faster = clock.setSpeed(2, 150)
  assert.notEqual(faster, advanced)
  assert.deepEqual(advanced, { gameTimeMs: initialGameTimeMs + 100, speed: 1 })
  assert.deepEqual(faster, { gameTimeMs: initialGameTimeMs + 150, speed: 2 })
})
