import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { PdfBackend, render } from '../../src/index.js'
import type { RenderDeviceParams, RenderDocument, RenderNode } from '../../src/types/render.js'
import { adjustPdfStrokePath, adjustPdfStrokeWidth } from '../../src/renderer/pdf-scan-conversion.js'
import { compositePdfTransparencyObject } from '../../src/renderer/pdf-compositor.js'
import { applyDeviceRasterToRgba } from '../../src/renderer/device-raster.js'
import type { BlendMode } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

const PDFTOPPM = '/opt/homebrew/bin/pdftoppm'
const GHOSTSCRIPT = '/opt/homebrew/bin/gs'
let rasterCounter = 0

function pdf(nodes: RenderNode[]): Uint8Array {
  const backend = new PdfBackend({ fonts: {} })
  const document: RenderDocument = { pages: [{ width: 100, height: 100, children: nodes }] }
  render(document, backend)
  return backend.toUint8Array()
}

async function raster(bytes: Uint8Array, cmyk = false, overprint = false): Promise<{ data: Buffer, channels: number }> {
  const directory = join(tmpdir(), `tsreport-production-${process.pid}-${Date.now()}-${rasterCounter++}`)
  mkdirSync(directory, { recursive: true })
  try {
    const input = join(directory, 'input.pdf')
    const output = join(directory, 'page')
    writeFileSync(input, bytes)
    const args = ['-f', '1', '-singlefile', '-r', '72']
    if (overprint) args.push('-overprint')
    if (cmyk) args.push('-jpegcmyk', input, output)
    else args.push('-png', input, output)
    execFileSync(PDFTOPPM, args)
    const image = sharp(readFileSync(`${output}.${cmyk ? 'jpg' : 'png'}`))
    const metadata = await image.metadata()
    return { data: await image.raw().toBuffer(), channels: metadata.channels! }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function rasterMonochrome(bytes: Uint8Array): Promise<{ data: Buffer, channels: number }> {
  const directory = join(tmpdir(), `tsreport-production-gs-${process.pid}-${Date.now()}-${rasterCounter++}`)
  mkdirSync(directory, { recursive: true })
  try {
    const input = join(directory, 'input.pdf')
    const output = join(directory, 'page.png')
    writeFileSync(input, bytes)
    execFileSync(GHOSTSCRIPT, [
      '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dGraphicsAlphaBits=1', '-dTextAlphaBits=1',
      '-sDEVICE=pngmono', '-r72', `-sOutputFile=${output}`, input,
    ])
    const image = sharp(readFileSync(output))
    const metadata = await image.metadata()
    return { data: await image.raw().toBuffer(), channels: metadata.channels! }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function pixel(image: { data: Buffer, channels: number }, x: number, y: number): number[] {
  const start = (y * 100 + x) * image.channels
  return Array.from(image.data.subarray(start, start + image.channels))
}

describe.skipIf(!existsSync(PDFTOPPM))('PDF production raster oracle', () => {
  it('matches every PDF blend equation to the independent renderer', async () => {
    const modes: BlendMode[] = [
      'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light',
      'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    ]
    const nodes: RenderNode[] = [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#40a0e0' }]
    for (let i = 0; i < modes.length; i++) {
      nodes.push({
        type: 'rect', x: (i % 4) * 25, y: Math.floor(i / 4) * 25,
        width: 25, height: 25, fill: '#e06020', blendMode: modes[i],
      })
    }
    const image = await raster(pdf(nodes))
    for (let i = 0; i < modes.length; i++) {
      const accumulated = new Uint8ClampedArray([64, 160, 224, 255])
      const backdrop = accumulated.slice()
      compositePdfTransparencyObject(
        accumulated, backdrop, new Uint8ClampedArray([224, 96, 32, 255]),
        new Uint8ClampedArray(1), new Uint8ClampedArray(1), new Uint8ClampedArray([255]),
        false, modes[i]!,
      )
      const actual = pixel(image, (i % 4) * 25 + 12, Math.floor(i / 4) * 25 + 12)
      for (let component = 0; component < 3; component++) {
        expect(Math.abs(actual[component]! - accumulated[component]!), `${modes[i]} component ${component}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('matches independent blend, isolated, and knockout compositing behavior', async () => {
    const normal = await raster(pdf([
      { type: 'rect', x: 10, y: 10, width: 60, height: 60, fill: '#ff0000' },
      { type: 'rect', x: 40, y: 40, width: 50, height: 50, fill: '#0000ff' },
    ]))
    const multiply = await raster(pdf([
      { type: 'rect', x: 10, y: 10, width: 60, height: 60, fill: '#ff0000' },
      { type: 'rect', x: 40, y: 40, width: 50, height: 50, fill: '#0000ff', blendMode: 'multiply' },
    ]))
    expect(pixel(normal, 50, 50)).not.toEqual(pixel(multiply, 50, 50))
    expect(pixel(multiply, 50, 50).slice(0, 3).every(function (channel) { return channel < 20 })).toBe(true)

    const group = function (knockout: boolean, isolated = true): RenderNode[] { return [
      { type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#00ff00' },
      {
      type: 'group', x: 10, y: 10, width: 80, height: 80, isolated, knockout, transparencyGroup: !isolated, blendMode: 'multiply',
      children: [
        { type: 'group', x: 0, y: 0, width: 60, height: 60, opacity: 0.5, children: [{ type: 'rect', x: 0, y: 0, width: 60, height: 60, fill: '#ff0000' }] },
        { type: 'group', x: 30, y: 30, width: 50, height: 50, opacity: 0.5, children: [{ type: 'rect', x: 0, y: 0, width: 50, height: 50, fill: '#0000ff' }] },
      ],
    }] }
    const regularBytes = pdf(group(false))
    const knockoutBytes = pdf(group(true))
    expect(pdfToText(regularBytes)).toContain('/I true /K false')
    expect(pdfToText(knockoutBytes)).toContain('/I true /K true')
    const composited = await raster(regularBytes)
    const knockedOut = await raster(knockoutBytes)
    expect(pixel(composited, 50, 50)).toEqual([0, 63, 0])
    expect(pixel(knockedOut, 50, 50)).toEqual([0, 127, 0])
    const nonIsolatedBytes = pdf(group(false, false))
    expect(pdfToText(nonIsolatedBytes)).toContain('/I false /K false')
    expect(pixel(await raster(nonIsolatedBytes), 50, 50)).toEqual([0, 63, 0])
  })

  it('preserves cyan and magenta plates only when overprint is enabled', async () => {
    const base: RenderNode = { type: 'rect', x: 10, y: 10, width: 70, height: 70, fill: 'cmyk(100,0,0,0)' }
    const top = function (overprintFill: boolean): RenderNode {
      return { type: 'rect', x: 40, y: 40, width: 50, height: 50, fill: 'cmyk(0,100,0,0)', overprintFill, overprintMode: 1 }
    }
    const replaced = await raster(pdf([base, top(false)]), true, true)
    const overprinted = await raster(pdf([base, top(true)]), true, true)
    const replacePixel = pixel(replaced, 50, 50)
    const overprintPixel = pixel(overprinted, 50, 50)
    expect(replaced.channels).toBe(4)
    expect(pixel(replaced, 20, 20)).not.toEqual(pixel(replaced, 85, 85))
    expect(overprintPixel).not.toEqual(replacePixel)
    expect(overprintPixel[1]).toBeGreaterThan(180)
  })

  it('renders every intent and black-point-compensation state through the independent engine', async () => {
    for (const intent of ['AbsoluteColorimetric', 'RelativeColorimetric', 'Saturation', 'Perceptual'] as const) {
      for (const state of ['on', 'off', 'default'] as const) {
        const bytes = pdf([{
          type: 'group', x: 0, y: 0, width: 100, height: 100,
          renderingIntent: intent, deviceParams: { useBlackPointCompensation: state },
          children: [{ type: 'rect', x: 10, y: 10, width: 80, height: 80, fill: 'cmyk(80,40,20,30)' }],
        }])
        const text = pdfToText(bytes)
        expect(text).toContain(`/RI /${intent}`)
        expect(text).toContain(`/UseBlackPtComp /${state === 'on' ? 'ON' : state === 'off' ? 'OFF' : 'Default'}`)
        expect(pixel(await raster(bytes, true, true), 50, 50).some(function (channel) { return channel > 0 })).toBe(true)
      }
    }
  })

  it('renders all halftone algorithms and halftone origin through the independent engine', async () => {
    const halftones = [
      { frequency: 18, angle: 15, spotFunction: 'Round' },
      { type: 6 as const, width: 2, height: 2, thresholds: [0, 128, 192, 255] },
      { type: 10 as const, xsquare: 2, ysquare: 1, thresholds: [0, 64, 128, 192, 255] },
      { type: 16 as const, width: 2, height: 1, width2: 1, height2: 1, thresholds: [0, 65535, 32768] },
    ]
    for (let i = 0; i < halftones.length; i++) {
      const bytes = pdf([{
        type: 'group', x: 0, y: 0, width: 100, height: 100,
        deviceParams: { halftone: halftones[i]!, halftoneOrigin: [3, 5] },
        children: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#808080' }],
      }])
      expect(pdfToText(bytes)).toContain(`/HalftoneType ${i === 0 ? 1 : halftones[i]!.type}`)
      expect(pdfToText(bytes)).toContain('/HTO [3 5]')
      const image = await raster(bytes)
      expect(pixel(image, 50, 50).slice(0, 3).some(function (channel) { return channel < 255 })).toBe(true)
    }
  })

  it.skipIf(!existsSync(GHOSTSCRIPT))('matches threshold halftone pixels to the independent renderer', async () => {
    const params = {
      halftoneOrigin: [0, 0] as [number, number],
      halftone: { type: 6 as const, width: 2, height: 2, thresholds: [0, 64, 128, 192] },
    }
    const bytes = pdf([{
      type: 'group', x: 0, y: 0, width: 100, height: 100, deviceParams: params,
      children: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#808080' }],
    }])
    const actual = await rasterMonochrome(bytes)
    const expected = new Uint8ClampedArray(100 * 100 * 4)
    for (let offset = 0; offset < expected.length; offset += 4) {
      expected[offset] = 128
      expected[offset + 1] = 128
      expected[offset + 2] = 128
      expected[offset + 3] = 255
    }
    applyDeviceRasterToRgba(expected, 100, 100, params)
    let actualWhite = 0
    let expectedWhite = 0
    for (let y = 2; y < 98; y++) {
      for (let x = 2; x < 98; x++) {
        if (pixel(actual, x, y)[0] === 255) actualWhite++
        if (expected[(y * 100 + x) * 4] === 255) expectedWhite++
      }
    }
    expect(actualWhite).toBe(expectedWhite)

  })

  it.skipIf(!existsSync(GHOSTSCRIPT))('matches type 1, 5, 10, and 16 halftone coverage to the independent renderer', async () => {
    const cases: RenderDeviceParams[] = [
      {
        halftone: {
          type: 5,
          halftones: [
            { colorant: 'Gray', halftone: { type: 6, width: 2, height: 2, thresholds: [0, 64, 128, 192] } },
            { colorant: 'Default', halftone: { type: 6, width: 1, height: 1, thresholds: [255] } },
          ],
        },
      },
      { halftone: { type: 10, xsquare: 2, ysquare: 1, thresholds: [0, 64, 128, 192, 255] } },
      { halftone: { type: 16, width: 2, height: 1, width2: 1, height2: 1, thresholds: [0, 65535, 32768] } },
      { halftone: { frequency: 18, angle: 15, spotFunction: 'Round' } },
      { halftone: { frequency: 18, angle: 15, spotFunction: 'Round', accurateScreens: true } },
    ]
    for (let index = 0; index < cases.length; index++) {
      const params = cases[index]!
      const bytes = pdf([{
        type: 'group', x: 0, y: 0, width: 100, height: 100, deviceParams: params,
        children: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#808080' }],
      }])
      const actual = await rasterMonochrome(bytes)
      const expected = new Uint8ClampedArray(100 * 100 * 4)
      for (let offset = 0; offset < expected.length; offset += 4) {
        expected[offset] = 128
        expected[offset + 1] = 128
        expected[offset + 2] = 128
        expected[offset + 3] = 255
      }
      applyDeviceRasterToRgba(expected, 100, 100, params)
      let actualWhite = 0
      let expectedWhite = 0
      for (let y = 2; y < 98; y++) {
        for (let x = 2; x < 98; x++) {
          if (pixel(actual, x, y)[0] === 255) actualWhite++
          if (expected[(y * 100 + x) * 4] === 255) expectedWhite++
        }
      }
      // Type 1 permits device-specific rational screen-cell selection; compare
      // its tone coverage within one 8-bit output step per 32 samples.
      const tolerance = index < 3 ? 10 : 288
      expect(Math.abs(actualWhite - expectedWhite), `halftone case ${index}: ${actualWhite}/${expectedWhite}`).toBeLessThanOrEqual(tolerance)
    }
  })

  it('applies transfer, black generation, and undercolor removal to rendered pixels', async () => {
    const normal = await raster(pdf([{
      type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#204080',
    }]))
    const processed = await raster(pdf([{
      type: 'group', x: 0, y: 0, width: 100, height: 100,
      deviceParams: {
        transferFunction: { expression: '{ 1 exch sub }' },
        blackGeneration: { expression: '{ dup mul }' },
        undercolorRemoval: { expression: '{ 0.5 mul }' },
      },
      children: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#204080' }],
    }]))
    expect(pixel(processed, 50, 50)).not.toEqual(pixel(normal, 50, 50))
  })

  it('matches the shared stroke-adjustment grid to independent scan conversion', async () => {
    const bytes = pdf([{
      type: 'group', x: 0, y: 0, width: 100, height: 100,
      deviceParams: { strokeAdjustment: true, flatness: 0.25 },
      children: [
        { type: 'line', x1: 5.1, y1: 2, x2: 5.1, y2: 14, lineWidth: 0.2, color: '#000000' },
        { type: 'line', x1: 18, y1: 5.1, x2: 30, y2: 5.1, lineWidth: 0.2, color: '#000000' },
      ],
    }])
    expect(pdfToText(bytes)).toContain('/SA true')
    const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    const vertical = adjustPdfStrokePath(new Float32Array([5.1, 2, 5.1, 14]), 0.2, matrix)
    const horizontal = adjustPdfStrokePath(new Float32Array([18, 5.1, 30, 5.1]), 0.2, matrix)
    expect(adjustPdfStrokeWidth(0.2, matrix)).toBe(1)
    expect(vertical[0]).toBe(5.5)
    expect(horizontal[1]).toBe(5.5)
    const image = await raster(bytes)
    expect(pixel(image, 5, 8).slice(0, 3).every(function (channel) { return channel < 32 })).toBe(true)
    expect(pixel(image, 4, 8).slice(0, 3).every(function (channel) { return channel > 224 })).toBe(true)
    expect(pixel(image, 24, 5).slice(0, 3).every(function (channel) { return channel < 32 })).toBe(true)
    expect(pixel(image, 24, 4).slice(0, 3).every(function (channel) { return channel > 224 })).toBe(true)
  })
})
