import { useState } from 'react'
// relative path: the package's `exports` field hides the wasm file from bare imports
import woff2Wasm from '../../node_modules/fonteditor-core/woff2/woff2.wasm?url'
import type { Update } from '../App.tsx'
import { buildOTF, buildTTF, buildWOFF2, type Embedding } from '../core/font.ts'
import { layoutAll } from '../core/layout.ts'
import type { Project } from '../project.ts'
import { shortSample } from '../sampleText.ts'
import { download } from './download.ts'

type Props = { project: Project; update: Update; family: string | null; counts: { hangul: number; latin: number; total: number } }
type Format = 'ttf' | 'otf' | 'woff2'

const FORMATS: { f: Format; title: string; desc: string; mime: string }[] = [
  { f: 'ttf', title: 'TTF', desc: '윈도우·맥·아이패드·한글(HWP) 어디서나. 고민되면 이걸로.', mime: 'font/ttf' },
  { f: 'otf', title: 'OTF', desc: '디자인 프로그램용. 맥에서도 잘 돼요.', mime: 'font/otf' },
  { f: 'woff2', title: 'WOFF2', desc: '웹사이트에 쓸 때. 설치용은 아니에요.', mime: 'font/woff2' },
]

export default function ExportStep({ project, update, family, counts }: Props) {
  const [busy, setBusy] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = project.fontName.trim() || '내 손글씨'

  async function make(f: Format) {
    setBusy(f)
    setError(null)
    try {
      const shapes = Object.values(project.glyphs).map((g) => ({ char: g.char, kind: g.kind, outlines: g.outlines }))
      const laid = layoutAll(shapes, project.settings, project.adjust)
      const meta = { family: name, embedding: project.embedding, settings: project.settings }
      let bytes: Uint8Array
      if (f === 'otf') bytes = buildOTF(laid, meta)
      else {
        bytes = buildTTF(laid, meta)
        if (f === 'woff2') bytes = await buildWOFF2(bytes, woff2Wasm)
      }
      const fmt = FORMATS.find((x) => x.f === f)!
      download(new Blob([bytes as BlobPart], { type: fmt.mime }), `${name}.${f}`)
    } catch (err) {
      setError(`만드는 중 문제가 생겼어요: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel" aria-labelledby="e-h">
      <h2 id="e-h">폰트 받기</h2>
      <p className="lead">한글 {counts.hangul}자, 영문·숫자·기호 {counts.latin}자가 들어가요. 없는 글자는 앱이 다른 글꼴로 채워서 보여 줘요.</p>

      <div className="split">
        <div className="card options">
          <div className="field">
            <label htmlFor="font-name"><b>폰트 이름</b></label>
            <input id="font-name" type="text" maxLength={40} value={project.fontName} onChange={(e) => update((p) => ({ ...p, fontName: e.target.value }))} />
            <p className="hint">앱의 글꼴 목록에 이 이름으로 보여요.</p>
          </div>
          <fieldset className="field">
            <legend><b>문서에 넣어 보낼 때</b></legend>
            {([
              ['editable', '보기·편집만 허용', '파워포인트·한글 문서에 넣어 보내도 받는 사람이 내 폰트를 설치해 가져갈 수 없어요.'],
              ['installable', '설치까지 허용', '받는 사람도 이 폰트를 설치해 쓸 수 있어요.'],
            ] as [Embedding, string, string][]).map(([v, label, desc]) => (
              <label key={v} className="radio">
                <input type="radio" name="embedding" id={`emb-${v}`} checked={project.embedding === v} onChange={() => update((p) => ({ ...p, embedding: v }))} />
                <span><b>{label}</b><br /><span className="hint">{desc}</span></span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="card sample">
          <p className="sample-name">{name}</p>
          <div style={{ fontFamily: family ? `"${family}", var(--font-ui)` : undefined }}>
            {shortSample(new Set(Object.keys(project.glyphs))).map((l, i) => <p key={i}>{l}</p>)}
          </div>
        </div>
      </div>

      <div className="formats">
        {FORMATS.map((x) => (
          <button key={x.f} type="button" className={x.f === 'ttf' ? 'primary format' : 'secondary format'} disabled={busy !== null || !counts.total} onClick={() => void make(x.f)}>
            <span className="format-t">{busy === x.f ? '만드는 중…' : `${x.title} 내려받기`}</span>
            <span className="format-d">{x.desc}</span>
          </button>
        ))}
      </div>
      {error && <p className="status bad" role="alert">{error}</p>}

      <h3>설치하는 법</h3>
      <div className="installs">
        <details><summary>윈도우</summary><p>내려받은 파일을 오른쪽 클릭 → <b>설치</b>. 한글(HWP)·워드·파워포인트를 다시 열면 목록에 보여요.</p></details>
        <details><summary>맥</summary><p>파일을 더블클릭 → <b>설치</b>. 서체 관리자에 들어가면 페이지스·키노트 등에서 바로 쓸 수 있어요.</p></details>
        <details><summary>아이폰·아이패드 (굿노트, 노타빌리티)</summary><p>폰트를 설치해 주는 앱(예: App Store의 폰트 설치 앱)으로 TTF를 열어 설치하면, 굿노트·노타빌리티 같은 앱의 글꼴 목록에 보여요.</p></details>
        <details><summary>갤럭시 폰</summary><p>2026년 3월 One UI 8.5부터 Galaxy Store 밖의 폰트는 설치할 수 없게 막혔어요. PC나 태블릿에서 써 주세요.</p></details>
      </div>
      <p className="source">만든 폰트의 권리는 글씨를 쓴 사람에게 있어요. 이 사이트는 아무것도 보관하지 않아요.</p>
    </section>
  )
}
