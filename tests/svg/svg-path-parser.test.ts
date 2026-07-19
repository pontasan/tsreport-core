import { describe, it, expect } from 'vitest'
import { parseSvgPath } from '../../src/svg/svg-path-parser.js'

describe('parseSvgPath', () => {
  // Verifies that absolute M/L/Z parse to MoveTo/LineTo/Close opcodes with their coordinates.
  it('M L Z basic', () => {
    const { commands, coords } = parseSvgPath('M 10 20 L 30 40 Z')
    expect(Array.from(commands)).toEqual([0, 1, 3]) // MoveTo, LineTo, Close
    expect(Array.from(coords)).toEqual([10, 20, 30, 40])
  })

  // Verifies that relative m/l offsets are accumulated onto the current position.
  it('relative m l z', () => {
    const { commands, coords } = parseSvgPath('m 10 20 l 5 10 z')
    expect(Array.from(commands)).toEqual([0, 1, 3])
    expect(coords[0]).toBe(10)
    expect(coords[1]).toBe(20)
    expect(coords[2]).toBe(15) // 10 + 5
    expect(coords[3]).toBe(30) // 20 + 10
  })

  // Verifies that H/V expand to full LineTo commands keeping the other axis unchanged.
  it('H V commands', () => {
    const { commands, coords } = parseSvgPath('M 0 0 H 100 V 50')
    expect(Array.from(commands)).toEqual([0, 1, 1])
    expect(coords[2]).toBe(100)
    expect(coords[3]).toBe(0) // Y unchanged
    expect(coords[4]).toBe(100) // X unchanged
    expect(coords[5]).toBe(50)
  })

  // Verifies that relative h/v add their delta to the current position on one axis only.
  it('h v relative', () => {
    const { commands, coords } = parseSvgPath('M 10 20 h 30 v 40')
    expect(coords[2]).toBe(40)  // 10 + 30
    expect(coords[3]).toBe(20)  // unchanged
    expect(coords[4]).toBe(40)  // unchanged
    expect(coords[5]).toBe(60)  // 20 + 40
  })

  // Verifies that absolute C emits a CubicTo with both control points and the endpoint.
  it('C cubic bezier', () => {
    const { commands, coords } = parseSvgPath('M 0 0 C 10 20 30 40 50 60')
    expect(Array.from(commands)).toEqual([0, 2]) // MoveTo, CubicTo
    expect(Array.from(coords)).toEqual([0, 0, 10, 20, 30, 40, 50, 60])
  })

  // Verifies that relative c resolves control points and endpoint against the current position.
  it('c relative cubic', () => {
    const { commands, coords } = parseSvgPath('M 10 10 c 5 5 15 15 20 20')
    expect(Array.from(commands)).toEqual([0, 2])
    // cp1: (15, 15), cp2: (25, 25), end: (30, 30)
    expect(coords[2]).toBe(15)
    expect(coords[3]).toBe(15)
    expect(coords[4]).toBe(25)
    expect(coords[5]).toBe(25)
    expect(coords[6]).toBe(30)
    expect(coords[7]).toBe(30)
  })

  // Verifies that S derives its first control point by reflecting the previous cubic's second control point.
  it('S smooth cubic', () => {
    const { commands, coords } = parseSvgPath('M 0 0 C 10 10 20 20 30 30 S 50 50 60 60')
    expect(commands.length).toBe(3) // M, C, C (S → C with reflected cp)
    // S's cp1 is the reflection of the previous cp2: 2*30 - 20 = 40, 2*30 - 20 = 40
    expect(coords[8]).toBe(40)
    expect(coords[9]).toBe(40)
    expect(coords[10]).toBe(50)
    expect(coords[11]).toBe(50)
  })

  // Verifies that quadratic Q is degree-elevated to a cubic with cp = P + 2/3*(Q - P).
  it('Q quadratic → cubic', () => {
    const { commands, coords } = parseSvgPath('M 0 0 Q 50 100 100 0')
    // Q → C with degree elevation
    expect(Array.from(commands)).toEqual([0, 2])
    // cp1 = P0 + 2/3*(Q - P0) = 0 + 2/3*50 = 33.33...
    expect(coords[2]).toBeCloseTo(33.333, 2)
    expect(coords[3]).toBeCloseTo(66.667, 2)
    // cp2 = P2 + 2/3*(Q - P2) = 100 + 2/3*(50-100) = 66.67
    expect(coords[4]).toBeCloseTo(66.667, 2)
    expect(coords[5]).toBeCloseTo(66.667, 2)
  })

  // Verifies that T reflects the previous quadratic control point before cubic conversion.
  it('T smooth quadratic', () => {
    const { commands, coords } = parseSvgPath('M 0 0 Q 25 50 50 0 T 100 0')
    expect(commands.length).toBe(3) // M, C (from Q), C (from T)
    // T's control point is the reflection of Q's: 2*50 - 25 = 75, 2*0 - 50 = -50
    // → cp1 = P0 + 2/3*(qx - P0) = 50 + 2/3*(75 - 50) = 66.67
    expect(coords[8]).toBeCloseTo(66.667, 2)
    expect(coords[9]).toBeCloseTo(-33.333, 2)
  })

  // Verifies that an elliptical arc is approximated by cubic segments ending exactly at the arc endpoint.
  it('A arc to cubic', () => {
    const { commands, coords } = parseSvgPath('M 0 0 A 50 50 0 0 1 100 0')
    // Arc → multiple CubicTo segments
    expect(commands[0]).toBe(0) // MoveTo
    for (let i = 1; i < commands.length; i++) {
      expect(commands[i]).toBe(2) // All CubicTo
    }
    // End point should be (100, 0)
    const lastIdx = coords.length - 2
    expect(coords[lastIdx]).toBeCloseTo(100, 3)
    expect(coords[lastIdx + 1]).toBeCloseTo(0, 3)
  })

  // Verifies that an arc with a zero radius degenerates to a straight LineTo per the SVG spec.
  it('degenerate arc (rx=0) → lineto', () => {
    const { commands } = parseSvgPath('M 0 0 A 0 50 0 0 1 100 0')
    expect(commands[1]).toBe(1) // LineTo
  })

  // Verifies that coordinate pairs following M are treated as implicit LineTo commands.
  it('implicit lineto after M', () => {
    const { commands, coords } = parseSvgPath('M 0 0 10 10 20 20')
    // Implicit coordinates after M are treated as L
    expect(Array.from(commands)).toEqual([0, 1, 1])
    expect(Array.from(coords)).toEqual([0, 0, 10, 10, 20, 20])
  })

  // Verifies that path data without whitespace (comma-only separators) is tokenized correctly.
  it('compact notation (no spaces)', () => {
    const { commands, coords } = parseSvgPath('M0,0L10,20L30,40Z')
    expect(Array.from(commands)).toEqual([0, 1, 1, 3])
    expect(Array.from(coords)).toEqual([0, 0, 10, 20, 30, 40])
  })

  // Verifies that a minus sign acts as an implicit number separator (e.g. "10-5").
  it('negative numbers as separators', () => {
    const { commands, coords } = parseSvgPath('M10-5L20-10')
    expect(Array.from(commands)).toEqual([0, 1])
    expect(Array.from(coords)).toEqual([10, -5, 20, -10])
  })

  // Verifies that extra coordinate pairs after L repeat the command for each pair.
  it('multiple same commands', () => {
    const { commands, coords } = parseSvgPath('M 0 0 L 10 10 20 20 30 30')
    expect(Array.from(commands)).toEqual([0, 1, 1, 1])
    expect(coords.length).toBe(8)
  })

  // Verifies that an empty path string yields empty command and coordinate buffers without error.
  it('empty path', () => {
    const { commands, coords } = parseSvgPath('')
    expect(commands.length).toBe(0)
    expect(coords.length).toBe(0)
  })

  // Verifies that commands after Z continue from the subpath start with correct coordinate indexing.
  it('Z resets current position', () => {
    const { commands, coords } = parseSvgPath('M 10 20 L 30 40 Z L 50 60')
    // After Z, current position resets to M start (10, 20)
    // The L 50 60 is absolute
    // Z has no coords, so L coords are at index 4,5
    expect(Array.from(commands)).toEqual([0, 1, 3, 1])
    expect(coords[4]).toBe(50)
    expect(coords[5]).toBe(60)
  })

  // Verifies that exponent notation (1e1, 2.5e2) is parsed as valid coordinate numbers.
  it('scientific notation', () => {
    const { commands, coords } = parseSvgPath('M 1e1 2e1 L 1.5e2 2.5e2')
    expect(coords[0]).toBe(10)
    expect(coords[1]).toBe(20)
    expect(coords[2]).toBe(150)
    expect(coords[3]).toBe(250)
  })

  // Regression: a bare number after a closepath used to re-dispatch the 'Z'
  // command without advancing the scanner, spinning forever. It must terminate.
  it('does not hang on a number following a closepath', () => {
    const { commands } = parseSvgPath('M0 0L1 1Z5')
    expect(Array.from(commands)).toEqual([0, 1, 3]) // stray "5" skipped
  })

  // Regression: an implicit coordinate that is not a valid number (e.g. after a
  // coordinate command) used to leave the scanner stuck on the same character.
  it('does not hang on a non-numeric implicit coordinate', () => {
    const { commands } = parseSvgPath('M0 0L1 1@')
    expect(Array.from(commands)).toEqual([0, 1]) // stray "@" skipped
  })
})
