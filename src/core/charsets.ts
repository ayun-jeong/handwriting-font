import syllables from './data/syllables.json' with { type: 'json' }
import { JAMO_PAGES } from './compose.ts'
import { LAYOUTS, type Kind, type LayoutId } from './geometry.ts'

export type PageDef = {
  /** Value encoded in the page's QR code(s). */
  id: string
  layout: LayoutId
  title: string
  /** Cell contents in slot order: a character, or a jamo key (`j:...`). */
  chars: string[]
  kinds: Kind[]
}

/** 80 syllables per set (one page of the large layout). */
export const SET_SIZE = 80
export const KOREAN_PAGES = Math.floor(syllables.ranked.length / SET_SIZE)

const LATIN = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', ...'.,!?\'"-()&:;/@#%+*']

// Frequently used symbols. Full-width ones (chat jamo, hearts, arrows, CJK brackets) sit in the em box like
// Hangul; the rest sit on the baseline like Latin.
const SYMBOLS: [string, Kind][] = [
  ...[...'ㅋㅎㅠㅜㅡㅇㄱㄴㄷㅂㅅㅈㅊ'].map((c): [string, Kind] => [c, 'hangul']),
  ...[...'♥♡★☆♪♬○●◎△▲□■◇◆※✓✗'].map((c): [string, Kind] => [c, 'hangul']),
  ...[...'→←↑↓↔⇒↗↘'].map((c): [string, Kind] => [c, 'hangul']),
  ...[...'~^=<>$_[]{}|\\`'].map((c): [string, Kind] => [c, 'latin']),
  ...[...'±×÷≠≤≥∞°℃₩€¥£'].map((c): [string, Kind] => [c, 'latin']),
  ...[...'·…‘’“”'].map((c): [string, Kind] => [c, 'latin']),
  ...[...'「」『』《》〈〉'].map((c): [string, Kind] => [c, 'hangul']),
]

// Pages of the first printed test template (spike-v1), still accepted so those printouts keep working.
const SPIKE_KOREAN = [...'다람쥐헌쳇바퀴에타고파키스의유조건은입술끼리만나야하특별한기필요치않손글씨로든꼴오늘도좋루되세안녕반갑습니이는을가지서사자어수아해대일정시인있적과보것국상전들장']

const page = (id: string, title: string, chars: string[], kind: Kind): PageDef => ({ id, layout: 'L', title, chars, kinds: chars.map(() => kind) })

export function latinPage(): PageDef {
  return page('HF1|L', '영문·숫자·기호', LATIN, 'latin')
}

export function symbolPage(): PageDef {
  return { id: 'HF1|Y', layout: 'L', title: '특수문자', chars: SYMBOLS.map((x) => x[0]), kinds: SYMBOLS.map((x) => x[1]) }
}

/** Jamo pages: 1 = syllables without a final consonant, 2 = with a final consonant and the finals. */
export function jamoPage(n: 1 | 2): PageDef {
  return page(`HF1|J${n}`, n === 1 ? '자모 1 · 받침 없는 글자' : '자모 2 · 받침 있는 글자', n === 1 ? JAMO_PAGES.J1 : JAMO_PAGES.J2, 'hangul')
}

const koreanSet = (n: number) => [...syllables.ranked].slice((n - 1) * SET_SIZE, n * SET_SIZE)

/** n-th set (1-based) of Hangul syllables, most frequent first. */
export function koreanPage(n: number): PageDef {
  return page(`HF1|K${n}`, `한글 ${n}`, koreanSet(n), 'hangul')
}

/** What goes on the template: both jamo pages, Korean sets from..to (0 = none), the Latin set, the symbol set. */
export type Parts = { jamo: boolean; from: number; to: number; latin: boolean; symbols: boolean }

export function partsKey(p: Parts): string {
  const t: string[] = []
  if (p.jamo) t.push('J')
  if (p.to > 0 && p.to >= p.from) t.push(p.from === p.to ? `K${p.from}` : `K${p.from}-${p.to}`)
  if (p.latin) t.push('L')
  if (p.symbols) t.push('Y')
  return t.join('.')
}

function parseParts(s: string): Parts | null {
  const p: Parts = { jamo: false, from: 1, to: 0, latin: false, symbols: false }
  for (const t of s.split('.')) {
    const k = /^K(\d{1,2})(?:-(\d{1,2}))?$/.exec(t)
    if (t === 'J') p.jamo = true
    else if (t === 'L') p.latin = true
    else if (t === 'Y') p.symbols = true
    else if (k) {
      p.from = Number(k[1]); p.to = Number(k[2] ?? k[1])
      if (p.from < 1 || p.to > KOREAN_PAGES || p.to < p.from) return null
    } else return null
  }
  return p
}

/** All cells of a selection, in template order. */
export function partsCells(p: Parts): { chars: string[]; kinds: Kind[] } {
  const chars: string[] = [], kinds: Kind[] = []
  const add = (list: string[], kind: Kind) => { for (const c of list) { chars.push(c); kinds.push(kind) } }
  if (p.jamo) add([...JAMO_PAGES.J1, ...JAMO_PAGES.J2], 'hangul')
  for (let n = p.from; p.to > 0 && n <= p.to; n++) add(koreanSet(n), 'hangul')
  if (p.latin) add(LATIN, 'latin')
  if (p.symbols) for (const [c, k] of SYMBOLS) { chars.push(c); kinds.push(k) }
  return { chars, kinds }
}

/** The printable pages for a selection. 크게 keeps one set per page; 보통·작게 pack everything densely. */
export function templatePages(layout: LayoutId, p: Parts): PageDef[] {
  if (layout === 'L') {
    const out: PageDef[] = []
    if (p.jamo) out.push(jamoPage(1), jamoPage(2))
    for (let n = p.from; p.to > 0 && n <= p.to; n++) out.push(koreanPage(n))
    if (p.latin) out.push(latinPage())
    if (p.symbols) out.push(symbolPage())
    return out
  }
  const { chars, kinds } = partsCells(p)
  const cap = LAYOUTS[layout].slots.length
  const total = Math.ceil(chars.length / cap)
  const key = partsKey(p)
  return Array.from({ length: total }, (_, i) => ({
    id: `HF2|${layout}|${key}|${i + 1}`, layout, title: `${LAYOUTS[layout].name} ${i + 1}/${total}`,
    chars: chars.slice(i * cap, (i + 1) * cap), kinds: kinds.slice(i * cap, (i + 1) * cap),
  }))
}

export function pageFromQr(text: string): PageDef | null {
  const t = text.trim()
  const m = /^HF1\|(L|Y|J([12])|K(\d{1,2}))$/.exec(t)
  if (m) {
    if (m[1] === 'L') return latinPage()
    if (m[1] === 'Y') return symbolPage()
    if (m[2]) return jamoPage(Number(m[2]) as 1 | 2)
    const n = Number(m[3])
    return n >= 1 && n <= KOREAN_PAGES ? koreanPage(n) : null
  }
  const dense = /^HF2\|([MS])\|([A-Z0-9.-]+)\|(\d{1,2})$/.exec(t)
  if (dense) {
    const parts = parseParts(dense[2])
    if (!parts) return null
    return templatePages(dense[1] as LayoutId, parts)[Number(dense[3]) - 1] ?? null
  }
  const legacy = /^HWF1;P=(\d);N=2;S=spike-v1$/.exec(t)
  if (legacy) {
    if (legacy[1] === '1') return page(t, '한글 (테스트)', SPIKE_KOREAN, 'hangul')
    if (legacy[1] === '2') return { ...latinPage(), id: t }
  }
  return null
}

/** Share of syllables in ordinary written Korean covered by the first `sets` Korean sets (percent). */
export function koreanCoverage(sets: number): number {
  if (sets <= 0) return 0
  const table = syllables.coverageByCount as Record<string, number>
  return table[String(Math.min(sets, KOREAN_PAGES) * SET_SIZE)] ?? 0
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
