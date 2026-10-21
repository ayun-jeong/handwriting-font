// Template page geometry, shared by the template renderer and the photo pipeline.
// Values are in pixels of an A4 page at 300 dpi and must stay identical on both sides.

export const DPI = 300
export const MM = DPI / 25.4
export const PAGE_W = 2480
export const PAGE_H = 3508
export const COLS = 8
export const ROWS = 10
export const CELLS = COLS * ROWS
const GX0 = 12 * MM
const GY0 = 40 * MM
const CW = (186 / COLS) * MM
const CH = (236 / ROWS) * MM
const LABEL = 4.0 * MM
/** Writing box edge (≈19 mm). */
export const BOX = 224
/** Crop inset that keeps the printed box border out of the ink. */
export const INSET = 10
export const CROP = BOX - 2 * INSET
export const MARK = Math.round(12 * MM)
export const MARK_MARGIN = Math.round(6 * MM)
export const QR_X = Math.round(163 * MM)
export const QR_Y = Math.round(7 * MM)
export const QR_SIZE = Math.round(22 * MM)

export type Kind = 'hangul' | 'latin'

/** How the writing box maps to font units: the box is U units tall and its top edge sits at TOP. */
export const KIND: Record<Kind, { U: number; TOP: number }> = {
  hangul: { U: 1000, TOP: 880 },
  latin: { U: 1200, TOP: 900 },
}

export type Pt = [number, number]

export function markerPos(id: number): Pt {
  const far = { x: PAGE_W - MARK_MARGIN - MARK, y: PAGE_H - MARK_MARGIN - MARK }
  return ([
    [MARK_MARGIN, MARK_MARGIN],
    [far.x, MARK_MARGIN],
    [far.x, far.y],
    [MARK_MARGIN, far.y],
  ] as Pt[])[id]
}

/** Canonical corners of marker `id`, in the order ArUco reports them (TL, TR, BR, BL). */
export function markerCorners(id: number): Pt[] {
  const [x, y] = markerPos(id)
  return [[x, y], [x + MARK, y], [x + MARK, y + MARK], [x, y + MARK]]
}

/** Top-left corner of writing box `i` (row-major). */
export function cellBox(i: number): Pt {
  const r = Math.floor(i / COLS)
  const c = i % COLS
  return [Math.round(GX0 + c * CW + (CW - BOX) / 2), Math.round(GY0 + r * CH + LABEL)]
}

/** Crop pixel (1x, relative to the inset crop) -> font units. */
export function cropToFont(kind: Kind, x: number, y: number): Pt {
  const k = KIND[kind]
  return [((x + INSET) * k.U) / BOX, k.TOP - ((y + INSET) * k.U) / BOX]
}
