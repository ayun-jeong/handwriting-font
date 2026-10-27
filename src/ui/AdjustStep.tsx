import { useMemo, useState } from 'react'
import type { Counts, Update } from '../App.tsx'
import type { Stroke } from '../core/brush.ts'
import { isJamoKey, isSyllable, jamoLabel } from '../core/compose.ts'
import { DEFAULT_SETTINGS, NO_ADJUST, autoAlign, type Settings } from '../core/layout.ts'
import { request } from '../engine.ts'
import type { GlyphRec, Project } from '../project.ts'
import GlyphEditor from './GlyphEditor.tsx'
import GlyphTile from './GlyphTile.tsx'
import type { Tool } from './ShapeCanvas.tsx'

type Props = {
  project: Project
  update: Update
  family: string | null
  building: boolean
  counts: Counts
  written: Set<string>
  composable: Set<string>
  text: string
  setText: (t: string) => void
  onAdd: () => void
  onNext: () => void
}

type SliderDef = { key: keyof Settings; label: string; min: number; max: number; step: number; fmt: (v: number) => string }
const signed = (v: number) => (v > 0 ? `+${v}` : String(v))
const pct = (v: number) => `${Math.round(v * 100)}%`

const GROUPS: { title: string; note?: string; items: SliderDef[] }[] = [
  {
    title: '간격',
    items: [
      { key: 'tracking', label: '자간', min: -150, max: 250, step: 5, fmt: signed },
      { key: 'space', label: '띄어쓰기 폭', min: 100, max: 700, step: 10, fmt: String },
      { key: 'lineGap', label: '줄 간격', min: 0, max: 800, step: 10, fmt: String },
    ],
  },
  {
    title: '줄 맞춤',
    note: '칸마다 높이가 들쑥날쑥하게 쓰인 글자를 한 줄에 맞춰요. 한글·기호는 가운데, 영문·숫자는 바닥선에 맞춰요. 0%면 쓴 그대로예요.',
    items: [{ key: 'align', label: '위아래 맞춤', min: 0, max: 1, step: 0.05, fmt: pct }],
  },
  {
    title: '굵기',
    note: '가는 펜이라 얇게 나왔다면 올리고, 번져서 뭉쳤다면 내려 보세요.',
    items: [{ key: 'weight', label: '획 굵기', min: -3, max: 3, step: 1, fmt: signed }],
  },
  {
    title: '한글',
    items: [
      { key: 'hangulScale', label: '크기', min: 0.6, max: 1.6, step: 0.01, fmt: pct },
      { key: 'hangulShift', label: '높이', min: -200, max: 200, step: 5, fmt: signed },
    ],
  },
  {
    title: '조합한 한글',
    note: '자모로 만든 글자를 직접 쓴 글자와 맞춰요. 크기는 처음에 같은 글자끼리 비교해 자동으로 맞춰 둬요.',
    items: [
      { key: 'composedScale', label: '크기', min: 0.6, max: 1.6, step: 0.01, fmt: pct },
      { key: 'composedShift', label: '높이', min: -200, max: 200, step: 5, fmt: signed },
    ],
  },
  {
    title: '영문·숫자·기호',
    note: '한글과 나란히 쓸 때 높이와 크기를 맞춰 주세요.',
    items: [
      { key: 'latinScale', label: '크기', min: 0.6, max: 1.6, step: 0.01, fmt: pct },
      { key: 'latinShift', label: '높이', min: -200, max: 200, step: 5, fmt: signed },
    ],
  },
]

type Filter = 'all' | 'hangul' | 'jamo' | 'latin' | 'off'

export default function AdjustStep({ project, update, family, building, counts, written, composable, text, setText, onAdd, onNext }: Props) {
  const [size, setSize] = useState(40)
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>(null)
  const [brush, setBrush] = useState(10)
  const [showComposed, setShowComposed] = useState(false)

  // runs of characters: written by hand, assembled from jamo, or missing (drawn grey in the system font)
  const runs = useMemo(() => {
    const out: { kind: 'have' | 'comp' | 'miss'; text: string }[] = []
    for (const c of text) {
      const kind = !c.trim() || written.has(c) ? 'have' : composable.has(c) ? 'comp' : 'miss'
      const last = out[out.length - 1]
      if (last && last.kind === kind) last.text += c
      else out.push({ kind, text: c })
    }
    return out
  }, [text, written, composable])
  const missing = useMemo(() => [...new Set([...text].filter((c) => c.trim() && !written.has(c) && !composable.has(c)))], [text, written, composable])
  const composedHere = useMemo(() => new Set([...text].filter((c) => composable.has(c))).size, [text, composable])

  // the same per-glyph line-up offsets the font build uses, so tiles show what the font will look like
  const auto = useMemo(() => autoAlign(Object.values(project.glyphs).filter((g) => !isJamoKey(g.char))), [project.glyphs])

  // hand corrections: saved at once, then the glyph is re-traced with them (a newer edit wins over a late result)
  const setStrokes = (char: string, strokes: Stroke[]) => {
    const g = project.glyphs[char]
    if (!g) return
    update((p) => ({ ...p, glyphs: { ...p.glyphs, [char]: { ...p.glyphs[char], strokes } } }))
    void request({ t: 'retrace', weight: project.tracedWeight, items: [{ key: char, kind: g.kind, crop: g.crop, ink: g.ink, strokes }] }).then((res) => {
      if (res.t !== 'retraced') return
      const outlines = res.items[0]?.outlines ?? []
      update((p) => (p.glyphs[char]?.strokes === strokes ? { ...p, glyphs: { ...p.glyphs, [char]: { ...p.glyphs[char], outlines } } } : p))
    })
  }

  const s = project.settings
  const setSetting = (key: keyof Settings, v: number) => update((p) => ({ ...p, settings: { ...p.settings, [key]: v } }))

  const list = useMemo(() => {
    const order = (g: GlyphRec) => (isJamoKey(g.char) ? 1 : isSyllable(g.char) ? 0 : 2)
    const all = Object.values(project.glyphs).sort((a, b) => order(a) - order(b) || (isJamoKey(a.char) ? 0 : a.char.localeCompare(b.char, 'ko')))
    return all.filter((g) => {
      const off = project.adjust[g.char]?.off
      if (filter === 'off') return off
      if (filter === 'all') return true
      if (filter === 'jamo') return isJamoKey(g.char)
      if (filter === 'hangul') return isSyllable(g.char)
      return !isSyllable(g.char) && !isJamoKey(g.char)
    })
  }, [project.glyphs, project.adjust, filter])
  const offCount = Object.values(project.adjust).filter((a) => a.off).length

  if (!counts.total) {
    return (
      <section className="panel" aria-labelledby="a-h">
        <h2 id="a-h">다듬기</h2>
        <p className="lead">아직 모은 글자가 없어요. 템플릿에 쓴 사진을 먼저 올려 주세요.</p>
        <button type="button" className="primary" onClick={onAdd}>사진 올리기</button>
      </section>
    )
  }

  const chips: [Filter, string][] = [
    ['all', `전체 ${counts.total}`], ['hangul', `한글 ${counts.hangul}`], ['jamo', `자모 ${counts.jamo}`],
    ['latin', `영문·숫자·기호 ${counts.latin}`], ['off', `뺀 글자 ${offCount}`],
  ]

  return (
    <section className="panel" aria-labelledby="a-h">
      <h2 id="a-h">다듬기</h2>
      <p className="lead">미리보기는 내려받을 폰트 파일 그대로예요. 슬라이더를 움직이면 바로 바뀌어요.</p>

      <div className="card preview">
        <div className="preview-bar">
          <label htmlFor="preview-size">미리보기 크기</label>
          <input id="preview-size" type="range" min={16} max={96} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          {composable.size > 0 && (
            <label className="check small">
              <input id="show-composed" type="checkbox" checked={showComposed} onChange={(e) => setShowComposed(e.target.checked)} />
              <span>조합한 글자 색으로 표시</span>
            </label>
          )}
          {building && <span className="hint"><span className="spin" aria-hidden="true" /> 반영 중</span>}
        </div>
        <div className={`preview-render${showComposed ? ' mark' : ''}`} style={{ fontFamily: family ? `"${family}", var(--font-ui)` : undefined, fontSize: size }}>
          {runs.map((r, i) => <span key={i} className={r.kind === 'have' ? undefined : r.kind}>{r.text}</span>)}
        </div>
        <p className="hint">
          {composedHere > 0 && <>이 문장의 {composedHere}자는 자모를 조합해 만들었어요{showComposed ? '(파란 글자)' : ''}. </>}
          {missing.length > 0 ? <>회색 {missing.length}자는 아직 없는 글자예요.</> : '빠진 글자 없이 모두 내 글씨예요.'}
        </p>
        <label htmlFor="preview-text" className="hint">미리보기 문장 바꾸기</label>
        <textarea id="preview-text" className="preview-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </div>

      <div className="controls">
        {GROUPS.filter((g) => g.title !== '조합한 한글' || counts.jamo > 0).map((g) => (
          <fieldset key={g.title} className="card group">
            <legend>{g.title}</legend>
            {g.items.map((it) => (
              <div key={it.key} className="slider">
                <label htmlFor={`set-${it.key}`}>{it.label}</label>
                <input id={`set-${it.key}`} type="range" min={it.min} max={it.max} step={it.step} value={s[it.key]} onChange={(e) => setSetting(it.key, Number(e.target.value))} />
                <output htmlFor={`set-${it.key}`}>{it.fmt(s[it.key])}</output>
              </div>
            ))}
            {g.note && <p className="hint">{g.note}</p>}
          </fieldset>
        ))}
        <div className="controls-actions">
          <button type="button" className="ghost" onClick={() => update((p) => ({ ...p, settings: { ...DEFAULT_SETTINGS } }))}>전체 설정 기본값으로</button>
        </div>
      </div>

      <h3>글자 하나씩 고치기</h3>
      <div className="chips" role="tablist" aria-label="글자 거르기">
        {chips.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <p className="hint">
        글자를 누르면 붓으로 모양을 더하거나 지우고, 위치·크기를 고치거나, 폰트에서 뺄 수 있어요. 자모를 고치면 그 자모로 조합한 글자가 모두 함께 바뀌어요.
        마음에 안 드는 글자는 템플릿 그 쪽만 다시 써서 올리면 새 글씨로 바뀌어요.
      </p>
      <ul className="grid">
        {list.map((g) => {
          const adj = project.adjust[g.char] ?? NO_ADJUST
          const changed = adj.dx || adj.dy || adj.scale !== 1 || !!g.strokes?.length
          const jamo = isJamoKey(g.char)
          return (
            <li key={g.char}>
              <button type="button" className={`tile${adj.off ? ' off' : ''}${jamo ? ' jamo' : ''}`} onClick={() => setEditing(g.char)} aria-label={`${jamo ? jamoLabel(g.char) : g.char} 고치기`}>
                <GlyphTile glyph={g} settings={s} adjust={adj} auto={auto.get(g.char)} />
                <span className="tile-char">{jamo ? jamoLabel(g.char) : g.char}</span>
                {changed && !adj.off && <span className="tile-dot" aria-label="고친 글자" />}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="next-row">
        <button type="button" className="secondary" onClick={onAdd}>사진 더 올리기</button>
        <button type="button" className="primary" onClick={onNext}>폰트 받기 →</button>
      </div>

      {editing && project.glyphs[editing] && (
        <GlyphEditor
          key={editing}
          glyph={project.glyphs[editing]}
          order={list.map((g) => g.char)}
          settings={s}
          adjust={project.adjust[editing] ?? NO_ADJUST}
          auto={auto.get(editing) ?? 0}
          weight={project.tracedWeight}
          family={family}
          tool={tool}
          setTool={setTool}
          brush={brush}
          setBrush={setBrush}
          onChange={(a) => update((p) => ({ ...p, adjust: { ...p.adjust, [editing]: a } }))}
          onStrokes={(st) => setStrokes(editing, st)}
          onGo={setEditing}
          onClose={() => { setEditing(null); setTool(null) }}
        />
      )}
    </section>
  )
}
