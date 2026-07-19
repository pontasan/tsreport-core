import { BinaryReader } from '../../binary/reader.js'

/**
 * STAT table: Style Attributes Table
 */

export interface StatAxisValue {
  readonly format: number
  readonly axisIndex: number
  readonly flags: number
  readonly valueNameId: number
  readonly value?: number
  readonly linkedValue?: number
  readonly rangeMinValue?: number
  readonly rangeMaxValue?: number
  readonly axisValues?: { axisIndex: number, value: number }[]
}

export interface StatTable {
  readonly majorVersion: number
  readonly minorVersion: number
  readonly designAxisCount: number
  readonly designAxes: { tag: string, nameId: number, ordering: number }[]
  readonly axisValues: StatAxisValue[]
  readonly elidedFallbackNameId?: number
}

export function parseStat(reader: BinaryReader, expectedFvarAxisCount?: number): StatTable {
  const tableStart = reader.position
  ensureStatRange(reader, tableStart, 18, 'STAT header')
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported STAT version: ${majorVersion}.${minorVersion}`)
  }
  const headerSize = minorVersion >= 1 ? 20 : 18
  ensureStatRange(reader, tableStart, headerSize, 'STAT header')
  const designAxisSize = reader.readUint16()
  const designAxisCount = reader.readUint16()
  const designAxesOffset = reader.readUint32()
  const axisValueCount = reader.readUint16()
  const axisValueArrayOffset = reader.readUint32()
  if (designAxisSize < 8) {
    throw new Error(`STAT designAxisSize must be at least 8, got ${designAxisSize}`)
  }
  if (expectedFvarAxisCount !== undefined && designAxisCount < expectedFvarAxisCount) {
    throw new Error(`STAT designAxisCount must be at least fvar axis count ${expectedFvarAxisCount}, got ${designAxisCount}`)
  }
  if (axisValueCount > 0 && designAxisCount === 0) {
    throw new Error('STAT designAxisCount must be greater than zero when axisValueCount is greater than zero')
  }
  if (designAxisCount === 0 && designAxesOffset !== 0) {
    throw new Error(`STAT designAxesOffset must be 0 when designAxisCount is 0, got ${designAxesOffset}`)
  }
  if (designAxisCount > 0 && designAxesOffset === 0) {
    throw new Error('STAT designAxesOffset must be greater than 0 when designAxisCount is greater than 0')
  }
  if (axisValueCount === 0 && axisValueArrayOffset !== 0) {
    throw new Error(`STAT axisValueArrayOffset must be 0 when axisValueCount is 0, got ${axisValueArrayOffset}`)
  }
  if (axisValueCount > 0 && axisValueArrayOffset === 0) {
    throw new Error('STAT axisValueArrayOffset must be greater than 0 when axisValueCount is greater than 0')
  }

  let elidedFallbackNameId: number | undefined
  if (minorVersion >= 1) {
    elidedFallbackNameId = reader.readUint16()
    validateStatNameId(elidedFallbackNameId, 'STAT elidedFallbackNameId')
  }

  // Design Axes
  const designAxes: { tag: string, nameId: number, ordering: number }[] = []
  if (designAxisCount > 0) {
    const designAxesStart = tableStart + designAxesOffset
    ensureStatRange(reader, designAxesStart, designAxisCount * designAxisSize, 'STAT design axes array')
    const tags = new Set<string>()
    for (let i = 0; i < designAxisCount; i++) {
      reader.seek(designAxesStart + i * designAxisSize)
      const tag = reader.readTag()
      if (tags.has(tag)) {
        throw new Error(`STAT axisTag must be unique, got duplicate '${tag}'`)
      }
      tags.add(tag)
      const nameId = reader.readUint16()
      validateStatNameId(nameId, `STAT axis ${i} axisNameID`)
      const ordering = reader.readUint16()
      designAxes.push({ tag, nameId, ordering })
    }
  }

  // Axis Values
  const axisValues: StatAxisValue[] = []
  if (axisValueArrayOffset !== 0 && axisValueCount > 0) {
    const axisValueArrayStart = tableStart + axisValueArrayOffset
    const axisValueOffsetsSize = axisValueCount * 2
    ensureStatRange(reader, axisValueArrayStart, axisValueOffsetsSize, 'STAT axis value offsets array')
    reader.seek(axisValueArrayStart)
    const offsets: number[] = []
    for (let i = 0; i < axisValueCount; i++) {
      const offset = reader.readUint16()
      if (offset < axisValueOffsetsSize) {
        throw new Error(`STAT axis value offset ${i} must be at least ${axisValueOffsetsSize}, got ${offset}`)
      }
      ensureStatRange(reader, axisValueArrayStart + offset, 2, `STAT axis value table ${i}`)
      offsets.push(offset)
    }

    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i]!
      const axisValueStart = axisValueArrayStart + off
      reader.seek(axisValueStart)
      const format = reader.readUint16()
      let axisIndex = 0, flags = 0, valueNameId = 0
      let value: number | undefined, linkedValue: number | undefined
      let rangeMinValue: number | undefined, rangeMaxValue: number | undefined
      let axisValueRecords: { axisIndex: number, value: number }[] | undefined

      if (format === 1) {
        ensureStatRange(reader, axisValueStart, 12, `STAT AxisValue format 1 table ${i}`)
        axisIndex = reader.readUint16()
        flags = reader.readUint16()
        valueNameId = reader.readUint16()
        validateStatAxisValue(axisIndex, flags, valueNameId, designAxisCount, `STAT AxisValue table ${i}`)
        value = reader.readFixed()
      } else if (format === 2) {
        ensureStatRange(reader, axisValueStart, 20, `STAT AxisValue format 2 table ${i}`)
        axisIndex = reader.readUint16()
        flags = reader.readUint16()
        valueNameId = reader.readUint16()
        validateStatAxisValue(axisIndex, flags, valueNameId, designAxisCount, `STAT AxisValue table ${i}`)
        value = reader.readFixed()
        rangeMinValue = reader.readFixed()
        rangeMaxValue = reader.readFixed()
        if (rangeMinValue > rangeMaxValue) {
          throw new Error(`STAT AxisValue table ${i} rangeMinValue exceeds rangeMaxValue`)
        }
        if (value < rangeMinValue || value > rangeMaxValue) {
          throw new Error(`STAT AxisValue table ${i} nominalValue is outside its range`)
        }
      } else if (format === 3) {
        ensureStatRange(reader, axisValueStart, 16, `STAT AxisValue format 3 table ${i}`)
        axisIndex = reader.readUint16()
        flags = reader.readUint16()
        valueNameId = reader.readUint16()
        validateStatAxisValue(axisIndex, flags, valueNameId, designAxisCount, `STAT AxisValue table ${i}`)
        value = reader.readFixed()
        linkedValue = reader.readFixed()
      } else if (format === 4) {
        if (minorVersion < 2) {
          throw new Error('STAT AxisValue format 4 requires STAT version 1.2')
        }
        ensureStatRange(reader, axisValueStart, 8, `STAT AxisValue format 4 table ${i}`)
        const axisCount = reader.readUint16()
        // The spec requires axisCount greater than zero; a single-axis format-4
        // value is valid (used by the SF Rounded family), so only reject zero.
        if (axisCount === 0) {
          throw new Error(`STAT AxisValue format 4 table ${i} axisCount must be greater than zero`)
        }
        ensureStatRange(reader, axisValueStart, 8 + axisCount * 6, `STAT AxisValue format 4 table ${i}`)
        flags = reader.readUint16()
        valueNameId = reader.readUint16()
        validateStatFlags(flags, `STAT AxisValue table ${i} flags`)
        validateStatNameId(valueNameId, `STAT AxisValue table ${i} valueNameID`)
        axisValueRecords = []
        const axisIndexes = new Set<number>()
        for (let j = 0; j < axisCount; j++) {
          const recordAxisIndex = reader.readUint16()
          if (recordAxisIndex >= designAxisCount) {
            throw new Error(`STAT AxisValue format 4 table ${i} axisIndex ${recordAxisIndex} out of designAxisCount ${designAxisCount}`)
          }
          if (axisIndexes.has(recordAxisIndex)) {
            throw new Error(`STAT AxisValue format 4 table ${i} has duplicate axisIndex ${recordAxisIndex}`)
          }
          axisIndexes.add(recordAxisIndex)
          const recordValue = reader.readFixed()
          axisValueRecords.push({ axisIndex: recordAxisIndex, value: recordValue })
          if (j === 0) {
            axisIndex = recordAxisIndex
            value = recordValue
          }
        }
      } else {
        throw new Error(`Unsupported STAT AxisValue format: ${format}`)
      }

      axisValues.push({
        format, axisIndex, flags, valueNameId,
        value, linkedValue, rangeMinValue, rangeMaxValue, axisValues: axisValueRecords,
      })
    }
  }

  return {
    majorVersion, minorVersion, designAxisCount, designAxes, axisValues, elidedFallbackNameId,
  }
}

function ensureStatRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds table length: need ${offset + length}, got ${reader.length}`)
  }
}

function validateStatAxisValue(
  axisIndex: number,
  flags: number,
  valueNameId: number,
  designAxisCount: number,
  label: string,
): void {
  if (axisIndex >= designAxisCount) {
    throw new Error(`${label} axisIndex ${axisIndex} out of designAxisCount ${designAxisCount}`)
  }
  validateStatFlags(flags, `${label} flags`)
  validateStatNameId(valueNameId, `${label} valueNameID`)
}

function validateStatFlags(flags: number, label: string): void {
  const reserved = flags & 0xFFFC
  if (reserved !== 0) {
    throw new Error(`${label} contain reserved bits: 0x${reserved.toString(16).padStart(4, '0')}`)
  }
}

function validateStatNameId(nameId: number, label: string): void {
  if (nameId >= 32768) {
    throw new Error(`${label} must be less than 32768, got ${nameId}`)
  }
}
