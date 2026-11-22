import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { farmerView, liveState, publicNetwork, scenario, setShowUnrecorded, tools, trends } from '../src/state.js'
import { templated } from '../src/assistant.js'
import type { Network } from '../src/types.js'

const net: Network = JSON.parse(readFileSync(new URL('../../data/network.json', import.meta.url), 'utf8'))
const hidden = net.wells.filter(w => !w.recorded)
const hiddenPlots = net.plots.filter(p => p.wellId && hidden.some(w => w.id === p.wellId))
const needles = [
  ...hidden.flatMap(w => [String(w.lon), String(w.lat), `"${w.id}"`, `"${w.name}"`, `${w.name} `]),
  ...hiddenPlots.flatMap(p => [`"id":"${p.id}"`, `"plotId":"${p.id}"`, `:${p.id}"`, String(p.centroid[0]) + ',' + String(p.centroid[1]), JSON.stringify(p.polygon[0])]),
]
const leaks = (payload: unknown) => {
  const s = JSON.stringify(payload)
  return needles.filter(n => s.includes(n))
}

// these tests cover the strict mode; the demo runs in committee view (unrecorded wells shown)
setShowUnrecorded(false)

describe('privacy (strict mode): an unrecorded well is never exposed', () => {
  it('the synthetic data does contain unrecorded wells', () => {
    expect(hidden.length).toBeGreaterThan(5)
    expect(hiddenPlots.length).toBe(hidden.length)
  })
  it('community endpoints (network, live, scenario, trends) carry no trace of them', () => {
    expect(leaks(publicNetwork())).toEqual([])
    expect(leaks(liveState())).toEqual([])
    expect(leaks(scenario())).toEqual([])
    expect(leaks(trends())).toEqual([])
    expect(publicNetwork().wells).toHaveLength(net.wells.length - hidden.length)
  })
  it('the stress grid is not sharper than the hexagon aggregate', () => {
    // no grid value may peak on an unrecorded well: the hottest point is at least 150 m away from each of them
    const sc = scenario()
    const dd = sc.grid.dd[0]
    const top = sc.grid.points[dd.indexOf(Math.max(...dd))]
    for (const w of hidden) {
      const d = Math.hypot((top[0] - w.lon) * 111320 * Math.cos((w.lat * Math.PI) / 180), (top[1] - w.lat) * 111320)
      expect(d).toBeGreaterThan(150)
    }
  })
  it('the assistant tools and templates only know an aggregate', () => {
    for (const t of [tools.wells(), tools.kpis(), tools.alerts(), tools.schedule(), tools.weeklyDeficits(), tools.replanLog()]) expect(leaks(t)).toEqual([])
    for (const q of ['wells and salinity?', 'Où sont les puits non déclarés ?', 'Chkoun 3andou bir mouch msajjel?']) expect(leaks(templated(q))).toEqual([])
  })
  it('even its owner gets the sensor values without any location', () => {
    const v = farmerView(hidden[0].ownerId!)!
    expect(v.myWell).not.toBeNull()
    expect(leaks({ ...v, myWell: { ...v.myWell, name: '' } }).filter(n => /\d\.\d{4,}/.test(n))).toEqual([])
    // and another farmer sees nothing of it
    expect(leaks(farmerView('f01'))).toEqual([])
  })
  it('the public registry and the satellite outputs do not flag anyone', () => {
    const csv = readFileSync(new URL('../../data/wells_registry.csv', import.meta.url), 'utf8')
    for (const w of hidden) expect(csv).not.toContain(`${w.id},`)
    const patches = readFileSync(new URL('../../app/public/data/sat_patches.geojson', import.meta.url), 'utf8')
    expect(patches).not.toMatch(/unrecorded|recorded|well/i)
  })
})
