// Download a template PDF from the site. usage: node tests/e2e-get-template.mjs <url> <out dir> <size L|M|S> <preset id|custom:jamo,from,to,latin,symbols>
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, out, size, preset] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900 })
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(out), eventsEnabled: true })
await page.goto(url, { waitUntil: 'networkidle0' })
await page.click(`#size-${size}`)
if (preset.startsWith('custom:')) {
  const [jamo, from, to, latin, symbols] = preset.slice(7).split(',')
  await page.click('#preset-custom')
  const setCheck = async (id, v) => { const c = await page.$eval(id, (e) => e.checked); if (c !== (v === '1')) await page.click(id) }
  await setCheck('#opt-jamo', jamo); await setCheck('#opt-latin', latin); await setCheck('#opt-symbols', symbols)
  await page.select('#opt-from', from); await page.select('#opt-to', to)
} else await page.click(`#preset-${preset}`)
const done = new Promise((resolve) => cdp.on('Browser.downloadProgress', (e) => { if (e.state === 'completed') resolve(e) }))
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('PDF 내려받기')).click())
await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('download timeout')), 120000))])
await page.screenshot({ path: path.join(out, 'step1.png') })
console.log('downloaded:', fs.readdirSync(out).filter((f) => f.endsWith('.pdf')))
await browser.close()
