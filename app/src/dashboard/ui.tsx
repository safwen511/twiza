// Shared building blocks of the dashboard: one card, one header, one way to show numbers and states.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info as InfoIcon, RefreshCw, X } from 'lucide-react'
import { fmt } from '../api'
import { useT } from '../i18n'

export function Card({ title, help, right, children, className = '', pad = true }: { title?: string; help?: string; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`tw-card flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="tw-card-h px-4 pt-4">
          <h2 className="text-14 font-semibold">{title}</h2>
          {help && <Info text={help} />}
          {right && <div className="ms-auto flex items-center gap-2 font-normal">{right}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${pad ? 'p-4' : ''} ${title && pad ? 'pt-3' : ''}`}>{children}</div>
    </section>
  )
}

/** "i" indicator: what a component means, in a sentence or two */
export function Info({ text, align = 'start' }: { text: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={text} aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex h-5 w-5 items-center justify-center rounded-full text-dim hover:text-fg"><InfoIcon size={16} /></button>
      {open && <span role="tooltip" className={`absolute top-6 z-50 w-72 rounded-card border border-hair bg-card p-3 text-14 font-normal text-fg2 shadow-lg ${align === 'end' ? 'end-0' : 'start-0'}`}>{text}</span>}
    </span>
  )
}

/** a figure with a smaller, muted unit: 18 666 m³/j */
export function Num({ v, d = 0, unit, className = '' }: { v: number; d?: number; unit?: string; className?: string }) {
  return <span className={`num whitespace-nowrap ${className}`}>{fmt(v, d)}{unit && <span className="ms-1 text-[0.72em] font-normal text-dim">{unit}</span>}</span>
}

export const Skeleton = ({ className = 'h-24' }: { className?: string }) => <div className={`tw-skel ${className}`} aria-hidden />

export function ErrorState({ retry }: { retry: () => void }) {
  const { t } = useT()
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 p-6 text-center text-14 text-fg2">
      {t('state.error')}
      <button className="tw-btn" onClick={retry}><RefreshCw size={16} /> {t('state.retry')}</button>
    </div>
  )
}
export const Empty = ({ children }: { children?: ReactNode }) => {
  const { t } = useT()
  return <div className="p-4 text-center text-14 text-dim">{children ?? t('state.empty')}</div>
}
/** loading / error / data in one place */
export function Async<T>({ state, skeleton = 'h-32', children }: { state: { data: T | null; error: boolean; refresh: () => void }; skeleton?: string; children: (d: T) => ReactNode }) {
  if (state.data) return <>{children(state.data)}</>
  if (state.error) return <ErrorState retry={state.refresh} />
  return <Skeleton className={skeleton} />
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="tw-seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: [T, string, number?][] }) {
  return (
    <div role="tablist" className="flex border-b border-hair px-2">
      {tabs.map(([v, l, n]) => (
        <button key={v} role="tab" type="button" aria-selected={value === v} data-tab={v} onClick={() => onChange(v)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-14 ${value === v ? 'border-accent font-semibold text-fg' : 'border-transparent text-fg2 hover:text-fg'}`}>
          {l}{!!n && <span className="num rounded-full bg-danger-soft px-1.5 text-12 font-semibold text-danger">{n}</span>}
        </button>
      ))}
    </div>
  )
}

/** right-hand drawer for details (never covers the map permanently: it closes on Escape or outside click) */
export function Drawer({ title, onClose, children, width = 380 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const { t } = useT()
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside role="dialog" aria-label={title} className="flex h-full flex-col border-s border-hair bg-card shadow-xl" style={{ width }} data-testid="drawer">
        <header className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <h2 className="flex-1 text-16 font-semibold">{title}</h2>
          <button className="tw-btn tw-icon" onClick={onClose} aria-label={t('close')}><X size={16} /></button>
        </header>
        <div className="scroll min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  )
}

export const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1 text-14"><span className="text-dim">{k}</span><span className="text-end text-fg">{children}</span></div>
)
export const StatusDot = ({ tone }: { tone: 'ok' | 'caution' | 'danger' | 'accent' | 'dim' }) => (
  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${{ ok: 'bg-ok', caution: 'bg-caution', danger: 'bg-danger', accent: 'bg-accent', dim: 'bg-dim' }[tone]}`} />
)
