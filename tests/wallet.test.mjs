import assert from 'node:assert/strict'
import test from 'node:test'
import { createWallet } from '../src/wallet/wallet.ts'

test('assigns starting balances at both inclusive bounds and between them', () => {
  for (const [randomValue, balance] of [
    [0, 1],
    [0.25, 3.25],
    [0.5, 5.5],
    [1 - Number.EPSILON, 10],
  ]) {
    assert.deepEqual(createWallet(() => randomValue).getSnapshot(), { balance })
  }
})

test('samples the starting balance only once per wallet', () => {
  let samples = 0
  const wallet = createWallet(() => {
    samples += 1
    return 0.5
  })

  wallet.getSnapshot()
  wallet.getSnapshot()
  assert.equal(wallet.pay_money(1), true)
  assert.equal(wallet.pay_money(20), false)
  assert.equal(wallet.getSnapshot().balance, 4.5)
  assert.equal(samples, 1)
})

test('deducts successful payments immediately in dollars', () => {
  const wallet = createWallet(() => 0.5)

  assert.equal(wallet.pay_money(2.35), true)
  assert.deepEqual(wallet.getSnapshot(), { balance: 3.15 })
})

test('allows spending the exact balance and then refuses further spending', () => {
  const wallet = createWallet(() => 0.25)

  assert.equal(wallet.pay_money(3.25), true)
  assert.deepEqual(wallet.getSnapshot(), { balance: 0 })
  assert.equal(wallet.pay_money(0.01), false)
  assert.deepEqual(wallet.getSnapshot(), { balance: 0 })
})

test('insufficient funds leave the balance and published snapshot unchanged', () => {
  const wallet = createWallet(() => 0)
  const before = wallet.getSnapshot()

  assert.equal(wallet.pay_money(1.01), false)
  assert.equal(wallet.getSnapshot(), before)
  assert.deepEqual(before, { balance: 1 })
})

test('rejects invalid or fractional-cent amounts without changing the wallet', () => {
  const wallet = createWallet(() => 0.5)
  const before = wallet.getSnapshot()

  for (const amount of [
    0,
    -0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    Number.MIN_VALUE,
    0.001,
    1.005,
    0.30001,
    Number.MAX_VALUE,
  ]) {
    assert.equal(wallet.pay_money(amount), false, `payment of ${amount}`)
    assert.equal(wallet.getSnapshot(), before)
    assert.deepEqual(wallet.getSnapshot(), { balance: 5.5 })
  }
})

test('accepts cent amounts with ordinary binary floating-point imprecision', () => {
  const wallet = createWallet(() => 0.5)

  assert.equal(wallet.pay_money(1.01), true)
  assert.equal(wallet.pay_money(0.1 + 0.2), true)
  assert.equal(wallet.getSnapshot().balance, 4.19)
})

test('repeated ten-cent payments reach zero without accumulating rounding error', () => {
  const wallet = createWallet(() => 0)

  for (let payment = 1; payment <= 10; payment += 1) {
    assert.equal(wallet.pay_money(0.1), true)
    assert.equal(wallet.getSnapshot().balance, (100 - payment * 10) / 100)
  }

  assert.equal(wallet.pay_money(0.1), false)
  assert.equal(wallet.getSnapshot().balance, 0)
})

test('consecutive payments cannot spend the same available funds twice', () => {
  const wallet = createWallet(() => 0)

  assert.equal(wallet.pay_money(0.6), true)
  assert.equal(wallet.pay_money(0.6), false)
  assert.equal(wallet.getSnapshot().balance, 0.4)
})

test('publishes stable snapshots and preserves previously published balances', () => {
  const wallet = createWallet(() => 0.5)
  const initial = wallet.getSnapshot()
  assert.equal(wallet.getSnapshot(), initial)

  assert.equal(wallet.pay_money(1), true)
  const paid = wallet.getSnapshot()
  assert.notEqual(paid, initial)
  assert.equal(wallet.getSnapshot(), paid)
  assert.deepEqual(initial, { balance: 5.5 })
  assert.deepEqual(paid, { balance: 4.5 })

  assert.equal(wallet.pay_money(0.5), true)
  assert.deepEqual(paid, { balance: 4.5 })
  assert.deepEqual(wallet.getSnapshot(), { balance: 4 })
})
