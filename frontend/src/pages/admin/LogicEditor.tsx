// "🔀 Shartli o‘tish": conditional jumps of one question, edited without any code.
// Rules are tried from the top; the first one that holds decides where the respondent goes,
// otherwise the default does. Targets are only later questions or sections, so a survey can't loop.
import { useApp } from '../../app-context'
import { Button, Input, Label, Select } from '../../components/ui'
import { pick } from '../../i18n'
import { logicKind, opsFor } from '../../logic'
import type { Cond, CondOp, JumpTarget, QLogic, QSettings, QType, QuestionT } from '../../types'
import { IconBtn } from './QuestionEditor'

type YesNo = 'yes' | 'no' | 'unsure'

export function blankCond(op: CondOp): Cond {
  if (op === 'between') return { op, min: 0, max: 10 }
  if (['gt', 'gte', 'lt', 'lte', 'eq'].includes(op)) return { op, value: 0 }
  if (op === 'equals' || op === 'contains') return { op, value: '' }
  if (op === 'answered' || op === 'unanswered') return { op }
  return { op, options: [], values: [] }
}

/** The rules to save: conditions that can't work any more (deleted options, empty values) are left out. */
export function cleanLogic(l: QLogic, q: { qtype: QType; settings: QSettings }, optionIds: number[]): QLogic | null {
  const k = logicKind(q)
  const ops = opsFor(k)
  const rules = l.rules
    .filter((r) => ops.includes(r.if.op))
    .map((r) => {
      const c = r.if
      if (k === 'yes_no' && (c.op === 'is' || c.op === 'not')) return { ...r, if: { op: c.op, values: c.values ?? [] } }
      if ((k === 'single' || k === 'multi') && c.options) {
        const opts = c.options.filter((o) => optionIds.includes(o))
        return { ...r, if: { op: c.op, options: c.op === 'has' || c.op === 'lacks' ? opts.slice(0, 1) : opts } }
      }
      return r
    })
    .filter((r) => {
      const c = r.if
      if (c.op === 'is' || c.op === 'not') return k === 'yes_no' ? !!c.values?.length : !!c.options?.length
      if (['has', 'lacks', 'any', 'all'].includes(c.op)) return !!c.options?.length
      if (c.op === 'equals' || c.op === 'contains') return String(c.value ?? '').trim() !== ''
      if (c.op === 'between') return typeof c.min === 'number' && typeof c.max === 'number' && c.min <= c.max
      if (['gt', 'gte', 'lt', 'lte', 'eq'].includes(c.op)) return typeof c.value === 'number'
      return true
    })
  return rules.length || l.default !== null ? { rules, default: l.default } : null
}

export default function LogicEditor({
  value,
  onChange,
  question,
  qtype,
  settings,
  options,
  allQuestions,
  disabled,
}: {
  value: QLogic
  onChange: (l: QLogic) => void
  question: QuestionT | null
  qtype: QType
  settings: QSettings
  options: { id?: number | null; text_uz: string; text_ru: string }[]
  allQuestions: QuestionT[]
  disabled: boolean
}) {
  const { t, lang } = useApp()
  const kind = logicKind({ qtype, settings })
  const ops = opsFor(kind)
  const saved = options.filter((o): o is typeof o & { id: number } => o.id != null)
  const pos = question ? allQuestions.findIndex((x) => x.id === question.id) : -1
  // only forward: a jump back would make the survey go round in circles
  const later = pos >= 0 ? allQuestions.slice(pos + 1).filter((x) => !x.hidden) : []
  let n = allQuestions.slice(0, pos + 1).filter((x) => x.qtype !== 'section').length
  const targets = later.map((x) => {
    const text = pick(x, 'text', lang)
    const short = text.length > 60 ? text.slice(0, 60) + '…' : text
    return { value: String(x.id), label: x.qtype === 'section' ? `📂 ${t('sectionWord')}: ${short}` : `${t('questionShort', { n: ++n })}: ${short}` }
  })

  const setRule = (i: number, r: QLogic['rules'][number]) => onChange({ ...value, rules: value.rules.map((x, k) => (k === i ? r : x)) })
  const moveRule = (i: number, d: -1 | 1) => {
    const rules = [...value.rules]
    ;[rules[i], rules[i + d]] = [rules[i + d], rules[i]]
    onChange({ ...value, rules })
  }
  const addRule = () => onChange({ ...value, rules: [...value.rules, { if: blankCond(ops[0]), to: null }] })
  // one rule per answer option: "Ha → 20-savol, Yo‘q → 7-savol…"
  const perAnswer = () => {
    const have = new Set(value.rules.map((r) => JSON.stringify(r.if)))
    const fresh =
      kind === 'yes_no'
        ? (['yes', 'no', ...(settings.unsure ? ['unsure' as const] : [])] as YesNo[]).map((v) => ({ op: 'is' as const, values: [v] }))
        : saved.map((o) => ({ op: 'is' as const, options: [o.id] }))
    onChange({ ...value, rules: [...value.rules, ...fresh.filter((c) => !have.has(JSON.stringify(c))).map((c) => ({ if: c, to: null }))] })
  }

  const targetSelect = (to: JumpTarget, set: (v: JumpTarget) => void, nextLabel = t('jumpNext')) => (
    <Select
      value={to === null ? '' : String(to)}
      disabled={disabled}
      onChange={(e) => set(e.target.value === '' ? null : e.target.value === 'end' ? 'end' : Number(e.target.value))}
    >
      <option value="">➡️ {nextLabel}</option>
      {targets.map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
      {typeof to === 'number' && !targets.some((x) => x.value === String(to)) && <option value={String(to)}>⛔ {t('jumpBroken')}</option>}
      <option value="end">🏁 {t('jumpEnd')}</option>
    </Select>
  )

  const used = value.rules.length > 0 || value.default !== null
  return (
    <details className="rounded-2xl border border-line bg-card p-3" open={used}>
      <summary className="cursor-pointer select-none font-semibold">🔀 {t('jumpsTitle')}</summary>
      <div className="mt-3 space-y-4">
        {!question ? (
          <p className="text-sm text-muted">{t('jumpsSaveFirst')}</p>
        ) : (
          <>
            <p className="text-sm text-muted">{t('rulesHint')}</p>
            {value.rules.map((r, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-muted">{t('ruleN', { n: i + 1 })}</span>
                  {!disabled && (
                    <div className="flex gap-1">
                      <IconBtn label="⬆️" title={t('moveUp')} disabled={i === 0} onClick={() => moveRule(i, -1)} />
                      <IconBtn label="⬇️" title={t('moveDown')} disabled={i === value.rules.length - 1} onClick={() => moveRule(i, 1)} />
                      <IconBtn label="🗑️" title={t('delete')} onClick={() => onChange({ ...value, rules: value.rules.filter((_, k) => k !== i) })} />
                    </div>
                  )}
                </div>
                <CondEditor
                  cond={r.if}
                  kind={kind}
                  ops={ops}
                  options={saved}
                  unsure={!!settings.unsure}
                  disabled={disabled}
                  onChange={(c) => setRule(i, { ...r, if: c })}
                />
                <div className="mt-2">
                  <Label>{t('ruleThen')}</Label>
                  {targetSelect(r.to, (to) => setRule(i, { ...r, to }))}
                </div>
              </div>
            ))}
            {!disabled && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="soft" onClick={addRule}>
                  ➕ {t('ruleAdd')}
                </Button>
                {(kind === 'single' || kind === 'yes_no') && (
                  <Button size="sm" variant="soft" onClick={perAnswer}>
                    🧩 {t('rulePerAnswer')}
                  </Button>
                )}
              </div>
            )}
            <div>
              <Label>{value.rules.length ? t('ruleDefault') : t('jumpAfter')}</Label>
              {targetSelect(value.default, (to) => onChange({ ...value, default: to }), t('jumpNextDefault'))}
            </div>
          </>
        )}
        {disabled && <p className="text-sm text-muted">🔒 {t('jumpsNoRight')}</p>}
      </div>
    </details>
  )
}

function CondEditor({
  cond,
  kind,
  ops,
  options,
  unsure,
  disabled,
  onChange,
}: {
  cond: Cond
  kind: ReturnType<typeof logicKind>
  ops: CondOp[]
  options: { id: number; text_uz: string; text_ru: string }[]
  unsure: boolean
  disabled: boolean
  onChange: (c: Cond) => void
}) {
  const { t, lang } = useApp()
  const single = cond.op === 'has' || cond.op === 'lacks'
  const chip = (on: boolean, label: string, toggle: () => void, key: string | number) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      onClick={toggle}
      className={`rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition ${on ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200' : 'border-line text-muted'}`}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  )
  const toggleOption = (id: number) => {
    const cur = cond.options ?? []
    onChange({ ...cond, options: single ? [id] : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  const toggleValue = (v: YesNo) => {
    const cur = cond.values ?? []
    onChange({ ...cond, values: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })
  }
  const numInput = (field: 'value' | 'min' | 'max') => (
    <Input
      type="number"
      inputMode="decimal"
      disabled={disabled}
      value={cond[field] ?? ''}
      onChange={(e) => onChange({ ...cond, [field]: e.target.value === '' ? undefined : Number(e.target.value) })}
    />
  )
  return (
    <div className="space-y-2">
      <Label>{t('ruleIf')}</Label>
      <Select
        value={cond.op}
        disabled={disabled}
        onChange={(e) => {
          const op = e.target.value as CondOp
          const keep = cond.options?.length || cond.values?.length ? { options: cond.options, values: cond.values } : {}
          onChange({ ...blankCond(op), ...(['is', 'not', 'has', 'lacks', 'any', 'all'].includes(op) ? keep : {}) })
        }}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {t(`op_${kind === 'yes_no' && (op === 'is' || op === 'not') ? 'yn_' : ''}${op}` as 'op_is')}
          </option>
        ))}
      </Select>
      {kind === 'yes_no' && (cond.op === 'is' || cond.op === 'not') && (
        <div className="flex flex-wrap gap-2">
          {(['yes', 'no', ...(unsure ? ['unsure' as const] : [])] as YesNo[]).map((v) => chip((cond.values ?? []).includes(v), t(v), () => toggleValue(v), v))}
        </div>
      )}
      {(kind === 'single' || kind === 'multi') && ['is', 'not', 'has', 'lacks', 'any', 'all'].includes(cond.op) && (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => chip((cond.options ?? []).includes(o.id), pick(o, 'text', lang) || '…', () => toggleOption(o.id), o.id))}
          {!options.length && <p className="text-sm text-muted">{t('ruleSaveOptions')}</p>}
        </div>
      )}
      {['gt', 'gte', 'lt', 'lte', 'eq'].includes(cond.op) && numInput('value')}
      {cond.op === 'between' && (
        <div className="grid grid-cols-2 gap-2">
          {numInput('min')}
          {numInput('max')}
        </div>
      )}
      {(cond.op === 'equals' || cond.op === 'contains') && (
        <Input disabled={disabled} maxLength={500} value={String(cond.value ?? '')} onChange={(e) => onChange({ ...cond, value: e.target.value })} />
      )}
    </div>
  )
}
