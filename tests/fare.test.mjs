import assert from 'node:assert/strict'
import test from 'node:test'
import { CATCH_PROBABILITY, FARE, createFareEvasion, fineForOffense } from '../src/fare/fare.ts'
import { createStationEntry } from '../src/fare/station-entry.ts'
import { createGameStateMachine } from '../src/game-state/state-machine.ts'
import { createWallet } from '../src/wallet/wallet.ts'

const CAUGHT = 0
const NOT_CAUGHT = 0.5

/** A wallet, machine, and evasion record wired together with scripted dice rolls. */
function createEntry({ stationId = '101', startingBalance = 5.5, rolls = [] } = {}) {
  // The wallet draws its balance as 100 + floor(random * 901) cents; aim for the middle of that cent.
  const cents = Math.round(startingBalance * 100)
  const wallet = createWallet(() => (cents - 100 + 0.5) / 901)
  assert.equal(wallet.getSnapshot().balance, startingBalance)

  const machine = createGameStateMachine(stationId)
  const queue = [...rolls]
  const evasion = createFareEvasion(() => queue.shift() ?? NOT_CAUGHT)
  const entry = createStationEntry({
    wallet,
    evasion,
    send: machine.send,
    canEnter: () => {
      const { state, stationId: station } = machine.getSnapshot()
      return state === 'outside' && station !== null
    },
  })
  return { entry, wallet, machine }
}

test('fare and catch chance match the rules', () => {
  assert.equal(FARE, 3)
  assert.equal(CATCH_PROBABILITY, 0.01)
})

test('fines escalate: warning, $50, then $150 for every later offense', () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(fineForOffense), [0, 50, 150, 150, 150])
})

test('a jump is caught below the 1% threshold only', () => {
  for (const [roll, caught] of [[0, true], [0.0099, true], [0.01, false], [0.5, false], [0.999, false]]) {
    assert.equal(createFareEvasion(() => roll).jumpTurnstile().caught, caught, `roll ${roll}`)
  }
})

test('offenses count only times caught, not attempts', () => {
  const rolls = [NOT_CAUGHT, CAUGHT, NOT_CAUGHT, NOT_CAUGHT, CAUGHT, CAUGHT, CAUGHT]
  const evasion = createFareEvasion(() => rolls.shift())
  const results = Array.from({ length: 7 }, () => evasion.jumpTurnstile())
  assert.deepEqual(results, [
    { caught: false },
    { caught: true, offense: 1, fine: 0 },
    { caught: false },
    { caught: false },
    { caught: true, offense: 2, fine: 50 },
    { caught: true, offense: 3, fine: 150 },
    { caught: true, offense: 4, fine: 150 },
  ])
})

test('separate sessions keep separate offense records', () => {
  const first = createFareEvasion(() => CAUGHT)
  const second = createFareEvasion(() => CAUGHT)
  first.jumpTurnstile()
  assert.equal(first.jumpTurnstile().offense, 2)
  assert.equal(second.jumpTurnstile().offense, 1)
})

test('paying the fare deducts $3.00 and enters the station', () => {
  const { entry, wallet, machine } = createEntry({ startingBalance: 5.5 })
  assert.deepEqual(entry.payFare(), { kind: 'paid', fare: 3 })
  assert.equal(wallet.getSnapshot().balance, 2.5)
  assert.equal(machine.getSnapshot().state, 'in_station')
})

test('the exact fare can be paid, leaving nothing', () => {
  const { entry, wallet } = createEntry({ startingBalance: 3 })
  assert.equal(entry.payFare().kind, 'paid')
  assert.equal(wallet.getSnapshot().balance, 0)
})

test('paying without enough money changes nothing', () => {
  const { entry, wallet, machine } = createEntry({ startingBalance: 2.99 })
  const before = machine.getSnapshot()
  assert.deepEqual(entry.payFare(), { kind: 'insufficient_funds', fare: 3 })
  assert.equal(wallet.getSnapshot().balance, 2.99)
  assert.equal(machine.getSnapshot(), before)
})

test('no station selected: nothing is charged and the player stays outside', () => {
  const { entry, wallet, machine } = createEntry({ stationId: null })
  assert.deepEqual(entry.payFare(), { kind: 'unavailable' })
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'unavailable' })
  assert.equal(wallet.getSnapshot().balance, 5.5)
  assert.equal(machine.getSnapshot().state, 'outside')
})

test('cannot enter again once inside; no second charge', () => {
  const { entry, wallet } = createEntry({ startingBalance: 9 })
  assert.equal(entry.payFare().kind, 'paid')
  assert.deepEqual(entry.payFare(), { kind: 'unavailable' })
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'unavailable' })
  assert.equal(wallet.getSnapshot().balance, 6)
})

test('a failed entry after payment is refunded', () => {
  const wallet = createWallet(() => 0.5)
  const entry = createStationEntry({
    wallet,
    evasion: createFareEvasion(),
    send: () => false,
    canEnter: () => true,
  })
  assert.deepEqual(entry.payFare(), { kind: 'unavailable' })
  assert.equal(wallet.getSnapshot().balance, 5.5)
})

test('jumping unnoticed enters for free', () => {
  const { entry, wallet, machine } = createEntry({ rolls: [NOT_CAUGHT] })
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'jumped' })
  assert.equal(wallet.getSnapshot().balance, 5.5)
  assert.equal(machine.getSnapshot().state, 'in_station')
})

test('the first catch is a warning: no fine, and the player stays outside', () => {
  const { entry, wallet, machine } = createEntry({ rolls: [CAUGHT] })
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'caught', offense: 1, fine: 0 })
  assert.equal(wallet.getSnapshot().balance, 5.5)
  assert.equal(machine.getSnapshot().state, 'outside')
})

test('repeated catches are fined $50 then $150, and the player can go into debt', () => {
  const { entry, wallet, machine } = createEntry({
    startingBalance: 5.5,
    rolls: [CAUGHT, CAUGHT, CAUGHT, CAUGHT],
  })
  assert.equal(entry.jumpTurnstile().fine, 0)
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'caught', offense: 2, fine: 50 })
  assert.equal(wallet.getSnapshot().balance, -44.5)
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'caught', offense: 3, fine: 150 })
  assert.equal(wallet.getSnapshot().balance, -194.5)
  assert.deepEqual(entry.jumpTurnstile(), { kind: 'caught', offense: 4, fine: 150 })
  assert.equal(machine.getSnapshot().state, 'outside')
})

test('after being caught, the player can still pay the fare to enter', () => {
  const { entry, machine } = createEntry({ rolls: [CAUGHT] })
  assert.equal(entry.jumpTurnstile().kind, 'caught')
  assert.equal(entry.payFare().kind, 'paid')
  assert.equal(machine.getSnapshot().state, 'in_station')
})
