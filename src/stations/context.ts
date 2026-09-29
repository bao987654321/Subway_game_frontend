import { createContext, useContext } from 'react'
import type { StationSummary } from '../api/stations'

export type StationCatalog =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stations: readonly StationSummary[] }

export const StationCatalogContext = createContext<{
  catalog: StationCatalog
  byId: ReadonlyMap<string, StationSummary>
  retry: () => void
} | null>(null)

export function useStationCatalog() {
  const context = useContext(StationCatalogContext)
  if (!context) throw new Error('useStationCatalog must be used within StationCatalogProvider.')
  return context
}
