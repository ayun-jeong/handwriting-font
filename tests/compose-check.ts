// Assemble all 11,172 syllables from "perfectly traced" jamo (the trace guides themselves) and build fonts.
// usage: node tests/compose-check.ts <out dir>
import fs from 'node:fs'
import path from 'node:path'
import guides from '../src/core/data/jamo-guides.json' with { type: 'json' }
import type { Pt } from '../src/core/geometry.ts'
import type { Cubic, Outline } from '../src/core/tracer.ts'
import { buildGlyphSet } from '../src/core/glyphset.ts'
import { buildOTF, buildTTF, buildWOFF2 } from '../src/core/font.ts'
import { DEFAULT_SETTINGS } from '../src/core/layout.ts'

function parse(d: string): Outline[] {
  const polys: Cubic[][] = []
  let cur: Cubic[] = [], p: Pt = [0, 0], start: Pt = [0, 0]
  for (const [, cmd, args] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = args.trim().split(/\s+/).filter(Boolean).map(Number)
    const pts: Pt[] = []
    for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]])
    if (cmd === 'M') { if (cur.length) polys.push(cur); cur = []; p = start = pts[0] }
    else if (cmd === 'L') { cur.push([p, p, pts[0], pts[0]]); p = pts[0] }
    else if (cmd === 'Q') {
      const [c, e] = pts
      cur.push([p, [p[0] + (2 / 3) * (c[0] - p[0]), p[1] + (2 / 3) * (c[1] - p[1])], [e[0] + (2 / 3) * (c[0] - e[0]), e[1] + (2 / 3) * (c[1] - e[1])], e]); p = e
    } else if (cmd === 'C') { cur.push([p, pts[0], pts[1], pts[2]]); p = pts[2] }
    else if (cmd === 'Z') { if (p[0] !== start[0] || p[1] !== start[1]) cur.push([p, p, start, start]); p = start }
  }
  if (cur.length) polys.push(cur)
  const area = (c: Cubic[]) => c.reduce((a, s) => a + (s[0][0] * s[3][1] - s[3][0] * s[0][1]), 0) / 2
  const inside = (c: Cubic[], q: Pt) => {
    let r = false
    for (const s of c) { const [a, b] = [s[0], s[3]]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r }
    return r
  }
  return polys.map((c, i) => ({
    segs: c,
    hole: polys.some((o, j) => j !== i && Math.abs(area(o)) > Math.abs(area(c)) && Math.sign(area(o)) !== Math.sign(area(c)) && inside(o, c[0][0])),
  }))
}

const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const sources = Object.entries(guides.guides).map(([key, g]) => ({ key, kind: 'hangul' as const, outlines: parse(g.target) }))
for (const scope of ['all', 'ks'] as const) {
  const t0 = performance.now()
  const set = buildGlyphSet(sources, DEFAULT_SETTINGS, {}, { scope })
  const t1 = performance.now()
  const meta = { family: '조합 테스트', embedding: 'editable' as const, settings: DEFAULT_SETTINGS }
  const ttf = buildTTF(set.glyphs, meta)
  const t2 = performance.now()
  fs.writeFileSync(path.join(out, `compose-${scope}.ttf`), ttf)
  const otf = buildOTF(set.glyphs, meta)
  const t3 = performance.now()
  fs.writeFileSync(path.join(out, `compose-${scope}.otf`), otf)
  const w2 = await buildWOFF2(ttf)
  const t4 = performance.now()
  fs.writeFileSync(path.join(out, `compose-${scope}.woff2`), w2)
  console.log(scope, { composed: set.composed.size, glyphs: set.glyphs.length, setMs: Math.round(t1 - t0), ttfMs: Math.round(t2 - t1), ttfKB: Math.round(ttf.length / 1024), otfMs: Math.round(t3 - t2), otfKB: Math.round(otf.length / 1024), woff2Ms: Math.round(t4 - t3), woff2KB: Math.round(w2.length / 1024) })
}
