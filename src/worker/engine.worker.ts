/// <reference lib="webworker" />
// Heavy lifting off the main thread: OpenCV.js (13 MB) is loaded here on first use.
import cvModule from '@techstark/opencv-js'
import type { CV } from '../core/cv.ts'
import { BOX, PAGE_H, PAGE_W, cellBox } from '../core/geometry.ts'
import { extractMask, maskToOutlines, scanPage, traceCells } from '../core/pipeline.ts'
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

const MAX_SIDE = 4200

async function checkImage(warped: { data: Uint8Array | Uint8ClampedArray }, found: Set<number>, total: number): Promise<Blob> {
  const full = new OffscreenCanvas(PAGE_W, PAGE_H)
  const fctx = full.getContext('2d')!
  const px = new Uint8ClampedArray(PAGE_W * PAGE_H * 4)
  px.set(warped.data)
  fctx.putImageData(new ImageData(px, PAGE_W, PAGE_H), 0, 0)
  fctx.lineWidth = 8
  for (let i = 0; i < total; i++) {
    const [x, y] = cellBox(i)
    fctx.strokeStyle = found.has(i) ? 'rgb(30,160,90)' : 'rgb(220,60,50)'
    fctx.strokeRect(x - 4, y - 4, BOX + 8, BOX + 8)
  }
  const small = new OffscreenCanvas(620, 877)
  small.getContext('2d')!.drawImage(full, 0, 0, 620, 877)
  return small.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
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
      const scan = scanPage(cv, img)
      if (!scan.ok) {
        post({ t: 'scanned', id: msg.id, ok: false, reason: scan.reason, markers: scan.markers.length })
        return
      }
      const { glyphs, empties } = traceCells(cv, scan, msg.weight)
      const check = await checkImage(scan.warped, new Set(glyphs.map((g) => g.index)), scan.cells.length)
      const out: ScannedGlyph[] = glyphs.map((g) => ({ index: g.index, char: g.char, kind: g.kind, crop: g.crop, outlines: g.outlines }))
      post({
        t: 'scanned', id: msg.id, ok: true,
        page: { id: scan.page.id, title: scan.page.title, kind: scan.page.kind },
        ink: scan.ink, glyphs: out, empties: empties.map((c) => c.char), check,
      }, out.map((g) => g.crop.buffer as ArrayBuffer))
      return
    }
    if (msg.t === 'retrace') {
      const items = msg.items.map((it) => {
        const mask = extractMask(cv, it.crop, it.ink, msg.weight)
        return { key: it.key, outlines: mask ? maskToOutlines(cv, mask, it.kind) : [] }
      })
      post({ t: 'retraced', id: msg.id, items })
    }
  } catch (err) {
    post({ t: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
