import { describe, it, expect } from 'vitest'
import { isDefinedTrueTypeOpcode, TrueTypeInterpreter, type InterpreterOptions } from '../../src/hinting/interpreter.js'
import { RoundState } from '../../src/hinting/graphics-state.js'
import type { ZonePoint } from '../../src/hinting/graphics-state.js'
import { BinaryReader } from '../../src/binary/reader.js'
import { parseCvt } from '../../src/parsers/tables/cvt.js'

function createInterpreter(ppem = 16, overrides: Partial<InterpreterOptions> = {}) {
  return new TrueTypeInterpreter({
    ppem,
    unitsPerEm: 1000,
    maxTwilightPoints: 64,
    maxStorage: 64,
    maxFunctionDefs: 64,
    maxInstructionDefs: 64,
    maxStackElements: 256,
    ...overrides,
  })
}

const INTERPRETER_LIMITS = {
  maxTwilightPoints: 64,
  maxStorage: 64,
  maxFunctionDefs: 64,
  maxInstructionDefs: 64,
  maxStackElements: 256,
}

function makePoint(x: number, y: number): ZonePoint {
  return { x, y, origX: x, origY: y, orusX: x, orusY: y, touchedX: false, touchedY: false, onCurve: true }
}

function buildCvt(values: number[]) {
  const buf = new ArrayBuffer(values.length * 2)
  const view = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    view.setInt16(i * 2, values[i]!)
  }
  return parseCvt(new BinaryReader(buf))
}

describe('TrueType Hinting Interpreter', () => {
  describe('Push instructions', () => {
    // Verifies PUSHB[n] pushes n+1 unsigned inline bytes onto the stack.
    it('PUSHB[n] pushes n+1 bytes', () => {
      const interp = createInterpreter()
      // PUSHB[2] = 0xB2 → push 3 bytes
      interp.execute(new Uint8Array([0xB2, 10, 20, 30]))
      expect(interp.getStack()).toEqual([10, 20, 30])
    })

    // Verifies PUSHW[n] sign-extends 16-bit words (0xFF00 → -256).
    it('PUSHW[n] pushes n+1 signed words', () => {
      const interp = createInterpreter()
      // PUSHW[0] = 0xB8 → push 1 word
      // 0xFF00 = -256 (signed)
      interp.execute(new Uint8Array([0xB8, 0xFF, 0x00]))
      expect(interp.getStack()).toEqual([-256])
    })

    // Verifies NPUSHB reads its byte count operand and pushes that many bytes.
    it('NPUSHB pushes n bytes', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x40, 3, 1, 2, 3]))
      expect(interp.getStack()).toEqual([1, 2, 3])
    })

    // Verifies NPUSHW reads its word count operand and pushes signed 16-bit words.
    it('NPUSHW pushes n signed words', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x41, 2, 0x00, 0x0A, 0xFF, 0xF6]))
      expect(interp.getStack()).toEqual([10, -10])
    })
  })

  describe('Stack manipulation', () => {
    // Verifies DUP duplicates the top stack element.
    it('DUP duplicates top', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 42, 0x20])) // PUSHB[0] 42, DUP
      expect(interp.getStack()).toEqual([42, 42])
    })

    // Verifies POP removes only the top stack element.
    it('POP removes top', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 1, 2, 0x21])) // PUSHB[1] 1 2, POP
      expect(interp.getStack()).toEqual([1])
    })

    // Verifies CLEAR discards the entire stack.
    it('CLEAR empties stack', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 1, 2, 0x22])) // PUSHB[1] 1 2, CLEAR
      expect(interp.getStack()).toEqual([])
    })

    // Verifies SWAP exchanges the top two stack elements.
    it('SWAP swaps top two', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 1, 2, 0x23])) // PUSHB[1] 1 2, SWAP
      expect(interp.getStack()).toEqual([2, 1])
    })

    // Verifies DEPTH pushes the current element count without consuming anything.
    it('DEPTH pushes stack depth', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 1, 2, 0x24])) // PUSHB[1] 1 2, DEPTH
      expect(interp.getStack()).toEqual([1, 2, 2])
    })

    // Verifies CINDEX copies the kth element from the top onto the stack.
    it('CINDEX copies kth element', () => {
      const interp = createInterpreter()
      // Stack: 10 20 30, CINDEX 2 → copies 20 → 10 20 30 20
      interp.execute(new Uint8Array([0xB2, 10, 20, 30, 0xB0, 2, 0x25]))
      expect(interp.getStack()).toEqual([10, 20, 30, 20])
    })

    // Verifies MINDEX removes the kth element and moves it to the top.
    it('MINDEX moves kth element to top', () => {
      const interp = createInterpreter()
      // Stack: 10 20 30, MINDEX 3 → 20 30 10
      interp.execute(new Uint8Array([0xB2, 10, 20, 30, 0xB0, 3, 0x26]))
      expect(interp.getStack()).toEqual([20, 30, 10])
    })

    // Verifies ROLL rotates the top three elements per the spec ordering.
    it('ROLL rotates top three', () => {
      const interp = createInterpreter()
      // Stack: 1 2 3, ROLL → 2 3 1  (spec: a=3, b=2, c=1 → push b, a, c = 2, 3, 1)
      interp.execute(new Uint8Array([0xB2, 1, 2, 3, 0x8A]))
      expect(interp.getStack()).toEqual([2, 3, 1])
    })
  })

  describe('Arithmetic', () => {
    // Verifies ADD sums the top two values.
    it('ADD adds two values', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 100, 50, 0x60]))
      expect(interp.getStack()).toEqual([150])
    })

    // Verifies SUB computes second-from-top minus top.
    it('SUB subtracts', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 100, 30, 0x61]))
      expect(interp.getStack()).toEqual([70])
    })

    // Verifies MUL performs F26Dot6 fixed-point multiplication (a*b/64).
    it('MUL multiplies (F26Dot6)', () => {
      const interp = createInterpreter()
      // 128 * 128 / 64 = 256
      interp.execute(new Uint8Array([0xB1, 128, 128, 0x63]))
      expect(interp.getStack()).toEqual([256])
    })

    // Verifies DIV performs F26Dot6 fixed-point division (a*64/b).
    it('DIV divides (F26Dot6)', () => {
      const interp = createInterpreter()
      // 128 * 64 / 64 = 128
      interp.execute(new Uint8Array([0xB1, 128, 64, 0x62]))
      expect(interp.getStack()).toEqual([128])
    })

    // Verifies ABS converts a negative value to its absolute value.
    it('ABS returns absolute value', () => {
      const interp = createInterpreter()
      // Push -10 (0xFFF6) then ABS
      interp.execute(new Uint8Array([0xB8, 0xFF, 0xF6, 0x64]))
      expect(interp.getStack()).toEqual([10])
    })

    // Verifies NEG flips the sign of the top value.
    it('NEG negates', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 42, 0x65]))
      expect(interp.getStack()).toEqual([-42])
    })

    // Verifies FLOOR truncates a value down to the nearest 64 (F26Dot6 grid unit).
    it('FLOOR floors to F26Dot6 grid', () => {
      const interp = createInterpreter()
      // 100 → floor(100/64)*64 = 64
      interp.execute(new Uint8Array([0xB0, 100, 0x66]))
      expect(interp.getStack()).toEqual([64])
    })

    // Verifies CEILING rounds a value up to the nearest 64 (F26Dot6 grid unit).
    it('CEILING ceils to F26Dot6 grid', () => {
      const interp = createInterpreter()
      // 65 → ceil(65/64)*64 = 128
      interp.execute(new Uint8Array([0xB0, 65, 0x67]))
      expect(interp.getStack()).toEqual([128])
    })

    // Verifies MAX keeps the larger and MIN keeps the smaller of the top two values.
    it('MAX and MIN', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 10, 20, 0x8B])) // MAX
      expect(interp.getStack()).toEqual([20])

      const interp2 = createInterpreter()
      interp2.execute(new Uint8Array([0xB1, 10, 20, 0x8C])) // MIN
      expect(interp2.getStack()).toEqual([10])
    })
  })

  describe('Comparison and Logical', () => {
    // Verifies the ordered comparison opcodes LT/LTEQ/GT push 1 for true conditions.
    it('LT, LTEQ, GT, GTEQ', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 5, 10, 0x50])) // 5 < 10 → 1
      expect(interp.getStack()).toEqual([1])

      const interp2 = createInterpreter()
      interp2.execute(new Uint8Array([0xB1, 10, 10, 0x51])) // 10 <= 10 → 1
      expect(interp2.getStack()).toEqual([1])

      const interp3 = createInterpreter()
      interp3.execute(new Uint8Array([0xB1, 10, 5, 0x52])) // 10 > 5 → 1
      expect(interp3.getStack()).toEqual([1])
    })

    // Verifies EQ and NEQ push 1 for equal and unequal operands respectively.
    it('EQ and NEQ', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 10, 10, 0x54])) // EQ
      expect(interp.getStack()).toEqual([1])

      const interp2 = createInterpreter()
      interp2.execute(new Uint8Array([0xB1, 10, 20, 0x55])) // NEQ
      expect(interp2.getStack()).toEqual([1])
    })

    // Verifies the logical opcodes AND, OR, and NOT produce boolean 0/1 results.
    it('AND, OR, NOT', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB1, 1, 1, 0x5A])) // AND
      expect(interp.getStack()).toEqual([1])

      const interp2 = createInterpreter()
      interp2.execute(new Uint8Array([0xB1, 0, 1, 0x5B])) // OR
      expect(interp2.getStack()).toEqual([1])

      const interp3 = createInterpreter()
      interp3.execute(new Uint8Array([0xB0, 0, 0x5C])) // NOT 0 → 1
      expect(interp3.getStack()).toEqual([1])
    })
  })

  describe('Control flow', () => {
    // Verifies IF executes its body when the condition is non-zero.
    it('IF/EIF — true branch', () => {
      const interp = createInterpreter()
      // PUSHB 1, IF, PUSHB 42, EIF
      interp.execute(new Uint8Array([0xB0, 1, 0x58, 0xB0, 42, 0x59]))
      expect(interp.getStack()).toEqual([42])
    })

    // Verifies IF skips its body (including embedded push data) when the condition is zero.
    it('IF/EIF — false branch skips', () => {
      const interp = createInterpreter()
      // PUSHB 0, IF, PUSHB 42, EIF
      interp.execute(new Uint8Array([0xB0, 0, 0x58, 0xB0, 42, 0x59]))
      expect(interp.getStack()).toEqual([])
    })

    // Verifies a false condition transfers control to the ELSE branch.
    it('IF/ELSE/EIF', () => {
      const interp = createInterpreter()
      // PUSHB 0, IF, PUSHB 1, ELSE, PUSHB 2, EIF
      interp.execute(new Uint8Array([0xB0, 0, 0x58, 0xB0, 1, 0x1B, 0xB0, 2, 0x59]))
      expect(interp.getStack()).toEqual([2])
    })

    // Verifies FDEF stores a function body and CALL executes it by index.
    it('FDEF/CALL — function definition and call', () => {
      const interp = createInterpreter()
      // Define function 0: pushes 99
      // PUSHB 0, FDEF, PUSHB 99, ENDF, PUSHB 0, CALL
      interp.execute(new Uint8Array([0xB0, 0, 0x2C, 0xB0, 99, 0x2D, 0xB0, 0, 0x2B]))
      expect(interp.getStack()).toEqual([99])
    })

    // Verifies LOOPCALL invokes the referenced function the requested number of times.
    it('LOOPCALL — calls function multiple times', () => {
      const interp = createInterpreter()
      // Define function 1: DUP
      // PUSHB 1, FDEF, DUP, ENDF
      // PUSHB 42, PUSHB 3, PUSHB 1, LOOPCALL
      interp.execute(new Uint8Array([
        0xB0, 1, 0x2C, 0x20, 0x2D,       // FDEF 1: DUP, ENDF
        0xB0, 42,                          // PUSHB 42
        0xB1, 3, 1,                        // PUSHB 3 1
        0x2A,                              // LOOPCALL
      ]))
      // After 3 DUPs: 42 42 42 42
      expect(interp.getStack()).toEqual([42, 42, 42, 42])
    })

    // Verifies JMPR advances the instruction pointer by the popped relative offset, skipping instructions.
    it('JMPR — jump relative', () => {
      const interp = createInterpreter()
      // PUSHB 3, JMPR (jump forward 3), PUSHB 99 (skipped), PUSHB 42
      interp.execute(new Uint8Array([0xB0, 3, 0x1C, 0xB0, 99, 0xB0, 42]))
      expect(interp.getStack()).toEqual([42])
    })
  })

  describe('Graphics state', () => {
    // Verifies SRP0/SRP1/SRP2 store their operands into the rp0/rp1/rp2 reference points.
    it('SRP0/SRP1/SRP2 set reference points', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 5, 0x10, 0xB0, 6, 0x11, 0xB0, 7, 0x12]))
      expect(interp.gs.rp0).toBe(5)
      expect(interp.gs.rp1).toBe(6)
      expect(interp.gs.rp2).toBe(7)
    })

    // Verifies SZP0 switches zone pointer 0 to the twilight zone (0).
    it('SZP0/SZP1/SZP2 set zone pointers', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 0, 0x13])) // SZP0 = 0
      expect(interp.gs.zp0).toBe(0)
    })

    // Verifies SZPS sets all three zone pointers at once.
    it('SZPS sets all zone pointers', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 0, 0x16]))
      expect(interp.gs.zp0).toBe(0)
      expect(interp.gs.zp1).toBe(0)
      expect(interp.gs.zp2).toBe(0)
    })

    // Verifies SLOOP updates the loop counter used by looping point instructions.
    it('SLOOP sets loop counter', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 5, 0x17]))
      expect(interp.gs.loop).toBe(5)
    })

    // Verifies SMD stores the minimum distance value in F26Dot6 units.
    it('SMD sets minimum distance', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 32, 0x1A]))
      expect(interp.gs.minimumDistance).toBe(32)
    })
  })

  describe('Round state', () => {
    // Verifies RTG switches the round state to grid rounding.
    it('RTG sets round to grid', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x18]))
      expect(interp.gs.roundState).toBe(RoundState.TO_GRID)
    })

    // Verifies RTHG switches the round state to half-grid rounding.
    it('RTHG sets round to half grid', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x19]))
      expect(interp.gs.roundState).toBe(RoundState.TO_HALF_GRID)
    })

    // Verifies ROFF turns rounding off entirely.
    it('ROFF disables rounding', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x7A]))
      expect(interp.gs.roundState).toBe(RoundState.OFF)
    })

    // Verifies roundValue snaps F26Dot6 values to the nearest full pixel under TO_GRID.
    it('roundValue with RTG', () => {
      const interp = createInterpreter()
      interp.gs.roundState = RoundState.TO_GRID
      expect(interp.roundValue(100)).toBe(128) // round(100/64)*64 = 2*64 = 128
      expect(interp.roundValue(32)).toBe(64)   // round(32/64)*64 = round(0.5)*64 = 64
      expect(interp.roundValue(33)).toBe(64)   // round(33/64)*64 = 64
    })

    // Verifies roundValue snaps to half-pixel positions (n + 0.5) under TO_HALF_GRID.
    it('roundValue with RTHG', () => {
      const interp = createInterpreter()
      interp.gs.roundState = RoundState.TO_HALF_GRID
      expect(interp.roundValue(100)).toBe(96)  // floor(100/64)*64+32 = 96
      expect(interp.roundValue(32)).toBe(32)   // floor(32/64)*64+32 = 32
    })

    // Verifies roundValue is the identity when rounding is OFF.
    it('roundValue with ROFF', () => {
      const interp = createInterpreter()
      interp.gs.roundState = RoundState.OFF
      expect(interp.roundValue(100)).toBe(100)
    })
  })

  describe('Vector operations', () => {
    // Verifies SVTCA[X] aligns both projection and freedom vectors to the X axis.
    it('SVTCA[X] sets both vectors to X axis', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x01])) // SVTCA[X]
      expect(interp.gs.projectionVector).toEqual({ x: 1, y: 0 })
      expect(interp.gs.freedomVector).toEqual({ x: 1, y: 0 })
    })

    // Verifies SVTCA[Y] aligns both projection and freedom vectors to the Y axis.
    it('SVTCA[Y] sets both vectors to Y axis', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0x00])) // SVTCA[Y]
      expect(interp.gs.projectionVector).toEqual({ x: 0, y: 1 })
      expect(interp.gs.freedomVector).toEqual({ x: 0, y: 1 })
    })

    // Verifies GPV pushes the projection vector components in F2Dot14 format.
    it('GPV returns projection vector', () => {
      const interp = createInterpreter()
      // Set PV to X axis, then GPV
      interp.execute(new Uint8Array([0x01, 0x0C])) // SVTCA[X], GPV
      const stack = interp.getStack()
      expect(stack[0]).toBe(16384) // x = 1.0 in F2Dot14
      expect(stack[1]).toBe(0)     // y = 0.0
    })

    // Verifies MPPEM pushes the interpreter's configured pixels-per-em.
    it('MPPEM returns current ppem', () => {
      const interp = createInterpreter(24)
      interp.execute(new Uint8Array([0x4B]))
      expect(interp.getStack()).toEqual([24])
    })

    it('MPS returns point size in F26Dot6 independently of ppem', () => {
      const interp = createInterpreter(20, { pointSize: 12.5 })
      interp.execute(new Uint8Array([0x4C]))
      expect(interp.getStack()).toEqual([800])
    })

    it('SANGW stores the deprecated angle-weight graphics-state value', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 37, 0x7E]))
      expect(interp.gs.angleWeight).toBe(37)
    })
  })

  describe('Storage', () => {
    // Verifies WS writes to the storage area and RS reads the same slot back.
    it('WS/RS write and read storage', () => {
      const interp = createInterpreter()
      // WS: store 42 at index 5 → PUSHB 5 42, WS, PUSHB 5, RS
      interp.execute(new Uint8Array([0xB1, 5, 42, 0x42, 0xB0, 5, 0x43]))
      expect(interp.getStack()).toEqual([42])
    })
  })

  describe('CVT operations', () => {
    // Verifies RCVT converts the CVT entry from font units to F26Dot6 pixels using ppem/unitsPerEm.
    it('RCVT reads CVT value scaled to F26Dot6', () => {
      const cvt = buildCvt([100, 200, -50])
      const interp = new TrueTypeInterpreter({ ppem: 16, unitsPerEm: 1000, cvt, ...INTERPRETER_LIMITS })
      // PUSHB 1, RCVT → read CVT[1] = 200, scale to F26Dot6
      interp.execute(new Uint8Array([0xB0, 1, 0x45]))
      const stack = interp.getStack()
      // 200 * (16/1000) * 64 = 204.8 → 205
      expect(stack[0]).toBeCloseTo(205, 0)
    })
  })

  describe('fpgm/prep execution', () => {
    // Verifies functions defined by the font program (fpgm) persist and are callable later.
    it('fpgm defines functions available in later execution', () => {
      // fpgm: define function 0 that pushes 77
      const fpgm = new Uint8Array([0xB0, 0, 0x2C, 0xB0, 77, 0x2D])
      const interp = new TrueTypeInterpreter({ ppem: 16, fpgm, ...INTERPRETER_LIMITS })

      // Now call function 0
      interp.execute(new Uint8Array([0xB0, 0, 0x2B]))
      expect(interp.getStack()).toEqual([77])
    })

    // Verifies prep establishes the graphics state inherited by glyph programs.
    it('prep executes at init and modifies GS', () => {
      // prep: set minimum distance to 32
      const prep = new Uint8Array([0xB0, 32, 0x1A])
      const interp = new TrueTypeInterpreter({ ppem: 16, prep, ...INTERPRETER_LIMITS })
      expect(interp.gs.minimumDistance).toBe(32)
    })
  })

  describe('Point movement', () => {
    // Verifies MDAP[1] touches the point and updates rp0/rp1 to it.
    it('MDAP[1] rounds point to grid', () => {
      const interp = createInterpreter()
      interp.gs.projectionVector = { x: 1, y: 0 }
      interp.gs.freedomVector = { x: 1, y: 0 }
      interp.setGlyphZone([makePoint(100, 0)]) // x=100 in F26Dot6

      // MDAP[1] with rounding on point 0
      interp.execute(new Uint8Array([0xB0, 0, 0x2F]))
      const pt = interp.gs // check rp0/rp1
      expect(pt.rp0).toBe(0)
      expect(pt.rp1).toBe(0)
    })

    // Verifies SHPIX shifts the point along the freedom vector by the given F26Dot6 amount and marks it touched.
    it('SHPIX moves point along freedom vector', () => {
      const interp = createInterpreter()
      interp.gs.projectionVector = { x: 1, y: 0 }
      interp.gs.freedomVector = { x: 1, y: 0 }
      const points = [makePoint(0, 0)]
      interp.setGlyphZone(points)

      // PUSHB 0 64, SHPIX → move point 0 by 64 (1 pixel) along X
      interp.execute(new Uint8Array([0xB1, 0, 64, 0x38]))
      // Point should have moved by 64 in X
      expect(points[0]!.x).toBe(64)
      expect(points[0]!.touchedX).toBe(true)
    })
  })

  describe('GETINFO', () => {
    // Verifies GETINFO with selector bit 0 reports the engine version number.
    it('returns version when selector bit 0 set', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 1, 0x88]))
      expect(interp.getStack()).toEqual([40])
    })

    // Verifies GETINFO with selector bit 5 sets the grayscale-rendering result bit (0x1000).
    it('returns grayscale flag when selector bit 5 set', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([0xB0, 32, 0x88]))
      expect(interp.getStack()[0]! & 0x1000).toBe(0x1000)
    })

    it('reports and returns normalized variation coordinates', () => {
      const interp = createInterpreter(16, { normalizedCoords: [-1, 0.5] })
      interp.execute(new Uint8Array([0xB0, 8, 0x88, 0x91]))
      expect(interp.getStack()).toEqual([0x0400, -16384, 8192])
    })

    it('maps every OpenType 1.9.1 capability selector to its result bit', () => {
      const interp = createInterpreter(16, {
        normalizedCoords: [0],
        rotated: true,
        stretched: true,
        getInfo: {
          grayscale: true,
          clearType: true,
          compatibleWidths: true,
          verticalLcd: true,
          bgr: true,
          subpixelPositioned: true,
          symmetricRendering: true,
          clearTypeGray: true,
        },
      })
      interp.execute(new Uint8Array([0xB8, 0x1F, 0xFF, 0x88]))
      expect(interp.getStack()).toEqual([0xFF728])
    })

    it('implements the v40 INSTCTRL native-ClearType waiver', () => {
      const interp = createInterpreter(16, { backwardCompatibility: true })
      const points = [makePoint(0, 0)]
      interp.setGlyphZone(points)
      interp.executeGlyphProgram(new Uint8Array([
        0xB1, 0, 64, 0x38,
        0xB1, 4, 3, 0x8E,
        0xB1, 0, 64, 0x38,
      ]))
      expect(points[0]!.x).toBe(64)
    })
  })

  describe('Contour point flags', () => {
    it('implements FLIPPT and FLIP range instructions', () => {
      const interp = createInterpreter()
      const points = [makePoint(0, 0), makePoint(64, 0)]
      points[1]!.onCurve = false
      interp.setGlyphZone(points)
      interp.execute(new Uint8Array([
        0xB0, 2, 0x17,       // SLOOP 2
        0xB1, 0, 1, 0x80,    // FLIPPT points 1 and 0
      ]))
      expect(points.map(point => point.onCurve)).toEqual([false, true])

      interp.execute(new Uint8Array([0xB1, 0, 1, 0x82]))
      expect(points.map(point => point.onCurve)).toEqual([false, false])
      interp.execute(new Uint8Array([0xB1, 0, 1, 0x81]))
      expect(points.map(point => point.onCurve)).toEqual([true, true])
    })
  })

  describe('maxp execution profile', () => {
    it('enforces stack, storage, function, and instruction-definition limits', () => {
      expect(() => createInterpreter(16, { maxStackElements: 1 }).execute(
        new Uint8Array([0xB1, 1, 2]),
      )).toThrow('exceeds maxp.maxStackElements 1')

      expect(() => createInterpreter(16, { maxStorage: 1 }).execute(
        new Uint8Array([0xB1, 1, 42, 0x42]),
      )).toThrow('storage index 1 exceeds maxp.maxStorage 1')

      expect(() => createInterpreter(16, { maxFunctionDefs: 1 }).execute(
        new Uint8Array([0xB0, 1, 0x2C, 0x2D]),
      )).toThrow('function 1 exceeds maxp.maxFunctionDefs 1')

      expect(() => createInterpreter(16, { maxInstructionDefs: 0 }).execute(
        new Uint8Array([0xB0, 0x83, 0x89, 0x2D]),
      )).toThrow('instruction definitions exceed maxp.maxInstructionDefs 0')
    })
  })

  describe('Edge cases', () => {
    // Verifies executing an empty program leaves the stack empty without throwing.
    it('empty bytecode does not crash', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([]))
      expect(interp.getStack()).toEqual([])
    })

    // Verifies popping from an empty stack (ADD with no operands) raises an error.
    it('stack underflow throws', () => {
      const interp = createInterpreter()
      expect(() => interp.execute(new Uint8Array([0x60]))).toThrow() // ADD with empty stack
    })

    // Verifies DIV throws a descriptive error when the divisor is zero.
    it('division by zero throws', () => {
      const interp = createInterpreter()
      expect(() => interp.execute(new Uint8Array([0xB1, 100, 0, 0x62]))).toThrow('DIV')
    })

    it('DIV truncates toward zero as specified for F26Dot6 division', () => {
      const positive = createInterpreter()
      positive.execute(new Uint8Array([0xB1, 1, 3, 0x62]))
      expect(positive.getStack()).toEqual([21])
      const negative = createInterpreter()
      negative.execute(new Uint8Array([0xB8, 0xFF, 0xFF, 0xB0, 3, 0x62]))
      expect(negative.getStack()).toEqual([-21])
    })

    it('rejects truncated instruction data and invalid zone, point and CVT references', () => {
      expect(() => createInterpreter().execute(new Uint8Array([0xB1, 1]))).toThrow('instruction data is truncated')
      expect(() => createInterpreter().execute(new Uint8Array([0xB0, 2, 0x13]))).toThrow('zone 2 must be 0 or 1')
      const pointInterpreter = createInterpreter()
      pointInterpreter.setGlyphZone([makePoint(0, 0)], [0])
      expect(() => pointInterpreter.execute(new Uint8Array([0xB0, 1, 0x2E]))).toThrow('MDAP point 1 is out of range')
      expect(() => createInterpreter().execute(new Uint8Array([0xB0, 0, 0x45]))).toThrow('CVT index 0 is out of range')
    })

    it('rejects an undefined opcode without an IDEF', () => {
      const interp = createInterpreter()
      expect(() => interp.execute(new Uint8Array([0x0E]))).toThrow('undefined opcode 0x0e')
    })

    it('executes an IDEF for an undefined opcode and ignores an IDEF for an assigned opcode', () => {
      const interp = createInterpreter()
      interp.execute(new Uint8Array([
        0xB0, 0x0E, 0x89, 0xB0, 7, 0x2D,
        0x0E,
        0xB0, 0x20, 0x89, 0xB0, 99, 0x2D,
        0xB0, 3, 0x20,
      ]))
      expect(interp.getStack()).toEqual([7, 3, 3])
    })

    it('enumerates every assigned OpenType 1.9.1 opcode and reserved gap', () => {
      const assigned: number[] = []
      const reserved: number[] = []
      for (let opcode = 0; opcode <= 0xFF; opcode++) {
        if (isDefinedTrueTypeOpcode(opcode)) assigned.push(opcode)
        else reserved.push(opcode)
      }
      expect(reserved).toEqual([
        0x0E, 0x28, 0x7B, 0x7F, 0x83, 0x84, 0x8F, 0x90,
        0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99,
        0x9A, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F,
        0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
        0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF,
      ])
      expect(assigned.length).toBe(218)
    })
  })
})
