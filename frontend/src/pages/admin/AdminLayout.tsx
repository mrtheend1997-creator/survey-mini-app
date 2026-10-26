import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../../app-context'
import { LangSwitch, Logo } from '../../components/Header'
import { useTelegramBack } from '../../hooks'
import type { Key } from '../../i18n'

const NAV: { to: string; icon: string; key: Key; superOnly?: boolean }[] = [
  { to: '/admin', icon: '🏠', key: 'nav_home' },
  { to: '/admin/surveys', icon: '📋', key: 'nav_surveys' },
  { to: '/admin/questions', icon: '❓', key: 'nav_questions' },
  { to: '/admin/responses', icon: '📨', key: 'nav_responses' },
  { to: '/admin/results', icon: '📊', key: 'nav_results' },
  { to: '/admin/stats', icon: '📈', key: 'nav_stats' },
  { to: '/admin/admins', icon: '👥', key: 'nav_admins', superOnly: true },
  { to: '/admin/users', icon: '🙋', key: 'nav_users', superOnly: true },
  { to: '/admin/settings', icon: '⚙️', key: 'nav_settings' },
]

export default function AdminLayout() {
  const { t, me } = useApp()
  const location = useLocation()
  const navRef = useRef<HTMLDivElement>(null)
  useTelegramBack()
  const items = NAV.filter((n) => me?.role === 'super_admin' || !n.superOnly)

  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [location.pathname])

  return (
    <div className="min-h-screen pb-12">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 pt-2.5">
          <Logo size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-bold leading-tight">{t('adminPanel').replace('⚙️ ', '')}</div>
            <Link to="/" className="block truncate text-xs font-semibold text-muted">
              {t('exitAdmin')}
            </Link>
          </div>
          <LangSwitch compact />
        </div>
        <nav ref={navRef} className="no-scrollbar mx-auto flex max-w-5xl gap-1.5 overflow-x-auto px-4 py-2.5">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/admin'}
              className={({ isActive }) =>
                `flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition ${
                  isActive ? 'bg-navy-800 text-white dark:bg-navy-500' : 'bg-card text-ink ring-1 ring-line'
                }`
              }
            >
              <span aria-hidden>{n.icon}</span>
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-4">
        <Outlet />
      </main>
    </div>
  )
}
