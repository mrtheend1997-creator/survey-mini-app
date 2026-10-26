export type Role = 'super_admin' | 'admin' | 'analyst' | 'user'
export type QType = 'single' | 'multiple' | 'text' | 'number' | 'yes_no' | 'rating5' | 'rating10' | 'dropdown' | 'date'
export type SurveyStatus = 'draft' | 'active' | 'paused' | 'finished'
export type SurveyType = 'anonymous' | 'named' | 'registered'

export interface Me {
  id: number
  telegram_id: number
  first_name: string
  last_name: string
  username: string
  language: 'uz' | 'ru'
  role: Role
  can_admin: boolean
  can_export: boolean
  can_publish: boolean
}

export interface OptionT {
  id?: number
  text_uz: string
  text_ru: string
  removed?: boolean
}

export interface QuestionT {
  id: number
  qtype: QType
  text_uz: string
  text_ru: string
  hint_uz: string
  hint_ru: string
  image_url: string
  required: boolean
  min_choices: number | null
  max_choices: number | null
  allow_other: boolean
  options: (OptionT & { id: number })[]
  position?: number
}

export type AnswerValue = {
  option_id?: number
  option_ids?: number[]
  other?: string | null
  text?: string
  number?: number
  bool?: boolean
  rating?: number
  date?: string
}

export interface SurveyCard {
  id: number
  title_uz: string
  title_ru: string
  description_uz: string
  description_ru: string
  question_count: number
  estimated_minutes: number
  start_date: string | null
  end_date: string | null
  status: SurveyStatus
  survey_type: SurveyType
  allow_repeat: boolean
  completed: boolean
  can_start: boolean
}

export interface SurveyFull extends SurveyCard {
  version_id: number
  questions: QuestionT[]
}

export interface ResponseState {
  token: string
  status: 'in_progress' | 'completed'
  current_index: number
  version_id: number
  questions: QuestionT[]
  answers: Record<string, AnswerValue>
}

export interface AdminSurvey {
  id: number
  title_uz: string
  title_ru: string
  description_uz: string
  description_ru: string
  start_date: string | null
  end_date: string | null
  survey_type: SurveyType
  allow_repeat: boolean
  status: SurveyStatus
  effective_status: SurveyStatus
  estimated_minutes: number | null
  estimated_minutes_auto: number
  published_version_id: number | null
  version_number: number | null
  has_unpublished_changes: boolean
  question_count: number
  responses_count: number
  completed_count: number
  owner: { id: number; name: string } | null
  manager_ids: number[]
  can_manage: boolean
  created_at: string
  updated_at: string
  questions?: QuestionT[]
  versions?: { id: number; number: number; created_at: string; question_count: number }[]
}

export interface StatItem {
  option_id: number | string | null
  text_uz: string
  text_ru: string
  count: number
  percent: number
  removed?: boolean
}

export interface QuestionResult extends QuestionT {
  removed: boolean
  answered: number
  stats:
    | { kind: 'choice'; items: StatItem[]; other_texts?: string[] }
    | { kind: 'rating'; items: StatItem[]; average: number | null }
    | { kind: 'number'; average: number | null; min: number | null; max: number | null }
    | { kind: 'list'; values: string[] }
}

export interface SurveyResults {
  survey_id: number
  title_uz: string
  title_ru: string
  participants: number
  completed: number
  in_progress: number
  completion_rate: number
  per_day: { day: string; count: number }[]
  questions: QuestionResult[]
  versions: { id: number; number: number; created_at: string }[]
}

export interface UserRow {
  id: number
  telegram_id: number
  first_name: string
  last_name: string
  username: string
  language: string
  role: Role
  is_blocked: boolean
  created_at: string
  last_seen_at: string | null
  joined_at: string | null
  display_name: string
  admin_suspended: boolean
}

export type StaffRole = 'super_admin' | 'admin' | 'analyst'
export type AdminStatus = 'active' | 'pending' | 'suspended' | 'blocked'

export interface AdminRow {
  id: number
  telegram_id: number
  name: string
  display_name: string
  username: string
  role: StaffRole
  status: AdminStatus
  all_surveys: boolean
  can_export: boolean
  can_publish: boolean
  survey_ids: number[]
  owned_surveys: number
  role_assigned_at: string | null
  role_assigned_by: string | null
  joined_at: string | null
  last_seen_at: string | null
  from_server_settings: boolean
  is_me: boolean
}
