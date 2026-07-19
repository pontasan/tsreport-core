import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseFeat } from '../../../src/parsers/tables/feat.js'

/**
 * Builds a synthetic AAT feat table binary.
 */
function buildFeatTable(
  features: { featureType: number, nameIndex: number, selectors: { value: number, nameIndex: number }[], featureFlags?: number }[],
): ArrayBuffer {
  // Header: version(4=Fixed) + featureNameCount(2) + reserved1(2) + reserved2(4) = 12
  // Per feature: featureType(2) + nSettings(2) + settingTableOffset(4) + featureFlags(2) + nameIndex(2) = 12
  // Per selector: selectorValue(2) + nameIndex(2) = 4

  const headerSize = 12
  const featureHeaderSize = 12
  const selectorSize = 4

  const featureHeadersSize = features.length * featureHeaderSize
  let totalSelectorsSize = 0
  for (let i = 0; i < features.length; i++) {
    totalSelectorsSize += features[i]!.selectors.length * selectorSize
  }

  const totalSize = headerSize + featureHeadersSize + totalSelectorsSize
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint32(pos, 0x00010000); pos += 4 // version 1.0 (Fixed)
  view.setUint16(pos, features.length); pos += 2 // featureNameCount
  view.setUint16(pos, 0); pos += 2 // reserved1
  view.setUint32(pos, 0); pos += 4 // reserved2

  // Feature headers — compute selector offsets
  let selectorOffset = headerSize + featureHeadersSize
  for (let i = 0; i < features.length; i++) {
    const f = features[i]!
    view.setUint16(pos, f.featureType); pos += 2
    view.setUint16(pos, f.selectors.length); pos += 2
    view.setUint32(pos, selectorOffset); pos += 4
    view.setUint16(pos, f.featureFlags ?? 0); pos += 2
    view.setUint16(pos, f.nameIndex); pos += 2
    selectorOffset += f.selectors.length * selectorSize
  }

  // Selectors
  for (let i = 0; i < features.length; i++) {
    const f = features[i]!
    for (let j = 0; j < f.selectors.length; j++) {
      const s = f.selectors[j]!
      view.setUint16(pos, s.value); pos += 2
      view.setUint16(pos, s.nameIndex); pos += 2
    }
  }

  return buf
}

describe('feat table parser', () => {
  // Verifies that a FeatureName record and its settings are parsed with featureType, nameIndex, and selector value/name pairs intact.
  it('should parse a feat table with a single feature', () => {
    const buf = buildFeatTable([
      {
        featureType: 1, // kLigaturesType
        nameIndex: 256,
        selectors: [
          { value: 0, nameIndex: 257 }, // off
          { value: 2, nameIndex: 258 }, // on
        ],
      },
    ])

    const table = parseFeat(new BinaryReader(buf))
    expect(table.features).toHaveLength(1)
    expect(table.features[0]!.featureType).toBe(1)
    expect(table.features[0]!.nameIndex).toBe(256)
    expect(table.features[0]!.selectors).toHaveLength(2)
    expect(table.features[0]!.selectors[0]!.selectorValue).toBe(0)
    expect(table.features[0]!.selectors[0]!.nameIndex).toBe(257)
    expect(table.features[0]!.selectors[1]!.selectorValue).toBe(2)
    expect(table.features[0]!.selectors[1]!.nameIndex).toBe(258)
  })

  // Verifies that getFeature looks up feature records by their AAT feature type.
  it('should return feature by type via getFeature()', () => {
    const buf = buildFeatTable([
      { featureType: 1, nameIndex: 256, selectors: [{ value: 0, nameIndex: 258 }] },
      { featureType: 3, nameIndex: 257, selectors: [{ value: 1, nameIndex: 259 }], featureFlags: 0x8000 },
    ])

    const table = parseFeat(new BinaryReader(buf))
    const f1 = table.getFeature(1)
    expect(f1).not.toBeNull()
    expect(f1!.featureType).toBe(1)
    expect(f1!.nameIndex).toBe(256)

    const f3 = table.getFeature(3)
    expect(f3).not.toBeNull()
    expect(f3!.featureType).toBe(3)
    expect(f3!.nameIndex).toBe(257)
  })

  // Verifies that getFeature returns null for a feature type not present in the table.
  it('should return null for unknown feature type', () => {
    const buf = buildFeatTable([
      { featureType: 1, nameIndex: 256, selectors: [] },
    ])

    const table = parseFeat(new BinaryReader(buf))
    expect(table.getFeature(99)).toBeNull()
  })

  // Verifies that per-feature settingTableOffsets are honored so each feature gets its own selector list.
  it('should parse multiple features with multiple selectors', () => {
    const buf = buildFeatTable([
      {
        featureType: 1, nameIndex: 256,
        selectors: [
          { value: 0, nameIndex: 257 },
          { value: 2, nameIndex: 258 },
          { value: 4, nameIndex: 259 },
        ],
      },
      {
        featureType: 6, nameIndex: 260,
        featureFlags: 0x8000,
        selectors: [
          { value: 0, nameIndex: 261 },
          { value: 1, nameIndex: 262 },
        ],
      },
    ])

    const table = parseFeat(new BinaryReader(buf))
    expect(table.features).toHaveLength(2)
    expect(table.features[0]!.selectors).toHaveLength(3)
    expect(table.features[1]!.selectors).toHaveLength(2)
    expect(table.features[1]!.selectors[1]!.selectorValue).toBe(1)
  })

  // Verifies that featureNameCount=0 parses to an empty feature list and lookups return null.
  it('should handle empty features list', () => {
    const buf = buildFeatTable([])
    const table = parseFeat(new BinaryReader(buf))
    expect(table.features).toHaveLength(0)
    expect(table.getFeature(0)).toBeNull()
  })

  // Verifies that the feat table version is fixed to 1.0.
  it('rejects unsupported versions', () => {
    const buf = buildFeatTable([])
    new DataView(buf).setUint32(0, 0x00020000)

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('Unsupported feat table version')
  })

  // Verifies that the reserved header fields must be zero.
  it('rejects non-zero reserved header fields', () => {
    const buf = buildFeatTable([])
    new DataView(buf).setUint16(6, 1)

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('feat reserved field 1 must be zero')
  })

  // Verifies that FeatureName records are sorted by feature type.
  it('rejects unsorted feature records', () => {
    const buf = buildFeatTable([
      { featureType: 3, nameIndex: 256, selectors: [{ value: 0, nameIndex: 258 }] },
      { featureType: 1, nameIndex: 257, selectors: [{ value: 0, nameIndex: 259 }] },
    ])

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('feat feature records must be sorted by feature type')
  })

  // Verifies the Apple name-index range used by feature and setting names.
  it('rejects out-of-range name indices', () => {
    const buf = buildFeatTable([
      { featureType: 1, nameIndex: 255, selectors: [{ value: 0, nameIndex: 256 }] },
    ])

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('nameIndex must be greater than 255 and less than 32768')
  })

  // Verifies that reserved featureFlags bits are rejected.
  it('rejects reserved feature flag bits', () => {
    const buf = buildFeatTable([
      { featureType: 1, nameIndex: 256, featureFlags: 0x0100, selectors: [{ value: 0, nameIndex: 257 }] },
    ])

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('reserved featureFlags bits must be zero')
  })

  // Verifies explicit default indexes are valid for exclusive features.
  it('rejects invalid explicit default setting indexes', () => {
    const buf = buildFeatTable([
      { featureType: 6, nameIndex: 256, featureFlags: 0xC002, selectors: [{ value: 0, nameIndex: 257 }] },
    ])

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('default setting index 2 exceeds setting count 1')
  })

  // Verifies feature type 39 language settings must be exclusive.
  it('rejects non-exclusive language-specific feature type 39', () => {
    const buf = buildFeatTable([
      { featureType: 39, nameIndex: 256, selectors: [{ value: 0, nameIndex: 257 }] },
    ])

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('feat language-specific feature type 39 must be exclusive')
  })

  // Verifies non-exclusive features list only even on-selectors.
  it('accepts odd non-exclusive selector values (on/off pairs)', () => {
    // A non-exclusive feature lists on (even) and off (odd) selectors; shipping
    // fonts rely on the odd "off" values, so they must parse rather than throw.
    const buf = buildFeatTable([
      { featureType: 1, nameIndex: 256, selectors: [{ value: 0, nameIndex: 257 }, { value: 1, nameIndex: 258 }] },
    ])
    const feat = parseFeat(new BinaryReader(buf))
    expect(feat.features[0]!.selectors.map(s => s.selectorValue)).toEqual([0, 1])
  })

  // Verifies each setting name array is sorted by setting value.
  it('rejects unsorted selector records', () => {
    const buf = buildFeatTable([
      { featureType: 6, nameIndex: 256, featureFlags: 0x8000, selectors: [
        { value: 2, nameIndex: 257 },
        { value: 1, nameIndex: 258 },
      ] },
    ])

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('settings must be sorted by selector value')
  })

  // Verifies settingTable offsets cannot overlap the feature name array.
  it('rejects setting arrays that overlap feature records', () => {
    const buf = buildFeatTable([
      { featureType: 1, nameIndex: 256, selectors: [{ value: 0, nameIndex: 257 }] },
    ])
    new DataView(buf).setUint32(16, 12)

    expect(() => parseFeat(new BinaryReader(buf))).toThrow('settingTable overlaps feature name array')
  })

  // Verifies truncated setting-name arrays are malformed rather than silently omitted.
  it('rejects setting arrays that extend beyond the table', () => {
    const full = buildFeatTable([
      { featureType: 1, nameIndex: 256, selectors: [{ value: 0, nameIndex: 257 }] },
    ])
    const truncated = full.slice(0, full.byteLength - 1)

    expect(() => parseFeat(new BinaryReader(truncated))).toThrow('setting name array exceeds feat table length')
  })
})
