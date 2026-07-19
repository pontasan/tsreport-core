import { describe, expect, it } from 'vitest'
import { executeSvgFilterGraph } from '../../src/svg/svg-filter.js'
import type { SvgFilterGraph, SvgFilterPrimitive } from '../../src/svg/svg-types.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'

const WIDTH = 3
const HEIGHT = 3

function primitive(type: string, attributes: Record<string, string> = {}, children: SvgFilterPrimitive[] = []): SvgFilterPrimitive {
  return { type, attributes, children }
}

function graph(primitives: SvgFilterPrimitive[]): SvgFilterGraph {
  return {
    type: 'graph', id: 'test', filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
    x: 0, y: 0, width: WIDTH, height: HEIGHT, attributes: {}, primitives,
  }
}

function source(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  const p = (1 * WIDTH + 1) * 4
  rgba[p] = 255
  rgba[p + 3] = 255
  return rgba
}

function pixel(data: Uint8Array, x: number, y: number): number[] {
  const p = (y * WIDTH + x) * 4
  return Array.from(data.subarray(p, p + 4))
}

describe('SVG filter graph executor', () => {
  it('executes blend, composite, merge and flood primitives', () => {
    const output = executeSvgFilterGraph(graph([
      primitive('feFlood', { 'flood-color': '#0000ff', result: 'blue' }),
      primitive('feBlend', { in: 'SourceGraphic', in2: 'blue', mode: 'screen', result: 'mixed' }),
      primitive('feComposite', { in: 'mixed', in2: 'SourceAlpha', operator: 'in', result: 'clipped' }),
      primitive('feMerge', {}, [primitive('feMergeNode', { in: 'clipped' })]),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(output, 1, 1)).toEqual([255, 0, 255, 255])
    expect(pixel(output, 0, 0)[3]).toBe(0)
  })

  it('uses connected FillPaint and StrokePaint standard inputs', () => {
    const fill = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
    const stroke = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      fill[i * 4 + 1] = 255; fill[i * 4 + 3] = 255
      stroke[i * 4 + 2] = 255; stroke[i * 4 + 3] = 255
    }
    const output = executeSvgFilterGraph(graph([
      primitive('feMerge', {}, [primitive('feMergeNode', { in: 'FillPaint' }), primitive('feMergeNode', { in: 'StrokePaint' })]),
    ]), source(), WIDTH, HEIGHT, 1, 1, undefined, undefined, { fillPaint: fill, strokePaint: stroke })
    expect(pixel(output, 0, 0)).toEqual([0, 0, 255, 255])
  })

  it('executes all color-matrix and component-transfer forms', () => {
    const output = executeSvgFilterGraph(graph([
      primitive('feColorMatrix', { type: 'saturate', values: '0' }),
      primitive('feColorMatrix', { type: 'hueRotate', values: '0' }),
      primitive('feColorMatrix', { type: 'matrix', values: '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0' }),
      primitive('feComponentTransfer', {}, [
        primitive('feFuncR', { type: 'linear', slope: '0.5', intercept: '0.25' }),
        primitive('feFuncG', { type: 'table', tableValues: '0 1' }),
        primitive('feFuncB', { type: 'discrete', tableValues: '0 1' }),
        primitive('feFuncA', { type: 'gamma', amplitude: '1', exponent: '1', offset: '0' }),
      ]),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    const center = pixel(output, 1, 1)
    expect(center[0]).toBeGreaterThan(center[1]!)
    expect(center[3]).toBe(255)
  })

  it('executes blur, offset, morphology and convolution', () => {
    const blurred = executeSvgFilterGraph(graph([
      primitive('feGaussianBlur', { stdDeviation: '0.6' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(blurred, 0, 1)[3]).toBeGreaterThan(0)

    const moved = executeSvgFilterGraph(graph([
      primitive('feOffset', { dx: '1', dy: '0' }),
      primitive('feMorphology', { operator: 'dilate', radius: '1' }),
      primitive('feConvolveMatrix', { order: '1', kernelMatrix: '1' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(moved, 2, 1)[3]).toBe(255)
  })

  it('maps filter vectors through the complete primitive affine transform', () => {
    const moved = executeSvgFilterGraph(
      graph([primitive('feOffset', { dx: '1', dy: '0' })]),
      source(), WIDTH, HEIGHT, 1, 1, undefined,
      { primitiveTransform: [0, 1, -1, 0, 3, 0], percentageReferenceWidth: 3, percentageReferenceHeight: 3 },
    )
    expect(pixel(moved, 1, 2)[3]).toBe(255)
    expect(pixel(moved, 2, 1)[3]).toBe(0)
  })

  it('executes displacement, tiling and arithmetic composition', () => {
    const output = executeSvgFilterGraph(graph([
      primitive('feDisplacementMap', { in: 'SourceGraphic', in2: 'SourceGraphic', scale: '0' }),
      primitive('feTile'),
      primitive('feComposite', { in2: 'SourceGraphic', operator: 'arithmetic', k1: '0', k2: '1', k3: '0', k4: '0' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(output, 1, 1)).toEqual([255, 0, 0, 255])
  })

  it('clips primitive inputs and results to their declared subregions', () => {
    const output = executeSvgFilterGraph(graph([
      primitive('feFlood', { x: '1', y: '1', width: '1', height: '1', 'flood-color': '#ff0000', result: 'tileSource' }),
      primitive('feTile', { in: 'tileSource' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      expect(pixel(output, x, y)).toEqual([255, 0, 0, 255])
    }
  })

  it('uses the closest preceding named result and rejects forward references', () => {
    const output = executeSvgFilterGraph(graph([
      primitive('feFlood', { 'flood-color': '#ff0000', result: 'paint' }),
      primitive('feFlood', { 'flood-color': '#0000ff', result: 'paint' }),
      primitive('feComposite', { in: 'paint', in2: 'SourceGraphic', operator: 'in' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(output, 1, 1)).toEqual([0, 0, 255, 255])
    expect(() => executeSvgFilterGraph(graph([
      primitive('feComposite', { in: 'later', in2: 'SourceGraphic', operator: 'in' }),
      primitive('feFlood', { result: 'later' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)).toThrow('does not reference a preceding result')
  })

  it('honors color-interpolation-filters for each primitive', () => {
    const matrix = '0.5 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0'
    const linear = executeSvgFilterGraph(graph([
      primitive('feColorMatrix', { values: matrix }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    const srgb = executeSvgFilterGraph(graph([
      primitive('feColorMatrix', { values: matrix, 'color-interpolation-filters': 'sRGB' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(linear, 1, 1)[0]).toBe(188)
    expect(pixel(srgb, 1, 1)[0]).toBe(128)
  })

  it('decodes feImage PNG data and executes drop shadow', () => {
    const png = encodePngRgba(1, 1, new Uint8Array([0, 255, 0, 255]))
    const href = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    const image = executeSvgFilterGraph(graph([primitive('feImage', { href })]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(image, 0, 0)).toEqual([0, 255, 0, 255])

    const shadow = executeSvgFilterGraph(graph([
      primitive('feDropShadow', { dx: '1', dy: '0', stdDeviation: '0', 'flood-color': '#0000ff' }),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(shadow, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(shadow, 2, 1)).toEqual([0, 0, 255, 255])
  })

  it('executes turbulence and both lighting primitives deterministically', () => {
    const noiseA = executeSvgFilterGraph(graph([primitive('feTurbulence', { baseFrequency: '0.2', numOctaves: '2', seed: '7' })]), source(), WIDTH, HEIGHT, 1, 1)
    const noiseB = executeSvgFilterGraph(graph([primitive('feTurbulence', { baseFrequency: '0.2', numOctaves: '2', seed: '7' })]), source(), WIDTH, HEIGHT, 1, 1)
    expect(noiseA).toEqual(noiseB)

    const diffuse = executeSvgFilterGraph(graph([
      primitive('feDiffuseLighting', { 'lighting-color': '#ffffff', surfaceScale: '2' }, [primitive('feDistantLight', { azimuth: '45', elevation: '60' })]),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(diffuse, 1, 1)[3]).toBe(255)

    const specular = executeSvgFilterGraph(graph([
      primitive('feSpecularLighting', { 'lighting-color': '#ffffff', specularExponent: '4' }, [primitive('fePointLight', { x: '1', y: '1', z: '3' })]),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(specular, 1, 1)[3]).toBeGreaterThan(0)

    const spot = executeSvgFilterGraph(graph([
      primitive('feDiffuseLighting', { 'lighting-color': '#ffffff', diffuseConstant: '1' }, [
        primitive('feSpotLight', { x: '1', y: '1', z: '3', pointsAtX: '1', pointsAtY: '1', pointsAtZ: '0', specularExponent: '2', limitingConeAngle: '10' }),
      ]),
    ]), source(), WIDTH, HEIGHT, 1, 1)
    expect(pixel(spot, 1, 1)[0]).toBeGreaterThan(0)
    expect(pixel(spot, 0, 0)[0]).toBe(0)
  })

})
