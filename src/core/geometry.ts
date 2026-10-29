// Template page geometry, shared by the template renderer and the photo pipeline.
// Canonical coordinates are pixels of an A4 page at 300 dpi; both sides must agree on every value.

export const DPI = 300
export const MM = DPI / 25.4
export const PAGE_W = 2480
export const PAGE_H = 3508

/**
 * Processing scale: every cell is resampled so its writing box is BOX px, whatever its printed size.
 * Extraction, tracing and the font-unit mapping only ever see this scale.
 */
export const BOX = 224
/** Crop inset that keeps the printed box border out of the ink. */
export const INSET = 10
export const CROP = BOX - 2 * INSET

export const MARK = Math.round(12 * MM)
export const MARK_MARGIN = Math.round(6 * MM)
export const QR_X = Math.round(163 * MM)
export const QR_Y = Math.round(7 * MM)
export const QR_SIZE = Math.round(22 * MM)
/** Middle band (보통·작게 layouts): two more markers and a second QR, so half a page can be photographed alone. */
export const MID_Y = Math.round(148.5 * MM)
export const MID_QR_SIZE = Math.round(16 * MM)
export const MID_QR_X = Math.round(PAGE_W / 2 - MID_QR_SIZE / 2)
export const MID_QR_Y = Math.round(MID_Y - MID_QR_SIZE / 2)

export type Kind = 'hangul' | 'latin'

/** How the writing box maps to font units: the box is U units tall and its top edge sits at TOP. */
export const KIND: Record<Kind, { U: number; TOP: number }> = {
  hangul: { U: 1000, TOP: 880 },
  latin: { U: 1200, TOP: 900 },
}

export type Pt = [number, number]

/** Marker ids: 0 TL, 1 TR, 2 BR, 3 BL, 4 middle-left, 5 middle-right. */
export function markerPos(id: number): Pt {
  const fx = PAGE_W - MARK_MARGIN - MARK, fy = PAGE_H - MARK_MARGIN - MARK, my = MID_Y - MARK / 2
  return ([[MARK_MARGIN, MARK_MARGIN], [fx, MARK_MARGIN], [fx, fy], [MARK_MARGIN, fy], [MARK_MARGIN, my], [fx, my]] as Pt[])[id]
}

/** Canonical corners of marker `id`, in the order ArUco reports them (TL, TR, BR, BL). */
export function markerCorners(id: number): Pt[] {
  const [x, y] = markerPos(id)
  return [[x, y], [x + MARK, y], [x + MARK, y + MARK], [x, y + MARK]]
}

export type LayoutId = 'L' | 'M' | 'S'

export type Layout = {
  id: LayoutId
  name: string
  boxMm: number
  /** Writing box edge in canonical px. */
  box: number
  /** Row pitch in canonical px (used to find neighbours). */
  pitch: number
  /** Size of the label printed above each box. */
  labelMm: number
  /** Resolution the printable PDF is rendered at. */
  renderDpi: number
  /** Has the middle band (markers 4-5, second QR). */
  mid: boolean
  /** Top-left corner of every writing box, in reading order. */
  slots: Pt[]
}

// 크게: the original 8×10 grid, unchanged so printed templates keep working
function legacySlots(): Pt[] {
  const gx = 12 * MM, gy = 40 * MM, cw = (186 / 8) * MM, ch = (236 / 10) * MM, label = 4 * MM
  return Array.from({ length: 80 }, (_, i) => {
    const r = Math.floor(i / 8), c = i % 8
    return [Math.round(gx + c * cw + (cw - BOX) / 2), Math.round(gy + r * ch + label)] as Pt
  })
}

// 보통·작게: a dense grid in two bands, above and below the middle band
function gridSlots(boxMm: number, gapXmm: number, labelMm: number, gapYmm: number): Pt[] {
  const pitchX = boxMm + gapXmm, pitchY = labelMm + boxMm + gapYmm
  const x0 = 12, x1 = 198
  const cols = Math.floor((x1 - x0 + gapXmm) / pitchX)
  const left = x0 + (x1 - x0 - (cols * pitchX - gapXmm)) / 2
  const out: Pt[] = []
  for (const [top, bottom] of [[38, 139], [158, 278]]) {
    const rows = Math.floor((bottom - top + gapYmm) / pitchY)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([(left + c * pitchX) * MM, (top + r * pitchY + labelMm) * MM])
  }
  return out
}

export const LAYOUTS: Record<LayoutId, Layout> = {
  L: { id: 'L', name: '크게', boxMm: 19, box: BOX, pitch: (236 / 10) * MM, labelMm: 3.4, renderDpi: 300, mid: false, slots: legacySlots() },
  M: { id: 'M', name: '보통', boxMm: 9.5, box: 9.5 * MM, pitch: 13.3 * MM, labelMm: 2.6, renderDpi: 400, mid: true, slots: gridSlots(9.5, 2.4, 3.0, 0.8) },
  S: { id: 'S', name: '작게', boxMm: 5, box: 5 * MM, pitch: 7.7 * MM, labelMm: 1.9, renderDpi: 400, mid: true, slots: gridSlots(5, 1.4, 2.2, 0.5) },
}

/**
 * Guide level (see the scanner's guideLevel) above which the printed guides came out as dark as ink, as in
 * black-and-white scans: they can no longer be told apart from the writing by darkness.
 */
export const GUIDE_LIKE_INK = 0.85

/** Width of the printed box border (canonical px); the template draws it and the scanner measures it. */
export const borderWidth = (lay: Layout) => (lay.id === 'L' ? 3 : Math.max(1.2, lay.box * 0.02))

/** Crop pixel (processing scale, relative to the inset crop) -> font units. */
export function cropToFont(kind: Kind, x: number, y: number): Pt {
  const k = KIND[kind]
  return [((x + INSET) * k.U) / BOX, k.TOP - ((y + INSET) * k.U) / BOX]
}

/**
 * Too blurry or too small for its cells: pen strokes would run together. Measured on simulated photos of 5 mm
 * cells, the traced shapes overlapped the written ones by about 89% when the blur (Gaussian sigma) was 2.2% of
 * a cell, 83% at 2.7% and 71% at 4%; below ~40 px per cell detail is lost however sharp the photo.
 */
export const photoTooSoft = (cellPx: number, blurPx: number) => cellPx < 40 || blurPx > 0.028 * cellPx
