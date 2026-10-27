// Thin wrapper around window.Telegram.WebApp so the app also opens in a normal browser (dev mode).
import { getItem } from './storage'

type HapticStyle = 'light' | 'medium' | 'heavy'
interface TgWebApp {
  initData: string
  initDataUnsafe: { user?: { id: number; first_name?: string; language_code?: string } }
  colorScheme: 'light' | 'dark'
  version: string
  ready(): void
  expand(): void
  close(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  onEvent(event: string, cb: () => void): void
  offEvent(event: string, cb: () => void): void
  openLink?(url: string): void
  downloadFile?(params: { url: string; file_name: string }, cb?: (ok: boolean) => void): void
  isVersionAtLeast?(v: string): boolean
  disableVerticalSwipes?(): void
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
  HapticFeedback?: {
    impactOccurred(style: HapticStyle): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp }
  }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : undefined

export function initTelegram() {
  if (!tg) return
  // each call on its own: an older Telegram client may lack one of them
  for (const call of [() => tg?.ready(), () => tg?.expand(), () => tg?.disableVerticalSwipes?.()]) {
    try {
      call()
    } catch {
      /* not supported by this client */
    }
  }
}

/** Value for the Authorization header. */
export function authHeader(): string {
  if (tg?.initData) return `tma ${tg.initData}`
  // Local development without Telegram (works only when the server runs with DEV_MODE=true).
  const devId = getItem('fti_dev_user') || import.meta.env.VITE_DEV_TELEGRAM_ID || '1'
  return `dev ${devId}`
}

export function telegramUserId(): string {
  return String(tg?.initDataUnsafe.user?.id ?? getItem('fti_dev_user') ?? import.meta.env.VITE_DEV_TELEGRAM_ID ?? '1')
}

export function isDark(): boolean {
  if (tg) return tg.colorScheme === 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function applyTheme() {
  const dark = isDark()
  document.documentElement.classList.toggle('dark', dark)
  const header = dark ? '#0B1520' : '#F3F6FA'
  try {
    tg?.setHeaderColor?.(header)
    tg?.setBackgroundColor?.(header)
  } catch {
    /* older Telegram clients */
  }
}

export function onThemeChange(cb: () => void) {
  tg?.onEvent('themeChanged', cb)
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  mq?.addEventListener?.('change', cb)
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.selectionChanged(),
  success: () => tg?.HapticFeedback?.notificationOccurred('success'),
  error: () => tg?.HapticFeedback?.notificationOccurred('error'),
}

export function openDownload(url: string, fileName: string) {
  const absolute = new URL(url, window.location.origin).toString()
  if (tg?.downloadFile && tg.isVersionAtLeast?.('8.0')) {
    tg.downloadFile({ url: absolute, file_name: fileName })
  } else if (tg?.openLink) {
    tg.openLink(absolute)
  } else {
    const a = document.createElement('a')
    a.href = absolute
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}
