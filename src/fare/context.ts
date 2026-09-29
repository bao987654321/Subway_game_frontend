import { createContext, useContext } from 'react'
import type { EntryOutcome } from './station-entry'

export interface StationEntryContextValue {
  /** Result of the latest attempt to enter the station, if any. */
  readonly lastOutcome: EntryOutcome | null
  /** Whether the player is outside with a station selected. */
  readonly canEnter: boolean
  payFare: () => EntryOutcome
  jumpTurnstile: () => EntryOutcome
}

export const StationEntryContext = createContext<StationEntryContextValue | null>(null)

export function useStationEntry(): StationEntryContextValue {
  const stationEntry = useContext(StationEntryContext)

  if (!stationEntry) {
    throw new Error('useStationEntry must be used within FareProvider.')
  }

  return stationEntry
}
