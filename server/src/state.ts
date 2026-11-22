// TWIZA — S().live state of the community (in memory).
// The planner decides; this module only feeds it events and keeps the log.

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { CONFIG, CROPS, SITE } from './config.js'
import { daily, leakBalance, risingTrend, suddenStep } from './anomaly.js'
import { absMin, addDays, annotate, dayIndex, diffPlans, hhmm, planDay, privatePlan } from './planner.js'
import { buildScenario } from './scenario.js'
import type { DayPlan, Farmer, Network, PlanEvent, ReplanEntry, Turn, Txt, WeatherDay } from './types.js'

const DATA = new URL('../../data/', import.meta.url)
const load = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8'))

const raw = load('network.json')
export const site: { lat: number; lon: number; bearingDeg: number } = raw.site
export const network: Network = { farmers: raw.farmers, plots: raw.plots, wells: raw.wells, jebias: raw.jebias, seguias: raw.seguias }
const sensors: {
  startHour: number
  hours: number
  wells: Record<string, { level: number[]; flow: number[]; ec: number[] }>
  jebias: Record<string, { level: number[]; inflow: number[]; outflow: number[] }>
} = load('sensors.json')
const history: {
  events: PlanEvent[]
  reports: { id: string; farmerId: string; type: ReportType; seguiaId: string; date: string; minute: number; status: string }[]
  swaps: { id: string; from: string; to: string; plotA: string; dateA: string; plotB: string; dateB: string; status: string; date: string; minute: number }[]
  regularization: { farmerId: string; done: string[] }[]
} = load('history.json')
export const weatherDays: WeatherDay[] = load('weather.json').days
const weather: Record<string, number> = Object.fromEntries(weatherDays.map(d => [d.date, d.et0]))
const satMetaPath = new URL('../../app/public/data/sat_meta.json', import.meta.url)
export const satMeta = () => (existsSync(satMetaPath) ? JSON.parse(readFileSync(satMetaPath, 'utf8')) : null)

const farmerById = new Map(network.farmers.map(f => [f.id, f]))
const plotById = new Map(network.plots.map(p => [p.id, p]))
const wellById = new Map(network.wells.map(w => [w.id, w]))
const seguiaById = new Map(network.seguias.map(s => [s.id, s]))
const jebiaById = new Map(network.jebias.map(j => [j.id, j]))
const fullName = (f?: Farmer) => (f ? `${f.first} ${f.last}` : '?')
const T = (fr: string, en: string, ar = ''): Txt => ({ fr, en, ar: ar || fr })
const n0 = (v: number) => Math.round(v).toLocaleString('fr-FR').replace(/ /g, ' ')

// ---------- types of the S().live state ----------
export type ReportType = 'seguia_broken' | 'well_dry' | 'no_water' | 'leak'
export interface Alert {
  id: string
  kind: 'proactive' | 'reactive'
  severity: 'info' | 'warn' | 'crit'
  icon: 'heat' | 'salt' | 'limit' | 'rain' | 'well' | 'seguia' | 'leak' | 'swap' | 'sensor' | 'drop'
  date: string
  minute: number
  title: Txt
  detail: Txt
  /** what the system decided */
  decision: Txt
  source: 'forecast' | 'sensor' | 'report' | 'planner' | 'swap'
  resolved?: boolean
  photo?: string
}
export interface Report {
  id: string
  farmerId: string
  type: ReportType
  seguiaId: string | null
  date: string
  minute: number
  status: 'open' | 'resolved'
  photo?: string
}
export interface SwapReq {
  id: string
  from: string
  to: string
  plotA: string
  dateA: string
  plotB: string
  dateB: string
  status: 'pending' | 'accepted' | 'refused'
  date: string
  minute: number
}
export interface Notif { id: string; farmerId: string; kind: 'swap_request' | 'swap_answer' | 'replan' | 'report' | 'advice'; date: string; minute: number; text: Txt; swapId?: string }
export interface Proposal { id: string; date: string; minute: number; text: string; status: 'to_review' }

// ---------- S().clock (simulated, real weather day) ----------
export function now() {
  const abs = absMin(S().clock.date, S().clock.minute) + ((Date.now() - S().clock.real) / 60000) * S().clock.speed
  const di = Math.floor(abs / 1440)
  return { date: new Date(di * 86400000).toISOString().slice(0, 10), minute: abs - di * 1440, abs, speed: S().clock.speed }
}
export function setClock(p: { date?: string; minute?: number; speed?: number }) {
  const n = now()
  S().clock = { date: p.date ?? n.date, minute: p.minute ?? n.minute, real: Date.now(), speed: p.speed ?? S().clock.speed }
  S().live.version++
}
const stamp = () => {
  const n = now()
  return { date: n.date, minute: Math.floor(n.minute / CONFIG.stepMin) * CONFIG.stepMin }
}

// ---------- sessions: every visitor has their own demo ----------
// Reports, swaps and re-plans stay in the visitor's session, so one visitor cannot break the demo for the next.
// All sessions start from the same seed and are dropped every night.
interface Session {
  id: string
  clock: { date: string; minute: number; real: number; speed: number }
  live: ReturnType<typeof fresh>
  planCache: Map<string, DayPlan>
  admin: boolean
  showUnrecorded: boolean
  touched: number
}
const als = new AsyncLocalStorage<Session>()
const sessions = new Map<string, Session>()
let SEED: Alert[] = []
const newSession = (id: string): Session => ({
  id,
  clock: { date: CONFIG.demoDate, minute: CONFIG.demoMinute, real: Date.now(), speed: 1 },
  live: fresh(),
  planCache: new Map(),
  admin: false,
  showUnrecorded: false,
  touched: Date.now(),
})
let fallback: Session | null = null
const S = (): Session => als.getStore() ?? (fallback ??= newSession('public'))
const MAX_SESSIONS = 400
export function withSession<T>(id: string | undefined, fn: () => T): T {
  const key = id && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : 'public'
  let sess = sessions.get(key)
  if (!sess) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((a, b) => a.touched - b.touched)[0]
      sessions.delete(oldest.id)
    }
    sessions.set(key, (sess = newSession(key)))
  }
  sess.touched = Date.now()
  return als.run(sess, fn)
}
/** nightly reset: every visitor starts again from the seed */
export function resetAll() {
  sessions.clear()
  fallback = null
}
export const sessionCount = () => sessions.size

let seq = 0
const uid = (p: string) => `${p}${++seq}`
const fresh = () => ({
  version: 1,
  events: [] as PlanEvent[],
  alerts: SEED.map(a => ({ ...a })) as Alert[],
  log: [] as ReplanEntry[],
  reports: [] as Report[],
  swaps: [] as SwapReq[],
  notifs: [] as Notif[],
  proposals: [] as Proposal[],
  regularization: new Map<string, Set<string>>(history.regularization.map(r => [r.farmerId, new Set(r.done)])),
  heat: false,
  rain: false,
})

// ---------- plans ----------
const refCache = new Map<string, DayPlan>()
const allEvents = () => [...history.events, ...S().live.events]
const reference = (date: string) => {
  let p = refCache.get(date)
  if (!p) refCache.set(date, (p = planDay(date, { network, weather, events: [] })))
  return p
}
const basePlans = new Map<string, DayPlan>()
export function plan(date: string): DayPlan {
  const cache = S().live.events.length ? S().planCache : basePlans
  let p = cache.get(date)
  if (!p) cache.set(date, (p = annotate(planDay(date, { network, weather, events: allEvents() }), reference(date))))
  return p
}
const horizon = () => {
  const d = now().date
  return [0, 1, 2, 3].map(i => addDays(d, i))
}

/** state of the wells / seguias at this instant, from the events */
function world() {
  const t = now().abs
  const flow = new Map<string, number>()
  const ec = new Map<string, number>()
  const loss = new Map<string, number>()
  const factor = new Map<string, number>()
  for (const e of allEvents().sort((a, b) => absMin(a.date, a.minute) - absMin(b.date, b.minute))) {
    if (absMin(e.date, e.minute) > t) continue
    if (e.type === 'well_flow' && e.wellId) flow.set(e.wellId, e.flowLs ?? 0)
    if (e.type === 'ec' && e.wellId) ec.set(e.wellId, e.ecDs ?? 0)
    if (e.type === 'leak' && e.seguiaId) loss.set(e.seguiaId, e.extraLoss ?? 0)
    if (e.type === 'forecast' && e.et0Factor) for (const [d, f] of Object.entries(e.et0Factor)) factor.set(d, f)
  }
  return { flow, ec, loss, factor }
}

/** push events, re-plan, log what changed and why */
function replan(events: PlanEvent[], cause: Txt): ReplanEntry {
  const dates = horizon()
  const before = dates.map(plan)
  S().live.events.push(...events)
  S().planCache = new Map()
  const after = dates.map(plan)
  const changes = diffPlans(before, after)
  const s = stamp()
  const moved = changes.filter(c => c.before && c.after && c.after.start >= 0 && (c.after.start !== c.before.start || c.after.end !== c.before.end))
  const longer = changes.filter(c => c.before && c.after && c.after.target > c.before.target + 1)
  const shorter = changes.filter(c => c.before && c.after && c.after.target < c.before.target - 1)
  const avg = moved.length ? Math.round(moved.reduce((a, c) => a + (c.after!.end - c.before!.end), 0) / moved.length) : 0
  const pumped = after.map(p => Math.round(p.pumped))
  const entry: ReplanEntry = {
    id: uid('rp'),
    date: s.date,
    minute: s.minute,
    cause,
    changes,
    summary: T(
      `${changes.length} tour(s) re-planifié(s) : ${moved.length} décalé(s) (fin ${avg >= 0 ? '+' : ''}${avg} min en moyenne), ${longer.length} allongé(s), ${shorter.length} réduit(s). Pompage prévu ${n0(pumped[0])} m³ aujourd'hui, ${n0(pumped[1])} m³ demain (plafond ${n0(CONFIG.collectiveCap)}).`,
      `${changes.length} turn(s) re-planned: ${moved.length} shifted (end ${avg >= 0 ? '+' : ''}${avg} min on average), ${longer.length} lengthened, ${shorter.length} reduced. Planned pumping ${n0(pumped[0])} m³ today, ${n0(pumped[1])} m³ tomorrow (limit ${n0(CONFIG.collectiveCap)}).`,
    ),
  }
  S().live.log.unshift(entry)
  S().live.version++
  // tell the farmers whose turn changed
  const told = new Set<string>()
  for (const c of changes) {
    if (!c.after || told.has(c.farmerId)) continue
    told.add(c.farmerId)
    const off = dayIndex(c.date) - dayIndex(s.date)
    const dayAr = off === 0 ? 'اليوم' : off === 1 ? 'غدوة' : `بعد ${off} أيام`
    const dayFr = off === 0 ? "aujourd'hui" : off === 1 ? 'demain' : `dans ${off} jours`
    if (c.after.start < 0) continue
    notify(c.farmerId, 'replan', T(`Votre tour a changé : ${dayFr} ${hhmm(c.after.start)}–${hhmm(c.after.end)}.`, `Your turn changed: ${hhmm(c.after.start)}–${hhmm(c.after.end)}.`, `نوبتك تبدّلت: ${dayAr} من ${hhmm(c.after.start)} لـ ${hhmm(c.after.end)}`))
  }
  return entry
}
function notify(farmerId: string, kind: Notif['kind'], text: Txt, swapId?: string) {
  const s = stamp()
  S().live.notifs.unshift({ id: uid('n'), farmerId, kind, text, swapId, ...s })
}
function alert(a: Omit<Alert, 'id' | 'date' | 'minute'> & { date?: string; minute?: number }) {
  const s = stamp()
  const al: Alert = { id: uid('a'), date: a.date ?? s.date, minute: a.minute ?? s.minute, ...a }
  S().live.alerts.push(al)
  S().live.version++
  return al
}

// ---------- alerts that exist when the app opens ----------
function seedAlerts() {
  const D = CONFIG.demoDate
  // 1. sensors
  const hourDate = (i: number) => {
    const h = sensors.startHour + i
    return { date: new Date(Math.floor(h / 24) * 86400000).toISOString().slice(0, 10), minute: (((h % 24) + 24) % 24) * 60 }
  }
  const off = (24 - (((sensors.startHour % 24) + 24) % 24)) % 24 // align daily means on midnight
  for (const w of network.wells) {
    const s = sensors.wells[w.id]
    if (!s) continue
    const step = suddenStep(daily(s.level.slice(off)), 3, 1.5)
    if (step) {
      const when = hourDate(off + step.index * 24)
      const pub = w.recorded
      alert({
        kind: 'reactive', severity: 'warn', icon: 'drop', source: 'sensor', ...when, resolved: true,
        title: T(pub ? `${w.name} : niveau en chute de ${step.value.toFixed(1)} m` : `Un puits privé : niveau en chute de ${step.value.toFixed(1)} m`, pub ? `${w.name}: level dropped by ${step.value.toFixed(1)} m` : `A private well: level dropped by ${step.value.toFixed(1)} m`),
        detail: T(`Capteur de niveau : palier durable (${step.score.toFixed(0)} σ), débit −28 %.`, `Level sensor: lasting step (${step.score.toFixed(0)} σ), flow −28 %.`),
        decision: T('Propriétaire prévenu par SMS ; pompage conseillé ramené au besoin des cultures.', 'Owner warned by SMS; advised pumping reduced to the crop need.'),
      })
    }
    const tr = risingTrend(daily(s.ec.slice(off)), 10)
    if (tr) {
      const in7 = w.ecDs + tr.slope * 7
      alert({
        kind: 'proactive', severity: 'warn', icon: 'salt', source: 'sensor', date: D, minute: 6 * 60,
        title: T(`Salinité en hausse sur ${w.name} : +${tr.value.toFixed(2)} dS/m en 10 jours`, `Salinity rising on ${w.name}: +${tr.value.toFixed(2)} dS/m in 10 days`),
        detail: T(`EC ${w.ecDs.toFixed(1)} dS/m aujourd'hui, ${in7.toFixed(1)} dS/m dans 7 jours à ce rythme (tendance r² ${tr.score.toFixed(2)}).`, `EC ${w.ecDs.toFixed(1)} dS/m today, ${in7.toFixed(1)} dS/m in 7 days at this rate (trend r² ${tr.score.toFixed(2)}).`),
        decision: T('Fraction de lessivage recalculée dans chaque tour ; conseil de lessivage envoyé aux agriculteurs.', 'Leaching fraction recomputed in every turn; leaching advice sent to the farmers.'),
      })
    }
  }
  for (const j of network.jebias) {
    const s = sensors.jebias[j.id]
    const lk = s && leakBalance(s.level, s.inflow, s.outflow)
    if (lk)
      alert({
        kind: 'reactive', severity: 'warn', icon: 'leak', source: 'sensor', ...hourDate(lk.index), resolved: true,
        title: T(`${j.name} : fuite détectée (${Math.round(lk.value)} m³/h pendant ${lk.hours} h)`, `${j.name}: leak detected (${Math.round(lk.value)} m³/h for ${lk.hours} h)`),
        detail: T("L'eau entre mais le niveau ne suit pas (bilan entrée − sortie).", 'Water comes in but the level does not follow (inflow − outflow balance).'),
        decision: T('Inspection demandée au garde-canal ; remplissage limité à 70 % jusqu\'à réparation.', 'Inspection requested; filling limited to 70 % until repaired.'),
      })
  }
  // 2. history of reports
  for (const r of history.reports) {
    const f = farmerById.get(r.farmerId)
    const sg = seguiaById.get(r.seguiaId)?.name ?? ''
    const label = REPORT_LABEL[r.type]
    alert({
      kind: 'reactive', severity: 'info', icon: r.type === 'leak' ? 'leak' : 'seguia', source: 'report', date: r.date, minute: r.minute, resolved: true,
      title: T(`${label.fr} — ${sg} (signalé par ${fullName(f)})`, `${label.en} — ${sg} (reported by ${fullName(f)})`),
      detail: T('Signalement agriculteur.', 'Farmer report.'),
      decision:
        r.type === 'seguia_broken' ? T('Seguia fermée 3 h, tours décalés, volumes conservés.', 'Seguia closed for 3 h, turns shifted, volumes kept.')
        : r.type === 'leak' ? T('Pertes +15 % compensées par des lâchers plus longs jusqu\'à réparation.', 'Loss +15 % compensated by longer releases until repaired.')
        : T('Contrôle du garde-canal ; cause : fuite déjà signalée.', 'Checked by the water guard; cause: the leak already reported.'),
    })
  }
  const cut = history.events.find(e => e.type === 'well_flow' && e.flowLs === 0)
  if (cut) {
    const p = plan(cut.date)
    alert({
      kind: 'reactive', severity: 'crit', icon: 'well', source: 'sensor', date: cut.date, minute: cut.minute, resolved: true,
      title: cut.cause,
      detail: T('Débit nul mesuré sur les deux forages.', 'Zero flow measured on both boreholes.'),
      decision: T(
        `Tours servis sur le stock des jebias : palmiers d'abord (${Math.round(p.palmShare * 100)} % pour tous), sous-étage suspendu jusqu'au retour du courant.`,
        `Turns served from the jebias' storage: palms first (${Math.round(p.palmShare * 100)} % for everybody), understory suspended until power came back.`,
      ),
    })
  }
  // 3. forecast (real Open-Meteo values)
  const next = weatherDays.filter(d => d.date > D && d.date <= addDays(D, 3))
  const hot = next.reduce((a, b) => (b.tmax > a.tmax ? b : a), next[0])
  if (hot && hot.tmax >= 44) {
    const p = plan(addDays(D, 1))
    alert({
      kind: 'proactive', severity: 'info', icon: 'heat', source: 'forecast', date: D, minute: 5 * 60,
      title: T(`Chaleur : ${hot.tmax.toFixed(0)} °C prévus le ${hot.date.slice(8)}/${hot.date.slice(5, 7)}`, `Heat: ${hot.tmax.toFixed(0)} °C forecast on ${hot.date.slice(5)}`),
      detail: T(`ET0 ${next.map(d => d.et0.toFixed(1)).join(' / ')} mm sur 3 jours (Open-Meteo).`, `ET0 ${next.map(d => d.et0.toFixed(1)).join(' / ')} mm over 3 days (Open-Meteo).`),
      decision: T(`Les tours de demain couvrent déjà ce besoin : ${n0(p.pumped)} m³ sur ${n0(CONFIG.collectiveCap)} autorisés.`, `Tomorrow's turns already cover this need: ${n0(p.pumped)} m³ of the ${n0(CONFIG.collectiveCap)} allowed.`),
    })
  }
  // 4. the aquifer limit without TWIZA
  const sc = scenario()
  const base = sc.rows[0]
  if (base.crossMin != null)
    alert({
      kind: 'proactive', severity: 'crit', icon: 'limit', source: 'planner', date: D, minute: 7 * 60,
      title: T(`Sans TWIZA, la limite de la nappe est atteinte à ${hhmm(base.crossMin)}`, `Without TWIZA, the aquifer limit is reached at ${hhmm(base.crossMin)}`),
      detail: T(`Pompage estimé de la communauté ${n0(base.total)} m³/j pour une limite sûre de ${n0(sc.limit)} m³/j (${Math.round(base.pct)} %).`, `Estimated community pumping ${n0(base.total)} m³/d for a safe limit of ${n0(sc.limit)} m³/d (${Math.round(base.pct)} %).`),
      decision: T(`Réseau collectif plafonné à ${n0(CONFIG.collectiveCap)} m³/j ; adhésion proposée aux puits privés (voir le curseur de scénario).`, `Collective network capped at ${n0(CONFIG.collectiveCap)} m³/d; private wells invited to join (see the scenario slider).`),
    })
  S().live.version++
}

export const REPORT_LABEL: Record<ReportType, Txt> = {
  seguia_broken: T('Seguia cassée', 'Seguia broken', 'الساقية مكسورة'),
  well_dry: T('Puits à sec', 'Well dry', 'البير نشف'),
  no_water: T("Pas d'eau dans la seguia", 'No water in the seguia', 'ما فمّاش ماء في الساقية'),
  leak: T('Fuite', 'Leak', 'تسريب ماء'),
}

// ---------- scenario ----------
let scenarioCache: ReturnType<typeof buildScenario> | null = null
export function scenario() {
  if (!scenarioCache) {
    const d = CONFIG.demoDate
    scenarioCache = buildScenario(network, reference(d), weather[d] ?? 9, site, false)
  }
  return scenarioCache
}

// ---------- actions ----------
const mySeguia = (farmerId: string) => network.plots.find(p => p.farmerId === farmerId && p.kind === 'collective')?.seguiaId ?? null
const turnState = (t: Turn, n = now()) => {
  const off = dayIndex(t.date) - dayIndex(n.date)
  if (off > 0 || t.start < 0) return 'pending' as const
  if (off < 0) return 'done' as const
  return n.minute >= t.end ? ('done' as const) : n.minute >= t.start ? ('active' as const) : ('pending' as const)
}

export function report(farmerId: string, type: ReportType, photo?: string) {
  const f = farmerById.get(farmerId)
  if (!f) throw new Error('unknown farmer')
  const s = stamp()
  const sid = mySeguia(farmerId)
  const sg = sid ? seguiaById.get(sid)! : null
  const rep: Report = { id: uid('r'), farmerId, type, seguiaId: sid, ...s, status: 'open', photo }
  S().live.reports.unshift(rep)
  const label = REPORT_LABEL[type]
  const cause = T(`Signalement de ${fullName(f)} : ${label.fr.toLowerCase()}${sg ? ` (${sg.name})` : ''}`, `Report from ${fullName(f)}: ${label.en.toLowerCase()}${sg ? ` (${sg.name})` : ''}`, `بلاغ من ${f.firstAr}: ${label.ar}`)
  const ownWell = network.wells.find(w => w.ownerId === farmerId)
  let entry: ReplanEntry | null = null
  let decision: Txt
  let icon: Alert['icon'] = 'seguia'
  let title = T(`${label.fr} — ${sg?.name ?? ''} (signalé par ${fullName(f)})`, `${label.en} — ${sg?.name ?? ''} (reported by ${fullName(f)})`)
  if ((type === 'no_water' || type === 'seguia_broken') && sg) {
    const dur = type === 'no_water' ? CONFIG.blockNoWaterMin : CONFIG.blockBrokenMin
    entry = replan([{ id: uid('e'), type: 'block', ...s, seguiaId: sg.id, durationMin: dur, cause }], cause)
    const names = [...new Set(entry.changes.filter(c => c.date === s.date).map(c => farmerById.get(c.farmerId)?.first))].filter(Boolean)
    decision = T(
      `${sg.name} fermée ${dur} min (${hhmm(s.minute)}–${hhmm(s.minute + dur)}) pour ${type === 'no_water' ? 'contrôle' : 'réparation'} ; garde-canal prévenu. Tours décalés de +${dur} min, volumes conservés : ${names.join(', ') || '—'}.`,
      `${sg.name} closed for ${dur} min (${hhmm(s.minute)}–${hhmm(s.minute + dur)}) for ${type === 'no_water' ? 'a check' : 'repair'}; water guard warned. Turns shifted by +${dur} min, volumes kept: ${names.join(', ') || '—'}.`,
    )
  } else if (type === 'leak' && sg) {
    icon = 'leak'
    entry = replan([{ id: uid('e'), type: 'leak', ...s, seguiaId: sg.id, extraLoss: CONFIG.leakExtraLoss, cause }], cause)
    decision = T(
      `Pertes de ${sg.name} relevées de +${Math.round(CONFIG.leakExtraLoss * 100)} % ; lâchers allongés pour que chaque parcelle reçoive son besoin, dans la limite du plafond. Réparation demandée.`,
      `${sg.name} loss raised by +${Math.round(CONFIG.leakExtraLoss * 100)} %; releases lengthened so every plot still gets its need, within the limit. Repair requested.`,
    )
  } else if (type === 'well_dry' && ownWell) {
    // a private well: nothing about it is shown to the community unless it is recorded
    icon = 'well'
    S().live.events.push({ id: uid('e'), type: 'well_flow', ...s, wellId: ownWell.id, flowLs: 0, cause })
    title = ownWell.recorded ? T(`${ownWell.name} à sec (signalé par ${fullName(f)})`, `${ownWell.name} dry (reported by ${fullName(f)})`) : T('Un puits privé signalé à sec', 'A private well reported dry')
    decision = T('Puits privé : pas d\'effet sur le réseau collectif. Propriétaire orienté vers le GDA pour un appoint.', 'Private well: no effect on the collective network. Owner directed to the GDA for a top-up.')
  } else {
    // a member of the GDA: the borehole that feeds his side of the network
    icon = 'well'
    const wid = sid && ['s3', 's4'].includes(sid) ? 'f2' : 'f1'
    const w = wellById.get(wid)!
    entry = replan([{ id: uid('e'), type: 'well_flow', ...s, wellId: wid, flowLs: 0, cause }], cause)
    const t = plan(addDays(s.date, 1))
    title = T(`${w.name} à sec (signalé par ${fullName(f)})`, `${w.name} dry (reported by ${fullName(f)})`)
    decision = T(
      `Tours restants servis par l'autre forage et le stock des jebias. Demain : palmiers ${Math.round(t.palmShare * 100)} %, sous-étage ${Math.round(t.underShare * 100)} % pour tous (palmiers d'abord).`,
      `Remaining turns served by the other borehole and the jebias' storage. Tomorrow: palms ${Math.round(t.palmShare * 100)} %, understory ${Math.round(t.underShare * 100)} % for everybody (palms first).`,
    )
  }
  alert({ kind: 'reactive', severity: type === 'leak' ? 'warn' : 'crit', icon, source: 'report', title, detail: entry ? entry.summary : T('Signalement agriculteur.', 'Farmer report.'), decision, photo })
  notify(farmerId, 'report', T('Signalement reçu. Le planning a été recalculé.', 'Report received. The schedule was re-planned.', 'بلاغك وصل ✓ والنوبات تعاودت'))
  return rep
}

export function swapCandidates(farmerId: string) {
  const n = now()
  const mine = nextTurn(farmerId)
  if (!mine || turnState(mine, n) !== 'pending') return []
  const out: { farmerId: string; turn: Turn }[] = []
  for (const d of horizon())
    for (const t of plan(d).turns)
      if (t.seguiaId === mine.seguiaId && t.farmerId !== farmerId && turnState(t, n) === 'pending' && t.start >= 0 && !out.some(o => o.farmerId === t.farmerId))
        out.push({ farmerId: t.farmerId, turn: t })
  return out
}
function nextTurn(farmerId: string): Turn | null {
  const n = now()
  for (const d of horizon()) {
    const t = plan(d).turns.filter(t => t.farmerId === farmerId && turnState(t, n) !== 'done').sort((a, b) => a.start - b.start)[0]
    if (t) return t
  }
  return null
}

export function requestSwap(from: string, to: string) {
  const a = nextTurn(from)
  const b = swapCandidates(from).find(c => c.farmerId === to)?.turn
  if (!a || !b || turnState(a) !== 'pending') throw new Error('swap impossible')
  const f = farmerById.get(from)!
  const s = stamp()
  const req: SwapReq = { id: uid('sw'), from, to, plotA: a.plotId, dateA: a.date, plotB: b.plotId, dateB: b.date, status: 'pending', ...s }
  S().live.swaps.unshift(req)
  notify(to, 'swap_request', T(`${f.first} vous demande d'échanger votre tour (${hhmm(b.start)}) contre le sien (${hhmm(a.start)}).`, `${f.first} asks to swap turns.`, `${f.firstAr} يطلب يبدّل نوبتو معاك`), req.id)
  S().live.version++
  return req
}

export function answerSwap(id: string, accept: boolean) {
  const req = S().live.swaps.find(s => s.id === id)
  if (!req || req.status !== 'pending') throw new Error('unknown swap')
  const from = farmerById.get(req.from)!
  const to = farmerById.get(req.to)!
  if (!accept) {
    req.status = 'refused'
    notify(req.from, 'swap_answer', T(`${to.first} a refusé l'échange.`, `${to.first} refused the swap.`, `${to.firstAr} ما قبلش التبديل`), id)
    S().live.version++
    return req
  }
  const find = (plotId: string, date: string) => plan(date).turns.find(t => t.plotId === plotId)
  const a = find(req.plotA, req.dateA)
  const b = find(req.plotB, req.dateB)
  if (!a || !b || turnState(a) !== 'pending' || turnState(b) !== 'pending') {
    req.status = 'refused'
    S().live.version++
    throw new Error('one of the turns has already started')
  }
  req.status = 'accepted'
  const s = stamp()
  const cause = T(`Échange de tours accepté : ${from.first} ↔ ${to.first}`, `Turn swap accepted: ${from.first} ↔ ${to.first}`, `تبديل نوبة: ${from.firstAr} ↔ ${to.firstAr}`)
  const entry = replan([{ id: uid('e'), type: 'swap', ...s, swap: { plotA: req.plotA, dateA: req.dateA, plotB: req.plotB, dateB: req.dateB }, cause }], cause)
  const a2 = plan(req.dateB).turns.find(t => t.plotId === req.plotA)
  const b2 = plan(req.dateA).turns.find(t => t.plotId === req.plotB)
  alert({
    kind: 'reactive', severity: 'info', icon: 'swap', source: 'swap',
    title: cause,
    detail: entry.summary,
    decision: T(
      `Vérifié par le planificateur : ${from.first} passe ${a2 ? `le ${a2.date.slice(8)}/${a2.date.slice(5, 7)} à ${hhmm(a2.start)}` : ''}, ${to.first} ${b2 ? `le ${b2.date.slice(8)}/${b2.date.slice(5, 7)} à ${hhmm(b2.start)}` : ''}. Chacun garde son volume ; plafond respecté.`,
      `Checked by the planner: ${from.first} now irrigates ${a2 ? `on ${a2.date.slice(5)} at ${hhmm(a2.start)}` : ''}, ${to.first} ${b2 ? `on ${b2.date.slice(5)} at ${hhmm(b2.start)}` : ''}. Each keeps their volume; limit respected.`,
    ),
  })
  notify(req.from, 'swap_answer', T(`${to.first} a accepté l'échange.`, `${to.first} accepted the swap.`, `${to.firstAr} قبل التبديل ✓`), id)
  return req
}

// ---------- demo controls (stand in for the forecast feed and the sensors) ----------
export function demo(action: string) {
  const s = stamp()
  const D = s.date
  if (action === 'reset') {
    Object.assign(S(), newSession(S().id))
    return
  }
  if (action === 'heatwave') {
    const dates = [1, 2, 3].map(i => addDays(D, i))
    const cause = T(`Prévision : vague de chaleur, ET0 +${Math.round((CONFIG.heatWaveFactor - 1) * 100)} % pendant 3 jours`, `Forecast: heat wave, ET0 +${Math.round((CONFIG.heatWaveFactor - 1) * 100)} % for 3 days`, 'موجة سخانة جاية')
    const before = plan(dates[0])
    const entry = replan([{ id: uid('e'), type: 'forecast', ...s, et0Factor: Object.fromEntries(dates.map(d => [d, CONFIG.heatWaveFactor])), cause }], cause)
    const after = plan(dates[0])
    const palms = after.turns.filter(t => !plotById.get(t.plotId)?.under)
    const extra = palms.length ? Math.round(palms.reduce((a, t) => a + (t.end - t.start) - ((before.turns.find(b => b.id === t.id)?.end ?? 0) - (before.turns.find(b => b.id === t.id)?.start ?? 0)), 0) / palms.length) : 0
    S().live.heat = true
    alert({
      kind: 'proactive', severity: 'warn', icon: 'heat', source: 'forecast',
      title: cause,
      detail: entry.summary,
      decision: T(
        `Tours de demain allongés pour les palmiers (+${extra} min en moyenne, besoin servi à ${Math.round(after.palmShare * 100)} %). Sous-étage servi à ${Math.round(after.underShare * 100)} % pour rester sous le plafond : ${n0(after.pumped)} m³ sur ${n0(CONFIG.collectiveCap)}.`,
        `Tomorrow's turns lengthened for the palms (+${extra} min on average, need ${Math.round(after.palmShare * 100)} % served). Understory served at ${Math.round(after.underShare * 100)} % to stay under the limit: ${n0(after.pumped)} m³ of ${n0(CONFIG.collectiveCap)}.`,
      ),
    })
  } else if (action === 'rain') {
    const d1 = addDays(D, 1)
    const cause = T('Prévision : pluie demain', 'Forecast: rain tomorrow', 'المطر جاية غدوة')
    const before = horizon().map(plan).reduce((a, p) => a + p.released, 0)
    const entry = replan([{ id: uid('e'), type: 'forecast', ...s, et0Factor: { [d1]: CONFIG.rainFactor }, cause }], cause)
    const saved = before - horizon().map(plan).reduce((a, p) => a + p.released, 0)
    S().live.rain = true
    alert({
      kind: 'proactive', severity: 'info', icon: 'rain', source: 'forecast', title: cause, detail: entry.summary,
      decision: T(`Tours raccourcis ; ${n0(saved)} m³ économisés restent dans les jebias et dans la nappe.`, `Turns shortened; ${n0(saved)} m³ saved stay in the jebias and in the aquifer.`),
    })
  } else if (action === 'ec') {
    const w = wellById.get('f2')!
    const ec = +(w.ecDs + 1.3).toFixed(1)
    const cause = T(`Capteur : salinité du ${w.name} à ${ec} dS/m`, `Sensor: salinity of ${w.name} at ${ec} dS/m`, 'الملوحة طلعت')
    const entry = replan([{ id: uid('e'), type: 'ec', ...s, wellId: 'f2', ecDs: ec, cause }], cause)
    const t = plan(addDays(D, 1)).turns[0]
    alert({
      kind: 'proactive', severity: 'warn', icon: 'salt', source: 'sensor', title: cause, detail: entry.summary,
      decision: T(`Lessivage porté à ${Math.round((t?.leaching ?? 0) * 100)} % dans les tours à venir ; conseil « lessivage » envoyé.`, `Leaching raised to ${Math.round((t?.leaching ?? 0) * 100)} % in the coming turns; leaching advice sent.`),
    })
  } else if (action === 'welldry' || action === 'wellfix') {
    const w = wellById.get('f2')!
    const dry = action === 'welldry'
    const cause = dry ? T(`Capteur : ${w.name} à sec (débit nul)`, `Sensor: ${w.name} dry (zero flow)`, 'البير 2 نشف') : T(`${w.name} remis en service`, `${w.name} back in service`, 'البير 2 رجع يخدم')
    const entry = replan([{ id: uid('e'), type: 'well_flow', ...s, wellId: 'f2', flowLs: dry ? 0 : w.flowLs, cause }], cause)
    const t = plan(addDays(D, 1))
    alert({
      kind: 'reactive', severity: dry ? 'crit' : 'info', icon: 'well', source: 'sensor', title: cause, detail: entry.summary,
      decision: dry
        ? T(`Aujourd'hui : tours restants servis par le forage 1 et le stock des jebias. Demain : palmiers ${Math.round(t.palmShare * 100)} % pour tous, sous-étage ${Math.round(t.underShare * 100)} % (palmiers d'abord, manque réparti également).`, `Today: remaining turns served by borehole 1 and the jebias' storage. Tomorrow: palms ${Math.round(t.palmShare * 100)} % for everybody, understory ${Math.round(t.underShare * 100)} % (palms first, shortage spread evenly).`)
        : T('Planning normal rétabli.', 'Normal schedule restored.'),
    })
  } else if (action === 'repair') {
    // reopen every seguia: end the running closures and the leaks
    const evs: PlanEvent[] = []
    const w = world()
    for (const [sid, v] of w.loss) if (v > 0) evs.push({ id: uid('e'), type: 'leak', ...s, seguiaId: sid, extraLoss: 0, cause: T('Fuite réparée', 'Leak repaired') })
    S().live.events = S().live.events.filter(e => !(e.type === 'block' && absMin(e.date, e.minute) + (e.durationMin ?? 0) > now().abs))
    S().planCache = new Map()
    replan(evs, T('Réparations terminées', 'Repairs done', 'التصليح كمل'))
    for (const r of S().live.reports) r.status = 'resolved'
  } else throw new Error('unknown action')
}

export function startRegularization(farmerId: string, step: string, on: boolean) {
  const set = S().live.regularization.get(farmerId) ?? new Set<string>()
  if (on) set.add(step)
  else set.delete(step)
  S().live.regularization.set(farmerId, set)
  S().live.version++
}
export function addProposal(text: string) {
  const p: Proposal = { id: uid('pr'), ...stamp(), text, status: 'to_review' }
  S().live.proposals.unshift(p)
  S().live.version++
  return p
}

// ---------- read models ----------
// PRIVACY: an unrecorded well never leaves the server. Not its position, not its plot, not its name, not its
// own volume. The dashboard only gets counts, zone totals and hexagon aggregates.
// The only exception is the "Admin / CRDA demo" mode, where a layer of JITTERED points can be requested
// (see unrecordedZone below): the frontend never receives a real coordinate, in any mode.
const publicWell = (w: (typeof network.wells)[number]) => w.recorded
const publicPlot = (p: (typeof network.plots)[number]) => p.kind === 'collective' || (p.wellId != null && publicWell(wellById.get(p.wellId)!))

export function setAdmin(on: boolean) {
  S().admin = on
  if (!on) S().showUnrecorded = false
  S().live.version++
}
export function setUnrecordedLayer(on: boolean) {
  if (!S().admin) throw new Error('admin mode required')
  S().showUnrecorded = on
  S().live.version++
}
// each unrecorded well is moved 300-500 m in a fixed random direction. The salt lives only in this process,
// and the offset is stable, so repeated requests cannot be averaged to recover the real position.
const SALT = randomBytes(16).toString('hex')
const HIDDEN = network.wells.filter(w => !w.recorded)
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 111320)
const JITTER = HIDDEN.map(w => {
  // try directions until the blurred point is at least 300 m away from EVERY real unrecorded well, not only its own
  let best = { sort: 0, lon: 0, lat: 0, clear: -1 }
  for (let k = 0; k < 64; k++) {
    const h = createHash('sha256').update(`${SALT}:${w.id}:${k}`).digest()
    const angle = (h.readUInt32BE(0) / 2 ** 32) * 2 * Math.PI
    const dist = 300 + (h.readUInt32BE(4) / 2 ** 32) * 200
    const p = { lat: +(w.lat + (dist * Math.cos(angle)) / 111320).toFixed(5), lon: +(w.lon + (dist * Math.sin(angle)) / (111320 * Math.cos((w.lat * Math.PI) / 180))).toFixed(5) }
    const clear = Math.min(...HIDDEN.map(x => metres(p, x)))
    if (clear > best.clear) best = { sort: h.readUInt32BE(8), ...p, clear }
    if (clear >= 300) break
  }
  return best
}).sort((a, b) => a.sort - b.sort).map((p, i) => ({ id: `zone-${i + 1}`, lon: p.lon, lat: p.lat }))
/** admin mode only, layer switched on only: blurred positions, no identity, no per-well volume */
export function unrecordedZone() {
  if (!S().admin || !S().showUnrecorded) return null
  return { blurred: true, jitterM: [300, 500], points: JITTER }
}

/** static description of the network — only what the community may see */
export function publicNetwork() {
  return {
    synthetic: true,
    site: { ...SITE, center: site },
    config: { cap: CONFIG.collectiveCap, limit: CONFIG.safeDailyLimit, rotationDays: CONFIG.rotationDays, efficiency: CONFIG.efficiency, demoDate: CONFIG.demoDate },
    crops: CROPS,
    farmers: network.farmers.map(f => ({ id: f.id, first: f.first, last: f.last, firstAr: f.firstAr, lastAr: f.lastAr, lang: f.lang, smartphone: f.smartphone })),
    plots: network.plots.filter(publicPlot).map(p => ({ id: p.id, farmerId: p.farmerId, kind: p.kind, areaHa: p.areaHa, under: p.under, underShare: p.underShare, seguiaId: p.seguiaId, branchId: p.branchId, wellId: p.wellId, polygon: p.polygon, centroid: p.centroid })),
    wells: network.wells.filter(publicWell).map(w => ({ id: w.id, name: w.name, type: w.type, recorded: w.recorded, flowLs: w.flowLs, depthM: w.depthM, lon: w.lon, lat: w.lat })),
    /** aggregate only */
    wellCounts: { total: network.wells.length, recorded: network.wells.filter(w => w.recorded).length },
    jebias: network.jebias,
    seguias: network.seguias,
    sat: satMeta(),
  }
}

const delivered = (t: Turn, n = now()) => {
  const st = turnState(t, n)
  if (st === 'done') return t.delivered
  if (st === 'active' && t.end > t.start) return (t.delivered * (n.minute - t.start)) / (t.end - t.start)
  return 0
}

function weekly() {
  const n = now()
  const rows = new Map<string, { farmerId: string; need: number; got: number; turns: number }>()
  for (let i = -6; i <= 0; i++)
    for (const t of plan(addDays(n.date, i)).turns) {
      if (turnState(t, n) !== 'done') continue
      const r = rows.get(t.farmerId) ?? { farmerId: t.farmerId, need: 0, got: 0, turns: 0 }
      r.need += t.needPalm + t.needUnder
      r.got += t.delivered
      r.turns++
      rows.set(t.farmerId, r)
    }
  return [...rows.values()].map(r => ({ ...r, name: fullName(farmerById.get(r.farmerId)), need: Math.round(r.need), got: Math.round(r.got), pct: r.need > 0 ? +((r.got / r.need) * 100).toFixed(1) : 100 })).sort((a, b) => a.pct - b.pct)
}

function kpis() {
  const n = now()
  const p = plan(n.date)
  const week = weekly()
  const x = week.map(r => Math.min(100, r.pct))
  const jain = x.length ? x.reduce((a, b) => a + b, 0) ** 2 / (x.length * x.reduce((a, b) => a + b * b, 0)) : 1
  const step = Math.min(288, Math.floor(n.minute / CONFIG.stepMin))
  const pumpedNow = p.pumpedCum[step] + ((p.pumpedCum[Math.min(288, step + 1)] - p.pumpedCum[step]) * (n.minute - step * CONFIG.stepMin)) / CONFIG.stepMin
  const needWeek = week.reduce((a, r) => a + r.need, 0)
  const gotWeek = week.reduce((a, r) => a + r.got, 0)
  return {
    needToday: Math.round(p.need),
    plannedToday: Math.round(p.delivered),
    deliveredNow: Math.round(p.turns.reduce((a, t) => a + delivered(t, n), 0)),
    needWeek,
    gotWeek,
    servedWeekPct: needWeek ? +((gotWeek / needWeek) * 100).toFixed(1) : 100,
    fairness: +jain.toFixed(3),
    minPct: x.length ? Math.min(...x) : 100,
    maxPct: x.length ? Math.max(...x) : 100,
    below: week.filter(r => r.pct < 97).length,
    lossPct: p.released ? +((1 - p.delivered / p.released) * 100).toFixed(1) : 0,
    lostToday: Math.round(p.released - p.delivered),
    pumpedNow: Math.round(pumpedNow),
    pumpedPlanned: Math.round(p.pumped),
    cap: p.cap,
    farmersActive: network.farmers.filter(f => f.active).length,
    farmersTotal: network.farmers.length,
    regularizationFiles: [...S().live.regularization.values()].filter(s => s.size > 0).length,
    turnsToday: p.turns.length,
    turnsDone: p.turns.filter(t => turnState(t, n) === 'done').length,
  }
}

const slim = (p: DayPlan, full: boolean) => ({ ...p, pumpedCum: full ? p.pumpedCum.map(Math.round) : [], jebiaLevels: full ? Object.fromEntries(Object.entries(p.jebiaLevels).map(([k, v]) => [k, v.map(Math.round)])) : {} })

export function liveState() {
  const n = now()
  const w = world()
  const today = plan(n.date)
  const step = Math.min(288, Math.floor(n.minute / CONFIG.stepMin))
  return {
    version: S().live.version,
    now: { date: n.date, minute: Math.floor(n.minute), speed: n.speed, hhmm: hhmm(n.minute) },
    weather: weatherDays.filter(d => d.date >= addDays(n.date, -1) && d.date <= addDays(n.date, 4)).map(d => ({ ...d, factor: w.factor.get(d.date) ?? 1 })),
    plans: horizon().slice(0, 3).map((d, i) => slim(plan(d), i === 0)),
    jebias: network.jebias.map(j => ({ id: j.id, level: Math.round(today.jebiaLevels[j.id][step]), capacity: j.capacityM3 })),
    seguias: network.seguias.map(s => {
      const b = today.blocks.find(b => b.seguiaId === s.id && n.minute >= b.from && n.minute < b.to)
      const active = today.turns.find(t => t.seguiaId === s.id && turnState(t, n) === 'active')
      return { id: s.id, blockedUntil: b ? b.to : null, extraLoss: w.loss.get(s.id) ?? 0, flow: active && !b ? s.capacityM3h : 0, activeTurnId: active?.id ?? null }
    }),
    wells: network.wells.filter(publicWell).map(x => {
      const flow = w.flow.get(x.id) ?? x.flowLs
      const s = sensors.wells[x.id]
      return { id: x.id, flowLs: flow, ecDs: w.ec.get(x.id) ?? x.ecDs, levelM: s ? s.level[s.level.length - 1] : x.levelM, status: flow <= 0 ? 'dry' : 'ok' }
    }),
    alerts: [...S().live.alerts].sort((a, b) => absMin(b.date, b.minute) - absMin(a.date, a.minute) || (a.id < b.id ? 1 : -1)),
    log: S().live.log.slice(0, 15),
    reports: S().live.reports.map(r => ({ ...r, photo: undefined, hasPhoto: !!r.photo })),
    swaps: S().live.swaps,
    proposals: S().live.proposals,
    kpis: kpis(),
    weekly: weekly(),
    flags: { heat: S().live.heat, rain: S().live.rain },
    admin: S().admin,
    unrecordedLayer: S().admin && S().showUnrecorded,
    unrecorded: { count: network.wells.filter(w => !w.recorded).length },
  }
}

export function trends() {
  const off = (24 - (((sensors.startHour % 24) + 24) % 24)) % 24
  const days = Math.floor((sensors.hours - off) / 24)
  const dates = Array.from({ length: days }, (_, i) => new Date(Math.floor((sensors.startHour + off + i * 24) / 24) * 86400000).toISOString().slice(0, 10))
  const d = (id: string, k: 'level' | 'ec') => daily(sensors.wells[id][k].slice(off)).map(v => +v.toFixed(2))
  return {
    dates,
    wells: network.wells.filter(publicWell).map(w => {
      const level = d(w.id, 'level')
      const ec = d(w.id, 'ec')
      return { id: w.id, name: w.name, type: w.type, level, ec, drop: !!suddenStep(level, 3, 1.5), rising: !!risingTrend(ec, 10) }
    }),
  }
}

interface MyWell {
  name: string; recorded: boolean; depthM: number; flowLs: number; ecDs: number; levelM: number; health: 'good' | 'warn' | 'bad'
  level48: number[]; ec48: number[]; flow48: number[]
  advisedHours: number | null; advisedM3: number | null; traditionalM3: number | null; dropM: number | null
}
function viewTurn(t: Turn, farmerId: string, n: ReturnType<typeof now>) {
  const o = farmerById.get(t.farmerId)!
  return {
    id: t.id, farmerId: t.farmerId, first: o.first, firstAr: o.firstAr, date: t.date, dayOffset: dayIndex(t.date) - dayIndex(n.date),
    start: t.start, end: t.end, m3: Math.round(t.target), deliveredM3: Math.round(t.delivered), state: turnState(t, n), me: t.farmerId === farmerId, flags: t.flags,
    extraMin: t.start >= 0 ? Math.round(((t.target - t.baseTarget) / seguiaById.get(t.seguiaId)!.capacityM3h) * 12) * 5 : 0, underShare: t.underShare, palmShare: t.palmShare, leaching: t.leaching, travelMin: t.travelMin,
  }
}
type TurnView = ReturnType<typeof viewTurn>

// ---------- farmer view ----------
export function farmerView(farmerId: string) {
  const f = farmerById.get(farmerId)
  if (!f) return null
  const n = now()
  const w = world()
  const plots = network.plots.filter(p => p.farmerId === farmerId)
  const next = nextTurn(farmerId)
  const sid = next?.seguiaId ?? mySeguia(farmerId)
  const seguia = sid ? seguiaById.get(sid)! : null
  const jebia = seguia ? jebiaById.get(seguia.jebiaId)! : null
  const today = plan(n.date)
  const view = (t: Turn) => viewTurn(t, farmerId, n)
  const timeline = seguia ? today.turns.filter(t => t.seguiaId === seguia.id).sort((a, b) => (a.start < 0 ? 9999 : a.start) - (b.start < 0 ? 9999 : b.start)).map(view) : []
  const active = timeline.find(t => t.state === 'active') ?? null
  const block = seguia ? today.blocks.find(b => b.seguiaId === seguia.id && n.minute >= b.from && n.minute < b.to) : null
  const nx = next ? view(next) : null
  const status = !nx ? 'none' : nx.state === 'active' ? 'now' : nx.dayOffset === 0 ? 'today' : 'later'
  const countdownMin = nx && nx.start >= 0 ? Math.max(0, Math.round(absMin(nx.date, nx.state === 'active' ? nx.end : nx.start) - n.abs)) : null

  // my well (private): only its owner sees it
  const well = network.wells.find(x => x.ownerId === farmerId)
  let myWell: MyWell | null = null
  if (well) {
    const s = sensors.wells[well.id]
    const flow = w.flow.get(well.id) ?? well.flowLs
    const plot = plots.find(p => p.wellId === well.id)
    const et0 = (weather[n.date] ?? 9) * (w.factor.get(n.date) ?? 1)
    const pp = plot ? privatePlan(plot, { flowLs: Math.max(0.1, flow), ecDs: well.ecDs }, et0) : null
    const lv = s.level.slice(-48)
    const drop = suddenStep(daily(s.level.slice(-24 * 14)), 3, 1.5)
    const health: MyWell['health'] = flow <= 0 ? 'bad' : drop || well.ecDs >= 5.5 ? 'warn' : 'good'
    myWell = {
      name: well.name, recorded: well.recorded, depthM: well.depthM, flowLs: flow, ecDs: well.ecDs, levelM: lv[lv.length - 1], health,
      level48: lv, ec48: s.ec.slice(-48), flow48: s.flow.slice(-48),
      advisedHours: pp ? +pp.hours.toFixed(1) : null, advisedM3: pp ? Math.round(pp.need) : null, traditionalM3: pp ? Math.round(pp.traditional) : null,
      dropM: drop ? +drop.value.toFixed(1) : null,
    }
  }
  const neighbour = active && !active.me ? active : null
  return {
    version: S().live.version,
    synthetic: true,
    now: { date: n.date, minute: Math.floor(n.minute), hhmm: hhmm(n.minute) },
    farmer: { id: f.id, first: f.first, last: f.last, firstAr: f.firstAr, lastAr: f.lastAr, lang: f.lang, smartphone: f.smartphone },
    plots: plots.map(p => ({ id: p.id, kind: p.kind, areaHa: p.areaHa, under: p.under })),
    seguia: seguia ? { id: seguia.id, n: seguia.id.slice(1), name: seguia.name, blockedUntil: block ? block.to : null, leak: (w.loss.get(seguia.id) ?? 0) > 0 } : null,
    jebia: jebia ? { id: jebia.id, n: jebia.id.slice(1), name: jebia.name } : null,
    status,
    next: nx,
    countdownMin,
    neighbour,
    timeline,
    advice: advice(farmerId, nx, myWell),
    candidates: swapCandidates(farmerId).map(c => ({ ...view(c.turn) })),
    swapsIn: S().live.swaps.filter(s => s.to === farmerId && s.status === 'pending').map(s => ({ ...s, first: farmerById.get(s.from)!.first, firstAr: farmerById.get(s.from)!.firstAr })),
    swapsOut: S().live.swaps.filter(s => s.from === farmerId).slice(0, 3).map(s => ({ ...s, first: farmerById.get(s.to)!.first, firstAr: farmerById.get(s.to)!.firstAr })),
    reports: S().live.reports.filter(r => r.farmerId === farmerId).map(r => ({ id: r.id, type: r.type, date: r.date, minute: r.minute, status: r.status })),
    notifs: S().live.notifs.filter(x => x.farmerId === farmerId).slice(0, 6),
    myWell,
    regularization: { needed: !!well && !well.recorded, done: [...(S().live.regularization.get(farmerId) ?? [])] },
    sms: sms(f, nx, neighbour, jebia?.id.slice(1) ?? '', block ? block.to : null),
  }
}

function sms(f: Farmer, nx: TurnView | null, neighbour: { first: string } | null, jebia: string, blockedUntil: number | null) {
  // Latin-script derja: works on every feature phone
  if (!nx) return 'TWIZA: Ma 3andekch nouba el jem3a hedhi.'
  const day = nx.state === 'active' ? 'Tawa' : nx.dayOffset === 0 ? 'Lyoum' : nx.dayOffset === 1 ? 'Ghodwa' : `Ba3d ${nx.dayOffset} ayam`
  let s = `TWIZA: ${day} ${hhmm(nx.start)}-${hhmm(nx.end)} Jebia ${jebia}, ${nx.m3} m3.`
  if (neighbour) s += ` Jarek ${neighbour.first} tawa.`
  if (blockedUntil != null) s += ` Seguia msakra 7atta ${hhmm(blockedUntil)}.`
  if (nx.extraMin >= 10) s += ` S5ana: +${nx.extraMin} d9.`
  return s
}

// ---------- advice: rules produce structured advice, text is templated (LLM may rephrase) ----------
export interface Advice { id: string; icon: 'heat' | 'salt' | 'rain' | 'short' | 'well' | 'tip'; key: string; n: Record<string, number | string>; ar: string; fr: string; llm?: boolean }
const polished = new Map<string, { ar: string; fr: string }>()
export const adviceSignature = (a: Advice) => `${a.key}:${JSON.stringify(a.n)}`
export function setPolished(sig: string, text: { ar: string; fr: string }) {
  polished.set(sig, text)
  S().live.version++
}
export const hasPolished = (sig: string) => polished.has(sig)

function advice(farmerId: string, nx: TurnView | null, myWell: MyWell | null): Advice[] {
  const out: Advice[] = []
  const w = world()
  const n = now()
  const add = (a: Omit<Advice, 'id'>) => out.push({ id: `${farmerId}-${a.key}`, ...a })
  const factor = nx ? Math.max(...[0, 1, 2].map(i => w.factor.get(addDays(nx.date, i)) ?? 1)) : 1
  const minFactor = nx ? Math.min(...[0, 1, 2].map(i => w.factor.get(addDays(nx.date, i)) ?? 1)) : 1
  const dayAr = !nx ? '' : nx.dayOffset === 0 ? 'اليوم' : nx.dayOffset === 1 ? 'غدوة' : `بعد ${nx.dayOffset} أيام`
  const dayFr = !nx ? '' : nx.dayOffset === 0 ? "aujourd'hui" : nx.dayOffset === 1 ? 'demain' : `dans ${nx.dayOffset} jours`
  const heat = !!nx && factor > 1.05
  const pct = nx ? Math.round(nx.underShare * 100) : 100
  const more = Math.round((factor - 1) * 100)
  if (nx && heat && nx.underShare >= 0.99 && nx.extraMin >= 5)
    add({ icon: 'heat', key: 'heat', n: { min: nx.extraMin, day: nx.dayOffset }, ar: `سخانة قويّة جاية: نوبتك ${dayAr} أطول بـ ${nx.extraMin} دقيقة`, fr: `Vague de chaleur : votre tour de ${dayFr} dure ${nx.extraMin} min de plus.` })
  else if (nx && heat && nx.underShare < 0.99)
    add({ icon: 'heat', key: 'heatshort', n: { more, pct, day: nx.dayOffset }, ar: `سخانة قويّة جاية: النخل ياخذ ${more}٪ ماء زايد ${dayAr}، والخضرة تحت النخل ${pct}٪ برك باش الماء يكفي الناس الكل`, fr: `Vague de chaleur : ${dayFr} vos palmiers reçoivent ${more} % d'eau en plus, les cultures sous palmiers ${pct} % seulement pour que l'eau suffise à tous.` })
  if (nx && minFactor < 0.95 && nx.extraMin <= -5)
    add({ icon: 'rain', key: 'rain', n: { min: -nx.extraMin, day: nx.dayOffset }, ar: `المطر جاية: نوبتك ${dayAr} أقصر بـ ${-nx.extraMin} دقيقة، والماء الباقي يقعد في الجابية`, fr: `Pluie prévue : votre tour de ${dayFr} est raccourci de ${-nx.extraMin} min, l'eau économisée reste dans la jebia.` })
  if (nx && !heat && nx.underShare < 0.99)
    add({ icon: 'short', key: 'short', n: { pct }, ar: `الماء ناقص: النخل ياخذ حقّو كامل، والخضرة تحت النخل ${pct}٪`, fr: `Eau limitée : les palmiers reçoivent tout leur besoin, les cultures sous palmiers ${pct} %.` })
  const ec = myWell ? myWell.ecDs : nx ? collectiveEcNow(w) : 0
  const lr = nx ? Math.round(nx.leaching * 100) : 0
  if (nx && !myWell && (ec >= 3.2 || lr >= 10))
    add({ icon: 'salt', key: 'salt', n: { ec: +ec.toFixed(1), lr }, ar: `الماء مالح (${ec.toFixed(1)}): نوبتك فيها ${lr}٪ ماء زايد باش يغسل الملح — عبّي الحوض كامل`, fr: `Eau salée (${ec.toFixed(1)} dS/m) : votre tour inclut ${lr} % d'eau en plus pour lessiver le sel — remplissez toute la cuvette.` })
  if (myWell && myWell.ecDs >= 4.5)
    add({ icon: 'salt', key: 'saltwell', n: { ec: +myWell.ecDs.toFixed(1) }, ar: `ماء بيرك مالح (${myWell.ecDs.toFixed(1)}): زيد سقية غسيل للتربة الجمعة هاذي`, fr: `L'eau de votre puits est salée (${myWell.ecDs.toFixed(1)} dS/m) : ajoutez un arrosage de lessivage cette semaine.` })
  if (myWell?.advisedHours != null && myWell.traditionalM3 && myWell.advisedM3)
    add({ icon: 'well', key: 'pump', n: { h: myWell.advisedHours, save: myWell.traditionalM3 - myWell.advisedM3 }, ar: `بيرك: ${fmtHoursAr(myWell.advisedHours)} ضخّ تكفي اليوم — تربح ${myWell.traditionalM3 - myWell.advisedM3} م³`, fr: `Votre puits : ${fmtHoursFr(myWell.advisedHours)} de pompage suffisent aujourd'hui — ${myWell.traditionalM3 - myWell.advisedM3} m³ économisés.` })
  if (out.length < 2 && nx && nx.state !== 'active')
    nx.travelMin >= 5
      ? add({ icon: 'tip', key: 'tip', n: { min: nx.travelMin }, ar: `الماء يوصل لأرضك ${nx.travelMin} دقيقة بعد ما تتحلّ الساقية — حضّر الأحواض قبل`, fr: `L'eau arrive ${nx.travelMin} min après l'ouverture de la seguia : préparez vos cuvettes avant.` })
      : add({ icon: 'tip', key: 'tip0', n: { m3: nx.m3 }, ar: `نوبتك فيها ${nx.m3} م³: نقّي الساقية وحضّر الأحواض قبل ما يجي الماء`, fr: `Votre tour apporte ${nx.m3} m³ : nettoyez la seguia et préparez les cuvettes avant l'arrivée de l'eau.` })
  void n
  return out.slice(0, 3).map(a => {
    const p = polished.get(adviceSignature(a))
    return p ? { ...a, ...p, llm: true } : a
  })
}
const fmtHoursAr = (h: number) => `${Math.floor(h)} س${Math.round((h % 1) * 60) ? ` و ${Math.round((h % 1) * 60)} دق` : ''}`
const fmtHoursFr = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
function collectiveEcNow(w: ReturnType<typeof world>) {
  const g = network.wells.filter(x => x.type === 'gda')
  const q = g.reduce((s, x) => s + (w.flow.get(x.id) ?? x.flowLs), 0)
  return q > 0 ? g.reduce((s, x) => s + (w.flow.get(x.id) ?? x.flowLs) * (w.ec.get(x.id) ?? x.ecDs), 0) / q : 3.3
}

// ---------- read-only tools for the assistant ----------
export const tools = {
  schedule(date?: string, seguia?: string) {
    const n = now()
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : n.date
    const p = plan(d)
    return {
      date: d, et0_mm: +(p.et0 * p.et0Factor).toFixed(1), pumped_m3: Math.round(p.pumped), limit_m3: p.cap,
      turns: p.turns.filter(t => !seguia || t.seguiaId === seguia || seguiaById.get(t.seguiaId)?.name.toLowerCase() === seguia.toLowerCase()).map(t => ({
        farmer: fullName(farmerById.get(t.farmerId)), seguia: seguiaById.get(t.seguiaId)?.name, start: t.start < 0 ? null : hhmm(t.start), end: t.end < 0 ? null : hhmm(t.end),
        volume_m3: Math.round(t.target), need_met_pct: Math.round((t.delivered / Math.max(1, t.needPalm + t.needUnder)) * 100), state: turnState(t, n), flags: t.flags, reason: t.reason.fr,
      })),
    }
  },
  weeklyDeficits() {
    const all = weekly()
    return { period: `${addDays(now().date, -6)} → ${now().date}`, farmers: all.length, below_need: all.filter(r => r.pct < 97).map(r => ({ farmer: r.name, need_m3: r.need, received_m3: r.got, pct: r.pct, missing_m3: r.need - r.got })), causes: history.events.filter(e => e.type !== 'block' && (e.flowLs === 0 || (e.extraLoss ?? 0) > 0)).map(e => `${e.date} ${hhmm(e.minute)} — ${e.cause.fr}`) }
  },
  wells() {
    const w = world()
    return {
      recorded: network.wells.filter(publicWell).map(x => ({ name: x.name, type: x.type, flow_ls: w.flow.get(x.id) ?? x.flowLs, ec_ds_m: w.ec.get(x.id) ?? x.ecDs, level_m: sensors.wells[x.id].level.slice(-1)[0], depth_m: x.depthM })),
      unrecorded: { count: network.wells.filter(x => !x.recorded).length, note: 'Agrégé uniquement : aucun puits non déclaré n\'est localisé ni nommé.' },
    }
  },
  alerts() {
    return liveState().alerts.slice(0, 12).map(a => ({ kind: a.kind, when: `${a.date} ${hhmm(a.minute)}`, title: a.title.fr, decision: a.decision.fr, resolved: !!a.resolved }))
  },
  kpis() {
    return { ...kpis(), scenario: scenario().rows.filter(r => [0, 35, 70, 100].includes(r.share)), safe_limit_m3_day: CONFIG.safeDailyLimit }
  },
  farmer(name: string) {
    const q = name.toLowerCase()
    const f = network.farmers.find(x => `${x.first} ${x.last}`.toLowerCase().includes(q) || x.first.toLowerCase() === q || x.firstAr === name)
    if (!f) return { error: 'unknown farmer' }
    const t = nextTurn(f.id)
    const wk = weekly().find(r => r.farmerId === f.id)
    return { farmer: fullName(f), plots: network.plots.filter(p => p.farmerId === f.id && publicPlot(p)).map(p => ({ area_ha: p.areaHa, understory: p.under, seguia: p.seguiaId ? seguiaById.get(p.seguiaId)!.name : null })), next_turn: t ? { date: t.date, start: hhmm(t.start), end: hhmm(t.end), volume_m3: Math.round(t.target), reason: t.reason.fr } : null, week: wk ?? null }
  },
  /** exact first-name match, Latin or Arabic script */
  findFarmer(words: string[]) {
    const w = new Set(words.map(x => x.toLowerCase()))
    const f = network.farmers.find(x => w.has(x.first.toLowerCase()) || w.has(x.firstAr) || w.has(x.firstAr.replace(/^ال/, '')))
    return f ? `${f.first} ${f.last}` : null
  },
  replanLog() {
    return S().live.log.slice(0, 8).map(l => ({ when: `${l.date} ${hhmm(l.minute)}`, cause: l.cause.fr, summary: l.summary.fr }))
  },
}

// the alerts every visitor starts with are computed once
{
  const tmp = newSession('seed')
  als.run(tmp, seedAlerts)
  SEED = tmp.live.alerts
}
