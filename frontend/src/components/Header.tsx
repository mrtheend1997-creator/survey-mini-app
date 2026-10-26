import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DEFAULT_LOGO, useLogoUrl } from '../branding'
import { useApp } from '../app-context'

/** The organisation logo. Never cropped or recoloured; sits on a white plate so it reads in dark mode too. */
export function Logo({ size, className = '' }: { size?: number; className?: string }) {
  const { url, custom } = useLogoUrl()
  const [failed, setFailed] = useState<string | null>(null)
  const src = failed === url ? DEFAULT_LOGO : url
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-sm ring-1 ring-black/5 ${custom ? 'rounded-xl p-[6%]' : 'rounded-full'} ${className}`}
      style={size ? { width: size, height: size } : undefined}
    >
      <img
        src={src}
        alt="FTI"
        width={size}
        height={size}
        decoding="async"
        draggable={false}
        onError={() => setFailed(url)}
        className="h-full w-full select-none object-contain"
      />
    </span>
  )
}

export function LangSwitch({ compact }: { compact?: boolean }) {
  const { lang, setLang, t } = useApp()
  return (
    <div className="flex items-center rounded-full border border-line bg-card p-0.5 text-[13px] font-semibold" role="group" aria-label="Language">
      <span className="pl-1.5 pr-0.5" aria-hidden>
        🌐
      </span>
      {(['uz', 'ru'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`min-h-[34px] rounded-full px-2 transition ${lang === l ? 'bg-navy-800 text-white dark:bg-navy-500' : 'text-muted'}`}
        >
          {compact ? l.toUpperCase() : l === 'uz' ? t('langUz') : t('langRu')}
        </button>
      ))}
    </div>
  )
}

export function Header() {
  const { me, t } = useApp()
  const initials = (me?.first_name?.[0] ?? '') + (me?.last_name?.[0] ?? '')
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-1.5 px-4 py-2.5">
        <Link to="/" className="flex min-w-0 items-center gap-1.5">
          <Logo size={36} />
          <span className="whitespace-nowrap text-[15px] font-bold leading-tight max-[359px]:hidden">{t('appName')}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <LangSwitch />
          <Link
            to="/profile"
            aria-label={t('profile')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-800 text-sm font-bold uppercase text-white dark:bg-navy-500"
          >
            {initials || '👤'}
          </Link>
        </div>
      </div>
    </header>
  )
}
