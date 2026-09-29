import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GameClockProvider } from './game-clock/GameClockProvider'
import { WalletProvider } from './wallet/WalletProvider'
import { GameStateProvider } from './game-state/GameStateProvider'
import { GameOverWatcher } from './game-state/GameOverWatcher'
import { FareProvider } from './fare/FareProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameClockProvider>
      {/* Placeholder station until the game has station selection. */}
      <GameStateProvider initialStationId="101">
        <WalletProvider>
          <FareProvider>
            <GameOverWatcher />
            <App />
          </FareProvider>
        </WalletProvider>
      </GameStateProvider>
    </GameClockProvider>
  </StrictMode>,
)
