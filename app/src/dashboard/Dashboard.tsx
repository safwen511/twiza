// Dashboard shell: sidebar, top bar, routes, the demo menu, the guided demo and the shared state.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bot, CalendarClock, ChevronDown, CloudRain, Droplet, FastForward, FlaskConical, Info as InfoIcon, LayoutDashboard, PlayCircle, RotateCcw, ShieldAlert, Smartphone, ThermometerSun, Waves, Wrench, X, Zap } from 'lucide-react'
import { fmt, get, hhmm, post, SESSION, useApi } from '../api'
import { LangCtx, DICT, useT, type DLang, type Key } from '../i18n'
import type { Live, Network, Scenario, Trends, Zone } from '../types'
import type { Selection, View } from './MapView'
import { Async, Card, Drawer, ErrorState, Info, Num, Row, Skeleton, StatusDot, Tabs } from './ui'
import { AboutPage, AssistantPage, NotFound, SensorsPage, SmallScreen, TurnsPage } from './pages'

const MapView = lazy(() => import('./MapView'))

export type Route = '/' | '/tours' | '/capteurs' | '/assistant' | '/a-propos'
const ROUTES: Route[] = ['/', '/tours', '/capteurs', '/assistant', '/a-propos']
const NAV: [Route, typeof Zap, Key, Key][] = [['/', LayoutDashboard, 'nav.overview', 'q.overview'], ['/tours', CalendarClock, 'nav.turns', 'q.turns'], ['/capteurs', Activity, 'nav.sensors', 'q.sensors'], ['/assistant', Bot, 'nav.assistant', 'q.assistant']]
type SideTab = 'today' | 'alerts' | 'scenario'
export interface Phone { farmer: string; tab: string }

export default function Dashboard() {
  const [lang, setLang] = useState<DLang>(() => (localStorage.getItem('twiza-dlang') as DLang) || 'fr')
  const t = useCallback((k: Key) => DICT[lang][k], [lang])
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const go = useCallback((p: string) => { history.pushState(null, '', p); setPath(p); window.scrollTo(0, 0) }, [])
  const netS = useApi<Network>('/api/network')
  const liveS = useApi<Live>('/api/live', 2000)
  const scS = useApi<Scenario>('/api/scenario')
  const trS = useApi<Trends>('/api/trends')
  const [share, setShare] = useState(0)
  const [view, setView] = useState<View>('network')
  const [sideTab, setSideTab] = useState<SideTab>('today')
  const [preview, setPreview] = useState<number | null>(null)
  const [phone, setPhone] = useState<Phone | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [zone, setZone] = useState<Zone | null>(null)
  const [menu, setMenu] = useState(false)
  const [guide, setGuide] = useState<number | null>(null)
  const [ask, setAsk] = useState<string | null>(null)
  const [wide, setWide] = useState(window.innerWidth >= 1100)
  const live = liveS.data, net = netS.data, scenario = scS.data

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = 'ltr'
    document.documentElement.style.fontSize = '16px'
    document.body.className = 'dash'
    localStorage.setItem('twiza-dlang', lang)
    document.title = `TWIZA — ${t((NAV.find(n => n[0] === path)?.[2] ?? (path === '/a-propos' ? 'nav.about' : 'nf.title')) as Key)}`
  }, [lang, path, t])
  useEffect(() => {
    const pop = () => setPath(location.pathname.replace(/\/$/, '') || '/')
    const rs = () => setWide(window.innerWidth >= 1100)
    window.addEventListener('popstate', pop); window.addEventListener('resize', rs)
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('resize', rs) }
  }, [])
  // blurred unrecorded wells: only requested when the admin layer is on; the server refuses otherwise
  useEffect(() => {
    if (live?.unrecordedLayer) get<Zone>('/api/admin/unrecorded').then(setZone).catch(() => setZone(null))
    else setZone(null)
  }, [live?.unrecordedLayer])

  const act = useCallback(async (url: string, body?: unknown) => { const r = await post(url, body).catch(() => null); await liveS.refresh(); return r }, [liveS])
  const reset = useCallback(async () => { await act('/api/demo/reset'); setShare(0); setView('network'); setSideTab('today'); setPreview(null); setPhone(null); setSel(null); setGuide(null); setAsk(null) }, [act])

  // ---------- guided "Démo jury": each step sets the screen and plays one action of the story ----------
  const done = useRef(new Set<number>())
  const step = useCallback(async (n: number) => {
    const once = async (fn: () => Promise<unknown>) => { if (!done.current.has(n)) { done.current.add(n); await fn() } }
    setSel(null)
    if (n === 1) { go('/'); setPhone(null); setView('satellite'); setShare(0); setSideTab('scenario') }
    if (n === 2) { go('/'); setPhone(null); setView('aquifer'); setShare(70); setSideTab('scenario') }
    if (n === 3) { go('/'); setView('network'); setSideTab('today'); setPhone({ farmer: 'f01', tab: 'home' }) }
    if (n === 4) { await once(() => act('/api/reports', { farmerId: 'f01', type: 'no_water' })); go('/'); setView('turns'); setSideTab('alerts'); setPhone({ farmer: 'f01', tab: 'home' }) }
    if (n === 5) { await once(async () => { const r = (await act('/api/swaps', { from: 'f01', to: 'f03' })) as { id?: string } | null; if (r?.id) await act(`/api/swaps/${r.id}`, { accept: true }) }); go('/tours'); setPhone({ farmer: 'f01', tab: 'home' }) }
    if (n === 6) { await once(() => act('/api/demo/heatwave')); go('/'); setView('turns'); setSideTab('alerts'); setPhone({ farmer: 'f03', tab: 'advice' }) }
    if (n === 7) { setPhone(null); setAsk(DICT[lang]['as.q1']); go('/assistant') }
    if (n === 8) { go('/'); setView('network'); setSideTab('today'); setPhone({ farmer: 'f36', tab: 'reg' }) }
    setGuide(n)
  }, [act, go, lang])
  const startGuide = async () => { done.current.clear(); await reset(); await step(1) }

  const row = scenario?.rows[Math.round(share / 5)]
  const over = !!row && row.total > (scenario?.limit ?? Infinity)
  const today = live?.weather.find(w => w.date === live.now.date)
  const activeAlerts = live ? live.alerts.filter(a => !a.resolved).length : 0
  const known = (ROUTES as string[]).includes(path)
  const title = t((NAV.find(n => n[0] === path)?.[2] ?? (path === '/a-propos' ? 'nav.about' : 'nf.title')) as Key)
  const question = NAV.find(n => n[0] === path)?.[3]
  const demoItem = (key: Key, Icon: typeof Zap, onClick: () => void, testid?: string, pressed?: boolean) => (
    <button key={key} role="menuitem" data-testid={testid} aria-pressed={pressed} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-14 text-fg2 hover:bg-bg hover:text-fg" onClick={() => { setMenu(false); onClick() }}>
      <Icon size={16} className={pressed ? 'text-accent' : 'text-dim'} /> {t(key)}{pressed && <span className="ms-auto text-12 text-accent">●</span>}
    </button>
  )

  if (!wide) return <LangCtx.Provider value={lang}><SmallScreen /></LangCtx.Provider>

  return (
    <LangCtx.Provider value={lang}>
      <div className="dash flex h-screen overflow-hidden">
        {/* ---------- sidebar: 64px icons, expands to 220px on hover or keyboard focus ---------- */}
        <nav aria-label="Navigation" className="group fixed inset-y-0 start-0 z-40 flex w-16 flex-col border-e border-hair bg-card transition-[width] duration-150 hover:w-[220px] focus-within:w-[220px]" data-testid="sidebar">
          <a href="/" onClick={e => { e.preventDefault(); go('/') }} className="flex h-14 items-center gap-3 px-3" aria-label="TWIZA">
            <img src="/logo-96.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
            <span className="hidden whitespace-nowrap text-16 font-semibold group-hover:inline group-focus-within:inline">TWIZA <span className="font-ar font-normal text-dim">تويزة</span></span>
          </a>
          <div className="mt-2 flex flex-1 flex-col gap-1 px-3">
            {NAV.map(([p, Icon, key]) => (
              <a key={p} href={p} data-nav={p} aria-current={path === p ? 'page' : undefined} aria-label={t(key)} onClick={e => { e.preventDefault(); go(p) }}
                className={`flex h-10 items-center gap-3 rounded-lg px-2.5 text-14 ${path === p ? 'bg-accent-soft font-semibold text-accent' : 'text-fg2 hover:bg-bg hover:text-fg'}`}>
                <Icon size={20} className="shrink-0" />
                <span className="hidden whitespace-nowrap group-hover:inline group-focus-within:inline">{t(key)}</span>
              </a>
            ))}
          </div>
          <a href="/a-propos" data-nav="/a-propos" aria-label={t('nav.about')} aria-current={path === '/a-propos' ? 'page' : undefined} onClick={e => { e.preventDefault(); go('/a-propos') }} className={`m-3 flex h-10 items-center gap-3 rounded-lg px-2.5 text-14 ${path === '/a-propos' ? 'bg-accent-soft font-semibold text-accent' : 'text-fg2 hover:bg-bg hover:text-fg'}`}>
            <InfoIcon size={20} className="shrink-0" /><span className="hidden whitespace-nowrap group-hover:inline group-focus-within:inline">{t('nav.about')}</span>
          </a>
        </nav>

        <div className={`flex min-w-0 flex-1 flex-col ps-16 ${phone ? 'pe-[400px]' : ''}`}>
          {/* ---------- top bar ---------- */}
          <header className="flex h-14 shrink-0 items-center gap-4 border-b border-hair bg-card px-4">
            <div className="min-w-0">
              <h1 className="truncate text-16 font-semibold leading-5">{title}</h1>
              {question && <p className="truncate text-12 text-dim">{t(question)}</p>}
            </div>
            {live && (
              <div className="ms-2 flex items-baseline gap-2 whitespace-nowrap">
                <span className="num text-16 font-semibold" data-testid="clock">{live.now.hhmm}</span>
                <span className="text-12 capitalize text-dim">{new Date(`${live.now.date}T12:00:00Z`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
                {live.now.speed !== 1 && <span className="num rounded bg-caution-soft px-1 text-12 text-caution">×{live.now.speed}</span>}
              </div>
            )}
            {today && (
              <div className="flex items-center gap-3 whitespace-nowrap text-14 text-fg2" title={t('top.weather')}>
                <span className="flex items-center gap-1"><ThermometerSun size={16} className="text-dim" /><Num v={today.tmax} unit="°C" /></span>
                <span className="flex items-center gap-1"><Droplet size={16} className="text-dim" />ET0 <Num v={today.et0 * today.factor} d={1} unit="mm" /></span>
              </div>
            )}
            <div className="ms-auto flex items-center gap-2">
              {liveS.error && <span role="alert" className="rounded-lg bg-danger-soft px-2 py-1 text-12 font-semibold text-danger">{t('top.offline')}</span>}
              {row && (
                <button onClick={() => { go('/'); setSideTab('scenario') }} data-testid="status-pill" data-over={over} className={`flex h-8 items-center gap-2 rounded-full px-3 text-14 font-semibold ${over ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>
                  <StatusDot tone={over ? 'danger' : 'ok'} /> {t(over ? 'top.over' : 'top.under')} <span className="num">{fmt(row.pct)} %</span>
                </button>
              )}
              {live?.admin && <span className="flex h-8 items-center gap-1.5 rounded-full bg-caution-soft px-3 text-12 font-semibold text-caution" data-testid="admin-pill"><ShieldAlert size={14} /> {t('demo.adminOn')}</span>}
              <div className="tw-seg" role="group" aria-label={t('top.lang')}>
                {(['fr', 'en'] as const).map(l => <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} className="uppercase">{l}</button>)}
              </div>
              <div className="relative">
                <button className="tw-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(o => !o)} data-testid="demo-menu"><FlaskConical size={16} /> {t('top.demo')} <ChevronDown size={14} /></button>
                {menu && (
                  <div role="menu" className="absolute end-0 top-full z-50 mt-1 w-72 rounded-card border border-hair bg-card p-2 shadow-lg" data-testid="demo-items">
                    {demoItem('demo.guided', PlayCircle, startGuide, 'demo-guided')}
                    {demoItem('demo.farmer', Smartphone, () => setPhone(p => (p ? null : { farmer: 'f01', tab: 'home' })), 'demo-farmer', !!phone)}
                    <div className="my-1 border-t border-hair" />
                    <div className="px-2 py-1 text-12 text-dim">{t('demo.controls')}</div>
                    {demoItem('demo.heat', ThermometerSun, () => act('/api/demo/heatwave'), 'demo-heatwave')}
                    {demoItem('demo.rain', CloudRain, () => act('/api/demo/rain'), 'demo-rain')}
                    {demoItem('demo.ec', Waves, () => act('/api/demo/ec'), 'demo-ec')}
                    {demoItem('demo.dry', Zap, () => act('/api/demo/welldry'), 'demo-welldry')}
                    {demoItem('demo.fix', Wrench, () => act('/api/demo/wellfix'), 'demo-wellfix')}
                    {demoItem('demo.repair', Wrench, () => act('/api/demo/repair'), 'demo-repair')}
                    <div className="flex items-center gap-1 px-2 py-1.5 text-14 text-fg2"><FastForward size={16} className="text-dim" /> {t('demo.clock')}
                      <span className="ms-auto flex gap-1">{[1, 60, 600].map(s => <button key={s} className="tw-btn num !h-6 !px-1.5 !text-12" aria-pressed={live?.now.speed === s} onClick={() => act('/api/demo/clock', { speed: s })}>×{s}</button>)}</span>
                    </div>
                    <div className="my-1 border-t border-hair" />
                    {demoItem('demo.admin', ShieldAlert, () => act('/api/admin/mode', { on: !live?.admin }), 'demo-admin', !!live?.admin)}
                    {demoItem('demo.reset', RotateCcw, reset, 'demo-reset')}
                    <p className="px-2 pb-1 pt-2 text-12 text-dim">{t('demo.session')}</p>
                  </div>
                )}
              </div>
            </div>
          </header>

          {guide != null && (
            <div className="flex shrink-0 items-center gap-3 border-b border-hair bg-accent-soft px-4 py-2 text-14" role="status" data-testid="guide">
              <span className="whitespace-nowrap font-semibold text-accent">{t('g.title')} · {t('g.step')} {guide}/8</span>
              <span className="min-w-0 flex-1 text-fg" data-testid="guide-caption">{t(`g.${guide}` as Key)}</span>
              <button className="tw-btn" disabled={guide <= 1} onClick={() => step(guide - 1)} data-testid="guide-prev">{t('g.prev')}</button>
              <button className="tw-btn primary" disabled={guide >= 8} onClick={() => step(guide + 1)} data-testid="guide-next">{t('g.next')}</button>
              <button className="tw-btn tw-icon" aria-label={t('g.quit')} onClick={() => setGuide(null)} data-testid="guide-quit"><X size={16} /></button>
            </div>
          )}

          {/* ---------- page ---------- */}
          <main className={`flex min-h-0 flex-1 flex-col gap-4 p-4 ${path === '/' ? '' : 'scroll overflow-y-auto'}`}>
            {!known ? <NotFound go={go} />
              : path === '/a-propos' ? <AboutPage />
              : !net || !live ? (netS.error || liveS.error ? <ErrorState retry={() => { netS.refresh(); liveS.refresh() }} /> : <><div className="grid grid-cols-4 gap-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[88px]" />)}</div><Skeleton className="min-h-0 flex-1" /></>)
              : path === '/' ? (
                <>
                  <Kpis live={live} scenario={scenario} share={share} activeAlerts={activeAlerts} onAlerts={() => setSideTab('alerts')} />
                  <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4">
                    <Suspense fallback={<Skeleton className="h-full" />}>
                      <MapView net={net} live={live} scenario={scenario} share={share} view={view} setView={setView} preview={preview} setPreview={setPreview} zone={zone}
                        onUnrecordedLayer={on => act('/api/admin/unrecorded-layer', { on })} onSelect={setSel} />
                    </Suspense>
                    <SidePanel net={net} live={live} scS={scS} share={share} setShare={setShare} tab={sideTab} setTab={setSideTab} minute={preview ?? live.now.minute} go={go} activeAlerts={activeAlerts} />
                  </div>
                </>
              ) : path === '/tours' ? <TurnsPage net={net} live={live} />
              : path === '/capteurs' ? <SensorsPage trS={trS} live={live} />
              : <AssistantPage live={live} ask={ask} clearAsk={() => setAsk(null)} />}
          </main>

          <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-hair bg-card px-4 text-12 text-dim">
            <span className="truncate">{t('foot.synthetic')}</span>
            <a href="/a-propos" onClick={e => { e.preventDefault(); go('/a-propos') }} className="ms-auto whitespace-nowrap underline hover:text-fg">{t('foot.about')}</a>
            <a href="/a-propos#confidentialite" onClick={e => { e.preventDefault(); go('/a-propos'); setTimeout(() => document.getElementById('confidentialite')?.scrollIntoView(), 50) }} className="whitespace-nowrap underline hover:text-fg">{t('foot.privacy')}</a>
          </footer>
        </div>

        {sel && (
          <Drawer title={sel.title} onClose={() => setSel(null)}>
            {sel.rows.map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}
            {sel.note && <p className="mt-3 border-t border-hair pt-3 text-14 text-fg2">{sel.note}</p>}
          </Drawer>
        )}
        {phone && net && (
          <aside className="fixed inset-y-0 end-0 z-50 flex w-[400px] flex-col border-s border-hair bg-card shadow-xl" data-testid="phone" aria-label={t('demo.farmer')}>
            <div className="flex items-center gap-2 border-b border-hair px-3 py-2 text-14 text-fg2">
              <Smartphone size={16} /> <label htmlFor="ph-f">{t('ph.viewOf')}</label>
              <select id="ph-f" value={phone.farmer} onChange={e => setPhone({ farmer: e.target.value, tab: 'home' })} className="h-8 min-w-0 flex-1 rounded-lg border border-hair bg-card px-2 text-fg" data-testid="phone-farmer">
                {net.farmers.map(f => <option key={f.id} value={f.id}>{f.first} {f.last}</option>)}
              </select>
              <a className="tw-btn tw-icon" href={`/farmer?f=${phone.farmer}&s=${SESSION}`} target="_blank" rel="noreferrer" aria-label={t('ph.open')}>↗</a>
              <button className="tw-btn tw-icon" onClick={() => setPhone(null)} aria-label={t('close')} data-testid="phone-close"><X size={16} /></button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3">
              <div className="h-full max-h-[800px] w-[360px] overflow-hidden rounded-[24px] border-[6px] border-fg bg-black">
                <iframe key={`${phone.farmer}-${phone.tab}`} title={t('demo.farmer')} src={`/farmer?f=${phone.farmer}&tab=${phone.tab}&s=${SESSION}`} className="h-full w-full" />
              </div>
            </div>
          </aside>
        )}
      </div>
    </LangCtx.Provider>
  )
}

// =====================================================================
function Kpis({ live, scenario, share, activeAlerts, onAlerts }: { live: Live; scenario: Scenario | null; share: number; activeAlerts: number; onAlerts: () => void }) {
  const { t } = useT()
  const row = scenario?.rows[Math.round(share / 5)]
  const k = live.kpis
  const over = !!row && !!scenario && row.total > scenario.limit
  const Tile = ({ label, help, children, sub, tone, align, onClick, testid }: { label: Key; help: Key; children: React.ReactNode; sub: React.ReactNode; tone?: 'danger' | 'ok'; align?: 'end'; onClick?: () => void; testid: string }) => (
    <div className="tw-card flex h-[88px] flex-col justify-between px-4 py-3" data-testid={testid}>
      <div className="flex items-center gap-1.5 text-12 text-dim"><span className="flex-1 truncate">{t(label)}</span><Info text={t(help)} align={align} /></div>
      <div className="flex items-baseline gap-3">
        <span className={`text-28 font-semibold leading-8 ${tone === 'danger' ? 'text-danger' : 'text-fg'}`}>{children}</span>
        {onClick ? <button onClick={onClick} className="truncate text-12 text-accent underline">{sub}</button> : <span className="truncate text-12 text-dim">{sub}</span>}
      </div>
    </div>
  )
  return (
    <div className="grid shrink-0 grid-cols-4 gap-4" data-testid="kpis">
      <Tile label="kpi.pump" help="help.pump" tone={over ? 'danger' : undefined} testid="kpi-pump" sub={row ? <><span className={`num font-semibold ${over ? 'text-danger' : 'text-ok'}`}>{fmt(row.pct)} %</span> {t('kpi.pumpSub')}</> : ''}>
        {row ? <Num v={row.total} unit={`m³/${t('unit.day')}`} /> : '—'}
      </Tile>
      <Tile label="kpi.turns" help="help.turns" testid="kpi-turns" sub={t('kpi.turnsSub')}><span className="num">{k.turnsDone}<span className="text-16 font-normal text-dim"> / {k.turnsToday}</span></span></Tile>
      <Tile label="kpi.fair" help="help.fair" testid="kpi-fair" sub={<><span className="num">{k.below}</span> {t('kpi.fairSub')}</>}><Num v={k.fairness} d={2} /></Tile>
      <Tile label="kpi.alerts" help="help.alerts" testid="kpi-alerts" align="end" tone={activeAlerts ? 'danger' : undefined} onClick={activeAlerts ? onAlerts : undefined} sub={activeAlerts ? t('kpi.alertsSub') : t('kpi.alertsNone')}><span className="num">{activeAlerts}</span></Tile>
    </div>
  )
}

// =====================================================================
function SidePanel({ net, live, scS, share, setShare, tab, setTab, minute, go, activeAlerts }: { net: Network; live: Live; scS: ReturnType<typeof useApi<Scenario>>; share: number; setShare: (n: number) => void; tab: SideTab; setTab: (t: SideTab) => void; minute: number; go: (p: string) => void; activeAlerts: number }) {
  const { t, lang } = useT()
  const [allAlerts, setAllAlerts] = useState(false)
  const plan = live.plans[0]
  const farmer = useMemo(() => new Map(net.farmers.map(f => [f.id, f])), [net])
  const st = Math.min(288, Math.floor(minute / 5))
  const pumped = plan.pumpedCum[st] ?? 0
  const stock = net.jebias.reduce((a, j) => a + (plan.jebiaLevels[j.id]?.[st] ?? 0), 0) / net.jebias.reduce((a, j) => a + j.capacityM3, 0)
  const active = plan.turns.filter(x => x.start >= 0 && minute >= x.start && minute < x.end)
  const doneN = plan.turns.filter(x => x.start >= 0 && minute >= x.end).length
  const next = plan.turns.filter(x => x.start >= 0 && x.end > minute).sort((a, b) => a.start - b.start).slice(0, 3)
  const alerts = live.alerts.filter(a => !a.resolved)
  const resolved = live.alerts.filter(a => a.resolved)
  const AlertCard = ({ a }: { a: Live['alerts'][number] }) => (
    <article className="rounded-lg border border-hair p-3" data-alert={a.kind}>
      <div className="flex items-start gap-2">
        <span className="mt-1.5"><StatusDot tone={a.resolved ? 'dim' : a.severity === 'crit' ? 'danger' : a.severity === 'warn' ? 'caution' : 'accent'} /></span>
        <div className="min-w-0">
          <h3 className="text-14 font-semibold">{a.title[lang]}</h3>
          <p className="num text-12 text-dim">{t(a.kind === 'proactive' ? 'alerts.proactive' : 'alerts.reactive')} · {a.date.slice(8)}/{a.date.slice(5, 7)} {hhmm(a.minute)}</p>
          <p className="mt-1 text-14 text-fg2"><span className="font-semibold text-fg">{t('alerts.decision')} : </span>{a.decision[lang]}</p>
        </div>
      </div>
    </article>
  )
  return (
    <section className="tw-card flex min-h-0 flex-col" data-testid="side">
      <Tabs value={tab} onChange={setTab} tabs={[['today', t('tab.today')], ['alerts', t('tab.alerts'), activeAlerts], ['scenario', t('tab.scenario')]]} />
      <div className="scroll min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        {tab === 'today' && (
          <div className="space-y-4" data-testid="today">
            <div>
              <div className="tw-card-h mb-2">{t('flow.title')} <Info text={t('flow.help')} /></div>
              <div className="flex items-stretch text-center" data-testid="flow">
                {([['flow.wells', <Num v={pumped} unit="m³" />], ['flow.jebias', <Num v={stock * 100} unit="%" />], ['flow.seguias', <span className="num">{active.length}/{net.seguias.length}</span>], ['flow.plots', <span className="num">{doneN}/{plan.turns.length}</span>]] as [Key, React.ReactNode][]).map(([k, v], i) => (
                  <div key={k} className="flex min-w-0 flex-1 items-center">
                    <div className="min-w-0 flex-1"><div className="truncate text-12 text-dim">{t(k)}</div><div className="text-14 font-semibold">{v}</div></div>
                    {i < 3 && <span className="px-0.5 text-dim" aria-hidden>→</span>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="tw-card-h mb-2">{t('next.title')}</div>
              {!next.length && <p className="text-14 text-dim">{t('next.none')}</p>}
              <ul className="space-y-2">
                {next.map(x => {
                  const on = minute >= x.start
                  return (
                    <li key={x.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${on ? 'border-accent bg-accent-soft' : 'border-hair'}`}>
                      <span className="num w-[86px] shrink-0 text-14 font-semibold">{hhmm(x.start)}–{hhmm(x.end)}</span>
                      <span className="min-w-0 flex-1 truncate text-14">{farmer.get(x.farmerId)?.first} <span className="text-dim">· S{x.seguiaId.slice(1)}</span></span>
                      {on ? <span className="text-12 font-semibold text-accent">{t('next.now')}</span> : <Num v={x.target} unit="m³" className="text-14" />}
                    </li>
                  )
                })}
              </ul>
              <button className="mt-2 text-14 text-accent underline" onClick={() => go('/tours')} data-testid="all-turns">{t('all')}</button>
            </div>
          </div>
        )}
        {tab === 'alerts' && (
          <div className="space-y-2" data-testid="alerts">
            {!alerts.length && <p className="text-14 text-dim">{t('alerts.none')}</p>}
            {(allAlerts ? alerts : alerts.slice(0, 3)).map(a => <AlertCard key={a.id} a={a} />)}
            {alerts.length > 3 && <button className="text-14 text-accent underline" onClick={() => setAllAlerts(v => !v)} data-testid="all-alerts">{allAlerts ? t('less') : `${t('all')} (${alerts.length})`}</button>}
            {resolved.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-14 text-fg2">{t('alerts.resolved')} ({resolved.length})</summary>
                <div className="mt-2 space-y-2">{resolved.map(a => <AlertCard key={a.id} a={a} />)}</div>
              </details>
            )}
          </div>
        )}
        {tab === 'scenario' && (
          <Async state={scS} skeleton="h-64">
            {sc => {
              const i = Math.round(share / 5), r = sc.rows[i], max = Math.max(sc.limit * 1.1, sc.rows[0].total * 1.02), saved = sc.rows[0].total - r.total
              const peak = Math.round((1 - Math.max(...sc.grid.dd[i]) / Math.max(...sc.grid.dd[0])) * 100)
              const isOver = r.total > sc.limit
              return (
                <div className="space-y-4" data-testid="scenario">
                  <div>
                    <label htmlFor="share" className="tw-card-h mb-2">{t('sc.title')} <Info text={t('sc.help')} /></label>
                    <div className="flex items-center gap-3">
                      <input id="share" data-testid="share" type="range" min={0} max={100} step={5} value={share} onChange={e => setShare(Number(e.target.value))} className="tw-range flex-1" style={{ background: `linear-gradient(90deg, var(--accent) ${share}%, var(--border) ${share}%)` }} />
                      <span className="num w-14 text-end text-20 font-semibold">{share} %</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {[0, 35, 70, 100].map(v => <button key={v} className="tw-btn num !h-7 !px-2" aria-pressed={share === v} onClick={() => setShare(v)} data-share={v}>{v === 0 ? t('sc.without') : `${v} %`}</button>)}
                    </div>
                    <p className="num mt-1 text-12 text-dim">{r.joined} / {sc.wells} {t('sc.wells')}</p>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between"><span className="text-12 text-dim">{t('sc.total')}</span><span className={`text-20 font-semibold ${isOver ? 'text-danger' : 'text-fg'}`} data-testid="scenario-total"><Num v={r.total} unit={`m³/${t('unit.day')}`} /></span></div>
                    <div className="relative mt-2 h-5" aria-hidden>
                      <div className="absolute inset-x-0 top-1.5 flex h-2 gap-px overflow-hidden rounded bg-bg">
                        <div className="h-full bg-accent" style={{ width: `${(r.collective / max) * 100}%` }} /><div className="h-full bg-[#6fb1bc]" style={{ width: `${(r.private / max) * 100}%` }} />
                      </div>
                      <div className="absolute top-0 h-5 w-0.5 bg-fg" style={{ left: `${(sc.limit / max) * 100}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-12 text-fg2">
                      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent" />{t('sc.collective')} <Num v={r.collective} /></span>
                      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#6fb1bc]" />{t('sc.private')} <Num v={r.private} /></span>
                      <span className="flex items-center gap-1"><span className="inline-block h-3 w-0.5 bg-fg" />{t('sc.limit')} <Num v={sc.limit} /></span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-bg p-3" data-testid="effects">
                    <Row k={t('sc.saved')}><Num v={saved} unit={`m³/${t('unit.day')}`} className="font-semibold" /></Row>
                    <Row k={t('sc.energy')}><span title={t('sc.energyHelp')}>≈ <Num v={saved * 0.19} unit={`kWh/${t('unit.day')}`} className="font-semibold" /></span></Row>
                    <Row k={t('sc.stress')}><span className="num font-semibold">{peak > 0 ? `−${peak} %` : '—'}</span></Row>
                    <Row k={t('sc.unrecorded')}><span className="num font-semibold">{sc.unrecorded.joined[i]} / {sc.unrecorded.count}</span></Row>
                    <Row k={r.crossMin != null ? t('sc.cross') : t('sc.nocross')}><span className="num font-semibold">{r.crossMin != null ? hhmm(r.crossMin) : '✓'}</span></Row>
                  </div>
                </div>
              )
            }}
          </Async>
        )}
      </div>
    </section>
  )
}
