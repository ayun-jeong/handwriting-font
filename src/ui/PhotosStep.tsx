import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Counts, Update } from '../App.tsx'
import { request, warmup } from '../engine.ts'
import { refit } from '../fit.ts'
import { GUIDE_LIKE_INK, photoTooSoft } from '../core/geometry.ts'
import { isPdf, openPdf, type OpenPdf } from '../pdf.ts'
import type { GlyphRec } from '../project.ts'

export type PhotoItem = {
  id: number
  name: string
  thumb: string
  status: 'working' | 'done' | 'error'
  /** Share of the scan done, 0..1, while working. */
  progress?: number
  message?: string
  pageTitle?: string
  pageId?: string
  /** Slot indices of the cells inside this photo. */
  seen?: number[]
  found?: number
  /** Cells inside this photo, and on the whole page. */
  total?: number
  pageCells?: number
  /** Photo pixels across one cell, and the photo's blur in photo pixels. */
  cellPx?: number
  blurPx?: number
  /** How dark the printed guides came out, and whether the scan was black and white. */
  guide?: number
  binary?: boolean
  empties?: string[]
  check?: string
}

type Props = {
  photos: PhotoItem[]
  setPhotos: Dispatch<SetStateAction<PhotoItem[]>>
  update: Update
  weight: number
  counts: Counts
  onNext: () => void
}

let photoId = 0

const FAIL: Record<string, (markers: number) => string> = {
  markers: (m) => `검은 네모 표식을 ${m}개만 찾았어요(3개 이상 필요). 네 모서리가 다 보이게, 반씩 찍을 땐 가운데 양쪽 표식도 보이게 다시 찍어 주세요.`,
  qr: () => 'QR 코드를 읽지 못했어요. 조금 더 가까이, 흔들리지 않게 찍어 주세요.',
  page: () => '이 사이트에서 받은 템플릿이 아닌 것 같아요.',
}

export default function PhotosStep({ photos, setPhotos, update, weight, counts, onNext }: Props) {
  const [dragging, setDragging] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const working = photos.some((p) => p.status === 'working')
  // cells of each template page seen in any photo, so half-page photos can be checked together
  const covered = new Map<string, Set<number>>()
  for (const p of photos) {
    if (p.status !== 'done' || !p.pageId || !p.seen) continue
    const set = covered.get(p.pageId) ?? new Set<number>()
    for (const i of p.seen) set.add(i)
    covered.set(p.pageId, set)
  }

  useEffect(() => { warmup() }, [])

  const patch = (id: number, p: Partial<PhotoItem>) => setPhotos((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))

  async function handlePhoto(file: File) {
    const id = ++photoId
    setPhotos((list) => [{ id, name: file.name, thumb: URL.createObjectURL(file), status: 'working' }, ...list])
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      patch(id, { status: 'error', message: '이 사진 형식은 이 브라우저에서 열 수 없어요(HEIC 등). JPG로 바꾸거나 아이폰이라면 사파리에서 올려 주세요.' })
      return
    }
    await scan(id, bitmap)
  }

  /** Every page of a PDF goes through the scanner like a photo. */
  async function handlePdf(file: File) {
    let pdf: OpenPdf
    try {
      pdf = await openPdf(file)
    } catch (err) {
      const locked = err instanceof Error && err.name === 'PasswordException'
      setPhotos((list) => [{
        id: ++photoId, name: file.name, thumb: '', status: 'error',
        message: locked ? '암호가 걸린 PDF예요. 암호를 풀어서 저장한 뒤 올려 주세요.' : 'PDF를 열지 못했어요. 파일이 깨졌거나 다른 형식일 수 있어요.',
      }, ...list])
      return
    }
    try {
      for (let n = 1; n <= pdf.pages; n++) {
        const id = ++photoId
        const name = pdf.pages > 1 ? `${file.name} · ${n}/${pdf.pages}쪽` : file.name
        setPhotos((list) => [{ id, name, thumb: '', status: 'working' }, ...list])
        let page: Awaited<ReturnType<OpenPdf['render']>>
        try {
          page = await pdf.render(n)
        } catch {
          patch(id, { status: 'error', message: '이 쪽을 그리지 못했어요. 이 쪽만 사진으로 찍어 올려 주세요.' })
          continue
        }
        patch(id, { thumb: page.thumb })
        await scan(id, page.bitmap)
      }
    } finally {
      pdf.close()
    }
  }

  /** Scan one page image and add what was read to the project. */
  async function scan(id: number, bitmap: ImageBitmap) {
    try {
      const res = await request({ t: 'scan', bitmap, weight }, [bitmap], (done) => patch(id, { progress: done }))
      if (res.t !== 'scanned') throw new Error('unexpected reply')
      if (!res.ok) {
        patch(id, { status: 'error', message: FAIL[res.reason](res.markers) })
        return
      }
      const add: Record<string, GlyphRec> = {}
      for (const g of res.glyphs) add[g.char] = { char: g.char, kind: g.kind, crop: g.crop, ink: res.ink, guide: res.guide, outlines: g.outlines, page: res.page.id }
      update((p) => refit({ ...p, glyphs: { ...p.glyphs, ...add } }))
      patch(id, {
        status: 'done', pageTitle: res.page.title, pageId: res.page.id, seen: res.seen, found: res.glyphs.length, total: res.visible, pageCells: res.total,
        cellPx: res.cellPx, blurPx: res.blurPx, guide: res.guide, binary: res.binary, empties: res.empties, check: URL.createObjectURL(res.check),
      })
    } catch (err) {
      patch(id, { status: 'error', message: `처리하다 문제가 생겼어요: ${err instanceof Error ? err.message : err}` })
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) {
      if (isPdf(f)) await handlePdf(f)
      else if (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)) await handlePhoto(f)
    }
  }

  return (
    <section className="panel" aria-labelledby="p-h">
      <h2 id="p-h">사진 올리기</h2>
      <p className="lead">다 쓴 템플릿을 한 쪽씩 찍어서 올려 주세요. 스캔하거나 사진을 묶은 PDF도 돼요(여러 쪽이면 쪽마다 읽어요). 여러 개를 한꺼번에 올려도 되고, 순서는 상관없어요.</p>

      <div
        className={`drop${dragging ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files) }}
      >
        <div className="drop-actions">
          <button type="button" className="primary" onClick={() => pick.current?.click()}>사진·PDF 고르기</button>
          <button type="button" className="secondary camera" onClick={() => camera.current?.click()}>카메라로 찍기</button>
        </div>
        <p className="hint">여기에 사진이나 PDF를 끌어다 놓아도 돼요. 그림자 없이 위에서 찍어 주세요. 작은 칸 템플릿은 위·아래 반씩 가까이 찍어 올려도 돼요(가운데 양쪽 표식이 보이게).</p>
        <input ref={pick} id="photo-input" type="file" accept="image/*,.heic,.heif,application/pdf,.pdf" multiple hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
        <input ref={camera} id="camera-input" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {photos.length > 0 && (
        <ul className="photos" aria-live="polite">
          {photos.map((p) => (
            <li key={p.id} className={`photo ${p.status}`}>
              {p.thumb ? <img src={p.thumb} alt="" width={72} height={96} /> : <span className="photo-ph" aria-hidden="true" />}
              <div className="photo-body">
                <div className="photo-name">{p.name}</div>
                {p.status === 'working' && (
                  <div className="status">
                    <span className="spin" aria-hidden="true" />{' '}
                    {p.progress === undefined ? '글자를 찾는 중… 처음 한 번은 준비하는 데 몇 초 걸려요' : `글자를 찾는 중… ${Math.round(p.progress * 100)}%`}
                  </div>
                )}
                {p.status === 'done' && (
                  <>
                    <div className="status ok">{p.pageTitle} · {p.found}/{p.total}칸 인식</div>
                    {p.cellPx !== undefined && p.blurPx !== undefined && photoTooSoft(p.cellPx, p.blurPx) && (
                      <div className="hint warn">
                        {p.cellPx < 50
                          ? `사진 속 칸이 작아서(칸 하나가 ${p.cellPx}픽셀) 획이 굵게 뭉개질 수 있어요. 종이에 더 가까이, 위·아래 반씩 나눠 찍어 보세요.`
                          : '사진이 조금 흐려서 획이 굵게 뭉개질 수 있어요. 초점을 맞추고 흔들리지 않게 다시 찍어 보세요.'}
                      </div>
                    )}
                    {(p.binary || (p.guide !== undefined && p.guide >= GUIDE_LIKE_INK)) && (
                      <div className="hint warn">흑백으로 스캔된 것 같아요. 흑백에서는 획 가장자리가 거칠어지고, 예전 템플릿이라면 안내선이 글씨에 섞일 수 있어요. 결과가 마음에 안 들면 컬러나 회색조로 다시 스캔해 주세요.</div>
                    )}
                    {p.pageCells !== undefined && p.total !== undefined && p.total < p.pageCells && (() => {
                      const missing = p.pageCells - (covered.get(p.pageId!)?.size ?? p.total)
                      return missing > 0
                        ? <div className="hint">이 사진에 칸 {p.total}/{p.pageCells}개가 보였어요. 아직 안 찍힌 {missing}칸은 나머지 부분을 찍어 올려 주세요.</div>
                        : <div className="hint">다른 사진과 합쳐 이 쪽의 {p.pageCells}칸이 모두 모였어요.</div>
                    })()}
                    {p.found === 0 ? (
                      <div className="hint warn">글씨를 하나도 찾지 못했어요. 아직 안 쓴 템플릿이거나 펜이 너무 연하면 이래요. 검은 펜으로 쓴 쪽을 올려 주세요.</div>
                    ) : p.empties && p.empties.length > 0 && (
                      <div className="hint">비어 있는 칸 {p.empties.length}개{p.empties.length <= 20 ? `: ${p.empties.map((c) => (c.startsWith('j:') ? '자모' : c)).join(' ')}` : ''}</div>
                    )}
                    {p.check && (
                      <a className="hint" href={p.check} target="_blank" rel="noreferrer">
                        인식 결과 보기 (초록 = 인식, 빨강 = 빈칸{p.total !== undefined && p.pageCells !== undefined && p.total < p.pageCells ? ', 회색 = 사진 밖' : ''})
                      </a>
                    )}
                  </>
                )}
                {p.status === 'error' && <div className="status bad">{p.message}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="next-row">
        <span>
          모은 칸 <b>{counts.total}</b> (한글 {counts.hangul} · 자모 {counts.jamo} · 영문·기호 {counts.latin})
          {counts.composable > 0 && <> · 자모로 조합할 수 있는 한글 <b>{counts.composable.toLocaleString()}자</b></>}
        </span>
        <button type="button" className="primary" disabled={!counts.total || working} onClick={onNext}>다듬기 →</button>
      </div>
    </section>
  )
}
