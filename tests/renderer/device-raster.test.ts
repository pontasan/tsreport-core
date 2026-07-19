import { describe, expect, it } from 'vitest'
import {
  applyDeviceRasterToComponents,
  applyDeviceRasterToRgba,
  evaluatePredefinedSpotFunction,
  PDF_PREDEFINED_SPOT_FUNCTIONS,
  validateRenderDeviceParams,
} from '../../src/renderer/device-raster.js'

function solid(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return data
}

describe('device raster model', () => {
  it('applies type 6 thresholds and the PDF 2.0 halftone origin in device pixels', () => {
    const data = solid(4, 1, 128, 128, 128)
    applyDeviceRasterToRgba(data, 4, 1, {
      halftoneOrigin: [1, 0],
      halftone: { type: 6, width: 2, height: 1, thresholds: [0, 255] },
    })
    expect(Array.from(data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ])
  })

  it('treats an eight-bit zero threshold as one at the exact gray boundary', () => {
    const black = solid(1, 1, 0, 0, 0)
    applyDeviceRasterToRgba(black, 1, 1, { halftone: { type: 6, width: 1, height: 1, thresholds: [0] } })
    expect(Array.from(black)).toEqual([0, 0, 0, 255])
    const firstGray = solid(1, 1, 1, 1, 1)
    applyDeviceRasterToRgba(firstGray, 1, 1, { halftone: { type: 6, width: 1, height: 1, thresholds: [0] } })
    expect(Array.from(firstGray)).toEqual([255, 255, 255, 255])
  })

  it('applies type 5 component screens and each CMYK transfer function', () => {
    const data = solid(1, 1, 128, 64, 32)
    const identity = { functionType: 2 as const, domain: [0, 1] as [number, number], c0: [0], c1: [1], exponent: 1 }
    const zero = { functionType: 2 as const, domain: [0, 1] as [number, number], c0: [0], c1: [0], exponent: 1 }
    applyDeviceRasterToRgba(data, 1, 1, {
      transferFunction: [zero, identity, identity, zero],
      halftone: {
        type: 5,
        halftones: [
          { colorant: 'Cyan', halftone: { type: 6, width: 1, height: 1, thresholds: [0] } },
          { colorant: 'Default', halftone: { type: 16, width: 1, height: 1, thresholds: [0] } },
        ],
      },
    })
    expect(Array.from(data)).toEqual([0, 0, 0, 255])
  })

  it('applies type 5 screens to arbitrary DeviceN colorant planes', () => {
    const data = new Float64Array([0.25, 0.25, 0.75, 0.75])
    applyDeviceRasterToComponents(data, 2, 1, ['Cyan', 'SpotOrange'], {
      halftone: {
        type: 5,
        halftones: [
          { colorant: 'Cyan', halftone: { type: 6, width: 1, height: 1, thresholds: [128] } },
          { colorant: 'SpotOrange', halftone: { type: 6, width: 1, height: 1, thresholds: [192] } },
          { colorant: 'Default', halftone: { type: 6, width: 1, height: 1, thresholds: [0] } },
        ],
      },
    })
    expect(Array.from(data)).toEqual([0, 1, 1, 1])
  })

  it('uses halftone transfer functions for spot colorants instead of process TR', () => {
    const zero = { functionType: 2 as const, domain: [0, 1] as [number, number], c0: [0], c1: [0], exponent: 1 }
    const invert = { functionType: 4 as const, domain: [0, 1], range: [0, 1], expression: '{ 1 exch sub }' }
    const processTransferIgnored = new Float64Array([0.25])
    applyDeviceRasterToComponents(processTransferIgnored, 1, 1, ['SpotOrange'], {
      transferFunction: zero,
      halftone: { type: 6, width: 1, height: 1, thresholds: [128] },
    })
    expect(processTransferIgnored[0]).toBe(0)

    const halftoneTransferApplied = new Float64Array([0.25])
    applyDeviceRasterToComponents(halftoneTransferApplied, 1, 1, ['SpotOrange'], {
      transferFunction: zero,
      halftone: { type: 6, width: 1, height: 1, thresholds: [128], transferFunction: invert },
    })
    expect(halftoneTransferApplied[0]).toBe(1)
  })

  it('applies transfer functions to Gray, RGB, CMYK, and DeviceN process components', () => {
    const invert = { functionType: 4 as const, domain: [0, 1], range: [0, 1], expression: '{ 1 exch sub }' }
    const data = new Float64Array([
      0.2,
      0.2, 0.3, 0.4,
      0.2, 0.3, 0.4, 0.5,
      0.2, 0.3, 0.4, 0.5, 0.6,
    ])
    applyDeviceRasterToComponents(data.subarray(0, 1), 1, 1, ['Gray'], { transferFunction: invert })
    applyDeviceRasterToComponents(data.subarray(1, 4), 1, 1, ['Red', 'Green', 'Blue'], { transferFunction: invert })
    applyDeviceRasterToComponents(data.subarray(4, 8), 1, 1, ['Cyan', 'Magenta', 'Yellow', 'Black'], { transferFunction: invert })
    applyDeviceRasterToComponents(data.subarray(8), 1, 1, ['Cyan', 'Magenta', 'Yellow', 'Black', 'SpotOrange'], { transferFunction: invert })
    expect(Array.from(data)).toEqual([
      0.8,
      0.8, 0.7, 0.6,
      0.8, 0.7, 0.6, 0.5,
      0.8, 0.7, 0.6, 0.5, 0.6,
    ])
  })

  it('applies black generation and undercolor removal to actual CMYK preview pixels', () => {
    const zero = { expression: '{ pop 0 }' }
    const one = { expression: '{ pop 1 }' }
    const noBlack = solid(1, 1, 64, 128, 192)
    applyDeviceRasterToRgba(noBlack, 1, 1, { blackGeneration: zero, undercolorRemoval: 'Default' })
    expect(Array.from(noBlack)).toEqual([127, 191, 255, 255])

    const fullRemoval = solid(1, 1, 64, 128, 192)
    applyDeviceRasterToRgba(fullRemoval, 1, 1, { blackGeneration: zero, undercolorRemoval: one })
    expect(Array.from(fullRemoval)).toEqual([255, 255, 255, 255])
  })

  it('rejects malformed native component rasters', () => {
    expect(() => applyDeviceRasterToComponents(new Float64Array(1), 1, 1, [], {})).toThrow(/at least one/)
    expect(() => applyDeviceRasterToComponents(new Float64Array(1), 1, 1, ['A', 'B'], {})).toThrow(/length/)
    expect(() => applyDeviceRasterToComponents(new Float64Array([1.1]), 1, 1, ['Spot'], {})).toThrow(/from 0 to 1/)
    expect(() => applyDeviceRasterToComponents(new Float64Array([0, 0]), 1, 1, ['Spot', 'Spot'], {})).toThrow(/unique/)
  })

  it('applies type 1 calculator spots and type 10/type 16 threshold tiling', () => {
    const type1 = solid(3, 3, 64, 64, 64)
    applyDeviceRasterToRgba(type1, 3, 3, {
      halftone: { frequency: 36, angle: 0, spotFunction: { expression: '{ add 2 div }' } },
    })
    expect(new Set(Array.from(type1).filter(function (_value, index) { return index % 4 === 0 })).size).toBeGreaterThan(1)

    const type10 = solid(8, 8, 128, 128, 128)
    applyDeviceRasterToRgba(type10, 8, 8, { halftone: { type: 10, xsquare: 2, ysquare: 1, thresholds: [0, 64, 128, 192, 255] } })
    expect(new Set(Array.from(type10).filter(function (_value, index) { return index % 4 === 0 })).size).toBe(2)

    const type16 = solid(4, 4, 128, 128, 128)
    applyDeviceRasterToRgba(type16, 4, 4, {
      halftone: { type: 16, width: 2, height: 1, width2: 1, height2: 1, thresholds: [0, 65535, 32768] },
    })
    expect(new Set(Array.from(type16).filter(function (_value, index) { return index % 4 === 0 })).size).toBe(2)
  })

  it('maps Type 10 squares into the normative shifted strip for positive and negative device rows', () => {
    const positive = solid(5, 2, 128, 128, 128)
    applyDeviceRasterToRgba(positive, 5, 2, {
      halftone: { type: 10, xsquare: 2, ysquare: 1, thresholds: [0, 255, 0, 255, 0] },
    })
    expect(Array.from(positive).filter(function (_value, index) { return index % 4 === 0 })).toEqual([
      255, 0, 255, 0, 255,
      255, 0, 255, 255, 0,
    ])

    const negative = solid(5, 1, 128, 128, 128)
    applyDeviceRasterToRgba(negative, 5, 1, {
      halftoneOrigin: [0, 1],
      halftone: { type: 10, xsquare: 2, ysquare: 1, thresholds: [0, 255, 0, 255, 0] },
    })
    expect(Array.from(negative).filter(function (_value, index) { return index % 4 === 0 })).toEqual([
      0, 255, 255, 0, 255,
    ])
  })

  it('maps two Type 16 rectangles into their common-height shifted strip', () => {
    const data = solid(8, 2, 128, 128, 128)
    applyDeviceRasterToRgba(data, 8, 2, {
      halftone: {
        type: 16,
        width: 2,
        height: 3,
        width2: 1,
        height2: 2,
        thresholds: [0, 65535, 65535, 0, 0, 65535, 65535, 0],
      },
    })
    expect(Array.from(data).filter(function (_value, index) { return index % 4 === 0 })).toEqual([
      255, 0, 255, 0, 255, 0, 255, 0,
      0, 255, 0, 255, 0, 255, 0, 255,
    ])
  })

  it('uses Type 1 spot-function ordering rather than absolute return values', () => {
    const first = solid(8, 8, 96, 96, 96)
    const second = first.slice()
    applyDeviceRasterToRgba(first, 8, 8, {
      halftone: { frequency: 18, angle: 0, spotFunction: { expression: '{ add 2 div }' } },
    })
    applyDeviceRasterToRgba(second, 8, 8, {
      halftone: { frequency: 18, angle: 0, spotFunction: { expression: '{ add 2 div 0.5 mul 0.25 add }' } },
    })
    expect(second).toEqual(first)
  })

  it('uses quantized ordinary screens and the requested high-precision screen when selected', () => {
    const ordinary = solid(32, 32, 96, 96, 96)
    const accurate = ordinary.slice()
    applyDeviceRasterToRgba(ordinary, 32, 32, {
      halftone: { frequency: 20, angle: 27, spotFunction: 'Round' },
    })
    applyDeviceRasterToRgba(accurate, 32, 32, {
      halftone: { frequency: 20, angle: 27, spotFunction: 'Round', accurateScreens: true },
    })
    expect(accurate).not.toEqual(ordinary)
  })

  it('rejects malformed threshold arrays and device parameter ranges', () => {
    expect(() => validateRenderDeviceParams({ halftone: { type: 6, width: 2, height: 2, thresholds: [0] } })).toThrow(/threshold count/)
    expect(() => validateRenderDeviceParams({ halftone: { type: 5, halftones: [{ colorant: 'Cyan', halftone: { frequency: 60, angle: 15, spotFunction: 'Round' } }] } })).toThrow(/requires a Default/)
    expect(() => validateRenderDeviceParams({ transferFunction: [{ expression: '{}' }] })).toThrow(/exactly four/)
    expect(() => validateRenderDeviceParams({ flatness: 101 })).toThrow(/between 0 and 100/)
    expect(() => validateRenderDeviceParams({ smoothness: -0.1 })).toThrow(/between 0 and 1/)
  })

  it('implements every predefined spot function with the normative equation', () => {
    const x = 0.25
    const y = -0.5
    const expected: Record<string, number> = {
      SimpleDot: 0.6875,
      InvertedSimpleDot: -0.6875,
      DoubleDot: 0.5,
      InvertedDoubleDot: -0.5,
      CosineDot: Math.SQRT1_2 / 2,
      Double: Math.SQRT1_2 / 2,
      InvertedDouble: -Math.SQRT1_2 / 2,
      Line: -0.5,
      LineX: 0.25,
      LineY: -0.5,
      Round: 0.6875,
      Ellipse: 1 - (0.25 ** 2 + (-0.5 / 0.75) ** 2) / 4,
      EllipseA: 0.7125,
      InvertedEllipseA: -0.7125,
      EllipseB: 1 - Math.sqrt(0.25 ** 2 + 5 * 0.5 ** 2 / 8),
      EllipseC: 0.69375,
      InvertedEllipseC: -0.69375,
      Square: -0.5,
      Cross: -0.25,
      Rhomboid: 0.3625,
      Diamond: 0.6875,
    }
    expect(PDF_PREDEFINED_SPOT_FUNCTIONS).toHaveLength(Object.keys(expected).length)
    for (let i = 0; i < PDF_PREDEFINED_SPOT_FUNCTIONS.length; i++) {
      const name = PDF_PREDEFINED_SPOT_FUNCTIONS[i]!
      expect(evaluatePredefinedSpotFunction(name, x, y), name).toBeCloseTo(expected[name]!, 12)
    }
    expect(() => evaluatePredefinedSpotFunction('Unknown', x, y)).toThrow(/Unsupported PDF predefined spot function/)
  })
})
