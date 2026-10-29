// "🧪 O‘tishlarni tekshirish": try answers and see the route, plus a map of all jumps.
import { useMemo, useState } from 'react'
import { useApp } from '../../app-context'
import { Button, Input, Select } from '../../components/ui'
import { pick, type Key, type Lang } from '../../i18n'
import { hasLogic, logicKind, routeOf, rulesOf } from '../../logic'
import type { AnswerValue, Cond, JumpTarget, QuestionT } from '../../types'

type T = (key: Key, vars?: Record<string, string | number>) => string

/** "javob «Ha» bo‘lsa", "son 18 dan katta"… for the builder's badges and the map. */
export function describeCond(q: QuestionT, c: Cond, t: T, lang: Lang): string {
  const opt = (id: number) => {
    const o = q.options.find((x) => x.id === id)
    return o ? `«${pick(o, 'text', lang)}»` : '?'
  }
  const list = (c.options ?? []).map(opt).join(', ') || (c.values ?? []).map((v) => `«${t(v)}»`).join(', ')
  const yn = logicKind(q) === 'yes_no' && (c.op === 'is' || c.op === 'not') ? 'yn_' : ''
  const head = t(`op_${yn}${c.op}` as Key)
  if (c.op === 'between') return `${head} ${c.min}–${c.max}`
  if (c.value !== undefined && c.value !== '') return `${head} ${typeof c.value === 'string' ? `«${c.value}»` : c.value}`
  return list ? `${head}: ${list}` : head
}

export function useTargetLabel(questions: QuestionT[]) {
  const { t, lang } = useApp()
  const numbers = useMemo(() => {
    const m: Record<number, number> = {}
    questions.filter((x) => x.qtype !== 'section').forEach((x, k) => (m[x.id] = k + 1))
    return m
  }, [questions])
  return (to: JumpTarget): string => {
    if (to === null) return t('jumpNext')
    if (to === 'end') return `🏁 ${t('jumpEnd')}`
    const x = questions.find((y) => y.id === to)
    if (!x) return `⛔ ${t('jumpBroken')}`
    return x.qtype === 'section' ? `📂 ${pick(x, 'text', lang)}` : t('questionShort', { n: numbers[x.id] })
  }
}

/** Pick answers for the questions that have jumps and see which questions the respondent gets. */
export function LogicTester({ questions }: { questions: QuestionT[] }) {
  const { t, lang } = useApp()
  const visible = questions.filter((q) => !q.hidden)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const route = routeOf(visible, answers)
  const onRoute = new Set(route.map((q) => q.id))
  const numbers: Record<number, number> = {}
  visible.filter((x) => x.qtype !== 'section').forEach((x, k) => (numbers[x.id] = k + 1))
  const set = (q: QuestionT, v: AnswerValue | undefined) =>
    setAnswers((a) => {
      const next = { ...a }
      if (v === undefined) delete next[String(q.id)]
      else next[String(q.id)] = v
      return next
    })
  const deciding = route.filter((q) => hasLogic(q) && q.qtype !== 'section')
  const shown = route.filter((q) => q.qtype !== 'section')
  const skipped = visible.filter((q) => q.qtype !== 'section' && q.qtype !== 'info' && !onRoute.has(q.id))

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('testerHint')}</p>
      {deciding.length === 0 && <p className="text-sm text-muted">{t('testerNoLogic')}</p>}
      {deciding.map((q) => (
        <div key={q.id} className="rounded-xl border border-line p-3">
          <div className="mb-2 text-sm font-semibold">
            {numbers[q.id]}. {pick(q, 'text', lang)}
          </div>
          <AnswerPicker q={q} value={answers[String(q.id)]} onChange={(v) => set(q, v)} />
        </div>
      ))}
      <div className="rounded-xl bg-navy-50 p-3 dark:bg-white/5">
        <div className="text-sm font-bold">
          {t('testerRoute')} ({shown.length})
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((q) => (
            <span key={q.id} className="rounded-lg bg-brand-600 px-2 py-0.5 text-sm font-bold text-white">
              {numbers[q.id]}
            </span>
          ))}
          <span className="px-1 text-sm">🏁</span>
        </div>
        {skipped.length > 0 && (
          <div className="mt-2 text-sm text-muted">
            {t('testerSkipped')}: {skipped.map((q) => numbers[q.id]).join(', ')}
          </div>
        )}
      </div>
      {Object.keys(answers).length > 0 && (
        <Button size="sm" variant="soft" onClick={() => setAnswers({})}>
          ↺ {t('testerReset')}
        </Button>
      )}
    </div>
  )
}

function AnswerPicker({ q, value, onChange }: { q: QuestionT; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void }) {
  const { t, lang } = useApp()
  const k = logicKind(q)
  if (k === 'single' || k === 'yes_no') {
    const cur = k === 'yes_no' ? (value?.unsure ? 'unsure' : value?.bool != null ? (value.bool ? 'yes' : 'no') : '') : String(value?.option_id ?? '')
    return (
      <Select
        value={cur}
        onChange={(e) => {
          const v = e.target.value
          if (!v) return onChange(undefined)
          if (k === 'yes_no') onChange(v === 'unsure' ? { unsure: true } : { bool: v === 'yes' })
          else onChange({ option_id: Number(v) })
        }}
      >
        <option value="">— {t('testerNoAnswer')} —</option>
        {k === 'yes_no'
          ? ['yes', 'no', ...(q.settings?.unsure ? ['unsure'] : [])].map((v) => (
              <option key={v} value={v}>
                {t(v as 'yes')}
              </option>
            ))
          : q.options.map((o) => (
              <option key={o.id} value={o.id}>
                {pick(o, 'text', lang)}
              </option>
            ))}
      </Select>
    )
  }
  if (k === 'multi') {
    const picked = value?.option_ids ?? []
    return (
      <div className="flex flex-wrap gap-2">
        {q.options.map((o) => {
          const on = picked.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                const ids = on ? picked.filter((x) => x !== o.id) : [...picked, o.id]
                onChange(ids.length ? { option_ids: ids } : undefined)
              }}
              className={`rounded-full border-2 px-3 py-1.5 text-sm font-semibold ${on ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200' : 'border-line text-muted'}`}
            >
              {on ? '✓ ' : ''}
              {pick(o, 'text', lang)}
            </button>
          )
        })}
      </div>
    )
  }
  if (k === 'number') {
    const n = value?.number ?? value?.rating
    return (
      <Input
        type="number"
        inputMode="decimal"
        value={n ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? undefined : q.qtype === 'number' ? { number: Number(e.target.value) } : { rating: Number(e.target.value) })
        }
      />
    )
  }
  if (k === 'text') return <Input value={value?.text ?? ''} onChange={(e) => onChange(e.target.value ? { text: e.target.value } : undefined)} />
  return (
    <Select value={value ? 'yes' : ''} onChange={(e) => onChange(e.target.value ? ({ answered: true } as AnswerValue) : undefined)}>
      <option value="">— {t('testerNoAnswer')} —</option>
      <option value="yes">{t('op_answered')}</option>
    </Select>
  )
}

const ROW = 30
const COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899']

/** Every question in a column and an arc for each jump, so the whole survey's branching is seen at once. */
export function LogicMap({ questions }: { questions: QuestionT[] }) {
  const { t, lang } = useApp()
  const label = useTargetLabel(questions)
  const visible = questions.filter((q) => !q.hidden)
  const index = new Map(visible.map((q, i) => [q.id, i]))
  const numbers: Record<number, number> = {}
  visible.filter((x) => x.qtype !== 'section').forEach((x, k) => (numbers[x.id] = k + 1))
  const endRow = visible.length
  const arcs: { from: number; to: number; color: string; text: string }[] = []
  visible.forEach((q, i) => {
    const r = rulesOf(q)
    const color = COLORS[arcs.length % COLORS.length]
    const add = (to: JumpTarget, text: string) => {
      if (to === null) return
      const j = to === 'end' ? endRow : index.get(to)
      if (j === undefined || j <= i) return
      arcs.push({ from: i, to: j, color, text })
    }
    r.rules.forEach((rule) => add(rule.to, describeCond(q, rule.if, t, lang)))
    add(r.default, r.rules.length ? t('ruleDefaultShort') : t('jumpAny'))
  })
  const lanes = Math.min(arcs.length, 12)
  const width = 24 + lanes * 14
  const base = width - 2
  const height = (endRow + 1) * ROW
  return (
    <div>
      <p className="mb-2 text-sm text-muted">{t('mapHint')}</p>
      <div className="flex overflow-x-auto rounded-xl border border-line p-2">
        <svg width={width} height={height} className="shrink-0" role="img" aria-label={t('mapTitle')}>
          {arcs.map((a, k) => {
            const y1 = a.from * ROW + ROW / 2
            const y2 = a.to * ROW + ROW / 2
            const left = base - 16 - (k % 12) * 14
            return (
              <g key={k}>
                <title>{a.text}</title>
                <path
                  d={`M ${base} ${y1} H ${left + 6} Q ${left} ${y1} ${left} ${y1 + 6} V ${y2 - 6} Q ${left} ${y2} ${left + 6} ${y2} H ${base}`}
                  fill="none"
                  stroke={a.color}
                  strokeWidth="2"
                />
                <path d={`M ${base - 7} ${y2 - 4} L ${base} ${y2} L ${base - 7} ${y2 + 4}`} fill="none" stroke={a.color} strokeWidth="2" />
              </g>
            )
          })}
        </svg>
        <div className="min-w-0 flex-1">
          {visible.map((q) => (
            <div key={q.id} style={{ height: ROW }} className="flex items-center gap-2 truncate text-sm">
              <span className={`shrink-0 rounded-md px-1.5 font-bold ${q.qtype === 'section' ? '' : 'bg-navy-800 text-white dark:bg-navy-500'}`}>
                {q.qtype === 'section' ? '📂' : numbers[q.id]}
              </span>
              <span className="truncate">{pick(q, 'text', lang)}</span>
            </div>
          ))}
          <div style={{ height: ROW }} className="flex items-center gap-2 text-sm font-semibold">
            🏁 {t('jumpEnd')}
          </div>
        </div>
      </div>
      {arcs.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {arcs.map((a, k) => (
            <li key={k} className="flex gap-2">
              <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
              <span>
                <b>{visible[a.from].qtype === 'section' ? '📂' : t('questionShort', { n: numbers[visible[a.from].id] })}</b>: {a.text} →{' '}
                <b>{a.to === endRow ? label('end') : label(visible[a.to].id)}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
