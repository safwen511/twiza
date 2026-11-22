// Privacy, checked in the browser against a running server (dev or production build):
// real coordinates of unrecorded wells must never appear in an API response or in a map source,
// and the blurred layer must be unreachable outside admin mode.
import { BASE, launch, watch, ok, finish, session, truth, metres } from './lib.mjs'
const hidden = truth().wells.filter(w => !w.recorded)
const near = pts => pts.filter(p => hidden.some(w => metres(p, w) < 25))
function points(v, out = []) {
  if (Array.isArray(v)) { if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] > 8 && v[0] < 9.5 && v[1] > 33 && v[1] < 34.5) out.push({ lon: v[0], lat: v[1] }); else v.forEach(x => points(x, out)) }
  else if (v && typeof v === 'object') { if (typeof v.lon === 'number' && typeof v.lat === 'number') out.push({ lon: v.lon, lat: v.lat }); for (const [k, x] of Object.entries(v)) if (k !== 'grid') points(x, out) }
  return out
}
const b = await launch(); const errs = []
const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); watch(p, errs)
const bodies = []
p.on('response', async r => { if (r.url().includes('/api/') && r.status() === 200) { try { bodies.push([r.url(), await r.json()]) } catch {} } })
await p.goto(`${BASE}/?s=${session()}`, { waitUntil: 'domcontentloaded' })
await p.waitForSelector('[data-testid=map-card]'); await p.mouse.move(700, 450); await p.waitForTimeout(6000)
const api = (path, init) => p.evaluate(async ([path, init]) => { const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', 'x-twiza-session': localStorage.getItem('twiza-session') } }); return { status: r.status, body: await r.json().catch(() => null) } }, [path, init])
// 'patches' and 'hex' are the satellite layers: outlines of real groves and ~0.7 km² hexagons covering the whole oasis.
// They carry no flag per area, and their vertices pass near any point of the oasis, so they are not tested by proximity.
const sourcePoints = () => p.evaluate(() => { const m = window.__twizaMap; const out = []; for (const id of Object.keys(m.getStyle().sources)) { if (id === 'patches' || id === 'hex') continue; const s = m.getSource(id); const d = s && s._data; const fs = (d && (d.features || (d.geojson && d.geojson.features))) || []; const walk = c => { if (typeof c[0] === 'number') out.push({ lon: c[0], lat: c[1], src: id }); else c.forEach(walk) }; fs.forEach(f => f.geometry && walk(f.geometry.coordinates)) } return out })

// ---- default mode ----
ok('default: the layer endpoint is refused', (await api('/api/admin/unrecorded')).status === 403)
ok('default: switching the layer on is refused', (await api('/api/admin/unrecorded-layer', { method: 'POST', body: '{"on":true}' })).status === 400)
await p.locator('[data-testid=layers]').click()
ok('default: no unrecorded toggle in the layer controls', await p.locator('[data-testid=unrecorded-toggle]').count() === 0)
for (const v of ['Satellite', 'Nappe', 'Tours', 'Réseau']) { await p.getByRole('button', { name: v, exact: true }).click(); await p.waitForTimeout(700) }
await p.getByRole('button', { name: 'Satellite', exact: true }).click(); await p.waitForTimeout(1500)
await p.locator('[data-testid=layers]').click()
ok('default (satellite view): still no unrecorded toggle', await p.locator('[data-testid=unrecorded-toggle]').count() === 0)
{ const n = near(await sourcePoints()); ok('default: no real unrecorded coordinate in any map source', n.length === 0, n.slice(0, 4).map(q => `${q.src} ${q.lon},${q.lat}`).join(' ; ')) }
ok('default: blurred source is empty', (await sourcePoints()).filter(x => x.src === 'blurred').length === 0)

// ---- admin mode ----
await p.locator('[data-testid=demo-menu]').click(); await p.locator('[data-testid=demo-admin]').click(); await p.waitForTimeout(2500)
ok('admin: layer is OFF by default', (await api('/api/admin/unrecorded')).status === 403 && await p.locator('[data-testid=admin-banner]').count() === 0)
await p.locator('[data-testid=layers]').click()
await p.locator('[data-testid=unrecorded-toggle]').click(); await p.waitForTimeout(4000)
ok('admin: banner shown while the layer is visible', /positions floutées/.test(await p.locator('[data-testid=admin-banner]').innerText()))
const blurred = (await sourcePoints()).filter(x => x.src === 'blurred')
ok('admin: blurred points are on the map', blurred.length === hidden.length, `${blurred.length} points`)
ok('admin: every blurred point is at least 300 m from every real unrecorded well', blurred.every(q => hidden.every(w => metres(q, w) >= 295)), `closest ${Math.round(Math.min(...blurred.flatMap(q => hidden.map(w => metres(q, w)))))} m`)
ok('admin: no real unrecorded coordinate in any map source', near(await sourcePoints()).length === 0)
const zone = (await api('/api/admin/unrecorded')).body
ok('admin: points carry no volume, name or owner', zone.points.every(q => Object.keys(q).sort().join() === 'id,lat,lon'))
await p.locator('[data-testid=map] canvas').click({ position: { x: 5, y: 5 } }).catch(() => {})
// ---- every API response seen during the whole visit ----
const leaks = bodies.flatMap(([url, body]) => near(points(body)).map(q => `${url} ${q.lon},${q.lat}`))
const names = bodies.filter(([, body]) => hidden.some(w => JSON.stringify(body).includes(`"${w.id}"`) || JSON.stringify(body).includes(`"${w.name}"`))).map(([u]) => u)
ok(`no real unrecorded coordinate in ${bodies.length} API responses`, leaks.length === 0, leaks.slice(0, 3).join(' ; '))
ok('no unrecorded well id or name in any API response', names.length === 0, names.slice(0, 3).join(' ; '))
// ---- leaving admin mode closes the layer ----
await p.locator('[data-testid=demo-menu]').click(); await p.locator('[data-testid=demo-admin]').click(); await p.waitForTimeout(2500)
ok('leaving admin mode removes the layer', (await api('/api/admin/unrecorded')).status === 403 && (await sourcePoints()).filter(x => x.src === 'blurred').length === 0)
await p.screenshot({ path: new URL('./out/privacy-default.png', import.meta.url).pathname })
await finish(b, errs.filter(e => !/status of 40[03]/.test(e))) // the refusals above are expected
