import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchNextTrips, fetchTripStops } from '../src/api/trips.ts'

const localTime = (hour = 12, minute = 0, second = 0) => new Date(2026, 8, 29, hour, minute, second).getTime()

function trip(overrides = {}) {
  return {
    route_id: 'A', trip_id: 'trip-A', service_id: 'weekday', trip_headsign: 'Uptown',
    stop_sequence: 4, arrival_time: '12:10:00', departure_time: '12:10:00',
    ...overrides,
  }
}

function stop(overrides = {}) {
  return {
    trip_id: 'trip-A', stop_id: 'A01N', stop_sequence: 4,
    arrival_time: '12:10:00', departure_time: '12:10:00', ...overrides,
  }
}

test('requests all remaining station trips using the local game time and weekday', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([trip()]))
  const trips = await fetchNextTrips('A01', localTime(12, 3, 7))
  const [url, options] = fetchMock.mock.calls[0].arguments
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://subway-game-backend.rcdis.co')
  assert.equal(parsed.pathname, '/get_next_trips')
  assert.deepEqual([...parsed.searchParams], [['station_id', 'A01'], ['time', '12:03:07'], ['day', 'weekday']])
  assert.equal(options.headers.Accept, 'application/json')
  assert.deepEqual(trips, [{
    tripId: 'trip-A', routeId: 'A', headsign: 'Uptown', stopSequence: 4,
    arrivalGameTimeMs: localTime(12, 10), departureGameTimeMs: localTime(12, 10),
    serviceDateMs: localTime(0),
  }])
  assert.ok(Object.isFrozen(trips))
  assert.ok(Object.isFrozen(trips[0]))
})

test('uses saturday and sunday service according to the game calendar date', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([]))
  for (const [date, day] of [[26, 'saturday'], [27, 'sunday'], [28, 'weekday']]) {
    await fetchNextTrips('A01', new Date(2026, 8, date, 0, 0, 3).getTime())
    const url = new URL(fetchMock.mock.calls.at(-1).arguments[0])
    assert.equal(url.searchParams.get('day'), day)
    assert.equal(url.searchParams.get('time'), '00:00:03')
  }
})

test('filters past and next-day departures, retains departures now, and sorts the remaining day', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    trip({ trip_id: 'late', arrival_time: '23:59:59', departure_time: '23:59:59' }),
    trip({ trip_id: 'past', arrival_time: '11:59:59', departure_time: '11:59:59' }),
    trip({ trip_id: 'tomorrow', arrival_time: '24:01:00', departure_time: '24:01:00' }),
    trip({ trip_id: 'now', arrival_time: '12:00:00', departure_time: '12:00:00' }),
    trip({ trip_id: 'next' }),
    trip({ trip_id: 'midnight', arrival_time: '24:00:00', departure_time: '24:00:00' }),
  ]))
  assert.deepEqual((await fetchNextTrips('A01', localTime())).map(({ tripId }) => tripId), ['now', 'next', 'late'])
  assert.deepEqual((await fetchNextTrips('A01', localTime() + 1)).map(({ tripId }) => tripId), ['next', 'late'])
})

test('preserves real arrival and departure times without imposing the game dwell duration', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    trip({ arrival_time: '11:59:50', departure_time: '12:00:20' }),
  ]))
  const [result] = await fetchNextTrips('A01', localTime())
  assert.equal(result.arrivalGameTimeMs, localTime(11, 59, 50))
  assert.equal(result.departureGameTimeMs, localTime(12, 0, 20))
})

test('accepts absent or null headsigns without inventing a direction label', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const trip_headsign of [undefined, null, '', '   ']) {
    fetchMock.mock.mockImplementation(async () => Response.json([trip({ trip_headsign })]))
    assert.equal((await fetchNextTrips('A01', localTime()))[0].headsign, null)
  }
})

test('safely encodes IDs, supports proxy and absolute base URLs, and forwards cancellation', async (t) => {
  const controller = new AbortController()
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([]))
  const id = 'A & /? #'
  await fetchNextTrips(id, localTime(), { baseUrl: '/api///', signal: controller.signal })
  await fetchTripStops(id, localTime(0), { baseUrl: 'https://example.test/api///', signal: controller.signal })
  const [next, stops] = fetchMock.mock.calls
  assert.ok(next.arguments[0].startsWith('/api/get_next_trips?'))
  const nextUrl = new URL(next.arguments[0], 'https://example.test')
  assert.equal(nextUrl.searchParams.get('station_id'), id)
  assert.equal(nextUrl.searchParams.size, 3)
  const stopUrl = new URL(stops.arguments[0])
  assert.equal(stopUrl.pathname, '/api/get_trip_stoptimes')
  assert.deepEqual([...stopUrl.searchParams], [['trip_id', id]])
  for (const { arguments: [, options] } of fetchMock.mock.calls) {
    assert.equal(options.signal, controller.signal)
    assert.equal(options.headers.Accept, 'application/json')
  }
})

test('converts and sorts full stop schedules across midnight, retaining platform stop IDs', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    stop({ stop_id: 'A03N', stop_sequence: 9, arrival_time: '25:10:00', departure_time: '25:10:30' }),
    stop({ stop_id: 'A01N', stop_sequence: 4, arrival_time: '23:59:00', departure_time: '23:59:00' }),
    stop({ stop_id: 'A02N', stop_sequence: 6, arrival_time: '24:05:00', departure_time: '24:05:00' }),
  ]))
  const result = await fetchTripStops('trip-A', localTime(0))
  assert.deepEqual(result.map(({ stopId }) => stopId), ['A01N', 'A02N', 'A03N'])
  assert.equal(result[0].arrivalGameTimeMs, localTime(23, 59))
  assert.equal(result[1].arrivalGameTimeMs, localTime(24, 5))
  assert.equal(result[2].departureGameTimeMs, localTime(25, 10, 30))
  assert.ok(Object.isFrozen(result))
  assert.ok(result.every(Object.isFrozen))
})

test('accepts empty trip and stop lists', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([]))
  assert.deepEqual(await fetchNextTrips('A01', localTime()), [])
  assert.deepEqual(await fetchTripStops('trip-A', localTime(0)), [])
})

test('rejects invalid list shapes for both endpoints', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const result of [null, {}, 'trip-A', 123]) {
    fetchMock.mock.mockImplementation(async () => Response.json(result))
    await assert.rejects(fetchNextTrips('A01', localTime()), /invalid trip list/)
    await assert.rejects(fetchTripStops('trip-A', localTime(0)), /invalid stop list/)
  }
})

test('rejects incomplete or invalid trip identifiers, routes, headsigns, and stop sequences', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  const invalid = [null, {}, 3, trip({ trip_id: '' }), trip({ trip_id: '  ' }),
    trip({ route_id: null }), trip({ route_id: '' }), trip({ trip_headsign: 1 }),
    trip({ stop_sequence: -1 }), trip({ stop_sequence: 1.5 }), trip({ stop_sequence: '4' }),
    trip({ stop_sequence: Number.MAX_SAFE_INTEGER + 1 })]
  for (const value of invalid) {
    fetchMock.mock.mockImplementation(async () => Response.json([value]))
    await assert.rejects(fetchNextTrips('A01', localTime()), /invalid trip details/)
  }
})

test('rejects invalid schedule times and departures before arrival', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const time of [null, 123, '', '-1:00:00', '12:60:00', '12:00:60', '12:0:00', '12:00', ' 12:00:00', '99999999999999999999:00:00']) {
    fetchMock.mock.mockImplementation(async () => Response.json([trip({ arrival_time: time })]))
    await assert.rejects(fetchNextTrips('A01', localTime()), /invalid schedule time/)
  }
  fetchMock.mock.mockImplementation(async () => Response.json([trip({ departure_time: '12:09:59' })]))
  await assert.rejects(fetchNextTrips('A01', localTime()), /departure before arrival/)
})

test('rejects stops belonging to another trip or with missing stop IDs', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const value of [stop({ trip_id: 'other' }), stop({ stop_id: '' }), stop({ stop_id: 1 })]) {
    fetchMock.mock.mockImplementation(async () => Response.json([value]))
    await assert.rejects(fetchTripStops('trip-A', localTime(0)), /invalid trip stop details/)
  }
})

test('rejects duplicate stop sequences and schedules that move backwards in time', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([
    stop(), stop({ stop_id: 'A02N' }),
  ]))
  await assert.rejects(fetchTripStops('trip-A', localTime(0)), /duplicate stop sequences/)
  fetchMock.mock.mockImplementation(async () => Response.json([
    stop(), stop({ stop_sequence: 5, arrival_time: '12:09:59' }),
  ]))
  await assert.rejects(fetchTripStops('trip-A', localTime(0)), /out of time order/)
  fetchMock.mock.mockImplementation(async () => Response.json([
    stop({ departure_time: '12:11:00' }), stop({ stop_sequence: 5, arrival_time: '12:10:30', departure_time: '12:11:00' }),
  ]))
  await assert.rejects(fetchTripStops('trip-A', localTime(0)), /out of time order/)
})

test('rejects invalid caller IDs and dates before making a request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch')
  for (const id of [null, undefined, '', '  ', 42]) {
    await assert.rejects(fetchNextTrips(id, localTime()), /station ID/)
    await assert.rejects(fetchTripStops(id, localTime(0)), /trip ID/)
  }
  for (const time of [null, undefined, '2026-09-29', NaN, Infinity, 9e15]) {
    await assert.rejects(fetchNextTrips('A01', time), /valid game time/)
    await assert.rejects(fetchTripStops('trip-A', time), /valid game time/)
  }
  assert.equal(fetchMock.mock.callCount(), 0)
})

for (const [name, load] of [
  ['next trips', (options) => fetchNextTrips('A01', localTime(), options)],
  ['trip stops', (options) => fetchTripStops('trip-A', localTime(0), options)],
]) {
  test(`${name}: rejects HTTP errors and invalid JSON`, async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }))
    await assert.rejects(load(), /Unable to load trips \(HTTP 503\)/)
    fetchMock.mock.mockImplementation(async () => new Response('not JSON'))
    await assert.rejects(load(), SyntaxError)
  })

  test(`${name}: propagates network and abort failures`, async (t) => {
    const networkError = new TypeError('Failed to fetch')
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw networkError })
    await assert.rejects(load(), (error) => error === networkError)
    const abortError = new DOMException('Aborted', 'AbortError')
    fetchMock.mock.mockImplementation(async () => { throw abortError })
    await assert.rejects(load(), (error) => error === abortError)
  })

  test(`${name}: makes no request when already aborted and rejects cancellation during JSON reading`, async (t) => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = t.mock.method(globalThis, 'fetch')
    await assert.rejects(load({ signal: controller.signal }), { name: 'AbortError' })
    assert.equal(fetchMock.mock.callCount(), 0)
    const later = new AbortController()
    fetchMock.mock.mockImplementation(async () => ({
      ok: true,
      async json() { later.abort(); return [] },
    }))
    await assert.rejects(load({ signal: later.signal }), { name: 'AbortError' })
  })
}
