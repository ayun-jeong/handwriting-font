// Node check of the browser pipeline on the spike's simulated photos.
// usage: node tests/scan-photos.ts <photos dir> <out dir>
import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import cvModule from '@techstark/opencv-js'
import { scanPage, traceCells } from '../src/core/pipeline.ts'
import { DEFAULT_SETTINGS, bounds } from '../src/core/layout.ts'
import { buildGlyphSet } from '../src/core/glyphset.ts'
import { buildTTF, buildOTF, buildWOFF2 } from '../src/core/font.ts'

async function loadCv() {
  let cv: any = cvModule
  if (cv instanceof Promise) cv = await cv
  else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r })
  return cv
}

const [dir, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const cv = await loadCv()
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
const report: any[] = []
for (const f of files) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, f)), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  const t0 = performance.now()
  const scan = scanPage(cv, { data: raw.data, width: raw.width, height: raw.height })
  const t1 = performance.now()
  if (!scan.ok) { report.push({ f, ok: false, reason: scan.reason, markers: scan.markers }); console.log(f, 'FAIL', scan.reason); continue }
  const { glyphs, empties } = traceCells(cv, scan)
  const t2 = performance.now()
  const sources = glyphs.map((g) => ({ key: g.char, kind: g.kind, outlines: g.outlines }))
  const laid = buildGlyphSet(sources, DEFAULT_SETTINGS, {}, { scope: 'only', chars: [] }).glyphs
  const rawX = new Map(sources.map((s) => [s.key, bounds(s.outlines)[0]]))
  const shifts = Object.fromEntries(laid.filter((g) => g.unicode !== undefined).map((g) => {
    const ch = String.fromCodePoint(g.unicode!)
    return [ch, g.bounds[0] - rawX.get(ch)!]
  }))
  const meta = { family: '손글씨 테스트', embedding: 'editable' as const, settings: DEFAULT_SETTINGS }
  const ttf = buildTTF(laid, meta)
  const base = path.join(out, f.replace('.jpg', ''))
  fs.writeFileSync(base + '.ttf', ttf)
  fs.writeFileSync(base + '.json', JSON.stringify({ page: scan.page.id, kind: scan.page.kind, shifts, empties: empties.map((e) => e.index) }))
  if (f === files[0]) {
    fs.writeFileSync(base + '.otf', buildOTF(laid, meta))
    fs.writeFileSync(base + '.woff2', await buildWOFF2(ttf))
  }
  const row = { f, ok: true, page: scan.page.id, markers: scan.markers.length, ink: +scan.ink.toFixed(3), glyphs: glyphs.length, empties: empties.length, scanMs: Math.round(t1 - t0), traceMs: Math.round(t2 - t1), ttfKB: +(ttf.length / 1024).toFixed(1) }
  report.push(row)
  console.log(JSON.stringify(row))
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
