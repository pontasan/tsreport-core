import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, PdfBackend, render } from '../src/index.js'
import { zlibInflate } from '../src/compression/inflate.js'
import type { RenderDocument } from '../src/types/render.js'
import {
  buildCmap4, buildFont, buildHead, buildHhea, buildHmtx, buildLocaGlyf,
  buildMaxp, buildName, buildOs2, buildPost,
} from './renderer/synthetic-font.js'

function fontBufferWithOs2(os2?: Uint8Array, cmap = buildCmap4([[0x41, 1], [0x42, 2]])): ArrayBuffer {
  const { loca, glyf } = buildLocaGlyf([null, null, null])
  const tables: Array<[string, Uint8Array]> = [
    ['head', buildHead()], ['maxp', buildMaxp(3)], ['hhea', buildHhea(3)],
    ['hmtx', buildHmtx([[600, 0], [600, 0], [600, 0]])],
    ['cmap', cmap],
    ['post', buildPost()], ['name', buildName()], ['loca', loca], ['glyf', glyf],
  ]
  if (os2 !== undefined) tables.push(['OS/2', os2])
  return buildFont(tables)
}

function fontWithOs2(os2: Uint8Array): Font {
  return Font.load(fontBufferWithOs2(os2))
}

function os2With(mutator: (view: DataView) => void, version = 4): Uint8Array {
  const base = buildOs2()
  const result = new Uint8Array(version === 5 ? 100 : 96)
  result.set(base)
  const view = new DataView(result.buffer)
  view.setUint16(0, version)
  mutator(view)
  return result
}

function renderSingleText(font: Font): Uint8Array {
  const backend = new PdfBackend({ fonts: { default: font } })
  const document: RenderDocument = {
    pages: [{
      width: 100,
      height: 50,
      children: [{ type: 'text', x: 5, y: 20, text: 'A', fontId: 'default', fontSize: 12, color: '#000000' }],
    }],
  }
  render(document, backend)
  return backend.toUint8Array()
}

function latin1(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i++) value += String.fromCharCode(bytes[i]!)
  return value
}

function pdfObjectText(bytes: Uint8Array): string {
  const source = latin1(bytes)
  let expanded = source
  let searchFrom = 0
  for (;;) {
    const typeIndex = source.indexOf('/Type /ObjStm', searchFrom)
    if (typeIndex < 0) return expanded
    const streamStart = source.indexOf('stream\n', typeIndex) + 7
    const dictionary = source.slice(source.lastIndexOf('<<', typeIndex), streamStart)
    const length = Number(dictionary.match(/\/Length\s+(\d+)/)?.[1])
    const raw = bytes.slice(streamStart, streamStart + length)
    const content = dictionary.includes('/FlateDecode') ? new Uint8Array(zlibInflate(raw)) : raw
    expanded += `\n${latin1(content)}`
    searchFrom = streamStart + length
  }
}

function embeddedTrueType(bytes: Uint8Array): Uint8Array {
  const text = pdfObjectText(bytes)
  const descriptor = text.match(/\/FontFile2\s+(\d+)\s+0\s+R/)
  if (descriptor === null) throw new Error('Expected an embedded TrueType font')
  const marker = `${descriptor[1]} 0 obj\n`
  const objectStart = text.indexOf(marker)
  const streamStart = text.indexOf('stream\n', objectStart) + 7
  const dictionary = text.slice(objectStart, streamStart)
  const length = Number(dictionary.match(/\/Length\s+(\d+)/)?.[1])
  const stream = bytes.slice(streamStart, streamStart + length)
  return dictionary.includes('/FlateDecode') ? new Uint8Array(zlibInflate(stream)) : stream
}

describe('OS/2 public consumers', () => {
  it('selects line metrics only when USE_TYPO_METRICS is set', () => {
    const withoutFlag = fontWithOs2(os2With(view => {
      view.setInt16(68, 700)
      view.setInt16(70, -300)
      view.setInt16(72, 100)
      view.setUint16(62, 0x0040)
    }))
    expect(withoutFlag.metrics).toMatchObject({
      ascender: 800, descender: -200, lineGap: 0, useTypographicMetrics: false,
    })

    const withFlag = fontWithOs2(os2With(view => {
      view.setInt16(68, 700)
      view.setInt16(70, -300)
      view.setInt16(72, 100)
      view.setUint16(62, 0x00C0)
    }))
    expect(withFlag.metrics).toMatchObject({
      ascender: 700, descender: -300, lineGap: 100, useTypographicMetrics: true,
    })
  })

  it('exposes Unicode/code-page coverage, classification, and optical ranges', () => {
    const font = fontWithOs2(os2With(view => {
      view.setUint32(42, 0x80000001)
      view.setUint32(54, 0x00000008)
      view.setUint32(78, 0x00000004)
      view.setUint32(82, 0x80000000)
      view.setUint16(96, 120)
      view.setUint16(98, 480)
    }, 5))
    expect(font.supportsUnicodeRange(0)).toBe(true)
    expect(font.supportsUnicodeRange(31)).toBe(true)
    expect(font.supportsUnicodeRange(99)).toBe(true)
    expect(font.supportsCodePageRange(2)).toBe(true)
    expect(font.supportsCodePageRange(63)).toBe(true)
    expect(font.opticalSizeRange).toEqual({ lowerInclusive: 6, upperExclusive: 24 })
    expect(font.os2Metadata.panose).not.toBe(font.os2Metadata.panose)
    expect(() => font.supportsUnicodeRange(128)).toThrow(/0 to 127/)
    expect(() => font.supportsCodePageRange(-1)).toThrow(/0 to 63/)
  })

  it('connects wght/wdth variation coordinates to public style metrics', () => {
    const path = resolve(import.meta.dirname, 'fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')
    const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
    font.setVariation({ wght: 650, wdth: 87.5 })
    expect(font.metrics.weightClass).toBe(650)
    expect(font.metrics.widthClass).toBe(4)
  })

  it('connects a Windows symbol cmap to shaping through OS/2.usFirstCharIndex', () => {
    const os2 = os2With(view => view.setUint16(64, 0xF020))
    const font = Font.load(fontBufferWithOs2(os2, buildCmap4([[0xF020, 1], [0xF021, 2]], 3, 0)))

    expect(font.cmap.selectedEncoding).toMatchObject({ platformId: 3, encodingId: 0, format: 4 })
    expect(font.getGlyphId(0x20)).toBe(1)
    expect(font.getGlyphId(0x21)).toBe(2)
    expect(font.getGlyphId(0xF020)).toBe(1)
    expect(font.shapeText('!')[0]!.glyphId).toBe(2)
  })

  it('enforces embedding, bitmap-only, and no-subsetting permissions', () => {
    const restricted = fontWithOs2(os2With(view => view.setUint16(8, 0x0002)))
    expect(restricted.embeddingPermissions.level).toBe('restricted')
    expect(() => restricted.subset('A')).toThrow(/prohibits font embedding/)

    const bitmapOnly = fontWithOs2(os2With(view => view.setUint16(8, 0x0204)))
    expect(bitmapOnly.embeddingPermissions).toMatchObject({ level: 'preview-print', bitmapOnly: true })
    expect(() => bitmapOnly.subset('A')).toThrow(/only embedded bitmap data/)

    const completeOnly = fontWithOs2(os2With(view => view.setUint16(8, 0x0100)))
    expect(completeOnly.embeddingPermissions.noSubsetting).toBe(true)
    expect(() => completeOnly.subset('A')).toThrow(/complete font/)
    const allGlyphs = new Set<number>([0, 1, 2])
    expect(completeOnly.subsetByGlyphIds(allGlyphs).oldToNewGlyphId.size).toBe(3)

    const legacyCombined = fontWithOs2(os2With(view => view.setUint16(8, 0x000C), 2))
    expect(legacyCombined.embeddingPermissions.level).toBe('editable')
  })

  it('separates legacy sfnt decoding from explicit OpenType conformance', () => {
    const invalidWeight = fontBufferWithOs2(os2With(view => view.setUint16(4, 0)))
    expect(Font.load(invalidWeight).os2Metadata.weightClass).toBe(0)
    expect(() => Font.load(invalidWeight, { conformance: 'opentype-1.9.1' })).toThrow(
      'OS/2 usWeightClass must be from 1 to 1000, got 0',
    )
    expect(() => Font.load(fontBufferWithOs2(), { conformance: 'opentype-1.9.1' })).toThrow(
      'OpenType 1.9.1 conformance requires an OS/2 table',
    )
    const mismatchedItalic = fontBufferWithOs2(os2With(view => view.setUint16(62, 0x0001)))
    expect(() => Font.load(mismatchedItalic, { conformance: 'opentype-1.9.1' })).toThrow(
      'OpenType 1.9.1 requires OS/2 fsSelection ITALIC to match head.macStyle',
    )

    const variablePath = resolve(import.meta.dirname, 'fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')
    const variableBytes = readFileSync(variablePath)
    const variableBuffer = variableBytes.buffer.slice(
      variableBytes.byteOffset,
      variableBytes.byteOffset + variableBytes.byteLength,
    ) as ArrayBuffer
    expect(() => Font.load(variableBuffer, { conformance: 'opentype-1.9.1' })).not.toThrow()
  })

  it('enforces embedding permissions at the PDF output boundary', () => {
    const restricted = fontWithOs2(os2With(view => view.setUint16(8, 0x0002)))
    expect(() => renderSingleText(restricted)).toThrow(/prohibits font embedding/)

    const bitmapOnly = fontWithOs2(os2With(view => view.setUint16(8, 0x0204)))
    expect(() => renderSingleText(bitmapOnly)).toThrow(/only embedded bitmap data/)

    const completeOnly = fontWithOs2(os2With(view => view.setUint16(8, 0x0100)))
    const pdf = renderSingleText(completeOnly)
    const pdfText = pdfObjectText(pdf)
    expect(pdfText).toContain(`/BaseFont /${completeOnly.postScriptName}`)
    expect(pdfText).not.toMatch(new RegExp(`/BaseFont /[A-Z]{6}\\+${completeOnly.postScriptName}`))
    const embedded = embeddedTrueType(pdf)
    const embeddedBuffer = embedded.buffer.slice(
      embedded.byteOffset,
      embedded.byteOffset + embedded.byteLength,
    ) as ArrayBuffer
    expect(Font.load(embeddedBuffer).numGlyphs).toBe(completeOnly.numGlyphs)
  })
})
