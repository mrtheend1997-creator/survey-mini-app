import { useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Button, Card, ConfirmDialog, Input, Label, Modal, Spinner } from '../../components/ui'
import { useLoad } from '../../hooks'
import { pick } from '../../i18n'
import type { RegionT } from '../../types'
import { IconBtn } from './QuestionEditor'

interface EditState {
  id?: number
  parent_id?: number | null
  name_uz: string
  name_ru: string
}

/** Super Admin: the regions → districts list used by "Region" questions. */
export default function RegionsSettings() {
  const { t, lang, toast, showError } = useApp()
  const [open, setOpen] = useState(false)
  const list = useLoad(() => (open ? api.get<RegionT[]>('/api/admin/regions') : Promise.resolve(null)), [open])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [toDelete, setToDelete] = useState<{ id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!edit) return
    setBusy(true)
    try {
      if (edit.id) await api.patch(`/api/admin/regions/${edit.id}`, { name_uz: edit.name_uz, name_ru: edit.name_ru })
      else await api.post('/api/admin/regions', { name_uz: edit.name_uz, name_ru: edit.name_ru, parent_id: edit.parent_id ?? null })
      toast(t('savedOk'))
      setEdit(null)
      await list.reload()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-4">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-semibold">🗺️ {t('regionsTitle')}</span>
        <span className="text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-sm text-muted">{t('regionsHint')}</p>
          {list.loading && !list.data && <Spinner />}
          <div className="divide-y divide-line rounded-xl border border-line">
            {list.data?.map((r) => (
              <div key={r.id}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <div className="font-medium">{pick(r, 'name', lang)}</div>
                    <div className="text-xs text-muted">
                      {r.districts.length} {t('districtsShort')} {expanded === r.id ? '▲' : '▼'}
                    </div>
                  </button>
                  <IconBtn label="✏️" title={t('edit')} onClick={() => setEdit({ id: r.id, name_uz: r.name_uz, name_ru: r.name_ru })} />
                  <IconBtn label="🗑️" title={t('delete')} onClick={() => setToDelete({ id: r.id, name: pick(r, 'name', lang) })} />
                </div>
                {expanded === r.id && (
                  <div className="space-y-1 bg-navy-50/60 px-3 py-2 dark:bg-white/5">
                    {r.districts.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 pl-3">
                        <span className="min-w-0 flex-1 text-[15px]">{pick(d, 'name', lang)}</span>
                        <IconBtn label="✏️" title={t('edit')} onClick={() => setEdit({ id: d.id, name_uz: d.name_uz, name_ru: d.name_ru })} />
                        <IconBtn label="🗑️" title={t('delete')} onClick={() => setToDelete({ id: d.id, name: pick(d, 'name', lang) })} />
                      </div>
                    ))}
                    <Button size="sm" variant="soft" block onClick={() => setEdit({ parent_id: r.id, name_uz: '', name_ru: '' })}>
                      {t('addDistrict')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button variant="soft" block className="mt-3" onClick={() => setEdit({ parent_id: null, name_uz: '', name_ru: '' })}>
            {t('addRegion')}
          </Button>
        </div>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t('edit') : edit?.parent_id ? t('addDistrict') : t('addRegion')}
        footer={
          <Button variant="success" block loading={busy} disabled={!edit?.name_uz.trim() || !edit?.name_ru.trim()} onClick={save}>
            {t('save')}
          </Button>
        }
      >
        {edit && (
          <div className="space-y-3">
            <div>
              <Label required>UZ</Label>
              <Input autoFocus value={edit.name_uz} onChange={(e) => setEdit({ ...edit, name_uz: e.target.value })} />
            </div>
            <div>
              <Label required>RU</Label>
              <Input value={edit.name_ru} onChange={(e) => setEdit({ ...edit, name_ru: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={busy}
        text={t('confirmDeleteRegion', { name: toDelete?.name ?? '' })}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return
          setBusy(true)
          try {
            await api.del(`/api/admin/regions/${toDelete.id}`)
            toast(t('deletedOk'))
            await list.reload()
          } catch (e) {
            showError(e)
          } finally {
            setBusy(false)
            setToDelete(null)
          }
        }}
      />
    </Card>
  )
}
