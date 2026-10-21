// Builds the real TTF from the current glyphs + adjustments and loads it as a web font for the preview,
// so the preview is the exact file the user downloads.
import { useEffect, useRef, useState } from 'react'
import { buildTTF } from './core/font.ts'
import { layoutAll, type GlyphAdjust, type GlyphShape, type Settings } from './core/layout.ts'

let counter = 0

export function useLiveFont(shapes: GlyphShape[], settings: Settings, adjust: Record<string, GlyphAdjust>) {
  const [family, setFamily] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const current = useRef<FontFace | null>(null)

  useEffect(() => {
    if (!shapes.length) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setBuilding(true)
      try {
        const ttf = buildTTF(layoutAll(shapes, settings, adjust), { family: 'Preview', embedding: 'installable', settings })
        const name = `HandPreview${++counter}`
        const face = new FontFace(name, ttf.buffer as ArrayBuffer)
        await face.load()
        if (cancelled) return
        document.fonts.add(face)
        if (current.current) document.fonts.delete(current.current)
        current.current = face
        setFamily(name)
      } catch (err) {
        console.error('preview font failed', err)
      } finally {
        if (!cancelled) setBuilding(false)
      }
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [shapes, settings, adjust])

  return { family: shapes.length ? family : null, building }
}
