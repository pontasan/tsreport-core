import { BinaryReader } from '../../binary/reader.js'

const MERG_HEADER_SIZE = 10
const MERG_RESERVED_FLAGS = 0x88

export interface MergGlyphGroup {
  readonly start: number
  readonly end: number
  readonly mergeRequired: boolean
}

/** OpenType MERG class definitions and pre-antialias merge processing. */
export interface MergTable {
  readonly version: number
  readonly mergeClassCount: number
  getMergeClass(glyphId: number): number
  getMergeActionByClass(classId1: number, classId2: number): number
  getMergeAction(glyphId1: number, glyphId2: number): number
  getMergeGroups(glyphIds: ArrayLike<number>, direction?: 'ltr' | 'rtl'): readonly MergGlyphGroup[]
}

export function parseMerg(reader: BinaryReader, numGlyphs?: number): MergTable {
  const tableStart = reader.position
  validateRange(reader, tableStart, MERG_HEADER_SIZE, 'MERG header')
  const version = reader.readUint16()
  if (version !== 0) throw new Error(`Unsupported MERG table version: ${version}`)
  const mergeClassCount = reader.readUint16()
  if (mergeClassCount === 0) throw new Error('MERG mergeClassCount must be greater than zero')
  const mergeDataOffset = reader.readUint16()
  const classDefCount = reader.readUint16()
  const offsetToClassDefOffsets = reader.readUint16()

  const offsetsStart = tableStart + offsetToClassDefOffsets
  validateRange(reader, offsetsStart, classDefCount * 2, 'MERG class definition offset array')
  const classDefOffsets = new Array<number>(classDefCount)
  const seenOffsets = new Set<number>()
  for (let i = 0; i < classDefCount; i++) {
    const offset = reader.getUint16At(offsetsStart + i * 2)
    if (offset === 0) throw new Error(`MERG class definition ${i} offset must not be zero`)
    if (seenOffsets.has(offset)) throw new Error(`MERG class definition offset ${offset} is duplicated`)
    seenOffsets.add(offset)
    classDefOffsets[i] = offset
  }

  const glyphToClass = new Map<number, number>()
  let previousGlyph = -1
  for (let i = 0; i < classDefOffsets.length; i++) {
    previousGlyph = parseMergClassDef(
      reader, tableStart + classDefOffsets[i]!, glyphToClass, previousGlyph, numGlyphs, i,
    )
  }

  const mergeDataStart = tableStart + mergeDataOffset
  const mergeDataLength = mergeClassCount * mergeClassCount
  validateRange(reader, mergeDataStart, mergeDataLength, 'MERG merge-entry data')
  const mergeData = new Uint8Array(mergeDataLength)
  for (let i = 0; i < mergeDataLength; i++) mergeData[i] = reader.getUint8At(mergeDataStart + i)
  for (let i = 0; i < mergeData.length; i++) {
    if ((mergeData[i]! & MERG_RESERVED_FLAGS) !== 0) {
      throw new Error(`MERG merge entry ${i} has reserved flag bits set: 0x${mergeData[i]!.toString(16).padStart(2, '0')}`)
    }
  }

  function getMergeClass(glyphId: number): number {
    return glyphToClass.get(glyphId) ?? 0
  }

  function getEntry(firstClass: number, secondClass: number): number {
    if (firstClass >= mergeClassCount || secondClass >= mergeClassCount) return 0
    return mergeData[firstClass * mergeClassCount + secondClass]!
  }

  return {
    version,
    mergeClassCount,
    getMergeClass,
    getMergeAction(glyphId1: number, glyphId2: number): number {
      return getEntry(getMergeClass(glyphId1), getMergeClass(glyphId2))
    },
    getMergeActionByClass(classId1: number, classId2: number): number {
      return getEntry(classId1, classId2)
    },
    getMergeGroups(glyphIds: ArrayLike<number>, direction: 'ltr' | 'rtl' = 'ltr'): readonly MergGlyphGroup[] {
      const groups: MergGlyphGroup[] = []
      const mergeMask = direction === 'rtl' ? 0x10 : 0x01
      const groupMask = direction === 'rtl' ? 0x20 : 0x02
      const subordinateMask = direction === 'rtl' ? 0x40 : 0x04
      let start = 0
      while (start < glyphIds.length) {
        let end = start + 1
        let groupClass = getMergeClass(glyphIds[start]!)
        let mergeRequired = false
        while (end < glyphIds.length) {
          const nextClass = getMergeClass(glyphIds[end]!)
          const entry = getEntry(groupClass, nextClass)
          if ((entry & (mergeMask | groupMask)) === 0) break
          if ((entry & mergeMask) !== 0) mergeRequired = true
          if ((entry & subordinateMask) === 0) groupClass = nextClass
          end++
        }
        groups.push({ start, end, mergeRequired })
        start = end
      }
      return groups
    },
  }
}

function parseMergClassDef(
  reader: BinaryReader,
  offset: number,
  glyphToClass: Map<number, number>,
  previousGlyph: number,
  numGlyphs: number | undefined,
  tableIndex: number,
): number {
  validateRange(reader, offset, 2, `MERG class definition ${tableIndex}`)
  const format = reader.getUint16At(offset)
  if (format === 1) {
    validateRange(reader, offset, 6, `MERG class definition ${tableIndex} format 1 header`)
    const startGlyph = reader.getUint16At(offset + 2)
    const glyphCount = reader.getUint16At(offset + 4)
    validateRange(reader, offset + 6, glyphCount * 2, `MERG class definition ${tableIndex} format 1 values`)
    for (let i = 0; i < glyphCount; i++) {
      const glyphId = startGlyph + i
      previousGlyph = addMergClass(reader, offset + 6 + i * 2, glyphId, glyphToClass, previousGlyph, numGlyphs)
    }
    return previousGlyph
  }
  if (format === 2) {
    validateRange(reader, offset, 4, `MERG class definition ${tableIndex} format 2 header`)
    const rangeCount = reader.getUint16At(offset + 2)
    validateRange(reader, offset + 4, rangeCount * 6, `MERG class definition ${tableIndex} format 2 ranges`)
    let previousRangeEnd = -1
    for (let i = 0; i < rangeCount; i++) {
      const rangeOffset = offset + 4 + i * 6
      const startGlyph = reader.getUint16At(rangeOffset)
      const endGlyph = reader.getUint16At(rangeOffset + 2)
      if (startGlyph > endGlyph) throw new Error(`MERG class definition ${tableIndex} range ${i} has startGlyph greater than endGlyph`)
      if (startGlyph <= previousRangeEnd) throw new Error(`MERG class definition ${tableIndex} ranges overlap or are out of order`)
      previousRangeEnd = endGlyph
      for (let glyphId = startGlyph; glyphId <= endGlyph; glyphId++) {
        previousGlyph = addMergClass(reader, rangeOffset + 4, glyphId, glyphToClass, previousGlyph, numGlyphs)
      }
    }
    return previousGlyph
  }
  throw new Error(`Unsupported MERG ClassDef format: ${format}`)
}

function addMergClass(
  reader: BinaryReader,
  classValueOffset: number,
  glyphId: number,
  glyphToClass: Map<number, number>,
  previousGlyph: number,
  numGlyphs: number | undefined,
): number {
  if (glyphId <= previousGlyph) throw new Error('MERG glyph references must be strictly increasing across class definitions')
  if (numGlyphs !== undefined && glyphId >= numGlyphs) {
    throw new Error(`MERG glyph ${glyphId} exceeds numGlyphs ${numGlyphs}`)
  }
  const classId = reader.getUint16At(classValueOffset)
  if (classId !== 0) glyphToClass.set(glyphId, classId)
  return glyphId
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || length > reader.length - offset) {
    throw new Error(`${label} exceeds MERG table length`)
  }
}
