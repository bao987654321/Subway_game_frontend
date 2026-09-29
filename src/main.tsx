import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GameClockProvider } from './game-clock/GameClockProvider'
import { WalletProvider } from './wallet/WalletProvider'
import { GameStateProvider } from './game-state/GameStateProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameClockProvider>
      <GameStateProvider>
        <WalletProvider>
          <App />
        </WalletProvider>
      </GameStateProvider>
    </GameClockProvider>
  </StrictMode>,
)
