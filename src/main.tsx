import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GameClockProvider } from './game-clock/GameClockProvider'
import { WalletProvider } from './wallet/WalletProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <GameClockProvider>
        <App />
      </GameClockProvider>
    </WalletProvider>
  </StrictMode>,
)
