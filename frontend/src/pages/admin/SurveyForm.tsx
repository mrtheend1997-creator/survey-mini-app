import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Bilingual, Button, Card, ConfirmDialog, ErrorBox, Input, Label, Select, Spinner, StatusBadge, Toggle } from '../../components/ui'
import { useLoad } from '../../hooks'
import { pick } from '../../i18n'
import { can, meCan, type Perm } from '../../permissions'
import type { AdminSurvey, SurveyStatus, SurveyType, TimeoutPolicy, UserRow } from '../../types'

interface FormState {
  title_uz: string
  title_ru: string
  description_uz: string
  description_ru: string
  opens_at: string
  closes_at: string
  survey_type: SurveyType
  attempts: 'once' | 'several' | 'unlimited'
  max_attempts: string
  allow_edit: boolean
  time_limit: string
  time_limit_custom: string
  timeout_policy: TimeoutPolicy
  status: SurveyStatus
  estimated_minutes: string
  manager_ids: number[]
}

const TIME_PRESETS = ['5', '10', '15', '30', '60']

const EMPTY: FormState = {
  title_uz: '',
  title_ru: '',
  description_uz: '',
  description_ru: '',
  opens_at: '',
  closes_at: '',
  survey_type: 'anonymous',
  attempts: 'once',
  max_attempts: '2',
  allow_edit: false,
  time_limit: '',
  time_limit_custom: '',
  timeout_policy: 'submit',
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
      opens_at: s.opens_at ?? '',
      closes_at: s.closes_at ?? '',
      survey_type: s.survey_type,
      attempts: !s.allow_repeat ? 'once' : s.max_attempts ? 'several' : 'unlimited',
      max_attempts: String(s.max_attempts ?? 2),
      allow_edit: !!s.allow_edit,
      time_limit: !s.time_limit_minutes ? '' : TIME_PRESETS.includes(String(s.time_limit_minutes)) ? String(s.time_limit_minutes) : 'custom',
      time_limit_custom: s.time_limit_minutes ? String(s.time_limit_minutes) : '',
      timeout_policy: s.timeout_policy ?? 'submit',
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
      opens_at: form.opens_at || null,
      closes_at: form.closes_at || null,
      survey_type: form.survey_type,
      allow_repeat: form.attempts !== 'once',
      max_attempts: form.attempts === 'several' ? Number(form.max_attempts) || 2 : null,
      allow_edit: form.allow_edit && form.survey_type !== 'anonymous',
      time_limit_minutes: !form.time_limit ? null : Number(form.time_limit === 'custom' ? form.time_limit_custom : form.time_limit) || null,
      timeout_policy: form.timeout_policy,
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
        <fieldset disabled={!allowed('timer_manage')} className="space-y-3 disabled:opacity-60">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('opensAt')}</Label>
              <Input type="datetime-local" value={form.opens_at} onChange={(e) => set('opens_at', e.target.value)} />
            </div>
            <div>
              <Label>{t('closesAt')}</Label>
              <Input type="datetime-local" value={form.closes_at} min={form.opens_at || undefined} onChange={(e) => set('closes_at', e.target.value)} />
            </div>
          </div>
          <p className="text-sm text-muted">{t('windowHint')}</p>
          <div>
            <Label>⏱ {t('timeLimit')}</Label>
            <Select value={form.time_limit} onChange={(e) => set('time_limit', e.target.value)}>
              <option value="">{t('timeLimitNone')}</option>
              {TIME_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {t('minutesN', { n: m })}
                </option>
              ))}
              <option value="custom">{t('timeLimitCustom')}</option>
            </Select>
          </div>
          {form.time_limit === 'custom' && (
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              placeholder={t('minutesPlaceholder')}
              value={form.time_limit_custom}
              onChange={(e) => set('time_limit_custom', e.target.value)}
            />
          )}
          {form.time_limit && (
            <div>
              <Label>{t('timeoutPolicy')}</Label>
              <Select value={form.timeout_policy} onChange={(e) => set('timeout_policy', e.target.value as TimeoutPolicy)}>
                {(['submit', 'incomplete', 'lock'] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`timeout_${v}`)}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-sm text-muted">{t(`timeout_${form.timeout_policy}_hint`)}</p>
            </div>
          )}
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
            <Choice value="once" current={form.attempts} onPick={(x) => set('attempts', x)} label={t('attempts_once')} />
            <Choice value="several" current={form.attempts} onPick={(x) => set('attempts', x)} label={t('attempts_several')} />
            {form.attempts === 'several' && (
              <Input
                type="number"
                inputMode="numeric"
                min={2}
                max={1000}
                aria-label={t('attempts_max')}
                value={form.max_attempts}
                onChange={(e) => set('max_attempts', e.target.value)}
              />
            )}
            <Choice value="unlimited" current={form.attempts} onPick={(x) => set('attempts', x)} label={t('attempts_unlimited')} />
          </div>
          {form.survey_type === 'anonymous' && form.attempts === 'once' && <p className="mt-2 text-sm text-muted">{t('anonOnceHint')}</p>}
          <div className="mt-3">
            {form.survey_type === 'anonymous' ? (
              <p className="text-sm text-muted">{t('allowEditAnon')}</p>
            ) : (
              <Toggle checked={form.allow_edit} onChange={(v) => set('allow_edit', v)} label={t('allowEdit')} />
            )}
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
