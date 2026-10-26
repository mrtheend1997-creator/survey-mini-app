// Current logo: uploaded by the Super Admin (stored in the database) or the built-in FTI logo.
import { useSyncExternalStore } from 'react'

export const DEFAULT_LOGO = '/fti-logo.png'

let customUrl: string | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function setLogoUrl(url: string | null) {
  customUrl = url
  emit()
}

/** Ask the server once at startup; the endpoint is public, so it also works before login. */
export function loadBranding() {
  fetch('/api/branding')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { logo_url: string | null } | null) => {
      if (d) setLogoUrl(d.logo_url)
    })
    .catch(() => undefined)
}

export function useLogoUrl(): { url: string; custom: boolean } {
  const url = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => customUrl,
  )
  return { url: url ?? DEFAULT_LOGO, custom: !!url }
}
