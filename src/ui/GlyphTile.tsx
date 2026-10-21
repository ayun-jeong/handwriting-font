import { isJamoKey, jamoCell } from '../core/compose.ts'
import type { Pt } from '../core/geometry.ts'
import { bounds, layoutGlyph, svgPath, type GlyphAdjust, type Settings } from '../core/layout.ts'
import { mapOutlines } from '../core/tracer.ts'
import { composedToFont } from '../core/glyphset.ts'
import type { GlyphRec } from '../project.ts'

/** Written glyphs are drawn as they will be spaced; jamo pieces in place, over the rest of their guide syllable. */
export default function GlyphTile({ glyph, settings: s, adjust: a, className }: { glyph: GlyphRec; settings: Settings; adjust: GlyphAdjust; className?: string }) {
  if (isJamoKey(glyph.char)) {
    const cell = jamoCell(glyph.char)
    const [x0, y0, x1, y1] = bounds(glyph.outlines)
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const placed = mapOutlines(glyph.outlines, ([x, y]): Pt => composedToFont([cx + (x - cx) * a.scale + a.dx, cy + (y - cy) * a.scale + a.dy], s))
    // the guide paths are in font units (y up); draw them through the same transform, flipped for SVG
    const [ox, oy] = composedToFont([0, 0], s), [ux] = composedToFont([1, 0], s)
    const k = ux - ox
    const guide = `matrix(${k} 0 0 ${-k} ${ox} ${-oy})`
    return (
      <svg viewBox="-20 -900 1040 1060" className={className} aria-hidden="true">
        {cell && <path d={cell.rest} transform={guide} className="ctx" />}
        <path d={svgPath(placed)} />
      </svg>
    )
  }
  const laid = layoutGlyph(glyph, s, a)
  return (
    <svg viewBox={`${laid.advance / 2 - 520} -950 1040 1300`} className={className} aria-hidden="true">
      <line x1={laid.advance / 2 - 520} x2={laid.advance / 2 + 520} y1={0} y2={0} className="baseline" />
      <rect x={0} y={-950} width={laid.advance} height={1300} className="advance" />
      <path d={svgPath(laid.outlines)} />
    </svg>
  )
}
