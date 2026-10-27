import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, qs } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, Empty, ErrorBox, Modal, Spinner } from '../../components/ui'
import { useLoad } from '../../hooks'
import { formatDate, pick } from '../../i18n'
import { openDownload } from '../../telegram'
import type { AdminSurvey, UploadedFile } from '../../types'
import { useExcelDownload } from './AdminResults'

interface Respondent {
  name: string
  username: string
  phone: string
}
interface Row {
  id: number
  status: 'completed' | 'in_progress'
  started_at: string
  completed_at: string | null
  version_number: number
  answered: number
  question_count: number
  respondent: Respondent | null
}
interface Page {
  total: number
  items: Row[]
  anonymous: boolean
}
interface Detail {
  id: number
  status: string
  started_at: string
  completed_at: string | null
  version_number: number
  respondent: Respondent | null
  items: { question_id: number; text_uz: string; text_ru: string; answer: string; files: UploadedFile[] }[]
}

export default function AdminResponses() {
  const { id } = useParams()
  const { t, lang, me, errorText, showError } = useApp()
  const [status, setStatus] = useState<'' | 'completed' | 'in_progress'>('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const survey = useLoad(() => api.get<AdminSurvey>(`/api/admin/surveys/${id}`), [id])
  const list = useLoad(() => api.get<Page>(`/api/admin/surveys/${id}/responses${qs({ status, page, page_size: 20 })}`), [id, status, page])
  const { download, busy } = useExcelDownload()

  useEffect(() => {
    if (!list.data) return
    setTotal(list.data.total)
    setRows((prev) => (page === 1 ? list.data!.items : [...prev, ...list.data!.items.filter((x) => !prev.some((p) => p.id === x.id))]))
  }, [list.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeStatus = (s: typeof status) => {
    setPage(1)
    setRows([])
    setStatus(s)
  }

  const downloadFile = async (responseId: number, f: UploadedFile) => {
    try {
      const link = await api.post<{ url: string; file_name: string }>(`/api/admin/responses/${responseId}/file-link${qs({ key: f.key })}`)
      openDownload(link.url, link.file_name)
    } catch (e) {
      showError(e)
    }
  }

  const open = async (r: Row) => {
    try {
      setDetail(await api.get<Detail>(`/api/admin/responses/${r.id}${qs({ lang })}`))
    } catch (e) {
      showError(e)
    }
  }

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold">{t('responsesTitle')}</h1>
      {survey.data && <div className="mt-1 text-[17px] font-semibold text-muted">{pick(survey.data, 'title', lang)}</div>}
      {me?.can_export && (
        <Button variant="success" block className="mt-4" loading={busy} onClick={() => download(Number(id))}>
          {t('downloadExcel')}
        </Button>
      )}
      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
        {(['', 'completed', 'in_progress'] as const).map((s) => (
          <button
            key={s}
            onClick={() => changeStatus(s)}
            className={`min-h-[38px] shrink-0 rounded-full px-4 text-sm font-semibold ${status === s ? 'bg-navy-800 text-white dark:bg-navy-500' : 'bg-card ring-1 ring-line'}`}
          >
            {s === '' ? t('all') : s === 'completed' ? t('completed') : t('inProgress')}
          </button>
        ))}
        <span className="ml-auto self-center whitespace-nowrap text-sm text-muted">Σ {total}</span>
      </div>

      <div className="mt-4 space-y-2.5">
        {list.loading && page === 1 && <Spinner />}
        {!!list.error && <ErrorBox text={errorText(list.error)} onRetry={list.reload} />}
        {!list.loading && rows.length === 0 && !list.error && <Empty icon="📨" title={t('noResponses')} />}
        {rows.map((r, i) => (
          <Card key={r.id} onClick={() => open(r)} className="!p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">
                  #{total - i > 0 ? total - i : r.id} ·{' '}
                  {r.respondent ? r.respondent.name || (r.respondent.username ? `@${r.respondent.username}` : '—') : `🔒 ${t('anonymous')}`}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {formatDate(r.completed_at ?? r.started_at, lang, true)} · {t('answeredOf', { a: r.answered, n: r.question_count })} · v{r.version_number}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                  r.status === 'completed'
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                }`}
              >
                {r.status === 'completed' ? t('completed') : t('inProgress')}
              </span>
            </div>
          </Card>
        ))}
        {rows.length < total && (
          <Button variant="outline" block loading={list.loading} onClick={() => setPage((p) => p + 1)}>
            {t('loadMore')}
          </Button>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('responseDetail')}>
        {detail && (
          <div className="space-y-4">
            <div className="rounded-xl bg-navy-50 p-3 text-[15px] dark:bg-white/5">
              {detail.respondent ? (
                <>
                  <div className="font-semibold">{detail.respondent.name || '—'}</div>
                  {detail.respondent.username && <div>@{detail.respondent.username}</div>}
                  {detail.respondent.phone && <div>📞 {detail.respondent.phone}</div>}
                </>
              ) : (
                <div className="font-semibold">🔒 {t('anonymous')}</div>
              )}
              <div className="mt-1 text-sm text-muted">
                {t('startedAt')}: {formatDate(detail.started_at, lang, true)}
                {detail.completed_at && ` · ${t('completedAt')}: ${formatDate(detail.completed_at, lang, true)}`} · v{detail.version_number}
              </div>
            </div>
            {detail.items.map((it, i) => (
              <div key={it.question_id}>
                <div className="text-sm font-semibold text-muted">
                  {i + 1}. {pick(it, 'text', lang)}
                </div>
                {it.files?.length ? (
                  <div className="mt-1 space-y-1.5">
                    {it.files.map((f) => (
                      <Button key={f.key} size="sm" variant="outline" block onClick={() => downloadFile(detail.id, f)}>
                        📎 {f.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-0.5 whitespace-pre-line text-base">{it.answer || <span className="text-muted">{t('noAnswer')}</span>}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
