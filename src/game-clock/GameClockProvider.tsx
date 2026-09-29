import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createGameClock } from './clock'
import { GameClockContext } from './context'

export function GameClockProvider({ children }: { children: ReactNode }) {
  const [clock] = useState(() => createGameClock(Date.now(), performance.now()))
  const [snapshot, setSnapshot] = useState(clock.getSnapshot)

  const setSpeed = useCallback(
    (speed: number) => {
      setSnapshot(clock.setSpeed(speed, performance.now()))
    },
    [clock],
  )

  useEffect(() => {
    let frameId: number | undefined

    function stopLoop() {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId)
        frameId = undefined
      }
      clock.pause(performance.now())
    }

    function frame() {
      setSnapshot(clock.tick(performance.now()))
      frameId = requestAnimationFrame(frame)
    }

    function syncVisibility() {
      if (document.hidden) {
        stopLoop()
      } else if (frameId === undefined) {
        clock.resume(performance.now())
        frameId = requestAnimationFrame(frame)
      }
      setSnapshot(clock.getSnapshot())
    }

    document.addEventListener('visibilitychange', syncVisibility)
    syncVisibility()

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      stopLoop()
    }
  }, [clock])

  return (
    <GameClockContext.Provider value={{ ...snapshot, setSpeed }}>
      {children}
    </GameClockContext.Provider>
  )
}
