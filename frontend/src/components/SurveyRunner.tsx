import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { useApp } from '../app-context'
import { formatDate, pick } from '../i18n'
import { isSection, routeOf, sectionOf } from '../logic'
import { isAnswered, isMulti, problem, ratingValues } from '../qtypes'
import { getItem, setItem } from '../storage'
import { haptic, telegramUserId } from '../telegram'
import type { AnswerValue, QuestionT, ResponseState, SurveyCard } from '../types'
import QuestionInput, { QuestionMedia } from './QuestionInputs'
import { Button, Input, Label, ProgressBar } from './ui'

type Mode = 'live' | 'preview'
type Phase = 'intro' | 'questions' | 'done'
type Outcome = 'completed' | 'edited' | 'time_submit' | 'time_incomplete' | 'time_lock'

// Question types that jump to the next question right after a choice is made.
const AUTO_ADVANCE = new Set(['single', 'dropdown', 'yes_no', 'rating5', 'rating10', 'scale', 'stars', 'nps', 'image_choice', 'region'])
// typed answers are sent after a short pause instead of on every key press
const DEBOUNCED = new Set(['text', 'short_text', 'video', 'number', 'contact', 'points'])

function autoAdvance(q: QuestionT): boolean {
  if (!AUTO_ADVANCE.has(q.qtype)) return false
  if (q.qtype === 'image_choice') return !isMulti(q)
  if (q.qtype === 'scale') return ratingValues(q).length <= 11
  return true
}

/** 125 → "2:05", 3725 → "1:02:05" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const tokenKey = (surveyId: number) => `fti_resp_${telegramUserId()}_${surveyId}`
const backupKey = (token: string) => `fti_ans_${token}`

const safeGet = getItem
const safeSet = setItem

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
  const [outcome, setOutcome] = useState<Outcome>('completed')
  const [editing, setEditing] = useState(false)
  // end times as Date.now() values, taken from the seconds the server reported
  const [deadline, setDeadline] = useState<number | null>(null)
  const [qDeadlines, setQDeadlines] = useState<Record<string, number>>({})
  const [now, setNow] = useState(() => Date.now())

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pending = useRef<Record<string, AnswerValue | null>>({})
  const inflight = useRef<Set<Promise<unknown>>>(new Set())
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>()
  const timingOut = useRef(false)

  const hadDraft = mode === 'live' && !!safeGet(tokenKey(surveyId))

  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout)
      clearTimeout(advanceTimer.current)
    },
    [],
  )

  // ---------- time limits ----------
  const timeUp = useCallback(
    (status: string) => {
      safeSet(tokenKey(surveyId), null)
      if (token) safeSet(backupKey(token), null)
      setDeadline(null)
      setOutcome(status === 'completed' ? 'time_submit' : survey.timeout_policy === 'lock' ? 'time_lock' : 'time_incomplete')
      setPhase('done')
      haptic.error()
    },
    [surveyId, token, survey.timeout_policy],
  )
  const timeUpRef = useRef(timeUp)
  timeUpRef.current = timeUp

  const questionExpired = (question: QuestionT) => {
    const end = qDeadlines[String(question.id)]
    return !!question.time_limit_seconds && end !== undefined && now >= end
  }

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
          if (e instanceof ApiError && e.code === 'question_time_over') {
            delete pending.current[qid]
            setSaveState('idle')
            setQDeadlines((d) => ({ ...d, [qid]: 0 }))
          }
          if (e instanceof ApiError && e.code === 'time_over') {
            pending.current = {}
            timeUpRef.current(String(e.extra.status ?? ''))
          }
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
  const start = async (edit = false) => {
    setError(null)
    if (mode === 'preview') {
      if (survey.time_limit_minutes) setDeadline(Date.now() + survey.time_limit_minutes * 60_000)
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
        edit,
      })
      if (res.status !== 'in_progress') {
        // its time ran out while the app was closed
        safeSet(tokenKey(surveyId), null)
        setOutcome(res.status === 'completed' ? 'time_submit' : survey.timeout_policy === 'lock' ? 'time_lock' : 'time_incomplete')
        setPhase('done')
        return
      }
      safeSet(tokenKey(surveyId), res.token)
      const at = Date.now()
      setNow(at)
      setDeadline(res.remaining_seconds != null ? at + res.remaining_seconds * 1000 : null)
      setQDeadlines(Object.fromEntries(Object.entries(res.question_time_left ?? {}).map(([qid, left]) => [qid, at + left * 1000])))
      setEditing(!!res.editing)
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

  // the questions on the respondent's way: jumps skip the rest, sections are shown as headings
  const steps = routeOf(questions, answers).filter((x) => !isSection(x))
  const q = steps[Math.min(index, steps.length - 1)]
  const total = steps.length
  const isLast = index >= total - 1
  useEffect(() => {
    // a changed answer can shorten the route behind the current position
    if (total && index > total - 1) setIndex(total - 1)
  }, [index, total])

  // one clock tick per second while a countdown is on the screen
  const ticking = phase === 'questions' && (deadline !== null || !!q?.time_limit_seconds)
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [ticking])

  // a question with its own limit: the server starts its clock the first time it is shown
  const qKey = q && q.time_limit_seconds && qDeadlines[String(q.id)] === undefined ? String(q.id) : null
  useEffect(() => {
    if (!qKey || !q) return
    const limit = q.time_limit_seconds ?? 0
    if (mode !== 'live' || !token) {
      setQDeadlines((d) => ({ ...d, [qKey]: Date.now() + limit * 1000 }))
      return
    }
    api
      .post<{ time_left: number | null }>(`/api/responses/${token}/questions/${qKey}/open`)
      .then((r) => setQDeadlines((d) => ({ ...d, [qKey]: Date.now() + (r.time_left ?? limit) * 1000 })))
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'time_over') timeUpRef.current(String(e.extra.status ?? ''))
        else setQDeadlines((d) => ({ ...d, [qKey]: Date.now() + limit * 1000 }))
      })
  }, [qKey, mode, token]) // eslint-disable-line react-hooks/exhaustive-deps

  // the whole survey's time is over: the server applies the survey's rule
  const totalLeft = deadline !== null ? (deadline - now) / 1000 : null
  useEffect(() => {
    if (totalLeft === null || totalLeft > 0 || timingOut.current || phase !== 'questions') return
    timingOut.current = true
    if (mode === 'preview') {
      timeUpRef.current(survey.timeout_policy === 'submit' ? 'completed' : 'timed_out')
      return
    }
    ;(async () => {
      await flush().catch(() => undefined)
      for (let i = 0; i < 3; i++) {
        try {
          const r = await api.post<{ status: string }>(`/api/responses/${token}/timeout`)
          if (r.status !== 'in_progress') return timeUpRef.current(r.status)
        } catch {
          /* retry below */
        }
        await new Promise((ok) => setTimeout(ok, 1500))
      }
      timingOut.current = false
    })()
  }, [totalLeft !== null && totalLeft <= 0, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // a question's own time is over: move on by itself
  const qExpired = !!q && questionExpired(q)
  useEffect(() => {
    if (!qExpired || isLast) return
    const id = setTimeout(() => goTo(index + 1), 900)
    return () => clearTimeout(id)
  }, [qExpired]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (i: number) => {
    setError(null)
    setIndex(i)
    setAnimKey((k) => k + 1)
    window.scrollTo({ top: 0 })
    if (mode === 'live' && token) api.patch(`/api/responses/${token}`, { current_index: i }).catch(() => undefined)
  }

  const reasonText = (question: QuestionT, reason: string): string => {
    const st = question.settings ?? {}
    switch (reason) {
      case 'required':
        return t('requiredError')
      case 'min_choices':
        return t('minChoicesError', { n: question.min_choices ?? 0 })
      case 'min_len':
        return t('minLenError', { n: st.min_len ?? 0 })
      case 'format':
        return t('formatError')
      case 'integer':
        return t('integerError')
      case 'range':
        return t('rangeError', { a: st.min ?? '−∞', b: st.max ?? '∞' })
      case 'points_sum':
        return t('pointsSumError', { n: st.total ?? 100 })
      case 'incomplete':
        return t('incompleteError')
      default:
        return t('requiredError')
    }
  }

  const validate = (question: QuestionT, v: AnswerValue | undefined): string | null => {
    const reason = problem(question, v)
    // the question's own time ran out: it may stay unanswered
    if (reason === 'required' && questionExpired(question)) return null
    return reason ? reasonText(question, reason) : null
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
    if (questionExpired(question)) return
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
    if (opts.advance && autoAdvance(question) && !isLast) {
      clearTimeout(advanceTimer.current)
      advanceTimer.current = setTimeout(() => goTo(index + 1), 380)
    }
  }

  const finish = async () => {
    if (!q) return
    // check every question locally first
    for (let i = 0; i < steps.length; i++) {
      const err = validate(steps[i], answers[String(steps[i].id)])
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
      const r = await api.post<{ ok: boolean; status: string; timed_out?: boolean }>(`/api/responses/${token}/submit`)
      if (r.timed_out) return timeUp(r.status)
      safeSet(tokenKey(surveyId), null)
      if (token) safeSet(backupKey(token), null)
      setDeadline(null)
      setOutcome(editing ? 'edited' : 'completed')
      setPhase('done')
      haptic.success()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'required_missing') {
        const missing = (e.extra.missing as { question_id: number; reason?: string }[] | undefined)?.[0]
        const at = missing ? steps.findIndex((x) => x.id === missing.question_id) : -1
        if (at >= 0) goTo(at)
        const mq = at >= 0 ? steps[at] : undefined
        setTimeout(() => setError(mq ? reasonText(mq, missing?.reason ?? 'required') : t('requiredError')), 0)
        haptic.error()
      } else if (e instanceof ApiError && e.code === 'time_over') {
        /* handled by sendAnswer */
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

  // keyboard (computers): Enter goes on, unless typing a long text or pressing a button
  const enterRef = useRef<() => void>(() => undefined)
  enterRef.current = () => (isLast ? finish() : next())
  useEffect(() => {
    if (phase !== 'questions') return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || ['TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(el.tagName)) return
      e.preventDefault()
      enterRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  // ---------- render ----------
  const previewBanner =
    mode === 'preview' ? <div className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">{t('previewBanner')}</div> : null

  if (phase === 'intro') {
    const blocked = mode === 'live' && !survey.can_start && !hadDraft
    const blockedText = survey.locked ? t('attemptsLocked') : (survey.attempts_limit ?? 1) > 1 ? t('attemptsUsedUp') : t('alreadyDone')
    const closes = survey.closes_at ? formatDate(survey.closes_at, lang, true) : survey.end_date ? formatDate(survey.end_date, lang) : null
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
                ❓ {t('questionsCount', { n: mode === 'preview' ? questions.filter((x) => !isSection(x)).length : survey.question_count })}
              </div>
              <div className="rounded-xl bg-navy-50 p-3 dark:bg-white/5">⏱️ {t('minutes', { n: survey.estimated_minutes })}</div>
              <div className="col-span-2 rounded-xl bg-navy-50 p-3 dark:bg-white/5">📅 {closes ? t('until', { d: closes }) : t('noDeadline')}</div>
              {!!survey.time_limit_minutes && (
                <div className="col-span-2 rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  ⏰ {t('timeLimitNote', { n: survey.time_limit_minutes })} {t(`timeout_${survey.timeout_policy ?? 'submit'}_note`)}
                </div>
              )}
              {mode === 'live' && !!survey.attempts_limit && survey.attempts_limit > 1 && (
                <div className="col-span-2 rounded-xl bg-navy-50 p-3 dark:bg-white/5">
                  🔁 {t('attemptsOf', { used: survey.attempts_used ?? 0, n: survey.attempts_limit })}
                </div>
              )}
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
              <div className="rounded-2xl bg-brand-50 p-4 text-center font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">{blockedText}</div>
            ) : (
              <Button variant="success" block onClick={() => start()} loading={starting} className="text-lg">
                {hadDraft ? t('continueSurvey') : t('startSurvey')}
              </Button>
            )}
            {mode === 'live' && survey.can_edit && !hadDraft && (
              <Button variant="outline" block onClick={() => start(true)} loading={starting} className="mt-3">
                ✏️ {t('editAnswers')}
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
          <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-brand-100 text-5xl dark:bg-brand-700/30">
            {outcome.startsWith('time_') ? '⏰' : '✅'}
          </div>
          <h1 className="mt-6 text-3xl font-bold">{outcome.startsWith('time_') ? t('timeUpTitle') : t('thanksTitle')}</h1>
          <p className="mt-2 text-lg text-muted">
            {outcome === 'completed' ? (mode === 'preview' ? t('previewDone') : pick(survey, 'thanks', lang) || t('thanksText')) : t(`outcome_${outcome}`)}
          </p>
          <Button block className="mt-8" onClick={onExit}>
            {mode === 'preview' ? t('exitPreview') : t('toHome')}
          </Button>
        </div>
      </div>
    )
  }

  if (!q) return null
  const value = answers[String(q.id)]
  const progress = total ? ((index + (isAnswered(q, value) || q.qtype === 'info' ? 1 : 0)) / total) * 100 : 0
  const section = sectionOf(questions, q)
  // the section's note is shown with its first question on the route
  const firstInSection = !!section && (index === 0 || sectionOf(questions, steps[index - 1]) !== section)

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
            <span className="flex items-center gap-2 font-semibold text-ink">
              {t('questionOf', { i: index + 1, n: total })}
              {totalLeft !== null && (
                <span
                  role="timer"
                  aria-label={t('timeLeft')}
                  className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${totalLeft <= 60 ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200' : 'bg-navy-100 text-navy-700 dark:bg-white/10 dark:text-navy-100'}`}
                >
                  ⏱ {clock(totalLeft)}
                </span>
              )}
            </span>
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
        {section && (
          <div className={`mb-4 ${firstInSection ? 'rounded-2xl bg-navy-50 p-4 dark:bg-white/5' : ''}`}>
            <div className="text-sm font-bold uppercase tracking-wide text-navy-700 dark:text-navy-200">📂 {pick(section, 'text', lang)}</div>
            {firstInSection && pick(section, 'description', lang) && (
              <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-muted">{pick(section, 'description', lang)}</p>
            )}
          </div>
        )}
        <h2 className="text-[21px] font-bold leading-snug">
          {pick(q, 'text', lang)}
          {q.required && (
            <span className="ml-1 text-red-600" aria-label={t('required')}>
              *
            </span>
          )}
        </h2>
        {pick(q, 'description', lang) && <p className="mt-3 whitespace-pre-line text-base leading-relaxed">{pick(q, 'description', lang)}</p>}
        {pick(q, 'hint', lang) && <p className="mt-2 text-[15px] leading-relaxed text-muted">{pick(q, 'hint', lang)}</p>}
        <QuestionMedia q={q} />
        {!!q.time_limit_seconds && qDeadlines[String(q.id)] !== undefined && (
          <div
            className={`mt-4 rounded-xl p-3 text-[15px] font-medium ${qExpired ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'}`}
          >
            {qExpired ? `⌛ ${t('questionTimeOver')}` : `⏳ ${t('questionTimeLeft', { t: clock((qDeadlines[String(q.id)] - now) / 1000) })}`}
          </div>
        )}
        <div className={`mt-5 ${qExpired ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={qExpired}>
          <QuestionInput q={q} value={value} lang={lang} token={token} preview={mode === 'preview'} onChange={(v, adv) => setAnswer(q, v, { advance: adv })} />
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
