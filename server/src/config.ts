// TWIZA — agronomic and hydraulic configuration.
// Every value here is either a published reference value (FAO-56 / FAO-29) or an
// explicit assumption listed in the README section "Hypothèses".

export type CropId = 'palm' | 'vegetables' | 'alfalfa'

export const CROPS: Record<CropId, {
  /** FAO-56 single crop coefficient, mid-season */
  kc: number
  /** soil salinity (ECe, dS/m) tolerated for ~90 % yield, FAO-29 table 4 */
  ece: number
  label: { fr: string; en: string; ar: string }
}> = {
  palm: { kc: 0.95, ece: 6.8, label: { fr: 'Palmier dattier', en: 'Date palm', ar: 'نخل' } },
  vegetables: { kc: 1.05, ece: 3.5, label: { fr: 'Maraîchage', en: 'Vegetables', ar: 'خضرة' } },
  alfalfa: { kc: 0.95, ece: 3.4, label: { fr: 'Luzerne', en: 'Alfalfa', ar: 'فصّة' } },
}

export const CONFIG = {
  /** application efficiency of basin (flood) irrigation at plot level */
  efficiency: 0.7,
  /** crops under the palms are shaded: their ET is reduced by this factor */
  understoryShade: 0.6,
  /** leaching requirement is capped (beyond that, change crop instead) */
  maxLeaching: 0.3,
  /** turn rotation: every plot gets one turn every N days */
  rotationDays: 3,
  /** first turn of the day opens at this minute (04:00) */
  dayStartMin: 4 * 60,
  /** simulation step of the planner, minutes */
  stepMin: 5,
  /** boreholes rest at least 2 h a day */
  maxPumpHours: 22,
  /** jebias start each day at this share of their capacity */
  jebiaStartShare: 0.6,
  /** jebia reserve the planner keeps when re-planning after a failure */
  jebiaReserveShare: 0.05,
  /** safe daily abstraction for the whole community (collective + private), m3/day */
  safeDailyLimit: 13800,
  /** part of the safe limit granted to the collective network, m3/day */
  collectiveCap: 10800,
  /** water speed in a seguia, m/s (travel time) */
  seguiaSpeed: 0.45,
  /** traditional practice: fixed turns deliver this multiple of the real need */
  traditionalCollectiveFactor: 1.3,
  /** traditional practice of a private well: hours of pumping per day */
  traditionalPrivateHours: 12,
  /** events */
  blockNoWaterMin: 60,
  blockBrokenMin: 180,
  leakExtraLoss: 0.15,
  heatWaveFactor: 1.2,
  rainFactor: 0.6,
  /** demo clock: the app opens on this real-weather day */
  demoDate: '2026-07-14',
  demoMinute: 10 * 60 + 5,
} as const

export const SITE = {
  name: 'Souk Lahad',
  governorate: 'Kebili',
  /** town centre, verified with OSM Nominatim */
  town: { lat: 33.7783142, lon: 8.8525855 },
}
