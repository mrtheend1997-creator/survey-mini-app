import { useState } from 'react'
import { api, qs } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, ConfirmDialog, ErrorBox, Input, Select, Spinner } from '../../components/ui'
import { useLoad } from '../../hooks'
import { formatDate } from '../../i18n'
import type { Role, UserRow } from '../../types'

const ROLES: Role[] = ['super_admin', 'admin', 'analyst', 'user']

interface UsersPage {
  total: number
  items: UserRow[]
  role_counts: Record<string, number>
  assignable_roles: Role[]
}

export default function AdminUsers() {
  const { t, lang, me, toast, showError, errorText } = useApp()
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [pendingRole, setPendingRole] = useState<{ user: UserRow; role: Role } | null>(null)
  const { data, error, loading, reload } = useLoad(() => api.get<UsersPage>(`/api/admin/users${qs({ q, role, page, page_size: 30 })}`), [role, page])

  const patch = async (u: UserRow, body: Partial<Pick<UserRow, 'role' | 'is_blocked'>>, msg: string) => {
    try {
      await api.patch(`/api/admin/users/${u.id}`, body)
      toast(msg)
      reload()
    } catch (e) {
      showError(e)
    }
  }

  const assignable = data?.assignable_roles ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold">{t('usersTitle')}</h1>
      <p className="mt-2 rounded-xl bg-navy-50 p-3 text-sm leading-relaxed text-muted dark:bg-white/5">{t('rolesHelp')}</p>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          reload()
        }}
      >
        <Input type="search" value={q} placeholder={`${t('search')} (ism, @username, ID)`} onChange={(e) => setQ(e.target.value)} />
      </form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {['', ...ROLES].map((r) => (
          <button
            key={r}
            onClick={() => {
              setPage(1)
              setRole(r)
            }}
            className={`min-h-[38px] shrink-0 rounded-full px-4 text-sm font-semibold ${role === r ? 'bg-navy-800 text-white dark:bg-navy-500' : 'bg-card ring-1 ring-line'}`}
          >
            {r ? t(`role_${r}` as 'role_user') : t('all')}
            {r && data?.role_counts[r] ? ` · ${data.role_counts[r]}` : ''}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2.5">
        {loading && !data && <Spinner />}
        {!!error && <ErrorBox text={errorText(error)} onRetry={reload} />}
        {data?.items.map((u) => {
          const isMe = u.id === me?.id
          const canEdit = !isMe && assignable.includes(u.role)
          const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '—'
          return (
            <Card key={u.id} className="!p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {name} {isMe && <span className="text-sm text-muted">({t('you')})</span>}
                  </div>
                  <div className="text-sm text-muted">
                    {u.username ? `@${u.username} · ` : ''}ID {u.telegram_id}
                  </div>
                  <div className="text-xs text-muted">
                    {t('lastSeen')}: {formatDate(u.last_seen_at, lang, true)}
                  </div>
                </div>
                {u.is_blocked && <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{t('blocked')}</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <Select value={u.role} disabled={!canEdit} onChange={(e) => setPendingRole({ user: u, role: e.target.value as Role })} className="!py-2">
                  {ROLES.filter((r) => r === u.role || assignable.includes(r)).map((r) => (
                    <option key={r} value={r}>
                      {t(`role_${r}` as 'role_user')}
                    </option>
                  ))}
                </Select>
                {canEdit && (
                  <Button
                    size="md"
                    variant={u.is_blocked ? 'success' : 'outline'}
                    className="shrink-0"
                    onClick={() => patch(u, { is_blocked: !u.is_blocked }, t('savedOk'))}
                  >
                    {u.is_blocked ? t('unblock') : t('block')}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="outline" size="md" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ←
          </Button>
          <span className="text-muted">
            {page} / {pages}
          </span>
          <Button variant="outline" size="md" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            →
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!pendingRole}
        text={
          pendingRole
            ? `${[pendingRole.user.first_name, pendingRole.user.last_name].filter(Boolean).join(' ') || pendingRole.user.telegram_id}: ${t(`role_${pendingRole.user.role}` as 'role_user')} → ${t(`role_${pendingRole.role}` as 'role_user')}`
            : ''
        }
        onCancel={() => setPendingRole(null)}
        onConfirm={async () => {
          if (pendingRole) await patch(pendingRole.user, { role: pendingRole.role }, t('roleChanged'))
          setPendingRole(null)
        }}
      />
    </div>
  )
}
