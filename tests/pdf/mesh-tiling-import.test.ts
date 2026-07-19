// Round trip of mesh gradients and tiling patterns: our own PdfBackend
// output re-imported through PdfImporter must reproduce the fill structure
// (previously these shading/pattern types failed the whole page import).

import { describe, expect, it } from 'vitest'
import { createReport, PdfBackend, PdfImporter, renderToPdf } from '../../src/index.js'
import type { FunctionShadingPaint, MeshGradientPaint, TilingPatternPaint } from '../../src/renderer/backend.js'
import type { MeshGradientDef, PathDef, TilingPatternDef } from '../../src/types/template.js'
import { parseSvgPath } from '../../src/svg/svg-path-parser.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'

const RECT_PATH = parseSvgPath('M0 0L30 0L30 30L0 30Z')

function flatPatchPoints(size: number, x: number, y: number): number[] {
  const points: number[] = []
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      points.push(x + (i / 3) * size, y + (j / 3) * size)
    }
  }
  return points
}

function renderPdf(
  fill: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint,
  standardFonts?: Record<string, string>,
): Uint8Array {
  const backend = new PdfBackend({ fonts: {}, standardFonts })
  backend.beginDocument()
  backend.beginPage(100, 100)
  // Page-space path at (10, 10)
  const coords = new Float32Array(RECT_PATH.coords.length)
  for (let i = 0; i < RECT_PATH.coords.length; i += 2) {
    coords[i] = RECT_PATH.coords[i]! + 10
    coords[i + 1] = RECT_PATH.coords[i + 1]! + 10
  }
  backend.drawPathWithPaints(RECT_PATH.commands, coords, { fill })
  backend.endPage()
  backend.endDocument()
  return backend.toUint8Array()
}

function importedPathFills(pdf: Uint8Array): PathDef[] {
  const importer = PdfImporter.open(pdf)
  const page = importer.importPage(0)
  const paths: PathDef[] = []
  const walk = function (elements: typeof page.elements): void {
    for (const element of elements) {
      if (element.type === 'path' && element.fill !== undefined) paths.push(element)
      if (element.type === 'frame' && element.elements !== undefined) walk(element.elements)
    }
  }
  walk(page.elements)
  return paths
}

function reemitImportedPdf(pdf: Uint8Array): Uint8Array {
  const page = PdfImporter.open(pdf).importPage(0)
  const report = createReport({
    page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
    bands: { details: [{ height: 100, elements: page.elements }] },
  }, { rows: [{}] })
  return renderToPdf(report, { fonts: {} })
}

describe('mesh gradient round trip', () => {
  it('tensor patches survive the PDF round trip', () => {
    const pdf = renderPdf({
      type: 'mesh-gradient',
      patches: [{ points: flatPatchPoints(30, 10, 10), colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
      triangles: [],
    })
    const paths = importedPathFills(pdf)
    const mesh = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'meshGradient'
    })
    expect(mesh).toBeDefined()
    const fill = mesh!.fill as MeshGradientDef
    expect(fill.patches!.length).toBe(1)
    expect(fill.patches![0]!.colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff'])
    // Element-local geometry: the patch covers 0..30 within the path bounds
    const points = fill.patches![0]!.points
    const absolute = points.map(function (v, i) { return v + (i % 2 === 0 ? mesh!.x : mesh!.y) })
    expect(absolute[0]).toBeCloseTo(10, 3)
    expect(absolute[1]).toBeCloseTo(10, 3)
    expect(absolute[30]).toBeCloseTo(40, 3)
    expect(absolute[31]).toBeCloseTo(40, 3)
  })

  it.each([1, 2, 4, 8, 12, 16, 24, 32])('decodes Type 5 with BitsPerCoordinate=%i', (bits) => {
    const pdf = buildPackedMeshPdf(5, bits, 8)
    const fill = importedMeshFill(pdf)
    expect(fill.lattice?.points).toHaveLength(8)
    expect(fill.pdfShading?.native?.bitsPerCoordinate).toBe(bits)
    expect(new TextDecoder('latin1').decode(reemitImportedPdf(pdf))).toContain(`/BitsPerCoordinate ${bits}`)
  })

  it.each([1, 2, 4, 8, 12, 16])('decodes Type 5 with BitsPerComponent=%i', (bits) => {
    const pdf = buildPackedMeshPdf(5, 8, bits)
    const fill = importedMeshFill(pdf)
    expect(fill.lattice?.colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff'])
    expect(fill.pdfShading?.native?.bitsPerComponent).toBe(bits)
    expect(new TextDecoder('latin1').decode(reemitImportedPdf(pdf))).toContain(`/BitsPerComponent ${bits}`)
  })

  it.each([4, 6, 7] as const)('decodes every permitted BitsPerFlag width for ShadingType %i', (shadingType) => {
    for (const bitsPerFlag of [2, 4, 8]) {
      const fill = importedMeshFill(buildPackedMeshPdf(shadingType, 8, 8, bitsPerFlag))
      if (shadingType === 4) expect(fill.triangles).toHaveLength(1)
      else expect(fill.patches).toHaveLength(1)
      expect(fill.pdfShading?.native?.bitsPerFlag).toBe(bitsPerFlag)
      expect(new TextDecoder('latin1').decode(reemitImportedPdf(buildPackedMeshPdf(shadingType, 8, 8, bitsPerFlag)))).toContain(`/BitsPerFlag ${bitsPerFlag}`)
    }
  })

  it('decodes mesh Function arrays and retains common shading entries through re-output', () => {
    const first = PdfImporter.open(buildPackedMeshPdf(5, 8, 8, 8, true)).importPage(0)
    const path = findMeshPath(first.elements)
    expect((path.fill as MeshGradientDef).lattice?.colors).toEqual(['#000000', '#ffffff', '#808080', '#404040'])
    expect((path.fill as MeshGradientDef).pdfShading).toMatchObject({ background: [0.1, 0.2, 0.3], bbox: [0, 0, 20, 20], antiAlias: true })
    expect((path.fill as MeshGradientDef).pdfShading?.native).toMatchObject({
      shadingType: 5,
      bitsPerCoordinate: 8,
      bitsPerComponent: 8,
      decode: [0, 20, 0, 20, 0, 1],
      colorSpace: { kind: 'rgb' },
      background: [0.1, 0.2, 0.3],
    })
    const report = createReport({
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: 100, elements: first.elements }] },
    }, { rows: [{}] })
    const text = new TextDecoder('latin1').decode(renderToPdf(report, { fonts: {} }))
    expect(text).toContain('/Background [0.1 0.2 0.3]')
    expect(text).toContain('/AntiAlias true')
    expect(text).toContain('/Function [')
  })

  it.each([
    [5, 3, 8, 8, /BitsPerCoordinate/],
    [5, 8, 3, 8, /BitsPerComponent/],
    [4, 8, 8, 1, /BitsPerFlag/],
  ])('rejects forbidden mesh bit widths', (type, coordBits, componentBits, flagBits, error) => {
    expect(() => PdfImporter.open(buildPackedMeshPdf(type as 4 | 5, coordBits, componentBits, flagBits)).importPage(0)).toThrow(error as RegExp)
  })

  it('rejects truncated mesh records and non-zero trailing padding bits', () => {
    expect(() => PdfImporter.open(buildPackedMeshPdf(5, 8, 8, 8, false, 'truncate')).importPage(0)).toThrow(/padding|truncated/)
    expect(() => PdfImporter.open(buildPackedMeshPdf(5, 1, 1, 8, false, 'nonzero-padding')).importPage(0)).toThrow(/padding/)
  })

  it('free-form triangles survive the PDF round trip', () => {
    const pdf = renderPdf({
      type: 'mesh-gradient',
      patches: [],
      triangles: [{ points: [10, 10, 40, 10, 10, 40], colors: ['#ff0000', '#00ff00', '#0000ff'] }],
    })
    const paths = importedPathFills(pdf)
    const mesh = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'meshGradient'
    })
    expect(mesh).toBeDefined()
    const fill = mesh!.fill as MeshGradientDef
    expect(fill.triangles!.length).toBe(1)
    expect(fill.triangles![0]!.colors).toEqual(['#ff0000', '#00ff00', '#0000ff'])
  })
})

describe('tiling pattern round trip', () => {
  it('the cell graphics and steps survive the PDF round trip', () => {
    const cell = parseSvgPath('M0 0L4 0L4 4L0 4Z')
    const pdf = renderPdf({
      type: 'tiling-pattern',
      tilingType: 2,
      bbox: [0, 0, 8, 8],
      xStep: 8,
      yStep: 8,
      matrix: [1, 0, 0, 1, 10, 10],
      graphics: [{ kind: 'path', commands: cell.commands, coords: cell.coords, fill: '#336699' }],
    })
    const paths = importedPathFills(pdf)
    const tiled = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'tilingPattern'
    })
    expect(tiled).toBeDefined()
    const fill = tiled!.fill as TilingPatternDef
    expect(fill.xStep).toBe(8)
    expect(fill.yStep).toBe(8)
    expect(fill.tilingType).toBe(2)
    expect(fill.bbox).toEqual([0, 0, 8, 8])
    expect(fill.graphics.length).toBe(1)
    const graphic = fill.graphics[0]!
    if (graphic.kind !== 'path') throw new Error('unexpected tile graphic kind')
    expect(graphic.fill).toBe('#336699')
  })

  it('uncolored patterns import with the use-site color applied to cell graphics', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const cell = parseSvgPath('M0 0L4 0L4 4L0 4Z')
    const pdf = renderPdf({
      type: 'tiling-pattern',
      paintType: 'uncolored',
      color: '#336699',
      bbox: [0, 0, 8, 8],
      xStep: 8,
      yStep: 8,
      matrix: [1, 0, 0, 1, 10, 10],
      graphics: [{ kind: 'path', commands: cell.commands, coords: cell.coords, fill: '#000000' }],
    })
    const text = pdfToText(pdf)
    expect(text).toContain('/PaintType 2')

    const paths = importedPathFills(pdf)
    const tiled = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'tilingPattern'
    })
    expect(tiled).toBeDefined()
    const fill = tiled!.fill as TilingPatternDef
    const graphic = fill.graphics[0]!
    if (graphic.kind !== 'path') throw new Error('unexpected tile graphic kind')
    expect(graphic.fill).toBe('#336699')
  })

  it('preserves nested tiling and mesh paints in cell paths', () => {
    const cell = parseSvgPath('M0 0L8 0L8 8L0 8Z')
    const inner = parseSvgPath('M0 0L2 0L2 2L0 2Z')
    const pdf = renderPdf({
      type: 'tiling-pattern', bbox: [0, 0, 8, 8], xStep: 8, yStep: 8, matrix: [1, 0, 0, 1, 10, 10],
      graphics: [{
        kind: 'path', commands: cell.commands, coords: cell.coords,
        fill: {
          type: 'tiling-pattern', bbox: [0, 0, 4, 4], xStep: 4, yStep: 4, matrix: [1, 0, 0, 1, 0, 0],
          graphics: [{ kind: 'path', commands: inner.commands, coords: inner.coords, fill: '#ff0000' }],
        },
        stroke: {
          type: 'mesh-gradient', patches: [],
          triangles: [{ points: [0, 0, 8, 0, 0, 8], colors: ['#ff0000', '#00ff00', '#0000ff'] }],
        },
      }],
    })
    const outer = importedPathFills(pdf).find(function (p) {
      return typeof p.fill !== 'string' && p.fill?.type === 'tilingPattern'
    })!
    const outerPattern = outer.fill as TilingPatternDef
    const graphic = outerPattern.graphics[0]!
    if (graphic.kind !== 'path') throw new Error('unexpected tile graphic kind')
    expect(typeof graphic.fill !== 'string' && graphic.fill?.type).toBe('tilingPattern')
    expect(outerPattern.graphics.some(function (g) {
      return g.kind === 'path' && ((typeof g.fill !== 'string' && g.fill?.type === 'meshGradient')
        || (typeof g.stroke !== 'string' && g.stroke?.type === 'meshGradient'))
    })).toBe(true)
  })

  it('preserves text inside a tiling pattern cell', () => {
    const pdf = renderPdf({
      type: 'tiling-pattern', bbox: [0, 0, 20, 20], xStep: 20, yStep: 20, matrix: [1, 0, 0, 1, 10, 10],
      graphics: [{ kind: 'text', x: 2, y: 2, text: 'A', fontId: 'Helvetica', fontSize: 10, color: '#336699' }],
    }, { Helvetica: 'Helvetica' })
    const outer = importedPathFills(pdf).find(function (p) {
      return typeof p.fill !== 'string' && p.fill?.type === 'tilingPattern'
    })!
    const pattern = outer.fill as TilingPatternDef
    const text = pattern.graphics.find(function (g) { return g.kind === 'text' })
    expect(text).toMatchObject({ kind: 'text', text: 'A', fontSize: 10, color: '#336699' })
  })

  it('preserves image XObjects inside a colored tiling cell', () => {
    const backend = new PdfBackend({ fonts: {}, images: { dot: encodePngRgba(1, 1, new Uint8Array([51, 102, 153, 255])) } })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(RECT_PATH.commands, RECT_PATH.coords, {
      fill: {
        type: 'tiling-pattern', bbox: [0, 0, 8, 8], xStep: 8, yStep: 8, matrix: [1, 0, 0, 1, 0, 0],
        graphics: [{ kind: 'image', x: 1, y: 2, width: 4, height: 5, imageId: 'dot' }],
      },
    })
    backend.endPage()
    backend.endDocument()
    const path = importedPathFills(backend.toUint8Array()).find(function (candidate) {
      return typeof candidate.fill !== 'string' && candidate.fill?.type === 'tilingPattern'
    })!
    const fill = path.fill as TilingPatternDef
    expect(fill.graphics[0]).toMatchObject({ kind: 'image', x: 1, width: 4, height: 5 })
  })

  it('preserves clipped transparency groups inside a tiling cell across preview and PDF output', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const clip = parseSvgPath('M0 0L12 0L12 12L0 12Z')
    const child = parseSvgPath('M0 0L16 0L16 16L0 16Z')
    const pdf = renderPdf({
      type: 'tiling-pattern',
      bbox: [0, 0, 20, 20],
      xStep: 20,
      yStep: 20,
      matrix: [1, 0, 0, 1, 10, 10],
      graphics: [{
        kind: 'group', x: 2, y: 3, width: 16, height: 16,
        clipPath: { commands: clip.commands, coords: clip.coords },
        opacity: 0.5, blendMode: 'multiply', isolated: true, knockout: true,
        optionalContent: { name: 'Tile layer', visible: true, print: true },
        graphics: [{ kind: 'path', commands: child.commands, coords: child.coords, fill: '#336699' }],
      }],
    })
    const path = importedPathFills(pdf).find(function (candidate) {
      return typeof candidate.fill !== 'string' && candidate.fill?.type === 'tilingPattern'
    })!
    const fill = path.fill as TilingPatternDef
    expect(fill.graphics).toHaveLength(1)
    const groups: Array<Extract<(typeof fill.graphics)[number], { kind: 'group' }>> = []
    const collectGroups = function (graphics: typeof fill.graphics): void {
      for (const graphic of graphics) {
        if (graphic.kind === 'group') { groups.push(graphic); collectGroups(graphic.graphics) }
      }
    }
    collectGroups(fill.graphics)
    expect(groups).toContainEqual(expect.objectContaining({
      kind: 'group', opacity: 0.5, blendMode: 'multiply', isolated: true, knockout: true,
    }))
    expect(groups.some(function (group) { return group.clipPath !== undefined })).toBe(true)
    expect(groups.some(function (group) { return group.optionalContent?.name === 'Tile layer' })).toBe(true)
    const output = pdfToText(reemitImportedPdf(pdf))
    expect(output).toContain('/Group << /Type /Group /S /Transparency')
    expect(output).toContain('/I true')
    expect(output).toContain('/K true')
    expect(output).toContain('/BM /Multiply')
    expect(output).toContain('/OCProperties')
  })

  it.each([
    ['/PaintType 3 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>', /PaintType/],
    ['/PaintType 1 /TilingType 4 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>', /TilingType/],
    ['/PaintType 1 /TilingType 1 /BBox [0 0 8] /XStep 8 /YStep 8 /Resources << >>', /BBox/],
    ['/PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 0 /YStep 8 /Resources << >>', /XStep/],
    ['/PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Matrix [1 0 0 1 0] /Resources << >>', /Matrix/],
    ['/PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8', /Resources/],
  ])('rejects malformed tiling pattern dictionaries', (entries, error) => {
    expect(() => PdfImporter.open(buildTilingDictionaryPdf(entries)).importPage(0)).toThrow(error)
  })

  it('normalizes either pair of diagonal corners in a tiling pattern BBox', () => {
    expect(() => PdfImporter.open(buildTilingDictionaryPdf(
      '/PaintType 1 /TilingType 1 /BBox [8 8 0 0] /XStep 8 /YStep 8 /Resources << >>',
    )).importPage(0)).not.toThrow()
  })
})

describe('Coons patch (ShadingType 6) output', () => {
  it('emits a Coons-equivalent patch as ShadingType 6 and round trips', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    // Flat patch: bilinear control net — its interior IS the Coons derivation
    const pdf = renderPdf({
      type: 'mesh-gradient',
      patches: [{ points: flatPatchPoints(30, 10, 10), colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
      triangles: [],
    })
    const text = pdfToText(pdf)
    expect(text).toContain('/ShadingType 6')
    expect(text).not.toContain('/ShadingType 7')
    // Round trip: the importer promotes Coons back to a tensor patch
    const paths = importedPathFills(pdf)
    const mesh = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'meshGradient'
    })
    expect(mesh).toBeDefined()
    const fill = mesh!.fill as MeshGradientDef
    expect(fill.patches!.length).toBe(1)
    expect(fill.patches![0]!.colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff'])
  })

  it('keeps a true tensor patch (non-Coons interior) as ShadingType 7', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const points = flatPatchPoints(30, 10, 10)
    // Displace one interior point (grid index 5 = p11) away from the Coons value
    points[5 * 2] = points[5 * 2]! + 8
    points[5 * 2 + 1] = points[5 * 2 + 1]! - 8
    const pdf = renderPdf({
      type: 'mesh-gradient',
      patches: [{ points, colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'] }],
      triangles: [],
    })
    const text = pdfToText(pdf)
    expect(text).toContain('/ShadingType 7')
    expect(text).not.toContain('/ShadingType 6')
  })
})

describe('lattice mesh (ShadingType 5) round trip', () => {
  it('emits a lattice as ShadingType 5 and re-imports the grid intact', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    // 3 columns x 2 rows lattice covering the 30x30 rect at (10,10)
    const pdf = renderPdf({
      type: 'mesh-gradient',
      patches: [],
      triangles: [],
      lattice: {
        columns: 3,
        points: [10, 10, 25, 10, 40, 10, 10, 40, 25, 40, 40, 40],
        colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'],
      },
    })
    const text = pdfToText(pdf)
    expect(text).toContain('/ShadingType 5')
    expect(text).toContain('/VerticesPerRow 3')
    expect(text).not.toContain('/BitsPerFlag')

    const paths = importedPathFills(pdf)
    const mesh = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'meshGradient'
    })
    expect(mesh).toBeDefined()
    const fill = mesh!.fill as MeshGradientDef
    expect(fill.lattice).toBeDefined()
    expect(fill.lattice!.columns).toBe(3)
    expect(fill.lattice!.colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'])
    // Element-local grid geometry survives (element at 10,10)
    const pts = fill.lattice!.points
    expect(pts[0]! + mesh!.x).toBeCloseTo(10, 2)
    expect(pts[1]! + mesh!.y).toBeCloseTo(10, 2)
    expect(pts[10]! + mesh!.x).toBeCloseTo(40, 2)
    expect(pts[11]! + mesh!.y).toBeCloseTo(40, 2)
  })

  it('tessellates a lattice for the display backends', async () => {
    const { tessellateMeshGradient } = await import('../../src/renderer/complex-paint.js')
    const triangles = tessellateMeshGradient({
      type: 'mesh-gradient',
      patches: [],
      triangles: [],
      lattice: {
        columns: 2,
        points: [0, 0, 30, 0, 0, 30, 30, 30],
        colors: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
      },
    })
    // One cell -> two Gouraud triangles -> further tessellation produces many
    expect(triangles.length).toBeGreaterThan(1)
  })
})

describe('function-based shading (ShadingType 1)', () => {
  const EXPR = '{ pop dup 1 exch sub 0 }' // x y -> r=x g=1-x b=0

  it('emits a native ShadingType 1 with the Type 4 expression and round trips', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const pdf = renderPdf({
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [30, 0, 0, 30, 10, 10],
      expression: EXPR,
    })
    const text = pdfToText(pdf)
    expect(text).toContain('/ShadingType 1')
    expect(text).toContain('/FunctionType 4')
    expect(text).toContain('pop dup 1 exch sub 0')

    const paths = importedPathFills(pdf)
    const shaded = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'functionShading'
    })
    expect(shaded).toBeDefined()
    const fill = shaded!.fill as import('../../src/types/template.js').FunctionShadingDef
    expect(fill.expression.trim()).toBe(EXPR)
    expect(fill.domain).toEqual([0, 1, 0, 1])
    // Element-local matrix: element at (10,10) so translation returns to origin
    expect(fill.matrix![4]).toBeCloseTo(0, 2)
    expect(fill.matrix![5]).toBeCloseTo(0, 2)
    expect(fill.matrix![0]).toBeCloseTo(30, 2)
  })

  it('emits Shading dictionary Background, BBox, and AntiAlias hints', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const pdf = renderPdf({
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [30, 0, 0, 30, 10, 10],
      background: [0.1, 0.2, 0.3],
      bbox: [0, 0, 1, 1],
      antiAlias: true,
      expression: EXPR,
    })
    const text = pdfToText(pdf)

    expect(text).toContain('/ShadingType 1')
    expect(text).toContain('/Background [0.1 0.2 0.3]')
    expect(text).toContain('/BBox [0 0 1 1]')
    expect(text).toContain('/AntiAlias true')
  })

  it('can paint a function shading with the direct sh operator under the path clip', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const pdf = renderPdf({
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [30, 0, 0, 30, 10, 10],
      paintOperator: 'sh',
      expression: EXPR,
    })
    const text = pdfToText(pdf)

    expect(text).toContain('/ShadingType 1')
    expect(text).toMatch(/W n\n\/Sh\d+ sh/)
    expect(text).not.toContain('/PatternType 2')
    expect(text).not.toContain('/Pattern cs')

    const paths = importedPathFills(pdf)
    const shaded = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'functionShading'
    })
    expect(shaded).toBeDefined()
  })

  it('emits a native ShadingType 1 with a sampled FunctionType 0 and re-imports it', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const pdf = renderPdf({
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [30, 0, 0, 30, 10, 10],
      sampled: {
        size: [2, 2],
        bitsPerSample: 8,
        range: [0, 1, 0, 1, 0, 1],
        samples: [
          1, 0, 0,
          0, 1, 0,
          0, 0, 1,
          1, 1, 1,
        ],
      },
    })
    const text = pdfToText(pdf)
    expect(text).toContain('/ShadingType 1')
    expect(text).toContain('/FunctionType 0')
    expect(text).toContain('/Size [2 2]')
    expect(text).toContain('/BitsPerSample 8')
    expect(text).not.toContain('/FunctionType 4')

    const paths = importedPathFills(pdf)
    const mesh = paths.find(function (p) {
      return typeof p.fill !== 'string' && p.fill !== undefined && p.fill.type === 'meshGradient'
    })
    expect(mesh).toBeDefined()
    const fill = mesh!.fill as MeshGradientDef
    expect(fill.patches!.length).toBeGreaterThan(1)
    expect(fill.patches!.some(function (p) { return p.colors.includes('#ff0000') })).toBe(true)
    expect(fill.patches!.some(function (p) { return p.colors.includes('#ffffff') })).toBe(true)
    const retained = pdfToText(reemitImportedPdf(pdf))
    expect(retained).toContain('/ShadingType 1')
    expect(retained).toContain('/FunctionType 0')
    expect(retained).toContain('/Size [2 2]')
    expect(retained).toContain('/BitsPerSample 8')
  })

  it('retains multiple Type 1 functions, color space, domain, and matrix through re-output', async () => {
    const { pdfToText } = await import('../renderer/pdf-test-utils.js')
    const source = buildMultipleFunctionType1Pdf()
    const fill = importedMeshFill(source)
    expect(fill.patches!.length).toBeGreaterThan(1)
    expect(fill.pdfShading?.nativeFunction).toMatchObject({
      domain: [2, 4, 6, 8],
      matrix: [2, 0, 0, 3, 5, 7],
      colorSpace: { kind: 'rgb' },
      paintOperator: 'pattern',
    })
    expect(fill.pdfShading?.nativeFunction?.functions).toHaveLength(3)
    const text = pdfToText(reemitImportedPdf(source))
    expect(text).toContain('/ShadingType 1')
    expect(text).toContain('/Domain [2 4 6 8]')
    expect(text).toContain('/Matrix [2 0 0 3 5 7]')
    expect(text).toContain('/Function [')
    expect(text.match(/\/FunctionType 4/g)).toHaveLength(3)
  })

  it('normalizes either pair of diagonal corners in a shading BBox', () => {
    const forward = importedMeshFill(buildMultipleFunctionType1Pdf('[2 6 4 8]'))
    const reversed = importedMeshFill(buildMultipleFunctionType1Pdf('[4 8 2 6]'))
    expect(reversed.pdfShading?.bbox).toEqual(forward.pdfShading?.bbox)
    expect(reversed.pdfShading?.nativeFunction?.bbox).toEqual(forward.pdfShading?.nativeFunction?.bbox)
  })

  it('tessellates via the same calculator expression for display backends', async () => {
    const { tessellateFunctionShading } = await import('../../src/renderer/complex-paint.js')
    const triangles = tessellateFunctionShading({
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [30, 0, 0, 30, 0, 0],
      expression: EXPR,
    })
    expect(triangles.length).toBeGreaterThan(100)
    // Left edge (x=0) is green #00ff00, right edge (x=1) is red #ff0000
    const nearLeft = triangles.find(t => t.points[0] < 2)!
    const nearRight = triangles.find(t => t.points[0] > 28)!
    expect(parseInt(nearLeft.color.slice(3, 5), 16)).toBeGreaterThan(200)  // green channel
    expect(parseInt(nearRight.color.slice(1, 3), 16)).toBeGreaterThan(200) // red channel
  })

  it('tessellates sampled functions for display backends', async () => {
    const { tessellateFunctionShading } = await import('../../src/renderer/complex-paint.js')
    const triangles = tessellateFunctionShading({
      type: 'function-shading',
      domain: [0, 1, 0, 1],
      matrix: [30, 0, 0, 30, 0, 0],
      sampled: {
        size: [2, 2],
        bitsPerSample: 8,
        range: [0, 1, 0, 1, 0, 1],
        samples: [
          1, 0, 0,
          0, 1, 0,
          0, 0, 1,
          1, 1, 1,
        ],
      },
    })
    expect(triangles.length).toBeGreaterThan(100)
    expect(triangles.some(t => parseInt(t.color.slice(1, 3), 16) > 200)).toBe(true)
    expect(triangles.some(t =>
      parseInt(t.color.slice(1, 3), 16) > 200
      && parseInt(t.color.slice(3, 5), 16) > 200
      && parseInt(t.color.slice(5, 7), 16) > 200,
    )).toBe(true)
  })
})

function importedMeshFill(pdf: Uint8Array): MeshGradientDef {
  return findMeshPath(PdfImporter.open(pdf).importPage(0).elements).fill as MeshGradientDef
}

function findMeshPath(elements: ReturnType<PdfImporter['importPage']>['elements']): PathDef {
  const result = findMeshPathOrNull(elements)
  if (result === null) throw new Error('mesh path not found')
  return result
}

function findMeshPathOrNull(elements: ReturnType<PdfImporter['importPage']>['elements']): PathDef | null {
  for (const element of elements) {
    if (element.type === 'path' && typeof element.fill !== 'string' && element.fill?.type === 'meshGradient') return element
    if (element.type === 'frame' && element.elements !== undefined) {
      const nested = findMeshPathOrNull(element.elements)
      if (nested !== null) return nested
    }
  }
  return null
}

function buildPackedMeshPdf(
  shadingType: 4 | 5 | 6 | 7,
  bitsPerCoordinate: number,
  bitsPerComponent: number,
  bitsPerFlag = 8,
  withFunctions = false,
  corruption?: 'truncate' | 'nonzero-padding',
): Uint8Array {
  const maxCoordinate = 2 ** bitsPerCoordinate - 1
  const maxComponent = 2 ** bitsPerComponent - 1
  const values: Array<{ value: number, bits: number }> = []
  const point = function (x: number, y: number): void {
    values.push({ value: x, bits: bitsPerCoordinate }, { value: y, bits: bitsPerCoordinate })
  }
  const color = function (components: number[]): void {
    for (let i = 0; i < components.length; i++) values.push({ value: components[i]!, bits: bitsPerComponent })
  }
  const colors = withFunctions
    ? [[0], [maxComponent], [Math.round(maxComponent / 2)], [Math.round(maxComponent / 4)]]
    : [[maxComponent, 0, 0], [0, maxComponent, 0], [0, 0, maxComponent], [maxComponent, maxComponent, maxComponent]]
  if (shadingType === 5) {
    const points = [[0, 0], [maxCoordinate, 0], [0, maxCoordinate], [maxCoordinate, maxCoordinate]]
    for (let i = 0; i < points.length; i++) { point(points[i]![0]!, points[i]![1]!); color(colors[i]!) }
  } else if (shadingType === 4) {
    const points = [[0, 0], [maxCoordinate, 0], [0, maxCoordinate]]
    for (let i = 0; i < 3; i++) {
      values.push({ value: 0, bits: bitsPerFlag })
      point(points[i]![0]!, points[i]![1]!)
      color(colors[i]!)
    }
  } else {
    values.push({ value: 0, bits: bitsPerFlag })
    const pointCount = shadingType === 6 ? 12 : 16
    for (let i = 0; i < pointCount; i++) point(i % 3 === 0 ? maxCoordinate : 0, i % 3 === 1 ? maxCoordinate : 0)
    for (let i = 0; i < 4; i++) color(colors[i]!)
  }
  let data = packBits(values)
  if (corruption === 'truncate') data = data.slice(0, data.length - 1)
  if (corruption === 'nonzero-padding') data[data.length - 1] |= 1
  const stream = binaryString(data)
  const pageContent = withFunctions ? '/Pattern cs /P scn 0 0 20 20 re f\n' : '/Sh sh\n'
  const componentPairs = withFunctions ? '0 1' : '0 1 0 1 0 1'
  const typeEntries = shadingType === 5 ? '/VerticesPerRow 2' : `/BitsPerFlag ${bitsPerFlag}`
  const functionEntry = withFunctions ? '/Function [6 0 R 7 0 R 8 0 R]' : ''
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << ${withFunctions ? '/Pattern << /P 9 0 R >>' : '/Shading << /Sh 5 0 R >>'} >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
    `5 0 obj\n<< /ShadingType ${shadingType} /ColorSpace /DeviceRGB /BitsPerCoordinate ${bitsPerCoordinate} /BitsPerComponent ${bitsPerComponent} ${typeEntries} /Decode [0 20 0 20 ${componentPairs}] ${functionEntry} /Background [0.1 0.2 0.3] /BBox [0 0 20 20] /AntiAlias true /Length ${data.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ]
  if (withFunctions) {
    for (let i = 0; i < 3; i++) objects.push(`${6 + i} 0 obj\n<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 1 >>\nendobj\n`)
    objects.push('9 0 obj\n<< /Type /Pattern /PatternType 2 /Shading 5 0 R >>\nendobj\n')
  }
  return pdfObjects(objects)
}

function buildMultipleFunctionType1Pdf(bbox = '[2 6 4 8]'): Uint8Array {
  const content = '/Pattern cs /P scn 0 0 40 40 re f\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 9 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    `5 0 obj\n<< /ShadingType 1 /ColorSpace /DeviceRGB /Domain [2 4 6 8] /Matrix [2 0 0 3 5 7] /Function [6 0 R 7 0 R 8 0 R] /BBox ${bbox} /AntiAlias true >>\nendobj\n`,
    '6 0 obj\n<< /FunctionType 4 /Domain [2 4 6 8] /Range [0 1] /Length 15 >>\nstream\n{ pop pop 0.2 }\nendstream\nendobj\n',
    '7 0 obj\n<< /FunctionType 4 /Domain [2 4 6 8] /Range [0 1] /Length 15 >>\nstream\n{ pop pop 0.4 }\nendstream\nendobj\n',
    '8 0 obj\n<< /FunctionType 4 /Domain [2 4 6 8] /Range [0 1] /Length 15 >>\nstream\n{ pop pop 0.6 }\nendstream\nendobj\n',
    '9 0 obj\n<< /Type /Pattern /PatternType 2 /Shading 5 0 R >>\nendobj\n',
  ]
  return pdfObjects(objects)
}

function buildTilingDictionaryPdf(entries: string): Uint8Array {
  const pageContent = '/Pattern cs /P scn 0 0 20 20 re f\n'
  const cellContent = '0 0 8 8 re f\n'
  return pdfObjects([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Pattern /PatternType 1 ${entries} /Length ${cellContent.length} >>\nstream\n${cellContent}endstream\nendobj\n`,
  ])
}

function packBits(values: Array<{ value: number, bits: number }>): Uint8Array {
  let bitLength = 0
  for (let i = 0; i < values.length; i++) bitLength += values[i]!.bits
  const out = new Uint8Array(Math.ceil(bitLength / 8))
  let bit = 0
  for (let i = 0; i < values.length; i++) {
    const entry = values[i]!
    for (let shift = entry.bits - 1; shift >= 0; shift--) {
      const divisor = 2 ** shift
      if (Math.floor(entry.value / divisor) % 2 !== 0) out[bit >> 3] |= 1 << (7 - (bit & 7))
      bit++
    }
  }
  return out
}

function pdfObjects(objects: string[]): Uint8Array {
  const header = '%PDF-1.7\n'
  let body = ''
  let offset = header.length
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(offset); body += objects[i]!; offset += objects[i]!.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  return latin1(`${header}${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
}

function latin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 255
  return out
}

function binaryString(value: Uint8Array): string {
  let out = ''
  for (let i = 0; i < value.length; i++) out += String.fromCharCode(value[i]!)
  return out
}
