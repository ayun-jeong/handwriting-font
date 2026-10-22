// Dump a template page's geometry (for the Python photo simulator): slots, box, cell contents, jamo guides.
// usage: node tests/page-json.ts <qr id> <out.json>
import fs from 'node:fs'
import { pageFromQr } from '../src/core/charsets.ts'
import { jamoCell } from '../src/core/compose.ts'
import { LAYOUTS } from '../src/core/geometry.ts'

const [id, out] = process.argv.slice(2)
const page = pageFromQr(id)
if (!page) throw new Error('unknown page ' + id)
const lay = LAYOUTS[page.layout]
fs.writeFileSync(out, JSON.stringify({
  id, layout: page.layout, box: lay.box, renderDpi: lay.renderDpi,
  cells: page.chars.map((c, i) => ({ i, char: c, kind: page.kinds[i], slot: lay.slots[i], guide: jamoCell(c)?.target ?? null })),
}))
console.log(page.layout, page.chars.length, 'cells')
