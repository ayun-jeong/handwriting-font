// Photo of a filled template -> per-cell ink crops -> glyph outlines.
// ArUco markers give the page homography; the QR says which template page (and layout) this is; every cell is
// then warped straight out of the photo at the processing scale, so small printed cells keep all the detail
// the photo has. Borders are re-registered per cell (paper curl), ink is read from the green channel with
// page-adaptive thresholds.
import { pageFromQr, type PageDef } from './charsets.ts'
import type { CV } from './cv.ts'
import {
  BOX, CROP, INSET, LAYOUTS, MID_QR_SIZE, MID_QR_X, MID_QR_Y, MM, PAGE_H, PAGE_W, QR_SIZE, QR_X, QR_Y,
  cropToFont, markerCorners, type Kind, type Layout, type Pt,
} from './geometry.ts'
import { mapOutlines, traceMask, type Outline } from './tracer.ts'

export type RGBAImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export type InkCell = {
  index: number
  char: string
  kind: Kind
  /** CROP×CROP green-channel darkness, 0 (paper) .. 255 (ink). Kept so weight changes can re-threshold. */
  crop: Uint8Array
}

export type PageScan =
  | {
      ok: true; page: PageDef; markers: number[]; ink: number
      /** Cells fully inside the photo, in slot order. */
      cells: InkCell[]
      /** Per slot: was it inside the photo. */
      visible: boolean[]
      /** The page at OVERVIEW scale, for showing what was recognised. */
      overview: RGBAImage
      /** Photo pixels across one cell (median over the visible cells); see photoTooSoft. */
      cellPx: number
      /** Blur of the photo (Gaussian sigma in photo pixels), measured on the edges of the markers. */
      blurPx: number
    }
  | { ok: false; reason: 'markers' | 'qr' | 'page'; markers: number[]; qr?: string }

const MAX_SIDE = 5000
const BG_SCALE = 4
export const OVERVIEW = 0.5
const SEARCH_MM = 1.4

type M3 = number[] // row-major 3×3

const mul = (a: M3, b: M3): M3 => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]))

function invert(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det)
}

const apply = (m: M3, [x, y]: Pt): Pt => {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

/** Photo -> window: canonical region starting at (ox, oy), sampled at `s` window px per canonical px. */
const windowOf = (H: M3, s: number, ox: number, oy: number): M3 => mul([s, 0, -s * ox, 0, s, -s * oy, 0, 0, 1], H)

function warp(cv: CV, src: CV, m: M3, w: number, h: number, interp: number): CV {
  const mm = cv.matFromArray(3, 3, cv.CV_64F, m)
  const out = new cv.Mat()
  cv.warpPerspective(src, out, mm, new cv.Size(w, h), interp, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))
  mm.delete()
  return out
}

/** Bilinear sample of the background map (RGBA bytes, `w`×`h`, canonical / BG_SCALE) at canonical coordinates. */
function bgAt(bg: Uint8Array, w: number, h: number, x: number, y: number, ch: number): number {
  const fx = Math.min(Math.max(x / BG_SCALE - 0.5, 0), w - 1.001)
  const fy = Math.min(Math.max(y / BG_SCALE - 0.5, 0), h - 1.001)
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0
  const i00 = (y0 * w + x0) * 4 + ch, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4
  return (bg[i00] * (1 - ax) + bg[i10] * ax) * (1 - ay) + (bg[i01] * (1 - ax) + bg[i11] * ax) * ay
}

type Bg = { data: Uint8Array; w: number; h: number }

/** Darkness (0..1) of channel `ch` of a window, normalised by the local paper colour. */
function darkness(win: Uint8Array, size: number, bg: Bg, ox: number, oy: number, s: number, ch: number): Float32Array {
  const out = new Float32Array(size * size)
  for (let v = 0; v < size; v++) {
    const cy = oy + (v + 0.5) / s
    for (let u = 0; u < size; u++) {
      const b = Math.max(bgAt(bg.data, bg.w, bg.h, ox + (u + 0.5) / s, cy, ch), 1)
      out[v * size + u] = 1 - Math.min(win[(v * size + u) * 4 + ch] / b, 1)
    }
  }
  return out
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((q / 100) * (s.length - 1)))]
}

const median = (values: number[]) => percentile(values, 50)

function readQr(cv: CV, src: CV, H: M3): string {
  const qd = new cv.QRCodeDetector()
  try {
    for (const [x, y, size, s] of [[QR_X, QR_Y, QR_SIZE, 1], [MID_QR_X, MID_QR_Y, MID_QR_SIZE, 1.5], [QR_X, QR_Y, QR_SIZE, 2]]) {
      const pad = 40
      const w = Math.round((size + 2 * pad) * s)
      const win = warp(cv, src, windowOf(H, s, x - pad, y - pad), w, w, cv.INTER_LINEAR)
      const gray = new cv.Mat(), pts = new cv.Mat(), straight = new cv.Mat()
      cv.cvtColor(win, gray, cv.COLOR_RGBA2GRAY)
      const text: string = qd.detectAndDecode(gray, pts, straight)
      win.delete(); gray.delete(); pts.delete(); straight.delete()
      if (text) return text
    }
    return ''
  } finally {
    qd.delete()
  }
}

/**
 * Photo blur as a Gaussian sigma (photo px): median 10-90% rise distance across the outer edges of the markers,
 * which are black (one module deep) on white paper.
 */
function edgeBlur(gray: Uint8Array, w: number, h: number, quads: Pt[][]): number {
  const at = (x: number, y: number) => {
    const fx = Math.min(Math.max(x, 0), w - 1.001), fy = Math.min(Math.max(y, 0), h - 1.001)
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, i = y0 * w + x0
    return (gray[i] * (1 - ax) + gray[i + 1] * ax) * (1 - ay) + (gray[i + w] * (1 - ax) + gray[i + w + 1] * ax) * ay
  }
  const STEP = 0.25
  const widths: number[] = []
  for (const q of quads) {
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4
    const side = q.reduce((a, p, k) => a + Math.hypot(q[(k + 1) % 4][0] - p[0], q[(k + 1) % 4][1] - p[1]), 0) / 4
    const reach = Math.max(4, (side / 6) * 0.8) // stays inside the black border module
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4]
      const len = Math.hypot(bx - ax, by - ay)
      let nx = -(by - ay) / len, ny = (bx - ax) / len
      if (((ax + bx) / 2 - cx) * nx + ((ay + by) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny }
      for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t
        const prof: number[] = []
        for (let s = -reach; s <= reach; s += STEP) prof.push(at(px + nx * s, py + ny * s))
        const lo = median(prof.slice(0, 8)), hi = median(prof.slice(-8))
        if (hi - lo < 40) continue
        const cross = (f: number) => {
          const v = lo + f * (hi - lo)
          for (let j = 1; j < prof.length; j++) if (prof[j - 1] < v && prof[j] >= v) return (j - 1 + (v - prof[j - 1]) / (prof[j] - prof[j - 1])) * STEP
          return NaN
        }
        const d = cross(0.9) - cross(0.1)
        if (d > 0) widths.push(d)
      }
    }
  }
  return widths.length ? median(widths) / 2.563 : 0
}

/** The printed border's offset from where the homography puts it, per cell (paper curl), in canonical px. */
function registerCells(cv: CV, src: CV, H: M3, bg: Bg, lay: Layout, cells: number[]): Map<number, Pt> {
  const { slots, box } = lay
  // a modest resolution is enough to find the border; the ink is read later at full processing scale
  const s = Math.min(BOX / box, 1.5)
  const b = Math.round(box * s)
  const R = Math.round(SEARCH_MM * MM * s)
  const W = b + 2 * R
  const tm = cv.Mat.zeros(b, b, cv.CV_32F)
  cv.rectangle(tm, new cv.Point(1, 1), new cv.Point(b - 2, b - 2), new cv.Scalar(1), Math.max(2, Math.round(b / 75)))
  const band = new cv.Mat(), k = cv.Mat.ones(5, 5, cv.CV_8U), res = new cv.Mat()
  cv.dilate(tm, band, k)
  const raw = new Map<number, Pt>()
  for (const i of cells) {
    const [x, y] = slots[i]
    const ox = x - R / s, oy = y - R / s
    const win = warp(cv, src, windowOf(H, s, ox, oy), W, W, cv.INTER_LINEAR)
    const d = darkness(win.data, W, bg, ox, oy, s, 0) // the printed border is dark in red
    win.delete()
    const m = cv.matFromArray(W, W, cv.CV_32F, d)
    cv.matchTemplate(m, tm, res, cv.TM_CCORR_NORMED, band)
    const r = cv.minMaxLoc(res)
    raw.set(i, r.maxVal > 0.3 ? [(r.maxLoc.x - R) / s, (r.maxLoc.y - R) / s] : [0, 0])
    m.delete()
  }
  tm.delete(); band.delete(); k.delete(); res.delete()
  // curl is smooth across the page: replace offsets that disagree with their neighbours
  const reach = 1.5 * lay.pitch // the cell itself and its 8 neighbours
  const out = new Map<number, Pt>()
  for (const [i, [dx, dy]] of raw) {
    const [x, y] = slots[i]
    const nb = [...raw].filter(([j]) => Math.hypot(slots[j][0] - x, slots[j][1] - y) <= reach).map(([, o]) => o)
    const mx = median(nb.map((p) => p[0])), my = median(nb.map((p) => p[1]))
    out.set(i, Math.abs(dx - mx) <= 3 && Math.abs(dy - my) <= 3 ? [dx, dy] : [mx, my])
  }
  return out
}

/** Share of the work done, 0..1 (reading cells is about the first 30%, tracing them the rest). */
export type Progress = (done: number) => void

export function scanPage(cv: CV, img: RGBAImage, progress?: Progress): PageScan {
  const mats: CV[] = []
  const keep = <T>(m: T): T => { mats.push(m); return m }
  try {
    let src = keep(cv.matFromImageData({ data: img.data, width: img.width, height: img.height }))
    const side = Math.max(img.width, img.height)
    if (side > MAX_SIDE) {
      const small = keep(new cv.Mat())
      const f = MAX_SIDE / side
      cv.resize(src, small, new cv.Size(Math.round(img.width * f), Math.round(img.height * f)), 0, 0, cv.INTER_AREA)
      src = small
    }
    const gray = keep(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    const dict = keep(cv.getPredefinedDictionary(cv.DICT_4X4_50))
    const params = keep(new cv.aruco_DetectorParameters())
    const refine = keep(new cv.aruco_RefineParameters(10, 3, true))
    const detector = keep(new cv.aruco_ArucoDetector(dict, params, refine))
    const corners = keep(new cv.MatVector())
    const ids = keep(new cv.Mat())
    const rejected = keep(new cv.MatVector())
    detector.detectMarkers(gray, corners, ids, rejected)

    const srcPts: number[] = [], dstPts: number[] = [], markers: number[] = [], quads: Pt[][] = []
    const idList: Int32Array = ids.data32S
    for (let i = 0; i < idList.length; i++) {
      const id = idList[i]
      if (id < 0 || id > 5 || markers.includes(id)) continue
      markers.push(id)
      const c = corners.get(i)
      const d: Float32Array = c.data32F
      markerCorners(id).forEach((q, k) => {
        srcPts.push(d[2 * k], d[2 * k + 1]); dstPts.push(q[0], q[1])
      })
      quads.push([0, 1, 2, 3].map((k): Pt => [d[2 * k], d[2 * k + 1]]))
      c.delete()
    }
    markers.sort()
    if (markers.length < 3) return { ok: false, reason: 'markers', markers }

    const n = srcPts.length / 2
    const sm = keep(cv.matFromArray(n, 1, cv.CV_32FC2, srcPts))
    const dm = keep(cv.matFromArray(n, 1, cv.CV_32FC2, dstPts))
    const Hm = keep(cv.findHomography(sm, dm, cv.RANSAC, 3.0))
    const H: M3 = Array.from(Hm.data64F as Float64Array)
    const Hinv = invert(H)

    const qr = readQr(cv, src, H)
    if (!qr) return { ok: false, reason: 'qr', markers }
    const page = pageFromQr(qr)
    if (!page) return { ok: false, reason: 'page', markers, qr }
    const lay = LAYOUTS[page.layout]

    // paper colour at quarter resolution: closing removes strokes and print, blur smooths the lighting
    const bgMat = keep(warp(cv, src, windowOf(H, 1 / BG_SCALE, 0, 0), Math.round(PAGE_W / BG_SCALE), Math.round(PAGE_H / BG_SCALE), cv.INTER_AREA))
    const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11)))
    cv.morphologyEx(bgMat, bgMat, cv.MORPH_CLOSE, kernel)
    cv.GaussianBlur(bgMat, bgMat, new cv.Size(0, 0), 3)
    const bg: Bg = { data: new Uint8Array(bgMat.data), w: bgMat.cols, h: bgMat.rows }
    const ov = keep(warp(cv, src, windowOf(H, OVERVIEW, 0, 0), Math.round(PAGE_W * OVERVIEW), Math.round(PAGE_H * OVERVIEW), cv.INTER_AREA))
    const overview: RGBAImage = { data: new Uint8Array(ov.data), width: ov.cols, height: ov.rows }

    // which cells are entirely inside the photo (a photo may show only half the page)
    const count = Math.min(page.chars.length, lay.slots.length)
    const margin = SEARCH_MM * MM + 2
    const visible = Array.from({ length: count }, (_, i) => {
      const [x, y] = lay.slots[i]
      return ([[x - margin, y - margin], [x + lay.box + margin, y - margin], [x + lay.box + margin, y + lay.box + margin], [x - margin, y + lay.box + margin]] as Pt[])
        .every((p) => { const [u, v] = apply(Hinv, p); return u >= 1 && v >= 1 && u <= src.cols - 2 && v <= src.rows - 2 })
    })
    const shown = visible.flatMap((v, i) => (v ? [i] : []))
    const offsets = registerCells(cv, src, H, bg, lay, shown)
    progress?.(0.1)
    const cellPx = median(shown.map((i) => {
      const [x, y] = lay.slots[i]
      const [p, q, r] = ([[x, y], [x + lay.box, y], [x, y + lay.box]] as Pt[]).map((c) => apply(Hinv, c))
      return Math.sqrt(Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])))
    }))

    // read each visible cell at the processing scale (box = BOX px)
    const s = BOX / lay.box
    const crops = new Map<number, Float32Array>()
    const levels: number[] = []
    for (const [n, i] of shown.entries()) {
      if (n % 40 === 39) progress?.(0.1 + (0.2 * n) / shown.length)
      const [x, y] = lay.slots[i]
      const [dx, dy] = offsets.get(i)!
      const ox = x + dx + INSET / s, oy = y + dy + INSET / s
      const win = warp(cv, src, windowOf(H, s, ox, oy), CROP, CROP, cv.INTER_CUBIC)
      const d = darkness(win.data, CROP, bg, ox, oy, s, 1)
      win.delete()
      crops.set(i, d)
      const ink: number[] = []
      for (const v of d) if (v > 0.12) ink.push(v)
      if (ink.length > 150) levels.push(percentile(ink, 95))
    }
    // ink level of this page: typical darkness of written strokes (pen colour, exposure)
    const ink = levels.length ? median(levels) : 0.8

    const cells: InkCell[] = shown.map((index) => {
      const d = crops.get(index)!
      const crop = new Uint8Array(d.length)
      for (let k = 0; k < d.length; k++) crop[k] = Math.round(d[k] * 255)
      return { index, char: page.chars[index], kind: page.kinds[index], crop }
    })
    const blurPx = edgeBlur(new Uint8Array(gray.data), gray.cols, gray.rows, quads)
    return { ok: true, page, markers, ink, cells, visible, overview, cellPx, blurPx }
  } finally {
    for (const m of mats) m.delete?.()
  }
}

/** Upsampling factor used for extraction and tracing (smoother edges than the processing grid). */
export const UPSAMPLE = 2

/**
 * Ink mask of one cell at UPSAMPLE resolution (0/255), or null if the cell is empty.
 * `weight` thickens (+) or thins (-) strokes by about one processing pixel per step.
 */
export function extractMask(cv: CV, crop: Uint8Array, ink: number, weight = 0): Uint8Array | null {
  const S = UPSAMPLE, W = CROP * S
  const candT = Math.max(0.12, 0.3 * ink)
  const seedT = Math.max(0.2, 0.55 * ink)
  const m8 = cv.matFromArray(CROP, CROP, cv.CV_8UC1, crop)
  const f = new cv.Mat(), up = new cv.Mat(), bin = new cv.Mat(), labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat()
  try {
    m8.convertTo(f, cv.CV_32F, 1 / 255)
    cv.resize(f, up, new cv.Size(W, W), 0, 0, cv.INTER_CUBIC)
    cv.GaussianBlur(up, up, new cv.Size(0, 0), 0.7 * S)
    const d: Float32Array = up.data32F
    const cand: number[] = []
    for (const v of d) if (v > candT) cand.push(v)
    if (cand.length < 60 * S * S) return null
    const thr = Math.min(Math.max(0.5 * percentile(cand, 90), candT), 0.5)
    const mask = new Uint8Array(W * W)
    for (let k = 0; k < d.length; k++) mask[k] = d[k] > thr ? 255 : 0
    const mm = cv.matFromArray(W, W, cv.CV_8UC1, mask)
    const nLab = cv.connectedComponentsWithStats(mm, labels, stats, cents, 8, cv.CV_32S)
    mm.delete()
    const lab: Int32Array = labels.data32S
    const peak = new Float32Array(nLab)
    for (let k = 0; k < lab.length; k++) if (lab[k] > 0 && d[k] > peak[lab[k]]) peak[lab[k]] = d[k]
    const st: Int32Array = stats.data32S
    const keepLab = new Uint8Array(nLab)
    for (let l = 1; l < nLab; l++) keepLab[l] = st[l * 5 + 4] >= 40 * S * S && peak[l] > seedT ? 1 : 0
    let total = 0
    for (let k = 0; k < lab.length; k++) {
      mask[k] = keepLab[lab[k]] ? 255 : 0
      if (mask[k]) total++
    }
    if (total < 80 * S * S) return null
    if (weight !== 0) {
      const r = Math.abs(weight) * S
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1))
      const mw = cv.matFromArray(W, W, cv.CV_8UC1, mask)
      if (weight > 0) cv.dilate(mw, bin, kernel); else cv.erode(mw, bin, kernel)
      mask.set(bin.data)
      mw.delete(); kernel.delete()
    }
    return mask
  } finally {
    m8.delete(); f.delete(); up.delete(); bin.delete(); labels.delete(); stats.delete(); cents.delete()
  }
}

/** Mask (UPSAMPLE resolution) -> outlines in font units. */
export function maskToOutlines(cv: CV, mask: Uint8Array, kind: Kind): Outline[] {
  const W = CROP * UPSAMPLE
  // contour points are pixel indices at UPSAMPLE scale; +0.5 converts index to continuous (pixel-edge) coordinates
  return mapOutlines(traceMask(cv, mask, W, W), ([x, y]) => cropToFont(kind, (x + 0.5) / UPSAMPLE, (y + 0.5) / UPSAMPLE))
}

export type CellGlyph = InkCell & { outlines: Outline[] }

/** All non-empty visible cells of a scanned page, traced. */
export function traceCells(cv: CV, scan: Extract<PageScan, { ok: true }>, weight = 0, progress?: Progress): { glyphs: CellGlyph[]; empties: InkCell[] } {
  const glyphs: CellGlyph[] = [], empties: InkCell[] = []
  for (const [n, cell] of scan.cells.entries()) {
    if (n % 20 === 19) progress?.(0.3 + (0.7 * n) / scan.cells.length)
    const mask = extractMask(cv, cell.crop, scan.ink, weight)
    if (!mask) { empties.push(cell); continue }
    const outlines = maskToOutlines(cv, mask, cell.kind)
    if (outlines.length) glyphs.push({ ...cell, outlines })
    else empties.push(cell)
  }
  return { glyphs, empties }
}
