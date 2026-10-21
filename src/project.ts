// Everything the user made, kept in this browser's IndexedDB only (never sent anywhere).
import { del, get, set } from 'idb-keyval'
import type { Embedding } from './core/font.ts'
import type { Kind } from './core/geometry.ts'
import { DEFAULT_SETTINGS, type GlyphAdjust, type Settings } from './core/layout.ts'
import type { Outline } from './core/tracer.ts'

export type GlyphRec = {
  char: string
  kind: Kind
  /** Green-channel darkness of the cell, kept for re-tracing at another weight. */
  crop: Uint8Array
  /** Ink level of the page it came from. */
  ink: number
  outlines: Outline[]
  page: string
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
  /** Scripts whose size was already auto-fitted (done once, so later photos don't undo the user's choice). */
  fitted: { hangul: boolean; latin: boolean }
}

export function emptyProject(): Project {
  return { version: 1, glyphs: {}, settings: { ...DEFAULT_SETTINGS }, adjust: {}, fontName: '내 손글씨', embedding: 'editable', tracedWeight: 0, fitted: { hangul: false, latin: false } }
}

const KEY = 'handwriting-font/project-v1'

export async function loadProject(): Promise<Project | null> {
  try {
    const p = (await get(KEY)) as Project | undefined
    if (p?.version !== 1) return null
    return { ...emptyProject(), ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } }
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
