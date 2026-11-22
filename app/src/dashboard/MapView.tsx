// The map is the hero of the overview. One view at a time decides what is drawn:
//   Réseau (network) · Nappe (aquifer stress) · Satellite (Sentinel-2, irrigated areas, hexagons) · Tours (turn order)
// No permanent labels: a name appears on hover, a small card on click, the full detail in a drawer.
import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Box, Layers, Maximize2, Minimize2, Pause, Play, Radio, ShieldAlert } from 'lucide-react'
import { fmt, hhmm } from '../api'
import { useT, type Key } from '../i18n'
import type { Live, Network, Scenario, Zone } from '../types'
import { Segmented } from './ui'

export type View = 'network' | 'aquifer' | 'satellite' | 'turns'
export interface Selection { title: string; rows: [string, string][]; note?: string }

const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
const C = { accent: '#1c7a89', accentMid: '#6fb1bc', accentSoft: '#c5e0e5', ok: '#2c7556', okSoft: '#9fcdb6', caution: '#b87503', danger: '#b5121b', neutral: '#a7a39c', ink: '#171717' }
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const STOPS: [number, number, number, number, number][] = [[0.3, 250, 178, 25, 0], [0.45, 250, 178, 25, 0.45], [0.6, 236, 131, 90, 0.65], [0.78, 208, 59, 59, 0.8], [1, 181, 18, 27, 0.9]]
function ramp(v: number): [number, number, number, number] {
  if (v <= STOPS[0][0]) return [250, 178, 25, 0]
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
    const [v0, r0, g0, b0, a0] = STOPS[i - 1], [v1, r1, g1, b1, a1] = STOPS[i], f = (v - v0) / (v1 - v0)
    return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f, a0 + (a1 - a0) * f]
  }
  return [181, 18, 27, 0.9]
}
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features }) as never

interface Props {
  net: Network; live: Live; scenario: Scenario | null; share: number
  view: View; setView: (v: View) => void
  preview: number | null; setPreview: (m: number | null) => void
  zone: Zone | null; onUnrecordedLayer: (on: boolean) => void
  onSelect: (s: Selection) => void
}

export default function MapView({ net, live, scenario, share, view, setView, preview, setPreview, zone, onUnrecordedLayer, onSelect }: Props) {
  const { t, lang } = useT()
  const box = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const badges = useRef<maplibregl.Marker[]>([])
  const clusters = useRef(new Map<number, maplibregl.Marker>())
  const [ready, setReady] = useState(false)
  const [layers, setLayers] = useState({ plots: true, wells: true, patches: true, hex: true, ndvi: false })
  const [stress, setStress] = useState<'combined' | 'dd' | 'sal'>('combined')
  const [menu, setMenu] = useState(false)
  const [three, setThree] = useState(false)
  const [full, setFull] = useState(false)
  const [playing, setPlaying] = useState(false)
  const farmer = useMemo(() => new Map(net.farmers.map(f => [f.id, f])), [net])
  const minute = preview ?? live.now.minute
  const today = live.plans[0]
  const dayEnd = Math.max(16 * 60, ...today.turns.map(x => x.end))
  // latest values for the map's event handlers
  const cur = useRef({ live, scenario, share, minute, t, lang, onSelect, view })
  cur.current = { live, scenario, share, minute, t, lang, onSelect, view }

  // ---------- state of every seguia and turn at the minute shown ----------
  const turnState = (x: { start: number; end: number }, m: number) => (x.start < 0 ? 'pending' : m >= x.end ? 'done' : m >= x.start ? 'active' : 'pending')
  const seguiaAt = (sid: string, m: number, lv: Live) => {
    const plan = lv.plans[0]
    const liveS = lv.seguias.find(s => s.id === sid)
    const b = plan.blocks.find(b => b.seguiaId === sid && m >= b.from && m < b.to)
    const a = plan.turns.find(x => x.seguiaId === sid && x.start >= 0 && m >= x.start && m < x.end)
    return { blockedUntil: b ? b.to : null, extraLoss: liveS?.extraLoss ?? 0, active: a ?? null, flowing: !!a && !b }
  }

  // ---------- what a feature says about itself (hover title, click card, drawer) ----------
  const describe = (layer: string, p: Record<string, unknown>): Selection | null => {
    const { live: lv, scenario: sc, share: sh, minute: m, t: tr } = cur.current
    const u = `m³/${tr('unit.day')}`
    if (layer === 'plots-fill') {
      const plot = net.plots.find(x => x.id === p.id)
      if (!plot) return null
      const f = farmer.get(plot.farmerId)
      const turn = lv.plans[0].turns.find(x => x.plotId === plot.id)
      const rows: [string, string][] = [[tr('pop.owner'), f ? `${f.first} ${f.last}` : '—'], [tr('pop.today'), turn && turn.start >= 0 ? `${hhmm(turn.start)}–${hhmm(turn.end)} · ${fmt(turn.target)} m³` : tr('pop.noTurn')], [tr('pop.status'), String(p.label ?? '')]]
      rows.push([tr('pop.area'), `${fmt(plot.areaHa, 2)} ha`], [tr('pop.crop'), tr(`crop.${plot.under ?? 'palm'}` as Key)])
      if (turn) rows.push([tr('pop.need'), `${fmt((turn.delivered / Math.max(1, turn.needPalm + turn.needUnder)) * 100)} %`])
      return { title: `${tr('pop.plot')} ${plot.id.toUpperCase()}`, rows, note: turn ? turn.reason[cur.current.lang] : undefined }
    }
    if (layer === 'wells') {
      const w = net.wells.find(x => x.id === p.id)
      const s = lv.wells.find(x => x.id === p.id)
      const r = sc?.recorded.find(x => x.id === p.id)
      if (!w) return null
      const rows: [string, string][] = [[tr('pop.today'), r ? `${fmt(r.q[Math.round(sh / 5)])} ${u}` : '—'], [tr('pop.status'), s?.status === 'dry' ? tr('pop.dry') : tr('pop.ok')]]
      if (r) rows.push([tr('pop.joined'), sh >= r.joinShare ? '✓' : '—'])
      if (s) rows.push([tr('pop.flow'), `${fmt(s.flowLs, 1)} l/s`], [tr('pop.ec'), `${fmt(s.ecDs, 1)} dS/m`], [tr('pop.level'), `−${fmt(s.levelM, 1)} m`])
      return { title: `${w.name} · ${w.type === 'gda' ? tr('lg.gda') : tr('lg.priv')}`, rows }
    }
    if (layer === 'jebias') {
      const j = net.jebias.find(x => x.id === p.id)
      if (!j) return null
      const lvNow = lv.plans[0].jebiaLevels[j.id]?.[Math.min(288, Math.floor(m / 5))] ?? 0
      return { title: j.name, rows: [[tr('pop.stock'), `${fmt(lvNow)} / ${fmt(j.capacityM3)} m³`], [tr('pop.status'), `${fmt((lvNow / j.capacityM3) * 100)} %`]] }
    }
    if (layer === 'seguias') return { title: String(p.name), rows: [[tr('pop.status'), String(p.label)], [tr('pop.loss'), String(p.loss)]] }
    if (layer === 'hex-fill') {
      const masked = p.suppressed === true || p.suppressed === 'true'
      return { title: tr('pop.hex'), rows: [[tr('pop.irrigated'), `${fmt(Number(p.irrigated_ha), 1)} ha`], [tr('pop.estimate'), `${fmt(Number(p.est_m3_day))} ${u}`], [tr('pop.unrecorded'), masked ? '—' : `${fmt(Number(p.unrecorded_m3_day))} ${u}`]], note: masked ? tr('pop.maskedNote') : undefined }
    }
    if (layer === 'blurred') return { title: tr('pop.blurred'), rows: [], note: tr('pop.blurredNote') }
    return null
  }

  // ---------- create the map once ----------
  useEffect(() => {
    if (!box.current) return
    const c = net.site.center
    const m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' },
          eox: { type: 'raster', tiles: [EOX], tileSize: 256, maxzoom: 14, attribution: '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)' },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#f1efea' } },
          { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.85, 'raster-contrast': -0.15, 'raster-brightness-min': 0.12 } },
          { id: 'eox', type: 'raster', source: 'eox', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.25 } },
        ],
      },
      center: [c.lon, c.lat], zoom: 14.3, attributionControl: { compact: false },
    })
    map.current = m
    ;(window as unknown as { __twizaMap?: maplibregl.Map }).__twizaMap = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'tw-hover' })
    const cardPop = new maplibregl.Popup({ closeButton: false, offset: 12, maxWidth: '280px' })

    m.on('load', () => {
      if (net.sat) {
        const [w, s, e, n] = net.sat.bbox
        m.addSource('ndvi', { type: 'image', url: '/data/ndvi.png', coordinates: [[w, n], [e, n], [e, s], [w, s]] })
        m.addLayer({ id: 'ndvi', type: 'raster', source: 'ndvi', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7 } })
        m.addSource('patches', { type: 'geojson', data: '/data/sat_patches.geojson' })
        m.addLayer({ id: 'patches-line', type: 'line', source: 'patches', layout: { visibility: 'none' }, paint: { 'line-color': '#7fe0b5', 'line-width': 1, 'line-opacity': 0.8 } })
        m.addSource('hex', { type: 'geojson', data: '/data/sat_hex.geojson' })
        m.addLayer({ id: 'hex-fill', type: 'fill', source: 'hex', layout: { visibility: 'none' }, paint: { 'fill-color': ['case', ['boolean', ['get', 'suppressed'], false], '#a7a39c', '#f2b23a'], 'fill-opacity': ['case', ['boolean', ['get', 'suppressed'], false], 0.15, ['interpolate', ['linear'], ['coalesce', ['get', 'unrecorded_m3_day'], 0], 0, 0.04, 1500, 0.18, 4000, 0.36, 7000, 0.55]] } })
        m.addLayer({ id: 'hex-line', type: 'line', source: 'hex', layout: { visibility: 'none' }, paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.55, 'line-dasharray': [3, 2] } })
      }
      const kLon = 1750 / (111320 * Math.cos((c.lat * Math.PI) / 180)), kLat = 1750 / 111320
      m.addSource('stress', { type: 'image', url: BLANK, coordinates: [[c.lon - kLon, c.lat + kLat], [c.lon + kLon, c.lat + kLat], [c.lon + kLon, c.lat - kLat], [c.lon - kLon, c.lat - kLat]] })
      m.addLayer({ id: 'stress', type: 'raster', source: 'stress', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 } })
      m.addSource('plots', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'plots-fill', type: 'fill', source: 'plots', minzoom: 12.5, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } })
      m.addLayer({ id: 'plots-line', type: 'line', source: 'plots', minzoom: 12.5, paint: { 'line-color': ['get', 'line'], 'line-width': ['case', ['==', ['get', 'status'], 'now'], 2.5, 1] } })
      m.addSource('pipes', { type: 'geojson', data: fc(net.wells.filter(w => w.type === 'gda').flatMap(w => net.jebias.map(j => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w.lon, w.lat], [w.lon, j.lat + 0.0005], [j.lon, j.lat + 0.0005], [j.lon, j.lat]] } })))) })
      m.addLayer({ id: 'pipes', type: 'line', source: 'pipes', minzoom: 12.5, paint: { 'line-color': C.accent, 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [2, 2] } })
      m.addSource('seguias', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'seguias', type: 'line', source: 'seguias', minzoom: 12.5, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'kind'], 'main'], 4, 2.5] } })
      m.addLayer({ id: 'seguias-flow', type: 'line', source: 'seguias', minzoom: 12.5, filter: ['==', ['get', 'wet'], true], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [0, 4, 3] } })
      m.addSource('wells', { type: 'geojson', data: fc([]), cluster: true, clusterMaxZoom: 13, clusterRadius: 50 })
      m.addLayer({ id: 'wells-cluster', type: 'circle', source: 'wells', filter: ['has', 'point_count'], paint: { 'circle-radius': 15, 'circle-color': C.accent, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'wells', type: 'circle', source: 'wells', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': ['case', ['==', ['get', 'type'], 'gda'], 8, 5.5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      m.addSource('jebias', { type: 'geojson', data: fc(net.jebias.map(j => ({ type: 'Feature', properties: { id: j.id }, geometry: { type: 'Point', coordinates: [j.lon, j.lat] } }))) })
      m.addLayer({ id: 'jebias', type: 'circle', source: 'jebias', paint: { 'circle-radius': 9, 'circle-color': '#fff', 'circle-stroke-color': C.accent, 'circle-stroke-width': 3 } })
      m.addSource('blurred', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'blurred-halo', type: 'circle', source: 'blurred', paint: { 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 12, 9, 16, 150], 'circle-color': '#ffffff', 'circle-opacity': 0.18, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.7 } })
      m.addLayer({ id: 'blurred', type: 'circle', source: 'blurred', paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': C.ink, 'circle-stroke-width': 2 } })

      const interactive = ['wells', 'jebias', 'blurred', 'seguias', 'plots-fill', 'hex-fill']
      const pick = (e: maplibregl.MapMouseEvent) => m.queryRenderedFeatures(e.point, { layers: interactive.filter(id => m.getLayer(id)) })[0]
      m.on('mousemove', e => {
        const f = pick(e)
        const cl = m.queryRenderedFeatures(e.point, { layers: ['wells-cluster'] })[0]
        m.getCanvas().style.cursor = f || cl ? 'pointer' : ''
        if (cl) return void hover.setLngLat(e.lngLat).setHTML(`<b>${esc(cl.properties.point_count)} ${esc(cur.current.t('pop.cluster'))}</b>`).addTo(m)
        const d = f && describe(f.layer.id, f.properties)
        if (d) hover.setLngLat(e.lngLat).setHTML(`<b>${esc(d.title)}</b>`).addTo(m)
        else hover.remove()
      })
      m.on('mouseout', () => hover.remove())
      m.on('click', e => {
        const cl = m.queryRenderedFeatures(e.point, { layers: ['wells-cluster'] })[0]
        if (cl) return void m.easeTo({ center: e.lngLat, zoom: 14.2 })
        const f = pick(e)
        const d = f && describe(f.layer.id, f.properties)
        if (!d) return
        hover.remove()
        const el = document.createElement('div')
        el.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${esc(d.title)}</div>${d.rows.slice(0, 3).map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#66625d">${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join('')}${d.rows.length ? '' : `<div style="color:#45423e">${esc(d.note ?? '')}</div>`}`
        const btn = document.createElement('button')
        btn.className = 'tw-btn'
        btn.style.cssText = 'margin-top:8px;width:100%'
        btn.dataset.testid = 'pop-details'
        btn.textContent = cur.current.t('pop.details')
        btn.onclick = () => { cardPop.remove(); cur.current.onSelect(d) }
        el.append(btn)
        cardPop.setLngLat(e.lngLat).setDOMContent(el).addTo(m)
      })
      // cluster counts as small HTML labels (no glyph server needed)
      const syncClusters = () => {
        const seen = new Set<number>()
        if (m.getLayer('wells-cluster') && m.getLayoutProperty('wells-cluster', 'visibility') !== 'none')
          for (const f of m.querySourceFeatures('wells', { filter: ['has', 'point_count'] })) {
            const id = f.properties.cluster_id as number
            seen.add(id)
            if (clusters.current.has(id)) continue
            const el = document.createElement('div')
            el.className = 'pointer-events-none text-12 font-semibold text-white'
            el.textContent = String(f.properties.point_count)
            clusters.current.set(id, new maplibregl.Marker({ element: el }).setLngLat((f.geometry as unknown as { coordinates: [number, number] }).coordinates).addTo(m))
          }
        for (const [id, mk] of clusters.current) if (!seen.has(id)) { mk.remove(); clusters.current.delete(id) }
      }
      m.on('moveend', syncClusters)
      m.on('sourcedata', e => { if (e.sourceId === 'wells' && e.isSourceLoaded) syncClusters() })
      m.on('zoom', () => { const show = m.getZoom() >= 13.6; for (const b of badges.current) b.getElement().style.display = show ? '' : 'none' })
      setReady(true)
    })
    const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]]
    let dash = 0
    const anim = setInterval(() => { dash = (dash + 1) % DASH.length; if (m.getLayer('seguias-flow')) m.setPaintProperty('seguias-flow', 'line-dasharray', DASH[dash]) }, 110)
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current)
    return () => { setReady(false); clearInterval(anim); ro.disconnect(); m.remove(); map.current = null; clusters.current.clear(); badges.current = [] }
  }, [net]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the view decides what is visible ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const vis = (id: string, v: boolean) => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none') }
    const net2 = view === 'network' || view === 'turns'
    vis('eox', view === 'satellite'); vis('osm', view !== 'satellite')
    vis('stress', view === 'aquifer')
    vis('patches-line', view === 'satellite' && layers.patches); vis('hex-fill', view === 'satellite' && layers.hex); vis('hex-line', view === 'satellite' && layers.hex); vis('ndvi', view === 'satellite' && layers.ndvi)
    vis('plots-fill', layers.plots && view !== 'satellite'); vis('plots-line', layers.plots)
    for (const id of ['seguias', 'seguias-flow', 'pipes']) vis(id, net2)
    vis('jebias', view !== 'satellite')
    vis('wells', layers.wells && view !== 'satellite'); vis('wells-cluster', layers.wells && view !== 'satellite')
    vis('blurred', view === 'satellite' && !!zone); vis('blurred-halo', view === 'satellite' && !!zone)
    if (m.getLayer('columns')) vis('columns', three && view !== 'satellite')
  }, [ready, view, layers, zone, three])

  // ---------- blurred unrecorded wells: admin mode only, and only what the server chose to send ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    ;(m.getSource('blurred') as maplibregl.GeoJSONSource).setData(fc((zone?.points ?? []).map(p => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))))
  }, [ready, zone])

  // ---------- live data ----------
  const tick = Math.floor(minute / 5)
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const turnOf = new Map(today.turns.map(x => [x.plotId, x]))
    const nextOf = new Map(net.seguias.map(s => [s.id, today.turns.filter(x => x.seguiaId === s.id && x.start > minute).sort((a, b) => a.start - b.start)[0]?.id]))
    const plots = net.plots.map(p => {
      const turn = turnOf.get(p.id)
      const sg = p.seguiaId ? seguiaAt(p.seguiaId, minute, live) : null
      let status: 'now' | 'served' | 'later' | 'short' | 'problem' | 'none' | 'next' = 'none'
      if (turn) {
        const st = turnState(turn, minute)
        status = st === 'active' ? 'now' : st === 'done' ? 'served' : view === 'turns' && nextOf.get(turn.seguiaId) === turn.id ? 'next' : 'later'
        if (view !== 'turns' && st !== 'done' && sg?.blockedUntil != null) status = 'problem'
        else if (view !== 'turns' && st !== 'active' && (turn.palmShare < 0.999 || turn.underShare < 0.999)) status = 'short'
      }
      const color = { now: C.accent, served: C.ok, later: C.accentSoft, next: C.accentMid, short: C.caution, problem: C.danger, none: C.neutral }[status]
      const quiet = view === 'aquifer' || view === 'satellite'
      return {
        type: 'Feature',
        properties: { id: p.id, status, color, line: quiet ? (view === 'satellite' ? '#ffffff' : '#8d8982') : status === 'none' ? '#8d8982' : color, opacity: quiet ? 0 : status === 'now' ? 0.75 : status === 'none' ? 0.1 : status === 'later' ? 0.45 : 0.5, label: t(`lg.${status === 'next' ? 'next' : status}` as Key) },
        geometry: { type: 'Polygon', coordinates: [p.polygon] },
      }
    })
    ;(m.getSource('plots') as maplibregl.GeoJSONSource).setData(fc(plots))
    const lines = net.seguias.flatMap(s => {
      const st = seguiaAt(s.id, minute, live)
      const branch = st.active ? net.plots.find(p => p.id === st.active!.plotId)?.branchId ?? null : undefined
      const mk = (kind: 'main' | 'branch', name: string, line: [number, number][], wet: boolean, loss: number) => ({
        type: 'Feature',
        properties: { kind, name, wet: wet && st.blockedUntil == null, color: st.blockedUntil != null ? C.danger : st.extraLoss > 0 ? C.caution : wet ? C.accent : '#9b978f', label: st.blockedUntil != null ? `${t('lg.closed')} → ${hhmm(st.blockedUntil)}` : wet ? t('lg.flow') : t('lg.idle'), loss: `${fmt((loss + st.extraLoss) * 100)} %/km` },
        geometry: { type: 'LineString', coordinates: line },
      })
      return [mk('main', s.name, s.main.line, st.flowing, s.main.lossPerKm), ...s.branches.map(b => mk('branch', b.name, b.line, st.flowing && branch === b.id, b.lossPerKm))]
    })
    ;(m.getSource('seguias') as maplibregl.GeoJSONSource).setData(fc(lines))
    const ws = new Map(live.wells.map(w => [w.id, w]))
    ;(m.getSource('wells') as maplibregl.GeoJSONSource).setData(fc(net.wells.map(w => ({ type: 'Feature', properties: { id: w.id, type: w.type, color: ws.get(w.id)?.status === 'dry' ? C.danger : w.type === 'gda' ? C.accent : C.accentMid }, geometry: { type: 'Point', coordinates: [w.lon, w.lat] } }))))
  }, [ready, live.version, tick, view, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- numbered turn badges: Tours view only ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    badges.current.forEach(b => b.remove())
    badges.current = []
    if (view !== 'turns') return
    for (const s of net.seguias)
      today.turns.filter(x => x.seguiaId === s.id && x.start >= 0).sort((a, b) => a.start - b.start).forEach((turn, i) => {
        const plot = net.plots.find(p => p.id === turn.plotId)
        if (!plot) return
        const el = document.createElement('div')
        el.className = 'pointer-events-none flex h-5 w-5 items-center justify-center rounded-full bg-fg text-12 font-semibold text-white ring-2 ring-white'
        el.textContent = String(i + 1)
        el.style.display = m.getZoom() >= 13.6 ? '' : 'none'
        badges.current.push(new maplibregl.Marker({ element: el }).setLngLat(plot.centroid).addTo(m))
      })
  }, [ready, view, live.version]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- aquifer stress raster follows the scenario ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !scenario || view !== 'aquifer') return
    const idx = Math.round(share / 5), dd = scenario.grid.dd[idx] ?? scenario.grid.dd[0], sal = scenario.grid.sal, c = net.site.center, N = 35
    const small = document.createElement('canvas'); small.width = small.height = N
    const ctx = small.getContext('2d')!, img = ctx.createImageData(N, N), k = 111320 * Math.cos((c.lat * Math.PI) / 180)
    scenario.grid.points.forEach((p, i) => {
      const x = Math.round(((p[0] - c.lon) * k) / 100), y = Math.round(((p[1] - c.lat) * 111320) / 100)
      const v = stress === 'dd' ? dd[i] : stress === 'sal' ? sal[i] * (0.5 + 0.5 * dd[i]) : dd[i] * (0.7 + 0.3 * sal[i])
      const [r, g, b, a] = ramp(v), edge = Math.min(1, Math.max(0, (17.5 - Math.hypot(x, y)) / 3)), o = ((17 - y) * N + (x + 17)) * 4
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = Math.round(a * edge * 255)
    })
    ctx.putImageData(img, 0, 0)
    const big = document.createElement('canvas'); big.width = big.height = 420
    const bctx = big.getContext('2d')!; bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high'; bctx.drawImage(small, 0, 0, 420, 420)
    const kLon = 1750 / k, kLat = 1750 / 111320
    ;(m.getSource('stress') as maplibregl.ImageSource).updateImage({ url: big.toDataURL('image/png'), coordinates: [[c.lon - kLon, c.lat + kLat], [c.lon + kLon, c.lat + kLat], [c.lon + kLon, c.lat - kLat], [c.lon - kLon, c.lat - kLat]] })
  }, [ready, scenario, share, stress, view, net])

  // ---------- 3D: columns as tall as what each recorded well pumps (the layer is created on first use) ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    if (three && scenario) {
      const idx = Math.round(share / 5), kx = 111320 * Math.cos((net.site.center.lat * Math.PI) / 180)
      const data = fc(scenario.recorded.flatMap(w => {
        const nw = net.wells.find(x => x.id === w.id)
        if (!nw) return []
        const r = nw.type === 'gda' ? 20 : 13, dx = r / kx, dy = r / 111320
        return [{ type: 'Feature', properties: { h: 7 * Math.sqrt(w.q[idx]), color: share >= w.joinShare ? C.ok : C.accent }, geometry: { type: 'Polygon', coordinates: [[[nw.lon - dx, nw.lat - dy], [nw.lon + dx, nw.lat - dy], [nw.lon + dx, nw.lat + dy], [nw.lon - dx, nw.lat + dy], [nw.lon - dx, nw.lat - dy]]] } }]
      }))
      if (!m.getSource('columns')) {
        m.addSource('columns', { type: 'geojson', data })
        m.addLayer({ id: 'columns', type: 'fill-extrusion', source: 'columns', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.85 } })
      } else (m.getSource('columns') as maplibregl.GeoJSONSource).setData(data)
    }
    m.easeTo({ pitch: three ? 55 : 0, bearing: three ? -18 : 0, duration: 700 })
  }, [three, ready, scenario, share, net])

  // ---------- replay, full screen ----------
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => { const n = (cur.current.minute < 240 || cur.current.minute >= dayEnd ? 240 : cur.current.minute) + 10; if (n >= dayEnd) { setPlaying(false); setPreview(dayEnd) } else setPreview(n) }, 140)
    return () => clearInterval(id)
  }, [playing, dayEnd, setPreview])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFull(false); setMenu(false) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const legend: [string, Key, ('dot' | 'line' | 'ring')?][] =
    view === 'network' ? [[C.accent, 'lg.now'], [C.ok, 'lg.served'], [C.accentSoft, 'lg.later'], [C.caution, 'lg.short'], [C.danger, 'lg.problem'], [C.accent, 'lg.gda', 'dot'], [C.accentMid, 'lg.priv', 'dot'], [C.accent, 'lg.jebia', 'ring']]
    : view === 'turns' ? [[C.accent, 'lg.now'], [C.accentMid, 'lg.next'], [C.accentSoft, 'lg.later'], [C.ok, 'lg.done'], [C.accent, 'lg.flow', 'line'], [C.danger, 'lg.closed', 'line']]
    : view === 'satellite' ? [['#7fe0b5', 'lg.patch', 'line'], ['#f2b23a', 'lg.hex'], ['#a7a39c', 'lg.masked'], ...(zone ? [['#ffffff', 'lg.blurred', 'ring'] as [string, Key, 'ring']] : [])]
    : []
  const toggles: [keyof typeof layers, Key][] = view === 'satellite' ? [['patches', 'layer.patches'], ['hex', 'layer.hex'], ['ndvi', 'layer.ndvi']] : [['plots', 'layer.plots'], ['wells', 'layer.wells']]

  return (
    <div ref={card} data-testid="map-card" className={`tw-card relative overflow-hidden ${full ? 'fixed inset-0 z-[60] !rounded-none' : 'h-full'}`}>
      <div className="absolute inset-0"><div ref={box} className="h-full w-full" data-testid="map" /></div>
      <div className="absolute start-3 top-3 z-10">
        <Segmented label={t('map.view')} value={view} onChange={setView} options={[['network', t('view.network')], ['aquifer', t('view.aquifer')], ['satellite', t('view.satellite')], ['turns', t('view.turns')]]} />
      </div>
      <div className="absolute end-3 top-3 z-10 flex gap-2">
        <div className="relative">
          <button className="tw-btn" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(o => !o)} data-testid="layers"><Layers size={16} /> {t('map.layers')}</button>
          {menu && (
            <div className="absolute end-0 top-full mt-1 w-72 rounded-card border border-hair bg-card p-3 shadow-lg" data-testid="layers-menu">
              {view === 'aquifer' && <Segmented label={t('view.aquifer')} value={stress} onChange={setStress} options={[['combined', t('stress.combined')], ['dd', t('stress.dd')], ['sal', t('stress.sal')]]} />}
              {toggles.map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 py-1.5 text-14 text-fg2">
                  <input type="checkbox" className="h-4 w-4 accent-[#1c7a89]" checked={layers[k]} onChange={e => setLayers(l => ({ ...l, [k]: e.target.checked }))} /> {t(label)}
                </label>
              ))}
              {view === 'satellite' && live.admin && (
                <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-hair pt-2.5 text-14 text-fg2">
                  <input type="checkbox" className="h-4 w-4 accent-[#1c7a89]" checked={live.unrecordedLayer} onChange={e => onUnrecordedLayer(e.target.checked)} data-testid="unrecorded-toggle" /> {t('layer.unrecorded')}
                </label>
              )}
            </div>
          )}
        </div>
        <button className="tw-btn" aria-pressed={three} onClick={() => setThree(v => !v)} data-testid="map-3d" aria-label={three ? t('map.2d') : t('map.3d')}><Box size={16} /> {three ? '2D' : '3D'}</button>
        <button className="tw-btn tw-icon" onClick={() => setFull(f => !f)} aria-label={full ? t('map.exitFull') : t('map.full')} aria-pressed={full} data-testid="map-full">{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
      {zone && view === 'satellite' && (
        <div role="status" className="absolute start-1/2 top-14 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-caution bg-caution-soft px-3 py-1.5 text-14 font-semibold text-caution" data-testid="admin-banner">
          <ShieldAlert size={16} /> {t('admin.banner')}
        </div>
      )}
      <div className="absolute bottom-3 start-3 z-10 flex max-w-[calc(100%-420px)] flex-col gap-2">
        {(legend.length > 0 || view === 'aquifer') && (
          <div className="flex w-fit flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hair bg-card px-3 py-1.5 text-12 text-fg2" data-testid="legend">
            {view === 'aquifer' && <span className="flex items-center gap-2">{t('lg.stressLow')}<span className="inline-block h-2 w-20 rounded" style={{ background: 'linear-gradient(90deg, rgba(250,178,25,.3), #ec835a, #b5121b)' }} />{t('lg.stressHigh')}</span>}
            {legend.map(([color, key, shape]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="inline-block shrink-0" style={shape === 'line' ? { width: 14, height: 3, borderRadius: 2, background: color } : shape === 'dot' ? { width: 9, height: 9, borderRadius: 9, background: color } : shape === 'ring' ? { width: 10, height: 10, borderRadius: 10, border: `2.5px solid ${color === '#ffffff' ? C.ink : color}`, background: '#fff' } : { width: 12, height: 9, borderRadius: 2, background: color }} />
                {t(key)}
              </span>
            ))}
          </div>
        )}
        <div className="flex h-10 w-[400px] max-w-full items-center gap-2 rounded-lg border border-hair bg-card px-2" data-testid="replay">
          <button className="tw-btn tw-icon primary !h-7 !w-7 shrink-0 !rounded-full" aria-label={playing ? t('map.pause') : t('map.play')} data-testid="replay-play" onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <input type="range" className="tw-range min-w-0 flex-1" min={240} max={dayEnd} step={5} value={Math.min(dayEnd, Math.max(240, minute))} aria-label={t('map.time')} onChange={e => { setPlaying(false); setPreview(Number(e.target.value)) }} />
          <span className="num w-11 text-center text-14 font-semibold" data-testid="replay-time">{hhmm(minute)}</span>
          <button className="tw-btn !h-7 !px-2" aria-pressed={preview == null} onClick={() => { setPlaying(false); setPreview(null) }} data-testid="replay-live"><Radio size={14} /> {t('map.live')}</button>
        </div>
      </div>
    </div>
  )
}
