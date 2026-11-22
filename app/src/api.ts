import { useCallback, useEffect, useRef, useState } from 'react'

// Every visitor gets their own demo session: what they report or swap stays theirs.
// ?s=<id> joins an existing session (used to open the farmer app on a phone next to a dashboard).
function sessionId(): string {
  const fromUrl = new URLSearchParams(location.search).get('s')
  const ok = (v: string | null): v is string => !!v && /^[A-Za-z0-9_-]{8,64}$/.test(v)
  try {
    if (ok(fromUrl)) { localStorage.setItem('twiza-session', fromUrl); return fromUrl }
    const saved = localStorage.getItem('twiza-session')
    if (ok(saved)) return saved
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('twiza-session', id)
    return id
  } catch {
    return ok(fromUrl) ? fromUrl : 'public'
  }
}
export const SESSION = sessionId()
const headers = { 'x-twiza-session': SESSION }

export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}
export async function post<T = unknown>(url: string, body: unknown = {}): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? String(r.status))
  return j
}

/** fetch (and optionally poll) an endpoint, with loading / error state and a retry */
export function useApi<T>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const alive = useRef(true)
  const refresh = useCallback(async () => {
    if (!url) return
    try {
      const d = await get<T>(url)
      if (alive.current) { setData(d); setError(false) }
    } catch {
      if (alive.current) setError(true)
    }
  }, [url])
  useEffect(() => {
    alive.current = true
    refresh()
    const id = pollMs ? setInterval(refresh, pollMs) : 0
    return () => { alive.current = false; if (id) clearInterval(id) }
  }, [refresh, pollMs])
  return { data, error, loading: !data && !error, refresh }
}
/** kept for the farmer app */
export function usePoll<T>(url: string | null, ms = 2000) {
  const { data, error, refresh } = useApi<T>(url, ms)
  return { data, offline: error, refresh }
}

export const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** French number format, thin non-breaking spaces between thousands: 18 666 */
export const fmt = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d })
