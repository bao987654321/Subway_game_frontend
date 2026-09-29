import { GameClock } from './components/GameClock'
import { Wallet } from './components/Wallet'

function App() {
  return (
    <main>
      <div className="game-dashboard">
        <Wallet />
        <GameClock />
      </div>
    </main>
  )
}

export default App
