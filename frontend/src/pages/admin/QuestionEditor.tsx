import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Bilingual, Button, ConfirmDialog, Input, Label, Modal, Select, Toggle } from '../../components/ui'
import {
  CONTACT_FIELDS,
  FILE_FORMATS,
  LEGACY_TYPES,
  MAX_PAIRWISE,
  OPTION_TYPES,
  OTHER_TYPES,
  QTYPE_GROUPS,
  QTYPE_ICON,
  defaultSettings,
  isMulti,
} from '../../qtypes'
import { rulesOf } from '../../logic'
import type { MatrixRow, QLogic, QSettings, QType, QuestionT, SurveyType } from '../../types'
import LogicEditor, { cleanLogic } from './LogicEditor'

interface OptionDraft {
  key: string
  id?: number
  text_uz: string
  text_ru: string
  image_url: string
}

interface RowDraft extends MatrixRow {
  key: string
}

interface Draft {
  text_uz: string
  text_ru: string
  qtype: QType
  required: boolean
  hint_uz: string
  hint_ru: string
  description_uz: string
  description_ru: string
  image_url: string
  video_url: string
  hidden: boolean
  time_limit: string
  // conditional jumps (rules form), edited in LogicEditor
  logic: QLogic
  min_choices: string
  max_choices: string
  allow_other: boolean
  options: OptionDraft[]
  rows: RowDraft[]
  settings: QSettings
}

let keySeq = 0
const newKey = () => `n${++keySeq}`
const blankOption = (): OptionDraft => ({ key: newKey(), text_uz: '', text_ru: '', image_url: '' })
const blankRow = (): RowDraft => ({ key: newKey(), text_uz: '', text_ru: '' })

function toDraft(q?: QuestionT | null): Draft {
  const settings = q ? { ...(q.settings ?? {}) } : defaultSettings('single')
  return {
    text_uz: q?.text_uz ?? '',
    text_ru: q?.text_ru ?? '',
    qtype: q?.qtype ?? 'single',
    required: q?.required ?? true,
    hint_uz: q?.hint_uz ?? '',
    hint_ru: q?.hint_ru ?? '',
    description_uz: q?.description_uz ?? '',
    description_ru: q?.description_ru ?? '',
    image_url: q?.image_url ?? '',
    video_url: q?.video_url ?? '',
    hidden: q?.hidden ?? false,
    time_limit: q?.time_limit_seconds ? String(q.time_limit_seconds) : '',
    logic: q ? rulesOf(q) : { rules: [], default: null },
    min_choices: q?.min_choices ? String(q.min_choices) : '',
    max_choices: q?.max_choices ? String(q.max_choices) : '',
    allow_other: q?.allow_other ?? false,
    options: q?.options.length
      ? q.options.map((o) => ({ key: `o${o.id}`, id: o.id, text_uz: o.text_uz, text_ru: o.text_ru, image_url: o.image_url ?? '' }))
      : [blankOption(), blankOption()],
    rows: (settings.rows ?? []).map((r) => ({ ...r, key: r.id ?? newKey() })),
    settings,
  }
}

/** Turn an input's text into a number setting (empty → null). */
const num = (v: string): number | null => (v.trim() === '' || isNaN(Number(v)) ? null : Number(v))

export default function QuestionEditor({
  open,
  surveyId,
  surveyType,
  question,
  allQuestions = [],
  permissions,
  onClose,
  onSaved,
}: {
  open: boolean
  surveyId: number
  surveyType: SurveyType
  question: QuestionT | null
  /** every question of the survey, for choosing jump targets */
  allQuestions?: QuestionT[]
  permissions: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t, toast, showError } = useApp()
  const [d, setD] = useState<Draft>(toDraft(question))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [removeKey, setRemoveKey] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string>('question')
  const optionRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (open) setD(toDraft(question))
  }, [open, question])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setS = (patch: Partial<QSettings>) => setD((x) => ({ ...x, settings: { ...x.settings, ...patch } }))
  const setOpt = (key: string, field: 'text_uz' | 'text_ru' | 'image_url', v: string) =>
    setD((x) => ({ ...x, options: x.options.map((o) => (o.key === key ? { ...o, [field]: v } : o)) }))
  const moveOpt = (i: number, dir: -1 | 1) =>
    setD((x) => {
      const j = i + dir
      if (j < 0 || j >= x.options.length) return x
      const opts = [...x.options]
      ;[opts[i], opts[j]] = [opts[j], opts[i]]
      return { ...x, options: opts }
    })
  const addOpt = () => {
    const o = blankOption()
    setD((x) => ({ ...x, options: [...x.options, o] }))
    setTimeout(() => optionRefs.current[o.key]?.focus(), 50)
  }
  const setRow = (key: string, field: 'text_uz' | 'text_ru', v: string) =>
    setD((x) => ({ ...x, rows: x.rows.map((r) => (r.key === key ? { ...r, [field]: v } : r)) }))

  const changeType = (qtype: QType) =>
    setD((x) => {
      const defaults = defaultSettings(qtype)
      return { ...x, qtype, settings: defaults, rows: (defaults.rows ?? []).map((r) => ({ ...r, key: newKey() })) }
    })

  const s = d.settings
  const hasOptions = OPTION_TYPES.has(d.qtype)
  const isMatrix = d.qtype === 'matrix' || d.qtype === 'matrix_multi'
  const multi = isMulti({ qtype: d.qtype, settings: s })
  // a new question is built freely; changing an existing one needs the matching permission
  const canType = !question || permissions.includes('question_type')
  const canOptions = !question || permissions.includes('option_manage')
  const canMedia = permissions.includes('media_manage')
  const canTimer = permissions.includes('timer_manage')
  const canLogic = permissions.includes('logic_manage')
  const noAnswer = d.qtype === 'info' || d.qtype === 'section'
  const pickTypes = QTYPE_GROUPS.map((g) => ({ ...g, types: g.types }))
  if (LEGACY_TYPES.includes(d.qtype)) pickTypes.push({ key: 'grpLegacy', types: [d.qtype] })

  const upload = async (file: File) => {
    const target = uploadTarget.current
    setUploading(target)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.upload<{ url: string }>('/api/admin/uploads', fd)
      if (target === 'question') set('image_url', res.url)
      else setOpt(target, 'image_url', res.url)
    } catch (e) {
      showError(e)
    } finally {
      setUploading(null)
    }
  }
  const pickImage = (target: string) => {
    uploadTarget.current = target
    fileRef.current?.click()
  }

  const save = async () => {
    setSaving(true)
    const settings: QSettings = { ...s }
    if (isMatrix) settings.rows = d.rows.map((r) => ({ id: r.id, text_uz: r.text_uz, text_ru: r.text_ru }))
    const body = {
      text_uz: d.text_uz,
      text_ru: d.text_ru,
      qtype: d.qtype,
      required: d.required,
      hint_uz: d.hint_uz,
      hint_ru: d.hint_ru,
      description_uz: d.description_uz,
      description_ru: d.description_ru,
      image_url: d.image_url,
      video_url: d.video_url.trim(),
      hidden: d.hidden,
      time_limit_seconds: !noAnswer && d.time_limit ? Number(d.time_limit) : null,
      logic: canLogic
        ? cleanLogic(
            d.logic,
            { qtype: d.qtype, settings },
            d.options.flatMap((o) => (o.id != null ? [o.id] : [])),
          )
        : (question?.logic ?? null),
      settings,
      min_choices: multi && d.min_choices ? Number(d.min_choices) : null,
      max_choices: multi && d.max_choices ? Number(d.max_choices) : null,
      allow_other: OTHER_TYPES.has(d.qtype) ? d.allow_other : false,
      options: hasOptions ? d.options.map((o) => ({ id: o.id ?? null, text_uz: o.text_uz, text_ru: o.text_ru, image_url: o.image_url })) : [],
    }
    try {
      if (question) await api.put(`/api/admin/questions/${question.id}`, body)
      else await api.post(`/api/admin/surveys/${surveyId}/questions`, body)
      toast(t('savedOk'))
      onSaved()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  const optionsLabel = isMatrix ? t('matrixColumns') : d.qtype === 'ranking' ? t('rankingItems') : t('options')

  return (
    <Modal
      open={open}
      full
      onClose={onClose}
      title={t('questionEditor')}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" block onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="success" block onClick={save} loading={saving}>
            {t('save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-4">
        <div>
          <Label>{t('questionType')}</Label>
          <Select value={d.qtype} disabled={!canType} onChange={(e) => changeType(e.target.value as QType)}>
            {pickTypes.map((g) => (
              <optgroup key={g.key} label={t(g.key as 'grpChoice')}>
                {g.types.map((q) => (
                  <option key={q} value={q}>
                    {QTYPE_ICON[q]} {t(`qt_${q}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <p className="mt-1.5 text-sm text-muted">{t(`qtHelp_${d.qtype}`)}</p>
        </div>

        <div>
          <Label required>{d.qtype === 'section' ? t('sectionTitle') : d.qtype === 'info' ? t('infoTitle') : t('questionUz')}</Label>
          <textarea
            rows={2}
            value={d.text_uz}
            onChange={(e) => set('text_uz', e.target.value)}
            className="w-full rounded-xl border-2 border-line bg-card px-3.5 py-3 text-base outline-none focus:border-navy-500"
          />
        </div>
        <div>
          <Label required>{d.qtype === 'section' ? t('sectionTitleRu') : d.qtype === 'info' ? t('infoTitleRu') : t('questionRu')}</Label>
          <textarea
            rows={2}
            value={d.text_ru}
            onChange={(e) => set('text_ru', e.target.value)}
            className="w-full rounded-xl border-2 border-line bg-card px-3.5 py-3 text-base outline-none focus:border-navy-500"
          />
        </div>

        {(noAnswer || d.qtype === 'video') && (
          <Bilingual
            label={t('qDescription')}
            multiline
            uz={d.description_uz}
            ru={d.description_ru}
            onUz={(v) => set('description_uz', v)}
            onRu={(v) => set('description_ru', v)}
          />
        )}

        {d.qtype === 'video' && <VideoField value={d.video_url} disabled={!canMedia} onChange={(v) => set('video_url', v)} />}

        {isMatrix && (
          <div>
            <Label required>{t('matrixRows')}</Label>
            <div className="space-y-2">
              {d.rows.map((r, i) => (
                <div key={r.key} className="rounded-2xl border border-line bg-card p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold">{t('rowN', { n: i + 1 })}</span>
                    {canOptions && d.rows.length > 1 && (
                      <IconBtn label="🗑️" title={t('delete')} onClick={() => setD((x) => ({ ...x, rows: x.rows.filter((y) => y.key !== r.key) }))} />
                    )}
                  </div>
                  <LangPair uz={r.text_uz} ru={r.text_ru} onUz={(v) => setRow(r.key, 'text_uz', v)} onRu={(v) => setRow(r.key, 'text_ru', v)} />
                </div>
              ))}
            </div>
            {canOptions && (
              <Button variant="soft" block className="mt-3" onClick={() => setD((x) => ({ ...x, rows: [...x.rows, blankRow()] }))}>
                {t('addRow')}
              </Button>
            )}
          </div>
        )}

        {hasOptions && (
          <div>
            <Label required>{optionsLabel}</Label>
            {d.qtype === 'pairwise' && <p className="mb-2 text-sm text-muted">{t('pairwiseLimit', { n: MAX_PAIRWISE })}</p>}
            <div className="space-y-3">
              {d.options.map((o, i) => (
                <div key={o.key} className="rounded-2xl border border-line bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-1">
                    <span className="font-semibold">{isMatrix ? t('columnN', { n: i + 1 }) : t('optionN', { n: i + 1 })}</span>
                    <div className="flex items-center gap-1">
                      <IconBtn label="⬆️" title={t('moveUp')} disabled={i === 0} onClick={() => moveOpt(i, -1)} />
                      <IconBtn label="⬇️" title={t('moveDown')} disabled={i === d.options.length - 1} onClick={() => moveOpt(i, 1)} />
                      {canOptions && <IconBtn label="🗑️" title={t('delete')} onClick={() => setRemoveKey(o.key)} />}
                    </div>
                  </div>
                  <LangPair
                    uz={o.text_uz}
                    ru={o.text_ru}
                    onUz={(v) => setOpt(o.key, 'text_uz', v)}
                    onRu={(v) => setOpt(o.key, 'text_ru', v)}
                    inputRef={(el) => (optionRefs.current[o.key] = el)}
                  />
                  {d.qtype === 'image_choice' && (
                    <div className="mt-2 flex items-center gap-3">
                      {o.image_url ? (
                        <img src={o.image_url} alt="" className="h-16 w-16 rounded-xl border border-line object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-navy-50 text-2xl dark:bg-white/5">🖼️</div>
                      )}
                      {canMedia && (
                        <div className="flex flex-1 gap-2">
                          <Button size="sm" variant="outline" className="flex-1" loading={uploading === o.key} onClick={() => pickImage(o.key)}>
                            {o.image_url ? t('replaceImage') : t('uploadImage')}
                          </Button>
                          {o.image_url && (
                            <Button size="sm" variant="outline" onClick={() => setOpt(o.key, 'image_url', '')}>
                              ✕
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {canOptions && !(d.qtype === 'pairwise' && d.options.length >= MAX_PAIRWISE) && (
              <Button variant="soft" block className="mt-3" onClick={addOpt}>
                {isMatrix ? t('addColumn') : t('addOption')}
              </Button>
            )}
          </div>
        )}

        <TypeSettings qtype={d.qtype} s={s} setS={setS} surveyType={surveyType} />

        <div className="space-y-3">
          {!noAnswer && <Toggle checked={d.required} onChange={(v) => set('required', v)} label={t('requiredQuestion')} />}
          {OTHER_TYPES.has(d.qtype) && <Toggle checked={d.allow_other} onChange={(v) => set('allow_other', v)} label={t('allowOther')} />}
        </div>

        {multi && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('minChoices')}</Label>
              <Input type="number" inputMode="numeric" min={0} value={d.min_choices} onChange={(e) => set('min_choices', e.target.value)} />
            </div>
            <div>
              <Label>{t('maxChoices')}</Label>
              <Input type="number" inputMode="numeric" min={1} value={d.max_choices} onChange={(e) => set('max_choices', e.target.value)} />
            </div>
          </div>
        )}

        {d.qtype !== 'section' && (
          <Bilingual label={t('hint')} multiline uz={d.hint_uz} ru={d.hint_ru} onUz={(v) => set('hint_uz', v)} onRu={(v) => set('hint_ru', v)} />
        )}

        {d.qtype !== 'section' && (
          <LogicEditor
            value={d.logic}
            onChange={(l) => set('logic', l)}
            question={question}
            qtype={d.qtype}
            settings={s}
            options={hasOptions ? d.options : []}
            allQuestions={allQuestions}
            disabled={!canLogic}
          />
        )}

        <details className="rounded-2xl border border-line bg-card p-3" open={d.hidden || !!d.time_limit || (!!d.video_url && d.qtype !== 'video')}>
          <summary className="cursor-pointer select-none font-semibold">⚙️ {t('advanced')}</summary>
          <div className="mt-4 space-y-5">
            {!noAnswer && d.qtype !== 'video' && (
              <Bilingual
                label={t('qDescription')}
                multiline
                uz={d.description_uz}
                ru={d.description_ru}
                onUz={(v) => set('description_uz', v)}
                onRu={(v) => set('description_ru', v)}
              />
            )}
            {(canMedia || d.image_url) && (
              <div>
                <Label>{t('image')}</Label>
                {d.image_url ? (
                  <div className="space-y-2">
                    <img src={d.image_url} alt="" className="max-h-56 w-full rounded-2xl border border-line object-contain" />
                    {canMedia && (
                      <Button variant="outline" size="md" block onClick={() => set('image_url', '')}>
                        {t('removeImage')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" block loading={uploading === 'question'} onClick={() => pickImage('question')}>
                    {t('uploadImage')}
                  </Button>
                )}
              </div>
            )}
            {d.qtype !== 'video' && (canMedia || d.video_url) && <VideoField value={d.video_url} disabled={!canMedia} onChange={(v) => set('video_url', v)} />}
            {!noAnswer && (canTimer || d.time_limit) && (
              <div>
                <Label>⏱ {t('questionTimeLimit')}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={3600}
                  disabled={!canTimer}
                  placeholder={t('questionTimeLimitNone')}
                  value={d.time_limit}
                  onChange={(e) => set('time_limit', e.target.value)}
                />
                <p className="mt-1 text-sm text-muted">{t('questionTimeLimitHint')}</p>
              </div>
            )}
            <Toggle checked={d.hidden} onChange={(v) => set('hidden', v)} label={t('hideQuestion')} />
            {d.hidden && <p className="-mt-3 text-sm text-muted">{t('hideQuestionHint')}</p>}
          </div>
        </details>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''
          }}
        />
      </div>
      <ConfirmDialog
        open={!!removeKey}
        danger
        text={t('confirmDeleteOption')}
        onCancel={() => setRemoveKey(null)}
        onConfirm={() => {
          setD((x) => ({ ...x, options: x.options.filter((o) => o.key !== removeKey) }))
          setRemoveKey(null)
        }}
      />
    </Modal>
  )
}

function LangPair({
  uz,
  ru,
  onUz,
  onRu,
  inputRef,
}: {
  uz: string
  ru: string
  onUz: (v: string) => void
  onRu: (v: string) => void
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs font-bold text-muted">UZ</span>
        <Input ref={inputRef} value={uz} onChange={(e) => onUz(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs font-bold text-muted">RU</span>
        <Input value={ru} onChange={(e) => onRu(e.target.value)} />
      </div>
    </div>
  )
}

function VideoField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const { t } = useApp()
  return (
    <div>
      <Label required={false}>{t('videoUrl')}</Label>
      <Input type="url" inputMode="url" placeholder="https://youtu.be/…" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <p className="mt-1.5 text-sm text-muted">{t('videoUrlHint')}</p>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
}: {
  label: string
  value: number | null | undefined
  onChange: (v: number | null) => void
  min?: number
  max?: number
  placeholder?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(num(e.target.value))}
      />
    </div>
  )
}

function TypeSettings({ qtype, s, setS, surveyType }: { qtype: QType; s: QSettings; setS: (p: Partial<QSettings>) => void; surveyType: SurveyType }) {
  const { t } = useApp()
  const box = (children: React.ReactNode) => (
    <div className="space-y-4 rounded-2xl bg-navy-50 p-3.5 dark:bg-white/5">
      <div className="text-sm font-bold uppercase tracking-wide text-muted">{t('typeSettings')}</div>
      {children}
    </div>
  )
  const labels = (
    <>
      <Bilingual
        label={t('labelMin')}
        uz={s.label_min_uz ?? ''}
        ru={s.label_min_ru ?? ''}
        onUz={(v) => setS({ label_min_uz: v })}
        onRu={(v) => setS({ label_min_ru: v })}
      />
      <Bilingual
        label={t('labelMax')}
        uz={s.label_max_uz ?? ''}
        ru={s.label_max_ru ?? ''}
        onUz={(v) => setS({ label_max_uz: v })}
        onRu={(v) => setS({ label_max_ru: v })}
      />
    </>
  )
  switch (qtype) {
    case 'short_text':
    case 'text':
    case 'video':
      return box(
        <>
          {qtype === 'short_text' && (
            <div>
              <Label>{t('textFormat')}</Label>
              <Select value={s.format ?? 'any'} onChange={(e) => setS({ format: e.target.value as QSettings['format'] })}>
                {(['any', 'email', 'phone', 'digits', 'letters', 'url'] as const).map((f) => (
                  <option key={f} value={f}>
                    {t(`fmt_${f}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <NumField label={t('minLen')} value={s.min_len} min={0} onChange={(v) => setS({ min_len: v })} />
            <NumField label={t('maxLen')} value={s.max_len} min={1} max={qtype === 'short_text' ? 500 : 5000} onChange={(v) => setS({ max_len: v })} />
          </div>
        </>,
      )
    case 'scale': {
      const presets: [number, number, number][] = [
        [1, 5, 1],
        [1, 10, 1],
        [0, 10, 1],
        [0, 100, 1],
      ]
      return box(
        <>
          <div>
            <Label>{t('scaleRange')}</Label>
            <div className="grid grid-cols-4 gap-2">
              {presets.map(([a, b, st]) => {
                const on = s.min === a && s.max === b
                return (
                  <button
                    key={`${a}-${b}`}
                    type="button"
                    onClick={() => setS({ min: a, max: b, step: st })}
                    className={`min-h-[44px] rounded-xl border-2 text-sm font-bold ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-card'}`}
                  >
                    {a}–{b}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t('from')}</Label>
              <Select value={s.min ?? 1} onChange={(e) => setS({ min: Number(e.target.value) })}>
                <option value={0}>0</option>
                <option value={1}>1</option>
              </Select>
            </div>
            <NumField label={t('to')} value={s.max} min={2} max={100} onChange={(v) => setS({ max: v ?? 5 })} />
            <NumField label={t('step')} value={s.step} min={1} max={50} onChange={(v) => setS({ step: v ?? 1 })} />
          </div>
          {labels}
        </>,
      )
    }
    case 'stars':
      return box(
        <div>
          <Label>{t('starsCount')}</Label>
          <div className="flex flex-wrap gap-2">
            {[3, 4, 5, 6, 7, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setS({ count: n })}
                className={`min-h-[44px] min-w-[52px] rounded-xl border-2 font-bold ${(s.count ?? 5) === n ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-card'}`}
              >
                {n} ★
              </button>
            ))}
          </div>
        </div>,
      )
    case 'nps':
      return box(
        <>
          <p className="text-sm text-muted">{t('npsHelp')}</p>
          {labels}
        </>,
      )
    case 'yes_no':
      return box(<Toggle checked={!!s.unsure} onChange={(v) => setS({ unsure: v })} label={t('allowUnsure')} />)
    case 'date':
      return box(
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('minDate')}</Label>
              <Input type="date" value={s.min_date ?? ''} onChange={(e) => setS({ min_date: e.target.value || null })} />
            </div>
            <div>
              <Label>{t('maxDate')}</Label>
              <Input type="date" value={s.max_date ?? ''} onChange={(e) => setS({ max_date: e.target.value || null })} />
            </div>
          </div>
          <Toggle checked={!!s.no_past} onChange={(v) => setS({ no_past: v, no_future: v ? false : s.no_future })} label={t('noPast')} />
          <Toggle checked={!!s.no_future} onChange={(v) => setS({ no_future: v, no_past: v ? false : s.no_past })} label={t('noFuture')} />
        </>,
      )
    case 'time':
      return box(
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('minTime')}</Label>
            <Input type="time" value={s.min_time ?? ''} onChange={(e) => setS({ min_time: e.target.value.slice(0, 5) || null })} />
          </div>
          <div>
            <Label>{t('maxTime')}</Label>
            <Input type="time" value={s.max_time ?? ''} onChange={(e) => setS({ max_time: e.target.value.slice(0, 5) || null })} />
          </div>
        </div>,
      )
    case 'number':
      return box(
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumField label={t('minValue')} value={s.min} onChange={(v) => setS({ min: v })} />
            <NumField label={t('maxValue')} value={s.max} onChange={(v) => setS({ max: v })} />
          </div>
          <Toggle checked={!!s.integer} onChange={(v) => setS({ integer: v })} label={t('integerOnly')} />
          <Bilingual
            label={t('unit')}
            uz={s.unit_uz ?? ''}
            ru={s.unit_ru ?? ''}
            onUz={(v) => setS({ unit_uz: v })}
            onRu={(v) => setS({ unit_ru: v })}
            placeholderUz="kg, yil…"
            placeholderRu="кг, лет…"
          />
        </>,
      )
    case 'image_choice':
      return box(<Toggle checked={!!s.multiple} onChange={(v) => setS({ multiple: v })} label={t('allowSeveral')} />)
    case 'points':
      return box(<NumField label={t('pointsTotal')} value={s.total} min={1} max={10000} onChange={(v) => setS({ total: v ?? 100 })} />)
    case 'file': {
      const formats = s.formats ?? []
      return box(
        <>
          <div>
            <Label>{t('fileFormats')}</Label>
            <div className="flex flex-wrap gap-2">
              {FILE_FORMATS.map((f) => {
                const on = formats.includes(f)
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setS({ formats: on ? formats.filter((x) => x !== f) : [...formats, f] })}
                    className={`min-h-[40px] rounded-xl border-2 px-3 text-sm font-bold uppercase ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-card'}`}
                  >
                    {f}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label={t('fileMaxMb')} value={s.max_mb} min={1} max={20} onChange={(v) => setS({ max_mb: v ?? 10 })} />
            <NumField label={t('fileMaxCount')} value={s.max_files} min={1} max={5} onChange={(v) => setS({ max_files: v ?? 1 })} />
          </div>
          <p className="text-sm text-muted">{t('fileSecurity')}</p>
        </>,
      )
    }
    case 'contact':
      return box(
        <>
          {surveyType === 'anonymous' && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              ⚠️ {t('contactAnonymousWarn')}
            </div>
          )}
          <div className="space-y-2">
            {CONTACT_FIELDS.map((f) => (
              <Toggle key={f} checked={!!s.fields?.[f]} onChange={(v) => setS({ fields: { ...s.fields, [f]: v } })} label={t(`cf_${f}`)} />
            ))}
          </div>
          <Bilingual
            label={t('contactPurposeLabel')}
            required
            multiline
            uz={s.purpose_uz ?? ''}
            ru={s.purpose_ru ?? ''}
            onUz={(v) => setS({ purpose_uz: v })}
            onRu={(v) => setS({ purpose_ru: v })}
            placeholderUz="Natijalar haqida xabar berish uchun"
            placeholderRu="Чтобы сообщить вам о результатах"
          />
          <p className="text-sm text-muted">{t('contactMinimal')}</p>
        </>,
      )
    case 'region':
      return box(
        <>
          <Toggle checked={s.district !== false} onChange={(v) => setS({ district: v })} label={t('askDistrict')} />
          <p className="text-sm text-muted">{t('regionsEditHint')}</p>
        </>,
      )
    default:
      return null
  }
}

export function IconBtn({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-lg transition active:scale-95 disabled:opacity-30 dark:bg-white/10"
    >
      {label}
    </button>
  )
}
