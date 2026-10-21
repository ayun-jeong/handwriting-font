import { useState } from 'react'

const LICENSES: [string, string, string][] = [
  ['OpenCV.js (@techstark/opencv-js)', 'Apache-2.0', 'https://github.com/TechStark/opencv-js'],
  ['fonteditor-core', 'MIT', 'https://github.com/kekee000/fonteditor-core'],
  ['opentype.js', 'MIT', 'https://github.com/opentypejs/opentype.js'],
  ['fit-curve', 'MIT', 'https://github.com/soswow/fit-curves'],
  ['pdf-lib', 'MIT', 'https://github.com/Hopding/pdf-lib'],
  ['qrcode-generator', 'MIT', 'https://github.com/kazuhikoarase/qrcode-generator'],
  ['idb-keyval', 'Apache-2.0', 'https://github.com/jakearchibald/idb-keyval'],
  ['React', 'MIT', 'https://github.com/facebook/react'],
]

export default function Footer({ onRestart, hasWork }: { onRestart: () => void; hasWork: boolean }) {
  const [asking, setAsking] = useState(false)
  return (
    <footer className="foot">
      <p>사진과 글씨는 이 브라우저 안에서만 처리되고 저장돼요. 서버로 보내지 않고, 방문 기록도 모으지 않아요.</p>
      {hasWork && (
        <div className="restart">
          {asking ? (
            <>
              <span>모은 글자와 설정이 모두 지워져요.</span>
              <button type="button" className="danger" onClick={() => { setAsking(false); onRestart() }}>지우고 처음부터</button>
              <button type="button" className="ghost" onClick={() => setAsking(false)}>취소</button>
            </>
          ) : (
            <button type="button" className="ghost" onClick={() => setAsking(true)}>처음부터 다시 하기</button>
          )}
        </div>
      )}
      <details>
        <summary>오픈소스 라이선스</summary>
        <ul>
          {LICENSES.map(([n, l, u]) => <li key={n}><a href={u} target="_blank" rel="noreferrer">{n}</a> · {l}</li>)}
        </ul>
        <p>이 사이트는 있는 그대로 제공되며, 만든 폰트를 쓰다 생긴 문제에 대해 책임지지 않아요.</p>
      </details>
    </footer>
  )
}
