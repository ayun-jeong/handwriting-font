import syllables from './data/syllables.json' with { type: 'json' }
import { JAMO_PAGES } from './compose.ts'
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

/** Jamo pages: 1 = syllables without a final consonant, 2 = with a final consonant and the finals. */
export function jamoPage(n: 1 | 2): PageDef {
  return {
    id: `${TEMPLATE_VERSION}|J${n}`, kind: 'hangul',
    title: n === 1 ? '자모 1 · 받침 없는 글자' : '자모 2 · 받침 있는 글자',
    chars: n === 1 ? JAMO_PAGES.J1 : JAMO_PAGES.J2,
  }
}

/** n-th page (1-based) of Hangul syllables, most frequent first. */
export function koreanPage(n: number): PageDef {
  const chars = [...syllables.ranked].slice((n - 1) * CELLS, n * CELLS)
  return { id: `${TEMPLATE_VERSION}|K${n}`, kind: 'hangul', title: `한글 ${n}`, chars }
}

export function pageFromQr(text: string): PageDef | null {
  const t = text.trim()
  const m = /^HF1\|(L|J([12])|K(\d{1,2}))$/.exec(t)
  if (m) {
    if (m[1] === 'L') return latinPage()
    if (m[2]) return jamoPage(Number(m[2]) as 1 | 2)
    const n = Number(m[3])
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

export type Preset = { id: 'quick' | 'standard' | 'careful' | 'master'; name: string; korean: number; note: string }

/** Template sets. Every preset includes both jamo pages, so all 11,172 syllables can be assembled. */
export const PRESETS: Preset[] = [
  { id: 'quick', name: '빠른', korean: 0, note: '자모만 써서 모든 글자를 조합' },
  { id: 'standard', name: '표준', korean: 3, note: '자주 쓰는 240자는 직접' },
  { id: 'careful', name: '정성', korean: 6, note: '자주 쓰는 480자는 직접' },
  { id: 'master', name: '장인', korean: 13, note: '자주 쓰는 1,040자는 직접' },
]
