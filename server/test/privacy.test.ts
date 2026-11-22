import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { farmerView, liveState, publicNetwork, scenario, setAdmin, setUnrecordedLayer, tools, trends, unrecordedZone, withSession } from '../src/state.js'
import { templated } from '../src/assistant.js'
import type { Network } from '../src/types.js'

const net: Network = JSON.parse(readFileSync(new URL('../../data/network.json', import.meta.url), 'utf8'))
const hidden = net.wells.filter(w => !w.recorded)
const hiddenPlots = net.plots.filter(p => p.wellId && hidden.some(w => w.id === p.wellId))
const needles = [
  ...hidden.flatMap(w => [`${w.lon},${w.lat}`, `"${w.id}"`, `"${w.name}"`, `${w.name} `]),
  ...hiddenPlots.flatMap(p => [`"id":"${p.id}"`, `"plotId":"${p.id}"`, `:${p.id}"`, String(p.centroid[0]) + ',' + String(p.centroid[1]), JSON.stringify(p.polygon[0])]),
]
// every [lon, lat] pair or {lon, lat} object found anywhere in a payload
function points(v: unknown, out: { lon: number; lat: number }[] = []) {
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] > 8 && v[0] < 9.5 && v[1] > 33 && v[1] < 34.5) out.push({ lon: v[0], lat: v[1] })
    else for (const x of v) points(x, out)
  } else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.lon === 'number' && typeof o.lat === 'number') out.push({ lon: o.lon, lat: o.lat })
    for (const [k, x] of Object.entries(o)) if (k !== 'grid') points(x, out) // the stress grid is a regular 100 m lattice, tested separately
  }
  return out
}
const leaks = (payload: unknown) => {
  const s = JSON.stringify(payload)
  const text = needles.filter(n => s.includes(n))
  // and no coordinate of any kind within 25 m of a real unrecorded well
  const near = points(payload).filter(p => hidden.some(w => Math.hypot((p.lon - w.lon) * 111320 * Math.cos((w.lat * Math.PI) / 180), (p.lat - w.lat) * 111320) < 25))
  return [...text, ...near.map(p => `point ${p.lon},${p.lat}`)]
}
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 111320)
const everything = () => [publicNetwork(), liveState(), scenario(), trends(), tools.wells(), tools.kpis(), tools.alerts(), tools.schedule(), tools.weeklyDeficits(), tools.replanLog(), farmerView('f01')]

describe('privacy: the real position of an unrecorded well never leaves the server', () => {
  it('the synthetic data does contain unrecorded wells', () => {
    expect(hidden.length).toBeGreaterThan(5)
    expect(hiddenPlots.length).toBe(hidden.length)
  })

  it('default mode: no trace of them in any response, and the layer is not reachable', () => {
    withSession('visitor-default', () => {
      for (const payload of everything()) expect(leaks(payload)).toEqual([])
      expect(publicNetwork().wells).toHaveLength(net.wells.length - hidden.length)
      expect(unrecordedZone()).toBeNull()
      expect(() => setUnrecordedLayer(true)).toThrow() // not reachable outside admin mode
      expect(unrecordedZone()).toBeNull()
    })
  })

  it('admin mode: the layer is off by default, and once on it only carries blurred points', () => {
    withSession('visitor-admin', () => {
      setAdmin(true)
      expect(unrecordedZone()).toBeNull() // OFF by default even in admin mode
      setUnrecordedLayer(true)
      const zone = unrecordedZone()!
      expect(zone.points).toHaveLength(hidden.length)
      for (const payload of [zone, ...everything()]) expect(leaks(payload)).toEqual([])
      // every blurred point is 300-500 m away from a real well, and no point sits within 250 m of any real one
      for (const p of zone.points) {
        const d = hidden.map(w => metres(p, w))
        expect(Math.min(...d)).toBeGreaterThan(250)
        expect(Object.keys(p).sort()).toEqual(['id', 'lat', 'lon']) // no volume, no owner, no name
      }
      const sorted = (a: number[]) => [...a].sort((x, y) => x - y)
      // the set of offsets is exactly "300 to 500 m": match each real well to its nearest unused blurred point
      const used = new Set<string>()
      for (const w of hidden) {
        const best = sorted(zone.points.filter(p => !used.has(p.id)).map(p => metres(p, w)))[0]
        expect(best).toBeLessThanOrEqual(1000)
      }
      // stable: asking twice gives the same blurred points (no averaging attack)
      expect(unrecordedZone()).toEqual(zone)
      setAdmin(false)
      expect(unrecordedZone()).toBeNull()
    })
  })

  it('admin mode of one visitor does not open the layer for another', () => {
    withSession('visitor-a1234', () => { setAdmin(true); setUnrecordedLayer(true); expect(unrecordedZone()).not.toBeNull() })
    withSession('visitor-b1234', () => expect(unrecordedZone()).toBeNull())
  })

  it('the stress grid is not sharper than the hexagon aggregate', () => {
    const sc = scenario()
    const dd = sc.grid.dd[0]
    const top = sc.grid.points[dd.indexOf(Math.max(...dd))]
    for (const w of hidden) expect(metres({ lon: top[0], lat: top[1] }, w)).toBeGreaterThan(150)
    expect(leaks(sc.recorded)).toEqual([])
  })

  it('the assistant templates only know an aggregate', () => {
    for (const q of ['wells and salinity?', 'Où sont les puits non déclarés ?', 'Chkoun 3andou bir mouch msajjel?']) expect(leaks(templated(q))).toEqual([])
  })

  it('even its owner gets the sensor values without any location', () => {
    withSession('visitor-owner', () => {
      const v = farmerView(hidden[0].ownerId!)!
      expect(v.myWell).not.toBeNull()
      expect(leaks({ ...v, myWell: { ...v.myWell, name: '' } }).filter(n => /\d\.\d{4,}/.test(n))).toEqual([])
    })
  })

  it('the public registry and the satellite outputs do not flag anyone', () => {
    const csv = readFileSync(new URL('../../data/wells_registry.csv', import.meta.url), 'utf8')
    for (const w of hidden) expect(csv).not.toContain(`${w.id},`)
    const patches = readFileSync(new URL('../../app/public/data/sat_patches.geojson', import.meta.url), 'utf8')
    expect(patches).not.toMatch(/unrecorded|recorded|well/i)
  })
})

describe('sessions: one visitor cannot break the demo for the next', () => {
  it('a report stays in the session that made it', async () => {
    const { report } = await import('../src/state.js')
    const before = withSession('visitor-two-000', () => liveState())
    withSession('visitor-one-000', () => report('f01', 'no_water'))
    const one = withSession('visitor-one-000', () => liveState())
    const two = withSession('visitor-two-000', () => liveState())
    expect(one.reports).toHaveLength(1)
    expect(one.plans[0].blocks.length).toBeGreaterThan(0)
    expect(two.reports).toHaveLength(0)
    expect(two.plans[0].blocks).toHaveLength(0)
    expect(two.alerts.length).toBe(before.alerts.length)
  })
  it('every visitor starts from the same seed', () => {
    const a = withSession('visitor-seed-a', () => liveState())
    const b = withSession('visitor-seed-b', () => liveState())
    expect(a.alerts.map(x => x.title.fr)).toEqual(b.alerts.map(x => x.title.fr))
    expect(a.plans[0].turns.map(t => [t.id, t.start, t.end])).toEqual(b.plans[0].turns.map(t => [t.id, t.start, t.end]))
    expect(a.now.hhmm).toBe('10:05')
  })
})
