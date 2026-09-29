import { useEffect } from 'react'
import { useWallet } from '../wallet/context'
import { useGameState } from './context'

/** Ends the game when the balance is negative. Renders nothing. */
export function GameOverWatcher() {
  const { balance } = useWallet()
  const { state, send } = useGameState()

  useEffect(() => {
    if (balance < 0 && state !== 'game_over') send('GAME_OVER')
  }, [balance, state, send])

  return null
}
