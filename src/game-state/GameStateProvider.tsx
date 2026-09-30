import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { GameStateContext } from './context'
import { createGameStateMachine, STOP_DURATION_MS } from './state-machine'
import type { GameEvent } from './state-machine'
import { useGameClock } from '../game-clock/context'
import { useStationCatalog } from '../stations/context'
import { fetchNextTrips, fetchTripStops } from '../api/trips'
import { advanceJourney, createJourneyPlan } from './journey'
import type { JourneyProgress } from './journey'
import { GameControlsContext } from './controls-context'
import type { StationTrips } from './controls-context'
import { useWallet } from '../wallet/context'
import { createBusker, getBuskingPhase } from '../busking/busking'
import { BuskingContext } from '../busking/context'

export function GameStateProvider({
  children,
  initialStationId = null,
  onQuit,
}: {
  children: ReactNode
  initialStationId?: string | null
  onQuit?: () => void
}) {
  const { gameTimeMs } = useGameClock()
  const { byId } = useStationCatalog()
  const { earn_money } = useWallet()
  const [machine] = useState(() => createGameStateMachine(initialStationId))
  const [busker] = useState(() => createBusker())
  const buskingSnapshot = useSyncExternalStore(busker.subscribe, busker.getSnapshot)
  const [snapshot, setSnapshot] = useState(machine.getSnapshot)
  const [tripResult, setTripResult] = useState<{ key: string; list: StationTrips } | null>(null)
  const [journey, setJourney] = useState<JourneyProgress | null>(null)
  const [choosingTrip, setChoosingTrip] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshAttempt, setRefreshAttempt] = useState(0)
  const stationId = snapshot.state === 'in_station' ? snapshot.stationId : null
  const gameDay = new Date(gameTimeMs).toDateString()
  const requestKey = JSON.stringify([stationId, gameDay, refreshAttempt])
  const stationTrips = useMemo<StationTrips>(() => stationId === null
    ? { status: 'idle', stationId: null, trips: [], error: null }
    : tripResult?.key === requestKey ? tripResult.list
    : { status: 'loading', stationId, trips: [], error: null }, [stationId, tripResult, requestKey])
  const timeRef = useRef(gameTimeMs)
  const journeyRef = useRef<JourneyProgress | null>(null)
  const tripRequestRef = useRef<AbortController | null>(null)
  const tripListRef = useRef(stationTrips)
  useLayoutEffect(() => {
    timeRef.current = gameTimeMs
    tripListRef.current = stationTrips
  }, [gameTimeMs, stationTrips])

  const publishJourney = useCallback((next: JourneyProgress | null) => {
    journeyRef.current = next
    setJourney(next)
  }, [])

  const settleBusking = useCallback(() => {
    const cents = busker.settle(timeRef.current)
    if (cents > 0) earn_money(cents / 100)
  }, [busker, earn_money])

  const syncJourney = useCallback(() => {
    const current = journeyRef.current
    if (!current) return
    const before = machine.getSnapshot()
    // Settle before boarding so fast clock jumps cannot lose completed minutes.
    if (before.state === 'waiting_for_trip') settleBusking()
    const next = advanceJourney(machine, current, timeRef.current)
    if (machine.getSnapshot().state !== 'waiting_for_trip') busker.stop()
    if (next !== current) publishJourney(next)
    if (machine.getSnapshot() !== before) setSnapshot(machine.getSnapshot())
  }, [machine, busker, publishJourney, settleBusking])

  useEffect(() => { syncJourney() }, [gameTimeMs, syncJourney])

  useEffect(() => () => {
    tripRequestRef.current?.abort()
    tripRequestRef.current = null
  }, [])

  useEffect(() => {
    if (stationId === null) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    let active = true

    async function loadTrips() {
      try {
        const trips = await fetchNextTrips(stationId!, timeRef.current, {
          baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', signal: controller.signal,
        })
        const gameTrips = trips.map((trip) => ({
          tripId: trip.tripId,
          departureGameTimeMs: trip.arrivalGameTimeMs + STOP_DURATION_MS,
        }))
        if (active && !controller.signal.aborted && machine.refreshStationTrips(stationId!, gameTrips)) {
          setSnapshot(machine.getSnapshot())
          setTripResult({ key: requestKey, list: { status: 'ready', stationId, trips, error: null } })
        }
      } catch {
        if (active) {
          setTripResult({ key: requestKey, list: {
            status: 'error', stationId, trips: [],
            error: 'Could not load upcoming trips. Please try again.',
          } })
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void loadTrips()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [stationId, requestKey, machine])

  const send = useCallback(
    (event: GameEvent): boolean => {
      // Apply events before rendering so consecutive calls use the latest state.
      const eventType = typeof event === 'string' ? event : event.type
      if (machine.getSnapshot().state === 'waiting_for_trip' && eventType !== 'GAME_OVER') {
        settleBusking()
      }
      const success = machine.send(event)
      if (success) {
        const next = machine.getSnapshot()
        if (next.state !== 'waiting_for_trip') busker.stop()
        if (next.state === 'game_over') {
          tripRequestRef.current?.abort()
          tripRequestRef.current = null
          setChoosingTrip(false)
          setActionError(null)
          publishJourney(null)
        }
        setSnapshot(next)
      }
      return success
    },
    [machine, busker, publishJourney, settleBusking],
  )

  const selectStartingStation = useCallback(
    (stationId: string): boolean => {
      const success = machine.selectStartingStation(stationId)
      if (success) setSnapshot(machine.getSnapshot())
      return success
    },
    [machine],
  )

  function cancelTripRequest() {
    tripRequestRef.current?.abort()
    tripRequestRef.current = null
    setChoosingTrip(false)
  }

  function leaveStation() {
    cancelTripRequest()
    setActionError(null)
    send('LEAVE_STATION')
  }

  async function chooseTrip(tripId: string, stopSequence: number) {
    const current = machine.getSnapshot()
    const list = tripListRef.current
    if (current.state !== 'in_station' || tripRequestRef.current !== null ||
        list.status !== 'ready' || list.stationId !== current.stationId) return
    const trip = list.trips.find((item) => item.tripId === tripId && item.stopSequence === stopSequence)
    if (!trip || trip.arrivalGameTimeMs + STOP_DURATION_MS <= timeRef.current) {
      setActionError('That trip has already left. Please choose another trip.')
      return
    }

    const controller = new AbortController()
    tripRequestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    setChoosingTrip(true)
    setActionError(null)
    try {
      const stops = await fetchTripStops(trip.tripId, trip.serviceDateMs, {
        baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', signal: controller.signal,
      })
      if (controller.signal.aborted || tripRequestRef.current !== controller) return
      const latest = machine.getSnapshot()
      if (latest.state !== 'in_station' || latest.stationId !== current.stationId) return
      const plan = createJourneyPlan(trip, stops, current.stationId, new Set(byId.keys()))
      if (plan.stops[plan.boardingIndex]!.departureGameTimeMs <= timeRef.current) {
        setActionError('That trip left while its schedule was loading. Please choose another trip.')
        return
      }
      if (send({ type: 'WAIT_FOR_TRIP', tripId: trip.tripId })) {
        // Main boards at arrival: reserve a full packing minute before that.
        busker.stop()
        busker.start(timeRef.current, plan.stops[plan.boardingIndex]!.arrivalGameTimeMs)
        publishJourney({ plan, stopIndex: plan.boardingIndex })
        syncJourney()
      }
    } catch (error) {
      if (tripRequestRef.current === controller) {
        setActionError(controller.signal.aborted
          ? 'Loading the trip took too long. Please try again.'
          : error instanceof Error ? error.message : 'Could not load the trip. Please try again.')
      }
    } finally {
      window.clearTimeout(timeout)
      if (tripRequestRef.current === controller) {
        tripRequestRef.current = null
        setChoosingTrip(false)
      }
    }
  }

  function cancelWait() {
    syncJourney()
    if (send('CANCEL_WAIT')) {
      publishJourney(null)
      setActionError(null)
    }
  }

  function getOff() {
    syncJourney()
    const current = journeyRef.current
    if (machine.getSnapshot().state !== 'on_trip_in_station' || !current) return
    const stop = current.plan.stops[current.stopIndex]!
    if (send({ type: 'GET_OFF_TRIP', stationId: stop.stationId })) {
      publishJourney(null)
      setActionError(null)
    }
  }

  function requestExit() {
    syncJourney()
    const current = journeyRef.current
    if (machine.getSnapshot().state !== 'in_transit' || !current) return
    const next = current.plan.stops[current.stopIndex + 1]
    if (next) send({ type: 'REQUEST_EXIT', nextStopId: next.stopId })
  }

  function cancelExit() {
    syncJourney()
    send('CANCEL_EXIT')
  }

  function quitGame() {
    if (machine.getSnapshot().state === 'outside') {
      cancelTripRequest()
      onQuit?.()
    }
  }

  return (
    <GameStateContext.Provider value={{ ...snapshot, send, selectStartingStation, getSnapshot: machine.getSnapshot }}>
      <GameControlsContext.Provider value={{
        stationTrips, journey, choosingTrip, actionError,
        leaveStation, chooseTrip, cancelWait, getOff, requestExit, cancelExit, quitGame,
        refreshTrips: () => setRefreshAttempt((attempt) => attempt + 1),
      }}>
        <BuskingContext.Provider value={{ busking: snapshot.state === 'waiting_for_trip' && buskingSnapshot ? {
          phase: getBuskingPhase(buskingSnapshot, gameTimeMs),
          paidMinutes: buskingSnapshot.paidMinutes,
          minutes: buskingSnapshot.minutes,
          earnedCents: buskingSnapshot.earnedCents,
        } : null }}>
          {children}
        </BuskingContext.Provider>
      </GameControlsContext.Provider>
    </GameStateContext.Provider>
  )
}
