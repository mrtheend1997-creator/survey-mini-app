import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tg } from './telegram'

/** Load data from the API with loading / error state and a reload function. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return loaderRef
      .current()
      .then((d) => {
        setData(d)
        return d
      })
      .catch((e) => {
        setError(e)
        return null
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, setData, error, loading, reload }
}

/** Show Telegram's native back button while the component is mounted. */
export function useTelegramBack(to?: string | number) {
  const navigate = useNavigate()
  useEffect(() => {
    const app = tg
    if (!app) return
    const handler = () => (typeof to === 'string' ? navigate(to) : navigate(-1))
    app.BackButton.show()
    app.BackButton.onClick(handler)
    return () => {
      app.BackButton.offClick(handler)
      app.BackButton.hide()
    }
  }, [navigate, to])
}
