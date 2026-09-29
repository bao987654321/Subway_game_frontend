import { createContext, useContext } from 'react'
import { useGameClock } from '../game-clock/context'
import { getGameStateInfo } from './state-machine'
import type { GameEvent, GameStateInfo, GameStateSnapshot } from './state-machine'

interface GameStateActions {
  /** Apply an allowed event; false leaves the state unchanged. */
  send: (event: GameEvent) => boolean
  /** Choose the initial station while outside; false leaves the state unchanged. */
  selectStartingStation: (stationId: string) => boolean
}

export type GameStateContextValue = GameStateInfo & GameStateActions

export const GameStateContext = createContext<(GameStateSnapshot & GameStateActions) | null>(null)

export function useGameState(): GameStateContextValue {
  const gameState = useContext(GameStateContext)
  const { gameTimeMs } = useGameClock()

  if (!gameState) {
    throw new Error('useGameState must be used within GameStateProvider.')
  }

  return {
    ...getGameStateInfo(gameState, gameTimeMs),
    send: gameState.send,
    selectStartingStation: gameState.selectStartingStation,
  }
}
