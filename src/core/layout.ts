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
  /** Assembled syllables relative to written ones (matched automatically, adjustable). */
  composedScale: number
  composedShift: number
}

export const DEFAULT_SETTINGS: Settings = {
  tracking: 0, space: 280, hangulScale: 1, latinScale: 1, hangulShift: 0, latinShift: 0, weight: 0, lineGap: 200,
  composedScale: 1, composedShift: 0,
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

export function layoutGlyph(g: GlyphShape, s: Settings, adj: GlyphAdjust = NO_ADJUST): LaidGlyph {
  const hangul = g.kind === 'hangul'
  const scale = (hangul ? s.hangulScale : s.latinScale) * adj.scale
  const [bx0, , bx1] = bounds(g.outlines)
  const ax = (bx0 + bx1) / 2
  const ay = hangul ? 380 : 0 // Hangul scales about the middle of the em box, Latin about the baseline
  const lift = (hangul ? s.hangulShift : s.latinShift) + adj.dy
  let outlines = mapOutlines(g.outlines, ([x, y]): Pt => [ax + (x - ax) * scale, ay + (y - ay) * scale + lift])
  const [x0, y0, x1, y1] = bounds(outlines)
  const left = SIDE + s.tracking / 2
  const dx = left - x0 + adj.dx
  outlines = mapOutlines(outlines, ([x, y]): Pt => [x + dx, y])
  const advance = Math.max(50, Math.round(x1 - x0 + 2 * SIDE + s.tracking))
  return { char: g.char, outlines, advance, bounds: [x0 + dx, y0, x1 + dx, y1] }
}

export function layoutAll(glyphs: GlyphShape[], s: Settings, adjust: Record<string, GlyphAdjust>): LaidGlyph[] {
  return glyphs.filter((g) => !adjust[g.char]?.off).map((g) => layoutGlyph(g, s, adjust[g.char]))
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

