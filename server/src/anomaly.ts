// TWIZA — anomaly detection on sensor series. Simple and explainable on purpose:
//   rolling z-score   a point far from the recent mean
//   sudden step       the level settles at a new value (a well that drops)
//   trend             a slow, steady rise (salinity)
//   mass balance      water enters a jebia but its level does not follow (leak)

export interface Anomaly {
  kind: 'zscore' | 'step' | 'trend' | 'leak'
  /** index in the series where the anomaly starts */
  index: number
  /** size of the anomaly, in the unit of the series */
  value: number
  /** how many standard deviations (or r² for a trend) */
  score: number
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const std = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map(v => (v - m) ** 2)))
}

/** daily means of an hourly series (removes the pumping cycle) */
export function daily(hourly: number[], perDay = 24): number[] {
  const out: number[] = []
  for (let i = 0; i + perDay <= hourly.length; i += perDay) out.push(mean(hourly.slice(i, i + perDay)))
  return out
}

/** points further than `threshold` σ from the mean of the previous `window` points */
export function rollingZ(values: number[], window = 10, threshold = 4, minStd = 1e-6): Anomaly[] {
  const out: Anomaly[] = []
  for (let i = window; i < values.length; i++) {
    const w = values.slice(i - window, i)
    const s = Math.max(std(w), minStd)
    const z = (values[i] - mean(w)) / s
    if (Math.abs(z) >= threshold) out.push({ kind: 'zscore', index: i, value: values[i] - mean(w), score: z })
  }
  return out
}

/** a lasting step: mean of the next `k` points vs mean of the previous `k` points */
export function suddenStep(values: number[], k = 3, minDelta = 1, threshold = 5): Anomaly | null {
  let best: Anomaly | null = null
  for (let i = k; i + k <= values.length; i++) {
    const before = values.slice(i - k, i)
    const after = values.slice(i, i + k)
    const delta = mean(after) - mean(before)
    const s = Math.max(std(before), std(after), minDelta / 20)
    if (Math.abs(delta) >= minDelta && Math.abs(delta) / s >= threshold && (!best || Math.abs(delta) > Math.abs(best.value)))
      best = { kind: 'step', index: i, value: delta, score: Math.abs(delta) / s }
  }
  return best
}

/** least-squares slope over the last `n` points; anomaly when steep and regular */
export function risingTrend(values: number[], n = 10, minSlope = 0.02, minR2 = 0.7): (Anomaly & { slope: number }) | null {
  if (values.length < n) return null
  const y = values.slice(-n)
  const mx = (n - 1) / 2
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  y.forEach((v, i) => {
    sxy += (i - mx) * (v - my)
    sxx += (i - mx) ** 2
    syy += (v - my) ** 2
  })
  const slope = sxy / sxx
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0
  if (slope >= minSlope && r2 >= minR2) return { kind: 'trend', index: values.length - n, value: slope * (n - 1), score: r2, slope }
  return null
}

/** leak: for `minHours` in a row the level is lower than inflow − outflow explains */
export function leakBalance(level: number[], inflow: number[], outflow: number[], minHours = 6, minRate = 20): (Anomaly & { hours: number }) | null {
  let run = 0
  let lost = 0
  let best: (Anomaly & { hours: number }) | null = null
  for (let i = 1; i < level.length; i++) {
    // smooth over 3 h so that level noise does not break a run
    const a = Math.max(1, i - 2)
    let r = 0
    for (let j = a; j <= i; j++) r += level[j] - level[j - 1] - (inflow[j] - outflow[j])
    r /= i - a + 1
    if (r <= -minRate) {
      run++
      lost += -r
      if (run >= minHours && (!best || run > best.hours)) best = { kind: 'leak', index: i - run + 1, value: lost / run, score: run, hours: run }
    } else {
      run = 0
      lost = 0
    }
  }
  return best
}
