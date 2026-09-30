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
import { FareProvider } from './fare/FareProvider'
import { GameOverWatcher } from './game-state/GameOverWatcher'
import { Busking } from './components/Busking'
import { useGameState } from './game-state/context'
import { useWallet } from './wallet/context'

function GameSession({ onRestart }: { onRestart: () => void }) {
  const { state } = useGameState()
  const { balance } = useWallet()
  if (state === 'game_over') {
    return (
      <section className="session-ended" aria-labelledby="game-over-title">
        <h1 id="game-over-title">Game over</h1>
        <p>Your balance went below zero (${balance.toFixed(2)}).</p>
        <button type="button" onClick={onRestart}>Start New Game</button>
      </section>
    )
  }
  return (
    <>
      <GameClock />
      <StartingStationPicker />
      <Wallet />
      <Busking />
      <RouteProgress />
      <RouteMap />
      <PlayerState />
    </>
  )
}

function App() {
  const [playing, setPlaying] = useState(true)
  const [sessionId, setSessionId] = useState(0)
  return (
    <main>
      <div className="game-dashboard">
        {playing ? (
          <GameClockProvider key={sessionId}>
            <WalletProvider>
              <GameStateProvider onQuit={() => setPlaying(false)}>
                <FareProvider>
                  <GameOverWatcher />
                  <GameSession onRestart={() => setSessionId((value) => value + 1)} />
                </FareProvider>
              </GameStateProvider>
            </WalletProvider>
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
