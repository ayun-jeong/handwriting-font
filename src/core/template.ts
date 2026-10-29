// Printable template pages (A4) drawn on a canvas in canonical 300-dpi coordinates, then bundled into a PDF.
import qrcode from 'qrcode-generator'
import { PDFDocument } from 'pdf-lib'
import aruco from './data/aruco4x4.json' with { type: 'json' }
import type { PageDef } from './charsets.ts'
import { isJamoKey, jamoCell } from './compose.ts'
import { KIND, LAYOUTS, MARK, MID_QR_SIZE, MID_QR_X, MID_QR_Y, MID_Y, MM, PAGE_H, PAGE_W, QR_SIZE, QR_X, QR_Y, borderWidth, markerPos } from './geometry.ts'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// The box border is the darkest guide: the scanner finds the cells by it and measures how dark the guides came out.
const GUIDE = 'rgb(110,185,235)'
// Everything printed inside a cell is lighter, so that scan apps' contrast boost doesn't turn it into ink.
const BASELINE = 'rgb(150,205,240)'
const GUIDE_LIGHT = 'rgb(188,224,246)'
// Trace guides for jamo cells: the part to write, and the rest of the syllable for context.
const TRACE = 'rgb(176,218,245)'
const CONTEXT = 'rgb(232,243,251)'
const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif'

function dashed(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, dash: number) {
  ctx.save()
  ctx.strokeStyle = GUIDE_LIGHT
  ctx.lineWidth = width
  ctx.setLineDash([dash, dash * 0.8])
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
  ctx.restore()
}

function drawMarker(ctx: Ctx, id: number) {
  const [x, y] = markerPos(id)
  const rows = (aruco as Record<string, string[]>)[String(id)]
  const step = MARK / 6
  ctx.fillStyle = '#fff'
  ctx.fillRect(x, y, MARK, MARK)
  ctx.fillStyle = '#000'
  rows.forEach((row, r) => [...row].forEach((bit, c) => {
    if (bit !== '1') return
    const x0 = Math.round(x + c * step), x1 = Math.round(x + (c + 1) * step)
    const y0 = Math.round(y + r * step), y1 = Math.round(y + (r + 1) * step)
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  }))
}

function drawQr(ctx: Ctx, text: string, qx: number, qy: number, size: number) {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  const n = q.getModuleCount()
  const quiet = 2
  const step = size / (n + 2 * quiet)
  ctx.fillStyle = '#fff'
  ctx.fillRect(qx, qy, size, size)
  ctx.fillStyle = '#000'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c)) continue
    const x0 = Math.round(qx + (c + quiet) * step), x1 = Math.round(qx + (c + quiet + 1) * step)
    const y0 = Math.round(qy + (r + quiet) * step), y1 = Math.round(qy + (r + quiet + 1) * step)
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  }
}

function instructions(page: PageDef): string[] {
  const jamo = page.chars.some(isJamoKey)
  const hangul = page.kinds.some((k, i) => k === 'hangul' && !isJamoKey(page.chars[i]))
  const latin = page.kinds.includes('latin')
  if (page.layout !== 'L') {
    const out = ['검은색 사인펜이나 중성펜으로, 칸 위의 회색 글자를 칸 안에 평소 내 글씨 크기로 써 주세요.']
    if (jamo) out.push('자모 칸(하늘색 글자가 그려진 칸)은 진한 부분만 따라 쓰세요. 예: ‘ㄱ가’ 칸에는 가의 ㄱ만 씁니다.')
    out.push('한 장이 다 나오게 찍거나, 위·아래 반씩 가까이 찍어도 돼요(가운데 양쪽 표식이 보이게). 하늘색은 자동으로 지워집니다.')
    return out
  }
  const out = [
    '검은색 사인펜이나 중성펜으로, 회색 글자를 하늘색 칸 안에 평소처럼 크게 써 주세요. 칸 밖으로 나가지 않게.',
    '사진은 그림자 없이 위에서, 네 모서리의 검은 표식과 QR이 모두 보이게 찍어 주세요. 하늘색 선은 자동으로 지워집니다.',
  ]
  if (jamo) {
    out.splice(0, 1,
      '하늘색으로 진하게 그려진 부분만 그 위에 따라 쓰세요. 예: ‘ㄱ · 가’ 칸에는 가의 ㄱ만 씁니다.',
      '연한 부분은 위치 안내예요. 모양은 내 글씨대로, 위치와 크기는 안내에 맞춰 주세요. 검은 사인펜·중성펜으로.')
  }
  if (hangul && !jamo) out.splice(1, 0, '점선 네모가 글자 크기 기준이에요. 자모 쪽 안내 글자와 같은 크기로 쓰면 조합한 글자와 잘 어울려요.')
  if (latin) out.push('영문: 진한 하늘색 선이 글자의 바닥선입니다. 위의 점선 두 줄은 소문자 높이와 대문자 높이 기준입니다.')
  return out
}

/** Draw one page in canonical coordinates (the caller may scale the context for higher resolution). */
export function drawTemplatePage(ctx: Ctx, page: PageDef, no: number, total: number) {
  const lay = LAYOUTS[page.layout]
  const box = lay.box
  const dense = page.layout !== 'L'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  for (let id = 0; id < (lay.mid ? 6 : 4); id++) drawMarker(ctx, id)
  drawQr(ctx, page.id, QR_X, QR_Y, QR_SIZE)
  if (lay.mid) drawQr(ctx, page.id, MID_QR_X, MID_QR_Y, MID_QR_SIZE)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgb(20,20,20)'
  ctx.font = `600 ${Math.round(6 * MM)}px ${FONT}`
  ctx.fillText(`손글씨 폰트 템플릿 · ${page.title}`, Math.round(24 * MM), Math.round(13 * MM))
  ctx.fillStyle = 'rgb(90,90,90)'
  ctx.font = `400 ${Math.round(3 * MM)}px ${FONT}`
  instructions(page).forEach((t, k) => ctx.fillText(t, Math.round(24 * MM), Math.round((20 + 4.6 * k) * MM)))
  if (lay.mid) {
    ctx.font = `400 ${Math.round(2.6 * MM)}px ${FONT}`
    ctx.fillStyle = 'rgb(150,150,150)'
    ctx.textAlign = 'right'
    ctx.fillText('반씩 찍을 땐 가운데 양쪽 표식과 이 QR이 보이게', MID_QR_X - Math.round(4 * MM), MID_Y + Math.round(1 * MM))
    ctx.textAlign = 'left'
  }

  const lineW = borderWidth(lay)
  const dash = box * 0.045
  ctx.font = `400 ${Math.round(lay.labelMm * MM)}px ${FONT}`
  page.chars.forEach((ch, i) => {
    const slot = lay.slots[i]
    if (!slot) return
    const [x, y] = slot
    const kind = page.kinds[i]
    const cell = isJamoKey(ch) ? jamoCell(ch) : null
    ctx.fillStyle = 'rgb(140,140,140)'
    ctx.fillText(cell ? (dense ? `${cell.jamo}${cell.ctx}` : `${cell.jamo} · ${cell.ctx}`) : ch, x + (dense ? 0 : 2), y - (dense ? 0.35 * MM : 8))
    ctx.strokeStyle = GUIDE
    ctx.lineWidth = lineW
    ctx.strokeRect(x + lineW / 2, y + lineW / 2, box - lineW, box - lineW)
    if (cell) {
      const k = KIND.hangul
      ctx.save()
      ctx.translate(x, y + (box * k.TOP) / k.U)
      ctx.scale(box / k.U, -box / k.U)
      ctx.fillStyle = CONTEXT
      ctx.fill(new Path2D(cell.rest))
      ctx.fillStyle = TRACE
      ctx.fill(new Path2D(cell.target))
      ctx.restore()
    } else if (kind === 'hangul') {
      if (!dense) {
        dashed(ctx, x + box / 2, y + 6, x + box / 2, y + box - 6, 2, dash)
        dashed(ctx, x + 6, y + box / 2, x + box - 6, y + box / 2, 2, dash)
      }
      if (page.layout !== 'S') {
        // size frame: the same area the jamo guides fill, so written and assembled syllables come out alike
        const k = KIND.hangul, u = box / k.U, w = dense ? lineW : 2
        const [fx0, fy0, fx1, fy1] = [90 * u, (k.TOP - 810) * u, 910 * u, (k.TOP + 50) * u]
        dashed(ctx, x + fx0, y + fy0, x + fx1, y + fy0, w, dash); dashed(ctx, x + fx1, y + fy0, x + fx1, y + fy1, w, dash)
        dashed(ctx, x + fx1, y + fy1, x + fx0, y + fy1, w, dash); dashed(ctx, x + fx0, y + fy1, x + fx0, y + fy0, w, dash)
      }
    } else {
      const k = KIND.latin
      const yb = y + (box * k.TOP) / k.U
      ctx.strokeStyle = BASELINE
      ctx.lineWidth = lineW
      ctx.beginPath(); ctx.moveTo(x + lineW, yb); ctx.lineTo(x + box - lineW, yb); ctx.stroke()
      for (const units of [480, 700]) {
        const yy = y + (box * (k.TOP - units)) / k.U
        dashed(ctx, x + box * 0.03, yy, x + box * 0.97, yy, dense ? lineW * 0.8 : 2, dash)
      }
    }
  })
  ctx.fillStyle = 'rgb(160,160,160)'
  ctx.font = `400 ${Math.round(3 * MM)}px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(`${no} / ${total} · ${page.id}`, PAGE_W - Math.round(24 * MM), PAGE_H - Math.round(8 * MM))
  ctx.textAlign = 'left'
}

/** Render pages and bundle them into an A4 PDF. Browser only (needs OffscreenCanvas). */
export async function templatePdf(pages: PageDef[], onPage?: (done: number) => void): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('손글씨 폰트 템플릿')
  const scale = LAYOUTS[pages[0]?.layout ?? 'L'].renderDpi / 300
  const canvas = new OffscreenCanvas(Math.round(PAGE_W * scale), Math.round(PAGE_H * scale))
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < pages.length; i++) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawTemplatePage(ctx, pages[i], i + 1, pages.length)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    const p = pdf.addPage([595.28, 841.89])
    p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 })
    onPage?.(i + 1)
  }
  return pdf.save()
}
