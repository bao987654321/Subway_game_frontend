# Subway Game Frontend

A React + TypeScript app powered by Vite, with a shared game clock, wallet, and
player state machine.

## Run locally

Use Node.js 24 LTS and npm. From this directory:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173.

## Starting station

On each page load, the starting-station picker requests `GET /all_stations`
from the [backend API](https://subway-game-backend.rcdis.co/docs). This endpoint
returns station IDs, ordered by station name. The frontend resolves names and
lines using `/all_routes` and `/get_route_stations`, with `/get_station` as a
fallback for any missing station. Requests run in bounded batches. The picker
shows station names, lines, and IDs in the original order; IDs distinguish
stations sharing a name. Choose one and press **Start at this station** to set the shared
`stationId` while remaining **Outside**. The picker then disappears. Reloading
starts a fresh selection. Loading, empty lists, and request failures have visible
feedback, with a Retry button for empty lists or failures. The shared station
catalog remains available after selection, so the Player state card displays the
station name alongside its ID. The FSM continues to store station IDs.

Vite development and preview servers proxy `/api/*` requests to
`https://subway-game-backend.rcdis.co/*`, so the browser does not need cross-origin
access to that server. For a deployed production build, configure the host to
reverse-proxy `/api/*` to that backend with the `/api` prefix removed. Alternatively,
set `VITE_API_BASE_URL` at build time to an API URL that allows the frontend's
origin through CORS. Vite's proxy is not included in the static `dist/` files.

## Game clock

The clock starts at your computer's current time at 1x speed and displays the
local date and 24-hour time. Adjust the slider from 0.5x to 200x in 0.5x steps.
Game time pauses while the page is hidden and resumes without catching up.
Reloading starts a fresh clock.

`GameClockProvider` wraps the app and owns the animation loop. Other components
can access the same clock through `useGameClock`:

```tsx
import { useGameClock } from './game-clock/context'

function GameStatus() {
  const { gameTimeMs, speed, setSpeed } = useGameClock()

  return (
    <button onClick={() => setSpeed(1)}>
      {new Date(gameTimeMs).toLocaleTimeString()} · {speed}x — Reset speed
    </button>
  )
}
```

`gameTimeMs` is a read-only timestamp in epoch milliseconds. `setSpeed` accepts
finite multipliers from 0.5 to 200 and preserves elapsed time at the previous
speed. The clock uses monotonic elapsed time, independent of frame rate.

## Wallet

Each game session starts with a random balance from $1.00 through $10.00,
including cents. The wallet card displays the available balance. Clock ticks
and speed changes do not affect it; reloading assigns a fresh balance.

`WalletProvider` wraps the app. Game actions can read the balance and make a
payment with `useWallet()`:

```tsx
import { useWallet } from './wallet/context'

function BuyTicket() {
  const { balance, pay_money } = useWallet()

  function buyTicket() {
    const success = pay_money(2.75)
    if (success) {
      // Grant the ticket here; the wallet UI updates automatically.
    } else {
      // Show feedback that the ticket could not be purchased.
    }
  }

  return <button onClick={buyTicket}>Buy ticket — ${balance.toFixed(2)} available</button>
}
```

Both `balance` and `pay_money(amount)` use dollars. Money is stored internally
as integer cents. A successful payment immediately deducts the amount and
returns `true`; paying the exact balance is allowed. Insufficient funds or an
invalid amount (nonfinite, nonpositive, or fractional-cent) returns `false`
without changing the balance. Consecutive calls use the latest balance, even
before React rerenders. The wallet has no deposits, persistence, or payment UI.

## Game state machine

The [FSM definition](docs/game-state-machine.md) describes the six player states
and eleven allowed transitions, starting in **Outside**. The Player state card
shows the current state and its information between the wallet and clock.

`GameStateProvider` wraps the app inside `GameClockProvider`. Its optional
`initialStationId` prop selects the starting station; without it, Outside has
`stationId: null` and the picker lets the player choose. The card shows
**Not selected** until then. `useGameState().selectStartingStation(stationId)`
accepts a nonempty ID only while Outside with an unassigned station; it returns
`true` on success and `false` without mutation otherwise. This initialization
action keeps the existing state and transition graph intact. Other components
access the state-specific fields and send events through `useGameState()`. For example,
a future station-entry control could use:

```tsx
import { useGameState } from './game-state/context'
import { GAME_STATE_LABELS } from './game-state/state-machine'

function StationEntrance() {
  const { state, send } = useGameState()

  function enterStation() {
    const success = send({ type: 'ENTER_STATION', stationId: '101' })
    if (!success) {
      // The transition or its supplied information was invalid.
    }
  }

  return (
    <button onClick={enterStation}>
      Enter station — {GAME_STATE_LABELS[state]}
    </button>
  )
}
```

The hook returns a discriminated union: check `state` before reading that
state's fields. Outside exposes `stationId`; In Station exposes `stationId` and
`nextTrips`; Waiting exposes `stationId` and `tripId`; On Trip In Station exposes
`tripId`, `stopArrivalGameTimeMs`, and `remainingStopTimeMs`; In Transit exposes
`tripId`; and In Transit (Off At Next Station) exposes `tripId` and `nextStopId`.

Supply upcoming trips as `{ tripId, departureGameTimeMs }` records on station
entry or arrival. Timestamps are absolute epoch milliseconds on the game clock.
The hook shows only departures from the current game time through the end of
the local game day, sorted by departure time. The stopped-train countdown uses
30 game seconds from the supplied stop arrival time, so boarding late does not
restart the stop. Clock speed affects these derived fields.

`send(event)` returns `true` after immediately committing an allowed transition.
Consecutive calls use the latest state, even before React rerenders. An invalid
event or missing required payload returns `false` and leaves the state and
snapshot unchanged. Events needing new information use objects, for example
`send({ type: 'WAIT_FOR_TRIP', tripId })` and
`send({ type: 'BOARD_TRIP', stopArrivalGameTimeMs })`. Events needing no payload
can still use strings, such as `send('CANCEL_WAIT')`. See the FSM document for
the complete payload contract. State changes must follow the documented graph;
there is no direct setter or reset event. Reloading or remounting the provider
starts again in **Outside**.

The current UI lets the player choose a starting station and displays supplied
and derived state information. It has no
transition buttons or automatic events, so it stays **Outside** until a
component sends an event. Clock ticks update the countdown and upcoming-trips
view but do not trigger transitions, even when the countdown reaches zero.
Wallet payments do not trigger transitions. Trip lookups, automatic scheduling,
and fares are not connected yet.

## Checks and production build

```sh
npm test
npm run lint
npm run build
npm run preview
```

The production build is written to `dist/`. Preview serves that build locally.
