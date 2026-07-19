import { describe, it, expect } from 'vitest'
import { Font } from '../../src/font.js'
import { BinaryWriter } from '../../src/binary/writer.js'
import {
  ARG_1_AND_2_ARE_WORDS,
  ARGS_ARE_XY_VALUES,
  MORE_COMPONENTS,
} from '../../src/parsers/tables/glyf.js'
import {
  buildTestFont, buildTable, encodeSimpleGlyph, UPEM,
} from '../renderer/synthetic-font.js'

/**
 * TrueType grid-fitting pipeline: Font.getHintedGlyph → TrueTypeGlyphHinter
 * → bytecode interpreter, gated by the gasp table.
 */

// Instruction opcodes used by the synthetic glyphs
const SVTCA_X = 0x01
const PUSHB_1 = 0xB0
const PUSHB_2 = 0xB1
const MDAP_RND = 0x2F
const MIAP_NORND = 0x3E
const INSTCTRL = 0x8E

/** gasp table: one range covering all ppem sizes with the given behavior */
function buildGasp(behavior: number): Uint8Array {
  return buildTable(w => {
    w.writeUint16(1) // version
    w.writeUint16(1) // numRanges
    w.writeUint16(0xFFFF) // rangeMaxPPEM
    w.writeUint16(behavior)
  })
}

/** cvt table with the given FWord values */
function buildCvt(values: number[]): Uint8Array {
  return buildTable(w => {
    for (const v of values) w.writeInt16(v)
  })
}

const SQUARE: [number, number][] = [[100, 100], [300, 100], [300, 300], [100, 300]]

// MDAP[rnd] on point 0 along X: rounds the point's x to the pixel grid
const NATIVE_CLEARTYPE_WAIVER = [PUSHB_2, 4, 3, INSTCTRL]
const MDAP_INSTRUCTIONS = new Uint8Array([...NATIVE_CLEARTYPE_WAIVER, SVTCA_X, PUSHB_1, 0, MDAP_RND])

// MIAP[no-rnd] point 0 ← cvt[0] along X: moves the point to the scaled CVT value
const MIAP_INSTRUCTIONS = new Uint8Array([...NATIVE_CLEARTYPE_WAIVER, SVTCA_X, PUSHB_2, 0, 0, MIAP_NORND])

function encodePhantomMatchedComposite(): Uint8Array {
  const w = new BinaryWriter()
  w.writeInt16(-1)
  w.writeInt16(0); w.writeInt16(0); w.writeInt16(0); w.writeInt16(0)
  w.writeUint16(ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES | MORE_COMPONENTS)
  w.writeUint16(1)
  w.writeInt16(0); w.writeInt16(0)
  w.writeUint16(ARG_1_AND_2_ARE_WORDS)
  w.writeUint16(1)
  w.writeUint16(9) // Parent PP2: eight final contour points followed by PP1/PP2.
  w.writeUint16(4) // Child PP1: four contour points followed by PP1.
  return w.toUint8Array()
}

function firstMoveToX(font: Font, glyphId: number, ppem: number): number {
  const glyph = font.getHintedGlyph(glyphId, ppem)
  expect(glyph.outline.commands[0]).toBe(0) // MoveTo
  return glyph.outline.coords[0]!
}

describe('TrueType glyph hinting (getHintedGlyph)', () => {
  it('grid-fits a point via MDAP[rnd]', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
    ))

    // ppem 16, upem 1000: x=100 → 1.6px → rounds to 2px → 125 font units
    const hintedX = firstMoveToX(font, 1, 16)
    expect(hintedX).toBeCloseTo(125, 3)

    // The unhinted glyph is unchanged
    expect(font.getGlyph(1).outline.coords[0]).toBe(100)
  })

  it('moves a point to the scaled CVT value via MIAP (scaled-CVT model)', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MIAP_INSTRUCTIONS)],
      [[0x41, 1]],
      [['cvt ', buildCvt([105])]],
    ))

    // cvt[0] = 105 font units → 105·(16/1000)·64 = 107.52 → 108 F26Dot6
    // → back to font units: 108·1000/(16·64) = 105.47
    const hintedX = firstMoveToX(font, 1, 16)
    expect(hintedX).toBeCloseTo(108 * UPEM / (16 * 64), 3)
  })

  it('returns the device-scaled F26Dot6 outline when the glyph has no instructions', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3])],
      [[0x41, 1]],
    ))
    const hinted = font.getHintedGlyph(1, 16)
    expect(hinted.outline.coords[0]).toBe(99.609375)
    expect(font.getGlyph(1).outline.coords[0]).toBe(100)
  })

  it('executes zero-contour glyph instructions against phantom points', () => {
    const roundAdvance = new Uint8Array([SVTCA_X, PUSHB_1, 1, MDAP_RND])
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph([], [], roundAdvance)],
      [[0x20, 1]],
    ))

    const hinted = font.getHintedGlyph(1, 16)
    expect(hinted.outline.commands.length).toBe(0)
    // 600 units = 9.6 px at 16 ppem; MDAP rounds phantom point 1 to 10 px.
    expect(hinted.advanceWidth).toBeCloseTo(625, 10)
  })

  it('uses grid-fitted phantom points for composite point matching', () => {
    const child = encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)
    const font = Font.load(buildTestFont(
      [null, child, encodePhantomMatchedComposite()],
      [[0x41, 2]],
    ))

    const hinted = font.getHintedGlyph(2, 20)
    // Parent PP2 is 600 units and child PP1 is 0, so the second contour is
    // translated 600 units after the child's own grid fitting.
    expect(hinted.outline.coords[10]).toBeCloseTo(700, 10)
    expect(hinted.advanceWidth).toBeCloseTo(600, 10)
  })

  it('gasp without GRIDFIT disables hinting at that ppem', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
      [['gasp', buildGasp(0x0002)]], // DOGRAY only, no GRIDFIT
    ))
    expect(firstMoveToX(font, 1, 16)).toBe(99.609375)
  })

  it('gasp with GRIDFIT keeps hinting enabled', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
      [['gasp', buildGasp(0x0003)]], // GRIDFIT | DOGRAY
    ))
    expect(firstMoveToX(font, 1, 16)).toBeCloseTo(125, 3)
  })

  it('hinted glyphs are cached per (glyph, ppem) and differ across ppem', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
    ))
    const a = font.getHintedGlyph(1, 16)
    const b = font.getHintedGlyph(1, 16)
    expect(b).toBe(a)

    // ppem 20: x=100 → 2.0px exactly on the grid → stays 100
    expect(firstMoveToX(font, 1, 20)).toBeCloseTo(100, 3)
  })

  it('uses independent horizontal and vertical ppem for stretched device transforms', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
    ))
    const glyph = font.getHintedGlyph(1, 16, 32)
    // x=100 is 3.2 device pixels at 32 horizontal ppem and rounds to 3px.
    expect(glyph.outline.coords[0]).toBeCloseTo(3 * UPEM / 32, 3)
    // The vertical scale remains the 16ppem scale.
    expect(glyph.outline.coords[1]).toBeCloseTo(102 * UPEM / (16 * 64), 3)
  })

  it('ppem 0 returns the plain glyph', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
    ))
    expect(font.getHintedGlyph(1, 0).outline.coords[0]).toBe(100)
  })
})

describe('real font grid-fitting regression', () => {
  it('hints NotoSans glyphs without errors and grid-fits advances', async () => {
    const fs = await import('node:fs')
    const path = new URL('../fixtures/fonts/NotoSans-Regular.ttf', import.meta.url)
    if (!fs.existsSync(path)) return // fixture downloaded by global setup

    const data = fs.readFileSync(path)
    const font = Font.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)

    const text = 'Hamburgefonstiv123'
    for (const ch of text) {
      const gid = font.getGlyphId(ch.codePointAt(0)!)
      for (const ppem of [9, 12, 16, 24, 48]) {
        const hinted = font.getHintedGlyph(gid, ppem)
        const pixelAdvance = hinted.advanceWidth * ppem / font.metrics.unitsPerEm
        expect(pixelAdvance).toBeCloseTo(Math.round(pixelAdvance), 10)
        expect(hinted.outline.commands.length).toBeGreaterThan(0)
      }
    }
  })
})
