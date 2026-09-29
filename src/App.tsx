import { GameClock } from './components/GameClock'
import { Wallet } from './components/Wallet'
import { PlayerState } from './components/PlayerState'

function App() {
  return (
    <main>
      <div className="game-dashboard">
        <Wallet />
        <PlayerState />
        <GameClock />
      </div>
    </main>
  )
}

export default App
