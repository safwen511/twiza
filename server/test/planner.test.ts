import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONFIG } from '../src/config.js'
import { addDays, dailyNeed, leaching, planDay, serviceLevel } from '../src/planner.js'
import type { Network, PlanEvent } from '../src/types.js'

const network: Network = JSON.parse(readFileSync(new URL('../../data/network.json', import.meta.url), 'utf8'))
const real: Record<string, number> = Object.fromEntries(
  JSON.parse(readFileSync(new URL('../../data/weather.json', import.meta.url), 'utf8')).days.map((d: any) => [d.date, d.et0]),
)
const D: string = CONFIG.demoDate
const flat = (et0: number) => Object.fromEntries(Array.from({ length: 40 }, (_, i) => [addDays(D, i - 10), et0]))
const cause = { fr: '', en: '', ar: '' }
const heat = (f: number, from = D, days = 6): PlanEvent => ({
  id: 'hw', type: 'forecast', date: addDays(from, -1), minute: 0, cause,
  et0Factor: Object.fromEntries(Array.from({ length: days }, (_, i) => [addDays(from, i), f])),
})

describe('agronomy', () => {
  it('FAO-56 need and FAO-29 leaching', () => {
    expect(leaching(3, 6.8)).toBeCloseTo(3 / 31, 6)
    expect(leaching(40, 6.8)).toBe(CONFIG.maxLeaching)
    const n = dailyNeed({ areaHa: 1, under: null, underShare: 0 }, 10, 0)
    expect(n.palm).toBeCloseTo((0.95 * 10 * 10) / CONFIG.efficiency, 6)
    expect(n.under).toBe(0)
  })
  it('service level: palms first, then the understory', () => {
    const reqs = [{ palm: 100, under: 50 }, { palm: 200, under: 0 }]
    expect(serviceLevel(reqs, 1000)).toBe(2)
    expect(serviceLevel(reqs, 325)).toBeCloseTo(1.5, 6)
    expect(serviceLevel(reqs, 150)).toBeCloseTo(0.5, 6)
  })
})

describe('planner', () => {
  it('never pumps more than the safe limit, even in a heat wave', () => {
    for (const f of [1, 1.2, 1.5, 2])
      for (const cap of [4000, 8000, CONFIG.collectiveCap])
        for (let i = 0; i < 6; i++) {
          const p = planDay(addDays(D, i), { network, weather: real, events: [heat(f)], cap })
          expect(p.pumped).toBeLessThanOrEqual(cap + 1e-6)
          expect(Math.max(...p.pumpedCum)).toBeLessThanOrEqual(cap + 1e-6)
          expect(p.released).toBeLessThanOrEqual(cap + 1e-6)
        }
  })

  it('respects the hydraulics: seguia capacity, jebia storage, one turn at a time', () => {
    const p = planDay(D, { network, weather: real, events: [] })
    for (const j of network.jebias) {
      expect(Math.min(...p.jebiaLevels[j.id])).toBeGreaterThanOrEqual(-1e-6)
      expect(Math.max(...p.jebiaLevels[j.id])).toBeLessThanOrEqual(j.capacityM3 + 1e-6)
    }
    for (const s of network.seguias) {
      const turns = p.turns.filter(t => t.seguiaId === s.id).sort((a, b) => a.start - b.start)
      turns.forEach((t, i) => {
        expect(t.start).toBeGreaterThanOrEqual(CONFIG.dayStartMin)
        expect(t.released).toBeLessThanOrEqual(((t.end - t.start) / 60) * s.capacityM3h + 1e-6)
        expect(t.delivered).toBeLessThan(t.released)
        if (i > 0) expect(t.start).toBeGreaterThanOrEqual(turns[i - 1].end)
      })
    }
    // a normal day: everybody is fully served
    expect(p.underShare).toBe(1)
    for (const t of p.turns) expect(t.delivered).toBeCloseTo(t.needPalm + t.needUnder, 3)
  })

  it('serves the palms first', () => {
    // mild shortage: palms 100 %, the understory is cut
    const mild = planDay(D, { network, weather: real, events: [], cap: 8500 })
    for (const t of mild.turns) {
      expect(t.palmShare).toBe(1)
      expect(t.underShare).toBeLessThan(1)
      expect(t.delivered).toBeGreaterThanOrEqual(t.needPalm - 1e-6)
    }
    // severe shortage: the understory gets nothing before the palms are whole
    const severe = planDay(D, { network, weather: real, events: [], cap: 5000 })
    for (const t of severe.turns) {
      expect(t.underShare).toBe(0)
      expect(t.palmShare).toBeLessThan(1)
      expect(t.palmShare).toBeGreaterThan(0.5)
    }
  })

  it('spreads the shortage evenly (fairness)', () => {
    for (const cap of [5000, 7000, 8500]) {
      const p = planDay(D, { network, weather: real, events: [], cap })
      const palm = p.turns.map(t => t.palmShare)
      const under = p.turns.map(t => t.underShare)
      expect(Math.max(...palm) - Math.min(...palm)).toBeLessThan(1e-9)
      expect(Math.max(...under) - Math.min(...under)).toBeLessThan(1e-9)
      // all the budget is used
      expect(p.released).toBeGreaterThan(cap - 1)
    }
  })

  it('a swap exchanges the slots and keeps each volume', () => {
    const weather = flat(9)
    const before = [planDay(D, { network, weather, events: [] }), planDay(addDays(D, 1), { network, weather, events: [] })]
    const a = before[1].turns.find(t => t.seguiaId === 's2')! // first turn of seguia 2 tomorrow
    const s2 = before[0].turns.filter(t => t.seguiaId === 's2')
    const b = s2[s2.length - 1] // last turn of seguia 2 today
    const swap: PlanEvent = { id: 'sw', type: 'swap', date: D, minute: 10 * 60, cause, swap: { plotA: a.plotId, dateA: a.date, plotB: b.plotId, dateB: b.date } }
    const after = [planDay(D, { network, weather, events: [swap] }), planDay(addDays(D, 1), { network, weather, events: [swap] })]
    const a2 = after[0].turns.find(t => t.plotId === a.plotId)!
    const b2 = after[1].turns.find(t => t.plotId === b.plotId)!
    expect(a2.start).toBe(b.start) // A now irrigates in B's slot, today
    expect(b2.start).toBe(a.start) // B takes A's slot, tomorrow
    expect(a2.target).toBeCloseTo(a.target, 6)
    expect(b2.target).toBeCloseTo(b.target, 6)
    expect(a2.flags).toContain('swap')
    expect(after[0].turns.find(t => t.plotId === b.plotId)).toBeUndefined()
    // nobody else on the seguia loses water
    for (const t of [...before[0].turns, ...before[1].turns]) {
      if (t.plotId === a.plotId || t.plotId === b.plotId) continue
      const u = [...after[0].turns, ...after[1].turns].find(x => x.id === t.id)!
      expect(u.target).toBeCloseTo(t.target, 6)
    }
  })

  it('re-plans after a dry well without touching the past', () => {
    // both boreholes stop at 07:00: only what is stored in the jebias is left
    const at = 7 * 60
    const dry: PlanEvent[] = network.wells.filter(w => w.type === 'gda').map((w, i) => ({ id: `dry${i}`, type: 'well_flow', date: D, minute: at, wellId: w.id, flowLs: 0, cause }))
    const before = planDay(D, { network, weather: real, events: [] })
    const after = planDay(D, { network, weather: real, events: dry })
    for (const t of before.turns) {
      const u = after.turns.find(x => x.id === t.id)!
      if (t.end <= at) {
        expect(u.start).toBe(t.start)
        expect(u.end).toBe(t.end)
        expect(u.released).toBeCloseTo(t.released, 6)
      }
      if (t.start < at && t.end > at) expect(u.target).toBeCloseTo(t.target, 6) // running turn keeps its volume
    }
    expect(after.released).toBeLessThan(before.released)
    expect(after.pumped).toBeLessThan(before.pumped)
    const late = after.turns.filter(t => t.start >= at || t.start < 0)
    expect(late.length).toBeGreaterThan(0)
    // palms first, same share for everybody who had not started
    const palm = late.map(t => t.palmShare)
    const under = late.map(t => t.underShare)
    expect(Math.max(...palm) - Math.min(...palm)).toBeLessThan(1e-9)
    expect(Math.max(...under) - Math.min(...under)).toBeLessThan(1e-9)
    expect(under[0]).toBeLessThan(1)
    if (under[0] > 0) expect(palm[0]).toBe(1)
    for (const j of network.jebias) expect(Math.min(...after.jebiaLevels[j.id])).toBeGreaterThanOrEqual(-1e-6)
    // the day after with one borehole still dry: limit, palms first and fairness still hold
    const one = dry.slice(0, 1)
    const next = planDay(addDays(D, 1), { network, weather: real, events: one })
    expect(next.pumped).toBeLessThanOrEqual(CONFIG.collectiveCap + 1e-6)
    expect(next.underShare).toBe(0)
    expect(next.palmShare).toBeLessThan(1)
    expect(next.palmShare).toBeGreaterThan(0.3)
    expect(Math.max(...next.turns.map(t => t.palmShare)) - next.palmShare).toBeLessThan(1e-9)
  })

  it('a closed seguia delays the turns but keeps their volumes', () => {
    const block: PlanEvent = { id: 'b', type: 'block', date: D, minute: 10 * 60 + 5, seguiaId: 's2', durationMin: 60, cause }
    const before = planDay(D, { network, weather: real, events: [] })
    const after = planDay(D, { network, weather: real, events: [block] })
    for (const t of before.turns) {
      const u = after.turns.find(x => x.id === t.id)!
      expect(u.released).toBeCloseTo(t.released, 6)
      if (t.seguiaId !== 's2' || t.end <= 605) expect(u.end).toBe(t.end)
      else expect(u.end).toBe(t.end + 60)
    }
  })

  it('a heat wave lengthens the turns of the palms and stays under the limit', () => {
    const next = addDays(D, 1)
    const hw = heat(CONFIG.heatWaveFactor, next, 3)
    const before = planDay(next, { network, weather: real, events: [] })
    const after = planDay(next, { network, weather: real, events: [hw] })
    expect(after.pumped).toBeLessThanOrEqual(CONFIG.collectiveCap + 1e-6)
    expect(after.palmShare).toBe(1)
    for (const t of before.turns) {
      const u = after.turns.find(x => x.id === t.id)!
      expect(u.needPalm).toBeCloseTo(t.needPalm * CONFIG.heatWaveFactor, 3)
      const plot = network.plots.find(p => p.id === t.plotId)!
      if (!plot.under) expect(u.end - u.start).toBeGreaterThan(t.end - t.start)
    }
  })
})
