/**
 * Synthetic TrueType font builder for renderer / hinting regression tests.
 *
 * Produces a minimal but fully loadable TTF (head/maxp/hhea/hmtx/cmap/OS2/
 * post/name/loca/glyf) that extra tables (SVG, sbix, CBLC/CBDT, EBLC/EBDT,
 * gasp, cvt, fpgm, prep, COLR, CPAL, ...) can be merged into.
 */

import { BinaryWriter } from '../../src/binary/writer.js'

export const UPEM = 1000

export function buildTable(fn: (w: BinaryWriter) => void): Uint8Array {
  const w = new BinaryWriter()
  fn(w)
  return w.toUint8Array()
}

/** Assembles an SFNT font binary from (tag, data) pairs */
export function buildFont(tables: [string, Uint8Array][]): ArrayBuffer {
  const sortedTables = [...tables].sort(([a], [b]) => compareSfntTags(a, b))
  const numTables = sortedTables.length
  const headerSize = 12 + numTables * 16
  const w = new BinaryWriter()
  const search = computeSfntSearchFields(numTables)
  w.writeUint32(0x00010000) // sfntVersion (TrueType)
  w.writeUint16(numTables)
  w.writeUint16(search.searchRange)
  w.writeUint16(search.entrySelector)
  w.writeUint16(search.rangeShift)

  let offset = headerSize
  const offsets: number[] = []
  for (const [, data] of sortedTables) {
    offsets.push(offset)
    offset += (data.length + 3) & ~3
  }
  for (let i = 0; i < numTables; i++) {
    w.writeTag(sortedTables[i]![0])
    w.writeUint32(0) // checksum
    w.writeUint32(offsets[i]!)
    w.writeUint32(sortedTables[i]![1].length)
  }
  for (let i = 0; i < numTables; i++) {
    const data = sortedTables[i]![1]
    const padded = new Uint8Array((data.length + 3) & ~3)
    padded.set(data)
    w.writeBytes(padded)
  }
  return w.toArrayBuffer()
}

function compareSfntTags(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function computeSfntSearchFields(numTables: number): { searchRange: number; entrySelector: number; rangeShift: number } {
  let maxPowerOfTwo = 1
  let entrySelector = 0
  while (maxPowerOfTwo * 2 <= numTables) {
    maxPowerOfTwo *= 2
    entrySelector++
  }
  const searchRange = maxPowerOfTwo * 16
  return { searchRange, entrySelector, rangeShift: numTables * 16 - searchRange }
}

export function buildHead(flags = 0): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1) // majorVersion
    w.writeUint16(0) // minorVersion
    w.writeUint32(0x00010000) // fontRevision
    w.writeUint32(0) // checksumAdjustment
    w.writeUint32(0x5F0F3CF5) // magicNumber
    w.writeUint16(flags)
    w.writeUint16(UPEM) // unitsPerEm
    w.writeUint32(0); w.writeUint32(0) // created
    w.writeUint32(0); w.writeUint32(0) // modified
    w.writeInt16(0) // xMin
    w.writeInt16(0) // yMin
    w.writeInt16(1000) // xMax
    w.writeInt16(1000) // yMax
    w.writeUint16(0) // macStyle
    w.writeUint16(8) // lowestRecPPEM
    w.writeInt16(2) // fontDirectionHint
    w.writeInt16(1) // indexToLocFormat (long)
    w.writeInt16(0) // glyphDataFormat
  })
}

export function buildMaxp(numGlyphs: number): Uint8Array {
  return buildTable(w => {
    w.writeUint32(0x00010000) // version 1.0
    w.writeUint16(numGlyphs)
    w.writeUint16(4096) // maxPoints
    w.writeUint16(256) // maxContours
    w.writeUint16(4096) // maxCompositePoints
    w.writeUint16(256) // maxCompositeContours
    w.writeUint16(2) // maxZones
    w.writeUint16(64) // maxTwilightPoints
    w.writeUint16(256) // maxStorage
    w.writeUint16(256) // maxFunctionDefs
    w.writeUint16(256) // maxInstructionDefs
    w.writeUint16(1024) // maxStackElements
    w.writeUint16(65535) // maxSizeOfInstructions
    w.writeUint16(256) // maxComponentElements
    w.writeUint16(32) // maxComponentDepth
  })
}

export function buildHhea(numberOfHMetrics: number): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1); w.writeUint16(0) // version
    w.writeInt16(800) // ascender
    w.writeInt16(-200) // descender
    w.writeInt16(0) // lineGap
    w.writeUint16(1000) // advanceWidthMax
    w.writeInt16(0) // minLeftSideBearing
    w.writeInt16(0) // minRightSideBearing
    w.writeInt16(0) // xMaxExtent
    w.writeInt16(1) // caretSlopeRise
    w.writeInt16(0) // caretSlopeRun
    w.writeInt16(0) // caretOffset
    w.writeInt16(0); w.writeInt16(0); w.writeInt16(0); w.writeInt16(0) // reserved
    w.writeInt16(0) // metricDataFormat
    w.writeUint16(numberOfHMetrics)
  })
}

export function buildHmtx(metrics: [number, number][]): Uint8Array {
  return buildTable(w => {
    for (const [aw, lsb] of metrics) {
      w.writeUint16(aw)
      w.writeInt16(lsb)
    }
  })
}

/** cmap with a single format 4 subtable mapping individual codepoints */
export function buildCmap4(mapping: [number, number][], platformId = 3, encodingId = 1): Uint8Array {
  const sorted = [...mapping].sort((a, b) => a[0] - b[0])
  const segCount = sorted.length + 1 // one segment per codepoint + terminator
  return buildTable(w => {
    w.writeUint16(0) // version
    w.writeUint16(1) // numTables
    w.writeUint16(platformId)
    w.writeUint16(encodingId)
    w.writeUint32(12) // subtable offset

    // format 4 subtable
    w.writeUint16(4) // format
    w.writeUint16(16 + segCount * 8) // length
    w.writeUint16(0) // language
    w.writeUint16(segCount * 2) // segCountX2
    const entrySelector = Math.floor(Math.log2(segCount))
    const searchRange = 2 * (1 << entrySelector)
    w.writeUint16(searchRange)
    w.writeUint16(entrySelector)
    w.writeUint16(segCount * 2 - searchRange)
    for (const [cp] of sorted) w.writeUint16(cp) // endCode
    w.writeUint16(0xFFFF)
    w.writeUint16(0) // reservedPad
    for (const [cp] of sorted) w.writeUint16(cp) // startCode
    w.writeUint16(0xFFFF)
    for (const [cp, gid] of sorted) w.writeInt16((gid - cp) & 0xFFFF) // idDelta
    w.writeInt16(1) // terminator idDelta (maps 0xFFFF -> 0)
    for (let i = 0; i < segCount; i++) w.writeUint16(0) // idRangeOffset
  })
}

export function buildOs2(): Uint8Array {
  return buildTable(w => {
    w.writeUint16(2) // version 2 (includes xHeight/capHeight)
    w.writeInt16(500) // avgCharWidth
    w.writeUint16(400) // weightClass
    w.writeUint16(5) // widthClass
    w.writeUint16(0) // fsType
    // subscript/superscript (8) + strikeout (2) + familyClass (1)
    for (let i = 0; i < 11; i++) w.writeInt16(0)
    // panose (10 bytes)
    for (let i = 0; i < 10; i++) w.writeUint8(0)
    // unicodeRange1-4
    for (let i = 0; i < 4; i++) w.writeUint32(0)
    w.writeTag('TEST') // achVendID
    w.writeUint16(0x0040) // fsSelection (REGULAR)
    w.writeUint16(0x0020) // firstCharIndex
    w.writeUint16(0xFFFF) // lastCharIndex
    w.writeInt16(800) // typoAscender
    w.writeInt16(-200) // typoDescender
    w.writeInt16(0) // typoLineGap
    w.writeUint16(800) // winAscent
    w.writeUint16(200) // winDescent
    w.writeUint32(0) // codePageRange1
    w.writeUint32(0) // codePageRange2
    w.writeInt16(500) // xHeight
    w.writeInt16(700) // capHeight
    w.writeUint16(0) // defaultChar
    w.writeUint16(32) // breakChar
    w.writeUint16(1) // maxContext
  })
}

export function buildPost(): Uint8Array {
  return buildTable(w => {
    w.writeUint32(0x00030000) // version 3.0
    w.writeUint32(0) // italicAngle
    w.writeInt16(-100) // underlinePosition
    w.writeInt16(50) // underlineThickness
    w.writeUint32(0) // isFixedPitch
    for (let i = 0; i < 4; i++) w.writeUint32(0) // memory hints
  })
}

export function buildName(): Uint8Array {
  const value = 'SynthTest'
  return buildTable(w => {
    w.writeUint16(0) // format
    w.writeUint16(2) // count
    w.writeUint16(6 + 2 * 12) // stringOffset
    // nameID 1 (family), then nameID 6 (PostScript name), same UTF-16BE string
    for (const nameId of [1, 6]) {
      w.writeUint16(3) // platformID
      w.writeUint16(1) // encodingID
      w.writeUint16(0x0409) // languageID
      w.writeUint16(nameId)
      w.writeUint16(value.length * 2) // length
      w.writeUint16(0) // offset
    }
    for (let i = 0; i < value.length; i++) w.writeUint16(value.charCodeAt(i))
  })
}

/** Builds long-format loca + glyf from per-glyph records (null = empty glyph) */
export function buildLocaGlyf(glyphs: (Uint8Array | null)[]): { loca: Uint8Array, glyf: Uint8Array } {
  const glyfW = new BinaryWriter()
  const offsets: number[] = [0]
  let pos = 0
  for (const g of glyphs) {
    if (g) {
      const padded = new Uint8Array((g.length + 3) & ~3)
      padded.set(g)
      glyfW.writeBytes(padded)
      pos += padded.length
    }
    offsets.push(pos)
  }
  const loca = buildTable(w => {
    for (const o of offsets) w.writeUint32(o)
  })
  return { loca, glyf: glyfW.toUint8Array() }
}

/**
 * Encodes a simple glyph (all points on-curve, int16 deltas)
 * @param instructions optional TrueType instruction bytecode
 */
export function encodeSimpleGlyph(
  points: [number, number][],
  endPts: number[],
  instructions?: Uint8Array,
): Uint8Array {
  const w = new BinaryWriter()
  w.writeInt16(endPts.length) // numberOfContours
  w.writeInt16(0) // xMin
  w.writeInt16(0) // yMin
  w.writeInt16(0) // xMax
  w.writeInt16(0) // yMax
  for (const e of endPts) w.writeUint16(e)
  const instr = instructions ?? new Uint8Array(0)
  w.writeUint16(instr.length)
  w.writeBytes(instr)
  for (let i = 0; i < points.length; i++) w.writeUint8(0x01) // on-curve, int16 deltas
  let prevX = 0
  for (const [x] of points) { w.writeInt16(x - prevX); prevX = x }
  let prevY = 0
  for (const [, y] of points) { w.writeInt16(y - prevY); prevY = y }
  return w.toUint8Array()
}

/**
 * Builds a complete loadable TrueType font.
 * @param glyphs glyf records per glyph ID (null = empty)
 * @param cmapping codepoint → glyph ID pairs
 * @param extraTables additional tables merged into the font
 */
export function buildTestFont(
  glyphs: (Uint8Array | null)[],
  cmapping: [number, number][],
  extraTables: [string, Uint8Array][] = [],
  headFlags = 0,
): ArrayBuffer {
  const { loca, glyf } = buildLocaGlyf(glyphs)
  const metrics: [number, number][] = glyphs.map(() => [600, 0])
  return buildFont([
    ['head', buildHead(headFlags)],
    ['maxp', buildMaxp(glyphs.length)],
    ['hhea', buildHhea(glyphs.length)],
    ['hmtx', buildHmtx(metrics)],
    ['cmap', buildCmap4(cmapping)],
    ['OS/2', buildOs2()],
    ['post', buildPost()],
    ['name', buildName()],
    ['loca', loca],
    ['glyf', glyf],
    ...extraTables,
  ])
}
