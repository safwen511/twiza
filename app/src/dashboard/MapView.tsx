import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { Box, Eye, EyeOff, Layers, Maximize2, Minimize2, Pause, Play, Radio, ShieldCheck } from 'lucide-react'
import { fmt, hhmm } from '../api'
import type { DLang, Live, Network, Scenario } from '../types'
import { HELP, Info } from './panels'

const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
const EOX_ATTR = '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless – https://s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)'
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'

const CROP = { palm: '#37795D', vegetables: '#C77700', alfalfa: '#8FC3CB' }
const STATUS = { now: '#2BB3C6', served: '#37795D', later: '#B9DCE1', none: '#9D9995', problem: '#B5121B', short: '#C77700' }

const TXT = {
  fr: {
    title: 'Carte du réseau — Souk Lahad', base: 'Fond', sat: 'Satellite', osm: 'Plan', color: 'Parcelles', crop: 'Cultures', water: "Eau aujourd'hui",
    net: 'Réseau', patches: 'Zones irriguées (Sentinel-2)', ndvi: 'NDVI', hex: 'Prélèvements non déclarés (hexagones)', stress: 'Stress de la nappe',
    combined: 'Combiné', dd: 'Rabattement', sal: 'Salinité', privacy: 'Confidentialité',
    privacyText: "Les puits non déclarés ne sont jamais affichés un par un. Le satellite repère les surfaces irriguées ; celles qui n'ont aucun puits déclaré à moins de 400 m sont additionnées par hexagone d'environ 0,7 km² (H3 niveau 8). Un hexagone qui contient moins de 3 zones est masqué. Aucune épingle, aucun nom, aucune parcelle individuelle. Le registre étant celui du pilote (synthétique), le reste de l'oasis apparaît logiquement « sans puits déclaré ».",
    palm: 'Palmiers seuls', veg: 'Palmiers + maraîchage', alf: 'Palmiers + luzerne',
    now: 'Irrigue maintenant', served: 'Servie aujourd\'hui', later: 'Plus tard aujourd\'hui', none: 'Pas de tour aujourd\'hui', problem: 'Problème', short: 'Servie partiellement',
    hexLegend: 'm³/j estimés sans puits déclaré', masked: 'masqué (< 3 zones)', stressLegend: 'Stress', low: 'faible', high: 'fort',
    plot: 'Parcelle', owner: 'Exploitant', area: 'Surface', turn: 'Tour', noTurn: 'pas de tour aujourd\'hui', ext: 'Extension — puits privé déclaré',
    well: 'Forage / puits déclaré', flow: 'Débit', ec: 'Salinité', level: 'Niveau', dry: 'À SEC', jebia: 'Jebia', stock: 'Stock',
    irrigated: 'Irrigué', est: 'Besoin estimé', unrec: 'dont sans puits déclaré', seguia: 'Seguia', closed: 'fermée jusqu\'à', loss: 'pertes', idle: 'au repos', flowing: 'en eau',
    satFail: 'Tuiles satellite indisponibles : fond OpenStreetMap utilisé.', scene: 'Scène', gda: 'Forage GDA', priv: 'Puits privé déclaré', main: 'Seguia principale (béton)', branch: 'Branche (terre)',
  },
  en: {
    title: 'Network map — Souk Lahad', base: 'Basemap', sat: 'Satellite', osm: 'Map', color: 'Plots', crop: 'Crops', water: 'Water today',
    net: 'Network', patches: 'Irrigated areas (Sentinel-2)', ndvi: 'NDVI', hex: 'Unrecorded abstraction (hexagons)', stress: 'Groundwater stress',
    combined: 'Combined', dd: 'Drawdown', sal: 'Salinity', privacy: 'Privacy',
    privacyText: 'Unrecorded wells are never shown one by one. The satellite finds irrigated land; areas with no recorded well within 400 m are summed per hexagon of about 0.7 km² (H3 level 8). A hexagon holding fewer than 3 areas is masked. No pin, no name, no individual plot. The registry is the pilot\'s (synthetic), so the rest of the oasis naturally shows as "no recorded well".',
    palm: 'Palms only', veg: 'Palms + vegetables', alf: 'Palms + alfalfa',
    now: 'Irrigating now', served: 'Served today', later: 'Later today', none: 'No turn today', problem: 'Problem', short: 'Partly served',
    hexLegend: 'est. m³/d with no recorded well', masked: 'masked (< 3 areas)', stressLegend: 'Stress', low: 'low', high: 'high',
    plot: 'Plot', owner: 'Farmer', area: 'Area', turn: 'Turn', noTurn: 'no turn today', ext: 'Extension — recorded private well',
    well: 'Recorded borehole / well', flow: 'Flow', ec: 'Salinity', level: 'Level', dry: 'DRY', jebia: 'Jebia', stock: 'Storage',
    irrigated: 'Irrigated', est: 'Estimated need', unrec: 'of which no recorded well', seguia: 'Seguia', closed: 'closed until', loss: 'loss', idle: 'idle', flowing: 'flowing',
    satFail: 'Satellite tiles unavailable: OpenStreetMap basemap used.', scene: 'Scene', gda: 'GDA borehole', priv: 'Recorded private well', main: 'Main seguia (concrete)', branch: 'Branch (earth)',
  },
}

const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// stress colour: one warm ramp, transparent when low (yellow -> orange -> red)
const STOPS: [number, number, number, number, number][] = [[0.3, 250, 178, 25, 0], [0.45, 250, 178, 25, 0.4], [0.6, 236, 131, 90, 0.62], [0.78, 208, 59, 59, 0.78], [1, 181, 18, 27, 0.9]]
function ramp(v: number): [number, number, number, number] {
  if (v <= STOPS[0][0]) return [250, 178, 25, 0]
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [v0, r0, g0, b0, a0] = STOPS[i - 1]
      const [v1, r1, g1, b1, a1] = STOPS[i]
      const f = (v - v0) / (v1 - v0)
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f, a0 + (a1 - a0) * f]
    }
  }
  return [181, 18, 27, 0.9]
}
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default function MapView({ net, live, scenario, share, setShare, lang, onUnrecorded }: { net: Network; live: Live; scenario: Scenario | null; share: number; setShare: (n: number) => void; lang: DLang; onUnrecorded?: (on: boolean) => void }) {
  const t = TXT[lang]
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef<Map<string, HTMLDivElement>>(new Map())
  const [ready, setReady] = useState(false)
  const [base, setBase] = useState<'sat' | 'osm'>('sat')
  const [satFail, setSatFail] = useState(false)
  const [mode, setMode] = useState<'water' | 'crop' | 'equity' | 'before'>('water') // 'before' = illustration of the situation without coordination (used by the video)
  const [full, setFull] = useState(false)
  const [three, setThree] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null) // replay of the day: minute shown instead of the live clock
  const [playing, setPlaying] = useState(false)
  const [showOrder, setShowOrder] = useState(true)
  const orderMk = useRef<maplibregl.Marker[]>([])
  const [on, setOn] = useState({ net: true, patches: true, ndvi: false, hex: true, stress: true, unrec: false }) // unrecorded wells: hidden by default (strict view); the community may choose to show them
  const [overlay, setOverlay] = useState(true)
  const [stressMode, setStressMode] = useState<'combined' | 'dd' | 'sal'>('combined')
  const [privacy, setPrivacy] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const liveRef = useRef(live)
  liveRef.current = live
  const langRef = useRef(lang)
  langRef.current = lang
  const farmer = useMemo(() => new Map(net.farmers.map(f => [f.id, f])), [net])

  // ---------- create the map once ----------
  useEffect(() => {
    if (!box.current) return
    const c = net.site.center
    const m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: OSM_ATTR },
          eox: { type: 'raster', tiles: [EOX], tileSize: 256, maxzoom: 14, attribution: EOX_ATTR },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#F7F6F3' } },
          { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.35 } },
          { id: 'eox', type: 'raster', source: 'eox', paint: { 'raster-brightness-max': 0.95 } },
        ],
      },
      center: [c.lon, c.lat],
      zoom: 14.15,
      attributionControl: { compact: true },
    })
    map.current = m
    ;(window as unknown as { __twizaMap?: maplibregl.Map }).__twizaMap = m // handy for tests
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    let eoxErrors = 0
    m.on('error', e => {
      const src = (e as unknown as { sourceId?: string }).sourceId
      if (src === 'eox' && ++eoxErrors >= 4) { setSatFail(true); setBase('osm') }
    })
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '280px', offset: 10 })

    m.on('load', () => {
      const sat = net.sat
      if (sat) {
        const [w, s, e, n] = sat.bbox
        m.addSource('ndvi', { type: 'image', url: '/data/ndvi.png', coordinates: [[w, n], [e, n], [e, s], [w, s]] })
        m.addLayer({ id: 'ndvi', type: 'raster', source: 'ndvi', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7 } })
        m.addSource('patches', { type: 'geojson', data: '/data/sat_patches.geojson' })
        m.addLayer({ id: 'patches-fill', type: 'fill', source: 'patches', paint: { 'fill-color': '#35d39a', 'fill-opacity': 0.1 } })
        m.addLayer({ id: 'patches-line', type: 'line', source: 'patches', paint: { 'line-color': '#5fe3b0', 'line-width': 0.8, 'line-opacity': 0.75 } })
        m.addSource('hex', { type: 'geojson', data: '/data/sat_hex.geojson' })
        m.addLayer({
          id: 'hex-fill', type: 'fill', source: 'hex',
          paint: {
            'fill-color': ['case', ['boolean', ['get', 'suppressed'], false], '#9D9995', '#B5121B'],
            'fill-opacity': ['case', ['boolean', ['get', 'suppressed'], false], 0.12, ['interpolate', ['linear'], ['coalesce', ['get', 'unrecorded_m3_day'], 0], 0, 0.02, 1500, 0.12, 4000, 0.26, 7000, 0.4]],
          },
        })
        m.addLayer({ id: 'hex-line', type: 'line', source: 'hex', paint: { 'line-color': ['case', ['boolean', ['get', 'suppressed'], false], '#F7F6F3', '#E9C9CD'], 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [3, 2] } })
      }
      // stress field: a small raster drawn on a canvas (see the effect below), placed by its corners
      const kLon = 1750 / (111320 * Math.cos((c.lat * Math.PI) / 180))
      const kLat = 1750 / 111320
      m.addSource('stress', { type: 'image', url: BLANK, coordinates: [[c.lon - kLon, c.lat + kLat], [c.lon + kLon, c.lat + kLat], [c.lon + kLon, c.lat - kLat], [c.lon - kLon, c.lat - kLat]] })
      m.addLayer({ id: 'stress', type: 'raster', source: 'stress', paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } })
      m.addSource('plots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'plots-fill', type: 'fill', source: 'plots', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } })
      m.addLayer({ id: 'plots-line', type: 'line', source: 'plots', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'status'], 'now'], 2.5, 1.2], 'line-opacity': 0.95 } })
      m.addSource('pipes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: net.wells.filter(w => w.type === 'gda').flatMap(w => net.jebias.map(j => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[w.lon, w.lat], [w.lon, j.lat + 0.0005], [j.lon, j.lat + 0.0005], [j.lon, j.lat]] } }))) },
      })
      m.addLayer({ id: 'pipes-flow', type: 'line', source: 'pipes', layout: { visibility: 'none' }, paint: { 'line-color': '#1C7A89', 'line-width': 2.5, 'line-dasharray': [0, 4, 3] } })
      m.addLayer({ id: 'pipes', type: 'line', source: 'pipes', paint: { 'line-color': '#8FC3CB', 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [2, 2] } })
      m.addSource('seguias', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'seguias-case', type: 'line', source: 'seguias', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#171717', 'line-width': ['case', ['==', ['get', 'kind'], 'main'], 6.5, 4.5], 'line-opacity': 0.55 } })
      m.addLayer({ id: 'seguias', type: 'line', source: 'seguias', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'kind'], 'main'], 4, 2.5] } })
      // water moving in the canal that is serving a turn (animated dashes, from the jebia to the plot)
      m.addLayer({ id: 'seguias-flow', type: 'line', source: 'seguias', filter: ['==', ['get', 'wet'], true], paint: { 'line-color': '#FFFFFF', 'line-width': 2, 'line-dasharray': [0, 4, 3] } })
      m.addSource('wells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'wells', type: 'circle', source: 'wells', paint: { 'circle-radius': ['case', ['==', ['get', 'type'], 'gda'], 9, 6], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })
      // 3D view: one column per well, as tall as what it pumps
      m.addSource('columns', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'columns', type: 'fill-extrusion', source: 'columns', layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.88 } })
      m.addSource('jebias', { type: 'geojson', data: { type: 'FeatureCollection', features: net.jebias.map(j => ({ type: 'Feature' as const, properties: { id: j.id }, geometry: { type: 'Point' as const, coordinates: [j.lon, j.lat] } })) } })
      m.addLayer({ id: 'jebias', type: 'circle', source: 'jebias', paint: { 'circle-radius': 11, 'circle-color': '#145A66', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })

      // labels: a few HTML markers (no glyph server needed)
      const label = (id: string, lon: number, lat: number, cls: string, dy: number) => {
        const el = document.createElement('div')
        el.className = `pointer-events-none whitespace-nowrap rounded px-1.5 py-0.5 text-sm font-semibold leading-tight ${cls}`
        markers.current.set(id, el)
        new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, dy] }).setLngLat([lon, lat]).addTo(m)
      }
      for (const j of net.jebias) label(j.id, j.lon, j.lat, 'bg-white/95 text-ink border border-line shadow-sm', -13)
      for (const w of net.wells) label(w.id, w.lon, w.lat, 'bg-white/95 text-ink border border-line shadow-sm', -12)

      const show = (e: maplibregl.MapLayerMouseEvent, html: string) => { m.getCanvas().style.cursor = 'pointer'; popup.setLngLat(e.lngLat).setHTML(html).addTo(m) }
      const hide = () => { m.getCanvas().style.cursor = ''; popup.remove() }
      const row = (k: string, v: string) => `<div class="flex justify-between gap-4"><span style="color:#6F6B66">${esc(k)}</span><span class="num">${v}</span></div>`
      m.on('mousemove', 'plots-fill', e => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const x = TXT[langRef.current]
        show(e, `<div class="font-semibold mb-1">${esc(x.plot)} ${esc(String(p.id).toUpperCase())} · ${esc(p.cropLabel)}</div>${row(x.owner, esc(p.owner))}${row(x.area, `${fmt(Number(p.area), 2)} ha`)}${p.kind === 'extension' ? `<div style="color:#45423E" class="mt-1">${esc(x.ext)}</div>` : row(x.turn, p.turn ? esc(p.turn) : esc(x.noTurn))}${p.kind === 'extension' ? '' : `<div class="mt-1" style="color:${esc(p.color)}">● ${esc(p.statusLabel)}</div>`}`)
      })
      m.on('mouseleave', 'plots-fill', hide)
      m.on('mousemove', 'hex-fill', e => {
        const p = e.features?.[0]?.properties
        if (!p || m.queryRenderedFeatures(e.point, { layers: ['plots-fill'] }).length) return
        const x = TXT[langRef.current]
        const sup = p.suppressed === true || p.suppressed === 'true'
        show(e, `<div class="font-semibold mb-1">H3 ${esc(String(p.h3).slice(0, 9))}…</div>${row(x.irrigated, `${fmt(Number(p.irrigated_ha), 1)} ha`)}${row(x.est, `${fmt(Number(p.est_m3_day))} m³/j`)}${sup ? `<div style="color:#45423E" class="mt-1">${esc(x.masked)}</div>` : row(x.unrec, `${fmt(Number(p.unrecorded_m3_day))} m³/j`)}`)
      })
      m.on('mouseleave', 'hex-fill', hide)
      m.on('mousemove', 'wells', e => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const x = TXT[langRef.current]
        show(e, `<div class="font-semibold mb-1">${esc(p.name)}</div>${row(x.flow, p.status === 'dry' ? `<b style="color:#B5121B">${x.dry}</b>` : `${fmt(Number(p.flow), 0)} l/s`)}${row(x.ec, `${fmt(Number(p.ec), 1)} dS/m`)}${row(x.level, `−${fmt(Number(p.level), 1)} m`)}`)
      })
      m.on('mouseleave', 'wells', hide)
      m.on('mousemove', 'jebias', e => {
        const p = e.features?.[0]?.properties
        const j = liveRef.current.jebias.find(j => j.id === p?.id)
        if (!j) return
        const x = TXT[langRef.current]
        show(e, `<div class="font-semibold mb-1">${esc(x.jebia)} ${esc(j.id.slice(1))}</div>${row(x.stock, `${fmt(j.level)} / ${fmt(j.capacity)} m³`)}`)
      })
      m.on('mouseleave', 'jebias', hide)
      m.on('mousemove', 'seguias', e => {
        const p = e.features?.[0]?.properties
        if (!p) return
        show(e, `<div class="font-semibold mb-1">${esc(p.name)}</div><div style="color:${esc(p.color)}">● ${esc(p.label)}</div>`)
      })
      m.on('mouseleave', 'seguias', hide)
      setReady(true)
    })
    const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]]
    let dash = 0
    const anim = setInterval(() => { dash = (dash + 1) % DASH.length; for (const id of ['seguias-flow', 'pipes-flow']) if (m.getLayer(id)) m.setPaintProperty(id, 'line-dasharray', DASH[dash]) }, 90)
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current)
    return () => { setReady(false); clearInterval(anim); ro.disconnect(); m.remove(); map.current = null; markers.current.clear() }
  }, [net])

  // ---------- basemap + layer visibility ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !m.getSource('plots')) return
    const vis = (id: string, v: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none')
    vis('eox', base === 'sat'); vis('osm', base === 'osm')
    vis('ndvi', on.ndvi); vis('patches-fill', on.patches); vis('patches-line', on.patches)
    vis('hex-fill', on.hex); vis('hex-line', on.hex); vis('stress', on.stress)
    for (const id of ['seguias', 'seguias-case', 'seguias-flow', 'pipes', 'wells', 'jebias']) vis(id, on.net)
    const hiddenWell = new Set(net.wells.filter(w => !w.recorded && !on.unrec).map(w => w.id))
    for (const [id, el] of markers.current) el.style.display = on.net && !hiddenWell.has(id) ? '' : 'none'
    if (m.getLayer('wells')) m.setFilter('wells', on.unrec ? null : ['==', ['get', 'recorded'], true])
    if (m.getLayer('plots-fill')) for (const id of ['plots-fill', 'plots-line']) m.setFilter(id, on.unrec ? null : ['!=', ['get', 'unrec'], true])
  }, [base, on, ready])

  // ---------- live data: plots, seguias, wells, jebia labels ----------
  const tick = Math.floor(live.now.minute / 5)
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !m.getSource('plots')) return
    const today = live.plans[0]
    const minute = preview ?? live.now.minute
    const liveSeg = new Map(live.seguias.map(s => [s.id, s]))
    // state of each seguia at the minute shown (live, or replayed from the plan)
    const sState = new Map(net.seguias.map(s => {
      if (preview == null) return [s.id, liveSeg.get(s.id)!] as const
      const b = today.blocks.find(b => b.seguiaId === s.id && minute >= b.from && minute < b.to)
      const a = today.turns.find(x => x.seguiaId === s.id && x.start >= 0 && minute >= x.start && minute < x.end)
      return [s.id, { id: s.id, blockedUntil: b ? b.to : null, extraLoss: liveSeg.get(s.id)?.extraLoss ?? 0, flow: a && !b ? s.capacityM3h : 0, activeTurnId: a?.id ?? null }] as const
    }))
    const weekPct = new Map(live.weekly.map(r => [r.farmerId, r.pct]))
    const lats = net.plots.filter(p => p.kind === 'collective').map(p => p.centroid[1])
    const latMin = Math.min(...lats)
    const latMax = Math.max(...lats)
    const unrecPlots = new Set(net.plots.filter(p => p.wellId && net.wells.some(w => w.id === p.wellId && !w.recorded)).map(p => p.id))
    const turnOf = new Map(today.turns.map(x => [x.plotId, x]))
    const plots = net.plots.map(p => {
      const turn = turnOf.get(p.id)
      const sg = p.seguiaId ? sState.get(p.seguiaId) : undefined
      let status: keyof typeof STATUS = 'none'
      if (turn) {
        const st = turn.start < 0 ? 'pending' : minute >= turn.end ? 'done' : minute >= turn.start ? 'active' : 'pending'
        status = st === 'active' ? 'now' : st === 'done' ? 'served' : 'later'
        if (st !== 'done' && sg?.blockedUntil != null) status = 'problem'
        else if (turn.palmShare < 0.999 || turn.underShare < 0.999) status = st === 'active' ? 'now' : 'short'
      }
      const crop = p.under ?? 'palm'
      const pct = weekPct.get(p.farmerId)
      const eq = pct == null ? '#9D9995' : pct >= 97 ? '#37795D' : pct >= 85 ? '#C77700' : '#B5121B'
      // without coordination (illustration): the head of the canal takes the water, the tail goes without
      const rank = p.kind === 'collective' ? (p.centroid[1] - latMin) / Math.max(1e-9, latMax - latMin) : 1
      const bf = rank > 0.55 ? '#2BB3C6' : rank > 0.3 ? '#C77700' : '#B5121B'
      const color = mode === 'crop' ? CROP[crop] : p.kind === 'extension' ? STATUS.none : mode === 'equity' ? eq : mode === 'before' ? bf : STATUS[status]
      const f = farmer.get(p.farmerId)
      return {
        type: 'Feature' as const,
        properties: {
          id: p.id, kind: p.kind, unrec: unrecPlots.has(p.id), status, color, opacity: mode === 'before' ? (p.kind === 'extension' ? 0.2 : 0.62) : mode !== 'water' ? 0.55 : status === 'now' ? 0.7 : status === 'none' ? 0.16 : status === 'later' ? 0.28 : 0.5,
          owner: f ? `${f.first} ${f.last}` : '', area: p.areaHa, cropLabel: crop === 'palm' ? t.palm : crop === 'vegetables' ? t.veg : t.alf,
          turn: turn && turn.start >= 0 ? `${hhmm(turn.start)}–${hhmm(turn.end)} · ${fmt(turn.target)} m³` : '', statusLabel: mode === 'equity' && pct != null ? `${fmt(pct)} % ${lang === 'fr' ? 'du besoin reçu (7 j)' : 'of need received (7 d)'}` : t[status],
        },
        geometry: { type: 'Polygon' as const, coordinates: [p.polygon] },
      }
    })
    ;(m.getSource('plots') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: plots })

    const activeBranch = new Map<string, string | null>()
    for (const s of sState.values()) {
      const turn = today.turns.find(x => x.id === s.activeTurnId)
      const plot = turn && net.plots.find(p => p.id === turn.plotId)
      if (plot) activeBranch.set(s.id, plot.branchId)
    }
    const lines = net.seguias.flatMap(s => {
      const st = sState.get(s.id)!
      const blocked = st.blockedUntil != null
      const flowing = mode === 'before' ? true : st.flow > 0
      const paint = (wet: boolean) => (blocked ? '#B5121B' : st.extraLoss > 0 ? '#C77700' : wet ? '#1C7A89' : '#D8D4CC')
      const lab = (wet: boolean, loss: number) => (blocked ? `${t.closed} ${hhmm(st.blockedUntil!)}` : `${wet ? `${t.flowing} · ${fmt(st.flow)} m³/h` : t.idle} · ${t.loss} ${fmt((loss + st.extraLoss) * 100, 0)} %/km`)
      const br = activeBranch.get(s.id)
      return [
        { type: 'Feature' as const, properties: { kind: 'main', wet: flowing && !blocked, name: `${s.name} — ${t.main}`, color: paint(flowing), label: lab(flowing, s.main.lossPerKm) }, geometry: { type: 'LineString' as const, coordinates: s.main.line } },
        ...s.branches.map(b => ({ type: 'Feature' as const, properties: { kind: 'branch', wet: mode === 'before' ? true : flowing && !blocked && br === b.id, name: `${b.name} — ${t.branch}`, color: paint(mode === 'before' ? true : flowing && br === b.id), label: lab(flowing && br === b.id, b.lossPerKm) }, geometry: { type: 'LineString' as const, coordinates: b.line } })),
      ]
    })
    ;(m.getSource('seguias') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: lines })

    const wState = new Map(live.wells.map(w => [w.id, w]))
    ;(m.getSource('wells') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: net.wells.map(w => {
        const s = wState.get(w.id)
        return { type: 'Feature' as const, properties: { name: w.type === 'gda' ? w.name : w.recorded ? `${w.name} — ${t.priv}` : `${w.name} — ${lang === 'fr' ? 'puits non déclaré' : 'unrecorded well'}`, recorded: w.recorded, type: w.type, status: s?.status ?? 'ok', flow: s?.flowLs ?? w.flowLs, ec: s?.ecDs ?? 0, level: s?.levelM ?? 0, color: s?.status === 'dry' ? '#171717' : w.type === 'gda' ? '#1C7A89' : w.recorded ? '#8FC3CB' : '#B5121B' }, geometry: { type: 'Point' as const, coordinates: [w.lon, w.lat] } }
      }),
    })
    const stepNow = Math.min(288, Math.floor(minute / 5))
    for (const j of live.jebias) { const el = markers.current.get(j.id); const lv = preview != null ? today.jebiaLevels[j.id]?.[stepNow] ?? j.level : j.level; if (el) el.textContent = `J${j.id.slice(1)} ${Math.round((lv / j.capacity) * 100)}%` }
    const pumping = (today.pumpedCum[Math.min(288, stepNow + 1)] ?? 0) - (today.pumpedCum[stepNow] ?? 0) > 0.5
    if (m.getLayer('pipes-flow')) m.setLayoutProperty('pipes-flow', 'visibility', pumping && on.net ? 'visible' : 'none')
    for (const w of net.wells.filter(w => w.type === 'gda')) { const el = markers.current.get(w.id); const s = wState.get(w.id); if (el) el.textContent = `${w.name.replace('Forage ', '')}${s?.status === 'dry' ? ` · ${t.dry}` : ''}` }
  }, [ready, live.version, tick, mode, lang, net, farmer, preview, on.net]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- order of the turns: a number on each plot irrigated today ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !m.getSource('plots')) return
    orderMk.current.forEach(x => x.remove())
    orderMk.current = []
    if (!showOrder || !on.net || mode === 'before') return
    for (const s of net.seguias) {
      live.plans[0].turns.filter(x => x.seguiaId === s.id && x.start >= 0).sort((a, b) => a.start - b.start).forEach((turn, i) => {
        const plot = net.plots.find(p => p.id === turn.plotId)
        if (!plot) return
        const el = document.createElement('div')
        el.className = 'pointer-events-none flex h-6 w-6 items-center justify-center rounded-full bg-ink text-sm font-bold text-white shadow ring-2 ring-white'
        el.textContent = String(i + 1)
        orderMk.current.push(new maplibregl.Marker({ element: el }).setLngLat(plot.centroid).addTo(m))
      })
    }
  }, [ready, live.version, showOrder, on.net, net, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- full screen, 3D view, and a small remote control (used to record the video) ----------
  const sentUnrec = useRef(false)
  useEffect(() => {
    if (on.unrec === sentUnrec.current) return
    sentUnrec.current = on.unrec
    onUnrecorded?.(on.unrec)
  }, [on.unrec]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('fullscreenchange', onFs)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('keydown', onKey) }
  }, [])
  const toggleFull = () => {
    const next = !full
    setFull(next)
    if (next) card.current?.requestFullscreen?.().catch(() => {})
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !m.getSource('plots')) return
    if (m.getLayer('columns')) m.setLayoutProperty('columns', 'visibility', three && on.net ? 'visible' : 'none')
    m.easeTo({ pitch: three ? 58 : 0, bearing: three ? -18 : 0, duration: 900 })
  }, [three, ready, on.net])
  useEffect(() => {
    ;(window as unknown as { __twizaCtl?: unknown }).__twizaCtl = { setMode, setPreview, setPlaying, setFull, setThree, setShowOrder, setOverlay, setShare, setOn }
  })

  // ---------- replay of the day ----------
  const dayEnd = Math.max(16 * 60, ...live.plans[0].turns.map(x => x.end))
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setPreview(p => { const n = (p ?? 240) + 10; if (n >= dayEnd) { setPlaying(false); return dayEnd } return n }), 130)
    return () => clearInterval(id)
  }, [playing, dayEnd])

  // ---------- stress heatmap follows the scenario slider ----------
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !scenario || !m.getSource('plots')) return
    const idx = Math.round(share / 5)
    // recorded private wells: what each pumps in this scenario, and whether it has joined
    for (const w of scenario.recorded) {
      const el = markers.current.get(w.id)
      const nw = net.wells.find(x => x.id === w.id)
      if (!el || !nw || nw.type === 'gda') continue
      const joined = share >= w.joinShare
      el.textContent = `${joined ? '✓ ' : ''}${w.recorded ? '' : lang === 'fr' ? 'non déclaré · ' : 'unrecorded · '}${fmt(w.q[idx])} ${lang === 'fr' ? 'm³/j' : 'm³/d'}`
      el.style.borderColor = joined ? '#37795D' : w.recorded ? '#6F6B66' : '#B5121B'
      el.style.color = joined ? '#37795D' : w.recorded ? '#45423E' : '#B5121B'
    }
    const kx = 111320 * Math.cos((net.site.center.lat * Math.PI) / 180)
    ;(m.getSource('columns') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: scenario.recorded.filter(w => on.unrec || w.recorded).flatMap(w => {
        const nw = net.wells.find(x => x.id === w.id)
        if (!nw) return []
        const r = nw.type === 'gda' ? 20 : 13
        const dx = r / kx
        const dy = r / 111320
        const joined = share >= w.joinShare
        return [{ type: 'Feature' as const, properties: { h: 7 * Math.sqrt(w.q[idx]), color: joined ? '#37795D' : nw.type === 'gda' ? '#1C7A89' : w.recorded ? '#6F6B66' : '#B5121B' }, geometry: { type: 'Polygon' as const, coordinates: [[[nw.lon - dx, nw.lat - dy], [nw.lon + dx, nw.lat - dy], [nw.lon + dx, nw.lat + dy], [nw.lon - dx, nw.lat + dy], [nw.lon - dx, nw.lat - dy]]] } }]
      }),
    })
    const dd = scenario.grid.dd[idx] ?? scenario.grid.dd[0]
    const sal = scenario.grid.sal
    const c = net.site.center
    const N = 35
    const small = document.createElement('canvas')
    small.width = small.height = N
    const ctx = small.getContext('2d')!
    const img = ctx.createImageData(N, N)
    const k = 111320 * Math.cos((c.lat * Math.PI) / 180)
    scenario.grid.points.forEach((p, i) => {
      const x = Math.round(((p[0] - c.lon) * k) / 100)
      const y = Math.round(((p[1] - c.lat) * 111320) / 100)
      const v = stressMode === 'dd' ? dd[i] : stressMode === 'sal' ? sal[i] * (0.5 + 0.5 * dd[i]) : dd[i] * (0.7 + 0.3 * sal[i])
      const [r, g, b2, a2] = ramp(v)
      const edge = Math.min(1, Math.max(0, (17.5 - Math.hypot(x, y)) / 3)) // fade out at the rim of the disc
      const o = ((17 - y) * N + (x + 17)) * 4
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b2; img.data[o + 3] = Math.round(a2 * edge * 255)
    })
    ctx.putImageData(img, 0, 0)
    // upscale with smoothing = bilinear interpolation between the grid values
    const big = document.createElement('canvas')
    big.width = big.height = 420
    const bctx = big.getContext('2d')!
    bctx.imageSmoothingEnabled = true
    bctx.imageSmoothingQuality = 'high'
    bctx.drawImage(small, 0, 0, 420, 420)
    const src = m.getSource('stress') as maplibregl.ImageSource
    const kLon = 1750 / k
    const kLat = 1750 / 111320
    src.updateImage({ url: big.toDataURL('image/png'), coordinates: [[c.lon - kLon, c.lat + kLat], [c.lon + kLon, c.lat + kLat], [c.lon + kLon, c.lat - kLat], [c.lon - kLon, c.lat - kLat]] })
  }, [ready, scenario, share, stressMode, net, lang, on.unrec])

  const Toggle = ({ k, label }: { k: keyof typeof on; label: string }) => (
    <button className={`chip ${on[k] ? 'chip-on' : ''}`} onClick={() => setOn(o => ({ ...o, [k]: !o[k] }))} aria-pressed={on[k]}>
      {on[k] ? <Eye size={12} /> : <EyeOff size={12} />} {label}
    </button>
  )
  const Seg = <T extends string>({ value, set, opts }: { value: T; set: (v: T) => void; opts: [T, string][] }) => (
    <span className="inline-flex overflow-hidden rounded-md border border-line">
      {opts.map(([v, l]) => (
        <button key={v} onClick={() => set(v)} className={`px-2 py-1 text-base ${value === v ? 'bg-ink text-white' : 'bg-panel text-ink2 hover:text-ink'}`}>{l}</button>
      ))}
    </span>
  )
  const legend = mode === 'crop'
    ? [[CROP.palm, t.palm], [CROP.vegetables, t.veg], [CROP.alfalfa, t.alf]]
    : [[STATUS.now, t.now], [STATUS.served, t.served], [STATUS.later, t.later], [STATUS.short, t.short], [STATUS.problem, t.problem], [STATUS.none, t.none]]

  return (
    <div ref={card} data-testid="map-card" className={`card flex flex-col ${full ? 'fixed inset-0 z-[60] !rounded-none' : 'h-full'}`}>
      <div className="card-h flex-wrap gap-y-2" data-video-hide>
        <Layers size={15} className="text-brand" /> {t.title} <Info text={HELP[lang].map} />
        {net.sat && <span className="font-normal text-mute">· {t.scene} Sentinel-2 {net.sat.scene_date} · {fmt(net.sat.irrigated_ha)} ha</span>}
        <span className="ms-auto flex flex-wrap items-center gap-1.5 font-normal">
          <Seg value={base} set={setBase} opts={[['sat', t.sat], ['osm', t.osm]]} />
          <Seg value={mode} set={setMode} opts={[['water', t.water], ['equity', lang === 'fr' ? 'Équité' : 'Fairness'], ['crop', t.crop]]} />
          <button className={`chip ${three ? 'chip-on' : ''}`} onClick={() => setThree(v => !v)} data-testid="map-3d"><Box size={15} /> 3D</button>
          <button className={`chip ${full ? 'chip-on' : ''}`} onClick={toggleFull} data-testid="map-full">{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />} {full ? (lang === 'fr' ? 'Quitter' : 'Exit') : (lang === 'fr' ? 'Plein écran' : 'Full screen')}</button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2" data-video-hide>
        <Toggle k="net" label={t.net} />
        <Toggle k="patches" label={t.patches} />
        <Toggle k="hex" label={t.hex} />
        <Toggle k="stress" label={t.stress} />
        {on.stress && <Seg value={stressMode} set={setStressMode} opts={[['combined', t.combined], ['dd', t.dd], ['sal', t.sal]]} />}
        <Toggle k="unrec" label={lang === 'fr' ? 'Puits non déclarés' : 'Unrecorded wells'} />
        <Toggle k="ndvi" label={t.ndvi} />
        <button className={`chip ms-auto ${privacy ? 'chip-on' : ''}`} onClick={() => setPrivacy(p => !p)} aria-expanded={privacy}>
          <ShieldCheck size={13} className="text-good" /> {t.privacy}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-base text-ink" data-testid="replay">
        <button className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white" aria-label="replay" data-testid="replay-play" onClick={() => { if (!playing && (preview == null || preview >= dayEnd)) setPreview(240); setPlaying(p => !p) }}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span className="whitespace-nowrap font-semibold">{lang === 'fr' ? 'Rejouer la journée' : 'Replay the day'}</span>
        <input type="range" min={240} max={dayEnd} step={5} value={preview ?? Math.min(dayEnd, Math.max(240, live.now.minute))} onChange={e => { setPlaying(false); setPreview(Number(e.target.value)) }} className="slider min-w-40 flex-1" aria-label="time" />
        <span className="num w-14 text-center font-semibold" data-testid="replay-time">{hhmm(preview ?? live.now.minute)}</span>
        <button className={`chip ${preview == null ? 'chip-on' : ''}`} onClick={() => { setPlaying(false); setPreview(null) }}><Radio size={14} /> {lang === 'fr' ? 'Direct' : 'Live'}</button>
        <button className={`chip ${showOrder ? 'chip-on' : ''}`} onClick={() => setShowOrder(o => !o)}>1·2·3</button>
      </div>
      {(() => {
        // the whole chain at the minute shown: borehole -> jebia -> seguia -> plot -> aquifer
        const plan = live.plans[0]
        const minute = preview ?? live.now.minute
        const st = Math.min(288, Math.floor(minute / 5))
        const fr = lang === 'fr'
        const pumped = plan.pumpedCum[st] ?? 0
        const pumping = (plan.pumpedCum[Math.min(288, st + 1)] ?? 0) - pumped > 0.5
        const stock = net.jebias.reduce((a, j) => a + (plan.jebiaLevels[j.id]?.[st] ?? 0), 0)
        const cap = net.jebias.reduce((a, j) => a + j.capacityM3, 0)
        const active = plan.turns.filter(x => x.start >= 0 && minute >= x.start && minute < x.end)
        const done = plan.turns.filter(x => x.start >= 0 && minute >= x.end)
        const names = active.map(x => farmer.get(x.farmerId)?.first).filter(Boolean).join(', ')
        const steps: [string, string, string, boolean][] = [
          [fr ? 'Forages' : 'Boreholes', pumping ? (fr ? 'pompent' : 'pumping') : (fr ? 'à l\'arrêt' : 'stopped'), `${fmt(pumped)} m³`, pumping],
          [fr ? 'Jebias' : 'Jebias', fr ? 'stockent' : 'storing', `${fmt((stock / cap) * 100)} %`, stock > 0],
          [fr ? 'Seguias' : 'Seguias', fr ? 'distribuent' : 'delivering', `${active.length} / ${net.seguias.length}`, active.length > 0],
          [fr ? 'Parcelles' : 'Plots', names || (fr ? 'personne n\'irrigue' : 'nobody irrigating'), `${done.length} / ${plan.turns.length} ${fr ? 'tours' : 'turns'}`, active.length > 0],
          [fr ? 'Nappe' : 'Aquifer', fr ? 'sous le plafond' : 'under the limit', `${fmt((pumped / plan.cap) * 100)} %`, pumped <= plan.cap],
        ]
        return (
          <div className="flex items-stretch gap-1 border-t border-line px-4 py-2" data-testid="workflow">
            {steps.map(([name, verb, value, on2], i) => (
              <div key={name} className="flex min-w-0 flex-1 items-center gap-1">
                <div className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 ${on2 ? 'border-s1/50 bg-s1/10' : 'border-line bg-panel2'}`}>
                  <div className="flex items-center gap-1.5 text-base font-semibold text-ink"><span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-white">{i + 1}</span><span className="truncate">{name}</span></div>
                  <div className="num truncate text-lg font-semibold leading-tight text-ink">{value}</div>
                  <div className="truncate text-sm text-ink2" title={verb}>{verb}</div>
                </div>
                {i < steps.length - 1 && <span className="text-lg text-mute">›</span>}
              </div>
            ))}
          </div>
        )
      })()}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-2xl">
        <div ref={box} className="absolute inset-0" data-testid="map" />
        {privacy && (
          <div className="absolute end-3 top-3 z-20 max-w-sm rounded-lg border border-line bg-panel p-3 text-base leading-relaxed text-ink2 shadow-xl">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink"><ShieldCheck size={14} className="text-good" /> {t.privacy}</div>
            {t.privacyText}
            <div className="mt-1.5 text-mute">{net.wellCounts.recorded} / {net.wellCounts.total} {lang === 'fr' ? 'puits de la communauté sont déclarés ; les autres ne sont connus qu\'en agrégat.' : 'community wells are recorded; the others are known only as an aggregate.'}</div>
          </div>
        )}
        {scenario && !overlay && <button className="chip absolute end-3 top-3 z-10 !bg-panel/95" onClick={() => setOverlay(true)} data-testid="overlay-open">{lang === 'fr' ? 'Effet sur la nappe' : 'Effect on the aquifer'}</button>}
        {scenario && overlay && (() => {
          const i = Math.round(share / 5)
          const row = scenario.rows[i]
          const saved = scenario.rows[0].total - row.total
          const peak = Math.round((1 - Math.max(...scenario.grid.dd[i]) / Math.max(...scenario.grid.dd[0])) * 100)
          const fr = lang === 'fr'
          return (
            <div className="absolute end-3 top-3 z-10 w-[17rem] rounded-xl border border-line bg-panel/95 p-3 text-base leading-snug text-ink2 shadow-lg" data-testid="aquifer-overlay">
              <div className="mb-1 flex items-center justify-between font-semibold text-ink">{fr ? 'Effet sur la nappe' : 'Effect on the aquifer'}<button onClick={() => setOverlay(false)} aria-label="close" data-testid="overlay-close" className="px-1 text-ink2 hover:text-ink">✕</button></div>
              <div className="flex justify-between"><span>{fr ? 'Puits dans TWIZA' : 'Wells in TWIZA'}</span><b className="num text-ink">{row.joined} / {scenario.wells}</b></div>
              <div className="flex justify-between"><span>{fr ? 'dont non déclarés' : 'of which unrecorded'}</span><b className="num whitespace-nowrap text-ink">{scenario.unrecorded.joined[i]} / {scenario.unrecorded.count}</b></div>
              <div className="flex justify-between"><span>{fr ? 'Pompage évité' : 'Pumping avoided'}</span><b className="num text-good">{fmt(saved)} {fr ? 'm³/j' : 'm³/d'}</b></div>
              <div className="flex justify-between" title={fr ? 'Hypothèse : 0,2 kWh par m³ (relevage ~35 m, rendement 50 %)' : 'Assumption: 0.2 kWh per m³ (lift ~35 m, efficiency 50 %)'}><span>{fr ? 'Énergie évitée' : 'Energy avoided'}</span><b className="num text-good">≈ {fmt(saved * 0.2)} kWh/{fr ? 'j' : 'd'}</b></div>
              <div className="flex justify-between"><span>{fr ? 'Stress maximal' : 'Peak stress'}</span><b className={`num ${peak > 0 ? 'text-good' : 'text-ink'}`}>{peak > 0 ? `−${peak} %` : '—'}</b></div>
              <input type="range" min={0} max={100} step={5} value={share} onChange={e => setShare(Number(e.target.value))} className="slider mt-2 w-full" aria-label={fr ? 'Part des puits dans TWIZA' : 'Share of wells in TWIZA'} data-testid="share-map" style={{ background: `linear-gradient(90deg, #1C7A89 ${share}%, #DEDBD4 ${share}%)` }} />
              <div className="mt-1 text-sm text-mute">{on.unrec ? (fr ? 'En rouge : puits non déclarés. Ils passent au vert quand ils rejoignent TWIZA.' : 'Red: unrecorded wells. They turn green when they join TWIZA.') : (fr ? 'Puits non déclarés : comptés, jamais localisés. La communauté peut choisir de les afficher.' : 'Unrecorded wells: counted, never located. The community may choose to show them.')}</div>
            </div>
          )
        })()}
        {satFail && <div className="absolute end-3 bottom-14 z-10 rounded bg-panel/95 px-2 py-1 text-base text-warn">{t.satFail}</div>}
        <button className={`chip absolute bottom-3 start-3 z-10 !bg-panel/95 ${legendOpen ? 'hidden' : ''}`} onClick={() => setLegendOpen(true)} data-testid="legend-open">
          <Layers size={14} /> {lang === 'fr' ? 'Légende' : 'Legend'}
        </button>
        {legendOpen && (
          <div className="absolute bottom-3 start-3 z-10">
            <button className="absolute end-2 top-2 z-20 text-ink2 hover:text-ink" onClick={() => setLegendOpen(false)} aria-label="close">✕</button>
        <div className="max-w-[360px] pe-7 space-y-1.5 rounded-lg border border-line bg-panel/95 p-2 text-sm leading-tight text-ink2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {legend.map(([c, l]) => (
              <div key={l} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: c, opacity: 0.85 }} /> {l}</div>
            ))}
          </div>
          {on.net && (
            <div className="space-y-1 border-t border-line pt-1.5">
              <div className="flex items-center gap-1.5"><span className="inline-block h-1 w-4 rounded" style={{ background: '#1C7A89' }} /> {t.seguia} · {t.flowing}</div>
              <div className="flex items-center gap-1.5"><span className="inline-block h-1 w-4 rounded" style={{ background: '#D8D4CC' }} /> {t.idle} <span className="ms-1 inline-block h-1 w-4 rounded bg-crit" /> {lang === 'fr' ? 'fermée' : 'closed'}</div>
              <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#1C7A89' }} /> {t.gda} <span className="ms-1 inline-block h-2 w-2 rounded-full" style={{ background: '#8FC3CB' }} /> {t.priv}</div>
            </div>
          )}
          {on.hex && (
            <div className="border-t border-line pt-1.5">
              <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-14 rounded-sm" style={{ background: 'linear-gradient(90deg, rgba(181,18,27,.06), rgba(181,18,27,.45))' }} /> {t.hexLegend}</div>
              <div className="mt-1 flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-sm border border-dashed border-[#aab1bd] bg-[#7c8594]/20" /> {t.masked}</div>
            </div>
          )}
          {on.stress && (
            <div className="flex items-center gap-1.5 border-t border-line pt-1.5">
              {t.stressLegend}: {t.low} <span className="inline-block h-2.5 w-16 rounded-sm" style={{ background: 'linear-gradient(90deg, rgba(250,178,25,.3), #ec835a, #B5121B)' }} /> {t.high}
            </div>
          )}
        </div>
          </div>
        )}
      </div>
    </div>
  )
}
