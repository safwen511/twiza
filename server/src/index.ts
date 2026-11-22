import 'dotenv/config'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import express from 'express'

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

const { answerSwap, demo, farmerView, liveState, publicNetwork, report, requestSwap, scenario, setClock, setShowUnrecorded, startRegularization, trends } = await import('./state.js')
const { chat, llmEnabled, polishAdvice } = await import('./assistant.js')

const app = express()
app.use(express.json({ limit: '3mb' }))

const guard = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try {
    const out = await fn(req, res)
    if (!res.headersSent) res.json(out ?? { ok: true })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
  }
}

// ---- community dashboard (only public-safe data) ----
app.get('/api/network', guard(() => publicNetwork()))
app.get('/api/live', guard(() => ({ ...liveState(), llm: llmEnabled() })))
app.get('/api/scenario', guard(() => scenario()))
app.get('/api/trends', guard(() => trends()))

// ---- farmer app ----
app.get('/api/farmer/:id', guard(req => {
  const v = farmerView(String(req.params.id))
  if (!v) throw new Error('unknown farmer')
  void polishAdvice(v.advice) // rephrase in the background when a key is set
  return v
}))
app.post('/api/reports', guard(req => report(req.body.farmerId, req.body.type, typeof req.body.photo === 'string' ? req.body.photo.slice(0, 400000) : undefined)))
app.post('/api/swaps', guard(req => requestSwap(req.body.from, req.body.to)))
app.post('/api/swaps/:id', guard(req => answerSwap(String(req.params.id), !!req.body.accept)))
app.post('/api/regularization', guard(req => startRegularization(req.body.farmerId, req.body.step, !!req.body.on)))

// ---- assistant (Claude API proxy; templated answers without a key) ----
app.post('/api/assistant', guard(req => chat(String(req.body.message ?? ''), Array.isArray(req.body.history) ? req.body.history : [])))

// ---- demo controls: stand in for the forecast feed and the sensors ----
app.post('/api/demo/:action', guard(req => {
  if (req.params.action === 'clock') setClock(req.body ?? {})
  else if (req.params.action === 'unrecorded') setShowUnrecorded(!!req.body?.on) // the community's choice: show unrecorded wells on the map
  else demo(String(req.params.action))
}))

// production: serve the built app from the same port
const dist = fileURLToPath(new URL('../../app/dist', import.meta.url))
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dist}/index.html`))
}

const port = Number(process.env.PORT || 8787)
app.listen(port, () => console.log(`[twiza] API on http://localhost:${port} — assistant: ${llmEnabled() ? 'Claude API' : 'templates (no ANTHROPIC_API_KEY)'}`))
