/** Turnstile fare in dollars. */
export const FARE = 3

/** Chance of being caught on each turnstile jump. */
export const CATCH_PROBABILITY = 0.01

/** Fines in dollars by offense: a warning, then $50, then $150 for every offense after. */
const FINES = [0, 50, 150] as const

export type JumpResult =
  | { readonly caught: false }
  | { readonly caught: true; readonly offense: number; readonly fine: number }

export function fineForOffense(offense: number): number {
  return FINES[Math.min(offense, FINES.length) - 1]
}

/** One session's fare evasion record; only being caught counts as an offense. */
export function createFareEvasion(random: () => number = Math.random) {
  let offenses = 0

  return {
    jumpTurnstile(): JumpResult {
      if (random() >= CATCH_PROBABILITY) return { caught: false }

      offenses += 1
      return { caught: true, offense: offenses, fine: fineForOffense(offenses) }
    },
  }
}
