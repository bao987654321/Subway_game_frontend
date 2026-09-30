export const MINUTE_MS = 60_000
/** Time to set up at the start of the wait, before any busking earns money. */
export const SETUP_MS = MINUTE_MS
/** Time to pack up at the end of the wait, ready to board when the train arrives. */
export const PACK_UP_MS = MINUTE_MS

export const MIN_EARNINGS_CENTS = 25
export const MAX_EARNINGS_CENTS = 500
export const MEAN_EARNINGS_CENTS = 150

// Geometric distribution over cents above the minimum, so the untruncated mean is
// 150 cents. The tail past the maximum is cut off, which lowers the mean slightly.
const MAX_EXTRA_CENTS = MAX_EARNINGS_CENTS - MIN_EARNINGS_CENTS
const RATIO = 1 - 1 / (MEAN_EARNINGS_CENTS - MIN_EARNINGS_CENTS + 1)
const TRUNCATED_MASS = 1 - RATIO ** (MAX_EXTRA_CENTS + 1)

/** One busking minute's earnings in whole cents; long-tailed, from 25 cents to $5.00. */
export function sampleEarningsCents(random: () => number = Math.random): number {
  // Inverse CDF of the truncated distribution, using a single random draw.
  const extra = Math.floor(Math.log(1 - random() * TRUNCATED_MASS) / Math.log(RATIO))
  return MIN_EARNINGS_CENTS + Math.min(MAX_EXTRA_CENTS, Math.max(0, extra))
}

/** Full minutes of busking between setting up and packing up. */
export function getBuskingMinutes(startMs: number, departureMs: number): number {
  return Math.max(0, Math.floor((departureMs - startMs - SETUP_MS - PACK_UP_MS) / MINUTE_MS))
}

export type BuskingSession = Readonly<{
  startMs: number
  /** End of the wait; callers supply the actual boarding arrival time. */
  departureMs: number
  /** Full busking minutes available in this wait. */
  minutes: number
  /** Busking minutes already paid out. */
  paidMinutes: number
  earnedCents: number
}>

/** null when not busking. */
export type BuskerSnapshot = BuskingSession | null

export type BuskingPhase = 'setting_up' | 'busking' | 'packing_up'

/** Busking is the middle of a wait: setting up first, then whole minutes, then packing up. */
export function getBuskingPhase(session: BuskingSession, nowMs: number): BuskingPhase {
  const buskStartMs = session.startMs + SETUP_MS
  if (nowMs < buskStartMs) return 'setting_up'
  if (nowMs < buskStartMs + session.minutes * MINUTE_MS) return 'busking'
  return 'packing_up'
}

/** One session's busker. Game time is supplied by callers, so clock speed just works. */
export function createBusker(random: () => number = Math.random) {
  let snapshot: BuskerSnapshot = null
  const listeners = new Set<() => void>()

  function publish(next: BuskerSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    /** Calls listener whenever the snapshot changes; returns an unsubscribe function. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Begin busking while waiting; false if already busking or a time is invalid. */
    start(startMs: number, departureMs: number): boolean {
      if (snapshot !== null || !Number.isFinite(startMs) || !Number.isFinite(departureMs)) {
        return false
      }

      publish(Object.freeze({
        startMs,
        departureMs,
        minutes: getBuskingMinutes(startMs, departureMs),
        paidMinutes: 0,
        earnedCents: 0,
      }))
      return true
    },
    /** Stop busking, keeping what was already paid out; false if not busking. */
    stop(): boolean {
      if (snapshot === null) return false

      publish(null)
      return true
    },
    /** Pays out each busking minute completed by nowMs, once; returns the new cents earned. */
    settle(nowMs: number): number {
      if (snapshot === null || !Number.isFinite(nowMs)) return 0

      const elapsedMinutes = Math.floor((nowMs - snapshot.startMs - SETUP_MS) / MINUTE_MS)
      const completed = Math.min(snapshot.minutes, Math.max(0, elapsedMinutes))
      if (completed <= snapshot.paidMinutes) return 0

      let cents = 0
      for (let minute = snapshot.paidMinutes; minute < completed; minute += 1) {
        cents += sampleEarningsCents(random)
      }
      publish(Object.freeze({
        ...snapshot,
        paidMinutes: completed,
        earnedCents: snapshot.earnedCents + cents,
      }))
      return cents
    },
  }
}
