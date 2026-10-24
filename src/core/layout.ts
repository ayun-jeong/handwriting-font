// User adjustments (spacing, size, position) applied to traced glyphs. Preview and export share this code,
// so what the user sees is exactly what ends up in the font file.
import type { Kind, Pt } from './geometry.ts'
import { mapOutlines, type Outline } from './tracer.ts'

export type Settings = {
  /** Font units added to every advance width, split evenly to both sides. */
  tracking: number
  /** Advance width of the word space. */
  space: number
  hangulScale: number
  latinScale: number
  /** Vertical shift in font units (+ = up). */
  hangulShift: number
  latinShift: number
  /** Stroke weight steps; each step grows or shrinks strokes by about one 300-dpi pixel. */
  weight: number
  /** Extra space between lines. */
  lineGap: number
  /** Assembled syllables relative to written ones (size matched automatically, adjustable). */
  composedScale: number
  composedShift: number
  /** How far each glyph is moved onto the common line (see autoAlign): 0 = as written, 1 = fully lined up. */
  align: number
}

export const DEFAULT_SETTINGS: Settings = {
  tracking: 0, space: 280, hangulScale: 1, latinScale: 1, hangulShift: 0, latinShift: 0, weight: 0, lineGap: 200,
  composedScale: 1, composedShift: 0, align: 1,
}

export type GlyphAdjust = { dx: number; dy: number; scale: number; off: boolean }
export const NO_ADJUST: GlyphAdjust = { dx: 0, dy: 0, scale: 1, off: false }

/** Base side bearing, font units. */
export const SIDE = 40

export type GlyphShape = { char: string; kind: Kind; outlines: Outline[] }
export type LaidGlyph = { char: string; outlines: Outline[]; advance: number; bounds: [number, number, number, number] }

export function bounds(outlines: Outline[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const o of outlines) for (const s of o.segs) for (const [x, y] of s) {
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0]
}

/** Middle of the em box: Hangul and other full-width glyphs are centred on it. */
export const MID = 380

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]

/**
 * Vertical offsets (font units, before scaling) that put every glyph on a common line, so text doesn't bounce
 * with where each cell happened to be written in: Hangul and other full-width glyphs are centred on MID;
 * Latin letters, digits and a few signs sit on the baseline; g p q y, j and Q, which reach below it, are placed
 * by their top instead (x-height, the dot of i, cap height). Other punctuation keeps its written position.
 */
export function autoAlign(glyphs: GlyphShape[]): Map<string, number> {
  const out = new Map<string, number>()
  const box = new Map(glyphs.filter((g) => g.outlines.length).map((g) => [g.char, bounds(g.outlines)]))
  const heights = (re: RegExp) => [...box].filter(([c]) => re.test(c)).map(([, b]) => b[3] - b[1])
  const xs = heights(/^[acemnorsuvwxz]$/), caps = heights(/^[A-PR-Z]$/), dotI = heights(/^i$/)
  const xTop = xs.length >= 3 ? median(xs) : null, capTop = caps.length >= 3 ? median(caps) : null
  const iTop = dotI.length ? dotI[0] : null
  for (const g of glyphs) {
    const b = box.get(g.char)
    if (!b) continue
    const [, y0, , y1] = b
    let dy = 0
    if (g.kind === 'hangul') dy = MID - (y0 + y1) / 2
    else if (/^[A-PR-Z0-9a-fh-ik-or-xz.:!?%&#₩€¥£…]$/.test(g.char)) dy = -y0
    else if (/^[gpqy]$/.test(g.char) && xTop !== null) dy = xTop - y1
    else if (g.char === 'j' && iTop !== null) dy = iTop - y1
    else if (g.char === 'Q' && capTop !== null) dy = capTop - y1
    if (dy) out.set(g.char, dy)
  }
  return out
}

/** `auto` is the glyph's offset from autoAlign; it is applied at the strength set by `s.align`. */
export function layoutGlyph(g: GlyphShape, s: Settings, adj: GlyphAdjust = NO_ADJUST, auto = 0): LaidGlyph {
  const hangul = g.kind === 'hangul'
  const scale = (hangul ? s.hangulScale : s.latinScale) * adj.scale
  const [bx0, , bx1] = bounds(g.outlines)
  const ax = (bx0 + bx1) / 2
  const ay = hangul ? MID : 0 // Hangul scales about the middle of the em box, Latin about the baseline
  const pre = s.align * auto
  const lift = (hangul ? s.hangulShift : s.latinShift) + adj.dy
  let outlines = mapOutlines(g.outlines, ([x, y]): Pt => [ax + (x - ax) * scale, ay + (y + pre - ay) * scale + lift])
  const [x0, y0, x1, y1] = bounds(outlines)
  const left = SIDE + s.tracking / 2
  const dx = left - x0 + adj.dx
  outlines = mapOutlines(outlines, ([x, y]): Pt => [x + dx, y])
  const advance = Math.max(50, Math.round(x1 - x0 + 2 * SIDE + s.tracking))
  return { char: g.char, outlines, advance, bounds: [x0 + dx, y0, x1 + dx, y1] }
}

/** SVG path data (y flipped, so it can be drawn with a font-unit viewBox). */
export function svgPath(outlines: Outline[]): string {
  const f = (n: number) => Math.round(n * 10) / 10
  return outlines.map((o) => {
    const [p0] = o.segs[0]
    return `M${f(p0[0])} ${f(-p0[1])}` + o.segs.map(([, c1, c2, p]) => `C${f(c1[0])} ${f(-c1[1])} ${f(c2[0])} ${f(-c2[1])} ${f(p[0])} ${f(-p[1])}`).join('') + 'Z'
  }).join('')
}

/**
 * Scales that bring a fresh set of glyphs to a typical size: Hangul about 720 units tall, Latin capitals
 * about 700 units. Each script is fitted once, as soon as it has enough glyphs to measure.
 */
export function fitScale(target: number, heights: number[]): number {
  const v = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)]
  return Math.round(Math.min(1.5, Math.max(0.8, target / v)) * 100) / 100
}

