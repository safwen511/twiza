// Scenario slider: "share of the community's wells that joined TWIZA".
//
// PRIVACY: unrecorded wells never enter this module with their own position.
// They are first summed per H3 hexagon (resolution 8, ~0.7 km²) and then spread
// over the hexagon, so nothing that leaves the server can locate one of them.

import { cellToChildren, cellToLatLng, latLngToCell } from 'h3-js'
import { CONFIG } from './config.js'
import { privatePlan } from './planner.js'
import type { DayPlan, Network } from './types.js'

const M_LAT = 111320
const dist = (a: [number, number], b: [number, number]) => {
  const k = Math.cos((a[1] * Math.PI) / 180)
  return Math.hypot((a[0] - b[0]) * M_LAT * k, (a[1] - b[1]) * M_LAT)
}

export interface ScenarioRow {
  share: number
  joined: number
  total: number
  collective: number
  private: number
  pct: number
  /** minute of the day when cumulative pumping crosses the safe limit, or null */
  crossMin: number | null
}

export function buildScenario(net: Network, today: DayPlan, et0: number, site: { lat: number; lon: number }, showAll = false) {
  const wells = [...net.wells].sort((a, b) => a.joinRank - b.joinRank)
  const gda = wells.filter(w => w.type === 'gda')
  const priv = wells.filter(w => w.type === 'private')
  const plotOf = new Map(net.plots.filter(p => p.wellId).map(p => [p.wellId!, p]))
  const gdaFlow = gda.reduce((s, w) => s + w.flowLs, 0)
  const limit = CONFIG.safeDailyLimit

  /** m3/day pumped by each well when the first `n` wells (join order) are in TWIZA */
  const pumping = (n: number) => {
    const joined = new Set(wells.slice(0, n).map(w => w.id))
    const gdaJoined = gda.filter(w => joined.has(w.id)).length
    const factor = 1 + (CONFIG.traditionalCollectiveFactor - 1) * (1 - gdaJoined / Math.max(1, gda.length))
    const q = new Map<string, number>()
    for (const w of gda) q.set(w.id, (today.pumped * factor * w.flowLs) / gdaFlow)
    for (const w of priv) {
      const p = plotOf.get(w.id)
      const plan = p ? privatePlan(p, w, et0) : { need: 0, traditional: w.flowLs * 3.6 * CONFIG.traditionalPrivateHours }
      q.set(w.id, joined.has(w.id) ? Math.min(plan.need, plan.traditional) : plan.traditional)
    }
    return { q, factor }
  }

  // stress grid: regular points every 100 m within 1.7 km of the community
  const k = Math.cos((site.lat * Math.PI) / 180)
  const points: [number, number][] = []
  for (let y = -1700; y <= 1700; y += 100)
    for (let x = -1700; x <= 1700; x += 100)
      if (Math.hypot(x, y) <= 1700) points.push([+(site.lon + x / (M_LAT * k)).toFixed(5), +(site.lat + y / M_LAT).toFixed(5)])

  // unrecorded wells -> hexagon -> its 7 children centres
  const hexOf = (w: { lat: number; lon: number }) => latLngToCell(w.lat, w.lon, 8)
  const spread = (cell: string): [number, number][] => cellToChildren(cell, 9).map(c => { const [lat, lon] = cellToLatLng(c); return [lon, lat] })

  const sourcesFor = (q: Map<string, number>) => {
    const src: { at: [number, number]; q: number }[] = []
    const hex = new Map<string, number>()
    for (const w of wells) {
      if (w.recorded) src.push({ at: [w.lon, w.lat], q: q.get(w.id)! })
      else hex.set(hexOf(w), (hex.get(hexOf(w)) ?? 0) + q.get(w.id)!)
    }
    for (const [cell, v] of hex) for (const at of spread(cell)) src.push({ at, q: v / 7 })
    return src
  }
  const R = 2500
  const R0 = 140
  const drawdown = (src: { at: [number, number]; q: number }[]) =>
    points.map(p => src.reduce((s, w) => { const d = dist(p, w.at); return d >= R ? s : s + w.q * Math.log(R / Math.max(d, R0)) }, 0))

  // salinity field: inverse-distance mean of well EC (unrecorded wells: hexagon mean)
  const ecSrc: { at: [number, number]; ec: number }[] = wells.filter(w => w.recorded).map(w => ({ at: [w.lon, w.lat], ec: w.ecDs }))
  const ecHex = new Map<string, number[]>()
  for (const w of wells) if (!w.recorded) ecHex.set(hexOf(w), [...(ecHex.get(hexOf(w)) ?? []), w.ecDs])
  for (const [cell, v] of ecHex) { const [lat, lon] = cellToLatLng(cell); ecSrc.push({ at: [lon, lat], ec: v.reduce((a, b) => a + b, 0) / v.length }) }
  const sal = points.map(p => {
    let a = 0
    let b = 0
    for (const s of ecSrc) { const wgt = 1 / Math.max(dist(p, s.at), 150) ** 2; a += wgt * s.ec; b += wgt }
    return +Math.min(1, Math.max(0, (a / b - 3) / 3.5)).toFixed(3)
  })

  const shares = Array.from({ length: 21 }, (_, i) => i * 5)
  const rows: ScenarioRow[] = []
  const dd: number[][] = []
  const recQ = new Map<string, number[]>(wells.filter(w => w.recorded || showAll).map(w => [w.id, []]))
  const unrec = { count: wells.filter(w => !w.recorded).length, joined: [] as number[], q: [] as number[] }
  let ref = 1
  for (const share of shares) {
    const n = Math.round((share / 100) * wells.length)
    const { q, factor } = pumping(n)
    const collective = gda.reduce((s, w) => s + q.get(w.id)!, 0)
    const privateQ = priv.reduce((s, w) => s + q.get(w.id)!, 0)
    const total = collective + privateQ
    // cumulative curve: collective follows the planned pumping, private wells run 06:00-18:00
    let crossMin: number | null = null
    for (let i = 0; i < today.pumpedCum.length; i++) {
      const t = i * CONFIG.stepMin
      const cum = today.pumpedCum[i] * factor + privateQ * Math.min(1, Math.max(0, (t - 360) / 720))
      if (cum >= limit) { crossMin = t; break }
    }
    rows.push({ share, joined: n, total: Math.round(total), collective: Math.round(collective), private: Math.round(privateQ), pct: +((total / limit) * 100).toFixed(1), crossMin })
    for (const [id, arr] of recQ) arr.push(Math.round(q.get(id)!))
    unrec.joined.push(wells.slice(0, n).filter(w => !w.recorded).length)
    unrec.q.push(Math.round(wells.filter(w => !w.recorded).reduce((a, w) => a + q.get(w.id)!, 0)))
    const raw = drawdown(sourcesFor(q))
    if (share === 0) ref = Math.max(...raw)
    dd.push(raw.map(v => +Math.min(1, v / ref).toFixed(3)))
  }
  // recorded wells: their own numbers. Unrecorded wells: one anonymous total, no position, no identity.
  const recorded = wells.filter(w => w.recorded || showAll).map(w => ({ id: w.id, recorded: w.recorded, joinShare: Math.ceil((w.joinRank / wells.length) * 20) * 5, q: recQ.get(w.id)! }))
  return { limit, wells: wells.length, shares, rows, recorded, unrecorded: unrec, grid: { points, dd, sal } }
}
