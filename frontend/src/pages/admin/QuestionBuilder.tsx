import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { SortableList } from '../../components/Sortable'
import { Button, Card, ConfirmDialog, Empty, ErrorBox, Spinner, StatusBadge } from '../../components/ui'
import { useLoad } from '../../hooks'
import { pick } from '../../i18n'
import { can } from '../../permissions'
import { QTYPE_ICON } from '../../qtypes'
import type { AdminSurvey, Jump, QuestionT } from '../../types'

interface LogicProblem {
  question_id: number
  code: string
}
interface LogicCheck {
  errors: LogicProblem[]
  warnings: LogicProblem[]
}
import QuestionEditor, { IconBtn } from './QuestionEditor'

export default function QuestionBuilder() {
  const { id } = useParams()
  const surveyId = Number(id)
  const navigate = useNavigate()
  const { t, lang, toast, showError, errorText } = useApp()
  const { data: s, error, loading, reload, setData } = useLoad(() => api.get<AdminSurvey>(`/api/admin/surveys/${surveyId}`), [surveyId])
  const check = useLoad(() => api.get<LogicCheck>(`/api/admin/surveys/${surveyId}/logic-check`), [surveyId, s])
  const [editing, setEditing] = useState<QuestionT | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [toDelete, setToDelete] = useState<QuestionT | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [busy, setBusy] = useState(false)

  const openEditor = (q: QuestionT | null) => {
    setEditing(q)
    setEditorOpen(true)
  }

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      if (msg) toast(msg)
      await reload()
    } catch (e) {
      showError(e)
    }
  }

  const move = async (q: QuestionT, direction: 'up' | 'down') => {
    // optimistic reorder for a snappy feel
    if (s?.questions) {
      const list = [...s.questions]
      const i = list.findIndex((x) => x.id === q.id)
      const j = direction === 'up' ? i - 1 : i + 1
      if (j >= 0 && j < list.length) {
        ;[list[i], list[j]] = [list[j], list[i]]
        setData({ ...s, questions: list })
      }
    }
    await act(() => api.post(`/api/admin/questions/${q.id}/move`, { direction }))
  }

  const reorder = async (list: QuestionT[]) => {
    if (!s) return
    setData({ ...s, questions: list })
    await act(() => api.post(`/api/admin/surveys/${s.id}/questions/reorder`, { question_ids: list.map((x) => x.id) }))
  }

  if (loading && !s) return <Spinner />
  if (error || !s) return <ErrorBox text={errorText(error)} onRetry={reload} />
  const questions = s.questions ?? []
  // questions are numbered without the sections, like in a printed questionnaire
  const numbers: Record<number, number> = {}
  questions.filter((x) => x.qtype !== 'section').forEach((x, k) => (numbers[x.id] = k + 1))
  const label = (id: number): string => {
    const x = questions.find((y) => y.id === id)
    if (!x) return '—'
    return x.qtype === 'section' ? `📂 ${pick(x, 'text', lang)}` : `${t('questionN', { n: numbers[x.id] })}`
  }
  const jumpWhen = (q: QuestionT, when: Jump['when']): string => {
    if (when === '*') return t('jumpAny')
    if (when === 'yes' || when === 'no' || when === 'unsure') return t(when)
    const o = q.options.find((x) => x.id === when)
    return o ? `«${pick(o, 'text', lang)}»` : '?'
  }
  const canQuestions = can(s, 'question_manage')
  const canPublish = can(s, 'publish')
  const addButton = canQuestions && (
    <Button variant="success" block className="min-h-[58px] text-lg" onClick={() => openEditor(null)}>
      {t('addQuestion')}
    </Button>
  )

  return (
    <div className="pb-8">
      <button onClick={() => navigate(`/admin/surveys/${s.id}`)} className="text-sm font-semibold text-muted">
        ← {pick(s, 'title', lang)}
      </button>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {t('questions')} <span className="text-muted">({Object.keys(numbers).length})</span>
        </h1>
        <StatusBadge status={s.effective_status} />
      </div>

      {s.has_unpublished_changes && (
        <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <div>{t('unpublishedChanges', { v: s.version_number ?? 1 })}</div>
          <Button variant="success" size="md" className="mt-3" disabled={!canPublish} onClick={() => setConfirmPublish(true)}>
            {t('publishChanges')}
          </Button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="soft" size="md" onClick={() => navigate(`/admin/surveys/${s.id}/preview`)}>
          {t('preview')}
        </Button>
        {!s.published_version_id ? (
          <Button variant="primary" size="md" onClick={() => setConfirmPublish(true)} disabled={!questions.length || !canPublish}>
            {t('publish')}
          </Button>
        ) : (
          <Button variant="soft" size="md" onClick={() => navigate(`/admin/results/${s.id}`)}>
            {t('results')}
          </Button>
        )}
      </div>

      <div className="mt-4">{addButton}</div>

      {!!check.data && (check.data.errors.length > 0 || check.data.warnings.length > 0) && (
        <div className="mt-4 space-y-2">
          {check.data.errors.map((p, k) => (
            <div
              key={`e${k}`}
              className="rounded-2xl border border-red-300 bg-red-50 p-3 text-[15px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            >
              ⛔ {t('logicIn', { n: label(p.question_id) })}: {t(`lc_${p.code}` as 'lc_logic_backward')}
            </div>
          ))}
          {check.data.warnings.map((p, k) => (
            <div
              key={`w${k}`}
              className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              ⚠️ {t('logicIn', { n: label(p.question_id) })}: {t(`lc_${p.code}` as 'lc_logic_backward')}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        {questions.length === 0 && <Empty icon="❓" title={t('noQuestions')} hint={t('noQuestionsHint')} />}
        <SortableList
          items={questions}
          getKey={(q) => q.id}
          onChange={reorder}
          handleLabel={t('dragToMove')}
          render={(q, i, handle) => (
            <Card className={q.qtype === 'section' ? 'border-l-4 !border-l-navy-500' : ''}>
              <div className="flex items-start gap-3">
                {canQuestions && <div className="-ml-2 -mt-1.5">{handle}</div>}
                {q.qtype === 'section' ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center text-xl">📂</span>
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-800 text-sm font-bold text-white dark:bg-navy-500">
                    {numbers[q.id]}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {QTYPE_ICON[q.qtype]} {t(`qt_${q.qtype}`)}
                    {q.required && <span className="ml-2 text-red-600">● {t('required')}</span>}
                    {q.hidden && <span className="ml-2 text-amber-600">🙈 {t('hiddenBadge')}</span>}
                  </div>
                  <div className="mt-0.5 font-semibold leading-snug">{pick(q, 'text', lang)}</div>
                  {q.options.length > 0 && !q.settings?.rows?.length && (
                    <ul className="mt-2 space-y-0.5 text-[15px] text-muted">
                      {q.options.slice(0, 6).map((o) => (
                        <li key={o.id}>○ {pick(o, 'text', lang)}</li>
                      ))}
                      {q.options.length > 6 && <li>… +{q.options.length - 6}</li>}
                      {q.allow_other && <li>○ {t('other')}…</li>}
                    </ul>
                  )}
                  {!!q.settings?.rows?.length && (
                    <div className="mt-1 text-sm text-muted">
                      ▤ {q.settings.rows.length} {t('matrixRowsShort')} × {q.options.length} {t('matrixColumnsShort')}
                    </div>
                  )}
                  {q.qtype === 'section' && pick(q, 'description', lang) && <div className="mt-1 text-sm text-muted">{pick(q, 'description', lang)}</div>}
                  {!!q.logic?.jumps.length && (
                    <ul className="mt-2 space-y-0.5 text-sm font-medium text-navy-700 dark:text-navy-200">
                      {q.logic.jumps.map((j, k) => (
                        <li key={k}>
                          ↪ {jumpWhen(q, j.when)} → {j.to === 'end' ? `🏁 ${t('jumpEnd')}` : label(j.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(q.image_url || q.video_url) && (
                    <div className="mt-1 text-sm text-muted">
                      {q.image_url && `🖼️ ${t('image')} `}
                      {q.video_url && `🎬 ${t('video')}`}
                    </div>
                  )}
                </div>
              </div>
              {canQuestions && (
                <div className="mt-3 flex gap-1.5">
                  <Button size="sm" variant="primary" className="min-w-0 flex-1" onClick={() => openEditor(q)}>
                    {t('change')}
                  </Button>
                  <IconBtn label="📑" title={t('duplicate')} onClick={() => act(() => api.post(`/api/admin/questions/${q.id}/duplicate`), t('savedOk'))} />
                  <IconBtn label="⬆️" title={t('moveUp')} disabled={i === 0} onClick={() => move(q, 'up')} />
                  <IconBtn label="⬇️" title={t('moveDown')} disabled={i === questions.length - 1} onClick={() => move(q, 'down')} />
                  <IconBtn label="🗑️" title={t('delete')} onClick={() => setToDelete(q)} />
                </div>
              )}
            </Card>
          )}
        />
      </div>

      {questions.length > 2 && <div className="mt-4">{addButton}</div>}

      <QuestionEditor
        open={editorOpen}
        surveyId={s.id}
        surveyType={s.survey_type}
        question={editing}
        allQuestions={questions}
        permissions={s.permissions}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false)
          reload()
        }}
      />
      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={busy}
        text={t('confirmDeleteQuestion')}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return
          setBusy(true)
          await act(() => api.del(`/api/admin/questions/${toDelete.id}`), t('deletedOk'))
          setBusy(false)
          setToDelete(null)
        }}
      />
      <ConfirmDialog
        open={confirmPublish}
        loading={busy}
        text={s.published_version_id ? t('confirmPublishChanges') : t('confirmPublish')}
        onCancel={() => setConfirmPublish(false)}
        onConfirm={async () => {
          setBusy(true)
          await act(() => api.post(`/api/admin/surveys/${s.id}/publish`), t('publishedOk'))
          setBusy(false)
          setConfirmPublish(false)
        }}
      />
    </div>
  )
}
