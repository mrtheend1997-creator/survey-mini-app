// Moving a survey's Uzbek Latin texts to the new alphabet (Ö, Ğ, Ş, Ç).
// The server lists every change first; only the ticked ones are written, into the draft.
// Published versions and collected answers are never changed.
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Button, Modal, Spinner } from '../../components/ui'
import { LANG_CODE, LANGS, missingLangs, type Lang } from '../../i18n'
import type { QuestionT } from '../../types'

interface Change {
  key: string
  question_id: number | null
  old: string
  new: string
}

/** Languages in which a question (its text, options or table rows) still has no text. */
export function questionMissing(q: QuestionT): Lang[] {
  const missing = new Set<Lang>(missingLangs(q, 'text'))
  for (const o of q.options) missingLangs(o, 'text').forEach((l) => missing.add(l))
  for (const r of q.settings?.rows ?? []) missingLangs(r, 'text').forEach((l) => missing.add(l))
  return LANGS.filter((l) => missing.has(l))
}

export function MissingBadge({ q }: { q: QuestionT }) {
  const { t } = useApp()
  const missing = questionMissing(q)
  if (!missing.length) return null
  return <span className="ml-2 text-amber-600">🌐 {t('trMissingBadge', { langs: missing.map((l) => LANG_CODE[l]).join(', ') })}</span>
}

export default function NewLatinDialog({
  open,
  surveyId,
  labelOf,
  onClose,
  onDone,
}: {
  open: boolean
  surveyId: number
  /** "3-savol" or the section name, as in the builder */
  labelOf: (questionId: number) => string
  onClose: () => void
  onDone: () => void
}) {
  const { t, toast, showError } = useApp()
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setChanges(null)
    api
      .get<{ changes: Change[] }>(`/api/admin/surveys/${surveyId}/new-latin`)
      .then((r) => {
        setChanges(r.changes)
        setPicked(new Set(r.changes.map((c) => c.key)))
      })
      .catch((e) => {
        showError(e)
        onClose()
      })
  }, [open, surveyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const apply = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ changed: number }>(`/api/admin/surveys/${surveyId}/new-latin`, { keys: [...picked] })
      toast(t('newLatinDone', { n: r.changed }))
      onDone()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      full
      onClose={onClose}
      title={`Ö ${t('newLatinTitle')}`}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" block onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="success" block loading={busy} disabled={!picked.size} onClick={apply}>
            {t('newLatinApply', { n: picked.size })}
          </Button>
        </div>
      }
    >
      <p className="text-[15px] text-muted">{t('newLatinHint')}</p>
      <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">⚠️ {t('newLatinCheck')}</p>
      {!changes ? (
        <Spinner />
      ) : changes.length === 0 ? (
        <p className="mt-4 rounded-xl bg-brand-50 p-3 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">✅ {t('newLatinNone')}</p>
      ) : (
        <div className="mt-4 space-y-2 pb-4">
          <Button size="sm" variant="soft" onClick={() => setPicked(new Set(changes.map((c) => c.key)))}>
            ☑️ {t('selectAll')}
          </Button>
          {changes.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-card p-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand-600" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  {c.question_id ? labelOf(c.question_id) : t('surveyTexts')}
                </span>
                <span className="block whitespace-pre-line text-[15px] text-muted line-through decoration-1">{c.old}</span>
                <span lang="uz-Latn" className="block whitespace-pre-line text-[15px] font-semibold">
                  {c.new}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
