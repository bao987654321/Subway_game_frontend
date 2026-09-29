export const MIN_CLOCK_SPEED = 0.5
export const MAX_CLOCK_SPEED = 200

export interface GameClockSnapshot {
  readonly gameTimeMs: number
  readonly speed: number
}

/** A clock driven by monotonic timestamps supplied by the game loop. */
export function createGameClock(
  initialGameTimeMs: number,
  initialRealTimeMs: number,
) {
  let snapshot: GameClockSnapshot = { gameTimeMs: initialGameTimeMs, speed: 1 }
  let lastRealTimeMs = initialRealTimeMs
  let paused = false

  function tick(nowMs: number): GameClockSnapshot {
    if (paused) return snapshot

    const elapsedMs = nowMs - lastRealTimeMs
    snapshot = {
      ...snapshot,
      gameTimeMs: snapshot.gameTimeMs + elapsedMs * snapshot.speed,
    }
    lastRealTimeMs = nowMs
    return snapshot
  }

  return {
    getSnapshot: () => snapshot,
    tick,
    setSpeed(speed: number, nowMs: number): GameClockSnapshot {
      if (
        !Number.isFinite(speed) ||
        speed < MIN_CLOCK_SPEED ||
        speed > MAX_CLOCK_SPEED
      ) {
        throw new RangeError(
          `Clock speed must be between ${MIN_CLOCK_SPEED} and ${MAX_CLOCK_SPEED}.`,
        )
      }

      // Account for the previous interval before applying the new multiplier.
      tick(nowMs)
      snapshot = { ...snapshot, speed }
      return snapshot
    },
    pause(nowMs: number): GameClockSnapshot {
      tick(nowMs)
      paused = true
      return snapshot
    },
    resume(nowMs: number): GameClockSnapshot {
      if (paused) {
        lastRealTimeMs = nowMs
        paused = false
      }
      return snapshot
    },
  }
}
