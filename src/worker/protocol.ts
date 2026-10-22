import type { Kind, LayoutId } from '../core/geometry.ts'
import type { Outline } from '../core/tracer.ts'

export type ScannedGlyph = { index: number; char: string; kind: Kind; crop: Uint8Array; outlines: Outline[] }

export type EngineRequest =
  | { t: 'warmup'; id: number }
  | { t: 'scan'; id: number; bitmap: ImageBitmap; weight: number }
  | { t: 'retrace'; id: number; weight: number; items: { key: string; kind: Kind; crop: Uint8Array; ink: number }[] }

export type EngineResponse =
  | { t: 'ready'; id: number }
  | { t: 'scanned'; id: number; ok: false; reason: 'markers' | 'qr' | 'page'; markers: number }
  | {
      t: 'scanned'; id: number; ok: true
      page: { id: string; title: string; layout: LayoutId }
      ink: number; glyphs: ScannedGlyph[]; empties: string[]; check: Blob
      /** Cells inside this photo, out of all cells on the page, and which ones (slot indices). */
      visible: number; total: number; seen: number[]
      /** Photo pixels across one cell, and the photo's blur (Gaussian sigma) in photo pixels. */
      cellPx: number; blurPx: number
    }
  | { t: 'retraced'; id: number; items: { key: string; outlines: Outline[] }[] }
  /** Sent while a scan runs; `done` is 0..1. */
  | { t: 'progress'; id: number; done: number }
  | { t: 'error'; id: number; message: string }
