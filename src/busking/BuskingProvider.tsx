import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useGameClock } from '../game-clock/context'
import { useGameState } from '../game-state/context'
import { useWallet } from '../wallet/context'
import { BuskingContext } from './context'
import { createBusker, getBuskingPhase } from './busking'

/** Busks while the player waits for a trip. Belongs inside the clock, wallet, and game state providers. */
export function BuskingProvider({ children }: { children: ReactNode }) {
  const [busker] = useState(() => createBusker())
  const snapshot = useSyncExternalStore(busker.subscribe, busker.getSnapshot)
  const { gameTimeMs } = useGameClock()
  const { earn_money } = useWallet()
  const gameState = useGameState()

  const departureGameTimeMs =
    gameState.state === 'waiting_for_trip' ? gameState.departureGameTimeMs : null

  useEffect(() => {
    if (departureGameTimeMs === null) {
      busker.stop()
      return
    }

    // A different trip means a new wait, even if no render saw the player stop waiting.
    if (busker.getSnapshot()?.departureMs !== departureGameTimeMs) busker.stop()
    // The wait begins now; starting is a no-op if it already has.
    busker.start(gameTimeMs, departureGameTimeMs)
    const earnedCents = busker.settle(gameTimeMs)
    if (earnedCents > 0) earn_money(earnedCents / 100)
  }, [busker, departureGameTimeMs, gameTimeMs, earn_money])

  const busking = snapshot && {
    phase: getBuskingPhase(snapshot, gameTimeMs),
    paidMinutes: snapshot.paidMinutes,
    minutes: snapshot.minutes,
    earnedCents: snapshot.earnedCents,
  }

  return <BuskingContext.Provider value={{ busking }}>{children}</BuskingContext.Provider>
}
