// Visit every route and click every interactive element. Fails on a console error, an unhandled
// rejection, or a "dead click" (a control that changes nothing: no DOM change, no request, no navigation).
import { BASE, launch, watch, ok, finish, session } from './lib.mjs'
const ROUTES = ['/', '/tours', '/capteurs', '/assistant', '/a-propos', '/nope', '/farmer?f=f01', '/farmer?f=f36&tab=more']
const SEL = 'button:not([disabled]), a[href], [role=tab], summary, select, input[type=checkbox], input[type=range]'
const b = await launch(); const errs = []; let clicks = 0; const dead = []
for (const route of ROUTES) {
  const farmer = route.startsWith('/farmer')
  const ctx = await b.newContext({ viewport: farmer ? { width: 360, height: 800 } : { width: 1440, height: 900 } })
  const p = await ctx.newPage(); watch(p, errs, route)
  let requests = 0
  p.on('request', r => { if (!r.url().includes('/api/live') && !r.url().includes('/api/farmer/')) requests++ })
  const url = `${BASE}${route}${route.includes('?') ? '&' : '?'}s=${session()}`
  const open = async () => { await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(farmer ? 700 : 1300); await p.mouse.move(700, 450) }
  await open()
  const n = await p.locator(SEL).count()
  for (let i = 0; i < n; i++) {
    const el = p.locator(SEL).nth(i)
    if (!(await el.count()) || !(await el.isVisible().catch(() => false))) continue
    const info = await el.evaluate(e => ({ tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || e.getAttribute('data-testid') || '').trim().slice(0, 40), on: e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-current') === 'page', href: e.getAttribute('href') || '', target: e.getAttribute('target') }))
    if (info.target === '_blank' || info.href.startsWith('http')) continue // external or new tab
    const before = await p.evaluate(() => document.body.innerHTML.length + '|' + location.href + '|' + document.activeElement?.tagName)
    const req0 = requests
    try {
      if (info.tag === 'SELECT') { const opts = await el.locator('option').count(); await el.selectOption({ index: Math.min(1, opts - 1) }) }
      else if (await el.evaluate(e => e.type === 'range')) await el.fill(String(Number(await el.getAttribute('max')) - 5 * 2))
      else await el.click({ timeout: 3000 })
    } catch { continue } // covered by an overlay it opened itself, or gone: not a dead control
    clicks++
    await p.waitForTimeout(250)
    const after = await p.evaluate(() => document.body.innerHTML.length + '|' + location.href + '|' + document.activeElement?.tagName)
    if (before === after && requests === req0 && !info.on) dead.push(`${route} → "${info.label}"`)
    await open() // fresh state for the next control
  }
  await ctx.close()
}
ok(`clicked ${clicks} controls on ${ROUTES.length} routes`, clicks > 60)
ok('no dead click', dead.length === 0, dead.join(' ; '))
await finish(b, errs)
