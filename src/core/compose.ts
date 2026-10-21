// Hangul syllables assembled from jamo the user wrote in position (jamo template pages).
//
// Six layout types: vowel shape (vertical ㅏ / horizontal ㅗ / compound ㅘ) × final consonant (no / yes).
// The user writes initials for types 1–5, vowels without and (vertical, horizontal) with a final, and the
// 27 finals under ㅏ. Every other variant is derived from its nearest written sibling by mapping the region
// where that jamo sits in one layout onto the region of the other (regions measured from Pretendard,
// the font the trace guides come from).
import guides from './data/jamo-guides.json' with { type: 'json' }
import type { Pt } from './geometry.ts'
import { mapOutlines, type Outline } from './tracer.ts'

export type Rect = [number, number, number, number]
type Role = 'L' | 'V' | 'T'

const REGIONS = guides.regions as unknown as Record<Role, Record<string, Rect>>
const VERTICAL = new Set([0, 1, 2, 3, 4, 5, 6, 7, 20])
const HORIZONTAL = new Set([8, 12, 13, 17, 18])

export const JAMO_L = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
export const JAMO_V = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
export const JAMO_T = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'

export const isJamoKey = (k: string) => k.startsWith('j:')
export const isSyllable = (c: string) => c.length === 1 && c >= '가' && c <= '힣'

/** Vowel class: 0 vertical, 1 horizontal, 2 compound. */
const vclass = (v: number) => (VERTICAL.has(v) ? 0 : HORIZONTAL.has(v) ? 1 : 2)

export function decompose(ch: string) {
  const i = ch.charCodeAt(0) - 0xac00
  const l = Math.floor(i / 588), v = Math.floor((i % 588) / 28), t = i % 28
  const cls = vclass(v)
  return { l, v, t, cls, type: cls + (t ? 3 : 0) + 1 }
}

/** What a jamo template cell asks for, from its key (`j:L:<l>:<type>`, `j:V:<v>:<final 0|1>`, `j:T:<t>:0`). */
export function jamoCell(key: string) {
  const g = (guides.guides as Record<string, { jamo: string; ctx: string; target: string; rest: string }>)[key]
  return g ? { ...g, key } : null
}

/** Readable label for a jamo piece: the jamo and the syllable it was written for. */
export function jamoLabel(key: string): string {
  const c = jamoCell(key)
  return c ? `${c.jamo} (${c.ctx})` : key
}

export const JAMO_PAGES = guides.pages as { J1: string[]; J2: string[] }
export const GUIDE_SOURCE = guides.source

// ---- variants: every positional form a syllable can need, written or derived

/** Variant ids: `L:<l>:<type 1-6>`, `V:<v>:<final 0|1>`, `T:<t>:<class 0-2>`. */
export type VariantId = string

function mapRect(o: Outline[], from: Rect, to: Rect): Outline[] {
  const sx = (to[2] - to[0]) / (from[2] - from[0]), sy = (to[3] - to[1]) / (from[3] - from[1])
  return mapOutlines(o, ([x, y]): Pt => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy])
}

const regionL = (type: number) => REGIONS.L[String(type)]
const regionV = (cls: number, fin: number) => REGIONS.V[String(cls + 1 + fin * 3)]
const regionT = (cls: number) => REGIONS.T[String(cls + 4)]

/** Written pieces (jamo key -> outlines) -> every variant that can be made from them. */
export function resolveVariants(written: Map<string, Outline[]>): Map<VariantId, Outline[]> {
  const out = new Map<VariantId, Outline[]>()
  for (let l = 0; l < 19; l++) {
    for (let type = 1; type <= 6; type++) {
      const sibling = type <= 3 ? type + 3 : type - 3
      const order = [type, sibling, 1, 4, 2, 5, 3, 6]
      const src = order.find((s) => s <= 5 && written.has(`j:L:${l}:${s}`))
      if (src === undefined) continue
      const o = written.get(`j:L:${l}:${src}`)!
      out.set(`L:${l}:${type}`, src === type ? o : mapRect(o, regionL(src), regionL(type)))
    }
  }
  for (let v = 0; v < 21; v++) {
    const cls = vclass(v)
    for (const fin of [0, 1]) {
      const src = [fin, 1 - fin].find((f) => written.has(`j:V:${v}:${f}`))
      if (src === undefined) continue
      const o = written.get(`j:V:${v}:${src}`)!
      out.set(`V:${v}:${fin}`, src === fin ? o : mapRect(o, regionV(cls, src), regionV(cls, fin)))
    }
  }
  for (let t = 1; t < 28; t++) {
    const o = written.get(`j:T:${t}:0`)
    if (!o) continue
    for (const cls of [0, 1, 2]) out.set(`T:${t}:${cls}`, cls === 0 ? o : mapRect(o, regionT(0), regionT(cls)))
  }
  return out
}

/** Variant ids a syllable is assembled from, or null if one of them is missing. */
export function syllableParts(ch: string, variants: Map<VariantId, unknown>): VariantId[] | null {
  const { l, v, t, cls, type } = decompose(ch)
  const parts = [`L:${l}:${type}`, `V:${v}:${t ? 1 : 0}`]
  if (t) parts.push(`T:${t}:${cls}`)
  return parts.every((p) => variants.has(p)) ? parts : null
}

export const ALL_SYLLABLES: string[] = Array.from({ length: 11172 }, (_, i) => String.fromCharCode(0xac00 + i))

const syl = (l: number, v: number, t: number) => String.fromCharCode(0xac00 + l * 588 + v * 28 + t)
const CLASS_VOWELS: number[][] = [[0, 4, 20], [8, 13, 18], [9, 14, 16]]

/** A few syllables that use a jamo piece, to show it in context while editing. */
export function examplesFor(key: string): string[] {
  const [, role, a, b] = key.split(':')
  const n = Number(a), m = Number(b)
  if (role === 'L') {
    const cls = (m - 1) % 3, fin = m > 3 ? 4 : 0
    return CLASS_VOWELS[cls].map((v) => syl(n, v, fin))
  }
  if (role === 'V') return [0, 6, 9].map((l) => syl(l, n, m ? 4 : 0))
  if (role === 'T') return [[0, 0], [6, 4], [9, 8]].map(([l, v]) => syl(l, v, n))
  return []
}

/** Every example syllable, so the preview font can always show them. */
export const JAMO_EXAMPLES: string = [...JAMO_PAGES.J1, ...JAMO_PAGES.J2].flatMap(examplesFor).join('')
