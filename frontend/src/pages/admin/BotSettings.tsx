// "🤖 Bot sozlamalari": the message the bot sends on /start, edited without any code.
// Stored on the server (PostgreSQL); the next /start uses it, no redeploy needed.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { useApp } from '../../app-context'
import { Bilingual, Button, Card, ConfirmDialog, ErrorBox, Input, Label, Segmented, Spinner, Toggle } from '../../components/ui'
import { useLoad } from '../../hooks'
import { IconBtn } from './QuestionEditor'

interface BotButton {
  type: 'webapp' | 'url'
  text_uz: string
  text_ru: string
  url: string
  visible: boolean
}
interface Welcome {
  enabled: boolean
  languages: 'both' | 'user'
  title_uz: string
  text_uz: string
  title_ru: string
  text_ru: string
  buttons: BotButton[]
}
interface Message {
  text: string
  reply_markup?: { inline_keyboard: { text: string; url?: string; web_app?: { url: string } }[][] }
}
interface WelcomeOut {
  welcome: Welcome
  default: Welcome
  preview: { uz: Message | null; ru: Message | null }
  webapp_ready: boolean
}

export default function BotSettings() {
  const { t, lang, toast, showError, errorText } = useApp()
  const data = useLoad(() => api.get<WelcomeOut>('/api/admin/bot/welcome'))
  const [w, setW] = useState<Welcome | null>(null)
  const [preview, setPreview] = useState<WelcomeOut['preview'] | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLang, setPreviewLang] = useState<'uz' | 'ru'>(lang)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const timer = useRef<number>()

  useEffect(() => {
    if (data.data) {
      setW(data.data.welcome)
      setPreview(data.data.preview)
    }
  }, [data.data])

  // the preview is built by the server, exactly as the bot will send it
  useEffect(() => {
    if (!w) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      api
        .post<WelcomeOut>('/api/admin/bot/welcome/preview', w)
        .then((r) => {
          setPreview(r.preview)
          setPreviewError('')
        })
        .catch((e) => setPreviewError(errorText(e)))
    }, 400)
    return () => window.clearTimeout(timer.current)
  }, [w, errorText])

  if (data.loading && !data.data) return <Spinner />
  if (data.error || !w) return <ErrorBox text={errorText(data.error)} onRetry={data.reload} />

  const set = <K extends keyof Welcome>(k: K, v: Welcome[K]) => setW({ ...w, [k]: v })
  const setButton = (i: number, b: Partial<BotButton>) =>
    set(
      'buttons',
      w.buttons.map((x, k) => (k === i ? { ...x, ...b } : x)),
    )

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.put<WelcomeOut>('/api/admin/bot/welcome', w)
      setW(r.welcome)
      toast(t('botSaved'))
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }
  const sendTest = async () => {
    setTesting(true)
    try {
      await api.post('/api/admin/bot/welcome/test', w)
      toast(t('botTestSent'))
    } catch (e) {
      showError(e)
    } finally {
      setTesting(false)
    }
  }
  const msg = preview?.[w.languages === 'both' ? 'uz' : previewLang] ?? null

  return (
    <div className="pb-8">
      <h1 className="text-2xl font-bold">🤖 {t('botTitle')}</h1>
      <h2 className="mt-1 text-lg font-semibold text-muted">👋 {t('botWelcome')}</h2>

      <Card className="mt-4 space-y-4">
        <Toggle checked={w.enabled} onChange={(v) => set('enabled', v)} label={t('botEnabled')} />
        {!w.enabled && <p className="text-sm text-muted">{t('botDisabledHint')}</p>}
        <div>
          <Label>{t('botLanguages')}</Label>
          <Segmented
            value={w.languages}
            onChange={(v) => set('languages', v)}
            options={[
              { value: 'both', label: t('botLangBoth') },
              { value: 'user', label: t('botLangUser') },
            ]}
          />
        </div>
        <Bilingual label={t('botHeading')} uz={w.title_uz} ru={w.title_ru} onUz={(v) => set('title_uz', v)} onRu={(v) => set('title_ru', v)} />
        <Bilingual label={t('botText')} multiline uz={w.text_uz} ru={w.text_ru} onUz={(v) => set('text_uz', v)} onRu={(v) => set('text_ru', v)} />
        <p className="text-sm text-muted">{t('botFormatHint')}</p>
        <Button size="sm" variant="outline" onClick={() => setW({ ...w, title_uz: '', text_uz: '', title_ru: '', text_ru: '' })}>
          🧹 {t('botClear')}
        </Button>
      </Card>

      <Card className="mt-4 space-y-3">
        <div className="font-semibold">🔘 {t('botButtons')}</div>
        {w.buttons.map((b, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-muted">{b.type === 'webapp' ? `📱 ${t('botButtonApp')}` : `🔗 ${t('botButtonLink')}`}</span>
              <div className="flex gap-1">
                <IconBtn
                  label="⬆️"
                  title={t('moveUp')}
                  disabled={i === 0}
                  onClick={() => {
                    const list = [...w.buttons]
                    ;[list[i - 1], list[i]] = [list[i], list[i - 1]]
                    set('buttons', list)
                  }}
                />
                {b.type === 'url' && (
                  <IconBtn
                    label="🗑️"
                    title={t('delete')}
                    onClick={() =>
                      set(
                        'buttons',
                        w.buttons.filter((_, k) => k !== i),
                      )
                    }
                  />
                )}
              </div>
            </div>
            <Bilingual
              label={t('botButtonText')}
              uz={b.text_uz}
              ru={b.text_ru}
              onUz={(v) => setButton(i, { text_uz: v })}
              onRu={(v) => setButton(i, { text_ru: v })}
            />
            {b.type === 'url' && (
              <div>
                <Label>{t('botButtonUrl')}</Label>
                <Input type="url" placeholder="https://" value={b.url} onChange={(e) => setButton(i, { url: e.target.value })} />
              </div>
            )}
            <Toggle checked={b.visible} onChange={(v) => setButton(i, { visible: v })} label={t('botButtonVisible')} />
            {b.type === 'webapp' && <p className="text-sm text-muted">{t('botAppButtonHint')}</p>}
          </div>
        ))}
        {w.buttons.length < 6 && (
          <Button
            size="sm"
            variant="soft"
            onClick={() => set('buttons', [...w.buttons, { type: 'url', text_uz: '', text_ru: '', url: 'https://', visible: true }])}
          >
            ➕ {t('botAddLink')}
          </Button>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">👁️ {t('botPreview')}</div>
          {w.languages === 'user' && (
            <Segmented
              value={previewLang}
              onChange={setPreviewLang}
              options={[
                { value: 'uz', label: 'UZ' },
                { value: 'ru', label: 'RU' },
              ]}
            />
          )}
        </div>
        {previewError ? (
          <p className="mt-3 text-sm text-red-600">{previewError}</p>
        ) : !w.enabled || !msg ? (
          <p className="mt-3 text-sm text-muted">{t('botPreviewOff')}</p>
        ) : (
          <div className="mt-3 rounded-2xl bg-[#e6ebee] p-3 dark:bg-[#0e1621]">
            <div className="max-w-[340px] rounded-2xl rounded-bl-md bg-white p-3 text-[15px] leading-snug text-black shadow-sm dark:bg-[#182533] dark:text-white">
              {/* the server builds this HTML from escaped text: only <b> and https links are in it */}
              <div className="whitespace-pre-wrap break-words [&_a]:text-sky-600 [&_a]:underline" dangerouslySetInnerHTML={{ __html: msg.text }} />
            </div>
            <div className="mt-1 max-w-[340px] space-y-1">
              {(msg.reply_markup?.inline_keyboard ?? []).map((row, k) => (
                <div key={k} className="rounded-lg bg-white/70 py-2 text-center text-sm font-semibold text-sky-700 dark:bg-white/10 dark:text-sky-300">
                  {row[0].text}
                  {row[0].url ? ' ↗' : ''}
                </div>
              ))}
            </div>
          </div>
        )}
        {!data.data?.webapp_ready && <p className="mt-2 text-sm text-amber-700">{t('botNoHttps')}</p>}
      </Card>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Button variant="success" loading={saving} onClick={save}>
          {t('save')}
        </Button>
        <Button variant="soft" loading={testing} onClick={sendTest}>
          📨 {t('botSendTest')}
        </Button>
        <Button variant="outline" onClick={() => setConfirmReset(true)}>
          ↺ {t('botReset')}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">{t('botSaveHint')}</p>

      <ConfirmDialog
        open={confirmReset}
        text={t('botResetConfirm')}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false)
          try {
            const r = await api.post<WelcomeOut>('/api/admin/bot/welcome/reset')
            setW(r.welcome)
            toast(t('botSaved'))
          } catch (e) {
            showError(e)
          }
        }}
      />
    </div>
  )
}
