import type { AnswerValue, QSettings, QType, QuestionT } from './types'

/** Types offered when building a question, grouped for the type picker. Legacy rating5/rating10 are kept only for old questions. */
export const QTYPE_GROUPS: { key: string; types: QType[] }[] = [
  { key: 'grpChoice', types: ['single', 'multiple', 'dropdown', 'image_choice', 'yes_no'] },
  { key: 'grpText', types: ['short_text', 'text', 'number', 'date', 'time'] },
  { key: 'grpRating', types: ['scale', 'stars', 'nps'] },
  { key: 'grpTable', types: ['matrix', 'matrix_multi', 'ranking', 'points', 'pairwise'] },
  { key: 'grpOther', types: ['file', 'video', 'contact', 'region', 'info', 'section'] },
]
export const LEGACY_TYPES: QType[] = ['rating5', 'rating10']

export const QTYPE_ICON: Record<QType, string> = {
  single: '🔘',
  multiple: '☑️',
  dropdown: '🔽',
  image_choice: '🖼️',
  yes_no: '👍',
  short_text: '✏️',
  text: '📝',
  number: '🔢',
  date: '📅',
  time: '🕒',
  scale: '📏',
  stars: '⭐',
  nps: '📈',
  matrix: '▦',
  matrix_multi: '▦',
  ranking: '🏆',
  points: '🎯',
  pairwise: '⚖️',
  file: '📎',
  video: '🎬',
  contact: '📇',
  region: '🗺️',
  info: 'ℹ️',
  section: '📂',
  rating5: '⭐',
  rating10: '🔟',
}

export const OPTION_TYPES = new Set<QType>(['single', 'multiple', 'dropdown', 'image_choice', 'matrix', 'matrix_multi', 'ranking', 'points', 'pairwise'])
export const OTHER_TYPES = new Set<QType>(['single', 'multiple', 'dropdown'])
export const FILE_FORMATS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'png', 'webp', 'txt']
export const CONTACT_FIELDS = ['full_name', 'phone', 'email', 'organization', 'position'] as const
export const MAX_PAIRWISE = 6

export function isMulti(q: Pick<QuestionT, 'qtype' | 'settings'>): boolean {
  return q.qtype === 'multiple' || (q.qtype === 'image_choice' && !!q.settings?.multiple)
}

/** Settings a freshly picked type starts with. */
export function defaultSettings(qtype: QType): QSettings {
  switch (qtype) {
    case 'short_text':
      return { format: 'any', max_len: 200 }
    case 'text':
    case 'video':
      return { max_len: 2000 }
    case 'scale':
      return { min: 1, max: 10, step: 1 }
    case 'stars':
      return { count: 5 }
    case 'yes_no':
      return { unsure: false }
    case 'number':
      return { integer: false }
    case 'matrix':
    case 'matrix_multi':
      return {
        rows: [
          { text_uz: '', text_ru: '' },
          { text_uz: '', text_ru: '' },
        ],
      }
    case 'points':
      return { total: 100 }
    case 'file':
      return { formats: ['pdf', 'docx', 'jpg', 'png'], max_mb: 10, max_files: 1 }
    case 'contact':
      return { fields: { full_name: true, phone: true }, purpose_uz: '', purpose_ru: '' }
    case 'region':
      return { district: true }
    case 'image_choice':
      return { multiple: false }
    default:
      return {}
  }
}

export function ratingValues(q: Pick<QuestionT, 'qtype' | 'settings'>): number[] {
  const s = q.settings ?? {}
  let lo = 1
  let hi = 5
  let step = 1
  if (q.qtype === 'rating10') hi = 10
  else if (q.qtype === 'stars') hi = s.count || 5
  else if (q.qtype === 'nps') {
    lo = 0
    hi = 10
  } else if (q.qtype === 'scale') {
    lo = s.min ?? 1
    hi = s.max ?? 5
    step = s.step || 1
  }
  const out: number[] = []
  for (let v = lo; v <= hi; v += step) out.push(v)
  return out
}

export function pairKeys(q: Pick<QuestionT, 'options'>): [number, number][] {
  const ids = q.options.map((o) => o.id).sort((a, b) => a - b)
  const out: [number, number][] = []
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => out.push([a, b])))
  return out
}

export function choiceCount(v: AnswerValue | undefined): number {
  return (v?.option_ids?.length ?? 0) + (v?.other != null ? 1 : 0)
}

export function isAnswered(q: QuestionT, v: AnswerValue | undefined): boolean {
  if (!v) return false
  switch (q.qtype) {
    case 'single':
    case 'dropdown':
    case 'image_choice':
    case 'multiple':
      return v.option_id != null || (v.option_ids?.length ?? 0) > 0 || !!v.other?.trim()
    case 'text':
    case 'short_text':
    case 'video':
      return !!v.text?.trim()
    case 'number':
      return typeof v.number === 'number' && isFinite(v.number)
    case 'yes_no':
      return typeof v.bool === 'boolean' || v.unsure === true
    case 'rating5':
    case 'rating10':
    case 'scale':
    case 'stars':
    case 'nps':
      return typeof v.rating === 'number'
    case 'date':
      return !!v.date
    case 'time':
      return !!v.time
    case 'matrix':
    case 'matrix_multi':
      return Object.keys(v.matrix ?? {}).length > 0
    case 'ranking':
      return (v.order?.length ?? 0) > 0
    case 'points':
      return Object.values(v.points ?? {}).some((n) => n > 0)
    case 'pairwise':
      return Object.keys(v.pairs ?? {}).length > 0
    case 'file':
      return (v.files?.length ?? 0) > 0
    case 'contact':
      return Object.values(v.contact ?? {}).some((x) => !!x?.trim())
    case 'region':
      return v.region != null
    case 'info':
    case 'section':
      return false
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/
const FORMAT_RE: Record<string, RegExp> = {
  email: EMAIL_RE,
  phone: PHONE_RE,
  url: /^https?:\/\/\S+\.\S+$/,
  digits: /^\d+$/,
  letters: /^[^\d!"#$%&()*+,./:;<=>?@[\\\]^_`{|}~]+$/,
}

/** Same rules the server checks on submit; returns a reason code or null. */
export function problem(q: QuestionT, v: AnswerValue | undefined): string | null {
  const s = q.settings ?? {}
  if (q.qtype === 'info' || q.qtype === 'section') return null
  if (!isAnswered(q, v) || !v) return q.required ? 'required' : null
  if (isMulti(q) && q.min_choices && choiceCount(v) < q.min_choices) return 'min_choices'
  if (q.qtype === 'text' || q.qtype === 'short_text' || q.qtype === 'video') {
    const text = (v.text ?? '').trim()
    if (s.min_len && text.length < s.min_len) return 'min_len'
    const re = s.format ? FORMAT_RE[s.format] : undefined
    if (re && !re.test(text)) return 'format'
  }
  if (q.qtype === 'number' && typeof v.number === 'number') {
    if (s.integer && !Number.isInteger(v.number)) return 'integer'
    if ((s.min != null && v.number < s.min) || (s.max != null && v.number > s.max)) return 'range'
  }
  if ((q.qtype === 'matrix' || q.qtype === 'matrix_multi') && q.required && Object.keys(v.matrix ?? {}).length < (s.rows?.length ?? 0)) return 'incomplete'
  if (q.qtype === 'points') {
    const sum = Object.values(v.points ?? {}).reduce((a, b) => a + b, 0)
    if (sum !== (s.total ?? 100)) return 'points_sum'
  }
  if (q.qtype === 'pairwise' && q.required && Object.keys(v.pairs ?? {}).length < pairKeys(q).length) return 'incomplete'
  if (q.qtype === 'contact') {
    const c = v.contact ?? {}
    const enabled = CONTACT_FIELDS.filter((f) => s.fields?.[f])
    if (q.required && enabled.some((f) => !c[f]?.trim())) return 'incomplete'
    if ((c.email && !EMAIL_RE.test(c.email)) || (c.phone && !PHONE_RE.test(c.phone))) return 'format'
  }
  return null
}

export function videoEmbed(url: string): { kind: 'iframe' | 'video' | 'link'; src: string } {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` }
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` }
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return { kind: 'video', src: url }
  return { kind: 'link', src: url }
}
