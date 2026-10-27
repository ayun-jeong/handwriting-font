// Hand corrections end to end in Node: scan a photo, then erase / add ink on one glyph with brush strokes and
// re-trace it the way the worker does. Prints the glyph's bounds before and after, and writes PNG-less SVGs.
// usage: node tests/brush-check.ts <photo.jpg> <char> <out dir>
import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import cvModule from '@techstark/opencv-js'
import { paintStrokes, type Stroke } from '../src/core/brush.ts'
import { CROP } from '../src/core/geometry.ts'
import { bounds, svgPath } from '../src/core/layout.ts'
import { UPSAMPLE, extractMask, maskToOutlines, scanPage } from '../src/core/pipeline.ts'

let cv: any = cvModule
if (cv instanceof Promise) cv = await cv
else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r })

const [file, ch, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const img = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 })
const scan = scanPage(cv, { data: img.data, width: img.width, height: img.height })
if (!scan.ok) throw new Error(scan.reason)
const cell = scan.cells.find((c) => c.char === ch)
if (!cell) throw new Error(`no cell ${ch}`)
const W = CROP * UPSAMPLE
const trace = (strokes: Stroke[]) => {
  let mask = extractMask(cv, cell.crop, scan.ink, 0)
  if (strokes.length) { mask ??= new Uint8Array(W * W); paintStrokes(mask, W, strokes) }
  return mask?.some((v) => v) ? maskToOutlines(cv, mask, cell.kind) : []
}
const cases: [string, Stroke[]][] = [
  ['original', []],
  // erase the left half of the cell with a fat brush
  ['erase-left', [{ erase: true, r: 30, pts: [30, 0, 30, 70, 30, 140, 30, 204] }, { erase: true, r: 30, pts: [80, 0, 80, 204] }]],
  // add a dot in the empty top-right corner
  ['add-dot', [{ erase: false, r: 12, pts: [185, 18] }]],
  // erase everything
  ['erase-all', [{ erase: true, r: 150, pts: [102, 102] }]],
]
for (const [name, strokes] of cases) {
  const o = trace(strokes)
  const b = o.length ? bounds(o).map(Math.round) : null
  console.log(name.padEnd(11), 'outlines', String(o.length).padStart(2), 'bounds', JSON.stringify(b))
  fs.writeFileSync(path.join(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -900 1000 1000" width="200" height="200"><rect x="0" y="-900" width="1000" height="1000" fill="#fff"/><path d="${svgPath(o)}" fill="#111"/></svg>`)
}
