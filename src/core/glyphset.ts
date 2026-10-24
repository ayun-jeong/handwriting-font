// Everything that goes into a font file, with every user adjustment applied. Preview and export both
// build from here, so the preview is exactly the downloaded font.
//
// Assembled syllables are TrueType composites that reference the jamo variant glyphs, which keeps a full
// 11,172-syllable font small (a few hundred KB instead of several MB).
import { ALL_SYLLABLES, isJamoKey, isSyllable, resolveVariants, syllableParts, type Rect, type VariantId } from './compose.ts'
import type { Kind, Pt } from './geometry.ts'
import { MID, NO_ADJUST, SIDE, autoAlign, bounds, layoutGlyph, type GlyphAdjust, type Settings } from './layout.ts'
import { mapOutlines, type Outline } from './tracer.ts'

export type SourceGlyph = { key: string; kind: Kind; outlines: Outline[] }

export type SimpleGlyph = { type: 'simple'; name: string; unicode?: number; outlines: Outline[]; advance: number; bounds: Rect }
export type CompositeGlyph = { type: 'composite'; name: string; unicode: number; components: { name: string; dx: number; dy: number }[]; advance: number; bounds: Rect }
export type FontGlyph = SimpleGlyph | CompositeGlyph

/** Which Hangul syllables to assemble: all 11,172, the 2,350 of KS X 1001, or only those in `only`. */
export type SyllableScope = { scope: 'all' | 'ks' } | { scope: 'only'; chars: Iterable<string> }

let ksCache: string[] | null = null
/** The 2,350 syllables of KS X 1001 (EUC-KR), the common Hangul set. */
export function ksSyllables(): string[] {
  if (ksCache) return ksCache
  const dec = new TextDecoder('euc-kr')
  const out: string[] = []
  for (let b1 = 0xb0; b1 <= 0xc8; b1++) for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
    const c = dec.decode(new Uint8Array([b1, b2]))
    if (c.length === 1 && isSyllable(c)) out.push(c)
  }
  return (ksCache = out)
}

const glyphName = (c: string) => `uni${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
const variantName = (id: VariantId) => `jamo.${id.replace(/:/g, '_')}`

function adjustPiece(o: Outline[], a: GlyphAdjust): Outline[] {
  if (!a.dx && !a.dy && a.scale === 1) return o
  const [x0, y0, x1, y1] = bounds(o)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  return mapOutlines(o, ([x, y]): Pt => [cx + (x - cx) * a.scale + a.dx, cy + (y - cy) * a.scale + a.dy])
}

/** Where an assembled-syllable point lands in the font: matched to the written syllables, then the Hangul size. */
export function composedToFont([x, y]: Pt, s: Settings): Pt {
  const cx = 500 + (x - 500) * s.composedScale, cy = MID + (y - MID) * s.composedScale + s.composedShift
  return [500 + (cx - 500) * s.hangulScale, MID + (cy - MID) * s.hangulScale + s.hangulShift]
}

export type GlyphSet = { glyphs: FontGlyph[]; written: Set<string>; composed: Set<string> }

export function buildGlyphSet(sources: SourceGlyph[], s: Settings, adjust: Record<string, GlyphAdjust>, which: SyllableScope): GlyphSet {
  const pieces = new Map<string, Outline[]>()
  const plain: SourceGlyph[] = []
  for (const g of sources) {
    const a = adjust[g.key] ?? NO_ADJUST
    if (a.off) continue
    if (isJamoKey(g.key)) pieces.set(g.key, adjustPiece(g.outlines, a))
    else plain.push(g)
  }

  const glyphs: FontGlyph[] = []
  const written = new Set<string>()
  const auto = autoAlign(plain.map((g) => ({ char: g.key, kind: g.kind, outlines: g.outlines })))
  for (const g of plain) {
    const laid = layoutGlyph({ char: g.key, kind: g.kind, outlines: g.outlines }, s, adjust[g.key], auto.get(g.key))
    glyphs.push({ type: 'simple', name: glyphName(g.key), unicode: g.key.codePointAt(0), outlines: laid.outlines, advance: laid.advance, bounds: laid.bounds })
    written.add(g.key)
  }

  const composed = new Set<string>()
  if (!pieces.size) return { glyphs, written, composed }
  const variants = resolveVariants(pieces)
  const want: string[] = which.scope === 'only' ? [...new Set(which.chars)].filter(isSyllable) : which.scope === 'all' ? ALL_SYLLABLES : ksSyllables()

  // Hangul is scaled about the middle of the em box, the same transform layoutGlyph uses for written syllables
  const toFont = (o: Outline[]) => mapOutlines(o, (p) => composedToFont(p, s))
  const used = new Map<VariantId, { outlines: Outline[]; bounds: Rect }>()
  const variant = (id: VariantId) => {
    let v = used.get(id)
    if (!v) {
      const outlines = toFont(variants.get(id)!)
      v = { outlines, bounds: bounds(outlines) }
      used.set(id, v)
    }
    return v
  }
  // assembled syllables are centred like written ones (autoAlign), on the same line moved by their own height slider
  const line = composedToFont([500, MID], s)[1]
  const composites: CompositeGlyph[] = []
  for (const ch of want) {
    if (written.has(ch)) continue
    const parts = syllableParts(ch, variants)
    if (!parts) continue
    const bs = parts.map((p) => variant(p).bounds)
    const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]))
    const x1 = Math.max(...bs.map((b) => b[2])), y1 = Math.max(...bs.map((b) => b[3]))
    const dx = Math.round(SIDE + s.tracking / 2 - x0)
    const dy = Math.round(s.align * (line - (y0 + y1) / 2))
    composites.push({
      type: 'composite', name: glyphName(ch), unicode: ch.charCodeAt(0),
      components: parts.map((p) => ({ name: variantName(p), dx, dy })),
      advance: Math.max(50, Math.round(x1 - x0 + 2 * SIDE + s.tracking)),
      bounds: [x0 + dx, y0 + dy, x1 + dx, y1 + dy],
    })
    composed.add(ch)
  }
  for (const [id, v] of used) glyphs.push({ type: 'simple', name: variantName(id), outlines: v.outlines, advance: 0, bounds: v.bounds })
  glyphs.push(...composites)
  return { glyphs, written, composed }
}

/** Characters this project can show: written ones plus every syllable the jamo can assemble. */
export function availableChars(sources: SourceGlyph[], adjust: Record<string, GlyphAdjust>): { written: Set<string>; composable: Set<string> } {
  const written = new Set<string>()
  const pieces = new Map<string, Outline[]>()
  for (const g of sources) {
    if (adjust[g.key]?.off) continue
    if (isJamoKey(g.key)) pieces.set(g.key, g.outlines)
    else written.add(g.key)
  }
  const composable = new Set<string>()
  if (pieces.size) {
    const variants = resolveVariants(pieces)
    for (const ch of ALL_SYLLABLES) if (!written.has(ch) && syllableParts(ch, variants)) composable.add(ch)
  }
  return { written, composable }
}

/** Raw (unadjusted) assembled outlines for the given syllables, where the jamo allow it. */
export function assembledOutlines(sources: SourceGlyph[], chars: string[]): Outline[][] {
  const pieces = new Map<string, Outline[]>()
  for (const g of sources) if (isJamoKey(g.key)) pieces.set(g.key, g.outlines)
  if (!pieces.size) return []
  const variants = resolveVariants(pieces)
  const out: Outline[][] = []
  for (const ch of chars) {
    const parts = syllableParts(ch, variants)
    if (parts) out.push(parts.flatMap((p) => variants.get(p)!))
  }
  return out
}
