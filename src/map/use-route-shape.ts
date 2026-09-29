import { useEffect, useState } from 'react'
import { fetchRouteShape } from '../api/route-shapes'
import type { RouteShape } from '../api/route-shapes'

type ShapeResult =
  | { status: 'loading' }
  | { status: 'ready'; shape: RouteShape }
  | { status: 'error'; message: string }

// Geometry is independent of the trip schedule and shared clock.
const shapeCache = new Map<string, RouteShape>()

export function useRouteShape(routeId: string, directionId: 0 | 1 | null) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api'
  const cacheKey = JSON.stringify([baseUrl, routeId, directionId])
  const [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify([cacheKey, attempt])
  const [result, setResult] = useState<{ key: string; value: ShapeResult } | null>(null)
  const cached = shapeCache.get(cacheKey)

  useEffect(() => {
    if (shapeCache.has(cacheKey)) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    let active = true

    async function load() {
      try {
        const shape = await fetchRouteShape(routeId, directionId, {
          baseUrl, signal: controller.signal,
        })
        if (!active || controller.signal.aborted) return
        shapeCache.set(cacheKey, shape)
        setResult({ key: requestKey, value: { status: 'ready', shape } })
      } catch {
        if (active) {
          setResult({ key: requestKey, value: {
            status: 'error', message: 'Could not load the route map. Please try again.',
          } })
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void load()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [baseUrl, routeId, directionId, cacheKey, requestKey])

  const shape: ShapeResult = cached ? { status: 'ready', shape: cached }
    : result?.key === requestKey ? result.value : { status: 'loading' }
  return { ...shape, retry: () => setAttempt((value) => value + 1) }
}
