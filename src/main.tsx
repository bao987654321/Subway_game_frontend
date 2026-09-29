import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StationCatalogProvider } from './stations/StationCatalogProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StationCatalogProvider>
      <App />
    </StationCatalogProvider>
  </StrictMode>,
)
