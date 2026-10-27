import { useEffect, useRef, useState } from 'react'
import type { Stroke } from '../core/brush.ts'
import { examplesFor, isJamoKey, jamoLabel } from '../core/compose.ts'
import { NO_ADJUST, type GlyphAdjust, type Settings } from '../core/layout.ts'
import { request } from '../engine.ts'
import type { GlyphRec } from '../project.ts'
import GlyphTile from './GlyphTile.tsx'
import ShapeCanvas, { type Tool } from './ShapeCanvas.tsx'

type Props = {
  glyph: GlyphRec
  order: string[]
  settings: Settings
  adjust: GlyphAdjust
  /** Offset from autoAlign. */
  auto: number
  /** Stroke weight the glyph's outlines are traced at. */
  weight: number
  family: string | null
  tool: Tool
  setTool: (t: Tool) => void
  brush: number
  setBrush: (n: number) => void
  onChange: (a: GlyphAdjust) => void
  /** Saves hand corrections; the parent re-traces the glyph with them. */
  onStrokes: (s: Stroke[]) => void
  onGo: (char: string) => void
  onClose: () => void
}

/** Opened per glyph (the parent keys it by the glyph), so the undo history belongs to one glyph. */
export default function GlyphEditor(props: Props) {
  const { glyph, order, settings, adjust, auto, weight, family, tool, setTool, brush, setBrush, onChange, onStrokes, onGo, onClose } = props
  const dialog = useRef<HTMLDivElement>(null)
  const [base, setBase] = useState<{ mask: Uint8Array | null; w: number } | null>(null)
  const [past, setPast] = useState<Stroke[][]>([])
  const [future, setFuture] = useState<Stroke[][]>([])
  const strokes = glyph.strokes ?? []
  const at = order.indexOf(glyph.char)
  const prev = at > 0 ? order[at - 1] : null
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null

  // the scanner's own ink mask, which the hand corrections are painted over
  useEffect(() => {
    let gone = false
    void request({ t: 'mask', weight, crop: glyph.crop, ink: glyph.ink }).then((r) => {
      if (!gone && r.t === 'masked') setBase({ mask: r.mask, w: r.w })
    })
    return () => { gone = true }
  }, [glyph.crop, glyph.ink, weight])

  const save = (s: Stroke[]) => {
    setPast((h) => [...h, strokes])
    setFuture([])
    onStrokes(s)
  }
  const undo = () => {
    if (!past.length) return
    setPast(past.slice(0, -1))
    setFuture([strokes, ...future])
    onStrokes(past[past.length - 1])
  }
  const redo = () => {
    if (!future.length) return
    setFuture(future.slice(1))
    setPast([...past, strokes])
    onStrokes(future[0])
  }

  useEffect(() => {
    dialog.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && prev && !(e.target instanceof HTMLInputElement)) onGo(prev)
      if (e.key === 'ArrowRight' && next && !(e.target instanceof HTMLInputElement)) onGo(next)
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y')) {
        e.preventDefault()
        if (k === 'y' || e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
            <ShapeCanvas
              crop={glyph.crop} base={base} strokes={strokes} outlines={glyph.outlines} kind={glyph.kind}
              tool={tool} size={brush} onStroke={(s) => save([...strokes, s])}
            />
            <figcaption>
              {tool === 'draw' ? '칸 위를 문질러 잉크를 더해요.' : tool === 'erase' ? '칸 위를 문질러 지워요.' : '검정 = 폰트에 들어갈 모양, 회색 = 사진 속 글씨, 파란 선 = 따낸 윤곽'}
            </figcaption>
          </figure>
          <figure>
            <GlyphTile glyph={glyph} settings={settings} adjust={adjust} auto={auto} className="crop result" />
            <figcaption>{jamo ? '조합에 쓰일 모양(연한 부분 = 나머지 자모 자리)' : '폰트에 들어갈 모양(옅은 띠 = 글자 폭)'}</figcaption>
          </figure>
        </div>

        <div className="brush" role="toolbar" aria-label="모양 고치기">
          <button type="button" id="ge-draw" className={`chip${tool === 'draw' ? ' on' : ''}`} aria-pressed={tool === 'draw'} onClick={() => setTool(tool === 'draw' ? null : 'draw')}>그리기</button>
          <button type="button" id="ge-erase" className={`chip${tool === 'erase' ? ' on' : ''}`} aria-pressed={tool === 'erase'} onClick={() => setTool(tool === 'erase' ? null : 'erase')}>지우기</button>
          <label htmlFor="ge-brush" className="brush-size">붓 크기</label>
          <input id="ge-brush" type="range" min={2} max={40} step={1} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
          <button type="button" className="ghost small" disabled={!past.length} onClick={undo}>되돌리기</button>
          <button type="button" className="ghost small" disabled={!future.length} onClick={redo}>다시 하기</button>
          <button type="button" className="ghost small" disabled={!strokes.length} onClick={() => save([])}>모양 원래대로</button>
        </div>
        {!glyph.outlines.length && (
          <p className="hint warn">모양을 다 지웠어요. 이 글자는 폰트에서 빠지고, 자모로 조합할 수 있으면 조합한 글자가 대신 들어가요.</p>
        )}

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
          <button type="button" className="ghost" onClick={() => onChange({ ...NO_ADJUST })}>위치·크기 원래대로</button>
          <button type="button" className="primary" onClick={onClose}>완료</button>
        </div>
      </div>
    </div>
  )
}
