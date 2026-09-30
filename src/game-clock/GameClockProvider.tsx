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
    function resetSpeed(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== 'n' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target
      if (
        (target instanceof HTMLInputElement && target.type !== 'range') ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      setSpeed(1)
    }

    window.addEventListener('keydown', resetSpeed, true)
    return () => window.removeEventListener('keydown', resetSpeed, true)
  }, [setSpeed])

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
