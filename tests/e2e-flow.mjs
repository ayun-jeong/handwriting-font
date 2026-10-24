// E2E part 2: upload photos, wait for recognition, adjust (global + one glyph), download TTF/OTF/WOFF2.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, photosDir, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900 })
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(out), eventsEnabled: true })
const clickText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('no button ' + t); b.click() }, t)
const setRange = (id, v) => page.evaluate((id, v) => {
  const el = document.getElementById(id)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, id, v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(url, { waitUntil: 'networkidle0' })
await clickText('사진 올리기')
const input = await page.$('#photo-input')
const files = process.argv.slice(5).map((f) => path.join(photosDir, f))
const t0 = Date.now()
await input.uploadFile(...files)
await page.waitForFunction((n) => document.querySelectorAll('.photo.done, .photo.error').length >= n, { timeout: 180000 }, files.length)
console.log('processing time', ((Date.now() - t0) / 1000).toFixed(1), 's')
console.log(await page.evaluate(() => [...document.querySelectorAll('.photo')].map((p) => p.innerText.replace(/\n/g, ' | ')).join('\n')))
await page.screenshot({ path: path.join(out, 'step2.png'), fullPage: true })

await clickText('다듬기 →')
await page.waitForFunction(() => getComputedStyle(document.querySelector('.preview-render')).fontFamily.includes('HandPreview'), { timeout: 20000 })
await sleep(500)
await page.screenshot({ path: path.join(out, 'step3-default.png'), fullPage: false })
await setRange('set-tracking', -40)
await setRange('set-latinScale', 0.9)
await setRange('set-weight', 1)
await setRange('set-align', 0.5)
await page.waitForFunction(() => !document.querySelector('.preview-bar .spin'), { timeout: 60000 })
await sleep(1200)
await page.screenshot({ path: path.join(out, 'step3-adjusted.png'), fullPage: false })
const fam = await page.evaluate(() => getComputedStyle(document.querySelector('.preview-render')).fontFamily)
console.log('preview font after adjust:', fam)

// edit one glyph
await page.evaluate(() => document.querySelector('.tile').click())
await page.waitForSelector('.dialog')
await setRange('ge-dy', 60)
await setRange('ge-scale', 1.1)
await sleep(600)
await page.screenshot({ path: path.join(out, 'step3-editor.png'), fullPage: false })
await clickText('완료')

await clickText('폰트 받기 →')
await page.evaluate(() => {
  const el = document.getElementById('font-name')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '테스트 손글씨')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(400)
for (const f of ['TTF', 'OTF', 'WOFF2']) {
  const before = fs.readdirSync(out).length
  await clickText(`${f} 내려받기`)
  for (let i = 0; i < 100 && fs.readdirSync(out).filter((x) => !x.endsWith('.crdownload')).length <= before; i++) await sleep(200)
}
await sleep(800)
await page.screenshot({ path: path.join(out, 'step4.png'), fullPage: true })
console.log('files:', fs.readdirSync(out))
const errors = logs.filter((l) => /error/i.test(l))
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
