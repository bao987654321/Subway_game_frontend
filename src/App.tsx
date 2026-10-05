import { useState } from 'react'
import { GameClock } from './components/GameClock'
import { Wallet } from './components/Wallet'
import { PlayerState } from './components/PlayerState'
import { StartingStationPicker } from './components/StartingStationPicker'
import { GameClockProvider } from './game-clock/GameClockProvider'
import { GameStateProvider } from './game-state/GameStateProvider'
import { WalletProvider } from './wallet/WalletProvider'
import { RouteProgress } from './components/RouteProgress'
import { RouteMap } from './components/RouteMap'
import { GameTripLetters } from './components/GameTripLetters'

function App() {
  const [playing, setPlaying] = useState(true)
  return (
    <main>
      <div className="game-dashboard">
        {playing ? (
          <GameClockProvider>
            <GameStateProvider onQuit={() => setPlaying(false)}>
              <WalletProvider>
                <GameTripLetters />
                <GameClock />
                <StartingStationPicker />
                <Wallet />
                <RouteProgress />
                <RouteMap />
                <PlayerState />
              </WalletProvider>
            </GameStateProvider>
          </GameClockProvider>
        ) : (
          <section className="session-ended">
            <h1>Game ended</h1>
            <p>Start a new game to choose a station and take another trip.</p>
            <button type="button" onClick={() => setPlaying(true)}>Start New Game</button>
          </section>
        )}
      </div>
    </main>
  )
}

export default App
