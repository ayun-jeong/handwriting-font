import syllables from './data/syllables.json' with { type: 'json' }
import { CELLS, type Kind } from './geometry.ts'

export type PageDef = {
  /** Value encoded in the page's QR code. */
  id: string
  kind: Kind
  title: string
  chars: string[]
}

export const TEMPLATE_VERSION = 'HF1'
export const KOREAN_PAGES = Math.floor(syllables.ranked.length / CELLS)

const LATIN = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', ...'.,!?\'"-()&:;/@#%+*']

// Pages of the first printed test template (spike-v1), still accepted so those printouts keep working.
const SPIKE_KOREAN = [...'다람쥐헌쳇바퀴에타고파키스의유조건은입술끼리만나야하특별한기필요치않손글씨로든꼴오늘도좋루되세안녕반갑습니이는을가지서사자어수아해대일정시인있적과보것국상전들장']

export function latinPage(): PageDef {
  return { id: `${TEMPLATE_VERSION}|L`, kind: 'latin', title: '영문·숫자·기호', chars: LATIN }
}

/** n-th page (1-based) of Hangul syllables, most frequent first. */
export function koreanPage(n: number): PageDef {
  const chars = [...syllables.ranked].slice((n - 1) * CELLS, n * CELLS)
  return { id: `${TEMPLATE_VERSION}|K${n}`, kind: 'hangul', title: `한글 ${n}`, chars }
}

export function pageFromQr(text: string): PageDef | null {
  const t = text.trim()
  const m = /^HF1\|(L|K(\d{1,2}))$/.exec(t)
  if (m) {
    if (m[1] === 'L') return latinPage()
    const n = Number(m[2])
    return n >= 1 && n <= KOREAN_PAGES ? koreanPage(n) : null
  }
  const legacy = /^HWF1;P=(\d);N=2;S=spike-v1$/.exec(t)
  if (legacy) {
    if (legacy[1] === '1') return { id: t, kind: 'hangul', title: '한글 (테스트)', chars: SPIKE_KOREAN }
    if (legacy[1] === '2') return { ...latinPage(), id: t }
  }
  return null
}

/** Share of syllables in ordinary written Korean covered by the first `pages` Korean pages (percent). */
export function koreanCoverage(pages: number): number {
  if (pages <= 0) return 0
  const table = syllables.coverageByCount as Record<string, number>
  return table[String(Math.min(pages, KOREAN_PAGES) * CELLS)] ?? 0
}

export const FREQUENCY_SOURCE = syllables.source
