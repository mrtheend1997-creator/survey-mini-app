// localStorage that never throws. Browsers refuse storage in some embedded windows (Telegram Web
// in a browser that blocks third-party site data, some desktop web views): reading it then
// throws and, unguarded, leaves a blank screen. Values are kept in memory instead.

const memory = new Map<string, string>()

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function getItem(key: string): string | null {
  try {
    return store()?.getItem(key) ?? memory.get(key) ?? null
  } catch {
    return memory.get(key) ?? null
  }
}

export function setItem(key: string, value: string | null): void {
  if (value === null) memory.delete(key)
  else memory.set(key, value)
  try {
    if (value === null) store()?.removeItem(key)
    else store()?.setItem(key, value)
  } catch {
    /* kept in memory only */
  }
}
