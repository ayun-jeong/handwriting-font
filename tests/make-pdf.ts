// Bundle JPEGs into one PDF, one image per page, for testing PDF upload.
// usage: node tests/make-pdf.ts <photos|a4> <out.pdf> <a.jpg> [b.jpg ...]
//   photos: each page is the image's size (1 px = 1 pt), like combining photos into a PDF on a phone
//   a4:     each image fitted on an A4 page in its orientation, like scanner apps
import fs from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const [mode, out, ...images] = process.argv.slice(2)
const pdf = await PDFDocument.create()
const A4: [number, number] = [595.28, 841.89]
for (const file of images) {
  const img = await pdf.embedJpg(fs.readFileSync(file))
  if (mode === 'photos') {
    pdf.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    continue
  }
  const [pw, ph] = img.width > img.height ? [A4[1], A4[0]] : A4
  const k = Math.min(pw / img.width, ph / img.height)
  const w = img.width * k, h = img.height * k
  pdf.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
}
fs.writeFileSync(out, await pdf.save())
console.log(out, pdf.getPageCount(), 'pages')
