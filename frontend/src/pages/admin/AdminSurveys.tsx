import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Spinner, StatusBadge } from '../../components/ui'
import { useLoad } from '../../hooks'
import { formatDate, pick } from '../../i18n'
import type { AdminSurvey } from '../../types'

const STATUSES = ['', 'draft', 'active', 'paused', 'finished'] as const

export default function AdminSurveys() {
  const { t, lang, me, toast, showError, errorText } = useApp()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('')
  const [toDelete, setToDelete] = useState<AdminSurvey | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, error, loading, reload } = useLoad(() => api.get<AdminSurvey[]>(`/api/admin/surveys${qs({ q, status })}`), [status])
  const manager = me?.role === 'admin' || me?.role === 'super_admin'

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      toast(msg)
      reload()
    } catch (e) {
      showError(e)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('nav_surveys')}</h1>
      </div>
      {manager && (
        <Button variant="success" block className="mt-3 min-h-[58px] text-lg" onClick={() => navigate('/admin/surveys/new')}>
          {t('createSurvey')}
        </Button>
      )}
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault()
          reload()
        }}
      >
        <Input type="search" value={q} placeholder={t('search')} onChange={(e) => setQ(e.target.value)} onBlur={() => reload()} />
      </form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`min-h-[38px] shrink-0 rounded-full px-4 text-sm font-semibold ${status === s ? 'bg-navy-800 text-white dark:bg-navy-500' : 'bg-card ring-1 ring-line'}`}
          >
            {s ? t(`status_${s}` as 'status_draft') : t('all')}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {loading && <Spinner />}
        {!!error && <ErrorBox text={errorText(error)} onRetry={reload} />}
        {data?.length === 0 && <Empty title={t('noData')} />}
        {data?.map((s) => (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[17px] font-bold leading-snug">{pick(s, 'title', lang) || '—'}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted">
                  <span>❓ {t('questionsCount', { n: s.question_count })}</span>
                  <span>📨 {t('responsesShort', { n: s.completed_count })}</span>
                  <span>{s.version_number ? t('versionLabel', { v: s.version_number }) : t('notPublishedYet')}</span>
                  {s.end_date && <span>📅 {formatDate(s.end_date, lang)}</span>}
                </div>
                {s.has_unpublished_changes && <div className="mt-1 text-sm font-semibold text-amber-600">● {t('publishChanges').replace('🚀 ', '')}</div>}
              </div>
              <StatusBadge status={s.effective_status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {s.can_manage && (
                <>
                  <Button size="md" variant="primary" onClick={() => navigate(`/admin/surveys/${s.id}`)}>
                    {t('edit')}
                  </Button>
                  <Button size="md" variant="soft" onClick={() => navigate(`/admin/surveys/${s.id}/questions`)}>
                    ❓ {t('questions')}
                  </Button>
                </>
              )}
              <Button size="md" variant="soft" onClick={() => navigate(`/admin/surveys/${s.id}/preview`)}>
                {t('preview')}
              </Button>
              <Button size="md" variant="soft" onClick={() => navigate(`/admin/results/${s.id}`)}>
                {t('results')}
              </Button>
              {s.can_manage && s.status === 'active' && (
                <Button
                  size="md"
                  variant="outline"
                  onClick={() => act(() => api.post(`/api/admin/surveys/${s.id}/status`, { status: 'paused' }), t('savedOk'))}
                >
                  {t('pause')}
                </Button>
              )}
              {s.can_manage && s.status !== 'active' && (
                <Button
                  size="md"
                  variant="success"
                  onClick={() =>
                    act(
                      () =>
                        s.published_version_id
                          ? api.post(`/api/admin/surveys/${s.id}/status`, { status: 'active' })
                          : api.post(`/api/admin/surveys/${s.id}/publish`),
                      t('publishedOk'),
                    )
                  }
                >
                  {s.published_version_id ? t('resume') : t('publish')}
                </Button>
              )}
              {s.can_manage && (
                <Button size="md" variant="outline" onClick={() => act(() => api.post(`/api/admin/surveys/${s.id}/duplicate`), t('savedOk'))}>
                  {t('duplicate')}
                </Button>
              )}
              {s.can_manage && (
                <Button size="md" variant="outline" className="!text-red-600" onClick={() => setToDelete(s)}>
                  {t('delete')}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={busy}
        text={t('confirmDeleteSurvey')}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return
          setBusy(true)
          await act(() => api.del(`/api/admin/surveys/${toDelete.id}`), t('deletedOk'))
          setBusy(false)
          setToDelete(null)
        }}
      />
    </div>
  )
}
