import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { daily, leakBalance, risingTrend, rollingZ, suddenStep } from '../src/anomaly.js'

const noise = (i: number) => Math.sin(i * 12.9898) * 0.5 // deterministic pseudo-noise in [-0.5, 0.5]

describe('anomaly detector', () => {
  it('rolling z-score flags a spike and nothing else', () => {
    const v = Array.from({ length: 60 }, (_, i) => 10 + noise(i) * 0.2)
    v[40] = 14
    const a = rollingZ(v, 10, 4)
    expect(a.map(x => x.index)).toContain(40)
    expect(rollingZ(v.slice(0, 40), 10, 4)).toHaveLength(0)
  })

  it('detects a well whose level drops and stays down', () => {
    const v = Array.from({ length: 30 }, (_, i) => 25 + noise(i) * 0.1 + (i >= 21 ? 3.4 : 0))
    const a = suddenStep(v, 3, 1)
    expect(a?.index).toBe(21)
    expect(a!.value).toBeGreaterThan(3)
    expect(suddenStep(v.slice(0, 20), 3, 1)).toBeNull()
  })

  it('detects rising salinity, ignores a flat series', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 3 + noise(i) * 0.02 + (i > 18 ? (i - 18) * 0.05 : 0))
    const a = risingTrend(rising, 10)
    expect(a).not.toBeNull()
    expect(a!.slope).toBeGreaterThan(0.04)
    expect(risingTrend(rising.slice(0, 18), 10)).toBeNull()
  })

  it('detects a leak: inflow without the matching level change', () => {
    const n = 96
    const inflow = Array.from({ length: n }, () => 100)
    const outflow = Array.from({ length: n }, (_, i) => (i % 24 > 4 && i % 24 < 15 ? 200 : 0))
    const level = [1000]
    for (let i = 1; i < n; i++) level.push(level[i - 1] + inflow[i] - outflow[i] - (i >= 40 && i < 60 ? 45 : 0) + noise(i) * 6)
    const a = leakBalance(level, inflow, outflow)
    expect(a).not.toBeNull()
    expect(a!.index).toBeGreaterThanOrEqual(38)
    expect(a!.index).toBeLessThanOrEqual(43)
    expect(a!.value).toBeGreaterThan(35)
    const clean = [1000]
    for (let i = 1; i < n; i++) clean.push(clean[i - 1] + inflow[i] - outflow[i] + noise(i) * 6)
    expect(leakBalance(clean, inflow, outflow)).toBeNull()
  })

  it('finds exactly the three planted events in the synthetic sensors', () => {
    const s = JSON.parse(readFileSync(new URL('../../data/sensors.json', import.meta.url), 'utf8'))
    const steps = Object.entries<any>(s.wells).filter(([, w]) => suddenStep(daily(w.level), 3, 1.5))
    const trends = Object.entries<any>(s.wells).filter(([, w]) => risingTrend(daily(w.ec), 10))
    const leaks = Object.entries<any>(s.jebias).filter(([, j]) => leakBalance(j.level, j.inflow, j.outflow))
    expect(steps).toHaveLength(1)
    expect(trends.map(([id]) => id)).toEqual(['f2'])
    expect(leaks.map(([id]) => id)).toEqual(['j4'])
  })
})
