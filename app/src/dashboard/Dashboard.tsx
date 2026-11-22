import { useEffect, useState } from 'react'
import { Activity, Bot, CalendarClock, ChevronDown, CloudRain, Droplet, FastForward, FlaskConical, LayoutDashboard, PanelLeftClose, PanelLeftOpen, RotateCcw, Smartphone, ThermometerSun, Waves, Wrench, X, Zap } from 'lucide-react'
import { get, post, usePoll, fmt } from '../api'
import type { DLang, Live, Network, Scenario, Trends } from '../types'
import MapView from './MapView'
import { Alerts, Aquifer, Assistant, D, Farms, Gantt, KpiStrip, ReplanLog, TrendsCard } from './panels'

type Section = 'overview' | 'schedule' | 'monitor' | 'assistant'

// the drawer: sections grouped by what the committee wants to do
const NAV = {
  fr: {
    groups: [
      { label: 'Piloter', items: ['overview', 'schedule'] as Section[] },
      { label: 'Suivre', items: ['monitor'] as Section[] },
      { label: 'Comprendre', items: ['assistant'] as Section[] },
    ],
    overview: ['Vue d\'ensemble', 'La carte du réseau, la nappe et les alertes : l\'état de la communauté en un coup d\'œil.'],
    schedule: ['Tours d\'eau', 'Qui irrigue quand, et ce que le planificateur a changé et pourquoi.'],
    monitor: ['Capteurs et équité', 'L\'évolution de la nappe sur 30 jours et l\'eau reçue par chaque exploitation.'],
    assistant: ['Assistant', 'Posez vos questions sur les tours, la nappe ou les agriculteurs.'],
    collapse: 'Réduire le menu',
  },
  en: {
    groups: [
      { label: 'Steer', items: ['overview', 'schedule'] as Section[] },
      { label: 'Monitor', items: ['monitor'] as Section[] },
      { label: 'Understand', items: ['assistant'] as Section[] },
    ],
    overview: ['Overview', 'The network map, the aquifer and the alerts: the state of the community at a glance.'],
    schedule: ['Water turns', 'Who irrigates when, and what the planner changed and why.'],
    monitor: ['Sensors and fairness', 'The aquifer over 30 days and the water each farm received.'],
    assistant: ['Assistant', 'Ask about the turns, the aquifer or the farmers.'],
    collapse: 'Collapse menu',
  },
}
const NAV_ICON: Record<Section, typeof Zap> = { overview: LayoutDashboard, schedule: CalendarClock, monitor: Activity, assistant: Bot }

export default function Dashboard() {
  const [lang, setLang] = useState<DLang>(() => (localStorage.getItem('twiza-dlang') as DLang) || 'fr')
  const [net, setNet] = useState<Network | null>(null)
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [trends, setTrends] = useState<Trends | null>(null)
  const [share, setShare] = useState(0)
  const [section, setSection] = useState<Section>('overview')
  const [drawer, setDrawer] = useState(true)
  const [phone, setPhone] = useState(false)
  const [phoneFarmer, setPhoneFarmer] = useState('f01')
  const [demoOpen, setDemoOpen] = useState(false)
  const { data: live, offline, refresh } = usePoll<Live>('/api/live', 2000)
  const t = D[lang]
  const nav = NAV[lang]

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = 'ltr'
    document.body.className = 'bg-plane text-ink font-sans'
    document.documentElement.style.fontSize = '18px' // dashboard only: everything scales with it
    localStorage.setItem('twiza-dlang', lang)
  }, [lang])
  useEffect(() => {
    get<Network>('/api/network').then(setNet).catch(() => {})
    get<Scenario>('/api/scenario').then(setScenario).catch(() => {})
    get<Trends>('/api/trends').then(setTrends).catch(() => {})
  }, [])

  // the community's choice: only when switched on does the server send the unrecorded wells
  const showUnrecorded = async (on: boolean) => {
    await post('/api/demo/unrecorded', { on }).catch(() => {})
    get<Network>('/api/network').then(setNet).catch(() => {})
    get<Scenario>('/api/scenario').then(setScenario).catch(() => {})
  }
  const act = async (action: string, body?: unknown) => {
    await post(`/api/demo/${action}`, body).catch(() => {})
    if (action === 'reset') { setShare(0); get<Network>('/api/network').then(setNet).catch(() => {}); get<Scenario>('/api/scenario').then(setScenario).catch(() => {}) }
    refresh()
  }

  if (!net || !live)
    return (
      <div className="flex h-full items-center justify-center bg-plane text-xl text-ink2">
        {offline ? (lang === 'fr' ? 'Serveur TWIZA injoignable — lancez « npm run dev ».' : 'TWIZA server unreachable — run "npm run dev".') : 'TWIZA…'}
      </div>
    )

  const today = live.weather.find(w => w.date === live.now.date)
  const dateLabel = new Date(`${live.now.date}T12:00:00Z`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const openAlerts = live.alerts.filter(a => !a.resolved).length
  const badge: Partial<Record<Section, number>> = { overview: openAlerts, schedule: live.log.length }
  const demoBtn = (label: string, action: string, Icon: typeof Zap, body?: unknown) => (
    <button key={label} data-demo={action} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-base text-ink2 hover:bg-panel2 hover:text-ink" onClick={() => { act(action, body); setDemoOpen(false) }}>
      <Icon size={16} className="text-mute" /> {label}
    </button>
  )
  const show = (s: Section) => (section === s ? '' : 'hidden')
  const Heading = ({ s }: { s: Section }) => (
    <div className="mb-4">
      <h1 className="text-3xl font-semibold text-ink">{nav[s][0]}</h1>
      <p className="mt-0.5 text-lg text-ink2">{nav[s][1]}</p>
    </div>
  )

  return (
    <div className={`min-h-full bg-plane ${drawer ? 'ps-64' : 'ps-[76px]'} ${phone ? 'xl:pe-[420px]' : ''}`}>
      {/* ---------- drawer ---------- */}
      <nav className={`fixed inset-y-0 start-0 z-40 flex flex-col border-e border-line/60 bg-panel ${drawer ? 'w-64' : 'w-[76px]'}`} data-testid="drawer">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src="/logo.png" alt="TWIZA" className="h-11 w-11 shrink-0" />
          {drawer && (
            <div className="leading-tight">
              <div className="text-xl font-semibold text-ink">TWIZA <span className="font-ar text-ink2">تويزة</span></div>
              <div className="text-sm text-mute">{lang === 'fr' ? 'L\'entraide autour de l\'eau' : 'Collective effort for water'}</div>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {nav.groups.map(g => (
            <div key={g.label}>
              {drawer && <div className="px-2 pb-1 text-sm font-semibold uppercase tracking-wider text-mute">{g.label}</div>}
              <div className="space-y-1">
                {g.items.map(s => {
                  const Icon = NAV_ICON[s]
                  const on = section === s
                  return (
                    <button key={s} data-nav={s} title={nav[s][0]} aria-current={on} onClick={() => setSection(s)}
                      className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-lg ${on ? 'bg-brand/10 font-semibold text-ink' : 'text-ink2 hover:bg-panel2 hover:text-ink'}`}>
                      <Icon size={20} className={`shrink-0 ${on ? 'text-brand' : ''}`} />
                      {drawer && <span className="flex-1">{nav[s][0]}</span>}
                      {!!badge[s] && <span className={`num rounded-full bg-brand px-2 text-sm text-white ${drawer ? '' : 'absolute end-1 top-1'}`}>{badge[s]}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => setDrawer(d => !d)} title={nav.collapse} className="m-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-base text-ink2 hover:bg-panel2 hover:text-ink" data-testid="drawer-toggle">
          {drawer ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />} {drawer && nav.collapse}
        </button>
      </nav>

      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 bg-plane/95 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2.5">
          <span className="num text-3xl font-semibold leading-none text-ink" data-testid="clock">{live.now.hhmm}</span>
          <span className="text-lg capitalize text-ink2">{dateLabel}</span>
          {live.now.speed !== 1 && <span className="num rounded bg-warn/20 px-1.5 text-sm text-warn">×{live.now.speed}</span>}
        </div>
        {today && (
          <div className="flex items-center gap-4 text-base text-ink2">
            <span className="flex items-center gap-1.5"><ThermometerSun size={16} className="text-mute" /> <span className="num text-ink">{fmt(today.tmax)} °C</span></span>
            <span className="flex items-center gap-1.5" title="Open-Meteo"><Droplet size={16} className="text-mute" /> ET0 <span className="num text-ink">{fmt(today.et0 * today.factor, 1)} mm</span></span>
          </div>
        )}
        {offline && <span className="rounded bg-crit/20 px-2 py-1 text-base text-ink">{lang === 'fr' ? 'hors ligne' : 'offline'}</span>}
        <div className="ms-auto flex items-center gap-2">
          <div className="relative">
            <button className={`chip ${demoOpen ? 'chip-on' : ''}`} onClick={() => setDemoOpen(o => !o)} data-testid="demo-menu" aria-expanded={demoOpen}>
              <FlaskConical size={15} /> {t.demo} <ChevronDown size={14} />
            </button>
            {demoOpen && (
              <div className="absolute end-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-panel p-2 shadow-2xl">
                <div className="px-3 pb-1 pt-0.5 text-sm uppercase tracking-wide text-mute">{lang === 'fr' ? 'Prévisions et capteurs simulés' : 'Simulated forecast and sensors'}</div>
                {demoBtn(t.heat, 'heatwave', ThermometerSun)}
                {demoBtn(t.rain, 'rain', CloudRain)}
                {demoBtn(t.ecUp, 'ec', Waves)}
                {demoBtn(t.dry, 'welldry', Zap)}
                {demoBtn(t.fix, 'wellfix', Wrench)}
                {demoBtn(t.repair, 'repair', Wrench)}
                <div className="my-1 border-t border-line" />
                <div className="flex items-center gap-1 px-3 py-1.5 text-base text-ink2">
                  <FastForward size={16} className="text-mute" /> {t.speed}
                  {[1, 60, 600].map(s => (
                    <button key={s} className={`chip num ms-1 !px-2 !py-0.5 ${live.now.speed === s ? 'chip-on' : ''}`} onClick={() => act('clock', { speed: s })}>×{s}</button>
                  ))}
                </div>
                {demoBtn(t.reset, 'reset', RotateCcw)}
              </div>
            )}
          </div>
          <button className={`chip ${phone ? 'chip-on' : ''}`} onClick={() => setPhone(p => !p)} data-testid="phone-toggle"><Smartphone size={15} /> {lang === 'fr' ? 'App agriculteur' : 'Farmer app'}</button>
          <span className="inline-flex overflow-hidden rounded-lg border border-line/70">
            {(['fr', 'en'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1.5 text-base uppercase ${lang === l ? 'bg-ink text-white' : 'text-ink2 hover:text-ink'}`}>{l}</button>
            ))}
          </span>
        </div>
      </header>

      {/* ---------- sections (all stay mounted so the map and the chat keep their state) ---------- */}
      <main className="px-6 pb-6 pt-2">
        <section className={show('overview')} data-section="overview">
          <Heading s="overview" />
          <div className="space-y-4">
            <KpiStrip k={live.kpis} lang={lang} />
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 h-[940px] xl:col-span-8"><MapView net={net} live={live} scenario={scenario} share={share} setShare={setShare} lang={lang} onUnrecorded={showUnrecorded} /></div>
              <div className="col-span-12 flex flex-col gap-4 xl:col-span-4">
                <Aquifer live={live} scenario={scenario} share={share} setShare={setShare} lang={lang} />
                <div className="flex max-h-[560px] min-h-[320px] flex-col"><Alerts live={live} lang={lang} /></div>
              </div>
            </div>
          </div>
        </section>

        <section className={show('schedule')} data-section="schedule">
          <Heading s="schedule" />
          <div className="space-y-4">
            <Gantt net={net} live={live} lang={lang} />
            <ReplanLog net={net} live={live} lang={lang} />
          </div>
        </section>

        <section className={show('monitor')} data-section="monitor">
          <Heading s="monitor" />
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-6"><TrendsCard trends={trends} lang={lang} /></div>
            <div className="col-span-12 xl:col-span-6"><Farms live={live} lang={lang} /></div>
          </div>
        </section>

        <section className={show('assistant')} data-section="assistant">
          <Heading s="assistant" />
          <div className="h-[680px] max-w-5xl"><Assistant live={live} lang={lang} /></div>
        </section>
      </main>

      <footer className="px-6 py-4 text-sm leading-relaxed text-mute">
        {lang === 'fr'
          ? 'DONNÉES SYNTHÉTIQUES (hackathon) : agriculteurs, parcelles, puits, jebias, seguias, capteurs et signalements sont générés. Réel : météo et ET0 (Open-Meteo, Kébili, été 2026) et imagerie satellite (Sentinel-2 L2A, Copernicus). Aucun puits non déclaré n\'est localisé individuellement.'
          : 'SYNTHETIC DATA (hackathon): farmers, plots, wells, jebias, seguias, sensors and reports are generated. Real: weather and ET0 (Open-Meteo, Kebili, summer 2026) and satellite imagery (Sentinel-2 L2A, Copernicus). No unrecorded well is ever located individually.'}
      </footer>

      {phone && (
        <aside className="fixed inset-y-0 end-0 z-40 flex w-[420px] flex-col border-s border-line bg-panel shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 text-base text-ink2">
            <Smartphone size={16} /> {lang === 'fr' ? 'Vue de' : 'View of'}
            <select value={phoneFarmer} onChange={e => setPhoneFarmer(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-plane px-2 py-1.5 text-ink" data-testid="phone-farmer">
              {net.farmers.map(f => <option key={f.id} value={f.id}>{f.first} {f.last}</option>)}
            </select>
            <a className="chip" href={`/farmer?f=${phoneFarmer}`} target="_blank" rel="noreferrer">↗</a>
            <button onClick={() => setPhone(false)} aria-label="close" className="text-ink2 hover:text-ink"><X size={18} /></button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden p-3">
            <div className="h-full max-h-[820px] w-[390px] overflow-hidden rounded-[28px] border-[6px] border-[#05070a] bg-black shadow-xl">
              <iframe key={phoneFarmer} title="farmer" src={`/farmer?f=${phoneFarmer}`} className="h-full w-full" />
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
