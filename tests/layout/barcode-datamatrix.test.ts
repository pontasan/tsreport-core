import { describe, it, expect } from 'vitest'
import { generateDataMatrix, encodeDMData, selectSize, DM_SIZES } from '../../src/layout/barcode-datamatrix.js'
import { renderBarcode } from '../../src/layout/barcode-renderer.js'
import type { RenderGroup, RenderRect } from '../../src/types/render.js'

describe('DataMatrix', () => {
  describe('encodeDMData', () => {
    // Verifies that two digits are packed into one codeword (value + 130).
    it('digit pair encoding: "12" produces single codeword 142', () => {
      const codewords = encodeDMData('12')
      // (1*10 + 2) + 130 = 142
      expect(codewords.length).toBe(1)
      expect(codewords[0]).toBe(142)
    })

    // Verifies plain ASCII encoding maps a character to charCode + 1.
    it('ASCII characters encoded as charCode + 1', () => {
      const codewords = encodeDMData('A')
      // 'A' = 65, codeword = 66
      expect(codewords.length).toBe(1)
      expect(codewords[0]).toBe(66)
    })

    // Verifies chars >= 128 emit the upper shift codeword 235 before the shifted value.
    it('extended ASCII uses upper shift', () => {
      // char code 200 => 235 (upper shift), then 200-128+1 = 73
      const codewords = encodeDMData(String.fromCharCode(200))
      expect(codewords.length).toBe(2)
      expect(codewords[0]).toBe(235)
      expect(codewords[1]).toBe(73)
    })

    // Verifies a run of digits is encoded pairwise into 3 codewords instead of 6.
    it('numeric string "123456" uses digit pair optimization', () => {
      const codewords = encodeDMData('123456')
      // "12" -> 142, "34" -> 164, "56" -> 186
      expect(codewords.length).toBe(3)
      expect(codewords[0]).toBe(142)
      expect(codewords[1]).toBe(164)
      expect(codewords[2]).toBe(186)
    })
  })

  describe('generateDataMatrix', () => {
    // Verifies 3 codewords of numeric data fit in the 10x10 symbol size.
    it('simple numeric "123456" produces matrix with correct dimensions', () => {
      const matrix = generateDataMatrix('123456')
      // "123456" -> 3 codewords, fits in 10x10 (dataCodewords=3)
      expect(matrix.length).toBe(10)
      expect(matrix[0]!.length).toBe(10)
    })

    // Verifies 5 ASCII codewords select the 12x12 symbol size.
    it('alphabetic "HELLO" produces valid matrix', () => {
      const matrix = generateDataMatrix('HELLO')
      // 'H'=73, 'E'=70, 'L'=77, 'L'=77, 'O'=80 => codewords: 74,71,78,78,81 = 5 codewords
      // Fits in 12x12 (dataCodewords=5)
      expect(matrix.length).toBe(12)
      expect(matrix[0]!.length).toBe(12)
    })

    // Verifies minimal input selects the smallest defined symbol size.
    it('single character "A" produces smallest symbol (10x10)', () => {
      const matrix = generateDataMatrix('A')
      // 'A' -> 1 codeword, fits in 10x10 (dataCodewords=3)
      expect(matrix.length).toBe(10)
      expect(matrix[0]!.length).toBe(10)
    })

    // Verifies size selection skips symbols that are too small for the data.
    it('long data requires larger symbol', () => {
      // 50 ASCII characters = 50 codewords, exceeds 26x26 (dataCodewords=44), needs 32x32 (dataCodewords=62)
      const data = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWX'
      const matrix = generateDataMatrix(data)
      expect(matrix.length).toBe(32)
      expect(matrix[0]!.length).toBe(32)
    })

    // Verifies the empty-input boundary still yields a well-formed 10x10 matrix.
    it('empty string produces valid matrix', () => {
      const matrix = generateDataMatrix('')
      // Empty = 0 codewords, fits in 10x10
      expect(matrix.length).toBe(10)
      expect(matrix[0]!.length).toBe(10)
      // Should still have proper structure
      for (let r = 0; r < matrix.length; r++) {
        expect(matrix[r]!.length).toBe(10)
      }
    })

    // Verifies the solid L-shape finder and alternating clock tracks per the DataMatrix spec.
    it('finder pattern: L-shape and clock tracks', () => {
      const matrix = generateDataMatrix('A')
      const rows = matrix.length
      const cols = matrix[0]!.length

      // Bottom row: all dark (L-shape bottom)
      for (let c = 0; c < cols; c++) {
        expect(matrix[rows - 1]![c]).toBe(true)
      }

      // Left column: all dark (L-shape left)
      for (let r = 0; r < rows; r++) {
        expect(matrix[r]![0]).toBe(true)
      }

      // Top row interior: alternating (clock track), c=0 is dark (overridden by L left)
      // Skip corners (c=0 overridden by left, c=cols-1 overridden by right clock)
      for (let c = 1; c < cols - 1; c++) {
        expect(matrix[0]![c]).toBe(c % 2 === 0)
      }

      // Right column interior: alternating (clock track, starts dark at bottom)
      // Skip corners (r=0 is top-right, r=rows-1 overridden by bottom L)
      for (let r = 1; r < rows - 1; r++) {
        expect(matrix[r]![cols - 1]).toBe((rows - 1 - r) % 2 === 0)
      }

      // Top-left corner: dark (L-shape left + clock track both agree)
      expect(matrix[0]![0]).toBe(true)
      // Bottom-left corner: dark (both L-shapes)
      expect(matrix[rows - 1]![0]).toBe(true)
      // Bottom-right corner: dark (L-shape bottom overrides)
      expect(matrix[rows - 1]![cols - 1]).toBe(true)
      // Top-right corner: light for even-height matrices (right clock starts dark at bottom)
      // For 10x10 (regH=10): (10-1-0)%2=1 → light
      expect(matrix[0]![cols - 1]).toBe((rows - 1) % 2 === 0)
    })

    // Verifies the 10x10 capacity boundary: 3 codewords fit, 4 force 12x12.
    it('data capacity: 10x10 holds up to 3 ASCII codewords', () => {
      // 2 ASCII chars = 2 codewords, fits in 10x10
      const matrix2 = generateDataMatrix('AB')
      expect(matrix2.length).toBe(10)

      // 3 ASCII chars = 3 codewords, fits in 10x10
      const matrix3 = generateDataMatrix('ABC')
      expect(matrix3.length).toBe(10)

      // 4 ASCII chars = 4 codewords, needs 12x12
      const matrix4 = generateDataMatrix('ABCD')
      expect(matrix4.length).toBe(12)
    })
  })

  describe('renderBarcode integration', () => {
    // Verifies renderBarcode routes 'datamatrix' and emits background plus dark modules.
    it('datamatrix type produces valid RenderGroup', () => {
      const result = renderBarcode('datamatrix', 'TEST', {
        x: 0, y: 0, width: 100, height: 100,
      })
      expect(result.type).toBe('group')
      const group = result as RenderGroup
      expect(group.children.length).toBeGreaterThan(0)

      // Should have white background + dark modules
      const rects = group.children.filter(c => c.type === 'rect') as RenderRect[]
      const whites = rects.filter(r => r.fill === '#FFFFFF')
      const blacks = rects.filter(r => r.fill === '#000000')
      expect(whites.length).toBeGreaterThan(0)
      expect(blacks.length).toBeGreaterThan(0)
    })

    // Verifies the hyphenated type alias resolves and position options are applied.
    it('data-matrix alias also works', () => {
      const result = renderBarcode('data-matrix', 'TEST', {
        x: 5, y: 10, width: 80, height: 80,
      })
      expect(result.type).toBe('group')
      const group = result as RenderGroup
      expect(group.x).toBe(5)
      expect(group.y).toBe(10)
    })
  })
})
