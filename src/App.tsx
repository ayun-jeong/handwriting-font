import { useCallback, useEffect, useMemo, useState } from 'react'
import { request } from './engine.ts'
import type { GlyphShape } from './core/layout.ts'
import { clearProject, emptyProject, loadProject, saveProject, type Project } from './project.ts'
import { useLiveFont } from './useLiveFont.ts'
import TemplateStep from './ui/TemplateStep.tsx'
import PhotosStep, { type PhotoItem } from './ui/PhotosStep.tsx'
import AdjustStep from './ui/AdjustStep.tsx'
import ExportStep from './ui/ExportStep.tsx'
import Footer from './ui/Footer.tsx'

export type Update = (fn: (p: Project) => Project) => void
type Step = 1 | 2 | 3 | 4

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: '템플릿 받기' },
  { n: 2, label: '사진 올리기' },
  { n: 3, label: '다듬기' },
  { n: 4, label: '폰트 받기' },
]

export default function App() {
  const [project, setProject] = useState<Project>(emptyProject)
  const [loaded, setLoaded] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [reweighing, setReweighing] = useState(false)

  useEffect(() => {
    loadProject().then((p) => {
      if (p) {
        setProject(p)
        if (Object.keys(p.glyphs).length) setStep(3)
      }
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void saveProject(project), 400)
    return () => clearTimeout(t)
  }, [project, loaded])

  const update: Update = useCallback((fn) => setProject((p) => fn(p)), [])

  // weight changes re-trace every glyph from its stored crop
  const { weight } = project.settings
  const { tracedWeight, glyphs } = project
  useEffect(() => {
    if (weight === tracedWeight || !Object.keys(glyphs).length) return
    let cancelled = false
    const t = setTimeout(async () => {
      setReweighing(true)
      try {
        const items = Object.values(glyphs).map((g) => ({ key: g.char, kind: g.kind, crop: g.crop, ink: g.ink }))
        const res = await request({ t: 'retrace', weight, items })
        if (cancelled || res.t !== 'retraced') return
        const outlines = new Map(res.items.map((i) => [i.key, i.outlines]))
        setProject((p) => {
          const next = { ...p.glyphs }
          for (const [k, o] of outlines) if (next[k] && o.length) next[k] = { ...next[k], outlines: o }
          return { ...p, glyphs: next, tracedWeight: weight }
        })
      } finally {
        if (!cancelled) setReweighing(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [weight, tracedWeight, glyphs])

  const shapes: GlyphShape[] = useMemo(
    () => Object.values(project.glyphs).map((g) => ({ char: g.char, kind: g.kind, outlines: g.outlines })),
    [project.glyphs],
  )
  const live = useLiveFont(shapes, project.settings, project.adjust)
  const counts = useMemo(() => {
    let hangul = 0, latin = 0
    for (const g of Object.values(project.glyphs)) {
      if (g.kind === 'hangul') hangul++
      else latin++
    }
    return { hangul, latin, total: hangul + latin }
  }, [project.glyphs])

  const restart = async () => {
    await clearProject()
    setProject(emptyProject())
    setPhotos([])
    setStep(1)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-cell" aria-hidden="true">손</span>
          <div>
            <h1>손글씨 폰트 만들기</h1>
            <p className="tagline">종이에 쓴 글씨를 사진으로 찍으면 내 글씨체 폰트(TTF·OTF)가 돼요. 사진은 이 기기 밖으로 나가지 않아요.</p>
          </div>
        </div>
        <nav className="steps" aria-label="단계">
          {STEPS.map((s) => (
            <button key={s.n} type="button" className={`step${step === s.n ? ' on' : ''}`} aria-current={step === s.n ? 'step' : undefined} onClick={() => setStep(s.n)}>
              <span className="step-n">{s.n}</span>
              <span className="step-l">{s.label}</span>
              {s.n === 3 && counts.total > 0 && <span className="step-c">{counts.total}자</span>}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {step === 1 && <TemplateStep onNext={() => setStep(2)} />}
        {step === 2 && (
          <PhotosStep photos={photos} setPhotos={setPhotos} update={update} weight={project.tracedWeight} counts={counts} onNext={() => setStep(3)} />
        )}
        {step === 3 && (
          <AdjustStep project={project} update={update} family={live.family} building={live.building || reweighing} counts={counts} onAdd={() => setStep(2)} onNext={() => setStep(4)} />
        )}
        {step === 4 && <ExportStep project={project} update={update} family={live.family} counts={counts} />}
      </main>

      <Footer onRestart={restart} hasWork={counts.total > 0} />
    </div>
  )
}
