import { useEffect, useMemo, useRef, useState } from 'react'
import { FREQUENCY_SOURCE, KOREAN_PAGES, PRESETS, SET_SIZE, koreanCoverage, partsCells, templatePages, type Parts, type Preset } from '../core/charsets.ts'
import { LAYOUTS, PAGE_H, PAGE_W, type LayoutId } from '../core/geometry.ts'
import { drawTemplatePage, templatePdf } from '../core/template.ts'
import { download } from './download.ts'

type Choice = Preset['id'] | 'custom'

// 99.66 must not read as 100%
const pctLabel = (v: number) => `${v >= 99 ? v.toFixed(1) : v.toFixed(0)}%`

const SIZES: { id: LayoutId; label: string; note: string }[] = [
  { id: 'S', label: '작게', note: '칸 5mm · 글씨가 작은 편이면' },
  { id: 'M', label: '보통', note: '칸 9.5mm' },
  { id: 'L', label: '크게', note: '칸 19mm · 큰 글씨' },
]

const SIZE_KEY = 'handwriting-font/template-size'
function savedSize(): LayoutId {
  try {
    const v = localStorage.getItem(SIZE_KEY)
    return v === 'S' || v === 'M' || v === 'L' ? v : 'S'
  } catch {
    return 'S'
  }
}

export default function TemplateStep({ onNext }: { onNext: () => void }) {
  const [size, setSize] = useState<LayoutId>(savedSize)
  const [choice, setChoice] = useState<Choice>('careful')
  const [parts, setParts] = useState<Parts>({ jamo: true, from: 1, to: 6, latin: true, symbols: true })
  const [busy, setBusy] = useState<string | null>(null)
  const preview = useRef<HTMLCanvasElement>(null)

  const chooseSize = (s: LayoutId) => {
    setSize(s)
    try { localStorage.setItem(SIZE_KEY, s) } catch { /* not remembered; fine */ }
  }
  const pick = (c: Choice) => {
    setChoice(c)
    const p = PRESETS.find((x) => x.id === c)
    if (p) setParts({ jamo: true, from: 1, to: p.korean, latin: true, symbols: true })
  }
  const set = (p: Partial<Parts>) => setParts((x) => ({ ...x, ...p }))

  const pages = useMemo(() => templatePages(size, parts), [size, parts])
  const cells = useMemo(() => partsCells(parts).chars.length, [parts])
  const koreanCount = parts.to >= parts.from && parts.to > 0 ? (parts.to - parts.from + 1) * SET_SIZE : 0
  const pagesFor = (korean: number) => templatePages(size, { jamo: true, from: 1, to: korean, latin: true, symbols: true }).length

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
      download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `손글씨-템플릿-${LAYOUTS[size].name}-${pages.length}쪽.pdf`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel" aria-labelledby="t-h">
      <h2 id="t-h">템플릿 받기</h2>
      <p className="lead">
        한글은 자모만 쓰면 11,172자를 전부 조합해 만들어요. 자주 쓰는 글자를 직접 더 쓸수록 실제 글에 내 진짜 글씨가 많이 나와요.
      </p>

      <div className="sizes" role="radiogroup" aria-label="칸 크기">
        <span className="sizes-label">칸 크기</span>
        {SIZES.map((s) => (
          <label key={s.id} className={`size${size === s.id ? ' on' : ''}`}>
            <input type="radio" name="size" id={`size-${s.id}`} checked={size === s.id} onChange={() => chooseSize(s.id)} />
            <b>{s.label}</b>
            <span>{s.note}</span>
          </label>
        ))}
      </div>

      <div className="presets" role="radiogroup" aria-label="얼마나 쓸지">
        {PRESETS.map((p) => (
          <label key={p.id} className={`preset${choice === p.id ? ' on' : ''}`}>
            <input type="radio" name="preset" id={`preset-${p.id}`} checked={choice === p.id} onChange={() => pick(p.id)} />
            <span className="preset-name">{p.name}{p.id === 'careful' && <span className="chip info">추천</span>}</span>
            <span className="preset-pages">{pagesFor(p.korean)}쪽</span>
            <span className="preset-note">{p.note}</span>
            <span className="preset-cov">직접 쓴 글씨가 일상 글의 <b>{pctLabel(koreanCoverage(p.korean))}</b></span>
          </label>
        ))}
        <label className={`preset${choice === 'custom' ? ' on' : ''}`}>
          <input type="radio" name="preset" id="preset-custom" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
          <span className="preset-name">직접 고르기</span>
          <span className="preset-note">이미 쓴 것은 빼고 받을 때</span>
        </label>
      </div>

      <div className="split">
        <div className="card options">
          {choice === 'custom' ? (
            <>
              <label className="check">
                <input id="opt-jamo" type="checkbox" checked={parts.jamo} onChange={(e) => set({ jamo: e.target.checked })} />
                <span><b>자모</b> 157칸 · 나머지 한글을 조합하는 재료</span>
              </label>
              <div className="field">
                <b>자주 쓰는 한글</b>
                <div className="range-pick">
                  <select id="opt-from" aria-label="시작" value={parts.from} onChange={(e) => { const v = Number(e.target.value); set({ from: v, to: Math.max(parts.to, v) }) }}>
                    {Array.from({ length: KOREAN_PAGES }, (_, i) => <option key={i} value={i + 1}>{i * SET_SIZE + 1}번째</option>)}
                  </select>
                  부터
                  <select id="opt-to" aria-label="끝" value={parts.to} onChange={(e) => set({ to: Number(e.target.value) })}>
                    <option value={0}>안 받음</option>
                    {Array.from({ length: KOREAN_PAGES }, (_, i) => i + 1).filter((n) => n >= parts.from).map((n) => <option key={n} value={n}>{n * SET_SIZE}번째</option>)}
                  </select>
                  까지
                </div>
              </div>
              <label className="check">
                <input id="opt-latin" type="checkbox" checked={parts.latin} onChange={(e) => set({ latin: e.target.checked })} />
                <span><b>영문·숫자·기호</b> 80칸</span>
              </label>
              <label className="check">
                <input id="opt-symbols" type="checkbox" checked={parts.symbols} onChange={(e) => set({ symbols: e.target.checked })} />
                <span><b>특수문자</b> 80칸 · ♥ ★ → ㅋㅋ ㅠㅠ 「」 ₩ ℃ 등</span>
              </label>
            </>
          ) : (
            <ul className="page-list">
              <li><b>자모</b> 157칸. 하늘색으로 진한 부분만 따라 써요.</li>
              {parts.to > 0 && <li><b>자주 쓰는 한글</b> {koreanCount}자</li>}
              <li><b>영문·숫자·기호</b> 80칸</li>
              <li><b>특수문자</b> 80칸 · ♥ ★ → ㅋㅋ ㅠㅠ 「」 ₩ ℃ 등</li>
            </ul>
          )}
          <p className="hint">
            모두 {cells}칸, {LAYOUTS[size].name} 칸으로 {pages.length}쪽.{' '}
            {koreanCount > 0
              ? <>자주 쓰는 {koreanCount}자를 직접 쓰면 일상 글에 나오는 글자의 <b>{pctLabel(koreanCoverage(parts.to))}</b>가 진짜 내 글씨로 보이고, 나머지는 자모로 조합돼요.</>
              : '모든 한글을 자모로 조합해요.'}
          </p>
          <button type="button" className="primary" disabled={!pages.length || busy !== null} onClick={makePdf}>
            {busy !== null ? `PDF 만드는 중 ${busy}/${pages.length}쪽` : `PDF 내려받기 · ${pages.length}쪽`}
          </button>
          <button type="button" className="ghost" onClick={onNext}>이미 썼어요, 사진 올리기 →</button>
        </div>

        <figure className="tpl-preview">
          <canvas ref={preview} width={310} height={438} aria-label="템플릿 첫 쪽 미리보기" />
          <figcaption>첫 쪽 미리보기. 표식과 QR로 사진 속 칸 위치를 찾아요.</figcaption>
        </figure>
      </div>

      <h3>잘 되는 방법</h3>
      <ul className="tips">
        <li>A4에 <b>실제 크기(100%)</b>로 인쇄하세요. ‘페이지에 맞춤’은 꺼 주세요. 흑백 프린터도 괜찮아요.</li>
        <li><b>검은 사인펜이나 중성펜</b>이 가장 잘 돼요. 볼펜도 되지만 획이 조금 두꺼워질 수 있어요(다듬기에서 굵기 조절). 연필은 권하지 않아요.</li>
        <li>자모 칸은 안내 위치와 크기에 맞춰 쓰세요. 그래야 조합한 글자의 자모끼리 잘 맞물려요.</li>
        {size === 'L'
          ? <li>칸 밖으로 나가지 않게, 평소보다 조금 크게 써 주세요.</li>
          : <li>칸이 작아서 사진이 선명해야 해요. 종이가 화면에 꽉 차게 찍거나, <b>위·아래 반씩 가까이</b> 찍어 주세요(가운데 양쪽 표식이 보이게).</li>}
        <li><b>PDF로 올려도 돼요.</b> 스캐너·스캔 앱으로 만든 PDF나 사진 여러 장을 묶은 PDF를 올리면 쪽마다 읽어요. 스캔은 사진보다 또렷해서 작은 칸에 특히 좋아요. <b>컬러나 회색조로</b> 스캔해 주세요(흑백 모드는 하늘색 안내선까지 글씨처럼 진해져요).</li>
      </ul>
      <p className="source">자주 쓰는 순서: {FREQUENCY_SOURCE}</p>
    </section>
  )
}
