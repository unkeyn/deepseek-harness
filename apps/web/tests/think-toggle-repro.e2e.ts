// TEMP repro (not for commit): expand/collapse the Think disclosure mid-turn
// and watch the back-to-bottom button + scroll geometry.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/code-mode-round/session.jsonl', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./think-toggle-repro.overlay.yml', import.meta.url))

interface Geom { scrollTop: number; scrollHeight: number; clientHeight: number }

async function geometry(page: Page): Promise<Geom> {
  return await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (host === null) throw new Error('no conversation scroll host')
    return { scrollTop: host.scrollTop, scrollHeight: host.scrollHeight, clientHeight: host.clientHeight }
  })
}

async function installScrollLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (host === null) throw new Error('no conversation scroll host')
    const log: unknown[] = []
    ;(window as unknown as { __scrollLog: unknown[] }).__scrollLog = log
    let last = host.scrollTop
    host.addEventListener('scroll', () => {
      log.push({
        t: Math.round(performance.now()),
        scrollTop: host.scrollTop,
        prev: last,
        floor: Math.max(0, host.scrollHeight - host.clientHeight),
      })
      last = host.scrollTop
    }, { passive: true })
  })
}

async function dumpScrollLog(page: Page, label: string): Promise<void> {
  const log = await page.evaluate(() => (window as unknown as { __scrollLog: unknown[] }).__scrollLog)
  console.log(`--- scroll log (${label}): ${JSON.stringify(log)}`)
}

describe('temp repro: think toggle vs back-to-bottom', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page

  afterEach(async () => {
    await browser?.close().catch(() => {})
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch(() => {})
  })

  const thinkHeader = () => page.locator('[data-variant="think"][data-state="running"] [data-disclosure-row]').first()
  const backButton = () => page.getByRole('button', { name: 'Back to bottom' })

  it('expand then collapse Think while the turn streams', async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 40, extraOverlayPath: OVERLAY })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('textarea').first()
    await input.fill('run the recorded code round')
    await input.press('Enter')

    await thinkHeader().waitFor({ timeout: 20_000 })
    expect(await backButton().count()).toBe(0)
    await installScrollLog(page)

    console.log('--- geometry before expand:', JSON.stringify(await geometry(page)))
    await thinkHeader().click()
    await page.waitForTimeout(600)
    console.log('--- geometry expanded:', JSON.stringify(await geometry(page)), 'button:', await backButton().count())

    await thinkHeader().click()
    await page.waitForTimeout(300)
    console.log('--- geometry collapsed (+300ms):', JSON.stringify(await geometry(page)), 'button:', await backButton().count())
    await page.waitForTimeout(1500)
    console.log('--- geometry collapsed (+1800ms):', JSON.stringify(await geometry(page)), 'button:', await backButton().count())
    await dumpScrollLog(page, 'mid-stream toggle')

    // Keep the scenario alive until the turn settles so the scaffold's fixture
    // consumption check passes at close.
    await expect(page.locator('textarea').first()).toBeEnabled({ timeout: 60_000 })
    await page.waitForTimeout(500)
    console.log('--- final button count:', await backButton().count())
  }, 170_000)
})
