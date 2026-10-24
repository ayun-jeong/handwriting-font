// E2E: upload PDF(s) (every page is scanned like a photo), then build and download a TTF.
// usage: node tests/e2e-pdf.mjs <url> <out dir> <expected pages> <file.pdf> [more files ...]
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, out, expected, ...files] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900 })
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(out), eventsEnabled: true })
const clickText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('no button ' + t); b.click() }, t)

await page.goto(url, { waitUntil: 'networkidle0' })
await clickText('사진 올리기')
const t0 = Date.now()
await (await page.$('#photo-input')).uploadFile(...files.map((f) => path.resolve(f)))
await page.waitForFunction((n) => {
  const items = document.querySelectorAll('.photo')
  return items.length >= n && !document.querySelector('.photo.working')
}, { timeout: 300000, polling: 300 }, Number(expected))
console.log('processing', ((Date.now() - t0) / 1000).toFixed(1), 's')
console.log(await page.evaluate(() => [...document.querySelectorAll('.photo')].map((p) => p.innerText.replace(/\n/g, ' | ')).join('\n')))
console.log(await page.evaluate(() => document.querySelector('.next-row').innerText.replace(/\n/g, ' ')))
await page.screenshot({ path: path.join(out, 'photos.png'), fullPage: true })

await clickText('다듬기 →')
await page.waitForFunction(() => getComputedStyle(document.querySelector('.preview-render')).fontFamily.includes('HandPreview'), { timeout: 60000 })
await clickText('폰트 받기 →')
const before = fs.readdirSync(out).length
await clickText('TTF 내려받기')
for (let i = 0; i < 300 && fs.readdirSync(out).filter((x) => !x.endsWith('.crdownload')).length <= before; i++) await new Promise((r) => setTimeout(r, 100))
console.log('files:', fs.readdirSync(out).filter((x) => /\.(ttf|otf|woff2)$/.test(x)))
const errors = logs.filter((l) => /error/i.test(l))
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
