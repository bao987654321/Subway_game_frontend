import { createContext, useContext } from 'react'
import type { ScheduledTrip } from '../api/trips'
import type { JourneyProgress } from './journey'

export interface StationTrips {
  status: 'idle' | 'loading' | 'ready' | 'error'
  stationId: string | null
  trips: readonly ScheduledTrip[]
  error: string | null
}

export interface GameControlsContextValue {
  stationTrips: StationTrips
  journey: JourneyProgress | null
  choosingTrip: boolean
  actionError: string | null
  enterStation: () => void
  leaveStation: () => void
  refreshTrips: () => void
  chooseTrip: (tripId: string, stopSequence: number) => Promise<void>
  cancelWait: () => void
  getOff: () => void
  requestExit: () => void
  cancelExit: () => void
  quitGame: () => void
}

export const GameControlsContext = createContext<GameControlsContextValue | null>(null)

export function useGameControls() {
  const controls = useContext(GameControlsContext)
  if (!controls) throw new Error('useGameControls must be used within GameStateProvider.')
  return controls
}
