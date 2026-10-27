import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { useApp } from '../../app-context'
import SurveyRunner from '../../components/SurveyRunner'
import { Button, Empty, ErrorBox, Spinner } from '../../components/ui'
import { useLoad } from '../../hooks'
import type { AdminSurvey } from '../../types'

/** Shows the survey exactly as respondents will see it. Nothing is sent to the server. */
export default function Preview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { errorText, t } = useApp()
  const { data: s, error, loading, reload } = useLoad(() => api.get<AdminSurvey>(`/api/admin/surveys/${id}`), [id])
  if (loading) return <Spinner />
  if (error || !s) return <ErrorBox text={errorText(error)} onRetry={reload} />
  const questions = s.questions ?? []
  if (!questions.length)
    return (
      <Empty
        icon="❓"
        title={t('noQuestions')}
        hint={t('noQuestionsHint')}
        action={
          <Button variant="success" block onClick={() => navigate(`/admin/surveys/${s.id}/questions`)}>
            {t('addQuestion')}
          </Button>
        }
      />
    )
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-surface">
      <SurveyRunner
        surveyId={s.id}
        mode="preview"
        previewQuestions={questions}
        survey={{
          id: s.id,
          title_uz: s.title_uz,
          title_ru: s.title_ru,
          description_uz: s.description_uz,
          description_ru: s.description_ru,
          question_count: questions.length,
          estimated_minutes: s.estimated_minutes || s.estimated_minutes_auto,
          start_date: s.start_date,
          end_date: s.end_date,
          status: s.effective_status,
          survey_type: s.survey_type,
          allow_repeat: s.allow_repeat,
          closes_at: s.closes_at,
          time_limit_minutes: s.time_limit_minutes,
          timeout_policy: s.timeout_policy,
          completed: false,
          can_start: true,
        }}
        onExit={() => navigate(-1)}
      />
    </div>
  )
}
