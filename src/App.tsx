import { GameClock } from './components/GameClock'
import { Wallet } from './components/Wallet'
import { PlayerState } from './components/PlayerState'
import { StartingStationPicker } from './components/StartingStationPicker'

function App() {
  return (
    <main>
      <div className="game-dashboard">
        <StartingStationPicker />
        <Wallet />
        <PlayerState />
        <GameClock />
      </div>
    </main>
  )
}

export default App
