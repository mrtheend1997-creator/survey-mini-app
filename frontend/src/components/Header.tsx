import { Link } from 'react-router-dom'
import { useApp } from '../app-context'

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="FTI">
      <rect width="64" height="64" rx="16" fill="#0E2742" />
      <text x="32" y="40" textAnchor="middle" fontFamily="Arial,Helvetica,sans-serif" fontWeight="700" fontSize="22" fill="#fff">
        FTI
      </text>
      <rect x="14" y="46" width="36" height="4" rx="2" fill="#16A34A" />
    </svg>
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
          <Logo size={32} />
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
