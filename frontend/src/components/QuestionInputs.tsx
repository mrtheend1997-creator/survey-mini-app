import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../app-context'
import { pick, type Lang } from '../i18n'
import { CONTACT_FIELDS, isMulti, pairKeys, ratingValues, videoEmbed } from '../qtypes'
import type { AnswerValue, ContactField, QuestionT, RegionT, UploadedFile } from '../types'
import { SortableList } from './Sortable'
import { Button, Input, TextArea } from './ui'

type OnChange = (v: AnswerValue | null, advance?: boolean) => void

let regionsCache: Promise<RegionT[]> | null = null
export function loadRegions(): Promise<RegionT[]> {
  if (!regionsCache) {
    regionsCache = api.get<RegionT[]>('/api/regions')
    regionsCache.catch(() => (regionsCache = null))
  }
  return regionsCache
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const selectCls = 'min-h-[56px] w-full rounded-2xl border-2 border-line bg-card px-4 text-base text-ink outline-none focus:border-navy-500'

export function OptionButton({ selected, multi, children, onClick }: { selected: boolean; multi?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-base transition active:scale-[0.99] ${
        selected ? 'animate-pop border-brand-500 bg-brand-50 font-semibold dark:bg-brand-700/20' : 'border-line bg-card'
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 text-sm text-white transition ${multi ? 'rounded-md' : 'rounded-full'} ${
          selected ? 'border-brand-500 bg-brand-500' : 'border-gray-300 dark:border-gray-500'
        }`}
      >
        {selected && '✓'}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  )
}

function Chip({ selected, onClick, children, className = '' }: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-[48px] rounded-xl border-2 px-3 py-2 text-[15px] font-semibold transition active:scale-95 ${
        selected ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-card'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/** Picture and/or video shown above any question's answer field. */
export function QuestionMedia({ q }: { q: QuestionT }) {
  const video = q.video_url ? videoEmbed(q.video_url) : null
  return (
    <>
      {q.image_url && <img src={q.image_url} alt="" className="mt-4 max-h-72 w-full rounded-2xl object-contain" />}
      {video && (
        <div className="mt-4 overflow-hidden rounded-2xl bg-black">
          {video.kind === 'iframe' && (
            <iframe
              src={video.src}
              className="aspect-video w-full"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              title="video"
            />
          )}
          {video.kind === 'video' && <video src={video.src} controls playsInline className="aspect-video w-full" />}
          {video.kind === 'link' && (
            <a href={video.src} target="_blank" rel="noreferrer" className="block p-4 text-center font-semibold text-white underline">
              ▶ {video.src}
            </a>
          )}
        </div>
      )}
    </>
  )
}

export default function QuestionInput({
  q,
  value,
  lang,
  onChange,
  token,
  preview,
}: {
  q: QuestionT
  value: AnswerValue | undefined
  lang: Lang
  onChange: OnChange
  token: string | null
  preview: boolean
}) {
  const { t, toast } = useApp()
  const s = q.settings ?? {}
  // a choice over the limit is refused with a visible warning
  const tooMany = (max: number) => {
    toast(t('maxChoicesError', { n: max }), 'error')
  }
  const [numText, setNumText] = useState(value?.number != null ? String(value.number) : '')
  useEffect(() => setNumText(value?.number != null ? String(value.number) : ''), [q.id]) // eslint-disable-line react-hooks/exhaustive-deps

  switch (q.qtype) {
    case 'single': {
      const otherOn = value?.other != null
      return (
        <div className="space-y-2.5">
          {q.options.map((o) => (
            <OptionButton key={o.id} selected={value?.option_id === o.id} onClick={() => onChange({ option_id: o.id }, true)}>
              {pick(o, 'text', lang)}
            </OptionButton>
          ))}
          {q.allow_other && (
            <>
              <OptionButton selected={otherOn} onClick={() => onChange({ other: value?.other ?? '' })}>
                {t('other')}
              </OptionButton>
              {otherOn && (
                <Input autoFocus value={value?.other ?? ''} placeholder={t('otherPlaceholder')} onChange={(e) => onChange({ other: e.target.value })} />
              )}
            </>
          )}
        </div>
      )
    }
    case 'multiple': {
      const ids = value?.option_ids ?? []
      const otherOn = value?.other != null
      const max = q.max_choices ?? Infinity
      const count = ids.length + (otherOn ? 1 : 0)
      const toggle = (id: number) => {
        if (!ids.includes(id) && count >= max) return tooMany(max)
        const nextIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
        if (!nextIds.length && !otherOn) onChange(null)
        else onChange({ option_ids: nextIds, other: value?.other ?? null })
      }
      return (
        <div className="space-y-2.5">
          <ChoiceHint q={q} />
          {q.options.map((o) => (
            <OptionButton key={o.id} multi selected={ids.includes(o.id)} onClick={() => toggle(o.id)}>
              {pick(o, 'text', lang)}
            </OptionButton>
          ))}
          {q.allow_other && (
            <>
              <OptionButton
                multi
                selected={otherOn}
                onClick={() => {
                  if (otherOn) onChange(ids.length ? { option_ids: ids, other: null } : null)
                  else if (count < max) onChange({ option_ids: ids, other: '' })
                  else tooMany(max)
                }}
              >
                {t('other')}
              </OptionButton>
              {otherOn && (
                <Input
                  autoFocus
                  value={value?.other ?? ''}
                  placeholder={t('otherPlaceholder')}
                  onChange={(e) => onChange({ option_ids: ids, other: e.target.value })}
                />
              )}
            </>
          )}
        </div>
      )
    }
    case 'dropdown': {
      const otherOn = value?.other != null
      const current = otherOn ? 'other' : value?.option_id != null ? String(value.option_id) : ''
      return (
        <div className="space-y-2.5">
          <select
            value={current}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') onChange(null)
              else if (v === 'other') onChange({ other: '' })
              else onChange({ option_id: Number(v) }, true)
            }}
            className={selectCls}
          >
            <option value="">{t('selectPlaceholder')}</option>
            {q.options.map((o) => (
              <option key={o.id} value={o.id}>
                {pick(o, 'text', lang)}
              </option>
            ))}
            {q.allow_other && <option value="other">{t('other')}</option>}
          </select>
          {otherOn && <Input autoFocus value={value?.other ?? ''} placeholder={t('otherPlaceholder')} onChange={(e) => onChange({ other: e.target.value })} />}
        </div>
      )
    }
    case 'image_choice': {
      const multi = isMulti(q)
      const ids = multi ? (value?.option_ids ?? []) : value?.option_id != null ? [value.option_id] : []
      const max = q.max_choices ?? Infinity
      const toggle = (id: number) => {
        if (!multi) return onChange({ option_id: id }, true)
        if (!ids.includes(id) && ids.length >= max) return tooMany(max)
        const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
        onChange(next.length ? { option_ids: next } : null)
      }
      return (
        <div>
          {multi && <ChoiceHint q={q} />}
          <div className="mt-2 grid grid-cols-2 gap-3">
            {q.options.map((o) => {
              const on = ids.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.id)}
                  className={`overflow-hidden rounded-2xl border-2 bg-card text-left transition active:scale-[0.98] ${on ? 'animate-pop border-brand-500 ring-2 ring-brand-500/30' : 'border-line'}`}
                >
                  {o.image_url ? (
                    <img src={o.image_url} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-navy-50 text-4xl dark:bg-white/5">🖼️</div>
                  )}
                  <div className={`flex items-center gap-2 p-2.5 text-[15px] ${on ? 'font-semibold' : ''}`}>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 text-xs text-white ${multi ? 'rounded-md' : 'rounded-full'} ${on ? 'border-brand-500 bg-brand-500' : 'border-gray-300 dark:border-gray-500'}`}
                    >
                      {on && '✓'}
                    </span>
                    {pick(o, 'text', lang)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )
    }
    case 'short_text': {
      const type = s.format === 'email' ? 'email' : s.format === 'phone' ? 'tel' : s.format === 'url' ? 'url' : 'text'
      const mode = s.format === 'digits' ? 'numeric' : s.format === 'phone' ? 'tel' : s.format === 'email' ? 'email' : undefined
      return (
        <div>
          <Input
            type={type}
            inputMode={mode}
            value={value?.text ?? ''}
            maxLength={s.max_len ?? 500}
            placeholder={s.format && s.format !== 'any' ? t(`fmtPh_${s.format}`) : t('yourAnswer')}
            onChange={(e) => onChange(e.target.value ? { text: e.target.value } : null)}
          />
          <LengthHint min={s.min_len} max={s.max_len} n={value?.text?.length ?? 0} />
        </div>
      )
    }
    case 'text':
    case 'video':
      return (
        <div>
          <TextArea
            rows={5}
            value={value?.text ?? ''}
            placeholder={t('yourAnswer')}
            maxLength={s.max_len ?? 5000}
            onChange={(e) => onChange(e.target.value ? { text: e.target.value } : null)}
          />
          <LengthHint min={s.min_len} max={s.max_len} n={value?.text?.length ?? 0} />
        </div>
      )
    case 'number': {
      const unit = pick(s, 'unit', lang)
      return (
        <div>
          <div className="flex items-center gap-3">
            <Input
              type="text"
              inputMode={s.integer ? 'numeric' : 'decimal'}
              value={numText}
              placeholder={t('numberPlaceholder')}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.')
                if (!(s.integer ? /^-?\d*$/ : /^-?\d*\.?\d*$/).test(raw)) return
                setNumText(raw)
                const n = parseFloat(raw)
                onChange(raw === '' || isNaN(n) ? null : { number: n })
              }}
            />
            {unit && <span className="shrink-0 text-lg font-semibold text-muted">{unit}</span>}
          </div>
          {(s.min != null || s.max != null) && (
            <p className="mt-2 text-sm text-muted">
              {s.min != null && s.max != null
                ? t('rangeHint', { a: s.min, b: s.max })
                : s.min != null
                  ? t('minHint', { n: s.min })
                  : t('maxHint', { n: s.max! })}
            </p>
          )}
        </div>
      )
    }
    case 'yes_no':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[true, false].map((b) => (
              <button
                key={String(b)}
                type="button"
                onClick={() => onChange({ bool: b }, true)}
                aria-pressed={value?.bool === b}
                className={`flex min-h-[72px] flex-col items-center justify-center rounded-2xl border-2 text-lg font-semibold transition active:scale-[0.98] ${
                  value?.bool === b ? 'animate-pop border-brand-500 bg-brand-50 dark:bg-brand-700/20' : 'border-line bg-card'
                }`}
              >
                <span className="text-2xl">{b ? '👍' : '👎'}</span>
                {b ? t('yes') : t('no')}
              </button>
            ))}
          </div>
          {s.unsure && (
            <OptionButton selected={!!value?.unsure} onClick={() => onChange({ unsure: true }, true)}>
              🤔 {t('unsure')}
            </OptionButton>
          )}
        </div>
      )
    case 'rating5':
    case 'rating10':
    case 'scale':
    case 'stars':
    case 'nps':
      return <RatingInput q={q} value={value} lang={lang} onChange={onChange} />
    case 'date': {
      const min = [s.min_date, s.no_past ? todayIso() : null].filter(Boolean).sort().pop() ?? undefined
      const max = [s.max_date, s.no_future ? todayIso() : null].filter(Boolean).sort()[0] ?? undefined
      return <Input type="date" min={min} max={max} value={value?.date ?? ''} onChange={(e) => onChange(e.target.value ? { date: e.target.value } : null)} />
    }
    case 'time':
      return (
        <div>
          <Input
            type="time"
            min={s.min_time ?? undefined}
            max={s.max_time ?? undefined}
            value={value?.time ?? ''}
            onChange={(e) => onChange(e.target.value ? { time: e.target.value.slice(0, 5) } : null)}
          />
          {(s.min_time || s.max_time) && <p className="mt-2 text-sm text-muted">{t('rangeHint', { a: s.min_time ?? '00:00', b: s.max_time ?? '23:59' })}</p>}
        </div>
      )
    case 'matrix':
    case 'matrix_multi': {
      const m = value?.matrix ?? {}
      const multi = q.qtype === 'matrix_multi'
      const set = (rowId: string, optId: number) => {
        const next = { ...m }
        if (multi) {
          const cur = (next[rowId] as number[] | undefined) ?? []
          const v = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId]
          if (v.length) next[rowId] = v
          else delete next[rowId]
        } else next[rowId] = optId
        onChange(Object.keys(next).length ? { matrix: next } : null)
      }
      return (
        <div className="space-y-3">
          {multi && <p className="text-sm text-muted">{t('chooseMany')}</p>}
          {(s.rows ?? []).map((row) => {
            const cur = m[row.id!]
            return (
              <div key={row.id} className="rounded-2xl border border-line bg-card p-3">
                <div className="mb-2 font-semibold">
                  {pick(row, 'text', lang)}
                  {cur != null && <span className="ml-1 text-brand-600">✓</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <Chip key={o.id} selected={Array.isArray(cur) ? cur.includes(o.id) : cur === o.id} onClick={() => set(row.id!, o.id)}>
                      {pick(o, 'text', lang)}
                    </Chip>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )
    }
    case 'ranking':
      return <RankingInput q={q} value={value} lang={lang} onChange={onChange} />
    case 'points':
      return <PointsInput q={q} value={value} lang={lang} onChange={onChange} />
    case 'pairwise': {
      const pairs = value?.pairs ?? {}
      const label = (id: number) =>
        pick(
          q.options.find((o) => o.id === id),
          'text',
          lang,
        )
      const keys = pairKeys(q)
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {t('pairwiseHint')} · {Object.keys(pairs).length}/{keys.length}
          </p>
          {keys.map(([a, b]) => {
            const k = `${a}-${b}`
            return (
              <div key={k} className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                {[a, b].map((id, i) => (
                  <Chip key={id} selected={pairs[k] === id} onClick={() => onChange({ pairs: { ...pairs, [k]: id } })} className={i === 1 ? 'col-start-3' : ''}>
                    {label(id)}
                  </Chip>
                ))}
                <span className="col-start-2 row-start-1 self-center text-sm font-bold text-muted">vs</span>
              </div>
            )
          })}
        </div>
      )
    }
    case 'file':
      return <FileInput q={q} value={value} onChange={onChange} token={token} preview={preview} />
    case 'contact': {
      const c = value?.contact ?? {}
      const fields = CONTACT_FIELDS.filter((f) => s.fields?.[f])
      const set = (f: ContactField, v: string) => {
        const next = { ...c, [f]: v }
        if (!v) delete next[f]
        onChange(Object.keys(next).length ? { contact: next } : null)
      }
      const types: Record<ContactField, string> = { full_name: 'text', phone: 'tel', email: 'email', organization: 'text', position: 'text' }
      const auto: Record<ContactField, string> = {
        full_name: 'name',
        phone: 'tel',
        email: 'email',
        organization: 'organization',
        position: 'organization-title',
      }
      return (
        <div className="space-y-3">
          <div className="rounded-xl bg-navy-50 p-3 text-[15px] dark:bg-white/5">
            🔒 <b>{t('contactPurpose')}:</b> {pick(s, 'purpose', lang)}
          </div>
          {fields.map((f) => (
            <div key={f}>
              <div className="mb-1 text-sm font-semibold">{t(`cf_${f}`)}</div>
              <Input type={types[f]} autoComplete={auto[f]} value={c[f] ?? ''} maxLength={255} onChange={(e) => set(f, e.target.value)} />
            </div>
          ))}
        </div>
      )
    }
    case 'region':
      return <RegionInput q={q} value={value} lang={lang} onChange={onChange} />
    case 'info':
    case 'section':
      return null
  }
}

function ChoiceHint({ q }: { q: QuestionT }) {
  const { t } = useApp()
  return (
    <p className="text-sm text-muted">
      {t('chooseMany')}
      {q.min_choices ? ` · ${t('minChoicesHint', { n: q.min_choices })}` : ''}
      {q.max_choices ? ` · ${t('maxChoicesHint', { n: q.max_choices })}` : ''}
    </p>
  )
}

function LengthHint({ min, max, n }: { min?: number | null; max?: number | null; n: number }) {
  const { t } = useApp()
  if (!min && !max) return null
  return (
    <div className="mt-1.5 flex justify-between text-xs text-muted">
      <span>{min ? t('minLenHint', { n: min }) : ''}</span>
      {max ? (
        <span className={n > max * 0.9 ? 'font-semibold text-amber-600' : ''}>
          {n}/{max}
        </span>
      ) : null}
    </div>
  )
}

function RatingInput({ q, value, lang, onChange }: { q: QuestionT; value: AnswerValue | undefined; lang: Lang; onChange: OnChange }) {
  const { t } = useApp()
  const s = q.settings ?? {}
  const values = ratingValues(q)
  const current = value?.rating
  const labels = (
    <div className="mt-2 flex justify-between gap-4 text-xs text-muted">
      <span>{pick(s, 'label_min', lang) || (q.qtype === 'nps' ? t('npsLow') : values[0])}</span>
      <span className="text-right">{pick(s, 'label_max', lang) || (q.qtype === 'nps' ? t('npsHigh') : values[values.length - 1])}</span>
    </div>
  )

  if (values.length > 11) {
    return (
      <div>
        <div className="mb-3 text-center text-4xl font-bold text-brand-600">{current ?? '—'}</div>
        <input
          type="range"
          min={values[0]}
          max={values[values.length - 1]}
          step={s.step || 1}
          value={current ?? Math.round((values[0] + values[values.length - 1]) / 2)}
          onChange={(e) => onChange({ rating: Number(e.target.value) })}
          className="h-10 w-full accent-brand-600"
        />
        {labels}
      </div>
    )
  }

  if (q.qtype === 'stars' || q.qtype === 'rating5') {
    return (
      <div>
        <div className="flex justify-center gap-1.5" role="radiogroup">
          {values.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={String(n)}
              onClick={() => onChange({ rating: n }, true)}
              className={`text-[40px] leading-none transition active:scale-90 ${(current ?? 0) >= n ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} ${values.length > 7 ? 'text-[30px]' : ''}`}
            >
              ★
            </button>
          ))}
        </div>
        <div className="mt-2 text-center text-sm font-semibold text-muted">{current ? `${current} / ${values.length}` : ''}</div>
        {(s.label_min_uz || s.label_min_ru || s.label_max_uz || s.label_max_ru) && labels}
      </div>
    )
  }

  const color = (n: number) => {
    if (q.qtype !== 'nps') return ''
    return n <= 6 ? 'border-red-300 dark:border-red-800' : n <= 8 ? 'border-amber-300 dark:border-amber-700' : 'border-brand-500/50'
  }
  return (
    <div>
      <div
        className={`grid gap-2 ${values.length <= 5 ? 'grid-cols-5' : values.length === 11 ? 'grid-cols-6 sm:grid-cols-11' : 'grid-cols-5 sm:grid-cols-10'}`}
      >
        {values.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ rating: n }, true)}
            aria-pressed={current === n}
            className={`flex aspect-square items-center justify-center rounded-2xl border-2 text-lg font-bold transition active:scale-95 ${
              current === n ? 'animate-pop border-brand-500 bg-brand-500 text-white' : `bg-card ${color(n) || 'border-line'}`
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {labels}
    </div>
  )
}

function RankingInput({ q, value, lang, onChange }: { q: QuestionT; value: AnswerValue | undefined; lang: Lang; onChange: OnChange }) {
  const { t } = useApp()
  const order = value?.order?.length === q.options.length ? value.order : q.options.map((o) => o.id)
  const byId = Object.fromEntries(q.options.map((o) => [o.id, o]))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange({ order: next })
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted">{t('rankingHint')}</p>
      <SortableList
        items={order}
        getKey={(id) => id}
        handleLabel={t('dragToMove')}
        onChange={(next) => onChange({ order: next })}
        render={(id, i, handle) => (
          <div className={`flex items-center gap-2 rounded-2xl border-2 bg-card py-1.5 pl-1 pr-2 ${value?.order ? 'border-brand-500/60' : 'border-line'}`}>
            {handle}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-800 text-sm font-bold text-white dark:bg-navy-500">
              {i + 1}
            </span>
            <span className="flex-1 text-base">{pick(byId[id], 'text', lang)}</span>
            <button
              type="button"
              aria-label={t('moveUp')}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="h-10 w-9 rounded-lg text-lg disabled:opacity-25"
            >
              ⬆️
            </button>
            <button
              type="button"
              aria-label={t('moveDown')}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
              className="h-10 w-9 rounded-lg text-lg disabled:opacity-25"
            >
              ⬇️
            </button>
          </div>
        )}
      />
      {!value?.order && (
        <Button variant="soft" size="md" block className="mt-3" onClick={() => onChange({ order })}>
          {t('rankingKeep')}
        </Button>
      )}
    </div>
  )
}

function PointsInput({ q, value, lang, onChange }: { q: QuestionT; value: AnswerValue | undefined; lang: Lang; onChange: OnChange }) {
  const { t } = useApp()
  const total = q.settings?.total ?? 100
  const pts: Record<string, number> = value?.points ?? {}
  const used = Object.values(pts).reduce((a, b) => a + b, 0)
  const left = total - used
  const step = total >= 100 ? 5 : 1
  const set = (id: number, n: number) => {
    const others = used - (pts[id] ?? 0)
    const v = Math.max(0, Math.min(Math.round(n) || 0, total - others))
    const next: Record<string, number> = { ...pts, [id]: v }
    if (!v) delete next[id]
    onChange(Object.keys(next).length ? { points: next } : null)
  }
  return (
    <div className="space-y-2.5">
      <div
        className={`sticky top-[72px] z-10 rounded-xl p-3 text-center font-bold ${
          left === 0
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100'
            : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100'
        }`}
      >
        {left === 0 ? `✓ ${t('pointsDone', { n: total })}` : t('pointsLeft', { n: left, total })}
      </div>
      {q.options.map((o) => (
        <div key={o.id} className="flex items-center gap-2 rounded-2xl border border-line bg-card p-2.5">
          <span className="flex-1 text-base">{pick(o, 'text', lang)}</span>
          <button
            type="button"
            aria-label="−"
            onClick={() => set(o.id, (pts[o.id] ?? 0) - step)}
            className="h-11 w-11 rounded-xl bg-navy-50 text-xl font-bold dark:bg-white/10"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            aria-label={pick(o, 'text', lang)}
            value={pts[o.id] ?? 0}
            onChange={(e) => set(o.id, Number(e.target.value.replace(/\D/g, '')))}
            className="h-11 w-16 rounded-xl border-2 border-line bg-card text-center text-lg font-bold outline-none focus:border-navy-500"
          />
          <button
            type="button"
            aria-label="+"
            onClick={() => set(o.id, (pts[o.id] ?? 0) + step)}
            className="h-11 w-11 rounded-xl bg-navy-50 text-xl font-bold dark:bg-white/10"
          >
            +
          </button>
        </div>
      ))}
    </div>
  )
}

function FileInput({
  q,
  value,
  onChange,
  token,
  preview,
}: {
  q: QuestionT
  value: AnswerValue | undefined
  onChange: OnChange
  token: string | null
  preview: boolean
}) {
  const { t, showError } = useApp()
  const s = q.settings ?? {}
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const files = value?.files ?? []
  const maxFiles = s.max_files ?? 1
  const formats = s.formats ?? []
  const accept = formats.map((f) => `.${f}`).join(',') + (formats.includes('jpg') ? ',.jpeg' : '')

  const upload = async (file: File) => {
    if (file.size > (s.max_mb ?? 10) * 1024 * 1024) {
      showError(new Error(t('fileTooBig', { n: s.max_mb ?? 10 })))
      return
    }
    setBusy(true)
    try {
      let res: UploadedFile
      if (preview || !token) res = { key: `preview/${Date.now()}`, name: file.name, size: file.size }
      else {
        const fd = new FormData()
        fd.append('file', file)
        res = await api.upload<UploadedFile>(`/api/responses/${token}/files/${q.id}`, fd)
      }
      onChange({ files: [...files, res].slice(-maxFiles) })
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5">
      {files.map((f) => (
        <div key={f.key} className="flex items-center gap-3 rounded-2xl border-2 border-brand-500/60 bg-card p-3">
          <span className="text-2xl">📄</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{f.name}</div>
            <div className="text-xs text-muted">{(f.size / 1024).toFixed(0)} KB</div>
          </div>
          <button
            type="button"
            aria-label={t('removeFile')}
            onClick={() => {
              const next = files.filter((x) => x.key !== f.key)
              onChange(next.length ? { files: next } : null)
            }}
            className="h-10 w-10 rounded-xl bg-navy-50 text-lg dark:bg-white/10"
          >
            🗑️
          </button>
        </div>
      ))}
      {files.length < maxFiles && (
        <Button variant="outline" block loading={busy} onClick={() => ref.current?.click()}>
          📎 {t('attachFile')}
        </Button>
      )}
      <p className="text-sm text-muted">{t('fileHint', { f: formats.map((f) => f.toUpperCase()).join(', '), n: s.max_mb ?? 10 })}</p>
      {preview && <p className="text-sm text-amber-700 dark:text-amber-300">{t('previewNoUpload')}</p>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function RegionInput({ q, value, lang, onChange }: { q: QuestionT; value: AnswerValue | undefined; lang: Lang; onChange: OnChange }) {
  const { t, errorText } = useApp()
  const [regions, setRegions] = useState<RegionT[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadRegions()
      .then(setRegions)
      .catch((e) => setError(errorText(e)))
  }, [errorText])
  const withDistrict = q.settings?.district !== false
  const region = regions?.find((r) => r.id === value?.region)
  if (error) return <div className="text-red-600">{error}</div>
  if (!regions) return <div className="text-muted">…</div>
  return (
    <div className="space-y-3">
      <select
        value={value?.region ?? ''}
        aria-label={t('region')}
        onChange={(e) => onChange(e.target.value ? { region: Number(e.target.value), district: null } : null)}
        className={selectCls}
      >
        <option value="">{t('regionPlaceholder')}</option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {pick(r, 'name', lang)}
          </option>
        ))}
      </select>
      {withDistrict && region && region.districts.length > 0 && (
        <select
          value={value?.district ?? ''}
          aria-label={t('district')}
          onChange={(e) => onChange({ region: region.id, district: e.target.value ? Number(e.target.value) : null }, !!e.target.value)}
          className={selectCls}
        >
          <option value="">{t('districtPlaceholder')}</option>
          {region.districts.map((d) => (
            <option key={d.id} value={d.id}>
              {pick(d, 'name', lang)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
