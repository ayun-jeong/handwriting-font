import { useCallback, useEffect, useMemo, useRef } from 'react'
import { paintSegments, paintStrokes, type Stroke } from '../core/brush.ts'
import { BOX, CROP, INSET, KIND, type Kind } from '../core/geometry.ts'
import type { Outline } from '../core/tracer.ts'

export type Tool = 'draw' | 'erase' | null

type Props = {
  /** CROP×CROP darkness of the cell, as the scanner read it. */
  crop: Uint8Array
  /** The scanner's ink mask (`w`×`w`), null mask = no ink found; null = still loading. */
  base: { mask: Uint8Array | null; w: number } | null
  strokes: Stroke[]
  /** Traced outlines currently in the font, drawn as a thin line. */
  outlines: Outline[]
  kind: Kind
  tool: Tool
  /** Brush diameter in crop pixels. */
  size: number
  onStroke: (s: Stroke) => void
}

const INK = [24, 29, 34]
const round1 = (v: number) => Math.round(Math.min(CROP, Math.max(0, v)) * 10) / 10

/** The glyph's ink over the faint photo; with a tool picked, rubbing on it adds or erases ink. */
export default function ShapeCanvas({ crop, base, strokes, outlines, kind, tool, size, onStroke }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const w = base?.w ?? CROP * 2

  // the scanner's mask with the saved strokes painted in: exactly what gets traced
  const committed = useMemo(() => {
    const m = base?.mask ? base.mask.slice() : new Uint8Array(w * w)
    paintStrokes(m, w, strokes)
    return m
  }, [base, strokes, w])

  // the photo, faint, to trace over
  const photo = useMemo(() => {
    const px = new Uint8ClampedArray(w * w * 4)
    const k = CROP / w
    for (let y = 0; y < w; y++) {
      const row = Math.floor(y * k) * CROP
      for (let x = 0; x < w; x++) {
        const v = 255 - Math.round(crop[row + Math.floor(x * k)] * 0.32)
        const i = (y * w + x) * 4
        px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255
      }
    }
    return px
  }, [crop, w])

  // the stroke being drawn, painted into its own copy of the mask; kept until the saved strokes include it
  const live = useRef<{ stroke: Stroke; mask: Uint8Array; done: boolean } | null>(null)
  const cursor = useRef<[number, number] | null>(null)

  const render = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const mask = live.current?.mask ?? committed
    const px = photo.slice()
    for (let i = 0; i < mask.length; i++) if (mask[i]) { px[4 * i] = INK[0]; px[4 * i + 1] = INK[1]; px[4 * i + 2] = INK[2] }
    ctx.putImageData(new ImageData(px, w, w), 0, 0)
    const s = w / CROP, k = KIND[kind]
    const fx = (x: number) => ((x * BOX) / k.U - INSET) * s
    const fy = (y: number) => (((k.TOP - y) * BOX) / k.U - INSET) * s
    ctx.strokeStyle = 'rgba(30,140,220,0.9)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (const o of outlines) {
      ctx.moveTo(fx(o.segs[0][0][0]), fy(o.segs[0][0][1]))
      for (const [, c1, c2, p] of o.segs) ctx.bezierCurveTo(fx(c1[0]), fy(c1[1]), fx(c2[0]), fy(c2[1]), fx(p[0]), fy(p[1]))
      ctx.closePath()
    }
    ctx.stroke()
    if (tool && cursor.current) {
      ctx.strokeStyle = tool === 'erase' ? 'rgba(200,60,50,0.9)' : 'rgba(30,140,220,0.9)'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(cursor.current[0] * s, cursor.current[1] * s, Math.max(1, (size / 2) * s), 0, 2 * Math.PI)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [committed, photo, outlines, kind, tool, size, w])

  useEffect(() => {
    if (live.current?.done) live.current = null
    render()
  }, [render])

  const toCrop = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * CROP, ((e.clientY - r.top) / r.height) * CROP]
  }

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool || !base) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = toCrop(e)
    const stroke: Stroke = { erase: tool === 'erase', r: size / 2, pts: [round1(x), round1(y)] }
    const mask = committed.slice()
    paintSegments(mask, w, stroke, 0)
    live.current = { stroke, mask, done: false }
    cursor.current = [x, y]
    render()
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toCrop(e)
    cursor.current = p
    const l = live.current
    if (l && !l.done) {
      const n = l.stroke.pts.length
      if (Math.hypot(p[0] - l.stroke.pts[n - 2], p[1] - l.stroke.pts[n - 1]) >= 0.6) {
        l.stroke.pts.push(round1(p[0]), round1(p[1]))
        paintSegments(l.mask, w, l.stroke, l.stroke.pts.length / 2 - 1)
      }
    }
    if (tool) render()
  }

  const up = () => {
    const l = live.current
    if (!l || l.done) return
    l.done = true
    onStroke(l.stroke)
  }

  return (
    <canvas
      ref={canvas}
      width={w}
      height={w}
      className={`shape-canvas${tool ? ` ${tool}` : ''}`}
      style={{ touchAction: tool ? 'none' : 'auto' }}
      aria-label="글자 모양: 검정은 폰트에 들어갈 잉크, 연한 회색은 사진 속 글씨"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => { cursor.current = null; if (tool) render() }}
    />
  )
}
