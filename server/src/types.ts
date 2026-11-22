import type { CropId } from './config.js'

export type Lang = 'fr' | 'en' | 'ar'
export type Txt = { fr: string; en: string; ar: string }

export interface Farmer {
  id: string
  first: string
  last: string
  firstAr: string
  lastAr: string
  phone: string
  lang: 'ar' | 'fr'
  smartphone: boolean
  /** has opened the app this week (synthetic) */
  active: boolean
}

export interface Plot {
  id: string
  farmerId: string
  /** 'collective' = inside the GDA perimeter, served by a seguia; 'extension' = own private well */
  kind: 'collective' | 'extension'
  areaHa: number
  /** understory crop under the palms, if any */
  under: Exclude<CropId, 'palm'> | null
  /** share of the plot area carrying the understory crop */
  underShare: number
  seguiaId: string | null
  /** secondary branch the plot takes water from (null = directly on the main) */
  branchId: string | null
  /** metres of main canal / of earth branch between the jebia and the plot */
  distMainM: number
  distBranchM: number
  /** rank along the seguia, upstream first */
  order: number
  /** day group of the rotation, 0..rotationDays-1 */
  group: number
  wellId: string | null
  polygon: [number, number][]
  centroid: [number, number]
}

export interface Well {
  id: string
  name: string
  type: 'gda' | 'private'
  /** PRIVATE flag. Never leaves the server for unrecorded wells. */
  recorded: boolean
  ownerId: string | null
  flowLs: number
  depthM: number
  /** static water level below ground, m */
  levelM: number
  ecDs: number
  lon: number
  lat: number
  /** rank in which wells join TWIZA in the scenario slider */
  joinRank: number
}

export interface Jebia {
  id: string
  name: string
  capacityM3: number
  lon: number
  lat: number
}

export interface Seguia {
  id: string
  name: string
  jebiaId: string
  /** main canal: concrete; branches: earth */
  capacityM3h: number
  main: { lengthM: number; lossPerKm: number; line: [number, number][] }
  branches: { id: string; name: string; lengthM: number; lossPerKm: number; line: [number, number][]; startAtMainM: number }[]
}

export interface Network {
  farmers: Farmer[]
  plots: Plot[]
  wells: Well[]
  jebias: Jebia[]
  seguias: Seguia[]
}

export interface WeatherDay { date: string; et0: number; tmax: number; tmin: number; rain: number }

// ---------- planner ----------

export type EventType =
  | 'block' // seguia closed for a while (report: no water / broken)
  | 'leak' // extra seepage on a seguia until repaired
  | 'well_flow' // a well changes flow (dry, pump failure, repaired)
  | 'ec' // a well's EC changes (sensor)
  | 'forecast' // ET0 multiplier for a set of dates
  | 'swap' // two plots exchange their next turns

export interface PlanEvent {
  id: string
  type: EventType
  /** when the event becomes known */
  date: string
  minute: number
  seguiaId?: string
  durationMin?: number
  extraLoss?: number
  wellId?: string
  flowLs?: number
  ecDs?: number
  /** forecast: multiplier per date */
  et0Factor?: Record<string, number>
  /** swap: plot a (turn on dateA) <-> plot b (turn on dateB) */
  swap?: { plotA: string; dateA: string; plotB: string; dateB: string }
  cause: Txt
}

export interface Turn {
  id: string
  date: string
  seguiaId: string
  jebiaId: string
  plotId: string
  farmerId: string
  /** minutes since 00:00 of `date`; -1 if the turn could not start */
  start: number
  end: number
  /** gross need at the plot for the rotation (m3), palms / understory */
  needPalm: number
  needUnder: number
  /** volume released at the jebia for this turn (m3) */
  target: number
  /** the same without any event (normal forecast, no incident): used to say "+30 min" */
  baseTarget: number
  released: number
  /** volume reaching the plot after seepage (m3) */
  delivered: number
  /** share of the need that is met, 0..1 */
  palmShare: number
  underShare: number
  lossShare: number
  travelMin: number
  leaching: number
  flags: ('swap' | 'replan' | 'shortened' | 'lengthened' | 'cut' | 'delayed' | 'unfinished')[]
  reason: Txt
}

export interface DayPlan {
  date: string
  et0: number
  et0Factor: number
  turns: Turn[]
  /** collective pumping per 5-min step, cumulative m3 (length 289) */
  pumpedCum: number[]
  /** jebia level per step, m3 */
  jebiaLevels: Record<string, number[]>
  pumped: number
  released: number
  delivered: number
  need: number
  cap: number
  /** service level: palms share, understory share */
  palmShare: number
  underShare: number
  blocks: { seguiaId: string; from: number; to: number }[]
}

export interface ReplanEntry {
  id: string
  date: string
  minute: number
  cause: Txt
  summary: Txt
  changes: { turnId: string; plotId: string; farmerId: string; date: string; before: { start: number; end: number; target: number } | null; after: { start: number; end: number; target: number } | null }[]
}
