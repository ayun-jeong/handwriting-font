declare module 'opentype.js' {
  // Only the constructors used by src/core/font.ts; the package ships no type declarations.
  export const Font: any
  export const Glyph: any
  export const Path: any
}
