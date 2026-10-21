// E2E: jamo pages + Korean page 1 + Latin → preview with assembled syllables → download all 11,172.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, photosDir, out] = process.argv.slice(2)
const files = process.argv.slice(5)
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 1000 })
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(out), eventsEnabled: true })
const clickText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('no button ' + t); b.click() }, t)
const setValue = (id, v) => page.evaluate((id, v) => {
  const el = document.getElementById(id)
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, id, v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(url, { waitUntil: 'networkidle0' })
await clickText('사진 올리기')
const t0 = Date.now()
await (await page.$('#photo-input')).uploadFile(...files.map((f) => path.join(photosDir, f)))
await page.waitForFunction((n) => document.querySelectorAll('.photo.done, .photo.error').length >= n, { timeout: 240000 }, files.length)
console.log('processing', ((Date.now() - t0) / 1000).toFixed(1), 's')
console.log(await page.evaluate(() => [...document.querySelectorAll('.photo')].map((p) => p.innerText.split('\n').slice(0, 3).join(' | ')).join('\n')))
console.log(await page.evaluate(() => document.querySelector('.next-row').innerText.replace(/\n/g, ' ')))

await clickText('다듬기 →')
await page.waitForFunction(() => getComputedStyle(document.querySelector('.preview-render')).fontFamily.includes('HandPreview'), { timeout: 30000 })
await setValue('preview-text', '그리고 우리는 다시 만나 이야기를 했다.\n닭볶음탕 곽밥 뷁 쌓았다 읊조림\n훌륭한 젊은이가 앉았고 꽹과리를 쳤다\nThe quick brown fox 2026!')
await page.click('#show-composed')
await sleep(1500)
await page.waitForFunction(() => !document.querySelector('.preview-bar .spin'), { timeout: 30000 })
await sleep(800)
await page.screenshot({ path: path.join(out, 'adjust-composed.png'), clip: await page.evaluate(() => { const r = document.querySelector('.card.preview').getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height } }) })
console.log(await page.evaluate(() => document.querySelector('.card.preview .hint').innerText))

// jamo filter + editor
await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent.startsWith('자모')).click())
await sleep(300)
await page.evaluate(() => document.querySelectorAll('.tile')[0].click())
await page.waitForSelector('.dialog')
await sleep(800)
await page.screenshot({ path: path.join(out, 'editor-jamo.png') })
await clickText('완료')

await clickText('폰트 받기 →')
await sleep(500)
for (const f of ['TTF', 'OTF', 'WOFF2']) {
  const before = fs.readdirSync(out).filter((x) => /\.(ttf|otf|woff2)$/.test(x)).length
  const t = Date.now()
  await clickText(`${f} 내려받기`)
  for (let i = 0; i < 300 && fs.readdirSync(out).filter((x) => /\.(ttf|otf|woff2)$/.test(x)).length <= before; i++) await sleep(100)
  console.log(f, 'downloaded in', ((Date.now() - t) / 1000).toFixed(1), 's')
}
await page.screenshot({ path: path.join(out, 'export.png'), fullPage: false })
console.log('files:', fs.readdirSync(out).filter((x) => /\.(ttf|otf|woff2)$/.test(x)))
const errors = logs.filter((l) => /error/i.test(l))
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
