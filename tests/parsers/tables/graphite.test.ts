import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import {
  decompressLz4Block,
  compressLz4Block,
  compressGraphiteTable,
  parseGloc,
  parseGlat,
  parseSill,
  parseGraphiteFeat,
  parseSilf,
} from '../../../src/parsers/tables/graphite.js'

/**
 * Big-endian byte writer for building synthetic Graphite table binaries.
 */
class ByteWriter {
  private readonly bytes: number[] = []

  get length(): number {
    return this.bytes.length
  }

  u8(v: number): this {
    this.bytes.push(v & 0xff)
    return this
  }

  u16(v: number): this {
    this.bytes.push((v >>> 8) & 0xff, v & 0xff)
    return this
  }

  u32(v: number): this {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
    return this
  }

  tag(s: string): this {
    for (let i = 0; i < 4; i++) {
      this.bytes.push(s.charCodeAt(i))
    }
    return this
  }

  raw(arr: number[] | Uint8Array): this {
    for (let i = 0; i < arr.length; i++) {
      this.bytes.push(arr[i]!)
    }
    return this
  }

  toBytes(): number[] {
    return this.bytes
  }

  toBuffer(): ArrayBuffer {
    const buf = new ArrayBuffer(this.bytes.length)
    new Uint8Array(buf).set(this.bytes)
    return buf
  }
}

/** Encodes data as a valid LZ4 block consisting of pure literal sequences. */
function lz4EncodeLiterals(data: Uint8Array | number[]): number[] {
  const out: number[] = []
  const len = data.length
  if (len < 15) {
    out.push(len << 4)
  } else {
    out.push(0xf0)
    let rest = len - 15
    while (rest >= 255) {
      out.push(255)
      rest -= 255
    }
    out.push(rest)
  }
  for (let i = 0; i < len; i++) {
    out.push(data[i]!)
  }
  return out
}

/**
 * Wraps an uncompressed Graphite table (Silf 5.0 / Glat 3.0) in the
 * compressed layout: version word + (scheme 1 | full size) + an LZ4 block
 * that expands to the complete uncompressed table.
 */
function buildCompressedTable(uncompressed: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(uncompressed)
  const w = new ByteWriter()
  w.raw(bytes.subarray(0, 4))
  w.u32((1 << 27) | bytes.length)
  w.raw(lz4EncodeLiterals(bytes))
  return w.toBuffer()
}

// ---------------------------------------------------------------------------
// Gloc / Glat builders
// ---------------------------------------------------------------------------

function buildGlocTable(opts: {
  long?: boolean
  numAttribs?: number
  attribIds?: number[]
  locations: number[]
}): ArrayBuffer {
  const w = new ByteWriter()
  w.u32(0x00010000)
  let flags = 0
  if (opts.long) flags |= 1
  if (opts.attribIds) flags |= 2
  w.u16(flags)
  w.u16(opts.numAttribs ?? opts.attribIds?.length ?? 0)
  for (let i = 0; i < opts.locations.length; i++) {
    if (opts.long) {
      w.u32(opts.locations[i]!)
    } else {
      w.u16(opts.locations[i]!)
    }
  }
  if (opts.attribIds) {
    for (let i = 0; i < opts.attribIds.length; i++) {
      w.u16(opts.attribIds[i]!)
    }
  }
  return w.toBuffer()
}

/** Encodes one Glat version 1 attribute run (BYTE attNum / BYTE num). */
function glatRunV1(attNum: number, values: number[]): number[] {
  const w = new ByteWriter()
  w.u8(attNum).u8(values.length)
  for (let i = 0; i < values.length; i++) {
    w.u16(values[i]!)
  }
  return w.toBytes()
}

/** Encodes one Glat version 2/3 attribute run (USHORT attNum / USHORT num). */
function glatRunV2(attNum: number, values: number[]): number[] {
  const w = new ByteWriter()
  w.u16(attNum).u16(values.length)
  for (let i = 0; i < values.length; i++) {
    w.u16(values[i]!)
  }
  return w.toBytes()
}

/**
 * Builds a Glat table plus its matching short-format Gloc table from
 * per-glyph raw byte blocks.
 */
function buildGlatAndGloc(
  version: number,
  glyphBlocks: number[][],
  octaboxes = false,
): { glat: ArrayBuffer, gloc: ArrayBuffer } {
  const headerSize = version >= 0x00030000 ? 8 : 4
  const w = new ByteWriter()
  w.u32(version)
  if (version >= 0x00030000) {
    w.u32(octaboxes ? 1 : 0) // scheme 0 + octaboxes flag in bit 0
  }
  const locations: number[] = [headerSize]
  for (let i = 0; i < glyphBlocks.length; i++) {
    w.raw(glyphBlocks[i]!)
    locations.push(locations[i]! + glyphBlocks[i]!.length)
  }
  return {
    glat: w.toBuffer(),
    gloc: buildGlocTable({ locations }),
  }
}

// ---------------------------------------------------------------------------
// Sill builder
// ---------------------------------------------------------------------------

function buildSillTable(
  languages: { code: string, settings: [number, number][] }[],
): ArrayBuffer {
  const numLangs = languages.length
  const headerSize = 12
  const entriesSize = (numLangs + 1) * 8
  const w = new ByteWriter()
  w.u32(0x00010000)
  w.u16(numLangs)
  w.u16(0).u16(0).u16(0) // deprecated search fields

  let settingOffset = headerSize + entriesSize
  for (let i = 0; i < numLangs; i++) {
    const lang = languages[i]!
    for (let j = 0; j < 4; j++) {
      w.u8(j < lang.code.length ? lang.code.charCodeAt(j) : 0)
    }
    w.u16(lang.settings.length)
    w.u16(settingOffset)
    settingOffset += lang.settings.length * 8
  }
  // terminator entry
  w.u8(0).u8(0).u8(0).u8(0)
  w.u16(0)
  w.u16(settingOffset)

  for (let i = 0; i < numLangs; i++) {
    const settings = languages[i]!.settings
    for (let j = 0; j < settings.length; j++) {
      w.u32(settings[j]![0])
      w.u16(settings[j]![1])
      w.u16(0) // reserved pad
    }
  }
  return w.toBuffer()
}

// ---------------------------------------------------------------------------
// Graphite Feat builder
// ---------------------------------------------------------------------------

function buildGraphiteFeatTable(
  version: number,
  features: { id: number, flags: number, label: number, settings: [number, number][] }[],
): ArrayBuffer {
  const major = version >>> 16
  const recordSize = major >= 2 ? 16 : 12
  const headerSize = 12
  const w = new ByteWriter()
  w.u32(version)
  w.u16(features.length)
  w.u16(0)
  w.u32(0)

  let settingOffset = headerSize + features.length * recordSize
  for (let i = 0; i < features.length; i++) {
    const f = features[i]!
    if (major >= 2) {
      w.u32(f.id)
    } else {
      w.u16(f.id)
    }
    w.u16(f.settings.length)
    if (major >= 2) {
      w.u16(0) // reserved
    }
    w.u32(settingOffset)
    w.u16(f.flags)
    w.u16(f.label)
    settingOffset += f.settings.length * 4
  }
  for (let i = 0; i < features.length; i++) {
    const settings = features[i]!.settings
    for (let j = 0; j < settings.length; j++) {
      w.u16(settings[j]![0])
      w.u16(settings[j]![1])
    }
  }
  return w.toBuffer()
}

// ---------------------------------------------------------------------------
// Silf builder
// ---------------------------------------------------------------------------

interface SilfPassSpec {
  flags: number
  maxRuleLoop: number
  maxRuleContext: number
  maxBackup: number
  numRows: number
  numTransitional: number
  numSuccess: number
  numColumns: number
  ranges: [number, number, number][]
  oRuleMap: number[]
  ruleMap: number[]
  minRulePreContext: number
  maxRulePreContext: number
  startStates: number[]
  ruleSortKeys: number[]
  rulePreContext: number[]
  collisionThreshold: number
  oConstraints: number[]
  oActions: number[]
  stateTrans: number[]
  passConstraints: number[]
  ruleConstraints: number[]
  actions: number[]
  debug?: { dActions: number[], dStates: number[], dCols: number[] }
}

interface SilfSubSpec {
  maxGlyphId: number
  extraAscent: number
  extraDescent: number
  iSubst: number
  iPos: number
  iJust: number
  iBidi: number
  flags: number
  maxPreContext: number
  maxPostContext: number
  attrPseudo: number
  attrBreakWeight: number
  attrDirectionality: number
  attrMirroring: number
  attrSkipPasses: number
  jLevels: { stretch: number, shrink: number, step: number, weight: number, runto: number }[]
  numLigComp: number
  numUserDefn: number
  maxCompPerLig: number
  direction: number
  attCollisions: number
  critFeatures: number[]
  scriptTags: string[]
  lbGID: number
  pseudoMaps: [number, number][]
  linearClasses: number[][]
  lookupClasses: [number, number][][]
  passes: SilfPassSpec[]
}

function buildSilfClassMap(
  version: number,
  linearClasses: number[][],
  lookupClasses: [number, number][][],
): number[] {
  const numClass = linearClasses.length + lookupClasses.length
  const offW = version >= 0x00040000 ? 4 : 2
  const headSize = 4 + offW * (numClass + 1)

  const offsets: number[] = [headSize]
  for (let i = 0; i < linearClasses.length; i++) {
    offsets.push(offsets[offsets.length - 1]! + linearClasses[i]!.length * 2)
  }
  for (let i = 0; i < lookupClasses.length; i++) {
    offsets.push(offsets[offsets.length - 1]! + 8 + lookupClasses[i]!.length * 4)
  }

  const w = new ByteWriter()
  w.u16(numClass)
  w.u16(linearClasses.length)
  for (let i = 0; i <= numClass; i++) {
    if (offW === 4) {
      w.u32(offsets[i]!)
    } else {
      w.u16(offsets[i]!)
    }
  }
  for (let i = 0; i < linearClasses.length; i++) {
    const glyphs = linearClasses[i]!
    for (let j = 0; j < glyphs.length; j++) {
      w.u16(glyphs[j]!)
    }
  }
  for (let i = 0; i < lookupClasses.length; i++) {
    const pairs = lookupClasses[i]!
    let p2 = 1
    while (p2 * 2 <= pairs.length) p2 *= 2
    w.u16(pairs.length)
    w.u16(p2)
    w.u16(Math.log2(p2))
    w.u16(pairs.length - p2)
    for (let j = 0; j < pairs.length; j++) {
      w.u16(pairs[j]![0])
      w.u16(pairs[j]![1])
    }
  }
  return w.toBytes()
}

function buildSilfPass(p: SilfPassSpec, oPass: number): number[] {
  const numRules = p.ruleSortKeys.length
  const fsmSize =
    16 +
    6 * p.ranges.length +
    2 * p.oRuleMap.length +
    2 * p.ruleMap.length +
    2 +
    2 * p.startStates.length +
    2 * numRules +
    numRules +
    1 +
    2 +
    2 * (numRules + 1) * 2 +
    2 * p.stateTrans.length

  const pcCode = oPass + 24 + fsmSize + 1
  const rcCode = pcCode + p.passConstraints.length
  const aCode = rcCode + p.ruleConstraints.length
  const oDebug = p.debug ? aCode + p.actions.length : 0

  const w = new ByteWriter()
  w.u8(p.flags).u8(p.maxRuleLoop).u8(p.maxRuleContext).u8(p.maxBackup)
  w.u16(numRules)
  w.u16(24) // fsmOffset (numRows follows the fixed 24-byte pass header)
  w.u32(pcCode).u32(rcCode).u32(aCode).u32(oDebug)
  w.u16(p.numRows).u16(p.numTransitional).u16(p.numSuccess).u16(p.numColumns)
  w.u16(p.ranges.length)
  w.u16(0).u16(0).u16(0) // deprecated search fields
  for (let i = 0; i < p.ranges.length; i++) {
    w.u16(p.ranges[i]![0]).u16(p.ranges[i]![1]).u16(p.ranges[i]![2])
  }
  for (let i = 0; i < p.oRuleMap.length; i++) w.u16(p.oRuleMap[i]!)
  for (let i = 0; i < p.ruleMap.length; i++) w.u16(p.ruleMap[i]!)
  w.u8(p.minRulePreContext).u8(p.maxRulePreContext)
  for (let i = 0; i < p.startStates.length; i++) w.u16(p.startStates[i]!)
  for (let i = 0; i < numRules; i++) w.u16(p.ruleSortKeys[i]!)
  for (let i = 0; i < numRules; i++) w.u8(p.rulePreContext[i]!)
  w.u8(p.collisionThreshold)
  w.u16(p.passConstraints.length)
  for (let i = 0; i < p.oConstraints.length; i++) w.u16(p.oConstraints[i]!)
  for (let i = 0; i < p.oActions.length; i++) w.u16(p.oActions[i]!)
  for (let i = 0; i < p.stateTrans.length; i++) w.u16(p.stateTrans[i]!)
  w.u8(0) // reserved
  w.raw(p.passConstraints)
  w.raw(p.ruleConstraints)
  w.raw(p.actions)
  if (p.debug) {
    for (let i = 0; i < p.debug.dActions.length; i++) w.u16(p.debug.dActions[i]!)
    for (let i = 0; i < p.debug.dStates.length; i++) w.u16(p.debug.dStates[i]!)
    for (let i = 0; i < p.debug.dCols.length; i++) w.u16(p.debug.dCols[i]!)
  }
  return w.toBytes()
}

function buildSilfSubtable(version: number, s: SilfSubSpec): number[] {
  const numPasses = s.passes.length
  const v3 = version >= 0x00030000
  const headerSize =
    (v3 ? 8 : 0) +
    20 +
    8 * s.jLevels.length +
    10 +
    2 * s.critFeatures.length +
    2 +
    4 * s.scriptTags.length +
    2 +
    4 * (numPasses + 1) +
    8 +
    6 * s.pseudoMaps.length

  const classMap = buildSilfClassMap(version, s.linearClasses, s.lookupClasses)

  const passOffsets: number[] = [headerSize + classMap.length]
  const passBytes: number[][] = []
  for (let i = 0; i < numPasses; i++) {
    const pb = buildSilfPass(s.passes[i]!, passOffsets[i]!)
    passBytes.push(pb)
    passOffsets.push(passOffsets[i]! + pb.length)
  }

  const w = new ByteWriter()
  if (v3) {
    w.u32(0x00010000) // ruleVersion
    w.u16(headerSize - 6 * s.pseudoMaps.length - 8 - 4 * (numPasses + 1)) // passOffset
    w.u16(headerSize - 6 * s.pseudoMaps.length) // pseudosOffset
  }
  w.u16(s.maxGlyphId)
  w.u16(s.extraAscent).u16(s.extraDescent)
  w.u8(numPasses).u8(s.iSubst).u8(s.iPos).u8(s.iJust).u8(s.iBidi).u8(s.flags)
  w.u8(s.maxPreContext).u8(s.maxPostContext)
  w.u8(s.attrPseudo).u8(s.attrBreakWeight).u8(s.attrDirectionality).u8(s.attrMirroring).u8(s.attrSkipPasses)
  w.u8(s.jLevels.length)
  for (let i = 0; i < s.jLevels.length; i++) {
    const j = s.jLevels[i]!
    w.u8(j.stretch).u8(j.shrink).u8(j.step).u8(j.weight).u8(j.runto).u8(0).u8(0).u8(0)
  }
  w.u16(s.numLigComp)
  w.u8(s.numUserDefn).u8(s.maxCompPerLig).u8(s.direction + 1).u8(s.attCollisions)
  w.u8(0).u8(0).u8(0) // reserved
  w.u8(s.critFeatures.length)
  for (let i = 0; i < s.critFeatures.length; i++) w.u16(s.critFeatures[i]!)
  w.u8(0) // reserved
  w.u8(s.scriptTags.length)
  for (let i = 0; i < s.scriptTags.length; i++) w.tag(s.scriptTags[i]!)
  w.u16(s.lbGID)
  for (let i = 0; i <= numPasses; i++) w.u32(passOffsets[i]!)
  w.u16(s.pseudoMaps.length)
  w.u16(0).u16(0).u16(0) // deprecated searchPseudo/pseudoSelector/pseudoShift
  for (let i = 0; i < s.pseudoMaps.length; i++) {
    w.u32(s.pseudoMaps[i]![0])
    w.u16(s.pseudoMaps[i]![1])
  }
  if (w.length !== headerSize) {
    throw new Error(`Silf test builder: header size mismatch (${w.length} != ${headerSize})`)
  }
  w.raw(classMap)
  for (let i = 0; i < numPasses; i++) {
    w.raw(passBytes[i]!)
  }
  return w.toBytes()
}

function buildSilfTable(version: number, subSpecs: SilfSubSpec[], compilerVersion = 0): ArrayBuffer {
  const w = new ByteWriter()
  w.u32(version)
  if (version >= 0x00030000) {
    w.u32(compilerVersion) // for 5.0: scheme 0 in the top 5 bits
  }
  w.u16(subSpecs.length)
  w.u16(0) // reserved
  const headerSize = (version >= 0x00030000 ? 8 : 4) + 4 + 4 * subSpecs.length

  const subBytes: number[][] = []
  let offset = headerSize
  for (let i = 0; i < subSpecs.length; i++) {
    w.u32(offset)
    const sb = buildSilfSubtable(version, subSpecs[i]!)
    subBytes.push(sb)
    offset += sb.length
  }
  for (let i = 0; i < subBytes.length; i++) {
    w.raw(subBytes[i]!)
  }
  return w.toBuffer()
}

/** Baseline subtable spec with two passes exercising every structure. */
function makeSubSpec(): SilfSubSpec {
  return {
    maxGlyphId: 110,
    extraAscent: 10,
    extraDescent: 5,
    iSubst: 0,
    iPos: 1,
    iJust: 2,
    iBidi: 0xff,
    flags: 0x22,
    maxPreContext: 1,
    maxPostContext: 2,
    attrPseudo: 1,
    attrBreakWeight: 2,
    attrDirectionality: 3,
    attrMirroring: 4,
    attrSkipPasses: 5,
    jLevels: [{ stretch: 6, shrink: 7, step: 8, weight: 9, runto: 0 }],
    numLigComp: 4,
    numUserDefn: 2,
    maxCompPerLig: 3,
    direction: 1,
    attCollisions: 10,
    critFeatures: [1, 3],
    scriptTags: ['latn', 'arab'],
    lbGID: 3,
    pseudoMaps: [[0x200b, 101], [0x2028, 102]],
    linearClasses: [[5, 6, 7]],
    lookupClasses: [[[10, 0], [12, 1], [15, 2]]],
    passes: [
      {
        flags: 0x20,
        maxRuleLoop: 15,
        maxRuleContext: 4,
        maxBackup: 2,
        numRows: 4,
        numTransitional: 3,
        numSuccess: 2,
        numColumns: 3,
        ranges: [[10, 20, 0], [21, 30, 1], [40, 40, 2]],
        oRuleMap: [0, 1, 3],
        ruleMap: [0, 0, 1],
        minRulePreContext: 0,
        maxRulePreContext: 1,
        startStates: [0, 1],
        ruleSortKeys: [100, 200],
        rulePreContext: [1, 0],
        collisionThreshold: 8,
        oConstraints: [0, 1, 2],
        oActions: [0, 1, 2],
        stateTrans: [1, 2, 0, 3, 0, 0, 0, 3, 0],
        passConstraints: [0x32],
        ruleConstraints: [0x00, 0x32],
        actions: [0x32, 0x32],
      },
      {
        flags: 0,
        maxRuleLoop: 5,
        maxRuleContext: 1,
        maxBackup: 0,
        numRows: 2,
        numTransitional: 1,
        numSuccess: 1,
        numColumns: 1,
        ranges: [[1, 1, 0]],
        oRuleMap: [0, 1],
        ruleMap: [0],
        minRulePreContext: 0,
        maxRulePreContext: 0,
        startStates: [0],
        ruleSortKeys: [1],
        rulePreContext: [0],
        collisionThreshold: 0,
        oConstraints: [0, 0],
        oActions: [0, 1],
        stateTrans: [1],
        passConstraints: [],
        ruleConstraints: [],
        actions: [0x32],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LZ4 block decompressor', () => {
  it.each([0, 1, 14, 15, 270, 1024])('round-trips a %i-byte encoded block', (length) => {
    const source = new Uint8Array(length)
    for (let i = 0; i < source.length; i++) source[i] = (i * 29 + 7) & 0xff
    const compressed = compressLz4Block(source)
    const decoded = new Uint8Array(length)
    expect(decompressLz4Block(compressed, decoded, 0)).toBe(length)
    expect(decoded).toEqual(source)
  })
  // Verifies that a block consisting of a single literal sequence is copied through unchanged.
  it('should decompress a pure literal block', () => {
    const src = new Uint8Array([0x40, 1, 2, 3, 4])
    const dst = new Uint8Array(4)
    const written = decompressLz4Block(src, dst, 0)
    expect(written).toBe(4)
    expect(Array.from(dst)).toEqual([1, 2, 3, 4])
  })

  // Verifies match copying with an overlapping (RLE-style) offset of 1 followed by a final literal sequence.
  it('should decompress a block with an overlapping match', () => {
    // literals "AB", match offset=1 len=6, then final literal "C"
    const src = new Uint8Array([0x22, 0x41, 0x42, 0x01, 0x00, 0x10, 0x43])
    const dst = new Uint8Array(9)
    const written = decompressLz4Block(src, dst, 0)
    expect(written).toBe(9)
    expect(String.fromCharCode(...dst)).toBe('ABBBBBBBC')
  })

  // Verifies the extended literal length encoding (length >= 15 uses continuation bytes).
  it('should decompress a long literal run with length extension bytes', () => {
    const literals: number[] = []
    for (let i = 0; i < 20; i++) literals.push(i + 1)
    const src = new Uint8Array([0xf0, 5, ...literals])
    const dst = new Uint8Array(20)
    const written = decompressLz4Block(src, dst, 0)
    expect(written).toBe(20)
    expect(dst[0]).toBe(1)
    expect(dst[19]).toBe(20)
  })
})

describe('Gloc table parser', () => {
  // Verifies short-format locations and glyph count derivation from the table length.
  it('should parse short format locations', () => {
    const buf = buildGlocTable({ locations: [4, 10, 16, 16] })
    const gloc = parseGloc(new BinaryReader(buf))
    expect(gloc.version).toBe(0x00010000)
    expect(gloc.isLongFormat).toBe(false)
    expect(gloc.hasAttribIds).toBe(false)
    expect(gloc.numGlyphs).toBe(3)
    expect(Array.from(gloc.locations)).toEqual([4, 10, 16, 16])
    expect(gloc.attribIds).toBeNull()
  })

  // Verifies long-format (32-bit) locations selected via flags bit 0.
  it('should parse long format locations', () => {
    const buf = buildGlocTable({ long: true, locations: [8, 0x12345, 0x23456] })
    const gloc = parseGloc(new BinaryReader(buf))
    expect(gloc.isLongFormat).toBe(true)
    expect(gloc.numGlyphs).toBe(2)
    expect(Array.from(gloc.locations)).toEqual([8, 0x12345, 0x23456])
  })

  // Verifies that the trailing attribIds array (flags bit 1) is parsed and excluded from the locations count.
  it('should parse the attribIds array when flags bit 1 is set', () => {
    const buf = buildGlocTable({ locations: [4, 8, 12], attribIds: [256, 257, 258] })
    const gloc = parseGloc(new BinaryReader(buf))
    expect(gloc.hasAttribIds).toBe(true)
    expect(gloc.numAttribs).toBe(3)
    expect(gloc.numGlyphs).toBe(2)
    expect(Array.from(gloc.attribIds!)).toEqual([256, 257, 258])
  })

  // Verifies that an unknown major version is rejected.
  it('should throw on an unsupported version', () => {
    const w = new ByteWriter()
    w.u32(0x00020000).u16(0).u16(0).u16(4).u16(4)
    expect(() => parseGloc(new BinaryReader(w.toBuffer()))).toThrow(/Unsupported Gloc/)
  })
})

describe('Glat table parser', () => {
  // Verifies version 1 byte-sized run headers and attribute lookup through Gloc.
  it('should parse version 1 byte-run entries', () => {
    const { glat, gloc } = buildGlatAndGloc(0x00010000, [
      glatRunV1(1, [10, 20, 30]),
      [...glatRunV1(2, [5]), ...glatRunV1(7, [-3 & 0xffff])],
    ])
    const table = parseGlat(new BinaryReader(glat), parseGloc(new BinaryReader(gloc)))
    expect(table.version).toBe(0x00010000)
    expect(table.hasOctaboxes).toBe(false)

    const g0 = table.getGlyphAttrs(0)
    expect(g0.octabox).toBeNull()
    expect(g0.runs).toHaveLength(1)
    expect(g0.runs[0]!.firstAttr).toBe(1)
    expect(Array.from(g0.runs[0]!.values)).toEqual([10, 20, 30])

    expect(table.getAttr(0, 1)).toBe(10)
    expect(table.getAttr(0, 3)).toBe(30)
    expect(table.getAttr(1, 2)).toBe(5)
    expect(table.getAttr(1, 7)).toBe(-3)
  })

  // Verifies version 2 USHORT run headers, attribute numbers above 255, negative values, and the sparse default 0.
  it('should parse version 2 ushort-run entries', () => {
    const { glat, gloc } = buildGlatAndGloc(0x00020000, [
      [...glatRunV2(300, [-100 & 0xffff, 200]), ...glatRunV2(1000, [42])],
      [],
    ])
    const table = parseGlat(new BinaryReader(glat), parseGloc(new BinaryReader(gloc)))

    expect(table.getAttr(0, 300)).toBe(-100)
    expect(table.getAttr(0, 301)).toBe(200)
    expect(table.getAttr(0, 1000)).toBe(42)
    // Attributes not stored in any run are 0 (sparse array semantics)
    expect(table.getAttr(0, 302)).toBe(0)
    expect(table.getAttr(0, 5)).toBe(0)
    // Empty glyph block: no runs at all
    expect(table.getGlyphAttrs(1).runs).toHaveLength(0)
    expect(table.getAttr(1, 300)).toBe(0)
  })

  // Verifies version 3 octabox metrics: bitmap, whole-glyph diagonals, per-bit subbox entries, and runs following them.
  it('should parse version 3 octaboxes before the attribute runs', () => {
    const octabox = new ByteWriter()
    octabox.u16(0x8001) // subboxes at bit 0 and bit 15
    octabox.u8(10).u8(20).u8(30).u8(40) // whole-glyph diagonals
    octabox.u8(1).u8(2).u8(3).u8(4).u8(5).u8(6).u8(7).u8(8) // subbox for bit 0
    octabox.u8(9).u8(10).u8(11).u8(12).u8(13).u8(14).u8(15).u8(16) // subbox for bit 15

    const { glat, gloc } = buildGlatAndGloc(
      0x00030000,
      [[...octabox.toBytes(), ...glatRunV2(1, [77])], []],
      true,
    )
    const table = parseGlat(new BinaryReader(glat), parseGloc(new BinaryReader(gloc)))
    expect(table.version).toBe(0x00030000)
    expect(table.hasOctaboxes).toBe(true)

    const g0 = table.getGlyphAttrs(0)
    expect(g0.octabox).not.toBeNull()
    expect(g0.octabox!.subboxBitmap).toBe(0x8001)
    expect(g0.octabox!.diagNegMin).toBe(10)
    expect(g0.octabox!.diagNegMax).toBe(20)
    expect(g0.octabox!.diagPosMin).toBe(30)
    expect(g0.octabox!.diagPosMax).toBe(40)
    expect(g0.octabox!.subboxes).toHaveLength(2)
    expect(g0.octabox!.subboxes[0]).toEqual({
      left: 1, right: 2, bottom: 3, top: 4,
      diagNegMin: 5, diagNegMax: 6, diagPosMin: 7, diagPosMax: 8,
    })
    expect(g0.octabox!.subboxes[1]!.left).toBe(9)
    expect(g0.octabox!.subboxes[1]!.diagPosMax).toBe(16)
    expect(table.getAttr(0, 1)).toBe(77)

    // Empty glyph block: no octabox and no runs
    const g1 = table.getGlyphAttrs(1)
    expect(g1.octabox).toBeNull()
    expect(g1.runs).toHaveLength(0)
  })

  // Verifies that an LZ4-compressed version 3 table decompresses to the same attribute data as its uncompressed form.
  it('should parse an LZ4-compressed version 3 table', () => {
    const { glat, gloc } = buildGlatAndGloc(0x00030000, [
      [0, 0, 0, 0, 0, 0, ...glatRunV2(1, [10, 20])],
      [0, 0, 0, 0, 0, 0, ...glatRunV2(5, [-1 & 0xffff])],
    ], true)
    const compressed = buildCompressedTable(glat)
    const glocTable = parseGloc(new BinaryReader(gloc))
    const table = parseGlat(new BinaryReader(compressed), glocTable)
    expect(table.hasOctaboxes).toBe(true)
    expect(table.getAttr(0, 1)).toBe(10)
    expect(table.getAttr(0, 2)).toBe(20)
    expect(table.getAttr(1, 5)).toBe(-1)
  })

  it('should parse a version 3 table produced by the public compressor', () => {
    const { glat, gloc } = buildGlatAndGloc(0x00030000, [[0, 0, 0, 0, 0, 0]], true)
    const glocTable = parseGloc(new BinaryReader(gloc))
    const compressed = compressGraphiteTable(new Uint8Array(glat), 'Glat')
    expect(parseGlat(new BinaryReader(compressed.buffer), glocTable).getGlyphAttrs(0))
      .toEqual(parseGlat(new BinaryReader(glat), glocTable).getGlyphAttrs(0))
  })

  // Verifies that an unknown compression scheme is rejected.
  it('should throw on an unsupported compression scheme', () => {
    const { glat, gloc } = buildGlatAndGloc(0x00030000, [glatRunV2(1, [10])])
    const bytes = new Uint8Array(glat)
    const w = new ByteWriter()
    w.raw(bytes.subarray(0, 4))
    w.u32((2 << 27) | bytes.length) // scheme 2 is not defined
    w.raw(bytes.subarray(8))
    const glocTable = parseGloc(new BinaryReader(gloc))
    expect(() => parseGlat(new BinaryReader(w.toBuffer()), glocTable)).toThrow(/compression scheme/)
  })

  // Verifies that a glyph ID outside the Gloc range raises an error instead of returning bogus data.
  it('should throw for a glyph ID outside the Gloc range', () => {
    const { glat, gloc } = buildGlatAndGloc(0x00020000, [glatRunV2(1, [10])])
    const table = parseGlat(new BinaryReader(glat), parseGloc(new BinaryReader(gloc)))
    expect(() => table.getGlyphAttrs(1)).toThrow(/out of Gloc range/)
  })

  // Verifies that an unknown major version is rejected.
  it('should throw on an unsupported version', () => {
    const w = new ByteWriter()
    w.u32(0x00040000)
    const gloc = parseGloc(new BinaryReader(buildGlocTable({ locations: [4, 4] })))
    expect(() => parseGlat(new BinaryReader(w.toBuffer()), gloc)).toThrow(/Unsupported Glat/)
  })
})

describe('Sill table parser', () => {
  // Verifies language entries with NUL-padded codes and their resolved feature settings.
  it('should parse languages with feature settings', () => {
    const buf = buildSillTable([
      { code: 'en', settings: [[0x6c696761, 1], [0x736d6370, 0]] },
      { code: 'tur', settings: [[0x6c696761, 2]] },
    ])
    const sill = parseSill(new BinaryReader(buf))
    expect(sill.version).toBe(0x00010000)
    expect(sill.languages).toHaveLength(2)
    expect(sill.languages[0]!.langCode).toBe('en')
    expect(sill.languages[1]!.langCode).toBe('tur')

    const en = sill.getFeatures('en')
    expect(en).not.toBeNull()
    expect(en).toHaveLength(2)
    expect(en![0]!.featureId).toBe(0x6c696761)
    expect(en![0]!.value).toBe(1)
    expect(en![1]!.featureId).toBe(0x736d6370)
    expect(en![1]!.value).toBe(0)

    const tur = sill.getFeatures('tur')
    expect(tur).toHaveLength(1)
    expect(tur![0]!.value).toBe(2)
  })

  // Verifies that negative default values survive the SHORT decoding.
  it('should parse negative feature values', () => {
    const buf = buildSillTable([{ code: 'ja', settings: [[42, -5 & 0xffff]] }])
    const sill = parseSill(new BinaryReader(buf))
    expect(sill.getFeatures('ja')![0]!.value).toBe(-5)
  })

  // Verifies that an unknown language code yields null.
  it('should return null for an unknown language', () => {
    const buf = buildSillTable([{ code: 'en', settings: [] }])
    const sill = parseSill(new BinaryReader(buf))
    expect(sill.getFeatures('xx')).toBeNull()
  })

  // Verifies that an unknown major version is rejected.
  it('should throw on an unsupported version', () => {
    const w = new ByteWriter()
    w.u32(0x00020000).u16(0).u16(0).u16(0).u16(0)
    expect(() => parseSill(new BinaryReader(w.toBuffer()))).toThrow(/Unsupported Sill/)
  })
})

describe('Graphite Feat table parser', () => {
  // Verifies version 1.0 records with USHORT feature IDs and their settings.
  it('should parse a version 1.0 table', () => {
    const buf = buildGraphiteFeatTable(0x00010000, [
      { id: 1, flags: 0, label: 256, settings: [[0, 257], [1, 258]] },
      { id: 2, flags: 0, label: 259, settings: [[0, 260]] },
    ])
    const feat = parseGraphiteFeat(new BinaryReader(buf))
    expect(feat.version).toBe(0x00010000)
    expect(feat.features).toHaveLength(2)
    expect(feat.features[0]!.id).toBe(1)
    expect(feat.features[0]!.label).toBe(256)
    expect(feat.features[0]!.settings).toHaveLength(2)
    expect(feat.features[0]!.settings[1]).toEqual({ value: 1, label: 258 })
    expect(feat.features[1]!.settings[0]).toEqual({ value: 0, label: 260 })
  })

  // Verifies version 2.0 records with ULONG (tag-style) feature IDs, the inserted reserved field, and getFeature lookup.
  it('should parse a version 2.0 table with ULONG feature IDs', () => {
    const liga = 0x6c696761
    const buf = buildGraphiteFeatTable(0x00020000, [
      { id: liga, flags: 0, label: 300, settings: [[0, 301], [1, 302], [-1 & 0xffff, 303]] },
    ])
    const feat = parseGraphiteFeat(new BinaryReader(buf))
    expect(feat.version).toBe(0x00020000)
    expect(feat.features[0]!.id).toBe(liga)

    const f = feat.getFeature(liga)
    expect(f).not.toBeNull()
    expect(f!.label).toBe(300)
    expect(f!.settings).toHaveLength(3)
    expect(f!.settings[2]!.value).toBe(-1)
    expect(feat.getFeature(0x12345678)).toBeNull()
  })

  // Verifies that the version 2.1 alias flag (bit 0) is exposed.
  it('should expose the alias flag of version 2.1', () => {
    const buf = buildGraphiteFeatTable(0x00020001, [
      { id: 100, flags: 0, label: 1, settings: [] },
      { id: 200, flags: 1, label: 1, settings: [] },
    ])
    const feat = parseGraphiteFeat(new BinaryReader(buf))
    expect(feat.version).toBe(0x00020001)
    expect(feat.features[0]!.flags & 1).toBe(0)
    expect(feat.features[1]!.flags & 1).toBe(1)
  })

  // Verifies that numFeat=0 parses to an empty feature list.
  it('should handle an empty feature list', () => {
    const buf = buildGraphiteFeatTable(0x00020000, [])
    const feat = parseGraphiteFeat(new BinaryReader(buf))
    expect(feat.features).toHaveLength(0)
    expect(feat.getFeature(1)).toBeNull()
  })

  // Verifies that an unknown major version is rejected.
  it('should throw on an unsupported version', () => {
    const w = new ByteWriter()
    w.u32(0x00030000).u16(0).u16(0).u32(0)
    expect(() => parseGraphiteFeat(new BinaryReader(w.toBuffer()))).toThrow(/Unsupported Graphite Feat/)
  })
})

describe('Silf table parser', () => {
  // Verifies the complete version 2.0 structure: subtable header, justification levels,
  // critical features, script tags, pseudo maps, class map with USHORT offsets, and both passes.
  it('should parse a version 2.0 table', () => {
    const buf = buildSilfTable(0x00020000, [makeSubSpec()])
    const silf = parseSilf(new BinaryReader(buf))
    expect(silf.version).toBe(0x00020000)
    expect(silf.compilerVersion).toBe(0)
    expect(silf.subtables).toHaveLength(1)

    const sub = silf.subtables[0]!
    expect(sub.ruleVersion).toBe(0) // version 3.0+ field
    expect(sub.maxGlyphId).toBe(110)
    expect(sub.extraAscent).toBe(10)
    expect(sub.extraDescent).toBe(5)
    expect(sub.numPasses).toBe(2)
    expect(sub.iSubst).toBe(0)
    expect(sub.iPos).toBe(1)
    expect(sub.iJust).toBe(2)
    expect(sub.iBidi).toBe(0xff)
    expect(sub.flags).toBe(0x22)
    expect(sub.maxPreContext).toBe(1)
    expect(sub.maxPostContext).toBe(2)
    expect(sub.attrPseudo).toBe(1)
    expect(sub.attrBreakWeight).toBe(2)
    expect(sub.attrDirectionality).toBe(3)
    expect(sub.attrMirroring).toBe(4)
    expect(sub.attrSkipPasses).toBe(5)
    expect(sub.jLevels).toHaveLength(1)
    expect(sub.jLevels[0]).toEqual({ attrStretch: 6, attrShrink: 7, attrStep: 8, attrWeight: 9, runto: 0 })
    expect(sub.numLigComp).toBe(4)
    expect(sub.numUserDefn).toBe(2)
    expect(sub.maxCompPerLig).toBe(3)
    expect(sub.direction).toBe(1)
    expect(sub.attCollisions).toBe(10)
    expect(Array.from(sub.critFeatures)).toEqual([1, 3])
    expect(sub.scriptTags).toEqual(['latn', 'arab'])
    expect(sub.lbGID).toBe(3)
    expect(sub.pseudoMaps).toHaveLength(2)
    expect(sub.pseudoMaps[0]).toEqual({ unicode: 0x200b, pseudoGlyph: 101 })
    expect(sub.pseudoMaps[1]).toEqual({ unicode: 0x2028, pseudoGlyph: 102 })
  })

  // Verifies class map parsing: linear glyph arrays and binary-search lookup classes.
  it('should parse the class map with linear and lookup classes', () => {
    const buf = buildSilfTable(0x00020000, [makeSubSpec()])
    const sub = parseSilf(new BinaryReader(buf)).subtables[0]!

    const cm = sub.classMap
    expect(cm.numClass).toBe(2)
    expect(cm.numLinear).toBe(1)
    expect(cm.offsets).toHaveLength(3)
    expect(cm.linearClasses).toHaveLength(1)
    expect(Array.from(cm.linearClasses[0]!)).toEqual([5, 6, 7])
    expect(cm.lookupClasses).toHaveLength(1)
    expect(cm.lookupClasses[0]!.numIds).toBe(3)
    expect(Array.from(cm.lookupClasses[0]!.glyphIds)).toEqual([10, 12, 15])
    expect(Array.from(cm.lookupClasses[0]!.indices)).toEqual([0, 1, 2])
  })

  // Verifies the pass data model: FSM matrices, rule maps, sort keys, and the
  // constraint/action bytecode blocks located via the subtable-relative offsets.
  it('should parse pass FSM structures and bytecode blocks', () => {
    const buf = buildSilfTable(0x00020000, [makeSubSpec()])
    const sub = parseSilf(new BinaryReader(buf)).subtables[0]!
    expect(sub.passes).toHaveLength(2)
    expect(Array.from(sub.oPasses)).toHaveLength(3)

    const p0 = sub.passes[0]!
    expect(p0.flags).toBe(0x20)
    expect(p0.maxRuleLoop).toBe(15)
    expect(p0.maxRuleContext).toBe(4)
    expect(p0.maxBackup).toBe(2)
    expect(p0.numRules).toBe(2)
    expect(p0.fsmOffset).toBe(24)
    expect(p0.numRows).toBe(4)
    expect(p0.numTransitional).toBe(3)
    expect(p0.numSuccess).toBe(2)
    expect(p0.numColumns).toBe(3)
    expect(p0.ranges).toHaveLength(3)
    expect(p0.ranges[1]).toEqual({ firstId: 21, lastId: 30, colId: 1 })
    expect(Array.from(p0.oRuleMap)).toEqual([0, 1, 3])
    expect(Array.from(p0.ruleMap)).toEqual([0, 0, 1])
    expect(p0.minRulePreContext).toBe(0)
    expect(p0.maxRulePreContext).toBe(1)
    expect(Array.from(p0.startStates)).toEqual([0, 1])
    expect(Array.from(p0.ruleSortKeys)).toEqual([100, 200])
    expect(Array.from(p0.rulePreContext)).toEqual([1, 0])
    expect(p0.collisionThreshold).toBe(8)
    expect(Array.from(p0.stateTransitions)).toEqual([1, 2, 0, 3, 0, 0, 0, 3, 0])

    // Bytecode blocks with their per-rule offset metadata
    expect(p0.passConstraintLength).toBe(1)
    expect(Array.from(p0.passConstraints)).toEqual([0x32])
    expect(Array.from(p0.oConstraints)).toEqual([0, 1, 2])
    expect(Array.from(p0.ruleConstraints)).toEqual([0x00, 0x32])
    expect(Array.from(p0.oActions)).toEqual([0, 1, 2])
    expect(Array.from(p0.actions)).toEqual([0x32, 0x32])
    expect(p0.oDebug).toBe(0)
    expect(p0.debug).toBeNull()

    // The second pass ends at oPasses[2], bounding its action block
    const p1 = sub.passes[1]!
    expect(p1.numRules).toBe(1)
    expect(Array.from(p1.passConstraints)).toEqual([])
    expect(Array.from(p1.ruleConstraints)).toEqual([])
    expect(Array.from(p1.actions)).toEqual([0x32])
    expect(Array.from(p1.stateTransitions)).toEqual([1])
  })

  // Verifies the debug arrays when oDebug is non-zero (dActions/dStates/dCols name indices).
  it('should parse pass debug arrays when oDebug is set', () => {
    const spec = makeSubSpec()
    spec.passes[0]!.debug = {
      dActions: [400, 401],
      dStates: [500, 501],
      dCols: [600, 601, 602, 603],
    }
    const buf = buildSilfTable(0x00020000, [spec])
    const p0 = parseSilf(new BinaryReader(buf)).subtables[0]!.passes[0]!
    expect(p0.oDebug).not.toBe(0)
    expect(p0.debug).not.toBeNull()
    expect(Array.from(p0.debug!.dActions)).toEqual([400, 401])
    expect(Array.from(p0.debug!.dStates)).toEqual([500, 501])
    expect(Array.from(p0.debug!.dCols)).toEqual([600, 601, 602, 603])
    // Actions still end at oDebug rather than at the pass end
    expect(Array.from(p0.actions)).toEqual([0x32, 0x32])
  })

  // Verifies the version 3.0 header additions: compilerVersion, ruleVersion, passOffset and pseudosOffset.
  it('should parse a version 3.0 table with the extended subtable header', () => {
    const buf = buildSilfTable(0x00030000, [makeSubSpec()], 0x00040001)
    const silf = parseSilf(new BinaryReader(buf))
    expect(silf.version).toBe(0x00030000)
    expect(silf.compilerVersion).toBe(0x00040001)

    const sub = silf.subtables[0]!
    expect(sub.ruleVersion).toBe(0x00010000)
    expect(sub.passOffset).toBeGreaterThan(0)
    expect(sub.pseudosOffset).toBeGreaterThan(sub.passOffset)
    // The header offsets must locate the arrays they describe
    expect(sub.passOffset).toBe(sub.pseudosOffset - 8 - 4 * (sub.numPasses + 1))
    expect(sub.maxGlyphId).toBe(110)
    expect(Array.from(sub.passes[0]!.actions)).toEqual([0x32, 0x32])
  })

  // Verifies version 5.0: the scheme/compilerVersion word and ULONG class map offsets (4.0+).
  it('should parse an uncompressed version 5.0 table', () => {
    const buf = buildSilfTable(0x00050000, [makeSubSpec()], 0x00040001)
    const silf = parseSilf(new BinaryReader(buf))
    expect(silf.version).toBe(0x00050000)
    expect(silf.compilerVersion).toBe(0x00040001)

    const sub = silf.subtables[0]!
    expect(Array.from(sub.classMap.linearClasses[0]!)).toEqual([5, 6, 7])
    expect(Array.from(sub.classMap.lookupClasses[0]!.glyphIds)).toEqual([10, 12, 15])
    expect(Array.from(sub.passes[0]!.actions)).toEqual([0x32, 0x32])
    expect(Array.from(sub.passes[1]!.actions)).toEqual([0x32])
  })

  // Verifies that an LZ4-compressed version 5.0 table parses identically to its uncompressed form.
  it('should parse an LZ4-compressed version 5.0 table', () => {
    const uncompressed = buildSilfTable(0x00050000, [makeSubSpec()], 0x00040001)
    const compressed = buildCompressedTable(uncompressed)
    const silf = parseSilf(new BinaryReader(compressed))
    const reference = parseSilf(new BinaryReader(uncompressed))

    expect(silf.version).toBe(0x00050000)
    expect(silf.compilerVersion).toBe(0x00040001)
    expect(silf.subtables).toHaveLength(1)
    expect(silf.subtables[0]).toEqual(reference.subtables[0])
  })

  it('should parse a version 5.0 table produced by the public compressor', () => {
    const uncompressed = buildSilfTable(0x00050000, [makeSubSpec()], 0x00040001)
    const compressed = compressGraphiteTable(new Uint8Array(uncompressed), 'Silf')
    const actual = parseSilf(new BinaryReader(compressed.buffer))
    const expected = parseSilf(new BinaryReader(uncompressed))
    expect(actual.subtables[0]!.passes.length).toBe(expected.subtables[0]!.passes.length)
    expect(actual.subtables[0]!.classes).toEqual(expected.subtables[0]!.classes)
  })

  // Verifies that versions outside the supported 2.0-5.x range are rejected.
  it('should throw on unsupported versions', () => {
    const w1 = new ByteWriter()
    w1.u32(0x00010000).u16(0).u16(0)
    expect(() => parseSilf(new BinaryReader(w1.toBuffer()))).toThrow(/Unsupported Silf/)

    const w6 = new ByteWriter()
    w6.u32(0x00060000).u32(0).u16(0).u16(0)
    expect(() => parseSilf(new BinaryReader(w6.toBuffer()))).toThrow(/Unsupported Silf/)
  })

  it.each([0x1a, 0x2f, 0x39, 0x3a])('rejects Graphite2 non-implemented opcode 0x%s while loading', (opcode) => {
    const spec = makeSubSpec()
    spec.passes[0]!.actions[0] = opcode
    expect(() => parseSilf(new BinaryReader(buildSilfTable(0x00020000, [spec]))))
      .toThrow(/invalid opcode/)
  })

  it('rejects truncated VM instructions while loading', () => {
    const spec = makeSubSpec()
    spec.passes[0]!.actions.splice(0, 2, 0x05, 0x00)
    expect(() => parseSilf(new BinaryReader(buildSilfTable(0x00020000, [spec]))))
      .toThrow(/truncated opcode/)
  })

  it('rejects VM programs without a terminal return opcode', () => {
    const spec = makeSubSpec()
    spec.passes[0]!.actions[0] = 0x00
    expect(() => parseSilf(new BinaryReader(buildSilfTable(0x00020000, [spec]))))
      .toThrow(/missing a return opcode/)
  })

  it('rejects invalid pass-state dimensions before allocating FSM arrays', () => {
    const spec = makeSubSpec()
    spec.passes[0]!.numRows = 1
    spec.passes[0]!.numTransitional = 2
    expect(() => parseSilf(new BinaryReader(buildSilfTable(0x00050000, [spec]))))
      .toThrow(/pass dimensions/)
  })

  it('rejects subtable offsets that point back into the Silf directory', () => {
    const bytes = new Uint8Array(buildSilfTable(0x00050000, [makeSubSpec()]))
    new DataView(bytes.buffer).setUint32(12, 12, false)
    expect(() => parseSilf(new BinaryReader(bytes.buffer))).toThrow(/subtable offsets/)
  })

  it('keeps deterministic malformed mutations bounded and reproducible', () => {
    const source = new Uint8Array(buildSilfTable(0x00050000, [makeSubSpec()], 0x00040001))
    let rejected = 0
    for (let iteration = 0; iteration < 512; iteration++) {
      const bytes = new Uint8Array(source)
      const offset = (iteration * 1103515245 + 12345) >>> 0
      const index = offset % bytes.length
      bytes[index] = bytes[index]! ^ (1 << (iteration & 7))
      try {
        parseSilf(new BinaryReader(bytes.buffer))
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        rejected++
      }
    }
    expect(rejected).toBeGreaterThan(240)
  })
})
