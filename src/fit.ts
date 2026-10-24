// Automatic sizing, applied as photos come in (each step once, so later photos never undo the user's sliders).
import { koreanPage } from './core/charsets.ts'
import { isSyllable } from './core/compose.ts'
import { assembledOutlines } from './core/glyphset.ts'
import { bounds, fitScale } from './core/layout.ts'
import type { Outline } from './core/tracer.ts'
import type { Project } from './project.ts'

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]

export function refit(p: Project): Project {
  const all = Object.values(p.glyphs)
  const sources = all.map((g) => ({ key: g.char, kind: g.kind, outlines: g.outlines }))
  const written = all.filter((g) => isSyllable(g.char))
  const settings = { ...p.settings }
  const fitted = { ...p.fitted }
  const height = (o: Outline[]) => { const b = bounds(o); return b[3] - b[1] }

  // Hangul size: from the user's own syllables, or from assembled ones until there are some
  if (fitted.hangul !== 'written') {
    if (written.length >= 8) {
      settings.hangulScale = fitScale(720, written.map((g) => height(g.outlines)))
      fitted.hangul = 'written'
    } else if (fitted.hangul === 'none') {
      const asm = assembledOutlines(sources, koreanPage(1).chars)
      if (asm.length >= 8) { settings.hangulScale = fitScale(720, asm.map(height)); fitted.hangul = 'composed' }
    }
  }

  // assembled syllables: same size as the same syllables written by hand (both are centred by autoAlign)
  if (!fitted.composed && written.length >= 8) {
    const ratios: number[] = []
    for (const g of written) {
      const [a] = assembledOutlines(sources, [g.char])
      if (!a) continue
      const bw = bounds(g.outlines), ba = bounds(a)
      ratios.push((bw[3] - bw[1]) / (ba[3] - ba[1]))
    }
    if (ratios.length >= 8) {
      settings.composedScale = Math.round(Math.min(1.6, Math.max(0.6, median(ratios))) * 100) / 100
      fitted.composed = true
    }
  }

  if (!fitted.latin) {
    const caps = all.filter((g) => /^[A-Z]$/.test(g.char)).map((g) => bounds(g.outlines)[3])
    if (caps.length >= 8) { settings.latinScale = fitScale(700, caps); fitted.latin = true }
  }
  return { ...p, settings, fitted }
}
