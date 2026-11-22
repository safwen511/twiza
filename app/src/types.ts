// Shapes of the API payloads (the server types are the source of truth).
import type { DayPlan, Jebia, ReplanEntry, Seguia, Turn, Txt } from '../../server/src/types'

export type { DayPlan, Jebia, ReplanEntry, Seguia, Turn, Txt }
export type { DLang } from './i18n'
export type FLang = 'ar' | 'fr'

export interface NetFarmer { id: string; first: string; last: string; firstAr: string; lastAr: string; lang: FLang; smartphone: boolean }
export interface NetPlot { id: string; farmerId: string; kind: 'collective' | 'extension'; areaHa: number; under: 'vegetables' | 'alfalfa' | null; underShare: number; seguiaId: string | null; branchId: string | null; wellId?: string | null; polygon: [number, number][]; centroid: [number, number] }
export interface NetWell { id: string; name: string; type: 'gda' | 'private'; recorded: boolean; flowLs: number; depthM: number; lon: number; lat: number }
export interface Network {
  site: { name: string; governorate: string; town: { lat: number; lon: number }; center: { lat: number; lon: number } }
  config: { cap: number; limit: number; rotationDays: number; efficiency: number; demoDate: string }
  farmers: NetFarmer[]
  plots: NetPlot[]
  wells: NetWell[]
  wellCounts: { total: number; recorded: number }
  jebias: Jebia[]
  seguias: Seguia[]
  sat: null | { source: string; scene_id: string; scene_date: string; cloud_cover: number; bbox: [number, number, number, number]; ndvi_threshold: number; n_patches: number; irrigated_ha: number; est_m3_day: number; unrecorded_m3_day: number; registry_wells: number; hex_min_patches?: number; well_radius_m?: number }
}

export interface Alert {
  id: string; kind: 'proactive' | 'reactive'; severity: 'info' | 'warn' | 'crit'
  icon: 'heat' | 'salt' | 'limit' | 'rain' | 'well' | 'seguia' | 'leak' | 'swap' | 'sensor' | 'drop'
  date: string; minute: number; title: Txt; detail: Txt; decision: Txt; source: string; resolved?: boolean; photo?: string
}
export interface Kpis {
  needToday: number; plannedToday: number; deliveredNow: number; needWeek: number; gotWeek: number; servedWeekPct: number
  fairness: number; minPct: number; maxPct: number; below: number; lossPct: number; lostToday: number
  pumpedNow: number; pumpedPlanned: number; cap: number; farmersActive: number; farmersTotal: number; regularizationFiles: number; turnsToday: number; turnsDone: number
}
export interface Live {
  version: number
  llm: boolean
  now: { date: string; minute: number; speed: number; hhmm: string }
  weather: { date: string; et0: number; tmax: number; tmin: number; rain: number; factor: number }[]
  plans: DayPlan[]
  jebias: { id: string; level: number; capacity: number }[]
  seguias: { id: string; blockedUntil: number | null; extraLoss: number; flow: number; activeTurnId: string | null }[]
  wells: { id: string; flowLs: number; ecDs: number; levelM: number; status: 'ok' | 'dry' }[]
  alerts: Alert[]
  log: ReplanEntry[]
  reports: { id: string; farmerId: string; type: string; seguiaId: string | null; date: string; minute: number; status: string }[]
  swaps: { id: string; from: string; to: string; status: string; date: string; minute: number }[]
  proposals: { id: string; date: string; minute: number; text: string }[]
  kpis: Kpis
  weekly: { farmerId: string; name: string; need: number; got: number; pct: number; turns: number }[]
  flags: { heat: boolean; rain: boolean }
  admin: boolean
  unrecordedLayer: boolean
  unrecorded: { count: number }
}
export interface Scenario {
  limit: number; wells: number; shares: number[]
  rows: { share: number; joined: number; total: number; collective: number; private: number; pct: number; crossMin: number | null }[]
  recorded: { id: string; recorded: boolean; joinShare: number; q: number[] }[]
  unrecorded: { count: number; joined: number[]; q: number[] }
  grid: { points: [number, number][]; dd: number[][]; sal: number[] }
}
export interface Trends { dates: string[]; wells: { id: string; name: string; type: 'gda' | 'private'; level: number[]; ec: number[]; drop: boolean; rising: boolean }[] }
export interface Zone { blurred: true; jitterM: [number, number]; points: { id: string; lon: number; lat: number }[] }

// ---- farmer ----
export interface TurnView {
  id: string; farmerId: string; first: string; firstAr: string; date: string; dayOffset: number; start: number; end: number; m3: number; deliveredM3: number
  state: 'pending' | 'active' | 'done'; me: boolean; flags: string[]; extraMin: number; underShare: number; palmShare: number; leaching: number; travelMin: number
}
export interface Advice { id: string; icon: 'heat' | 'salt' | 'rain' | 'short' | 'well' | 'tip'; key: string; ar: string; fr: string; llm?: boolean }
export interface FarmerView {
  version: number
  now: { date: string; minute: number; hhmm: string }
  farmer: NetFarmer
  plots: { id: string; kind: string; areaHa: number; under: string | null }[]
  seguia: { id: string; n: string; name: string; blockedUntil: number | null; leak: boolean } | null
  jebia: { id: string; n: string; name: string } | null
  status: 'now' | 'today' | 'later' | 'none'
  next: TurnView | null
  countdownMin: number | null
  neighbour: TurnView | null
  timeline: TurnView[]
  advice: Advice[]
  candidates: TurnView[]
  swapsIn: { id: string; from: string; first: string; firstAr: string; dateA: string; dateB: string }[]
  swapsOut: { id: string; to: string; first: string; firstAr: string; status: 'pending' | 'accepted' | 'refused' }[]
  reports: { id: string; type: string; date: string; minute: number; status: string }[]
  notifs: { id: string; kind: string; date: string; minute: number; text: Txt; swapId?: string }[]
  myWell: null | { name: string; recorded: boolean; depthM: number; flowLs: number; ecDs: number; levelM: number; health: 'good' | 'warn' | 'bad'; level48: number[]; ec48: number[]; flow48: number[]; advisedHours: number | null; advisedM3: number | null; traditionalM3: number | null; dropM: number | null }
  regularization: { needed: boolean; done: string[] }
  sms: string
}
