import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../src/index.js'
import { parseCffGlyph, type CffData, type CffIndex } from '../../src/parsers/cff-parser.js'
import { PathCommand } from '../../src/types/index.js'

// --- Helpers ---

function makeEmptyIndex(): CffIndex {
  return { count: 0, offsets: new Uint32Array(0), data: new BinaryReader(new ArrayBuffer(0)) }
}

function calcBias(count: number): number {
  if (count < 1240) return 107
  if (count < 33900) return 1131
  return 32768
}

function makeCffWithCharstring(bytes: Uint8Array, opts?: {
  defaultWidthX?: number
  nominalWidthX?: number
  localSubrs?: { count: number, offsets: Uint32Array, data: BinaryReader }
  globalSubrs?: { count: number, offsets: Uint32Array, data: BinaryReader }
}): CffData {
  // Build a CffIndex with a single charstring entry (offsets are 1-based)
  const offsets = new Uint32Array([1, 1 + bytes.length])
  const buf = new ArrayBuffer(bytes.length)
  new Uint8Array(buf).set(bytes)
  const data = new BinaryReader(buf)
  return {
    charstrings: { count: 1, offsets, data },
    globalSubrs: opts?.globalSubrs ?? makeEmptyIndex(),
    globalBias: calcBias(opts?.globalSubrs?.count ?? 0),
    charset: [0],
    encoding: null,
    localSubrs: opts?.localSubrs ?? makeEmptyIndex(),
    localBias: calcBias(opts?.localSubrs?.count ?? 0),
    defaultWidthX: opts?.defaultWidthX ?? 0,
    nominalWidthX: opts?.nominalWidthX ?? 0,
    privateDictEntries: new Map(),
    isCIDFont: false,
    fdSelect: null,
    fdArray: null,
  }
}

/**
 * Encode an integer as Type 2 charstring number bytes.
 * Uses the most compact encoding available.
 */
function encNum(v: number): number[] {
  if (Number.isInteger(v) && v >= -107 && v <= 107) {
    return [v + 139]
  }
  if (Number.isInteger(v) && v >= 108 && v <= 1131) {
    const adjusted = v - 108
    return [247 + (adjusted >> 8), adjusted & 0xFF]
  }
  if (Number.isInteger(v) && v >= -1131 && v <= -108) {
    const adjusted = -v - 108
    return [251 + (adjusted >> 8), adjusted & 0xFF]
  }
  if (Number.isInteger(v) && v >= -32768 && v <= 32767) {
    // Int16 encoding (operator 28)
    const unsigned = v < 0 ? v + 0x10000 : v
    return [28, (unsigned >> 8) & 0xFF, unsigned & 0xFF]
  }
  // Fixed 16.16 for non-integers
  const fixed = Math.round(v * 65536) | 0
  return [
    255,
    (fixed >> 24) & 0xFF,
    (fixed >> 16) & 0xFF,
    (fixed >> 8) & 0xFF,
    fixed & 0xFF,
  ]
}

/** Build a Uint8Array from a flat list of byte values */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

/** Build a CffIndex containing multiple subroutine charstrings */
function makeSubrIndex(subroutines: Uint8Array[]): CffIndex {
  if (subroutines.length === 0) return makeEmptyIndex()

  // Compute total data size
  let totalSize = 0
  for (const s of subroutines) {
    totalSize += s.length
  }

  // Build the 1-based offset array
  const offsets = new Uint32Array(subroutines.length + 1)
  offsets[0] = 1
  for (let i = 0; i < subroutines.length; i++) {
    offsets[i + 1] = offsets[i]! + subroutines[i]!.length
  }

  // Concatenate all subroutine data
  const buf = new ArrayBuffer(totalSize)
  const arr = new Uint8Array(buf)
  let pos = 0
  for (const s of subroutines) {
    arr.set(s, pos)
    pos += s.length
  }

  return {
    count: subroutines.length,
    offsets,
    data: new BinaryReader(buf),
  }
}

/** Shorthand to get commands as a plain number array */
function cmds(outline: { commands: Uint8Array }): number[] {
  return Array.from(outline.commands)
}

/** Shorthand to get coords as a plain number array (rounded to avoid floating point noise) */
function coords(outline: { coords: Float32Array }, precision = 4): number[] {
  return Array.from(outline.coords).map(v => {
    const rounded = Math.round(v * Math.pow(10, precision)) / Math.pow(10, precision)
    return rounded
  })
}

// --- Operator byte constants ---
const OP_HSTEM = 1
const OP_VSTEM = 3
const OP_VMOVETO = 4
const OP_RLINETO = 5
const OP_HLINETO = 6
const OP_VLINETO = 7
const OP_RRCURVETO = 8
const OP_CALLSUBR = 10
const OP_RETURN = 11
const OP_ENDCHAR = 14
const OP_HSTEMHM = 18
const OP_HINTMASK = 19
const OP_CNTRMASK = 20
const OP_RMOVETO = 21
const OP_HMOVETO = 22
const OP_VSTEMHM = 23
const OP_RCURVELINE = 24
const OP_RLINECURVE = 25
const OP_VVCURVETO = 26
const OP_HHCURVETO = 27
const OP_INT16 = 28
const OP_CALLGSUBR = 29
const OP_VHCURVETO = 30
const OP_HVCURVETO = 31
const OP_ESCAPE = 12
const OP_HFLEX = 34
const OP_FLEX = 35
const OP_HFLEX1 = 36
const OP_FLEX1 = 37

// ============================================================================
// Tests
// ============================================================================

describe('CFF Type 2 Charstring Interpreter', () => {
  // ==========================================================================
  // 1. Move Operators
  // ==========================================================================
  describe('Move Operators', () => {
    // Verifies rmoveto emits MoveTo at relative (dx,dy) and width falls back to defaultWidthX when no width operand is present.
    it('rmoveto: basic dx,dy', () => {
      const charstring = bytes(
        ...encNum(10), ...encNum(20), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([10, 20])
      expect(width).toBe(0) // defaultWidthX
    })

    // Verifies an odd operand count on rmoveto treats the first value as width (nominalWidthX + value).
    it('rmoveto with width: 3 values on stack (first is width)', () => {
      const charstring = bytes(
        ...encNum(50), ...encNum(10), ...encNum(20), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 100 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([10, 20])
      expect(width).toBe(100 + 50) // nominalWidthX + stack[0]
    })

    // Verifies hmoveto moves only horizontally (dy stays 0).
    it('hmoveto: dx only', () => {
      const charstring = bytes(
        ...encNum(30), OP_HMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([30, 0])
      expect(width).toBe(0)
    })

    // Verifies the extra leading operand before hmoveto is consumed as the glyph width.
    it('hmoveto with width: 2 values on stack', () => {
      const charstring = bytes(
        ...encNum(80), ...encNum(30), OP_HMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 200 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([30, 0])
      expect(width).toBe(200 + 80)
    })

    // Verifies vmoveto moves only vertically (dx stays 0).
    it('vmoveto: dy only', () => {
      const charstring = bytes(
        ...encNum(40), OP_VMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([0, 40])
      expect(width).toBe(0)
    })

    // Verifies the extra leading operand before vmoveto is consumed as the glyph width.
    it('vmoveto with width: 2 values on stack', () => {
      const charstring = bytes(
        ...encNum(60), ...encNum(40), OP_VMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 300 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([0, 40])
      expect(width).toBe(300 + 60)
    })
  })

  // ==========================================================================
  // 2. Line Operators
  // ==========================================================================
  describe('Line Operators', () => {
    // Verifies rlineto draws one relative LineTo segment.
    it('rlineto: single line segment', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 10, 20])
    })

    // Verifies rlineto consumes the stack in dx,dy pairs to draw consecutive line segments.
    it('rlineto: multiple segments (4+ values)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(0),
        ...encNum(0), ...encNum(20),
        ...encNum(-10), ...encNum(0),
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      // (0,0) → (10,0) → (10,20) → (0,20)
      expect(coords(outline)).toEqual([0, 0, 10, 0, 10, 20, 0, 20])
    })

    // Verifies hlineto with one operand draws a purely horizontal segment.
    it('hlineto: single horizontal line', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(50), OP_HLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 50, 0])
    })

    // Verifies hlineto alternates horizontal/vertical direction across successive operands.
    it('hlineto: alternating h/v', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(50), ...encNum(30), ...encNum(20), OP_HLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      // h(50) → v(30) → h(20)
      // (0,0) → (50,0) → (50,30) → (70,30)
      expect(coords(outline)).toEqual([0, 0, 50, 0, 50, 30, 70, 30])
    })

    // Verifies vlineto with one operand draws a purely vertical segment.
    it('vlineto: single vertical line', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(40), OP_VLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 0, 40])
    })

    // Verifies vlineto alternates vertical/horizontal direction across successive operands.
    it('vlineto: alternating v/h', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(30), ...encNum(50), ...encNum(10), OP_VLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      // v(30) → h(50) → v(10)
      // (0,0) → (0,30) → (50,30) → (50,40)
      expect(coords(outline)).toEqual([0, 0, 0, 30, 50, 30, 50, 40])
    })
  })

  // ==========================================================================
  // 3. Curve Operators
  // ==========================================================================
  describe('Curve Operators', () => {
    // Verifies rrcurveto converts six relative operands into one cubic Bezier.
    it('rrcurveto: single curve (6 values)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40), ...encNum(50), ...encNum(60),
        OP_RRCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Start at (0,0)
      // cp1 = (0+10, 0+20) = (10,20)
      // cp2 = (10+30, 20+40) = (40,60)
      // end = (40+50, 60+60) = (90,120)
      expect(coords(outline)).toEqual([0, 0, 10, 20, 40, 60, 90, 120])
    })

    // Verifies rrcurveto emits one cubic per six operands, chaining each curve from the previous endpoint.
    it('rrcurveto: multiple curves (12 values = 2 curves)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(1), ...encNum(2), ...encNum(3), ...encNum(4), ...encNum(5), ...encNum(6),
        ...encNum(7), ...encNum(8), ...encNum(9), ...encNum(10), ...encNum(11), ...encNum(12),
        OP_RRCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Curve 1: start (0,0)
      // cp1=(1,2), cp2=(4,6), end=(9,12)
      // Curve 2: start (9,12)
      // cp1=(9+7, 12+8)=(16,20), cp2=(16+9, 20+10)=(25,30), end=(25+11, 30+12)=(36,42)
      expect(coords(outline)).toEqual([
        0, 0,
        1, 2, 4, 6, 9, 12,
        16, 20, 25, 30, 36, 42,
      ])
    })

    // Verifies hhcurveto's even-count form where start and end tangents are horizontal (dy1 = dy3 = 0).
    it('hhcurveto: 4 values (no initial dy1)', () => {
      // hhcurveto with 4 values: dx1 dx2 dy2 dx3
      // → cubicTo(dx1, 0, dx2, dy2, dx3, 0)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HHCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // cubicTo(10, 0, 20, 30, 40, 0) from (0,0)
      // cp1=(10,0), cp2=(30,30), end=(70,30)
      expect(coords(outline)).toEqual([0, 0, 10, 0, 30, 30, 70, 30])
    })

    // Verifies hhcurveto's odd-count form where the leading extra operand supplies dy1.
    it('hhcurveto: 5 values (with dy1)', () => {
      // With odd number: first value is dy1
      // dy1 dx1 dx2 dy2 dx3
      // → cubicTo(dx1, dy1, dx2, dy2, dx3, 0)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(5), ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HHCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // cubicTo(10, 5, 20, 30, 40, 0) from (0,0)
      // cp1=(10,5), cp2=(30,35), end=(70,35)
      expect(coords(outline)).toEqual([0, 0, 10, 5, 30, 35, 70, 35])
    })

    // Verifies vvcurveto's even-count form where start and end tangents are vertical (dx1 = dx3 = 0).
    it('vvcurveto: 4 values (no initial dx1)', () => {
      // vvcurveto with 4 values: dy1 dx2 dy2 dy3
      // → cubicTo(0, dy1, dx2, dy2, 0, dy3)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_VVCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // cubicTo(0, 10, 20, 30, 0, 40) from (0,0)
      // cp1=(0,10), cp2=(20,40), end=(20,80)
      expect(coords(outline)).toEqual([0, 0, 0, 10, 20, 40, 20, 80])
    })

    // Verifies vvcurveto's odd-count form where the leading extra operand supplies dx1.
    it('vvcurveto: 5 values (with dx1)', () => {
      // With odd number: first value is dx1
      // dx1 dy1 dx2 dy2 dy3
      // → cubicTo(dx1, dy1, dx2, dy2, 0, dy3)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(5), ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_VVCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // cubicTo(5, 10, 20, 30, 0, 40) from (0,0)
      // cp1=(5,10), cp2=(25,40), end=(25,80)
      expect(coords(outline)).toEqual([0, 0, 5, 10, 25, 40, 25, 80])
    })

    // Verifies hvcurveto's 4-operand form starts horizontal and ends vertical.
    it('hvcurveto: single curve (4 values)', () => {
      // hvcurveto phase 0: h→v
      // dx1 dx2 dy2 dy3
      // → cubicTo(dx1, 0, dx2, dy2, 0, dy3)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HVCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // cubicTo(10, 0, 20, 30, 0, 40) from (0,0)
      // cp1=(10,0), cp2=(30,30), end=(30,70)
      expect(coords(outline)).toEqual([0, 0, 10, 0, 30, 30, 30, 70])
    })

    // Verifies the fifth hvcurveto operand adjusts the final endpoint's x coordinate on the last curve.
    it('hvcurveto: with final adjustment (5 values)', () => {
      // 5 values: last curve gets extra dx/dy adjustment
      // dx1 dx2 dy2 dy3 dxf (lastCurve=true)
      // → cubicTo(dx1, 0, dx2, dy2, dxf, dy3)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40), ...encNum(5),
        OP_HVCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // phase 0 h→v, lastCurve: cubicTo(10, 0, 20, 30, 5, 40)
      // cp1=(10,0), cp2=(30,30), end=(35,70)
      expect(coords(outline)).toEqual([0, 0, 10, 0, 30, 30, 35, 70])
    })

    // Verifies vhcurveto's 4-operand form starts vertical and ends horizontal.
    it('vhcurveto: single curve (4 values)', () => {
      // vhcurveto phase 0: v→h
      // dy1 dx2 dy2 dx3
      // → cubicTo(0, dy1, dx2, dy2, dx3, 0)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_VHCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // cubicTo(0, 10, 20, 30, 40, 0) from (0,0)
      // cp1=(0,10), cp2=(20,40), end=(60,40)
      expect(coords(outline)).toEqual([0, 0, 0, 10, 20, 40, 60, 40])
    })

    // Verifies the fifth vhcurveto operand adjusts the final endpoint's y coordinate on the last curve.
    it('vhcurveto: with final adjustment (5 values)', () => {
      // 5 values: last curve has extra dy adjustment
      // dy1 dx2 dy2 dx3 dyf
      // → cubicTo(0, dy1, dx2, dy2, dx3, dyf)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40), ...encNum(5),
        OP_VHCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // phase 0 v→h, lastCurve: cubicTo(0, 10, 20, 30, 40, 5)
      // cp1=(0,10), cp2=(20,40), end=(60,45)
      expect(coords(outline)).toEqual([0, 0, 0, 10, 20, 40, 60, 45])
    })

    // Verifies hvcurveto alternates phase (h-to-v then v-to-h) across an 8-operand sequence.
    it('hvcurveto: two curves alternating h→v then v→h', () => {
      // 8 values: first curve h→v (4 vals), second curve v→h (4 vals)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        // curve 1 (h→v): dx1=10, dx2=20, dy2=30, dy3=40
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        // curve 2 (v→h): dya=5, dxb=6, dyb=7, dxc=8
        ...encNum(5), ...encNum(6), ...encNum(7), ...encNum(8),
        OP_HVCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Curve 1 (phase 0, h→v): cubicTo(10, 0, 20, 30, 0, 40) from (0,0)
      // cp1=(10,0), cp2=(30,30), end=(30,70)
      // Curve 2 (phase 1, v→h): cubicTo(0, 5, 6, 7, 8, 0) from (30,70)
      // cp1=(30,75), cp2=(36,82), end=(44,82)
      expect(coords(outline)).toEqual([
        0, 0,
        10, 0, 30, 30, 30, 70,
        30, 75, 36, 82, 44, 82,
      ])
    })
  })

  // ==========================================================================
  // 4. Mixed Operators
  // ==========================================================================
  describe('Mixed Operators', () => {
    // Verifies rcurveline draws a cubic then a line from the trailing operand pair.
    it('rcurveline: one curve + one line (8 values)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        // curve: 1,2,3,4,5,6 then line: 7,8
        ...encNum(1), ...encNum(2), ...encNum(3), ...encNum(4), ...encNum(5), ...encNum(6),
        ...encNum(7), ...encNum(8),
        OP_RCURVELINE,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      // Curve: cp1=(1,2), cp2=(4,6), end=(9,12)
      // Line from (9,12): (9+7, 12+8) = (16,20)
      expect(coords(outline)).toEqual([
        0, 0,
        1, 2, 4, 6, 9, 12,
        16, 20,
      ])
    })

    // Verifies rlinecurve draws a leading line then a cubic from the last six operands.
    it('rlinecurve: one line + one curve (8 values)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        // line: 1,2 then curve: 3,4,5,6,7,8
        ...encNum(1), ...encNum(2),
        ...encNum(3), ...encNum(4), ...encNum(5), ...encNum(6), ...encNum(7), ...encNum(8),
        OP_RLINECURVE,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Line from (0,0): (1,2)
      // Curve from (1,2): cp1=(1+3,2+4)=(4,6), cp2=(4+5,6+6)=(9,12), end=(9+7,12+8)=(16,20)
      expect(coords(outline)).toEqual([
        0, 0,
        1, 2,
        4, 6, 9, 12, 16, 20,
      ])
    })

    // Verifies rcurveline handles multiple cubics before the single final line segment.
    it('rcurveline: two curves + one line (14 values)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        // curve 1: 1,2,3,4,5,6
        ...encNum(1), ...encNum(2), ...encNum(3), ...encNum(4), ...encNum(5), ...encNum(6),
        // curve 2: 1,1,1,1,1,1
        ...encNum(1), ...encNum(1), ...encNum(1), ...encNum(1), ...encNum(1), ...encNum(1),
        // line: 10,10
        ...encNum(10), ...encNum(10),
        OP_RCURVELINE,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
    })

    // Verifies rlinecurve handles multiple leading lines before the single final cubic.
    it('rlinecurve: two lines + one curve (10 values)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        // line 1: 5,5
        ...encNum(5), ...encNum(5),
        // line 2: 3,3
        ...encNum(3), ...encNum(3),
        // curve: 1,2,3,4,5,6
        ...encNum(1), ...encNum(2), ...encNum(3), ...encNum(4), ...encNum(5), ...encNum(6),
        OP_RLINECURVE,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // line1: (5,5), line2: (8,8)
      // curve from (8,8): cp1=(9,10), cp2=(12,14), end=(17,20)
      expect(coords(outline)).toEqual([
        0, 0,
        5, 5,
        8, 8,
        9, 10, 12, 14, 17, 20,
      ])
    })
  })

  // ==========================================================================
  // 5. Flex Operators
  // ==========================================================================
  describe('Flex Operators', () => {
    // Verifies hflex expands into two cubics with mirrored dy2 and horizontal start/end tangents.
    it('hflex: 7 values → 2 curves', () => {
      // hflex: dx1 dx2 dy2 dx3 dx4 dx5 dx6
      // curve1: cubicTo(dx1, 0, dx2, dy2, dx3, 0)
      // curve2: cubicTo(dx4, 0, dx5, -dy2, dx6, 0)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(5), ...encNum(30),
        ...encNum(30), ...encNum(20), ...encNum(10),
        OP_ESCAPE, OP_HFLEX,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Curve 1: cubicTo(10, 0, 20, 5, 30, 0) from (0,0)
      // cp1=(10,0), cp2=(30,5), end=(60,5)
      // Curve 2: cubicTo(30, 0, 20, -5, 10, 0) from (60,5)
      // cp1=(90,5), cp2=(110,0), end=(120,0)
      expect(coords(outline)).toEqual([
        0, 0,
        10, 0, 30, 5, 60, 5,
        90, 5, 110, 0, 120, 0,
      ])
    })

    // Verifies flex expands 12 operands into two cubics and discards the flex-depth operand.
    it('flex: 13 values (12 curve args + 1 fd)', () => {
      // flex: dx1 dy1 dx2 dy2 dx3 dy3 dx4 dy4 dx5 dy5 dx6 dy6 fd
      // curve1: cubicTo(dx1,dy1,dx2,dy2,dx3,dy3)
      // curve2: cubicTo(dx4,dy4,dx5,dy5,dx6,dy6)
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(1), ...encNum(2), ...encNum(3), ...encNum(4), ...encNum(5), ...encNum(6),
        ...encNum(7), ...encNum(8), ...encNum(9), ...encNum(10), ...encNum(11), ...encNum(12),
        ...encNum(50), // fd (flex depth, ignored for outline)
        OP_ESCAPE, OP_FLEX,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Same as rrcurveto x2
      // Curve 1: cp1=(1,2), cp2=(4,6), end=(9,12)
      // Curve 2: cp1=(16,20), cp2=(25,30), end=(36,42)
      expect(coords(outline)).toEqual([
        0, 0,
        1, 2, 4, 6, 9, 12,
        16, 20, 25, 30, 36, 42,
      ])
    })

    // Verifies hflex1 derives the final dy as -(dy1+dy2+dy5) so the second curve returns to the start y.
    it('hflex1: 9 values → 2 curves', () => {
      // hflex1: dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6
      // curve1: cubicTo(dx1, dy1, dx2, dy2, dx3, 0)
      // curve2: cubicTo(dx4, 0, dx5, dy5, dx6, -(dy1+dy2+dy5))
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(5),   // dx1, dy1
        ...encNum(20), ...encNum(3),   // dx2, dy2
        ...encNum(30),                 // dx3
        ...encNum(30),                 // dx4
        ...encNum(20), ...encNum(2),   // dx5, dy5
        ...encNum(10),                 // dx6
        OP_ESCAPE, OP_HFLEX1,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // Curve 1: cubicTo(10, 5, 20, 3, 30, 0) from (0,0)
      // cp1=(10,5), cp2=(30,8), end=(60,8)
      // Curve 2: cubicTo(30, 0, 20, 2, 10, -(5+3+2)) from (60,8)
      // dy6 = -(5+3+2) = -10
      // cp1=(90,8), cp2=(110,10), end=(120,0)
      expect(coords(outline)).toEqual([
        0, 0,
        10, 5, 30, 8, 60, 8,
        90, 8, 110, 10, 120, 0,
      ])
    })

    // Verifies flex1 treats d6 as dx6 when the accumulated horizontal delta dominates.
    it('flex1: 11 values, sumDx > sumDy branch (d6 is dx6)', () => {
      // flex1: dx1 dy1 dx2 dy2 dx3 dy3 dx4 dy4 dx5 dy5 d6
      // If |sumDx| > |sumDy|: dx6=d6, dy6=-(sum of dy)
      // Else: dx6=-(sum of dx), dy6=d6
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(1),   // dx1, dy1
        ...encNum(20), ...encNum(2),   // dx2, dy2
        ...encNum(30), ...encNum(-1),  // dx3, dy3
        ...encNum(30), ...encNum(-1),  // dx4, dy4
        ...encNum(20), ...encNum(1),   // dx5, dy5
        ...encNum(10),                 // d6
        OP_ESCAPE, OP_FLEX1,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // sumDx = |10+20+30+30+20| = 110
      // sumDy = |1+2+(-1)+(-1)+1| = |2| = 2
      // sumDx > sumDy → dx6=10, dy6=-(1+2-1-1+1) = -2
      // Curve 1: cubicTo(10,1,20,2,30,-1) from (0,0)
      // cp1=(10,1), cp2=(30,3), end=(60,2)
      // Curve 2: cubicTo(30,-1,20,1,10,-2) from (60,2)
      // cp1=(90,1), cp2=(110,2), end=(120,0)
      expect(coords(outline)).toEqual([
        0, 0,
        10, 1, 30, 3, 60, 2,
        90, 1, 110, 2, 120, 0,
      ])
    })

    // Verifies flex1 treats d6 as dy6 when the accumulated vertical delta dominates.
    it('flex1: 11 values, sumDx <= sumDy branch (d6 is dy6)', () => {
      // Make |sumDy| >= |sumDx|
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(1), ...encNum(10),   // dx1, dy1
        ...encNum(2), ...encNum(20),   // dx2, dy2
        ...encNum(-1), ...encNum(30),  // dx3, dy3
        ...encNum(-1), ...encNum(30),  // dx4, dy4
        ...encNum(1), ...encNum(20),   // dx5, dy5
        ...encNum(10),                 // d6
        OP_ESCAPE, OP_FLEX1,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.CubicTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // sumDx = |1+2-1-1+1| = 2
      // sumDy = |10+20+30+30+20| = 110
      // sumDx <= sumDy → dx6=-(1+2-1-1+1)=-2, dy6=10
      // Curve 1: cubicTo(1,10,2,20,-1,30) from (0,0)
      // cp1=(1,10), cp2=(3,30), end=(2,60)
      // Curve 2: cubicTo(-1,30,1,20,-2,10) from (2,60)
      // cp1=(1,90), cp2=(2,110), end=(0,120)
      expect(coords(outline)).toEqual([
        0, 0,
        1, 10, 3, 30, 2, 60,
        1, 90, 2, 110, 0, 120,
      ])
    })
  })

  // ==========================================================================
  // 6. Hint Operators
  // ==========================================================================
  describe('Hint Operators', () => {
    // Verifies hstem consumes its operands without emitting any outline data.
    it('hstem: 2 values (one pair)', () => {
      // hstem should consume stack and not produce outline
      const charstring = bytes(
        ...encNum(100), ...encNum(50), OP_HSTEM,
        ...encNum(10), ...encNum(20), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([10, 20])
      expect(width).toBe(0) // even stack → defaultWidthX
    })

    // Verifies vstem consumes multiple stem pairs without emitting any outline data.
    it('vstem: 4 values (two pairs)', () => {
      const charstring = bytes(
        ...encNum(50), ...encNum(100), ...encNum(200), ...encNum(50),
        OP_VSTEM,
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([5, 5])
      expect(width).toBe(0) // even stack → defaultWidthX
    })

    // Verifies hstemhm/vstemhm register stems so the following hintmask skips the correct mask byte count.
    it('hstemhm/vstemhm: same as hstem/vstem but hintmask follows', () => {
      // 2 hstemhm pairs + 1 vstemhm pair = 3 stems → ceil(3/8) = 1 mask byte
      const charstring = bytes(
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HSTEMHM,
        ...encNum(50), ...encNum(60),
        OP_VSTEMHM,
        OP_HINTMASK, 0b11100000, // 3 stems, 1 mask byte
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([5, 5])
    })

    // Verifies hintmask skips ceil(numStems/8) mask bytes so charstring parsing stays in sync.
    it('hintmask: skip correct number of mask bytes (ceil(numStems/8))', () => {
      // 9 stem pairs = 9 stems → ceil(9/8) = 2 mask bytes
      const stemPairs: number[] = []
      for (let i = 0; i < 18; i++) {
        stemPairs.push(...encNum(10))
      }

      const charstring = bytes(
        ...stemPairs, // 18 values = 9 stem pairs
        OP_HSTEMHM,
        OP_HINTMASK, 0xFF, 0x80, // 2 mask bytes for 9 stems
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([5, 5])
    })

    // Verifies operands still on the stack at hintmask are counted as implicit vstem hints.
    it('hintmask with implicit vstem before it', () => {
      // If stack is not empty when hintmask is encountered, values are treated as vstem
      // 2 hstem + 2 implicit vstem via hintmask = 4 stems → 1 mask byte
      const charstring = bytes(
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HSTEM,
        // 4 values on stack before hintmask → implicit 2 vstem pairs
        ...encNum(50), ...encNum(60), ...encNum(70), ...encNum(80),
        OP_HINTMASK, 0b11110000, // 4 stems, 1 mask byte
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([5, 5])
    })

    // Verifies cntrmask skips its mask bytes using the same stem-count rule as hintmask.
    it('cntrmask: same as hintmask for mask byte skipping', () => {
      // 2 stem pairs via hstemhm = 2 stems → 1 mask byte
      const charstring = bytes(
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HSTEMHM,
        OP_CNTRMASK, 0b11000000, // 2 stems, 1 mask byte
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
      expect(coords(outline)).toEqual([5, 5])
    })

    // Verifies an odd operand count on the first hstem yields width = nominalWidthX + first value.
    it('hstem with width: odd stack count means first value is width', () => {
      const charstring = bytes(
        // 3 values: width(80), stem pair (10, 20)
        ...encNum(80), ...encNum(10), ...encNum(20),
        OP_HSTEM,
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 100 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(100 + 80)
    })

    // Verifies an odd stack before the first hintmask is parsed as width plus implicit vstem pairs.
    it('hintmask with width: odd stack before hintmask → first is width', () => {
      // 3 values on stack (odd) → first is width, remaining 2 are implicit vstem
      const charstring = bytes(
        ...encNum(50), ...encNum(10), ...encNum(20),
        OP_HINTMASK, 0x80, // 1 stem, 1 mask byte
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 200 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(200 + 50)
    })
  })

  // ==========================================================================
  // 7. Width Parsing
  // ==========================================================================
  describe('Width Parsing', () => {
    // Verifies a lone operand before endchar is parsed as the glyph width.
    it('endchar with width on stack', () => {
      const charstring = bytes(
        ...encNum(42), OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 100 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(width).toBe(100 + 42)
      expect(outline.commands.length).toBe(0)
    })

    // Verifies the width formula nominalWidthX + operand, including negative operands.
    it('width value should be nominalWidthX + stack[0]', () => {
      const charstring = bytes(
        ...encNum(-30), ...encNum(10), ...encNum(20), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 500 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(500 + (-30)) // 470
    })

    // Verifies an even stack at the first hint operator means no width, so defaultWidthX applies.
    it('no width (even stack at first hint) → defaultWidthX', () => {
      const charstring = bytes(
        ...encNum(10), ...encNum(20), OP_HSTEM,
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { defaultWidthX: 600, nominalWidthX: 100 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(600)
    })

    // Verifies an even stack at the first moveto means no width, so defaultWidthX applies.
    it('no width (even stack at first moveto) → defaultWidthX', () => {
      const charstring = bytes(
        ...encNum(10), ...encNum(20), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { defaultWidthX: 700 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(700)
    })

    // Verifies the width operand is extracted when vmoveto carries an extra leading value.
    it('width from vmoveto', () => {
      const charstring = bytes(
        ...encNum(25), ...encNum(10), OP_VMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 300 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(300 + 25)
    })

    // Verifies the width operand is extracted when hmoveto carries an extra leading value.
    it('width from hmoveto', () => {
      const charstring = bytes(
        ...encNum(35), ...encNum(10), OP_HMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 400 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(400 + 35)
    })

    // Verifies width detection applies only to the first stack-clearing operator, not later movetos.
    it('width only parsed once (first operator)', () => {
      // Width in first rmoveto, second rmoveto should not re-parse width
      const charstring = bytes(
        ...encNum(50), ...encNum(10), ...encNum(20), OP_RMOVETO,
        // This rmoveto has 2 values, no width (widthParsed is already true)
        ...encNum(5), ...encNum(5), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 100 })
      const { width } = parseCffGlyph(cff, 0)

      expect(width).toBe(100 + 50)
    })
  })

  // ==========================================================================
  // 8. Subroutine Calls
  // ==========================================================================
  describe('Subroutine Calls', () => {
    // Verifies callsubr resolves the biased index and executes the local subroutine's drawing ops.
    it('callsubr: local subroutine that draws a line', () => {
      // For count < 1240, bias = 107
      // To call subr index 0: push (0 - 107) = -107
      const subrCharstring = bytes(
        ...encNum(10), ...encNum(20), OP_RLINETO,
        OP_RETURN,
      )
      const localSubrs = makeSubrIndex([subrCharstring])

      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(-107), OP_CALLSUBR, // subr index = -107 + 107 = 0
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { localSubrs })
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 10, 20])
    })

    // Verifies callgsubr resolves the biased index and executes the global subroutine's drawing ops.
    it('callgsubr: global subroutine that draws a line', () => {
      const subrCharstring = bytes(
        ...encNum(30), ...encNum(40), OP_RLINETO,
        OP_RETURN,
      )
      const globalSubrs = makeSubrIndex([subrCharstring])

      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(-107), OP_CALLGSUBR, // gsubr index = -107 + 107 = 0
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { globalSubrs })
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 30, 40])
    })

    // Verifies nested subroutine calls return to the correct caller position.
    it('nested: subroutine calls another subroutine', () => {
      // Inner subr (index 0): draws a line and returns
      const innerSubr = bytes(
        ...encNum(5), ...encNum(10), OP_RLINETO,
        OP_RETURN,
      )
      // Outer subr (index 1): calls inner subr, draws another line, returns
      const outerSubr = bytes(
        ...encNum(-107), OP_CALLSUBR, // calls subr 0
        ...encNum(15), ...encNum(25), OP_RLINETO,
        OP_RETURN,
      )
      const localSubrs = makeSubrIndex([innerSubr, outerSubr])

      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(-106), OP_CALLSUBR, // calls subr 1 (-106 + 107 = 1)
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { localSubrs })
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      // Line from inner: (5,10), line from outer: (5+15, 10+25)=(20,35)
      expect(coords(outline)).toEqual([0, 0, 5, 10, 20, 35])
    })

    // Verifies an out-of-range local subr index is skipped without throwing.
    it('out of range subrIndex: should not crash', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), OP_CALLSUBR, // subr index = 100 + 107 = 207, out of range
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      // Should not throw, just skip the call
      const { outline } = parseCffGlyph(cff, 0)
      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
    })

    // Verifies an out-of-range global subr index is skipped without throwing.
    it('out of range gsubr: should not crash', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), OP_CALLGSUBR, // gsubr index out of range
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(cmds(outline)).toEqual([PathCommand.MoveTo, PathCommand.Close])
    })

    // Verifies execution resumes in the caller when a subroutine ends without an explicit return opcode.
    it('subroutine with implicit return (no explicit return opcode)', () => {
      // The interpreter handles subroutines that end without an explicit return
      const subrCharstring = bytes(
        ...encNum(10), ...encNum(20), OP_RLINETO,
        // No OP_RETURN here
      )
      const localSubrs = makeSubrIndex([subrCharstring])

      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(-107), OP_CALLSUBR,
        ...encNum(5), ...encNum(5), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { localSubrs })
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 10, 20, 15, 25])
    })
  })

  // ==========================================================================
  // 9. endchar
  // ==========================================================================
  describe('endchar', () => {
    // Verifies endchar appends a Close command to the open contour.
    it('basic endchar closes open path', () => {
      const charstring = bytes(
        ...encNum(10), ...encNum(20), OP_RMOVETO,
        ...encNum(30), ...encNum(0), OP_RLINETO,
        ...encNum(0), ...encNum(30), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
    })

    // Verifies endchar with no started contour produces an empty outline.
    it('endchar without prior moveto → empty outline', () => {
      const charstring = bytes(OP_ENDCHAR)
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
    })

    // Verifies endchar still parses a pending width operand when the glyph has no outline.
    it('endchar with width on stack', () => {
      const charstring = bytes(
        ...encNum(75), OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 200 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(width).toBe(200 + 75)
      expect(outline.commands.length).toBe(0)
    })
  })

  // ==========================================================================
  // 10. Fixed 16.16 Numbers
  // ==========================================================================
  describe('Fixed 16.16 Numbers', () => {
    // Verifies the 5-byte operand (prefix 255) is decoded as 16.16 fixed point (1.5).
    it('encode 1.5 as fixed point (0x00018000)', () => {
      // 1.5 in 16.16 fixed = 0x00018000 = 98304
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        255, 0x00, 0x01, 0x80, 0x00, // 1.5 in 16.16 fixed
        ...encNum(0),
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 1.5, 0])
    })

    // Verifies negative 16.16 fixed-point operands decode correctly.
    it('encode -2.25 as fixed point', () => {
      // -2.25 in 16.16 fixed = -2.25 * 65536 = -147456 = 0xFFFDC000
      const fixed = (-2.25 * 65536) | 0
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        255, (fixed >>> 24) & 0xFF, (fixed >>> 16) & 0xFF, (fixed >>> 8) & 0xFF, fixed & 0xFF,
        ...encNum(0),
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(coords(outline)[2]).toBeCloseTo(-2.25, 4)
    })

    // Verifies fractional 16.16 operands survive into output coordinates without rounding.
    it('encode 0.5 as fixed point', () => {
      // 0.5 in 16.16 = 0x00008000 = 32768
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        255, 0x00, 0x00, 0x80, 0x00, // 0.5
        255, 0x00, 0x00, 0x80, 0x00, // 0.5
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(coords(outline)).toEqual([0, 0, 0.5, 0.5])
    })
  })

  // ==========================================================================
  // 11. Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    // Verifies a charstring containing only endchar yields an empty outline and defaultWidthX.
    it('empty charstring (just endchar)', () => {
      const charstring = bytes(OP_ENDCHAR)
      const cff = makeCffWithCharstring(charstring)
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
      expect(width).toBe(0) // defaultWidthX
    })

    // Verifies a width-only charstring (like .notdef) yields an empty outline but a parsed width.
    it('.notdef equivalent (no outline, just width + endchar)', () => {
      const charstring = bytes(
        ...encNum(50), OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 500 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
      expect(width).toBe(500 + 50)
    })

    // Verifies a second moveto auto-closes the previous contour before starting a new one.
    it('multiple contours (moveto, lines, moveto, lines, endchar)', () => {
      const charstring = bytes(
        // Contour 1: triangle
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), ...encNum(0), OP_RLINETO,
        ...encNum(0), ...encNum(100), OP_RLINETO,
        // Contour 2: another shape (moveto auto-closes contour 1)
        ...encNum(50), ...encNum(50), OP_RMOVETO,
        ...encNum(10), ...encNum(0), OP_RLINETO,
        ...encNum(0), ...encNum(10), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        // Contour 1
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close, // auto-close when second moveto
        // Contour 2
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close, // endchar close
      ])
      // Contour 1: (0,0), (100,0), (100,100)
      // Contour 2: moveTo is relative from current pos (100,100) + (50,50) = (150,150)
      // Then lines: (160,150), (160,160)
      expect(coords(outline)).toEqual([
        0, 0, 100, 0, 100, 100,
        150, 150, 160, 150, 160, 160,
      ])
    })

    // Verifies an out-of-range glyphId returns an empty outline with defaultWidthX instead of throwing.
    it('invalid glyphId returns empty outline', () => {
      const charstring = bytes(OP_ENDCHAR)
      const cff = makeCffWithCharstring(charstring, { defaultWidthX: 500 })

      const { outline, width } = parseCffGlyph(cff, 99) // out of range
      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
      expect(width).toBe(500)
    })

    // Verifies a negative glyphId returns an empty outline with defaultWidthX instead of throwing.
    it('negative glyphId returns empty outline', () => {
      const charstring = bytes(OP_ENDCHAR)
      const cff = makeCffWithCharstring(charstring, { defaultWidthX: 500 })

      const { outline, width } = parseCffGlyph(cff, -1)
      expect(outline.commands.length).toBe(0)
      expect(outline.coords.length).toBe(0)
      expect(width).toBe(500)
    })
  })

  // ==========================================================================
  // 12. Number Encoding
  // ==========================================================================
  describe('Number Encoding', () => {
    // Verifies the single-byte operand encoding decodes 0 (byte 139).
    it('single byte encoding: value 0 (encoded as 139)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(0), ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies the single-byte encoding upper bound 107 (byte 246) decodes correctly.
    it('single byte encoding: value 107 (max positive, encoded as 246)', () => {
      const charstring = bytes(
        ...encNum(107), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([107, 0])
    })

    // Verifies the single-byte encoding lower bound -107 (byte 32) decodes correctly.
    it('single byte encoding: value -107 (max negative, encoded as 32)', () => {
      const charstring = bytes(
        ...encNum(-107), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([-107, 0])
    })

    // Verifies the two-byte positive encoding lower bound 108 decodes correctly.
    it('two-byte positive encoding: value 108', () => {
      const charstring = bytes(
        ...encNum(108), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([108, 0])
    })

    // Verifies the two-byte positive encoding upper bound 1131 decodes correctly.
    it('two-byte positive encoding: value 1131 (max)', () => {
      const charstring = bytes(
        ...encNum(1131), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([1131, 0])
    })

    // Verifies the two-byte negative encoding lower bound -108 decodes correctly.
    it('two-byte negative encoding: value -108', () => {
      const charstring = bytes(
        ...encNum(-108), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([-108, 0])
    })

    // Verifies the two-byte negative encoding upper bound -1131 decodes correctly.
    it('two-byte negative encoding: value -1131 (max negative)', () => {
      const charstring = bytes(
        ...encNum(-1131), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([-1131, 0])
    })

    // Verifies operator 28 decodes a positive 16-bit integer beyond the two-byte range.
    it('Int16 encoding (op 28): value 2000', () => {
      const charstring = bytes(
        ...encNum(2000), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      // 2000 > 1131, so encNum should use op 28
      expect(encNum(2000)[0]).toBe(28)
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([2000, 0])
    })

    // Verifies operator 28 decodes a negative 16-bit integer via two's complement.
    it('Int16 encoding (op 28): negative value -2000', () => {
      const charstring = bytes(
        ...encNum(-2000), ...encNum(0), OP_RMOVETO,
        OP_ENDCHAR,
      )
      expect(encNum(-2000)[0]).toBe(28)
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([-2000, 0])
    })
  })

  // ==========================================================================
  // 13. Comprehensive Combined Operations
  // ==========================================================================
  describe('Combined Operations', () => {
    // Verifies a realistic charstring mixing width, hints, lines, and curves parses end to end.
    it('hints + moveto + lines + curves + endchar', () => {
      const charstring = bytes(
        // Width + hstem
        ...encNum(50), ...encNum(10), ...encNum(20), OP_HSTEM,
        // rmoveto
        ...encNum(100), ...encNum(200), OP_RMOVETO,
        // rlineto
        ...encNum(50), ...encNum(0), OP_RLINETO,
        // rrcurveto
        ...encNum(10), ...encNum(0), ...encNum(0), ...encNum(10), ...encNum(-10), ...encNum(0),
        OP_RRCURVETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { nominalWidthX: 500 })
      const { outline, width } = parseCffGlyph(cff, 0)

      expect(width).toBe(500 + 50)
      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.CubicTo,
        PathCommand.Close,
      ])
      // moveTo(100,200), lineTo(150,200)
      // cubicTo: from (150,200)
      // cp1=(160,200), cp2=(160,210), end=(150,210)
      expect(coords(outline)).toEqual([
        100, 200,
        150, 200,
        160, 200, 160, 210, 150, 210,
      ])
    })

    // Verifies hintmask can switch hints mid-path without corrupting the outline stream.
    it('hintmask between drawing operations', () => {
      // 2 hstem pairs + 2 vstem pairs = 4 stems → 1 mask byte
      const charstring = bytes(
        ...encNum(10), ...encNum(20), ...encNum(30), ...encNum(40),
        OP_HSTEMHM,
        ...encNum(50), ...encNum(60), ...encNum(70), ...encNum(80),
        OP_VSTEMHM,
        OP_HINTMASK, 0b11110000, // first mask
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), ...encNum(0), OP_RLINETO,
        OP_HINTMASK, 0b10100000, // switch hints mid-path
        ...encNum(0), ...encNum(100), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      expect(coords(outline)).toEqual([0, 0, 100, 0, 100, 100])
    })

    // Verifies drawing state (current point) carries across a subroutine call boundary.
    it('subroutine with curves and main charstring with lines', () => {
      // Subroutine draws a curve
      const subrCharstring = bytes(
        ...encNum(10), ...encNum(0), ...encNum(0), ...encNum(10), ...encNum(10), ...encNum(0),
        OP_RRCURVETO,
        OP_RETURN,
      )
      const localSubrs = makeSubrIndex([subrCharstring])

      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(50), ...encNum(0), OP_RLINETO,
        ...encNum(-107), OP_CALLSUBR, // call the curve subr
        ...encNum(0), ...encNum(-10), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring, { localSubrs })
      const { outline } = parseCffGlyph(cff, 0)

      expect(cmds(outline)).toEqual([
        PathCommand.MoveTo,
        PathCommand.LineTo,
        PathCommand.CubicTo,
        PathCommand.LineTo,
        PathCommand.Close,
      ])
      // moveTo(0,0), lineTo(50,0)
      // curve from (50,0): cp1=(60,0), cp2=(60,10), end=(70,10)
      // lineTo from (70,10): (70,0)
      expect(coords(outline)).toEqual([
        0, 0,
        50, 0,
        60, 0, 60, 10, 70, 10,
        70, 0,
      ])
    })
  })

  // ==========================================================================
  // 14. calcBias helper
  // ==========================================================================
  // Sanity-checks the test helper's bias formula against the CFF spec thresholds.
  describe('calcBias', () => {
    // Verifies the CFF bias formula for subr counts below 1240.
    it('count < 1240 → bias 107', () => {
      expect(calcBias(0)).toBe(107)
      expect(calcBias(1)).toBe(107)
      expect(calcBias(1239)).toBe(107)
    })

    // Verifies the CFF bias formula for subr counts in the middle range.
    it('count 1240..33899 → bias 1131', () => {
      expect(calcBias(1240)).toBe(1131)
      expect(calcBias(33899)).toBe(1131)
    })

    // Verifies the CFF bias formula for subr counts of 33900 or more.
    it('count >= 33900 → bias 32768', () => {
      expect(calcBias(33900)).toBe(32768)
      expect(calcBias(100000)).toBe(32768)
    })
  })

  // ==========================================================================
  // 15. Arithmetic Operators (12.x)
  // ==========================================================================
  describe('Arithmetic Operators', () => {
    // Verifies the abs operator (12 9) replaces a negative top-of-stack value with its absolute value.
    it('abs: absolute value of negative', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(-50), OP_ESCAPE, 9, // abs(-50) = 50
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 50, 0])
    })

    // Verifies abs leaves positive values unchanged.
    it('abs: absolute value of positive is unchanged', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(30), OP_ESCAPE, 9, // abs(30) = 30
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 30, 0])
    })

    // Verifies the add operator (12 10) pops two operands and pushes their sum.
    it('add: a + b', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), OP_ESCAPE, 10, // add(10, 20) = 30
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 30, 0])
    })

    // Verifies the sub operator (12 11) pushes a - b.
    it('sub: a - b', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(50), ...encNum(20), OP_ESCAPE, 11, // sub(50, 20) = 30
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 30, 0])
    })

    // Verifies the div operator (12 12) pushes the quotient a / b.
    it('div: a / b', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), ...encNum(4), OP_ESCAPE, 12, // div(100, 4) = 25
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 25, 0])
    })

    // Verifies division by zero yields 0 instead of Infinity/NaN in output coordinates.
    it('div by zero returns 0', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), ...encNum(0), OP_ESCAPE, 12, // div(100, 0) = 0
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies the neg operator (12 14) negates the top of the stack.
    it('neg: negate value', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(42), OP_ESCAPE, 14, // neg(42) = -42
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, -42, 0])
    })

    // Verifies the mul operator (12 24) pushes the product a * b.
    it('mul: a * b', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(5), ...encNum(6), OP_ESCAPE, 24, // mul(5, 6) = 30
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 30, 0])
    })

    // Verifies random (12 23) is implemented deterministically as 1 for reproducible output.
    it('random: returns 1 (deterministic)', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        OP_ESCAPE, 23, // random → 1
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 1, 0])
    })
  })

  // ==========================================================================
  // 16. Logic Operators (12.x)
  // ==========================================================================
  describe('Logic Operators', () => {
    // Verifies the and operator (12 3) pushes 1 when both operands are non-zero.
    it('and: true && true → 1', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(1), ...encNum(1), OP_ESCAPE, 3, // and(1, 1) = 1
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 1, 0])
    })

    // Verifies and pushes 0 when either operand is zero.
    it('and: true && false → 0', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(1), ...encNum(0), OP_ESCAPE, 3, // and(1, 0) = 0
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies the or operator (12 4) pushes 1 when either operand is non-zero.
    it('or: false || true → 1', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(0), ...encNum(1), OP_ESCAPE, 4, // or(0, 1) = 1
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 1, 0])
    })

    // Verifies or pushes 0 when both operands are zero.
    it('or: false || false → 0', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(0), ...encNum(0), OP_ESCAPE, 4, // or(0, 0) = 0
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies the not operator (12 5) maps zero to 1.
    it('not: 0 → 1', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(0), OP_ESCAPE, 5, // not(0) = 1
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 1, 0])
    })

    // Verifies not maps any non-zero value to 0.
    it('not: non-zero → 0', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(42), OP_ESCAPE, 5, // not(42) = 0
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies the eq operator (12 15) pushes 1 for equal operands.
    it('eq: equal values → 1', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(42), ...encNum(42), OP_ESCAPE, 15, // eq(42, 42) = 1
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 1, 0])
    })

    // Verifies eq pushes 0 for unequal operands.
    it('eq: unequal values → 0', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(42), ...encNum(43), OP_ESCAPE, 15, // eq(42, 43) = 0
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies ifelse (12 22) selects s1 when v1 <= v2.
    it('ifelse: v1 <= v2 → s1', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), // s1=10, s2=20
        ...encNum(5), ...encNum(10),  // v1=5, v2=10
        OP_ESCAPE, 22,                // ifelse → v1<=v2 → s1=10
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 10, 0])
    })

    // Verifies ifelse selects s2 when v1 > v2.
    it('ifelse: v1 > v2 → s2', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), // s1=10, s2=20
        ...encNum(15), ...encNum(5),  // v1=15, v2=5
        OP_ESCAPE, 22,                // ifelse → v1>v2 → s2=20
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 20, 0])
    })
  })

  // ==========================================================================
  // 17. Stack Manipulation Operators (12.x)
  // ==========================================================================
  describe('Stack Manipulation Operators', () => {
    // Verifies drop (12 18) removes only the top stack element.
    it('drop: remove top element', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(99), OP_ESCAPE, 18, // drop(99)
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 10, 0])
    })

    // Verifies dup (12 27) duplicates the top stack element.
    it('dup: duplicate top element', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(15), OP_ESCAPE, 27, // dup → [15, 15]
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      // rlineto(15, 15)
      expect(coords(outline)).toEqual([0, 0, 15, 15])
    })

    // Verifies exch (12 28) swaps the top two stack elements.
    it('exch: exchange top two elements', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), OP_ESCAPE, 28, // exch → [20, 10]
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      // rlineto(20, 10)
      expect(coords(outline)).toEqual([0, 0, 20, 10])
    })

    // Verifies index (12 29) copies the nth element from the top onto the stack.
    it('index: copy nth element from top', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30),
        ...encNum(2), OP_ESCAPE, 29, // index(2) → copy stack[-3] = 10
        // stack now: [10, 20, 30, 10]
        OP_ESCAPE, 18, // drop → [10, 20, 30]
        OP_ESCAPE, 18, // drop → [10, 20]
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 10, 20])
    })

    // Verifies roll (12 30) rotates the top N stack elements by J positions.
    it('roll: rotate N elements by J positions', () => {
      // stack: [10, 20, 30], roll(3, 1) → [30, 10, 20]
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30),
        ...encNum(3), ...encNum(1), OP_ESCAPE, 30, // roll(N=3, J=1)
        // stack: [30, 10, 20] → drop 20 → [30, 10]
        OP_ESCAPE, 18, // drop
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      // rlineto(30, 10)
      expect(coords(outline)).toEqual([0, 0, 30, 10])
    })

    // Verifies roll with a negative J rotates in the opposite direction.
    it('roll: negative J rotates in opposite direction', () => {
      // stack: [10, 20, 30], roll(3, -1) → [20, 30, 10]
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(20), ...encNum(30),
        ...encNum(3), ...encNum(-1), OP_ESCAPE, 30, // roll(N=3, J=-1)
        // stack: [20, 30, 10] → drop 10 → [20, 30]
        OP_ESCAPE, 18, // drop
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      // rlineto(20, 30)
      expect(coords(outline)).toEqual([0, 0, 20, 30])
    })
  })

  // ==========================================================================
  // 18. Storage Operators (12.x)
  // ==========================================================================
  describe('Storage Operators', () => {
    // Verifies put (12 20) and get (12 21) round-trip a value through the transient array.
    it('put/get: store and retrieve value', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(42), ...encNum(0), OP_ESCAPE, 20, // put(42, index=0)
        ...encNum(0), OP_ESCAPE, 21,                // get(index=0) → 42
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 42, 0])
    })

    // Verifies get on an unwritten transient-array slot returns 0.
    it('get: uninitialized index returns 0', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(5), OP_ESCAPE, 21, // get(index=5) → 0 (uninitialized)
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 0, 0])
    })

    // Verifies the transient array keeps independent values per index.
    it('put/get: multiple indices', () => {
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(10), ...encNum(0), OP_ESCAPE, 20, // put(10, 0)
        ...encNum(20), ...encNum(1), OP_ESCAPE, 20, // put(20, 1)
        ...encNum(0), OP_ESCAPE, 21,                // get(0) → 10
        ...encNum(1), OP_ESCAPE, 21,                // get(1) → 20
        OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 10, 20])
    })
  })

  // ==========================================================================
  // 19. Combined Arithmetic + Drawing
  // ==========================================================================
  describe('Arithmetic + Drawing Combinations', () => {
    // Verifies chained arithmetic results feed directly into drawing operands.
    it('compute coordinate with add and mul', () => {
      // (3 + 7) * 5 = 50
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(3), ...encNum(7), OP_ESCAPE, 10, // add → 10
        ...encNum(5), OP_ESCAPE, 24,               // mul → 50
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 50, 0])
    })

    // Verifies an ifelse result can be consumed as a drawing coordinate.
    it('conditional drawing with ifelse', () => {
      // ifelse(s1=100, s2=200, v1=3, v2=5) → v1<=v2 → 100
      const charstring = bytes(
        ...encNum(0), ...encNum(0), OP_RMOVETO,
        ...encNum(100), ...encNum(200), // s1, s2
        ...encNum(3), ...encNum(5),     // v1, v2
        OP_ESCAPE, 22,                  // ifelse → 100
        ...encNum(0), OP_RLINETO,
        OP_ENDCHAR,
      )
      const cff = makeCffWithCharstring(charstring)
      const { outline } = parseCffGlyph(cff, 0)
      expect(coords(outline)).toEqual([0, 0, 100, 0])
    })
  })
})
