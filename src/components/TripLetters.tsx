// import { useWallet } from '../wallet/context'

import { useGameState } from '../game-state/context'

export function TripLetters() {
  const { tripLetters } = useGameState()
    // console.log(state)
  return (
    <section>
      <h2>Test</h2>
      <p>
       {tripLetters}
      </p>
    </section>
  )
}
