// TWIZA — LLM layer (Claude API). Two uses, both optional:
//   1. dashboard assistant: Claude answers with READ-ONLY tools over the live data;
//   2. advice: Claude rephrases the structured advice in friendly derja / French.
// Without ANTHROPIC_API_KEY everything falls back to templates, so the demo never breaks.
// The LLM can never change the schedule: its only write tool records a proposal
// that the committee reviews and the planner re-checks.

import Anthropic from '@anthropic-ai/sdk'
import { CONFIG } from './config.js'
import { addProposal, adviceSignature, hasPolished, setPolished, tools as data, type Advice } from './state.js'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'
export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY
let client: Anthropic | null = null
const api = () => (client ??= new Anthropic())

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_schedule',
    description: 'Turn schedule (tours d\'eau / nouba) of one day: who irrigates when on which seguia, volumes, share of need met, and the planner\'s reason for each turn. Defaults to today.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, optional' }, seguia: { type: 'string', description: 'e.g. "Seguia 2", optional' } } },
  },
  {
    name: 'get_weekly_deficits',
    description: 'Farmers who received less water than their crop need over the last 7 days, with need, received volume, percentage, and the incidents that caused it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_wells',
    description: 'Recorded wells (GDA boreholes and declared private wells) with flow, salinity (EC) and level. Unrecorded wells are only available as a count: they are never located or named.',
    input_schema: { type: 'object', properties: {} },
  },
  { name: 'get_alerts', description: 'Latest proactive and reactive alerts with the decision the system took.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_kpis', description: 'Community KPIs: water delivered vs need, fairness index, seguia losses, pumping vs the safe aquifer limit, scenario table (share of wells that joined TWIZA).', input_schema: { type: 'object', properties: {} } },
  { name: 'get_farmer', description: 'One farmer: plots, next turn, water received this week.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'get_replan_log', description: 'What the planner changed recently and why.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'propose_change',
    description: 'Record a proposal for the water committee (for example a swap or an extra turn). This does NOT change the schedule: the committee reviews it and the planner checks it against the aquifer limit.',
    input_schema: { type: 'object', properties: { proposal: { type: 'string', description: 'The proposal, in French, one or two sentences.' } }, required: ['proposal'] },
  },
]

function runTool(name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case 'get_schedule': return data.schedule(input.date as string | undefined, input.seguia as string | undefined)
    case 'get_weekly_deficits': return data.weeklyDeficits()
    case 'get_wells': return data.wells()
    case 'get_alerts': return data.alerts()
    case 'get_kpis': return data.kpis()
    case 'get_farmer': return data.farmer(String(input.name ?? ''))
    case 'get_replan_log': return data.replanLog()
    case 'propose_change': {
      const p = addProposal(String(input.proposal ?? ''))
      return { recorded: true, id: p.id, note: 'Recorded for committee review. The schedule is unchanged.' }
    }
    default: return { error: `unknown tool ${name}` }
  }
}

const SYSTEM = `You are the assistant of TWIZA, the water-sharing app of a farmers' community (GDA) in the oasis of Souk Lahad, Kebili, Tunisia. You talk to members of the water committee on their dashboard.

The community shares water from two collective boreholes through jebias (storage basins) and seguias (canals), by turns (nouba / tour d'eau). A deterministic planner builds the schedule: FAO-56 crop need, leaching for salinity, palms served first, then any shortage spread evenly, total pumping kept under a safe daily limit for the aquifer (${CONFIG.collectiveCap} m³/day for the collective network, ${CONFIG.safeDailyLimit} m³/day for the whole community).

Answer from the tools, with names and numbers, never from guesses. Keep answers short: a sentence or two, then a compact list when there are several people or turns. Reply in the language the person used: French, English, or Tunisian derja (Arabic script if they wrote in Arabic script, Latin letters if they wrote derja in Latin letters such as "chkoun", "9addech", "wa9tech").

You can read everything but you cannot change the schedule. If someone asks for a change, record it with propose_change and say plainly that it is a proposal for the committee and that the planner will check it; never say a turn was moved.

Privacy is a core promise of the product: wells that are not recorded are known only as an aggregate. Never try to identify, locate or name the owner of an unrecorded well, and say why if asked.

All data is synthetic (hackathon demo), except the weather (Open-Meteo) and the satellite imagery (Sentinel-2).`

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export async function chat(message: string, history: ChatTurn[] = []): Promise<{ text: string; mode: 'llm' | 'template'; tools: string[] }> {
  if (!llmEnabled()) return { text: templated(message), mode: 'template', tools: [] }
  const used: string[] = []
  try {
    const messages: Anthropic.MessageParam[] = [...history.slice(-8).map(h => ({ role: h.role, content: h.content })), { role: 'user' as const, content: message }]
    for (let i = 0; i < 8; i++) {
      const response = await create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages })
      if (response.stop_reason === 'refusal') break
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content })
        continue
      }
      const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || !calls.length) {
        const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim()
        if (text) return { text, mode: 'llm', tools: used }
        break
      }
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = calls.map(c => {
        used.push(c.name)
        try {
          return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(runTool(c.name, (c.input ?? {}) as Record<string, unknown>)) }
        } catch (e) {
          return { type: 'tool_result', tool_use_id: c.id, content: String(e), is_error: true }
        }
      })
      messages.push({ role: 'user', content: results })
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error('[assistant] invalid ANTHROPIC_API_KEY, using templates')
    else if (error instanceof Anthropic.RateLimitError) console.error('[assistant] rate limited, using templates')
    else if (error instanceof Anthropic.APIError) console.error(`[assistant] API error ${error.status}: ${error.message}`)
    else console.error('[assistant]', error)
  }
  return { text: templated(message), mode: 'template', tools: used }
}

/** effort keeps the assistant quick; models that do not know the parameter get a plain request */
async function create(params: Anthropic.MessageCreateParamsNonStreaming) {
  try {
    return await api().messages.create({ ...params, output_config: { effort: 'low' } })
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError) return api().messages.create(params)
    throw error
  }
}

// ---------- advice: structured facts in, friendly derja + French out ----------
export async function polishAdvice(items: Advice[]) {
  if (!llmEnabled()) return
  const todo = items.filter(a => !a.llm && !hasPolished(adviceSignature(a)))
  if (!todo.length) return
  try {
    const response = await create({
      model: MODEL,
      max_tokens: 4000,
      system: `You rewrite irrigation advice for farmers of a Tunisian oasis, many of them older and with little schooling. For each item you get the structured facts and a draft in Tunisian derja (Arabic script) and in French. Rewrite both so they sound warm, short and natural (one sentence, under 18 words), keeping every number exactly as given and adding no new fact or number. Derja must be everyday Tunisian, not standard Arabic. Return only a JSON array, one object per item, in the same order: [{"ar": "...", "fr": "..."}].`,
      messages: [{ role: 'user', content: JSON.stringify(todo.map(a => ({ kind: a.key, facts: a.n, ar: a.ar, fr: a.fr }))) }],
    })
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
    const parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as { ar?: string; fr?: string }[]
    todo.forEach((a, i) => {
      const p = parsed[i]
      if (!p?.ar || !p?.fr) return
      // the rules own the numbers: reject a rewrite that dropped or changed one
      const nums = Object.values(a.n).filter(v => typeof v === 'number' && v !== 0).map(v => String(v))
      const keeps = (s: string) => nums.every(n => s.includes(n) || s.includes(n.replace('.', ',')))
      if (keeps(p.ar) && keeps(p.fr)) setPolished(adviceSignature(a), { ar: p.ar, fr: p.fr })
    })
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error(`[advice] API error ${error.status}: ${error.message}`)
    else console.error('[advice] rewrite skipped:', error instanceof Error ? error.message : error)
  }
}

// ---------- templated answers (no API key) ----------
type L = 'fr' | 'en' | 'ar' | 'tn'
function langOf(q: string): L {
  if (/[\u0600-\u06FF]/.test(q)) return 'ar'
  if (/\b(chkoun|chkun|ch[ck]oun|9add?e[ch]+|wa9te?ch|kifech|3la[ch]+|el ?jem3a|hedhi|chreb|nouba|noubt|lyoum|ghodwa|tawa|fama|famma|barcha|bir|el ?me)\b/i.test(q) || /\d[a-z]|[a-z]\d/i.test(q.replace(/m3|s\d|j\d|f\d/gi, ''))) return 'tn'
  if (/\b(who|what|when|how|which|why|the|is|are|less|week|water|wells?)\b/i.test(q)) return 'en'
  return 'fr'
}
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/\u202f/g, ' ')

export function templated(q: string): string {
  const l = langOf(q)
  const s = q.toLowerCase()
  const has = (re: RegExp) => re.test(s)

  // who got less than their need this week?
  if (has(/chkoun|chkun|شكون|ma ?chreb|ما ?شرب|moins que|pas (assez|bu|reçu)|manqu|déficit|deficit|less than|short of|na9es|ناقص/)) {
    const d = data.weeklyDeficits()
    const rows = d.below_need.slice(0, 8)
    const list = rows.map(r => `• ${r.farmer} — ${r.pct} % (${fmt(r.received_m3)} / ${fmt(r.need_m3)} m³, −${fmt(r.missing_m3)} m³)`).join('\n')
    const more = d.below_need.length > rows.length ? (l === 'en' ? `\n… and ${d.below_need.length - rows.length} more.` : l === 'fr' ? `\n… et ${d.below_need.length - rows.length} autres.` : `\n… w ${d.below_need.length - rows.length} okhrin.`) : ''
    const cause = d.causes[0] ?? ''
    if (!rows.length) return l === 'en' ? 'Nobody: every farmer who irrigated this week received at least 97 % of the crop need.' : l === 'fr' ? 'Personne : tous les agriculteurs servis cette semaine ont reçu au moins 97 % de leur besoin.' : l === 'ar' ? 'حتى واحد: الناس الكل خذات حقّها الجمعة هاذي.' : '7atta wa7ed: el nas el kol khdhet 7a9ha el jem3a hedhi.'
    if (l === 'en') return `This week (${d.period}), ${d.below_need.length} of ${d.farmers} farmers received less than their crop need:\n${list}${more}\nCause: ${cause}. The planner served the palms first and spread the shortage evenly.`
    if (l === 'fr') return `Cette semaine (${d.period}), ${d.below_need.length} agriculteurs sur ${d.farmers} ont reçu moins que leur besoin :\n${list}${more}\nCause : ${cause}. Le planificateur a servi les palmiers d'abord et réparti le manque également.`
    if (l === 'ar') return `الجمعة هاذي (${d.period})، ${d.below_need.length} فلاحة من ${d.farmers} ما خذاوش حقّهم كامل من الماء:\n${list}${more}\nالسبب: ${cause}. تويزة عطات النخل قبل، وقسمت النقص على الناس الكل.`
    return `El jem3a hedhi (${d.period}), ${d.below_need.length} fellah men ${d.farmers} ma chrebch 7a9ou kamel:\n${list}${more}\nEssbeb: ${cause}. TWIZA 3tat el nakhl 9bal, w 9asmet el na9s 3al nas el kol.`
  }
  // a request to change the schedule: the assistant may only propose
  if (has(/déplac|deplac|modifi|chang(e|er|ez) |avanc|recul|décal|annul|\bmove\b|\bswap\b|reschedul|baddel|badel|بدّل|بدل|قدّم|أخّر/)) {
    const p = addProposal(q.slice(0, 240))
    if (l === 'en') return `I cannot change the schedule. I recorded your request as proposal ${p.id} for the committee; if it is accepted, the planner will check it against the turns and the aquifer limit before anything moves.`
    if (l === 'fr') return `Je ne peux pas modifier le planning. J'ai enregistré votre demande comme proposition ${p.id} pour le comité ; si elle est acceptée, le planificateur la vérifiera (tours, plafond de la nappe) avant tout changement.`
    if (l === 'ar') return `ما نجّمش نبدّل النوبات وحدي. سجّلت طلبك كاقتراح للجنة، والمخطّط يثبّت فيه قبل أي تبديل.`
    return `Ma najjamch nbaddel el nouba wa7di. Sajjelt talbek ka e9tira7 lel lajna, w el planificateur ythabbet fih 9bal ay tabdil.`
  }
  // one farmer
  const who = data.findFarmer(q.split(/[\s؟?،,.!:;'’"()]+/).filter(Boolean))
  if (who) {
    const f = data.farmer(who) as any
    if (!f.error) {
      const t = f.next_turn
      const wk = f.week ? ` ${l === 'en' ? 'This week' : l === 'fr' ? 'Cette semaine' : l === 'ar' ? 'الجمعة هاذي' : 'El jem3a hedhi'}: ${f.week.pct} % (${fmt(f.week.got)} / ${fmt(f.week.need)} m³).` : ''
      if (!t) return `${f.farmer}: ${l === 'en' ? 'no turn in the next 3 days.' : l === 'fr' ? 'pas de tour dans les 3 prochains jours.' : l === 'ar' ? 'ما عندوش نوبة في 3 أيام الجايين.' : 'ma 3andouch nouba fel 3 ayam el jeyin.'}${wk}`
      if (l === 'en') return `${f.farmer}: next turn ${t.date} ${t.start}–${t.end}, ${fmt(t.volume_m3)} m³.${wk}\n${t.reason}`
      if (l === 'fr') return `${f.farmer} : prochain tour le ${t.date} de ${t.start} à ${t.end}, ${fmt(t.volume_m3)} m³.${wk}\n${t.reason}`
      if (l === 'ar') return `${f.farmer}: نوبتو ${t.date} من ${t.start} لـ ${t.end}، ${fmt(t.volume_m3)} م³.${wk}`
      return `${f.farmer}: noubtou ${t.date} men ${t.start} l ${t.end}, ${fmt(t.volume_m3)} m3.${wk}`
    }
  }
  // schedule
  if (has(/nouba|noubt|نوب|tour|planning|schedule|turn|wa9te?ch|وقتاش|quand|when|lyoum|اليوم|aujourd|irrigu|maintenant|\bnow\b|tawa|yes9i|يسقي|توّا/)) {
    const sc = data.schedule()
    const now = sc.turns.filter(t => t.state === 'active').map(t => `• ${t.seguia}: ${t.farmer} (${t.start}–${t.end}, ${fmt(t.volume_m3)} m³)`).join('\n')
    const next = sc.turns.filter(t => t.state === 'pending').slice(0, 5).map(t => `• ${t.start} ${t.seguia}: ${t.farmer}`).join('\n')
    if (l === 'en') return `Today ${sc.date}: ${sc.turns.length} turns, ${fmt(sc.pumped_m3)} m³ planned (limit ${fmt(sc.limit_m3)}).\nIrrigating now:\n${now || '• nobody'}\nNext:\n${next || '• none'}`
    if (l === 'fr') return `Aujourd'hui ${sc.date} : ${sc.turns.length} tours, ${fmt(sc.pumped_m3)} m³ prévus (plafond ${fmt(sc.limit_m3)}).\nEn cours :\n${now || '• personne'}\nEnsuite :\n${next || '• aucun'}`
    return `Lyoum ${sc.date}: ${sc.turns.length} nouba, ${fmt(sc.pumped_m3)} m3 (el 7ad ${fmt(sc.limit_m3)}).\nTawa yes9i:\n${now || '• 7atta wa7ed'}\nBa3d:\n${next || '• —'}`
  }
  // aquifer / pumping
  if (has(/nappe|pomp|limite|limit|aquif|9add?e|قداش|مائدة|plafond|pump/)) {
    const k = data.kpis()
    const s0 = k.scenario.find(r => r.share === 0)!
    const s70 = k.scenario.find(r => r.share === 70)!
    if (l === 'en') return `Collective network: ${fmt(k.pumpedNow)} m³ pumped so far, ${fmt(k.pumpedPlanned)} m³ planned today for a limit of ${fmt(k.cap)} m³.\nWhole community: ${fmt(s0.total)} m³/day without TWIZA (${s0.pct} % of the safe limit ${fmt(k.safe_limit_m3_day)}), ${fmt(s70.total)} m³/day if 70 % of the wells join (${s70.pct} %).`
    if (l === 'fr') return `Réseau collectif : ${fmt(k.pumpedNow)} m³ pompés à cette heure, ${fmt(k.pumpedPlanned)} m³ prévus aujourd'hui pour un plafond de ${fmt(k.cap)} m³.\nCommunauté entière : ${fmt(s0.total)} m³/j sans TWIZA (${s0.pct} % de la limite sûre ${fmt(k.safe_limit_m3_day)}), ${fmt(s70.total)} m³/j si 70 % des puits adhèrent (${s70.pct} %).`
    return `El réseau: ${fmt(k.pumpedNow)} m3 tawa, ${fmt(k.pumpedPlanned)} m3 lyoum (el 7ad ${fmt(k.cap)}).\nEl jma3a el kol: ${fmt(s0.total)} m3 fel nhar bla TWIZA (${s0.pct} %), w ${fmt(s70.total)} m3 ki 70 % mel abyar yodkhlou (${s70.pct} %).`
  }
  // wells / salinity
  if (has(/puits|forage|well|bir|بير|sel|salin|ملوح|\bec\b|niveau|level/)) {
    const w = data.wells()
    const list = w.recorded.map(x => `• ${x.name}: ${x.flow_ls} l/s, EC ${x.ec_ds_m} dS/m, ${x.level_m} m`).join('\n')
    if (l === 'en') return `Recorded wells:\n${list}\nUnrecorded wells: ${w.unrecorded.count}, known only as an aggregate — never located or named.`
    if (l === 'fr') return `Puits déclarés :\n${list}\nPuits non déclarés : ${w.unrecorded.count}, connus seulement en agrégat — jamais localisés ni nommés.`
    return `El abyar el msajlin:\n${list}\nAbyar mouch msajlin: ${w.unrecorded.count} — ma n9oulouch winhom w la mta3 chkoun.`
  }
  // alerts
  if (has(/alert|mochk|مشكل|problème|probleme|panne|incident|what happened|chnoua sar/)) {
    const a = data.alerts().slice(0, 4).map(x => `• ${x.when} — ${x.title}\n  → ${x.decision}`).join('\n')
    return (l === 'en' ? 'Latest alerts:\n' : l === 'fr' ? 'Dernières alertes :\n' : 'Ekher el mchekel:\n') + a
  }
  if (l === 'en') return 'I can answer about: today\'s turns, a farmer\'s next turn, who got less than their need this week, pumping vs the aquifer limit, wells and salinity, alerts. (Template mode: set ANTHROPIC_API_KEY for free-form questions.)'
  if (l === 'fr') return 'Je peux répondre sur : les tours du jour, le prochain tour d\'un agriculteur, qui a reçu moins que son besoin cette semaine, le pompage et la limite de la nappe, les puits et la salinité, les alertes. (Mode gabarit : ajoutez ANTHROPIC_API_KEY pour des questions libres.)'
  return 'Najem njawbek 3la: nouba lyoum, wa9tech noubet fellah, chkoun ma chrebch el jem3a hedhi, 9addech jbedna mel me, el abyar w el mlou7a, el mchekel.'
}
