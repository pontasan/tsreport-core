import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSfntDirectory, getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseFont } from '../../../src/parsers/index.js'
import { parseOs2, syntheticOs2, validateOs2Conformance } from '../../../src/parsers/tables/os2.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { SfntTableManager } from '../../../src/parsers/ttf-parser.js'

const NOTO_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-Regular.ttf')
const ROBOTO_PATH = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
const SOURCE_SANS_PATH = resolve(__dirname, '../../fixtures/fonts/SourceSans3-Regular.otf')

describe('OS/2 table parser', () => {
  describe('NotoSans-Regular (TrueType)', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const reader = getTableReader(sfnt, 'OS/2')!
    const os2 = parseOs2(reader)

    it('should have weightClass 400 for Regular weight', () => {
      expect(os2.weightClass).toBe(400)
    })

    it('should have widthClass 5 (normal)', () => {
      expect(os2.widthClass).toBe(5)
    })

    it('should have fsSelection bit 6 set for Regular', () => {
      // Bit 6 (0x0040) = REGULAR
      const regularBit = os2.fsSelection & 0x0040
      expect(regularBit).toBe(0x0040)
    })

    it('should NOT have italic or bold bits set for Regular', () => {
      // Bit 0 (0x0001) = ITALIC
      expect(os2.fsSelection & 0x0001).toBe(0)
      // Bit 5 (0x0020) = BOLD
      expect(os2.fsSelection & 0x0020).toBe(0)
    })

    it('should have positive typoAscender', () => {
      expect(os2.typoAscender).toBeGreaterThan(0)
    })

    it('should have negative typoDescender', () => {
      expect(os2.typoDescender).toBeLessThan(0)
    })

    it('should have non-negative typoLineGap', () => {
      expect(os2.typoLineGap).toBeGreaterThanOrEqual(0)
    })

    it('should have positive winAscent', () => {
      expect(os2.winAscent).toBeGreaterThan(0)
    })

    it('should have non-negative winDescent', () => {
      // winDescent is unsigned and represents a positive distance below baseline
      expect(os2.winDescent).toBeGreaterThanOrEqual(0)
    })

    it('should have panose of 10 bytes', () => {
      expect(os2.panose).toBeInstanceOf(Uint8Array)
      expect(os2.panose.length).toBe(10)
    })

    it('should have achVendID of 4 characters', () => {
      expect(os2.achVendID).toHaveLength(4)
    })

    it('should have reasonable firstCharIndex and lastCharIndex', () => {
      expect(os2.firstCharIndex).toBeGreaterThanOrEqual(0)
      expect(os2.lastCharIndex).toBeGreaterThan(os2.firstCharIndex)
      // firstCharIndex is typically 0x0020 (space) or lower
      expect(os2.firstCharIndex).toBeLessThanOrEqual(0x0100)
      // lastCharIndex should be a reasonable unicode value
      expect(os2.lastCharIndex).toBeLessThanOrEqual(0xFFFF)
    })

    it('should have version >= 2', () => {
      expect(os2.version).toBeGreaterThanOrEqual(2)
    })

    it('should have positive capHeight for version >= 2', () => {
      expect(os2.capHeight).toBeGreaterThan(0)
    })

    it('should have positive xHeight for version >= 2', () => {
      expect(os2.xHeight).toBeGreaterThan(0)
    })

    it('should have xHeight < capHeight', () => {
      expect(os2.xHeight).toBeLessThan(os2.capHeight)
    })

    it('should have non-negative avgCharWidth', () => {
      expect(os2.avgCharWidth).toBeGreaterThan(0)
    })

    it('should have reasonable subscript/superscript sizes', () => {
      expect(os2.subscriptXSize).toBeGreaterThan(0)
      expect(os2.subscriptYSize).toBeGreaterThan(0)
      expect(os2.superscriptXSize).toBeGreaterThan(0)
      expect(os2.superscriptYSize).toBeGreaterThan(0)
    })

    it('should have positive strikeoutSize', () => {
      expect(os2.strikeoutSize).toBeGreaterThan(0)
    })
  })

  describe('Roboto-Regular (TrueType)', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const sfnt = parseSfntDirectory(buffer)
    const os2 = parseOs2(getTableReader(sfnt, 'OS/2')!)

    it('should have weightClass 400 for Regular weight', () => {
      expect(os2.weightClass).toBe(400)
    })

    it('should have widthClass 5 (normal)', () => {
      expect(os2.widthClass).toBe(5)
    })

    it('should have fsSelection bit 6 set for Regular', () => {
      expect(os2.fsSelection & 0x0040).toBe(0x0040)
    })

    it('should have positive typoAscender and negative typoDescender', () => {
      expect(os2.typoAscender).toBeGreaterThan(0)
      expect(os2.typoDescender).toBeLessThan(0)
    })

    it('should have panose of 10 bytes', () => {
      expect(os2.panose.length).toBe(10)
    })

    it('should have achVendID of 4 characters', () => {
      expect(os2.achVendID).toHaveLength(4)
    })
  })

  describe('SourceSans3-Regular (OTF/CFF)', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const sfnt = parseFont(buffer)
    const os2 = parseOs2(getTableReader(sfnt, 'OS/2')!)

    it('should have weightClass 400 for Regular weight', () => {
      expect(os2.weightClass).toBe(400)
    })

    it('should have widthClass 5 (normal)', () => {
      expect(os2.widthClass).toBe(5)
    })

    it('should have positive typoAscender', () => {
      expect(os2.typoAscender).toBeGreaterThan(0)
    })

    it('should have negative typoDescender', () => {
      expect(os2.typoDescender).toBeLessThan(0)
    })

    it('should have panose of 10 bytes', () => {
      expect(os2.panose).toBeInstanceOf(Uint8Array)
      expect(os2.panose.length).toBe(10)
    })

    it('should have achVendID of 4 characters', () => {
      expect(os2.achVendID).toHaveLength(4)
    })

    it('should have fsSelection bit 6 set for Regular', () => {
      expect(os2.fsSelection & 0x0040).toBe(0x0040)
    })

    it('should have reasonable firstCharIndex', () => {
      expect(os2.firstCharIndex).toBeGreaterThanOrEqual(0)
      expect(os2.firstCharIndex).toBeLessThanOrEqual(0x0100)
    })

    it('should have positive capHeight and xHeight for version >= 2', () => {
      if (os2.version >= 2) {
        expect(os2.capHeight).toBeGreaterThan(0)
        expect(os2.xHeight).toBeGreaterThan(0)
      }
    })
  })

  describe('SfntTableManager lazy access', () => {
    it('should provide os2 via manager', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const sfnt = parseSfntDirectory(buffer)
      const manager = new SfntTableManager(sfnt)

      const os2 = manager.os2
      expect(os2.weightClass).toBe(400)
      expect(os2.typoAscender).toBeGreaterThan(0)
    })
  })
})

describe('OS/2 version-dependent fields', () => {
  function parseConforming(buffer: ArrayBuffer): ReturnType<typeof parseOs2> {
    const os2 = parseOs2(new BinaryReader(buffer))
    validateOs2Conformance(os2)
    return os2
  }

  /** Build a synthetic OS/2 table of the given version */
  function buildOs2(version: number, mutate?: (view: DataView) => void): ArrayBuffer {
    // v0 body: 78 bytes; v1 adds 8; v2/3/4 add 10; v5 adds 4
    const size = 78 + (version >= 1 ? 8 : 0) + (version >= 2 ? 10 : 0) + (version >= 5 ? 4 : 0)
    const buf = new ArrayBuffer(size)
    const v = new DataView(buf)
    let p = 0
    v.setUint16(p, version); p += 2
    v.setInt16(p, 500); p += 2 // avgCharWidth
    v.setUint16(p, 400); p += 2 // weightClass
    v.setUint16(p, 5); p += 2 // widthClass
    v.setUint16(8, 0) // fsType
    v.setUint8(58, 0x54) // achVendID: TEST
    v.setUint8(59, 0x45)
    v.setUint8(60, 0x53)
    v.setUint8(61, 0x54)
    v.setUint16(64, 0x0020) // firstCharIndex
    v.setUint16(66, 0x007E) // lastCharIndex
    p += 70 // fsType .. typo/win metrics (zeros are fine)
    // running total so far: 78 bytes of v0 body
    if (version >= 1) {
      v.setUint32(p, 0x00000001); p += 4 // codePageRange1 (Latin 1)
      v.setUint32(p, 0x80000000); p += 4 // codePageRange2
    }
    if (version >= 2) {
      v.setInt16(p, 520); p += 2 // xHeight
      v.setInt16(p, 710); p += 2 // capHeight
      v.setUint16(p, 0); p += 2 // defaultChar
      v.setUint16(p, 32); p += 2 // breakChar
      v.setUint16(p, 3); p += 2 // maxContext
    }
    if (version >= 5) {
      v.setUint16(p, 120); p += 2 // lowerOpticalPointSize (6pt in TWIPs)
      v.setUint16(p, 480); p += 2 // upperOpticalPointSize (24pt in TWIPs)
    }
    mutate?.(v)
    return buf
  }

  it('parses v1 code page ranges', () => {
    const os2 = parseOs2(new BinaryReader(buildOs2(1)))
    expect(os2.codePageRange1).toBe(0x00000001)
    expect(os2.codePageRange2).toBe(0x80000000)
    expect(os2.xHeight).toBe(0)
  })

  it('parses v4 default/break char and max context', () => {
    const os2 = parseOs2(new BinaryReader(buildOs2(4)))
    expect(os2.xHeight).toBe(520)
    expect(os2.capHeight).toBe(710)
    expect(os2.breakChar).toBe(32)
    expect(os2.maxContext).toBe(3)
    expect(os2.lowerOpticalPointSize).toBe(0)
    expect(os2.upperOpticalPointSize).toBe(0xFFFF)
  })

  it('parses v5 optical point size range', () => {
    const os2 = parseOs2(new BinaryReader(buildOs2(5)))
    expect(os2.lowerOpticalPointSize).toBe(120)
    expect(os2.upperOpticalPointSize).toBe(480)
  })

  it('keeps v0 fields with defaults for later-version fields', () => {
    const os2 = parseOs2(new BinaryReader(buildOs2(0)))
    expect(os2.weightClass).toBe(400)
    expect(os2.codePageRange1).toBe(0)
    expect(os2.maxContext).toBe(0)
  })

  it('reads the latest known prefix of future versions and rejects truncated tables', () => {
    expect(parseOs2(new BinaryReader(buildOs2(6))).version).toBe(6)
    expect(() => parseOs2(new BinaryReader(buildOs2(1).slice(0, 78)))).toThrow(
      'OS/2 table length must be at least 86 bytes for version 1, got 78',
    )
  })

  it('rejects weight and width values outside their normative ranges', () => {
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(4, 0)))).toThrow(
      'OS/2 usWeightClass must be from 1 to 1000, got 0',
    )
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(6, 10)))).toThrow(
      'OS/2 usWidthClass must be from 1 to 9, got 10',
    )
  })

  it('rejects invalid embedding and selection flags', () => {
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(8, 1)))).toThrow(
      'OS/2 fsType bit 0 is reserved and must be zero',
    )
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(8, 6)))).toThrow(
      'OS/2 fsType versions 3 to 5 must set at most one usage-permission bit',
    )
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(8, 0x0040)))).toThrow(
      'OS/2 fsType reserved bits must be zero',
    )
    // Versions 0 to 2 retain the original least-restrictive interpretation.
    expect(parseConforming(buildOs2(2, v => v.setUint16(8, 0x000C))).fsType).toBe(0x000C)
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(62, 0x0400)))).toThrow(
      'OS/2 fsSelection reserved bits must be zero',
    )
    // Legacy sfnt decoding preserves real-world conflicts, while explicit
    // OpenType conformance rejects the undefined combination.
    expect(parseOs2(new BinaryReader(buildOs2(4, v => v.setUint16(62, 0x0041)))).fsSelection).toBe(0x0041)
    expect(() => parseConforming(buildOs2(4, v => v.setUint16(62, 0x0041)))).toThrow(
      'OS/2 fsSelection REGULAR bit requires ITALIC and BOLD bits to be clear',
    )
  })

  it('rejects invalid character ranges and optical ranges', () => {
    // achVendID is echoed as-is, including non-printable bytes.
    expect(parseOs2(new BinaryReader(buildOs2(4, v => {
      v.setUint32(58, 0)
    }))).achVendID).toBe('\x00\x00\x00\x00')
    expect(() => parseOs2(new BinaryReader(buildOs2(4, v => {
      v.setUint16(64, 0x0100)
      v.setUint16(66, 0x0020)
    })))).toThrow(
      'OS/2 usFirstCharIndex must be <= usLastCharIndex, got 256 > 32',
    )
    expect(() => parseConforming(buildOs2(5, v => {
      v.setUint16(96, 480)
      v.setUint16(98, 120)
    }))).toThrow(
      'OS/2 optical point size range must satisfy lower < upper and upper >= 2, got 480 and 120',
    )
    expect(() => parseConforming(buildOs2(5, v => {
      v.setUint16(96, 120)
      v.setUint16(98, 120)
    }))).toThrow(/lower < upper/)
    expect(() => parseConforming(buildOs2(5, v => {
      v.setUint16(96, 0)
      v.setUint16(98, 1)
    }))).toThrow(/upper >= 2/)
  })

  it('parses the 68-byte legacy version 0 form and rejects partial metric tails', () => {
    const legacy = buildOs2(0).slice(0, 68)
    const os2 = parseOs2(new BinaryReader(legacy))
    expect(os2.typoAscender).toBe(0)
    expect(os2.winAscent).toBe(0)
    expect(() => parseOs2(new BinaryReader(buildOs2(0).slice(0, 72)))).toThrow(
      'OS/2 version 0 table must be either the 68-byte legacy form or at least 78 bytes, got 72',
    )
  })

  // Real-font oracle: the exact metric values below were read from each font's
  // OS/2 table via fontTools. Matching them validates every OS/2 metric field
  // (not just sign/range), which drives line height, x-height and cap-height.
  describe('metric values match fontTools', () => {
    it('Roboto-Regular', () => {
      const os2 = parseOs2(getTableReader(parseSfntDirectory(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer), 'OS/2')!)
      expect(os2.winAscent).toBe(2146)
      expect(os2.winDescent).toBe(555)
      expect(os2.typoAscender).toBe(2146)
      expect(os2.typoDescender).toBe(-555)
      expect(os2.typoLineGap).toBe(0)
      expect(os2.xHeight).toBe(1082)
      expect(os2.capHeight).toBe(1456)
      expect(os2.strikeoutSize).toBe(102)
      expect(os2.strikeoutPosition).toBe(512)
    })

    it('SourceSans3-Regular', () => {
      const os2 = parseOs2(getTableReader(parseSfntDirectory(readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer), 'OS/2')!)
      expect(os2.winAscent).toBe(1000)
      expect(os2.winDescent).toBe(326)
      expect(os2.typoAscender).toBe(1000)
      expect(os2.typoDescender).toBe(-326)
      expect(os2.xHeight).toBe(486)
      expect(os2.capHeight).toBe(660)
      expect(os2.strikeoutSize).toBe(50)
      expect(os2.strikeoutPosition).toBe(291)
    })
  })

  it('synthesizes a default OS/2 for fonts that omit it', () => {
    const regular = syntheticOs2(0)
    expect(regular.fsSelection & 0x40).toBe(0x40) // REGULAR
    expect(regular.weightClass).toBe(400)
    // Metric fields stay zero so callers fall back to hhea / derived defaults.
    expect(regular.typoAscender).toBe(0)
    expect(regular.capHeight).toBe(0)

    const bold = syntheticOs2(0x01)
    expect(bold.fsSelection & 0x20).toBe(0x20) // BOLD from macStyle bit 0
    expect(bold.weightClass).toBe(700)

    const italic = syntheticOs2(0x02)
    expect(italic.fsSelection & 0x01).toBe(0x01) // ITALIC from macStyle bit 1
  })
})
