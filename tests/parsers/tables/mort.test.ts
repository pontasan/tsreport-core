import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseMort } from '../../../src/parsers/tables/mort.js'

interface MortFeatureEntry {
  featureType: number
  featureSetting: number
  enableFlags: number
  disableFlags: number
}

/**
 * Build a mort table with a Type 4 (noncontextual) subtable
 * using AAT Lookup format 8 (trimmed array)
 */
function buildMortType4(
  replacements: { firstGlyph: number, values: number[] },
  defaultFlags = 0xFFFFFFFF,
  features: MortFeatureEntry[] = [],
  subFeatureFlags = defaultFlags,
): ArrayBuffer {
  // mort header: version(4=Fixed) + nChains(4) = 8
  // Chain: defaultFlags(4) + chainLength(4) + nFeatureEntries(2) + nSubtables(2) = 12
  // Subtable: length(2) + coverage(1) + type(1) + subFeatureFlags(4) = 8
  // Lookup (format 8): format(2) + firstGlyph(2) + glyphCount(2) + values(2 each)

  const lookupSize = 6 + replacements.values.length * 2
  const subtableSize = 8 + lookupSize
  const chainSize = 12 + features.length * 12 + subtableSize
  const totalSize = 8 + chainSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // mort header
  view.setUint32(pos, 0x00010000); pos += 4 // version 1.0 (Fixed)
  view.setUint32(pos, 1); pos += 4 // nChains

  // Chain header
  view.setUint32(pos, defaultFlags); pos += 4
  view.setUint32(pos, chainSize); pos += 4
  view.setUint16(pos, features.length); pos += 2 // nFeatureEntries
  view.setUint16(pos, 1); pos += 2 // nSubtables

  for (const feature of features) {
    view.setUint16(pos, feature.featureType); pos += 2
    view.setUint16(pos, feature.featureSetting); pos += 2
    view.setUint32(pos, feature.enableFlags); pos += 4
    view.setUint32(pos, feature.disableFlags); pos += 4
  }

  // Subtable header
  view.setUint16(pos, subtableSize); pos += 2 // length
  view.setUint8(pos++, 0) // coverage
  view.setUint8(pos++, 4) // type = 4 (noncontextual)
  view.setUint32(pos, subFeatureFlags); pos += 4 // subFeatureFlags

  // AAT Lookup (format 8)
  view.setUint16(pos, 8); pos += 2
  view.setUint16(pos, replacements.firstGlyph); pos += 2
  view.setUint16(pos, replacements.values.length); pos += 2
  for (const v of replacements.values) {
    view.setUint16(pos, v); pos += 2
  }

  return buf
}

function buildMortStateSubtable(type: number, data: ArrayBuffer): ArrayBuffer {
  const subtableSize = (8 + data.byteLength + 3) & ~3
  const chainSize = 12 + subtableSize
  const buffer = new ArrayBuffer(8 + chainSize)
  const view = new DataView(buffer)
  view.setUint32(0, 0x00010000)
  view.setUint32(4, 1)
  view.setUint32(8, 1)
  view.setUint32(12, chainSize)
  view.setUint16(16, 0)
  view.setUint16(18, 1)
  view.setUint16(20, subtableSize)
  view.setUint16(22, type)
  view.setUint32(24, 1)
  new Uint8Array(buffer, 28, data.byteLength).set(new Uint8Array(data))
  return buffer
}

function writeMortClasses(view: DataView, offset: number): void {
  view.setUint16(offset, 10)
  view.setUint16(offset + 2, 11)
  const classes = [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5]
  for (let i = 0; i < classes.length; i++) view.setUint8(offset + 4 + i, classes[i]!)
}

function writeMortStateRows(view: DataView, offset: number): void {
  const rows = [
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1, 2],
  ]
  let position = offset
  for (const row of rows) for (const entry of row) view.setUint8(position++, entry)
}

function buildMortType1Contextual(): ArrayBuffer {
  const data = new ArrayBuffer(64)
  const view = new DataView(data)
  view.setUint16(0, 6)
  view.setUint16(2, 10)
  view.setUint16(4, 26)
  view.setUint16(6, 38)
  view.setUint16(8, 62)
  writeMortClasses(view, 10)
  writeMortStateRows(view, 26)
  const entries = [
    [26, 0, 0xFFFF, 0xFFFF],
    [32, 0x8000, 0xFFFF, 0xFFFF],
    [26, 0, 21, 0xFFFF],
  ]
  let position = 38
  for (const [newState, flags, marked, current] of entries) {
    view.setUint16(position, newState!)
    view.setUint16(position + 2, flags!)
    view.setUint16(position + 4, marked!)
    view.setUint16(position + 6, current!)
    position += 8
  }
  view.setUint16(62, 100)
  return buildMortStateSubtable(1, data)
}

function buildMortType2Ligature(): ArrayBuffer {
  const data = new ArrayBuffer(72)
  const view = new DataView(data)
  view.setUint16(0, 6)
  view.setUint16(2, 14)
  view.setUint16(4, 30)
  view.setUint16(6, 42)
  view.setUint16(8, 56)
  view.setUint16(10, 64)
  view.setUint16(12, 68)
  writeMortClasses(view, 14)
  writeMortStateRows(view, 30)
  const entries = [
    [30, 0],
    [36, 0x8000],
    [30, 0x8000 | 56],
  ]
  let position = 42
  for (const [newState, flags] of entries) {
    view.setUint16(position, newState!)
    view.setUint16(position + 2, flags!)
    position += 4
  }
  view.setUint32(56, 12)
  view.setUint32(60, 0xC0000000 | 23)
  view.setUint16(64, 30)
  view.setUint16(66, 38)
  view.setUint16(68, 100)
  return buildMortStateSubtable(2, data)
}

function buildMortType5Insertion(): ArrayBuffer {
  const data = new ArrayBuffer(64)
  const view = new DataView(data)
  view.setUint16(0, 6)
  view.setUint16(2, 8)
  view.setUint16(4, 24)
  view.setUint16(6, 36)
  writeMortClasses(view, 8)
  writeMortStateRows(view, 24)
  const entries = [
    [24, 0, 0, 0],
    [30, 0x8000, 0, 0],
    [24, 0x0401, 0, 60],
  ]
  let position = 36
  for (const [newState, flags, current, marked] of entries) {
    view.setUint16(position, newState!)
    view.setUint16(position + 2, flags!)
    view.setUint16(position + 4, current!)
    view.setUint16(position + 6, marked!)
    position += 8
  }
  view.setUint16(60, 99)
  return buildMortStateSubtable(5, data)
}

describe('mort table parser', () => {
  describe('state-machine substitutions', () => {
    it('executes classic contextual per-glyph substitution offsets', () => {
      const table = parseMort(new BinaryReader(buildMortType1Contextual()))
      expect(table.applySubstitutions([10, 20])).toEqual([100, 20])
      expect(table.applySubstitutions([10, 10])).toEqual([10, 10])
    })

    it('executes classic ligature action and component offsets', () => {
      const table = parseMort(new BinaryReader(buildMortType2Ligature()))
      const result = table.applySubstitutionsTracked({ glyphs: [10, 20], clusters: [3, 4], flags: [8, 0] })
      expect(result.glyphs).toEqual([100])
      expect(result.clusters).toEqual([3])
      expect(result.glyphsWithDeletions).toEqual([100, 0xFFFF])
      expect(result.flags).toEqual([8])
    })

    it('executes marked split-vowel insertion with source association', () => {
      const table = parseMort(new BinaryReader(buildMortType5Insertion()))
      const result = table.applySubstitutionsTracked({ glyphs: [10, 20], clusters: [0, 1], flags: [8, 0] })
      expect(result.glyphs).toEqual([99, 10, 20])
      expect(result.clusters).toEqual([1, 0, 1])
      expect(result.flags).toEqual([8, 8, 0])
    })

    it('enumerates contextual, ligature, and insertion output glyphs for subsetting', () => {
      expect(parseMort(new BinaryReader(buildMortType1Contextual()), 200).referencedGlyphIds).toEqual([100])
      expect(parseMort(new BinaryReader(buildMortType2Ligature()), 200).referencedGlyphIds).toEqual([100])
      expect(parseMort(new BinaryReader(buildMortType5Insertion()), 200).referencedGlyphIds).toEqual([99])
    })
  })

  describe('Type 4 (noncontextual substitution)', () => {
    it('should perform simple glyph substitution', () => {
      const buf = buildMortType4({ firstGlyph: 10, values: [100, 101, 102] })
      const table = parseMort(new BinaryReader(buf))

      expect(table.chains).toHaveLength(1)
      const result = table.applySubstitutions([10, 11, 12, 5])
      expect(result).toEqual([100, 101, 102, 5])
    })

    it('should leave unmapped glyphs unchanged', () => {
      const buf = buildMortType4({ firstGlyph: 10, values: [100] })
      const table = parseMort(new BinaryReader(buf))

      const result = table.applySubstitutions([5, 10, 15])
      expect(result).toEqual([5, 100, 15])
    })

    it('should handle empty input', () => {
      const buf = buildMortType4({ firstGlyph: 10, values: [100] })
      const table = parseMort(new BinaryReader(buf))

      const result = table.applySubstitutions([])
      expect(result).toEqual([])
    })

    it('should apply feature entries selected by feature type and setting', () => {
      const buf = buildMortType4(
        { firstGlyph: 10, values: [100] },
        0x00000000,
        [{ featureType: 1, featureSetting: 2, enableFlags: 0x00000001, disableFlags: 0xFFFFFFFF }],
        0x00000001,
      )
      const table = parseMort(new BinaryReader(buf))

      expect(table.applySubstitutions([10])).toEqual([10])
      expect(table.applySubstitutions([10], [{ featureType: 1, featureSetting: 2 }])).toEqual([100])
    })

    it('should disable subfeatures through selected feature entries', () => {
      const buf = buildMortType4(
        { firstGlyph: 10, values: [100] },
        0x00000001,
        [{ featureType: 1, featureSetting: 3, enableFlags: 0x00000000, disableFlags: 0xFFFFFFFE }],
        0x00000001,
      )
      const table = parseMort(new BinaryReader(buf))

      expect(table.applySubstitutions([10])).toEqual([100])
      expect(table.applySubstitutions([10], [{ featureType: 1, featureSetting: 3 }])).toEqual([10])
    })

    it('should apply matching feature entries in font-table order', () => {
      const table = parseMort(new BinaryReader(buildMortType4(
        { firstGlyph: 10, values: [100] },
        0,
        [
          { featureType: 1, featureSetting: 1, enableFlags: 1, disableFlags: 0xFFFFFFFF },
          { featureType: 2, featureSetting: 1, enableFlags: 0, disableFlags: 0xFFFFFFFE },
        ],
        1,
      )))

      expect(table.applySubstitutions([10], [
        { featureType: 2, featureSetting: 1 },
        { featureType: 1, featureSetting: 1 },
      ])).toEqual([10])
    })
  })

  describe('Table structure', () => {
    it('should parse chain metadata', () => {
      const buf = buildMortType4({ firstGlyph: 10, values: [100] })
      const table = parseMort(new BinaryReader(buf))

      expect(table.chains).toHaveLength(1)
      expect(table.chains[0]!.subtables).toHaveLength(1)
      expect(table.chains[0]!.subtables[0]!.type).toBe(4)
    })

    it('should parse features', () => {
      const lookupSize = 6 + 1 * 2
      const subtableSize = 8 + lookupSize
      const featureSize = 12
      const chainSize = 12 + 1 * featureSize + subtableSize
      const totalSize = 8 + chainSize

      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      // mort header
      view.setUint32(pos, 0x00010000); pos += 4
      view.setUint32(pos, 1); pos += 4

      // Chain
      view.setUint32(pos, 0x00000001); pos += 4
      view.setUint32(pos, chainSize); pos += 4
      view.setUint16(pos, 1); pos += 2 // 1 feature
      view.setUint16(pos, 1); pos += 2 // 1 subtable

      // Feature
      view.setUint16(pos, 3); pos += 2 // featureType
      view.setUint16(pos, 1); pos += 2 // featureSetting
      view.setUint32(pos, 0x00000001); pos += 4 // enableFlags
      view.setUint32(pos, 0xFFFFFFFE); pos += 4 // disableFlags

      // Subtable
      view.setUint16(pos, subtableSize); pos += 2
      view.setUint8(pos++, 0) // coverage
      view.setUint8(pos++, 4) // type 4
      view.setUint32(pos, 0x00000001); pos += 4 // subFeatureFlags

      // Lookup
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 100); pos += 2

      const table = parseMort(new BinaryReader(buf))
      expect(table.chains[0]!.features).toHaveLength(1)
      expect(table.chains[0]!.features[0]!.featureType).toBe(3)

      const result = table.applySubstitutions([10])
      expect(result).toEqual([100])
    })

    it('should handle multiple chains', () => {
      // Two chains: first maps 10→100, second maps 100→200
      const lookup1Size = 6 + 1 * 2
      const lookup2Size = 6 + 1 * 2
      const subtable1Size = 8 + lookup1Size
      const subtable2Size = 8 + lookup2Size
      const chain1Size = 12 + subtable1Size
      const chain2Size = 12 + subtable2Size
      const totalSize = 8 + chain1Size + chain2Size

      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      // mort header
      view.setUint32(pos, 0x00010000); pos += 4
      view.setUint32(pos, 2); pos += 4 // 2 chains

      // Chain 1
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      view.setUint32(pos, chain1Size); pos += 4
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 1); pos += 2
      // Subtable 1
      view.setUint16(pos, subtable1Size); pos += 2
      view.setUint8(pos++, 0)
      view.setUint8(pos++, 4)
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 100); pos += 2

      // Chain 2
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      view.setUint32(pos, chain2Size); pos += 4
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 1); pos += 2
      // Subtable 2
      view.setUint16(pos, subtable2Size); pos += 2
      view.setUint8(pos++, 0)
      view.setUint8(pos++, 4)
      view.setUint32(pos, 0xFFFFFFFF); pos += 4
      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 100); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 200); pos += 2

      const table = parseMort(new BinaryReader(buf))
      expect(table.chains).toHaveLength(2)

      // 10 → 100 → 200
      const result = table.applySubstitutions([10, 50])
      expect(result).toEqual([200, 50])
    })

    it('should not apply subtable when flags do not match', () => {
      // defaultFlags = 0x01, subFeatureFlags = 0x02 → no match
      const lookupSize = 6 + 1 * 2
      const subtableSize = 8 + lookupSize
      const chainSize = 12 + subtableSize
      const totalSize = 8 + chainSize

      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)
      let pos = 0

      view.setUint32(pos, 0x00010000); pos += 4
      view.setUint32(pos, 1); pos += 4

      view.setUint32(pos, 0x00000001); pos += 4 // defaultFlags
      view.setUint32(pos, chainSize); pos += 4
      view.setUint16(pos, 0); pos += 2
      view.setUint16(pos, 1); pos += 2

      view.setUint16(pos, subtableSize); pos += 2
      view.setUint8(pos++, 0)
      view.setUint8(pos++, 4)
      view.setUint32(pos, 0x00000002); pos += 4 // subFeatureFlags doesn't match defaultFlags

      view.setUint16(pos, 8); pos += 2
      view.setUint16(pos, 10); pos += 2
      view.setUint16(pos, 1); pos += 2
      view.setUint16(pos, 100); pos += 2

      const table = parseMort(new BinaryReader(buf))
      const result = table.applySubstitutions([10])
      expect(result).toEqual([10]) // Not substituted because flags don't match
    })

    it('should reject malformed table headers', () => {
      const unsupportedVersion = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(unsupportedVersion).setUint32(0, 0x00020000)

      const noChains = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(noChains).setUint32(4, 0)

      expect(() => parseMort(new BinaryReader(new ArrayBuffer(7)))).toThrow(/length/)
      expect(() => parseMort(new BinaryReader(unsupportedVersion))).toThrow(/Unsupported mort/)
      expect(() => parseMort(new BinaryReader(noChains))).toThrow(/at least one chain/)
    })

    it('should reject malformed chains', () => {
      const shortChain = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(shortChain).setUint32(12, 8)

      const unalignedChain = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(unalignedChain).setUint32(12, 14)

      const chainOverflow = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(chainOverflow).setUint32(12, chainOverflow.byteLength)

      const featureOverflow = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(featureOverflow).setUint16(16, 3)

      expect(() => parseMort(new BinaryReader(shortChain))).toThrow(/chain 0 length/)
      expect(() => parseMort(new BinaryReader(unalignedChain))).toThrow(/multiple of 4/)
      expect(() => parseMort(new BinaryReader(chainOverflow))).toThrow(/exceeds table length/)
      expect(() => parseMort(new BinaryReader(featureOverflow))).toThrow(/feature array/)
    })

    it('should reject malformed subtables', () => {
      const shortSubtable = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(shortSubtable).setUint16(20, 6)

      const unalignedSubtable = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(unalignedSubtable).setUint16(20, 10)

      const subtableOverflow = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(subtableOverflow).setUint16(20, 20)

      const reservedCoverage = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(reservedCoverage).setUint16(22, 0x000C)

      const reservedType = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(reservedType).setUint16(22, 0x0003)

      const unsupportedType = buildMortType4({ firstGlyph: 10, values: [100] })
      new DataView(unsupportedType).setUint16(22, 0x0006)

      expect(() => parseMort(new BinaryReader(shortSubtable))).toThrow(/subtable 0 length/)
      expect(() => parseMort(new BinaryReader(unalignedSubtable))).toThrow(/multiple of 4/)
      expect(() => parseMort(new BinaryReader(subtableOverflow))).toThrow(/subtable 0 exceeds/)
      expect(() => parseMort(new BinaryReader(reservedCoverage))).toThrow(/coverage reserved/)
      expect(() => parseMort(new BinaryReader(reservedType))).toThrow(/Unsupported mort subtable type/)
      expect(() => parseMort(new BinaryReader(unsupportedType))).toThrow(/Unsupported mort subtable type/)
    })
  })
})
