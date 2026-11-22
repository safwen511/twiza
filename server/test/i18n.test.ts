import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { DICT } from '../../app/src/i18n'
import { F } from '../../app/src/farmer/strings'

const keys = (o: unknown, prefix = ''): string[] =>
  o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)]

describe('i18n is complete', () => {
  it('dashboard: French and English have exactly the same keys, none empty', () => {
    expect(Object.keys(DICT.en).sort()).toEqual(Object.keys(DICT.fr).sort())
    for (const lang of ['fr', 'en'] as const) for (const [k, v] of Object.entries(DICT[lang])) expect(v.trim(), `${lang}:${k}`).not.toBe('')
  })
  it('farmer app: Arabic and French have exactly the same keys', () => {
    expect(keys(F.fr).sort()).toEqual(keys(F.ar).sort())
  })
  it('farmer app: the Arabic wording is in Arabic script', () => {
    for (const k of ['notToday', 'today', 'now', 'listen', 'privacy', 'regLaw'] as const) expect(F.ar[k]).toMatch(/[؀-ۿ]/)
  })
  it('dashboard components contain no hard-coded sentence', () => {
    const dir = new URL('../../app/src/dashboard/', import.meta.url)
    const allowed = /^(TWIZA|ET0|Jebia|2D|3D|Navigation|OpenStreetMap|m³|kWh|ha|mm|dS\/m|l\/s|°C|Promise|return)$/ // proper nouns, units, and code tokens the regex can catch
    const isKey = (v: string) => /^[a-z]+\.[A-Za-z0-9.]+$/.test(v) // a translation key passed as a prop
    const found: string[] = []
    for (const f of readdirSync(dir).filter(f => f.endsWith('.tsx'))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      // text between JSX tags, and string literals in aria-label / title / placeholder attributes
      for (const m of src.matchAll(/>\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{3,})\s*</g)) if (!allowed.test(m[1].trim())) found.push(`${f}: "${m[1].trim()}"`)
      for (const m of src.matchAll(/(?:aria-label|title|placeholder)="([^"{}]*[A-Za-zÀ-ÿ]{4,}[^"{}]*)"/g)) if (!allowed.test(m[1].trim()) && !isKey(m[1].trim())) found.push(`${f}: ${m[0]}`)
    }
    expect(found).toEqual([])
  })
})
