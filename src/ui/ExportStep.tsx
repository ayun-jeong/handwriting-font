import { useState } from 'react'
// relative path: the package's `exports` field hides the wasm file from bare imports
import woff2Wasm from '../../node_modules/fonteditor-core/woff2/woff2.wasm?url'
import type { Counts, Update } from '../App.tsx'
import { buildOTF, buildTTF, buildWOFF2, type Embedding } from '../core/font.ts'
import { buildGlyphSet } from '../core/glyphset.ts'
import type { Project } from '../project.ts'
import { download } from './download.ts'

type Props = { project: Project; update: Update; family: string | null; counts: Counts; sample: string }
type Format = 'ttf' | 'otf' | 'woff2'
type Scope = 'all' | 'ks'

const FORMATS: { f: Format; title: string; desc: string; mime: string }[] = [
  { f: 'ttf', title: 'TTF', desc: '윈도우·맥·아이패드·한글(HWP) 어디서나. 고민되면 이걸로.', mime: 'font/ttf' },
  { f: 'otf', title: 'OTF', desc: '디자인 프로그램용. 맥에서도 잘 돼요.', mime: 'font/otf' },
  { f: 'woff2', title: 'WOFF2', desc: '웹사이트에 쓸 때. 설치용은 아니에요.', mime: 'font/woff2' },
]

export default function ExportStep({ project, update, family, counts, sample }: Props) {
  const [busy, setBusy] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('all')
  const name = project.fontName.trim() || '내 손글씨'

  async function make(f: Format) {
    setBusy(f)
    setError(null)
    try {
      // let the button repaint before the heavy work
      await new Promise((r) => setTimeout(r, 30))
      const sources = Object.values(project.glyphs).map((g) => ({ key: g.char, kind: g.kind, outlines: g.outlines }))
      const set = buildGlyphSet(sources, project.settings, project.adjust, { scope })
      const meta = { family: name, embedding: project.embedding, settings: project.settings }
      let bytes: Uint8Array
      if (f === 'otf') bytes = buildOTF(set.glyphs, meta)
      else {
        bytes = buildTTF(set.glyphs, meta)
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
      <p className="lead">
        직접 쓴 한글 {counts.hangul}자, 영문·숫자·기호 {counts.latin}자
        {counts.jamo > 0 && (scope === 'all' ? <>, 자모로 조합한 한글 {counts.composable.toLocaleString()}자</> : <>, 완성형 2,350자 중 나머지는 자모로 조합한 글자</>)}가 들어가요.
        없는 글자는 앱이 다른 글꼴로 채워서 보여 줘요.
      </p>

      <div className="split">
        <div className="card options">
          <div className="field">
            <label htmlFor="font-name"><b>폰트 이름</b></label>
            <input id="font-name" type="text" maxLength={40} value={project.fontName} onChange={(e) => update((p) => ({ ...p, fontName: e.target.value }))} />
            <p className="hint">앱의 글꼴 목록에 이 이름으로 보여요.</p>
          </div>
          {counts.jamo > 0 && (
            <fieldset className="field">
              <legend><b>한글 글자 수</b></legend>
              <label className="radio">
                <input type="radio" name="scope" id="scope-all" checked={scope === 'all'} onChange={() => setScope('all')} />
                <span><b>11,172자 전부</b><br /><span className="hint">이름·외래어에 드물게 쓰는 글자까지. TTF는 조합 글자를 조각으로 저장해서 가벼워요.</span></span>
              </label>
              <label className="radio">
                <input type="radio" name="scope" id="scope-ks" checked={scope === 'ks'} onChange={() => setScope('ks')} />
                <span><b>자주 쓰는 2,350자만</b><br /><span className="hint">일상 글의 99.99%를 덮어요. OTF가 훨씬 작아져요.</span></span>
              </label>
            </fieldset>
          )}
          <fieldset className="field">
            <legend><b>문서에 넣어 보낼 때</b></legend>
            {([
              ['editable', '보기·편집만 허용', '파워포인트·한글 문서에 넣어 보내도 받는 사람이 내 폰트를 설치해 가져갈 수 없어요. 내가 설치해서 쓰는 데는 아무 제한이 없어요.'],
              ['installable', '설치까지 허용', '문서를 받은 사람도 이 폰트를 설치해 쓸 수 있어요.'],
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
            {sample.split('\n').slice(0, 3).map((l, i) => <p key={i}>{l}</p>)}
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
      <p className="hint">폰트 파일 자체를 남에게 주면 그 사람도 설치할 수 있어요. 내 글씨를 지키려면 파일 말고 문서로 보내 주세요.</p>

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
