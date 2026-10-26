import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../../api'
import { useApp } from '../../app-context'
import { BarChartView, LineChartView, PieChartView } from '../../components/Charts'
import { Button, Card, ErrorBox, Input, KpiCard, Label, Select, Spinner, StatusBadge } from '../../components/ui'
import { useLoad } from '../../hooks'
import { formatDate, pick } from '../../i18n'
import type { AdminSurvey } from '../../types'
import type { Dashboard } from './AdminHome'

export default function AdminStats() {
  const { t, lang, errorText } = useApp()
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ survey_id: '', date_from: '', date_to: '' })
  const [applied, setApplied] = useState(filters)
  const surveys = useLoad(() => api.get<AdminSurvey[]>('/api/admin/surveys'))
  const { data, error, loading, reload } = useLoad(() => api.get<Dashboard>(`/api/admin/dashboard${qs(applied)}`), [applied])

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold">{t('nav_stats')}</h1>

      <Card className="mt-4">
        <div className="mb-3 font-semibold">🔎 {t('filters')}</div>
        <div className="space-y-3">
          <Select value={filters.survey_id} onChange={(e) => setFilters({ ...filters, survey_id: e.target.value })}>
            <option value="">{t('allSurveys')}</option>
            {surveys.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {pick(s, 'title', lang)}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('dateFrom')}</Label>
              <Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
            </div>
            <div>
              <Label>{t('dateTo')}</Label>
              <Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                const empty = { survey_id: '', date_from: '', date_to: '' }
                setFilters(empty)
                setApplied(empty)
              }}
            >
              {t('reset')}
            </Button>
            <Button size="md" onClick={() => setApplied(filters)}>
              {t('apply')}
            </Button>
          </div>
        </div>
      </Card>

      {loading && !data && <Spinner />}
      {!!error && <ErrorBox text={errorText(error)} onRetry={reload} />}
      {data && (
        <>
          <div className="mt-2 text-center text-sm text-muted">
            {formatDate(data.date_from, lang)} — {formatDate(data.date_to, lang)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label={t('kpi_total')} value={data.kpi.total_surveys} />
            <KpiCard label={t('kpi_active')} value={data.kpi.active_surveys} accent="green" />
            <KpiCard label={t('kpi_participants')} value={data.kpi.participants} />
            <KpiCard label={t('kpi_completed')} value={data.kpi.completed} accent="green" />
            <div className="col-span-2 sm:col-span-1">
              <KpiCard label={t('kpi_today')} value={data.kpi.today} />
            </div>
          </div>

          <Card className="mt-4">
            <div className="mb-2 font-semibold">📈 {t('responsesPerDay')}</div>
            <LineChartView data={data.per_day.map((d) => ({ label: formatDate(d.day, lang).slice(0, 5), value: d.count }))} />
          </Card>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <div className="mb-2 font-semibold">🥧 {t('surveysByStatus')}</div>
              <PieChartView
                data={(['draft', 'active', 'paused', 'finished'] as const).map((s) => ({ label: t(`status_${s}`), value: data.status_counts[s] ?? 0 }))}
              />
            </Card>
            <Card>
              <div className="mb-2 font-semibold">📊 {t('completedBySurvey')}</div>
              {data.surveys.some((s) => s.completed > 0) ? (
                <BarChartView data={data.surveys.slice(0, 8).map((s) => ({ label: pick(s, 'title', lang), value: s.completed }))} />
              ) : (
                <div className="py-10 text-center text-muted">{t('noData')}</div>
              )}
            </Card>
          </div>

          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[520px] text-left text-[15px]">
              <thead className="bg-navy-50 text-sm text-muted dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3">{t('survey')}</th>
                  <th className="px-3 py-3">{t('status')}</th>
                  <th className="px-3 py-3 text-right">{t('participants')}</th>
                  <th className="px-3 py-3 text-right">{t('completed')}</th>
                  <th className="px-4 py-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {data.surveys.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-black/5" onClick={() => navigate(`/admin/results/${s.id}`)}>
                    <td className="px-4 py-3 font-medium">{pick(s, 'title', lang)}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-3 text-right">{s.participants}</td>
                    <td className="px-3 py-3 text-right font-semibold">{s.completed}</td>
                    <td className="px-4 py-3 text-right">{s.completion_rate}%</td>
                  </tr>
                ))}
                {data.surveys.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted">
                      {t('noData')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
