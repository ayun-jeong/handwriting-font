// Bitmap -> smooth cubic outlines, without potrace (GPL): OpenCV contours, Gaussian smoothing,
// corner detection, then Schneider curve fitting (fit-curve, MIT) between corners.
import fitCurve from 'fit-curve'
import type { CV } from './cv.ts'
import type { Pt } from './geometry.ts'

export type Cubic = [Pt, Pt, Pt, Pt]
/** One closed outline. `hole` marks a counter (the inside of ㅇ, ㅁ, o...). */
export type Outline = { hole: boolean; segs: Cubic[] }

export type TraceOptions = {
  /** Gaussian smoothing of contour points, in mask pixels. */
  smooth: number
  /** Max distance between fitted curve and contour, in mask pixels. */
  maxError: number
  /** Turning angle (radians) above which a point is a corner. */
  cornerAngle: number
  /** Neighbourhood (points) used to measure the turning angle. */
  cornerSpan: number
  /** Contours enclosing less area than this (mask px²) are dropped. */
  minArea: number
}

export const DEFAULT_TRACE: TraceOptions = { smooth: 1.2, maxError: 1.0, cornerAngle: 0.95, cornerSpan: 4, minArea: 30 }

function signedArea(p: Pt[]): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]
  return a / 2
}

function smooth(p: Pt[], sigma: number): Pt[] {
  if (sigma <= 0) return p
  const r = Math.ceil(sigma * 3)
  const w: number[] = []
  let sum = 0
  for (let k = -r; k <= r; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma))
    w.push(v); sum += v
  }
  const n = p.length
  return p.map((_, i) => {
    let x = 0, y = 0
    for (let k = -r; k <= r; k++) {
      const q = p[(i + k + n) % n]
      x += q[0] * w[k + r]; y += q[1] * w[k + r]
    }
    return [x / sum, y / sum] as Pt
  })
}

/**
 * OpenCV contours run through the centres of boundary pixels, half a pixel inside the ink.
 * Push every point half a pixel away from the ink so stroke width is preserved.
 */
function towardPaper(p: Pt[], hole: boolean, amount: number): Pt[] {
  const s = Math.sign(signedArea(p)) * (hole ? -1 : 1)
  const n = p.length
  return p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n]
    const tx = b[0] - a[0], ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    return [q[0] + (s * ty * amount) / len, q[1] - (s * tx * amount) / len] as Pt
  })
}

function turning(p: Pt[], i: number, k: number): number {
  const n = p.length
  const a = p[(i - k + n) % n], b = p[i], c = p[(i + k) % n]
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1]
  return Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y))
}

function findCorners(p: Pt[], o: TraceOptions): number[] {
  const n = p.length
  const k = Math.min(o.cornerSpan, Math.floor(n / 4))
  if (k < 2) return []
  const t = p.map((_, i) => turning(p, i, k))
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (t[i] < o.cornerAngle) continue
    let peak = true
    for (let j = -k; j <= k && peak; j++) {
      if (j === 0) continue
      const v = t[(i + j + n) % n]
      if (v > t[i] || (v === t[i] && j < 0)) peak = false
    }
    if (peak) out.push(i)
  }
  return out
}

function lineCubic(a: Pt, b: Pt): Cubic {
  return [a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b]
}

function fitOpen(pts: Pt[], maxError: number): Cubic[] {
  const clean: Pt[] = []
  for (const q of pts) {
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-6) clean.push(q)
  }
  if (clean.length < 2) return []
  if (clean.length === 2) return [lineCubic(clean[0], clean[1])]
  return fitCurve(clean, maxError) as Cubic[]
}

function fitClosed(p: Pt[], o: TraceOptions): Cubic[] {
  const n = p.length
  let cuts = findCorners(p, o)
  if (cuts.length === 0) {
    // no corner: split where the curve bends most and on the opposite side, so the seams are least visible
    const k = Math.max(2, Math.min(o.cornerSpan, Math.floor(n / 4)))
    let best = 0, bv = -1
    for (let i = 0; i < n; i++) {
      const v = turning(p, i, k)
      if (v > bv) { bv = v; best = i }
    }
    cuts = [best, (best + Math.floor(n / 2)) % n].sort((a, b) => a - b)
  } else if (cuts.length === 1) {
    cuts = [cuts[0], (cuts[0] + Math.floor(n / 2)) % n].sort((a, b) => a - b)
  }
  const segs: Cubic[] = []
  for (let c = 0; c < cuts.length; c++) {
    const from = cuts[c]
    const to = cuts[(c + 1) % cuts.length]
    const span = (to - from + n) % n || n
    const run: Pt[] = []
    for (let k = 0; k <= span; k++) run.push(p[(from + k) % n])
    segs.push(...fitOpen(run, o.maxError))
  }
  return segs
}

/**
 * Trace a binary mask (0 / 255, row-major, `w`×`h`) into closed cubic outlines in mask pixel coordinates.
 * `cv` is an initialised OpenCV.js module.
 */
export function traceMask(cv: CV, mask: Uint8Array, w: number, h: number, o: TraceOptions = DEFAULT_TRACE): Outline[] {
  const src = cv.matFromArray(h, w, cv.CV_8UC1, mask)
  const contours = new cv.MatVector()
  const hier = new cv.Mat()
  const out: Outline[] = []
  try {
    cv.findContours(src, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE)
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const d: Int32Array = c.data32S
      const pts: Pt[] = []
      for (let k = 0; k < d.length; k += 2) pts.push([d[k], d[k + 1]])
      c.delete()
      if (pts.length < 6 || Math.abs(signedArea(pts)) < o.minArea) continue
      const hole = hier.data32S[i * 4 + 3] !== -1
      const segs = fitClosed(towardPaper(smooth(pts, o.smooth), hole, 0.5), o)
      if (segs.length) out.push({ hole, segs })
    }
  } finally {
    src.delete(); contours.delete(); hier.delete()
  }
  return out
}

export function mapOutlines(outlines: Outline[], f: (p: Pt) => Pt): Outline[] {
  return outlines.map((o) => ({ hole: o.hole, segs: o.segs.map((s) => s.map(f) as Cubic) }))
}
