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
Press **N** to return to 1x; the shortcut leaves typing and dropdown navigation
alone.
Game time pauses while the page is hidden and resumes without catching up.
Reloading or starting a new game starts a fresh clock.

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
including cents. The wallet card displays the available balance. Paying fares,
busking, and fines update it; reloading or starting a new game assigns a fresh
balance.

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

`balance`, `pay_money(amount)`, `earn_money(amount)`, and `fine(amount)` use
dollars. Money is stored internally as integer cents. A successful payment
immediately deducts the amount and returns `true`; paying the exact balance is
allowed. Insufficient funds or an invalid amount (nonfinite, nonpositive, or
fractional-cent) returns `false` without changing the balance. `earn_money`
adds money; `fine` deducts money and may leave a negative balance. Consecutive
calls use the latest balance, even before React rerenders, and `getSnapshot()`
reads that committed balance synchronously. The wallet has no persistence.

## Entering the station

After selecting a starting station, the station entry controls offer two ways
in from **Outside**:

- **Pay fare ($3.00):** deducts the fare and enters the station. A balance below
  $3.00 cannot pay; paying the exact balance is allowed.
- **Jump turnstile:** free, with a 1% chance of getting caught on each attempt.
  A caught player stays outside. The first offense is a warning, the second
  costs $50, and the third and every later offense cost $150. Only getting
  caught counts as an offense.

A fine that leaves the wallet below zero immediately sends `GAME_OVER` before
another entry action can run. `GameOverWatcher` also watches for debt from other
fine callers. A zero balance does not end the game. The Game Over screen offers
a fresh start, resetting the wallet, offense history, busking, clock, and FSM.
`FareProvider` and `useStationEntry()` connect the entry rules to the shared
wallet and state machine. Sending `ENTER_STATION` directly is a pure state
transition; UI entry must use the fare actions to apply these rules.

## Busking

The player automatically busks while **In Station (Waiting For Trip)**. A wait
reserves one game minute for setup and at least one full game minute to pack up
before the train's boarding **arrival**, with only whole minutes in between
earning money. A train arriving in 5 game minutes allows 3 earning minutes.
Short waits with no complete earning minute pay nothing.

Each completed earning minute pays $0.25 to $5.00 in whole cents, sampled from
a truncated geometric distribution that favors smaller amounts. Payments use
`earn_money`; faster game speed accelerates the wait without changing the
per-minute rules. Canceling keeps completed earnings and discards an unfinished
minute. Waiting again starts a new setup. Clock jumps settle all completed
earning minutes once before boarding or cancellation, so a fast tick cannot
skip or duplicate payouts.

`GameStateProvider` owns the busker and exposes its phase and progress through
`useBusking()` for the Busking card; the hook returns `null` outside a wait.
The active journey's boarding arrival is the timing source, with no separate
departure timestamp added to the waiting FSM state.

## Game state machine

The [FSM definition](docs/game-state-machine.md) describes the seven player states
and seventeen allowed transitions, starting in **Outside**. The Player state card
at the end of the dashboard shows the current state, its information, and the
available controls.

| State | Controls |
| --- | --- |
| Outside | **Pay fare ($3.00)** or **Jump turnstile** after selecting a station; **Quit Game**. |
| In Station | Choose a trip and **Wait for this trip**; **Leave Station**. |
| In Station (Waiting For Trip) | **Cancel waiting**, returning to In Station with no selected trip. |
| On Trip In Station | **Get off** at the current station. |
| In Transit | **Get Off at Next Station**. |
| In Transit (Off At Next Station) | **Cancel getting off**, remaining aboard at the next stop. |
| Game Over | **Start New Game** resets the session. |

Entering a station loads its remaining-day trips. The state fields show the
remaining-trip count; the chooser shows each trip's arrival time, route, and
destination. Loading, failed requests, empty results, and trips that leave
before selection have visible feedback. The chooser offers retry or refresh
when appropriate. **Leave Station** remains available while trips load.

Selecting a trip loads its full stop schedule, then waits for its arrival.
The shared game clock drives automatic boarding, departures after **30 game
seconds** at each stop, and arrivals at subsequent stops. The player can get
off while stopped or request the next stop while moving. At the terminal, the
player automatically gets off after the final 30-second stop. Faster clock
speeds also speed up the journey; a clock tick that passes multiple scheduled
events applies them in order.

**Quit Game** is available Outside and ends the session. **Start New Game**
returns to station selection with a new current-time clock at 1x, a new random
wallet, a fresh Outside state, and cleared fare-evasion and busking history.
The loaded station catalog is retained. The same reset is available after Game Over.

### Route progress

The Route progress card above the map shows the selected
line and destination, the current station or travel segment, and the next
station's arrival countdown in game time. While waiting it counts down to the
train's arrival; while stopped it counts down to departure. The terminal is
identified as the final stop. A horizontal diagram shows every stop on the
selected trip, including stops before boarding. It marks past, current, and next
stops, with a moving position marker during travel. Scroll sideways or use
Start, Your position, and End to explore; the view centers on each new stop.
Without an active journey, the card prompts the player to choose
a trip. It reads the existing journey, shared clock, and station catalog, so
it makes no additional API requests.

### Route map

The Map card below Route progress draws the selected line geographically on a
plain background. It fits the full route automatically and shows every stop in
the selected trip, including stops before boarding. Hover, focus, or tap a
station to see its name; current and next stations have distinct markers.

The green **You** marker uses the shared game clock. It stays at the boarding
station while waiting, remains at each station during the stop, and moves in a
straight line between station coordinates during travel. This is an estimated
position: the backend shape can include other service variants and branches.
Ending or canceling the journey clears the map.

The frontend requests `GET /get_route_shape` with `route_id`, `simplify=true`,
and the trip's `direction_id` when available. Successful shapes are cached by
API base URL, route, and direction; clock ticks do not reload geometry. Station
coordinates come from the existing catalog. Map loading errors offer a retry
without blocking gameplay, and unavailable coordinates do not prevent station
selection. The map uses React and SVG without street tiles or a map SDK.

### Schedule API

The frontend calls `GET /get_next_trips` with the selected parent `station_id`,
the current local game `time` as `HH:MM:SS`, and `day` as `weekday`, `saturday`,
or `sunday`. It omits `limit` to request the rest of the day. Trip lists refresh
on station entry, cancellation back to the station, a new local game date, or
an explicit retry/refresh. Selecting a trip calls `GET /get_trip_stoptimes`
with its `trip_id`.

Schedule times use the local game calendar date, not wall-clock time at the
moment a request completes. GTFS times beyond `24:00:00` are supported in full
journeys, so a selected trip can continue after midnight. The trip chooser
is limited to the remaining local day. Journey departures use a 30-second
dwell; if necessary, a later arrival is moved forward to avoid preceding the
previous departure. Stop IDs resolve to the known station catalog by an exact
match or by removing one final `N`/`S` only when the resulting parent ID exists
in that catalog. Unsupported stops produce a visible error rather than an
invented station. These are frontend integrations with the existing backend;
no backend changes are needed. Fare and busking rules run in the frontend.

### Shared state and controls

`GameStateProvider` wraps the app inside `GameClockProvider` and `WalletProvider`.
`FareProvider` is nested inside the game-state provider so entry actions can use
both the wallet and current player state. The game-state provider's optional
`initialStationId` prop selects the starting station; without it, Outside has
`stationId: null` and the picker lets the player choose. The card shows
**Not selected** until then. `useGameState().selectStartingStation(stationId)`
accepts a nonempty ID only while Outside with an unassigned station; it returns
`true` on success and `false` without mutation otherwise. This initialization
action keeps the existing state and transition graph intact. Other components
access the state-specific fields through `useGameState()`. UI actions use
`useGameControls()` for schedule loading and journey progress, and
`useStationEntry()` for fare-aware entry:

```tsx
import { useStationEntry } from './fare/context'

function StationEntrance() {
  const { canEnter, payFare } = useStationEntry()

  return (
    <button onClick={payFare} disabled={!canEnter}>
      Pay fare — $3.00
    </button>
  )
}
```

`useGameState()` returns a discriminated union: check `state` before reading that
state's fields. Outside exposes `stationId`; In Station exposes `stationId` and
`nextTrips`; Waiting exposes `stationId` and `tripId`; On Trip In Station exposes
`tripId`, `stopArrivalGameTimeMs`, and `remainingStopTimeMs`; In Transit exposes
`tripId`; In Transit (Off At Next Station) exposes `tripId` and `nextStopId`;
and terminal Game Over has no location or trip fields.

The model accepts upcoming trips as `{ tripId, departureGameTimeMs }` records
on station entry, arrival, or a guarded station-data refresh. The provider
loads those records and uses each arrival plus 30 seconds as the game departure.
Timestamps are absolute epoch milliseconds on the game clock.
The hook shows only departures from the current game time through the end of
the local game day, sorted by departure time. The stopped-train countdown uses
30 game seconds from the supplied stop arrival time, so boarding late does not
restart the stop. Clock speed affects these derived fields.

`send(event)` returns `true` after immediately committing an allowed transition.
Consecutive calls use the latest state, even before React rerenders.
`useGameState().getSnapshot()` reads the committed FSM snapshot for action guards.
An invalid event or missing required payload returns `false` and leaves the state and
snapshot unchanged. Events needing new information use objects, for example
`send({ type: 'WAIT_FOR_TRIP', tripId })` and
`send({ type: 'BOARD_TRIP', stopArrivalGameTimeMs })`. Events needing no payload
can still use strings, such as `send('CANCEL_WAIT')`. See the FSM document for
the complete payload contract. State changes must follow the documented graph;
there is no direct setter or reset event. Reloading or remounting the provider
starts again in **Outside**.

The pure FSM remains event-driven and does not run its own timer. The provider's
scheduling layer observes the shared clock and sends the appropriate boarding,
departure, arrival, and terminal disembarkation events. Its
`refreshStationTrips(stationId, trips)` model method updates only trip data when
the player is In Station at that same station; invalid or stale-station updates
are rejected without mutation. It does not add a state transition or reset the
player's location. Fare actions combine payment and entry; a negative balance
ends the game through `GAME_OVER`. The pure FSM itself does not mutate money.

## Checks and production build

```sh
npm test
npm run lint
npm run build
npm run preview
```

The production build is written to `dist/`. Preview serves that build locally.
