import type { Me } from './types'

/** Permission switches set by the Super Admin (same names as on the server). */
export const PERMISSIONS = [
  'survey_create',
  'survey_edit',
  'survey_delete',
  'question_manage',
  'question_type',
  'option_manage',
  'timer_manage',
  'anonymity_manage',
  'logic_manage',
  'media_manage',
  'template_manage',
  'publish',
  'results_view',
  'export',
  'participants_manage',
] as const

export type Perm = (typeof PERMISSIONS)[number]
export type AccessLevel = 'view' | 'edit' | 'full'

/** May the current user do this with this survey? (the server decides; this only hides buttons) */
export function can(survey: { permissions?: string[] } | null | undefined, perm: Perm): boolean {
  return !!survey?.permissions?.includes(perm)
}

/** Is this permission switched on for the current user at all? */
export function meCan(me: Me | null | undefined, perm: Perm): boolean {
  return !!me?.permissions?.includes(perm)
}
