import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// index.html sets an inline background on <html> to avoid a flash before CSS
// loads; drop it now or it overrides the themed background forever
document.documentElement.style.removeProperty('background')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
