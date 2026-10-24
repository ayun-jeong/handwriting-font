// PDF pages -> images for the photo pipeline: scanner apps, flatbed scans, photos combined into one PDF, or a
// template written on with a tablet. pdf.js (about 1.5 MB) is loaded only when a PDF comes in.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

/** Longest rendered side: a 5 mm cell on an A4 page then spans about 80 px. */
const LONG_SIDE = 4800
/** Stays under the 16.7 MP canvas limit of iOS Safari. */
const MAX_AREA = 16_000_000
const THUMB_W = 144

export type OpenPdf = {
  pages: number
  /** Page `n` (1-based) as a bitmap for the scanner, plus a small thumbnail (object URL). */
  render(n: number): Promise<{ bitmap: ImageBitmap; thumb: string }>
  close(): void
}

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export async function openPdf(file: File): Promise<OpenPdf> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href,
  })
  const doc = await task.promise.catch(async (err: unknown) => { await task.destroy(); throw err })
  return {
    pages: doc.numPages,
    async render(n) {
      const page = await doc.getPage(n)
      try {
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(LONG_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_AREA / (base.width * base.height)))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        await page.render({ canvas, viewport }).promise
        const bitmap = await createImageBitmap(canvas)
        const small = document.createElement('canvas')
        small.width = THUMB_W
        small.height = Math.round((THUMB_W * canvas.height) / canvas.width)
        small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height)
        canvas.width = canvas.height = 0 // free the large canvas now rather than at the next GC
        const blob = await new Promise<Blob | null>((r) => small.toBlob(r, 'image/jpeg', 0.8))
        return { bitmap, thumb: blob ? URL.createObjectURL(blob) : '' }
      } finally {
        page.cleanup()
      }
    },
    close: () => { void task.destroy() },
  }
}
