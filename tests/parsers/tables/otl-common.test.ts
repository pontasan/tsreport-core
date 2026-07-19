import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import {
  parseCoverage,
  parseCoverageMap,
  parseClassDef,
  parseDeviceTable,
  readValueRecord,
  valueFormatSize,
  parseLookupList,
  parseFeatureVariations,
  getFeatureLookupIndices,
  getDirectFeatureLookupIndices,
} from '../../../src/parsers/tables/otl-common.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('OTL common utilities', () => {
  function uint16Buffer(values: number[]): ArrayBuffer {
    const buf = new ArrayBuffer(values.length * 2)
    const view = new DataView(buf)
    for (let i = 0; i < values.length; i++) {
      view.setUint16(i * 2, values[i]!)
    }
    return buf
  }

  function writeTag(view: DataView, offset: number, tag: string): void {
    for (let i = 0; i < 4; i++) {
      view.setUint8(offset + i, tag.charCodeAt(i))
    }
  }

  function buildScriptFeatureTable(
    lookupOrderOffset: number,
    requiredFeatureIndex: number,
    featureIndices: number[],
    featureCount: number,
    featureLookupIndices?: number[],
  ): ArrayBuffer {
    const scriptListOffset = 0
    const scriptTableOffset = 8
    const langSysOffset = 12
    const featureListOffset = langSysOffset + 6 + featureIndices.length * 2
    const featureRecordBytes = featureCount * 6
    const featureTableOffset = 2 + featureRecordBytes
    const buf = new ArrayBuffer(featureListOffset + featureTableOffset + featureCount * 6)
    const view = new DataView(buf)
    let pos = scriptListOffset

    view.setUint16(pos, 1); pos += 2
    writeTag(view, pos, 'DFLT'); pos += 4
    view.setUint16(pos, scriptTableOffset); pos += 2

    pos = scriptTableOffset
    view.setUint16(pos, langSysOffset - scriptTableOffset); pos += 2
    view.setUint16(pos, 0); pos += 2

    pos = langSysOffset
    view.setUint16(pos, lookupOrderOffset); pos += 2
    view.setUint16(pos, requiredFeatureIndex); pos += 2
    view.setUint16(pos, featureIndices.length); pos += 2
    for (const featureIndex of featureIndices) {
      view.setUint16(pos, featureIndex); pos += 2
    }

    pos = featureListOffset
    view.setUint16(pos, featureCount); pos += 2
    for (let i = 0; i < featureCount; i++) {
      writeTag(view, pos, i === 0 ? 'kern' : 'liga'); pos += 4
      view.setUint16(pos, featureTableOffset + i * 6); pos += 2
    }
    for (let i = 0; i < featureCount; i++) {
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, featureLookupIndices?.[i] ?? i); pos += 2
    }

    return buf
  }

  function copyIntoFeatureVariationBuffer(base: ArrayBuffer, totalLength: number, featureVariationsOffset: number): ArrayBuffer {
    const buf = new ArrayBuffer(totalLength)
    new Uint8Array(buf).set(new Uint8Array(base))
    const view = new DataView(buf)
    view.setUint16(featureVariationsOffset, 1)
    view.setUint16(featureVariationsOffset + 2, 0)
    view.setUint32(featureVariationsOffset + 4, 1)
    return buf
  }

  function writeFeatureTable(view: DataView, offset: number, lookupIndex: number): void {
    view.setUint16(offset, 0)
    view.setUint16(offset + 2, 1)
    view.setUint16(offset + 4, lookupIndex)
  }

  function writeFeatureTableSubstitution(
    view: DataView,
    offset: number,
    featureIndex: number,
    alternateFeatureOffset: number,
  ): void {
    view.setUint16(offset, 1)
    view.setUint16(offset + 2, 0)
    view.setUint16(offset + 4, 1)
    view.setUint16(offset + 6, featureIndex)
    view.setUint32(offset + 8, alternateFeatureOffset)
  }

  function buildUniversalFeatureVariations(): { buf: ArrayBuffer, featureVariationsOffset: number } {
    const base = buildScriptFeatureTable(0, 0xFFFF, [0], 1, [0])
    const featureVariationsOffset = 40
    const substitutionOffset = 16
    const alternateFeatureOffset = 12
    const buf = copyIntoFeatureVariationBuffer(base, 80, featureVariationsOffset)
    const view = new DataView(buf)
    view.setUint32(featureVariationsOffset + 8, 0)
    view.setUint32(featureVariationsOffset + 12, substitutionOffset)
    writeFeatureTableSubstitution(view, featureVariationsOffset + substitutionOffset, 0, alternateFeatureOffset)
    writeFeatureTable(view, featureVariationsOffset + substitutionOffset + alternateFeatureOffset, 1)
    return { buf, featureVariationsOffset }
  }

  function buildConditionalFeatureVariations(minValue: number, maxValue: number): {
    buf: ArrayBuffer,
    featureVariationsOffset: number,
  } {
    const base = buildScriptFeatureTable(0, 0xFFFF, [0], 1, [0])
    const featureVariationsOffset = 40
    const conditionSetOffset = 16
    const conditionOffset = 6
    const substitutionOffset = 30
    const alternateFeatureOffset = 12
    const buf = copyIntoFeatureVariationBuffer(base, 96, featureVariationsOffset)
    const view = new DataView(buf)
    view.setUint32(featureVariationsOffset + 8, conditionSetOffset)
    view.setUint32(featureVariationsOffset + 12, substitutionOffset)

    const conditionSetStart = featureVariationsOffset + conditionSetOffset
    view.setUint16(conditionSetStart, 1)
    view.setUint32(conditionSetStart + 2, conditionOffset)
    const conditionStart = conditionSetStart + conditionOffset
    view.setUint16(conditionStart, 1)
    view.setUint16(conditionStart + 2, 0)
    view.setInt16(conditionStart + 4, Math.round(minValue * 16384))
    view.setInt16(conditionStart + 6, Math.round(maxValue * 16384))

    writeFeatureTableSubstitution(view, featureVariationsOffset + substitutionOffset, 0, alternateFeatureOffset)
    writeFeatureTable(view, featureVariationsOffset + substitutionOffset + alternateFeatureOffset, 1)
    return { buf, featureVariationsOffset }
  }

  describe('Coverage parser', () => {
    it('should parse format 1 glyphs in coverage-index order', () => {
      const buf = uint16Buffer([1, 3, 7, 9, 11])

      expect(parseCoverage(new BinaryReader(buf), 0)).toEqual([7, 9, 11])
      expect([...parseCoverageMap(new BinaryReader(buf), 0).entries()]).toEqual([
        [7, 0],
        [9, 1],
        [11, 2],
      ])
    })

    it('should expand format 2 ranges in coverage-index order', () => {
      const buf = uint16Buffer([
        2, 2,
        10, 12, 0,
        20, 21, 3,
      ])

      expect(parseCoverage(new BinaryReader(buf), 0)).toEqual([10, 11, 12, 20, 21])
      expect([...parseCoverageMap(new BinaryReader(buf), 0).entries()]).toEqual([
        [10, 0],
        [11, 1],
        [12, 2],
        [20, 3],
        [21, 4],
      ])
    })

    it('should reject unsupported coverage formats', () => {
      const buf = uint16Buffer([3, 0])

      expect(() => parseCoverage(new BinaryReader(buf), 0)).toThrow(
        'Unsupported Coverage table format: 3',
      )
      expect(() => parseCoverageMap(new BinaryReader(buf), 0)).toThrow(
        'Unsupported Coverage table format: 3',
      )
    })

    it('accepts non-strictly-increasing format 1 glyph arrays (position = index)', () => {
      // Real fonts (Gujarati Sangam MN, NotoSansSiddham) ship these; the
      // coverage index is the list position.
      const buf = uint16Buffer([1, 3, 7, 7, 11])
      expect(parseCoverage(new BinaryReader(buf), 0)).toEqual([7, 7, 11])
      const map = parseCoverageMap(new BinaryReader(buf), 0)
      expect(map.get(11)).toBe(2)
    })

    it('should reject format 2 ranges with non-sequential coverage indexes', () => {
      const buf = uint16Buffer([
        2, 2,
        10, 12, 0,
        20, 21, 4,
      ])

      expect(() => parseCoverage(new BinaryReader(buf), 0)).toThrow(
        'Coverage format 2 range 1 startCoverageIndex 4 does not match expected 3',
      )
      expect(() => parseCoverageMap(new BinaryReader(buf), 0)).toThrow(
        'Coverage format 2 range 1 startCoverageIndex 4 does not match expected 3',
      )
    })

    it('should reject format 2 ranges that overlap or are out of order', () => {
      const buf = uint16Buffer([
        2, 2,
        10, 12, 0,
        12, 14, 3,
      ])

      expect(() => parseCoverage(new BinaryReader(buf), 0)).toThrow(
        'Coverage format 2 range 1 overlaps or is out of order',
      )
      expect(() => parseCoverageMap(new BinaryReader(buf), 0)).toThrow(
        'Coverage format 2 range 1 overlaps or is out of order',
      )
    })
  })

  describe('ClassDef parser', () => {
    it('should parse format 2 class ranges in glyph order', () => {
      const buf = uint16Buffer([
        2, 2,
        10, 12, 1,
        20, 21, 2,
      ])

      expect([...parseClassDef(new BinaryReader(buf), 0).entries()]).toEqual([
        [10, 1],
        [11, 1],
        [12, 1],
        [20, 2],
        [21, 2],
      ])
    })

    it('should reject unsupported class definition formats', () => {
      const buf = uint16Buffer([3, 0])

      expect(() => parseClassDef(new BinaryReader(buf), 0)).toThrow(
        'Unsupported ClassDef table format: 3',
      )
    })

    it('skips format 2 ranges with inverted glyph bounds (cover nothing)', () => {
      const buf = uint16Buffer([
        2, 1,
        12, 10, 1,
      ])
      const classDef = parseClassDef(new BinaryReader(buf), 0)
      expect(classDef.get(10)).toBeUndefined()
      expect(classDef.get(12)).toBeUndefined()
    })

    it('accepts overlapping/out-of-order format 2 ranges (later ranges win)', () => {
      // Real fonts (many Noto scripts) ship overlapping/unordered ClassDef
      // ranges; trust the data rather than reject the font.
      const buf = uint16Buffer([
        2, 2,
        10, 12, 1,
        12, 14, 2,
      ])
      const classDef = parseClassDef(new BinaryReader(buf), 0)
      expect(classDef.get(10)).toBe(1)
      expect(classDef.get(11)).toBe(1)
      expect(classDef.get(12)).toBe(2) // overlap: later range wins
      expect(classDef.get(14)).toBe(2)
    })

    it('skips degenerate format 2 ranges (startGlyph > endGlyph)', () => {
      const buf = uint16Buffer([
        2, 2,
        20, 10, 1, // degenerate: covers nothing
        30, 31, 2,
      ])
      const classDef = parseClassDef(new BinaryReader(buf), 0)
      expect(classDef.get(15)).toBeUndefined()
      expect(classDef.get(30)).toBe(2)
    })
  })

  describe('Device parser', () => {
    it('should reject unsupported device delta formats', () => {
      const buf = uint16Buffer([12, 12, 4])

      expect(() => parseDeviceTable(new BinaryReader(buf), 0)).toThrow(
        'Unsupported Device table deltaFormat: 4',
      )
    })

    it('should reject inverted device size ranges', () => {
      const buf = uint16Buffer([14, 12, 1])

      expect(() => parseDeviceTable(new BinaryReader(buf), 0)).toThrow(
        'Device table endSize 12 precedes startSize 14',
      )
    })
  })

  describe('valueFormatSize', () => {
    it('should return 0 for empty format', () => {
      expect(valueFormatSize(0)).toBe(0)
    })

    it('should return 2 for single field', () => {
      expect(valueFormatSize(0x0001)).toBe(2) // xPlacement only
      expect(valueFormatSize(0x0004)).toBe(2) // xAdvance only
    })

    it('should return 4 for two fields', () => {
      expect(valueFormatSize(0x0005)).toBe(4) // xPlacement + xAdvance
    })

    it('should return 16 for all 8 fields', () => {
      expect(valueFormatSize(0x00FF)).toBe(16)
    })

    it('should reject reserved ValueFormat bits', () => {
      expect(() => valueFormatSize(0x0100)).toThrow(
        'Unsupported ValueFormat reserved bits: 0x0100',
      )
      expect(() => readValueRecord(new BinaryReader(uint16Buffer([0])), 0x8001)).toThrow(
        'Unsupported ValueFormat reserved bits: 0x8000',
      )
    })
  })

  describe('GPOS Script/Feature traversal', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)

    it('should find kern feature lookup indices', () => {
      const reader = getTableReader(sfnt, 'GPOS')
      if (!reader) return

      const tableStart = reader.position
      reader.readUint16() // majorVersion
      reader.readUint16() // minorVersion
      const scriptListOffset = reader.readUint16()
      const featureListOffset = reader.readUint16()

      const indices = getDirectFeatureLookupIndices(
        reader, tableStart, featureListOffset, 'kern',
      )
      // NotoSans should have kern lookups
      expect(indices.length).toBeGreaterThan(0)
    })

    it('should find lookups via Script/Feature traversal', () => {
      const reader = getTableReader(sfnt, 'GPOS')
      if (!reader) return

      const tableStart = reader.position
      reader.readUint16() // majorVersion
      reader.readUint16() // minorVersion
      const scriptListOffset = reader.readUint16()
      const featureListOffset = reader.readUint16()

      const indices = getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        new Set(['kern']),
      )
      expect(indices.length).toBeGreaterThan(0)
    })

    it('should resolve valid LangSys feature indices through the FeatureList', () => {
      const buf = buildScriptFeatureTable(0, 0xFFFF, [0], 1)

      expect(getFeatureLookupIndices(new BinaryReader(buf), 0, 0, 20, null)).toEqual([0])
    })

    it('should reject a non-null LangSys lookupOrderOffset', () => {
      const buf = buildScriptFeatureTable(2, 0xFFFF, [0], 1)

      expect(() => getFeatureLookupIndices(new BinaryReader(buf), 0, 0, 20, null)).toThrow(
        'LangSys lookupOrderOffset must be 0, got 2',
      )
    })

    it('should reject LangSys feature indices outside the FeatureList', () => {
      const buf = buildScriptFeatureTable(0, 0xFFFF, [1], 1)

      expect(() => getFeatureLookupIndices(new BinaryReader(buf), 0, 0, 20, null)).toThrow(
        'LangSys feature index 1 out of FeatureList range 1',
      )
    })

    it('should reject Feature lookup indices outside the LookupList', () => {
      const buf = buildScriptFeatureTable(0, 0xFFFF, [0], 1, [1])

      expect(() => getFeatureLookupIndices(new BinaryReader(buf), 0, 0, 20, null, null, null, 1)).toThrow(
        'Feature lookup index 1 out of LookupList range 1',
      )
    })

    it('should replace a matching Feature table through FeatureVariations', () => {
      const { buf, featureVariationsOffset } = buildUniversalFeatureVariations()
      const reader = new BinaryReader(buf)
      const variations = parseFeatureVariations(reader, featureVariationsOffset, 1, 2)

      expect(getFeatureLookupIndices(
        reader, 0, 0, 20, new Set(['kern']), null, null, 2, variations, null,
      )).toEqual([1])
    })

    it('should apply FeatureVariations only when normalized coordinates match', () => {
      const { buf, featureVariationsOffset } = buildConditionalFeatureVariations(0.5, 1)
      const reader = new BinaryReader(buf)
      const variations = parseFeatureVariations(reader, featureVariationsOffset, 1, 2, 1)

      expect(getFeatureLookupIndices(
        reader, 0, 0, 20, new Set(['kern']), null, null, 2, variations, [0.75],
      )).toEqual([1])
      expect(getFeatureLookupIndices(
        reader, 0, 0, 20, new Set(['kern']), null, null, 2, variations, [0],
      )).toEqual([0])
      expect(getFeatureLookupIndices(
        reader, 0, 0, 20, new Set(['kern']), null, null, 2, variations, null,
      )).toEqual([0])
    })

    it('should reject unsupported FeatureVariations versions', () => {
      const { buf, featureVariationsOffset } = buildUniversalFeatureVariations()
      new DataView(buf).setUint16(featureVariationsOffset, 2)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2)).toThrow(
        'Unsupported FeatureVariations version: 2.0',
      )
    })

    it('should reject FeatureTableSubstitution records that are not sorted by featureIndex', () => {
      const { buf, featureVariationsOffset } = buildUniversalFeatureVariations()
      const view = new DataView(buf)
      const substitutionStart = featureVariationsOffset + 16
      view.setUint16(substitutionStart + 4, 2)
      view.setUint16(substitutionStart + 6, 0)
      view.setUint32(substitutionStart + 8, 18)
      view.setUint16(substitutionStart + 12, 0)
      view.setUint32(substitutionStart + 14, 18)
      writeFeatureTable(view, substitutionStart + 18, 1)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2)).toThrow(
        'FeatureTableSubstitution record 1 is not in strictly increasing featureIndex order',
      )
    })

    it('should reject FeatureVariation conditions with inverted ranges', () => {
      const { buf, featureVariationsOffset } = buildConditionalFeatureVariations(0.75, 0.5)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2, 1)).toThrow(
        'FeatureVariation Condition 0 has minValue greater than maxValue',
      )
    })

    it('should reject conditional FeatureVariations without fvar axis context', () => {
      const { buf, featureVariationsOffset } = buildConditionalFeatureVariations(0.5, 1)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2)).toThrow(
        "FeatureVariation Condition 0 requires table 'fvar'",
      )
    })

    it('should reject FeatureVariation conditions with axisIndex outside fvar axes', () => {
      const { buf, featureVariationsOffset } = buildConditionalFeatureVariations(0.5, 1)
      const conditionStart = featureVariationsOffset + 16 + 6
      new DataView(buf).setUint16(conditionStart + 2, 1)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2, 1)).toThrow(
        'FeatureVariation Condition 0 axisIndex 1 out of fvar axis range 1',
      )
    })

    it('should reject FeatureVariation record offsets inside the record array', () => {
      const { buf, featureVariationsOffset } = buildUniversalFeatureVariations()
      new DataView(buf).setUint32(featureVariationsOffset + 12, 8)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2)).toThrow(
        'FeatureVariationRecord 0 featureTableSubstitutionOffset must be at least 16, got 8',
      )
    })

    it('should reject ConditionSet condition offsets inside the offset array', () => {
      const { buf, featureVariationsOffset } = buildConditionalFeatureVariations(0.5, 1)
      const conditionSetStart = featureVariationsOffset + 16
      new DataView(buf).setUint32(conditionSetStart + 2, 2)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2, 1)).toThrow(
        'FeatureVariation ConditionSet conditionOffset 0 must be at least 6, got 2',
      )
    })

    it('should reject FeatureTableSubstitution alternate Feature offsets inside the record array', () => {
      const { buf, featureVariationsOffset } = buildUniversalFeatureVariations()
      const substitutionStart = featureVariationsOffset + 16
      new DataView(buf).setUint32(substitutionStart + 8, 6)

      expect(() => parseFeatureVariations(new BinaryReader(buf), featureVariationsOffset, 1, 2)).toThrow(
        'FeatureTableSubstitution record 0 alternateFeatureOffset must be at least 12, got 6',
      )
    })
  })

  describe('GSUB Script/Feature traversal', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)

    it('should find liga feature lookup indices', () => {
      const reader = getTableReader(sfnt, 'GSUB')
      if (!reader) return

      const tableStart = reader.position
      reader.readUint16() // majorVersion
      reader.readUint16() // minorVersion
      const scriptListOffset = reader.readUint16()
      const featureListOffset = reader.readUint16()

      const indices = getFeatureLookupIndices(
        reader, tableStart, scriptListOffset, featureListOffset,
        new Set(['liga']),
      )
      // NotoSans may have liga lookups
      expect(indices).toBeDefined()
    })
  })

  describe('Lookup List parsing', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)

    it('should parse GPOS lookups', () => {
      const reader = getTableReader(sfnt, 'GPOS')
      if (!reader) return

      const tableStart = reader.position
      reader.readUint16() // majorVersion
      reader.readUint16() // minorVersion
      reader.readUint16() // scriptListOffset
      reader.readUint16() // featureListOffset
      const lookupListOffset = reader.readUint16()

      const lookups = parseLookupList(reader, tableStart, lookupListOffset)
      expect(lookups.length).toBeGreaterThan(0)

      for (const lookup of lookups) {
        expect(lookup.type).toBeGreaterThan(0)
        expect(lookup.subtableOffsets.length).toBeGreaterThan(0)
      }
    })

    it('should reject reserved LookupFlag bits', () => {
      // Lookup list at offset 2 (offset 0 would mean "no lookup list").
      const buf = uint16Buffer([
        0,
        1,
        4,
        1,
        0x0020,
        1,
        10,
      ])

      expect(() => parseLookupList(new BinaryReader(buf), 0, 2)).toThrow(
        'Unsupported LookupFlag reserved bits: 0x0020',
      )
    })

    it('treats a zero lookup-list offset as an absent (empty) lookup list', () => {
      const buf = uint16Buffer([1, 4, 1, 0x0020, 1, 10])
      expect(parseLookupList(new BinaryReader(buf), 0, 0)).toEqual([])
    })

    it('should reject direct Feature lookup indices outside the LookupList', () => {
      const buf = buildScriptFeatureTable(0, 0xFFFF, [0], 1, [1])

      expect(() => getDirectFeatureLookupIndices(new BinaryReader(buf), 0, 20, 'kern', 1)).toThrow(
        'Feature lookup index 1 out of LookupList range 1',
      )
    })
  })
})
