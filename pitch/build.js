// TWIZA pitch deck — 10 slides. Run: node build.js  (then post.py adds the slide transitions)
const pptxgen = require('pptxgenjs')
const path = require('path')
const { applyTheme } = require('/home/flint/.claude/skills/synced/f9e51e31-6bba-4f5d-a3b6-3b6d028a8e0e_a37ef0fa-ff35-47b6-8789-35dc02fc4d1e/pptx/scripts/apply_theme.js')

const A = f => path.join(__dirname, 'assets', f)
const THEME = {
  name: 'TWIZA',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '171717', lt1: 'F7F6F3', dk2: '171717', lt2: 'FFFFFF',
    accent1: 'B5121B', accent2: 'E9C9CD', accent3: '1C7A89', accent4: 'B5121B', accent5: '37795D', accent6: '6F6B66',
    hlink: 'B5121B', folHlink: '6F6B66',
  },
}
const T = THEME.colors

const pres = new pptxgen()
pres.layout = 'LAYOUT_16x9' // 10 x 5.625 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
pres.title = 'TWIZA — community water sharing for the oasis of Souk Lahad'
pres.author = 'TWIZA team'
const C = pres.SchemeColor

pres.defineSlideMaster({
  title: 'DARK',
  background: { color: T.dk2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 1.25, w: 5.6, h: 1.3, fontSize: 54, bold: true, color: C.background1, align: 'left', valign: 'top', margin: 0 }, text: '' } },
  ],
})
pres.defineSlideMaster({
  title: 'DARK_TOP',
  background: { color: T.dk2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 34, bold: true, color: C.background1, align: 'left', valign: 'middle', margin: 0 }, text: '' } },
  ],
})
pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: T.lt1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.75, fontSize: 30, bold: true, color: C.text2, align: 'left', valign: 'middle', margin: 0 }, text: '' } },
    { text: { text: 'TWIZA · KIZUNA 2026 · pilot data is synthetic, weather and satellite imagery are real', options: { x: 0.5, y: 5.22, w: 7.5, h: 0.25, fontSize: 10, color: C.accent6, margin: 0 } } },
  ],
  slideNumber: { x: 9.0, y: 5.2, w: 0.5, h: 0.28, fontSize: 10, color: C.accent6, align: 'right' },
})

const txt = (s, text, o) => s.addText(text, { isTextBox: true, margin: 0, color: C.text1, ...o })
const card = (s, x, y, w, h, name, fill = C.background2) =>
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { type: 'none' }, objectName: name })
const badge = (s, n, x, y, color = C.accent1) => {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: 0.42, h: 0.42, fill: { color }, line: { type: 'none' }, objectName: `Badge ${n}` })
  s.addText(String(n), { isTextBox: true, x, y, w: 0.42, h: 0.42, margin: 0, align: 'center', valign: 'middle', fontSize: 16, bold: true, color: C.background1 })
}
const phone = (s, file, x, y, h, name) => {
  const w = (h * 390) / 844
  s.addShape(pres.ShapeType.roundRect, { x: x - 0.07, y: y - 0.07, w: w + 0.14, h: h + 0.14, rectRadius: 0.12, fill: { color: C.text1 }, line: { type: 'none' }, shadow: { type: 'outer', color: '000000', opacity: 0.25, blur: 8, offset: 3, angle: 90 }, objectName: `${name} frame` })
  s.addImage({ path: A(file), x, y, w, h, altText: name, objectName: name })
}

// ---------------------------------------------------------------- 1. Title
pres.addSection({ title: 'Opening' })
{
  const s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Opening' })
  s.addText([{ text: 'TWIZA  ' }, { text: 'تويزة', options: { lang: 'ar-TN', color: C.accent2 } }], { placeholder: 'title' })
  txt(s, 'Every farmer knows their water turn. The aquifer stays under its limit.', { x: 0.6, y: 2.55, w: 5.4, h: 1.0, fontSize: 22, color: C.background1, valign: 'top' })
  txt(s, 'Twiza: the village tradition of helping each other, applied to water. Like kizuna, a bond between people. Oasis of Souk Lahad, Kebili', { x: 0.6, y: 3.85, w: 5.4, h: 0.35, fontSize: 16, color: C.background2 })
  txt(s, 'KIZUNA 2026 · Tunisia × Japan · water', { x: 0.6, y: 4.25, w: 5.4, h: 0.3, fontSize: 14, color: C.background2 })
  phone(s, 'phone-home.png', 7.1, 0.7, 4.25, 'Farmer app, home screen in Tunisian Arabic')
  s.addNotes('Twiza is the collective effort of Tunisian villages: people gather to help each other harvest, build a house, clean the canals. We apply it to water. Japan has the same tradition: farmer-run Land Improvement Districts share canal water, by rotation in dry years (bansui). Twiza and kizuna, the bond between people, name the same idea. One sentence: an app that tells every farmer of an oasis when it is their turn to irrigate and how much water they get, while keeping the whole community under a safe pumping limit. On the right is the real home screen, in derja.')
}

// ---------------------------------------------------------------- 2. Problem statement
pres.addSection({ title: 'Problem' })
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Problem' })
  s.addText('Water shared on paper, pumped blind', { placeholder: 'title' })
  const cols = [
    ['The problem', C.accent4, ['Turns are fixed, on paper, often unfair', 'Nobody knows the aquifer\'s stress', 'Many private wells are unrecorded', 'The water is getting saltier']],
    ['Our approach', C.accent1, ['Turns computed from crop need, weather and sensors', 'Satellite shows where water is really used', 'Privacy first, so every well owner can join']],
    ['The objective', C.accent3, ['Each farm gets the right water for its crops', 'Palms never go without', 'Total pumping stays under a safe daily limit']],
  ]
  cols.forEach(([head, color, items], i) => {
    const x = 0.5 + i * 3.07
    card(s, x, 1.2, 2.87, 2.95, `${head} card`)
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.25, y: 1.4, w: 0.3, h: 0.3, fill: { color }, line: { type: 'none' }, objectName: `${head} dot` })
    txt(s, head, { x: x + 0.65, y: 1.37, w: 2.1, h: 0.36, fontSize: 18, bold: true, color: C.text2, valign: 'middle' })
    s.addText(items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { isTextBox: true, x: x + 0.22, y: 1.88, w: 2.5, h: 2.2, margin: 0, fontSize: 14, color: C.text1, valign: 'top', paraSpaceAfter: 5 })
  })
  txt(s, '135 %', { x: 0.5, y: 4.3, w: 2.0, h: 0.75, fontSize: 44, bold: true, color: C.accent4, valign: 'middle' })
  txt(s, 'of the safe daily limit: what our pilot community pumps today, without coordination (simulated: 18,666 m³/day against 13,800).', { x: 2.6, y: 4.3, w: 6.9, h: 0.75, fontSize: 14, color: C.text1, valign: 'middle' })
  s.addNotes('Problem, approach, objective. Souk Lahad lives on date palms and on the Complexe Terminal aquifer. Water turns are still fixed and written on paper; they do not follow the weather or the crop. Private wells, many unrecorded, pump on top. In our simulated pilot community that adds up to 135 % of what the aquifer can safely give in a day. Our objective is simple to state: the right water for each farm, and the total under the limit.')
}

// ---------------------------------------------------------------- 3. Study of the existing
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Problem' })
  s.addText('What exists today covers one piece each', { placeholder: 'title' })
  const head = ['', 'Paper nouba', 'Meters and telemetry', 'Irrigation advice apps', 'TWIZA']
  const rows = [
    ['Says who irrigates when', 'Yes', 'No', 'No', 'Yes'],
    ['Sizes water to crop need and weather', 'No', 'No', 'Yes', 'Yes'],
    ['Keeps pumping under an aquifer limit', 'No', 'Measures only', 'No', 'Yes'],
    ['Re-plans when a canal or well fails', 'No', 'No', 'No', 'Yes'],
    ['Works with low literacy (icons, voice)', 'Yes', 'No', 'Rarely', 'Yes'],
    ['Safe for owners of unrecorded wells', 'n/a', 'No', 'n/a', 'Yes'],
  ]
  const tone = v => (v === 'Yes' ? T.accent5 : v === 'No' ? T.accent4 : T.accent6)
  const table = [
    head.map((h, i) => ({ text: h, options: { bold: true, fontSize: 13, color: T.lt1, fill: { color: i === 4 ? T.accent1 : T.dk2 }, align: i ? 'center' : 'left', valign: 'middle' } })),
    ...rows.map(r => r.map((v, i) => ({ text: v, options: { fontSize: i ? 13 : 14, bold: i > 0, color: i ? tone(v) : T.dk1, fill: { color: i === 4 ? T.lt2 : T.lt1 }, align: i ? 'center' : 'left', valign: 'middle' } }))),
  ]
  s.addTable(table, { x: 0.5, y: 1.2, w: 9, colW: [3.9, 1.2, 1.35, 1.35, 1.2], rowH: 0.45, border: { type: 'solid', pt: 0.75, color: 'DEDBD4' }, margin: 0.06, objectName: 'Comparison of existing approaches' })
  txt(s, 'Qualitative comparison by the team from the field brief, not a market survey.', { x: 0.5, y: 4.8, w: 9, h: 0.3, fontSize: 11, italic: true, color: C.accent6 })
  s.addNotes('Study of the existing. Three families of answers exist. The traditional paper nouba organises who goes when, and everybody understands it, but it ignores need and the aquifer. Meters and telemetry measure pumping but do not organise anything, and nobody with an unrecorded well will accept one. Irrigation advice apps compute crop need for one farmer, not for a community sharing one canal. TWIZA is the combination: the turn, the need, the limit, and a design people with an unrecorded well can trust. This table is our own qualitative reading.')
}

// ---------------------------------------------------------------- 4. How it works
pres.addSection({ title: 'Solution' })
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Solution' })
  s.addText('From satellite to a turn on a phone', { placeholder: 'title' })
  const steps = [
    ['Sense', 'Sentinel-2 imagery, well and jebia sensors, Open-Meteo forecast'],
    ['Plan', 'Crop need, salinity, canal losses, storage, aquifer limit'],
    ['Tell', 'Each farmer sees or hears the turn; SMS for simple phones'],
    ['Adapt', 'A report, a swap or a heat wave re-plans in seconds'],
  ]
  steps.forEach(([h, d], i) => {
    const x = 0.5 + i * 2.3
    card(s, x, 1.3, 2.05, 1.95, `${h} step`)
    badge(s, i + 1, x + 0.2, 1.48)
    txt(s, h, { x: x + 0.75, y: 1.48, w: 1.2, h: 0.42, fontSize: 18, bold: true, color: C.text2, valign: 'middle' })
    txt(s, d, { x: x + 0.2, y: 2.05, w: 1.7, h: 1.1, fontSize: 14, valign: 'top' })
    if (i < 3) s.addShape(pres.ShapeType.rightArrow, { x: x + 2.07, y: 2.13, w: 0.21, h: 0.28, fill: { color: C.accent1 }, line: { type: 'none' }, objectName: `Arrow ${i + 1}` })
  })
  card(s, 0.5, 3.5, 4.4, 1.45, 'Formula card', C.text2)
  txt(s, 'need = Kc × ET0 × area ÷ efficiency', { x: 0.75, y: 3.62, w: 3.9, h: 0.5, fontSize: 16, bold: true, color: C.background1, valign: 'middle' })
  txt(s, 'FAO-56 crop need, plus a leaching share when the water is salty. Deterministic and unit-tested.', { x: 0.75, y: 4.12, w: 3.9, h: 0.72, fontSize: 14, color: C.background2, valign: 'top' })
  card(s, 5.1, 3.5, 4.4, 1.45, 'Rules card')
  s.addText([
    { text: 'Palms first, then the shortage is shared evenly', options: { bullet: true, breakLine: true } },
    { text: 'The aquifer limit is never exceeded', options: { bullet: true, breakLine: true } },
    { text: 'The AI assistant can only propose; the planner decides', options: { bullet: true } },
  ], { isTextBox: true, x: 5.35, y: 3.62, w: 3.95, h: 1.22, margin: 0, fontSize: 14, color: C.text1, valign: 'middle', paraSpaceAfter: 4 })
  s.addNotes('The approach in four verbs. Sense: a real Sentinel-2 scene, sensors on wells and basins, and the weather forecast. Plan: a deterministic planner, not a language model, computes each plot\'s need with the FAO-56 method and fits all turns inside the hydraulics and the aquifer limit. Tell: the farmer sees it, hears it, or gets an SMS. Adapt: any event re-plans the rest of the day without touching what already happened. The community rule is coded in: palms must survive, then everyone shares the shortage equally.')
}

// ---------------------------------------------------------------- 5. Solution breakdown
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Solution' })
  s.addText('Four parts, one water plan', { placeholder: 'title' })
  const parts = [
    ['Farmer app', C.accent5, 'Mobile PWA in Tunisian Arabic, right to left, French toggle. Big icons, colour codes, a listen button.'],
    ['Community dashboard', C.accent3, 'For the GDA committee: map of wells, jebias and seguias, Gantt of turns, aquifer gauge, alerts, KPIs.'],
    ['Water planner and AI', C.accent1, 'Deterministic planner, anomaly detection on sensors, advice rules, Claude assistant with read-only tools.'],
    ['Satellite pipeline', C.text1, 'Sentinel-2 NDVI finds irrigated land, estimates water use and aggregates it on hexagons.'],
  ]
  parts.forEach(([h, color, d], i) => {
    const x = 0.5 + (i % 2) * 4.6
    const y = 1.25 + Math.floor(i / 2) * 1.9
    card(s, x, y, 4.4, 1.7, `${h} card`)
    badge(s, i + 1, x + 0.25, y + 0.22, color)
    txt(s, h, { x: x + 0.85, y: y + 0.22, w: 3.3, h: 0.42, fontSize: 18, bold: true, color: C.text2, valign: 'middle' })
    txt(s, d, { x: x + 0.25, y: y + 0.78, w: 3.95, h: 0.82, fontSize: 14, valign: 'top' })
  })
  s.addNotes('The solution breakdown. Two interfaces for two audiences: a phone app for farmers who may not read much, and a desktop dashboard for the water committee. Behind them, the planner that produces the schedule and explains every choice, and a Python pipeline on real Sentinel-2 images. All four are built and running in the prototype.')
}

// ---------------------------------------------------------------- 6. Core features (farmer app)
pres.addSection({ title: 'Demo' })
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Demo' })
  s.addText('The farmer app: one screen, very few words', { placeholder: 'title' })
  phone(s, 'phone-flow.gif', 0.75, 1.3, 3.72, 'Animated walk through the farmer app: today, report, seguia closed, swap, advice')
  const feats = [
    ['My turn today', 'Green, grey or red, with a countdown and the m³ I will get'],
    ['Listen', 'The message is read aloud in Arabic'],
    ['Swap my turn', 'Ask a neighbour; the schedule updates for everyone'],
    ['Report a problem', 'One tap and an optional photo triggers a re-plan'],
    ['Advice of the day', 'Heat, salinity or rain, in short derja sentences'],
    ['My well and SMS', 'Sensor health for owners; an SMS for simple phones'],
  ]
  feats.forEach(([h, d], i) => {
    const x = 3.1 + (i % 2) * 3.25
    const y = 1.3 + Math.floor(i / 2) * 1.26
    badge(s, i + 1, x, y + 0.02)
    txt(s, h, { x: x + 0.55, y, w: 2.55, h: 0.42, fontSize: 16, bold: true, color: C.text2, valign: 'middle' })
    txt(s, d, { x: x + 0.55, y: y + 0.44, w: 2.55, h: 0.72, fontSize: 14, valign: 'top' })
  })
  s.addNotes('DEMO, phone. The animation on the left loops through the real screens. Live: open as Mohamed. "Not your turn today", his turn is tomorrow 04:00 to 06:30 on Jebia 2, and his neighbour Ali is irrigating now. Tap listen. Then report "no water": the screen turns red, the canal is closed for a check. Then ask Salah to swap; Salah accepts and Mohamed irrigates today.')
}

// ---------------------------------------------------------------- 7. Dashboard demo
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Demo' })
  s.addText('Before and after, on the 3D map', { placeholder: 'title' })
  s.addImage({ path: A('slider.gif'), x: 0.5, y: 1.2, w: 6.2, h: 3.49, altText: 'Animated 3D map: before TWIZA every well pumps on its own and the head of the canal takes the water; after, wells have joined and turns follow each other', objectName: 'Before and after animation' })
  const rows = [
    ['Before', C.accent1, '135 %', 'of the safe limit. Every well pumps alone; the head of the canal takes the water.'],
    ['With TWIZA', C.accent5, '94 %', 'at 70 % of wells joined. Each column is a well: it shrinks when the well joins.'],
  ]
  rows.forEach(([k, color, n, d], i) => {
    const y = 1.2 + i * 1.82
    card(s, 6.95, y, 2.55, 1.67, `${k} card`)
    txt(s, k, { x: 7.12, y: y + 0.1, w: 2.25, h: 0.3, fontSize: 14, bold: true, color: C.text2 })
    txt(s, n, { x: 7.12, y: y + 0.38, w: 2.25, h: 0.52, fontSize: 30, bold: true, color, valign: 'middle' })
    txt(s, d, { x: 7.12, y: y + 0.92, w: 2.25, h: 0.7, fontSize: 12, valign: 'top' })
  })
  txt(s, 'Full video: video/TWIZA-before-after.mp4 (39 s)', { x: 0.5, y: 4.78, w: 6.2, h: 0.3, fontSize: 11, italic: true, color: C.accent6 })
  s.addNotes('DEMO, dashboard. Open the map in full screen and 3D. Each column is a well, as tall as what it pumps. Before: 18,666 m³ a day, 135 % of the safe limit, and on the canals the head takes the water while the tail waits. Move the slider "share of wells that joined TWIZA" to 70 %: wells turn green, columns shrink, pumping drops to 12,936 m³, under the 13,800 limit, and the red stress zone cools. Then press "Replay the day": water moves from plot to plot in the numbered order. Unrecorded wells are not shown by default; the community can choose to show them. Then show the reactive alert from Mohamed\'s report with the decision the system took.')
}

// ---------------------------------------------------------------- 8. Results
pres.addSection({ title: 'Results' })
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Results' })
  s.addText('What the pilot simulation shows', { placeholder: 'title' })
  const labels = ['Without TWIZA', '35 % joined', '70 % joined', '100 % joined']
  const axis = { catAxisLabelColor: T.accent6, valAxisLabelColor: T.accent6, catAxisLabelFontSize: 11, valAxisLabelFontSize: 11, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt' }
  s.addChart(
    [
      { type: pres.charts.BAR, data: [{ name: 'Community pumping (m³/day)', labels, values: [18666, 14566, 12936, 12082] }], options: { barDir: 'col', barGapWidthPct: 60, chartColors: [T.accent3], showValue: true, dataLabelPosition: 'inEnd', dataLabelColor: T.lt1, dataLabelFontSize: 11, dataLabelFontFace: '+mn-lt', dataLabelFormatCode: '#,##0' } },
      { type: pres.charts.LINE, data: [{ name: 'Safe daily limit (13,800)', labels, values: [13800, 13800, 13800, 13800] }], options: { chartColors: [T.accent4], lineSize: 2, lineDataSymbol: 'none', showValue: false } },
    ],
    { x: 0.5, y: 1.2, w: 5.4, h: 3.75, showTitle: true, title: 'Pumping by share of wells in TWIZA', titleFontSize: 13, titleColor: T.dk2, titleFontFace: '+mn-lt', showLegend: true, legendPos: 'b', legendFontSize: 11, legendColor: T.accent6, legendFontFace: '+mn-lt', valAxisMinVal: 0, valAxisMaxVal: 20000, valAxisMajorUnit: 5000, valAxisLabelFormatCode: '#,##0', valGridLine: { color: 'DEDBD4', size: 0.75 }, catGridLine: { style: 'none' }, ...axis, objectName: 'Pumping versus safe limit chart' },
  )
  const stats = [
    ['+35 % → −6 %', C.accent1, 'over, then under the safe limit (70 % of wells joined)'],
    ['−17 % water', C.accent3, 'same crop coverage (95 %) as a fixed nouba, same week'],
    ['1.1 MWh/day', C.accent5, 'pumping energy avoided; worst-off farmer 71 % vs 60 %'],
  ]
  stats.forEach(([n, color, d], i) => {
    const y = 1.2 + i * 1.27
    card(s, 6.15, y, 3.35, 1.1, `Stat ${i + 1}`)
    txt(s, n, { x: 6.35, y: y + 0.08, w: 3.0, h: 0.55, fontSize: 30, bold: true, color, valign: 'middle' })
    txt(s, d, { x: 6.35, y: y + 0.62, w: 3.0, h: 0.42, fontSize: 12, valign: 'top' })
  })
  s.addNotes('The numbers come from the prototype on a synthetic community of 40 farmers, 63 plots, 17 wells, with real July 2026 weather. Two limits: 13,800 m³/day is the safe limit for the whole community; inside it the collective network has its own cap of 10,800, which the planner never exceeds. Without coordination: 18,666 m³ a day, 35 % over the limit. With 70 % of wells in TWIZA: 12,936, 6 % under. IF ASKED "you chose the baseline": we tested it. With a much milder baseline (collective turns at 1.15 times need, private wells 8 hours a day) the community is still 10 % over the limit today and the saving is 19 % instead of 31 %. Crops: we replayed the same week, power cut included, under a fixed paper nouba. Coverage is the same, 95 %, but TWIZA releases 17 % less water, and the worst-off farmer gets 71 % of need instead of 60 % (Jain fairness index 0.990 vs 0.986). Energy: about 0.19 kWh per cubic metre, so roughly 1.1 MWh a day and 130 MWh over a summer taken off the grid. These are simulation results, not field measurements.')
}

// ---------------------------------------------------------------- 9. Privacy and regularization
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Results' })
  s.addText('Privacy first, with a path to regularization', { placeholder: 'title' })
  const pts = [
    ['Never a pin on a well', 'Unrecorded abstraction appears only as hexagons of about 0.7 km²; small ones are masked'],
    ['Your data stays yours', 'The committee sees totals. A test suite checks that no endpoint leaks an unrecorded well'],
    ['A way out of illegality', 'Checklist in the app: documents, flat 3,500 TND fee, deadline 31 Dec 2027'],
  ]
  pts.forEach(([h, d], i) => {
    const y = 1.25 + i * 1.02
    badge(s, i + 1, 0.5, y + 0.02)
    txt(s, h, { x: 1.1, y, w: 5.3, h: 0.4, fontSize: 16, bold: true, color: C.text2, valign: 'middle' })
    txt(s, d, { x: 1.1, y: y + 0.4, w: 5.3, h: 0.55, fontSize: 14, valign: 'top' })
  })
  card(s, 0.5, 4.3, 5.9, 0.72, 'Satellite stat card')
  txt(s, '1,231 ha', { x: 0.7, y: 4.3, w: 1.75, h: 0.72, fontSize: 24, bold: true, color: C.accent1, valign: 'middle' })
  txt(s, 'of irrigated land detected on a real Sentinel-2 scene of Souk Lahad (6 July 2026)', { x: 2.45, y: 4.3, w: 3.8, h: 0.72, fontSize: 12, valign: 'middle' })
  phone(s, 'phone-reg.png', 7.2, 1.2, 3.75, 'Regularization helper screen in Tunisian Arabic')
  s.addNotes('Why would a farmer with an unrecorded well install this? Because TWIZA never shows an individual unrecorded well, anywhere. The satellite sees irrigated land, not wells, and we publish it only aggregated. And the app shows the way out: under the law of 27 October 2026, as described in our brief, wells dug before 10 December 2024 can be regularized for a flat 3,500 dinars until the end of 2027; the implementing rules are still pending and the app says so. The 1,231 hectares is a real measurement from real imagery; the water estimate on top of it uses assumed crop coefficients.')
}

// ---------------------------------------------------------------- 10. Next steps
pres.addSection({ title: 'Next' })
{
  const s = pres.addSlide({ masterName: 'DARK_TOP', sectionTitle: 'Next' })
  s.addText('Next: one real GDA, one season', { placeholder: 'title' })
  const steps = [
    ['Pilot', 'Run by one GDA in Souk Lahad, with the CRDA as technical partner: real plots, metered boreholes'],
    ['Reach', 'SMS gateway and Arabic voice so farmers without a smartphone get their turn'],
    ['Calibrate', 'Set the safe limit with hydrogeologists; replace assumed crop values with field data'],
  ]
  steps.forEach(([h, d], i) => {
    const x = 0.6 + i * 3.0
    card(s, x, 1.6, 2.8, 2.15, `${h} card`, C.accent6)
    badge(s, i + 1, x + 0.22, 1.8, C.accent1)
    txt(s, h, { x: x + 0.78, y: 1.8, w: 1.85, h: 0.42, fontSize: 18, bold: true, color: C.background1, valign: 'middle' })
    txt(s, d, { x: x + 0.22, y: 2.38, w: 2.4, h: 1.25, fontSize: 14, color: C.background1, valign: 'top' })
  })
  txt(s, 'Today: a working prototype. Planner, both apps and the satellite pipeline run end to end; community data is synthetic, weather and imagery are real.', { x: 0.6, y: 4.05, w: 8.8, h: 0.6, fontSize: 14, color: C.background2, valign: 'top' })
  txt(s, [{ text: 'شكرا', options: { lang: 'ar-TN', color: C.accent2, bold: true } }, { text: '  ·  Thank you' }], { x: 0.6, y: 4.75, w: 8.8, h: 0.45, fontSize: 20, color: C.background1, valign: 'middle' })
  s.addNotes('What we ask for: one real community for one irrigation season. The prototype is honest about what it is: everything runs, but the farmers, wells and sensors are generated. Three steps make it real: a pilot GDA with meters on its boreholes, an SMS and voice channel, and a safe limit set by hydrogeologists instead of by us. Thank you.')
}

;(async () => {
  const out = path.join(__dirname, 'TWIZA-pitch.pptx')
  await pres.writeFile({ fileName: out })
  await applyTheme(out, THEME)
  console.log('written', out)
})()
