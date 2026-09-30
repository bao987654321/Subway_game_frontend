import type { GameEvent } from '../game-state/state-machine'
// Runtime imports carry the extension so the plain-Node tests can load this module.
import { FARE } from './fare.ts'
import type { createFareEvasion } from './fare'

export type EntryOutcome =
  | { readonly kind: 'paid'; readonly fare: number }
  | { readonly kind: 'jumped' }
  | { readonly kind: 'caught'; readonly offense: number; readonly fine: number }
  | { readonly kind: 'insufficient_funds'; readonly fare: number }
  | { readonly kind: 'unavailable' }

interface StationEntryDependencies {
  wallet: {
    getSnapshot: () => { readonly balance: number }
    pay_money: (amount: number) => boolean
    earn_money: (amount: number) => boolean
    fine: (amount: number) => boolean
  }
  evasion: ReturnType<typeof createFareEvasion>
  send: (event: GameEvent) => boolean
  /** Read when an entry is attempted: outside, with a station selected. */
  canEnter: () => boolean
}

/** Ways of getting from outside into the station; none of them leave the player charged for nothing. */
export function createStationEntry({ wallet, evasion, send, canEnter }: StationEntryDependencies) {
  return {
    payFare(): EntryOutcome {
      if (!canEnter()) return { kind: 'unavailable' }
      if (!wallet.pay_money(FARE)) return { kind: 'insufficient_funds', fare: FARE }
      if (!send('ENTER_STATION')) {
        wallet.earn_money(FARE)
        return { kind: 'unavailable' }
      }
      return { kind: 'paid', fare: FARE }
    },
    jumpTurnstile(): EntryOutcome {
      if (!canEnter()) return { kind: 'unavailable' }

      const result = evasion.jumpTurnstile()
      if (result.caught) {
        // A warning costs nothing. Caught players stay outside and may try again.
        if (result.fine > 0) wallet.fine(result.fine)
        // End the game before another action can run against a stale React render.
        if (wallet.getSnapshot().balance < 0) send('GAME_OVER')
        return { kind: 'caught', offense: result.offense, fine: result.fine }
      }
      return send('ENTER_STATION') ? { kind: 'jumped' } : { kind: 'unavailable' }
    },
  }
}
