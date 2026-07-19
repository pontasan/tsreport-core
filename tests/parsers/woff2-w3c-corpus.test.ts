import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brotliDecompress } from '../../src/compression/brotli.js'
import { Font } from '../../src/font.js'
import { unwrapWoff2, wrapWoff2Collection } from '../../src/parsers/woff2-parser.js'

const corpusRoot = process.env.WOFF2_W3C_CORPUS ?? resolve(__dirname, '../fixtures/woff2-w3c')
const formatDirectory = join(corpusRoot, 'Format', 'Tests', 'xhtml1')
const indexPath = join(formatDirectory, 'testcaseindex.xht')
const decoderDirectory = join(corpusRoot, 'Decoder', 'Tests', 'xhtml1')
const decoderManifest = join(corpusRoot, 'Decoder', 'manifest.txt')
const authoringDirectory = join(corpusRoot, 'AuthoringTool', 'Tests', 'xhtml1')
const authoringIndex = join(authoringDirectory, 'testcaseindex.xht')

if (!existsSync(indexPath)) {
  throw new Error('WOFF2 conformance requires WOFF2_W3C_CORPUS pointing to w3c/woff2-compiled-tests')
}
if (!existsSync(decoderManifest)) {
  throw new Error('WOFF2 conformance requires the W3C decoder corpus')
}
if (!existsSync(authoringIndex)) throw new Error('WOFF2 conformance requires the W3C authoring corpus')

interface W3cFormatCase {
  id: string
  valid: boolean
}

const knownTags = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

interface EncodedEntry {
  tag: string
  transformVersion: number
  data: Uint8Array
  known: boolean
}

function readBase128(bytes: Uint8Array, position: { value: number }): number {
  let result = 0
  for (let count = 0; count < 5; count++) {
    const byte = bytes[position.value++]!
    result = result * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return result
  }
  throw new Error('Invalid test UIntBase128')
}

function read255(bytes: Uint8Array, position: { value: number }): number {
  const code = bytes[position.value++]!
  if (code === 253) return (bytes[position.value++]! << 8) | bytes[position.value++]!
  if (code === 254) return 506 + bytes[position.value++]!
  if (code === 255) return 253 + bytes[position.value++]!
  return code
}

function inspectWoff2(buffer: ArrayBuffer): { entries: EncodedEntry[], collectionFonts: number[][] } {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const flavor = view.getUint32(4, false)
  const count = view.getUint16(12, false)
  const compressedLength = view.getUint32(20, false)
  const position = { value: 48 }
  const headers: { tag: string, transformVersion: number, storedLength: number, known: boolean }[] = []
  for (let index = 0; index < count; index++) {
    const flags = bytes[position.value++]!
    const tagIndex = flags & 0x3f
    const tag = tagIndex === 63
      ? String.fromCharCode(bytes[position.value++]!, bytes[position.value++]!, bytes[position.value++]!, bytes[position.value++]!)
      : knownTags[tagIndex]!
    const transformVersion = flags >> 6
    const originalLength = readBase128(bytes, position)
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0
    headers.push({ tag, transformVersion, storedLength: transformed ? readBase128(bytes, position) : originalLength, known: tagIndex !== 63 })
  }
  const collectionFonts: number[][] = []
  if (flavor === 0x74746366) {
    position.value += 4
    const fontCount = read255(bytes, position)
    for (let font = 0; font < fontCount; font++) {
      const tableCount = read255(bytes, position)
      position.value += 4
      const indices: number[] = []
      for (let table = 0; table < tableCount; table++) indices.push(read255(bytes, position))
      collectionFonts.push(indices)
    }
  }
  const compressed = bytes.slice(position.value, position.value + compressedLength)
  const raw = brotliDecompress(compressed)
  const entries: EncodedEntry[] = []
  let rawOffset = 0
  for (const header of headers) {
    entries.push({ tag: header.tag, transformVersion: header.transformVersion, data: raw.slice(rawOffset, rawOffset + header.storedLength), known: header.known })
    rawOffset += header.storedLength
  }
  expect(rawOffset).toBe(raw.length)
  return { entries, collectionFonts }
}

function sfntTags(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const count = view.getUint16(4, false)
  const tags: string[] = []
  for (let index = 0; index < count; index++) tags.push(String.fromCharCode(...bytes.slice(12 + index * 16, 16 + index * 16)))
  return tags
}

function assertAuthoringRequirement(id: string, source: ArrayBuffer, encoded: ArrayBuffer): void {
  const inspected = inspectWoff2(encoded)
  const entries = inspected.entries
  const find = function (tag: string): EncodedEntry[] { return entries.filter(function (entry) { return entry.tag === tag }) }
  if (id.startsWith('tabledirectory-knowntags-')) {
    const sourceTags = sfntTags(source)
    for (const tag of sourceTags) if (knownTags.includes(tag) && tag !== 'DSIG') {
      expect(find(tag)).toHaveLength(1)
      expect(find(tag)[0]!.known).toBe(true)
    }
  } else if (id === 'tabledirectory-order-001' || id === 'tabledirectory-collection-index-001') {
    for (let fontIndex = 0; fontIndex < inspected.collectionFonts.length; fontIndex++) {
      const expected = Font.load(source, { fontIndex })
      const actual = Font.load(encoded, { fontIndex })
      expect(actual.familyName).toBe(expected.familyName)
      expect(actual.numGlyphs).toBe(expected.numGlyphs)
      for (const codePoint of [0x20, 0x41, 0x61]) expect(actual.getGlyphId(codePoint)).toBe(expected.getGlyphId(codePoint))
    }
  } else if (id.startsWith('tabledata-dsig-')) {
    expect(find('DSIG')).toHaveLength(0)
  } else if (id.startsWith('tabledata-bit11-')) {
    const sfnt = unwrapWoff2(encoded)
    const bytes = new Uint8Array(sfnt)
    const view = new DataView(sfnt)
    const headIndex = sfntTags(sfnt).indexOf('head')
    const headOffset = view.getUint32(12 + headIndex * 16 + 8, false)
    expect(new DataView(bytes.buffer).getUint16(headOffset + 16, false) & 0x0800).toBe(0x0800)
  } else if (id.startsWith('tabledata-transform-glyf-')) {
    const glyf = find('glyf')
    const loca = find('loca')
    expect(glyf).toHaveLength(1)
    expect(loca).toHaveLength(1)
    expect(glyf[0]!.transformVersion).toBe(0)
    expect(loca[0]!.transformVersion).toBe(0)
    expect(loca[0]!.data).toHaveLength(0)
    const glyphView = new DataView(glyf[0]!.data.buffer, glyf[0]!.data.byteOffset, glyf[0]!.data.byteLength)
    const numGlyphs = glyphView.getUint16(4, false)
    const bboxOffset = 36 + glyphView.getUint32(8, false) + glyphView.getUint32(12, false) + glyphView.getUint32(16, false)
      + glyphView.getUint32(20, false) + glyphView.getUint32(24, false)
    const bboxBitmapLength = 4 * Math.floor((numGlyphs + 31) / 32)
    const bboxSize = glyphView.getUint32(28, false)
    if (id === 'tabledata-transform-glyf-001' || id === 'tabledata-transform-glyf-005') expect(bboxSize).toBe(bboxBitmapLength)
    else expect(bboxSize).toBeGreaterThan(bboxBitmapLength)
    expect(bboxOffset + bboxSize).toBeLessThanOrEqual(glyf[0]!.data.length)
  } else if (id === 'tabledata-transform-hmtx-001') {
    const hmtx = find('hmtx')
    expect(hmtx).toHaveLength(1)
    expect(hmtx[0]!.transformVersion).toBe(1)
    expect(hmtx[0]!.data[0]).toBe(3)
  } else if (id === 'collection-transform-glyf-001') {
    expect(find('glyf').length).toBeGreaterThan(1)
    for (const entry of find('glyf')) expect(entry.transformVersion).toBe(0)
    for (const entry of find('loca')) expect(entry.transformVersion).toBe(0)
  } else if (id === 'collection-transform-hmtx-001') {
    expect(find('hmtx')[0]!.transformVersion).toBe(1)
  } else if (id === 'collection-transform-hmtx-002') {
    expect(find('hmtx')[0]!.transformVersion).toBe(0)
  } else if (id === 'collection-pairing-001') {
    for (const indices of inspected.collectionFonts) {
      const glyfIndex = indices.find(function (index) { return entries[index]!.tag === 'glyf' })!
      const locaIndex = indices.find(function (index) { return entries[index]!.tag === 'loca' })!
      expect(locaIndex).toBe(glyfIndex + 1)
    }
  } else if (id.startsWith('collection-sharing-')) {
    const fonts = inspected.collectionFonts.map(function (indices) { return new Set(indices) })
    if (id === 'collection-sharing-001') expect([...fonts[0]!]).toEqual([...fonts[1]!])
    else if (id === 'collection-sharing-002') {
      expect([...fonts[0]!].find(function (index) { return entries[index]!.tag === 'glyf' })).toBe([...fonts[1]!].find(function (index) { return entries[index]!.tag === 'glyf' }))
      expect([...fonts[0]!].find(function (index) { return entries[index]!.tag === 'loca' })).toBe([...fonts[1]!].find(function (index) { return entries[index]!.tag === 'loca' }))
    } else if (id === 'collection-sharing-003') {
      const glyfIndices = fonts.map(function (font) { return [...font].find(function (index) { return entries[index]!.tag === 'glyf' }) })
      expect(new Set(glyfIndices).size).toBe(2)
    } else if (id === 'collection-sharing-006') {
      const shared = [...fonts[0]!].filter(function (index) { return fonts[1]!.has(index) })
      expect(shared).toHaveLength(1)
      expect(entries[shared[0]!]!.tag).toBe('cmap')
    }
  }
}

function readCases(): W3cFormatCase[] {
  if (!existsSync(indexPath)) return []
  const index = readFileSync(indexPath, 'utf8')
  const matches = index.matchAll(/<div class="testCase" id="([^"]+)">[\s\S]*?<span id="\1-validity">(Yes|No)<\/span>[\s\S]*?<\/div>\s*<\/div>/g)
  const result: W3cFormatCase[] = []
  for (const match of matches) result.push({ id: match[1]!, valid: match[2] === 'Yes' })
  return result
}

function readAuthoringCases(path: string): W3cFormatCase[] {
  if (!existsSync(path)) return []
  const index = readFileSync(path, 'utf8')
  const result: W3cFormatCase[] = []
  for (const match of index.matchAll(/<div class="testCase" id="([^"]+)">[\s\S]*?<span id="\1-shouldconvert">(Yes|No)<\/span>[\s\S]*?<\/div>\s*<\/div>/g)) {
    result.push({ id: match[1]!, valid: match[2] === 'Yes' })
  }
  return result
}

const cases = readCases()

describe('W3C WOFF2 format corpus', function () {
  it('contains the complete published format suite', function () {
    expect(cases).toHaveLength(296)
  })

  for (const testCase of cases) {
    it(testCase.id, function () {
      const path = join(formatDirectory, `${testCase.id}.woff2`)
      expect(existsSync(path), `${testCase.id} fixture`).toBe(true)
      const bytes = readFileSync(path)
      const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      if (testCase.valid) expect(() => Font.load(source)).not.toThrow()
      else expect(() => Font.load(source)).toThrow()
    })
  }
})

const decoderCases = existsSync(decoderManifest)
  ? readFileSync(decoderManifest, 'utf8').trim().split('\n').map(function (line) { return line.split('\t')[0]! })
  : []

describe('W3C WOFF2 decoder corpus', function () {
  it('contains the complete published decoder suite', function () {
    expect(decoderCases).toHaveLength(163)
  })
  for (const id of decoderCases) {
    it(id, function () {
      const bytes = readFileSync(join(decoderDirectory, `${id}.woff2`))
      const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      expect(() => Font.load(source)).not.toThrow()
    })
  }

  const roundTrips = [
    { id: 'roundtrip-offset-tables-001', faces: 3 },
    { id: 'roundtrip-collection-dsig-001', faces: 3 },
    { id: 'roundtrip-collection-order-001', faces: 3 },
  ] as const
  for (const roundTrip of roundTrips) {
    it(`${roundTrip.id} preserves font semantics`, function () {
      const encodedBytes = readFileSync(join(decoderDirectory, `${roundTrip.id}.woff2`))
      const encoded = encodedBytes.buffer.slice(
        encodedBytes.byteOffset,
        encodedBytes.byteOffset + encodedBytes.byteLength,
      ) as ArrayBuffer
      const sourceBytes = readFileSync(join(decoderDirectory, `${roundTrip.id}.ttf`))
      const source = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer
      for (let fontIndex = 0; fontIndex < roundTrip.faces; fontIndex++) {
        const actual = Font.load(encoded, { fontIndex })
        const expected = Font.load(source, { fontIndex })
        expect(actual.numGlyphs).toBe(expected.numGlyphs)
        expect(actual.metrics).toEqual(expected.metrics)
        for (const codePoint of [0x20, 0x41, 0x61]) {
          const actualGlyph = actual.getGlyphByCodePoint(codePoint)
          const expectedGlyph = expected.getGlyphByCodePoint(codePoint)
          expect(actual.getGlyphId(codePoint)).toBe(expected.getGlyphId(codePoint))
          expect(actualGlyph.outline).toEqual(expectedGlyph.outline)
        }
      }
    })
  }
})

const authoringCases = readAuthoringCases(authoringIndex)
describe('W3C WOFF2 authoring corpus', function () {
  it('contains the complete published authoring suite', function () {
    expect(authoringCases).toHaveLength(24)
  })
  for (const testCase of authoringCases) {
    it(testCase.id, function () {
      const candidate = ['ttf', 'otf', 'ttc'].map(function (extension) {
        return join(authoringDirectory, `${testCase.id}.${extension}`)
      }).find(function (path) { return existsSync(path) })
      expect(candidate, `${testCase.id} source fixture`).toBeDefined()
      const bytes = readFileSync(candidate!)
      const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const encode = function (): ArrayBuffer {
        if (candidate!.endsWith('.ttc')) return wrapWoff2Collection(source)
        return Font.load(source).toWoff2()
      }
      if (!testCase.valid) expect(encode).toThrow()
      else {
        const encoded = encode()
        expect(() => Font.load(encoded)).not.toThrow()
        assertAuthoringRequirement(testCase.id, source, encoded)
      }
    })
  }
})
