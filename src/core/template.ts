// Printable template pages (A4, 300 dpi) drawn on a canvas, then bundled into a PDF.
import qrcode from 'qrcode-generator'
import { PDFDocument } from 'pdf-lib'
import aruco from './data/aruco4x4.json' with { type: 'json' }
import type { PageDef } from './charsets.ts'
import { BOX, KIND, MARK, MM, PAGE_H, PAGE_W, QR_SIZE, QR_X, QR_Y, cellBox, markerPos } from './geometry.ts'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const GUIDE = 'rgb(110,185,235)'
const GUIDE_LIGHT = 'rgb(165,212,242)'
const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif'

function dashed(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  ctx.save()
  ctx.strokeStyle = GUIDE_LIGHT
  ctx.lineWidth = 2
  ctx.setLineDash([10, 8])
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

function drawQr(ctx: Ctx, text: string) {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  const n = q.getModuleCount()
  const quiet = 2
  const step = QR_SIZE / (n + 2 * quiet)
  ctx.fillStyle = '#fff'
  ctx.fillRect(QR_X, QR_Y, QR_SIZE, QR_SIZE)
  ctx.fillStyle = '#000'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c)) continue
    const x0 = Math.round(QR_X + (c + quiet) * step), x1 = Math.round(QR_X + (c + quiet + 1) * step)
    const y0 = Math.round(QR_Y + (r + quiet) * step), y1 = Math.round(QR_Y + (r + quiet + 1) * step)
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  }
}

export function drawTemplatePage(ctx: Ctx, page: PageDef, no: number, total: number) {
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  for (let id = 0; id < 4; id++) drawMarker(ctx, id)
  drawQr(ctx, page.id)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgb(20,20,20)'
  ctx.font = `600 ${Math.round(6 * MM)}px ${FONT}`
  ctx.fillText(`손글씨 폰트 템플릿 · ${page.title}`, Math.round(24 * MM), Math.round(13 * MM))
  ctx.fillStyle = 'rgb(90,90,90)'
  ctx.font = `400 ${Math.round(3 * MM)}px ${FONT}`
  const lines = [
    '검은색 사인펜이나 중성펜으로, 회색 글자를 하늘색 칸 안에 평소처럼 크게 써 주세요. 칸 밖으로 나가지 않게.',
    '사진은 그림자 없이 위에서, 네 모서리의 검은 표식과 QR이 모두 보이게 찍어 주세요. 하늘색 선은 자동으로 지워집니다.',
  ]
  if (page.kind === 'latin') lines.push('영문: 진한 하늘색 선이 글자의 바닥선입니다. 위의 점선 두 줄은 소문자 높이와 대문자 높이 기준입니다.')
  lines.forEach((t, k) => ctx.fillText(t, Math.round(24 * MM), Math.round((20 + 4.6 * k) * MM)))

  ctx.font = `400 ${Math.round(3.4 * MM)}px ${FONT}`
  page.chars.forEach((ch, i) => {
    const [x, y] = cellBox(i)
    ctx.fillStyle = 'rgb(140,140,140)'
    ctx.fillText(ch, x + 2, y - 8)
    ctx.strokeStyle = GUIDE
    ctx.lineWidth = 3
    ctx.strokeRect(x + 1.5, y + 1.5, BOX - 3, BOX - 3)
    if (page.kind === 'hangul') {
      dashed(ctx, x + BOX / 2, y + 6, x + BOX / 2, y + BOX - 6)
      dashed(ctx, x + 6, y + BOX / 2, x + BOX - 6, y + BOX / 2)
    } else {
      const k = KIND.latin
      const yb = y + (BOX * k.TOP) / k.U
      ctx.strokeStyle = GUIDE
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(x + 3, yb); ctx.lineTo(x + BOX - 4, yb); ctx.stroke()
      for (const units of [480, 700]) {
        const yy = y + (BOX * (k.TOP - units)) / k.U
        dashed(ctx, x + 6, yy, x + BOX - 6, yy)
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
  const canvas = new OffscreenCanvas(PAGE_W, PAGE_H)
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < pages.length; i++) {
    drawTemplatePage(ctx, pages[i], i + 1, pages.length)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    const p = pdf.addPage([595.28, 841.89])
    p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 })
    onPage?.(i + 1)
  }
  return pdf.save()
}
