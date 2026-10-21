// Laid-out glyphs -> TTF (fonteditor-core), OTF (opentype.js), WOFF2 (fonteditor-core's woff2 wasm).
import { Font, woff2 } from 'fonteditor-core'
import * as opentypeNs from 'opentype.js'
import type { Pt } from './geometry.ts'
import type { LaidGlyph, Settings } from './layout.ts'
import { buildNameTable, replaceTables } from './sfnt.ts'
import type { Cubic, Outline } from './tracer.ts'

// The ESM build (bundlers) has named exports; Node resolves the CommonJS build, which only has a default.
const opentype: typeof opentypeNs = (opentypeNs as any).Font ? opentypeNs : (opentypeNs as any).default
const { Font: OTFont, Glyph: OTGlyph, Path: OTPath } = opentype

export type Embedding = 'editable' | 'installable'

export type FontMeta = {
  family: string
  embedding: Embedding
  settings: Pick<Settings, 'space' | 'lineGap'>
}

const ASC = 880
const DESC = -120

type TTPoint = { x: number; y: number; onCurve: boolean }

function area(points: Pt[]): number {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1]
  return a / 2
}

function reverse(o: Outline): Outline {
  return { hole: o.hole, segs: [...o.segs].reverse().map(([a, b, c, d]) => [d, c, b, a] as Cubic) }
}

/** Orient outlines: `outerCCW` true for PostScript/CFF, false for TrueType. */
function orient(outlines: Outline[], outerCCW: boolean): Outline[] {
  return outlines.map((o) => {
    const ccw = area(o.segs.flatMap((s) => [s[0], s[1], s[2]])) > 0
    const wantCCW = o.hole ? !outerCCW : outerCCW
    return ccw === wantCCW ? o : reverse(o)
  })
}

/** Cubic -> quadratic pieces within `tol` font units (error bound √3/36·|third difference|/n³). */
function cubicToQuads([p0, p1, p2, p3]: Cubic, tol: number): TTPoint[] {
  const d3x = p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0], d3y = p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]
  const err = (Math.sqrt(3) / 36) * Math.hypot(d3x, d3y)
  const n = Math.min(16, Math.max(1, Math.ceil(Math.cbrt(err / tol))))
  const at = (t: number): [Pt, Pt, Pt, Pt] => {
    // de Casteljau split of the original cubic, returning the sub-curve on [t, t + 1/n]
    const lerp = (a: Pt, b: Pt, u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
    const split = (c: Cubic, u: number): [Cubic, Cubic] => {
      const ab = lerp(c[0], c[1], u), bc = lerp(c[1], c[2], u), cd = lerp(c[2], c[3], u)
      const abc = lerp(ab, bc, u), bcd = lerp(bc, cd, u), m = lerp(abc, bcd, u)
      return [[c[0], ab, abc, m], [m, bcd, cd, c[3]]]
    }
    const right = split([p0, p1, p2, p3], t)[1]
    return split(right, (1 / n) / (1 - t || 1))[0]
  }
  const out: TTPoint[] = []
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = n === 1 ? [p0, p1, p2, p3] : at(i / n)
    const q: Pt = [(3 * (b[0] + c[0]) - (a[0] + d[0])) / 4, (3 * (b[1] + c[1]) - (a[1] + d[1])) / 4]
    out.push({ x: Math.round(q[0]), y: Math.round(q[1]), onCurve: false }, { x: Math.round(d[0]), y: Math.round(d[1]), onCurve: true })
  }
  return out
}

function ttContours(outlines: Outline[]): TTPoint[][] {
  return orient(outlines, false).map((o) => {
    const pts: TTPoint[] = [{ x: Math.round(o.segs[0][0][0]), y: Math.round(o.segs[0][0][1]), onCurve: true }]
    for (const s of o.segs) pts.push(...cubicToQuads(s, 1))
    pts.pop() // last on-curve point repeats the first
    return pts
  })
}

function psName(family: string): { ascii: string; ps: string } {
  const ascii = family.normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, '').trim()
  let h = 0
  for (const ch of family) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  const base = ascii ? ascii.replace(/ +/g, '') : `Handwriting${h.toString(36).toUpperCase()}`
  return { ascii: ascii || `Handwriting ${h.toString(36).toUpperCase()}`, ps: `${base.slice(0, 50)}-Regular` }
}

function nameTable(meta: FontMeta): Uint8Array {
  const { ascii, ps } = psName(meta.family)
  const year = new Date().getFullYear()
  return buildNameTable({
    family: meta.family, familyAscii: ascii, postScript: ps, version: 'Version 1.000',
    copyright: `Copyright (c) ${year} the writer of this handwriting`, unique: `${ps};${Date.now().toString(36)}`,
  })
}

function vertical(glyphs: LaidGlyph[]) {
  let top = ASC, bottom = DESC
  for (const g of glyphs) { top = Math.max(top, g.bounds[3]); bottom = Math.min(bottom, g.bounds[1]) }
  return { winAscent: Math.ceil(top), winDescent: Math.ceil(-bottom) }
}

const OS2_RANGES = {
  ulUnicodeRange1: (1 << 0) | (1 << 28), // Basic Latin, Hangul Jamo
  ulUnicodeRange2: 1 << (56 - 32), // Hangul Syllables
  ulCodePageRange1: (1 << 0) | (1 << 19), // Latin 1, Korean Wansung
}

export function buildTTF(glyphs: LaidGlyph[], meta: FontMeta): Uint8Array {
  const font = Font.create()
  const ttf = font.get() as any
  const notdef = ttf.glyf[0]
  const { winAscent, winDescent } = vertical(glyphs)
  ttf.head.unitsPerEm = 1000
  ttf.head.created = ttf.head.modified = Date.now()
  Object.assign(ttf.hhea, { ascent: ASC, descent: DESC, lineGap: meta.settings.lineGap })
  Object.assign(ttf['OS/2'], {
    fsType: meta.embedding === 'installable' ? 0 : 8,
    usWeightClass: 400, fsSelection: 64 | 128, achVendID: 'NONE',
    sTypoAscender: ASC, sTypoDescender: DESC, sTypoLineGap: meta.settings.lineGap,
    usWinAscent: winAscent, usWinDescent: winDescent, ...OS2_RANGES,
  })
  ttf.post.format = 3
  ttf.glyf = [
    { ...notdef, name: '.notdef' },
    { contours: [], advanceWidth: meta.settings.space, leftSideBearing: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0, name: 'space', unicode: [32] },
    ...glyphs.map((g) => {
      const contours = ttContours(g.outlines)
      const xs = contours.flat().map((p) => p.x), ys = contours.flat().map((p) => p.y)
      const xMin = Math.min(...xs)
      return {
        contours, advanceWidth: g.advance, leftSideBearing: xMin,
        xMin, xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys),
        name: `uni${g.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`, unicode: [g.char.codePointAt(0)!],
      }
    }),
  ]
  font.set(ttf)
  const raw = new Uint8Array(font.write({ type: 'ttf', hinting: false }) as ArrayBuffer)
  return replaceTables(raw, { name: nameTable(meta) })
}

export function buildOTF(glyphs: LaidGlyph[], meta: FontMeta): Uint8Array {
  const { ascii, ps } = psName(meta.family)
  const nd = new OTPath()
  nd.moveTo(50, 0); nd.lineTo(450, 0); nd.lineTo(450, 700); nd.lineTo(50, 700); nd.close()
  nd.moveTo(100, 50); nd.lineTo(100, 650); nd.lineTo(400, 650); nd.lineTo(400, 50); nd.close()
  const list = [
    new OTGlyph({ name: '.notdef', advanceWidth: 500, path: nd }),
    new OTGlyph({ name: 'space', unicode: 32, advanceWidth: meta.settings.space, path: new OTPath() }),
    ...glyphs.map((g) => {
      const path = new OTPath()
      for (const o of orient(g.outlines, true)) {
        path.moveTo(o.segs[0][0][0], o.segs[0][0][1])
        for (const [, c1, c2, p] of o.segs) path.curveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1])
        path.close()
      }
      return new OTGlyph({ name: `uni${g.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`, unicode: g.char.codePointAt(0)!, advanceWidth: g.advance, path })
    }),
  ]
  const f = new OTFont({ familyName: ascii, styleName: 'Regular', postScriptName: ps, unitsPerEm: 1000, ascender: ASC, descender: DESC, glyphs: list } as any)
  const { winAscent, winDescent } = vertical(glyphs)
  ;(f as any).tables.os2 = {
    fsType: meta.embedding === 'installable' ? 0 : 8, fsSelection: 64 | 128,
    sTypoLineGap: meta.settings.lineGap, usWinAscent: winAscent, usWinDescent: winDescent, ...OS2_RANGES,
  }
  ;(f as any).tables.hhea = { lineGap: meta.settings.lineGap }
  const raw = new Uint8Array(f.toArrayBuffer())
  return replaceTables(raw, { name: nameTable(meta) })
}

let woff2Ready: Promise<unknown> | null = null

export async function buildWOFF2(ttf: Uint8Array, wasm?: string | ArrayBuffer): Promise<Uint8Array> {
  woff2Ready ??= woff2.init(wasm as string)
  await woff2Ready
  return woff2.encode(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer)
}
