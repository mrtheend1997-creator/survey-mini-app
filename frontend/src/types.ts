export type Role = 'super_admin' | 'admin' | 'analyst' | 'user'
export type QType =
  | 'single'
  | 'multiple'
  | 'dropdown'
  | 'image_choice'
  | 'short_text'
  | 'text'
  | 'scale'
  | 'stars'
  | 'nps'
  | 'yes_no'
  | 'date'
  | 'time'
  | 'number'
  | 'matrix'
  | 'matrix_multi'
  | 'ranking'
  | 'points'
  | 'pairwise'
  | 'file'
  | 'video'
  | 'contact'
  | 'region'
  | 'info'
  | 'section'
  | 'rating5'
  | 'rating10'
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
  permissions: string[]
}

export interface OptionT {
  id?: number
  text_uz: string
  text_ru: string
  image_url?: string
  removed?: boolean
}

export interface MatrixRow {
  id?: string
  text_uz: string
  text_ru: string
}

export type ContactField = 'full_name' | 'phone' | 'email' | 'organization' | 'position'

/** Type-specific question settings; which keys are used depends on the question type. */
export interface QSettings {
  min_len?: number | null
  max_len?: number | null
  format?: 'any' | 'email' | 'phone' | 'digits' | 'letters' | 'url'
  min?: number | null
  max?: number | null
  step?: number
  label_min_uz?: string
  label_min_ru?: string
  label_max_uz?: string
  label_max_ru?: string
  count?: number
  unsure?: boolean
  min_date?: string | null
  max_date?: string | null
  no_past?: boolean
  no_future?: boolean
  min_time?: string | null
  max_time?: string | null
  integer?: boolean
  unit_uz?: string
  unit_ru?: string
  rows?: MatrixRow[]
  multiple?: boolean
  total?: number
  formats?: string[]
  max_mb?: number
  max_files?: number
  fields?: Partial<Record<ContactField, boolean>>
  purpose_uz?: string
  purpose_ru?: string
  district?: boolean
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
  description_uz?: string
  description_ru?: string
  video_url?: string
  hidden?: boolean
  settings?: QSettings
  time_limit_seconds?: number | null
  logic?: QLogic | null
  options: (OptionT & { id: number })[]
  position?: number
}

/** Where the respondent goes after a question: "when" is an option id, "yes"/"no"/"unsure" or "*" (any answer). */
export interface Jump {
  when: number | 'yes' | 'no' | 'unsure' | '*'
  to: number | 'end'
}
export interface QLogic {
  jumps: Jump[]
}

export interface UploadedFile {
  key: string
  name: string
  size: number
}

export interface RegionT {
  id: number
  name_uz: string
  name_ru: string
  districts: { id: number; name_uz: string; name_ru: string }[]
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
  unsure?: boolean
  time?: string
  matrix?: Record<string, number | number[]>
  order?: number[]
  points?: Record<string, number>
  pairs?: Record<string, number>
  files?: UploadedFile[]
  contact?: Partial<Record<ContactField, string>>
  region?: number
  district?: number | null
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
  closes_at?: string | null
  time_limit_minutes?: number | null
  timeout_policy?: TimeoutPolicy
  allow_edit?: boolean
  thanks_uz?: string
  thanks_ru?: string
  can_edit?: boolean
  locked?: boolean
  attempts_used?: number
  attempts_limit?: number | null
}

export type TimeoutPolicy = 'submit' | 'incomplete' | 'lock'

export interface SurveyFull extends SurveyCard {
  version_id: number
  questions: QuestionT[]
}

export interface ResponseState {
  token: string
  status: 'in_progress' | 'completed' | 'timed_out'
  current_index: number
  version_id: number
  questions: QuestionT[]
  answers: Record<string, AnswerValue>
  /** counted by the server; null when the survey has no time limit */
  remaining_seconds?: number | null
  question_time_left?: Record<string, number>
  editing?: boolean
  timed_out?: boolean
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
  opens_at?: string | null
  closes_at?: string | null
  time_limit_minutes?: number | null
  timeout_policy?: TimeoutPolicy
  max_attempts?: number | null
  allow_edit?: boolean
  thanks_uz?: string
  thanks_ru?: string
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
  access_level: 'view' | 'edit' | 'full' | null
  permissions: string[]
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
  image_url?: string
  average?: number | null
}

export interface QuestionResult extends QuestionT {
  removed: boolean
  answered: number
  not_applicable?: number
  stats:
    | { kind: 'choice'; items: StatItem[]; other_texts?: string[]; districts?: StatItem[] }
    | {
        kind: 'rating'
        items: StatItem[]
        average: number | null
        nps?: { score: number | null; promoters: number; passives: number; detractors: number }
      }
    | { kind: 'number'; average: number | null; min: number | null; max: number | null }
    | { kind: 'list'; values: string[] }
    | {
        kind: 'matrix'
        columns: { option_id: number; text_uz: string; text_ru: string }[]
        rows: { id: string; text_uz: string; text_ru: string; answered: number; cells: { option_id: number; count: number; percent: number }[] }[]
      }
    | { kind: 'ranking'; items: StatItem[]; pairwise?: boolean }
    | { kind: 'points'; items: StatItem[]; total: number }
    | { kind: 'none' }
}

export interface SurveyResults {
  survey_id: number
  title_uz: string
  title_ru: string
  participants: number
  completed: number
  in_progress: number
  timed_out?: number
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
  all_surveys_level: 'view' | 'edit' | 'full'
  permissions: Record<string, boolean>
  surveys: { id: number; level: 'view' | 'edit' | 'full' }[]
  owned_surveys: number
  role_assigned_at: string | null
  role_assigned_by: string | null
  joined_at: string | null
  last_seen_at: string | null
  from_server_settings: boolean
  is_me: boolean
}
