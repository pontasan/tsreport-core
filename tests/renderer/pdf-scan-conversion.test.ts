import { describe, expect, it } from 'vitest'
import { adjustPdfStrokePath, adjustPdfStrokeWidth, flattenPdfPath } from '../../src/renderer/pdf-scan-conversion.js'

describe('PDF scan-conversion path flattening', () => {
  it('subdivides a cubic until both controls meet the device flatness tolerance', () => {
    const commands = new Uint8Array([0, 2])
    const coords = new Float32Array([0, 0, 0, 10, 10, 10, 10, 0])
    const fine = flattenPdfPath(commands, coords, 0.25)
    const coarse = flattenPdfPath(commands, coords, 100)
    expect(fine.commands[0]).toBe(0)
    expect(Array.from(fine.commands.slice(1)).every(function (command) { return command === 1 })).toBe(true)
    expect(fine.commands.length).toBeGreaterThan(coarse.commands.length)
    expect(Array.from(coarse.commands)).toEqual([0, 1])
    expect(Array.from(fine.coords.slice(-2))).toEqual([10, 0])
  })

  it('preserves subpath closure and continues from the closed start point', () => {
    const flattened = flattenPdfPath(
      new Uint8Array([0, 1, 3, 2]),
      new Float32Array([2, 3, 8, 3, 2, 4, 4, 4, 5, 3]),
      1,
    )
    expect(Array.from(flattened.commands.slice(0, 3))).toEqual([0, 1, 3])
    expect(Array.from(flattened.coords.slice(-2))).toEqual([5, 3])
  })

  it('rejects zero, negative, and non-finite tolerances', () => {
    const commands = new Uint8Array([0])
    const coords = new Float32Array([0, 0])
    expect(() => flattenPdfPath(commands, coords, 0)).toThrow(/positive/)
    expect(() => flattenPdfPath(commands, coords, -1)).toThrow(/positive/)
    expect(() => flattenPdfPath(commands, coords, Number.NaN)).toThrow(/positive/)
  })

  it('quantizes every stroke orientation to the same device grid', () => {
    const matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    expect(adjustPdfStrokeWidth(0, matrix)).toBe(0.5)
    expect(adjustPdfStrokeWidth(0.2, matrix)).toBe(0.5)
    expect(adjustPdfStrokeWidth(1.3, matrix)).toBe(1.5)
    expect(Array.from(adjustPdfStrokePath(new Float32Array([0.1, 0.2, 4.1, 3.2]), 0.2, matrix)))
      .toEqual([0.25, 0.25, 4.25, 3.25])
  })

  it('maps adjusted coordinates through an affine device transform', () => {
    const matrix = { a: 0, b: 2, c: -2, d: 0, e: 10, f: 20 }
    const adjusted = adjustPdfStrokePath(new Float32Array([1.1, 2.2]), 1, matrix)
    const deviceX = matrix.a * adjusted[0]! + matrix.c * adjusted[1]! + matrix.e
    const deviceY = matrix.b * adjusted[0]! + matrix.d * adjusted[1]! + matrix.f
    expect(Number.isInteger(deviceX)).toBe(true)
    expect(Number.isInteger(deviceY)).toBe(true)
  })

  it('rejects invalid widths and singular transforms', () => {
    const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    expect(() => adjustPdfStrokeWidth(-1, identity)).toThrow(/non-negative/)
    expect(() => adjustPdfStrokeWidth(1, { ...identity, d: 0 })).toThrow(/non-singular/)
    expect(() => adjustPdfStrokePath(new Float32Array([0, 0]), 1, { ...identity, d: 0 })).toThrow(/non-singular/)
  })
})
