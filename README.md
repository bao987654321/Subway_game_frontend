# Subway Game Frontend

A React + TypeScript app powered by Vite, with a shared game clock and wallet.

## Run locally

Use Node.js 24 LTS and npm. From this directory:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173.

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
and eleven allowed transitions, starting in **Outside**. It includes leaving a
station and getting off a stopped train. This is a definition only; runtime
integration and controls will follow separately.

## Checks and production build

```sh
npm test
npm run lint
npm run build
npm run preview
```

The production build is written to `dist/`. Preview serves that build locally.

Backend integration is not included yet.
