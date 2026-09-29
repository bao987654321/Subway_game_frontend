import { GameClock } from './components/GameClock'
import { Wallet } from './components/Wallet'
import { PlayerState } from './components/PlayerState'
import { StationEntry } from './components/StationEntry'
import { Busking } from './components/Busking'

function App() {
  return (
    <main>
      <div className="game-dashboard">
        <Wallet />
        <PlayerState />
        <StationEntry />
        <Busking />
        <GameClock />
      </div>
    </main>
  )
}

export default App
