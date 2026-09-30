import { FARE } from '../fare/fare'
import { useStationEntry } from '../fare/context'
import type { EntryOutcome } from '../fare/station-entry'
import { useGameState } from '../game-state/context'
import { useWallet } from '../wallet/context'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function describeOutcome(outcome: EntryOutcome): string {
  switch (outcome.kind) {
    case 'paid':
      return `You paid the ${currencyFormatter.format(outcome.fare)} fare.`
    case 'jumped':
      return 'You jumped the turnstile and got in for free.'
    case 'caught':
      return outcome.fine === 0
        ? `Caught! Offense ${outcome.offense}: a warning, no fine. You are still outside.`
        : `Caught! Offense ${outcome.offense}: fined ${currencyFormatter.format(outcome.fine)}. You are still outside.`
    case 'insufficient_funds':
      return `You can't afford the ${currencyFormatter.format(outcome.fare)} fare.`
    case 'unavailable':
      return 'You can only enter from outside, at a selected station.'
  }
}

export function StationEntry() {
  const { balance } = useWallet()
  const { state } = useGameState()
  const { lastOutcome, canEnter, payFare, jumpTurnstile } = useStationEntry()

  const message =
    state === 'game_over'
      ? 'Game over: you ended up with a negative balance.'
      : lastOutcome && describeOutcome(lastOutcome)

  return (
    <div className="station-entry" aria-label="Station entrance">
      <div className="station-entry-actions">
        <button type="button" disabled={!canEnter || balance < FARE} onClick={payFare}>
          Pay fare ({currencyFormatter.format(FARE)})
        </button>
        <button type="button" disabled={!canEnter} onClick={jumpTurnstile}>
          Jump turnstile
        </button>
      </div>
      <p className="station-entry-message" role="status">
        {message || (balance < FARE ? `You need ${currencyFormatter.format(FARE)} to pay the fare.`
          : 'Pay the fare or risk a fine by jumping the turnstile.')}
      </p>
    </div>
  )
}
