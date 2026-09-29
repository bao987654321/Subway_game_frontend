export interface WalletSnapshot {
  /** Available money in dollars. Payments use dollars too. */
  readonly balance: number
}

/** Converts dollars to positive integer cents, or null if not a whole number of cents. */
function toCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null

  const cents = amount * 100
  const wholeCents = Math.round(cents)
  // Accept floating-point noise in cent amounts, not fractional cents.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(cents)) * 4
  if (
    !Number.isSafeInteger(wholeCents) ||
    wholeCents <= 0 ||
    Math.abs(cents - wholeCents) > tolerance
  ) {
    return null
  }
  return wholeCents
}

/** One session's wallet; integer cents keep payments exact. */
export function createWallet(random: () => number = Math.random) {
  // Random integer number of cents between $1.00 and $10.00
  let balanceCents = 100 + Math.floor(random() * 901)
  let snapshot: WalletSnapshot = { balance: balanceCents / 100 }

  /** Applies a signed cent change if the result is valid. */
  function applyDelta(deltaCents: number): boolean {
    const next = balanceCents + deltaCents
    if (next < 0 || !Number.isSafeInteger(next)) return false

    balanceCents = next
    snapshot = { balance: balanceCents / 100 }
    return true
  }

  return {
    getSnapshot: () => snapshot,
    pay_money(amount: number): boolean {
      const cents = toCents(amount)
      return cents !== null && applyDelta(-cents)
    },
    earn_money(amount: number): boolean {
      const cents = toCents(amount)
      return cents !== null && applyDelta(cents)
    }
  }
}
