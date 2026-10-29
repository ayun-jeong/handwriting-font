// Everything the user made, kept in this browser's IndexedDB only (never sent anywhere).
import { del, get, set } from 'idb-keyval'
import type { Embedding } from './core/font.ts'
import type { Stroke } from './core/brush.ts'
import { isJamoKey } from './core/compose.ts'
import type { Kind } from './core/geometry.ts'
import { DEFAULT_SETTINGS, autoAlign, type GlyphAdjust, type Settings } from './core/layout.ts'
import type { Outline } from './core/tracer.ts'

export type GlyphRec = {
  char: string
  kind: Kind
  /** Green-channel darkness of the cell, kept for re-tracing at another weight. */
  crop: Uint8Array
  /** Ink level of the page it came from, and how dark its printed guides came out. */
  ink: number
  guide?: number
  outlines: Outline[]
  page: string
  /** Hand corrections painted in the glyph editor, applied over the scanned ink on every re-trace. */
  strokes?: Stroke[]
}

export type Project = {
  version: 1
  glyphs: Record<string, GlyphRec>
  settings: Settings
  adjust: Record<string, GlyphAdjust>
  fontName: string
  embedding: Embedding
  /** Weight the stored outlines were traced at. */
  tracedWeight: number
  /** Automatic sizing already done (once each, so later photos don't undo the user's choices). */
  fitted: { hangul: 'none' | 'composed' | 'written'; latin: boolean; composed: boolean }
}

export function emptyProject(): Project {
  return { version: 1, glyphs: {}, settings: { ...DEFAULT_SETTINGS }, adjust: {}, fontName: '내 손글씨', embedding: 'editable', tracedWeight: 0, fitted: { hangul: 'none', latin: false, composed: false } }
}

const KEY = 'handwriting-font/project-v1'

export async function loadProject(): Promise<Project | null> {
  try {
    const p = (await get(KEY)) as Project | undefined
    if (p?.version !== 1) return null
    const f = (p as { fitted?: { hangul?: unknown; latin?: boolean; composed?: boolean } }).fitted
    const fitted: Project['fitted'] = {
      hangul: f?.hangul === true ? 'written' : f?.hangul === 'composed' || f?.hangul === 'written' ? f.hangul : 'none',
      latin: !!f?.latin, composed: !!f?.composed,
    }
    const settings = { ...DEFAULT_SETTINGS, ...p.settings }
    let adjust = p.adjust
    // saved before the automatic line-up: heights were matched against glyphs that weren't lined up yet
    if ((p.settings as Partial<Settings>).align === undefined) {
      settings.composedShift = 0
      const moved = autoAlign(Object.values(p.glyphs).filter((g) => !isJamoKey(g.char)))
      adjust = Object.fromEntries(Object.entries(p.adjust).map(([k, a]) => [k, moved.has(k) ? { ...a, dy: 0 } : a]))
    }
    return { ...emptyProject(), ...p, settings, adjust, fitted }
  } catch {
    return null
  }
}

export async function saveProject(p: Project): Promise<void> {
  try {
    await set(KEY, p)
  } catch {
    // storage blocked (private mode, quota): the session still works, it just won't be restored
  }
}

export async function clearProject(): Promise<void> {
  try {
    await del(KEY)
  } catch {
    // nothing stored
  }
}
