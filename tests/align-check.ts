// Build the same scanned glyphs into fonts with and without the automatic line-up, for a side-by-side look.
// usage: node tests/align-check.ts <photo.jpg> <out dir>   -> align0.ttf, align1.ttf, centres.json
import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import cvModule from '@techstark/opencv-js'
import { scanPage, traceCells } from '../src/core/pipeline.ts'
import { buildGlyphSet } from '../src/core/glyphset.ts'
import { buildTTF } from '../src/core/font.ts'
import { refit } from '../src/fit.ts'
import { emptyProject } from '../src/project.ts'

let cv: any = cvModule
if (cv instanceof Promise) cv = await cv
else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r })

const [file, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const img = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 })
const scan = scanPage(cv, { data: img.data, width: img.width, height: img.height })
if (!scan.ok) throw new Error(scan.reason)
const { glyphs } = traceCells(cv, scan)
const sources = glyphs.map((g) => ({ key: g.char, kind: g.kind, outlines: g.outlines }))
// the sizes the app would fit automatically
const fitted = refit({ ...emptyProject(), glyphs: Object.fromEntries(glyphs.map((g) => [g.char, { char: g.char, kind: g.kind, crop: g.crop, ink: scan.ink, outlines: g.outlines, page: scan.page.id }])) }).settings
const sample = [...'그리고 우리는 다시 만나 이야기를 했다 하지만 정말 원하는 것은 없었다 주말에 동생과 전화를 했다 닭볶음탕 곽밥 뷁 읊조림 훌륭한 젊은이']
const centres: Record<string, number[]> = {}
for (const align of [0, 1]) {
  const settings = { ...fitted, align }
  const set = buildGlyphSet(sources, settings, {}, { scope: 'only', chars: sample })
  fs.writeFileSync(path.join(out, `align${align}.ttf`), buildTTF(set.glyphs, { family: `정렬 ${align}`, embedding: 'editable', settings }))
  // vertical centre of each written syllable and assembled syllable in the sample
  centres[`align${align}`] = set.glyphs.filter((g) => g.unicode !== undefined && g.unicode >= 0xac00 && g.unicode <= 0xd7a3).map((g) => Math.round((g.bounds[1] + g.bounds[3]) / 2))
}
fs.writeFileSync(path.join(out, 'centres.json'), JSON.stringify(centres))
const sd = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }
for (const [k, v] of Object.entries(centres)) console.log(k, 'syllables', v.length, 'centre sd', sd(v).toFixed(1), 'min', Math.min(...v), 'max', Math.max(...v))
console.log('fitted', JSON.stringify(fitted))
console.log('latin bottoms', Object.fromEntries([0, 1].map((align) => {
  const set = buildGlyphSet(sources, { ...fitted, align }, {}, { scope: 'only', chars: [] })
  const b = set.glyphs.filter((g) => g.unicode !== undefined && /[a-fh-ik-or-xzA-PR-Z0-9]/.test(String.fromCodePoint(g.unicode))).map((g) => g.bounds[1])
  return [`align${align}`, `sd ${sd(b).toFixed(1)} min ${Math.round(Math.min(...b))} max ${Math.round(Math.max(...b))}`]
})))
