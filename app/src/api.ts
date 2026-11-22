import { useCallback, useEffect, useRef, useState } from 'react'

export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}
export async function post<T = unknown>(url: string, body: unknown = {}): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${r.status}`)
  return j
}

/** poll an endpoint; `refresh()` fetches right away (after an action) */
export function usePoll<T>(url: string | null, ms = 2000) {
  const [data, setData] = useState<T | null>(null)
  const [offline, setOffline] = useState(false)
  const alive = useRef(true)
  const refresh = useCallback(async () => {
    if (!url) return
    try {
      const d = await get<T>(url)
      if (alive.current) { setData(d); setOffline(false) }
    } catch {
      if (alive.current) setOffline(true)
    }
  }, [url])
  useEffect(() => {
    alive.current = true
    refresh()
    const id = setInterval(refresh, ms)
    return () => { alive.current = false; clearInterval(id) }
  }, [refresh, ms])
  return { data, offline, refresh }
}

export const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const fmt = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/ /g, ' ')
