// Photo of a filled template -> per-cell ink crops -> glyph outlines.
// Port of the measured Python spike: ArUco markers + homography, QR page id, per-cell border re-registration,
// green-channel darkness with page-adaptive thresholds.
import { pageFromQr, type PageDef } from './charsets.ts'
import type { CV } from './cv.ts'
import {
  BOX, CELLS, CROP, INSET, PAGE_H, PAGE_W, QR_SIZE, QR_X, QR_Y,
  cellBox, cropToFont, markerCorners, type Kind, type Pt,
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
  | { ok: true; page: PageDef; markers: number[]; ink: number; cells: InkCell[]; offsets: Pt[]; warped: RGBAImage }
  | { ok: false; reason: 'markers' | 'qr' | 'page'; markers: number[]; qr?: string }

const MAX_SIDE = 4200
const BG_SCALE = 4
const SEARCH = 16

/** Bilinear sample of a small background image (RGBA bytes, `w`×`h`) at full-page coordinates. */
function bgAt(bg: Uint8Array, w: number, h: number, x: number, y: number, ch: number): number {
  const fx = Math.min(Math.max(x / BG_SCALE - 0.5, 0), w - 1.001)
  const fy = Math.min(Math.max(y / BG_SCALE - 0.5, 0), h - 1.001)
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0
  const i00 = (y0 * w + x0) * 4 + ch, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4
  return (bg[i00] * (1 - ax) + bg[i10] * ax) * (1 - ay) + (bg[i01] * (1 - ax) + bg[i11] * ax) * ay
}

/** Darkness (0..1) of channel `ch` in a rectangle of the warped page, normalised by the local paper colour. */
function darkness(page: Uint8Array, bg: Uint8Array, bw: number, bh: number, x0: number, y0: number, w: number, h: number, ch: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const py = Math.min(Math.max(y0 + y, 0), PAGE_H - 1)
    for (let x = 0; x < w; x++) {
      const px = Math.min(Math.max(x0 + x, 0), PAGE_W - 1)
      const v = page[(py * PAGE_W + px) * 4 + ch]
      const b = Math.max(bgAt(bg, bw, bh, px, py, ch), 1)
      out[y * w + x] = 1 - Math.min(v / b, 1)
    }
  }
  return out
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((q / 100) * (s.length - 1)))]
}

function median(values: number[]): number {
  return percentile(values, 50)
}

function readQr(cv: CV, warped: CV): string {
  const qd = new cv.QRCodeDetector()
  const pad = 40
  const rect = new cv.Rect(QR_X - pad, QR_Y - pad, QR_SIZE + 2 * pad, QR_SIZE + 2 * pad)
  const roi = warped.roi(rect)
  const gray = new cv.Mat()
  try {
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY)
    const pts = new cv.Mat()
    const straight = new cv.Mat()
    const text: string = qd.detectAndDecode(gray, pts, straight)
    pts.delete(); straight.delete()
    return text || ''
  } finally {
    roi.delete(); gray.delete(); qd.delete()
  }
}

/** Per-cell offset of the printed box border from where the page homography puts it (paper curl). */
function registerCells(cv: CV, page: Uint8Array, bg: Uint8Array, bw: number, bh: number, count: number): Pt[] {
  const tm = cv.Mat.zeros(BOX, BOX, cv.CV_32F)
  cv.rectangle(tm, new cv.Point(1, 1), new cv.Point(BOX - 2, BOX - 2), new cv.Scalar(1), 3)
  const band = new cv.Mat()
  cv.dilate(tm, band, cv.Mat.ones(5, 5, cv.CV_8U))
  const raw: Pt[] = []
  const res = new cv.Mat()
  for (let i = 0; i < count; i++) {
    const [x, y] = cellBox(i)
    const size = BOX + 2 * SEARCH
    const win = darkness(page, bg, bw, bh, x - SEARCH, y - SEARCH, size, size, 0) // printed border is dark in red
    const m = cv.matFromArray(size, size, cv.CV_32F, win)
    cv.matchTemplate(m, tm, res, cv.TM_CCORR_NORMED, band)
    const r = cv.minMaxLoc(res)
    raw.push(r.maxVal > 0.3 ? [r.maxLoc.x - SEARCH, r.maxLoc.y - SEARCH] : [0, 0])
    m.delete()
  }
  tm.delete(); band.delete(); res.delete()
  // curl is smooth across the page: replace offsets that disagree with their 3×3 neighbourhood
  return raw.map(([dx, dy], i) => {
    const r = Math.floor(i / 8), c = i % 8
    const nb: Pt[] = []
    for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
      const j = rr * 8 + cc
      if (rr >= 0 && cc >= 0 && cc < 8 && j < count) nb.push(raw[j])
    }
    const mx = median(nb.map((p) => p[0])), my = median(nb.map((p) => p[1]))
    return Math.abs(dx - mx) <= 3 && Math.abs(dy - my) <= 3 ? [dx, dy] : [Math.round(mx), Math.round(my)]
  })
}

export function scanPage(cv: CV, img: RGBAImage): PageScan {
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

    const srcPts: number[] = [], dstPts: number[] = [], markers: number[] = []
    const idList: Int32Array = ids.data32S
    for (let i = 0; i < idList.length; i++) {
      const id = idList[i]
      if (id < 0 || id > 3 || markers.includes(id)) continue
      markers.push(id)
      const c = corners.get(i)
      const d: Float32Array = c.data32F
      markerCorners(id).forEach((q, k) => {
        srcPts.push(d[2 * k], d[2 * k + 1]); dstPts.push(q[0], q[1])
      })
      c.delete()
    }
    markers.sort()
    if (markers.length < 3) return { ok: false, reason: 'markers', markers }

    const n = srcPts.length / 2
    const sm = keep(cv.matFromArray(n, 1, cv.CV_32FC2, srcPts))
    const dm = keep(cv.matFromArray(n, 1, cv.CV_32FC2, dstPts))
    const H = keep(cv.findHomography(sm, dm, cv.RANSAC, 3.0))
    const warped = keep(new cv.Mat())
    cv.warpPerspective(src, warped, H, new cv.Size(PAGE_W, PAGE_H), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))

    const qr = readQr(cv, warped)
    if (!qr) return { ok: false, reason: 'qr', markers }
    const page = pageFromQr(qr)
    if (!page) return { ok: false, reason: 'page', markers, qr }

    // paper colour, estimated at quarter resolution: closing removes strokes, blur smooths lighting
    const small = keep(new cv.Mat())
    cv.resize(warped, small, new cv.Size(PAGE_W / BG_SCALE, Math.round(PAGE_H / BG_SCALE)), 0, 0, cv.INTER_AREA)
    const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11)))
    cv.morphologyEx(small, small, cv.MORPH_CLOSE, kernel)
    cv.GaussianBlur(small, small, new cv.Size(0, 0), 3)
    const bg = new Uint8Array(small.data)
    const bw = small.cols, bh = small.rows
    const pageData = new Uint8Array(warped.data)

    const count = Math.min(page.chars.length, CELLS)
    const offsets = registerCells(cv, pageData, bg, bw, bh, count)

    // ink level of this page: typical darkness of written strokes (pen colour, exposure)
    const levels: number[] = []
    const crops: Float32Array[] = []
    for (let i = 0; i < count; i++) {
      const [x, y] = cellBox(i)
      const d = darkness(pageData, bg, bw, bh, x + offsets[i][0] + INSET, y + offsets[i][1] + INSET, CROP, CROP, 1)
      crops.push(d)
      const ink: number[] = []
      for (const v of d) if (v > 0.12) ink.push(v)
      if (ink.length > 150) levels.push(percentile(ink, 95))
    }
    const ink = levels.length ? median(levels) : 0.8

    const cells: InkCell[] = crops.map((d, index) => {
      const crop = new Uint8Array(d.length)
      for (let k = 0; k < d.length; k++) crop[k] = Math.round(d[k] * 255)
      return { index, char: page.chars[index], kind: page.kind, crop }
    })
    return { ok: true, page, markers, ink, cells, offsets, warped: { data: pageData, width: PAGE_W, height: PAGE_H } }
  } finally {
    for (const m of mats) m.delete?.()
  }
}

/** Upsampling factor used for extraction and tracing (smoother edges than the 300 dpi grid). */
export const UPSAMPLE = 2

/**
 * Ink mask of one cell at UPSAMPLE resolution (0/255), or null if the cell is empty.
 * `weight` thickens (+) or thins (-) strokes by about one 300-dpi pixel per step.
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

/** All non-empty cells of a scanned page, traced. */
export function traceCells(cv: CV, scan: Extract<PageScan, { ok: true }>, weight = 0): { glyphs: CellGlyph[]; empties: InkCell[] } {
  const glyphs: CellGlyph[] = [], empties: InkCell[] = []
  for (const cell of scan.cells) {
    const mask = extractMask(cv, cell.crop, scan.ink, weight)
    if (!mask) { empties.push(cell); continue }
    const outlines = maskToOutlines(cv, mask, cell.kind)
    if (outlines.length) glyphs.push({ ...cell, outlines })
    else empties.push(cell)
  }
  return { glyphs, empties }
}
