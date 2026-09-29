import { createContext, useContext } from 'react'
import type { GameClockSnapshot } from './clock'

export interface GameClockContextValue extends GameClockSnapshot {
  setSpeed: (speed: number) => void
}

export const GameClockContext = createContext<GameClockContextValue | null>(null)

/** Read the shared game time and adjust its speed from any game component. */
export function useGameClock(): GameClockContextValue {
  const clock = useContext(GameClockContext)

  if (!clock) {
    throw new Error('useGameClock must be used within GameClockProvider.')
  }

  return clock
}
