import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './app-context'
import { loadBranding } from './branding'
import { applyTheme, initTelegram, onThemeChange } from './telegram'
import './index.css'

declare global {
  interface Window {
    __ftiReport?: (kind: string, message: string) => void
  }
}

/** Instead of a blank window: a message, a reload button, and a report to the server log. */
class CrashScreen extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    window.__ftiReport?.('crash', `${error?.stack || error} ${info.componentStack?.slice(0, 300) ?? ''}`)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-md p-8 text-center leading-relaxed">
        <p className="font-semibold">Ilovada xatolik yuz berdi. Sahifani qayta yuklang.</p>
        <p className="mt-2 font-semibold">Произошла ошибка. Перезагрузите страницу.</p>
        <button className="mt-5 rounded-xl bg-navy-800 px-5 py-3 font-semibold text-white" onClick={() => location.reload()}>
          ↻
        </button>
      </div>
    )
  }
}

initTelegram()
applyTheme()
onThemeChange(applyTheme)
loadBranding()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashScreen>
      <HashRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </HashRouter>
    </CrashScreen>
  </StrictMode>,
)
