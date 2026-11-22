// TWIZA — synthetic data generator (seeded, deterministic).
//   npm run gen
// Everything written here is SYNTHETIC, except weather.json (Open-Meteo).
// The layout is drawn in a local frame (metres) and placed on the map with
// data/site.json (centre + bearing), so it can be moved onto a real palm grove.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from '../server/src/config.js'
import { addDays, dayIndex, planDay } from '../server/src/planner.js'
import type { Farmer, Jebia, Network, PlanEvent, Plot, Seguia, Well } from '../server/src/types.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const SEED = 20261122

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(SEED)
const U = (a: number, b: number) => a + (b - a) * rnd()
const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

// ---------- site ----------
const sitePath = join(DIR, 'site.json')
const site: { lat: number; lon: number; bearingDeg: number } = existsSync(sitePath)
  ? JSON.parse(readFileSync(sitePath, 'utf8'))
  : { lat: 33.7905, lon: 8.862, bearingDeg: 0 }
const B = (site.bearingDeg * Math.PI) / 180
const ll = (x: number, y: number): [number, number] => {
  const xr = x * Math.cos(B) + y * Math.sin(B)
  const yr = -x * Math.sin(B) + y * Math.cos(B)
  return [r2(site.lon + xr / (111320 * Math.cos((site.lat * Math.PI) / 180)), 6), r2(site.lat + yr / 111320, 6)]
}
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]

const weather: Record<string, number> = Object.fromEntries(
  (JSON.parse(readFileSync(join(DIR, 'weather.json'), 'utf8')).days as { date: string; et0: number }[]).map(d => [d.date, d.et0]),
)

// ---------- network ----------
const SECTOR_W = 226
const jebias: Jebia[] = []
const seguias: Seguia[] = []
interface Draft extends Omit<Plot, 'farmerId' | 'order' | 'group' | 'polygon' | 'centroid'> {
  box: [number, number, number, number]
}
const drafts: Draft[] = []
let pid = 0
const newPlot = (d: Omit<Draft, 'id' | 'areaHa'>): Draft => {
  const [x0, y0, x1, y1] = d.box
  const p = { ...d, id: `p${String(++pid).padStart(2, '0')}`, areaHa: r2(((x1 - x0) * (y1 - y0)) / 10000) }
  drafts.push(p)
  return p
}
const crop = (): Pick<Plot, 'under' | 'underShare'> => {
  const u = rnd()
  if (u < 0.33) return { under: null, underShare: 0 }
  return { under: u < 0.7 ? 'vegetables' : 'alfalfa', underShare: r2(U(0.3, 0.6)) }
}

for (let s = 0; s < 4; s++) {
  const cx = (s - 1.5) * SECTOR_W
  const jid = `j${s + 1}`
  const sid = `s${s + 1}`
  const [jlon, jlat] = ll(cx, 348)
  jebias.push({ id: jid, name: `Jebia ${s + 1}`, capacityM3: [2000, 2200, 1900, 2100][s], lon: jlon, lat: jlat })
  seguias.push({
    id: sid,
    name: `Seguia ${s + 1}`,
    jebiaId: jid,
    capacityM3h: 216,
    main: { lengthM: 335, lossPerKm: 0.1, line: [ll(cx, 335), ll(cx, 0)] },
    branches: [
      { id: `${sid}a`, name: `Seguia ${s + 1}-A`, lengthM: 385, lossPerKm: 0.4, startAtMainM: 335, line: [ll(cx, 0), ll(cx - 55, 0), ll(cx - 55, -330)] },
      { id: `${sid}b`, name: `Seguia ${s + 1}-B`, lengthM: 385, lossPerKm: 0.4, startAtMainM: 335, line: [ll(cx, 0), ll(cx + 55, 0), ll(cx + 55, -330)] },
    ],
  })
  // upper plots: directly on the concrete main, two on each side
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? cx - 108 : cx + 4
    const x1 = side < 0 ? cx - 4 : cx + 108
    const h1 = Math.round(U(136, 180))
    const boxes: [number, number][] = [
      [328 - h1, 328],
      [8, 328 - h1 - 4],
    ]
    for (const [y0, y1] of boxes)
      newPlot({ kind: 'collective', ...crop(), seguiaId: sid, branchId: null, distMainM: 335 - y1, distBranchM: 0, wellId: null, box: [x0, y0, x1, y1] })
  }
  // lower plots: on the two earth branches, a column on each side of a branch
  const cols: [string, number, number][] = [
    ['a', cx - 108, cx - 58],
    ['a', cx - 52, cx - 4],
    ['b', cx + 4, cx + 52],
    ['b', cx + 58, cx + 108],
  ]
  for (const [br, x0, x1] of cols) {
    const h1 = Math.round(U(96, 222))
    const boxes: [number, number][] = [
      [-8 - h1, -8],
      [-330, -8 - h1 - 4],
    ]
    for (const [y0, y1] of boxes)
      newPlot({ kind: 'collective', ...crop(), seguiaId: sid, branchId: `${sid}${br}`, distMainM: 335, distBranchM: 55 - y1, wellId: null, box: [x0, y0, x1, y1] })
  }
}

// ---------- wells ----------
const wells: Well[] = []
const gda = (i: number, x: number, y: number, flow: number, depth: number, level: number, ec: number) => {
  const [lon, lat] = ll(x, y)
  wells.push({ id: `f${i}`, name: `Forage GDA ${i}`, type: 'gda', recorded: true, ownerId: null, flowLs: flow, depthM: depth, levelM: level, ecDs: ec, lon, lat, joinRank: i })
}
gda(1, -230, 452, 75, 210, 28.4, 3.1)
gda(2, 230, 452, 65, 240, 31.2, 3.6)

// extension plots: outside the old perimeter, each with its own private well
const ext: { x: number; y: number; w: number; h: number }[] = []
let guard = 0
while (ext.length < 15 && guard++ < 5000) {
  const x = U(-980, 980)
  const y = U(-760, 860)
  if (Math.abs(x) < 560 && y > -430 && y < 520) continue
  if (ext.some(e => Math.hypot(e.x - x, e.y - y) < 210)) continue
  const area = U(0.3, 1.6) * 10000
  const w = U(55, 118)
  ext.push({ x, y, w, h: area / w })
}
const recordedIdx = new Set<number>()
while (recordedIdx.size < 6) recordedIdx.add(Math.floor(rnd() * 15))
ext.forEach((e, i) => {
  const wid = `w${String(i + 1).padStart(2, '0')}`
  const p = newPlot({ kind: 'extension', ...crop(), seguiaId: null, branchId: null, distMainM: 0, distBranchM: 0, wellId: wid, box: [e.x - e.w / 2, e.y - e.h / 2, e.x + e.w / 2, e.y + e.h / 2] })
  const [lon, lat] = ll(e.x - e.w / 2 + 6, e.y + e.h / 2 - 6)
  wells.push({
    id: wid,
    name: `Puits ${i + 1}`,
    type: 'private',
    recorded: recordedIdx.has(i),
    ownerId: null,
    flowLs: r2(U(7, 13), 1),
    depthM: Math.round(U(60, 140)),
    levelM: r2(U(18, 42), 1),
    ecDs: r2(U(3.4, 6.4), 1),
    lon,
    lat,
    joinRank: 0,
  })
  void p
})
// join order of the scenario slider: GDA, then recorded private wells, then the others
let rank = 2
for (const w of wells.filter(w => w.type === 'private' && w.recorded)) w.joinRank = ++rank
for (const w of wells.filter(w => w.type === 'private' && !w.recorded)) w.joinRank = ++rank

// ---------- order along each seguia and rotation groups ----------
const demo = CONFIG.demoDate
const tomorrow = addDays(demo, 1)
const R = CONFIG.rotationDays
const g1 = dayIndex(tomorrow) % R
const finalize = (): Plot[] => {
  const plots: Plot[] = drafts.map(d => {
    const [x0, y0, x1, y1] = d.box
    const { box, ...rest } = d
    return { ...rest, areaHa: r2(((x1 - x0) * (y1 - y0)) / 10000), farmerId: '', order: 0, group: 0, polygon: rect(x0, y0, x1, y1), centroid: ll((x0 + x1) / 2, (y0 + y1) / 2) }
  })
  for (const s of seguias) {
    const mine = plots.filter(p => p.seguiaId === s.id).sort((a, b) => a.distMainM + a.distBranchM - (b.distMainM + b.distBranchM) || a.centroid[0] - b.centroid[0])
    // rotation groups balanced by water need (greedy), the head plot opens group g1
    const weight = (p: Plot) => p.areaHa * (1 + (p.under ? 0.65 * p.underShare : 0))
    const tot = new Array(R).fill(0)
    mine.forEach((p, i) => (p.order = i))
    mine[0].group = g1
    tot[g1] += weight(mine[0])
    for (const p of [...mine.slice(1)].sort((a, b) => weight(b) - weight(a) || a.order - b.order)) {
      const g = tot.indexOf(Math.min(...tot))
      p.group = g
      tot[g] += weight(p)
    }
  }
  return plots
}

const farmersStub: Farmer[] = []
const netOf = (plots: Plot[]): Network => ({ farmers: farmersStub, plots, wells, jebias, seguias })

// ---------- the three demo characters ----------
// Mohamed: first turn of Seguia 2 tomorrow, calibrated to 04:00-06:30 (palms only)
let plots = finalize()
const mohPlot = plots.find(p => p.seguiaId === 's2' && p.order === 0)!
const mohDraft = drafts.find(d => d.id === mohPlot.id)!
const nbrDraft = drafts.find(d => d.seguiaId === 's2' && d.branchId === null && d.box[0] === mohDraft.box[0] && d.id !== mohDraft.id)!
mohDraft.under = null
mohDraft.underShare = 0
const setH = (h: number) => {
  mohDraft.box[1] = 328 - h
  nbrDraft.box[3] = 328 - h - 4
  nbrDraft.distMainM = 335 - nbrDraft.box[3]
}
let lo = 90
let hi = 200
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2
  setH(mid)
  plots = finalize()
  const t = planDay(tomorrow, { network: netOf(plots), weather, events: [] }).turns.find(t => t.plotId === mohPlot.id)!
  if (t.target > 531) hi = mid
  else lo = mid
}
setH(r2(hi, 2))
plots = finalize()

const today = planDay(demo, { network: netOf(plots), weather, events: [] })
const s2 = today.turns.filter(t => t.seguiaId === 's2')
const aliTurn = s2.find(t => t.start <= CONFIG.demoMinute && t.end > CONFIG.demoMinute)
if (!aliTurn) throw new Error('no turn is running on Seguia 2 at the demo time: change the seed')
const salahTurn = s2.find(t => t.start >= aliTurn.end)
if (!salahTurn) throw new Error('no turn after Ali on Seguia 2: change the seed')

// ---------- farmers ----------
const FIRST: [string, string][] = [
  ['Mohamed', 'محمد'], ['Ali', 'علي'], ['Salah', 'صالح'], ['Ahmed', 'أحمد'], ['Brahim', 'إبراهيم'], ['Habib', 'الحبيب'], ['Mabrouk', 'مبروك'],
  ['Belgacem', 'بلقاسم'], ['Amor', 'عمر'], ['Abdallah', 'عبد الله'], ['Hedi', 'الهادي'], ['Lazhar', 'الأزهر'], ['Mokhtar', 'المختار'],
  ['Tahar', 'الطاهر'], ['Youssef', 'يوسف'], ['Khalifa', 'خليفة'], ['Messaoud', 'مسعود'], ['Nasr', 'نصر'], ['Slim', 'سليم'], ['Kamel', 'كمال'],
  ['Fethi', 'فتحي'], ['Ridha', 'رضا'], ['Moncef', 'المنصف'], ['Bechir', 'البشير'], ['Sadok', 'الصادق'], ['Hassen', 'حسن'], ['Houcine', 'حسين'],
  ['Jilani', 'الجيلاني'], ['Lotfi', 'لطفي'], ['Neji', 'الناجي'], ['Abdelkader', 'عبد القادر'], ['Ammar', 'عمّار'], ['Chedly', 'الشاذلي'],
  ['Dhaou', 'ضو'], ['Ezzedine', 'عز الدين'], ['Fatma', 'فاطمة'], ['Mabrouka', 'مبروكة'], ['Aicha', 'عائشة'], ['Zohra', 'زهرة'], ['Salha', 'صالحة'],
]
const LAST: [string, string][] = [
  ['Ben Salem', 'بن سالم'], ['Gharbi', 'الغربي'], ['Ben Amor', 'بن عمر'], ['Nefzaoui', 'النفزاوي'], ['Mansouri', 'المنصوري'], ['Ben Belgacem', 'بن بلقاسم'],
  ['Jeridi', 'الجريدي'], ['Ben Hamed', 'بن حامد'], ['Abdelmoula', 'عبد المولى'], ['Ben Khalifa', 'بن خليفة'], ['Zammouri', 'الزموري'], ['Bouzid', 'بوزيد'],
  ['Ben Nasr', 'بن نصر'], ['Haddad', 'الحدّاد'], ['Tlili', 'التليلي'], ['Dhahri', 'الظاهري'], ['Ben Messaoud', 'بن مسعود'], ['Chebbi', 'الشابي'],
  ['Ben Mabrouk', 'بن مبروك'], ['Douzi', 'الدوزي'],
]
const farmers: Farmer[] = FIRST.map(([first, firstAr], i) => {
  const [last, lastAr] = i < 3 ? LAST[i] : pick(LAST)
  return {
    id: `f${String(i + 1).padStart(2, '0')}`,
    first,
    last,
    firstAr,
    lastAr,
    phone: `+216 00 ${String(100 + Math.floor(rnd() * 900))} ${String(100 + Math.floor(rnd() * 900))}`,
    lang: rnd() < 0.85 ? 'ar' : 'fr',
    smartphone: rnd() < 0.65,
    active: rnd() < 0.72,
  }
})
for (const f of farmers.slice(0, 3)) Object.assign(f, { lang: 'ar', smartphone: true, active: true })

// ownership: 32 members of the GDA own the 48 collective plots, 15 extension
// plots belong to 7 members and to 8 farmers who only have a private well
const special = new Map([
  [mohPlot.id, 'f01'],
  [aliTurn.plotId, 'f02'],
  [salahTurn.plotId, 'f03'],
])
const coll = plots.filter(p => p.kind === 'collective')
const free = coll.filter(p => !special.has(p.id))
for (const p of coll) if (special.has(p.id)) p.farmerId = special.get(p.id)!
const members = farmers.slice(3, 32)
free.forEach((p, i) => {
  if (i < members.length) p.farmerId = members[i].id
  else {
    // a second plot, preferably on the same seguia
    const same = members.filter(m => plots.some(q => q.farmerId === m.id && q.seguiaId === p.seguiaId) && plots.filter(q => q.farmerId === m.id).length < 2)
    const pool = same.length ? same : members.filter(m => plots.filter(q => q.farmerId === m.id).length < 2)
    p.farmerId = pick(pool).id
  }
})
const extPlots = plots.filter(p => p.kind === 'extension')
extPlots.forEach((p, i) => {
  p.farmerId = i < 8 ? farmers[32 + i].id : members[(i * 3) % members.length].id
  const w = wells.find(w => w.id === p.wellId)!
  w.ownerId = p.farmerId
})
for (const f of farmers.slice(32)) f.smartphone = true

const network: Network = { farmers, plots, wells, jebias, seguias }

// ---------- history: planted incidents of the last 7 days ----------
const day = (n: number) => addDays(demo, n)
const ownerOn = (sid: string, date: string) => {
  const t = planDay(date, { network, weather, events: [] }).turns.filter(t => t.seguiaId === sid)
  return t[Math.min(1, t.length - 1)]
}
const cause = (fr: string, en: string, ar: string) => ({ fr, en, ar })
const events: PlanEvent[] = [
  { id: 'h1', type: 'block', date: day(-5), minute: 8 * 60 + 10, seguiaId: 's3', durationMin: 180, cause: cause('Seguia 3 cassée (signalement)', 'Seguia 3 broken (farmer report)', 'الساقية 3 مكسورة') },
  // power cut on both boreholes, 3 days ago: the jebias alone could not cover the day
  ...wells.filter(w => w.type === 'gda').flatMap((w, i): PlanEvent[] => [
    { id: `h2${i}`, type: 'well_flow', date: day(-3), minute: 4 * 60 + 30, wellId: w.id, flowLs: 0, cause: cause('Coupure électrique : les deux forages GDA à l\'arrêt', 'Power cut: both GDA boreholes stopped', 'قصّان الضو: البيرين واقفين') },
    { id: `h3${i}`, type: 'well_flow', date: day(-3), minute: 15 * 60 + 30, wellId: w.id, flowLs: w.flowLs, cause: cause('Courant rétabli : forages GDA relancés', 'Power back: GDA boreholes restarted', 'الضو رجع: الآبار خدمت') },
  ]),
  { id: 'h4', type: 'leak', date: day(-2), minute: 6 * 60, seguiaId: 's1', extraLoss: 0.15, cause: cause('Fuite sur la seguia 1', 'Leak on seguia 1', 'تسريب في الساقية 1') },
  { id: 'h5', type: 'leak', date: day(-1), minute: 12 * 60, seguiaId: 's1', extraLoss: 0, cause: cause('Fuite de la seguia 1 réparée', 'Seguia 1 leak repaired', 'الساقية 1 تصلّحت') },
]
const rep1 = ownerOn('s3', day(-5))
const rep2 = ownerOn('s1', day(-2))
const sw = planDay(day(-4), { network, weather, events: [] }).turns.filter(t => t.seguiaId === 's4')
const history = {
  synthetic: true,
  events,
  reports: [
    { id: 'r-h1', farmerId: rep1.farmerId, type: 'seguia_broken', seguiaId: 's3', date: day(-5), minute: 8 * 60 + 10, status: 'resolved' },
    { id: 'r-h2', farmerId: rep2.farmerId, type: 'leak', seguiaId: 's1', date: day(-2), minute: 6 * 60, status: 'resolved' },
    { id: 'r-h3', farmerId: rep2.farmerId, type: 'no_water', seguiaId: 's1', date: day(-2), minute: 9 * 60 + 40, status: 'resolved' },
  ],
  swaps: [{ id: 'sw-h1', from: sw[0].farmerId, to: sw[1].farmerId, plotA: sw[0].plotId, dateA: day(-4), plotB: sw[1].plotId, dateB: day(-4), status: 'accepted', date: day(-5), minute: 18 * 60 }],
  /** regularization files already started (farmer ids stay on the server) */
  regularization: wells.filter(w => w.type === 'private' && !w.recorded).slice(0, 3).map((w, i) => ({ farmerId: w.ownerId!, done: ['id', 'title', 'well'].slice(0, i + 1) })),
}

// ---------- sensors: 30 days, hourly, ending at the demo time ----------
const H = 720
const endHour = dayIndex(demo) * 24 + Math.floor(CONFIG.demoMinute / 60)
const hourOf = (i: number) => endHour - (H - 1 - i)
const noise = (s: number) => (rnd() + rnd() + rnd() - 1.5) * s
const sensors: {
  synthetic: true
  startHour: number
  hours: number
  wells: Record<string, { level: number[]; flow: number[]; ec: number[] }>
  jebias: Record<string, { level: number[]; inflow: number[]; outflow: number[] }>
} = { synthetic: true, startHour: hourOf(0), hours: H, wells: {}, jebias: {} }

const dropWell = wells.find(w => w.type === 'private' && w.recorded)!
for (const w of wells) {
  const level: number[] = []
  const flow: number[] = []
  const ec: number[] = []
  let dd = 0
  for (let i = 0; i < H; i++) {
    const h = ((hourOf(i) % 24) + 24) % 24
    const d = i / 24
    const on = w.type === 'gda' ? h < 20 : h >= 6 && h < 18
    const target = on ? (w.type === 'gda' ? 3.2 : 1.8) : 0
    dd += (target - dd) * 0.35
    let lv = w.levelM - 0.012 * (30 - d) * -1 - 0.36 + dd + noise(0.05)
    let q = on ? w.flowLs * (1 + noise(0.03)) : 0
    let e = w.ecDs + noise(0.03)
    // planted: sudden drop of a recorded private well, 9 days ago
    if (w.id === dropWell.id && i >= H - 9 * 24 + 4) {
      lv += 3.4
      q *= 0.72
    }
    // planted: salinity rising on GDA borehole 2 for 12 days
    if (w.id === 'f2') e = w.ecDs - 0.62 + noise(0.03) + (i > H - 12 * 24 ? (0.62 * (i - (H - 12 * 24))) / (12 * 24) : 0)
    level.push(r2(lv))
    flow.push(r2(q, 1))
    ec.push(r2(e))
  }
  sensors.wells[w.id] = { level, flow, ec }
}
for (const j of jebias) {
  const level: number[] = []
  const inflow: number[] = []
  const outflow: number[] = []
  let lv = j.capacityM3 * 0.6
  for (let i = 0; i < H; i++) {
    const h = ((hourOf(i) % 24) + 24) % 24
    const out = h >= 4 && h < 15 ? 216 * (0.9 + 0.1 * rnd()) : 0
    let inn = h < 20 ? 122 : 0
    // planted: jebia 4 leaks for 38 hours, 4 days ago (water comes in, the level does not follow)
    const leak = j.id === 'j4' && i >= H - 4 * 24 - 8 && i < H - 4 * 24 + 30 ? 46 : 0
    inn = Math.max(0, Math.min(inn, j.capacityM3 - lv + out + leak))
    const o = Math.min(out, lv + inn)
    lv = Math.max(0, lv + inn - o - leak)
    level.push(Math.round(lv + noise(6)))
    inflow.push(Math.round(inn))
    outflow.push(Math.round(o))
  }
  sensors.jebias[j.id] = { level, inflow, outflow }
}

// ---------- write ----------
mkdirSync(DIR, { recursive: true })
const w = (name: string, data: unknown) => writeFileSync(join(DIR, name), typeof data === 'string' ? data : JSON.stringify(data))
const csv = (rows: (string | number | boolean | null)[][]) => rows.map(r => r.map(c => (typeof c === 'string' && /[,"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c ?? '')).join(',')).join('\n') + '\n'

w('network.json', { synthetic: true, seed: SEED, site, ...network })
w('sensors.json', sensors)
w('history.json', history)
w('farmers.csv', csv([['id', 'first', 'last', 'first_ar', 'last_ar', 'phone', 'lang', 'smartphone', 'active'], ...farmers.map(f => [f.id, f.first, f.last, f.firstAr, f.lastAr, f.phone, f.lang, f.smartphone, f.active])]))
w('plots.csv', csv([['id', 'farmer_id', 'kind', 'area_ha', 'understory', 'understory_share', 'seguia', 'branch', 'well'], ...plots.map(p => [p.id, p.farmerId, p.kind, p.areaHa, p.under ?? '', p.underShare, p.seguiaId ?? '', p.branchId ?? '', p.wellId ?? ''])]))
w('wells_private.csv', csv([['id', 'name', 'type', 'recorded', 'owner_id', 'flow_ls', 'depth_m', 'level_m', 'ec_ds_m', 'lat', 'lon'], ...wells.map(x => [x.id, x.name, x.type, x.recorded, x.ownerId, x.flowLs, x.depthM, x.levelM, x.ecDs, x.lat, x.lon])]))
// the public registry only knows the recorded wells
w('wells_registry.csv', csv([['id', 'name', 'type', 'lat', 'lon'], ...wells.filter(x => x.recorded).map(x => [x.id, x.name, x.type, x.lat, x.lon])]))
w('jebias.csv', csv([['id', 'name', 'capacity_m3', 'lat', 'lon'], ...jebias.map(j => [j.id, j.name, j.capacityM3, j.lat, j.lon])]))
w('seguias.csv', csv([['id', 'name', 'jebia', 'kind', 'capacity_m3h', 'length_m', 'loss_per_km'], ...seguias.flatMap(s => [[s.id, s.name, s.jebiaId, 'main', s.capacityM3h, s.main.lengthM, s.main.lossPerKm], ...s.branches.map(b => [b.id, b.name, s.jebiaId, 'branch', s.capacityM3h, b.lengthM, b.lossPerKm])])]))
w('plots.geojson', {
  type: 'FeatureCollection',
  features: plots.map(p => ({ type: 'Feature', properties: { id: p.id, kind: p.kind, area_ha: p.areaHa, understory: p.under }, geometry: { type: 'Polygon', coordinates: [p.polygon] } })),
})

// ---------- summary ----------
const tom = planDay(tomorrow, { network, weather, events: [] })
const mt = tom.turns.find(t => t.farmerId === 'f01')!
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
console.log(`farmers ${farmers.length}, plots ${plots.length} (${coll.length} collective, ${extPlots.length} extension), wells ${wells.length} (${wells.filter(x => !x.recorded).length} unrecorded)`)
console.log(`collective area ${r2(coll.reduce((s, p) => s + p.areaHa, 0))} ha, extension ${r2(extPlots.reduce((s, p) => s + p.areaHa, 0))} ha`)
console.log(`${demo}: released ${Math.round(today.released)} m3, pumped ${Math.round(today.pumped)}, need ${Math.round(today.need)}, last turn ends ${hm(Math.max(...today.turns.map(t => t.end)))}`)
console.log(`Seguia 2 today: ${s2.map(t => `${farmers.find(f => f.id === plots.find(p => p.id === t.plotId)!.farmerId)!.first} ${hm(t.start)}-${hm(t.end)}`).join(', ')}`)
console.log(`Mohamed tomorrow: ${hm(mt.start)}-${hm(mt.end)} ${Math.round(mt.target)} m3, plot ${plots.find(p => p.id === mt.plotId)!.areaHa} ha`)
console.log(`tomorrow released ${Math.round(tom.released)} m3`)
