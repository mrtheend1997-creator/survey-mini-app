import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, qs } from '../../api'
import { useApp } from '../../app-context'
import { LineChartView, PercentBars, PieChartView } from '../../components/Charts'
import { Button, Card, ErrorBox, KpiCard, SectionTitle, Segmented, Select, Spinner } from '../../components/ui'
import { useLoad } from '../../hooks'
import { formatDate, pick } from '../../i18n'
import { openDownload } from '../../telegram'
import type { QuestionResult, SurveyResults } from '../../types'

export function useExcelDownload() {
  const { lang, toast, showError, t } = useApp()
  const [busy, setBusy] = useState(false)
  const download = async (surveyId: number, versionId?: number | null) => {
    setBusy(true)
    try {
      const link = await api.post<{ url: string; file_name: string }>(`/api/admin/surveys/${surveyId}/export-link${qs({ lang, version_id: versionId })}`)
      openDownload(link.url, link.file_name)
      toast(t('downloadStarted'), 'info')
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }
  return { download, busy }
}

function QuestionCard({ q, n }: { q: QuestionResult; n: number }) {
  const { t, lang } = useApp()
  const [view, setView] = useState<'bar' | 'pie'>('bar')
  const st = q.stats
  return (
    <Card>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        {n}. {t(`qt_${q.qtype}`)}
        {q.removed && <span className="ml-2 text-amber-600">· {t('removedQuestion')}</span>}
      </div>
      <div className="mt-1 text-[17px] font-bold leading-snug">{pick(q, 'text', lang)}</div>
      <div className="mt-1 text-sm text-muted">{t('answeredCount', { n: q.answered })}</div>
      <div className="mt-4">
        {(st.kind === 'choice' || st.kind === 'rating') && (
          <>
            {st.kind === 'rating' && st.average != null && (
              <div className="mb-3 text-lg">
                {t('average')}: <b className="text-brand-600">{st.average}</b>
              </div>
            )}
            {st.items.length <= 10 && (
              <div className="mb-3">
                <Segmented
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'bar', label: `📊 ${t('barChart')}` },
                    { value: 'pie', label: `🥧 ${t('pieChart')}` },
                  ]}
                />
              </div>
            )}
            {view === 'bar' || st.items.length > 10 ? (
              <PercentBars
                items={st.items.map((i) => ({
                  label: pick(i, 'text', lang) + (i.removed ? ` (${t('removedOption')})` : ''),
                  count: i.count,
                  percent: i.percent,
                  muted: i.removed,
                }))}
              />
            ) : (
              <PieChartView data={st.items.map((i) => ({ label: pick(i, 'text', lang), value: i.count }))} />
            )}
            {st.kind === 'choice' && !!st.other_texts?.length && (
              <details className="mt-4">
                <summary className="cursor-pointer font-semibold">
                  {t('otherAnswers')} ({st.other_texts.length})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {st.other_texts.map((x, i) => (
                    <li key={i} className="rounded-xl bg-navy-50 px-3 py-2 text-[15px] dark:bg-white/5">
                      {x}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {st.kind === 'number' && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              [t('average'), st.average],
              [t('min'), st.min],
              [t('max'), st.max],
            ].map(([label, v]) => (
              <div key={String(label)} className="rounded-xl bg-navy-50 p-3 dark:bg-white/5">
                <div className="text-xs text-muted">{label}</div>
                <div className="text-xl font-bold">{v ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
        {st.kind === 'list' &&
          (st.values.length ? (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {st.values
                .slice()
                .reverse()
                .map((x, i) => (
                  <li key={i} className="rounded-xl bg-navy-50 px-3 py-2 text-[15px] dark:bg-white/5">
                    {q.qtype === 'date' ? formatDate(x, lang) : x}
                  </li>
                ))}
            </ul>
          ) : (
            <div className="text-muted">{t('noData')}</div>
          ))}
      </div>
    </Card>
  )
}

export default function AdminResults() {
  const { id } = useParams()
  const { t, lang, me, errorText } = useApp()
  const [versionId, setVersionId] = useState<number | null>(null)
  const { data, error, loading, reload } = useLoad(
    () => api.get<SurveyResults>(`/api/admin/surveys/${id}/results${qs({ version_id: versionId })}`),
    [id, versionId],
  )
  const { download, busy } = useExcelDownload()

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox text={errorText(error)} onRetry={reload} />

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold leading-tight">{t('results')}</h1>
      <div className="mt-1 text-[17px] font-semibold text-muted">{pick(data, 'title', lang)}</div>

      {me?.can_export && (
        <Button variant="success" block className="mt-4" onClick={() => download(data.survey_id, versionId)} loading={busy}>
          {t('downloadExcel')}
        </Button>
      )}

      {data.versions.length > 1 && (
        <div className="mt-3">
          <Select value={versionId ?? ''} onChange={(e) => setVersionId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('allVersions')}</option>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {t('versionLabel', { v: v.number })} · {formatDate(v.created_at, lang)}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label={t('participants')} value={data.participants} />
        <KpiCard label={t('completed')} value={data.completed} accent="green" />
        <KpiCard label={t('inProgress')} value={data.in_progress} />
        <KpiCard label={t('completionRate')} value={`${data.completion_rate}%`} accent="green" />
      </div>

      {data.per_day.length > 0 && (
        <Card className="mt-4">
          <div className="mb-2 font-semibold">{t('responsesPerDay')}</div>
          <LineChartView data={data.per_day.map((d) => ({ label: formatDate(d.day, lang).slice(0, 5), value: d.count }))} />
        </Card>
      )}

      <SectionTitle>{t('questions')}</SectionTitle>
      <div className="space-y-3">
        {data.questions.map((q, i) => (
          <QuestionCard key={q.id} q={q} n={i + 1} />
        ))}
        {data.questions.length === 0 && <div className="text-muted">{t('noData')}</div>}
      </div>
    </div>
  )
}
