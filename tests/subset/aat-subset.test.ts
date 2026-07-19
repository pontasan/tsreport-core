import { describe, expect, it } from 'vitest'
import { BinaryReader } from '../../src/binary/reader.js'
import { BinaryWriter } from '../../src/binary/writer.js'
import { parseAcnt } from '../../src/parsers/tables/acnt.js'
import { parseAnkr } from '../../src/parsers/tables/ankr.js'
import { parseBsln } from '../../src/parsers/tables/bsln.js'
import { parseFmtx } from '../../src/parsers/tables/fmtx.js'
import { parseGcid } from '../../src/parsers/tables/gcid.js'
import { parseJust } from '../../src/parsers/tables/just.js'
import { parseKern } from '../../src/parsers/tables/kern.js'
import { parseKerx } from '../../src/parsers/tables/kerx.js'
import { parseLcar } from '../../src/parsers/tables/lcar.js'
import { parseMerg } from '../../src/parsers/tables/merg.js'
import { parseOpbd } from '../../src/parsers/tables/opbd.js'
import { parseProp } from '../../src/parsers/tables/prop.js'
import { parseZapf } from '../../src/parsers/tables/zapf.js'
import type { SfntTableManager } from '../../src/parsers/ttf-parser.js'
import { buildDirectAatSubsetTables } from '../../src/subset/aat-subset.js'

describe('compact AAT direct-table rebuilding', () => {
  it('renumbers lookup keys, direct references, arrays, and relative complements', () => {
    const ctlPoints = new Uint16Array(32)
    ctlPoints.fill(0xFFFF)
    ctlPoints[2] = 4
    const manager = {
      acnt: {
        version: 1,
        firstAccentGlyphIndex: 10,
        lastAccentGlyphIndex: 10,
        getAttachment(glyphId: number) {
          return glyphId === 10
            ? {
                primaryGlyphIndex: 7,
                components: [
                  { primaryAttachmentPoint: 4, secondaryGlyphIndex: 0, secondaryGlyphAttachmentNumber: 5 },
                  { primaryAttachmentPoint: 6, secondaryGlyphIndex: 0, secondaryGlyphAttachmentNumber: 7 },
                ],
              }
            : null
        },
      },
      ankr: {
        version: 0,
        flags: 0,
        getAnchorPoints(glyphId: number) {
          return glyphId === 10 ? [{ x: 20, y: -30 }] : null
        },
      },
      bsln: {
        version: 1,
        format: 3,
        defaultBaseline: 0,
        deltas: null,
        stdGlyph: 7,
        ctlPoints,
        getBaselineClass(glyphId: number) { return glyphId === 10 ? 2 : 0 },
      },
      fmtx: {
        version: 2,
        glyphIndex: 7,
        horizontalBefore: 1,
        horizontalAfter: 2,
        horizontalCaretHead: 3,
        horizontalCaretBase: 4,
        verticalBefore: 5,
        verticalAfter: 6,
        verticalCaretHead: 7,
        verticalCaretBase: 8,
      },
      gcid: {
        version: 0,
        format: 0,
        registry: 1,
        registryName: 'Adobe',
        order: 2,
        orderName: 'Identity',
        supplementVersion: 3,
        count: 13,
        getCid(glyphId: number) { return glyphId === 10 ? 501 : null },
      },
      lcar: {
        version: 1,
        format: 0,
        getCaretValues(glyphId: number) { return glyphId === 10 ? [120, 240] : null },
      },
      just: {
        version: 1,
        format: 0,
        horizontal: {
          classTable: {
            length: 0,
            coverage: 0,
            subFeatureFlags: 1,
            stateTable: {
              nClasses: 4,
              stateIndices: [0, 1],
              getClass() { return 1 },
              getEntry() { return { newState: 0, flags: 5, extra: [] } },
            },
          },
          getCategories() { return new Uint8Array(0) },
          getWidthDeltaPairs(glyphId: number) {
            return glyphId === 10
              ? [{
                  justClass: 0,
                  beforeGrowLimit: 1,
                  beforeShrinkLimit: -1,
                  afterGrowLimit: 2,
                  afterShrinkLimit: -2,
                  growFlags: 0,
                  shrinkFlags: 0,
                }]
              : null
          },
          getPostcompActions(glyphId: number) {
            return glyphId === 10
              ? [{ actionClass: 0, actionType: 2 as const, substThreshold: 0.5, addGlyph: 0, substGlyph: 12 }]
              : null
          },
        },
        vertical: null,
      },
      kern: {
        subsetData: {
          flavor: 'apple',
          pairSubtables: [{
            pairs: new Map([[(10 << 16) | 12, -50]]),
            vertical: false,
            crossStream: false,
            minimum: false,
            override: false,
            variation: false,
            tupleIndex: 0,
          }],
          contextualSubtables: [],
        },
      },
      kerx: parseKerx(new BinaryReader(buildKerxSource()), 13),
      opbd: {
        version: 1,
        format: 0,
        getOpticalBounds(glyphId: number) {
          return glyphId === 12 ? { left: -1, top: 2, right: 3, bottom: -4 } : null
        },
      },
      prop: {
        version: 3,
        format: 1,
        defaultProperties: 0,
        getProperties(glyphId: number) {
          if (glyphId === 10) return 0x1200
          if (glyphId === 12) return 0x1E00
          return 0
        },
      },
      zapf: {
        version: 2,
        getGlyphInfo(glyphId: number) {
          return glyphId === 10
            ? {
                flags: 0x80,
                unicodes: [0x41],
                identifiers: [{ kind: 1, name: 'A.alt', value: null }],
                groupReferences: [5],
                groups: [{
                  offset: 5,
                  subgroups: [{ flags: null, nameIndex: 4, glyphs: [10, 12] }],
                }],
                feature: { context: 1, aatFeatures: [{ featureType: 1, featureSetting: 2 }], otTags: ['liga'] },
              }
            : null
        },
      },
      merg: {
        version: 0,
        mergeClassCount: 2,
        getMergeClass(glyphId: number) { return glyphId === 10 || glyphId === 12 ? 1 : 0 },
        getMergeActionByClass(left: number, right: number) { return left === 1 && right === 1 ? 1 : 0 },
      },
    } as unknown as SfntTableManager
    const mapping = new Map([[0, 0], [7, 1], [10, 2], [12, 3]])
    const tables = buildDirectAatSubsetTables(manager, mapping)
    const reader = function (tag: string): BinaryReader {
      const data = tables.get(tag)
      if (data === undefined) throw new Error(`missing rebuilt ${tag}`)
      return new BinaryReader(data.buffer, data.byteOffset, data.byteLength)
    }

    expect(parseAnkr(reader('ankr'), 4).getAnchorPoints(2)).toEqual([{ x: 20, y: -30 }])
    expect(parseAcnt(reader('acnt')).getAttachment(2)).toEqual({
      primaryGlyphIndex: 1,
      components: [
        { primaryAttachmentPoint: 4, secondaryGlyphIndex: 0, secondaryGlyphAttachmentNumber: 5 },
        { primaryAttachmentPoint: 6, secondaryGlyphIndex: 0, secondaryGlyphAttachmentNumber: 7 },
      ],
    })
    const bsln = parseBsln(reader('bsln'), 4)
    expect(bsln.stdGlyph).toBe(1)
    expect(bsln.getBaselineClass(2)).toBe(2)
    expect(parseFmtx(reader('fmtx'), 4).glyphIndex).toBe(1)
    const gcid = parseGcid(reader('gcid'), 4)
    expect(gcid.count).toBe(4)
    expect(gcid.getCid(2)).toBe(501)
    expect(parseLcar(reader('lcar'), 4).getCaretValues(2)).toEqual([120, 240])
    const just = parseJust(reader('just'), 4).horizontal!
    expect(just.getCategories([2])).toEqual(Uint8Array.of(5))
    expect(just.getWidthDeltaPairs(2)?.[0]?.afterGrowLimit).toBe(2)
    expect(just.getPostcompActions(2)).toEqual([
      { actionClass: 0, actionType: 2, substThreshold: 0.5, addGlyph: 0, substGlyph: 3 },
    ])
    expect(parseKern(reader('kern'), 4).getKerning(2, 3)).toBe(-50)
    expect(parseKerx(reader('kerx'), 4).getKerning(2, 3)).toBe(-75)
    expect(parseOpbd(reader('opbd'), 4).getOpticalBounds(3)).toEqual({ left: -1, top: 2, right: 3, bottom: -4 })
    const prop = parseProp(reader('prop'), 4)
    expect(prop.getProperties(2) & 0x0F00).toBe(0x0100)
    expect(prop.getProperties(3) & 0x0F00).toBe(0x0F00)
    const zapf = parseZapf(reader('Zapf'), 4).getGlyphInfo(2)!
    expect(zapf.identifiers[0]?.name).toBe('A.alt')
    expect(zapf.groups[0]?.subgroups[0]?.glyphs).toEqual([2, 3])
    expect(zapf.feature?.otTags).toEqual(['liga'])
    const merg = parseMerg(reader('MERG'), 4)
    expect(merg.getMergeClass(2)).toBe(1)
    expect(merg.getMergeClass(3)).toBe(1)
    expect(merg.getMergeAction(2, 3)).toBe(1)
  })
})

function buildKerxSource(): ArrayBuffer {
  const writer = new BinaryWriter(42)
  writer.writeUint16(2)
  writer.writeUint16(0)
  writer.writeUint32(1)
  writer.writeUint32(34)
  writer.writeUint32(0)
  writer.writeUint32(0)
  writer.writeUint32(1)
  writer.writeUint32(6)
  writer.writeUint32(0)
  writer.writeUint32(0)
  writer.writeUint16(10)
  writer.writeUint16(12)
  writer.writeInt16(-75)
  return writer.toArrayBuffer()
}
