# TWIZA — تويزة

A community water app for the oasis of **Souk Lahad** (Kebili, southern Tunisia), built for the KIZUNA 2026 hackathon.

*Twiza* (تويزة) is the collective effort of Tunisian villages: people gather to help each other harvest the crop, build a house, clean the canals. TWIZA applies the same idea to water.

TWIZA groups the farmers of one community (GDA), decides who irrigates when (the *nouba* / *tour d'eau*), gives each plot the water its crops need, and keeps total pumping under a safe daily limit for the Complexe Terminal aquifer. It is privacy-first: an unrecorded well is never shown individually, and the app offers a path to regularization.

> **All data is synthetic**, except the weather (Open-Meteo, Kebili, summer 2026) and the satellite imagery (Sentinel-2 L2A). The footer of both apps says so.

| Part | Where | What |
|---|---|---|
| Farmer app | `app/` → `/farmer` | Mobile-first PWA, Tunisian Arabic (derja, RTL) with a French toggle, big icons, a "listen" button |
| Community dashboard | `app/` → `/` | Dark desktop dashboard, French with an English toggle: map, Gantt, aquifer gauge, alerts, KPIs, scenario slider, assistant |
| API + planner | `server/` | Express, in-memory state, deterministic water planner, anomaly detection, advice rules, Claude proxy |
| Satellite pipeline | `satellite/` | Python: Sentinel-2 → NDVI → irrigated areas → water use → H3 hexagons |
| Synthetic data | `data/` | Seeded generator + CSV / JSON / GeoJSON |

## Run it

Requirements: Node ≥ 20 (built with 24). Python is only needed to re-run the satellite pipeline; its outputs are already in the repo.

```bash
npm install
cp .env.example .env      # optional: add ANTHROPIC_API_KEY
npm run dev               # API on :8787 + app on :5173
```

- Dashboard: <http://localhost:5173/>
- Farmer app: <http://localhost:5173/farmer> (add `?f=f03` to open as another farmer; the dashboard's "App agriculteur" button shows it in a phone frame next to the map)
- On a phone on the same Wi-Fi: `http://<laptop-ip>:5173/farmer`

Other commands:

```bash
npm test                  # planner, anomaly detector, privacy (21 tests)
npm run gen               # regenerate the synthetic data (seeded, deterministic)
npm run build             # production build of the app (PWA, service worker)
npm start                 # build, then serve app + API from one port (:8787)
npm run satellite         # re-run the satellite pipeline (see satellite/README.md)
```

### `.env`

| Variable | Default | Use |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Enables the Claude assistant and the advice rewriter. Empty = templated answers, the demo still works. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used for both |
| `PORT` | `8787` | API port |

### Satellite pipeline

```bash
cd satellite
uv venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python pipeline.py --hex-min-patches 3                   # real scene (network, ~15 s)
.venv/bin/python pipeline.py --skip-download --hex-min-patches 3   # offline, from cache/
.venv/bin/python pipeline.py --synthetic                           # synthetic fallback
```

It writes `sat_patches.geojson`, `sat_hex.geojson`, `ndvi.png` and `sat_meta.json` to `app/public/data/`. If the network or the STAC query fails it falls back to cached or synthetic areas in the same format. The shipped files come from scene `S2C_32SMC_20260706_0_L2A` (6 July 2026, 0.7 % cloud): 258 irrigated areas, 1,231 ha, about 177,000 m³/day. Method and limits: [`satellite/README.md`](satellite/README.md).

Re-run it with `--skip-download` after `npm run gen`, because the registry of recorded wells changes with the data.

## The demo, step by step

The app opens on **Tuesday 14 July 2026, 10:05** (a real-weather day; the clock then runs in real time). "Démo → Réinitialiser" brings everything back to that moment. The dashboard has a drawer with four sections: *Vue d'ensemble*, *Tours d'eau*, *Capteurs et équité*, *Assistant*.

1. **Vue d'ensemble.** Map of Souk Lahad on the Sentinel-2 basemap, irrigated areas outlined. The aquifer gauge reads **135 % of the safe limit "Sans TWIZA"**. Use "Plein écran" and "3D" on the map to showcase it: each well becomes a column as tall as what it pumps.
2. **Slider to 70 %** (on the gauge, or in the "Effet sur la nappe" panel on the map). Pumping drops to 94 % of the limit, wells turn green as they join, the stress map cools.
3. **Rejouer la journée** (bar above the map): the water moves from plot to plot in the numbered order; the strip Forages → Jebias → Seguias → Parcelles → Nappe follows.
4. **Phone as Mohamed** ("App agriculteur"). "اليوم موش نوبتك", his turn tomorrow 04:00–06:30 on Jebia 2, neighbour Ali irrigating now. Tap **اسمع**.
5. **Mohamed reports "no water"** (بلّغ → ما فمّاش ماء → ابعث). Reactive alert with the decision, Seguia 2 closes for 60 min, Ali's and Salah's turns shift (see *Tours d'eau*), Mohamed's screen turns red.
6. **Swap.** Mohamed: بدّل → Salah → اطلب. Pick Salah in the phone frame, accept. Mohamed now irrigates today, Salah takes tomorrow 04:00.
7. **Démo → Vague de chaleur.** Proactive alert; tomorrow's turns lengthen, palms at 100 %, understory at 65 %, pumping stays at the cap. The advice tab (نصيحة) shows it in derja.
8. **Assistant** section. "Chkoun ma chrebch el jem3a hedhi?" → 12 farmers with percentages and m³, and the cause.
9. **Regularization.** Open a farmer with a private well (5 quick taps on the logo, e.g. Fatma) → أكثر → تسوية البير.

A headless run of this script passes all its checks; screenshots are in [`screenshots/`](screenshots/). Other deliverables: pitch deck [`pitch/TWIZA-pitch.pptx`](pitch/TWIZA-pitch.pptx), report [`report/TWIZA-report.pdf`](report/TWIZA-report.pdf), before/after video [`video/TWIZA-before-after.mp4`](video/TWIZA-before-after.mp4).

## Results, and how much they depend on our assumptions

`npx tsx data/baseline.ts` reproduces these numbers (synthetic pilot community, real July 2026 weather).

- **Aquifer.** Without coordination the community pumps 18,666 m³/day, 35 % over the safe limit (13,800). With 70 % of the wells in TWIZA: 12,936 m³/day, 6 % under.
- **Two limits.** 13,800 m³/day is the safe limit for the whole community. Inside it the collective network has its own cap of 10,800 m³/day, the only part the planner controls; it never exceeds it.
- **Sensitivity.** The 31 % saving assumes today's collective turns deliver 1.3 × the need and private wells pump 12 h/day. With 1.15 × and 8 h/day the community is still 10 % over the limit today and the saving is 19 %. With turns already exact (1.0 ×) and 8 h/day it is 10 %.
- **Crops, against a fixed paper nouba** (same week, power cut on both boreholes included; fixed clock slots sized at 1.3 × need, no re-planning): crop need covered 95.2 % (nouba) vs 95.0 % (TWIZA), with 17 % less water released; Jain fairness index 0.986 vs 0.990; worst-off farmer 60 % vs 71 % of need.
- **Energy.** About 0.19 kWh/m³ (assumed lift 35 m, efficiency 50 %): the 5,730 m³/day avoided at 70 % adoption are about 1.1 MWh/day, 130 MWh over a 120-day summer.

Japan has the same tradition: farmer-run Land Improvement Districts (土地改良区) share canal water, by rotation in dry years (番水). *Twiza* and *kizuna* (絆) name the same idea.

## How it works

### Water planner (`server/src/planner.ts`) — deterministic, not an LLM

- **Need (FAO-56):** `Kc × ET0 × area ÷ efficiency`, per plot, palms and understory separately. A turn covers the next 3 days (rotation), using the forecast ET0 of each day.
- **Salinity (FAO-29):** leaching requirement `LR = ECw / (5·ECe − ECw)`, need divided by `(1 − LR)`.
- **Hydraulics:** borehole flow, jebia storage (never below 0, never above capacity), seguia capacity (one turn at a time), seepage per km (concrete main, earth branches), travel time.
- **Aquifer limit:** the collective network never pumps more than its daily cap.
- **Priority:** one service level for everybody — palms first, then the understory; a shortage is spread evenly.
- **Output:** start/end, volumes and a written reason for every turn.
- **Re-plan:** `planDay()` is a pure function of (network, weather, events). A report, a sensor event, a swap or a forecast change is one more event; an event only acts from its own timestamp, so what already happened never changes. Every re-plan is diffed and logged.

Values (Kc, ECe, efficiency, limits) are in [`server/src/config.ts`](server/src/config.ts).

### Other pieces

- **Anomaly detection** (`anomaly.ts`): rolling z-score, lasting step (a well that drops), least-squares trend (rising salinity), mass balance (water enters a jebia but the level does not follow = leak). The three events planted in the sensor data are found, and nothing else.
- **Advice** (`state.ts`): rules produce structured advice (what, why, number) with a derja and a French template. With an API key, Claude rewrites the wording; a rewrite that drops or changes a number is rejected.
- **Assistant** (`assistant.ts`): Claude Messages API with read-only tools (schedule, weekly deficits, wells, alerts, KPIs, farmer, re-plan log). Its only write tool records a *proposal* for the committee; the planner decides. Without a key, keyword templates answer the common questions in French, English, derja (Latin or Arabic script).
- **Scenario slider** (`scenario.ts`): wells join in a fixed order (GDA boreholes, recorded private wells, then the others). A joined well pumps the crop need; a well outside TWIZA pumps the traditional volume.

### Unrecorded wells: private by default

- **Default (strict):** the server never sends an unrecorded well, its plot, its coordinates or its name to the dashboard. They exist only as counts, totals and hexagon aggregates. `server/test/privacy.test.ts` checks every community endpoint and the assistant tools for it.
- **Option the community can choose:** the "Puits non déclarés" switch on the map (`POST /api/demo/unrecorded`) makes the server send them; they then appear in red and turn green when they join. "Réinitialiser" switches it back off.
- The satellite output is aggregated on H3 hexagons (small ones masked), the stress map spreads unrecorded pumping over its hexagon, and a farmer sees the sensors of their own well without any location.
- The before/after video was recorded with the option on, to tell the story of those wells joining.

## Hypothèses

Simplifications and assumptions. None of these numbers is a measurement.

**Community and network**
- Farmers, plots, wells, jebias, seguias, sensors, reports and swaps are generated (`data/generate.ts`, seed 20261122). The layout is drawn on a real palm grove 2 km west of the town (the densest block found by the satellite pipeline); it is not the real network.
- 40 farmers, 63 plots (48 inside the collective perimeter, 15 "extensions" each fed by its own private well), 2 GDA boreholes, 15 private wells (6 recorded, 9 unrecorded), 4 jebias, 4 main seguias with 2 earth branches each.
- Boreholes feed all jebias through a shared main pipe; pipe capacity is not limiting.
- Jebias start each day at 60 % of capacity; one turn at a time per main seguia; a turn takes the full flow (60 l/s).
- Seepage: 10 %/km in concrete, 40 %/km in earth canals. Water speed 0.45 m/s.

**Agronomy**
- Kc: date palm 0.95, vegetables 1.05, alfalfa 0.95 (FAO-56 mid-season values). Understory ET reduced by 0.6 for shade. Application efficiency 0.7.
- ECe thresholds are the FAO-29 values for about 90 % yield (palm 6.8, vegetables 3.5, alfalfa 3.4 dS/m). Leaching is capped at 30 % and added on top of the efficiency loss, which is conservative.
- Rotation of 3 days. Real rotations in the Nefzaoua are often much longer.
- The "forecast" is the Open-Meteo archive for summer 2026; heat wave (+20 % ET0 for 3 days) and rain (×0.6) are injected from the demo menu.

**Aquifer**
- Safe limit 13,800 m³/day for the community and 10,800 m³/day for the collective network: chosen so the scenario tells a clear story. A real limit needs a hydrogeological study.
- Outside TWIZA: collective turns deliver 1.3 × the need, a private well pumps 12 h/day. Both are assumptions.
- The stress map is an index (log-distance drawdown kernel + inverse-distance salinity), not a groundwater model.

**Satellite**
- NDVI shows vegetation, not wells or flows. Every 10 m pixel above NDVI 0.30 counts as full-canopy palm; natural vegetation counts as irrigated. One date (6 July 2026).
- The registry of recorded wells is synthetic and covers only the pilot, so the rest of the oasis shows as "no recorded well within 400 m". That is an artefact of the registry, not a finding. The 400 m radius is arbitrary.
- Areas are image segments, not cadastral plots. A hexagon that is entirely "unrecorded" still says something about every area inside it; masking small hexagons reduces this, it does not remove it.

**Product**
- No login: the farmer picker is a demo control. In production a farmer must authenticate before seeing "My well".
- No SMS is sent; the SMS screen is a preview. No payment.
- A report acts immediately (seguia closed 60 min for "no water", 180 min for "broken", +15 % loss for a leak). In production the water guard would confirm first.
- The regularization text (law of 27 Oct 2026, wells dug before 10 Dec 2024, flat 3,500 TND, deadline 31 Dec 2027, implementing rules pending) is taken from the project brief and is not legal advice.
- The "listen" button uses the phone's own speech voices; a device without an Arabic voice may stay silent.
- State is in memory: restarting the server resets the demo.

## Not verified

- The Claude path (assistant tool loop and advice rewriting) compiles against `@anthropic-ai/sdk` but was not run: no API key was available during the build. The no-key templates are what the demo script exercises.
- The EOX satellite tiles and OpenStreetMap tiles need internet; the app falls back to OpenStreetMap if the satellite tiles fail, and the map is blank offline.

## Repository

```
app/         Vite + React + TypeScript + Tailwind, MapLibre GL, Recharts, vite-plugin-pwa
server/      Express API, planner, anomaly detection, scenario, assistant; vitest tests
satellite/   pipeline.py (pystac-client, rasterio, h3) + README
data/        generate.ts, weather.json (Open-Meteo), generated CSV / JSON / GeoJSON
screenshots/ the demo script, step by step
```
