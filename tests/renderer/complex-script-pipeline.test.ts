// End-to-end: a complex-script (USE) staticText element flows through the full
// report pipeline — createReport (layout + shaping, with reordering) → PDF
// backend (subset + Type0 CID font + ToUnicode) — so the shaped glyphs reach
// the drawing output. This locks the "shaping → drawing" connection for the
// SMP USE scripts. Skipped when the macOS system font is absent (non-macOS CI).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { createReport, PdfBackend, render } from '../../src/index.js'
import { parsePdf, PdfStream, PdfName } from '../../src/pdf/pdf-parser.js'
import type { RenderDocument } from '../../src/types/render.js'

const KAITHI = '/System/Library/Fonts/Supplemental/NotoSansKaithi-Regular.ttf'

function report(font: Font, text: string): RenderDocument {
  const fontMap = new Map([['default', new TextMeasurer(font)]])
  const template = {
    page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: { details: [{ height: 50, elements: [
      { type: 'staticText', x: 10, y: 5, width: 300, height: 40, text, forecolor: '#000000' },
    ] }] },
  }
  return createReport(template as never, { rows: [{}] }, fontMap)
}

function firstTextRun(doc: RenderDocument): number[] | null {
  let run: number[] | null = null
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as Record<string, unknown>
    if (node.type === 'text' && node.glyphRun) {
      run = Array.from((node.glyphRun as { glyphIds: Uint16Array }).glyphIds)
    }
    for (const key of ['children', 'elements', 'pages', 'child']) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v) walk(v)
    }
  }
  walk(doc)
  return run
}

describe.skipIf(!existsSync(KAITHI))('complex-script report → PDF pipeline', () => {
  it('reorders a Kaithi pre-base matra before the base through layout', () => {
    const font = Font.load(readFileSync(KAITHI).buffer as ArrayBuffer)
    // KA (U+1108D) + pre-base vowel sign I (U+110B1). The matra's presentation
    // form (glyph 217) must precede the base KA (glyph 18) — proof the USE
    // reordering ran in the layout, not a raw per-code-point cmap mapping
    // (which would emit [18, 54] in logical order).
    const run = firstTextRun(report(font, '\u{1108D}\u{110B1}'))
    expect(run).toEqual([217, 18])
  })

  it('emits the shaped glyphs as a Type0 CID font whose ToUnicode round-trips', () => {
    const font = Font.load(readFileSync(KAITHI).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { default: font } })
    render(report(font, '\u{1108D}\u{110B1}'), backend)
    const doc = parsePdf(backend.toUint8Array())

    // The text is drawn with a composite (Type0) font — required for CID glyphs.
    const cat = doc.getCatalog()
    const pages = doc.resolve(cat.get('Pages') ?? null) as Map<string, unknown>
    const kids = doc.resolve(pages.get('Kids') ?? null) as unknown[]
    const page = doc.resolve(kids[0] as never) as Map<string, unknown>
    const res = doc.resolve(page.get('Resources') ?? null) as Map<string, unknown>
    const fonts = doc.resolve(res.get('Font') ?? null) as Map<string, unknown>
    const fontDict = doc.resolve([...fonts.values()][0] as never) as Map<string, unknown>
    expect((fontDict.get('Subtype') as PdfName).name).toBe('Type0')

    // The content stream shows two glyphs (the reordered matra form + base; the
    // zero-width null form carries no outline/advance and is elided).
    const cs = latin1(doc.decodeStream(doc.resolve(page.get('Contents') ?? null) as PdfStream))
    const show = cs.match(/<([0-9a-fA-F]+)>\s*Tj/)
    expect(show).not.toBeNull()
    expect(show![1]!.length / 4).toBe(2)

    // ToUnicode maps each subset glyph back to its logical source code point, so
    // text extraction yields the original KA + I-matra order.
    let extracted = ''
    const gids = show![1]!.match(/.{4}/g)!.map(h => parseInt(h, 16))
    const map = toUnicodeMap(doc)
    for (const g of gids) extracted += map.get(g) ?? ''
    expect([...extracted].map(c => c.codePointAt(0))).toEqual([0x1108d, 0x110b1])
  })
})

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function toUnicodeMap(doc: ReturnType<typeof parsePdf>): Map<number, string> {
  const map = new Map<number, string>()
  for (let n = 1; n < 60; n++) {
    let o: unknown
    try { o = doc.getObject(n) } catch { continue }
    if (!(o instanceof PdfStream)) continue
    const s = latin1(doc.decodeStream(o))
    if (!s.includes('beginbfchar')) continue
    for (const m of s.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const gid = parseInt(m[1]!, 16)
      const hex = m[2]!
      let str = ''
      for (let i = 0; i + 4 <= hex.length; i += 4) str += String.fromCharCode(parseInt(hex.substr(i, 4), 16))
      if (gid >= 1 && gid < 100) map.set(gid, str)
    }
  }
  return map
}
