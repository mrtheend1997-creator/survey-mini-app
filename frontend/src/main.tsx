import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './app-context'
import { loadBranding } from './branding'
import { applyTheme, initTelegram, onThemeChange } from './telegram'
import './index.css'

initTelegram()
applyTheme()
onThemeChange(applyTheme)
loadBranding()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </StrictMode>,
)
