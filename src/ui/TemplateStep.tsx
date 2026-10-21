import { useEffect, useMemo, useRef, useState } from 'react'
import { FREQUENCY_SOURCE, KOREAN_PAGES, koreanCoverage, koreanPage, latinPage, type PageDef } from '../core/charsets.ts'
import { PAGE_H, PAGE_W } from '../core/geometry.ts'
import { drawTemplatePage, templatePdf } from '../core/template.ts'
import { download } from './download.ts'

export default function TemplateStep({ onNext }: { onNext: () => void }) {
  const [latin, setLatin] = useState(true)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(3)
  const [busy, setBusy] = useState<string | null>(null)
  const preview = useRef<HTMLCanvasElement>(null)

  const pages: PageDef[] = useMemo(() => {
    const list: PageDef[] = []
    if (latin) list.push(latinPage())
    for (let n = from; n <= to; n++) list.push(koreanPage(n))
    return list
  }, [latin, from, to])

  const koreanCount = to >= from ? (to - from + 1) * 80 : 0

  useEffect(() => {
    const c = preview.current
    if (!c || !pages.length) return
    const full = new OffscreenCanvas(PAGE_W, PAGE_H)
    const fctx = full.getContext('2d')!
    const first = pages.find((p) => p.kind === 'hangul') ?? pages[0]
    drawTemplatePage(fctx, first, pages.indexOf(first) + 1, pages.length)
    const ctx = c.getContext('2d')!
    ctx.drawImage(full, 0, 0, c.width, c.height)
  }, [pages])

  const makePdf = async () => {
    setBusy('0')
    try {
      const bytes = await templatePdf(pages, (n) => setBusy(String(n)))
      download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `손글씨-템플릿-${pages.length}쪽.pdf`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel" aria-labelledby="t-h">
      <h2 id="t-h">템플릿 받기</h2>
      <p className="lead">칸 위에 회색으로 적힌 글자를 그 아래 하늘색 칸에 따라 쓰면 돼요. 쓴 글자만 폰트에 들어가요.</p>

      <div className="split">
        <div className="card options">
          <label className="check">
            <input id="opt-latin" type="checkbox" checked={latin} onChange={(e) => setLatin(e.target.checked)} />
            <span><b>영문·숫자·기호</b> 1쪽, 80자</span>
          </label>

          <div className="field">
            <b>한글</b> 자주 쓰는 순서대로
            <div className="range-pick">
              <select id="opt-from" aria-label="시작 쪽" value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to < v) setTo(v) }}>
                {Array.from({ length: KOREAN_PAGES }, (_, i) => <option key={i} value={i + 1}>{i + 1}쪽</option>)}
              </select>
              부터
              <select id="opt-to" aria-label="끝 쪽" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {Array.from({ length: KOREAN_PAGES }, (_, i) => i + 1).filter((n) => n >= from).map((n) => <option key={n} value={n}>{n}쪽</option>)}
              </select>
              까지
            </div>
            <p className="hint">
              이번에 받는 한글 {koreanCount}자. 1~{to}쪽을 다 쓰면 일상 글에 나오는 글자의 <b>{koreanCoverage(to).toFixed(1)}%</b>가 내 글씨로 보여요.
            </p>
          </div>

          <button type="button" className="primary" disabled={!pages.length || busy !== null} onClick={makePdf}>
            {busy !== null ? `PDF 만드는 중 ${busy}/${pages.length}쪽` : `PDF 내려받기 · ${pages.length}쪽`}
          </button>
          <button type="button" className="ghost" onClick={onNext}>이미 썼어요, 사진 올리기 →</button>
        </div>

        <figure className="tpl-preview">
          <canvas ref={preview} width={310} height={438} aria-label="템플릿 미리보기" />
          <figcaption>A4 한 쪽에 80칸. 네 모서리 표식과 QR로 사진 속 칸 위치를 찾아요.</figcaption>
        </figure>
      </div>

      <h3>잘 되는 방법</h3>
      <ul className="tips">
        <li>A4에 <b>실제 크기(100%)</b>로 인쇄하세요. ‘페이지에 맞춤’은 꺼 주세요. 흑백 프린터도 괜찮아요.</li>
        <li><b>검은 사인펜이나 중성펜</b>이 가장 잘 돼요. 볼펜도 되지만 획이 조금 두꺼워질 수 있어요(다듬기에서 굵기 조절). 연필은 권하지 않아요.</li>
        <li>칸 밖으로 나가지 않게, 평소보다 조금 크게 써 주세요.</li>
      </ul>
      <p className="source">자주 쓰는 순서: {FREQUENCY_SOURCE}</p>
    </section>
  )
}
