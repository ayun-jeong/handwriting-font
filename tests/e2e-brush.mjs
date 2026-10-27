// E2E: hand corrections with the brush. Erase part of a glyph by dragging over the editor canvas, undo, redo,
// reload (the strokes are saved), and check the downloaded TTF got narrower.
// usage: node tests/e2e-brush.mjs <url> <photos dir> <out dir> <char> <photo> [photo ...]
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, photosDir, out, ch, ...files] = process.argv.slice(2)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const resultPath = () => page.$eval('.dialog .crop.result path:not(.ctx)', (p) => p.getAttribute('d'))
const waitPath = (fn, label, arg) => page.waitForFunction(fn, { timeout: 20000, polling: 100 }, arg).catch(() => { throw new Error('timed out: ' + label) })
const openGlyph = async () => {
  await page.evaluate((ch) => [...document.querySelectorAll('.tile')].find((t) => t.getAttribute('aria-label') === `${ch} 고치기`).click(), ch)
  await page.waitForSelector('.dialog .shape-canvas')
  await sleep(400)
}
const downloadTtf = async (name) => {
  await clickText('폰트 받기 →')
  await sleep(300)
  const before = new Set(fs.readdirSync(out))
  await clickText('TTF 내려받기')
  let got = null
  for (let i = 0; i < 300 && !got; i++) { await sleep(100); got = fs.readdirSync(out).find((f) => f.endsWith('.ttf') && !before.has(f)) }
  fs.renameSync(path.join(out, got), path.join(out, name))
  await clickText('다듬기')
  await sleep(300)
}

await page.goto(url, { waitUntil: 'networkidle0' })
await clickText('사진 올리기')
await (await page.$('#photo-input')).uploadFile(...files.map((f) => path.join(photosDir, f)))
await page.waitForFunction((n) => document.querySelectorAll('.photo').length >= n && !document.querySelector('.photo.working'), { timeout: 300000, polling: 300 }, files.length)
await clickText('다듬기 →')
await page.waitForSelector('.tile')
for (const f of fs.readdirSync(out).filter((f) => f.endsWith('.ttf'))) fs.unlinkSync(path.join(out, f))
await downloadTtf('before.ttf')

await openGlyph()
const d0 = await resultPath()
// eraser, biggest brush, one stroke down the left third of the cell
await page.click('#ge-erase')
await page.$eval('#ge-brush', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '40'); el.dispatchEvent(new Event('input', { bubbles: true })) })
const box = await (await page.$('.dialog .shape-canvas')).boundingBox()
await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.02)
await page.mouse.down()
for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * (0.02 + 0.96 * i / 20))
await page.mouse.up()
await waitPath((d0) => document.querySelector('.dialog .crop.result path:not(.ctx)').getAttribute('d') !== d0, 'erase applied', d0)
const d1 = await resultPath()
await page.screenshot({ path: path.join(out, 'erased.png'), clip: await page.$eval('.dialog', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 700) } }) })
console.log('erase changed the shape:', d1 !== d0, `(${d0.length} -> ${d1.length} chars of path)`)

await clickText('되돌리기')
await waitPath((d0) => document.querySelector('.dialog .crop.result path:not(.ctx)').getAttribute('d') === d0, 'undo', d0)
console.log('undo restores the original:', (await resultPath()) === d0)
await clickText('다시 하기')
await waitPath((d1) => document.querySelector('.dialog .crop.result path:not(.ctx)').getAttribute('d') === d1, 'redo', d1)
console.log('redo brings the edit back:', (await resultPath()) === d1)
await clickText('완료')
console.log('tile marked as changed:', await page.evaluate((ch) => !![...document.querySelectorAll('.tile')].find((t) => t.getAttribute('aria-label') === `${ch} 고치기`).querySelector('.tile-dot'), ch))

await sleep(1200) // let the project save
await page.reload({ waitUntil: 'networkidle0' })
await clickText('다듬기')
await page.waitForSelector('.tile')
await openGlyph()
console.log('after reload, edit kept:', (await resultPath()) === d1, '| reset enabled:', await page.evaluate(() => ![...document.querySelectorAll('button')].find((b) => b.textContent === '모양 원래대로').disabled))
await clickText('완료')
await downloadTtf('after.ttf')
console.log('fonts:', fs.readdirSync(out).filter((f) => f.endsWith('.ttf')))
const errors = logs.filter((l) => /error/i.test(l))
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
