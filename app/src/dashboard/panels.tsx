import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowLeftRight, Bot, CalendarClock, CheckCircle2, Clock, CloudRain, Droplet, Droplets, FileCheck2, Gauge, Lightbulb, RefreshCw, Scale, Scissors, Send, ShieldCheck, Siren, Sun, ThermometerSun, TrendingUp, Users, Waves, Wrench, Zap,
} from 'lucide-react'
import { fmt, hhmm, post } from '../api'
import type { Alert, DLang, DayPlan, Kpis, Live, Network, Scenario, Trends, Turn } from '../types'

export const D = {
  fr: {
    today: "Aujourd'hui", tomorrow: 'Demain', schedule: "Tours d'eau", pumped: 'pompage', cap: 'plafond', now: 'maintenant',
    done: 'terminé', active: 'en cours', pending: 'à venir', swap: 'échange', delayed: 'décalé', longer: 'allongé', cut: 'réduit (pénurie)', closed: 'seguia fermée',
    need: 'besoin couvert', volume: 'volume', why: 'Pourquoi',
    aquifer: 'Nappe : pompage et limite', scenario: 'Scénario : part des puits de la communauté ayant rejoint TWIZA', without: 'Sans TWIZA', wells: 'puits',
    total: 'Pompage estimé de la communauté', collective: 'Réseau collectif (GDA)', private: 'Puits privés', limit: 'Limite sûre', over: 'Au-dessus de la limite', under: 'Sous la limite',
    cross: 'Limite atteinte à', nocross: 'La limite n\'est pas atteinte aujourd\'hui', meter: 'Réseau collectif, compteurs', plannedDay: 'prévu ce jour',
    trend: 'Tendance 30 jours (capteurs)', level: 'Niveau de la nappe (m sous le sol)', ec: 'Salinité EC (dS/m)', f1: 'Forage GDA 1', f2: 'Forage GDA 2', priv: 'Puits privés déclarés (moy.)',
    alerts: 'Alertes', proactive: 'Proactives', reactive: 'Réactives', decision: 'Décision', resolved: 'résolu', none: 'Aucune alerte.',
    kServed: 'Besoin couvert', kFair: 'Équité', kLoss: 'Pertes en canal', kPump: 'Pompé', kActive: 'Actifs', kReg: 'Régularisations',
    spread: 'écart', below: 'sous le besoin', lost: 'perdus aujourd\'hui', plannedShort: 'prévu', started: 'démarrés via l\'app',
    farms: 'Besoin couvert par exploitation (7 j)', belowNeed: '< 97 %', covered: 'couvert',
    assistant: 'Assistant', ask: 'Posez une question (français ou derja)…', templ: 'gabarits (sans clé API)', llm: 'Claude', proposals: 'Propositions à valider par le comité',
    log: 'Journal de re-planification', noLog: 'Aucune re-planification depuis l\'ouverture.', changes: 'tours modifiés', before: 'avant', after: 'après', removed: 'retiré', added: 'ajouté',
    demo: 'Démo', heat: 'Vague de chaleur', rain: 'Pluie demain', ecUp: 'Salinité en hausse', dry: 'Forage 2 à sec', fix: 'Forage 2 réparé', repair: 'Réparations faites', reset: 'Réinitialiser', speed: 'Horloge',
    served: 'servi', understory: 'sous-étage', palms: 'palmiers',
  },
  en: {
    today: 'Today', tomorrow: 'Tomorrow', schedule: 'Water turns', pumped: 'pumping', cap: 'limit', now: 'now',
    done: 'done', active: 'running', pending: 'upcoming', swap: 'swap', delayed: 'delayed', longer: 'lengthened', cut: 'reduced (shortage)', closed: 'seguia closed',
    need: 'need met', volume: 'volume', why: 'Why',
    aquifer: 'Aquifer: pumping and limit', scenario: "Scenario: share of the community's wells that joined TWIZA", without: 'Without TWIZA', wells: 'wells',
    total: 'Estimated community pumping', collective: 'Collective network (GDA)', private: 'Private wells', limit: 'Safe limit', over: 'Above the limit', under: 'Under the limit',
    cross: 'Limit reached at', nocross: 'The limit is not reached today', meter: 'Collective network, meters', plannedDay: 'planned today',
    trend: '30-day trend (sensors)', level: 'Groundwater level (m below ground)', ec: 'Salinity EC (dS/m)', f1: 'GDA borehole 1', f2: 'GDA borehole 2', priv: 'Recorded private wells (mean)',
    alerts: 'Alerts', proactive: 'Proactive', reactive: 'Reactive', decision: 'Decision', resolved: 'resolved', none: 'No alert.',
    kServed: 'Need met', kFair: 'Fairness', kLoss: 'Canal losses', kPump: 'Pumped', kActive: 'Active', kReg: 'Regularizations',
    spread: 'spread', below: 'below their need', lost: 'lost today', plannedShort: 'planned', started: 'started in the app',
    farms: 'Need met per farm (7 d)', belowNeed: '< 97 %', covered: 'met',
    assistant: 'Assistant', ask: 'Ask a question (French or derja)…', templ: 'templates (no API key)', llm: 'Claude', proposals: 'Proposals for the committee',
    log: 'Re-plan log', noLog: 'No re-plan since the app opened.', changes: 'turns changed', before: 'before', after: 'after', removed: 'removed', added: 'added',
    demo: 'Demo', heat: 'Heat wave', rain: 'Rain tomorrow', ecUp: 'Salinity rising', dry: 'Borehole 2 dry', fix: 'Borehole 2 repaired', repair: 'Repairs done', reset: 'Reset', speed: 'Clock',
    served: 'served', understory: 'understory', palms: 'palms',
  },
}
type Dict = (typeof D)['fr']
// ---------------------------------------------------------------------
// "i" indicator: what a component means, in one or two sentences
// ---------------------------------------------------------------------
export const HELP = {
  fr: {
    kServed: "Part du besoin en eau des cultures réellement livrée aux parcelles sur les 7 derniers jours. 100 % = chaque culture a reçu ce qu'il lui faut.",
    kFair: "Mesure si le manque d'eau est partagé également entre les exploitations. 1 = tout le monde reçoit la même part de son besoin ; plus bas = certains sont lésés.",
    kLoss: "Eau qui s'infiltre dans les canaux (seguias) entre la jebia et la parcelle. Les branches en terre perdent plus que le canal en béton.",
    kPump: "Eau pompée aujourd'hui par les forages du GDA, comparée au maximum autorisé pour protéger la nappe.",
    kActive: "Agriculteurs qui ont utilisé l'application cette semaine, et tours d'eau déjà terminés aujourd'hui.",
    kReg: "Nombre d'agriculteurs qui ont commencé un dossier de régularisation de leur puits dans l'application. Seul le total est visible.",
    map: "Le réseau d'eau : forages, jebias (bassins), seguias (canaux) et parcelles. Les couleurs disent qui irrigue maintenant. Les numéros donnent l'ordre des tours du jour ; « Rejouer la journée » montre l'eau passer d'une parcelle à l'autre. Les étiquettes des puits déclarés indiquent ce que chacun pompe et s'il a rejoint TWIZA ; les puits non déclarés ne sont que comptés. La tache rouge montre où la nappe est la plus sollicitée.",
    gantt: "Qui irrigue quand, canal par canal. Chaque barre est le tour d'un agriculteur ; la ligne blanche est l'heure actuelle. Survolez une barre pour voir le volume et la raison.",
    aquifer: "Ce que toute la communauté pompe en un jour, comparé à ce que la nappe peut donner sans s'épuiser. Le curseur simule l'adhésion de plus de puits à TWIZA.",
    alerts: "Proactives : ce que le système voit venir (chaleur, salinité, limite). Réactives : ce qui vient d'arriver (panne, signalement). Chaque alerte indique la décision prise.",
    assistant: "Posez une question en français ou en derja. L'assistant lit les données mais ne peut jamais modifier les tours : il propose, le planificateur décide.",
    farms: "Pour chaque exploitation, la part de son besoin en eau reçue cette semaine. En orange : moins de 97 %.",
    trend: "Mesures des capteurs sur 30 jours. Un niveau qui descend ou une salinité qui monte signalent une nappe sous pression.",
    log: "Chaque fois que le planning change : la cause, et pour chaque tour l'horaire avant et après.",
  },
  en: {
    kServed: 'Share of the crops\' water need actually delivered to the plots over the last 7 days. 100 % = every crop got what it needs.',
    kFair: 'Shows whether a shortage is shared evenly between farms. 1 = everybody receives the same share of their need; lower = some are short-changed.',
    kLoss: 'Water that seeps into the canals (seguias) between the jebia and the plot. Earth branches lose more than the concrete main.',
    kPump: 'Water pumped today by the GDA boreholes, against the maximum allowed to protect the aquifer.',
    kActive: 'Farmers who used the app this week, and turns already finished today.',
    kReg: 'Farmers who started a regularization file for their well in the app. Only the total is visible.',
    map: 'The water network: boreholes, jebias (basins), seguias (canals) and plots. Colours show who is irrigating now. Numbers give the order of turns for the day; "Replay the day" shows the water moving from plot to plot. Labels on recorded wells show what each pumps and whether it joined TWIZA; unrecorded wells are only counted. The red area shows where the aquifer is under most pressure.',
    gantt: 'Who irrigates when, canal by canal. Each bar is one farmer\'s turn; the white line is the current time. Hover a bar for the volume and the reason.',
    aquifer: 'What the whole community pumps in a day, against what the aquifer can give without running down. The slider simulates more wells joining TWIZA.',
    alerts: 'Proactive: what the system sees coming (heat, salinity, limit). Reactive: what just happened (failure, report). Each alert states the decision taken.',
    assistant: 'Ask in French or derja. The assistant reads the data but can never change the turns: it proposes, the planner decides.',
    farms: 'For each farm, the share of its water need received this week. Orange: less than 97 %.',
    trend: 'Sensor readings over 30 days. A falling level or rising salinity means the aquifer is under pressure.',
    log: 'Every time the schedule changes: the cause, and for each turn the time before and after.',
  },
}
export function Info({ text, align = 'start' }: { text: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="info" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-mute/60 text-base font-semibold leading-none text-ink2 hover:border-ink hover:text-ink">i</button>
      {open && <span role="tooltip" className={`absolute top-6 z-50 w-80 rounded-xl border border-line bg-panel p-3.5 text-lg font-normal leading-relaxed text-ink2 shadow-2xl ${align === 'end' ? 'end-0' : 'start-0'}`}>{text}</span>}
    </span>
  )
}

const dayLabel = (date: string, lang: DLang) => new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// =====================================================================
// Gantt of the turns, one row per seguia
// =====================================================================
export function Gantt({ net, live, lang }: { net: Network; live: Live; lang: DLang }) {
  const t = D[lang]
  const [day, setDay] = useState(0)
  const [tip, setTip] = useState<{ x: number; y: number; turn: Turn } | null>(null)
  const plan: DayPlan = live.plans[day] ?? live.plans[0]
  const farmer = useMemo(() => new Map(net.farmers.map(f => [f.id, f])), [net])
  const t0 = 4 * 60
  const maxEnd = Math.max(18 * 60, ...live.plans.flatMap(p => p.turns.map(x => x.end)))
  const t1 = Math.min(1440, Math.ceil(maxEnd / 120) * 120)
  const pos = (m: number) => ((m - t0) / (t1 - t0)) * 100
  const hours = Array.from({ length: (t1 - t0) / 60 + 1 }, (_, i) => t0 + i * 60)
  const nowMin = live.now.minute
  const state = (x: Turn) => (day > 0 || x.start < 0 ? 'pending' : nowMin >= x.end ? 'done' : nowMin >= x.start ? 'active' : 'pending')

  return (
    <div className="card flex h-full flex-col">
      <div className="card-h flex-wrap gap-y-2">
        <CalendarClock size={15} className="text-brand" /> {t.schedule} <Info text={HELP[lang].gantt} />
        <span className="inline-flex overflow-hidden rounded-md border border-line font-normal">
          {live.plans.map((p, i) => (
            <button key={p.date} onClick={() => setDay(i)} className={`px-2.5 py-1 text-base ${day === i ? 'bg-ink text-white' : 'bg-panel text-ink2 hover:text-ink'}`}>
              {i === 0 ? t.today : i === 1 ? t.tomorrow : dayLabel(p.date, lang)}
            </button>
          ))}
        </span>
        <span className="ms-auto font-normal text-ink2">
          {dayLabel(plan.date, lang)} · ET0 <span className="num text-ink">{fmt(plan.et0 * plan.et0Factor, 1)} mm</span>
          {plan.et0Factor !== 1 && <span className="ms-1 rounded bg-warn/20 px-1 text-warn">×{fmt(plan.et0Factor, 2)}</span>} · {t.pumped}{' '}
          <span className="num text-ink">{fmt(plan.pumped)}</span> / {fmt(plan.cap)} m³
          {plan.underShare < 0.999 && <span className="ms-2 rounded bg-warn/20 px-1.5 py-0.5 text-warn">{t.palms} {Math.round(plan.palmShare * 100)} % · {t.understory} {Math.round(plan.underShare * 100)} %</span>}
        </span>
      </div>
      <div className="relative flex-1 px-4 pb-3 pt-2" onMouseLeave={() => setTip(null)}>
        {/* time axis */}
        <div className="relative ms-[132px] h-5">
          {hours.filter((_, i) => i % 2 === 0).map(h => (
            <span key={h} className="num absolute -translate-x-1/2 text-sm text-mute" style={{ left: `${pos(h)}%` }}>{hhmm(h)}</span>
          ))}
        </div>
        <div className="relative">
          {net.seguias.map(s => {
            const turns = plan.turns.filter(x => x.seguiaId === s.id)
            const st = live.seguias.find(x => x.id === s.id)
            return (
              <div key={s.id} className="flex items-center border-t border-line/60 py-1.5">
                <div className="w-[132px] shrink-0 text-base">
                  <div className="font-semibold text-ink">{s.name}</div>
                  <div className="text-sm text-mute">Jebia {s.jebiaId.slice(1)}{day === 0 && st?.blockedUntil != null ? <span className="ms-1 rounded bg-crit/25 px-1 text-ink">{lang === 'fr' ? 'fermée' : 'closed'}</span> : null}</div>
                </div>
                <div className="relative h-11 flex-1 rounded bg-panel2/60">
                  {hours.map(h => <span key={h} className="absolute top-0 h-full w-px bg-line/60" style={{ left: `${pos(h)}%` }} />)}
                  {turns.filter(x => x.start >= 0).map(x => {
                    const stt = state(x)
                    const f = farmer.get(x.farmerId)
                    const changed = x.flags.includes('replan') || x.flags.includes('delayed')
                    const swap = x.flags.includes('swap')
                    return (
                      <button
                        key={x.id}
                        data-turn={x.id}
                        onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, turn: x })}
                        onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left, y: r.bottom, turn: x }) }}
                        onBlur={() => setTip(null)}
                        className={`absolute top-1 flex h-9 items-center gap-1 overflow-hidden rounded px-1.5 text-start text-base leading-none outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                          stt === 'active' ? 'bg-s1 font-semibold text-white ring-2 ring-[#8FC3CB]' : stt === 'done' ? 'bg-s1/30 text-ink2' : 'border border-s1/70 bg-s1/15 text-ink'
                        } ${swap ? '!border-2 !border-s7' : changed ? '!border-2 !border-warn' : ''}`}
                        style={{ left: `calc(${pos(x.start)}% + 1px)`, width: `calc(${pos(x.end) - pos(x.start)}% - 2px)` }}
                      >
                        {swap && <ArrowLeftRight size={11} className="shrink-0 text-s7" />}
                        {!swap && x.flags.includes('delayed') && <Clock size={11} className="shrink-0 text-warn" />}
                        {x.flags.includes('lengthened') && <TrendingUp size={11} className="shrink-0 text-warn" />}
                        {x.flags.includes('cut') && <Scissors size={11} className="shrink-0 text-warn" />}
                        <span className="truncate">{f?.first}</span>
                      </button>
                    )
                  })}
                  {plan.blocks.filter(b => b.seguiaId === s.id).map((b, i) => (
                    <span key={i} title={`${t.closed} ${hhmm(b.from)}–${hhmm(b.to)}`} className="pointer-events-none absolute -top-0.5 z-10 h-12 rounded-sm border-x-2 border-crit"
                      style={{ left: `${pos(b.from)}%`, width: `${pos(b.to) - pos(b.from)}%`, background: 'repeating-linear-gradient(135deg, rgba(181,18,27,.55) 0 4px, rgba(181,18,27,.12) 4px 9px)' }} />
                  ))}
                </div>
              </div>
            )
          })}
          {day === 0 && nowMin >= t0 && nowMin <= t1 && (
            <div className="pointer-events-none absolute inset-y-0 ms-[132px]" style={{ left: 0, right: 0 }}>
              <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${pos(nowMin)}%` }}>
                <span className="num absolute -top-4 -translate-x-1/2 rounded bg-ink px-1 text-sm font-semibold text-plane">{hhmm(nowMin)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-ink2">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm bg-s1/30" /> {t.done}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm bg-s1 ring-1 ring-[#8FC3CB]" /> {t.active}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border border-s1/70 bg-s1/15" /> {t.pending}</span>
          <span className="flex items-center gap-1"><ArrowLeftRight size={11} className="text-s7" /> {t.swap}</span>
          <span className="flex items-center gap-1"><Clock size={11} className="text-warn" /> {t.delayed}</span>
          <span className="flex items-center gap-1"><TrendingUp size={11} className="text-warn" /> {t.longer}</span>
          <span className="flex items-center gap-1"><Scissors size={11} className="text-warn" /> {t.cut}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border-x border-crit/70" style={{ background: 'repeating-linear-gradient(135deg, rgba(181,18,27,.4) 0 3px, rgba(181,18,27,.1) 3px 6px)' }} /> {t.closed}</span>
        </div>
        {tip && (
          <div className="pointer-events-none fixed z-50 w-96 rounded-xl border border-line bg-panel p-4 text-base shadow-2xl" style={{ left: Math.min(tip.x + 14, window.innerWidth - 400), top: Math.min(tip.y + 14, window.innerHeight - 280) }}>
            <div className="mb-1 flex items-center justify-between font-semibold text-ink">
              <span>{farmer.get(tip.turn.farmerId)?.first} {farmer.get(tip.turn.farmerId)?.last}</span>
              <span className="num">{hhmm(tip.turn.start)}–{hhmm(tip.turn.end)}</span>
            </div>
            <div className="num flex justify-between text-ink2"><span>{t.volume}</span><span>{fmt(tip.turn.target)} m³ → {fmt(tip.turn.delivered)} m³</span></div>
            <div className="num flex justify-between text-ink2"><span>{t.need}</span><span>{fmt((tip.turn.delivered / Math.max(1, tip.turn.needPalm + tip.turn.needUnder)) * 100)} %</span></div>
            <div className="mt-1.5 border-t border-line pt-1.5 leading-snug text-ink2"><span className="text-mute">{t.why} : </span>{tip.turn.reason[lang]}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// Aquifer gauge + scenario slider + 30-day trends
// =====================================================================
export function Aquifer({ live, scenario, share, setShare, lang }: { live: Live; scenario: Scenario | null; share: number; setShare: (n: number) => void; lang: DLang }) {
  const t = D[lang]
  const row = scenario?.rows[Math.round(share / 5)]
  const limit = scenario?.limit ?? 1
  const max = scenario ? Math.max(limit * 1.12, scenario.rows[0].total * 1.04) : 1
  const over = row ? row.total > limit : false
  const k = live.kpis
  return (
    <div className="card">
      <div className="card-h"><Gauge size={15} className="text-brand" /> {t.aquifer} <Info text={HELP[lang].aquifer} /></div>
      <div className="space-y-3 p-4">
        {row && scenario && (
          <>
            <div>
              <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-base text-ink2">{t.total}</div>
                  <div className="num text-4xl font-semibold leading-tight text-ink" data-testid="scenario-total">{fmt(row.total)} <span className="text-lg font-normal text-ink2">{lang === 'fr' ? 'm³/j' : 'm³/d'}</span></div>
                </div>
                <div data-testid="scenario-status" className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-lg font-semibold ${over ? 'border-crit/60 bg-crit/15 text-ink' : 'border-good/60 bg-good/15 text-ink'}`}>
                  {over ? <AlertTriangle size={16} className="text-crit" /> : <CheckCircle2 size={16} className="text-good" />}
                  {over ? t.over : t.under} · <span className="num">{fmt(row.pct)} %</span>
                </div>
              </div>
              {/* meter: collective + private against the safe limit */}
              <div className="relative mt-2 h-7">
                <div className="absolute inset-x-0 top-1.5 flex h-4 gap-0.5 overflow-hidden rounded bg-panel2">
                  <div className="h-full rounded-s bg-s1 transition-all duration-300" style={{ width: `${(row.collective / max) * 100}%` }} title={`${t.collective}: ${fmt(row.collective)} m³`} />
                  <div className="h-full rounded-e bg-s2 transition-all duration-300" style={{ width: `${(row.private / max) * 100}%` }} title={`${t.private}: ${fmt(row.private)} m³`} />
                </div>
                <div className="absolute top-0 h-7 w-0.5 bg-ink" style={{ left: `${(limit / max) * 100}%` }} />
              </div>
              <div className="relative h-4 text-base">
                <span className="num absolute -translate-x-1/2 whitespace-nowrap text-ink2" style={{ left: `${(limit / max) * 100}%` }}>{t.limit} {fmt(limit)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base text-ink2">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-s1" /> {t.collective} <span className="num text-ink">{fmt(row.collective)}</span></span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-s2" /> {t.private} <span className="num text-ink">{fmt(row.private)}</span></span>
              </div>
              <div className={`mt-1.5 flex items-center gap-1.5 text-base ${row.crossMin != null ? 'text-ink' : 'text-ink2'}`}>
                <Clock size={13} className={row.crossMin != null ? 'text-crit' : 'text-good'} />
                {row.crossMin != null ? <>{t.cross} <b className="num">{hhmm(row.crossMin)}</b></> : t.nocross}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-panel2/60 p-3">
              <label htmlFor="share" className="block text-base leading-snug text-ink2">{t.scenario}</label>
              <div className="mt-1 flex items-center gap-3">
                <input id="share" data-testid="share" type="range" min={0} max={100} step={5} value={share} onChange={e => setShare(Number(e.target.value))} className="slider flex-1"
                  style={{ background: `linear-gradient(90deg, #1C7A89 ${share}%, #DEDBD4 ${share}%)` }} />
                <div className="w-24 text-end">
                  <div className="num text-2xl font-semibold leading-none text-ink">{share} %</div>
                  <div className="num text-base text-ink2">{share === 0 ? t.without : `${row.joined} / ${scenario.wells} ${t.wells}`}</div>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5">
                {[0, 35, 70, 100].map(v => (
                  <button key={v} onClick={() => setShare(v)} className={`chip num ${share === v ? 'chip-on' : ''}`}>{v === 0 ? t.without : `${v} %`}</button>
                ))}
              </div>
            </div>
          </>
        )}
        <div>
          <div className="mb-1 flex justify-between text-base text-ink2">
            <span>{t.meter} · {live.now.hhmm}</span>
            <span className="num"><b className="text-ink">{fmt(k.pumpedNow)}</b> / {fmt(k.cap)} m³ · {t.plannedDay} {fmt(k.pumpedPlanned)}</span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded bg-panel2">
            <div className="absolute inset-y-0 start-0 rounded bg-s1/35" style={{ width: `${Math.min(100, (k.pumpedPlanned / k.cap) * 100)}%` }} />
            <div className="absolute inset-y-0 start-0 rounded bg-s1" style={{ width: `${Math.min(100, (k.pumpedNow / k.cap) * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function TrendsCard({ trends, lang }: { trends: Trends | null; lang: DLang }) {
  const t = D[lang]
  return (
    <div className="card flex h-full flex-col">
      <div className="card-h"><TrendingUp size={15} className="text-brand" /> {t.trend} <Info text={HELP[lang].trend} /></div>
      <div className="flex-1 px-4 py-3">
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-ink2">
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-s1" /> {t.f1}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-s2" /> {t.f2}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-s3" /> {t.priv}</span>
        </div>
        {trends && (
          <>
            <TrendChart title={t.level} rows={trends.rows} keys={['f1Level', 'f2Level', 'privLevel']} names={[t.f1, t.f2, t.priv]} unit="m" reversed lang={lang} />
            <TrendChart title={t.ec} rows={trends.rows} keys={['f1Ec', 'f2Ec', 'privEc']} names={[t.f1, t.f2, t.priv]} unit="dS/m" lang={lang} />
          </>
        )}
      </div>
    </div>
  )
}

const SERIES = ['#1C7A89', '#B5121B', '#8A8580']
function TrendChart({ title, rows, keys, names, unit, reversed, lang }: { title: string; rows: Trends['rows']; keys: string[]; names: string[]; unit: string; reversed?: boolean; lang: DLang }) {
  return (
    <div className="mt-1">
      <div className="text-base text-mute">{title}</div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 18, bottom: 0, left: -14 }}>
            <CartesianGrid stroke="#DEDBD4" strokeDasharray="0" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: '#6F6B66', fontSize: 14 }} tickLine={false} axisLine={{ stroke: '#C9C5BD' }} interval={6} tickFormatter={d => `${d.slice(8)}/${d.slice(5, 7)}`} />
            <YAxis reversed={reversed} domain={[(min: number) => Math.floor(min * 2) / 2, (max: number) => Math.ceil(max * 2) / 2]} tickFormatter={v => fmt(Number(v), 1)} tick={{ fill: '#6F6B66', fontSize: 14 }} tickLine={false} axisLine={false} width={44} tickCount={4} />
            <Tooltip
              contentStyle={{ background: '#FFFFFF', border: '1px solid #DEDBD4', borderRadius: 8, fontSize: 15, padding: '8px 10px' }}
              labelStyle={{ color: '#45423E' }} itemStyle={{ color: '#171717', padding: 0 }}
              labelFormatter={d => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
              formatter={(v, name) => [`${fmt(Number(v), 2)} ${unit}`, name]}
              cursor={{ stroke: '#6F6B66', strokeWidth: 1 }}
            />
            {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={names[i]} stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#FFFFFF', strokeWidth: 2 }} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// =====================================================================
// Alerts feed
// =====================================================================
const ICON: Record<Alert['icon'], typeof Sun> = { heat: ThermometerSun, salt: Waves, limit: Gauge, rain: CloudRain, well: Zap, seguia: Wrench, leak: Droplets, swap: ArrowLeftRight, sensor: Siren, drop: TrendingUp }
const SEV = { info: 'text-s1', warn: 'text-warn', crit: 'text-crit' }

export function Alerts({ live, lang }: { live: Live; lang: DLang }) {
  const t = D[lang]
  const [tab, setTab] = useState<'proactive' | 'reactive'>('proactive')
  const count = (k: 'proactive' | 'reactive') => live.alerts.filter(a => a.kind === k && !a.resolved).length
  const list = live.alerts.filter(a => a.kind === tab)
  // jump to the tab that just received an alert
  const last = useRef(live.alerts.length)
  useEffect(() => {
    if (live.alerts.length > last.current) {
      const newest = [...live.alerts].sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)))[0]
      if (newest) setTab(newest.kind)
    }
    last.current = live.alerts.length
  }, [live.alerts])
  return (
    <div className="card flex min-h-0 flex-1 flex-col">
      <div className="card-h">
        <Siren size={15} className="text-brand" /> {t.alerts} <Info text={HELP[lang].alerts} />
        <span className="ms-auto inline-flex overflow-hidden rounded-md border border-line font-normal">
          {(['proactive', 'reactive'] as const).map(k => (
            <button key={k} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-2.5 py-1 text-base ${tab === k ? 'bg-ink text-white' : 'bg-panel text-ink2 hover:text-ink'}`}>
              {k === 'proactive' ? <Lightbulb size={12} /> : <AlertTriangle size={12} />} {t[k]}
              <span className="num rounded-full bg-plane px-1.5 text-sm text-ink">{count(k)}</span>
            </button>
          ))}
        </span>
      </div>
      <div className="scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="alerts">
        {!list.length && <div className="p-4 text-center text-base text-mute">{t.none}</div>}
        {list.map(a => {
          const Icon = ICON[a.icon] ?? Siren
          return (
            <div key={a.id} className={`rounded-lg border p-2.5 ${a.resolved ? 'border-line bg-panel2/40 opacity-75' : 'border-line bg-panel2'}`}>
              <div className="flex items-start gap-2">
                <Icon size={16} className={`mt-0.5 shrink-0 ${a.resolved ? 'text-mute' : SEV[a.severity]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold leading-snug text-ink">{a.title[lang]}</div>
                  <div className="num mt-0.5 text-base text-mute">
                    {a.date.slice(8)}/{a.date.slice(5, 7)} · {hhmm(a.minute)}{a.resolved ? ` · ${t.resolved}` : ''}
                  </div>
                  <div className="mt-1 text-base leading-snug text-ink2">{a.detail[lang]}</div>
                  <div className="mt-1.5 flex gap-1.5 rounded-md border border-line bg-plane p-2.5 text-base leading-snug text-ink">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0 text-good" />
                    <span><span className="font-semibold">{t.decision} : </span>{a.decision[lang]}</span>
                  </div>
                  {a.photo && <img src={a.photo} alt="" className="mt-1.5 h-20 rounded border border-line object-cover" />}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =====================================================================
// KPI tiles
// =====================================================================
export function KpiStrip({ k, lang }: { k: Kpis; lang: DLang }) {
  const t = D[lang]
  const Tile = ({ icon: Icon, label, value, unit, sub, help, align }: { icon: typeof Sun; label: string; value: string; unit?: string; sub: string; help: string; align?: 'end' }) => (
    <div className="card px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-base text-ink2"><Icon size={13} className="text-mute" /> <span className="flex-1">{label}</span> <Info text={help} align={align} /></div>
      <div className="num mt-1 text-3xl font-semibold leading-none text-ink">{value}{unit && <span className="ms-1 text-lg font-normal text-ink2">{unit}</span>}</div>
      <div className="num mt-1 truncate text-base text-mute">{sub}</div>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="kpis">
      <Tile icon={Droplet} label={t.kServed} help={HELP[lang].kServed} value={fmt(k.servedWeekPct, 1)} unit="%" sub={`${fmt(k.gotWeek)} / ${fmt(k.needWeek)} m³`} />
      <Tile icon={Scale} label={t.kFair} help={HELP[lang].kFair} value={fmt(k.fairness, 2)} sub={`${k.below} ${t.below}`} />
      <Tile icon={Droplets} label={t.kLoss} help={HELP[lang].kLoss} value={fmt(k.lossPct, 1)} unit="%" sub={`${fmt(k.lostToday)} m³`} />
      <Tile icon={Gauge} label={t.kPump} help={HELP[lang].kPump} value={fmt(k.pumpedNow)} unit="m³" sub={`${t.cap} ${fmt(k.cap)} m³`} />
      <Tile icon={Users} label={t.kActive} help={HELP[lang].kActive} align="end" value={String(k.farmersActive)} unit={`/ ${k.farmersTotal}`} sub={`${k.turnsDone} / ${k.turnsToday} ${lang === 'fr' ? 'tours' : 'turns'}`} />
      <Tile icon={FileCheck2} label={t.kReg} help={HELP[lang].kReg} align="end" value={String(k.regularizationFiles)} sub={t.started} />
    </div>
  )
}

export function Farms({ live, lang }: { live: Live; lang: DLang }) {
  const t = D[lang]
  return (
    <div className="card flex h-full flex-col">
      <div className="card-h">
        <Scale size={15} className="text-brand" /> {t.farms} <Info text={HELP[lang].farms} />
        <span className="ms-auto flex items-center gap-3 text-base font-normal text-ink2">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-s1" /> {t.covered}</span>
          <span className="flex items-center gap-1"><AlertTriangle size={11} className="text-serious" /> {t.belowNeed}</span>
        </span>
      </div>
      <div className="scroll max-h-[520px] flex-1 overflow-y-auto px-4 py-2" data-testid="farms">
        {live.weekly.map(r => {
          const low = r.pct < 97
          return (
            <div key={r.farmerId} className="group flex items-center gap-2 py-[3px] text-base" title={`${r.name} — ${fmt(r.got)} / ${fmt(r.need)} m³`}>
              <span className="w-40 shrink-0 truncate text-ink2 group-hover:text-ink">{r.name}</span>
              <span className="relative h-2.5 flex-1 rounded-sm bg-panel2">
                <span className={`absolute inset-y-0 start-0 rounded-e ${low ? 'bg-serious' : 'bg-s1'}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
              </span>
              <span className="num flex w-36 shrink-0 items-center justify-end gap-1 text-ink">
                {low && <AlertTriangle size={11} className="text-serious" />}
                {fmt(r.pct)} %{low && <span className="text-mute"> · −{fmt(r.need - r.got)} m³</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =====================================================================
// Assistant
// =====================================================================
interface Msg { role: 'user' | 'assistant'; content: string; mode?: string }
export function Assistant({ live, lang }: { live: Live; lang: DLang }) {
  const t = D[lang]
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [msgs, busy])
  const send = async (q: string) => {
    if (!q.trim() || busy) return
    const history = msgs.map(m => ({ role: m.role, content: m.content }))
    setMsgs(m => [...m, { role: 'user', content: q }])
    setText('')
    setBusy(true)
    try {
      const r = await post<{ text: string; mode: string }>('/api/assistant', { message: q, history })
      setMsgs(m => [...m, { role: 'assistant', content: r.text, mode: r.mode }])
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: lang === 'fr' ? 'Serveur injoignable.' : 'Server unreachable.' }])
    }
    setBusy(false)
  }
  const samples = ['Chkoun ma chrebch el jem3a hedhi?', lang === 'fr' ? 'Qui irrigue maintenant ?' : 'Who is irrigating now?', lang === 'fr' ? 'Pompage et limite de la nappe ?' : 'Pumping vs the aquifer limit?', lang === 'fr' ? 'Quand est le tour de Salah ?' : "When is Salah's turn?"]
  return (
    <div className="card flex h-full min-h-[330px] flex-col">
      <div className="card-h">
        <Bot size={15} className="text-brand" /> {t.assistant} <Info text={HELP[lang].assistant} />
        <span className="ms-auto rounded border border-line px-1.5 py-0.5 text-sm font-normal text-ink2">{live.llm ? t.llm : t.templ}</span>
      </div>
      <div className="scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="chat">
        {!msgs.length && (
          <div className="flex flex-wrap gap-1.5">
            {samples.map(s => <button key={s} className="chip text-start" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div dir="auto" className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-lg leading-relaxed ${m.role === 'user' ? 'bg-panel2 text-ink' : 'border border-line bg-panel2 text-ink'}`}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="text-base text-mute">…</div>}
        {live.proposals.length > 0 && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-base text-ink2">
            <div className="mb-1 font-semibold text-ink">{t.proposals}</div>
            {live.proposals.map(p => <div key={p.id}>• {p.text}</div>)}
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-line p-2.5" onSubmit={e => { e.preventDefault(); send(text) }}>
        <input dir="auto" value={text} onChange={e => setText(e.target.value)} placeholder={t.ask} data-testid="ask" className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2.5 text-lg text-ink outline-none placeholder:text-mute focus:border-ink" />
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 text-white disabled:opacity-50" aria-label="send"><Send size={15} /></button>
      </form>
    </div>
  )
}

// =====================================================================
// Re-plan log
// =====================================================================
export function ReplanLog({ net, live, lang }: { net: Network; live: Live; lang: DLang }) {
  const t = D[lang]
  const farmer = useMemo(() => new Map(net.farmers.map(f => [f.id, f])), [net])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { if (live.log[0]) setOpen(live.log[0].id) }, [live.log[0]?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card flex h-full flex-col">
      <div className="card-h"><RefreshCw size={15} className="text-brand" /> {t.log} <Info text={HELP[lang].log} /></div>
      <div className="scroll max-h-[520px] flex-1 space-y-2 overflow-y-auto p-3" data-testid="log">
        {!live.log.length && <div className="p-4 text-center text-base text-mute">{t.noLog}</div>}
        {live.log.map(l => (
          <div key={l.id} className="rounded-lg border border-line bg-panel2 p-2.5 text-base">
            <button className="flex w-full items-start gap-2 text-start" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
              <span className="num shrink-0 rounded bg-panel2 px-1.5 py-0.5 text-base text-ink2">{hhmm(l.minute)}</span>
              <span className="flex-1">
                <span className="font-semibold text-ink">{l.cause[lang]}</span>
                <span className="mt-0.5 block leading-snug text-ink2">{l.summary[lang]}</span>
              </span>
            </button>
            {open === l.id && l.changes.length > 0 && (
              <table className="num mt-2 w-full border-t border-line text-base">
                <thead><tr className="text-mute"><th className="py-1 text-start font-normal">{l.changes.length} {t.changes}</th><th className="text-start font-normal">{t.before}</th><th className="text-start font-normal">{t.after}</th></tr></thead>
                <tbody>
                  {l.changes.slice(0, 14).map(c => (
                    <tr key={c.turnId} className="border-t border-line/50 text-ink2">
                      <td className="py-0.5 text-ink">{farmer.get(c.farmerId)?.first} <span className="text-mute">{c.date.slice(8)}/{c.date.slice(5, 7)}</span></td>
                      <td>{c.before ? `${hhmm(c.before.start)}–${hhmm(c.before.end)} · ${fmt(c.before.target)} m³` : `— (${t.added})`}</td>
                      <td className="text-ink">{c.after ? (c.after.start < 0 ? '—' : `${hhmm(c.after.start)}–${hhmm(c.after.end)} · ${fmt(c.after.target)} m³`) : `— (${t.removed})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export type { Dict }
