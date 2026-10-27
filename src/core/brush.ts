// Hand corrections to a traced glyph: round-brush strokes that add ink or erase it, painted over the mask the
// scanner extracted. They are kept as strokes rather than pixels, so they survive re-tracing at another stroke
// weight and can be undone one by one. The editor and the worker paint them with this same code.
import { CROP } from './geometry.ts'

/** `pts` are crop pixels (0..CROP) as [x0, y0, x1, y1, ...]; `r` is the brush radius in crop pixels. */
export type Stroke = { erase: boolean; r: number; pts: number[] }

/** Paint strokes into a `w`×`w` mask (0 / 255) that covers the crop at `w / CROP` pixels per crop pixel. */
export function paintStrokes(mask: Uint8Array, w: number, strokes: Stroke[]): void {
  for (const s of strokes) paintSegments(mask, w, s, 0)
}

/** Paint the part of one stroke from point `from` on (to extend a stroke that is being drawn). */
export function paintSegments(mask: Uint8Array, w: number, s: Stroke, from: number): void {
  const k = w / CROP
  const v = s.erase ? 0 : 255
  const r = s.r * k, r2 = r * r
  const n = s.pts.length / 2
  for (let i = Math.max(0, from - 1); i < Math.max(1, n - 1); i++) {
    const ax = s.pts[2 * i] * k, ay = s.pts[2 * i + 1] * k
    const bx = n > 1 ? s.pts[2 * i + 2] * k : ax, by = n > 1 ? s.pts[2 * i + 3] * k : ay
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(w - 1, Math.ceil(Math.max(ay, by) + r))
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const t = len2 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
        const qx = ax + t * dx - px, qy = ay + t * dy - py
        if (qx * qx + qy * qy <= r2) mask[y * w + x] = v
      }
    }
  }
}
