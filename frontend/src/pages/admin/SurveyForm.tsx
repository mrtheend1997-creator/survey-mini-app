import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Bilingual, Button, Card, ConfirmDialog, ErrorBox, Input, Label, Select, Spinner, StatusBadge } from '../../components/ui'
import { useLoad } from '../../hooks'
import { pick } from '../../i18n'
import { can, meCan, type Perm } from '../../permissions'
import type { AdminSurvey, SurveyStatus, SurveyType, UserRow } from '../../types'

interface FormState {
  title_uz: string
  title_ru: string
  description_uz: string
  description_ru: string
  start_date: string
  end_date: string
  survey_type: SurveyType
  allow_repeat: boolean
  status: SurveyStatus
  estimated_minutes: string
  manager_ids: number[]
}

const EMPTY: FormState = {
  title_uz: '',
  title_ru: '',
  description_uz: '',
  description_ru: '',
  start_date: '',
  end_date: '',
  survey_type: 'anonymous',
  allow_repeat: false,
  status: 'draft',
  estimated_minutes: '',
  manager_ids: [],
}

function Choice<T extends string | boolean>({
  value,
  current,
  onPick,
  label,
  hint,
}: {
  value: T
  current: T
  onPick: (v: T) => void
  label: string
  hint?: string
}) {
  const on = value === current
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={`flex w-full items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left ${on ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/20' : 'border-line bg-card'}`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-brand-500' : 'border-gray-300'}`}>
        {on && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}
      </span>
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </button>
  )
}

export default function SurveyForm() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { t, lang, me, toast, showError, errorText } = useApp()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'publish' | 'delete'>(null)
  const survey = useLoad(() => (isNew ? Promise.resolve(null) : api.get<AdminSurvey>(`/api/admin/surveys/${id}`)), [id])
  const admins = useLoad(
    () => (me?.role === 'super_admin' ? api.get<{ items: UserRow[] }>('/api/admin/users?role=admin&page_size=100').then((r) => r.items) : Promise.resolve([])),
    [],
  )
  const s = survey.data

  useEffect(() => {
    if (!s) return
    setForm({
      title_uz: s.title_uz,
      title_ru: s.title_ru,
      description_uz: s.description_uz,
      description_ru: s.description_ru,
      start_date: s.start_date ?? '',
      end_date: s.end_date ?? '',
      survey_type: s.survey_type,
      allow_repeat: s.allow_repeat,
      status: s.status,
      estimated_minutes: s.estimated_minutes ? String(s.estimated_minutes) : '',
      manager_ids: s.manager_ids,
    })
  }, [s])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  /** Save the form; returns the saved survey. */
  const save = async (): Promise<AdminSurvey> => {
    const body = {
      title_uz: form.title_uz,
      title_ru: form.title_ru,
      description_uz: form.description_uz,
      description_ru: form.description_ru,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      survey_type: form.survey_type,
      allow_repeat: form.allow_repeat,
      estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
      ...(me?.role === 'super_admin' ? { manager_ids: form.manager_ids } : {}),
    }
    let saved: AdminSurvey
    if (isNew) {
      saved = await api.post<AdminSurvey>('/api/admin/surveys', body)
      // the survey exists now: switch to its edit page so a later error can't create a duplicate
      navigate(`/admin/surveys/${saved.id}`, { replace: true })
    } else {
      saved = await api.patch<AdminSurvey>(`/api/admin/surveys/${id}`, body)
    }
    if (form.status !== saved.status && !(form.status === 'draft' && isNew)) {
      saved = await api.post<AdminSurvey>(`/api/admin/surveys/${saved.id}/status`, { status: form.status })
    }
    return saved
  }

  const run = async (kind: string, after: (sv: AdminSurvey) => void | Promise<void>) => {
    setSaving(kind)
    try {
      const saved = await save()
      await after(saved)
    } catch (e) {
      showError(e)
    } finally {
      setSaving(null)
    }
  }

  const onSaveDraft = () =>
    run('draft', () => {
      toast(t('savedOk'))
      if (!isNew) survey.reload()
    })
  const onAddQuestions = () => run('questions', (sv) => navigate(`/admin/surveys/${sv.id}/questions`))
  const onPublish = () =>
    run('publish', async (sv) => {
      await api.post(`/api/admin/surveys/${sv.id}/publish`)
      toast(t('publishedOk'))
      if (!isNew) survey.reload()
    })

  if (survey.loading) return <Spinner />
  if (survey.error) return <ErrorBox text={errorText(survey.error)} onRetry={survey.reload} />
  const readOnly = s ? !s.can_manage : false
  // a new survey is the creator's own, so their permission switches decide
  const allowed = (p: Perm) => (s ? can(s, p) : meCan(me, p))
  const lock = (p: Perm) => !isNew && !allowed(p)

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold">{isNew ? t('newSurvey') : t('editSurvey')}</h1>
      {s && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusBadge status={s.effective_status} />
          <span>{s.version_number ? t('versionLabel', { v: s.version_number }) : t('notPublishedYet')}</span>
          <span>· ❓ {t('questionsCount', { n: s.question_count })}</span>
          <span>· 📨 {t('responsesShort', { n: s.completed_count })}</span>
        </div>
      )}
      {s?.has_unpublished_changes && (
        <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <div>{t('unpublishedChanges', { v: s.version_number ?? 1 })}</div>
          {allowed('publish') && (
            <Button variant="success" size="md" className="mt-3" onClick={() => setConfirm('publish')}>
              {t('publishChanges')}
            </Button>
          )}
        </div>
      )}

      {s && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="primary" size="md" onClick={() => navigate(`/admin/surveys/${s.id}/questions`)}>
            ❓ {t('questions')} ({s.question_count})
          </Button>
          <Button variant="soft" size="md" onClick={() => navigate(`/admin/surveys/${s.id}/preview`)}>
            {t('preview')}
          </Button>
        </div>
      )}

      <Card className="mt-4 space-y-5">
        <fieldset disabled={lock('survey_edit')} className="space-y-5 disabled:opacity-60">
          <Bilingual
            label={t('surveyTitle')}
            required
            uz={form.title_uz}
            ru={form.title_ru}
            onUz={(v) => set('title_uz', v)}
            onRu={(v) => set('title_ru', v)}
          />
          <Bilingual
            label={t('description')}
            multiline
            uz={form.description_uz}
            ru={form.description_ru}
            onUz={(v) => set('description_uz', v)}
            onRu={(v) => set('description_ru', v)}
          />
        </fieldset>
        <fieldset disabled={!allowed('timer_manage')} className="grid grid-cols-2 gap-3 disabled:opacity-60">
          <div>
            <Label>{t('startDate')}</Label>
            <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </div>
          <div>
            <Label>{t('endDate')}</Label>
            <Input type="date" value={form.end_date} min={form.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} />
          </div>
        </fieldset>
        <fieldset disabled={!allowed('anonymity_manage')} className="disabled:opacity-60">
          <Label>{t('type')}</Label>
          <div className="space-y-2">
            {(['anonymous', 'named', 'registered'] as const).map((v) => (
              <Choice key={v} value={v} current={form.survey_type} onPick={(x) => set('survey_type', x)} label={t(`type_${v}`)} />
            ))}
          </div>
        </fieldset>
        <fieldset disabled={!allowed('participants_manage')} className="disabled:opacity-60">
          <Label>{t('attempts')}</Label>
          <div className="space-y-2">
            <Choice value={false} current={form.allow_repeat} onPick={(x) => set('allow_repeat', x)} label={t('attempts_once')} />
            <Choice value={true} current={form.allow_repeat} onPick={(x) => set('allow_repeat', x)} label={t('attempts_repeat')} />
          </div>
        </fieldset>
        <fieldset disabled={!allowed('publish')} className="disabled:opacity-60">
          <Label>{t('status')}</Label>
          <Select value={form.status} onChange={(e) => set('status', e.target.value as SurveyStatus)}>
            {(['draft', 'active', 'paused', 'finished'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`status_${v}`)}
              </option>
            ))}
          </Select>
        </fieldset>
        <fieldset disabled={lock('survey_edit')} className="disabled:opacity-60">
          <Label>{t('estMinutes')}</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={form.estimated_minutes}
            placeholder={s ? String(s.estimated_minutes_auto) : ''}
            onChange={(e) => set('estimated_minutes', e.target.value)}
          />
          <p className="mt-1 text-sm text-muted">{t('estMinutesHint')}</p>
        </fieldset>
        {me?.role === 'super_admin' && (admins.data?.length ?? 0) > 0 && (
          <div>
            <Label>{t('managers')}</Label>
            <div className="space-y-2">
              {admins.data!.map((a) => {
                const on = form.manager_ids.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => set('manager_ids', on ? form.manager_ids.filter((x) => x !== a.id) : [...form.manager_ids, a.id])}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 text-left ${on ? 'border-brand-500' : 'border-line'}`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded border-2 text-xs text-white ${on ? 'border-brand-500 bg-brand-500' : 'border-gray-300'}`}
                    >
                      {on && '✓'}
                    </span>
                    {[a.first_name, a.last_name].filter(Boolean).join(' ') || a.username || a.telegram_id}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {!readOnly && (
        <div className="mt-5 space-y-2.5">
          <Button variant="outline" block onClick={onSaveDraft} loading={saving === 'draft'}>
            {isNew ? t('saveDraft') : t('save')}
          </Button>
          <Button variant="primary" block onClick={onAddQuestions} loading={saving === 'questions'}>
            {t('addQuestions')}
          </Button>
          {allowed('publish') && (isNew || !s?.published_version_id) && (
            <Button variant="success" block onClick={() => (isNew ? onPublish() : setConfirm('publish'))} loading={saving === 'publish'}>
              {t('publish')}
            </Button>
          )}
          {s && can(s, 'survey_delete') && (
            <Button variant="ghost" block className="!text-red-600" onClick={() => setConfirm('delete')}>
              {t('delete')}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'publish'}
        text={s?.published_version_id ? t('confirmPublishChanges') : t('confirmPublish')}
        loading={saving === 'publish'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await onPublish()
          setConfirm(null)
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        danger
        text={t('confirmDeleteSurvey')}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/admin/surveys/${id}`)
            toast(t('deletedOk'))
            navigate('/admin/surveys', { replace: true })
          } catch (e) {
            showError(e)
          }
          setConfirm(null)
        }}
      />
      {s && (
        <p className="mt-6 text-center text-xs text-muted">
          {pick(s, 'title', lang)} · ID {s.id}
        </p>
      )}
    </div>
  )
}
