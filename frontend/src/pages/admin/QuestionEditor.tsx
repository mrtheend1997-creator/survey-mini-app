import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Bilingual, Button, ConfirmDialog, Input, Label, Modal, Select, Toggle } from '../../components/ui'
import type { QType, QuestionT } from '../../types'

export const QTYPES: QType[] = ['single', 'multiple', 'text', 'number', 'yes_no', 'rating5', 'rating10', 'dropdown', 'date']
const CHOICE: QType[] = ['single', 'multiple', 'dropdown']

interface OptionDraft {
  key: string
  id?: number
  text_uz: string
  text_ru: string
}

interface Draft {
  text_uz: string
  text_ru: string
  qtype: QType
  required: boolean
  hint_uz: string
  hint_ru: string
  image_url: string
  min_choices: string
  max_choices: string
  allow_other: boolean
  options: OptionDraft[]
}

let keySeq = 0
const newKey = () => `n${++keySeq}`
const blankOption = (): OptionDraft => ({ key: newKey(), text_uz: '', text_ru: '' })

function toDraft(q?: QuestionT | null): Draft {
  return {
    text_uz: q?.text_uz ?? '',
    text_ru: q?.text_ru ?? '',
    qtype: q?.qtype ?? 'single',
    required: q?.required ?? true,
    hint_uz: q?.hint_uz ?? '',
    hint_ru: q?.hint_ru ?? '',
    image_url: q?.image_url ?? '',
    min_choices: q?.min_choices ? String(q.min_choices) : '',
    max_choices: q?.max_choices ? String(q.max_choices) : '',
    allow_other: q?.allow_other ?? false,
    options: q?.options.length ? q.options.map((o) => ({ key: `o${o.id}`, id: o.id, text_uz: o.text_uz, text_ru: o.text_ru })) : [blankOption(), blankOption()],
  }
}

export default function QuestionEditor({
  open,
  surveyId,
  question,
  permissions,
  onClose,
  onSaved,
}: {
  open: boolean
  surveyId: number
  question: QuestionT | null
  permissions: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t, toast, showError } = useApp()
  const [d, setD] = useState<Draft>(toDraft(question))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removeKey, setRemoveKey] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (open) setD(toDraft(question))
  }, [open, question])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setOpt = (key: string, field: 'text_uz' | 'text_ru', v: string) =>
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

  const isChoice = CHOICE.includes(d.qtype)
  // a new question is built freely; changing an existing one needs the matching permission
  const canType = !question || permissions.includes('question_type')
  const canOptions = !question || permissions.includes('option_manage')
  const canMedia = permissions.includes('media_manage')

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.upload<{ url: string }>('/api/admin/uploads', fd)
      set('image_url', res.url)
    } catch (e) {
      showError(e)
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    const body = {
      text_uz: d.text_uz,
      text_ru: d.text_ru,
      qtype: d.qtype,
      required: d.required,
      hint_uz: d.hint_uz,
      hint_ru: d.hint_ru,
      image_url: d.image_url,
      min_choices: d.qtype === 'multiple' && d.min_choices ? Number(d.min_choices) : null,
      max_choices: d.qtype === 'multiple' && d.max_choices ? Number(d.max_choices) : null,
      allow_other: isChoice ? d.allow_other : false,
      options: isChoice ? d.options.map((o) => ({ id: o.id ?? null, text_uz: o.text_uz, text_ru: o.text_ru })) : [],
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
          <Label required>{t('questionUz')}</Label>
          <textarea
            rows={2}
            value={d.text_uz}
            onChange={(e) => set('text_uz', e.target.value)}
            className="w-full rounded-xl border-2 border-line bg-card px-3.5 py-3 text-base outline-none focus:border-navy-500"
          />
        </div>
        <div>
          <Label required>{t('questionRu')}</Label>
          <textarea
            rows={2}
            value={d.text_ru}
            onChange={(e) => set('text_ru', e.target.value)}
            className="w-full rounded-xl border-2 border-line bg-card px-3.5 py-3 text-base outline-none focus:border-navy-500"
          />
        </div>
        <div>
          <Label>{t('questionType')}</Label>
          <Select value={d.qtype} disabled={!canType} onChange={(e) => set('qtype', e.target.value as QType)}>
            {QTYPES.map((q, i) => (
              <option key={q} value={q}>
                {i + 1}. {t(`qt_${q}`)}
              </option>
            ))}
          </Select>
        </div>

        {isChoice && (
          <div>
            <Label required>{t('options')}</Label>
            <div className="space-y-3">
              {d.options.map((o, i) => (
                <div key={o.key} className="rounded-2xl border border-line bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-1">
                    <span className="font-semibold">{t('optionN', { n: i + 1 })}</span>
                    <div className="flex items-center gap-1">
                      <IconBtn label="✏️" title={t('edit')} onClick={() => optionRefs.current[o.key]?.focus()} />
                      <IconBtn label="⬆️" title={t('moveUp')} disabled={i === 0} onClick={() => moveOpt(i, -1)} />
                      <IconBtn label="⬇️" title={t('moveDown')} disabled={i === d.options.length - 1} onClick={() => moveOpt(i, 1)} />
                      {canOptions && <IconBtn label="🗑️" title={t('delete')} onClick={() => setRemoveKey(o.key)} />}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-xs font-bold text-muted">UZ</span>
                      <Input ref={(el) => (optionRefs.current[o.key] = el)} value={o.text_uz} onChange={(e) => setOpt(o.key, 'text_uz', e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-xs font-bold text-muted">RU</span>
                      <Input value={o.text_ru} onChange={(e) => setOpt(o.key, 'text_ru', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {canOptions && (
              <Button variant="soft" block className="mt-3" onClick={addOpt}>
                {t('addOption')}
              </Button>
            )}
          </div>
        )}

        <div className="space-y-3">
          <Toggle checked={d.required} onChange={(v) => set('required', v)} label={t('requiredQuestion')} />
          {isChoice && <Toggle checked={d.allow_other} onChange={(v) => set('allow_other', v)} label={t('allowOther')} />}
        </div>

        {d.qtype === 'multiple' && (
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

        <Bilingual label={t('hint')} multiline uz={d.hint_uz} ru={d.hint_ru} onUz={(v) => set('hint_uz', v)} onRu={(v) => set('hint_ru', v)} />

        {(canMedia || d.image_url) && (
          <div>
            <Label>{t('image')}</Label>
            {d.image_url && !canMedia ? (
              <img src={d.image_url} alt="" className="max-h-56 w-full rounded-2xl border border-line object-contain" />
            ) : d.image_url ? (
              <div className="space-y-2">
                <img src={d.image_url} alt="" className="max-h-56 w-full rounded-2xl border border-line object-contain" />
                <Button variant="outline" size="md" block onClick={() => set('image_url', '')}>
                  {t('removeImage')}
                </Button>
              </div>
            ) : (
              <Button variant="outline" block loading={uploading} onClick={() => fileRef.current?.click()}>
                {t('uploadImage')}
              </Button>
            )}
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
        )}
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
