import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { translate, type Key, type Lang } from './i18n'
import { getItem, setItem } from './storage'
import type { Me } from './types'
import { haptic } from './telegram'

interface Toast {
  id: number
  text: string
  kind: 'success' | 'error' | 'info'
}

interface Ctx {
  me: Me | null
  setMe: (m: Me) => void
  lang: Lang
  applyProfileLang: (m: Me) => void
  setLang: (l: Lang) => void
  t: (key: Key, vars?: Record<string, string | number>) => string
  toast: (text: string, kind?: Toast['kind']) => void
  errorText: (e: unknown) => string
  showError: (e: unknown) => void
}

const AppCtx = createContext<Ctx | null>(null)

function initialLang(): Lang {
  // only a language the user picked themselves is remembered; everyone else starts in Uzbek
  // (whatever language Telegram uses) until the profile from the server says otherwise
  const saved = getItem(LANG_KEY)
  return saved === 'uz' || saved === 'ru' ? saved : 'uz'
}

const LANG_KEY = 'fti_lang_chosen'

/** The language from the profile: the user's own choice, or the default set by the Super Admin. */
export function profileLang(m: Me): Lang {
  return m.language === 'ru' ? 'ru' : 'uz'
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
    setItem(LANG_KEY, l)
    haptic.tap()
    api
      .patch<Me>('/api/me', { language: l })
      .then(setMe)
      .catch(() => undefined)
  }, [])

  const applyProfileLang = useCallback((m: Me) => {
    const l = profileLang(m)
    setLangState(l)
    if (m.language_chosen) setItem(LANG_KEY, l)
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

  const value = useMemo(
    () => ({ me, setMe, lang, setLang, applyProfileLang, t, toast, errorText, showError }),
    [me, lang, setLang, applyProfileLang, t, toast, errorText, showError],
  )

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
