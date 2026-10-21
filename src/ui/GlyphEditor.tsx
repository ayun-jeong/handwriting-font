import { useEffect, useRef } from 'react'
import { BOX, CROP, INSET, KIND } from '../core/geometry.ts'
import { examplesFor, isJamoKey, jamoLabel } from '../core/compose.ts'
import { NO_ADJUST, type GlyphAdjust, type Settings } from '../core/layout.ts'
import GlyphTile from './GlyphTile.tsx'
import type { GlyphRec } from '../project.ts'

type Props = {
  glyph: GlyphRec
  order: string[]
  settings: Settings
  adjust: GlyphAdjust
  family: string | null
  onChange: (a: GlyphAdjust) => void
  onGo: (char: string) => void
  onClose: () => void
}

export default function GlyphEditor({ glyph, order, settings, adjust, family, onChange, onGo, onClose }: Props) {
  const photo = useRef<HTMLCanvasElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const at = order.indexOf(glyph.char)
  const prev = at > 0 ? order[at - 1] : null
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null

  // the photo crop as the scanner saw it (paper white, ink dark), with the traced outline on top
  useEffect(() => {
    const c = photo.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(CROP, CROP)
    for (let i = 0; i < glyph.crop.length; i++) {
      const v = 255 - glyph.crop[i]
      img.data[4 * i] = v; img.data[4 * i + 1] = v; img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    const k = KIND[glyph.kind]
    const px = (x: number) => (x * BOX) / k.U - INSET
    const py = (y: number) => ((k.TOP - y) * BOX) / k.U - INSET
    ctx.strokeStyle = 'rgba(30,140,220,0.95)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (const o of glyph.outlines) {
      ctx.moveTo(px(o.segs[0][0][0]), py(o.segs[0][0][1]))
      for (const [, c1, c2, p] of o.segs) ctx.bezierCurveTo(px(c1[0]), py(c1[1]), px(c2[0]), py(c2[1]), px(p[0]), py(p[1]))
      ctx.closePath()
    }
    ctx.stroke()
  }, [glyph])

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && prev && !(e.target instanceof HTMLInputElement)) onGo(prev)
      if (e.key === 'ArrowRight' && next && !(e.target instanceof HTMLInputElement)) onGo(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onClose, onGo])

  const jamo = isJamoKey(glyph.char)
  const label = jamo ? jamoLabel(glyph.char) : glyph.char
  const set = (p: Partial<GlyphAdjust>) => onChange({ ...adjust, ...p })
  const sliders: { key: 'dx' | 'dy' | 'scale'; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
    { key: 'dx', label: '좌우 위치', min: -200, max: 200, step: 5, fmt: (v) => (v > 0 ? `+${v}` : String(v)) },
    { key: 'dy', label: '위아래 위치', min: -200, max: 200, step: 5, fmt: (v) => (v > 0 ? `+${v}` : String(v)) },
    { key: 'scale', label: '크기', min: 0.6, max: 1.4, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  ]

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ge-h" tabIndex={-1} ref={dialog}>
        <div className="dialog-head">
          <h3 id="ge-h">‘{label}’ 고치기</h3>
          <div className="dialog-nav">
            <button type="button" className="ghost" disabled={!prev} onClick={() => prev && onGo(prev)} aria-label="이전 글자">‹</button>
            <span className="hint">{at + 1} / {order.length}</span>
            <button type="button" className="ghost" disabled={!next} onClick={() => next && onGo(next)} aria-label="다음 글자">›</button>
            <button type="button" className="ghost" onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>

        <div className="editor">
          <figure>
            <canvas ref={photo} width={CROP} height={CROP} className="crop" aria-label="사진에서 읽은 칸과 따낸 윤곽" />
            <figcaption>사진 속 칸과 따낸 윤곽(파란 선)</figcaption>
          </figure>
          <figure>
            <GlyphTile glyph={glyph} settings={settings} adjust={adjust} className="crop result" />
            <figcaption>{jamo ? '조합에 쓰일 모양(연한 부분 = 나머지 자모 자리)' : '폰트에 들어갈 모양(옅은 띠 = 글자 폭)'}</figcaption>
          </figure>
        </div>

        <p className="in-context" style={{ fontFamily: family ? `"${family}", var(--font-ui)` : undefined }}>
          {jamo ? examplesFor(glyph.char).join(' ') : `${prev ?? ''}${glyph.char}${next ?? ''} ${glyph.char}${glyph.char}${glyph.char}`}
        </p>

        {sliders.map((it) => (
          <div key={it.key} className="slider">
            <label htmlFor={`ge-${it.key}`}>{it.label}</label>
            <input id={`ge-${it.key}`} type="range" min={it.min} max={it.max} step={it.step} value={adjust[it.key]} disabled={adjust.off} onChange={(e) => set({ [it.key]: Number(e.target.value) })} />
            <output htmlFor={`ge-${it.key}`}>{it.fmt(adjust[it.key])}</output>
          </div>
        ))}

        <div className="dialog-actions">
          <label className="check">
            <input id="ge-off" type="checkbox" checked={adjust.off} onChange={(e) => set({ off: e.target.checked })} />
            <span>이 글자는 폰트에서 빼기</span>
          </label>
          <button type="button" className="ghost" onClick={() => onChange({ ...NO_ADJUST })}>원래대로</button>
          <button type="button" className="primary" onClick={onClose}>완료</button>
        </div>
      </div>
    </div>
  )
}
