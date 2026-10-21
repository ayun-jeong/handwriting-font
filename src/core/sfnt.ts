// Minimal sfnt (TTF/OTF) table surgery: replace tables and fix checksums. Used to write our own `name` table,
// because fonteditor-core stores non-ASCII names in the Mac-Roman record, which shows up garbled.

function checksum(b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < b.length; i += 4) {
    sum = (sum + (((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0)) >>> 0
  }
  return sum
}

export function readTables(font: Uint8Array): { version: number; tables: Map<string, Uint8Array> } {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const version = v.getUint32(0)
  const n = v.getUint16(4)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < n; i++) {
    const r = 12 + 16 * i
    const tag = String.fromCharCode(font[r], font[r + 1], font[r + 2], font[r + 3])
    const off = v.getUint32(r + 8), len = v.getUint32(r + 12)
    tables.set(tag, font.slice(off, off + len))
  }
  return { version, tables }
}

export function writeFont(version: number, tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort()
  const n = tags.length
  let pow = 1, log = 0
  while (pow * 2 <= n) { pow *= 2; log++ }
  let size = 12 + 16 * n
  for (const t of tags) size += (tables.get(t)!.length + 3) & ~3
  const out = new Uint8Array(size)
  const v = new DataView(out.buffer)
  v.setUint32(0, version); v.setUint16(4, n); v.setUint16(6, pow * 16); v.setUint16(8, log); v.setUint16(10, n * 16 - pow * 16)
  let off = 12 + 16 * n, headOff = -1
  tags.forEach((tag, i) => {
    let data = tables.get(tag)!
    if (tag === 'head') {
      data = data.slice()
      new DataView(data.buffer).setUint32(8, 0) // checkSumAdjustment is computed last
      headOff = off
    }
    const r = 12 + 16 * i
    for (let k = 0; k < 4; k++) out[r + k] = tag.charCodeAt(k)
    v.setUint32(r + 4, checksum(data)); v.setUint32(r + 8, off); v.setUint32(r + 12, data.length)
    out.set(data, off)
    off += (data.length + 3) & ~3
  })
  if (headOff >= 0) v.setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0)
  return out
}

export function replaceTables(font: Uint8Array, replace: Record<string, Uint8Array>): Uint8Array {
  const { version, tables } = readTables(font)
  for (const [tag, data] of Object.entries(replace)) tables.set(tag, data)
  return writeFont(version, tables)
}

export type NameStrings = {
  family: string
  /** ASCII-only family for old Mac records and PostScript contexts. */
  familyAscii: string
  postScript: string
  version: string
  copyright: string
  unique: string
}

/** `name` table: Windows Unicode records in English and Korean, plus Mac-Roman records with ASCII names. */
export function buildNameTable(s: NameStrings): Uint8Array {
  type Rec = { p: number; e: number; l: number; id: number; bytes: Uint8Array }
  const utf16 = (t: string) => {
    const b = new Uint8Array(t.length * 2)
    for (let i = 0; i < t.length; i++) { b[2 * i] = t.charCodeAt(i) >> 8; b[2 * i + 1] = t.charCodeAt(i) & 255 }
    return b
  }
  const ascii = (t: string) => Uint8Array.from([...t].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63)))
  const base: [number, string][] = [[0, s.copyright], [1, s.family], [2, 'Regular'], [3, s.unique], [4, s.family], [5, s.version], [6, s.postScript]]
  const recs: Rec[] = []
  for (const [id, text] of base) {
    const macText = id === 1 || id === 4 ? s.familyAscii : text
    recs.push({ p: 1, e: 0, l: 0, id, bytes: ascii(macText) })
    recs.push({ p: 3, e: 1, l: 0x409, id, bytes: utf16(text) })
    if (id === 1 || id === 4) recs.push({ p: 3, e: 1, l: 0x412, id, bytes: utf16(text) })
  }
  recs.sort((a, b) => a.p - b.p || a.e - b.e || a.l - b.l || a.id - b.id)
  const strLen = recs.reduce((n, r) => n + r.bytes.length, 0)
  const out = new Uint8Array(6 + 12 * recs.length + strLen)
  const v = new DataView(out.buffer)
  v.setUint16(0, 0); v.setUint16(2, recs.length); v.setUint16(4, 6 + 12 * recs.length)
  let off = 0
  recs.forEach((r, i) => {
    const o = 6 + 12 * i
    v.setUint16(o, r.p); v.setUint16(o + 2, r.e); v.setUint16(o + 4, r.l); v.setUint16(o + 6, r.id)
    v.setUint16(o + 8, r.bytes.length); v.setUint16(o + 10, off)
    out.set(r.bytes, 6 + 12 * recs.length + off)
    off += r.bytes.length
  })
  return out
}
