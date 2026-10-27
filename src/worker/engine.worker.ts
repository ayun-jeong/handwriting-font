/// <reference lib="webworker" />
// Heavy lifting off the main thread: OpenCV.js (13 MB) is loaded here on first use.
import cvModule from '@techstark/opencv-js'
import { paintStrokes } from '../core/brush.ts'
import type { CV } from '../core/cv.ts'
import { CROP, LAYOUTS, type LayoutId } from '../core/geometry.ts'
import { OVERVIEW, UPSAMPLE, extractMask, maskToOutlines, scanPage, traceCells, type RGBAImage } from '../core/pipeline.ts'
import type { EngineRequest, EngineResponse, ScannedGlyph } from './protocol.ts'

declare const self: DedicatedWorkerGlobalScope

// Static import: a dynamic import() of the bundled OpenCV namespace trips over its `then` export.
// The worker itself is only started when photos are about to come in.
let cvReady: Promise<{ cv: CV }> | null = null

function loadCv(): Promise<{ cv: CV }> {
  cvReady ??= new Promise((resolve, reject) => {
    const m: CV = cvModule
    if (m.Mat) resolve({ cv: m })
    else if (typeof m.then === 'function') {
      // the browser build exports a promise of the initialised module
      m.then((cv: CV) => {
        if (cv?.Mat) resolve({ cv })
        else cv.onRuntimeInitialized = () => resolve({ cv })
      }, reject)
    } else m.onRuntimeInitialized = () => resolve({ cv: m })
  })
  return cvReady
}

function post(msg: EngineResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer)
}

const MAX_SIDE = 5000

/** The page as the scanner saw it, with every cell marked: green read, red empty, grey outside this photo. */
async function checkImage(ov: RGBAImage, layout: LayoutId, found: Set<number>, visible: boolean[]): Promise<Blob> {
  const c = new OffscreenCanvas(ov.width, ov.height)
  const ctx = c.getContext('2d')!
  const px = new Uint8ClampedArray(ov.width * ov.height * 4)
  px.set(ov.data)
  ctx.putImageData(new ImageData(px, ov.width, ov.height), 0, 0)
  const lay = LAYOUTS[layout]
  const b = lay.box * OVERVIEW
  ctx.lineWidth = Math.max(1.5, b / 28)
  visible.forEach((v, i) => {
    const [x, y] = lay.slots[i]
    ctx.strokeStyle = !v ? 'rgba(120,120,120,0.6)' : found.has(i) ? 'rgb(30,160,90)' : 'rgb(220,60,50)'
    ctx.strokeRect(x * OVERVIEW - 1, y * OVERVIEW - 1, b + 2, b + 2)
  })
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const msg = e.data
  try {
    if (msg.t === 'warmup') {
      await loadCv()
      post({ t: 'ready', id: msg.id })
      return
    }
    const { cv } = await loadCv()
    if (msg.t === 'scan') {
      const bmp = msg.bitmap
      const f = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
      const w = Math.round(bmp.width * f), h = Math.round(bmp.height * f)
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, w, h)
      bmp.close()
      const img = ctx.getImageData(0, 0, w, h)
      let last = 0
      const progress = (done: number) => {
        if (done - last < 0.02) return
        last = done
        post({ t: 'progress', id: msg.id, done })
      }
      const scan = scanPage(cv, img, progress)
      if (!scan.ok) {
        post({ t: 'scanned', id: msg.id, ok: false, reason: scan.reason, markers: scan.markers.length })
        return
      }
      const { glyphs, empties } = traceCells(cv, scan, msg.weight, progress)
      const check = await checkImage(scan.overview, scan.page.layout, new Set(glyphs.map((g) => g.index)), scan.visible)
      const out: ScannedGlyph[] = glyphs.map((g) => ({ index: g.index, char: g.char, kind: g.kind, crop: g.crop, outlines: g.outlines }))
      post({
        t: 'scanned', id: msg.id, ok: true,
        page: { id: scan.page.id, title: scan.page.title, layout: scan.page.layout },
        ink: scan.ink, glyphs: out, empties: empties.map((c) => c.char), check,
        visible: scan.cells.length, total: scan.visible.length, seen: scan.cells.map((c) => c.index), cellPx: Math.round(scan.cellPx), blurPx: Math.round(scan.blurPx * 100) / 100,
      }, out.map((g) => g.crop.buffer as ArrayBuffer))
      return
    }
    if (msg.t === 'retrace') {
      const W = CROP * UPSAMPLE
      const items = msg.items.map((it) => {
        let mask = extractMask(cv, it.crop, it.ink, msg.weight)
        if (it.strokes?.length) {
          mask ??= new Uint8Array(W * W)
          paintStrokes(mask, W, it.strokes)
        }
        return { key: it.key, outlines: mask?.some((v) => v) ? maskToOutlines(cv, mask, it.kind) : [] }
      })
      post({ t: 'retraced', id: msg.id, items })
    }
    if (msg.t === 'mask') {
      const mask = extractMask(cv, msg.crop, msg.ink, msg.weight)
      post({ t: 'masked', id: msg.id, mask, w: CROP * UPSAMPLE }, mask ? [mask.buffer as ArrayBuffer] : [])
    }
  } catch (err) {
    post({ t: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
