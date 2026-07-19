/**
 * Barcode readability tests.
 *
 * Rasterizes barcodes produced by renderBarcode() and decodes them with
 * the barcode decoder to verify the decoded text matches the input.
 * The pixel buffer is generated from the same vector data drawn into PDFs,
 * so this is equivalent to scanning the barcode from the PDF output.
 */
import { describe, it, expect } from 'vitest'
import { renderBarcode } from '../../src/layout/barcode-renderer.js'
import type { RenderGroup, RenderRect } from '../../src/types/render.js'
import { readBarcodes } from 'zxing-wasm/reader'
import type { ReadResult } from 'zxing-wasm/reader'

// ─── Rasterizer ───

/**
 * Converts a RenderGroup (barcode output) into an RGBA pixel buffer.
 * A barcode is a set of RenderRect (fill=#000000) nodes, so painting
 * black rectangles on a white background is sufficient.
 */
function rasterizeBarcode(group: RenderGroup, scale: number): { data: Uint8ClampedArray; width: number; height: number } {
  const pixelW = Math.ceil(group.width * scale)
  const pixelH = Math.ceil(group.height * scale)
  const data = new Uint8ClampedArray(pixelW * pixelH * 4)

  // Initialize with a white background (RGBA)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255     // R
    data[i + 1] = 255  // G
    data[i + 2] = 255  // B
    data[i + 3] = 255  // A
  }

  // Paint black bars (rects with fill=#000000)
  for (let ci = 0; ci < group.children.length; ci++) {
    const child = group.children[ci]
    if (child.type !== 'rect') continue
    const r = child as RenderRect
    if (r.fill !== '#000000') continue

    const x0 = Math.floor(r.x * scale)
    const y0 = Math.floor(r.y * scale)
    const x1 = Math.ceil((r.x + r.width) * scale)
    const y1 = Math.ceil((r.y + r.height) * scale)

    for (let py = Math.max(0, y0); py < Math.min(pixelH, y1); py++) {
      for (let px = Math.max(0, x0); px < Math.min(pixelW, x1); px++) {
        const idx = (py * pixelW + px) * 4
        data[idx] = 0      // R
        data[idx + 1] = 0   // G
        data[idx + 2] = 0   // B
        // A remains 255
      }
    }
  }

  return { data, width: pixelW, height: pixelH }
}

/**
 * Generates a barcode, rasterizes it, and decodes it with an external decoder.
 */
async function decodeBarcode(
  barcodeType: string,
  inputData: string,
  formats: string[],
  scale = 4,
): Promise<ReadResult[]> {
  const group = renderBarcode(barcodeType, inputData, {
    x: 0, y: 0, width: 300, height: 80,
  }) as RenderGroup

  const { data, width, height } = rasterizeBarcode(group, scale)

  // ImageData-compatible object
  const imageData = {
    data,
    width,
    height,
    colorSpace: 'srgb' as const,
  }

  return readBarcodes(imageData as ImageData, {
    formats: formats as any[],
    tryHarder: true,
    isPure: true,
  })
}

// ─── Tests ───

describe('Barcode readability (external decoder check)', () => {

  describe('UPC-A', () => {
    // UPC-A is rendered via EAN-13 (prepend "0"), so the scanner reads it as EAN-13.
    // "012345678905" → EAN-13 "0012345678905". This is the standard representation.
    // Verifies a rendered UPC-A scans back as its EAN-13 equivalent with leading 0.
    it('decodes "012345678905" correctly (read as EAN-13)', async () => {
      const results = await decodeBarcode('upca', '012345678905', ['EAN13'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      // EAN-13 returns 13 digits (leading 0 + UPC-A 12 digits)
      expect(valid!.text).toBe('0012345678905')
    })

    // Verifies a second UPC-A value round-trips through the scanner.
    it('decodes "036000291452" correctly (read as EAN-13)', async () => {
      const results = await decodeBarcode('upca', '036000291452', ['EAN13'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('0036000291452')
    })
  })

  describe('UPC-E', () => {
    // UPC-E scanners typically return the expanded UPC-A form.
    // "01234565" expands to UPC-A "0012345000065".
    // Verifies a rendered UPC-E decodes to its expanded UPC-A representation.
    it('decodes "01234565" correctly (expanded to UPC-A form)', async () => {
      const results = await decodeBarcode('upce', '01234565', ['UPCE'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      // The decoder HRI mode returns expanded UPC-A form
      expect(valid!.text).toBe('0012345000065')
    })
  })

  describe('ITF (Interleaved 2 of 5)', () => {
    // Verifies a rendered ITF barcode round-trips through the scanner.
    it('decodes "12345678" correctly', async () => {
      const results = await decodeBarcode('itf', '12345678', ['ITF'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('12345678')
      expect(valid!.format).toBe('ITF')
    })

    // Verifies the leading-zero padding for odd-length ITF input is what scanners read.
    it('decodes even-padded odd input "12345" → "012345"', async () => {
      const results = await decodeBarcode('itf', '12345', ['ITF'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('012345')
    })
  })

  describe('Codabar', () => {
    // Verifies a rendered Codabar with explicit start/stop decodes correctly.
    it('decodes "A12345B" correctly', async () => {
      const results = await decodeBarcode('codabar', 'A12345B', ['Codabar'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      // Codabar text may include start/stop characters
      expect(valid!.text).toContain('12345')
      expect(valid!.format).toBe('Codabar')
    })
  })

  describe('Code 93', () => {
    // Verifies a rendered Code 93 alphabetic barcode round-trips through the scanner.
    it('decodes "HELLO" correctly', async () => {
      const results = await decodeBarcode('code93', 'HELLO', ['Code93'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('HELLO')
      expect(valid!.format).toBe('Code93')
    })

    // Verifies a rendered Code 93 numeric barcode round-trips through the scanner.
    it('decodes "12345" correctly', async () => {
      const results = await decodeBarcode('code93', '12345', ['Code93'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('12345')
    })

    // Verifies a rendered Code 93 mixed alphanumeric barcode round-trips.
    it('decodes "ABC123" correctly', async () => {
      const results = await decodeBarcode('code93', 'ABC123', ['Code93'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('ABC123')
    })
  })

  describe('MSI (custom pixel decoder)', () => {
    // The external decoder does not support MSI. Neither does javascript-barcode-reader
    // (its MSI decoder has a broken calibration: bar=(lines[0]+lines[1])/2
    //  makes narrow and wide indistinguishable regardless of ratio).
    // Use a custom decoder that extracts bar/space runs and classifies N/W via clustering.

    /**
     * Scan pixel columns at the vertical center to extract bar/space run lengths.
     * Returns alternating runs: [bar, space, bar, space, ...].
     */
    function extractRuns(data: Uint8ClampedArray, width: number, height: number): number[] {
      const runs: number[] = []
      const midY = Math.floor(height / 2)
      let prevBlack = false
      let count = 0

      for (let x = 0; x < width; x++) {
        const idx = (midY * width + x) * 4
        const isBlack = data[idx] < 128
        if (x === 0) {
          // skip leading white
          if (!isBlack) continue
          prevBlack = true
          count = 1
          continue
        }
        if (count === 0) {
          // still in leading white
          if (!isBlack) continue
          prevBlack = true
          count = 1
          continue
        }
        if (isBlack === prevBlack) {
          count++
        } else {
          runs.push(count)
          prevBlack = isBlack
          count = 1
        }
      }
      if (count > 0) runs.push(count)
      return runs
    }

    /**
     * Classify run widths as narrow (false) or wide (true) using Otsu-style threshold:
     * threshold = (min + max) / 2.
     */
    function classifyNarrowWide(runs: number[]): boolean[] {
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < runs.length; i++) {
        if (runs[i] < min) min = runs[i]
        if (runs[i] > max) max = runs[i]
      }
      const threshold = (min + max) / 2
      const result: boolean[] = []
      for (let i = 0; i < runs.length; i++) {
        result.push(runs[i] > threshold)
      }
      return result
    }

    /**
     * Decode MSI barcode from classified N/W runs.
     * MSI encoding: Start(WN) + data BCD bits + Stop(NWN)
     * Bit 0: narrow bar + wide space (N W)
     * Bit 1: wide bar + narrow space (W N)
     */
    function decodeMSIRuns(nw: boolean[]): string {
      // Start: wide bar(W) + narrow space(N) → [true, false]
      if (nw.length < 5) return ''
      if (!nw[0] || nw[1]) return '' // expect W, N

      // Data starts at index 2
      // Stop: narrow bar(N) + wide space(W) + narrow bar(N) = 3 runs at end
      const dataEnd = nw.length - 3
      if (dataEnd < 10) return '' // need at least 2 digits (8 data runs) + start(2)

      // Verify stop pattern: N W N
      if (nw[dataEnd] !== false || nw[dataEnd + 1] !== true || nw[dataEnd + 2] !== false) {
        return ''
      }

      // Decode BCD: each bit is 2 runs (bar, space)
      const dataRuns = dataEnd - 2 // number of runs for data
      if (dataRuns % 8 !== 0) return '' // must be multiple of 8 (4 bits × 2 runs per digit)

      let result = ''
      for (let i = 2; i < dataEnd; i += 8) {
        let digit = 0
        for (let bit = 0; bit < 4; bit++) {
          const barWide = nw[i + bit * 2]      // bar: wide = 1, narrow = 0
          const spaceWide = nw[i + bit * 2 + 1] // space: wide = 0, narrow = 1
          // Bit 1: wide bar + narrow space → barWide=true, spaceWide=false
          // Bit 0: narrow bar + wide space → barWide=false, spaceWide=true
          if (barWide && !spaceWide) {
            digit |= (1 << (3 - bit))
          }
          // else: bit 0 (barWide=false, spaceWide=true) → no bit set
        }
        if (digit > 9) return '' // invalid BCD
        result += digit.toString()
      }
      return result
    }

    function decodeMSI(inputData: string, scale = 4): string {
      const group = renderBarcode('msi', inputData, {
        x: 0, y: 0, width: 300, height: 80,
      }) as RenderGroup
      const { data, width, height } = rasterizeBarcode(group, scale)
      const runs = extractRuns(data, width, height)
      const nw = classifyNarrowWide(runs)
      return decodeMSIRuns(nw)
    }

    // Verifies a rendered MSI barcode decodes back to its input via the custom decoder.
    it('decodes "80523" correctly', () => {
      const result = decodeMSI('80523')
      // MSI encodes data + Luhn check digit; result includes both
      expect(result.startsWith('80523')).toBe(true)
    })

    // Verifies all ten digit symbols decode correctly in one barcode.
    it('decodes "1234567890" correctly', () => {
      const result = decodeMSI('1234567890')
      expect(result.startsWith('1234567890')).toBe(true)
    })

    // Verifies leading zeros survive the encode/decode round trip.
    it('decodes "00042" correctly', () => {
      const result = decodeMSI('00042')
      expect(result.startsWith('00042')).toBe(true)
    })

    // Verifies the exact Luhn check digit appears in the decoded symbol stream.
    it('Luhn check digit is appended correctly', () => {
      // "80523" → Luhn check = 4 → full data = "805234"
      // (8*2→7, 0, 5*2→1, 2, 3*2→6 = sum 16, check = (10-6)%10 = 4)
      const result = decodeMSI('80523')
      expect(result).toBe('805234')
    })
  })

  // Confirms the rasterize-and-decode harness also works for pre-existing formats.
  describe('Cross-format verification', () => {
    // Verifies the existing Code128 renderer still produces scannable output.
    it('existing Code128 also decodes correctly', async () => {
      const results = await decodeBarcode('code128', 'tsreport-2026', ['Code128'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('tsreport-2026')
    })

    // Verifies the existing EAN-13 renderer still produces scannable output.
    it('existing EAN-13 also decodes correctly', async () => {
      const results = await decodeBarcode('ean13', '4901234567894', ['EAN13'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('4901234567894')
    })

    // Verifies the existing EAN-8 renderer still produces scannable output.
    it('existing EAN-8 also decodes correctly', async () => {
      const results = await decodeBarcode('ean8', '49012347', ['EAN8'])
      expect(results.length).toBeGreaterThanOrEqual(1)
      const valid = results.find(r => r.isValid)
      expect(valid).toBeDefined()
      expect(valid!.text).toBe('49012347')
    })
  })
})
