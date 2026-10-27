import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, KpiCard, SectionTitle, Spinner, StatusBadge } from '../../components/ui'
import { useLoad } from '../../hooks'
import { pick } from '../../i18n'
import { meCan } from '../../permissions'
import type { AdminSurvey } from '../../types'

export interface Dashboard {
  date_from: string
  date_to: string
  kpi: { total_surveys: number; active_surveys: number; participants: number; completed: number; today: number }
  per_day: { day: string; count: number }[]
  status_counts: Record<string, number>
  surveys: { id: number; title_uz: string; title_ru: string; status: string; participants: number; completed: number; completion_rate: number }[]
}

export default function AdminHome() {
  const { t, lang, me } = useApp()
  const navigate = useNavigate()
  const dash = useLoad(() => api.get<Dashboard>('/api/admin/dashboard'))
  const surveys = useLoad(() => api.get<AdminSurvey[]>('/api/admin/surveys'))
  const manager = meCan(me, 'survey_create')
  const k = dash.data?.kpi

  return (
    <div>
      {manager && (
        <Button variant="success" block className="min-h-[60px] text-lg shadow-md" onClick={() => navigate('/admin/surveys/new')}>
          {t('createSurvey')}
        </Button>
      )}
      {dash.loading && !k ? (
        <Spinner />
      ) : (
        k && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label={t('kpi_total')} value={k.total_surveys} />
            <KpiCard label={t('kpi_active')} value={k.active_surveys} accent="green" />
            <KpiCard label={t('kpi_participants')} value={k.participants} />
            <KpiCard label={t('kpi_completed')} value={k.completed} accent="green" />
            <div className="col-span-2 sm:col-span-1">
              <KpiCard label={t('kpi_today')} value={k.today} />
            </div>
          </div>
        )
      )}

      <SectionTitle
        action={
          <Link to="/admin/surveys" className="text-sm font-semibold text-navy-500 dark:text-navy-200">
            {t('nav_surveys')} →
          </Link>
        }
      >
        {t('recentSurveys')}
      </SectionTitle>
      <div className="space-y-3">
        {surveys.loading && <Spinner />}
        {surveys.data?.slice(0, 5).map((s) => (
          <Card key={s.id} onClick={() => navigate(s.can_manage ? `/admin/surveys/${s.id}` : `/admin/results/${s.id}`)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold">{pick(s, 'title', lang)}</div>
                <div className="mt-1 text-sm text-muted">
                  ❓ {t('questionsCount', { n: s.question_count })} · 📨 {t('responsesShort', { n: s.completed_count })}
                </div>
              </div>
              <StatusBadge status={s.effective_status} />
            </div>
          </Card>
        ))}
        {surveys.data?.length === 0 && <div className="text-muted">{t('noData')}</div>}
      </div>

      <SectionTitle>{t('nav_stats')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { to: '/admin/results', label: t('nav_results'), icon: '📊' },
          { to: '/admin/stats', label: t('nav_stats'), icon: '📈' },
          { to: '/admin/responses', label: t('nav_responses'), icon: '📨' },
          { to: '/admin/settings', label: t('nav_settings'), icon: '⚙️' },
        ].map((x) => (
          <Link
            key={x.to}
            to={x.to}
            className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-card font-semibold shadow-sm"
          >
            <span className="text-2xl">{x.icon}</span>
            {x.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
