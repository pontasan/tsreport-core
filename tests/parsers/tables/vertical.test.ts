import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseVhea } from '../../../src/parsers/tables/vhea.js'
import { parseVmtx } from '../../../src/parsers/tables/vmtx.js'
import { parseVorg } from '../../../src/parsers/tables/vorg.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'
import { Font } from '../../../src/index.js'

const NOTO_SANS_JP_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSansJP-Regular.otf')

// Synthetic binary table tests.

describe('vhea テーブル (合成バイナリ)', () => {
  function buildVheaTable(fields: {
    majorVersion?: number; minorVersion?: number
    ascender?: number; descender?: number; lineGap?: number
    advanceHeightMax?: number; minTopSideBearing?: number; minBottomSideBearing?: number
    yMaxExtent?: number; caretSlopeRise?: number; caretSlopeRun?: number
    caretOffset?: number; reservedIndex?: number; reservedValue?: number
    metricDataFormat?: number; numberOfVMetrics?: number
  }): ArrayBuffer {
    const buf = new ArrayBuffer(36) // vhea is 36 bytes
    const view = new DataView(buf)
    let pos = 0
    view.setUint16(pos, fields.majorVersion ?? 1); pos += 2 // majorVersion
    view.setUint16(pos, fields.minorVersion ?? 0x1000); pos += 2 // minorVersion
    view.setInt16(pos, fields.ascender ?? 800); pos += 2
    view.setInt16(pos, fields.descender ?? -200); pos += 2
    view.setInt16(pos, fields.lineGap ?? 0); pos += 2
    view.setUint16(pos, fields.advanceHeightMax ?? 1000); pos += 2
    view.setInt16(pos, fields.minTopSideBearing ?? 50); pos += 2
    view.setInt16(pos, fields.minBottomSideBearing ?? -10); pos += 2
    view.setInt16(pos, fields.yMaxExtent ?? 900); pos += 2
    view.setInt16(pos, fields.caretSlopeRise ?? 1); pos += 2
    view.setInt16(pos, fields.caretSlopeRun ?? 0); pos += 2
    view.setInt16(pos, fields.caretOffset ?? 0); pos += 2
    for (let i = 0; i < 4; i++) {
      view.setInt16(pos, fields.reservedIndex === i ? (fields.reservedValue ?? 1) : 0); pos += 2
    }
    view.setInt16(pos, fields.metricDataFormat ?? 0); pos += 2
    view.setUint16(pos, fields.numberOfVMetrics ?? 5); pos += 2
    return buf
  }

  it('should parse all 14 fields for version 1.1', () => {
    const buf = buildVheaTable({
      ascender: 880, descender: -120, lineGap: 90,
      advanceHeightMax: 1200, minTopSideBearing: 40, minBottomSideBearing: -15,
      yMaxExtent: 850, caretSlopeRise: 1, caretSlopeRun: 0,
      caretOffset: 10, numberOfVMetrics: 100,
    })
    const vhea = parseVhea(new BinaryReader(buf))

    expect(vhea.majorVersion).toBe(1)
    expect(vhea.minorVersion).toBe(0x1000)
    expect(vhea.ascender).toBe(880)
    expect(vhea.descender).toBe(-120)
    expect(vhea.lineGap).toBe(90)
    expect(vhea.advanceHeightMax).toBe(1200)
    expect(vhea.minTopSideBearing).toBe(40)
    expect(vhea.minBottomSideBearing).toBe(-15)
    expect(vhea.yMaxExtent).toBe(850)
    expect(vhea.caretSlopeRise).toBe(1)
    expect(vhea.caretSlopeRun).toBe(0)
    expect(vhea.caretOffset).toBe(10)
    expect(vhea.metricDataFormat).toBe(0)
    expect(vhea.numberOfVMetrics).toBe(100)
  })

  it('should parse version 1.0', () => {
    const vhea = parseVhea(new BinaryReader(buildVheaTable({ minorVersion: 0 })))

    expect(vhea.majorVersion).toBe(1)
    expect(vhea.minorVersion).toBe(0)
  })

  it('accepts vhea 1.1 encoded with minor version 1 (e.g. AppleGothic)', () => {
    const vhea = parseVhea(new BinaryReader(buildVheaTable({ minorVersion: 1, ascender: 750 })))
    expect(vhea.majorVersion).toBe(1)
    expect(vhea.minorVersion).toBe(1)
    expect(vhea.ascender).toBe(750)
  })

  it('should reject unsupported vhea versions', () => {
    expect(() => parseVhea(new BinaryReader(buildVheaTable({ majorVersion: 2 })))).toThrow(
      'Unsupported vhea version: 2.',
    )
  })

  it('should reject non-zero vhea reserved fields', () => {
    expect(() => parseVhea(new BinaryReader(buildVheaTable({ reservedIndex: 3, reservedValue: -2 })))).toThrow(
      'vhea reserved field 3 must be 0, got -2',
    )
  })

  it('should reject non-zero vhea metricDataFormat', () => {
    expect(() => parseVhea(new BinaryReader(buildVheaTable({ metricDataFormat: 1 })))).toThrow(
      'vhea metricDataFormat must be 0, got 1',
    )
  })

  it('should reject zero vhea metric counts', () => {
    expect(() => parseVhea(new BinaryReader(buildVheaTable({ numberOfVMetrics: 0 })))).toThrow(
      'vhea numberOfVMetrics must be greater than 0',
    )
  })
})

describe('vmtx テーブル (合成バイナリ)', () => {
  function buildVmtxTable(
    numVMetrics: number,
    numGlyphs: number,
    metrics: { advanceHeight: number; topSideBearing: number }[],
    extraTsbs: number[],
    extraBytes = 0,
  ): ArrayBuffer {
    const size = numVMetrics * 4 + extraTsbs.length * 2 + extraBytes
    const buf = new ArrayBuffer(size)
    const view = new DataView(buf)
    let pos = 0
    for (let i = 0; i < numVMetrics; i++) {
      view.setUint16(pos, metrics[i]!.advanceHeight); pos += 2
      view.setInt16(pos, metrics[i]!.topSideBearing); pos += 2
    }
    for (const tsb of extraTsbs) {
      view.setInt16(pos, tsb); pos += 2
    }
    return buf
  }

  it('should return correct advanceHeight and topSideBearing', () => {
    const vmtx = parseVmtx(
      new BinaryReader(buildVmtxTable(3, 5,
        [{ advanceHeight: 1000, topSideBearing: 50 }, { advanceHeight: 800, topSideBearing: 30 }, { advanceHeight: 600, topSideBearing: 20 }],
        [10, -5], // extra TSBs for glyphs 3,4
      )),
      3, 5,
    )

    expect(vmtx.getAdvanceHeight(0)).toBe(1000)
    expect(vmtx.getTopSideBearing(0)).toBe(50)
    expect(vmtx.getAdvanceHeight(1)).toBe(800)
    expect(vmtx.getTopSideBearing(1)).toBe(30)
    expect(vmtx.getAdvanceHeight(2)).toBe(600)
    expect(vmtx.getTopSideBearing(2)).toBe(20)
    // Glyphs beyond numVMetrics inherit last advanceHeight
    expect(vmtx.getAdvanceHeight(3)).toBe(600)
    expect(vmtx.getTopSideBearing(3)).toBe(10)
    expect(vmtx.getAdvanceHeight(4)).toBe(600)
    expect(vmtx.getTopSideBearing(4)).toBe(-5)
  })

  it('should return 0 for out-of-range glyphId', () => {
    const vmtx = parseVmtx(
      new BinaryReader(buildVmtxTable(1, 1,
        [{ advanceHeight: 1000, topSideBearing: 50 }],
        [],
      )),
      1, 1,
    )
    expect(vmtx.getAdvanceHeight(-1)).toBe(0)
    expect(vmtx.getAdvanceHeight(1)).toBe(0)
    expect(vmtx.getTopSideBearing(-1)).toBe(0)
    expect(vmtx.getTopSideBearing(1)).toBe(0)
  })

  it('should reject numberOfVMetrics outside the glyph range', () => {
    expect(() => parseVmtx(new BinaryReader(buildVmtxTable(0, 4, [], [])), 0, 4)).toThrow(
      'vmtx numberOfVMetrics must be in the range 1..4, got 0',
    )
    expect(() => parseVmtx(new BinaryReader(buildVmtxTable(0, 4, [], [])), 5, 4)).toThrow(
      'vmtx numberOfVMetrics must be in the range 1..4, got 5',
    )
  })

  it('should reject vmtx tables whose length does not match vhea/maxp counts', () => {
    expect(() => parseVmtx(new BinaryReader(buildVmtxTable(1, 2,
      [{ advanceHeight: 1000, topSideBearing: 50 }],
      [],
    )), 1, 2)).toThrow(
      'vmtx table length must be 6, got 4',
    )

    expect(() => parseVmtx(new BinaryReader(buildVmtxTable(1, 2,
      [{ advanceHeight: 1000, topSideBearing: 50 }],
      [20],
      2,
    )), 1, 2)).toThrow(
      'vmtx table length must be 6, got 8',
    )
  })
})

describe('VORG テーブル (合成バイナリ)', () => {
  function buildVorgTable(
    defaultVertOriginY: number,
    overrides: { glyphIndex: number; vertOriginY: number }[],
    options: { majorVersion?: number; minorVersion?: number; declaredCount?: number; extraBytes?: number } = {},
  ): ArrayBuffer {
    const buf = new ArrayBuffer(8 + overrides.length * 4 + (options.extraBytes ?? 0))
    const view = new DataView(buf)
    let pos = 0
    view.setUint16(pos, options.majorVersion ?? 1); pos += 2 // majorVersion
    view.setUint16(pos, options.minorVersion ?? 0); pos += 2 // minorVersion
    view.setInt16(pos, defaultVertOriginY); pos += 2
    view.setUint16(pos, options.declaredCount ?? overrides.length); pos += 2
    for (const o of overrides) {
      view.setUint16(pos, o.glyphIndex); pos += 2
      view.setInt16(pos, o.vertOriginY); pos += 2
    }
    return buf
  }

  it('should return override value for listed glyphId', () => {
    const vorg = parseVorg(new BinaryReader(buildVorgTable(800, [
      { glyphIndex: 10, vertOriginY: 900 },
      { glyphIndex: 20, vertOriginY: 750 },
    ])))
    expect(vorg.getVertOriginY(10)).toBe(900)
    expect(vorg.getVertOriginY(20)).toBe(750)
  })

  it('should return default value for unlisted glyphId', () => {
    const vorg = parseVorg(new BinaryReader(buildVorgTable(800, [
      { glyphIndex: 10, vertOriginY: 900 },
    ])))
    expect(vorg.getVertOriginY(0)).toBe(800)
    expect(vorg.getVertOriginY(999)).toBe(800)
  })

  it('should store defaultVertOriginY', () => {
    const vorg = parseVorg(new BinaryReader(buildVorgTable(850, [])))
    expect(vorg.defaultVertOriginY).toBe(850)
  })

  it('should reject malformed VORG headers and versions', () => {
    expect(() => parseVorg(new BinaryReader(new ArrayBuffer(7)))).toThrow(/length/)
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [], { majorVersion: 2 })))).toThrow(
      'Unsupported VORG version: 2.0',
    )
    expect(parseVorg(new BinaryReader(buildVorgTable(800, [], { minorVersion: 1 }))).defaultVertOriginY).toBe(800)
  })

  it('should reject VORG table lengths inconsistent with the metric count', () => {
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [], { declaredCount: 1 })))).toThrow(
      'VORG table length must be 12, got 8',
    )
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [], { extraBytes: 4 })))).toThrow(
      'VORG table length must be 8, got 12',
    )
  })

  it('should reject unsorted or duplicate VORG glyph indices', () => {
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [
      { glyphIndex: 10, vertOriginY: 900 },
      { glyphIndex: 9, vertOriginY: 750 },
    ])))).toThrow(/strictly increasing/)
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [
      { glyphIndex: 10, vertOriginY: 900 },
      { glyphIndex: 10, vertOriginY: 750 },
    ])))).toThrow(/strictly increasing/)
  })

  it('should reject VORG glyph indices outside maxp.numGlyphs when provided', () => {
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [
      { glyphIndex: 5, vertOriginY: 900 },
    ])), 5)).toThrow(
      'VORG glyphIndex 5 exceeds numGlyphs 5',
    )
    expect(() => parseVorg(new BinaryReader(buildVorgTable(800, [])), 0)).toThrow(
      'VORG numGlyphs must be in the range 1..65536, got 0',
    )
  })

  it('should ignore VORG in TrueType-outline fonts at the table manager level', () => {
    const buffer = buildVorgTable(800, [{ glyphIndex: 1, vertOriginY: 900 }])
    const manager = new SfntTableManager({
      format: 'ttf',
      sfntVersion: 0x00010000,
      tableDirectory: new Map([['VORG', { tag: 'VORG', checksum: 0, offset: 0, length: buffer.byteLength }]]),
      buffer,
      offsetInBuffer: 0,
    })

    expect(manager.vorg).toBeNull()
  })
})

// Font.


describe('縦書きテーブル (vhea/vmtx)', () => {
  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP に vhea テーブルが存在する', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Verticalget with.
    
    const glyphId = font.getGlyphId('あ'.codePointAt(0)!)
    expect(glyphId).toBeGreaterThan(0)

    const advHeight = font.getAdvanceHeight(glyphId)
    expect(advHeight).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP の縦書き advanceHeight が正の値', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    // Multiple with advanceHeight check.
    
    const chars = ['漢', '字', 'テ', 'ス', 'ト']
    for (const ch of chars) {
      const gid = font.getGlyphId(ch.codePointAt(0)!)
      if (gid === 0) continue
      const height = font.getAdvanceHeight(gid)
      expect(height).toBeGreaterThan(0)
    }
  })

  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP の全角文字は advanceHeight が均一', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const chars = ['あ', 'い', 'う', 'え', 'お']
    const heights = new Set<number>()
    for (const ch of chars) {
      const gid = font.getGlyphId(ch.codePointAt(0)!)
      if (gid === 0) continue
      heights.add(font.getAdvanceHeight(gid))
    }
    // Characterall advanceHeight.
    
    expect(heights.size).toBe(1)
  })

  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP で縦書きシェーピングが動作する', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const shaped = font.shapeText('テスト', { direction: 'vertical' })
    expect(shaped.length).toBeGreaterThan(0)

    for (const g of shaped) {
      expect(g.glyphId).toBeGreaterThan(0)
      // Vertical writing: xAdvance 0, yAdvance > 0.
      
      expect(g.xAdvance).toBe(0)
      expect(g.yAdvance).toBeGreaterThan(0)
    }
  })

  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP: ASCII vs CJK の advanceHeight 比較', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const cjkGid = font.getGlyphId('あ'.codePointAt(0)!)
    const asciiGid = font.getGlyphId('A'.codePointAt(0)!)

    if (cjkGid === 0 || asciiGid === 0) return

    const cjkHeight = font.getAdvanceHeight(cjkGid)
    const asciiHeight = font.getAdvanceHeight(asciiGid)

    // Both should be positive
    expect(cjkHeight).toBeGreaterThan(0)
    expect(asciiHeight).toBeGreaterThan(0)
  })
})

// Real-font oracle: values read from NotoSansJP's actual vhea and VORG tables
// via fontTools. Matching them validates the parsers against the reference
// (the vmtx advance heights were separately verified exhaustively: all
// 17,936 glyphs equal fontTools).
describe('NotoSansJP vhea/VORG match fontTools', () => {
  it('parses vhea metrics and VORG origins', () => {
    if (!existsSync(NOTO_SANS_JP_PATH)) return
    const font = Font.load(readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer)
    const tm = (font as unknown as { tableManager: { vhea: { ascender: number, descender: number, lineGap: number, advanceHeightMax: number, numberOfVMetrics: number } | null } }).tableManager
    const vhea = tm.vhea!
    expect(vhea.ascender).toBe(500)
    expect(vhea.descender).toBe(-500)
    expect(vhea.lineGap).toBe(0)
    expect(vhea.advanceHeightMax).toBe(3000)
    expect(vhea.numberOfVMetrics).toBe(17608)
    // VORG: non-default records for gids 480/498/499/500/502; default 880.
    expect(font.getVerticalOrigin(480)).toBe(867)
    expect(font.getVerticalOrigin(498)).toBe(868)
    expect(font.getVerticalOrigin(499)).toBe(875)
    expect(font.getVerticalOrigin(500)).toBe(868)
    expect(font.getVerticalOrigin(502)).toBe(652)
    expect(font.getVerticalOrigin(3)).toBe(880)
  })
})
