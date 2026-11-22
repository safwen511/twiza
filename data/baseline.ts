// TWIZA — baseline and sensitivity analysis (offline, deterministic).
//   npx tsx data/baseline.ts
// 1. Sensitivity of the pumping saving to the assumptions about today's practice.
// 2. The same week (power cut included) under a traditional fixed nouba vs under TWIZA.
// Everything here is a model of a synthetic community: see README, "Hypothèses".

import { readFileSync } from 'node:fs'
import { CONFIG } from '../server/src/config.js'
import { absMin, addDays, conveyance, dailyNeed, planDay, privatePlan, slotsFor } from '../server/src/planner.js'
import type { Network, PlanEvent } from '../server/src/types.js'

const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const raw = load('./network.json')
const network: Network = raw
const weather: Record<string, number> = Object.fromEntries(load('./weather.json').days.map((d: any) => [d.date, d.et0]))
const events: PlanEvent[] = load('./history.json').events
const D = CONFIG.demoDate
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

// ---------------- 1. sensitivity ----------------
const ref = planDay(D, { network, weather, events: [] })
const wells = [...network.wells].sort((a, b) => a.joinRank - b.joinRank)
const priv = wells.filter(w => w.type === 'private')
const plotOf = new Map(network.plots.filter(p => p.wellId).map(p => [p.wellId!, p]))
function total(share: number, factor: number, hours: number) {
  const n = Math.round(share * wells.length)
  const joined = new Set(wells.slice(0, n).map(w => w.id))
  const gda = wells.filter(w => w.type === 'gda')
  const f = 1 + (factor - 1) * (1 - gda.filter(w => joined.has(w.id)).length / gda.length)
  let t = ref.pumped * f
  for (const w of priv) {
    const need = privatePlan(plotOf.get(w.id)!, w, weather[D]).need
    const trad = w.flowLs * 3.6 * hours
    t += joined.has(w.id) ? Math.min(need, trad) : trad
  }
  return t
}
console.log('1. SENSITIVITY — community pumping (m3/day), saving at 70 % and 100 % adoption')
console.log('   collective factor | private hours | baseline | % of limit | at 70 % | saving | at 100 % | saving')
for (const [factor, hours] of [[1.3, 12], [1.3, 8], [1.15, 12], [1.15, 8], [1.0, 8], [1.0, 6]] as const) {
  const b = total(0, factor, hours), s70 = total(0.7, factor, hours), s100 = total(1, factor, hours)
  console.log(`   ${factor.toFixed(2)}x need        | ${String(hours).padStart(2)} h/day      | ${fmt(b).padStart(7)}  | ${Math.round((b / CONFIG.safeDailyLimit) * 100)} %      | ${fmt(s70)}  | -${Math.round((1 - s70 / b) * 100)} %  | ${fmt(s100)}   | -${Math.round((1 - s100 / b) * 100)} %`)
}

// ---------------- 2. traditional nouba vs TWIZA, same 7 days ----------------
const meanEt0 = Object.values(weather).reduce((a, b) => a + b, 0) / Object.values(weather).length
const gdaWells = network.wells.filter(w => w.type === 'gda')
const baseEc = gdaWells.reduce((s, w) => s + w.flowLs * w.ecDs, 0) / gdaWells.reduce((s, w) => s + w.flowLs, 0)
const seguiaById = new Map(network.seguias.map(s => [s.id, s]))
const dt = CONFIG.stepMin
const sorted = [...events].sort((a, b) => absMin(a.date, a.minute) - absMin(b.date, b.minute))

interface Row { need: number; got: number }
const acc = (m: Map<string, Row>, id: string, need: number, got: number) => { const r = m.get(id) ?? { need: 0, got: 0 }; r.need += need; r.got += Math.min(got, need); m.set(id, r) }
const trad = new Map<string, Row>()
const twiza = new Map<string, Row>()
let tradPumped = 0, twizaPumped = 0, tradReleased = 0, twizaReleased = 0

for (let i = -6; i <= 0; i++) {
  const date = addDays(D, i)
  const cut = i === 0 ? CONFIG.demoMinute : 1440 // same cut-off as the dashboard: turns finished by now
  // --- TWIZA (the planner, with the incidents) ---
  const plan = planDay(date, { network, weather, events })
  const need = new Map(planDay(date, { network, weather, events: [] }).turns.map(t => [t.plotId, t.needPalm + t.needUnder]))
  for (const t of plan.turns) if (t.start >= 0 && t.end <= cut) { acc(twiza, t.farmerId, need.get(t.plotId)!, t.delivered); twizaReleased += t.released }
  twizaPumped += plan.pumpedCum[Math.min(288, Math.floor(cut / dt))]

  // --- traditional fixed nouba: fixed clock slots sized once for the season (1.3 x need at the summer-mean ET0),
  //     no cap, no re-planning: a slot without water is lost ---
  const d0 = absMin(date, 0)
  const flow = new Map(gdaWells.map(w => [w.id, w.flowLs]))
  const extra = new Map<string, number>()
  let ei = 0
  const apply = (until: number) => { while (ei < sorted.length && absMin(sorted[ei].date, sorted[ei].minute) <= until) { const e = sorted[ei++]; if (e.type === 'well_flow' && e.wellId && flow.has(e.wellId)) flow.set(e.wellId, e.flowLs ?? 0); if (e.type === 'leak' && e.seguiaId) extra.set(e.seguiaId, e.extraLoss ?? 0) } }
  apply(d0)
  const blocks = events.filter(e => e.type === 'block').map(e => ({ sid: e.seguiaId!, from: absMin(e.date, e.minute) - d0, to: absMin(e.date, e.minute) - d0 + (e.durationMin ?? 0) }))
  const level = new Map(network.jebias.map(j => [j.id, j.capacityM3 * CONFIG.jebiaStartShare]))
  const slots = slotsFor(network, date, []).map(s => {
    const sg = seguiaById.get(s.seguiaId)!
    const n = dailyNeed(s.plot, meanEt0, baseEc)
    const right = (CONFIG.traditionalCollectiveFactor * CONFIG.rotationDays * (n.palm + n.under)) / (1 - conveyance(s.plot, sg).loss)
    return { ...s, sg, dur: Math.ceil(right / sg.capacityM3h * 60 / dt) * dt, start: 0, released: 0, delivered: 0 }
  })
  for (const sg of network.seguias) { let t = CONFIG.dayStartMin; for (const s of slots.filter(x => x.seguiaId === sg.id)) { s.start = t; t += s.dur } }
  for (let k = 0; k < 1440 / dt; k++) {
    const t = k * dt
    apply(d0 + t)
    let vol = [...flow.values()].reduce((a, f) => a + f * 3.6, 0) * dt / 60
    const room = network.jebias.map(j => j.capacityM3 - level.get(j.id)!)
    const sum = room.reduce((a, b) => a + b, 0)
    if (sum > 1e-9) network.jebias.forEach((j, x) => { const give = Math.min(room[x], vol * room[x] / sum); level.set(j.id, level.get(j.id)! + give); if (t < cut) tradPumped += give })
    for (const s of slots) {
      if (t < s.start || t >= s.start + s.dur) continue
      if (blocks.some(b => b.sid === s.seguiaId && t >= b.from && t < b.to)) continue
      const give = Math.min(s.sg.capacityM3h * dt / 60, level.get(s.sg.jebiaId)!)
      level.set(s.sg.jebiaId, level.get(s.sg.jebiaId)! - give)
      s.released += give
      s.delivered += give * (1 - conveyance(s.plot, s.sg, extra.get(s.seguiaId) ?? 0).loss)
    }
  }
  for (const s of slots) if (s.start + s.dur <= cut) { acc(trad, s.plot.farmerId, need.get(s.plot.id)!, s.delivered); tradReleased += s.released }
}
const stats = (m: Map<string, Row>) => {
  const pct = [...m.values()].map(r => (r.got / r.need) * 100)
  const need = [...m.values()].reduce((a, r) => a + r.need, 0), got = [...m.values()].reduce((a, r) => a + r.got, 0)
  return { covered: (got / need) * 100, jain: pct.reduce((a, b) => a + b, 0) ** 2 / (pct.length * pct.reduce((a, b) => a + b * b, 0)), min: Math.min(...pct), below: pct.filter(p => p < 97).length, farmers: pct.length, under50: pct.filter(p => p < 50).length }
}
const a = stats(trad), b = stats(twiza)
console.log(`\n2. SAME WEEK (${addDays(D, -6)} -> ${D} ${Math.floor(CONFIG.demoMinute / 60)}:05), collective network, power cut on ${addDays(D, -3)}`)
console.log('   model               | need covered | Jain fairness | worst-off farmer | farmers < 97 % | pumped (m3) | released (m3)')
console.log(`   traditional nouba   | ${a.covered.toFixed(1)} %       | ${a.jain.toFixed(3)}         | ${a.min.toFixed(0)} %             | ${a.below} / ${a.farmers}        | ${fmt(tradPumped)}      | ${fmt(tradReleased)}`)
console.log(`   TWIZA planner       | ${b.covered.toFixed(1)} %       | ${b.jain.toFixed(3)}         | ${b.min.toFixed(0)} %             | ${b.below} / ${b.farmers}        | ${fmt(twizaPumped)}      | ${fmt(twizaReleased)}`)
console.log(`   water released: TWIZA uses ${Math.round((1 - twizaReleased / tradReleased) * 100)} % less than the fixed nouba for the same week`)

// ---------------- 3. energy ----------------
const KWH_PER_M3 = (1000 * 9.81 * 35) / 3.6e6 / 0.5 // lift 35 m (water level + drawdown), pump + motor efficiency 50 %
const saved = total(0, 1.3, 12) - total(0.7, 1.3, 12)
console.log(`\n3. ENERGY — ${KWH_PER_M3.toFixed(2)} kWh/m3 (lift 35 m, efficiency 50 %): ${fmt(saved)} m3/day avoided = ${fmt(saved * KWH_PER_M3)} kWh/day, ${fmt((saved * KWH_PER_M3 * 120) / 1000)} MWh over a 120-day summer`)
