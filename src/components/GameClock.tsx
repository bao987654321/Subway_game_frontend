import { MAX_CLOCK_SPEED, MIN_CLOCK_SPEED } from '../game-clock/clock'
import { useGameClock } from '../game-clock/context'

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function GameClock() {
  const { gameTimeMs, speed, setSpeed } = useGameClock()

  return (
    <section className="clock-card" aria-labelledby="clock-title">
      <header className="clock-header">
        <div>
          <h1 id="clock-title">Game time</h1>
          <p className="clock-date">{dateFormatter.format(gameTimeMs)}</p>
        </div>
        <div className="clock-display">
          <time className="clock-time" dateTime={new Date(gameTimeMs).toISOString()}>
            {timeFormatter.format(gameTimeMs)}
          </time>
          <span className="clock-timezone">Local time</span>
        </div>
      </header>

      <div className="speed-control">
        <div className="speed-label">
          <label htmlFor="game-clock-speed">Game clock speed</label>
          <output htmlFor="game-clock-speed">{speed}x</output>
        </div>
        <input
          id="game-clock-speed"
          type="range"
          min={MIN_CLOCK_SPEED}
          max={MAX_CLOCK_SPEED}
          step={0.5}
          value={speed}
          aria-valuetext={`${speed} times normal speed`}
          onChange={(event) => setSpeed(event.currentTarget.valueAsNumber)}
        />
        <div className="speed-endpoints" aria-hidden="true">
          <span>{MIN_CLOCK_SPEED}x</span>
          <span>{MAX_CLOCK_SPEED}x</span>
        </div>
      </div>

      <p className="clock-note">
        Game time pauses when this tab is hidden. Press N for 1×.
      </p>
    </section>
  )
}
