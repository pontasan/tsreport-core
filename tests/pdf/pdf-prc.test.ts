import { describe, expect, it } from 'vitest'
import { decodePrcScene } from '../../src/pdf/pdf-prc.js'
import { renderPdf3DPoster } from '../../src/pdf/pdf-3d.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { buildBackgroundPrcFixture, buildCameraPrcFixture, buildClippedPrcFixture, buildCompressedPrcFixture, buildFilteredPrcFixture, buildLinkedMarkupPrcFixture, buildLitPrcFixture, buildMarkupPrcFixture, buildPrcFixture, buildStyledMarkupPrcFixture, buildStyledPrcFixture, buildTextPictureMarkupPrcFixture, buildTexturedPrcFixture, buildTransformedPrcFixture } from '../helpers/prc-fixture.js'

describe('ISO 14739-1 PRC scene integration', function () {
  it('decodes non-compressed face tessellation into renderable triangles', function () {
    const scene = decodePrcScene(buildPrcFixture())
    expect(scene).toMatchObject({ format: 'PRC', minimalVersion: 8137, authoringVersion: 8137, unitsInMeters: 0.001 })
    expect(scene.primitives).toEqual([{
      kind: 'triangles', name: 'PRC tessellation 0',
      positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2],
    }])
    expect(scene.bounds).toEqual({ minimum: [0, 0, 0], maximum: [1, 1, 0] })
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain(' h B')
  })

  it('connects PRC decoding to generation, import, and scene poster appearance', function () {
    const data = buildPrcFixture()
    const backend = new PdfBackend({
      fonts: {},
      annotations: [{ subtype: '3D', pageIndex: 0, x: 10, y: 10, width: 100, height: 80, format: 'PRC', data, poster: 'scene' }],
    })
    backend.beginDocument(); backend.beginPage(140, 110); backend.endPage(); backend.endDocument()
    const imported = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)[0]!.threeDimensional!
    expect(imported.format).toBe('PRC')
    expect(imported.scene.primitives[0]).toMatchObject({ kind: 'triangles', indices: [0, 1, 2] })
  })

  it('decodes highly compressed topology, Huffman arrays, and vertex colors', function () {
    const scene = decodePrcScene(buildCompressedPrcFixture())
    expect(scene.primitives).toEqual([{
      kind: 'triangles', name: 'PRC compressed tessellation 0',
      positions: [[0, 0, 0], [1, 0, 0], [0.5, 1, 0]], indices: [0, 1, 2],
      colors: [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]],
    }])
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain('1 0 0 rg')
  })

  it('applies product-occurrence and representation-item coordinate systems', function () {
    const scene = decodePrcScene(buildTransformedPrcFixture())
    expect(scene.nodes).toEqual([
      {
        kind: 'group', name: 'PRC 0 occurrence 0 Root', sourceBlockOffset: 0,
        parents: [{ name: '', matrix: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
      },
      {
        kind: 'model', name: 'PRC 0 model 1 Triangle', sourceBlockOffset: 0,
        parents: [{ name: 'PRC 0 occurrence 0 Root', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1] }],
        resourceName: 'PRC tessellation 0', visibility: 3,
      },
    ])
    expect(scene.bounds).toEqual({ minimum: [-1, 1, 0], maximum: [0, 2, 0] })
    expect(renderPdf3DPoster(scene, 100, 80).content).not.toBe(renderPdf3DPoster(decodePrcScene(buildPrcFixture()), 100, 80).content)
  })

  it('resolves global style color and transparency into the poster', function () {
    const scene = decodePrcScene(buildStyledPrcFixture())
    expect(scene.nodes[1]).toMatchObject({ kind: 'model', color: [1, 0, 0, 128 / 255] })
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain('0.985 0.483 0.483 rg')
  })

  it('renders geometric markup tessellations', function () {
    const scene = decodePrcScene(buildMarkupPrcFixture())
    expect(scene.primitives).toEqual([{
      kind: 'triangles', name: 'PRC markup 0 faces 0',
      positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2],
    }])
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain(' h B')
  })

  it('connects part markups to their tessellations in an assembly scene', function () {
    const scene = decodePrcScene(buildLinkedMarkupPrcFixture())
    expect(scene.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'model', resourceName: 'PRC markup 0 faces 0', visibility: 3 }),
    ]))
    expect(scene.bounds).toEqual({ minimum: [0, 0, 0], maximum: [1, 1, 0] })
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain(' h B')
  })

  it('applies markup color and line-width rendering state', function () {
    const scene = decodePrcScene(buildStyledMarkupPrcFixture())
    expect(scene.primitives).toEqual([{
      kind: 'lines', name: 'PRC markup 0 polyline 0', positions: [[0, 0, 0], [1, 0, 0]], indices: [0, 1],
      colors: [[1, 0, 0, 1], [1, 0, 0, 1]], lineWidth: 1,
    }])
    const poster = renderPdf3DPoster(scene, 100, 80).content
    expect(poster).toContain('1 0 0 RG')
    expect(poster).toContain('1 w')
  })

  it('applies the active PRC entity filter to scene visibility and poster output', function () {
    const scene = decodePrcScene(buildFilteredPrcFixture())
    expect(scene.nodes.map(function (node) { return node.kind })).toEqual(['group'])
    expect(scene.bounds).toBeNull()
    expect(renderPdf3DPoster(scene, 100, 80).content).not.toContain(' h B')
  })

  it('connects active PRC scene-display camera parameters to poster projection', function () {
    const scene = decodePrcScene(buildCameraPrcFixture())
    expect(scene.nodes.some(function (node) { return node.kind === 'view' && node.projection === 'orthographic' })).toBe(true)
    expect(renderPdf3DPoster(scene, 100, 80).content).not.toBe(renderPdf3DPoster(decodePrcScene(buildTransformedPrcFixture()), 100, 80).content)
  })

  it('applies the active PRC scene background style to the poster', function () {
    const scene = decodePrcScene(buildBackgroundPrcFixture())
    expect(scene.backgroundColor).toEqual([1, 0, 0])
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain('1 0 0 rg\n0 0 100 80 re f')
  })

  it('resolves PRC material textures and UV coordinates into rasterized poster pixels', function () {
    const scene = decodePrcScene(buildTexturedPrcFixture())
    expect(scene.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'model', renderPasses: expect.any(Array) })]))
    expect(scene.primitives[0]).toMatchObject({ kind: 'triangles', faceTextureCoordinates: [[[[0, 0, 0, 1], [1, 0, 0, 1], [0, 1, 0, 1]]]] })
    const poster = renderPdf3DPoster(scene, 40, 40).content
    expect(poster).toContain('/F /AHx')
    expect(poster).toContain('FF0000')
  })

  it('connects active PRC lights to generic material shading', function () {
    const scene = decodePrcScene(buildLitPrcFixture())
    expect(scene.lights).toEqual([expect.objectContaining({ type: 'ambient', ambientColor: [1, 0, 0] })])
    expect(renderPdf3DPoster(scene, 40, 40).content).toContain('FF0000')
  })

  it('clips PRC poster geometry against active scene planes', function () {
    const scene = decodePrcScene(buildClippedPrcFixture())
    expect(scene.clippingPlanes).toEqual([{ point: [0, 0, 0], normal: [-1, 0, 0] }])
    const poster = renderPdf3DPoster(scene, 40, 40).content
    expect(poster).toContain('/F /AHx')
    expect(poster).not.toContain(' h B')
  })

  it('renders PRC text and embedded-picture markup resources', function () {
    const scene = decodePrcScene(buildTextPictureMarkupPrcFixture())
    expect(scene.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'text', text: 'Hi', fontFamily: 'Helvetica' }),
      expect.objectContaining({ kind: 'triangles', name: expect.stringContaining('picture') }),
    ]))
    const poster = renderPdf3DPoster(scene, 80, 80)
    expect(poster.content).toContain('<4869> Tj')
    expect(poster.content).toContain('00FF00')
    expect(poster.resources).toContain('/BaseFont /Helvetica-Bold')
  })
})
