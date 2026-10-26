import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, Empty, ErrorBox, Spinner, StatusBadge } from '../../components/ui'
import { useLoad } from '../../hooks'
import { pick, type Key } from '../../i18n'
import type { AdminSurvey } from '../../types'

const TITLES: Record<string, Key> = { questions: 'nav_questions', responses: 'nav_responses', results: 'nav_results' }

/** Shared "choose a survey" screen for the Questions, Responses and Results sections. */
export default function SurveyPicker({ target }: { target: 'questions' | 'responses' | 'results' }) {
  const { t, lang, me, errorText } = useApp()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useLoad(() => api.get<AdminSurvey[]>('/api/admin/surveys'))
  const manager = me?.role === 'admin' || me?.role === 'super_admin'
  const list = target === 'questions' ? data?.filter((s) => s.can_manage) : data

  const go = (s: AdminSurvey) => {
    if (target === 'questions') navigate(`/admin/surveys/${s.id}/questions`)
    else navigate(`/admin/${target}/${s.id}`)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">{t(TITLES[target])}</h1>
      <p className="mt-1 text-muted">{t('selectSurvey')}</p>
      <div className="mt-4 space-y-3">
        {loading && <Spinner />}
        {!!error && <ErrorBox text={errorText(error)} onRetry={reload} />}
        {list && list.length === 0 && (
          <Empty
            title={t('noData')}
            action={
              manager ? (
                <Button variant="success" block onClick={() => navigate('/admin/surveys/new')}>
                  {t('createSurvey')}
                </Button>
              ) : undefined
            }
          />
        )}
        {list?.map((s) => (
          <Card key={s.id} onClick={() => go(s)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold leading-snug">{pick(s, 'title', lang)}</div>
                <div className="mt-1 text-sm text-muted">
                  ❓ {t('questionsCount', { n: s.question_count })} · 📨 {t('responsesShort', { n: s.completed_count })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={s.effective_status} />
                <span className="text-xl text-muted">›</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
