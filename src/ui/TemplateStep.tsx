import { useEffect, useMemo, useRef, useState } from 'react'
import { FREQUENCY_SOURCE, KOREAN_PAGES, PRESETS, jamoPage, koreanCoverage, koreanPage, latinPage, type PageDef, type Preset } from '../core/charsets.ts'
import { PAGE_H, PAGE_W } from '../core/geometry.ts'
import { drawTemplatePage, templatePdf } from '../core/template.ts'
import { download } from './download.ts'

type Choice = Preset['id'] | 'custom'

export default function TemplateStep({ onNext }: { onNext: () => void }) {
  const [choice, setChoice] = useState<Choice>('careful')
  const [jamo, setJamo] = useState(true)
  const [latin, setLatin] = useState(true)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(6)
  const [busy, setBusy] = useState<string | null>(null)
  const preview = useRef<HTMLCanvasElement>(null)

  const pick = (c: Choice) => {
    setChoice(c)
    const p = PRESETS.find((x) => x.id === c)
    if (p) { setJamo(true); setLatin(true); setFrom(1); setTo(p.korean) }
  }

  const pages: PageDef[] = useMemo(() => {
    const list: PageDef[] = []
    if (jamo) list.push(jamoPage(1), jamoPage(2))
    for (let n = from; n <= to && to > 0; n++) list.push(koreanPage(n))
    if (latin) list.push(latinPage())
    return list
  }, [jamo, latin, from, to])

  const koreanCount = to >= from && to > 0 ? (to - from + 1) * 80 : 0

  useEffect(() => {
    const c = preview.current
    if (!c || !pages.length) return
    const full = new OffscreenCanvas(PAGE_W, PAGE_H)
    drawTemplatePage(full.getContext('2d')!, pages[0], 1, pages.length)
    c.getContext('2d')!.drawImage(full, 0, 0, c.width, c.height)
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
      <p className="lead">
        한글은 자모 2쪽만 쓰면 11,172자를 전부 조합해 만들어요. 자주 쓰는 글자를 직접 더 쓸수록 실제 글에 내 진짜 글씨가 많이 나와요.
      </p>

      <div className="presets" role="radiogroup" aria-label="얼마나 쓸지">
        {PRESETS.map((p) => {
          const pagesN = 2 + p.korean + 1
          return (
            <label key={p.id} className={`preset${choice === p.id ? ' on' : ''}`}>
              <input type="radio" name="preset" id={`preset-${p.id}`} checked={choice === p.id} onChange={() => pick(p.id)} />
              <span className="preset-name">{p.name}{p.id === 'careful' && <span className="chip info">추천</span>}</span>
              <span className="preset-pages">{pagesN}쪽</span>
              <span className="preset-note">{p.note}</span>
              <span className="preset-cov">직접 쓴 글씨가 일상 글의 <b>{koreanCoverage(p.korean).toFixed(0)}%</b></span>
            </label>
          )
        })}
        <label className={`preset${choice === 'custom' ? ' on' : ''}`}>
          <input type="radio" name="preset" id="preset-custom" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
          <span className="preset-name">직접 고르기</span>
          <span className="preset-note">이미 쓴 쪽은 빼고 받을 때</span>
        </label>
      </div>

      <div className="split">
        <div className="card options">
          {choice === 'custom' ? (
            <>
              <label className="check">
                <input id="opt-jamo" type="checkbox" checked={jamo} onChange={(e) => setJamo(e.target.checked)} />
                <span><b>자모</b> 2쪽, 157칸 · 나머지 한글을 조합하는 재료</span>
              </label>
              <div className="field">
                <b>자주 쓰는 한글</b>
                <div className="range-pick">
                  <select id="opt-from" aria-label="시작 쪽" value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to < v) setTo(v) }}>
                    {Array.from({ length: KOREAN_PAGES }, (_, i) => <option key={i} value={i + 1}>{i + 1}쪽</option>)}
                  </select>
                  부터
                  <select id="opt-to" aria-label="끝 쪽" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                    <option value={0}>안 받음</option>
                    {Array.from({ length: KOREAN_PAGES }, (_, i) => i + 1).filter((n) => n >= from).map((n) => <option key={n} value={n}>{n}쪽</option>)}
                  </select>
                  까지
                </div>
              </div>
              <label className="check">
                <input id="opt-latin" type="checkbox" checked={latin} onChange={(e) => setLatin(e.target.checked)} />
                <span><b>영문·숫자·기호</b> 1쪽, 80자</span>
              </label>
            </>
          ) : (
            <ul className="page-list">
              <li><b>자모 2쪽</b> · 157칸. 하늘색으로 진한 부분만 따라 써요.</li>
              {to > 0 && <li><b>자주 쓰는 한글 {to}쪽</b> · {koreanCount}자</li>}
              <li><b>영문·숫자·기호 1쪽</b> · 80자</li>
            </ul>
          )}
          <p className="hint">
            {koreanCount > 0
              ? <>자주 쓰는 {koreanCount}자를 직접 쓰면 일상 글에 나오는 글자의 <b>{koreanCoverage(to).toFixed(1)}%</b>가 진짜 내 글씨로 보이고, 나머지는 자모로 조합돼요.</>
              : '모든 한글을 자모로 조합해요.'}
          </p>
          <button type="button" className="primary" disabled={!pages.length || busy !== null} onClick={makePdf}>
            {busy !== null ? `PDF 만드는 중 ${busy}/${pages.length}쪽` : `PDF 내려받기 · ${pages.length}쪽`}
          </button>
          <button type="button" className="ghost" onClick={onNext}>이미 썼어요, 사진 올리기 →</button>
        </div>

        <figure className="tpl-preview">
          <canvas ref={preview} width={310} height={438} aria-label="템플릿 첫 쪽 미리보기" />
          <figcaption>첫 쪽 미리보기. 네 모서리 표식과 QR로 사진 속 칸 위치를 찾아요.</figcaption>
        </figure>
      </div>

      <h3>잘 되는 방법</h3>
      <ul className="tips">
        <li>A4에 <b>실제 크기(100%)</b>로 인쇄하세요. ‘페이지에 맞춤’은 꺼 주세요. 흑백 프린터도 괜찮아요.</li>
        <li><b>검은 사인펜이나 중성펜</b>이 가장 잘 돼요. 볼펜도 되지만 획이 조금 두꺼워질 수 있어요(다듬기에서 굵기 조절). 연필은 권하지 않아요.</li>
        <li>자모 칸은 안내 위치와 크기에 맞춰 쓰세요. 그래야 조합한 글자의 자모끼리 잘 맞물려요.</li>
        <li>칸 밖으로 나가지 않게, 평소보다 조금 크게 써 주세요.</li>
      </ul>
      <p className="source">자주 쓰는 순서: {FREQUENCY_SOURCE}</p>
    </section>
  )
}
