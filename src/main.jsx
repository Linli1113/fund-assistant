import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { FundsProvider } from './lib/fundsContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FundsProvider>
      <App />
    </FundsProvider>
  </StrictMode>,
)
