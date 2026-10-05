import { useGameState } from '../game-state/context'
import { TripLetters } from './TripLetters'

/** Connect the game's collected routes to the presentational component. */
export function GameTripLetters() {
  const { tripLetters } = useGameState()
  return <TripLetters letters={tripLetters} />
}
