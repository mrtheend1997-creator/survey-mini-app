import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../app-context'
import { Header } from '../components/Header'
import { Button, Card, Segmented } from '../components/ui'
import { useLoad, useTelegramBack } from '../hooks'
import { pick } from '../i18n'

export default function Profile() {
  const { me, t, lang, setLang } = useApp()
  const navigate = useNavigate()
  useTelegramBack('/')
  const stats = useLoad(() => api.get<{ completed_surveys: number }>('/api/my/stats'))
  const settings = useLoad(() => api.get<Record<string, string>>('/api/settings/public'))
  if (!me) return null
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ')
  return (
    <div className="min-h-screen pb-10">
      <Header />
      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-5">
        <Card className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-navy-800 text-2xl font-bold uppercase text-white dark:bg-navy-500">
            {(me.first_name?.[0] ?? '') + (me.last_name?.[0] ?? '') || '👤'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xl font-bold">{name || '—'}</div>
            {me.username && <div className="text-muted">@{me.username}</div>}
            <div className="text-sm text-muted">Telegram ID: {me.telegram_id}</div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-muted">{t('role')}</span>
            <span className="font-semibold">{t(`role_${me.role}` as 'role_user')}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-muted">{t('completedSurveys')}</span>
            <span className="text-xl font-bold text-brand-600">{stats.data?.completed_surveys ?? '…'}</span>
          </div>
        </Card>
        <Card>
          <div className="mb-2 font-semibold">{t('interfaceLang')}</div>
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: 'uz', label: t('langUz') },
              { value: 'ru', label: t('langRu') },
            ]}
          />
        </Card>
        {(settings.data?.support_contact || pick(settings.data, 'org_name', lang)) && (
          <Card>
            {pick(settings.data, 'org_name', lang) && <div className="font-semibold">{pick(settings.data, 'org_name', lang)}</div>}
            {settings.data?.support_contact && (
              <div className="mt-1 text-muted">
                {t('support')}: {settings.data.support_contact}
              </div>
            )}
          </Card>
        )}
        {me.can_admin && (
          <Button block variant="outline" onClick={() => navigate('/admin')}>
            {t('adminPanel')}
          </Button>
        )}
        <Button block variant="ghost" onClick={() => navigate('/')}>
          {t('toHome')}
        </Button>
      </main>
    </div>
  )
}
