// TWIZA water planner — deterministic, no LLM.
//
//  need (FAO-56)      = Kc × ET0 × area ÷ efficiency ÷ (1 − LR)
//  leaching (FAO-29)  LR = ECw / (5·ECe − ECw)
//  constraints        well flow, jebia storage, seguia capacity / travel time /
//                     seepage, safe daily limit of the aquifer
//  priority           palms first, then the shortage is spread evenly
//
// planDay() is a pure function of (network, weather, events). Re-planning is
// simply calling it again with one more event: an event only acts from its own
// timestamp on, so what already happened never changes.

import { CONFIG, CROPS } from './config.js'
import type { DayPlan, Network, PlanEvent, Plot, ReplanEntry, Seguia, Turn, Txt } from './types.js'

export interface PlannerInput {
  network: Network
  /** date -> ET0 in mm/day (Open-Meteo) */
  weather: Record<string, number>
  events: PlanEvent[]
  /** safe daily limit for the collective network, m3/day */
  cap?: number
}

// ---------- dates ----------

export function dayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}
export function addDays(date: string, n: number): string {
  return new Date((dayIndex(date) + n) * 86400000).toISOString().slice(0, 10)
}
export const absMin = (date: string, minute: number) => dayIndex(date) * 1440 + minute
export const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ---------- agronomy ----------

export function leaching(ecw: number, ece: number): number {
  const d = 5 * ece - ecw
  if (d <= 0) return CONFIG.maxLeaching
  return Math.min(CONFIG.maxLeaching, Math.max(0, ecw / d))
}

/** gross daily need at the plot, m3/day, split palms / understory */
export function dailyNeed(plot: Pick<Plot, 'areaHa' | 'under' | 'underShare'>, et0: number, ecw: number) {
  const lrPalm = leaching(ecw, CROPS.palm.ece)
  const palm = (CROPS.palm.kc * et0 * plot.areaHa * 10) / CONFIG.efficiency / (1 - lrPalm)
  let under = 0
  let lrUnder = 0
  if (plot.under) {
    const c = CROPS[plot.under]
    lrUnder = leaching(ecw, c.ece)
    under = (c.kc * et0 * plot.areaHa * plot.underShare * CONFIG.understoryShade * 10) / CONFIG.efficiency / (1 - lrUnder)
  }
  return { palm, under, lrPalm, lrUnder }
}

/** seepage between the jebia and the plot (share lost) and travel time */
export function conveyance(plot: Plot, seguia: Seguia, extraLoss = 0) {
  const branch = seguia.branches.find(b => b.id === plot.branchId)
  const keep =
    Math.pow(1 - seguia.main.lossPerKm, plot.distMainM / 1000) *
    Math.pow(1 - (branch?.lossPerKm ?? 0), plot.distBranchM / 1000)
  const loss = Math.min(0.6, 1 - keep + extraLoss)
  const travelMin = Math.round((plot.distMainM + plot.distBranchM) / CONFIG.seguiaSpeed / 60)
  return { loss, travelMin }
}

/**
 * Palms first, then fairness. One service level λ for everybody:
 *   palms get min(1, λ) of their need, the understory gets clamp(λ − 1, 0, 1).
 * λ is the largest value whose total fits in the budget.
 */
export function serviceLevel(reqs: { palm: number; under: number }[], budget: number): number {
  const total = (l: number) =>
    reqs.reduce((s, r) => s + r.palm * Math.min(1, l) + r.under * Math.min(1, Math.max(0, l - 1)), 0)
  if (total(2) <= budget + 1e-9) return 2
  let lo = 0
  let hi = 2
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (total(mid) <= budget) lo = mid
    else hi = mid
  }
  return lo
}

// ---------- world state driven by events ----------

interface World {
  wellFlow: Map<string, number>
  wellEc: Map<string, number>
  extraLoss: Map<string, number>
  et0Factor: Map<string, number>
  swaps: NonNullable<PlanEvent['swap']>[]
}

function applyEvent(w: World, e: PlanEvent) {
  if (e.type === 'well_flow' && e.wellId) w.wellFlow.set(e.wellId, e.flowLs ?? 0)
  else if (e.type === 'ec' && e.wellId) w.wellEc.set(e.wellId, e.ecDs ?? 0)
  else if (e.type === 'leak' && e.seguiaId) w.extraLoss.set(e.seguiaId, e.extraLoss ?? 0)
  else if (e.type === 'forecast' && e.et0Factor) for (const [d, f] of Object.entries(e.et0Factor)) w.et0Factor.set(d, f)
  else if (e.type === 'swap' && e.swap) w.swaps.push(e.swap)
}

/** EC of the water in the collective network: flow-weighted mean of the running GDA boreholes */
function collectiveEc(net: Network, w: World): number {
  let q = 0
  let qe = 0
  for (const well of net.wells) {
    if (well.type !== 'gda') continue
    const f = w.wellFlow.get(well.id) ?? well.flowLs
    q += f
    qe += f * (w.wellEc.get(well.id) ?? well.ecDs)
  }
  if (q > 0) return qe / q
  const gda = net.wells.filter(x => x.type === 'gda')
  return gda.reduce((s, x) => s + (w.wellEc.get(x.id) ?? x.ecDs), 0) / Math.max(1, gda.length)
}

function supplyM3h(net: Network, w: World): number {
  return net.wells.filter(x => x.type === 'gda').reduce((s, x) => s + (w.wellFlow.get(x.id) ?? x.flowLs) * 3.6, 0)
}

const meanEt0 = (weather: Record<string, number>) => {
  const v = Object.values(weather)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 9
}

interface Work extends Turn {
  plot: Plot
  slotOrder: number
  state: 'pending' | 'active' | 'done'
  reqPalm: number
  reqUnder: number
  swappedWith?: string
  limited: 'cap' | 'supply' | null
}

/** which plots irrigate on `date` on each seguia, in order (swaps applied) */
export function slotsFor(net: Network, date: string, swaps: NonNullable<PlanEvent['swap']>[]) {
  const g = ((dayIndex(date) % CONFIG.rotationDays) + CONFIG.rotationDays) % CONFIG.rotationDays
  const byId = new Map(net.plots.map(p => [p.id, p]))
  const slots: { seguiaId: string; plot: Plot; slotOrder: number; swappedWith?: string }[] = []
  for (const p of net.plots) {
    if (p.kind !== 'collective' || !p.seguiaId) continue
    if (p.group === g) slots.push({ seguiaId: p.seguiaId, plot: p, slotOrder: p.order })
  }
  for (const s of swaps) {
    const a = byId.get(s.plotA)
    const b = byId.get(s.plotB)
    if (!a || !b) continue
    if (s.dateA === date) {
      const i = slots.findIndex(x => x.plot.id === a.id)
      if (i >= 0) slots[i] = { ...slots[i], plot: b, swappedWith: a.id }
    }
    if (s.dateB === date) {
      const i = slots.findIndex(x => x.plot.id === b.id && !x.swappedWith)
      if (i >= 0) slots[i] = { ...slots[i], plot: a, swappedWith: b.id }
    }
  }
  slots.sort((x, y) => x.seguiaId.localeCompare(y.seguiaId) || x.slotOrder - y.slotOrder)
  return slots
}

export function planDay(date: string, input: PlannerInput): DayPlan {
  const net = input.network
  const cap = input.cap ?? CONFIG.collectiveCap
  const R = CONFIG.rotationDays
  const dt = CONFIG.stepMin
  const steps = 1440 / dt
  const d0 = absMin(date, 0)
  const fallbackEt0 = meanEt0(input.weather)
  const seguiaById = new Map(net.seguias.map(s => [s.id, s]))
  const farmerOf = new Map(net.plots.map(p => [p.id, p.farmerId]))

  const events = [...input.events].sort((a, b) => absMin(a.date, a.minute) - absMin(b.date, b.minute))
  const world: World = { wellFlow: new Map(), wellEc: new Map(), extraLoss: new Map(), et0Factor: new Map(), swaps: [] }
  let ei = 0
  while (ei < events.length && absMin(events[ei].date, events[ei].minute) <= d0) applyEvent(world, events[ei++])

  // closed intervals of each seguia, in minutes of this day
  const blocks: DayPlan['blocks'] = []
  for (const e of events) {
    if (e.type !== 'block' || !e.seguiaId) continue
    const from = absMin(e.date, e.minute) - d0
    const to = from + (e.durationMin ?? 0)
    if (to <= 0 || from >= 1440) continue
    blocks.push({ seguiaId: e.seguiaId, from: Math.max(0, Math.floor(from / dt) * dt), to: Math.min(1440, Math.ceil(to / dt) * dt) })
  }
  const blocked = (sid: string, t: number) => blocks.some(b => b.seguiaId === sid && t >= b.from && t < b.to)

  const et0Of = (d: string) => (input.weather[d] ?? fallbackEt0) * (world.et0Factor.get(d) ?? 1)

  // ---- needs of a turn: the next R days of crop need, with the forecast ----
  const requirement = (plot: Plot, sid: string, base = false) => {
    const seguia = seguiaById.get(sid)!
    const ecw = base ? collectiveEc(net, { ...world, wellFlow: new Map(), wellEc: new Map() }) : collectiveEc(net, world)
    let palm = 0
    let under = 0
    let lr = 0
    for (let i = 0; i < R; i++) {
      const d = addDays(date, i)
      const n = dailyNeed(plot, base ? input.weather[d] ?? fallbackEt0 : et0Of(d), ecw)
      palm += n.palm
      under += n.under
      lr = n.lrPalm
    }
    const cv = conveyance(plot, seguia, base ? 0 : world.extraLoss.get(sid) ?? 0)
    return { palm, under, lr, ...cv }
  }

  const makeTurn = (slot: ReturnType<typeof slotsFor>[number]): Work => {
    const seguia = seguiaById.get(slot.seguiaId)!
    const base = requirement(slot.plot, slot.seguiaId, true)
    return {
      id: `${date}:${slot.plot.id}`,
      date,
      seguiaId: slot.seguiaId,
      jebiaId: seguia.jebiaId,
      plotId: slot.plot.id,
      farmerId: farmerOf.get(slot.plot.id) ?? '',
      start: -1,
      end: -1,
      needPalm: 0,
      needUnder: 0,
      target: 0,
      baseTarget: (base.palm + base.under) / (1 - base.loss),
      released: 0,
      delivered: 0,
      palmShare: 1,
      underShare: 1,
      lossShare: 0,
      travelMin: 0,
      leaching: 0,
      flags: slot.swappedWith ? ['swap'] : [],
      reason: { fr: '', en: '', ar: '' },
      plot: slot.plot,
      slotOrder: slot.slotOrder,
      state: 'pending',
      reqPalm: 0,
      reqUnder: 0,
      swappedWith: slot.swappedWith,
      limited: null,
    }
  }

  const turns: Work[] = slotsFor(net, date, world.swaps).map(makeTurn)
  const queue = new Map<string, Work[]>()
  for (const s of net.seguias) queue.set(s.id, turns.filter(t => t.seguiaId === s.id))

  const level = new Map(net.jebias.map(j => [j.id, j.capacityM3 * CONFIG.jebiaStartShare]))
  let pumped = 0
  let pumpBudget = 0

  /** (re)compute the targets of the turns that have not started yet */
  const allocate = (t: number) => {
    const pending = turns.filter(x => x.state === 'pending')
    for (const x of pending) {
      const r = requirement(x.plot, x.seguiaId)
      x.needPalm = r.palm
      x.needUnder = r.under
      x.lossShare = r.loss
      x.travelMin = r.travelMin
      x.leaching = r.lr
      x.reqPalm = r.palm / (1 - r.loss)
      x.reqUnder = r.under / (1 - r.loss)
    }
    const committed = turns.reduce((s, x) => s + (x.state === 'pending' ? 0 : x.state === 'done' ? x.released : x.target), 0)
    const activeRest = turns.reduce((s, x) => s + (x.state === 'active' ? x.target - x.released : 0), 0)
    const hoursLeft = t === 0 ? CONFIG.maxPumpHours : (1440 - t) / 60
    const pumpable = Math.max(0, Math.min(supplyM3h(net, world) * hoursLeft, cap - pumped))
    // at midnight the day must balance (pumped = released); after an incident the
    // planner may also draw the jebias down to their reserve
    const storage =
      t === 0 ? 0 : net.jebias.reduce((s, j) => s + Math.max(0, (level.get(j.id) ?? 0) - j.capacityM3 * CONFIG.jebiaReserveShare), 0)
    const physical = pumpable + storage - activeRest
    const capRoom = cap - committed
    const budget = Math.max(0, Math.min(physical, capRoom))
    const lambda = serviceLevel(pending.map(x => ({ palm: x.reqPalm, under: x.reqUnder })), budget)
    const fp = Math.min(1, lambda)
    const fu = Math.min(1, Math.max(0, lambda - 1))
    for (const x of pending) {
      x.palmShare = fp
      x.underShare = fu
      x.target = x.reqPalm * fp + x.reqUnder * fu
      x.limited = lambda >= 2 ? null : capRoom <= physical ? 'cap' : 'supply'
    }
    pumpBudget = Math.min(cap, turns.reduce((s, x) => s + (x.state === 'done' ? x.released : x.target), 0))
  }
  allocate(0)

  const pumpedCum: number[] = [0]
  const jebiaLevels: Record<string, number[]> = {}
  for (const j of net.jebias) jebiaLevels[j.id] = [level.get(j.id)!]

  for (let k = 0; k < steps; k++) {
    const t = k * dt
    // events that became known since the last step
    let changed = false
    while (ei < events.length && absMin(events[ei].date, events[ei].minute) <= d0 + t) {
      const e = events[ei++]
      applyEvent(world, e)
      if (e.type === 'swap' && e.swap) {
        // exchange inside the queues, only for turns that have not started
        const byId = new Map(net.plots.map(p => [p.id, p]))
        const put = (out: string, inn: string) => {
          const i = turns.findIndex(x => x.plotId === out && x.state === 'pending' && !x.swappedWith)
          const p = byId.get(inn)
          if (i < 0 || !p) return
          const old = turns[i]
          const nt = makeTurn({ seguiaId: old.seguiaId, plot: p, slotOrder: old.slotOrder, swappedWith: out })
          turns[i] = nt
          const q = queue.get(old.seguiaId)!
          q[q.indexOf(old)] = nt
        }
        if (e.swap.dateA === date) put(e.swap.plotA, e.swap.plotB)
        if (e.swap.dateB === date) put(e.swap.plotB, e.swap.plotA)
      }
      if (e.type !== 'block') changed = true
    }
    if (changed) allocate(t)

    // 1. boreholes fill the jebias (shared main pipe), never beyond the daily budget
    const avail = (supplyM3h(net, world) * dt) / 60
    let vol = Math.min(avail, Math.max(0, pumpBudget - pumped))
    if (vol > 1e-9) {
      const want = net.jebias.map(j => {
        const lv = level.get(j.id)!
        const rest = turns.reduce((s, x) => s + (x.jebiaId === j.id && x.state !== 'done' ? x.target - x.released : 0), 0)
        return { j, room: j.capacityM3 - lv, w: Math.max(0, rest - lv) }
      })
      for (const key of ['w', 'room'] as const) {
        const sum = want.reduce((s, x) => s + (x.room > 1e-9 ? x[key] : 0), 0)
        if (sum <= 1e-9 || vol <= 1e-9) continue
        const share = vol
        for (const x of want) {
          if (x.room <= 1e-9) continue
          const give = Math.min(x.room, (share * x[key]) / sum)
          level.set(x.j.id, level.get(x.j.id)! + give)
          x.room -= give
          pumped += give
          vol -= give
        }
      }
    }

    // 2. one turn at a time on each seguia
    if (t >= CONFIG.dayStartMin) {
      for (const s of net.seguias) {
        if (blocked(s.id, t)) continue
        const q = queue.get(s.id)!
        const cur = q.find(x => x.state !== 'done')
        if (!cur) continue
        const lv = level.get(s.jebiaId)!
        const give = Math.min((s.capacityM3h * dt) / 60, lv, cur.target - cur.released)
        if (cur.state === 'pending') {
          if (cur.target > 1e-6 && give <= 1e-9) continue // jebia empty: wait
          cur.state = 'active'
          cur.start = t
        }
        cur.released += give
        level.set(s.jebiaId, lv - give)
        if (cur.target - cur.released <= 1e-6) {
          cur.state = 'done'
          cur.end = t + dt
        }
      }
    }
    pumpedCum.push(pumped)
    for (const j of net.jebias) jebiaLevels[j.id].push(level.get(j.id)!)
  }

  for (const x of turns) {
    if (x.state === 'active') {
      x.end = 1440
      x.flags.push('unfinished')
    } else if (x.state === 'pending') x.flags.push('unfinished')
    x.delivered = x.released * (1 - x.lossShare)
    if (x.target > x.baseTarget * 1.03) x.flags.push('lengthened')
    else if (x.target < x.baseTarget * 0.97) x.flags.push(x.underShare < 1 || x.palmShare < 1 ? 'cut' : 'shortened')
  }

  const et0 = input.weather[date] ?? fallbackEt0
  const factor = world.et0Factor.get(date) ?? 1
  const out: Turn[] = turns.map(x => {
    const { plot, slotOrder, state, reqPalm, reqUnder, swappedWith, limited, ...turn } = x
    turn.reason = reasonOf(x, et0 * factor, factor, limited, swappedWith ? net.farmers.find(f => f.id === farmerOf.get(swappedWith)) : undefined)
    return turn
  })
  const released = out.reduce((s, x) => s + x.released, 0)
  const delivered = out.reduce((s, x) => s + x.delivered, 0)
  const need = out.reduce((s, x) => s + x.needPalm + x.needUnder, 0)
  return {
    date,
    et0,
    et0Factor: factor,
    turns: out,
    pumpedCum,
    jebiaLevels,
    pumped,
    released,
    delivered,
    need,
    cap,
    palmShare: out.length ? Math.min(...out.map(x => x.palmShare)) : 1,
    underShare: out.length ? Math.min(...out.map(x => x.underShare)) : 1,
    blocks,
  }
}

function reasonOf(
  x: Turn & { plot: Plot },
  et0: number,
  factor: number,
  limited: 'cap' | 'supply' | null,
  swapWith?: { first: string; firstAr: string },
): Txt {
  const n = (v: number) => Math.round(v).toString()
  const pct = (v: number) => Math.round(v * 100)
  const R = CONFIG.rotationDays
  const under = x.plot.under ? CROPS[x.plot.under].label : null
  const fr: string[] = []
  const en: string[] = []
  const ar: string[] = []
  fr.push(
    `Besoin ${R} j : ${n(x.needPalm + x.needUnder)} m³ au champ (palmier ${n(x.needPalm)}${under ? ` + ${under.fr.toLowerCase()} ${n(x.needUnder)}` : ''}), ET0 ${et0.toFixed(1)} mm/j${factor !== 1 ? ` (prévision ×${factor.toFixed(2)})` : ''}, lessivage ${pct(x.leaching)} %, pertes seguia ${pct(x.lossShare)} %.`,
  )
  en.push(
    `${R}-day need: ${n(x.needPalm + x.needUnder)} m³ at the plot (palm ${n(x.needPalm)}${under ? ` + ${under.en.toLowerCase()} ${n(x.needUnder)}` : ''}), ET0 ${et0.toFixed(1)} mm/d${factor !== 1 ? ` (forecast ×${factor.toFixed(2)})` : ''}, leaching ${pct(x.leaching)} %, seguia loss ${pct(x.lossShare)} %.`,
  )
  ar.push(`حاجة ${R} أيام: ${n(x.needPalm + x.needUnder)} م³ (النخل ${n(x.needPalm)}${under ? ` + ${under.ar} ${n(x.needUnder)}` : ''}).`)
  if (limited) {
    const why = limited === 'cap' ? { fr: 'plafond de la nappe', en: 'aquifer limit', ar: 'حدّ المائدة' } : { fr: 'débit des forages', en: 'borehole flow', ar: 'صبيب الآبار' }
    fr.push(`Servi : palmiers ${pct(x.palmShare)} %, sous-étage ${pct(x.underShare)} % (${why.fr} : palmiers d'abord, manque réparti également).`)
    en.push(`Served: palms ${pct(x.palmShare)} %, understory ${pct(x.underShare)} % (${why.en}: palms first, shortage spread evenly).`)
    ar.push(`النخل ${pct(x.palmShare)}٪، تحت النخل ${pct(x.underShare)}٪ (${why.ar}: النخل قبل، والنقص على الناس الكل).`)
  } else {
    fr.push('Besoin servi à 100 %.')
    en.push('Need fully served.')
    ar.push('الحاجة كاملة.')
  }
  if (swapWith) {
    fr.push(`Échange de tour avec ${swapWith.first}.`)
    en.push(`Turn swapped with ${swapWith.first}.`)
    ar.push(`تبديل نوبة مع ${swapWith.firstAr}.`)
  }
  if (x.flags.includes('unfinished')) {
    fr.push('Tour non terminé avant minuit.')
    en.push('Turn not finished before midnight.')
    ar.push('النوبة ما كملتش قبل نص الليل.')
  }
  return { fr: fr.join(' '), en: en.join(' '), ar: ar.join(' ') }
}

// ---------- comparing two plans (re-plan log) ----------

export function diffPlans(before: DayPlan[], after: DayPlan[]): ReplanEntry['changes'] {
  const b = new Map(before.flatMap(p => p.turns).map(t => [t.id, t]))
  const a = new Map(after.flatMap(p => p.turns).map(t => [t.id, t]))
  const changes: ReplanEntry['changes'] = []
  const pick = (t: Turn) => ({ start: t.start, end: t.end, target: Math.round(t.target) })
  for (const [id, t] of a) {
    const o = b.get(id)
    if (!o) changes.push({ turnId: id, plotId: t.plotId, farmerId: t.farmerId, date: t.date, before: null, after: pick(t) })
    else if (o.start !== t.start || o.end !== t.end || Math.abs(o.target - t.target) > 1)
      changes.push({ turnId: id, plotId: t.plotId, farmerId: t.farmerId, date: t.date, before: pick(o), after: pick(t) })
  }
  for (const [id, o] of b) if (!a.has(id)) changes.push({ turnId: id, plotId: o.plotId, farmerId: o.farmerId, date: o.date, before: pick(o), after: null })
  return changes
}

/** flag the turns that differ from the reference plan (no incident) */
export function annotate(plan: DayPlan, reference: DayPlan): DayPlan {
  const ref = new Map(reference.turns.map(t => [t.id, t]))
  for (const t of plan.turns) {
    const o = ref.get(t.id)
    if (!o) continue
    const late = t.start - o.start
    if (t.start >= 0 && late >= CONFIG.stepMin && !t.flags.includes('delayed')) {
      t.flags.push('delayed')
      t.reason = {
        fr: `${t.reason.fr} Décalé de ${late} min.`,
        en: `${t.reason.en} Delayed by ${late} min.`,
        ar: `${t.reason.ar} تأخّرت ${late} دق.`,
      }
    }
    if ((t.start !== o.start || t.end !== o.end || Math.abs(t.target - o.target) > 1) && !t.flags.includes('replan')) t.flags.push('replan')
  }
  return plan
}

// ---------- private wells that joined TWIZA (extension plots) ----------

export function privatePlan(plot: Plot, well: { flowLs: number; ecDs: number }, et0: number) {
  const n = dailyNeed(plot, et0, well.ecDs)
  const need = n.palm + n.under
  const hours = need / (well.flowLs * 3.6)
  const traditional = well.flowLs * 3.6 * CONFIG.traditionalPrivateHours
  return { need, hours, traditional, leaching: n.lrPalm }
}
