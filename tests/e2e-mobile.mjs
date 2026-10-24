// Phone-width screenshots of every step after loading photos (default: two large-cell photos).
// usage: node tests/e2e-mobile.mjs <url> <photos dir> <out dir> [photo ...]
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [url, photosDir, out] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const clickText = (t) => page.evaluate((t) => [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)).click(), t)
await page.goto(url, { waitUntil: 'networkidle0' })
await page.screenshot({ path: path.join(out, 'm1.png'), fullPage: true })
await clickText('사진 올리기')
const input = await page.$('#photo-input')
const files = process.argv.slice(5).length ? process.argv.slice(5) : ['latin_medium.jpg', 'hangul_medium.jpg']
await input.uploadFile(...files.map((f) => path.join(photosDir, f)))
// a PDF adds one item per page, so wait until nothing is still being read
await page.waitForFunction((n) => document.querySelectorAll('.photo').length >= n && !document.querySelector('.photo.working'), { timeout: 180000, polling: 300 }, files.length)
await page.screenshot({ path: path.join(out, 'm2.png'), fullPage: true })
await clickText('다듬기 →')
await page.waitForFunction(() => getComputedStyle(document.querySelector('.preview-render')).fontFamily.includes('HandPreview'), { timeout: 20000 })
await new Promise((r) => setTimeout(r, 600))
await page.screenshot({ path: path.join(out, 'm3.png'), fullPage: true })
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log('horizontal overflow px:', overflow)
await page.evaluate(() => document.querySelectorAll('.tile')[5].click())
await page.waitForSelector('.dialog')
await page.screenshot({ path: path.join(out, 'm3-editor.png') })
await browser.close()
