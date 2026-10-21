import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Update } from '../App.tsx'
import { request, warmup } from '../engine.ts'
import { autoFit } from '../core/layout.ts'
import type { GlyphRec } from '../project.ts'

export type PhotoItem = {
  id: number
  name: string
  thumb: string
  status: 'working' | 'done' | 'error'
  message?: string
  pageTitle?: string
  found?: number
  total?: number
  empties?: string[]
  check?: string
}

type Props = {
  photos: PhotoItem[]
  setPhotos: Dispatch<SetStateAction<PhotoItem[]>>
  update: Update
  weight: number
  counts: { hangul: number; latin: number; total: number }
  onNext: () => void
}

let photoId = 0

const FAIL: Record<string, (markers: number) => string> = {
  markers: (m) => `모서리 표식을 ${m}/4개만 찾았어요. 종이 네 모서리가 다 보이게 다시 찍어 주세요.`,
  qr: () => 'QR 코드를 읽지 못했어요. 조금 더 가까이, 흔들리지 않게 찍어 주세요.',
  page: () => '이 사이트에서 받은 템플릿이 아닌 것 같아요.',
}

export default function PhotosStep({ photos, setPhotos, update, weight, counts, onNext }: Props) {
  const [dragging, setDragging] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const working = photos.some((p) => p.status === 'working')

  useEffect(() => { warmup() }, [])

  const patch = (id: number, p: Partial<PhotoItem>) => setPhotos((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))

  async function handle(file: File) {
    const id = ++photoId
    setPhotos((list) => [{ id, name: file.name, thumb: URL.createObjectURL(file), status: 'working' }, ...list])
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      patch(id, { status: 'error', message: '이 사진 형식은 이 브라우저에서 열 수 없어요(HEIC 등). JPG로 바꾸거나 아이폰이라면 사파리에서 올려 주세요.' })
      return
    }
    try {
      const res = await request({ t: 'scan', bitmap, weight }, [bitmap])
      if (res.t !== 'scanned') throw new Error('unexpected reply')
      if (!res.ok) {
        patch(id, { status: 'error', message: FAIL[res.reason](res.markers) })
        return
      }
      const add: Record<string, GlyphRec> = {}
      for (const g of res.glyphs) add[g.char] = { char: g.char, kind: g.kind, crop: g.crop, ink: res.ink, outlines: g.outlines, page: res.page.id }
      update((p) => {
        const glyphs = { ...p.glyphs, ...add }
        const fit = autoFit(Object.values(glyphs))
        const settings = { ...p.settings }
        const fitted = { ...p.fitted }
        if (!fitted.hangul && fit.hangulScale) { settings.hangulScale = fit.hangulScale; fitted.hangul = true }
        if (!fitted.latin && fit.latinScale) { settings.latinScale = fit.latinScale; fitted.latin = true }
        return { ...p, glyphs, settings, fitted }
      })
      patch(id, {
        status: 'done', pageTitle: res.page.title, found: res.glyphs.length, total: res.glyphs.length + res.empties.length,
        empties: res.empties, check: URL.createObjectURL(res.check),
      })
    } catch (err) {
      patch(id, { status: 'error', message: `처리하다 문제가 생겼어요: ${err instanceof Error ? err.message : err}` })
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) if (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)) await handle(f)
  }

  return (
    <section className="panel" aria-labelledby="p-h">
      <h2 id="p-h">사진 올리기</h2>
      <p className="lead">다 쓴 템플릿을 한 쪽씩 찍어서 올려 주세요. 여러 장을 한꺼번에 올려도 되고, 순서는 상관없어요.</p>

      <div
        className={`drop${dragging ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files) }}
      >
        <div className="drop-actions">
          <button type="button" className="primary" onClick={() => pick.current?.click()}>사진 고르기</button>
          <button type="button" className="secondary camera" onClick={() => camera.current?.click()}>카메라로 찍기</button>
        </div>
        <p className="hint">여기에 사진을 끌어다 놓아도 돼요. 그림자 없이 위에서, 네 모서리 표식과 QR이 다 보이게 찍어 주세요.</p>
        <input ref={pick} id="photo-input" type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
        <input ref={camera} id="camera-input" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {photos.length > 0 && (
        <ul className="photos" aria-live="polite">
          {photos.map((p) => (
            <li key={p.id} className={`photo ${p.status}`}>
              <img src={p.thumb} alt="" width={72} height={96} />
              <div className="photo-body">
                <div className="photo-name">{p.name}</div>
                {p.status === 'working' && <div className="status"><span className="spin" aria-hidden="true" /> 글자를 찾는 중… 처음 한 번은 준비하는 데 몇 초 걸려요</div>}
                {p.status === 'done' && (
                  <>
                    <div className="status ok">{p.pageTitle} · {p.found}/{p.total}칸 인식</div>
                    {p.empties && p.empties.length > 0 && <div className="hint">비어 있는 칸: {p.empties.join(' ')}</div>}
                    {p.check && <a className="hint" href={p.check} target="_blank" rel="noreferrer">인식 결과 보기 (초록 = 인식, 빨강 = 빈칸)</a>}
                  </>
                )}
                {p.status === 'error' && <div className="status bad">{p.message}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="next-row">
        <span>모은 글자 <b>{counts.total}자</b> (한글 {counts.hangul} · 영문·기호 {counts.latin})</span>
        <button type="button" className="primary" disabled={!counts.total || working} onClick={onNext}>다듬기 →</button>
      </div>
    </section>
  )
}
