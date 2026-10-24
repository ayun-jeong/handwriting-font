import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const BASE = '/handwriting-font/'

// pdf.js fetches its wasm image decoders (JPEG 2000, JBIG2) and colour management from one folder, by file name,
// so they are copied as they are instead of going through the bundler. Their licences go along as .txt files.
const PDFJS_WASM = path.resolve('node_modules/pdfjs-dist/wasm')
const PDFJS_FILES = [
  'openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm',
  'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2', 'LICENSE_QCMS', 'LICENSE_PDFJS_QCMS',
]
const published = (name: string) => (name.startsWith('LICENSE') ? `${name}.txt` : name)

function pdfjsWasm(): Plugin {
  return {
    name: 'pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use(`${BASE}pdfjs/`, (req, res, next) => {
        const asked = path.basename((req.url ?? '').split('?')[0])
        const name = PDFJS_FILES.find((f) => published(f) === asked)
        if (!name) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/plain; charset=utf-8')
        fs.createReadStream(path.join(PDFJS_WASM, name)).pipe(res)
      })
    },
    generateBundle() {
      for (const name of PDFJS_FILES) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${published(name)}`, source: fs.readFileSync(path.join(PDFJS_WASM, name)) })
      }
    },
  }
}

// Served from https://ayun-jeong.github.io/handwriting-font/
export default defineConfig({
  base: BASE,
  plugins: [react(), pdfjsWasm()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 16000 },
})
