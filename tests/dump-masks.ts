// Run the photo pipeline on one photo and dump every visible cell's ink mask at the processing scale
// (CROP×CROP, 0/1 bytes, slot order) so a simulator can compare them with its ground truth.
// usage: node tests/dump-masks.ts <photo.jpg> <out prefix>   -> <prefix>.bin, <prefix>.json
import fs from 'node:fs'
import jpeg from 'jpeg-js'
import cvModule from '@techstark/opencv-js'
import { extractMask, scanPage, UPSAMPLE } from '../src/core/pipeline.ts'
import { CROP } from '../src/core/geometry.ts'

async function loadCv() {
  let cv: any = cvModule
  if (cv instanceof Promise) cv = await cv
  else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r })
  return cv
}

const [file, out] = process.argv.slice(2)
const cv = await loadCv()
const img = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 })
const t0 = performance.now()
const scan = scanPage(cv, { data: img.data, width: img.width, height: img.height })
const ms = Math.round(performance.now() - t0)
if (!scan.ok) {
  fs.writeFileSync(out + '.json', JSON.stringify({ ok: false, reason: scan.reason, markers: scan.markers, ms }))
  console.log(file, 'FAIL', scan.reason, scan.markers)
  process.exit(0)
}
const W = CROP * UPSAMPLE
const bin = new Uint8Array(scan.cells.length * CROP * CROP)
const cells = scan.cells.map((c, n) => {
  const m = extractMask(cv, c.crop, scan.ink, 0, scan.guide)
  if (m) {
    for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++) {
      let s = 0
      for (let dy = 0; dy < UPSAMPLE; dy++) for (let dx = 0; dx < UPSAMPLE; dx++) s += m[(y * UPSAMPLE + dy) * W + x * UPSAMPLE + dx] ? 1 : 0
      bin[n * CROP * CROP + y * CROP + x] = 2 * s >= UPSAMPLE * UPSAMPLE ? 1 : 0
    }
  }
  return { index: c.index, char: c.char, empty: !m }
})
fs.writeFileSync(out + '.bin', bin)
fs.writeFileSync(out + '.json', JSON.stringify({ ok: true, page: scan.page.id, markers: scan.markers, ink: scan.ink, guide: scan.guide, visible: scan.cells.length, total: scan.visible.length, ms, cells }))
console.log(file, 'ok', scan.page.id, 'markers', scan.markers.join(''), 'visible', `${scan.cells.length}/${scan.visible.length}`, 'empty', cells.filter((c) => c.empty).length, 'ink', scan.ink.toFixed(2), 'guide', scan.guide.toFixed(2), `${ms}ms`)
