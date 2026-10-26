import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { translate, type Key, type Lang } from './i18n'
import type { Me } from './types'
import { haptic, tg } from './telegram'

interface Toast {
  id: number
  text: string
  kind: 'success' | 'error' | 'info'
}

interface Ctx {
  me: Me | null
  setMe: (m: Me) => void
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: Key, vars?: Record<string, string | number>) => string
  toast: (text: string, kind?: Toast['kind']) => void
  errorText: (e: unknown) => string
  showError: (e: unknown) => void
}

const AppCtx = createContext<Ctx | null>(null)

function initialLang(): Lang {
  const saved = localStorage.getItem('fti_lang')
  if (saved === 'uz' || saved === 'ru') return saved
  const code = tg?.initDataUnsafe.user?.language_code ?? ''
  return code.startsWith('ru') ? 'ru' : 'uz' // Uzbek is the main language
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem('fti_lang', l)
    haptic.tap()
    api
      .patch<Me>('/api/me', { language: l })
      .then(setMe)
      .catch(() => undefined)
  }, [])

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = nextId.current++
    setToasts((ts) => [...ts, { id, text, kind }])
    if (kind === 'error') haptic.error()
    else if (kind === 'success') haptic.success()
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3200)
  }, [])

  const errorText = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.code === 'network') return translate(lang, 'errorNetwork')
        return e.text(lang) || translate(lang, 'errorGeneric')
      }
      return translate(lang, 'errorGeneric')
    },
    [lang],
  )
  const showError = useCallback((e: unknown) => toast(errorText(e), 'error'), [toast, errorText])

  const value = useMemo(() => ({ me, setMe, lang, setLang, t, toast, errorText, showError }), [me, lang, setLang, t, toast, errorText, showError])

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((x) => (
          <div
            key={x.id}
            role="status"
            className={`animate-slide-up pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-[15px] font-medium text-white shadow-lg ${
              x.kind === 'error' ? 'bg-red-600' : x.kind === 'info' ? 'bg-navy-700' : 'bg-brand-600'
            }`}
          >
            {x.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  )
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}
