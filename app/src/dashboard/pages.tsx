// The other screens of the dashboard. Same grid, tokens and card style as the overview.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Bot, Clock, Scissors, Send, Smartphone, TrendingUp } from 'lucide-react'
import { fmt, hhmm, post, useApi } from '../api'
import { useT, type Key } from '../i18n'
import type { Live, Network, Trends, Turn } from '../types'
import { Async, Card, Drawer, Empty, Info, Num, Row, Segmented } from './ui'

// =====================================================================  Water turns
export function TurnsPage({ net, live }: { net: Network; live: Live }) {
  const { t, lang } = useT()
  const [day, setDay] = useState(0)
  const [seg, setSeg] = useState('all')
  const [open, setOpen] = useState<Turn | null>(null)
  const [allLog, setAllLog] = useState(false)
  const [openLog, setOpenLog] = useState<string | null>(null)
  const plan = live.plans[day] ?? live.plans[0]
  const farmer = useMemo(() => new Map(net.farmers.map(f => [f.id, f])), [net])
  const t0 = 240
  const t1 = Math.min(1440, Math.ceil(Math.max(18 * 60, ...live.plans.flatMap(p => p.turns.map(x => x.end))) / 120) * 120)
  const pos = (m: number) => ((m - t0) / (t1 - t0)) * 100
  const hours = Array.from({ length: (t1 - t0) / 60 + 1 }, (_, i) => t0 + i * 60)
  const now = live.now.minute
  const state = (x: Turn) => (day > 0 || x.start < 0 ? 'pending' : now >= x.end ? 'done' : now >= x.start ? 'active' : 'pending')
  const dayName = (i: number, d: string) => (i === 0 ? t('turns.today') : i === 1 ? t('turns.tomorrow') : new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }))
  const rows = net.seguias.filter(s => seg === 'all' || s.id === seg)
  const log = allLog ? live.log : live.log.slice(0, 3)
  const flagIcon = (x: Turn) => (x.flags.includes('swap') ? <ArrowLeftRight size={12} /> : x.flags.includes('cut') ? <Scissors size={12} /> : x.flags.includes('lengthened') ? <TrendingUp size={12} /> : x.flags.includes('delayed') ? <Clock size={12} /> : null)

  return (
    <>
      <Card title={t('nav.turns')} help={t('turns.help')} right={
        <>
          <label className="flex items-center gap-2 text-14 text-fg2">{t('turns.filterSeguia')}
            <select value={seg} onChange={e => setSeg(e.target.value)} className="h-8 rounded-lg border border-hair bg-card px-2 text-14 text-fg" data-testid="filter-seguia">
              <option value="all">{t('turns.allSeguias')}</option>
              {net.seguias.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <Segmented label={t('turns.date')} value={String(day)} onChange={v => setDay(Number(v))} options={live.plans.map((p, i) => [String(i), dayName(i, p.date)] as [string, string])} />
        </>
      }>
        <p className="mb-3 text-14 text-fg2" data-testid="turns-summary">
          ET0 <Num v={plan.et0 * plan.et0Factor} d={1} unit="mm" />{plan.et0Factor !== 1 && <span className="num ms-1 rounded bg-caution-soft px-1 text-12 text-caution">×{fmt(plan.et0Factor, 2)}</span>} · {t('turns.pumping')} <Num v={plan.pumped} unit="m³" className="font-semibold text-fg" /> / <Num v={plan.cap} unit="m³" /> ({t('turns.cap')})
          {plan.underShare < 0.999 && <span className="ms-2 rounded bg-caution-soft px-1.5 py-0.5 text-12 font-semibold text-caution">{t('crop.palm')} {fmt(plan.palmShare * 100)} % · {fmt(plan.underShare * 100)} %</span>}
        </p>
        <div className="relative" data-testid="gantt">
          <div className="relative ms-[104px] h-5">{hours.filter((_, i) => i % 2 === 0).map(h => <span key={h} className="num absolute -translate-x-1/2 text-12 text-dim" style={{ left: `${pos(h)}%` }}>{hhmm(h)}</span>)}</div>
          {rows.map(s => (
            <div key={s.id} className="flex items-center border-t border-hair py-2">
              <div className="w-[104px] shrink-0"><div className="text-14 font-semibold">{s.name}</div><div className="text-12 text-dim">Jebia {s.jebiaId.slice(1)}</div></div>
              <div className="relative h-9 flex-1 rounded-lg bg-bg">
                {hours.map(h => <span key={h} className="absolute top-0 h-full w-px bg-hair" style={{ left: `${pos(h)}%` }} />)}
                {plan.turns.filter(x => x.seguiaId === s.id && x.start >= 0).map(x => {
                  const st = state(x)
                  const changed = x.flags.some(f => ['swap', 'replan', 'delayed', 'cut', 'lengthened'].includes(f))
                  return (
                    <button key={x.id} data-turn={x.id} onClick={() => setOpen(x)} title={`${farmer.get(x.farmerId)?.first} · ${hhmm(x.start)}–${hhmm(x.end)}`}
                      className={`absolute top-1 flex h-7 items-center gap-1 overflow-hidden rounded-md px-2 text-start text-12 ${st === 'active' ? 'bg-accent font-semibold text-white' : st === 'done' ? 'bg-[#c5e0e5] text-fg2' : 'border border-accent bg-card text-fg'} ${changed ? 'ring-2 ring-caution ring-offset-1' : ''}`}
                      style={{ left: `calc(${pos(x.start)}% + 1px)`, width: `calc(${pos(x.end) - pos(x.start)}% - 2px)` }}>
                      {flagIcon(x)}<span className="truncate">{farmer.get(x.farmerId)?.first}</span>
                    </button>
                  )
                })}
                {plan.blocks.filter(b => b.seguiaId === s.id).map((b, i) => (
                  <span key={i} title={`${t('turns.closed')} ${hhmm(b.from)}–${hhmm(b.to)}`} className="pointer-events-none absolute top-0 h-9 rounded border-x-2 border-danger" style={{ left: `${pos(b.from)}%`, width: `${pos(b.to) - pos(b.from)}%`, background: 'repeating-linear-gradient(135deg, rgba(181,18,27,.4) 0 4px, rgba(181,18,27,.08) 4px 9px)' }} />
                ))}
              </div>
            </div>
          ))}
          {day === 0 && now >= t0 && now <= t1 && (
            <div className="pointer-events-none absolute inset-y-0 ms-[104px]" style={{ left: 0, right: 0 }}>
              <div className="absolute inset-y-5 w-0.5 bg-fg" style={{ left: `${pos(now)}%` }}><span className="num absolute -top-5 -translate-x-1/2 rounded bg-fg px-1 text-12 font-semibold text-white">{hhmm(now)}</span></div>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-12 text-fg2">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-[#c5e0e5]" />{t('turns.done')}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-accent" />{t('turns.active')}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm border border-accent" />{t('turns.pending')}</span>
          <span className="flex items-center gap-1.5"><ArrowLeftRight size={12} />{t('turns.swap')}</span>
          <span className="flex items-center gap-1.5"><Clock size={12} />{t('turns.delayed')}</span>
          <span className="flex items-center gap-1.5"><TrendingUp size={12} />{t('turns.longer')}</span>
          <span className="flex items-center gap-1.5"><Scissors size={12} />{t('turns.cut')}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm border-x-2 border-danger bg-danger-soft" />{t('turns.closed')}</span>
        </div>
      </Card>

      <Card title={t('log.title')} help={t('log.help')}>
        {!live.log.length && <Empty>{t('log.none')}</Empty>}
        <ul className="space-y-2" data-testid="log">
          {log.map(l => (
            <li key={l.id} className="rounded-lg border border-hair">
              <button className="flex w-full items-start gap-3 p-3 text-start" aria-expanded={openLog === l.id} onClick={() => setOpenLog(openLog === l.id ? null : l.id)}>
                <span className="num rounded bg-bg px-1.5 py-0.5 text-12 text-fg2">{hhmm(l.minute)}</span>
                <span className="min-w-0 flex-1"><span className="block text-14 font-semibold">{l.cause[lang]}</span><span className="block text-14 text-fg2">{l.summary[lang]}</span></span>
              </button>
              {openLog === l.id && l.changes.length > 0 && (
                <table className="num w-full border-t border-hair text-12">
                  <thead><tr className="text-dim"><th className="px-3 py-1.5 text-start font-normal">{t('pop.turn')}</th><th className="text-start font-normal">{t('log.before')}</th><th className="text-start font-normal">{t('log.after')}</th></tr></thead>
                  <tbody>{l.changes.slice(0, 12).map(c => (
                    <tr key={c.turnId} className="border-t border-hair"><td className="px-3 py-1">{farmer.get(c.farmerId)?.first} <span className="text-dim">{c.date.slice(8)}/{c.date.slice(5, 7)}</span></td>
                      <td className="text-fg2">{c.before ? `${hhmm(c.before.start)}–${hhmm(c.before.end)} · ${fmt(c.before.target)} m³` : '—'}</td>
                      <td>{c.after && c.after.start >= 0 ? `${hhmm(c.after.start)}–${hhmm(c.after.end)} · ${fmt(c.after.target)} m³` : '—'}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
        {live.log.length > 3 && <button className="mt-2 text-14 text-accent underline" onClick={() => setAllLog(v => !v)}>{allLog ? t('less') : `${t('all')} (${live.log.length})`}</button>}
      </Card>

      {open && (
        <Drawer title={t('turn.detail')} onClose={() => setOpen(null)}>
          <Row k={t('pop.owner')}>{farmer.get(open.farmerId)?.first} {farmer.get(open.farmerId)?.last}</Row>
          <Row k={t('pop.seguia')}>{net.seguias.find(s => s.id === open.seguiaId)?.name}</Row>
          <Row k={t('pop.turn')}><span className="num">{hhmm(open.start)}–{hhmm(open.end)}</span></Row>
          <Row k={t('pop.volume')}><Num v={open.target} unit="m³" /></Row>
          <Row k={t('pop.need')}><Num v={(open.delivered / Math.max(1, open.needPalm + open.needUnder)) * 100} unit="%" /></Row>
          <Row k={t('pop.loss')}><Num v={open.lossShare * 100} unit="%" /></Row>
          <p className="mt-3 border-t border-hair pt-3 text-14 text-fg2"><span className="font-semibold text-fg">{t('pop.why')} : </span>{open.reason[lang]}</p>
        </Drawer>
      )}
    </>
  )
}

// =====================================================================  Sensors and fairness
function Spark({ data, color = 'var(--accent)', h = 36 }: { data: number[]; color?: string; h?: number }) {
  const min = Math.min(...data), max = Math.max(...data)
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${((d - min) / Math.max(1e-6, max - min)) * (h - 6) + 3}`).join(' ') // deeper water level = lower on the chart
  return <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>
}
function LineChart({ title, dates, data, unit, invert }: { title: string; dates: string[]; data: number[]; unit: string; invert?: boolean }) {
  const { t } = useT()
  const [i, setI] = useState<number | null>(null)
  const W = 520, H = 150, L = 44, R = 12, T = 10, B = 22
  const min = Math.floor(Math.min(...data) * 2) / 2, max = Math.ceil(Math.max(...data) * 2) / 2
  const x = (k: number) => L + (k / (data.length - 1)) * (W - L - R)
  const y = (v: number) => { const f = (v - min) / Math.max(1e-6, max - min); return T + (invert ? f : 1 - f) * (H - T - B) }
  const ticks = [min, (min + max) / 2, max]
  return (
    <figure className="mt-3">
      <figcaption className="text-12 text-dim">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const k = Math.round((((e.clientX - r.left) / r.width) * W - L) / ((W - L - R) / (data.length - 1))); setI(Math.max(0, Math.min(data.length - 1, k))) }} onMouseLeave={() => setI(null)}>
        {ticks.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--dim)" className="num">{fmt(v, 1)}</text></g>)}
        {[0, Math.floor(data.length / 2), data.length - 1].map(k => <text key={k} x={x(k)} y={H - 6} textAnchor={k === 0 ? 'start' : k === data.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--dim)">{dates[k].slice(8)}/{dates[k].slice(5, 7)}</text>)}
        <polyline points={data.map((v, k) => `${x(k)},${y(v)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {i != null && <g><line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="var(--dim)" /><circle cx={x(i)} cy={y(data[i])} r="4" fill="var(--accent)" stroke="#fff" strokeWidth="2" /></g>}
      </svg>
      <p className="num h-5 text-12 text-fg2" aria-live="polite">{i != null ? `${t('sens.day')} ${dates[i].slice(8)}/${dates[i].slice(5, 7)} · ${fmt(data[i], 2)} ${unit}` : ''}</p>
    </figure>
  )
}
export function SensorsPage({ trS, live }: { trS: ReturnType<typeof useApi<Trends>>; live: Live }) {
  const { t } = useT()
  const [selId, setSelId] = useState<string>('f2')
  const [all, setAll] = useState(false)
  const rows = all ? live.weekly : live.weekly.slice(0, 12)
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-4">
        <Card title={t('sens.wells')} help={t('sens.help')}>
          <Async state={trS} skeleton="h-64">
            {tr => (
              <div className="grid grid-cols-4 gap-3" data-testid="wells-grid">
                {tr.wells.map(w => (
                  <button key={w.id} data-well={w.id} aria-pressed={selId === w.id} onClick={() => setSelId(w.id)} className={`rounded-lg border p-3 text-start ${selId === w.id ? 'border-accent bg-accent-soft' : 'border-hair hover:border-[#cfcbc3]'}`}>
                    <div className="truncate text-14 font-semibold">{w.name}</div>
                    <Spark data={w.level} />
                    <div className="flex items-center justify-between gap-1 text-12">
                      <Num v={w.level[w.level.length - 1]} d={1} unit="m" className="text-fg2" />
                      {w.drop ? <span className="flex items-center gap-1 font-semibold text-caution"><AlertTriangle size={12} />{t('sens.drop')}</span> : w.rising ? <span className="flex items-center gap-1 font-semibold text-caution"><AlertTriangle size={12} />{t('sens.rising')}</span> : <span className="text-dim">{t('sens.stable')}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Async>
        </Card>
        <Card title={trS.data?.wells.find(w => w.id === selId)?.name ?? t('sens.select')}>
          <Async state={trS} skeleton="h-64">
            {tr => {
              const w = tr.wells.find(x => x.id === selId)
              if (!w) return <Empty>{t('sens.select')}</Empty>
              return <div data-testid="well-detail"><LineChart title={t('sens.level')} dates={tr.dates} data={w.level} unit="m" invert /><LineChart title={t('sens.ec')} dates={tr.dates} data={w.ec} unit="dS/m" /></div>
            }}
          </Async>
        </Card>
      </div>
      <Card title={t('fair.title')} help={t('fair.help')} right={<span className="flex items-center gap-1.5 text-12 text-fg2"><AlertTriangle size={12} className="text-caution" />{t('fair.below')}</span>}>
        <ul data-testid="fairness">
          {rows.map(r => {
            const low = r.pct < 97
            return (
              <li key={r.farmerId} className="flex items-center gap-3 py-1 text-14">
                <span className="w-44 shrink-0 truncate text-fg2">{r.name}</span>
                <span className="relative h-2 flex-1 rounded bg-bg"><span className={`absolute inset-y-0 start-0 rounded ${low ? 'bg-caution' : 'bg-accent'}`} style={{ width: `${Math.min(100, r.pct)}%` }} /></span>
                <span className="num flex w-40 shrink-0 items-center justify-end gap-1.5">{low && <AlertTriangle size={12} className="text-caution" />}<span className="font-semibold">{fmt(r.pct)} %</span>{low && <span className="text-12 text-dim">−{fmt(r.need - r.got)} m³</span>}</span>
              </li>
            )
          })}
        </ul>
        {live.weekly.length > 12 && <button className="mt-2 text-14 text-accent underline" onClick={() => setAll(v => !v)} data-testid="all-farms">{all ? t('less') : `${t('all')} (${live.weekly.length})`}</button>}
      </Card>
    </>
  )
}

// =====================================================================  Assistant
interface Msg { role: 'user' | 'assistant'; content: string }
export function AssistantPage({ live, ask, clearAsk }: { live: Live; ask: string | null; clearAsk: () => void }) {
  const { t } = useT()
  const status = useApi<{ mode: 'claude' | 'templates'; model: string | null }>('/api/assistant/status')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [msgs, busy])
  const send = async (q: string) => {
    if (!q.trim() || busy) return
    const history = msgs
    setMsgs(m => [...m, { role: 'user', content: q }]); setText(''); setBusy(true)
    try {
      const r = await post<{ text: string }>('/api/assistant', { message: q, history })
      setMsgs(m => [...m, { role: 'assistant', content: r.text }])
    } catch { setMsgs(m => [...m, { role: 'assistant', content: t('as.error') }]) }
    setBusy(false)
  }
  useEffect(() => { if (ask) { send(ask); clearAsk() } }, [ask]) // eslint-disable-line react-hooks/exhaustive-deps
  const claude = status.data?.mode === 'claude'
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col gap-3">
      <div className="flex items-center gap-2 text-14 text-fg2">
        <Bot size={20} className="text-accent" />
        <span className={`rounded-full px-2 py-0.5 text-12 font-semibold ${claude ? 'bg-ok-soft text-ok' : 'bg-bg text-fg2'}`} data-testid="assistant-mode">{claude ? `${t('as.claude')} · ${status.data?.model}` : t('as.templates')}</span>
        <Info text={claude ? t('as.readonly') : `${t('as.setup')} ${t('as.readonly')}`} />
      </div>
      <div className="tw-card scroll min-h-[320px] flex-1 space-y-3 overflow-y-auto p-4" data-testid="chat" aria-live="polite">
        {!msgs.length && (
          <div className="flex flex-wrap gap-2">{(['as.q1', 'as.q2', 'as.q3', 'as.q4'] as Key[]).map(k => <button key={k} className="tw-btn" onClick={() => send(t(k))}>{t(k)}</button>)}</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div dir="auto" data-role={m.role} className={`max-w-[88%] whitespace-pre-wrap rounded-card px-3 py-2 text-14 ${m.role === 'user' ? 'bg-accent text-white' : 'border border-hair bg-bg text-fg'}`}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="tw-skel h-10 w-40" />}
        {live.proposals.length > 0 && (
          <div className="rounded-lg border border-hair bg-caution-soft p-3 text-14"><div className="font-semibold">{t('as.proposals')}</div>{live.proposals.map(p => <div key={p.id}>• {p.text}</div>)}</div>
        )}
        <div ref={end} />
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send(text) }}>
        <input dir="auto" value={text} onChange={e => setText(e.target.value)} placeholder={t('as.placeholder')} aria-label={t('as.placeholder')} data-testid="ask" maxLength={1000} className="h-10 min-w-0 flex-1 rounded-lg border border-hair bg-card px-3 text-14 text-fg placeholder:text-dim" />
        <button type="submit" disabled={busy || !text.trim()} className="tw-btn primary !h-10" aria-label={t('as.send')} data-testid="ask-send"><Send size={16} /></button>
      </form>
    </div>
  )
}

// =====================================================================  About / 404 / small screens
export function AboutPage() {
  const { t } = useT()
  const S = ({ id, title, text }: { id?: string; title: Key; text: Key }) => <Card title={t(title)}><p id={id} className="text-14 leading-6 text-fg2">{t(text)}</p></Card>
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4" data-testid="about">
      <Card><h2 className="text-20 font-semibold">{t('about.title')}</h2><p className="mt-2 text-14 leading-6 text-fg2">{t('about.intro')}</p></Card>
      <S id="donnees" title="about.dataTitle" text="about.data" />
      <S id="confidentialite" title="about.privacyTitle" text="about.privacy" />
      <S title="about.sessionTitle" text="about.session" />
      <p className="px-1 text-12 text-dim">{t('about.sources')}</p>
    </div>
  )
}
export function NotFound({ go }: { go: (p: string) => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" data-testid="not-found">
      <p className="num text-28 font-semibold text-dim">404</p>
      <h2 className="text-20 font-semibold">{t('nf.title')}</h2>
      <p className="text-14 text-fg2">{t('nf.text')}</p>
      <button className="tw-btn primary" onClick={() => go('/')}>{t('nf.home')}</button>
    </div>
  )
}
export function SmallScreen() {
  const { t } = useT()
  return (
    <main className="dash flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center" data-testid="small-screen">
      <img src="/logo-96.png" alt="" width={72} height={72} />
      <h1 className="text-20 font-semibold">{t('small.title')}</h1>
      <p className="max-w-sm text-14 text-fg2">{t('small.text')}</p>
      <a href="/farmer" className="tw-btn primary !h-11 !px-4 !text-16"><Smartphone size={20} /> {t('small.cta')}</a>
    </main>
  )
}
