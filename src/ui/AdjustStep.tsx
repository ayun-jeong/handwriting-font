import { useMemo, useState } from 'react'
import type { Update } from '../App.tsx'
import { DEFAULT_SETTINGS, NO_ADJUST, layoutGlyph, svgPath, type Settings } from '../core/layout.ts'
import type { Project } from '../project.ts'
import { sampleText } from '../sampleText.ts'
import GlyphEditor from './GlyphEditor.tsx'

type Props = {
  project: Project
  update: Update
  family: string | null
  building: boolean
  counts: { hangul: number; latin: number; total: number }
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
    title: '영문·숫자·기호',
    note: '한글과 나란히 쓸 때 높이와 크기를 맞춰 주세요.',
    items: [
      { key: 'latinScale', label: '크기', min: 0.6, max: 1.6, step: 0.01, fmt: pct },
      { key: 'latinShift', label: '높이', min: -200, max: 200, step: 5, fmt: signed },
    ],
  },
]

type Filter = 'all' | 'hangul' | 'latin' | 'off'

export default function AdjustStep({ project, update, family, building, counts, onAdd, onNext }: Props) {
  const have = useMemo(() => new Set(Object.keys(project.glyphs)), [project.glyphs])
  const [text, setText] = useState(() => sampleText(have))
  const [size, setSize] = useState(40)
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<string | null>(null)

  const missing = useMemo(() => [...new Set([...text].filter((c) => c.trim() && !have.has(c)))], [text, have])
  // runs of characters we have (drawn in the live font) and don't have (drawn grey in the system font)
  const runs = useMemo(() => {
    const out: { have: boolean; text: string }[] = []
    for (const c of text) {
      const ok = !c.trim() || have.has(c)
      const last = out[out.length - 1]
      if (last && last.have === ok) last.text += c
      else out.push({ have: ok, text: c })
    }
    return out
  }, [text, have])
  const s = project.settings
  const setSetting = (key: keyof Settings, v: number) => update((p) => ({ ...p, settings: { ...p.settings, [key]: v } }))

  const list = useMemo(() => {
    const all = Object.values(project.glyphs).sort((a, b) => (a.kind === b.kind ? a.char.localeCompare(b.char, 'ko') : a.kind === 'hangul' ? -1 : 1))
    return all.filter((g) => {
      const off = project.adjust[g.char]?.off
      if (filter === 'off') return off
      if (filter === 'all') return true
      return g.kind === filter
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

  return (
    <section className="panel" aria-labelledby="a-h">
      <h2 id="a-h">다듬기</h2>
      <p className="lead">미리보기는 내려받을 폰트 파일 그대로예요. 슬라이더를 움직이면 바로 바뀌어요.</p>

      <div className="card preview">
        <div className="preview-bar">
          <label htmlFor="preview-size">미리보기 크기</label>
          <input id="preview-size" type="range" min={16} max={96} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          {building && <span className="hint"><span className="spin" aria-hidden="true" /> 반영 중</span>}
        </div>
        <div className="preview-render" style={{ fontFamily: family ? `"${family}", var(--font-ui)` : undefined, fontSize: size }}>
          {runs.map((r, i) => <span key={i} className={r.have ? undefined : 'miss'}>{r.text}</span>)}
        </div>
        <p className="hint">
          {missing.length
            ? <>회색은 아직 없는 글자예요({missing.length}개). 템플릿 다음 쪽을 쓰면 채워져요.</>
            : '모두 내 글씨예요.'}
        </p>
        <label htmlFor="preview-text" className="hint">미리보기 문장 바꾸기</label>
        <textarea id="preview-text" className="preview-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </div>

      <div className="controls">
        {GROUPS.map((g) => (
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
        {([['all', `전체 ${counts.total}`], ['hangul', `한글 ${counts.hangul}`], ['latin', `영문·기호 ${counts.latin}`], ['off', `뺀 글자 ${offCount}`]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <p className="hint">글자를 누르면 위치·크기를 고치거나 폰트에서 뺄 수 있어요. 마음에 안 드는 글자는 템플릿 그 쪽만 다시 써서 올리면 새 글씨로 바뀌어요.</p>
      <ul className="grid">
        {list.map((g) => {
          const adj = project.adjust[g.char] ?? NO_ADJUST
          const laid = layoutGlyph(g, s, adj)
          const changed = adj.dx || adj.dy || adj.scale !== 1
          return (
            <li key={g.char}>
              <button type="button" className={`tile${adj.off ? ' off' : ''}`} onClick={() => setEditing(g.char)} aria-label={`${g.char} 고치기`}>
                <svg viewBox={`${laid.advance / 2 - 520} -950 1040 1300`} aria-hidden="true">
                  <line x1={laid.advance / 2 - 520} x2={laid.advance / 2 + 520} y1={0} y2={0} className="baseline" />
                  <path d={svgPath(laid.outlines)} />
                </svg>
                <span className="tile-char">{g.char}</span>
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
          glyph={project.glyphs[editing]}
          order={list.map((g) => g.char)}
          settings={s}
          adjust={project.adjust[editing] ?? NO_ADJUST}
          family={family}
          onChange={(a) => update((p) => ({ ...p, adjust: { ...p.adjust, [editing]: a } }))}
          onGo={setEditing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
