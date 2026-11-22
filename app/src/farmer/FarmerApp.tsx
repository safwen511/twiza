import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeftRight, Camera, Check, ChevronLeft, ChevronRight, Clock, CloudRain, Construction, Droplet, Droplets, FileCheck2, Home, Lightbulb, Lock, Menu, MessageSquareText, Scissors, ThermometerSun, User, Volume2, Waves, WifiOff, X, Zap,
} from 'lucide-react'
import { get, hhmm, post, usePoll } from '../api'
import type { Advice, FLang, FarmerView, NetFarmer, TurnView } from '../types'
import { F } from './strings'

type Tab = 'home' | 'advice' | 'swap' | 'report' | 'more' | 'well' | 'reg' | 'sms'
const params = new URLSearchParams(location.search)

function speak(text: string, lang: FLang, done: () => void) {
  const s = window.speechSynthesis
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') { setTimeout(done, 2500); return }
  s.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const voice = s.getVoices().find(v => v.lang.toLowerCase().startsWith(lang))
  if (voice) u.voice = voice
  u.lang = voice?.lang ?? (lang === 'ar' ? 'ar-SA' : 'fr-FR')
  u.rate = 0.9
  let ended = false
  const end = () => { if (!ended) { ended = true; done() } }
  u.onend = end
  u.onerror = end
  s.speak(u)
  setTimeout(end, 15000)
}

export default function FarmerApp() {
  const [id, setId] = useState(() => params.get('f') || localStorage.getItem('twiza-farmer') || 'f01')
  const [lang, setLang] = useState<FLang>(() => (localStorage.getItem('twiza-flang') as FLang) || 'ar')
  const [tab, setTab] = useState<Tab>(() => { const q = params.get('tab'); return q && ['home', 'advice', 'swap', 'report', 'more', 'well', 'reg', 'sms'].includes(q) ? (q as Tab) : 'home' })
  const [dev, setDev] = useState(false)
  const [farmers, setFarmers] = useState<NetFarmer[]>([])
  const taps = useRef<number[]>([])
  const { data: v, offline, refresh } = usePoll<FarmerView>(`/api/farmer/${id}`, 2000)
  const t = F[lang]

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = t.dir
    document.body.className = 'bg-stone-300'
    document.documentElement.style.fontSize = '16px'
    localStorage.setItem('twiza-flang', lang)
  }, [lang, t.dir])
  useEffect(() => { localStorage.setItem('twiza-farmer', id) }, [id])
  useEffect(() => { if (dev && !farmers.length) get<{ farmers: NetFarmer[] }>('/api/network').then(n => setFarmers(n.farmers)).catch(() => {}) }, [dev, farmers.length])

  // hidden dev menu: 5 quick taps on the logo
  const logoTap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter(x => now - x < 2500), now]
    if (taps.current.length >= 5) { taps.current = []; setDev(true) }
  }

  const name = v ? (lang === 'ar' ? v.farmer.firstAr : v.farmer.first) : ''
  const badge = v ? v.swapsIn.length : 0
  const nav: [Tab, typeof Home, string][] = [['home', Home, t.nav.home], ['advice', Lightbulb, t.nav.advice], ['swap', ArrowLeftRight, t.nav.swap], ['report', AlertTriangle, t.nav.report], ['more', Menu, t.nav.more]]
  const sub = tab === 'well' || tab === 'reg' || tab === 'sms'

  return (
    <div dir={t.dir} className={`mx-auto flex h-full max-w-[430px] flex-col bg-sand text-stone-900 shadow-xl ${lang === 'ar' ? 'font-ar' : 'font-sans'}`}>
      <header className="flex items-center gap-2 bg-ink px-4 py-2.5 text-white">
        {sub ? (
          <button onClick={() => setTab('more')} aria-label="back" className="-ms-1 rounded-full p-1.5 active:bg-white/20">{t.dir === 'rtl' ? <ChevronRight size={26} /> : <ChevronLeft size={26} />}</button>
        ) : (
          <button onClick={logoTap} aria-label="TWIZA" data-testid="logo" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white"><img src="/logo-96.png" alt="" width={40} height={40} className="h-10 w-10 rounded-full" /></button>
        )}
        <div className="flex-1 leading-tight">
          <div className="text-lg font-bold">تويزة <span className="text-sm font-normal opacity-80">TWIZA</span></div>
          <div className="text-xs opacity-85">{v ? `${name} · ${v.now.hhmm}` : ''}</div>
        </div>
        <button onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')} data-testid="lang" className="min-h-[44px] rounded-full border border-white/50 px-4 text-sm font-semibold active:bg-white/20">{t.langBtn}</button>
      </header>
      {offline && <div className="flex items-center gap-2 bg-brand px-4 py-1.5 text-sm text-white"><WifiOff size={16} /> {t.offline}</div>}

      <main className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4 pt-3">
        {!v ? null : tab === 'home' ? <HomeScreen v={v} lang={lang} refresh={refresh} go={setTab} />
          : tab === 'advice' ? <AdviceScreen v={v} lang={lang} />
          : tab === 'swap' ? <SwapScreen v={v} lang={lang} refresh={refresh} />
          : tab === 'report' ? <ReportScreen v={v} lang={lang} refresh={refresh} />
          : tab === 'more' ? <MoreScreen v={v} lang={lang} go={setTab} />
          : tab === 'well' ? <WellScreen v={v} lang={lang} />
          : tab === 'reg' ? <RegScreen v={v} lang={lang} refresh={refresh} />
          : <SmsScreen v={v} lang={lang} />}
        <div className="mt-5 text-center text-[11px] text-stone-500">{t.synthetic}</div>
      </main>

      <nav className="grid grid-cols-5 border-t border-stone-300 bg-white pb-[env(safe-area-inset-bottom)]">
        {nav.map(([k, Icon, label]) => {
          const on = tab === k || (k === 'more' && sub)
          return (
            <button key={k} data-tab={k} onClick={() => setTab(k)} aria-current={on} className={`relative flex flex-col items-center gap-0.5 py-2 ${on ? 'text-palm' : 'text-stone-500'}`}>
              <span className={`rounded-full px-4 py-1 ${on ? 'bg-palm/15' : ''}`}><Icon size={26} strokeWidth={on ? 2.6 : 2} /></span>
              <span className={`text-[13px] ${on ? 'font-bold' : ''}`}>{label}</span>
              {k === 'swap' && badge > 0 && <span className="absolute end-4 top-1 h-5 min-w-5 rounded-full bg-brand px-1 text-center text-xs font-bold leading-5 text-white">{badge}</span>}
              {k === 'advice' && v && v.advice.length > 0 && !on && <span className="absolute end-5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500" />}
            </button>
          )
        })}
      </nav>

      {dev && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setDev(false)}>
          <div dir="ltr" className="max-h-[75%] w-full max-w-[430px] overflow-y-auto rounded-t-3xl bg-white p-4 font-sans" onClick={e => e.stopPropagation()} data-testid="dev-menu">
            <div className="mb-2 flex items-center justify-between text-base font-bold"><span>{t.devTitle}</span><button onClick={() => setDev(false)} aria-label="close"><X /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {farmers.map(f => (
                <button key={f.id} data-farmer={f.id} onClick={() => { setId(f.id); setDev(false); setTab('home') }} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-start text-sm ${f.id === id ? 'border-palm bg-palm/10 font-bold' : 'border-stone-300'}`}>
                  <User size={16} /> {f.first} {f.last}
                </button>
              ))}
            </div>
            <a href="/" className="mt-3 block text-center text-sm text-palm underline">Dashboard</a>
          </div>
        </div>
      )}
    </div>
  )
}

interface P { v: FarmerView; lang: FLang }
const nm = (x: { first: string; firstAr: string }, lang: FLang) => (lang === 'ar' ? x.firstAr : x.first)
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <div className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}>{children}</div>
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-3 mt-1 px-1 text-2xl font-bold">{children}</h2>

// ---------------------------------------------------------------- Today
function HomeScreen({ v, lang, refresh, go }: P & { refresh: () => void; go: (t: Tab) => void }) {
  const t = F[lang]
  const [speaking, setSpeaking] = useState(false)
  const nx = v.next
  const blocked = v.seguia?.blockedUntil != null
  const hero = blocked ? 'red' : v.status === 'now' || v.status === 'today' ? 'green' : 'grey'
  const title = blocked ? t.blocked(v.seguia!.n) : v.status === 'now' ? t.now : v.status === 'today' ? t.today : v.status === 'later' ? t.notToday : t.noTurn
  const subtitle = blocked ? t.blockedSub(hhmm(v.seguia!.blockedUntil!)) : v.status === 'now' && nx ? t.nowSub(hhmm(nx.end)) : v.status === 'today' && nx ? t.todaySub(hhmm(nx.start), hhmm(nx.end)) : v.status === 'none' ? t.noTurnSub : ''
  const nextLine = nx && nx.start >= 0 && v.jebia ? t.nextTurn(t.day(nx.dayOffset), hhmm(nx.start), hhmm(nx.end), v.jebia.n) : ''
  const neighbourLine = v.neighbour && v.seguia ? t.neighbour(nm(v.neighbour, lang), v.seguia.n) : ''
  const greeting = t.greet(v.now.minute, nm(v.farmer, lang))
  const wellLine = v.status === 'none' && v.myWell?.advisedHours != null ? t.wellAdvice(t.hm(v.myWell.advisedHours * 60), v.myWell.advisedM3 ?? 0) : ''
  const spoken = [greeting, title, subtitle, v.status === 'now' ? '' : nextLine, neighbourLine, wellLine].filter(Boolean).join('. ')
  const HeroIcon = blocked ? Construction : hero === 'green' ? Droplet : v.status === 'none' ? Zap : Clock
  const answer = async (id: string, accept: boolean) => { await post(`/api/swaps/${id}`, { accept }).catch(() => {}); refresh() }

  return (
    <div className="space-y-3">
      <section data-testid="hero" data-status={hero} className={`rounded-3xl p-5 text-white shadow-md ${hero === 'green' ? 'bg-oasis' : hero === 'red' ? 'bg-brand' : 'bg-[#7A766F]'}`}>
        <div className="flex items-start gap-4">
          <div className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-white/20 ${v.status === 'now' && !blocked ? 'pulse' : ''}`}><HeroIcon size={42} strokeWidth={2.2} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-lg opacity-95" data-testid="greeting">{greeting}</div>
            <div className="text-[28px] font-bold leading-tight" data-testid="status">{title}</div>
            {subtitle && <div className="mt-0.5 text-lg opacity-95">{subtitle}</div>}
          </div>
        </div>
        <button
          data-testid="listen"
          onClick={() => { const t0 = Date.now(); setSpeaking(true); speak(spoken, lang, () => setTimeout(() => setSpeaking(false), Math.max(0, 2500 - (Date.now() - t0)))) }}
          className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-3 text-xl font-bold text-stone-900 active:scale-[.98]"
        >
          {speaking ? <span className="wave text-palm"><span /><span /><span /></span> : <Volume2 size={28} className="text-palm" />}
          {speaking ? t.spoken : t.listen}
        </button>
      </section>

      {v.swapsIn.map(s => (
        <Card key={s.id} className="border-2 border-violet-500">
          <div className="flex items-center gap-3 text-lg font-bold"><ArrowLeftRight size={30} className="shrink-0 text-violet-600" /> {t.swapIn(nm(s, lang))}</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button data-testid="swap-accept" onClick={() => answer(s.id, true)} className="flex items-center justify-center gap-2 rounded-2xl bg-oasis py-3 text-xl font-bold text-white"><Check size={26} /> {t.accept}</button>
            <button onClick={() => answer(s.id, false)} className="flex items-center justify-center gap-2 rounded-2xl bg-stone-200 py-3 text-xl font-bold text-stone-800"><X size={26} /> {t.refuse}</button>
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-1 text-sm text-stone-600" data-testid="legend">
        {(['bg-oasis', 'bg-[#7A766F]', 'bg-brand'] as const).map((c, i) => (
          <span key={c} className="flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded-full ${c}`} /> {t.legend[i]}</span>
        ))}
      </div>

      {nx && nx.start >= 0 && (
        <Card>
          <div className="text-[21px] font-bold leading-snug" data-testid="next">{t.nextTurnShort(t.day(nx.dayOffset), hhmm(nx.start), hhmm(nx.end))}</div>
          {v.jebia && v.seguia && <div className="mt-0.5 text-base text-stone-600">{t.place(v.jebia.n, v.seguia.n)}</div>}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-stone-100 p-3">
              <div className="flex items-center gap-1.5 text-sm text-stone-600"><Clock size={18} /> {nx.state === 'active' ? t.ends : t.left}</div>
              <div className="mt-0.5 whitespace-nowrap text-[22px] font-bold" data-testid="countdown">{v.countdownMin != null ? t.hm(v.countdownMin) : '—'}</div>
            </div>
            <div className="rounded-2xl bg-sky-50 p-3">
              <div className="flex items-center gap-1.5 text-sm text-sky-800"><Droplets size={18} /> {t.water}</div>
              <div className="mt-0.5 text-2xl font-bold text-sky-900" data-testid="water">{nx.m3} {t.m3}</div>
              <div className="text-sm text-sky-800">{t.hm(nx.end - nx.start)}</div>
            </div>
          </div>
          {(nx.flags.includes('swap') || nx.extraMin >= 5 || nx.flags.includes('cut')) && (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {nx.flags.includes('swap') && <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-violet-800"><ArrowLeftRight size={15} /> {t.swapped}</span>}
              {nx.extraMin >= 5 && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-900"><ThermometerSun size={15} /> +{t.hm(nx.extraMin)}</span>}
              {nx.flags.includes('cut') && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-900"><Scissors size={15} /> {Math.round(nx.underShare * 100)}٪</span>}
            </div>
          )}
        </Card>
      )}

      {v.status === 'none' && v.myWell && (
        <button className="block w-full text-start" onClick={() => go('well')}>
          <Card><div className="flex items-center gap-3 text-xl font-bold"><Zap size={30} className="shrink-0 text-palm" /> {wellLine || t.myWell}</div></Card>
        </button>
      )}

      {neighbourLine && (
        <Card className="!bg-green-50">
          <div className="flex items-center gap-3 text-lg font-semibold text-green-900" data-testid="neighbour"><Droplet size={28} className="shrink-0 text-oasis" /> {neighbourLine}</div>
        </Card>
      )}

      {v.notifs.slice(0, 2).map(n => (
        <div key={n.id} className="flex items-center gap-2 rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-base" data-testid="notif">
          <Check size={20} className="shrink-0 text-palm" /> <span className="flex-1">{n.text[lang]}</span> <span className="text-xs text-stone-500">{hhmm(n.minute)}</span>
        </div>
      ))}

      {v.seguia && v.timeline.length > 0 && (
        <Card>
          <div className="mb-3 text-lg font-bold">{t.timeline(v.seguia.n)}</div>
          <ol className="relative space-y-2" data-testid="timeline">
            {v.timeline.map(x => <TimelineRow key={x.id} x={x} lang={lang} />)}
            {nx && nx.dayOffset > 0 && nx.start >= 0 && (
              <>
                <li className="py-0.5 text-center text-sm font-semibold text-stone-500">— {t.day(nx.dayOffset)} —</li>
                <TimelineRow x={nx} lang={lang} />
              </>
            )}
          </ol>
        </Card>
      )}
    </div>
  )
}

function TimelineRow({ x, lang }: { x: TurnView; lang: FLang }) {
  const t = F[lang]
  const tone = x.state === 'active' ? 'bg-oasis text-white' : x.state === 'done' ? 'bg-stone-100 text-stone-700' : 'bg-white text-stone-900 border border-stone-300'
  return (
    <li data-me={x.me} data-state={x.state} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${tone} ${x.me ? 'ring-[3px] ring-palm' : ''}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${x.state === 'active' ? 'bg-white/25' : x.state === 'done' ? 'bg-stone-200' : 'bg-stone-100'}`}>
        {x.state === 'done' ? <Check size={20} /> : x.state === 'active' ? <Droplet size={20} /> : <Clock size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold leading-tight">{nm(x, lang)}{x.me ? ` (${t.me})` : ''}</span>
        <span className="block text-sm">{x.state === 'done' ? t.done : x.state === 'active' ? t.active : t.pending}{x.flags.includes('delayed') ? ` · ${t.late}` : ''}{x.flags.includes('swap') ? ` · ${t.swapped}` : ''}</span>
      </span>
      <span dir="ltr" className="num text-lg font-bold">{x.start < 0 ? '—' : `${hhmm(x.start)} – ${hhmm(x.end)}`}</span>
    </li>
  )
}

// ---------------------------------------------------------------- Advice
const ADVICE_ICON: Record<Advice['icon'], [typeof Home, string]> = {
  heat: [ThermometerSun, 'bg-amber-100 text-amber-700'], salt: [Waves, 'bg-sky-100 text-sky-700'], rain: [CloudRain, 'bg-blue-100 text-blue-700'],
  short: [Scissors, 'bg-orange-100 text-orange-700'], well: [Zap, 'bg-teal-100 text-teal-700'], tip: [Lightbulb, 'bg-yellow-100 text-yellow-700'],
}
function AdviceScreen({ v, lang }: P) {
  const t = F[lang]
  return (
    <div>
      <H>{t.adviceTitle}</H>
      <p className="-mt-2 mb-3 px-1 text-base text-stone-600">{t.hintAdvice}</p>
      <div className="space-y-3" data-testid="advice">
        {!v.advice.length && <Card><div className="text-lg text-stone-600">{t.adviceNone}</div></Card>}
        {v.advice.map(a => {
          const [Icon, tone] = ADVICE_ICON[a.icon]
          return (
            <Card key={a.id} className="flex items-center gap-4">
              <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${tone}`}><Icon size={36} /></span>
              <div className="flex-1">
                <div className="text-xl font-semibold leading-snug" data-advice={a.key}>{a[lang]}</div>
                {a.llm && <div className="mt-1 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{t.ai}</div>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Swap
function SwapScreen({ v, lang, refresh }: P & { refresh: () => void }) {
  const t = F[lang]
  const [busy, setBusy] = useState(false)
  const ask = async (to: string) => { setBusy(true); await post('/api/swaps', { from: v.farmer.id, to }).catch(() => {}); setBusy(false); refresh() }
  const answer = async (id: string, accept: boolean) => { await post(`/api/swaps/${id}`, { accept }).catch(() => {}); refresh() }
  const pendingOut = v.swapsOut.find(s => s.status === 'pending')
  const turnLine = (x: TurnView) => <span dir="ltr" className="num">{hhmm(x.start)} – {hhmm(x.end)}</span>
  return (
    <div>
      <H>{t.swapTitle}</H>
      <p className="-mt-2 mb-3 px-1 text-base text-stone-600">{t.hintSwap}</p>
      <div className="space-y-3">
        {v.swapsIn.map(s => (
          <Card key={s.id} className="border-2 border-violet-500">
            <div className="flex items-center gap-3 text-lg font-bold"><ArrowLeftRight size={30} className="shrink-0 text-violet-600" /> {t.swapIn(nm(s, lang))}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button onClick={() => answer(s.id, true)} className="flex items-center justify-center gap-2 rounded-2xl bg-oasis py-3 text-xl font-bold text-white"><Check size={26} /> {t.accept}</button>
              <button onClick={() => answer(s.id, false)} className="flex items-center justify-center gap-2 rounded-2xl bg-stone-200 py-3 text-xl font-bold"><X size={26} /> {t.refuse}</button>
            </div>
          </Card>
        ))}
        {v.swapsOut.slice(0, 1).map(s => (
          <div key={s.id} data-testid="swap-out" data-status={s.status} className={`rounded-2xl px-4 py-3 text-lg font-semibold ${s.status === 'accepted' ? 'bg-green-100 text-green-900' : s.status === 'refused' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>
            {s.status === 'pending' ? t.swapWait(nm(s, lang)) : s.status === 'accepted' ? t.swapOk(nm(s, lang)) : t.swapNo(nm(s, lang))}
          </div>
        ))}
        {v.next && v.next.start >= 0 && (
          <Card className="!bg-ink text-white">
            <div className="text-sm opacity-85">{t.swapMine}</div>
            <div className="text-2xl font-bold">{t.day(v.next.dayOffset)} · {turnLine(v.next)}</div>
          </Card>
        )}
        {v.candidates.length > 0 && <div className="px-1 pt-1 text-lg font-bold">{t.swapChoose}</div>}
        {!v.candidates.length && <Card><div className="text-lg text-stone-600">{t.swapNone}</div></Card>}
        {v.candidates.map(c => (
          <Card key={c.id} className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-100"><User size={26} /></span>
            <div className="flex-1">
              <div className="text-xl font-bold">{nm(c, lang)}</div>
              <div className="text-base text-stone-600">{t.day(c.dayOffset)} · {turnLine(c)}</div>
            </div>
            <button data-swap={c.farmerId} disabled={busy || !!pendingOut} onClick={() => ask(c.farmerId)} className="flex items-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"><ArrowLeftRight size={22} /> {t.swapAsk}</button>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Report
const REPORTS: [keyof (typeof F)['ar']['types'], typeof Home, string][] = [
  ['no_water', Droplet, 'bg-sky-600'], ['seguia_broken', Construction, 'bg-orange-600'], ['leak', Droplets, 'bg-blue-700'], ['well_dry', Zap, 'bg-stone-700'],
]
function ReportScreen({ v, lang, refresh }: P & { refresh: () => void }) {
  const t = F[lang]
  const [pick, setPick] = useState<(typeof REPORTS)[number] | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const onFile = (file?: File) => {
    if (!file) return
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = img.width * k
      c.height = img.height * k
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      setPhoto(c.toDataURL('image/jpeg', 0.7))
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }
  const send = async () => {
    if (!pick) return
    setBusy(true)
    await post('/api/reports', { farmerId: v.farmer.id, type: pick[0], photo }).catch(() => {})
    setBusy(false); setPick(null); setPhoto(null); setSent(true)
    refresh()
    setTimeout(() => setSent(false), 6000)
  }
  return (
    <div>
      <H>{t.reportTitle}</H>
      {sent && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-oasis p-4 text-white" data-testid="report-sent">
          <Check size={36} className="shrink-0" />
          <div><div className="text-xl font-bold">{t.reportSent}</div><div className="text-base opacity-95">{t.reportSentSub}</div></div>
        </div>
      )}
      <div className="mb-2 px-1 text-base text-stone-600">{t.reportHint}</div>
      <div className="grid grid-cols-2 gap-3">
        {REPORTS.map(r => {
          const [k, Icon, tone] = r
          return (
            <button key={k} data-report={k} onClick={() => setPick(r)} className={`flex aspect-square flex-col items-center justify-center gap-3 rounded-3xl p-3 text-white shadow-md active:scale-[.97] ${tone}`}>
              <Icon size={64} strokeWidth={1.8} />
              <span className="text-center text-xl font-bold leading-tight">{t.types[k]}</span>
            </button>
          )
        })}
      </div>
      {v.reports.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 px-1 text-lg font-bold">{t.myReports}</div>
          <div className="space-y-2">
            {v.reports.map(r => (
              <div key={r.id} className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-base">
                <AlertTriangle size={20} className="shrink-0 text-brand" />
                <span className="flex-1 font-semibold">{t.types[r.type as keyof typeof t.types]}</span>
                <span className="text-sm text-stone-500">{hhmm(r.minute)} · {r.status === 'open' ? t.open : t.resolved}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {pick && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={() => setPick(null)}>
          <div className="w-full max-w-[430px] rounded-t-3xl bg-white p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-4">
              <span className={`flex h-16 w-16 items-center justify-center rounded-2xl text-white ${pick[2]}`}>{(() => { const Icon = pick[1]; return <Icon size={38} /> })()}</span>
              <div className="text-2xl font-bold">{t.types[pick[0]]}{v.seguia && pick[0] !== 'well_dry' ? ` — ${lang === 'ar' ? 'الساقية' : 'Seguia'} ${v.seguia.n}` : ''}</div>
            </div>
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-400 py-3 text-lg font-semibold text-stone-700">
              <Camera size={26} /> {photo ? t.photoOk : t.photo}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
            </label>
            {photo && <img src={photo} alt="" className="mx-auto mt-2 h-24 rounded-xl object-cover" />}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <button onClick={() => setPick(null)} className="rounded-2xl bg-stone-200 py-4 text-xl font-bold">{t.cancel}</button>
              <button data-testid="report-send" disabled={busy} onClick={send} className="col-span-2 rounded-2xl bg-brand py-4 text-2xl font-bold text-white disabled:opacity-50">{t.send}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- More
function MoreScreen({ v, lang, go }: P & { go: (t: Tab) => void }) {
  const t = F[lang]
  const items: [Tab, typeof Home, string, string][] = [
    ['well', Zap, t.myWell, 'bg-teal-600'],
    ['reg', FileCheck2, t.reg, 'bg-indigo-600'],
    ['sms', MessageSquareText, t.sms, 'bg-stone-700'],
  ]
  return (
    <div>
      <H>{t.more}</H>
      <p className="-mt-2 mb-3 px-1 text-base text-stone-600">{t.hintMore}</p>
      <div className="space-y-3">
        {items.filter(i => i[0] !== 'well' || v.myWell).map(([k, Icon, label, tone]) => (
          <button key={k} data-more={k} onClick={() => go(k)} className="flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-start shadow-sm active:scale-[.98]">
            <span className={`flex h-16 w-16 items-center justify-center rounded-2xl text-white ${tone}`}><Icon size={36} /></span>
            <span className="flex-1 text-2xl font-bold">{label}</span>
            {F[lang].dir === 'rtl' ? <ChevronLeft size={28} className="text-stone-400" /> : <ChevronRight size={28} className="text-stone-400" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function Spark({ data, color }: { data: number[]; color: string }) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${28 - ((d - min) / Math.max(1e-6, max - min)) * 24 - 2}`).join(' ')
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>
}

function WellScreen({ v, lang }: P) {
  const t = F[lang]
  const w = v.myWell
  if (!w) return (<div><H>{t.myWell}</H><Card><div className="text-lg text-stone-600">{t.noWell}</div></Card></div>)
  const tone = w.health === 'good' ? 'bg-oasis' : w.health === 'warn' ? 'bg-amber-500' : 'bg-brand'
  const Icon = w.health === 'good' ? Check : AlertTriangle
  const Row = ({ icon: I, label, value, unit, data, color }: { icon: typeof Home; label: string; value: string; unit: string; data: number[]; color: string }) => (
    <Card>
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100"><I size={26} style={{ color }} /></span>
        <div className="flex-1">
          <div className="text-base text-stone-600">{label}</div>
          <div className="text-2xl font-bold"><span dir="ltr">{value}</span> <span className="text-base font-normal text-stone-600">{unit}</span></div>
        </div>
      </div>
      <div className="mt-1"><Spark data={data} color={color} /></div>
      <div className="text-xs text-stone-500">{t.last48}</div>
    </Card>
  )
  return (
    <div>
      <H>{t.myWell}</H>
      <div className="space-y-3" data-testid="well">
        <div className={`flex items-center gap-4 rounded-3xl p-4 text-white ${tone}`} data-health={w.health}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20"><Icon size={38} /></span>
          <div>
            <div className="text-2xl font-bold">{t.health[w.health]}</div>
            {w.dropM != null && <div className="text-base opacity-95">{t.wellDrop(w.dropM)}</div>}
          </div>
        </div>
        {w.advisedHours != null && w.flowLs > 0 && (
          <Card className="!bg-teal-50"><div className="flex items-center gap-3 text-xl font-bold text-teal-900"><Clock size={30} className="shrink-0 text-teal-700" /> {t.wellAdvice(t.hm(w.advisedHours * 60), w.advisedM3 ?? 0)}</div></Card>
        )}
        <Row icon={Droplets} label={t.wellLevel} value={w.levelM.toFixed(1)} unit={lang === 'ar' ? 'متر' : 'm'} data={w.level48.map(x => -x)} color="#0369a1" />
        <Row icon={Zap} label={t.wellFlow} value={w.flowLs.toFixed(1)} unit={lang === 'ar' ? 'لتر/ثانية' : 'l/s'} data={w.flow48} color="#0f766e" />
        <Row icon={Waves} label={t.wellEc} value={w.ecDs.toFixed(1)} unit="dS/m" data={w.ec48} color="#b45309" />
        <div className="flex items-start gap-2 rounded-2xl bg-white px-4 py-3 text-base text-stone-700"><Lock size={20} className="mt-0.5 shrink-0 text-palm" /> {t.privacy}</div>
      </div>
    </div>
  )
}

function RegScreen({ v, lang, refresh }: P & { refresh: () => void }) {
  const t = F[lang]
  const done = useMemo(() => new Set(v.regularization.done), [v.regularization.done])
  const steps = Object.entries(t.regSteps) as [string, string][]
  const toggle = async (step: string) => { await post('/api/regularization', { farmerId: v.farmer.id, step, on: !done.has(step) }).catch(() => {}); refresh() }
  const can = v.regularization.needed
  return (
    <div>
      <H>{t.reg}</H>
      <div className="space-y-3" data-testid="reg">
        <Card className="!bg-indigo-50"><div className="flex gap-3 text-lg leading-relaxed text-indigo-950"><FileCheck2 size={30} className="mt-1 shrink-0 text-indigo-700" /> {t.regLaw}</div></Card>
        <div className="flex gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-lg leading-relaxed text-amber-950" data-testid="reg-pending"><AlertTriangle size={28} className="mt-0.5 shrink-0 text-amber-600" /> {t.regPending}</div>
        {!can && <Card><div className="text-lg text-stone-700">{v.myWell?.recorded ? t.regRecorded : t.regInfo}</div></Card>}
        <Card>
          <div className="mb-2 flex items-center justify-between text-xl font-bold">
            <span>{t.regList}</span>
            {can && <span dir="ltr" className="rounded-full bg-indigo-100 px-3 py-0.5 text-base text-indigo-800">{done.size} / {steps.length}</span>}
          </div>
          <ul className="space-y-2">
            {steps.map(([k, label]) => (
              <li key={k}>
                <button disabled={!can} onClick={() => toggle(k)} data-step={k} aria-pressed={done.has(k)} className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-3 text-start text-lg ${done.has(k) ? 'border-green-600 bg-green-50' : 'border-stone-200'}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done.has(k) ? 'bg-oasis text-white' : 'bg-stone-200 text-transparent'}`}><Check size={22} /></span>
                  <span className="flex-1 font-semibold leading-snug">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="rounded-3xl bg-ink p-4 text-white" data-testid="privacy">
          <div className="mb-1 flex items-center gap-2 text-xl font-bold"><Lock size={24} /> {t.privacyTitle}</div>
          <div className="text-lg leading-relaxed opacity-95">{t.privacy}</div>
        </div>
      </div>
    </div>
  )
}

function SmsScreen({ v, lang }: P) {
  const t = F[lang]
  return (
    <div>
      <H>{t.sms}</H>
      <div className="mb-3 px-1 text-lg text-stone-700">{t.smsTitle}</div>
      <div dir="ltr" className="mx-auto w-[270px] rounded-[30px] border-[10px] border-stone-800 bg-[#c7d3b6] p-3 font-mono shadow-lg">
        <div className="mb-2 flex justify-between text-[11px] text-stone-700"><span>TWIZA</span><span>{v.now.hhmm}</span></div>
        <div className="min-h-[120px] whitespace-pre-wrap break-words text-[15px] leading-snug text-stone-900" data-testid="sms">{v.sms}</div>
        <div className="mt-2 text-end text-[11px] text-stone-700">{v.sms.length} / 160</div>
      </div>
      <div className="mt-3 text-center text-sm text-stone-500">{t.smsNote}</div>
    </div>
  )
}
