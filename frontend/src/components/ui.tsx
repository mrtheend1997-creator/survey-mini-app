import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useApp } from '../app-context'

type Variant = 'primary' | 'success' | 'outline' | 'danger' | 'ghost' | 'soft'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy-800 text-white hover:bg-navy-700 dark:bg-navy-500 dark:hover:bg-navy-600',
  success: 'bg-brand-500 text-white hover:bg-brand-600',
  outline: 'border-2 border-line bg-card text-ink hover:border-navy-200',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'bg-transparent text-ink hover:bg-black/5 dark:hover:bg-white/5',
  soft: 'bg-navy-50 text-navy-800 hover:bg-navy-100 dark:bg-white/10 dark:text-ink',
}

export function Button({
  variant = 'primary',
  size = 'lg',
  block,
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  loading?: boolean
}) {
  const sizes = { sm: 'min-h-[40px] px-3 text-sm', md: 'min-h-[46px] px-4 text-[15px]', lg: 'min-h-[54px] px-5 text-base' }
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${sizes[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-line bg-card p-4 shadow-sm ${onClick ? 'cursor-pointer transition active:scale-[0.99]' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-navy-500 border-t-transparent" />
      {label && <span>{label}</span>}
    </div>
  )
}

export function Empty({ icon = '📭', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-lg font-semibold">{title}</div>
      {hint && <div className="text-muted">{hint}</div>}
      {action && <div className="mt-3 w-full max-w-xs">{action}</div>}
    </div>
  )
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useApp()
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <div className="text-3xl">⚠️</div>
      <div>{text}</div>
      {onRetry && (
        <Button variant="outline" size="md" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  )
}

export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-[15px] font-semibold text-ink">
      {children}
      {required && <span className="ml-1 text-red-600">*</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-xl border-2 border-line bg-card px-3.5 py-3 text-base text-ink outline-none transition placeholder:text-muted/70 focus:border-navy-500'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={`${inputCls} ${props.className ?? ''}`} />
})

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${inputCls} resize-y ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} appearance-auto ${props.className ?? ''}`} />
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-line bg-card px-3.5 py-3 text-left"
    >
      <span className="text-[15px] font-medium">{label}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** Two stacked inputs for the Uzbek and Russian version of one field. */
export function Bilingual({
  label,
  uz,
  ru,
  onUz,
  onRu,
  multiline,
  required,
  placeholderUz,
  placeholderRu,
}: {
  label: string
  uz: string
  ru: string
  onUz: (v: string) => void
  onRu: (v: string) => void
  multiline?: boolean
  required?: boolean
  placeholderUz?: string
  placeholderRu?: string
}) {
  const C = multiline ? TextArea : Input
  return (
    <div>
      <Label required={required}>{label}</Label>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-3 w-9 shrink-0 text-xs font-bold text-muted">UZ</span>
          <C value={uz} placeholder={placeholderUz} onChange={(e) => onUz(e.target.value)} />
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-3 w-9 shrink-0 text-xs font-bold text-muted">RU</span>
          <C value={ru} placeholder={placeholderRu} onChange={(e) => onRu(e.target.value)} />
        </div>
      </div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  full,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  full?: boolean
}) {
  const { t } = useApp()
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className={`animate-slide-up flex w-full flex-col bg-surface shadow-2xl sm:max-w-xl sm:rounded-3xl ${
          full ? 'h-[100dvh] sm:h-[90vh]' : 'max-h-[90dvh] rounded-t-3xl'
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="text-lg font-bold">{title}</div>
          <button onClick={onClose} aria-label={t('close')} className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-black/5">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-line px-4 pt-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  text,
  onConfirm,
  onCancel,
  danger,
  loading,
}: {
  open: boolean
  text: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
  loading?: boolean
}) {
  const { t } = useApp()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('confirm')}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" block onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'success'} block onClick={onConfirm} loading={loading}>
            {t('confirm')}
          </Button>
        </div>
      }
    >
      <p className="text-base leading-relaxed">{text}</p>
    </Modal>
  )
}

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  active: 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  finished: 'bg-navy-100 text-navy-800 dark:bg-navy-700/50 dark:text-navy-100',
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useApp()
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_CLS[status] ?? STATUS_CLS.draft}`}>
      {t(`status_${status}` as 'status_draft')}
    </span>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex w-full rounded-2xl bg-navy-50 p-1 dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-[40px] flex-1 rounded-xl px-2 text-sm font-semibold transition ${value === o.value ? 'bg-card text-ink shadow' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: 'green' | 'navy' }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="text-[13px] font-medium leading-tight text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent === 'green' ? 'text-brand-600' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between gap-2">
      <h2 className="text-lg font-bold">{children}</h2>
      {action}
    </div>
  )
}
