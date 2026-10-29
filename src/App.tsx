import { useCallback, useEffect, useMemo, useState } from 'react'
import { request } from './engine.ts'
import { JAMO_EXAMPLES, isJamoKey, isSyllable } from './core/compose.ts'
import { availableChars, type SourceGlyph } from './core/glyphset.ts'
import { clearProject, emptyProject, loadProject, saveProject, type Project } from './project.ts'
import { sampleText } from './sampleText.ts'
import { useLiveFont } from './useLiveFont.ts'
import TemplateStep from './ui/TemplateStep.tsx'
import PhotosStep, { type PhotoItem } from './ui/PhotosStep.tsx'
import AdjustStep from './ui/AdjustStep.tsx'
import ExportStep from './ui/ExportStep.tsx'
import Footer from './ui/Footer.tsx'

export type Update = (fn: (p: Project) => Project) => void
export type Counts = { hangul: number; jamo: number; latin: number; composable: number; total: number }
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
  const [previewText, setPreviewText] = useState<string | null>(null)

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
        const items = Object.values(glyphs).map((g) => ({ key: g.char, kind: g.kind, crop: g.crop, ink: g.ink, guide: g.guide, strokes: g.strokes }))
        const res = await request({ t: 'retrace', weight, items })
        if (cancelled || res.t !== 'retraced') return
        const outlines = new Map(res.items.map((i) => [i.key, i.outlines]))
        setProject((p) => {
          const next = { ...p.glyphs }
          // an empty result keeps the old shape, unless the user erased the glyph on purpose
          for (const [k, o] of outlines) if (next[k] && (o.length || next[k].strokes?.length)) next[k] = { ...next[k], outlines: o }
          return { ...p, glyphs: next, tracedWeight: weight }
        })
      } finally {
        if (!cancelled) setReweighing(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [weight, tracedWeight, glyphs])

  const sources: SourceGlyph[] = useMemo(
    () => Object.values(project.glyphs).map((g) => ({ key: g.char, kind: g.kind, outlines: g.outlines })),
    [project.glyphs],
  )
  const available = useMemo(() => availableChars(sources, project.adjust), [sources, project.adjust])
  const have = useMemo(() => new Set([...available.written, ...available.composable]), [available])
  const text = previewText ?? sampleText(have)
  const fontChars = useMemo(() => [...new Set([...text, ...sampleText(have), ...available.written, ...JAMO_EXAMPLES])].join(''), [text, have, available])
  const live = useLiveFont(sources, project.settings, project.adjust, fontChars)

  const counts: Counts = useMemo(() => {
    let hangul = 0, jamo = 0, latin = 0
    for (const g of Object.values(project.glyphs)) {
      if (isJamoKey(g.char)) jamo++
      else if (isSyllable(g.char)) hangul++
      else latin++
    }
    return { hangul, jamo, latin, composable: available.composable.size, total: hangul + jamo + latin }
  }, [project.glyphs, available])

  const restart = async () => {
    await clearProject()
    setProject(emptyProject())
    setPhotos([])
    setPreviewText(null)
    setStep(1)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-cell" aria-hidden="true">손</span>
          <div>
            <h1>손글씨 폰트 만들기</h1>
            <p className="tagline">종이에 쓴 글씨를 사진이나 스캔(PDF)으로 올리면 내 글씨체 폰트(TTF·OTF)가 돼요. 사진과 PDF는 이 기기 밖으로 나가지 않아요.</p>
          </div>
        </div>
        <nav className="steps" aria-label="단계">
          {STEPS.map((s) => (
            <button key={s.n} type="button" className={`step${step === s.n ? ' on' : ''}`} aria-current={step === s.n ? 'step' : undefined} onClick={() => setStep(s.n)}>
              <span className="step-n">{s.n}</span>
              <span className="step-l">{s.label}</span>
              {s.n === 3 && counts.total > 0 && <span className="step-c">{counts.total}칸</span>}
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
          <AdjustStep
            project={project} update={update} family={live.family} building={live.building || reweighing} counts={counts}
            written={available.written} composable={available.composable} text={text} setText={setPreviewText}
            onAdd={() => setStep(2)} onNext={() => setStep(4)}
          />
        )}
        {step === 4 && <ExportStep project={project} update={update} family={live.family} counts={counts} sample={sampleText(have)} />}
      </main>

      <Footer onRestart={restart} hasWork={counts.total > 0} />
    </div>
  )
}
