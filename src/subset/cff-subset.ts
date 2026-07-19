/**
 * CFF font subsetter
 * Generates a minimal CFF font containing only the specified glyph IDs
 *
 * CFF subsetting requires rebuilding not only the CFF table inside the OTF
 * but the entire SFNT structure
 */
import { BinaryReader } from '../binary/reader.js'
import { BinaryWriter } from '../binary/writer.js'
import type { SfntData } from '../types/index.js'
import type { SubsetResult } from './index.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import { SfntTableManager } from '../parsers/ttf-parser.js'
import { parseCff, parseCffGlyph, type CffData, type CffIndex } from '../parsers/cff-parser.js'
import { PathCommand } from '../types/glyph.js'
import type { GlyphOutline } from '../types/glyph.js'
import { buildGraphiteSubsetTables, collectGraphiteGlyphReferences } from './graphite-subset.js'
import { buildDirectAatSubsetTables, collectAatGlyphReferences } from './aat-subset.js'
import { buildBitmapSubsetTables } from './bitmap-subset.js'
import { buildSvgSubsetTable, collectSvgPaletteIndices } from './svg-subset.js'
import { collectColrGlyphReferences, collectColrPaletteIndices, subsetColrTable } from './colr-subset.js'
import { buildCpalSubsetTable } from './cpal-subset.js'
import {
  buildStandardSubsetTables,
  bakeMvarMetrics,
  buildVerticalMetricsSubsetTables,
  buildVorgSubsetTable,
  collectBaseGlyphReferences,
  collectJstfGlyphReferences,
  collectMathGlyphReferences,
} from './standard-subset.js'
import { buildCompactGsubTable } from '../parsers/tables/gsub.js'
import { buildCompactGposTable } from '../parsers/tables/gpos.js'
import { buildCompactGdefTable } from '../parsers/tables/gdef.js'
import {
  buildCmapTable as buildOpenTypeCmapTable,
  collectSubsetCmapVariationSequences,
} from './ttf-subset.js'

/**
 * Extract the item array from a CffIndex
 */
function extractIndexItems(index: CffIndex): Uint8Array[] {
  const items: Uint8Array[] = []
  for (let i = 0; i < index.count; i++) {
    const offset = index.offsets[i]! - 1
    const length = index.offsets[i + 1]! - index.offsets[i]!
    const reader = index.data.subReader(offset, length)
    const data = new Uint8Array(length)
    for (let j = 0; j < length; j++) data[j] = reader.readUint8()
    items.push(data)
  }
  return items
}

/**
 * Calculate the binary size of an INDEX
 */
function calcIndexSize(items: Uint8Array[]): number {
  if (items.length === 0) return 2 // count=0 only
  let dataSize = 0
  for (const item of items) dataSize += item.length
  let offSize = 1
  if (dataSize + 1 > 0xFF) offSize = 2
  if (dataSize + 1 > 0xFFFF) offSize = 3
  if (dataSize + 1 > 0xFFFFFF) offSize = 4
  return 2 + 1 + (items.length + 1) * offSize + dataSize
}

/**
 * Write a CFF INDEX in binary format
 */
function writeIndex(writer: BinaryWriter, items: Uint8Array[]): void {
  const count = items.length
  writer.writeUint16(count)

  if (count === 0) return

  // Determine offSize
  let totalDataSize = 0
  for (const item of items) totalDataSize += item.length

  let offSize = 1
  if (totalDataSize + 1 > 0xFF) offSize = 2
  if (totalDataSize + 1 > 0xFFFF) offSize = 3
  if (totalDataSize + 1 > 0xFFFFFF) offSize = 4

  writer.writeUint8(offSize)

  // Offsets (1-based)
  let offset = 1
  for (let i = 0; i <= count; i++) {
    if (offSize === 1) writer.writeUint8(offset)
    else if (offSize === 2) writer.writeUint16(offset)
    else if (offSize === 3) { writer.writeUint8((offset >> 16) & 0xFF); writer.writeUint16(offset & 0xFFFF) }
    else writer.writeUint32(offset)

    if (i < count) offset += items[i]!.length
  }

  // Data
  for (const item of items) {
    writer.writeBytes(item)
  }
}

/**
 * Encode a CFF DICT entry to binary
 */
function encodeDictInt(value: number): Uint8Array {
  if (value >= -107 && value <= 107) {
    return new Uint8Array([value + 139])
  } else if (value >= 108 && value <= 1131) {
    const v = value - 108
    return new Uint8Array([247 + (v >> 8), v & 0xFF])
  } else if (value >= -1131 && value <= -108) {
    const v = -value - 108
    return new Uint8Array([251 + (v >> 8), v & 0xFF])
  } else if (value >= -32768 && value <= 32767) {
    return new Uint8Array([28, (value >> 8) & 0xFF, value & 0xFF])
  } else {
    return new Uint8Array([29, (value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF])
  }
}

/**
 * Encode a CFF DICT integer always as a fixed-length 5 bytes (op 29 format)
 * Used for Top DICT offset values to make the size deterministic
 */
function encodeDictInt5(value: number): Uint8Array {
  return new Uint8Array([29, (value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF])
}

/**
 * Encode a CFF DICT real number in BCD nibble format (op 30 format)
 * Inverse operation of parseCffReal
 */
export function encodeDictReal(value: number): Uint8Array {
  const str = value.toString()
  const nibbles: number[] = []

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    if (ch >= '0' && ch <= '9') {
      nibbles.push(ch.charCodeAt(0) - 48)
    } else if (ch === '.') {
      nibbles.push(0x0A)
    } else if (ch === '-') {
      nibbles.push(0x0E)
    } else if (ch === 'e' || ch === 'E') {
      if (i + 1 < str.length && str[i + 1] === '-') {
        nibbles.push(0x0C)
        i++ // skip '-'
      } else {
        nibbles.push(0x0B)
      }
    }
  }

  nibbles.push(0x0F) // end marker
  if (nibbles.length % 2 !== 0) nibbles.push(0x0F) // pad

  const bytes = new Uint8Array(1 + nibbles.length / 2)
  bytes[0] = 30 // real number marker
  for (let i = 0; i < nibbles.length; i += 2) {
    bytes[1 + i / 2] = (nibbles[i]! << 4) | nibbles[i + 1]!
  }
  return bytes
}

/**
 * Encode a CFF DICT number (encodeDictInt for integers, encodeDictReal for reals)
 */
function encodeDictNumber(value: number): Uint8Array {
  if (Number.isInteger(value)) {
    return encodeDictInt(value)
  }
  return encodeDictReal(value)
}

function encodeDictOperator(op: number): Uint8Array {
  if (op >= 1200) {
    return new Uint8Array([12, op - 1200])
  }
  return new Uint8Array([op])
}

/** Default CFF FontMatrix: 1/1000 em scaling */
const DEFAULT_FONT_MATRIX = [0.001, 0, 0, 0.001, 0, 0]

/**
 * Encode a Top DICT FontMatrix entry (operands + operator 12 7).
 * Returns an empty array when the matrix is absent or equals the default,
 * in which case the entry is omitted and consumers apply the CFF default.
 */
function buildFontMatrixEntry(fontMatrix: number[] | null): Uint8Array {
  if (!fontMatrix || fontMatrix.length !== 6) return new Uint8Array(0)
  let isDefault = true
  for (let i = 0; i < 6; i++) {
    if (fontMatrix[i] !== DEFAULT_FONT_MATRIX[i]) {
      isDefault = false
      break
    }
  }
  if (isDefault) return new Uint8Array(0)

  const parts: Uint8Array[] = []
  let total = 0
  for (let i = 0; i < 6; i++) {
    const b = encodeDictNumber(fontMatrix[i]!)
    parts.push(b)
    total += b.length
  }
  const opBytes = encodeDictOperator(1207)
  const out = new Uint8Array(total + opBytes.length)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  out.set(opBytes, pos)
  return out
}

/**
 * Subset a CFF (OTF) font
 *
 * @param sfnt Original SFNT data
 * @param glyphIds Glyph IDs to include in the subset
 * @param codePointToGlyphId Mapping from codepoint to glyphId
 * @returns Subset result (font binary + GID mapping)
 */
export function subsetCff(
  sfnt: SfntData,
  glyphIds: Set<number>,
  codePointToGlyphId?: Map<number, number>,
  preserveGlyphIds = false,
): SubsetResult {
  const manager = new SfntTableManager(sfnt)
  const cffReader = getTableReader(sfnt, 'CFF ')
  if (!cffReader) throw new Error("'CFF ' table not found")

  const cff = parseCff(cffReader)

  // Always include .notdef
  const allGlyphIds = new Set<number>([0, ...glyphIds])
  collectGraphiteGlyphReferences(manager, allGlyphIds)
  collectAatGlyphReferences(manager, allGlyphIds)
  collectColrGlyphReferences(manager.colr, allGlyphIds)
  collectMathGlyphReferences(manager.math, allGlyphIds)
  collectBaseGlyphReferences(manager.base, allGlyphIds)
  collectJstfGlyphReferences(manager.jstf, allGlyphIds)
  const sortedGlyphIds = preserveGlyphIds
    ? Array.from({ length: cff.charset.length }, function (_unused, glyphId) { return glyphId })
    : [...allGlyphIds].sort((a, b) => a - b)
  const oldToNew = new Map<number, number>()
  for (let i = 0; i < sortedGlyphIds.length; i++) {
    oldToNew.set(sortedGlyphIds[i]!, i)
  }
  const numNewGlyphs = sortedGlyphIds.length

  // Extract charstrings
  const charstringsItems = extractCharstrings(cff, sortedGlyphIds)
  if (preserveGlyphIds) {
    for (let glyphId = 0; glyphId < charstringsItems.length; glyphId++) {
      if (!allGlyphIds.has(glyphId)) charstringsItems[glyphId] = new Uint8Array([14])
    }
  }

  // Global Subrs
  const globalSubrItems = extractIndexItems(cff.globalSubrs)

  // Font name
  const fontName = manager.postScriptName || 'SubsetFont'
  const nameData = asciiBytes(fontName)
  const isMathCff = !!getTableReader(sfnt, 'MATH')
  const subsetFontBBox = isMathCff ? computeSubsetFontBBox(cff, sortedGlyphIds) : null

  // For a CIDFont, build a multi-FD CID CFF
  if (cff.isCIDFont && cff.fdSelect && cff.fdArray) {
    return subsetCidFont(
      sfnt, manager, cff, sortedGlyphIds, oldToNew, numNewGlyphs,
      charstringsItems, globalSubrItems, nameData, subsetFontBBox, isMathCff, codePointToGlyphId,
    )
  }

  // --- Non-CIDFont: existing name-keyed CFF subsetting ---

  const localSubrItems = extractIndexItems(cff.localSubrs)

  // Math fonts that have a MATH table are prone to rendering differences
  // across PDF viewers (missing large operators or radicals) when subroutines are pruned.
  // Prioritize display stability and keep subroutines for math fonts.
  const inlined = inlineAllSubroutineCalls(charstringsItems, globalSubrItems, localSubrItems)
  charstringsItems.splice(0, charstringsItems.length, ...inlined)
  const effectiveGlobalSubrItems: Uint8Array[] = []
  const effectiveLocalSubrItems: Uint8Array[] = []

  // Build a compact String INDEX and remap custom charset SIDs. Glyph names
  // are semantic CFF data; replacing custom names with SID 0 would create
  // duplicate .notdef names and an invalid name-keyed font.
  const customStringItems: Uint8Array[] = []
  const customSidRemap = new Map<number, number>()
  const charsetWriter = new BinaryWriter(1 + (numNewGlyphs - 1) * 2)
  charsetWriter.writeUint8(0) // format
  for (let i = 1; i < numNewGlyphs; i++) {
    const oldGid = sortedGlyphIds[i]!
    const sid = oldGid < cff.charset.length ? cff.charset[oldGid]! : 0
    if (sid <= 390) {
      charsetWriter.writeUint16(sid)
      continue
    }
    let remappedSid = customSidRemap.get(sid)
    if (remappedSid === undefined) {
      const value = cff.strings[sid - 391]
      if (value === undefined) throw new Error(`CFF charset SID ${sid} exceeds String INDEX`)
      remappedSid = 391 + customStringItems.length
      customSidRemap.set(sid, remappedSid)
      customStringItems.push(asciiBytes(value))
    }
    charsetWriter.writeUint16(remappedSid)
  }

  // Build the Private DICT
  const privateDictData = buildPrivateDict(cff.defaultWidthX, cff.nominalWidthX, effectiveLocalSubrItems, cff.privateDictEntries)

  // Preserve a non-default FontMatrix (e.g. fonts not designed on a 1000-unit em)
  const fontMatrixBytes = buildFontMatrixEntry(cff.fontMatrix)

  // Top DICT fixed size: FontMatrix (variable) + charset(6) + charstrings(6) + private(11)
  const topDictFixedSize = fontMatrixBytes.length + 23
  const topDictIndexSize = 2 + 1 + 2 + topDictFixedSize

  const headerSize = 4
  const nameIndexSize = 2 + 1 + 2 + nameData.length
  const stringIndexSize = calcIndexSize(customStringItems)
  const globalSubrIndexSize = calcIndexSize(effectiveGlobalSubrItems)

  const afterTopDict = headerSize + nameIndexSize + topDictIndexSize
  const afterStringIndex = afterTopDict + stringIndexSize
  const afterGlobalSubr = afterStringIndex + globalSubrIndexSize
  const charsetDataOffset = afterGlobalSubr
  const charsetDataSize = charsetWriter.position
  const charstringsOffset = charsetDataOffset + charsetDataSize
  const charstringsIndexSize = calcIndexSize(charstringsItems)
  const privateDictOffset = charstringsOffset + charstringsIndexSize

  // Top DICT
  const topDictWriter = new BinaryWriter(topDictFixedSize)
  topDictWriter.writeBytes(fontMatrixBytes)
  topDictWriter.writeBytes(encodeDictInt5(charsetDataOffset))
  topDictWriter.writeBytes(encodeDictOperator(15))
  topDictWriter.writeBytes(encodeDictInt5(charstringsOffset))
  topDictWriter.writeBytes(encodeDictOperator(17))
  topDictWriter.writeBytes(encodeDictInt5(privateDictData.length))
  topDictWriter.writeBytes(encodeDictInt5(privateDictOffset))
  topDictWriter.writeBytes(encodeDictOperator(18))
  const topDictData = new Uint8Array(topDictWriter.toArrayBuffer())

  // Build the name-keyed CFF
  const cffWriter = new BinaryWriter(8192)
  cffWriter.writeUint8(1); cffWriter.writeUint8(0); cffWriter.writeUint8(4); cffWriter.writeUint8(1)
  writeIndex(cffWriter, [nameData])
  writeIndex(cffWriter, [topDictData])
  if (customStringItems.length > 0) writeIndex(cffWriter, customStringItems)
  else cffWriter.writeUint16(0)
  if (effectiveGlobalSubrItems.length > 0) writeIndex(cffWriter, effectiveGlobalSubrItems)
  else cffWriter.writeUint16(0)
  cffWriter.writeBytes(new Uint8Array(charsetWriter.toArrayBuffer()))
  writeIndex(cffWriter, charstringsItems)
  cffWriter.writeBytes(privateDictData)
  if (effectiveLocalSubrItems.length > 0) writeIndex(cffWriter, effectiveLocalSubrItems)
  const nameKeyedCff = new Uint8Array(cffWriter.toArrayBuffer())

  // CID-keyed CFF (for PDF)
  const cidCff = buildSingleFdCidCff(
    nameData, charstringsItems, privateDictData,
    effectiveGlobalSubrItems, effectiveLocalSubrItems, numNewGlyphs, subsetFontBBox,
    fontMatrixBytes,
  )

  return {
    buffer: buildCffSfntWrapper(sfnt, manager, nameKeyedCff, oldToNew, numNewGlyphs, codePointToGlyphId),
    oldToNewGlyphId: oldToNew,
    cidKeyedCff: cidCff,
  }
}

/** Rebuilds CFF while retaining GID numbering and replacing unused programs with endchar. */
export function subsetCffPreservingGlyphIds(
  sfnt: SfntData,
  glyphIds: Set<number>,
  codePointToGlyphId?: Map<number, number>,
): SubsetResult {
  return subsetCff(sfnt, glyphIds, codePointToGlyphId, true)
}

// --- CIDFont subsetting ---

function subsetCidFont(
  sfnt: SfntData,
  manager: SfntTableManager,
  cff: CffData,
  sortedGlyphIds: number[],
  oldToNew: Map<number, number>,
  numNewGlyphs: number,
  charstringsItems: Uint8Array[],
  globalSubrItems: Uint8Array[],
  nameData: Uint8Array,
  fontBBox: { xMin: number; yMin: number; xMax: number; yMax: number } | null,
  isMathCff: boolean,
  codePointToGlyphId?: Map<number, number>,
): SubsetResult {
  // Determine the FD of each glyph and collect the FDs in use
  const glyphFdOld: number[] = [] // new glyph index → old FD index
  const usedFds = new Set<number>()
  for (const oldGid of sortedGlyphIds) {
    const fd = cff.fdSelect![oldGid] ?? 0
    glyphFdOld.push(fd)
    usedFds.add(fd)
  }

  // FD remapping: old → new (compact)
  const usedFdsSorted = [...usedFds].sort((a, b) => a - b)
  const fdRemap = new Map<number, number>()
  for (let i = 0; i < usedFdsSorted.length; i++) {
    fdRemap.set(usedFdsSorted[i]!, i)
  }
  const numFds = usedFdsSorted.length

  // Extract per-FD Local Subrs
  const fdLocalSubrItems: Uint8Array[][] = []
  for (const oldFdIdx of usedFdsSorted) {
    const fd = cff.fdArray![oldFdIdx]!
    fdLocalSubrItems.push(extractIndexItems(fd.localSubrs))
  }

  for (let glyphIndex = 0; glyphIndex < charstringsItems.length; glyphIndex++) {
    const oldGlyphId = sortedGlyphIds[glyphIndex]!
    const oldFd = cff.fdSelect![oldGlyphId]!
    const newFd = fdRemap.get(oldFd)!
    charstringsItems[glyphIndex] = inlineAllSubroutineCalls(
      [charstringsItems[glyphIndex]!], globalSubrItems, fdLocalSubrItems[newFd]!,
    )[0]!
  }
  const effectiveGlobalSubrItems: Uint8Array[] = []
  const effectiveFdLocalSubrItems = fdLocalSubrItems.map(function () { return [] as Uint8Array[] })

  // Build per-FD Private DICTs (using pruned subroutines)
  const fdPrivateData: Uint8Array[] = []
  for (let i = 0; i < usedFdsSorted.length; i++) {
    const fd = cff.fdArray![usedFdsSorted[i]!]!
    fdPrivateData.push(buildPrivateDict(fd.defaultWidthX, fd.nominalWidthX, effectiveFdLocalSubrItems[i]!, fd.privateDictEntries))
  }

  // String INDEX: "Adobe"(SID 391), "Identity"(SID 392)
  const stringItems = [asciiBytes('Adobe'), asciiBytes('Identity')]

  // FDSelect ranges (format 3)
  interface FDRange { first: number; fd: number }
  const fdRanges: FDRange[] = []
  let currentFd = -1
  for (let i = 0; i < numNewGlyphs; i++) {
    const newFd = fdRemap.get(glyphFdOld[i]!)!
    if (newFd !== currentFd) {
      fdRanges.push({ first: i, fd: newFd })
      currentFd = newFd
    }
  }

  // FDSelect size: format(1) + nRanges(2) + ranges(N*3) + sentinel(2)
  const fdSelectSize = 1 + 2 + fdRanges.length * 3 + 2

  // Charset (Identity, format 2)
  const charsetSize = numNewGlyphs <= 1 ? 1 : 5

  // Each Font DICT is 11 bytes (INT5 size + INT5 offset + OP 18)
  const fontDictSize = 11
  const fontDictPlaceholders: Uint8Array[] = []
  for (let i = 0; i < numFds; i++) fontDictPlaceholders.push(new Uint8Array(fontDictSize))

  // --- Size/offset calculation ---
  // Preserve a non-default FontMatrix (e.g. fonts not designed on a 1000-unit em)
  const fontMatrixBytes = buildFontMatrixEntry(cff.fontMatrix)
  const includeFontBBox = !!fontBBox
  // Top DICT fixed size:
  //   with FontBBox: 61
  //   without FontBBox: 40 (as before)
  //   plus a preserved non-default FontMatrix (variable)
  const topDictSize = (includeFontBBox ? 61 : 40) + fontMatrixBytes.length
  const headerSize = 4
  const nameIndexSize = calcIndexSize([nameData])
  const topDictIndexSize = 2 + 1 + 2 + topDictSize
  const stringIndexSize = calcIndexSize(stringItems)
  const globalSubrIndexSize = calcIndexSize(effectiveGlobalSubrItems)
  const charstringsIndexSize = calcIndexSize(charstringsItems)
  const fdArrayIndexSize = calcIndexSize(fontDictPlaceholders)

  const afterTopDict = headerSize + nameIndexSize + topDictIndexSize
  const afterStringIndex = afterTopDict + stringIndexSize
  const afterGlobalSubr = afterStringIndex + globalSubrIndexSize
  const charsetOffset = afterGlobalSubr
  const fdSelectOffset = charsetOffset + charsetSize
  const charstringsOffset = fdSelectOffset + fdSelectSize
  const fdArrayOffset = charstringsOffset + charstringsIndexSize
  const privateSectionStart = fdArrayOffset + fdArrayIndexSize

  // Calculate offsets for per-FD Private/LocalSubrs
  const fdPrivateOffsets: number[] = []
  let curOffset = privateSectionStart
  for (let i = 0; i < numFds; i++) {
    fdPrivateOffsets.push(curOffset)
    curOffset += fdPrivateData[i]!.length
    if (effectiveFdLocalSubrItems[i]!.length > 0) {
      curOffset += calcIndexSize(effectiveFdLocalSubrItems[i]!)
    }
  }

  // Build Font DICTs with the correct offsets
  const fontDictItems: Uint8Array[] = []
  for (let i = 0; i < numFds; i++) {
    const fdWriter = new BinaryWriter(fontDictSize)
    fdWriter.writeBytes(encodeDictInt5(fdPrivateData[i]!.length))
    fdWriter.writeBytes(encodeDictInt5(fdPrivateOffsets[i]!))
    fdWriter.writeBytes(encodeDictOperator(18))
    fontDictItems.push(new Uint8Array(fdWriter.toArrayBuffer()))
  }

  // Build the Top DICT
  const td = new BinaryWriter(topDictSize)
  td.writeBytes(fontMatrixBytes)
  if (includeFontBBox) {
    td.writeBytes(encodeDictInt5(fontBBox!.xMin))
    td.writeBytes(encodeDictInt5(fontBBox!.yMin))
    td.writeBytes(encodeDictInt5(fontBBox!.xMax))
    td.writeBytes(encodeDictInt5(fontBBox!.yMax))
    td.writeBytes(encodeDictOperator(5))   // FontBBox
  }
  td.writeBytes(encodeDictInt(391))     // Registry = "Adobe"
  td.writeBytes(encodeDictInt(392))     // Ordering = "Identity"
  td.writeBytes(encodeDictInt(0))       // Supplement
  td.writeBytes(encodeDictOperator(1230)) // ROS
  td.writeBytes(encodeDictInt5(numNewGlyphs))
  td.writeBytes(encodeDictOperator(1234)) // CIDCount
  td.writeBytes(encodeDictInt5(charsetOffset))
  td.writeBytes(encodeDictOperator(15))   // charset
  td.writeBytes(encodeDictInt5(charstringsOffset))
  td.writeBytes(encodeDictOperator(17))   // charstrings
  td.writeBytes(encodeDictInt5(fdArrayOffset))
  td.writeBytes(encodeDictOperator(1236)) // FDArray
  td.writeBytes(encodeDictInt5(fdSelectOffset))
  td.writeBytes(encodeDictOperator(1237)) // FDSelect
  const topDictData = new Uint8Array(td.toArrayBuffer())

  // --- Assemble the CFF ---
  const writer = new BinaryWriter(curOffset + 256)

  // Header
  writer.writeUint8(1); writer.writeUint8(0); writer.writeUint8(4); writer.writeUint8(1)

  // Name INDEX
  writeIndex(writer, [nameData])

  // Top DICT INDEX
  writeIndex(writer, [topDictData])

  // String INDEX
  writeIndex(writer, stringItems)

  // Global Subr INDEX
  if (effectiveGlobalSubrItems.length > 0) writeIndex(writer, effectiveGlobalSubrItems)
  else writer.writeUint16(0)

  // Charset (Identity)
  if (numNewGlyphs <= 1) {
    writer.writeUint8(0)
  } else {
    writer.writeUint8(2)
    writer.writeUint16(1)
    writer.writeUint16(numNewGlyphs - 2)
  }

  // FDSelect (format 3)
  writer.writeUint8(3)
  writer.writeUint16(fdRanges.length)
  for (const range of fdRanges) {
    writer.writeUint16(range.first)
    writer.writeUint8(range.fd)
  }
  writer.writeUint16(numNewGlyphs) // sentinel

  // CharStrings INDEX
  writeIndex(writer, charstringsItems)

  // FDArray INDEX
  writeIndex(writer, fontDictItems)

  // Per-FD: Private DICT + Local Subr INDEX
  for (let i = 0; i < numFds; i++) {
    writer.writeBytes(fdPrivateData[i]!)
    if (effectiveFdLocalSubrItems[i]!.length > 0) {
      writeIndex(writer, effectiveFdLocalSubrItems[i]!)
    }
  }

  const cidCffData = new Uint8Array(writer.toArrayBuffer())

  // Return SFNT + CID CFF (the same CID CFF is used for both Canvas and PDF)
  return {
    buffer: buildCffSfntWrapper(sfnt, manager, cidCffData, oldToNew, numNewGlyphs, codePointToGlyphId),
    oldToNewGlyphId: oldToNew,
    cidKeyedCff: cidCffData,
  }
}

// --- Helper functions ---

function extractCharstrings(cff: CffData, sortedGlyphIds: number[]): Uint8Array[] {
  const items: Uint8Array[] = []
  for (const oldGid of sortedGlyphIds) {
    const csOffset = cff.charstrings.offsets[oldGid]! - 1
    const csLength = cff.charstrings.offsets[oldGid + 1]! - cff.charstrings.offsets[oldGid]!
    const csReader = cff.charstrings.data.subReader(csOffset, csLength)
    const csData = new Uint8Array(csLength)
    for (let i = 0; i < csLength; i++) csData[i] = csReader.readUint8()
    items.push(csData)
  }
  return items
}

// Hinting-related operators that must be preserved in the Private DICT
const PRIVATE_HINT_OPS = [
  6,     // BlueValues
  7,     // OtherBlues
  8,     // FamilyBlues
  9,     // FamilyOtherBlues
  10,    // StdHW
  11,    // StdVW
  1209,  // BlueScale (12 9)
  1210,  // BlueShift (12 10)
  1211,  // BlueFuzz (12 11)
  1212,  // StemSnapH (12 12)
  1213,  // StemSnapV (12 13)
  1214,  // ForceBold (12 14)
  1217,  // LanguageGroup (12 17)
  1218,  // ExpansionFactor (12 18)
  1219,  // initialRandomSeed (12 19)
]

function buildPrivateDict(
  defaultWidthX: number,
  nominalWidthX: number,
  localSubrItems: Uint8Array[],
  dictEntries?: Map<number, number[]>,
): Uint8Array {
  const w = new BinaryWriter(256)

  // Emit hinting operators first
  if (dictEntries) {
    for (const op of PRIVATE_HINT_OPS) {
      const values = dictEntries.get(op)
      if (values && values.length > 0) {
        for (const v of values) w.writeBytes(encodeDictNumber(v))
        w.writeBytes(encodeDictOperator(op))
      }
    }
  }

  if (defaultWidthX !== 0) {
    w.writeBytes(encodeDictNumber(defaultWidthX))
    w.writeBytes(encodeDictOperator(20))
  }
  if (nominalWidthX !== 0) {
    w.writeBytes(encodeDictNumber(nominalWidthX))
    w.writeBytes(encodeDictOperator(21))
  }
  let subrsPlaceholder = -1
  if (localSubrItems.length > 0) {
    subrsPlaceholder = w.position
    w.writeBytes(encodeDictInt5(0)) // placeholder
    w.writeBytes(encodeDictOperator(19))
  }
  const data = new Uint8Array(w.toArrayBuffer())
  if (subrsPlaceholder >= 0) {
    const subrsOff = data.length
    const encoded = encodeDictInt5(subrsOff)
    for (let i = 0; i < 5; i++) data[subrsPlaceholder + i] = encoded[i]!
  }
  return data
}

interface CffSubsetGlyphBounds {
  readonly xMin: number
  readonly yMin: number
  readonly xMax: number
  readonly yMax: number
}

function updateCffSubsetHeadBounds(view: DataView, bounds: readonly (CffSubsetGlyphBounds | null)[]): void {
  let xMin = 0
  let yMin = 0
  let xMax = 0
  let yMax = 0
  let initialized = false
  for (let i = 0; i < bounds.length; i++) {
    const glyph = bounds[i]
    if (glyph == null) continue
    if (!initialized) {
      xMin = glyph.xMin
      yMin = glyph.yMin
      xMax = glyph.xMax
      yMax = glyph.yMax
      initialized = true
    } else {
      if (glyph.xMin < xMin) xMin = glyph.xMin
      if (glyph.yMin < yMin) yMin = glyph.yMin
      if (glyph.xMax > xMax) xMax = glyph.xMax
      if (glyph.yMax > yMax) yMax = glyph.yMax
    }
  }
  setCffSubsetInt16(view, 36, xMin, 'head.xMin')
  setCffSubsetInt16(view, 38, yMin, 'head.yMin')
  setCffSubsetInt16(view, 40, xMax, 'head.xMax')
  setCffSubsetInt16(view, 42, yMax, 'head.yMax')
}

function updateCffSubsetHorizontalExtrema(
  view: DataView,
  bounds: readonly (CffSubsetGlyphBounds | null)[],
  advances: readonly number[],
  bearings: readonly number[],
): void {
  let advanceMax = 0
  let minLeft = 0
  let minRight = 0
  let maxExtent = 0
  let initialized = false
  for (let i = 0; i < advances.length; i++) {
    const advance = advances[i]!
    if (advance > advanceMax) advanceMax = advance
    const glyph = bounds[i]
    if (glyph == null) continue
    const left = bearings[i]!
    const extent = glyph.xMax - glyph.xMin
    const right = advance - left - extent
    const glyphExtent = left + extent
    if (!initialized) {
      minLeft = left
      minRight = right
      maxExtent = glyphExtent
      initialized = true
    } else {
      if (left < minLeft) minLeft = left
      if (right < minRight) minRight = right
      if (glyphExtent > maxExtent) maxExtent = glyphExtent
    }
  }
  assertCffSubsetRange(advanceMax, 0, 0xFFFF, 'hhea.advanceWidthMax')
  view.setUint16(10, advanceMax, false)
  setCffSubsetInt16(view, 12, minLeft, 'hhea.minLeftSideBearing')
  setCffSubsetInt16(view, 14, minRight, 'hhea.minRightSideBearing')
  setCffSubsetInt16(view, 16, maxExtent, 'hhea.xMaxExtent')
}

function setCffSubsetInt16(view: DataView, offset: number, value: number, field: string): void {
  assertCffSubsetRange(value, -0x8000, 0x7FFF, field)
  view.setInt16(offset, value, false)
}

function assertCffSubsetRange(value: number, minimum: number, maximum: number, field: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} ${value} is outside ${minimum}..${maximum}`)
  }
}

/** Wrap CFF data in an SFNT (OTF). */
export function buildCffSfntWrapper(
  sfnt: SfntData,
  manager: SfntTableManager,
  cffData: Uint8Array,
  oldToNew: Map<number, number>,
  numNewGlyphs: number,
  codePointToGlyphId?: Map<number, number>,
  resolvedHorizontalMetrics?: ReadonlyMap<number, { readonly advanceWidth: number, readonly leftSideBearing: number }>,
): ArrayBuffer {
  const bakeCoords = manager.fvar === null
    ? undefined
    : manager.normalizedCoords ?? new Array<number>(manager.fvar.axes.length).fill(0)
  // hmtx
  const hmtxWriter = new BinaryWriter(numNewGlyphs * 4)
  const sortedNewIds = [...oldToNew.entries()].sort((a, b) => a[1] - b[1])
  const glyphBounds = new Array<CffSubsetGlyphBounds | null>(numNewGlyphs).fill(null)
  const advances = new Array<number>(numNewGlyphs)
  const bearings = new Array<number>(numNewGlyphs)
  for (let newGlyphId = 0; newGlyphId < sortedNewIds.length; newGlyphId++) {
    const oldId = sortedNewIds[newGlyphId]![0]
    const resolved = resolvedHorizontalMetrics?.get(oldId)
    const advance = Math.round(resolved?.advanceWidth ?? manager.hmtx.getAdvanceWidth(oldId))
    const bearing = Math.round(resolved?.leftSideBearing ?? manager.hmtx.getLsb(oldId))
    assertCffSubsetRange(advance, 0, 0xFFFF, 'hmtx advance width')
    assertCffSubsetRange(bearing, -0x8000, 0x7FFF, 'hmtx left side bearing')
    hmtxWriter.writeUint16(advance)
    hmtxWriter.writeInt16(bearing)
    advances[newGlyphId] = advance
    bearings[newGlyphId] = bearing
    const glyph = manager.getGlyphOutline(oldId)
    if (glyph.outline.commands.length > 0) {
      glyphBounds[newGlyphId] = {
        xMin: Math.floor(glyph.xMin),
        yMin: Math.floor(glyph.yMin),
        xMax: Math.ceil(glyph.xMax),
        yMax: Math.ceil(glyph.yMax),
      }
    }
  }

  // cmap
  const cmapEntries: { codePoint: number; newGlyphId: number }[] = []
  if (codePointToGlyphId) {
    for (const [cp, oldGid] of codePointToGlyphId) {
      const newGid = oldToNew.get(oldGid)
      if (newGid !== undefined) {
        cmapEntries.push({ codePoint: cp, newGlyphId: newGid })
      }
    }
  } else {
    for (const [cp, oldGid] of manager.cmap.entries()) {
      const newGid = oldToNew.get(oldGid)
      if (newGid !== undefined) {
        cmapEntries.push({ codePoint: cp, newGlyphId: newGid })
      }
    }
  }
  cmapEntries.sort((a, b) => a.codePoint - b.codePoint)
  const cmapData = buildOpenTypeCmapTable(
    cmapEntries,
    collectSubsetCmapVariationSequences(manager.cmap, cmapEntries, oldToNew),
  )

  // maxp
  const maxpReader = getTableReader(sfnt, 'maxp')!
  const maxpData = copyTableData(maxpReader)
  new DataView(maxpData.buffer, maxpData.byteOffset).setUint16(4, numNewGlyphs, false)

  // head (checkSumAdjustment reset to 0; recomputed when the SFNT is assembled)
  const headData = copyTableData(getTableReader(sfnt, 'head')!)
  const headView = new DataView(headData.buffer, headData.byteOffset, headData.byteLength)
  headView.setUint32(8, 0, false)
  updateCffSubsetHeadBounds(headView, glyphBounds)

  // hhea
  const hheaData = copyTableData(getTableReader(sfnt, 'hhea')!)
  const hheaView = new DataView(hheaData.buffer, hheaData.byteOffset, hheaData.byteLength)
  hheaView.setUint16(34, numNewGlyphs, false)
  updateCffSubsetHorizontalExtrema(hheaView, glyphBounds, advances, bearings)
  bakeMvarMetrics('hhea', hheaData, manager)

  // Table list
  const tables: { tag: string; data: Uint8Array }[] = [
    { tag: 'CFF ', data: cffData },
    { tag: 'cmap', data: cmapData },
    { tag: 'head', data: headData },
    { tag: 'hhea', data: hheaData },
    { tag: 'hmtx', data: new Uint8Array(hmtxWriter.toArrayBuffer()) },
    { tag: 'maxp', data: maxpData },
  ]

  // OS/2 is optional (some fonts omit it); copy it only when present.
  const os2Reader = getTableReader(sfnt, 'OS/2')
  if (os2Reader) tables.push({ tag: 'OS/2', data: bakeMvarMetrics('OS/2', copyTableData(os2Reader), manager) })

  const nameReader = getTableReader(sfnt, 'name')
  if (nameReader) tables.push({ tag: 'name', data: copyTableData(nameReader) })

  const postReader = getTableReader(sfnt, 'post')
  if (postReader) {
    const postData = new Uint8Array(32)
    for (let i = 0; i < postData.length; i++) postData[i] = postReader.getUint8At(i)
    new DataView(postData.buffer, postData.byteOffset, postData.byteLength).setUint32(0, 0x00030000, false)
    bakeMvarMetrics('post', postData, manager)
    tables.push({ tag: 'post', data: postData })
  }

  const graphite = buildGraphiteSubsetTables(manager, oldToNew)
  if (graphite !== null) {
    tables.push({ tag: 'Glat', data: graphite.Glat })
    tables.push({ tag: 'Gloc', data: graphite.Gloc })
    tables.push({ tag: 'Silf', data: graphite.Silf })
    for (const tag of ['Feat', 'Sill']) {
      const reader = getTableReader(sfnt, tag)
      if (reader !== null) tables.push({ tag, data: copyTableData(reader) })
    }
  }

  const aatTables = buildDirectAatSubsetTables(manager, oldToNew)
  for (const [tag, data] of aatTables) tables.push({ tag, data })
  const standardTables = buildStandardSubsetTables(sfnt, manager, oldToNew)
  for (const [tag, data] of standardTables) tables.push({ tag, data })
  const gsubReader = getTableReader(sfnt, 'GSUB')
  if (gsubReader !== null) {
    let identityMapping = oldToNew.size === manager.maxp.numGlyphs
    if (identityMapping) {
      for (const [oldGlyphId, newGlyphId] of oldToNew) {
        if (oldGlyphId !== newGlyphId) { identityMapping = false; break }
      }
    }
    tables.push({
      tag: 'GSUB',
      data: identityMapping && bakeCoords === undefined
        ? copyTableData(gsubReader)
        : buildCompactGsubTable(gsubReader, oldToNew, bakeCoords, manager.fvar?.axes.length),
    })
  }
  const gposReader = getTableReader(sfnt, 'GPOS')
  if (gposReader !== null) {
    let identityMapping = oldToNew.size === manager.maxp.numGlyphs
    if (identityMapping) {
      for (const [oldGlyphId, newGlyphId] of oldToNew) {
        if (oldGlyphId !== newGlyphId) { identityMapping = false; break }
      }
    }
    tables.push({
      tag: 'GPOS',
      data: identityMapping && bakeCoords === undefined
        ? copyTableData(gposReader)
        : buildCompactGposTable(
          gposReader,
          oldToNew,
          bakeCoords !== undefined
            ? { coords: bakeCoords, gdef: manager.gdef }
            : undefined,
          manager.fvar?.axes.length,
        ),
    })
  }
  const gdefReader = getTableReader(sfnt, 'GDEF')
  if (gdefReader !== null) {
    tables.push({
      tag: 'GDEF',
      data: buildCompactGdefTable(gdefReader, oldToNew, manager.fvar?.axes.length, bakeCoords),
    })
  }
  const verticalTables = buildVerticalMetricsSubsetTables(sfnt, manager, oldToNew)
  for (const [tag, data] of verticalTables) tables.push({ tag, data })
  const vorgData = buildVorgSubsetTable(manager, oldToNew)
  if (vorgData !== null) tables.push({ tag: 'VORG', data: vorgData })
  const bitmapTables = buildBitmapSubsetTables(sfnt, oldToNew, numNewGlyphs)
  for (const [tag, data] of bitmapTables) if (data !== null) tables.push({ tag, data })
  let svgTable = buildSvgSubsetTable(sfnt, oldToNew)
  const usedPaletteEntries = new Set<number>()
  const retainedGlyphIds = new Set(oldToNew.keys())
  collectColrPaletteIndices(manager.colr, retainedGlyphIds, usedPaletteEntries)
  collectSvgPaletteIndices(svgTable, usedPaletteEntries)
  const cpalSubset = buildCpalSubsetTable(manager.cpal, usedPaletteEntries)
  if (manager.cpal !== null && svgTable !== null) {
    svgTable = buildSvgSubsetTable(sfnt, oldToNew, cpalSubset.oldToNewPaletteEntry)
  }
  if (svgTable !== null) tables.push({ tag: 'SVG ', data: svgTable })
  const colrReader = getTableReader(sfnt, 'COLR')
  if (colrReader !== null && manager.colr !== null) tables.push({ tag: 'COLR', data: subsetColrTable(
    colrReader, manager.colr, retainedGlyphIds, oldToNew,
    manager.cpal === null ? undefined : cpalSubset.oldToNewPaletteEntry,
    bakeCoords,
  ) })
  if (cpalSubset.table !== null) tables.push({ tag: 'CPAL', data: cpalSubset.table })
  for (const tag of ['feat', 'fdsc', 'ltag', 'trak']) {
    const reader = getTableReader(sfnt, tag)
    if (reader !== null) tables.push({ tag, data: copyTableData(reader) })
  }

  tables.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)

  return buildSfntFromTables(0x4F54544F, tables)
}

function copyTableData(reader: BinaryReader): Uint8Array {
  const data = new Uint8Array(reader.length)
  const sub = reader.subReader(0, reader.length)
  for (let i = 0; i < reader.length; i++) {
    data[i] = sub.readUint8()
  }
  return data
}

function buildSfntFromTables(flavor: number, tables: { tag: string; data: Uint8Array }[]): ArrayBuffer {
  const numTables = tables.length
  let searchRange = 1
  let entrySelector = 0
  while (searchRange * 2 <= numTables) { searchRange *= 2; entrySelector++ }
  searchRange *= 16

  const headerSize = 12 + numTables * 16
  const writer = new BinaryWriter(headerSize + tables.reduce((s, t) => s + t.data.length + 4, 0))

  writer.writeUint32(flavor)
  writer.writeUint16(numTables)
  writer.writeUint16(searchRange)
  writer.writeUint16(entrySelector)
  writer.writeUint16(numTables * 16 - searchRange)

  let dataOffset = headerSize
  let headOffset = -1
  for (const t of tables) {
    writer.writeTag(t.tag)
    writer.writeUint32(calcChecksum(t.data))
    writer.writeUint32(dataOffset)
    writer.writeUint32(t.data.length)
    if (t.tag === 'head') headOffset = dataOffset
    dataOffset += t.data.length
    dataOffset += (4 - (dataOffset % 4)) % 4
  }

  for (const t of tables) {
    writer.writeBytes(t.data)
    writer.pad4()
  }

  const buffer = writer.toArrayBuffer()

  // head.checkSumAdjustment: 0xB1B0AFBA minus the checksum of the entire font,
  // computed while the field itself is 0 (OpenType 'head' table spec)
  if (headOffset >= 0) {
    const fontSum = calcChecksum(new Uint8Array(buffer))
    const adjustment = (0xB1B0AFBA - fontSum) >>> 0
    new DataView(buffer).setUint32(headOffset + 8, adjustment, false)
  }

  return buffer
}

function calcChecksum(data: Uint8Array): number {
  let sum = 0
  const len = data.length
  const full = len & ~3
  for (let i = 0; i < full; i += 4) {
    sum = (sum + ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!)) >>> 0
  }
  if (len > full) {
    let last = 0
    for (let i = full; i < len; i++) last |= data[i]! << (24 - (i - full) * 8)
    sum = (sum + last) >>> 0
  }
  return sum
}

/**
 * Build a single-FD CID-keyed CFF (for non-CIDFont sources)
 */
function buildSingleFdCidCff(
  nameData: Uint8Array,
  charstringsItems: Uint8Array[],
  privateDictData: Uint8Array,
  globalSubrItems: Uint8Array[],
  localSubrItems: Uint8Array[],
  numNewGlyphs: number,
  fontBBox: { xMin: number; yMin: number; xMax: number; yMax: number } | null,
  fontMatrixBytes: Uint8Array,
): Uint8Array {
  const stringItems = [asciiBytes('Adobe'), asciiBytes('Identity')]

  const headerSize = 4
  const nameIndexSize = calcIndexSize([nameData])
  const stringIndexSize = calcIndexSize(stringItems)
  const globalSubrIndexSize = calcIndexSize(globalSubrItems)
  const charstringsIndexSize = calcIndexSize(charstringsItems)

  const includeFontBBox = !!fontBBox
  // Top DICT fixed size:
  //   with FontBBox: 61
  //   without FontBBox: 40 (as before)
  //   plus a preserved non-default FontMatrix (variable)
  const topDictSize = (includeFontBBox ? 61 : 40) + fontMatrixBytes.length
  const topDictIndexSize = 2 + 1 + 2 + topDictSize

  const charsetSize = numNewGlyphs <= 1 ? 1 : 5
  const fdSelectSize = 8 // format 3, 1 range

  const fontDictSize = 11
  const fdArrayIndexSize = calcIndexSize([new Uint8Array(fontDictSize)])

  const afterTopDict = headerSize + nameIndexSize + topDictIndexSize
  const afterStringIndex = afterTopDict + stringIndexSize
  const afterGlobalSubr = afterStringIndex + globalSubrIndexSize
  const charsetOffset = afterGlobalSubr
  const fdSelectOffset = charsetOffset + charsetSize
  const charstringsOffset = fdSelectOffset + fdSelectSize
  const fdArrayOffset = charstringsOffset + charstringsIndexSize
  const privateDictOffset = fdArrayOffset + fdArrayIndexSize

  // Top DICT
  const td = new BinaryWriter(topDictSize)
  td.writeBytes(fontMatrixBytes)
  if (includeFontBBox) {
    td.writeBytes(encodeDictInt5(fontBBox!.xMin))
    td.writeBytes(encodeDictInt5(fontBBox!.yMin))
    td.writeBytes(encodeDictInt5(fontBBox!.xMax))
    td.writeBytes(encodeDictInt5(fontBBox!.yMax))
    td.writeBytes(encodeDictOperator(5))
  }
  td.writeBytes(encodeDictInt(391))
  td.writeBytes(encodeDictInt(392))
  td.writeBytes(encodeDictInt(0))
  td.writeBytes(encodeDictOperator(1230))
  td.writeBytes(encodeDictInt5(numNewGlyphs))
  td.writeBytes(encodeDictOperator(1234))
  td.writeBytes(encodeDictInt5(charsetOffset))
  td.writeBytes(encodeDictOperator(15))
  td.writeBytes(encodeDictInt5(charstringsOffset))
  td.writeBytes(encodeDictOperator(17))
  td.writeBytes(encodeDictInt5(fdArrayOffset))
  td.writeBytes(encodeDictOperator(1236))
  td.writeBytes(encodeDictInt5(fdSelectOffset))
  td.writeBytes(encodeDictOperator(1237))
  const topDictData = new Uint8Array(td.toArrayBuffer())

  // Font DICT
  const fd = new BinaryWriter(fontDictSize)
  fd.writeBytes(encodeDictInt5(privateDictData.length))
  fd.writeBytes(encodeDictInt5(privateDictOffset))
  fd.writeBytes(encodeDictOperator(18))
  const fontDictData = new Uint8Array(fd.toArrayBuffer())

  // Assemble
  const writer = new BinaryWriter(privateDictOffset + privateDictData.length + 4096)
  writer.writeUint8(1); writer.writeUint8(0); writer.writeUint8(4); writer.writeUint8(1)
  writeIndex(writer, [nameData])
  writeIndex(writer, [topDictData])
  writeIndex(writer, stringItems)
  if (globalSubrItems.length > 0) writeIndex(writer, globalSubrItems)
  else writer.writeUint16(0)

  if (numNewGlyphs <= 1) {
    writer.writeUint8(0)
  } else {
    writer.writeUint8(2); writer.writeUint16(1); writer.writeUint16(numNewGlyphs - 2)
  }

  writer.writeUint8(3); writer.writeUint16(1)
  writer.writeUint16(0); writer.writeUint8(0); writer.writeUint16(numNewGlyphs)

  writeIndex(writer, charstringsItems)
  writeIndex(writer, [fontDictData])
  writer.writeBytes(privateDictData)
  if (localSubrItems.length > 0) writeIndex(writer, localSubrItems)

  return new Uint8Array(writer.toArrayBuffer())
}

function asciiBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0x7F
  return bytes
}

function computeSubsetFontBBox(
  cff: CffData,
  sortedGlyphIds: number[],
): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity

  for (const gid of sortedGlyphIds) {
    const glyph = parseCffGlyph(cff, gid)
    const coords = glyph.outline.coords
    for (let i = 0; i < coords.length; i += 2) {
      const x = coords[i]!
      const y = coords[i + 1]!
      if (x < xMin) xMin = x
      if (y < yMin) yMin = y
      if (x > xMax) xMax = x
      if (y > yMax) yMax = y
    }
  }

  if (xMin === Infinity) {
    return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  }

  return {
    xMin: Math.floor(xMin),
    yMin: Math.floor(yMin),
    xMax: Math.ceil(xMax),
    yMax: Math.ceil(yMax),
  }
}

// --- Subroutine pruning ---

const RETURN_CHARSTRING = new Uint8Array([11]) // {return}

/**
 * Calculate the subroutine bias
 */
function calcSubrBias(count: number): number {
  if (count < 1240) return 107
  if (count < 33900) return 1131
  return 32768
}

interface SubroutineInlineState {
  stack: number[]
  transient: number[]
  numStems: number
  widthParsed: boolean
  callChain: Set<string>
}

interface SubroutineInlineContext {
  globalSubrs: Uint8Array[]
  localSubrs: Uint8Array[]
  globalBias: number
  localBias: number
}

/**
 * Inline every reachable subroutine call. Keeping the original operand
 * program and replacing each call with `drop` preserves computed subroutine
 * indices and the shared operand stack, while allowing both Subr INDEXes to
 * be removed physically instead of retaining return-only placeholders.
 */
function inlineAllSubroutineCalls(
  charstrings: Uint8Array[],
  globalSubrs: Uint8Array[],
  localSubrs: Uint8Array[],
): Uint8Array[] {
  const context: SubroutineInlineContext = {
    globalSubrs,
    localSubrs,
    globalBias: calcSubrBias(globalSubrs.length),
    localBias: calcSubrBias(localSubrs.length),
  }
  return charstrings.map(function (charstring, glyphId) {
    const output: number[] = []
    const state: SubroutineInlineState = {
      stack: [], transient: [], numStems: 0, widthParsed: false, callChain: new Set(),
    }
    inlineCharstring(charstring, `C${glyphId}`, state, context, output)
    return new Uint8Array(output)
  })
}

function inlineCharstring(
  bytes: Uint8Array,
  key: string,
  state: SubroutineInlineState,
  context: SubroutineInlineContext,
  output: number[],
): void {
  if (state.callChain.has(key)) throw new Error(`CFF subroutine cycle at ${key}`)
  if (state.callChain.size >= 10) throw new Error('CFF subroutine nesting depth exceeds 10')
  state.callChain.add(key)
  const stack = state.stack
  let offset = 0

  const requireStack = function (count: number, operator: string): void {
    if (stack.length < count) throw new Error(`CFF ${operator} stack underflow while subsetting`)
  }
  const copy = function (start: number, end: number): void {
    for (let i = start; i < end; i++) output.push(bytes[i]!)
  }

  while (offset < bytes.length) {
    const start = offset
    const b0 = bytes[offset++]!
    if (b0 >= 32 && b0 <= 246) {
      stack.push(b0 - 139)
      output.push(b0)
      continue
    }
    if (b0 >= 247 && b0 <= 250) {
      if (offset >= bytes.length) throw new Error('CFF positive number is truncated')
      stack.push((b0 - 247) * 256 + bytes[offset++]! + 108)
      copy(start, offset)
      continue
    }
    if (b0 >= 251 && b0 <= 254) {
      if (offset >= bytes.length) throw new Error('CFF negative number is truncated')
      stack.push(-(b0 - 251) * 256 - bytes[offset++]! - 108)
      copy(start, offset)
      continue
    }
    if (b0 === 28) {
      if (offset + 2 > bytes.length) throw new Error('CFF int16 number is truncated')
      stack.push((bytes[offset]! << 8 | bytes[offset + 1]!) << 16 >> 16)
      offset += 2
      copy(start, offset)
      continue
    }
    if (b0 === 255) {
      if (offset + 4 > bytes.length) throw new Error('CFF fixed number is truncated')
      const raw = ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >> 0
      stack.push(raw / 65536)
      offset += 4
      copy(start, offset)
      continue
    }

    if (b0 === 10 || b0 === 29) {
      requireStack(1, b0 === 10 ? 'callsubr' : 'callgsubr')
      const operand = stack.pop()!
      if (!Number.isInteger(operand)) throw new Error('CFF subroutine index must be an integer')
      const items = b0 === 10 ? context.localSubrs : context.globalSubrs
      const index = operand + (b0 === 10 ? context.localBias : context.globalBias)
      const subroutine = items[index]
      if (subroutine === undefined) throw new Error(`CFF subroutine index ${index} is out of range`)
      output.push(12, 18) // drop the original, possibly computed index operand
      inlineCharstring(subroutine, `${b0 === 10 ? 'L' : 'G'}${index}`, state, context, output)
      continue
    }
    if (b0 === 11) {
      state.callChain.delete(key)
      return
    }
    if (b0 === 14) {
      output.push(b0)
      state.callChain.delete(key)
      return
    }

    if (b0 === 12) {
      if (offset >= bytes.length) throw new Error('CFF escaped operator is truncated')
      const b1 = bytes[offset++]!
      copy(start, offset)
      applyEscapedStackOperator(b1, stack, state.transient, requireStack)
      continue
    }

    output.push(b0)
    if (b0 === 1 || b0 === 3 || b0 === 18 || b0 === 23) {
      if (!state.widthParsed && stack.length % 2 !== 0) stack.shift()
      state.widthParsed = true
      state.numStems += stack.length >> 1
      stack.length = 0
    } else if (b0 === 19 || b0 === 20) {
      if (!state.widthParsed && stack.length % 2 !== 0) stack.shift()
      state.widthParsed = true
      state.numStems += stack.length >> 1
      stack.length = 0
      const maskLength = Math.max(1, Math.ceil(state.numStems / 8))
      if (offset + maskLength > bytes.length) throw new Error('CFF hint mask is truncated')
      copy(offset, offset + maskLength)
      offset += maskLength
    } else if (b0 === 4 || b0 === 22) {
      if (!state.widthParsed && stack.length > 1) stack.shift()
      state.widthParsed = true
      stack.length = 0
    } else if (b0 === 21) {
      if (!state.widthParsed && stack.length > 2) stack.shift()
      state.widthParsed = true
      stack.length = 0
    } else {
      state.widthParsed = true
      stack.length = 0
    }
  }
  state.callChain.delete(key)
}

function applyEscapedStackOperator(
  operator: number,
  stack: number[],
  transient: number[],
  requireStack: (count: number, operator: string) => void,
): void {
  const binary = function (name: string, operation: (a: number, b: number) => number): void {
    requireStack(2, name)
    const b = stack.pop()!
    const a = stack.pop()!
    stack.push(operation(a, b))
  }
  if (operator === 3) binary('and', function (a, b) { return a !== 0 && b !== 0 ? 1 : 0 })
  else if (operator === 4) binary('or', function (a, b) { return a !== 0 || b !== 0 ? 1 : 0 })
  else if (operator === 5) { requireStack(1, 'not'); stack.push(stack.pop()! === 0 ? 1 : 0) }
  else if (operator === 9) { requireStack(1, 'abs'); stack.push(Math.abs(stack.pop()!)) }
  else if (operator === 10) binary('add', function (a, b) { return a + b })
  else if (operator === 11) binary('sub', function (a, b) { return a - b })
  else if (operator === 12) binary('div', function (a, b) { return b === 0 ? 0 : a / b })
  else if (operator === 14) { requireStack(1, 'neg'); stack.push(-stack.pop()!) }
  else if (operator === 15) binary('eq', function (a, b) { return a === b ? 1 : 0 })
  else if (operator === 18) { requireStack(1, 'drop'); stack.pop() }
  else if (operator === 20) {
    requireStack(2, 'put')
    const index = stack.pop()!
    const value = stack.pop()!
    transient[index] = value
  } else if (operator === 21) {
    requireStack(1, 'get')
    const index = stack.pop()!
    stack.push(transient[index] ?? 0)
  } else if (operator === 22) {
    requireStack(4, 'ifelse')
    const v2 = stack.pop()!, v1 = stack.pop()!, s2 = stack.pop()!, s1 = stack.pop()!
    stack.push(v1 <= v2 ? s1 : s2)
  } else if (operator === 23) stack.push(1)
  else if (operator === 24) binary('mul', function (a, b) { return a * b })
  else if (operator === 26) { requireStack(1, 'sqrt'); stack.push(Math.sqrt(stack.pop()!)) }
  else if (operator === 27) { requireStack(1, 'dup'); stack.push(stack[stack.length - 1]!) }
  else if (operator === 28) {
    requireStack(2, 'exch')
    const b = stack.pop()!, a = stack.pop()!
    stack.push(b, a)
  } else if (operator === 29) {
    requireStack(1, 'index')
    const index = Math.max(0, stack.pop()!)
    requireStack(index + 1, 'index')
    stack.push(stack[stack.length - 1 - index]!)
  } else if (operator === 30) {
    requireStack(2, 'roll')
    const shiftOperand = stack.pop()!, count = stack.pop()!
    requireStack(count, 'roll')
    if (count > 0) {
      const start = stack.length - count
      const values = stack.splice(start, count)
      const shift = ((shiftOperand % count) + count) % count
      stack.push(...values.slice(count - shift), ...values.slice(0, count - shift))
    }
  } else {
    // Flex/path operators and reserved escaped operators consume their stack.
    stack.length = 0
  }
}

/**
 * Scan charstring binary and collect the indices of callsubr/callgsubr in use
 * Lightweight interpreter: only tracks numeric values on the stack, omits path drawing
 */
/**
 * Shared state for scanSubrUsage.
 * In CFF charstrings, the stack, numStems, and widthParsed are shared across subroutine boundaries.
 * There is a pattern where a subroutine pushes values onto the stack and returns, and the caller consumes them.
 * (e.g. a subroutine pushes vstem values → the caller's hintmask counts them as implicit stems)
 */
interface SubrScanState {
  stack: number[]
  numStems: number
  widthParsed: boolean
  callChain: Set<string>  // Current call chain (prevents infinite recursion)
}

interface SubrScanContext {
  globalSubrItems: Uint8Array[]
  localSubrItems: Uint8Array[]
  globalBias: number
  localBias: number
  usedGlobal: Set<number>
  usedLocal: Set<number>
}

function scanSubrUsage(
  data: Uint8Array,
  globalSubrItems: Uint8Array[],
  localSubrItems: Uint8Array[],
  globalBias: number,
  localBias: number,
  usedGlobal: Set<number>,
  usedLocal: Set<number>,
): void {
  const state: SubrScanState = {
    stack: [],
    numStems: 0,
    widthParsed: false,
    callChain: new Set(),
  }
  const ctx: SubrScanContext = {
    globalSubrItems, localSubrItems,
    globalBias, localBias,
    usedGlobal, usedLocal,
  }
  scanCharstring(data, 'CS', state, ctx)
}

function scanCharstring(
  bytes: Uint8Array,
  key: string,
  state: SubrScanState,
  ctx: SubrScanContext,
): void {
  if (state.callChain.has(key)) return
  state.callChain.add(key)

  const { stack } = state
  let i = 0

  while (i < bytes.length) {
    const b0 = bytes[i++]!

    // Number encodings
    if (b0 >= 32 && b0 <= 246) {
      stack.push(b0 - 139)
      continue
    }
    if (b0 >= 247 && b0 <= 250) {
      stack.push((b0 - 247) * 256 + (bytes[i++] ?? 0) + 108)
      continue
    }
    if (b0 >= 251 && b0 <= 254) {
      stack.push(-(b0 - 251) * 256 - (bytes[i++] ?? 0) - 108)
      continue
    }
    if (b0 === 28) {
      const hi = bytes[i++] ?? 0
      const lo = bytes[i++] ?? 0
      stack.push((hi << 8 | lo) << 16 >> 16)
      continue
    }
    if (b0 === 255) {
      const b1 = bytes[i++] ?? 0
      const b2 = bytes[i++] ?? 0
      const b3 = bytes[i++] ?? 0
      const b4 = bytes[i++] ?? 0
      stack.push(((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) / 65536)
      continue
    }

    // Operators
    if (b0 === 10) {
      // callsubr
      if (stack.length > 0) {
        const idx = stack.pop()! + ctx.localBias
        if (idx >= 0 && idx < ctx.localSubrItems.length) {
          ctx.usedLocal.add(idx)
          scanCharstring(ctx.localSubrItems[idx]!, `L${idx}`, state, ctx)
        }
      }
    } else if (b0 === 29) {
      // callgsubr
      if (stack.length > 0) {
        const idx = stack.pop()! + ctx.globalBias
        if (idx >= 0 && idx < ctx.globalSubrItems.length) {
          ctx.usedGlobal.add(idx)
          scanCharstring(ctx.globalSubrItems[idx]!, `G${idx}`, state, ctx)
        }
      }
    } else if (b0 === 11) {
      // return — the stack stays shared as control returns to the caller
      state.callChain.delete(key)
      return
    } else if (b0 === 14) {
      // endchar
      state.callChain.delete(key)
      return
    } else if (b0 === 1 || b0 === 3 || b0 === 18 || b0 === 23) {
      // hstem, vstem, hstemhm, vstemhm
      if (!state.widthParsed && stack.length % 2 !== 0) stack.shift()
      state.widthParsed = true
      state.numStems += stack.length >> 1
      stack.length = 0
    } else if (b0 === 19 || b0 === 20) {
      // hintmask, cntrmask
      if (!state.widthParsed && stack.length % 2 !== 0) stack.shift()
      state.widthParsed = true
      state.numStems += stack.length >> 1
      stack.length = 0
      i += Math.max(1, Math.ceil(state.numStems / 8))
    } else if (b0 === 4 || b0 === 22) {
      // vmoveto, hmoveto
      if (!state.widthParsed && stack.length > 1) stack.shift()
      state.widthParsed = true
      stack.length = 0
    } else if (b0 === 21) {
      // rmoveto
      if (!state.widthParsed && stack.length > 2) stack.shift()
      state.widthParsed = true
      stack.length = 0
    } else if (b0 === 12) {
      // 2-byte operator (escape)
      i++ // skip second byte
      stack.length = 0
    } else {
      // All other path operators: consume stack
      state.widthParsed = true
      stack.length = 0
    }
  }
  state.callChain.delete(key)
}

/**
 * Minimize unused entries in a subroutine array (replace them with {return})
 */
function pruneSubroutines(items: Uint8Array[], used: Set<number>): Uint8Array[] {
  if (items.length === 0) return items
  return items.map((item, idx) => used.has(idx) ? item : RETURN_CHARSTRING)
}

/**
 * Scan every entry in the charstring array to identify used subroutines and prune
 */
function pruneAllSubroutines(
  charstringsItems: Uint8Array[],
  globalSubrItems: Uint8Array[],
  localSubrItems: Uint8Array[],
): { prunedGlobal: Uint8Array[], prunedLocal: Uint8Array[] } {
  const globalBias = calcSubrBias(globalSubrItems.length)
  const localBias = calcSubrBias(localSubrItems.length)
  const usedGlobal = new Set<number>()
  const usedLocal = new Set<number>()

  for (const cs of charstringsItems) {
    scanSubrUsage(cs, globalSubrItems, localSubrItems, globalBias, localBias, usedGlobal, usedLocal)
  }

  return {
    prunedGlobal: pruneSubroutines(globalSubrItems, usedGlobal),
    prunedLocal: pruneSubroutines(localSubrItems, usedLocal),
  }
}

/**
 * For CIDFonts: prune per-FD local subroutines
 */
function pruneCidSubroutines(
  charstringsItems: Uint8Array[],
  globalSubrItems: Uint8Array[],
  fdLocalSubrItems: Uint8Array[][],
  sortedGlyphIds: number[],
  fdSelect: Uint8Array,
  fdRemap: Map<number, number>,
): { prunedGlobal: Uint8Array[], prunedFdLocal: Uint8Array[][] } {
  const globalBias = calcSubrBias(globalSubrItems.length)
  const usedGlobal = new Set<number>()
  const fdUsedLocal: Set<number>[] = fdLocalSubrItems.map(() => new Set<number>())

  for (let i = 0; i < charstringsItems.length; i++) {
    const oldGid = sortedGlyphIds[i]!
    const oldFd = fdSelect[oldGid] ?? 0
    const newFd = fdRemap.get(oldFd) ?? 0
    const localItems = fdLocalSubrItems[newFd] ?? []
    const localBias = calcSubrBias(localItems.length)
    const usedLocal = fdUsedLocal[newFd]!

    scanSubrUsage(charstringsItems[i]!, globalSubrItems, localItems, globalBias, localBias, usedGlobal, usedLocal)
  }

  return {
    prunedGlobal: pruneSubroutines(globalSubrItems, usedGlobal),
    prunedFdLocal: fdLocalSubrItems.map((items, idx) => pruneSubroutines(items, fdUsedLocal[idx]!)),
  }
}

// ---------------------------------------------------------------------------
// CFF2 → CFF: build a static CID-keyed CFF from resolved glyph outlines
// ---------------------------------------------------------------------------

/** One glyph to embed: its outline (resolved to the chosen instance) and advance. */
export interface OutlineGlyph {
  outline: GlyphOutline
  advanceWidth: number
}

/**
 * Build a CID-keyed CFF (CIDFontType0C) from already-resolved glyph outlines.
 *
 * This is how a CFF2 (variable) font is embedded in a PDF: the CFF2 charstrings
 * are interpreted at the chosen instance (producing plain cubic outlines), then
 * re-encoded as Type 2 charstrings in a static CFF. The outlines are the same
 * ones the rasteriser draws, so the embedded font matches the on-screen shapes
 * exactly. `glyphs[0]` must be .notdef. Coordinates are rounded to integers
 * (CFF charstrings are integer-based; CFF2 fonts use a 1000-unit em).
 */
export function buildCidCffFromOutlines(
  glyphs: OutlineGlyph[],
  fontBBox: { xMin: number; yMin: number; xMax: number; yMax: number } | null,
  fontMatrix: number[] | null,
): Uint8Array {
  const charstrings: Uint8Array[] = []
  for (let i = 0; i < glyphs.length; i++) {
    charstrings.push(encodeType2Charstring(glyphs[i]!.outline))
  }
  const privateDict = buildPrivateDict(0, 0, [], undefined)
  const fontMatrixBytes = buildFontMatrixEntry(fontMatrix)
  const nameData = asciiBytes('CFF2Subset')
  return buildSingleFdCidCff(nameData, charstrings, privateDict, [], [], glyphs.length, fontBBox, fontMatrixBytes)
}

/** Type 2 charstring number operand (28/255 forms; integers use the compact ops). */
function encodeCharstringNumber(value: number): Uint8Array {
  const v = Math.round(value)
  if (v >= -107 && v <= 107) return new Uint8Array([v + 139])
  if (v >= 108 && v <= 1131) { const n = v - 108; return new Uint8Array([247 + (n >> 8), n & 0xFF]) }
  if (v >= -1131 && v <= -108) { const n = -v - 108; return new Uint8Array([251 + (n >> 8), n & 0xFF]) }
  if (v >= -32768 && v <= 32767) return new Uint8Array([28, (v >> 8) & 0xFF, v & 0xFF])
  // 16.16 fixed (op 255): only needed for out-of-range values
  const fixed = Math.round(v * 65536)
  return new Uint8Array([255, (fixed >> 24) & 0xFF, (fixed >> 16) & 0xFF, (fixed >> 8) & 0xFF, fixed & 0xFF])
}

/**
 * Encode a normalized (all-cubic) outline as a Type 2 charstring. Every path
 * command becomes an explicit rmoveto / rlineto / rrcurveto against the
 * running point, so no hint or subroutine machinery is needed; the trailing
 * endchar terminates the glyph. Width is omitted (defaultWidthX = 0 in the
 * Private DICT, so the advance comes from the PDF /W array and hmtx).
 */
function encodeType2Charstring(outline: GlyphOutline): Uint8Array {
  const parts: Uint8Array[] = []
  const commands = outline.commands
  const coords = outline.coords
  let x = 0
  let y = 0
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    if (cmd === PathCommand.MoveTo) {
      const px = coords[ci++]!
      const py = coords[ci++]!
      parts.push(encodeCharstringNumber(px - x))
      parts.push(encodeCharstringNumber(py - y))
      parts.push(new Uint8Array([21])) // rmoveto
      x = px; y = py
    } else if (cmd === PathCommand.LineTo) {
      const px = coords[ci++]!
      const py = coords[ci++]!
      parts.push(encodeCharstringNumber(px - x))
      parts.push(encodeCharstringNumber(py - y))
      parts.push(new Uint8Array([5])) // rlineto
      x = px; y = py
    } else if (cmd === PathCommand.CubicTo) {
      const c1x = coords[ci++]!
      const c1y = coords[ci++]!
      const c2x = coords[ci++]!
      const c2y = coords[ci++]!
      const px = coords[ci++]!
      const py = coords[ci++]!
      parts.push(encodeCharstringNumber(c1x - x))
      parts.push(encodeCharstringNumber(c1y - y))
      parts.push(encodeCharstringNumber(c2x - c1x))
      parts.push(encodeCharstringNumber(c2y - c1y))
      parts.push(encodeCharstringNumber(px - c2x))
      parts.push(encodeCharstringNumber(py - c2y))
      parts.push(new Uint8Array([8])) // rrcurveto
      x = px; y = py
    }
    // Close is implicit in Type 2 charstrings (a new moveto or endchar closes)
  }
  parts.push(new Uint8Array([14])) // endchar
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}
