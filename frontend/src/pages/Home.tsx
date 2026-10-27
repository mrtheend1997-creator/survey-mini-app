import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../app-context'
import { Header, Logo } from '../components/Header'
import { Button, Card, Empty, ErrorBox, Spinner, StatusBadge } from '../components/ui'
import { useLoad } from '../hooks'
import { formatDate, pick } from '../i18n'
import type { SurveyCard } from '../types'
import { getItem } from '../storage'
import { telegramUserId } from '../telegram'

export function hasDraft(surveyId: number): boolean {
  try {
    return !!getItem(`fti_resp_${telegramUserId()}_${surveyId}`)
  } catch {
    return false
  }
}

export default function Home() {
  const { me, t, lang, errorText } = useApp()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)
  const { data, error, loading, reload } = useLoad(() => api.get<SurveyCard[]>('/api/surveys'))

  return (
    <div className="min-h-screen pb-10">
      <Header />
      <main className="mx-auto max-w-3xl px-4">
        <section className="mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-navy-800 to-navy-600 p-6 text-center text-white shadow-lg sm:p-8">
          <Logo className="mx-auto h-24 w-24 shadow-lg sm:h-28 sm:w-28" />
          <h1 className="mt-4 text-2xl font-bold leading-tight sm:text-3xl">{t('welcomeTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-navy-100">{t('welcomeText')}</p>
          <Button variant="success" block className="mt-5" onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {t('viewSurveys')}
          </Button>
        </section>

        {me?.can_admin && (
          <Link
            to="/admin"
            className="mt-3 flex min-h-[54px] items-center justify-center rounded-2xl border-2 border-navy-800 bg-card text-base font-bold text-navy-800 dark:border-navy-200 dark:text-ink"
          >
            {t('adminPanel')}
          </Link>
        )}

        <div ref={listRef} className="scroll-mt-20">
          <h2 className="mb-3 mt-7 text-lg font-bold">{t('activeSurveys')}</h2>
          {loading && <Spinner />}
          {!loading && !!error && <ErrorBox text={errorText(error)} onRetry={reload} />}
          {!loading && data && data.length === 0 && <Empty icon="🗂️" title={t('noSurveys')} hint={t('noSurveysHint')} />}
          <div className="space-y-3">
            {data?.map((s) => {
              const draft = hasDraft(s.id)
              return (
                <Card key={s.id} className="animate-slide-up">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[17px] font-bold leading-snug">{pick(s, 'title', lang)}</h3>
                    <StatusBadge status={s.status} />
                  </div>
                  {pick(s, 'description', lang) && <p className="mt-1.5 line-clamp-3 text-[15px] leading-relaxed text-muted">{pick(s, 'description', lang)}</p>}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span>❓ {t('questionsCount', { n: s.question_count })}</span>
                    <span>⏱️ {t('minutes', { n: s.estimated_minutes })}</span>
                    <span>
                      📅{' '}
                      {s.closes_at
                        ? t('until', { d: formatDate(s.closes_at, lang, true) })
                        : s.end_date
                          ? t('until', { d: formatDate(s.end_date, lang) })
                          : t('noDeadline')}
                    </span>
                    {!!s.time_limit_minutes && <span>⏰ {t('timeLimitShort', { n: s.time_limit_minutes })}</span>}
                    {!!s.attempts_limit && s.attempts_limit > 1 && <span>🔁 {t('attemptsOf', { used: s.attempts_used ?? 0, n: s.attempts_limit })}</span>}
                  </div>
                  {!s.can_start && !draft ? (
                    <>
                      <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-center font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">
                        {s.locked ? t('attemptsLocked') : s.completed ? t('completedBadge') : t('attemptsUsedUp')}
                      </div>
                      {s.can_edit && (
                        <Button variant="outline" block className="mt-2" onClick={() => navigate(`/survey/${s.id}`)}>
                          ✏️ {t('editAnswers')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button variant={draft ? 'success' : 'primary'} block className="mt-4" onClick={() => navigate(`/survey/${s.id}`)}>
                      {draft ? t('continue') : s.completed ? t('takeAgain') : t('start')} →
                    </Button>
                  )}
                </Card>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
