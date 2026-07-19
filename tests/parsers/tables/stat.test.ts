import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseStat } from '../../../src/parsers/tables/stat.js'

/**
 * STAT table regression tests.
 * Builds synthetic tables covering AxisRecords and AxisValue formats 1/2/3/4.
 */

function writeFixed(w: BinaryWriter, value: number): void {
  w.writeInt32(Math.round(value * 65536))
}

interface AxisRecord {
  tag: string
  nameId: number
  ordering: number
}

type AxisValueSpec =
  | { format: 1, axisIndex: number, flags: number, valueNameId: number, value: number }
  | { format: 2, axisIndex: number, flags: number, valueNameId: number, value: number, rangeMinValue: number, rangeMaxValue: number }
  | { format: 3, axisIndex: number, flags: number, valueNameId: number, value: number, linkedValue: number }
  | { format: 4, flags: number, valueNameId: number, axisValues: { axisIndex: number, value: number }[] }

function encodeAxisValue(spec: AxisValueSpec): Uint8Array {
  const w = new BinaryWriter()
  w.writeUint16(spec.format)
  if (spec.format === 4) {
    w.writeUint16(spec.axisValues.length) // axisCount
    w.writeUint16(spec.flags)
    w.writeUint16(spec.valueNameId)
    for (const av of spec.axisValues) {
      w.writeUint16(av.axisIndex)
      writeFixed(w, av.value)
    }
  } else {
    w.writeUint16(spec.axisIndex)
    w.writeUint16(spec.flags)
    w.writeUint16(spec.valueNameId)
    writeFixed(w, spec.value)
    if (spec.format === 2) {
      writeFixed(w, spec.rangeMinValue)
      writeFixed(w, spec.rangeMaxValue)
    } else if (spec.format === 3) {
      writeFixed(w, spec.linkedValue)
    }
  }
  return w.toUint8Array().slice()
}

function buildStat(opts: {
  minorVersion: number
  axes: AxisRecord[]
  axisValues: AxisValueSpec[]
  elidedFallbackNameId?: number
}): ArrayBuffer {
  const { minorVersion, axes, axisValues, elidedFallbackNameId } = opts
  const headerSize = minorVersion >= 1 ? 20 : 18
  const designAxesOffset = headerSize
  const axisValueArrayOffset = axisValues.length > 0
    ? designAxesOffset + axes.length * 8
    : 0

  const encodedValues = axisValues.map(encodeAxisValue)

  const w = new BinaryWriter()
  w.writeUint16(1) // majorVersion
  w.writeUint16(minorVersion)
  w.writeUint16(8) // designAxisSize
  w.writeUint16(axes.length) // designAxisCount
  w.writeUint32(designAxesOffset)
  w.writeUint16(axisValues.length) // axisValueCount
  w.writeUint32(axisValueArrayOffset)
  if (minorVersion >= 1) {
    w.writeUint16(elidedFallbackNameId ?? 2)
  }

  // Design axes (8 bytes each)
  for (const axis of axes) {
    w.writeTag(axis.tag)
    w.writeUint16(axis.nameId)
    w.writeUint16(axis.ordering)
  }

  // Axis value offsets array (relative to axisValueArrayOffset), then the values
  if (axisValues.length > 0) {
    let offset = axisValues.length * 2
    for (const encoded of encodedValues) {
      w.writeUint16(offset)
      offset += encoded.length
    }
    for (const encoded of encodedValues) {
      w.writeBytes(encoded)
    }
  }

  return w.toArrayBuffer()
}

describe('STAT table parser', () => {
  describe('version 1.2 with all axis value formats', () => {
    const buffer = buildStat({
      minorVersion: 2,
      elidedFallbackNameId: 2,
      axes: [
        { tag: 'wght', nameId: 256, ordering: 0 },
        { tag: 'wdth', nameId: 257, ordering: 1 },
      ],
      axisValues: [
        { format: 1, axisIndex: 0, flags: 0, valueNameId: 260, value: 400.5 },
        { format: 2, axisIndex: 1, flags: 0x0002, valueNameId: 261, value: 100, rangeMinValue: 75.5, rangeMaxValue: 125.25 },
        { format: 3, axisIndex: 0, flags: 0x0001, valueNameId: 262, value: 400, linkedValue: 700 },
        { format: 4, flags: 0, valueNameId: 263, axisValues: [{ axisIndex: 1, value: 87.5 }, { axisIndex: 0, value: 300 }] },
      ],
    })
    const stat = parseStat(new BinaryReader(buffer))

    // Verifies the header fields including the version 1.1+ elidedFallbackNameId.
    it('parses the header', () => {
      expect(stat.majorVersion).toBe(1)
      expect(stat.minorVersion).toBe(2)
      expect(stat.designAxisCount).toBe(2)
      expect(stat.elidedFallbackNameId).toBe(2)
    })

    // Verifies AxisRecord tag / nameId / ordering fields.
    it('parses design axis records', () => {
      expect(stat.designAxes).toEqual([
        { tag: 'wght', nameId: 256, ordering: 0 },
        { tag: 'wdth', nameId: 257, ordering: 1 },
      ])
    })

    // Verifies format 1: axisIndex, flags, valueNameId and a Fixed value with a fraction.
    it('parses AxisValue format 1', () => {
      const v = stat.axisValues[0]!
      expect(v.format).toBe(1)
      expect(v.axisIndex).toBe(0)
      expect(v.flags).toBe(0)
      expect(v.valueNameId).toBe(260)
      expect(v.value).toBe(400.5)
      expect(v.linkedValue).toBeUndefined()
      expect(v.rangeMinValue).toBeUndefined()
    })

    // Verifies format 2: nominal value plus range min/max.
    it('parses AxisValue format 2', () => {
      const v = stat.axisValues[1]!
      expect(v.format).toBe(2)
      expect(v.axisIndex).toBe(1)
      expect(v.flags).toBe(0x0002) // ELIDABLE_AXIS_VALUE_NAME
      expect(v.valueNameId).toBe(261)
      expect(v.value).toBe(100)
      expect(v.rangeMinValue).toBe(75.5)
      expect(v.rangeMaxValue).toBe(125.25)
    })

    // Verifies format 3: value plus linkedValue (style linking).
    it('parses AxisValue format 3', () => {
      const v = stat.axisValues[2]!
      expect(v.format).toBe(3)
      expect(v.axisIndex).toBe(0)
      expect(v.flags).toBe(0x0001) // OLDER_SIBLING_FONT_ATTRIBUTE
      expect(v.valueNameId).toBe(262)
      expect(v.value).toBe(400)
      expect(v.linkedValue).toBe(700)
    })

    // Verifies format 4: the parser records the full AxisValueRecord combination.
    it('parses AxisValue format 4', () => {
      const v = stat.axisValues[3]!
      expect(v.format).toBe(4)
      expect(v.valueNameId).toBe(263)
      expect(v.axisIndex).toBe(1)
      expect(v.value).toBe(87.5)
      expect(v.axisValues).toEqual([
        { axisIndex: 1, value: 87.5 },
        { axisIndex: 0, value: 300 },
      ])
    })
  })

  describe('version 1.0 without axis values', () => {
    const buffer = buildStat({
      minorVersion: 0,
      axes: [{ tag: 'ital', nameId: 258, ordering: 0 }],
      axisValues: [],
    })
    const stat = parseStat(new BinaryReader(buffer))

    // Verifies the 18-byte version 1.0 header has no elidedFallbackNameId.
    it('parses a version 1.0 header', () => {
      expect(stat.majorVersion).toBe(1)
      expect(stat.minorVersion).toBe(0)
      expect(stat.elidedFallbackNameId).toBeUndefined()
    })

    // Verifies axisValueArrayOffset = 0 yields an empty axis value list.
    it('handles a zero axisValueArrayOffset', () => {
      expect(stat.designAxes).toEqual([{ tag: 'ital', nameId: 258, ordering: 0 }])
      expect(stat.axisValues).toEqual([])
    })
  })

  describe('strict validation', () => {
    it('rejects unsupported versions', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [],
      })
      new DataView(buffer).setUint16(0, 2)

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'Unsupported STAT version: 2.2',
      )
    })

    it('rejects designAxisSize values smaller than an AxisRecord', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [],
      })
      new DataView(buffer).setUint16(4, 6)

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT designAxisSize must be at least 8, got 6',
      )
    })

    it('rejects STAT design axes fewer than fvar axes', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [],
      })

      expect(() => parseStat(new BinaryReader(buffer), 2)).toThrow(
        'STAT designAxisCount must be at least fvar axis count 2, got 1',
      )
    })

    it('rejects duplicate axis tags', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [
          { tag: 'wght', nameId: 256, ordering: 0 },
          { tag: 'wght', nameId: 257, ordering: 1 },
        ],
        axisValues: [],
      })

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        "STAT axisTag must be unique, got duplicate 'wght'",
      )
    })

    it('rejects axis value offsets inside the offset array', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [{ format: 1, axisIndex: 0, flags: 0, valueNameId: 260, value: 400 }],
      })
      const view = new DataView(buffer)
      const axisValueArrayOffset = view.getUint32(14)
      view.setUint16(axisValueArrayOffset, 0)

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT axis value offset 0 must be at least 2, got 0',
      )
    })

    it('rejects reserved AxisValue flags', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [{ format: 1, axisIndex: 0, flags: 0x0004, valueNameId: 260, value: 400 }],
      })

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT AxisValue table 0 flags contain reserved bits: 0x0004',
      )
    })

    it('rejects axis value indexes outside the design axis array', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [{ format: 1, axisIndex: 1, flags: 0, valueNameId: 260, value: 400 }],
      })

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT AxisValue table 0 axisIndex 1 out of designAxisCount 1',
      )
    })

    it('rejects format 2 ranges that do not include the nominal value', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [{ tag: 'wght', nameId: 256, ordering: 0 }],
        axisValues: [{ format: 2, axisIndex: 0, flags: 0, valueNameId: 260, value: 400, rangeMinValue: 500, rangeMaxValue: 600 }],
      })

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT AxisValue table 0 nominalValue is outside its range',
      )
    })

    it('rejects AxisValue format 4 before STAT version 1.2', () => {
      const buffer = buildStat({
        minorVersion: 1,
        axes: [
          { tag: 'wght', nameId: 256, ordering: 0 },
          { tag: 'wdth', nameId: 257, ordering: 1 },
        ],
        axisValues: [{ format: 4, flags: 0, valueNameId: 260, axisValues: [{ axisIndex: 0, value: 400 }, { axisIndex: 1, value: 100 }] }],
      })

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT AxisValue format 4 requires STAT version 1.2',
      )
    })

    it('rejects duplicate AxisValue format 4 axis indexes', () => {
      const buffer = buildStat({
        minorVersion: 2,
        axes: [
          { tag: 'wght', nameId: 256, ordering: 0 },
          { tag: 'wdth', nameId: 257, ordering: 1 },
        ],
        axisValues: [{ format: 4, flags: 0, valueNameId: 260, axisValues: [{ axisIndex: 0, value: 400 }, { axisIndex: 0, value: 500 }] }],
      })

      expect(() => parseStat(new BinaryReader(buffer))).toThrow(
        'STAT AxisValue format 4 table 0 has duplicate axisIndex 0',
      )
    })
  })
})
