// Shared helpers for the browser tests. BASE = app URL, CHROME = path to a Chromium binary.
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
export const BASE = process.env.BASE || 'http://localhost:5173'
export const OUT = new URL('./out/', import.meta.url).pathname
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`
export const launch = () => chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
export const session = () => 'e2e' + Math.random().toString(36).slice(2, 12)
export function watch(page, errs, tag = '') {
  page.on('console', m => { if (m.type() === 'error') errs.push(`${tag} console: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => errs.push(`${tag} pageerror: ${e.message.slice(0, 200)}`))
}
let failed = 0
export const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }
export const finish = async (browser, errs = []) => {
  await browser.close()
  if (errs.length) { failed += errs.length; console.log('ERRORS:\n' + errs.join('\n')) }
  console.log(failed ? `\n${failed} problem(s)` : '\nall good')
  process.exit(failed ? 1 : 0)
}
export const truth = () => JSON.parse(readFileSync(new URL('../data/network.json', import.meta.url), 'utf8'))
export const metres = (a, b) => Math.hypot((a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 111320)
