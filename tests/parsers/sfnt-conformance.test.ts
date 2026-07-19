import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, validateSfntChecksums } from '../../src/font.js'
import { parseFont } from '../../src/parsers/index.js'
import { getTableReader } from '../../src/parsers/sfnt-parser.js'
import { buildFontCollection } from '../../src/subset/collection.js'
import { buildSfntFromTables } from '../../src/subset/ttf-subset.js'
import { buildTestFont, encodeSimpleGlyph } from '../renderer/synthetic-font.js'

const OUTLINE: [number, number][] = [[0, 0], [400, 0], [400, 500], [0, 500]]

function validSubset(): ArrayBuffer {
  const font = Font.load(buildTestFont([null, encodeSimpleGlyph(OUTLINE, [3])], [[0x41, 1]]))
  return font.subset('A')
}

function withTables(buffer: ArrayBuffer, additions: ReadonlyMap<string, Uint8Array | null>): ArrayBuffer {
  const sfnt = parseFont(buffer)
  const tables: { tag: string, data: Uint8Array }[] = []
  for (const tag of sfnt.tableDirectory.keys()) {
    if (additions.has(tag)) continue
    const reader = getTableReader(sfnt, tag)!
    const data = new Uint8Array(reader.length)
    for (let i = 0; i < data.length; i++) data[i] = reader.getUint8At(i)
    if (tag === 'head') new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(8, 0, false)
    tables.push({ tag, data })
  }
  for (const [tag, data] of additions) if (data !== null) tables.push({ tag, data })
  tables.sort(function (left, right) { return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0 })
  return buildSfntFromTables(sfnt.sfntVersion, tables)
}

describe('OpenType sfnt directory conformance', () => {
  it('validates search fields, alignment, table checksums, padding and whole-font adjustment', () => {
    const buffer = validSubset()
    expect(() => validateSfntChecksums(parseFont(buffer))).not.toThrow()

    const badSearch = buffer.slice(0)
    new DataView(badSearch).setUint16(6, 0)
    expect(() => validateSfntChecksums(parseFont(badSearch))).toThrow(/search fields/)

    const badAlignment = buffer.slice(0)
    new DataView(badAlignment).setUint32(12 + 8, new DataView(badAlignment).getUint32(12 + 8) + 1)
    expect(() => validateSfntChecksums(parseFont(badAlignment))).toThrow(/four-byte aligned/)

    const badTable = buffer.slice(0)
    const sfnt = parseFont(badTable)
    const cmap = sfnt.tableDirectory.get('cmap')!
    new Uint8Array(badTable)[cmap.offset] ^= 1
    expect(() => validateSfntChecksums(parseFont(badTable))).toThrow(/checksum mismatch/)

    const badPadding = buffer.slice(0)
    const paddedEntry = Array.from(parseFont(badPadding).tableDirectory.values()).find(entry => (entry.length & 3) !== 0)!
    expect(paddedEntry).toBeDefined()
    new Uint8Array(badPadding)[paddedEntry.offset + paddedEntry.length] = 1
    expect(() => validateSfntChecksums(parseFont(badPadding))).toThrow(/padding must contain only zero/)

    const badWholeFont = buffer.slice(0)
    const head = parseFont(badWholeFont).tableDirectory.get('head')!
    new DataView(badWholeFont).setUint32(head.offset + 8, 0)
    expect(() => validateSfntChecksums(parseFont(badWholeFont))).toThrow(/checksumAdjustment/)
  })

  it('validates every directory in a collection, not only the selected face', () => {
    const subset = validSubset()
    const collection = buildFontCollection([subset, subset], { majorVersion: 1 })
    expect(() => validateSfntChecksums(parseFont(collection, { fontIndex: 0 }))).not.toThrow()

    const corrupted = collection.slice(0)
    const parsed = parseFont(corrupted, { fontIndex: 0 })
    const secondDirectory = parsed.collection!.fontOffsets[1]!
    new DataView(corrupted).setUint16(secondDirectory + 6, 0)
    expect(() => validateSfntChecksums(parseFont(corrupted, { fontIndex: 0 }))).toThrow(/search fields/)
  })

  it('validates every glyf record against the maxp memory profile', () => {
    const path = resolve(import.meta.dirname, '../fixtures/fonts/NotoSans-Regular.ttf')
    const source = readFileSync(path)
    const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
    expect(() => Font.load(sourceBuffer, { conformance: 'opentype-1.9.1' })).not.toThrow()

    const badPoints = sourceBuffer.slice(0)
    const maxp = parseFont(badPoints).tableDirectory.get('maxp')!
    new DataView(badPoints).setUint16(maxp.offset + 6, 0)
    expect(() => Font.load(badPoints, { conformance: 'opentype-1.9.1' })).toThrow(/exceeding maxp.maxPoints/)

    const badDepth = sourceBuffer.slice(0)
    new DataView(badDepth).setUint16(maxp.offset + 30, 0)
    expect(() => Font.load(badDepth, { conformance: 'opentype-1.9.1' })).toThrow(/exceeds maxp.maxComponentDepth/)
  })

  it('validates real TrueType, CFF, CFF2 and variable table combinations', () => {
    const fixtureDirectory = resolve(import.meta.dirname, '../fixtures/fonts')
    for (const name of [
      'NotoSans-Regular.ttf',
      'SourceSans3-Regular.otf',
      'NotoSans-VariableFont_wdth,wght.ttf',
      'EmojiOneColor-SVG-subset.otf',
      'NotoColorEmoji-CBDT-subset.ttf',
    ]) {
      const source = readFileSync(resolve(fixtureDirectory, name))
      const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
      expect(() => Font.load(buffer, { conformance: 'opentype-1.9.1' }), name).not.toThrow()
    }
    const encoded = readFileSync(resolve(fixtureDirectory, 'SFIndiaBangla-CFF2.otf.base64'), 'utf8').trim()
    const cff2 = Uint8Array.from(Buffer.from(encoded, 'base64'))
    expect(() => Font.load(
      cff2.buffer.slice(cff2.byteOffset, cff2.byteOffset + cff2.byteLength) as ArrayBuffer,
      { conformance: 'opentype-1.9.1' },
    ), 'SFIndiaBangla-CFF2.otf').not.toThrow()
  })

  it('accepts paired bitmap/color/SVG tables and rejects invalid dependencies', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../fixtures/fonts/NotoSans-Regular.ttf'))
    const base = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
    const cbdt = new Uint8Array([0, 3, 0, 0])
    const cblc = new Uint8Array([0, 3, 0, 0, 0, 0, 0, 0])
    const ebdt = new Uint8Array([0, 2, 0, 0])
    const eblc = new Uint8Array([0, 2, 0, 0, 0, 0, 0, 0])
    const svg = new Uint8Array([
      0, 0, 0, 0, 0, 10, 0, 0, 0, 0,
      0, 1, 0, 1, 0, 1, 0, 0, 0, 14, 0, 0, 0, 6,
      60, 115, 118, 103, 47, 62,
    ])
    const colr = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 14, 0, 0, 0, 14, 0, 0])
    const cpal = new Uint8Array([0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 14, 0, 0, 0, 0, 0, 0xFF])
    const valid = withTables(base, new Map([
      ['CBDT', cbdt], ['CBLC', cblc], ['EBDT', ebdt], ['EBLC', eblc],
      ['SVG ', svg], ['COLR', colr], ['CPAL', cpal],
    ]))
    expect(() => Font.load(valid, { conformance: 'opentype-1.9.1' })).not.toThrow()

    const invalidPairs: ReadonlyArray<readonly [string, string, Uint8Array]> = [
      ['CBDT', 'CBLC', cbdt], ['CBLC', 'CBDT', cblc],
      ['EBDT', 'EBLC', ebdt], ['EBLC', 'EBDT', eblc],
      ['COLR', 'CPAL', colr], ['avar', 'fvar', new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0])],
    ]
    for (const [present, missing, data] of invalidPairs) {
      const invalid = withTables(base, new Map([[present, data]]))
      expect(() => Font.load(invalid, { conformance: 'opentype-1.9.1' }), present).toThrow(
        new RegExp(`${present}.*${missing}|${missing}.*${present}`),
      )
    }
  })
})
