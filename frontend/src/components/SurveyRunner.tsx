import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { useApp } from '../app-context'
import { formatDate, pick, type Lang } from '../i18n'
import { haptic, telegramUserId } from '../telegram'
import type { AnswerValue, QuestionT, ResponseState, SurveyCard } from '../types'
import { Button, Input, Label, ProgressBar, TextArea } from './ui'

type Mode = 'live' | 'preview'
type Phase = 'intro' | 'questions' | 'done'

// Question types that jump to the next question right after a choice is made.
const AUTO_ADVANCE = new Set(['single', 'dropdown', 'yes_no', 'rating5', 'rating10'])
const DEBOUNCED = new Set(['text', 'number'])

const tokenKey = (surveyId: number) => `fti_resp_${telegramUserId()}_${surveyId}`
const backupKey = (token: string) => `fti_ans_${token}`

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

export function isAnswered(q: QuestionT, v: AnswerValue | undefined): boolean {
  if (!v) return false
  switch (q.qtype) {
    case 'single':
    case 'dropdown':
      return v.option_id != null || !!v.other?.trim()
    case 'multiple':
      return (v.option_ids?.length ?? 0) > 0 || !!v.other?.trim()
    case 'text':
      return !!v.text?.trim()
    case 'number':
      return typeof v.number === 'number' && isFinite(v.number)
    case 'yes_no':
      return typeof v.bool === 'boolean'
    case 'rating5':
    case 'rating10':
      return typeof v.rating === 'number'
    case 'date':
      return !!v.date
  }
}

function choiceCount(v: AnswerValue | undefined): number {
  return (v?.option_ids?.length ?? 0) + (v?.other != null ? 1 : 0)
}

export default function SurveyRunner({
  surveyId,
  survey,
  mode,
  previewQuestions,
  onExit,
}: {
  surveyId: number
  survey: SurveyCard
  mode: Mode
  previewQuestions?: QuestionT[]
  onExit: () => void
}) {
  const { t, lang, errorText, showError } = useApp()
  const [phase, setPhase] = useState<Phase>('intro')
  const [questions, setQuestions] = useState<QuestionT[]>(previewQuestions ?? [])
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [index, setIndex] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [animKey, setAnimKey] = useState(0)

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pending = useRef<Record<string, AnswerValue | null>>({})
  const inflight = useRef<Set<Promise<unknown>>>(new Set())
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>()

  const hadDraft = mode === 'live' && !!safeGet(tokenKey(surveyId))

  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout)
      clearTimeout(advanceTimer.current)
    },
    [],
  )

  // ---------- server sync ----------
  const sendAnswer = useCallback(
    (qid: string, value: AnswerValue | null, idx: number) => {
      if (mode !== 'live' || !token) return Promise.resolve()
      setSaveState('saving')
      const p = api
        .put(`/api/responses/${token}/answers/${qid}`, { value, current_index: idx })
        .then(() => {
          delete pending.current[qid]
          setSaveState('saved')
        })
        .catch((e) => {
          pending.current[qid] = value
          setSaveState('failed')
          if (e instanceof ApiError && e.code === 'invalid_answer') delete pending.current[qid]
          throw e
        })
        .finally(() => inflight.current.delete(p))
      inflight.current.add(p)
      return p
    },
    [mode, token],
  )

  /** Send everything that is still waiting (debounced or failed). */
  const flush = useCallback(async () => {
    Object.values(timers.current).forEach(clearTimeout)
    timers.current = {}
    await Promise.allSettled([...inflight.current])
    const entries = Object.entries(pending.current)
    for (const [qid, value] of entries) await sendAnswer(qid, value, index)
  }, [sendAnswer, index])

  // ---------- start ----------
  const start = async () => {
    setError(null)
    if (mode === 'preview') {
      setPhase('questions')
      return
    }
    setStarting(true)
    try {
      const res = await api.post<ResponseState>(`/api/surveys/${surveyId}/responses`, {
        token: safeGet(tokenKey(surveyId)),
        language: lang,
        full_name: fullName || null,
        phone: phone || null,
      })
      safeSet(tokenKey(surveyId), res.token)
      // merge local backup (answers typed while offline) over server answers
      let merged = res.answers
      try {
        const backup = JSON.parse(safeGet(backupKey(res.token)) || '{}')
        merged = { ...res.answers, ...backup }
        for (const qid of Object.keys(backup)) if (JSON.stringify(backup[qid]) !== JSON.stringify(res.answers[qid])) pending.current[qid] = backup[qid]
      } catch {
        /* ignore broken backup */
      }
      setQuestions(res.questions)
      setAnswers(merged)
      setToken(res.token)
      setIndex(Math.min(res.current_index, Math.max(0, res.questions.length - 1)))
      setPhase('questions')
    } catch (e) {
      setError(errorText(e))
      haptic.error()
    } finally {
      setStarting(false)
    }
  }

  // retry pending answers once the token is known (after resume)
  useEffect(() => {
    if (token && Object.keys(pending.current).length) flush().catch(() => undefined)
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = questions[index]
  const total = questions.length
  const isLast = index === total - 1

  const goTo = (i: number) => {
    setError(null)
    setIndex(i)
    setAnimKey((k) => k + 1)
    window.scrollTo({ top: 0 })
    if (mode === 'live' && token) api.patch(`/api/responses/${token}`, { current_index: i }).catch(() => undefined)
  }

  const validate = (question: QuestionT, v: AnswerValue | undefined): string | null => {
    if (question.required && !isAnswered(question, v)) return t('requiredError')
    if (question.qtype === 'multiple' && question.min_choices && isAnswered(question, v) && choiceCount(v) < question.min_choices)
      return t('minChoicesError', { n: question.min_choices })
    return null
  }

  const next = () => {
    if (!q) return
    const err = validate(q, answers[String(q.id)])
    if (err) {
      setError(err)
      haptic.error()
      return
    }
    if (!isLast) goTo(index + 1)
  }

  const setAnswer = (question: QuestionT, value: AnswerValue | null, opts: { advance?: boolean } = {}) => {
    const qid = String(question.id)
    setError(null)
    setAnswers((prev) => {
      const nextAnswers = { ...prev }
      if (value === null) delete nextAnswers[qid]
      else nextAnswers[qid] = value
      if (mode === 'live' && token) safeSet(backupKey(token), JSON.stringify(nextAnswers))
      return nextAnswers
    })
    haptic.tap()
    if (mode === 'live') {
      clearTimeout(timers.current[qid])
      pending.current[qid] = value
      if (DEBOUNCED.has(question.qtype) || value?.other != null) {
        timers.current[qid] = setTimeout(() => {
          sendAnswer(qid, pending.current[qid] ?? null, index).catch(() => undefined)
        }, 700)
      } else {
        sendAnswer(qid, value, index).catch(() => undefined)
      }
    }
    if (opts.advance && AUTO_ADVANCE.has(question.qtype) && !isLast) {
      clearTimeout(advanceTimer.current)
      advanceTimer.current = setTimeout(() => goTo(index + 1), 380)
    }
  }

  const finish = async () => {
    if (!q) return
    // check every question locally first
    for (let i = 0; i < questions.length; i++) {
      const err = validate(questions[i], answers[String(questions[i].id)])
      if (err) {
        if (i !== index) goTo(i)
        setTimeout(() => setError(err), 0)
        haptic.error()
        return
      }
    }
    if (mode === 'preview') {
      setPhase('done')
      haptic.success()
      return
    }
    setSubmitting(true)
    try {
      await flush()
      if (Object.keys(pending.current).length) throw new ApiError(0, 'network')
      await api.post(`/api/responses/${token}/submit`)
      safeSet(tokenKey(surveyId), null)
      if (token) safeSet(backupKey(token), null)
      setPhase('done')
      haptic.success()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'required_missing') {
        const missing = (e.extra.missing as { index: number }[] | undefined)?.[0]
        if (missing) goTo(missing.index)
        setTimeout(() => setError(t('requiredError')), 0)
        haptic.error()
      } else if (e instanceof ApiError && e.code === 'response_completed') {
        safeSet(tokenKey(surveyId), null)
        setPhase('done')
      } else {
        showError(e)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- render ----------
  const previewBanner =
    mode === 'preview' ? <div className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">{t('previewBanner')}</div> : null

  if (phase === 'intro') {
    const blocked = mode === 'live' && survey.completed && !survey.allow_repeat
    const typeNote = { anonymous: t('anonymousNote'), named: t('namedNote'), registered: t('registeredNote') }[survey.survey_type]
    return (
      <div className="flex min-h-screen flex-col">
        {previewBanner}
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
          <button onClick={onExit} className="mb-4 self-start text-[15px] font-semibold text-muted">
            {t('back')}
          </button>
          <div className="rounded-3xl border border-line bg-card p-6 shadow-sm">
            <div className="text-4xl">📋</div>
            <h1 className="mt-3 text-2xl font-bold leading-tight">{pick(survey, 'title', lang)}</h1>
            {pick(survey, 'description', lang) && (
              <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-muted">{pick(survey, 'description', lang)}</p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2 text-[15px]">
              <div className="rounded-xl bg-navy-50 p-3 dark:bg-white/5">
                ❓ {t('questionsCount', { n: mode === 'preview' ? questions.length : survey.question_count })}
              </div>
              <div className="rounded-xl bg-navy-50 p-3 dark:bg-white/5">⏱️ {t('minutes', { n: survey.estimated_minutes })}</div>
              <div className="col-span-2 rounded-xl bg-navy-50 p-3 dark:bg-white/5">
                📅 {survey.end_date ? t('until', { d: formatDate(survey.end_date, lang) }) : t('noDeadline')}
              </div>
            </div>
            <p className="mt-4 text-[15px] text-muted">{typeNote}</p>
            {survey.survey_type === 'registered' && !blocked && (
              <div className="mt-4 space-y-3">
                <div>
                  <Label required>{t('fullName')}</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                </div>
                <div>
                  <Label required>{t('phone')}</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    type="tel"
                    inputMode="tel"
                    placeholder="+998 __ ___ __ __"
                    autoComplete="tel"
                  />
                </div>
              </div>
            )}
            {hadDraft && !blocked && (
              <div className="mt-4 rounded-xl bg-brand-50 p-3 text-[15px] text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">{t('resumeNote')}</div>
            )}
            {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-[15px] text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
          </div>
          <div className="mt-auto pt-6">
            {blocked ? (
              <div className="rounded-2xl bg-brand-50 p-4 text-center font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">
                {t('alreadyDone')}
              </div>
            ) : (
              <Button variant="success" block onClick={start} loading={starting} className="text-lg">
                {hadDraft ? t('continueSurvey') : t('startSurvey')}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="flex min-h-screen flex-col">
        {previewBanner}
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-brand-100 text-5xl dark:bg-brand-700/30">✅</div>
          <h1 className="mt-6 text-3xl font-bold">{t('thanksTitle')}</h1>
          <p className="mt-2 text-lg text-muted">{mode === 'preview' ? t('previewDone') : t('thanksText')}</p>
          <Button block className="mt-8" onClick={onExit}>
            {mode === 'preview' ? t('exitPreview') : t('toHome')}
          </Button>
        </div>
      </div>
    )
  }

  if (!q) return null
  const value = answers[String(q.id)]
  const progress = total ? ((index + (isAnswered(q, value) ? 1 : 0)) / total) * 100 : 0

  return (
    <div className="flex min-h-screen flex-col">
      {previewBanner}
      <div className="sticky top-0 z-20 border-b border-line bg-surface/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <button
              onClick={onExit}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-muted hover:bg-black/5"
              aria-label={t('close')}
            >
              ✕
            </button>
            <span className="font-semibold text-ink">{t('questionOf', { i: index + 1, n: total })}</span>
            <span className={`w-20 text-right text-xs ${saveState === 'failed' ? 'text-red-600' : 'text-muted'}`}>
              {mode === 'live' && saveState === 'saving' && t('saving')}
              {mode === 'live' && saveState === 'saved' && `✓ ${t('saved')}`}
              {mode === 'live' && saveState === 'failed' && '⚠️'}
            </span>
          </div>
          <ProgressBar value={progress} />
        </div>
      </div>

      <main key={animKey} className="animate-fade-in mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-5">
        <h2 className="text-[21px] font-bold leading-snug">
          {pick(q, 'text', lang)}
          {q.required && (
            <span className="ml-1 text-red-600" aria-label={t('required')}>
              *
            </span>
          )}
        </h2>
        {pick(q, 'hint', lang) && <p className="mt-2 text-[15px] leading-relaxed text-muted">{pick(q, 'hint', lang)}</p>}
        {q.image_url && <img src={q.image_url} alt="" className="mt-4 max-h-72 w-full rounded-2xl object-contain" />}
        <div className="mt-5">
          <QuestionInput q={q} value={value} lang={lang} onChange={(v, adv) => setAnswer(q, v, { advance: adv })} />
        </div>
        {error && (
          <div role="alert" className="animate-pop mt-4 rounded-xl bg-red-50 p-3 text-[15px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-200">
            ⚠️ {error}
          </div>
        )}
        {saveState === 'failed' && mode === 'live' && <div className="mt-3 text-sm text-red-600">{t('saveFailed')}</div>}
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Button variant="outline" className="flex-1" disabled={index === 0} onClick={() => goTo(index - 1)}>
            {t('back')}
          </Button>
          {isLast ? (
            <Button variant="success" className="flex-[1.6]" onClick={finish} loading={submitting}>
              {t('finish')}
            </Button>
          ) : (
            <Button className="flex-[1.6]" onClick={next}>
              {t('next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ inputs

function OptionButton({ selected, multi, children, onClick }: { selected: boolean; multi?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-base transition active:scale-[0.99] ${
        selected ? 'animate-pop border-brand-500 bg-brand-50 font-semibold dark:bg-brand-700/20' : 'border-line bg-card'
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 text-sm text-white transition ${multi ? 'rounded-md' : 'rounded-full'} ${
          selected ? 'border-brand-500 bg-brand-500' : 'border-gray-300 dark:border-gray-500'
        }`}
      >
        {selected && '✓'}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  )
}

function QuestionInput({
  q,
  value,
  lang,
  onChange,
}: {
  q: QuestionT
  value: AnswerValue | undefined
  lang: Lang
  onChange: (v: AnswerValue | null, advance?: boolean) => void
}) {
  const { t } = useApp()
  const [numText, setNumText] = useState(value?.number != null ? String(value.number) : '')
  useEffect(() => setNumText(value?.number != null ? String(value.number) : ''), [q.id]) // eslint-disable-line react-hooks/exhaustive-deps

  switch (q.qtype) {
    case 'single': {
      const otherOn = value?.other != null
      return (
        <div className="space-y-2.5">
          {q.options.map((o) => (
            <OptionButton key={o.id} selected={value?.option_id === o.id} onClick={() => onChange({ option_id: o.id }, true)}>
              {pick(o, 'text', lang)}
            </OptionButton>
          ))}
          {q.allow_other && (
            <>
              <OptionButton selected={otherOn} onClick={() => onChange({ other: value?.other ?? '' })}>
                {t('other')}
              </OptionButton>
              {otherOn && (
                <Input autoFocus value={value?.other ?? ''} placeholder={t('otherPlaceholder')} onChange={(e) => onChange({ other: e.target.value })} />
              )}
            </>
          )}
        </div>
      )
    }
    case 'multiple': {
      const ids = value?.option_ids ?? []
      const otherOn = value?.other != null
      const max = q.max_choices ?? Infinity
      const count = ids.length + (otherOn ? 1 : 0)
      const toggle = (id: number) => {
        const nextIds = ids.includes(id) ? ids.filter((x) => x !== id) : count >= max ? ids : [...ids, id]
        if (!nextIds.length && !otherOn) onChange(null)
        else onChange({ option_ids: nextIds, other: value?.other ?? null })
      }
      return (
        <div className="space-y-2.5">
          <p className="text-sm text-muted">
            {t('chooseMany')}
            {q.max_choices ? ` · ${t('maxChoicesHint', { n: q.max_choices })}` : ''}
          </p>
          {q.options.map((o) => (
            <OptionButton key={o.id} multi selected={ids.includes(o.id)} onClick={() => toggle(o.id)}>
              {pick(o, 'text', lang)}
            </OptionButton>
          ))}
          {q.allow_other && (
            <>
              <OptionButton
                multi
                selected={otherOn}
                onClick={() => {
                  if (otherOn) onChange(ids.length ? { option_ids: ids, other: null } : null)
                  else if (count < max) onChange({ option_ids: ids, other: '' })
                }}
              >
                {t('other')}
              </OptionButton>
              {otherOn && (
                <Input
                  autoFocus
                  value={value?.other ?? ''}
                  placeholder={t('otherPlaceholder')}
                  onChange={(e) => onChange({ option_ids: ids, other: e.target.value })}
                />
              )}
            </>
          )}
        </div>
      )
    }
    case 'dropdown': {
      const otherOn = value?.other != null
      const current = otherOn ? 'other' : value?.option_id != null ? String(value.option_id) : ''
      return (
        <div className="space-y-2.5">
          <select
            value={current}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') onChange(null)
              else if (v === 'other') onChange({ other: '' })
              else onChange({ option_id: Number(v) }, true)
            }}
            className="min-h-[56px] w-full rounded-2xl border-2 border-line bg-card px-4 text-base text-ink outline-none focus:border-navy-500"
          >
            <option value="">{t('selectPlaceholder')}</option>
            {q.options.map((o) => (
              <option key={o.id} value={o.id}>
                {pick(o, 'text', lang)}
              </option>
            ))}
            {q.allow_other && <option value="other">{t('other')}</option>}
          </select>
          {otherOn && <Input autoFocus value={value?.other ?? ''} placeholder={t('otherPlaceholder')} onChange={(e) => onChange({ other: e.target.value })} />}
        </div>
      )
    }
    case 'text':
      return (
        <TextArea
          rows={5}
          value={value?.text ?? ''}
          placeholder={t('yourAnswer')}
          maxLength={5000}
          onChange={(e) => onChange(e.target.value ? { text: e.target.value } : null)}
        />
      )
    case 'number':
      return (
        <Input
          type="text"
          inputMode="decimal"
          value={numText}
          placeholder={t('numberPlaceholder')}
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.')
            if (!/^-?\d*\.?\d*$/.test(raw)) return
            setNumText(raw)
            const n = parseFloat(raw)
            onChange(raw === '' || isNaN(n) ? null : { number: n })
          }}
        />
      )
    case 'yes_no':
      return (
        <div className="grid grid-cols-2 gap-3">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              onClick={() => onChange({ bool: b }, true)}
              aria-pressed={value?.bool === b}
              className={`flex min-h-[72px] flex-col items-center justify-center rounded-2xl border-2 text-lg font-semibold transition active:scale-[0.98] ${
                value?.bool === b ? 'animate-pop border-brand-500 bg-brand-50 dark:bg-brand-700/20' : 'border-line bg-card'
              }`}
            >
              <span className="text-2xl">{b ? '👍' : '👎'}</span>
              {b ? t('yes') : t('no')}
            </button>
          ))}
        </div>
      )
    case 'rating5':
    case 'rating10': {
      const top = q.qtype === 'rating5' ? 5 : 10
      return (
        <div>
          <div className={`grid gap-2 ${top === 5 ? 'grid-cols-5' : 'grid-cols-5'}`}>
            {Array.from({ length: top }, (_, i) => i + 1).map((n) => {
              const selected = value?.rating === n
              const filled = top === 5 && (value?.rating ?? 0) >= n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange({ rating: n }, true)}
                  aria-pressed={selected}
                  className={`flex aspect-square flex-col items-center justify-center rounded-2xl border-2 text-lg font-bold transition active:scale-95 ${
                    selected
                      ? 'animate-pop border-brand-500 bg-brand-500 text-white'
                      : filled
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/20'
                        : 'border-line bg-card'
                  }`}
                >
                  {top === 5 && <span className="text-xl leading-none">{filled ? '★' : '☆'}</span>}
                  <span>{n}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>1</span>
            <span>{top}</span>
          </div>
        </div>
      )
    }
    case 'date':
      return <Input type="date" value={value?.date ?? ''} onChange={(e) => onChange(e.target.value ? { date: e.target.value } : null)} />
  }
}
