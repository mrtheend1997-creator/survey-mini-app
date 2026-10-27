import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, ConfirmDialog, ErrorBox, Input, Label, Modal, Spinner, Toggle } from '../../components/ui'
import { useLoad } from '../../hooks'
import { formatDate, pick } from '../../i18n'
import type { AdminRow, AdminStatus, AdminSurvey, StaffRole } from '../../types'

const STAFF_ROLES: StaffRole[] = ['admin', 'analyst', 'super_admin']

const STATUS_CLS: Record<AdminStatus, string> = {
  active: 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  suspended: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
}

const ROLE_CLS: Record<StaffRole, string> = {
  super_admin: 'bg-navy-800 text-white dark:bg-navy-500',
  admin: 'bg-navy-100 text-navy-800 dark:bg-navy-700/50 dark:text-navy-100',
  analyst: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100',
}

type DialogMode = 'add' | 'edit' | 'rights'

interface Lookup {
  exists: boolean
  telegram_id: number
  id?: number
  name?: string
  username?: string
  role?: string
  joined?: boolean
}

export default function AdminAdmins() {
  const { t, showError, toast, errorText } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<{ items: AdminRow[] }>('/api/admin/admins'))
  const surveys = useLoad(() => api.get<AdminSurvey[]>('/api/admin/surveys'))
  const [dialog, setDialog] = useState<{ mode: DialogMode; admin: AdminRow | null } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'suspend' | 'remove'; admin: AdminRow } | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast(msg)
      await reload()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  const toggleSuspend = (a: AdminRow) => {
    if (a.status === 'suspended') act(() => api.patch(`/api/admin/admins/${a.id}`, { suspended: false }), t('adminUnsuspended'))
    else setConfirm({ kind: 'suspend', admin: a })
  }

  const items = data?.items ?? []
  const rowProps = { onEdit: (a: AdminRow) => setDialog({ mode: 'edit', admin: a }), onRights: (a: AdminRow) => setDialog({ mode: 'rights', admin: a }) }

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold">{t('adminsTitle')}</h1>
      <p className="mt-2 rounded-xl bg-navy-50 p-3 text-sm leading-relaxed text-muted dark:bg-white/5">{t('adminsHelp')}</p>
      <Button variant="success" block className="mt-4 min-h-[58px] text-lg shadow-md" onClick={() => setDialog({ mode: 'add', admin: null })}>
        {t('addAdmin')}
      </Button>

      {loading && !data && <Spinner />}
      {!!error && <ErrorBox text={errorText(error)} onRetry={reload} />}

      {/* phones: one card per administrator */}
      <div className="mt-4 space-y-2.5 md:hidden">
        {items.map((a) => (
          <Card key={a.id} className="!p-3.5">
            <AdminInfo a={a} />
            <AdminActions a={a} {...rowProps} onSuspend={toggleSuspend} onRemove={(x) => setConfirm({ kind: 'remove', admin: x })} />
          </Card>
        ))}
      </div>

      {/* wider screens: a table */}
      {items.length > 0 && (
        <div className="mt-4 hidden overflow-hidden rounded-2xl border border-line bg-card md:block">
          <table className="w-full text-left text-[15px]">
            <thead className="bg-navy-50 text-xs font-bold uppercase tracking-wide text-muted dark:bg-white/5">
              <tr>
                <th className="px-4 py-3">{t('colName')}</th>
                <th className="px-3 py-3">{t('role')}</th>
                <th className="px-3 py-3">{t('colStatus')}</th>
                <th className="px-3 py-3">{t('assignedAt')}</th>
                <th className="px-3 py-3">{t('lastSeen')}</th>
                <th className="px-4 py-3 text-right">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <AdminTableRow key={a.id} a={a} {...rowProps} onSuspend={toggleSuspend} onRemove={(x) => setConfirm({ kind: 'remove', admin: x })} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <AdminDialog
          mode={dialog.mode}
          admin={dialog.admin}
          surveys={surveys.data ?? []}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reload()
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        danger
        loading={busy}
        text={confirm ? t(confirm.kind === 'suspend' ? 'confirmSuspend' : 'confirmRemove', { name: displayName(confirm.admin) }) : ''}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          const a = confirm.admin
          if (confirm.kind === 'suspend') await act(() => api.patch(`/api/admin/admins/${a.id}`, { suspended: true }), t('adminSuspended'))
          else await act(() => api.del(`/api/admin/admins/${a.id}`), t('adminRemoved'))
          setConfirm(null)
        }}
      />
    </div>
  )
}

function displayName(a: AdminRow): string {
  return a.name || (a.username ? `@${a.username}` : `ID ${a.telegram_id}`)
}

function RoleBadge({ role }: { role: StaffRole }) {
  const { t } = useApp()
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${ROLE_CLS[role]}`}>{t(`role_${role}`)}</span>
}

function StatusBadge({ status }: { status: AdminStatus }) {
  const { t } = useApp()
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_CLS[status]}`}>{t(`adminStatus_${status}`)}</span>
}

function NameCell({ a }: { a: AdminRow }) {
  const { t } = useApp()
  return (
    <div className="min-w-0">
      <div className="font-semibold">
        {displayName(a)} {a.is_me && <span className="text-sm font-normal text-muted">({t('you')})</span>}
      </div>
      <div className="text-sm text-muted">
        {a.username && a.name ? `@${a.username} · ` : ''}ID {a.telegram_id}
      </div>
      {a.display_name && a.name !== a.display_name && <div className="text-xs text-muted">«{a.display_name}»</div>}
      {a.from_server_settings && <div className="mt-0.5 text-xs font-semibold text-muted">{t('fromServer')}</div>}
    </div>
  )
}

function RightsSummary({ a }: { a: AdminRow }) {
  const { t } = useApp()
  if (a.role === 'super_admin') return null
  const parts = [a.all_surveys ? t('allSurveysShort') : t('someSurveysShort', { n: a.survey_ids.length })]
  if (a.role === 'admin' && a.owned_surveys) parts.push(t('ownSurveys', { n: a.owned_surveys }))
  if (a.role === 'admin' && !a.can_publish) parts.push(t('noPublishShort'))
  if (!a.can_export) parts.push(t('noExportShort'))
  return <div className="text-xs text-muted">⚙️ {parts.join(' · ')}</div>
}

function Assigned({ a }: { a: AdminRow }) {
  const { t, lang } = useApp()
  if (!a.role_assigned_at) return <span className="text-muted">—</span>
  return (
    <span>
      {formatDate(a.role_assigned_at, lang)}
      {a.role_assigned_by && <span className="block text-xs text-muted">{t('assignedBy', { name: a.role_assigned_by })}</span>}
    </span>
  )
}

function AdminInfo({ a }: { a: AdminRow }) {
  const { t, lang } = useApp()
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <NameCell a={a} />
        <RoleBadge role={a.role} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <StatusBadge status={a.status} />
        <span className="text-muted">
          {t('assignedAt')}: {a.role_assigned_at ? formatDate(a.role_assigned_at, lang) : '—'}
          {a.role_assigned_by ? ` · ${t('assignedBy', { name: a.role_assigned_by })}` : ''}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted">
        {t('lastSeen')}: {a.last_seen_at ? formatDate(a.last_seen_at, lang, true) : '—'}
      </div>
      <div className="mt-1">
        <RightsSummary a={a} />
      </div>
    </div>
  )
}

interface ActionProps {
  a: AdminRow
  onEdit: (a: AdminRow) => void
  onRights: (a: AdminRow) => void
  onSuspend: (a: AdminRow) => void
  onRemove: (a: AdminRow) => void
}

function lockReason(a: AdminRow, t: ReturnType<typeof useApp>['t']): string | null {
  if (a.is_me) return t('selfHint')
  if (a.from_server_settings) return t('fromServerHint')
  return null
}

function AdminActions({ a, onEdit, onRights, onSuspend, onRemove, compact }: ActionProps & { compact?: boolean }) {
  const { t } = useApp()
  const locked = lockReason(a, t)
  if (locked)
    return <div className={`text-xs text-muted ${compact ? 'max-w-[220px] text-right' : 'mt-3 rounded-xl bg-navy-50 p-2.5 dark:bg-white/5'}`}>{locked}</div>
  const size = 'sm'
  return (
    <div className={compact ? 'flex flex-wrap justify-end gap-1.5' : 'mt-3 grid grid-cols-2 gap-2'}>
      <Button size={size} variant="soft" onClick={() => onEdit(a)}>
        {t('editAdmin')}
      </Button>
      <Button size={size} variant="soft" onClick={() => onRights(a)} disabled={a.role === 'super_admin'}>
        {t('adminRights')}
      </Button>
      <Button size={size} variant={a.status === 'suspended' ? 'success' : 'outline'} onClick={() => onSuspend(a)}>
        {a.status === 'suspended' ? t('unsuspendAdmin') : t('suspendAdmin')}
      </Button>
      <Button size={size} variant="outline" className="!text-red-600" onClick={() => onRemove(a)}>
        {t('removeAdmin')}
      </Button>
    </div>
  )
}

function AdminTableRow(props: ActionProps) {
  const { lang } = useApp()
  const { a } = props
  return (
    <tr className="border-t border-line align-top">
      <td className="px-4 py-3">
        <NameCell a={a} />
        <div className="mt-1">
          <RightsSummary a={a} />
        </div>
      </td>
      <td className="px-3 py-3">
        <RoleBadge role={a.role} />
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={a.status} />
      </td>
      <td className="px-3 py-3 text-sm">
        <Assigned a={a} />
      </td>
      <td className="px-3 py-3 text-sm">{a.last_seen_at ? formatDate(a.last_seen_at, lang, true) : '—'}</td>
      <td className="px-4 py-3">
        <AdminActions {...props} compact />
      </td>
    </tr>
  )
}

/** The window for adding an administrator, editing name/role, or setting access rights. */
function AdminDialog({
  mode,
  admin,
  surveys,
  onClose,
  onSaved,
}: {
  mode: DialogMode
  admin: AdminRow | null
  surveys: AdminSurvey[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t, lang, me, toast, showError } = useApp()
  const [tid, setTid] = useState(admin ? String(admin.telegram_id) : '')
  const [name, setName] = useState(admin?.display_name ?? '')
  const [role, setRole] = useState<StaffRole>(admin?.role ?? 'admin')
  const [allSurveys, setAllSurveys] = useState(admin?.all_surveys ?? false)
  const [allTouched, setAllTouched] = useState(!!admin)
  const [canExport, setCanExport] = useState(admin?.can_export ?? true)
  const [canPublish, setCanPublish] = useState(admin?.can_publish ?? true)
  const [surveyIds, setSurveyIds] = useState<number[]>(admin?.survey_ids ?? [])
  const [lookup, setLookup] = useState<Lookup | 'checking' | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmSuper, setConfirmSuper] = useState(false)

  const tidValid = /^\d{1,16}$/.test(tid.trim()) && Number(tid) > 0
  const showMain = mode !== 'rights'
  const showRights = mode !== 'edit' && role !== 'super_admin'

  // analysts usually look at everything; admins usually get only their own surveys
  useEffect(() => {
    if (!allTouched) setAllSurveys(role === 'analyst')
  }, [role, allTouched])

  useEffect(() => {
    if (mode !== 'add' || !tidValid) {
      setLookup(null)
      return
    }
    setLookup('checking')
    const timer = setTimeout(() => {
      api
        .get<Lookup>(`/api/admin/admins/lookup?telegram_id=${tid.trim()}`)
        .then(setLookup)
        .catch(() => setLookup(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [tid, tidValid, mode])

  const lookupState = (() => {
    if (!lookup || lookup === 'checking') return null
    if (lookup.exists && lookup.id === me?.id) return { tone: 'warn', text: t('lookupIsMe') }
    if (lookup.exists && lookup.role && lookup.role !== 'user')
      return { tone: 'warn', text: t('lookupIsAdmin', { role: t(`role_${lookup.role}` as 'role_user') }) }
    if (lookup.exists && lookup.joined)
      return { tone: 'ok', text: t('lookupFound', { name: lookup.name || (lookup.username ? `@${lookup.username}` : `ID ${lookup.telegram_id}`) }) }
    return { tone: 'info', text: t('lookupNotFound') }
  })()
  const blocked = lookupState?.tone === 'warn'

  const save = async () => {
    if (mode === 'add' && !tidValid) return toast(t('invalidTelegramId'), 'error')
    setSaving(true)
    try {
      const rights = { all_surveys: allSurveys, can_export: canExport, can_publish: canPublish, survey_ids: allSurveys ? [] : surveyIds }
      if (mode === 'add') {
        const res = await api.post<AdminRow>('/api/admin/admins', { telegram_id: Number(tid.trim()), name: name.trim(), role, ...rights })
        toast(res.status === 'pending' ? t('adminAddedPending') : t('adminAdded'))
      } else if (mode === 'edit' && admin) {
        await api.patch(`/api/admin/admins/${admin.id}`, { name: name.trim(), role })
        toast(role !== admin.role ? t('roleChanged') : t('savedOk'))
      } else if (admin) {
        await api.patch(`/api/admin/admins/${admin.id}`, rights)
        toast(t('savedOk'))
      }
      onSaved()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  const onSave = () => (showMain && role === 'super_admin' && admin?.role !== 'super_admin' ? setConfirmSuper(true) : save())
  const title = mode === 'add' ? t('addAdmin') : mode === 'edit' ? t('editAdmin') : t('adminRights')

  return (
    <>
      <Modal
        open
        full
        onClose={onClose}
        title={title}
        footer={
          <Button
            variant="success"
            block
            className="mb-3"
            onClick={onSave}
            loading={saving}
            disabled={(mode === 'add' && (!tidValid || blocked)) || lookup === 'checking'}
          >
            {t('save')}
          </Button>
        }
      >
        {admin && mode !== 'add' && (
          <div className="mb-4 rounded-xl bg-navy-50 p-3 dark:bg-white/5">
            <div className="font-semibold">{displayName(admin)}</div>
            <div className="text-sm text-muted">ID {admin.telegram_id}</div>
          </div>
        )}

        {mode === 'add' && (
          <div className="mb-4">
            <Label required>{t('telegramId')}</Label>
            <Input
              inputMode="numeric"
              autoComplete="off"
              placeholder="123456789"
              value={tid}
              maxLength={16}
              onChange={(e) => setTid(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <p className="mt-1.5 text-sm text-muted">{t('telegramIdHint')}</p>
            {lookup === 'checking' && <p className="mt-2 text-sm text-muted">{t('lookupChecking')}</p>}
            {lookupState && (
              <p
                className={`mt-2 rounded-xl p-3 text-sm leading-relaxed ${
                  lookupState.tone === 'ok'
                    ? 'bg-brand-50 text-brand-800 dark:bg-brand-700/20 dark:text-brand-100'
                    : lookupState.tone === 'warn'
                      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                      : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
                }`}
              >
                {lookupState.text}
              </p>
            )}
          </div>
        )}

        {showMain && (
          <>
            <div className="mb-4">
              <Label>{t('adminName')}</Label>
              <Input
                value={name}
                maxLength={255}
                onChange={(e) => setName(e.target.value)}
                placeholder={lang === 'uz' ? 'Masalan: Aziz Karimov' : 'Например: Азиз Каримов'}
              />
              <p className="mt-1.5 text-sm text-muted">{t('adminNameHint')}</p>
            </div>
            <Label required>{t('role')}</Label>
            <div className="mb-4 space-y-2" role="radiogroup">
              {STAFF_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={`w-full rounded-xl border-2 p-3 text-left transition ${role === r ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/20' : 'border-line bg-card'}`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${role === r ? 'border-brand-500' : 'border-line'}`}>
                      {role === r && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}
                    </span>
                    {t(`role_${r}`)}
                  </div>
                  <div className="mt-1 pl-7 text-sm text-muted">{t(`roleDesc_${r}`)}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {mode !== 'edit' && role === 'super_admin' && <p className="rounded-xl bg-navy-50 p-3 text-sm text-muted dark:bg-white/5">{t('permSuperAll')}</p>}

        {showRights && (
          <div>
            {mode === 'add' && <div className="mb-2 mt-2 text-lg font-bold">{t('permissions')}</div>}
            <div className="space-y-2">
              <Toggle
                checked={allSurveys}
                onChange={(v) => {
                  setAllTouched(true)
                  setAllSurveys(v)
                }}
                label={t('permAllSurveys')}
              />
              {!allSurveys && (
                <div className="rounded-xl border-2 border-line bg-card p-3">
                  <div className="mb-2 text-sm text-muted">{role === 'admin' ? t('permSurveysAdmin') : t('permSurveysAnalyst')}</div>
                  {surveys.length === 0 && <div className="text-sm text-muted">{t('noSurveysYet')}</div>}
                  <div className="space-y-1">
                    {surveys.map((s) => {
                      const on = surveyIds.includes(s.id)
                      return (
                        <label
                          key={s.id}
                          className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-1 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-[#16a34a]"
                            checked={on}
                            onChange={() => setSurveyIds(on ? surveyIds.filter((x) => x !== s.id) : [...surveyIds, s.id])}
                          />
                          <span className="text-[15px]">{pick(s, 'title', lang)}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              {role === 'admin' && <Toggle checked={canPublish} onChange={setCanPublish} label={t('permPublish')} />}
              <Toggle checked={canExport} onChange={setCanExport} label={t('permExport')} />
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmSuper}
        text={t('confirmMakeSuper')}
        loading={saving}
        onCancel={() => setConfirmSuper(false)}
        onConfirm={async () => {
          await save()
          setConfirmSuper(false)
        }}
      />
    </>
  )
}
