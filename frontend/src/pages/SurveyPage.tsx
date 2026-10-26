import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../app-context'
import SurveyRunner from '../components/SurveyRunner'
import { ErrorBox, Spinner } from '../components/ui'
import { useLoad, useTelegramBack } from '../hooks'
import type { SurveyFull } from '../types'

export default function SurveyPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { errorText, t } = useApp()
  useTelegramBack('/')
  const { data, error, loading, reload } = useLoad(() => api.get<SurveyFull>(`/api/surveys/${id}`), [id])

  if (loading) return <Spinner label={t('loading')} />
  if (error || !data)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox text={errorText(error)} onRetry={reload} />
        <button className="mt-4 w-full text-center font-semibold text-muted" onClick={() => navigate('/')}>
          {t('toHome')}
        </button>
      </div>
    )
  return <SurveyRunner surveyId={data.id} survey={data} mode="live" onExit={() => navigate('/')} />
}
