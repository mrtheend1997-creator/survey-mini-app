// Conditional jumps: the respondent's route through the survey.
// Same rules and the same walk as backend/app/services/logic.py, so the app and the server agree
// on which questions apply.
import type { AnswerValue, Cond, CondOp, LegacyLogic, QLogic, QuestionT } from './types'

export type LogicKind = 'single' | 'multi' | 'yes_no' | 'number' | 'text' | null

const NUMBER_TYPES = new Set(['number', 'scale', 'stars', 'nps', 'rating5', 'rating10'])

/** Which conditions a question can have (null: only answered / not answered). */
export function logicKind(q: Pick<QuestionT, 'qtype' | 'settings'>): LogicKind {
  if (q.qtype === 'image_choice') return q.settings?.multiple ? 'multi' : 'single'
  if (q.qtype === 'single' || q.qtype === 'dropdown') return 'single'
  if (q.qtype === 'multiple') return 'multi'
  if (q.qtype === 'yes_no') return 'yes_no'
  if (NUMBER_TYPES.has(q.qtype)) return 'number'
  if (q.qtype === 'short_text' || q.qtype === 'text') return 'text'
  return null
}

export function opsFor(k: LogicKind): CondOp[] {
  const own: Record<string, CondOp[]> = {
    single: ['is', 'not'],
    yes_no: ['is', 'not'],
    multi: ['has', 'lacks', 'any', 'all'],
    number: ['gt', 'gte', 'lt', 'lte', 'eq', 'between'],
    text: ['equals', 'contains'],
  }
  return [...(k ? own[k] : []), 'answered', 'unanswered']
}

/** A question's logic in the rules form, whatever form it was stored in. */
export function rulesOf(q: Pick<QuestionT, 'logic'>): QLogic {
  const raw = q.logic
  if (!raw) return { rules: [], default: null }
  if ('jumps' in raw && !('rules' in raw)) {
    const out: QLogic = { rules: [], default: null }
    for (const j of (raw as LegacyLogic).jumps) {
      if (j.when === '*') out.default = j.to
      else if (j.when === 'yes' || j.when === 'no' || j.when === 'unsure') out.rules.push({ if: { op: 'is', values: [j.when] }, to: j.to })
      else out.rules.push({ if: { op: 'is', options: [j.when] }, to: j.to })
    }
    return out
  }
  const l = raw as QLogic
  return { rules: l.rules ?? [], default: l.default ?? null }
}

export const hasLogic = (q: Pick<QuestionT, 'logic'>) => {
  const r = rulesOf(q)
  return r.rules.length > 0 || r.default !== null
}

const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLocaleLowerCase()
const answered = (v: AnswerValue | undefined) => !!v && Object.keys(v).length > 0

/** Does the answer meet the condition? */
export function holds(q: QuestionT, c: Cond, v: AnswerValue | undefined): boolean {
  if (c.op === 'answered') return answered(v)
  if (c.op === 'unanswered') return !answered(v)
  if (!v || !answered(v)) return false
  const k = logicKind(q)
  if (k === 'yes_no') {
    const got = v.unsure ? 'unsure' : v.bool != null ? (v.bool ? 'yes' : 'no') : null
    if (!got) return false
    const inside = (c.values ?? []).includes(got)
    return c.op === 'is' ? inside : !inside
  }
  if (k === 'single') {
    const inside = v.option_id != null && (c.options ?? []).includes(v.option_id)
    return c.op === 'is' ? inside : !inside
  }
  if (k === 'multi') {
    const picked = new Set(v.option_ids ?? [])
    if (v.option_id != null) picked.add(v.option_id)
    const wanted = c.options ?? []
    if (c.op === 'has' || c.op === 'any') return wanted.some((o) => picked.has(o))
    if (c.op === 'lacks') return !wanted.some((o) => picked.has(o))
    return wanted.every((o) => picked.has(o))
  }
  if (k === 'number') {
    const n = v.number ?? v.rating
    if (typeof n !== 'number') return false
    if (c.op === 'between') return (c.min ?? -Infinity) <= n && n <= (c.max ?? Infinity)
    const x = Number(c.value)
    return { gt: n > x, gte: n >= x, lt: n < x, lte: n <= x, eq: n === x }[c.op as 'gt'] ?? false
  }
  if (k === 'text') {
    if (typeof v.text !== 'string') return false
    const want = norm(String(c.value ?? ''))
    return c.op === 'equals' ? norm(v.text) === want : norm(v.text).includes(want)
  }
  return false
}

/** Where a question sends the respondent: a question id, 'end', or null for the next one. */
export function nextTarget(q: QuestionT, v: AnswerValue | undefined): number | 'end' | null {
  const r = rulesOf(q)
  for (const rule of r.rules) if (holds(q, rule.if, v)) return rule.to
  return r.default
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
