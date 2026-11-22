// Overview at the two target sizes: layout fits, the map is the hero, no console error.
import { BASE, OUT, launch, watch, ok, finish, session } from './lib.mjs'
const b = await launch(); const errs = []
for (const [w, h] of [[1440, 900], [1280, 800]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); watch(p, errs, `${w}x${h}`)
  await p.goto(`${BASE}/?s=${session()}`, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('[data-testid=kpis]', { timeout: 20000 }); await p.waitForSelector('[data-testid=map-card]'); await p.mouse.move(700, 400); await p.waitForTimeout(6000)
  const m = await p.locator('[data-testid=map-card]').boundingBox()
  const scroll = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1 || document.documentElement.scrollWidth > window.innerWidth + 1)
  ok(`${w}x${h}: overview fits without page scroll`, !scroll)
  ok(`${w}x${h}: map is the hero`, (m.width * m.height) / (w * h) >= 0.45, `${Math.round((m.width * m.height) / (w * h) * 100)} % of the viewport`)
  await p.screenshot({ path: `${OUT}overview-${w}.png` })
  await p.close()
}
await finish(b, errs)
