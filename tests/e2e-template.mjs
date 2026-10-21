// E2E part 1: open the built site, download a 4-page template PDF (jamo 1-2, Korean page 1, Latin).
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900 })
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(out), eventsEnabled: true })
await page.goto(url, { waitUntil: 'networkidle0' })
await page.screenshot({ path: path.join(out, 'step1.png'), fullPage: true })
// custom set: both jamo pages, Korean page 1, Latin page
await page.click('#preset-custom')
await page.select('#opt-to', '1')
const done = new Promise((resolve) => cdp.on('Browser.downloadProgress', (e) => { if (e.state === 'completed') resolve(e) }))
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('PDF 내려받기')).click())
await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('download timeout')), 60000))])
console.log('downloaded:', fs.readdirSync(out).filter((f) => f.endsWith('.pdf')))
console.log(logs.join('\n'))
await browser.close()
