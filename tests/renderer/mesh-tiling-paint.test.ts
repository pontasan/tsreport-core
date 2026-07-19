// Mesh gradient / tiling pattern fills across the model and the three
// backends: shared tessellation, template resolution, SVG markup, PDF native
// shading/pattern objects, Canvas clip + painted content.

import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { CanvasBackend, PdfBackend, SvgBackend, renderPage } from '../../src/index.js'
import type { RenderPage } from '../../src/types/render.js'
import type { FunctionShadingPaint, MeshGradientPaint, TilingPatternPaint } from '../../src/renderer/backend.js'
import { parseHexColor, tessellateFunctionShading, tessellateMeshGradient, tileIndexRange } from '../../src/renderer/complex-paint.js'
import { rasterizePackedMesh } from '../../src/renderer/packed-mesh-raster.js'
import { offsetPaintValue, resolveFillPaint, scalePaintY } from '../../src/layout/gradient.js'
import { parseSvgPath } from '../../src/svg/svg-path-parser.js'
import { pdfToText } from './pdf-test-utils.js'

// Flat 0..30 square as a degenerate tensor patch (evenly spaced control net)
function flatPatchPoints(size: number): number[] {
  const points: number[] = []
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      points.push((i / 3) * size, (j / 3) * size)
    }
  }
  return points
}

function meshPaint(): MeshGradientPaint {
  return {
    type: 'mesh-gradient',
    patches: [{ points: flatPatchPoints(30), colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
    triangles: [],
  }
}

function tilingPaint(): TilingPatternPaint {
  const cell = parseSvgPath('M0 0L4 0L4 4L0 4Z')
  return {
    type: 'tiling-pattern',
    bbox: [0, 0, 8, 8],
    xStep: 8,
    yStep: 8,
    matrix: [1, 0, 0, 1, 0, 0],
    graphics: [{ kind: 'path', commands: cell.commands, coords: cell.coords, fill: '#336699' }],
  }
}

function uncoloredTilingPaint(color = '#336699'): TilingPatternPaint {
  const cell = parseSvgPath('M0 0L4 0L4 4L0 4Z')
  return {
    type: 'tiling-pattern',
    paintType: 'uncolored',
    color,
    bbox: [0, 0, 8, 8],
    xStep: 8,
    yStep: 8,
    matrix: [1, 0, 0, 1, 0, 0],
    graphics: [{ kind: 'path', commands: cell.commands, coords: cell.coords, fill: '#000000' }],
  }
}

function groupedTilingPaint(): TilingPatternPaint {
  const clip = parseSvgPath('M0 0L5 0L5 5L0 5Z')
  const cell = parseSvgPath('M0 0L8 0L8 8L0 8Z')
  return {
    type: 'tiling-pattern', bbox: [0, 0, 8, 8], xStep: 8, yStep: 8, matrix: [1, 0, 0, 1, 0, 0],
    graphics: [{
      kind: 'group', x: 2, y: 3, width: 8, height: 8, opacity: 0.5,
      clipPath: { commands: clip.commands, coords: clip.coords },
      graphics: [{ kind: 'path', commands: cell.commands, coords: cell.coords, fill: '#336699' }],
    }],
  }
}

const RECT_PATH = parseSvgPath('M0 0L30 0L30 30L0 30Z')

describe('mesh tessellation', () => {
  it('corner cells take the corner colors and the center blends them', () => {
    const triangles = tessellateMeshGradient(meshPaint())
    expect(triangles.length).toBeGreaterThan(50)
    // Cell nearest to (u,v)=(0,0) is red-dominated
    let nearOrigin = triangles[0]!
    let bestDist = Infinity
    let centerTriangle = triangles[0]!
    let bestCenterDist = Infinity
    for (const t of triangles) {
      const cx = (t.points[0] + t.points[2] + t.points[4]) / 3
      const cy = (t.points[1] + t.points[3] + t.points[5]) / 3
      const dOrigin = cx * cx + cy * cy
      if (dOrigin < bestDist) { bestDist = dOrigin; nearOrigin = t }
      const dCenter = (cx - 15) * (cx - 15) + (cy - 15) * (cy - 15)
      if (dCenter < bestCenterDist) { bestCenterDist = dCenter; centerTriangle = t }
    }
    const [r0, g0, b0] = parseHexColor(nearOrigin.color)
    expect(r0).toBeGreaterThan(200)
    expect(g0).toBeLessThan(80)
    expect(b0).toBeLessThan(80)
    // Center of the patch: bilinear average of the 4 corner colors ≈ (127, 127, 127)
    const [rc, gc, bc] = parseHexColor(centerTriangle.color)
    expect(Math.abs(rc - 127)).toBeLessThan(30)
    expect(Math.abs(gc - 127)).toBeLessThan(30)
    expect(Math.abs(bc - 127)).toBeLessThan(30)
  })

  it('is deterministic', () => {
    const a = tessellateMeshGradient(meshPaint())
    const b = tessellateMeshGradient(meshPaint())
    expect(a).toEqual(b)
  })

  it('uses PDF smoothness as a per-component color-error bound', () => {
    const coarse = tessellateMeshGradient(meshPaint(), { smoothness: 0.5 })
    const fine = tessellateMeshGradient(meshPaint(), { smoothness: 0.05 })
    expect(fine.length).toBeGreaterThan(coarse.length)
    expect(() => tessellateMeshGradient(meshPaint(), { smoothness: 1.1 })).toThrow(/between 0 and 1/)
  })

  it('rejects off-viewport mesh patches before tessellation', () => {
    const far = meshPaint()
    far.patches = far.patches.map(function (patch) {
      return {
        ...patch,
        points: patch.points.map(function (value, index) {
          return value + (index % 2 === 0 ? 1000 : 0)
        }),
      }
    })

    expect(tessellateMeshGradient(meshPaint(), { bounds: [-10, -10, 100, 100] }).length).toBeGreaterThan(0)
    expect(tessellateMeshGradient(far, { bounds: [-10, -10, 100, 100] })).toHaveLength(0)
  })

  it('renders compact mesh patches identically to ordinary patches', () => {
    const ordinary = meshPaint()
    const points = new Float32Array(ordinary.patches[0]!.points)
    const colors = new Uint32Array([0xff0000, 0x00ff00, 0x0000ff, 0xffffff])
    const compact: MeshGradientPaint = {
      type: 'mesh-gradient', patches: [], triangles: [], packedPatches: { points, colors },
    }

    expect(tessellateMeshGradient(compact)).toEqual(tessellateMeshGradient(ordinary))
  })

  it('rasterizes compact tensor patches in device space with bilinear colors', () => {
    const compact: MeshGradientPaint = {
      type: 'mesh-gradient',
      patches: [],
      triangles: [],
      packedPatches: {
        points: new Float32Array(flatPatchPoints(10)),
        colors: new Uint32Array([0xff0000, 0x00ff00, 0x0000ff, 0xffffff]),
      },
    }
    const raster = rasterizePackedMesh(compact, { a: 2, b: 0, c: 0, d: 2, e: 5, f: 7 }, 40, 40)
    expect(raster).not.toBeNull()
    if (raster === null) throw new Error('mesh raster expected')
    const centerX = 15 - raster.x
    const centerY = 17 - raster.y
    const center = (centerY * raster.width + centerX) * 4
    expect(raster.data[center + 3]).toBe(255)
    expect(raster.data[center]).toBeGreaterThan(100)
    expect(raster.data[center]).toBeLessThan(160)
    expect(raster.data[center + 1]).toBeGreaterThan(100)
    expect(raster.data[center + 2]).toBeGreaterThan(100)
  })

  it('samples function shading at the PDF smoothness precision', () => {
    const paint: FunctionShadingPaint = {
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [1, 0, 0, 1, 0, 0],
      expression: '{ pop dup dup }',
    }
    const coarse = tessellateFunctionShading(paint, { smoothness: 0.5 })
    const fine = tessellateFunctionShading(paint, { smoothness: 0.05 })
    expect(fine.length).toBeGreaterThan(coarse.length)
  })
})

describe('paint resolution', () => {
  it('resolveFillPaint shifts mesh geometry to the element position', () => {
    const paint = resolveFillPaint(
      { type: 'meshGradient', patches: [{ points: flatPatchPoints(30), colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }] },
      100, 50, 30, 30,
    )
    expect(paint).toBeDefined()
    if (paint === undefined || typeof paint === 'string' || paint.type !== 'mesh-gradient') throw new Error('unexpected paint')
    expect(paint.patches[0]!.points[0]).toBe(100)
    expect(paint.patches[0]!.points[1]).toBe(50)
  })

  it('resolveFillPaint carries the tiling matrix onto the element position', () => {
    const paint = resolveFillPaint(
      {
        type: 'tilingPattern', bbox: [0, 0, 8, 8], xStep: 8, yStep: 8,
        graphics: [{ kind: 'path', d: 'M0 0L4 0L4 4Z', fill: '#000000' }],
      },
      100, 50, 30, 30,
    )
    if (paint === undefined || typeof paint === 'string' || paint.type !== 'tiling-pattern') throw new Error('unexpected paint')
    expect(paint.matrix[4]).toBe(100)
    expect(paint.matrix[5]).toBe(50)
  })

  it('resolveFillPaint preserves uncolored tiling use-site color', () => {
    const paint = resolveFillPaint(
      {
        type: 'tilingPattern', paintType: 'uncolored', color: '#336699', bbox: [0, 0, 8, 8], xStep: 8, yStep: 8,
        graphics: [{ kind: 'path', d: 'M0 0L4 0L4 4Z', fill: '#000000' }],
      },
      100, 50, 30, 30,
    )
    if (paint === undefined || typeof paint === 'string' || paint.type !== 'tiling-pattern') throw new Error('unexpected paint')
    expect(paint.paintType).toBe('uncolored')
    expect(paint.color).toBe('#336699')
  })

  it('offsetPaintValue and scalePaintY transform mesh and tiling paints', () => {
    const mesh = offsetPaintValue(meshPaint(), 10, 20)
    if (mesh === undefined || typeof mesh === 'string' || mesh.type !== 'mesh-gradient') throw new Error('unexpected paint')
    expect(mesh.patches[0]!.points[0]).toBe(10)
    expect(mesh.patches[0]!.points[1]).toBe(20)
    const scaled = scalePaintY(mesh, 20, 2)
    if (scaled === undefined || typeof scaled === 'string' || scaled.type !== 'mesh-gradient') throw new Error('unexpected paint')
    // y=20 is the origin: stays; the far corner (y=50) doubles to 80
    expect(scaled.patches[0]!.points[1]).toBe(20)
    expect(scaled.patches[0]!.points[31]).toBe(80)

    const tiled = offsetPaintValue(tilingPaint(), 5, 6)
    if (tiled === undefined || typeof tiled === 'string' || tiled.type !== 'tiling-pattern') throw new Error('unexpected paint')
    expect(tiled.matrix[4]).toBe(5)
    expect(tiled.matrix[5]).toBe(6)
  })

  it('tileIndexRange covers the target bounds', () => {
    const range = tileIndexRange(tilingPaint(), [0, 0, 30, 30])
    expect(range.i0).toBeLessThanOrEqual(0)
    expect(range.j0).toBeLessThanOrEqual(0)
    expect(range.i1).toBeGreaterThanOrEqual(3)
    expect(range.j1).toBeGreaterThanOrEqual(3)
  })
})

describe('SVG backend', () => {
  function renderSvgPage(fill: MeshGradientPaint | TilingPatternPaint): string {
    const backend = new SvgBackend({ fonts: {}, background: null })
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill })
    backend.endPage()
    return backend.getPages()[0]!
  }

  it('mesh fill clips to the path and paints tessellated triangles', () => {
    const svg = renderSvgPage(meshPaint())
    expect(svg).toContain('<clipPath')
    expect(svg).toContain('clip-path="url(#')
    expect((svg.match(/fill="#/g) ?? []).length).toBeGreaterThan(50)
  })

  it('tiling fill emits the pattern matrix group and per-tile translates', () => {
    const svg = renderSvgPage(tilingPaint())
    expect(svg).toContain('transform="matrix(1 0 0 1 0 0)"')
    expect(svg).toContain('transform="translate(8 0)"')
    expect(svg).toContain('fill="#336699"')
  })

  it('uncolored tiling fill uses the use-site color', () => {
    const svg = renderSvgPage(uncoloredTilingPaint())
    expect(svg).toContain('fill="#336699"')
    expect(svg).not.toContain('fill="#000000"')
  })

  it('uncolored tiling fill requires a use-site color in SVG output', () => {
    const paint = uncoloredTilingPaint()
    delete paint.color
    expect(function () { renderSvgPage(paint) }).toThrow(/use-site color/)
  })

  it('tiling groups preserve translation, clipping, and opacity in SVG preview', () => {
    const svg = renderSvgPage(groupedTilingPaint())
    expect(svg).toContain('transform="translate(2 3)"')
    expect(svg).toContain('clip-path="url(#')
    expect(svg).toContain('opacity="0.5"')
  })

  it('mesh and tiling strokes use SVG stroke masks', () => {
    const backend = new SvgBackend({ fonts: {}, background: null })
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { stroke: meshPaint(), strokeWidth: 3 })
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { stroke: tilingPaint(), strokeWidth: 2 })
    backend.endPage()
    const svg = backend.getPages()[0]!
    expect(svg).toContain('<mask')
    expect(svg).toContain('stroke="white" stroke-width="3"')
    expect(svg).toContain('mask="url(#')
    expect(svg).toContain('fill="#336699"')
  })
})

describe('PDF backend', () => {
  function renderPdf(fill: MeshGradientPaint | TilingPatternPaint): string {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill })
    backend.endPage()
    backend.endDocument()
    return pdfToText(backend.toUint8Array())
  }

  it('mesh fill emits a native Coons/tensor shading pattern', () => {
    const text = renderPdf(meshPaint())
    expect(text).toMatch(/\/ShadingType [67]/)
    expect(text).toContain('/BitsPerCoordinate 32')
    expect(text).toContain('/PatternType 2')
    expect(text).toContain('scn')
  })

  it('mesh triangles emit a native ShadingType 4 pattern', () => {
    const paint: MeshGradientPaint = {
      type: 'mesh-gradient',
      patches: [],
      triangles: [{ points: [0, 0, 30, 0, 0, 30], colors: ['#ff0000', '#00ff00', '#0000ff'] }],
    }
    const text = renderPdf(paint)
    expect(text).toContain('/ShadingType 4')
  })

  it('tiling fill emits a native PatternType 1 cell stream', () => {
    const text = renderPdf(tilingPaint())
    expect(text).toContain('/PatternType 1')
    expect(text).toContain('/PaintType 1')
    expect(text).toContain('/XStep 8')
    expect(text).toContain('/YStep 8')
    expect(text).toContain('/BBox [0 0 8 8]')
  })

  it('same tiling fill under CTMs 655.36pt apart gets distinct pattern matrices (no key collision)', () => {
    // tilingPaintKey hashes the composed matrix; a 16-bit mix collides two
    // translations differing by an exact 655.36pt multiple (Math.round(v*100)
    // overflows 16 bits at page coordinates), which would reuse the wrong
    // /Matrix. The mix must span 24 bits.
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 700)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: tilingPaint() })
    backend.translate(0, 655.36)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: tilingPaint() })
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    const matrices = new Set([...text.matchAll(/\/PatternType 1[\s\S]*?\/Matrix \[([^\]]*)\]/g)].map((m) => m[1]!))
    // Also collect matrices that precede PatternType (dict key order can vary).
    for (const m of text.matchAll(/\/Matrix \[([^\]]*)\][\s\S]{0,80}?\/PatternType 1/g)) matrices.add(m[1]!)
    expect(matrices.size).toBe(2)
  })

  it('uncolored tiling fill emits PaintType 2 and a Pattern color space', () => {
    const text = renderPdf(uncoloredTilingPaint('#0000ff'))
    expect(text).toContain('/PatternType 1')
    expect(text).toContain('/PaintType 2')
    expect(text).toContain('[/Pattern /DeviceRGB]')
    expect(text).toMatch(/\/CSPat\d+ cs/)
    expect(text).toMatch(/0 0 1 \/P\d+ scn/)
  })

  it('uncolored CMYK tiling fill emits a Pattern DeviceCMYK color space', () => {
    const text = renderPdf(uncoloredTilingPaint('cmyk(0,100,100,0)'))
    expect(text).toContain('/PaintType 2')
    expect(text).toContain('[/Pattern /DeviceCMYK]')
    expect(text).toMatch(/0 1 1 0 \/P\d+ scn/)
  })

  it('uncolored tiling fill requires a use-site color in PDF output', () => {
    const paint = uncoloredTilingPaint()
    delete paint.color
    expect(function () { renderPdf(paint) }).toThrow(/use-site color/)
  })
})

describe.skipIf(!existsSync('/opt/homebrew/bin/pdftoppm'))('complex stroke raster parity', () => {
  it('keeps SVG mesh/tiling strokes within the PDF raster error budget', async () => {
    const path = parseSvgPath('M15 15L85 15L85 85L15 85Z')
    const mesh: MeshGradientPaint = {
      type: 'mesh-gradient',
      patches: [{ points: flatPatchPoints(100), colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
      triangles: [],
    }
    const svgBackend = new SvgBackend({ fonts: {}, background: '#ffffff' })
    svgBackend.beginPage(100, 100)
    svgBackend.drawPathWithPaints(path.commands, path.coords, { stroke: mesh, strokeWidth: 10 })
    svgBackend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { stroke: tilingPaint(), strokeWidth: 6 })
    svgBackend.endPage()

    const pdfBackend = new PdfBackend({ fonts: {} })
    pdfBackend.beginDocument()
    pdfBackend.beginPage(100, 100)
    pdfBackend.drawPathWithPaints(path.commands, path.coords, { stroke: mesh, strokeWidth: 10 })
    pdfBackend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { stroke: tilingPaint(), strokeWidth: 6 })
    pdfBackend.endPage()
    pdfBackend.endDocument()

    const directory = join(tmpdir(), `tsreport-complex-stroke-${process.pid}-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const pdfPath = join(directory, 'stroke.pdf')
      const pngPrefix = join(directory, 'stroke')
      writeFileSync(pdfPath, pdfBackend.toUint8Array())
      execFileSync('/opt/homebrew/bin/pdftoppm', ['-f', '1', '-singlefile', '-r', '96', '-png', pdfPath, pngPrefix])
      const expectedImage = sharp(readFileSync(`${pngPrefix}.png`)).removeAlpha()
      const metadata = await expectedImage.metadata()
      const width = metadata.width!
      const height = metadata.height!
      const expected = await expectedImage.raw().toBuffer()
      const actual = await sharp(Buffer.from(svgBackend.getPages()[0]!))
        .flatten({ background: '#ffffff' }).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
      let absoluteError = 0
      for (let i = 0; i < expected.length; i++) absoluteError += Math.abs(expected[i]! - actual[i]!)
      expect(absoluteError / expected.length).toBeLessThan(12)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Canvas backend', () => {
  function recordingContext() {
    const calls: unknown[][] = []
    const ctx = {
      canvas: { width: 0, height: 0, style: { width: '', height: '' } },
      _calls: calls,
      fillStyle: '' as string,
      strokeStyle: '' as string,
      lineWidth: 0,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      save: vi.fn(() => calls.push(['save'])),
      restore: vi.fn(() => calls.push(['restore'])),
      setTransform: vi.fn((...args: unknown[]) => calls.push(['setTransform', ...args])),
      getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
      transform: vi.fn((...args: unknown[]) => calls.push(['transform', ...args])),
      translate: vi.fn((x: number, y: number) => calls.push(['translate', x, y])),
      scale: vi.fn((...args: unknown[]) => calls.push(['scale', ...args])),
      beginPath: vi.fn(() => calls.push(['beginPath'])),
      closePath: vi.fn(() => calls.push(['closePath'])),
      moveTo: vi.fn((x: number, y: number) => calls.push(['moveTo', x, y])),
      lineTo: vi.fn((x: number, y: number) => calls.push(['lineTo', x, y])),
      bezierCurveTo: vi.fn((...args: unknown[]) => calls.push(['bezierCurveTo', ...args])),
      rect: vi.fn((...args: unknown[]) => calls.push(['rect', ...args])),
      clip: vi.fn((...args: unknown[]) => calls.push(['clip', ...args])),
      fill: vi.fn((...args: unknown[]) => calls.push(['fill', ...args])),
      stroke: vi.fn(() => calls.push(['stroke'])),
      fillRect: vi.fn((...args: unknown[]) => calls.push(['fillRect', ...args])),
      drawImage: vi.fn((...args: unknown[]) => calls.push(['drawImage', ...args])),
      getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      createImageData: vi.fn((width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
      putImageData: vi.fn((...args: unknown[]) => calls.push(['putImageData', ...args])),
      setLineDash: vi.fn(() => calls.push(['setLineDash'])),
      createLinearGradient: vi.fn((...args: unknown[]) => {
        calls.push(['createLinearGradient', ...args])
        return { addColorStop: vi.fn((...stop: unknown[]) => calls.push(['addColorStop', ...stop])) }
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ctx as any
  }

  it('mesh fill clips to the path and fills the tessellation', () => {
    const ctx = recordingContext()
    const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
    const page: RenderPage = { width: 100, height: 100, children: [] }
    backend.beginPage(page.width, page.height)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: meshPaint() })
    const calls = ctx._calls as unknown[][]
    expect(calls.some(function (c) { return c[0] === 'clip' })).toBe(true)
    const fillCount = calls.filter(function (c) { return c[0] === 'fill' }).length
    expect(fillCount).toBeGreaterThan(50)
  })

  it('paints compact imported meshes as streamed gradient cells', () => {
    const ctx = recordingContext()
    const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
    const ordinary = meshPaint()
    const compact: MeshGradientPaint = {
      type: 'mesh-gradient', patches: [], triangles: [],
      packedPatches: {
        points: new Float32Array(ordinary.patches[0]!.points),
        colors: new Uint32Array([0xff0000, 0x00ff00, 0x0000ff, 0xffffff]),
      },
    }
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: compact })

    const calls = ctx._calls as unknown[][]
    expect(calls.filter(function (call) { return call[0] === 'createLinearGradient' }).length).toBe(16)
    expect(calls.filter(function (call) { return call[0] === 'fill' }).length).toBe(16)
  })

  it('rasterizes large ordinary patch meshes on one common device grid', () => {
    const ctx = recordingContext()
    const previous = (globalThis as Record<string, unknown>).OffscreenCanvas
    class TestOffscreenCanvas {
      width: number
      height: number
      private readonly context = recordingContext()
      constructor(width: number, height: number) { this.width = width; this.height = height; this.context.canvas = this }
      getContext(): typeof this.context { return this.context }
    }
    ;(globalThis as Record<string, unknown>).OffscreenCanvas = TestOffscreenCanvas
    try {
      const ordinary = meshPaint()
      const patch = ordinary.patches[0]!
      const large: MeshGradientPaint = {
        type: 'mesh-gradient', triangles: [],
        patches: Array.from({ length: 64 }, function () { return patch }),
      }
      const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
      backend.beginPage(100, 100)
      backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: large })

      const calls = ctx._calls as unknown[][]
      expect(calls.filter(function (call) { return call[0] === 'drawImage' })).toHaveLength(1)
      expect(calls.filter(function (call) { return call[0] === 'fill' })).toHaveLength(0)
    } finally {
      ;(globalThis as Record<string, unknown>).OffscreenCanvas = previous
    }
  })

  it('tiling fill transforms into pattern space and clips each cell', () => {
    const ctx = recordingContext()
    const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: tilingPaint() })
    const calls = ctx._calls as unknown[][]
    expect(calls.some(function (c) { return c[0] === 'transform' })).toBe(true)
    expect(calls.filter(function (c) { return c[0] === 'translate' }).length).toBeGreaterThan(4)
  })

  it('uncolored tiling fill uses the use-site color on canvas', () => {
    const ctx = recordingContext()
    const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: uncoloredTilingPaint() })
    expect(ctx.fillStyle).toBe('#336699')
  })

  it('uncolored tiling fill requires a use-site color on canvas', () => {
    const ctx = recordingContext()
    const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
    const paint = uncoloredTilingPaint()
    delete paint.color
    backend.beginPage(100, 100)
    expect(function () {
      backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: paint })
    }).toThrow(/use-site color/)
  })

  it('tiling groups preserve translation, clipping, and opacity on canvas', () => {
    const ctx = recordingContext()
    const previous = (globalThis as Record<string, unknown>).OffscreenCanvas
    class TestOffscreenCanvas {
      width: number
      height: number
      private readonly context = recordingContext()
      constructor(width: number, height: number) { this.width = width; this.height = height; this.context.canvas = this }
      getContext(): typeof this.context { return this.context }
    }
    ;(globalThis as Record<string, unknown>).OffscreenCanvas = TestOffscreenCanvas
    try {
      const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
      backend.beginPage(100, 100)
      backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { fill: groupedTilingPaint() })
      const calls = ctx._calls as unknown[][]
      expect(calls.some(function (call) { return call[0] === 'translate' && call[1] === 2 && call[2] === 3 })).toBe(true)
      expect(ctx.globalAlpha).toBe(0.5)
    } finally {
      ;(globalThis as Record<string, unknown>).OffscreenCanvas = previous
    }
  })

  it('mesh and tiling strokes use an offscreen destination-in mask on canvas', () => {
    const ctx = recordingContext()
    const previous = (globalThis as Record<string, unknown>).OffscreenCanvas
    class TestOffscreenCanvas {
      width: number
      height: number
      private readonly context = recordingContext()
      constructor(width: number, height: number) { this.width = width; this.height = height; this.context.canvas = this }
      getContext(): typeof this.context { return this.context }
    }
    ;(globalThis as Record<string, unknown>).OffscreenCanvas = TestOffscreenCanvas
    try {
      const backend = new CanvasBackend(ctx, { fonts: {}, background: null, devicePixelRatio: 1 })
      backend.beginPage(100, 100)
      backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { stroke: tilingPaint() })
      backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, { stroke: meshPaint() })
      expect((ctx._calls as unknown[][]).filter(function (call) { return call[0] === 'drawImage' })).toHaveLength(2)
    } finally {
      ;(globalThis as Record<string, unknown>).OffscreenCanvas = previous
    }
  })
})

describe('template to render integration', () => {
  it('a path element with a mesh gradient fill renders through the pipeline', async () => {
    const { createReport } = await import('../../src/index.js')
    const doc = createReport({
      page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        title: {
          height: 100,
          elements: [{
            type: 'path', x: 10, y: 10, width: 30, height: 30, d: 'M0 0L30 0L30 30L0 30Z',
            fill: { type: 'meshGradient', patches: [{ points: flatPatchPoints(30), colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }] },
          }],
        },
      },
    }, { rows: [{}] })
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    renderPage(doc.pages[0]!, backend)
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toMatch(/\/ShadingType [67]/)
  })
})
