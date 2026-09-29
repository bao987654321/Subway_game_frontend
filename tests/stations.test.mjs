import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAllStations, fetchStartingStations } from '../src/api/stations.ts'

test('fetches the documented endpoint and preserves the API station order', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(['Z01', 'A02', 'M03']),
  )

  assert.deepEqual(await fetchAllStations(), ['Z01', 'A02', 'M03'])
  assert.equal(fetchMock.mock.callCount(), 1)
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    'https://subway-game-backend.rcdis.co/all_stations',
  )
  assert.equal(fetchMock.mock.calls[0].arguments[1].headers.Accept, 'application/json')
})

test('joins an absolute base URL without duplicate slashes and forwards cancellation', async (t) => {
  const controller = new AbortController()
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(['101']))

  await fetchAllStations({ baseUrl: 'https://example.test/api///', signal: controller.signal })

  const [url, options] = fetchMock.mock.calls[0].arguments
  assert.equal(url, 'https://example.test/api/all_stations')
  assert.equal(options.signal, controller.signal)
})

test('supports a relative base URL for the development proxy', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(['101']))

  await fetchAllStations({ baseUrl: '/api/' })

  assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/all_stations')
})

test('allows an empty list and removes duplicate IDs without reordering choices', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([]))
  assert.deepEqual(await fetchAllStations(), [])

  fetchMock.mock.mockImplementation(async () => Response.json(['Z01', 'A02', 'Z01', 'M03', 'A02']))
  assert.deepEqual(await fetchAllStations(), ['Z01', 'A02', 'M03'])
})

test('rejects malformed response shapes and invalid station IDs', async (t) => {
  const invalidLists = [null, {}, '101', [101], [''], ['  '], ['101', null], [{ id: '101' }]]
  const fetchMock = t.mock.method(globalThis, 'fetch')

  for (const stations of invalidLists) {
    fetchMock.mock.mockImplementation(async () => Response.json(stations))
    await assert.rejects(fetchAllStations(), /invalid station list/)
  }
})

test('rejects unsuccessful HTTP responses before reading their body', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }))

  await assert.rejects(fetchAllStations(), /Unable to load stations \(HTTP 503\)/)
})

test('rejects invalid JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not JSON', { status: 200 }))

  await assert.rejects(fetchAllStations(), SyntaxError)
})

test('preserves network errors for the caller', async (t) => {
  const networkError = new TypeError('Failed to fetch')
  t.mock.method(globalThis, 'fetch', async () => {
    throw networkError
  })

  await assert.rejects(fetchAllStations(), (error) => error === networkError)
})

test('preserves abort errors for the caller', async (t) => {
  const controller = new AbortController()
  controller.abort()
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signal.throwIfAborted()
  })

  await assert.rejects(fetchAllStations({ signal: controller.signal }), {
    name: 'AbortError',
  })
})

function station(id, name = `Station ${id}`, onLines = ['L']) {
  return { id, name, lat: 40.7, lon: -73.9, on_lines: onLines }
}

function mockStationApi(t, responses) {
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url, 'https://example.test')
    const response = responses[parsed.pathname]
    assert.ok(response, `Unexpected endpoint: ${url}`)
    const body = typeof response === 'function' ? await response(parsed, options) : response
    return body instanceof Response ? body : Response.json(body)
  })
}

test('resolves station names in route batches while preserving all_stations order', async (t) => {
  const fetchMock = mockStationApi(t, {
    '/all_stations': ['L06', 'A01', 'L06', 'Z09'],
    '/all_routes': ['A', 'L', 'A'],
    '/get_route_stations': (url) => url.searchParams.get('route_id') === 'A'
      ? [station('A01', 'Same name', ['A', 'C']), station('Z09', 'Same name', ['A'])]
      : [station('L06', '1 Av', ['L']), station('OTHER', 'Not a starting station')],
  })

  const stations = await fetchStartingStations()

  assert.deepEqual(stations, [
    { id: 'L06', name: '1 Av', onLines: ['L'] },
    { id: 'A01', name: 'Same name', onLines: ['A', 'C'] },
    { id: 'Z09', name: 'Same name', onLines: ['A'] },
  ])
  assert.equal(fetchMock.mock.callCount(), 4)
  assert.ok(Object.isFrozen(stations))
  assert.ok(Object.isFrozen(stations[0]))
  assert.ok(Object.isFrozen(stations[0].onLines))
})

test('fetches individual details only for IDs absent from route responses', async (t) => {
  const lookedUp = []
  mockStationApi(t, {
    '/all_stations': ['MISSING', 'L06'],
    '/all_routes': ['L'],
    '/get_route_stations': [station('L06', '1 Av')],
    '/get_station': (url) => {
      const id = url.searchParams.get('station_id')
      lookedUp.push(id)
      return station(id, 'Transfer station', ['A', 'C', 'A'])
    },
  })

  assert.deepEqual(await fetchStartingStations(), [
    { id: 'MISSING', name: 'Transfer station', onLines: ['A', 'C'] },
    { id: 'L06', name: '1 Av', onLines: ['L'] },
  ])
  assert.deepEqual(lookedUp, ['MISSING'])
})

test('falls back to individual station details when a route request fails', async (t) => {
  const lookedUp = []
  mockStationApi(t, {
    '/all_stations': ['A01', 'L06'],
    '/all_routes': ['A', 'L'],
    '/get_route_stations': (url) => url.searchParams.get('route_id') === 'A'
      ? new Response('Unavailable', { status: 503 })
      : [station('L06', '1 Av')],
    '/get_station': (url) => {
      const id = url.searchParams.get('station_id')
      lookedUp.push(id)
      return station(id)
    },
  })

  assert.equal((await fetchStartingStations()).length, 2)
  assert.deepEqual(lookedUp, ['A01'])
})

test('falls back when the route catalog fails or has an invalid shape', async (t) => {
  let routes = new Response('Unavailable', { status: 503 })
  mockStationApi(t, {
    '/all_stations': ['L06'],
    '/all_routes': () => routes,
    '/get_station': station('L06', '1 Av'),
  })

  for (const invalid of [routes, {}, [''], [null]]) {
    routes = invalid
    assert.equal((await fetchStartingStations())[0].name, '1 Av')
  }
})

test('ignores invalid route details and resolves those stations individually', async (t) => {
  mockStationApi(t, {
    '/all_stations': ['L06'],
    '/all_routes': ['L'],
    '/get_route_stations': [{ id: 'L06', name: '', on_lines: ['L'] }],
    '/get_station': station('L06', '1 Av'),
  })

  assert.equal((await fetchStartingStations())[0].name, '1 Av')
})

test('rejects invalid individual station IDs, names, and lines without inventing labels', async (t) => {
  let details
  mockStationApi(t, {
    '/all_stations': ['L06'],
    '/all_routes': [],
    '/get_station': () => details,
  })

  for (const invalid of [
    null, [], {},
    station('', '1 Av'),
    station('L06', ''),
    station('L06', '   '),
    station('L06', 12),
    station('L06', '1 Av', null),
    station('L06', '1 Av', ['']),
    station('L06', '1 Av', [3]),
  ]) {
    details = invalid
    await assert.rejects(fetchStartingStations(), /invalid station details/)
  }
})

test('rejects a station detail response for a different ID', async (t) => {
  mockStationApi(t, {
    '/all_stations': ['L06'],
    '/all_routes': [],
    '/get_station': station('L07', '3 Av'),
  })

  await assert.rejects(fetchStartingStations(), /different station/)
})

test('rejects unsuccessful individual lookups and preserves network errors', async (t) => {
  let details = () => new Response('Unavailable', { status: 503 })
  mockStationApi(t, {
    '/all_stations': ['L06'],
    '/all_routes': [],
    '/get_station': () => details(),
  })

  await assert.rejects(fetchStartingStations(), /Unable to load station details \(HTTP 503\)/)
  const networkError = new TypeError('Failed to fetch')
  details = () => { throw networkError }
  await assert.rejects(fetchStartingStations(), (error) => error === networkError)
})

test('forwards request options and safely encodes route and station query values', async (t) => {
  const controller = new AbortController()
  const routeId = 'A& /?'
  const stationId = 'L& /?'
  const fetchMock = mockStationApi(t, {
    '/api/all_stations': [stationId],
    '/api/all_routes': [routeId],
    '/api/get_route_stations': (url) => {
      assert.deepEqual([...url.searchParams], [['route_id', routeId]])
      return []
    },
    '/api/get_station': (url) => {
      assert.deepEqual([...url.searchParams], [['station_id', stationId]])
      return station(stationId, '1 Av')
    },
  })

  await fetchStartingStations({ baseUrl: '/api///', signal: controller.signal })

  for (const { arguments: [url, options] } of fetchMock.mock.calls) {
    assert.ok(url.startsWith('/api/'))
    assert.equal(options.signal, controller.signal)
    assert.equal(options.headers.Accept, 'application/json')
  }
})

test('does not request route or station details for an empty starting list', async (t) => {
  const fetchMock = mockStationApi(t, { '/all_stations': [] })

  assert.deepEqual(await fetchStartingStations(), [])
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('bounds concurrency for both route batches and individual fallback requests', async (t) => {
  const ids = Array.from({ length: 19 }, (_, index) => `S${index}`)
  let routeActive = 0
  let routePeak = 0
  let stationActive = 0
  let stationPeak = 0
  mockStationApi(t, {
    '/all_stations': ids,
    '/all_routes': ids.map((id) => `R${id}`),
    '/get_route_stations': async () => {
      routePeak = Math.max(routePeak, ++routeActive)
      await new Promise(setImmediate)
      routeActive--
      return []
    },
    '/get_station': async (url) => {
      stationPeak = Math.max(stationPeak, ++stationActive)
      await new Promise(setImmediate)
      stationActive--
      return station(url.searchParams.get('station_id'))
    },
  })

  assert.deepEqual((await fetchStartingStations()).map(({ id }) => id), ids)
  assert.ok(routePeak > 1 && routePeak <= 6, `Route concurrency was ${routePeak}`)
  assert.ok(stationPeak > 1 && stationPeak <= 6, `Station concurrency was ${stationPeak}`)
})

test('a pre-aborted station catalog request performs no network requests', async (t) => {
  const controller = new AbortController()
  controller.abort()
  const fetchMock = t.mock.method(globalThis, 'fetch')

  await assert.rejects(fetchStartingStations({ signal: controller.signal }), { name: 'AbortError' })
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('cancellation stops route dispatch and is not swallowed as a fallback condition', async (t) => {
  const controller = new AbortController()
  let routeRequests = 0
  mockStationApi(t, {
    '/all_stations': ['L06'],
    '/all_routes': Array.from({ length: 19 }, (_, index) => `R${index}`),
    '/get_route_stations': () => {
      routeRequests++
      controller.abort()
      return []
    },
  })

  await assert.rejects(fetchStartingStations({ signal: controller.signal }), { name: 'AbortError' })
  assert.equal(routeRequests, 1)
})

test('preserves abort errors from the route catalog and route details', async (t) => {
  const abortError = new DOMException('Aborted', 'AbortError')
  let abortAt = '/all_routes'
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { pathname } = new URL(url)
    if (pathname === abortAt) throw abortError
    if (pathname === '/all_stations') return Response.json(['L06'])
    if (pathname === '/all_routes') return Response.json(['L'])
    assert.fail(`Unexpected endpoint: ${pathname}`)
  })

  await assert.rejects(fetchStartingStations(), (error) => error === abortError)
  abortAt = '/get_route_stations'
  await assert.rejects(fetchStartingStations(), (error) => error === abortError)
})

test('cancellation stops individual lookup dispatch', async (t) => {
  const controller = new AbortController()
  let stationRequests = 0
  mockStationApi(t, {
    '/all_stations': Array.from({ length: 19 }, (_, index) => `S${index}`),
    '/all_routes': [],
    '/get_station': (url) => {
      stationRequests++
      controller.abort()
      return station(url.searchParams.get('station_id'))
    },
  })

  await assert.rejects(fetchStartingStations({ signal: controller.signal }), { name: 'AbortError' })
  assert.equal(stationRequests, 1)
})
