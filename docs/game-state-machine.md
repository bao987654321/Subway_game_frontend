# Game State Machine

This is the agreed definition of the player's finite state machine (FSM),
implemented by the shared frontend game state model. It has **seven states**,
**eleven events**, **seventeen allowed transitions**, and starts in **Outside**.

## States

| State | Meaning |
| --- | --- |
| Outside | The player is outside the station. This is the initial state. |
| In Station | The player is inside the station and off the train. |
| In Station (Waiting For Trip) | The player is waiting to board a trip. |
| On Trip In Station | The player is aboard a train stopped at a station. |
| In Transit | The player is aboard a moving train and plans to stay aboard at the next stop. |
| In Transit (Off At Next Station) | The player is aboard a moving train and has requested to get off at the next station. |
| Game Over | The session has ended because the wallet balance is negative. This state is terminal. |

“On Train In Station” refers to **On Trip In Station**; it is not an additional
state. “On Trip” and “On Trip (Off At Next Station)” refer to the existing
**In Transit** and **In Transit (Off At Next Station)** states, respectively.

## Information per state

| State | Information available through `useGameState()` |
| --- | --- |
| Outside | `stationId: string \| null`; `null` means no station has been selected. |
| In Station | `stationId: string`; `nextTrips: { tripId: string; departureGameTimeMs: number }[]`. |
| In Station (Waiting For Trip) | `tripId: string`; retained `stationId: string` for cancellation. |
| On Trip In Station | `tripId: string`; `stopArrivalGameTimeMs: number`; derived `remainingStopTimeMs: number`. |
| In Transit (Off At Next Station) | `tripId: string`; `nextStopId: string`. |
| In Transit | `tripId: string`. |
| Game Over | No station or trip fields. |

The state and its fields form a discriminated union. Components narrow on
`state` to access the relevant information; unrelated fields are not retained
on the public snapshot. Station and trip IDs must be nonempty strings. Only
the initial Outside state may have an unselected station.

`stationId` identifies a parent station, while `nextStopId` identifies a stop
on a trip. These are distinct IDs: a station may be `101` while its stop is
`101S`. The caller supplies the parent station on arrival or disembarkation;
the FSM does not resolve stop IDs itself. The journey layer accepts an exact
known station ID or removes one final `N`/`S` only if the resulting parent ID
exists in the loaded station catalog. It rejects schedules whose stops cannot
be resolved by those checks.

Upcoming trips are supplied by the caller, with absolute epoch-millisecond
departure timestamps on the game clock. The model stores the supplied list;
the hook derives `nextTrips` by including departures at or after the current
game time and before the next local midnight, sorted earliest first. An empty
list means no upcoming trips were supplied or remain in that interval. The
provider fetches a new list on entry or return to a station, including after
cancelling waiting. Cancellation immediately restores the retained list while
the refreshed list loads. The Player state fields show a count; the trip
chooser below them displays the available trip options.

Each stop lasts **30 game seconds**. The model stores the supplied stop arrival
timestamp; the hook derives `remainingStopTimeMs` as
`clamp(stopArrivalGameTimeMs + 30_000 - gameTimeMs, 0, 30_000)`. Boarding partway
through a stop uses that stop's original arrival time. Deriving the countdown
does not mutate the pure FSM. The provider's scheduling layer observes game
time and sends the departure event when the stop ends, or disembarks the player
at the terminal.

## State diagram

```mermaid
stateDiagram-v2
    state "Outside" as Outside
    state "In Station" as InStation
    state "In Station (Waiting For Trip)" as Waiting
    state "On Trip In Station" as OnTrip
    state "In Transit" as InTransit
    state "In Transit (Off At Next Station)" as GettingOff
    state "Game Over" as GameOver

    [*] --> Outside
    Outside --> InStation: ENTER_STATION
    InStation --> Outside: LEAVE_STATION

    InStation --> Waiting: WAIT_FOR_TRIP
    Waiting --> InStation: CANCEL_WAIT
    Waiting --> OnTrip: BOARD_TRIP

    OnTrip --> InStation: GET_OFF_TRIP
    OnTrip --> InTransit: DEPART_STATION
    InTransit --> OnTrip: ARRIVE_AT_STATION

    InTransit --> GettingOff: REQUEST_EXIT
    GettingOff --> InTransit: CANCEL_EXIT
    GettingOff --> InStation: ARRIVE_AT_STATION

    Outside --> GameOver: GAME_OVER
    InStation --> GameOver: GAME_OVER
    Waiting --> GameOver: GAME_OVER
    OnTrip --> GameOver: GAME_OVER
    InTransit --> GameOver: GAME_OVER
    GettingOff --> GameOver: GAME_OVER
```

## Allowed transitions

| Current state | Event | Next state |
| --- | --- | --- |
| Outside | `ENTER_STATION` | In Station |
| In Station | `LEAVE_STATION` | Outside |
| In Station | `WAIT_FOR_TRIP` | In Station (Waiting For Trip) |
| In Station (Waiting For Trip) | `CANCEL_WAIT` | In Station |
| In Station (Waiting For Trip) | `BOARD_TRIP` | On Trip In Station |
| On Trip In Station | `GET_OFF_TRIP` | In Station |
| On Trip In Station | `DEPART_STATION` | In Transit |
| In Transit | `ARRIVE_AT_STATION` | On Trip In Station |
| In Transit | `REQUEST_EXIT` | In Transit (Off At Next Station) |
| In Transit (Off At Next Station) | `CANCEL_EXIT` | In Transit |
| In Transit (Off At Next Station) | `ARRIVE_AT_STATION` | In Station |
| Outside | `GAME_OVER` | Game Over |
| In Station | `GAME_OVER` | Game Over |
| In Station (Waiting For Trip) | `GAME_OVER` | Game Over |
| On Trip In Station | `GAME_OVER` | Game Over |
| In Transit | `GAME_OVER` | Game Over |
| In Transit (Off At Next Station) | `GAME_OVER` | Game Over |

## Rules

- Only the transitions listed above are allowed. Every other state/event
  combination is rejected without changing the state.
- `GET_OFF_TRIP` allows the player to get off immediately while the train is
  stopped. While moving, the player uses `REQUEST_EXIT` instead.
- `ARRIVE_AT_STATION` keeps the player aboard in **On Trip In Station** unless
  an exit was requested. With an exit requested, arrival takes the player
  directly to **In Station**.
- `CANCEL_EXIT` means the player will stay aboard at the next arrival.
- `LEAVE_STATION` is available only in **In Station**. A waiting player must
  cancel waiting first; an onboard player must get off first.
- Arrival and departure events describe state changes. The provider sends
  these events as the shared game clock reaches the loaded journey schedule.
- At the terminal, the player gets off automatically through `GET_OFF_TRIP`
  after the final 30-game-second stop. This uses an existing transition.
- `GAME_OVER` is allowed from every active state. Game Over accepts no events,
  including another `GAME_OVER`; a fresh game is a new provider session.
- `ENTER_STATION` does not charge money itself. Player entry uses fare actions,
  which coordinate the wallet and transition without adding an FSM event.

## Player controls and scheduling

| State | Available player actions |
| --- | --- |
| Outside | Pay fare ($3.00) or Jump turnstile; Quit Game. Entry requires a selected station. |
| In Station | Choose a trip and wait for it; Leave Station. |
| In Station (Waiting For Trip) | Cancel waiting, restoring In Station without a selected trip. |
| On Trip In Station | Get off at the current station. |
| In Transit | Get Off at Next Station. |
| In Transit (Off At Next Station) | Cancel getting off. |
| Game Over | Start New Game, creating a fresh session. |

Paid entry requires at least $3.00 and deducts that fare. Turnstile jumping has
a 1% chance of getting caught on each attempt. A caught player stays Outside:
the first offense is a warning, the second costs $50, and the third and later
offenses cost $150 each. Only getting caught increments the offense count. A
fine may overdraw the wallet; the entry action immediately sends `GAME_OVER`
when the resulting balance is negative. `GameOverWatcher` also observes debt
from other fine callers. A zero balance is not Game Over. Fare actions read
the committed wallet and FSM snapshots so consecutive clicks cannot use a
stale rendered state to charge another entry or evade a terminal state.

The provider fetches `/get_next_trips` with `station_id`, local game time in
`HH:MM:SS`, and `day` (`weekday`, `saturday`, or `sunday`). Omitting `limit`
requests all remaining trips. Lists reload on station entry, return from
waiting or a trip, a new local game date, and explicit retry/refresh. The UI
shows loading, error, and empty states. A player can still leave while loading.

Choosing a trip fetches `/get_trip_stoptimes?trip_id=...` before transitioning
to Waiting. The frontend validates the trip and boarding stop, resolves parent
station IDs against the catalog, and checks that the trip has not left while
loading. A failed or expired choice leaves the player In Station with feedback.

The API layer converts GTFS times using the local game service date. Times
such as `24:10:00` belong to the following calendar day and remain available in
full journey schedules, though the station's departure list covers only the
remaining local day. The journey layer uses exactly 30 game seconds per stop,
moving an arrival forward if needed to keep it at or after the previous game
departure. It retains the boarding stop's original game arrival, so late
boarding does not restart the dwell.

`advanceJourney` in `src/game-state/journey.ts` sends `BOARD_TRIP` when the
selected train arrives, `DEPART_STATION` when its dwell ends, and
`ARRIVE_AT_STATION` at the next stop. It applies all reached events in order
when a fast clock tick passes several stops. Requested exits disembark on
arrival; otherwise the player stays aboard until choosing to get off or
reaching the terminal. The provider observes the existing shared clock and
does not create another animation loop.

Waiting automatically starts busking. `GameStateProvider` uses the journey's
boarding arrival as the end of the wait, reserves one game minute for setup
and at least one game minute for packing, and pays only complete earning
minutes between them. Each earning minute pays $0.25–$5.00 in whole cents from
a truncated geometric distribution. The provider settles completed earnings
before schedule advancement or cancellation, including clock ticks that pass
multiple events, and never pays the same minute twice. Canceling keeps paid
earnings; a subsequent wait starts a new setup. `useBusking()` exposes the phase
and progress for the UI and returns `null` when not waiting. Journey timing
stays in `JourneyPlan`; Waiting does not store a duplicated departure time.

Quit Game is available Outside and unmounts the active clock, wallet, and FSM.
Start New Game after quitting or Game Over creates a new Outside state with no
selected station, a clock initialized to the current time at 1x, a new random
wallet, and cleared fare-evasion and busking history. The station
catalog remains loaded. Session reset does not add an FSM event or transition.

## Runtime API

`createGameStateMachine(initialStationId: string | null = null)` in
`src/game-state/state-machine.ts` creates one independent machine in **Outside**.
It exposes:

- `getSnapshot()` returns a read-only snapshot containing `state` and its stored
  fields, with the same object returned until an allowed transition, initial
  station selection, or station-trip data update succeeds.
- `selectStartingStation(stationId)` initializes the station without changing
  the Outside state. It returns `true` only for a nonempty ID while Outside with
  `stationId: null`. Invalid IDs or later selections return `false` and preserve
  the snapshot. This setup action adds no FSM event or transition.
- `refreshStationTrips(stationId, trips)` replaces only the upcoming-trip data
  while In Station at that exact station. It validates the ID and trip records,
  copies and freezes accepted data, and returns `true` with a new snapshot.
  Wrong-state, wrong-station, or malformed updates return `false` and preserve
  snapshot identity. This guard prevents a late station response from changing
  the player's location or a different state's data; it adds no transition.
- `send(event)` returns `true` and updates the model synchronously for an allowed
  transition with valid information. It returns `false` for an invalid event or
  payload, preserving the existing state and snapshot. Consecutive calls always
  use the latest committed state.

`getGameStateInfo(snapshot, gameTimeMs)` derives the upcoming-trips view and
stopped-train countdown without changing the model snapshot. `gameTimeMs` and
event timestamps are absolute epoch milliseconds. Time-of-day parsing and
service-date scheduling live in the API and journey layers, outside this pure
model.

### Event payloads

Events carrying information use `{ type, ...payload }` objects:

| Event | Payload and behavior |
| --- | --- |
| `ENTER_STATION` | Optional `stationId` and `nextTrips`. Uses the current Outside station when `stationId` is omitted; rejects entry if no station is selected. Omitted `nextTrips` defaults to an empty list. |
| `LEAVE_STATION` | No payload. Carries the current station ID into Outside. |
| `WAIT_FOR_TRIP` | Required `tripId`. Retains the current station and its supplied trips for cancellation. |
| `CANCEL_WAIT` | No payload. Restores the station and its supplied trip list; the hook filters that list against the current game time. |
| `BOARD_TRIP` | Required `stopArrivalGameTimeMs`. Carries the selected trip into On Trip In Station. |
| `GET_OFF_TRIP` | Required `stationId`; optional `nextTrips`, defaulting to an empty list. Returns to the supplied parent station. |
| `DEPART_STATION` | No payload. Carries the trip ID into In Transit. |
| `ARRIVE_AT_STATION` | Required `stationId` and `stopArrivalGameTimeMs`; optional `nextTrips`, defaulting to an empty list. Staying aboard records the stop arrival time; an exit request instead moves to the supplied station and trip list. |
| `REQUEST_EXIT` | Required `nextStopId`. Carries the trip ID into In Transit (Off At Next Station). |
| `CANCEL_EXIT` | No payload. Keeps the trip ID and clears the exit request. |
| `GAME_OVER` | No payload. Enters terminal Game Over from any active state and clears state-specific fields. |

Bare strings remain supported for `ENTER_STATION`, `LEAVE_STATION`,
`CANCEL_WAIT`, `DEPART_STATION`, `CANCEL_EXIT`, and `GAME_OVER`. Bare `ENTER_STATION` requires
an already selected Outside station. The other events require their documented
payloads. Missing or invalid IDs, trip-list records, or timestamps are rejected.
The caller is responsible for supplying the correct trip, stop, and station;
the FSM does not validate them against a backend schedule.

The `GameState` IDs are `outside`, `in_station`, `waiting_for_trip`,
`on_trip_in_station`, `in_transit`, `in_transit_off_at_next_station`, and `game_over`.
`GAME_STATE_LABELS` maps these IDs to the display names above. Events use the
exact uppercase names in the transition table.

`GameStateProvider` owns the app's shared machine and accepts an optional
`initialStationId` prop. `useGameState()` from `src/game-state/context` exposes
the state-specific information above plus `send`, `selectStartingStation`, and
`getSnapshot` for synchronous reads of the latest committed FSM state.
The provider belongs inside
`GameClockProvider`, `WalletProvider`, and `StationCatalogProvider`, since the
scheduler and busker use the shared clock, wallet, and station catalog.
`FareProvider` belongs inside the game-state provider and exposes the paid-entry
and turnstile actions through `useStationEntry()`. `useGameControls()` from
`src/game-state/controls-context` exposes the UI actions, trip-loading status,
and active journey. See the [README example](../README.md#shared-state-and-controls)
for usage.
The Player state card at the end of the dashboard displays the current label
and fields, with **Not selected** for the app's initial `stationId: null`.
At startup, a picker fetches available station IDs from the backend's
`/all_stations` endpoint and resolves their names through the station catalog.
The picker and Player state card display names; the FSM keeps only station IDs.
Confirming a choice calls `selectStartingStation`,
updates the Player state card, and dismisses the picker. Supplying an
`initialStationId` skips the picker.

There is no direct state setter or reset event. Reloading, or choosing Start
New Game after quitting or Game Over, remounts the provider and creates a fresh machine in
**Outside**. Player controls and scheduled events both use the documented graph.

## Validation scenarios

1. **Complete journey:** start Outside, enter, wait, board, depart, request an
   exit, arrive in the station, and leave to return Outside.
2. **Immediate disembarkation:** enter, wait, board a stopped train, and use
   `GET_OFF_TRIP` to return to In Station before departure.
3. **Stay aboard:** alternate `DEPART_STATION` and `ARRIVE_AT_STATION` across
   multiple stops, remaining aboard until an exit is chosen.
4. **Cancel waiting:** `CANCEL_WAIT` returns a waiting player to In Station.
5. **Cancel an exit:** request an exit while moving, cancel it, and verify the
   next arrival leaves the player aboard in On Trip In Station.
6. **Reject invalid actions:** boarding from Outside, leaving while waiting or
   onboard, and `GET_OFF_TRIP` while in transit all leave the state unchanged.
7. **Exhaustive transitions:** verify all 77 combinations of seven states and
   eleven events: 17 succeed with the documented destination and 60 are rejected.
8. **Consecutive events and snapshots:** multiple valid events sent before a
   React rerender use the latest state. Rejected events preserve snapshot
   identity; successful events publish a new snapshot without changing earlier
   snapshots.
9. **State information:** station entry and exit preserve location; waiting
   cancellation restores station data; boarding and travel retain the selected
   trip; disembarkation uses the supplied parent station ID.
10. **Payload rejection:** missing or invalid required fields leave the model
    and snapshot unchanged, even for an otherwise allowed transition.
11. **Trip filtering:** include a departure at the current game time, exclude
    earlier departures and the next local midnight, and sort supplied trips
    without mutating their source list.
12. **Dwell time:** begin at 30 game seconds, account for boarding partway
    through a stop, clamp to zero after departure time, and derive progression
    from the shared clock. The pure model does not emit events; the journey
    layer sends the scheduled transition when the dwell ends.
13. **Journey progression:** board at arrival, depart after 30 game seconds,
    arrive at each next stop, handle several events within one clock tick,
    and automatically get off at the terminal.
14. **Trip requests and service dates:** use the local game date's service day,
    safely encode IDs, reject malformed schedules, preserve stops beyond
    midnight, and surface network failures or expired selections.
15. **Guarded refresh:** accept new trip data only for the current In Station
    station; reject stale or invalid updates without changing the snapshot.
16. **New session:** quit Outside, start again, choose a new station, and
    verify the clock, random wallet, FSM, offense history, and busker are fresh
    while the catalog remains. Repeat from Game Over.
17. **Station entry:** charge exactly $3 on paid entry; reject insufficient
    funds without moving or charging; enter freely on an uncaught jump; remain
    Outside after a warning or affordable fine. Repeated actions use the latest
    committed state and cannot double-charge an entry.
18. **Debt and terminal state:** verify warning/$50/$150 escalation, immediate
    Game Over after a fine produces debt, no Game Over at zero, and rejection
    of every event once terminal.
19. **Busking:** reserve setup and packing before boarding arrival, pay only
    completed earning minutes once, and preserve earnings on cancellation.
    Test short waits, restarted waits, boundary times, and accelerated ticks
    that cross boarding and multiple stops without missed or duplicate payouts.

## Scope

The frontend implements the runtime model, state information, player controls,
station and trip lookups, and automatic schedule progression. It consumes the
existing backend API without backend changes. The pure FSM remains event-driven;
the provider supplies schedule events and busking payouts from the shared game
clock. Fare actions connect paid entry and evasion penalties to the wallet and
FSM. Debt ends the session through `GAME_OVER`; the pure state machine does not
deduct or earn money itself.
