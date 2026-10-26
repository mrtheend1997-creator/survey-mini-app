import { useEffect, useState } from 'react'
import { api, qs } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, Input, Label, SectionTitle, Segmented, Spinner } from '../../components/ui'
import { useLoad } from '../../hooks'
import { auditLabel, formatDate } from '../../i18n'
import LogoSettings from './LogoSettings'

interface SettingsT {
  org_name_uz: string
  org_name_ru: string
  support_contact: string
  default_language: 'uz' | 'ru'
}
interface AuditRow {
  id: number
  action: string
  entity: string
  entity_id: number | null
  created_at: string
  user: string | null
}

export default function AdminSettings() {
  const { t, lang, setLang, me, toast, showError } = useApp()
  const isSuper = me?.role === 'super_admin'
  const manager = isSuper || me?.role === 'admin'
  const settings = useLoad(() => api.get<SettingsT>('/api/admin/settings'))
  const [form, setForm] = useState<SettingsT | null>(null)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const audit = useLoad(
    () => (manager ? api.get<{ total: number; items: AuditRow[] }>(`/api/admin/audit${qs({ page, page_size: 20 })}`) : Promise.resolve(null)),
    [page],
  )

  useEffect(() => {
    if (settings.data) setForm(settings.data)
  }, [settings.data])

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      setForm(await api.put<SettingsT>('/api/admin/settings', form))
      toast(t('savedOk'))
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold">{t('settingsTitle')}</h1>

      <Card className="mt-4">
        <Label>{t('interfaceLang')}</Label>
        <Segmented
          value={lang}
          onChange={setLang}
          options={[
            { value: 'uz', label: t('langUz') },
            { value: 'ru', label: t('langRu') },
          ]}
        />
      </Card>

      <LogoSettings />

      {!form ? (
        <Spinner />
      ) : (
        <Card className="mt-4 space-y-4">
          {!isSuper && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t('onlySuperAdmin')}</div>}
          <div>
            <Label>{t('orgNameUz')}</Label>
            <Input value={form.org_name_uz} disabled={!isSuper} onChange={(e) => setForm({ ...form, org_name_uz: e.target.value })} />
          </div>
          <div>
            <Label>{t('orgNameRu')}</Label>
            <Input value={form.org_name_ru} disabled={!isSuper} onChange={(e) => setForm({ ...form, org_name_ru: e.target.value })} />
          </div>
          <div>
            <Label>{t('supportContact')}</Label>
            <Input value={form.support_contact} disabled={!isSuper} onChange={(e) => setForm({ ...form, support_contact: e.target.value })} />
          </div>
          <div>
            <Label>{t('defaultLanguage')}</Label>
            <Segmented
              value={form.default_language}
              onChange={(v) => isSuper && setForm({ ...form, default_language: v })}
              options={[
                { value: 'uz', label: t('langUz') },
                { value: 'ru', label: t('langRu') },
              ]}
            />
          </div>
          {isSuper && (
            <Button variant="success" block onClick={save} loading={saving}>
              {t('save')}
            </Button>
          )}
        </Card>
      )}

      <Card className="mt-4 text-[15px] leading-relaxed">
        <div className="font-semibold">ℹ️ {t('about')}</div>
        <div className="mt-1 text-muted">FTI Survey v1.0 · {t(`role_${me?.role ?? 'user'}` as 'role_user')}</div>
        <div className="mt-1 text-muted">💾 {t('backupInfo')}</div>
      </Card>

      {manager && (
        <>
          <SectionTitle>📜 {t('auditLog')}</SectionTitle>
          <Card className="divide-y divide-line !p-0">
            {audit.loading && !audit.data && <Spinner />}
            {audit.data?.items.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {auditLabel(lang, r.action)}
                    {r.entity_id ? <span className="text-muted"> #{r.entity_id}</span> : null}
                  </div>
                  <div className="text-sm text-muted">{r.user ?? '—'}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">{formatDate(r.created_at, lang, true)}</div>
              </div>
            ))}
            {audit.data?.items.length === 0 && <div className="px-4 py-6 text-center text-muted">{t('noData')}</div>}
          </Card>
          {audit.data && audit.data.total > 20 && (
            <div className="mt-3 flex items-center justify-between">
              <Button variant="outline" size="md" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ←
              </Button>
              <span className="text-muted">
                {page} / {Math.ceil(audit.data.total / 20)}
              </span>
              <Button variant="outline" size="md" disabled={page >= Math.ceil(audit.data.total / 20)} onClick={() => setPage(page + 1)}>
                →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
