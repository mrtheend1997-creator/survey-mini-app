import { useRef, useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { setLogoUrl, useLogoUrl } from '../../branding'
import { Logo } from '../../components/Header'
import { Button, Card, ConfirmDialog } from '../../components/ui'

const MAX_BYTES = 2 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** «🖼 Изменить логотип»: Super Admin uploads a new logo without touching the code. */
export default function LogoSettings() {
  const { t, me, toast, showError } = useApp()
  const { custom } = useLogoUrl()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const isSuper = me?.role === 'super_admin'

  const upload = async (file: File) => {
    // quick checks here for a friendly message; the server checks the real file content again
    if (!TYPES.includes(file.type)) return toast(t('logoBadType'), 'error')
    if (file.size > MAX_BYTES) return toast(t('logoTooBig'), 'error')
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.upload<{ logo_url: string | null }>('/api/admin/branding/logo', fd, 'PUT')
      setLogoUrl(res.logo_url)
      toast(t('logoSaved'))
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await api.del('/api/admin/branding/logo')
      setLogoUrl(null)
      toast(t('logoResetDone'))
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
      setConfirmReset(false)
    }
  }

  return (
    <Card className="mt-4">
      <div className="font-semibold">{t('changeLogo')}</div>
      <div className="mt-4 flex items-center gap-4">
        <Logo size={88} />
        <div className="min-w-0 text-sm text-muted">
          <div className="font-medium text-ink">{custom ? t('logoCustom') : t('logoDefault')}</div>
          <div className="mt-1">{t('logoHint')}</div>
        </div>
      </div>
      {isSuper ? (
        <div className="mt-4 space-y-2">
          <Button variant="success" block loading={busy} onClick={() => fileRef.current?.click()}>
            {t('uploadLogo')}
          </Button>
          {custom && (
            <Button variant="outline" block disabled={busy} onClick={() => setConfirmReset(true)}>
              {t('resetLogo')}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t('onlySuperAdmin')}</div>
      )}
      <ConfirmDialog open={confirmReset} text={t('confirmResetLogo')} loading={busy} onCancel={() => setConfirmReset(false)} onConfirm={reset} />
    </Card>
  )
}
