import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { GameStateContext } from './context'
import { createGameStateMachine } from './state-machine'
import type { GameEvent } from './state-machine'

export function GameStateProvider({
  children,
  initialStationId = null,
}: {
  children: ReactNode
  initialStationId?: string | null
}) {
  const [machine] = useState(() => createGameStateMachine(initialStationId))
  const [snapshot, setSnapshot] = useState(machine.getSnapshot)

  const send = useCallback(
    (event: GameEvent): boolean => {
      // Apply events before rendering so consecutive calls use the latest state.
      const success = machine.send(event)
      if (success) setSnapshot(machine.getSnapshot())
      return success
    },
    [machine],
  )

  return (
    <GameStateContext.Provider value={{ ...snapshot, send }}>
      {children}
    </GameStateContext.Provider>
  )
}
