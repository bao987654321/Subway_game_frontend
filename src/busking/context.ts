import { createContext, useContext } from 'react'
import type { BuskingPhase } from './busking'

/** null unless the player is waiting for a trip. */
export type BuskingContextValue = Readonly<{
  phase: BuskingPhase
  /** Busking minutes paid out so far, and the total available this wait. */
  paidMinutes: number
  minutes: number
  earnedCents: number
}> | null

export const BuskingContext = createContext<{ busking: BuskingContextValue } | null>(null)

export function useBusking(): BuskingContextValue {
  const context = useContext(BuskingContext)

  if (!context) {
    throw new Error('useBusking must be used within GameStateProvider.')
  }

  return context.busking
}
