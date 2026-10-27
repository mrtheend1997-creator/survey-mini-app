import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, ApiError } from './api'
import { useApp } from './app-context'
import { ErrorBox, Spinner } from './components/ui'
import { Logo } from './components/Header'
import { getItem } from './storage'
import { tg } from './telegram'
import type { Me } from './types'
import Home from './pages/Home'
import SurveyPage from './pages/SurveyPage'
import Profile from './pages/Profile'
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminHome = lazy(() => import('./pages/admin/AdminHome'))
const AdminSurveys = lazy(() => import('./pages/admin/AdminSurveys'))
const SurveyForm = lazy(() => import('./pages/admin/SurveyForm'))
const QuestionBuilder = lazy(() => import('./pages/admin/QuestionBuilder'))
const SurveyPicker = lazy(() => import('./pages/admin/SurveyPicker'))
const AdminResponses = lazy(() => import('./pages/admin/AdminResponses'))
const AdminResults = lazy(() => import('./pages/admin/AdminResults'))
const AdminStats = lazy(() => import('./pages/admin/AdminStats'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminAdmins = lazy(() => import('./pages/admin/AdminAdmins'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))
const Preview = lazy(() => import('./pages/admin/Preview'))

export default function App() {
  const { me, setMe, t, errorText, lang, setLang } = useApp()
  const [error, setError] = useState<unknown>(null)

  const load = () => {
    setError(null)
    api
      .get<Me>('/api/me')
      .then((m) => {
        setMe(m)
        // first visit: use the language stored in the profile
        if (!getItem('fti_lang') && m.language !== lang) setLang(m.language)
      })
      .catch(setError)
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    const authProblem = error instanceof ApiError && error.status === 401 && !tg
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
        <Logo size={72} />
        <ErrorBox text={authProblem ? t('openInTelegram') : errorText(error)} onRetry={authProblem ? undefined : load} />
      </div>
    )
  }
  if (!me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Logo size={72} />
        <Spinner />
      </div>
    )
  }

  const staff = me.can_admin
  const superAdmin = me.role === 'super_admin'

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/survey/:id" element={<SurveyPage />} />
        <Route path="/profile" element={<Profile />} />
        {staff && (
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminHome />} />
            <Route path="surveys" element={<AdminSurveys />} />
            {me.permissions.includes('survey_create') && <Route path="surveys/new" element={<SurveyForm />} />}
            <Route path="surveys/:id" element={<SurveyForm />} />
            <Route path="surveys/:id/questions" element={<QuestionBuilder />} />
            <Route path="surveys/:id/preview" element={<Preview />} />
            <Route path="questions" element={<SurveyPicker target="questions" />} />
            <Route path="responses" element={<SurveyPicker target="responses" />} />
            <Route path="responses/:id" element={<AdminResponses />} />
            <Route path="results" element={<SurveyPicker target="results" />} />
            <Route path="results/:id" element={<AdminResults />} />
            <Route path="stats" element={<AdminStats />} />
            {superAdmin && <Route path="admins" element={<AdminAdmins />} />}
            {superAdmin && <Route path="users" element={<AdminUsers />} />}
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
