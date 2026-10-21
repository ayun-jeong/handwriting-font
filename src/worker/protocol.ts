import type { Kind } from '../core/geometry.ts'
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
      page: { id: string; title: string; kind: Kind }
      ink: number; glyphs: ScannedGlyph[]; empties: string[]; check: Blob
    }
  | { t: 'retraced'; id: number; items: { key: string; outlines: Outline[] }[] }
  | { t: 'error'; id: number; message: string }
