import { useState } from 'react'
import type { ReactNode } from 'react'
import { useGameState } from '../game-state/context'
import { useWallet } from '../wallet/context'
import { StationEntryContext } from './context'
import { createFareEvasion } from './fare'
import { createStationEntry } from './station-entry'
import type { EntryOutcome } from './station-entry'

/** Owns the session's fare evasion record. Belongs inside the wallet and game state providers. */
export function FareProvider({ children }: { children: ReactNode }) {
  const [evasion] = useState(() => createFareEvasion())
  const [lastOutcome, setLastOutcome] = useState<EntryOutcome | null>(null)
  const { pay_money, earn_money, fine, getSnapshot: getWalletSnapshot } = useWallet()
  const gameState = useGameState()

  const canEnterNow = () => {
    const current = gameState.getSnapshot()
    return current.state === 'outside' && current.stationId !== null &&
      getWalletSnapshot().balance >= 0
  }
  const canEnter = canEnterNow()
  const entry = createStationEntry({
    wallet: { pay_money, earn_money, fine, getSnapshot: getWalletSnapshot },
    evasion,
    send: gameState.send,
    canEnter: canEnterNow,
  })

  const record = (attempt: () => EntryOutcome) => (): EntryOutcome => {
    const outcome = attempt()
    setLastOutcome(outcome)
    return outcome
  }

  return (
    <StationEntryContext.Provider
      value={{
        lastOutcome,
        canEnter,
        payFare: record(entry.payFare),
        jumpTurnstile: record(entry.jumpTurnstile),
      }}
    >
      {children}
    </StationEntryContext.Provider>
  )
}
