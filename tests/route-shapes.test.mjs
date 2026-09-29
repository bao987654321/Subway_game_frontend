import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchRouteShape } from '../src/api/route-shapes.ts'

function shape(overrides = {}) {
  return {
    route_id: 'L', direction_id: null,
    coordinates: [[-73.95, 40.71], [-73.94, 40.72]], num_points: 2,
    ...overrides,
  }
}

test('requests simplified geometry and retains longitude/latitude ordering', async (t) => {
  const raw = shape()
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => raw,
  }))
  const result = await fetchRouteShape('L', null)
  const [url, options] = fetchMock.mock.calls[0].arguments
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://subway-game-backend.rcdis.co')
  assert.equal(parsed.pathname, '/get_route_shape')
  assert.deepEqual([...parsed.searchParams], [['route_id', 'L'], ['simplify', 'true']])
  assert.equal(options.headers.Accept, 'application/json')
  assert.deepEqual(result, {
    routeId: 'L', directionId: null, coordinates: raw.coordinates, numPoints: 2,
  })
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.coordinates))
  assert.ok(result.coordinates.every(Object.isFrozen))
  assert.notEqual(result.coordinates, raw.coordinates)
  raw.coordinates[0][0] = 0
  assert.equal(result.coordinates[0][0], -73.95)
})

test('passes valid directions including zero and omits unavailable directions', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    const rawDirection = new URL(url).searchParams.get('direction_id')
    return Response.json(shape({ direction_id: rawDirection === null ? null : Number(rawDirection) }))
  })
  for (const direction of [0, 1, null, undefined, -1, 2, '0', false]) {
    const result = await fetchRouteShape('L', direction)
    const expected = direction === 0 || direction === 1 ? direction : null
    const url = new URL(fetchMock.mock.calls.at(-1).arguments[0])
    assert.equal(url.searchParams.get('direction_id'), expected === null ? null : String(expected))
    assert.equal(result.directionId, expected)
  }
})

test('encodes route IDs and supports proxy and absolute base URLs with cancellation', async (t) => {
  const routeId = 'A & /? #'
  const controller = new AbortController()
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(shape({ route_id: routeId })))
  for (const baseUrl of ['/api///', 'https://example.test/api///']) {
    await fetchRouteShape(routeId, null, { baseUrl, signal: controller.signal })
    const [url, options] = fetchMock.mock.calls.at(-1).arguments
    const parsed = new URL(url, 'https://example.test')
    assert.equal(parsed.pathname, '/api/get_route_shape')
    assert.equal(parsed.searchParams.get('route_id'), routeId)
    assert.equal(parsed.searchParams.size, 2)
    assert.equal(options.signal, controller.signal)
  }
})

test('uses actual geometry size when num_points is absent or inconsistent', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const num_points of [undefined, null, 0, 100, '2']) {
    fetchMock.mock.mockImplementation(async () => Response.json(shape({ num_points })))
    assert.equal((await fetchRouteShape('L', null)).numPoints, 2)
  }
})

test('accepts omitted response direction only for an unfiltered request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(shape({ direction_id: undefined })))
  assert.equal((await fetchRouteShape('L', null)).directionId, null)
  await assert.rejects(fetchRouteShape('L', 0), /different route or direction/)
  await assert.rejects(fetchRouteShape('L', 1), /different route or direction/)
})

test('accepts repeated coordinates and geographic boundaries', async (t) => {
  const coordinates = [[-180, -90], [180, 90], [0, 0], [0, 0]]
  t.mock.method(globalThis, 'fetch', async () => Response.json(shape({ coordinates })))
  assert.deepEqual((await fetchRouteShape('L', null)).coordinates, coordinates)
})

test('rejects malformed, empty, and invalid coordinate geometry', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const coordinates of [
    undefined, null, {}, [], [[-73.9, 40.7]],
    [[-73.9, 40.7], null], [[-73.9, 40.7], [0]], [[-73.9, 40.7], [0, 0, 0]],
    [[-73.9, 40.7], ['0', 0]], [[-73.9, 40.7], [0, '0']],
    [[-73.9, 40.7], [NaN, 0]], [[-73.9, 40.7], [0, Infinity]],
    [[-73.9, 40.7], [180.1, 0]], [[-73.9, 40.7], [-180.1, 0]],
    [[-73.9, 40.7], [0, 90.1]], [[-73.9, 40.7], [0, -90.1]],
  ]) {
    fetchMock.mock.mockImplementation(async () => Response.json(shape({ coordinates })))
    await assert.rejects(fetchRouteShape('L', null), /invalid route coordinates/)
  }
})

test('rejects invalid bodies and mismatched route or direction', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const value of [null, 1, 'L']) {
    fetchMock.mock.mockImplementation(async () => Response.json(value))
    await assert.rejects(fetchRouteShape('L', null), /invalid route shape/)
  }
  for (const value of [{}, [], shape({ route_id: 'A' }), shape({ direction_id: 0 })]) {
    fetchMock.mock.mockImplementation(async () => Response.json(value))
    await assert.rejects(fetchRouteShape('L', null), /different route or direction/)
  }
  fetchMock.mock.mockImplementation(async () => Response.json(shape({ direction_id: 0 })))
  await assert.rejects(fetchRouteShape('L', 1), /different route or direction/)
})

test('rejects invalid route IDs before fetching', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const routeId of [undefined, null, 1, '', '  ']) {
    await assert.rejects(fetchRouteShape(routeId, null), /route ID/)
  }
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('rejects unsuccessful HTTP responses without consuming their body and propagates invalid JSON', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: false, status: 404, json() { assert.fail('Should not read error response body') },
  }))
  await assert.rejects(fetchRouteShape('L', null), /Unable to load route shape \(HTTP 404\)/)
  fetchMock.mock.mockImplementation(async () => new Response('not JSON'))
  await assert.rejects(fetchRouteShape('L', null), SyntaxError)
})

test('preserves network errors and fetch abort errors', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const error of [new TypeError('Failed to fetch'), new DOMException('Aborted', 'AbortError')]) {
    fetchMock.mock.mockImplementation(async () => { throw error })
    await assert.rejects(fetchRouteShape('L', null), (actual) => actual === error)
  }
})

test('does not fetch when pre-aborted and checks cancellation after fetch and JSON parsing', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  const before = new AbortController()
  before.abort()
  await assert.rejects(fetchRouteShape('L', null, { signal: before.signal }), { name: 'AbortError' })
  assert.equal(fetchMock.mock.callCount(), 0)

  const duringFetch = new AbortController()
  fetchMock.mock.mockImplementation(async () => {
    duringFetch.abort()
    return { ok: true, json() { assert.fail('Should not read aborted response') } }
  })
  await assert.rejects(fetchRouteShape('L', null, { signal: duringFetch.signal }), { name: 'AbortError' })

  const duringJson = new AbortController()
  fetchMock.mock.mockImplementation(async () => ({
    ok: true, async json() { duringJson.abort(); return shape() },
  }))
  await assert.rejects(fetchRouteShape('L', null, { signal: duringJson.signal }), { name: 'AbortError' })
})
