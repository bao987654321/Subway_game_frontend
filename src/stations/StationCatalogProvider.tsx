import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchStartingStations } from '../api/stations'
import { StationCatalogContext } from './context'
import type { StationCatalog } from './context'

export function StationCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<StationCatalog>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 30_000)

    async function loadStations() {
      try {
        const stations = await fetchStartingStations({
          baseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
          signal: controller.signal,
        })
        if (active) setCatalog({ status: 'ready', stations })
      } catch {
        if (active) {
          setCatalog({
            status: 'error',
            message: timedOut
              ? 'Loading stations took too long. Please try again.'
              : 'Could not load stations. Please try again.',
          })
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void loadStations()
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt])

  const retry = useCallback(() => {
    setCatalog({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  const byId = useMemo(() => new Map(
    catalog.status === 'ready' ? catalog.stations.map((station) => [station.id, station]) : [],
  ), [catalog])

  return (
    <StationCatalogContext.Provider value={{ catalog, byId, retry }}>
      {children}
    </StationCatalogContext.Provider>
  )
}
