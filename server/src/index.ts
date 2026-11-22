import 'dotenv/config'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import { config as loadEnv } from 'dotenv'
import express from 'express'

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

const state = await import('./state.js')
const { chat, llmEnabled, llmModel, polishAdvice } = await import('./assistant.js')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1) // behind Caddy / a reverse proxy
app.use(compression())
app.use(express.json({ limit: '1mb' }))

// ---- security headers (the app is same-origin; map tiles and fonts are the only third parties) ----
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://tiles.maps.eox.at; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self' data: blob: https://tile.openstreetmap.org https://tiles.maps.eox.at; font-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  )
  next()
})

// ---- small in-memory rate limiter (per IP) ----
const hits = new Map<string, { n: number; t: number }>()
const limit = (name: string, max: number, windowMs: number) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const key = `${name}:${req.ip}`
  const now = Date.now()
  const h = hits.get(key)
  if (!h || now - h.t > windowMs) hits.set(key, { n: 1, t: now })
  else if (++h.n > max) return void res.status(429).json({ error: 'too many requests' })
  next()
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 3600_000) hits.delete(k) }, 600_000).unref()

// ---- every visitor has their own demo session (header set by the app) ----
app.use('/api', limit('api', 600, 60_000), (req, _res, next) => state.withSession(req.get('x-twiza-session'), next))

const guard = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try {
    const out = await fn(req, res)
    if (!res.headersSent) res.json(out ?? { ok: true })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
const cache = (seconds: number) => (_req: express.Request, res: express.Response, next: express.NextFunction) => { res.setHeader('Cache-Control', `private, max-age=${seconds}`); next() }
const FARMER = /^f\d{2}$/
const farmerId = (v: unknown) => { if (typeof v !== 'string' || !FARMER.test(v)) throw new Error('unknown farmer'); return v }

app.get('/api/health', (_req, res) => res.json({ ok: true, sessions: state.sessionCount(), assistant: llmEnabled() ? 'claude' : 'templates' }))

// ---- community dashboard: only public-safe data ----
app.get('/api/network', cache(300), guard(() => state.publicNetwork()))
app.get('/api/live', guard(() => ({ ...state.liveState(), llm: llmEnabled() })))
app.get('/api/scenario', cache(300), guard(() => state.scenario()))
app.get('/api/trends', cache(300), guard(() => state.trends()))

// ---- Admin / CRDA demo mode: blurred positions only, never the real ones ----
app.post('/api/admin/mode', guard(req => state.setAdmin(!!req.body?.on)))
app.post('/api/admin/unrecorded-layer', guard(req => state.setUnrecordedLayer(!!req.body?.on)))
app.get('/api/admin/unrecorded', (_req, res) => {
  const zone = state.unrecordedZone()
  if (!zone) return void res.status(403).json({ error: 'admin mode and layer required' })
  res.json(zone)
})

// ---- farmer app ----
app.get('/api/farmer/:id', guard(req => {
  const v = state.farmerView(farmerId(req.params.id))
  if (!v) throw new Error('unknown farmer')
  void polishAdvice(v.advice) // rephrased in the background when a Claude key is set
  return v
}))
const REPORTS = new Set(['seguia_broken', 'well_dry', 'no_water', 'leak'])
app.post('/api/reports', limit('write', 30, 60_000), guard(req => {
  if (!REPORTS.has(req.body?.type)) throw new Error('unknown report type')
  const photo = typeof req.body.photo === 'string' && req.body.photo.startsWith('data:image/') ? req.body.photo.slice(0, 400_000) : undefined
  return state.report(farmerId(req.body.farmerId), req.body.type, photo)
}))
app.post('/api/swaps', limit('write', 30, 60_000), guard(req => state.requestSwap(farmerId(req.body?.from), farmerId(req.body?.to))))
app.post('/api/swaps/:id', limit('write', 30, 60_000), guard(req => state.answerSwap(String(req.params.id), !!req.body?.accept)))
app.post('/api/regularization', limit('write', 60, 60_000), guard(req => state.startRegularization(farmerId(req.body?.farmerId), String(req.body?.step ?? '').slice(0, 20), !!req.body?.on)))

// ---- assistant: Claude when ANTHROPIC_API_KEY is set, templated answers otherwise ----
app.get('/api/assistant/status', (_req, res) => res.json({ mode: llmEnabled() ? 'claude' : 'templates', model: llmEnabled() ? llmModel() : null }))
app.post('/api/assistant', limit('assistant', Number(process.env.ASSISTANT_PER_MINUTE || 12), 60_000), limit('assistant-day', Number(process.env.ASSISTANT_PER_DAY || 200), 86_400_000), guard(req => {
  const message = String(req.body?.message ?? '').slice(0, 1000)
  if (!message.trim()) throw new Error('empty message')
  const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-8)
    .filter((h: any) => (h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string')
    .map((h: any) => ({ role: h.role, content: h.content.slice(0, 2000) }))
  return chat(message, history)
}))

// ---- demo controls: stand in for the forecast feed and the sensors (act on the visitor's session only) ----
const DEMO = new Set(['reset', 'heatwave', 'rain', 'ec', 'welldry', 'wellfix', 'repair'])
app.post('/api/demo/:action', limit('write', 60, 60_000), guard(req => {
  const a = String(req.params.action)
  if (a === 'clock') state.setClock({ speed: [1, 60, 600].includes(Number(req.body?.speed)) ? Number(req.body.speed) : 1 })
  else if (DEMO.has(a)) state.demo(a)
  else throw new Error('unknown action')
}))
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

// ---- production: serve the built app from the same port ----
const dist = fileURLToPath(new URL('../../app/dist', import.meta.url))
if (existsSync(dist)) {
  app.use('/assets', express.static(`${dist}/assets`, { immutable: true, maxAge: '365d' }))
  app.use('/data', express.static(`${dist}/data`, { maxAge: '1d' }))
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  const ROUTES = /^\/(|tours|capteurs|assistant|a-propos|farmer)\/?$/
  app.get(/.*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.status(ROUTES.test(req.path) ? 200 : 404).sendFile(`${dist}/index.html`)
  })
}

// ---- every night all visitor sessions go back to the seed ----
let lastReset = new Date().toDateString()
setInterval(() => {
  const d = new Date()
  if (d.getHours() === 3 && d.toDateString() !== lastReset) { lastReset = d.toDateString(); state.resetAll(); console.log('[twiza] nightly reset') }
}, 60_000).unref()

const port = Number(process.env.PORT || 8787)
app.listen(port, () => console.log(`[twiza] API on http://localhost:${port} — assistant: ${llmEnabled() ? `Claude (${llmModel()})` : 'templates (no ANTHROPIC_API_KEY)'}`))
