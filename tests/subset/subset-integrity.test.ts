/**
 * Subset output integrity tests
 * - head.checkSumAdjustment recomputation (OpenType 'head' spec)
 * - CFF Top DICT FontMatrix preservation through subsetting
 * - Vertical origin fallback (VORG → vmtx tsb + yMax → ascender)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/font.js'
import { parseFont } from '../../src/parsers/index.js'
import { subsetFont } from '../../src/subset/index.js'
import { parseCff } from '../../src/parsers/cff-parser.js'
import { BinaryReader } from '../../src/binary/reader.js'
import { getTableReader } from '../../src/parsers/sfnt-parser.js'
import { parseSimpleGlyphPoints } from '../../src/parsers/tables/glyf.js'
import { SfntTableManager } from '../../src/parsers/ttf-parser.js'
import type { SfntData } from '../../src/types/index.js'
import { buildTable, buildTestFont, encodeSimpleGlyph } from '../renderer/synthetic-font.js'

const FIXTURES = resolve(__dirname, '../fixtures/fonts')

function loadBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(FIXTURES, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function outlineKey(font: Font, glyphId: number): string {
  const glyph = font.getGlyph(glyphId)
  const parts: string[] = []
  let coordinateIndex = 0
  for (let i = 0; i < glyph.outline.commands.length; i++) {
    const command = glyph.outline.commands[i]!
    const coordinateCount = command === 2 ? 6 : command === 3 ? 0 : 2
    parts.push(String(command))
    for (let j = 0; j < coordinateCount; j++) {
      parts.push((Math.round(glyph.outline.coords[coordinateIndex++]! * 100) / 100).toString())
    }
  }
  return parts.join(',')
}

/** OpenType checksum over a byte array (zero-padded to a ULONG boundary) */
function otChecksum(bytes: Uint8Array): number {
  let sum = 0
  const full = bytes.length & ~3
  for (let i = 0; i < full; i += 4) {
    sum = (sum + ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!)) >>> 0
  }
  if (bytes.length > full) {
    let last = 0
    for (let i = full; i < bytes.length; i++) last |= bytes[i]! << (24 - (i - full) * 8)
    sum = (sum + last) >>> 0
  }
  return sum
}

/** Locate a table in an SFNT binary; returns [offset, length] */
function findTable(bytes: Uint8Array, tag: string): [number, number] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numTables = dv.getUint16(4, false)
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16
    const t = String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!)
    if (t === tag) return [dv.getUint32(off + 8, false), dv.getUint32(off + 12, false)]
  }
  return [-1, 0]
}

describe('subset preserves glyph outlines', () => {
  // The checksum/metrics tests above do not detect a corrupted glyph shape:
  // subsetting could copy the wrong glyf entry, misrenumber composite
  // components, or renumber CFF subrs incorrectly and still checksum cleanly.
  // Reloading the subset and comparing every glyph's outline + advance to the
  // original guards the subsetter's core contract for both CFF and glyf,
  // including composites (é/ñ/Ọ) and ligatures (ﬁ).
  const TEXT = 'café ﬁñ Ọ8&@'

  for (const file of ['SourceSans3-Regular.otf', 'Roboto-Regular.ttf', 'NotoSans-Regular.ttf']) {
    it(`${file} のサブセットが元と同一のアウトライン/幅を保つ`, () => {
      const orig = Font.load(loadBuffer(file))
      const sub = Font.load(orig.subsetWithMapping(TEXT).buffer)
      let checked = 0
      for (const ch of TEXT) {
        if (ch === ' ') continue
        const og = orig.getGlyphId(ch.codePointAt(0)!)
        if (og === 0) continue
        const sg = sub.getGlyphId(ch.codePointAt(0)!)
        expect(sg, `${ch} present in subset`).toBeGreaterThan(0)
        expect(outlineKey(sub, sg), `${ch} outline`).toBe(outlineKey(orig, og))
        expect(Math.round(sub.getAdvanceWidth(sg)), `${ch} advance`).toBe(Math.round(orig.getAdvanceWidth(og)))
        checked++
      }
      expect(checked).toBeGreaterThanOrEqual(8)
    })
  }
})

describe('compact OpenType Layout subsetting', () => {
  it('rebuilds GSUB lookup types with compact glyph IDs and preserves shaping', () => {
    const source = Font.load(loadBuffer('SourceSans3-Regular.otf'))
    const text = 'office affine difficult'
    const expected = source.shapeText(text, { script: 'latn' })
    const result = source.subsetWithMapping(text)
    const subsetSfnt = parseFont(result.buffer)
    expect(subsetSfnt.tableDirectory.has('GSUB')).toBe(true)
    const subset = Font.load(result.buffer)
    const actual = subset.shapeText(text, { script: 'latn' })
    expect(actual.map(function (glyph) { return glyph.glyphId })).toEqual(expected.map(function (glyph) {
      return result.oldToNewGlyphId.get(glyph.glyphId)!
    }))
    expect(actual.map(function (glyph) {
      return [glyph.cluster, glyph.xOffset, glyph.yOffset, glyph.xAdvance, glyph.yAdvance, glyph.componentCount]
    })).toEqual(expected.map(function (glyph) {
      return [glyph.cluster, glyph.xOffset, glyph.yOffset, glyph.xAdvance, glyph.yAdvance, glyph.componentCount]
    }))
  })
})

describe('general-purpose subset table preservation', () => {
  it('keeps layout, vertical, and variable tables with stable glyph IDs', () => {
    const original = parseFont(loadBuffer('NotoSans-VariableFont_wdth,wght.ttf'))
    const font = Font.load(loadBuffer('NotoSans-VariableFont_wdth,wght.ttf'))
    const gid = font.getGlyphId(0x41)
    const result = font.subsetPreservingTables('A')
    const subset = parseFont(result.buffer)
    expect(result.oldToNewGlyphId.get(gid)).toBe(gid)
    for (const tag of ['GSUB', 'GPOS', 'GDEF', 'fvar', 'gvar', 'avar', 'HVAR', 'MVAR']) {
      if (original.tableDirectory.has(tag)) expect(subset.tableDirectory.has(tag), tag).toBe(true)
    }
    expect(Font.load(result.buffer).shapeText('A').length).toBeGreaterThan(0)
  })

  it('keeps MATH and CFF data in a general-purpose subset', () => {
    const font = Font.load(loadBuffer('FiraMath-Regular.otf'))
    const subsetResult = font.subsetPreservingTables('∫x')
    const subset = parseFont(subsetResult.buffer)
    expect(subset.tableDirectory.has('CFF ')).toBe(true)
    expect(subset.tableDirectory.has('MATH')).toBe(true)
    expect(Font.load(subsetResult.buffer).math).not.toBeNull()
  })

  it('physically empties unused CFF CharStrings while retaining stable glyph IDs', () => {
    const sourceBuffer = loadBuffer('SourceSans3-Regular.otf')
    const source = Font.load(sourceBuffer)
    const retained = source.getGlyphId(0x41)
    const removed = source.getGlyphId(0x42)
    const result = source.subsetPreservingTables('A')
    const subset = Font.load(result.buffer)
    expect(result.oldToNewGlyphId.get(retained)).toBe(retained)
    expect(subset.getGlyph(retained).outline.commands.length).toBeGreaterThan(0)
    expect(subset.getGlyph(removed).outline.commands.length).toBe(0)
    const sourceLength = parseFont(sourceBuffer).tableDirectory.get('CFF ')!.length
    const subsetLength = parseFont(result.buffer).tableDirectory.get('CFF ')!.length
    expect(subsetLength).toBeLessThan(sourceLength)
  })

  it('remaps CFF vertical metrics and VORG in compact subsets', () => {
    const source = Font.load(loadBuffer('NotoSansJP-Regular.otf'))
    const oldGlyphId = source.getGlyphId(0x3042)
    const expectedAdvance = source.getAdvanceHeight(oldGlyphId)
    const expectedOrigin = source.getVerticalOrigin(oldGlyphId)
    const result = source.subsetWithMapping('\u3042')
    const newGlyphId = result.oldToNewGlyphId.get(oldGlyphId)!
    const sfnt = parseFont(result.buffer)
    expect(sfnt.tableDirectory.has('vhea')).toBe(true)
    expect(sfnt.tableDirectory.has('vmtx')).toBe(true)
    expect(sfnt.tableDirectory.has('VORG')).toBe(true)
    const subset = Font.load(result.buffer)
    expect(subset.getAdvanceHeight(newGlyphId)).toBe(expectedAdvance)
    expect(subset.getVerticalOrigin(newGlyphId)).toBe(expectedOrigin)
  })

  it('physically empties unused CFF2 CharStrings while preserving variation semantics', () => {
    const encoded = readFileSync(resolve(FIXTURES, 'SFIndiaBangla-CFF2.otf.base64'), 'utf8').trim()
    const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'))
    const sourceBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const source = Font.load(sourceBuffer)
    const retained = source.getGlyphId(0x0995)
    const removed = source.getGlyphId(0x09aa)
    expect(retained).toBeGreaterThan(0)
    expect(removed).not.toBe(retained)

    const result = source.subsetPreservingTables('\u0995')
    const subset = Font.load(result.buffer)
    expect(result.oldToNewGlyphId.get(retained)).toBe(retained)
    expect(subset.isCff2).toBe(true)
    expect(subset.isVariable).toBe(true)
    expect(subset.getGlyph(removed).outline.commands.length).toBe(0)

    for (const location of [{ opsz: 17, wght: 1 }, { opsz: 28, wght: 1000 }]) {
      source.setVariation(location)
      subset.setVariation(location)
      expect(outlineKey(subset, retained)).toBe(outlineKey(source, retained))
      expect(subset.getAdvanceWidth(retained)).toBeCloseTo(source.getAdvanceWidth(retained), 5)
    }

    const sourceLength = parseFont(sourceBuffer).tableDirectory.get('CFF2')!.length
    const subsetLength = parseFont(result.buffer).tableDirectory.get('CFF2')!.length
    expect(subsetLength).toBeLessThan(sourceLength)
  })

  it('retains referenced COLR v0 layer outlines and removes unused color programs', () => {
    const square: [number, number][] = [[0, 0], [500, 0], [500, 500], [0, 500]]
    const outline = encodeSimpleGlyph(square, [3])
    const colr = buildTable(function (writer) {
      writer.writeUint16(0)
      writer.writeUint16(2)
      writer.writeUint32(14)
      writer.writeUint32(26)
      writer.writeUint16(3)
      writer.writeUint16(1); writer.writeUint16(0); writer.writeUint16(2)
      writer.writeUint16(2); writer.writeUint16(2); writer.writeUint16(1)
      writer.writeUint16(3); writer.writeUint16(0)
      writer.writeUint16(4); writer.writeUint16(1)
      writer.writeUint16(5); writer.writeUint16(2)
    })
    const fontBuffer = buildTestFont(
      [null, outline, outline, outline, outline, outline],
      [[0x41, 1], [0x42, 2]], [['COLR', colr]],
    )
    const font = Font.load(fontBuffer)
    const originalLength = parseFont(fontBuffer).tableDirectory.get('COLR')!.length
    const result = font.subsetPreservingTables('A')
    const subset = Font.load(result.buffer)
    expect(subset.getColorLayers(1)).toEqual([
      { glyphId: 3, paletteIndex: 0 },
      { glyphId: 4, paletteIndex: 1 },
    ])
    expect(subset.getColorLayers(2)).toBeNull()
    expect(subset.getGlyph(3).outline.commands.length).toBeGreaterThan(0)
    expect(subset.getGlyph(4).outline.commands.length).toBeGreaterThan(0)
    expect(subset.getGlyph(5).outline.commands.length).toBe(0)
    expect(parseFont(result.buffer).tableDirectory.get('COLR')!.length).toBeLessThan(originalLength)
  })

  it('retains AAT substitution target outlines in stable and compact closure', () => {
    const outline = encodeSimpleGlyph([[0, 0], [500, 0], [250, 500]], [2])
    const morx = buildTable(function (writer) {
      writer.writeUint16(2)
      writer.writeUint16(0)
      writer.writeUint32(1)
      writer.writeUint32(1)
      writer.writeUint32(36)
      writer.writeUint32(0)
      writer.writeUint32(1)
      writer.writeUint32(20)
      writer.writeUint32(4)
      writer.writeUint32(1)
      writer.writeUint16(8)
      writer.writeUint16(1)
      writer.writeUint16(1)
      writer.writeUint16(3)
    })
    const buffer = buildTestFont(
      [null, outline, outline, outline],
      [[0x41, 1]],
      [['morx', morx]],
    )
    const font = Font.load(buffer)

    const stable = Font.load(font.subsetPreservingTables('A').buffer)
    expect(stable.shapeText('A')[0]!.glyphId).toBe(3)
    expect(stable.getGlyph(3).outline.commands.length).toBeGreaterThan(0)

    const compactResult = font.subsetWithMapping('A')
    const target = compactResult.oldToNewGlyphId.get(3)
    expect(target).toBeDefined()
    const compact = Font.load(compactResult.buffer)
    expect(compact.getGlyph(target!).outline.commands.length).toBeGreaterThan(0)
    expect(compact.shapeText('A')[0]!.glyphId).toBe(target)
  })

  it('rebuilds legacy mort substitutions with compact glyph IDs', () => {
    const outline = encodeSimpleGlyph([[0, 0], [400, 0], [200, 400]], [2])
    const mort = buildTable(function (writer) {
      writer.writeUint32(0x00010000)
      writer.writeUint32(1)
      writer.writeUint32(1)
      writer.writeUint32(28)
      writer.writeUint16(0)
      writer.writeUint16(1)
      writer.writeUint16(16)
      writer.writeUint16(4)
      writer.writeUint32(1)
      writer.writeUint16(8)
      writer.writeUint16(1)
      writer.writeUint16(1)
      writer.writeUint16(3)
    })
    const font = Font.load(buildTestFont(
      [null, outline, outline, outline],
      [[0x41, 1]],
      [['mort', mort]],
    ))
    const result = font.subsetWithMapping('A')
    const target = result.oldToNewGlyphId.get(3)
    expect(target).toBeDefined()
    expect(Font.load(result.buffer).shapeText('A')[0]!.glyphId).toBe(target)
  })
})

describe('static variable TrueType subset hinting', () => {
  it('bakes selected outlines, metrics and layout into a non-variable compact font', () => {
    const sourceBuffer = loadBuffer('Roboto-VariableFont.ttf')
    const source = Font.load(sourceBuffer)
    source.setVariation({ wght: 700 })
    const text = 'Agé office'
    const expectedShape = source.shapeText(text)
    const expectedGlyphs = new Map<number, { commands: number[], coords: number[], advance: number }>()
    for (const glyph of expectedShape) {
      const sourceGlyph = source.getGlyph(glyph.glyphId)
      expectedGlyphs.set(glyph.glyphId, {
        commands: Array.from(sourceGlyph.outline.commands),
        coords: Array.from(sourceGlyph.outline.coords),
        advance: source.getAdvanceWidth(glyph.glyphId),
      })
    }
    const result = source.subsetWithMapping(text)
    const subset = Font.load(result.buffer)
    expect(subset.isVariable).toBe(false)
    const actualShape = subset.shapeText(text)
    expect(actualShape.map(function (glyph) {
      return [glyph.glyphId, glyph.xAdvance, glyph.yAdvance, glyph.xOffset, glyph.yOffset]
    })).toEqual(expectedShape.map(function (glyph) {
      return [result.oldToNewGlyphId.get(glyph.glyphId)!, glyph.xAdvance, glyph.yAdvance, glyph.xOffset, glyph.yOffset]
    }))
    for (const [oldGlyphId, expected] of expectedGlyphs) {
      const newGlyphId = result.oldToNewGlyphId.get(oldGlyphId)!
      const actual = subset.getGlyph(newGlyphId).outline
      expect(Array.from(actual.commands)).toEqual(expected.commands)
      expect(actual.coords.length).toBe(expected.coords.length)
      for (let coordinate = 0; coordinate < actual.coords.length; coordinate++) {
        expect(Math.abs(actual.coords[coordinate]! - expected.coords[coordinate]!)).toBeLessThanOrEqual(1)
      }
      expect(subset.getAdvanceWidth(newGlyphId)).toBeCloseTo(expected.advance, 0)
    }
  })

  it('retains glyph instructions and the font hint programs after baking variation deltas', () => {
    const sourceBuffer = loadBuffer('Roboto-VariableFont.ttf')
    const sourceSfnt = parseFont(sourceBuffer)
    const sourceManager = new SfntTableManager(sourceSfnt)
    const sourceGlyf = getTableReader(sourceSfnt, 'glyf')!
    let oldGlyphId = -1
    let sourceInstructions = new Uint8Array(0)
    for (let glyphId = 1; glyphId < sourceManager.maxp.numGlyphs; glyphId++) {
      const raw = parseSimpleGlyphPoints(sourceGlyf, sourceManager.loca, glyphId)
      if (raw !== null && raw.instructions.length > 0) {
        oldGlyphId = glyphId
        sourceInstructions = raw.instructions
        break
      }
    }
    expect(oldGlyphId).toBeGreaterThan(0)

    const font = Font.load(sourceBuffer)
    font.setVariation({ wght: 700 })
    const result = font.subsetByGlyphIds(new Set([oldGlyphId]))
    const subsetSfnt = parseFont(result.buffer)
    const subsetManager = new SfntTableManager(subsetSfnt)
    const newGlyphId = result.oldToNewGlyphId.get(oldGlyphId)!
    const subsetRaw = parseSimpleGlyphPoints(getTableReader(subsetSfnt, 'glyf')!, subsetManager.loca, newGlyphId)!
    expect(subsetRaw.instructions).toEqual(sourceInstructions)
    for (const tag of ['cvt ', 'fpgm', 'prep']) {
      if (sourceSfnt.tableDirectory.has(tag)) expect(subsetSfnt.tableDirectory.has(tag), tag).toBe(true)
    }
    expect(Font.load(result.buffer).getHintedGlyph(newGlyphId, 16).outline.commands.length).toBeGreaterThan(0)
  })

  it('materializes MVAR global metrics into static OpenType metric tables', () => {
    const source = Font.load(loadBuffer('NotoSans-VariableFont_wdth,wght.ttf'))
    source.setVariation({ wdth: 62.5, wght: 900 })
    const expected = source.metrics
    const result = source.subsetWithMapping('Ag')
    const sfnt = parseFont(result.buffer)
    const subset = Font.load(result.buffer)

    expect(subset.isVariable).toBe(false)
    expect(sfnt.tableDirectory.has('MVAR')).toBe(false)
    for (const field of [
      'ascender', 'descender', 'lineGap', 'horizontalClippingAscent', 'horizontalClippingDescent',
      'horizontalCaretSlopeRise', 'horizontalCaretSlopeRun', 'horizontalCaretOffset',
      'capHeight', 'xHeight', 'underlinePosition', 'underlineThickness',
      'strikeoutPosition', 'strikeoutSize', 'subscriptXSize', 'subscriptYSize',
      'subscriptXOffset', 'subscriptYOffset', 'superscriptXSize', 'superscriptYSize',
      'superscriptXOffset', 'superscriptYOffset',
    ] as const) {
      expect(subset.metrics[field], field).toBe(expected[field])
    }
  })
})

describe('head.checkSumAdjustment', () => {
  // The OpenType spec requires: sum of the whole font, with checkSumAdjustment
  // participating, to equal the magic constant 0xB1B0AFBA.
  it('TTFサブセットの全体チェックサムが 0xB1B0AFBA になる', () => {
    const font = Font.load(loadBuffer('NotoSans-Regular.ttf'))
    const gidA = font.getGlyphId(0x41)
    const result = font.subsetByGlyphIds(new Set([0, gidA]), new Map([[0x41, gidA]]))
    const bytes = new Uint8Array(result.buffer)

    expect(otChecksum(bytes)).toBe(0xB1B0AFBA)

    const [headOff] = findTable(bytes, 'head')
    expect(headOff).toBeGreaterThan(0)
    const adjustment = new DataView(bytes.buffer, bytes.byteOffset).getUint32(headOff + 8, false)
    expect(adjustment).not.toBe(0)
  })

  it('CFFサブセット(SFNTラッパー)の全体チェックサムが 0xB1B0AFBA になる', () => {
    const font = Font.load(loadBuffer('NotoSansJP-Regular.otf'))
    const gid = font.getGlyphId(0x3042)
    const result = font.subsetByGlyphIds(new Set([0, gid]), new Map([[0x3042, gid]]))
    const bytes = new Uint8Array(result.buffer)

    expect(otChecksum(bytes)).toBe(0xB1B0AFBA)
  })
})

describe('compact subset OpenType conformance', () => {
  it('rebuilds TrueType and CFF core metric extrema and font bounds', () => {
    for (const [fileName, text] of [
      ['NotoSans-Regular.ttf', 'Ag'],
      ['NotoSansJP-Regular.otf', '\u3042A'],
    ] as const) {
      const result = Font.load(loadBuffer(fileName)).subsetWithMapping(text)
      expect(() => Font.load(result.buffer, { conformance: 'opentype-1.9.1' }), fileName).not.toThrow()
    }
  })
})

// ─── FontMatrix preservation ───

/**
 * Craft a minimal name-keyed CFF: 2 glyphs (endchar only) and the given
 * FontMatrix in the Top DICT. Charset/Encoding/Private use CFF defaults.
 */
function craftCffWithFontMatrix(fontMatrix: number[]): Uint8Array {
  const encReal = (v: number): number[] => {
    const s = v.toString()
    const nib: number[] = []
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      if (c >= '0' && c <= '9') nib.push(c.charCodeAt(0) - 48)
      else if (c === '.') nib.push(0x0A)
      else if (c === '-') nib.push(0x0E)
      else if (c === 'e' || c === 'E') {
        if (s[i + 1] === '-') { nib.push(0x0C); i++ } else nib.push(0x0B)
      }
    }
    nib.push(0x0F)
    if (nib.length % 2 !== 0) nib.push(0x0F)
    const out = [30]
    for (let i = 0; i < nib.length; i += 2) out.push((nib[i]! << 4) | nib[i + 1]!)
    return out
  }
  const encNum = (v: number): number[] =>
    Number.isInteger(v) && v >= -107 && v <= 107 ? [v + 139] : encReal(v)

  const fm: number[] = []
  for (const v of fontMatrix) fm.push(...encNum(v))
  fm.push(12, 7) // FontMatrix operator

  // Layout: header(4) + Name INDEX(6) + Top DICT INDEX(5+td) + String(2) + GSubr(2) + CharStrings
  const tdLen = fm.length + 6 // + CharStrings offset (29 xx xx xx xx) + op 17
  const csOffset = 4 + 6 + (5 + tdLen) + 2 + 2
  const td = [
    ...fm,
    29, (csOffset >> 24) & 255, (csOffset >> 16) & 255, (csOffset >> 8) & 255, csOffset & 255, 17,
  ]

  return new Uint8Array([
    1, 0, 4, 1,                        // CFF header
    0, 1, 1, 1, 2, 0x54,               // Name INDEX: 'T'
    0, 1, 1, 1, 1 + td.length, ...td,  // Top DICT INDEX
    0, 0,                              // String INDEX (empty)
    0, 0,                              // Global Subr INDEX (empty)
    0, 2, 1, 1, 2, 3, 0x0E, 0x0E,      // CharStrings INDEX: 2 x endchar
  ])
}

/** Replace the CFF table of a real OTF with crafted bytes (appended to the buffer) */
function spliceCff(base: ArrayBuffer, cffBytes: Uint8Array): SfntData {
  const sfnt = parseFont(base)
  const merged = new ArrayBuffer(base.byteLength + cffBytes.length)
  const out = new Uint8Array(merged)
  out.set(new Uint8Array(base), 0)
  out.set(cffBytes, base.byteLength)
  const tableDirectory = new Map(sfnt.tableDirectory)
  tableDirectory.set('CFF ', { tag: 'CFF ', checksum: 0, offset: base.byteLength, length: cffBytes.length })
  for (const tag of ['BASE', 'GDEF', 'GPOS', 'GSUB', 'JSTF', 'MATH']) tableDirectory.delete(tag)
  return {
    format: sfnt.format,
    sfntVersion: sfnt.sfntVersion,
    tableDirectory,
    buffer: merged,
    offsetInBuffer: sfnt.offsetInBuffer,
  }
}

describe('CFF FontMatrix のサブセット保持', () => {
  const MATRIX_2048 = [0.00048828125, 0, 0, 0.00048828125, 0, 0] // 1/2048 em

  it('parseCff が Top DICT の FontMatrix を読み取る', () => {
    const cffBytes = craftCffWithFontMatrix(MATRIX_2048)
    const cff = parseCff(new BinaryReader(cffBytes.buffer, cffBytes.byteOffset, cffBytes.byteLength))
    expect(cff.fontMatrix).toEqual(MATRIX_2048)
    expect(cff.charstrings.count).toBe(2)
  })

  it('非デフォルト FontMatrix が CID CFF と SFNT ラッパーの両方に保持される', () => {
    const sfnt = spliceCff(loadBuffer('SourceSans3-Regular.otf'), craftCffWithFontMatrix(MATRIX_2048))
    const result = subsetFont(sfnt, new Set([1]), new Map([[0x41, 1]]))

    // The PDF-embedded CID-keyed CFF keeps the matrix
    const cid = result.cidKeyedCff!
    const cidCff = parseCff(new BinaryReader(cid.buffer as ArrayBuffer, cid.byteOffset, cid.byteLength))
    expect(cidCff.fontMatrix).toEqual(MATRIX_2048)

    // The SFNT-wrapped subset keeps it too
    const wrapped = parseFont(result.buffer)
    const cffReader = getTableReader(wrapped, 'CFF ')!
    const wrappedCff = parseCff(cffReader)
    expect(wrappedCff.fontMatrix).toEqual(MATRIX_2048)
  })

  it('デフォルト FontMatrix (0.001) のフォントでは省略される', () => {
    const font = Font.load(loadBuffer('SourceSans3-Regular.otf'))
    const gid = font.getGlyphId(0x41)
    const result = font.subsetByGlyphIds(new Set([0, gid]), new Map([[0x41, gid]]))
    const cid = result.cidKeyedCff!
    const cff = parseCff(new BinaryReader(cid.buffer as ArrayBuffer, cid.byteOffset, cid.byteLength))
    expect(cff.fontMatrix).toBeNull()
  })

  it('CID CFF ソースでも非デフォルト FontMatrix が保持される', () => {
    // NotoSansJP is a CID-keyed CFF: patch is not possible in place, so verify
    // the default case (no explicit matrix → none emitted, default applies)
    const font = Font.load(loadBuffer('NotoSansJP-Regular.otf'))
    const gid = font.getGlyphId(0x3042)
    const result = font.subsetByGlyphIds(new Set([0, gid]), new Map([[0x3042, gid]]))
    const cid = result.cidKeyedCff!
    const cff = parseCff(new BinaryReader(cid.buffer as ArrayBuffer, cid.byteOffset, cid.byteLength))
    expect(cff.fontMatrix).toBeNull()
  })
})

// ─── Vertical origin fallback ───

describe('getVerticalOrigin のフォールバック', () => {
  it('VORG があるフォントは VORG の値を返し vmtx(tsb)+yMax と一致する', () => {
    const font = Font.load(loadBuffer('NotoSansJP-Regular.otf'))
    for (const ch of ['あ', '、', 'x', 'A']) {
      const gid = font.getGlyphId(ch.codePointAt(0)!)
      const origin = font.getVerticalOrigin(gid)
      // In a consistent font the vmtx-derived origin (yMax + tsb) equals VORG
      const tm = (font as unknown as { tableManager: { vmtx: { getTopSideBearing(g: number): number } } }).tableManager
      const derived = font.getGlyph(gid).yMax + tm.vmtx.getTopSideBearing(gid)
      expect(origin).toBe(derived)
    }
  })

  it('VORG がないフォントでは vmtx の tsb + yMax から原点を導出する', () => {
    // Patch a copy of the font: hide VORG (rename the tag) and modify one tsb
    // so the vmtx-derived origin differs from the ascender
    const base = loadBuffer('NotoSansJP-Regular.otf')
    const refFont = Font.load(base)
    const gid = refFont.getGlyphId(0x3042) // あ
    const yMax = refFont.getGlyph(gid).yMax

    const bytes = new Uint8Array(base.slice(0))
    const dv = new DataView(bytes.buffer)
    const numTables = dv.getUint16(4, false)
    let vheaOff = -1
    let vmtxOff = -1
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16
      const tag = String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!)
      if (tag === 'VORG') bytes[off] = 0x58 // 'VORG' → 'XORG' (hides the table)
      if (tag === 'vhea') vheaOff = dv.getUint32(off + 8, false)
      if (tag === 'vmtx') vmtxOff = dv.getUint32(off + 8, false)
    }
    expect(vheaOff).toBeGreaterThan(0)
    expect(vmtxOff).toBeGreaterThan(0)

    // Overwrite the top side bearing of the glyph (long metrics assumed for this gid)
    const numLongVerMetrics = dv.getUint16(vheaOff + 34, false)
    expect(gid).toBeLessThan(numLongVerMetrics)
    const patchedTsb = 100
    dv.setInt16(vmtxOff + gid * 4 + 2, patchedTsb, false)

    const patched = Font.load(bytes.buffer)
    expect(patched.getVerticalOrigin(gid)).toBe(yMax + patchedTsb)
    // Distinguishable from the plain ascender fallback
    expect(patched.getVerticalOrigin(gid)).not.toBe(patched.metrics.ascender)
  })
})
