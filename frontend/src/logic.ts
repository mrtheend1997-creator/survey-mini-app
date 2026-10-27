// Jumps between questions: the respondent's route through the survey.
// Same walk as route() in backend/app/services/logic.py, so the app and the server agree on
// which questions apply.
import type { AnswerValue, QuestionT } from './types'

function answerKey(q: QuestionT, v: AnswerValue | undefined): number | string | null {
  if (!v) return null
  if (q.qtype === 'yes_no') {
    if (v.unsure) return 'unsure'
    if (v.bool != null) return v.bool ? 'yes' : 'no'
    return null
  }
  return v.option_id ?? null
}

/** Where a question sends the respondent: a question id, 'end', or null for the next one. */
export function nextTarget(q: QuestionT, v: AnswerValue | undefined): number | 'end' | null {
  const jumps = q.logic?.jumps ?? []
  const key = answerKey(q, v)
  let fallback: number | 'end' | null = null
  for (const j of jumps) {
    if (j.when === '*') fallback = j.to
    else if (key !== null && j.when === key) return j.to
  }
  return fallback
}

/** Questions (and sections) on the respondent's way, in order, given the answers so far. */
export function routeOf(questions: QuestionT[], answers: Record<string, AnswerValue>): QuestionT[] {
  const index = new Map(questions.map((q, i) => [q.id, i]))
  const out: QuestionT[] = []
  let i = 0
  while (i < questions.length) {
    const q = questions[i]
    out.push(q)
    const target = nextTarget(q, answers[String(q.id)])
    if (target === 'end') break
    const j = target !== null ? index.get(target) : undefined
    i = j !== undefined && j > i ? j : i + 1
  }
  return out
}

export const isSection = (q: QuestionT) => q.qtype === 'section'

/** The section a question belongs to (the last section before it), if any. */
export function sectionOf(questions: QuestionT[], q: QuestionT): QuestionT | null {
  let current: QuestionT | null = null
  for (const x of questions) {
    if (x.id === q.id) return current
    if (isSection(x)) current = x
  }
  return null
}

/** Which answers each question can jump on. */
export function jumpChoices(q: QuestionT): { when: number | 'yes' | 'no' | 'unsure'; label?: string; optionIndex?: number }[] {
  if (q.qtype === 'yes_no') return (['yes', 'no', ...(q.settings?.unsure ? ['unsure' as const] : [])] as const).map((w) => ({ when: w }))
  if (q.qtype === 'single' || q.qtype === 'dropdown' || (q.qtype === 'image_choice' && !q.settings?.multiple))
    return q.options.map((o, i) => ({ when: o.id, optionIndex: i }))
  return []
}
