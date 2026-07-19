import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Font } from '../../src/index.js'
import { unwrapWoff } from '../../src/parsers/woff-parser.js'

const WOFF_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.woff')

describe('WOFF parser', () => {
  // Verifies a WOFF container loads and reports format 'woff'.
  it('should load a WOFF font', () => {
    const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font).toBeInstanceOf(Font)
    expect(font.format).toBe('woff')
  })

  // Verifies the name table survives WOFF table decompression.
  it('should expose font names', () => {
    const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.familyName).toBeTruthy()
  })

  // Verifies glyph lookup and outline parsing work on the decompressed tables.
  it('should resolve glyphs', () => {
    const buffer = readFileSync(WOFF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const glyph = font.getGlyphByCodePoint(0x0041) // 'A'
    expect(glyph.advanceWidth).toBeGreaterThan(0)
    expect(glyph.outline.commands.length).toBeGreaterThan(0)
  })

  // Verifies WOFF unwrapping is lossless by comparing metrics against the raw TTF source.
  it('should produce same metrics as TTF source', () => {
    const woffBuf = readFileSync(WOFF_PATH).buffer as ArrayBuffer
    const ttfBuf = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer

    const woffFont = Font.load(woffBuf)
    const ttfFont = Font.load(ttfBuf)

    expect(woffFont.metrics.unitsPerEm).toBe(ttfFont.metrics.unitsPerEm)
    expect(woffFont.metrics.ascender).toBe(ttfFont.metrics.ascender)
    expect(woffFont.metrics.descender).toBe(ttfFont.metrics.descender)
    expect(woffFont.numGlyphs).toBe(ttfFont.numGlyphs)
  })

  it('rejects a mismatched declared file length', () => {
    const source = Uint8Array.from(readFileSync(WOFF_PATH))
    new DataView(source.buffer).setUint32(8, source.length + 1, false)
    expect(() => unwrapWoff(source.buffer)).toThrow('declared length')
  })

  it('rejects a non-zero reserved header field', () => {
    const source = Uint8Array.from(readFileSync(WOFF_PATH))
    new DataView(source.buffer).setUint16(14, 1, false)
    expect(() => unwrapWoff(source.buffer)).toThrow('reserved header field')
  })

  it('rejects overlapping table ranges', () => {
    const source = Uint8Array.from(readFileSync(WOFF_PATH))
    const view = new DataView(source.buffer)
    const firstOffset = view.getUint32(48, false)
    view.setUint32(68, firstOffset, false)
    expect(() => unwrapWoff(source.buffer)).toThrow('extraneous or overlapping data')
  })

  it('rejects non-zero table padding', () => {
    const source = Uint8Array.from(readFileSync(WOFF_PATH))
    const view = new DataView(source.buffer)
    const numTables = view.getUint16(12, false)
    let paddingOffset = -1
    for (let i = 0; i < numTables; i++) {
      const entry = 44 + i * 20
      const offset = view.getUint32(entry + 4, false)
      const compressedLength = view.getUint32(entry + 8, false)
      if ((compressedLength & 3) !== 0) { paddingOffset = offset + compressedLength; break }
    }
    expect(paddingOffset).toBeGreaterThan(0)
    source[paddingOffset] = 1
    expect(() => unwrapWoff(source.buffer)).toThrow('padding must contain only zero bytes')
  })

  it('rejects extraneous trailing data', () => {
    const original = Uint8Array.from(readFileSync(WOFF_PATH))
    const source = new Uint8Array(original.length + 1)
    source.set(original)
    new DataView(source.buffer).setUint32(8, source.length, false)
    expect(() => unwrapWoff(source.buffer)).toThrow('extraneous data after the final block')
  })

  it('exposes extended metadata and private data through Font', () => {
    const source = Uint8Array.from(readFileSync(WOFF_PATH))
    const metadataBytes = new TextEncoder().encode('<?xml version="1.0"?><metadata version="1.0"></metadata>')
    const compressed = Uint8Array.from(deflateSync(metadataBytes))
    const metadataOffset = (source.length + 3) & ~3
    const privateBytes = Uint8Array.from([1, 2, 3, 4])
    const privateOffset = (metadataOffset + compressed.length + 3) & ~3
    const bytes = new Uint8Array(privateOffset + privateBytes.length)
    bytes.set(source)
    bytes.set(compressed, metadataOffset)
    bytes.set(privateBytes, privateOffset)
    const view = new DataView(bytes.buffer)
    view.setUint32(8, bytes.length, false)
    view.setUint16(20, 3, false)
    view.setUint16(22, 7, false)
    view.setUint32(24, metadataOffset, false)
    view.setUint32(28, compressed.length, false)
    view.setUint32(32, metadataBytes.length, false)
    view.setUint32(36, privateOffset, false)
    view.setUint32(40, privateBytes.length, false)

    const container = Font.load(bytes.buffer).webFontContainer
    expect(container?.majorVersion).toBe(3)
    expect(container?.minorVersion).toBe(7)
    expect(container?.metadata).toBe(new TextDecoder().decode(metadataBytes))
    expect(container?.metadataDocument?.root.name).toBe('metadata')
    expect(container?.privateData).toEqual(privateBytes)
  })

  it('propagates an invalid metadata block', () => {
    const source = Uint8Array.from(readFileSync(WOFF_PATH))
    const metadataBytes = new TextEncoder().encode('<metadata version="1.0"><unknown/></metadata>')
    const compressed = Uint8Array.from(deflateSync(metadataBytes))
    const metadataOffset = (source.length + 3) & ~3
    const bytes = new Uint8Array(metadataOffset + compressed.length)
    bytes.set(source)
    bytes.set(compressed, metadataOffset)
    const view = new DataView(bytes.buffer)
    view.setUint32(8, bytes.length, false)
    view.setUint32(24, metadataOffset, false)
    view.setUint32(28, compressed.length, false)
    view.setUint32(32, metadataBytes.length, false)

    expect(() => Font.load(bytes.buffer)).toThrow('not permitted')
  })

  it('rejects invalid metadata when writing', () => {
    const source = Font.load(Uint8Array.from(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf'))).buffer)
    expect(() => source.toWoff({ metadata: '<metadata version="1.0"><unknown/></metadata>' })).toThrow('not permitted')
  })

  it('writes a WOFF container that preserves font data and container payloads', () => {
    const ttfBytes = Uint8Array.from(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')))
    const ttfBuffer = ttfBytes.buffer
    const source = Font.load(ttfBuffer)
    const metadata = '<?xml version="1.0" encoding="UTF-8"?><metadata version="1.0"></metadata>'
    const privateData = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])
    const woffBuffer = source.toWoff({ majorVersion: 1, minorVersion: 2, metadata, privateData })
    const bytes = new Uint8Array(woffBuffer)

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('wOFF')
    const woffView = new DataView(woffBuffer)
    const tableCount = woffView.getUint16(12, false)
    const storedLengths: Array<{ compressed: number; original: number }> = []
    for (let i = 0; i < tableCount; i++) {
      const entry = 44 + i * 20
      storedLengths.push({
        compressed: woffView.getUint32(entry + 8, false),
        original: woffView.getUint32(entry + 12, false),
      })
    }
    expect(storedLengths.some(function (lengths) { return lengths.compressed < lengths.original })).toBe(true)
    expect(storedLengths.some(function (lengths) { return lengths.compressed === lengths.original })).toBe(true)
    expect(new Uint8Array(unwrapWoff(woffBuffer))).toEqual(ttfBytes)

    const roundTrip = Font.load(woffBuffer)
    expect(roundTrip.format).toBe('woff')
    expect(roundTrip.metrics).toEqual(source.metrics)
    expect(roundTrip.numGlyphs).toBe(source.numGlyphs)
    expect(roundTrip.getGlyphByCodePoint(0x0041).outline).toEqual(source.getGlyphByCodePoint(0x0041).outline)
    expect(roundTrip.webFontContainer).toEqual({
      majorVersion: 1,
      minorVersion: 2,
      metadata,
      metadataDocument: {
        version: '1.0',
        root: { name: 'metadata', attributes: { version: '1.0' }, children: [] },
      },
      privateData,
    })
  })
})
