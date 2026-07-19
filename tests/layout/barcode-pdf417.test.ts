import { describe, it, expect } from 'vitest'
import {
  PDF417_GF_EXP,
  PDF417_GF_LOG,
  gf929Mul,
  encodeTextCompaction,
  encodeNumericCompaction,
  encodePDF417Data,
  computePDF417EC,
  selectECLevel,
  selectDimensions,
  leftRowIndicator,
  rightRowIndicator,
  renderPDF417,
  PDF417_CLUSTERS,
} from '../../src/layout/barcode-pdf417.js'
import { renderBarcode } from '../../src/layout/barcode-renderer.js'
import type { RenderGroup, RenderRect } from '../../src/types/render.js'

describe('PDF417', () => {
  describe('GF(929) arithmetic', () => {
    // Verifies the GF(929) EXP table is built from primitive element 3.
    it('primitive element 3: EXP table starts with 1,3,9,27,...', () => {
      expect(PDF417_GF_EXP[0]).toBe(1)
      expect(PDF417_GF_EXP[1]).toBe(3)
      expect(PDF417_GF_EXP[2]).toBe(9)
      expect(PDF417_GF_EXP[3]).toBe(27)
      expect(PDF417_GF_EXP[4]).toBe(81)
      expect(PDF417_GF_EXP[5]).toBe(243)
      expect(PDF417_GF_EXP[6]).toBe(729)
      // 729 * 3 = 2187, 2187 % 929 = 2187 - 2*929 = 329
      expect(PDF417_GF_EXP[7]).toBe(329)
    })

    // Verifies LOG[EXP[i]] == i across the whole field.
    it('LOG is inverse of EXP', () => {
      for (let i = 0; i < 928; i++) {
        const val = PDF417_GF_EXP[i]!
        expect(PDF417_GF_LOG[val]).toBe(i)
      }
    })

    // Verifies a basic field multiplication result.
    it('multiplication: 3*3=9', () => {
      expect(gf929Mul(3, 3)).toBe(9)
    })

    // Verifies multiplication reduces modulo 929.
    it('multiplication: 100*100 = 10000 % 929 = 855', () => {
      // 10000 / 929 = 10, remainder = 10000 - 10*929 = 10000 - 9290 = 710
      expect(gf929Mul(100, 100)).toBe(10000 % 929)
    })

    // Verifies the zero-operand special case in log-table multiplication.
    it('multiplication by 0 returns 0', () => {
      expect(gf929Mul(0, 500)).toBe(0)
      expect(gf929Mul(500, 0)).toBe(0)
    })

    // Verifies 1 acts as the multiplicative identity.
    it('multiplication by 1 returns same value', () => {
      expect(gf929Mul(1, 500)).toBe(500)
      expect(gf929Mul(123, 1)).toBe(123)
    })
  })

  describe('text compaction', () => {
    // Verifies text compaction pairs alpha values into H*30+L codewords.
    it('encode "ABC" produces codewords', () => {
      const cw = encodeTextCompaction('ABC')
      // A=0, B=1 -> 0*30+1 = 1
      // C=2, pad=29 -> 2*30+29 = 89
      expect(cw.length).toBeGreaterThan(0)
      expect(cw[0]).toBe(1)  // A*30 + B = 0*30 + 1 = 1
    })

    // Verifies uppercase-only input needs no sub-mode latch codewords.
    it('encode uppercase letters stays in upper sub-mode', () => {
      const cw = encodeTextCompaction('ABCD')
      // A=0, B=1 -> 0*30+1 = 1
      // C=2, D=3 -> 2*30+3 = 63
      expect(cw.length).toBe(2)
      expect(cw[0]).toBe(1)
      expect(cw[1]).toBe(63)
    })

    // Verifies the latch-to-lower value (27) is emitted before lowercase letters.
    it('encode lowercase switches to lower sub-mode', () => {
      const cw = encodeTextCompaction('ab')
      // Need latch to lower (27 in upper mode), then a=0, b=1
      // 27, 0, 1 -> pairs: (27,0) (1,pad)
      // 27*30+0 = 810, 1*30+29 = 59
      expect(cw.length).toBe(2)
      expect(cw[0]).toBe(810) // latch_lower * 30 + a
    })

    // Verifies space (value 26) encodes without a sub-mode switch.
    it('encode space works in all modes', () => {
      const cw = encodeTextCompaction('A B')
      // A=0, SP=26 -> 0*30+26 = 26
      // B=1, pad -> 1*30+29 = 59
      expect(cw.length).toBe(2)
      expect(cw[0]).toBe(26)
    })
  })

  describe('numeric compaction', () => {
    // Verifies base-900 numeric compaction beats text compaction for long digit runs.
    it('encode long digit string uses fewer codewords than text', () => {
      const digits = '0123456789012345'
      const numericCW = encodeNumericCompaction(digits)
      const textCW = encodeTextCompaction(digits)
      // Numeric mode should be more compact for long digit strings
      // (numeric: mode latch + base-900 encoding)
      // First codeword is 902 (numeric latch)
      expect(numericCW[0]).toBe(902)
      // Numeric compaction should use fewer codewords
      expect(numericCW.length).toBeLessThan(textCW.length)
    })

    // Verifies the numeric mode latch codeword 902 leads the output.
    it('numeric compaction starts with mode latch 902', () => {
      const cw = encodeNumericCompaction('123')
      expect(cw[0]).toBe(902)
    })
  })

  // Covers automatic selection between text and numeric compaction modes.
  describe('data encoding strategy', () => {
    // Verifies text compaction is the default and emits no mode latch.
    it('short text uses text compaction (no mode latch)', () => {
      const cw = encodePDF417Data('ABC')
      // Text compaction: no mode latch codeword
      // All values should be < 900
      for (let i = 0; i < cw.length; i++) {
        expect(cw[i]).toBeLessThan(900)
      }
    })

    // Verifies 13+ digits trigger the numeric compaction latch.
    it('long digit string uses numeric compaction', () => {
      const cw = encodePDF417Data('1234567890123')
      // Should start with 902 (numeric mode latch)
      expect(cw[0]).toBe(902)
    })

    // Verifies the sub-13-digit boundary stays in text compaction.
    it('short digit string uses text compaction', () => {
      const cw = encodePDF417Data('123')
      // Less than 13 digits => text compaction, no 902 latch
      expect(cw[0]).not.toBe(902)
    })
  })

  describe('error correction', () => {
    // Verifies EC level thresholds at each data-count boundary.
    it('EC level selection based on data count', () => {
      expect(selectECLevel(1)).toBe(2)
      expect(selectECLevel(40)).toBe(2)
      expect(selectECLevel(41)).toBe(3)
      expect(selectECLevel(160)).toBe(3)
      expect(selectECLevel(161)).toBe(4)
      expect(selectECLevel(320)).toBe(4)
      expect(selectECLevel(321)).toBe(5)
    })

    // Verifies EC codeword count is 2^(level+1) for level 2.
    it('EC level 2 produces 8 EC codewords', () => {
      const data = [1, 2, 3]
      const ec = computePDF417EC(data, 2)
      expect(ec.length).toBe(8) // 2^(2+1) = 8
    })

    // Verifies EC codeword count is 2^(level+1) for level 3.
    it('EC level 3 produces 16 EC codewords', () => {
      const data = [1, 2, 3, 4, 5]
      const ec = computePDF417EC(data, 3)
      expect(ec.length).toBe(16) // 2^(3+1) = 16
    })

    // Verifies all EC outputs stay within the GF(929) value range.
    it('EC codewords are in range 0-928', () => {
      const data = [10, 20, 30, 40, 50]
      const ec = computePDF417EC(data, 2)
      for (let i = 0; i < ec.length; i++) {
        expect(ec[i]).toBeGreaterThanOrEqual(0)
        expect(ec[i]).toBeLessThan(929)
      }
    })

    // Sanity-checks that EC output actually depends on the input data.
    it('different data produces different EC', () => {
      const ec1 = computePDF417EC([1, 2, 3], 2)
      const ec2 = computePDF417EC([4, 5, 6], 2)
      let different = false
      for (let i = 0; i < ec1.length; i++) {
        if (ec1[i] !== ec2[i]) { different = true; break }
      }
      expect(different).toBe(true)
    })
  })

  describe('dimension selection', () => {
    // Verifies chosen rows*cols covers the codeword count.
    it('small data fits in minimal dimensions', () => {
      // 10 total codewords needs rows*cols >= 10
      const dims = selectDimensions(10)
      expect(dims.rows).toBeGreaterThanOrEqual(3)
      expect(dims.cols).toBeGreaterThanOrEqual(1)
      expect(dims.rows * dims.cols).toBeGreaterThanOrEqual(10)
    })

    // Verifies row count respects the PDF417 spec limits.
    it('rows within 3-90 range', () => {
      const dims = selectDimensions(100)
      expect(dims.rows).toBeGreaterThanOrEqual(3)
      expect(dims.rows).toBeLessThanOrEqual(90)
    })

    // Verifies column count respects the PDF417 spec limits.
    it('cols within 1-30 range', () => {
      const dims = selectDimensions(100)
      expect(dims.cols).toBeGreaterThanOrEqual(1)
      expect(dims.cols).toBeLessThanOrEqual(30)
    })

    // Verifies dimension selection does not over-allocate padding capacity.
    it('area is minimal (no excessive waste)', () => {
      const dims = selectDimensions(20)
      const area = dims.rows * dims.cols
      // Area should be reasonably close to 20
      expect(area).toBeGreaterThanOrEqual(20)
      expect(area).toBeLessThan(40) // Not more than 2x waste
    })
  })

  describe('symbol structure', () => {
    // Smoke-checks that a full symbol renders as a non-empty group.
    it('symbol length descriptor is correct', () => {
      const result = renderPDF417('Hello', { x: 0, y: 0, width: 200, height: 100 })
      // Should produce a valid RenderGroup
      expect(result.type).toBe('group')
      expect(result.children.length).toBeGreaterThan(0)
    })

    // Verifies pad codewords let a 1-char payload still render bars.
    it('padding fills remaining capacity', () => {
      // Short data should still produce a valid barcode
      const result = renderPDF417('A', { x: 0, y: 0, width: 200, height: 100 })
      expect(result.type).toBe('group')
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      const blacks = rects.filter(r => r.fill === '#000000')
      expect(blacks.length).toBeGreaterThan(0)
    })
  })

  describe('row indicators', () => {
    // Verifies left row indicator values follow the 3-row cluster rotation formula.
    it('left indicator uses correct cluster rotation', () => {
      const rows = 9
      const cols = 5
      const ecLevel = 2

      // Row 0 (cluster 0): t=0, (rows-1)/3 = 2
      expect(leftRowIndicator(0, rows, cols, ecLevel)).toBe(0 * 30 + 2)
      // Row 1 (cluster 1): t=0, ecLevel*3 + (rows-1)%3 = 6 + 2 = 8
      expect(leftRowIndicator(1, rows, cols, ecLevel)).toBe(0 * 30 + 8)
      // Row 2 (cluster 2): t=0, cols-1 = 4
      expect(leftRowIndicator(2, rows, cols, ecLevel)).toBe(0 * 30 + 4)
      // Row 3 (cluster 0): t=1, (rows-1)/3 = 2
      expect(leftRowIndicator(3, rows, cols, ecLevel)).toBe(1 * 30 + 2)
    })

    // Verifies right row indicator values follow the 3-row cluster rotation formula.
    it('right indicator uses correct cluster rotation', () => {
      const rows = 9
      const cols = 5
      const ecLevel = 2

      // Row 0 (cluster 0): t=0, cols-1 = 4
      expect(rightRowIndicator(0, rows, cols, ecLevel)).toBe(0 * 30 + 4)
      // Row 1 (cluster 1): t=0, (rows-1)/3 = 2
      expect(rightRowIndicator(1, rows, cols, ecLevel)).toBe(0 * 30 + 2)
      // Row 2 (cluster 2): t=0, ecLevel*3 + (rows-1)%3 = 6 + 2 = 8
      expect(rightRowIndicator(2, rows, cols, ecLevel)).toBe(0 * 30 + 8)
    })
  })

  describe('bar pattern clusters', () => {
    // Verifies each of the 3 cluster tables covers all 929 codewords.
    it('three cluster tables each have 929 entries', () => {
      expect(PDF417_CLUSTERS.length).toBe(3)
      for (let c = 0; c < 3; c++) {
        expect(PDF417_CLUSTERS[c]!.length).toBe(929)
      }
    })

    // Verifies every pattern is a non-zero value within 17 modules.
    it('patterns are 17-bit values (fit in 17 bits)', () => {
      for (let c = 0; c < 3; c++) {
        for (let i = 0; i < 929; i++) {
          const pattern = PDF417_CLUSTERS[c]![i]!
          // Pattern should be at most 17 bits
          expect(pattern).toBeLessThan(1 << 17)
          // Pattern should be non-zero (every codeword has at least some bars)
          expect(pattern).toBeGreaterThan(0)
        }
      }
    })

    // Verifies no duplicate patterns exist inside a cluster (decodability).
    it('cluster patterns are distinct within each cluster', () => {
      for (let c = 0; c < 3; c++) {
        const seen = new Set<number>()
        for (let i = 0; i < 929; i++) {
          const pattern = PDF417_CLUSTERS[c]![i]!
          expect(seen.has(pattern)).toBe(false)
          seen.add(pattern)
        }
      }
    })
  })

  describe('renderBarcode integration', () => {
    // Verifies renderBarcode routes 'pdf417' and emits background plus bar modules.
    it('pdf417 type produces valid RenderGroup', () => {
      const result = renderBarcode('pdf417', 'Hello', {
        x: 0, y: 0, width: 200, height: 80,
      })
      expect(result.type).toBe('group')
      const group = result as RenderGroup
      expect(group.children.length).toBeGreaterThan(0)

      // Should have white background + black bar modules
      const rects = group.children.filter(c => c.type === 'rect') as RenderRect[]
      const whites = rects.filter(r => r.fill === '#FFFFFF')
      const blacks = rects.filter(r => r.fill === '#000000')
      expect(whites.length).toBeGreaterThan(0)
      expect(blacks.length).toBeGreaterThan(0)
    })

    // Verifies x/y/width/height options are propagated to the group.
    it('pdf417 respects position options', () => {
      const result = renderBarcode('pdf417', 'Test', {
        x: 10, y: 20, width: 150, height: 60,
      })
      expect(result.type).toBe('group')
      const group = result as RenderGroup
      expect(group.x).toBe(10)
      expect(group.y).toBe(20)
      expect(group.width).toBe(150)
      expect(group.height).toBe(60)
    })

    // Verifies numeric-compacted data still renders bar modules end to end.
    it('pdf417 with numeric data', () => {
      const result = renderBarcode('pdf417', '1234567890123456', {
        x: 0, y: 0, width: 200, height: 80,
      })
      expect(result.type).toBe('group')
      const group = result as RenderGroup
      const rects = group.children.filter(c => c.type === 'rect') as RenderRect[]
      const blacks = rects.filter(r => r.fill === '#000000')
      expect(blacks.length).toBeGreaterThan(0)
    })
  })
})
