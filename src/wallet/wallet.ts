export interface WalletSnapshot {
  /** Available money in dollars. Payments use dollars too. */
  readonly balance: number
}

/** One session's wallet; integer cents keep payments exact. */
export function createWallet(random: () => number = Math.random) {
  let balanceCents = 100 + Math.floor(random() * 901)
  let snapshot: WalletSnapshot = { balance: balanceCents / 100 }

  return {
    getSnapshot: () => snapshot,
    pay_money(amount: number): boolean {
      if (!Number.isFinite(amount) || amount <= 0) return false

      const cents = amount * 100
      const paymentCents = Math.round(cents)
      // Accept floating-point noise in cent amounts, not fractional cents.
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(cents)) * 4
      if (
        !Number.isSafeInteger(paymentCents) ||
        paymentCents <= 0 ||
        Math.abs(cents - paymentCents) > tolerance ||
        paymentCents > balanceCents
      ) {
        return false
      }

      balanceCents -= paymentCents
      snapshot = { balance: balanceCents / 100 }
      return true
    },
  }
}
