import assert from 'node:assert/strict'
import test from 'node:test'
import { createBusker } from '../src/busking/busking.ts'
import { createFareEvasion } from '../src/fare/fare.ts'
import { createStationEntry } from '../src/fare/station-entry.ts'
import { createGameClock } from '../src/game-clock/clock.ts'
import { advanceJourney, createJourneyPlan } from '../src/game-state/journey.ts'
import { createGameStateMachine } from '../src/game-state/state-machine.ts'
import { createWallet } from '../src/wallet/wallet.ts'

const start = new Date(2026, 8, 29, 12).getTime()
const minute = 60_000

function planArrivingIn(minutes) {
  const arrival = start + minutes * minute
  const trip = {
    tripId: 'L-trip', routeId: 'L', directionId: 0, headsign: '8 Av', stopSequence: 1,
    arrivalGameTimeMs: arrival, departureGameTimeMs: arrival + 30_000,
    serviceDateMs: new Date(2026, 8, 29).getTime(),
  }
  return createJourneyPlan(trip, [
    { tripId: trip.tripId, stopId: 'L06N', stopSequence: 1,
      arrivalGameTimeMs: arrival, departureGameTimeMs: arrival },
    { tripId: trip.tripId, stopId: 'L05N', stopSequence: 2,
      arrivalGameTimeMs: arrival + 2 * minute, departureGameTimeMs: arrival + 2 * minute },
  ], 'L06', new Set(['L06', 'L05']))
}

function paidEntry() {
  const wallet = createWallet(() => 0.5) // $5.50
  const machine = createGameStateMachine('L06')
  const entry = createStationEntry({
    wallet,
    evasion: createFareEvasion(() => 0.5),
    send: machine.send,
    canEnter: () => machine.getSnapshot().state === 'outside' &&
      machine.getSnapshot().stationId !== null && wallet.getSnapshot().balance >= 0,
  })
  assert.equal(entry.payFare().kind, 'paid')
  assert.equal(wallet.getSnapshot().balance, 2.5)
  return { wallet, machine, entry }
}

test('a 200x clock jump pays only complete waiting minutes and preserves fares through a trip', () => {
  const { wallet, machine, entry } = paidEntry()
  const clock = createGameClock(start, 0)
  clock.setSpeed(200, 0)
  const plan = planArrivingIn(5)
  const progress = { plan, stopIndex: plan.boardingIndex }
  const busker = createBusker(() => 0) // 25 cents per completed minute
  assert.equal(machine.send({ type: 'WAIT_FOR_TRIP', tripId: plan.tripId }), true)
  busker.start(clock.getSnapshot().gameTimeMs, plan.stops[plan.boardingIndex].arrivalGameTimeMs)

  // One delayed frame reaches the platform dwell after the full wait.
  const now = clock.tick(1_575).gameTimeMs
  assert.equal(now, start + 5 * minute + 15_000)
  const earnings = busker.settle(now)
  assert.equal(earnings, 75, 'five minutes allow setup, three paid minutes, and packing')
  assert.equal(wallet.earn_money(earnings / 100), true)
  assert.equal(advanceJourney(machine, progress, now), progress)
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
  assert.equal(busker.settle(now), 0, 'the frame cannot pay twice')
  busker.stop()
  assert.equal(wallet.getSnapshot().balance, 3.25)

  // Travel time cannot produce more busking income or another entry fare.
  const afterTrip = clock.tick(3_000).gameTimeMs
  assert.equal(advanceJourney(machine, progress, afterTrip), null)
  assert.equal(machine.getSnapshot().stationId, 'L05')
  assert.equal(busker.settle(afterTrip), 0)
  assert.equal(wallet.getSnapshot().balance, 3.25)
  assert.equal(machine.send('LEAVE_STATION'), true)
  assert.equal(entry.payFare().kind, 'paid', 'the wait earned enough for a second entry')
  assert.equal(wallet.getSnapshot().balance, 0.25)
})

test('canceling and selecting the same arrival preserves tips but starts a fresh setup minute', () => {
  const { wallet, machine } = paidEntry()
  const plan = planArrivingIn(8)
  const arrival = plan.stops[plan.boardingIndex].arrivalGameTimeMs
  const busker = createBusker(() => 0)
  machine.send({ type: 'WAIT_FOR_TRIP', tripId: plan.tripId })
  busker.start(start, arrival)

  const cancelAt = start + 2.5 * minute
  assert.equal(wallet.earn_money(busker.settle(cancelAt) / 100), true)
  assert.equal(machine.send('CANCEL_WAIT'), true)
  busker.stop()
  assert.equal(wallet.getSnapshot().balance, 2.75)

  assert.equal(machine.send({ type: 'WAIT_FOR_TRIP', tripId: plan.tripId }), true)
  assert.equal(busker.start(cancelAt, arrival), true)
  assert.equal(busker.settle(start + 4 * minute), 0,
    'setup restarts and the unfinished previous minute is not carried forward')
  assert.equal(wallet.earn_money(busker.settle(arrival) / 100), true)
  assert.equal(busker.getSnapshot().paidMinutes, 3)
  assert.equal(wallet.getSnapshot().balance, 3.5, 'one previous minute plus three new minutes')
  advanceJourney(machine, { plan, stopIndex: plan.boardingIndex }, arrival)
  busker.stop()
  assert.equal(machine.getSnapshot().state, 'on_trip_in_station')
})

test('a terminal game rejects a late trip selection and its already-loaded schedule', async () => {
  const { machine } = paidEntry()
  const pendingPlan = Promise.resolve(planArrivingIn(5))
  assert.equal(machine.send('GAME_OVER'), true)
  const terminal = machine.getSnapshot()

  const latePlan = await pendingPlan
  assert.equal(machine.send({ type: 'WAIT_FOR_TRIP', tripId: latePlan.tripId }), false)
  assert.equal(machine.refreshStationTrips('L06', [{
    tripId: latePlan.tripId,
    departureGameTimeMs: latePlan.stops[0].departureGameTimeMs,
  }]), false)
  assert.equal(advanceJourney(machine, { plan: latePlan, stopIndex: 0 }, start + 20 * minute), null)
  assert.equal(machine.getSnapshot(), terminal)
})
