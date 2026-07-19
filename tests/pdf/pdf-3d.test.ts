import { describe, expect, it } from 'vitest'
import { decodeU3dScene, measurePdf3DScene, renderPdf3DPoster } from '../../src/pdf/pdf-3d.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { PdfStream, parsePdf } from '../../src/pdf/pdf-parser.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { buildColoredPointU3dFixture, buildLitU3dFixture, buildPointLineU3dFixture, buildProgressiveU3dFixture, buildStyledU3dFixture, buildTexturedU3dFixture, buildU3dFixture, buildU3dFixtureWithoutView } from '../helpers/u3d-fixture.js'

describe('ECMA-363 U3D scene integration', function () {
  it('decodes block framing, nodes, views, bounds, metadata units, and measurements', function () {
    const scene = decodeU3dScene(buildU3dFixture())
    expect(scene.header).toMatchObject({ majorVersion: 0, minorVersion: 1, profile: 12, characterEncoding: 106, unitsInMeters: 0.001 })
    expect(scene.nodes.map(function (node) { return node.kind })).toEqual(['group', 'model', 'view'])
    expect(scene.nodes[2]).toMatchObject({
      kind: 'view', name: 'Camera', resourceName: 'DefaultView', projection: 'orthographic',
      farClip: 1000, viewport: [640, 480, 0, 0],
    })
    expect((scene.nodes[2] as { nearClip: number }).nearClip).toBeCloseTo(0.1)
    expect(scene.primitives).toEqual([{
      kind: 'triangles', name: 'Mesh',
      positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2],
      colors: [[0.20000000298023224, 0.6000000238418579, 0.800000011920929, 1], [0.20000000298023224, 0.6000000238418579, 0.800000011920929, 1], [0.20000000298023224, 0.6000000238418579, 0.800000011920929, 1]],
    }])
    expect(scene.bounds).toEqual({ minimum: [-2, -1, -3], maximum: [4, 5, 6] })
    expect(measurePdf3DScene(scene, [0, 0, 0], [3, 4, 0])).toEqual({ sourceUnits: 5, metres: 0.005 })
  })

  it('renders decoded and transformed geometry in the deterministic inactive poster', function () {
    const poster = renderPdf3DPoster(decodeU3dScene(buildU3dFixture()), 120, 80)
    expect(poster.width).toBe(120)
    expect(poster.height).toBe(80)
    expect(poster.content).toContain('0 0 120 80 re f')
    expect(poster.content).toContain(' h B')
    expect(poster.content).toContain('0.2 0.6 0.8 rg')
    expect(poster.content).not.toBe(renderPdf3DPoster(decodeU3dScene(buildU3dFixtureWithoutView()), 120, 80).content)
  })

  it('applies progressive mesh resolution updates to final geometry', function () {
    const scene = decodeU3dScene(buildProgressiveU3dFixture())
    expect(scene.primitives).toHaveLength(1)
    const primitive = scene.primitives[0]!
    expect(primitive.kind).toBe('triangles')
    expect(primitive.positions).toHaveLength(6)
    expect(primitive.positions).toContainEqual([0, 0, 1])
    expect(primitive.indices).toEqual([0, 1, 2, 3, 4, 5])
    expect(renderPdf3DPoster(scene, 120, 80).content.match(/ h B/g)).toHaveLength(2)
  })

  it('decodes point and line generator continuations into poster primitives', function () {
    const scene = decodeU3dScene(buildPointLineU3dFixture())
    expect(scene.primitives).toEqual([
      { kind: 'points', name: 'Points', positions: [[1, 2, 0]] },
      { kind: 'lines', name: 'Lines', positions: [[0, 0, 0], [1, 0, 0]], indices: [0, 1] },
    ])
    const poster = renderPdf3DPoster(scene, 100, 100).content
    expect(poster).toContain(' re f')
    expect(poster).toContain(' l S')
  })

  it('connects shading modifiers, shaders, materials, and opacity to poster colors', function () {
    const scene = decodeU3dScene(buildStyledU3dFixture())
    const primitive = scene.primitives[0]!
    expect(primitive.kind).toBe('triangles')
    expect(primitive.colors).toEqual([[1, 0, 0, 0.5], [1, 0, 0, 0.5], [1, 0, 0, 0.5]])
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain('0.985 0.485 0.485 rg')
  })

  it('applies transformed U3D light resources to lit surface normals', function () {
    const scene = decodeU3dScene(buildLitU3dFixture())
    expect(scene.lights).toEqual([expect.objectContaining({ type: 'ambient', enabled: true, nodeName: 'Ambient light node' })])
    const primitive = scene.primitives[0]!
    expect(primitive.kind).toBe('triangles')
    expect(primitive.normals).toEqual([[0, 0, 1], [0, 0, 1], [0, 0, 1]])
    expect(renderPdf3DPoster(scene, 100, 80).content).toContain('0.25 0 0 rg')
  })

  it('decodes and samples embedded U3D texture resources in the poster', function () {
    const scene = decodeU3dScene(buildTexturedU3dFixture())
    const primitive = scene.primitives[0]!
    expect(primitive.kind).toBe('triangles')
    expect(primitive.faceRenderPasses?.[0]?.[0]?.layers[0]?.image).toMatchObject({ width: 2, height: 2 })
    const poster = renderPdf3DPoster(scene, 100, 80).content
    expect(poster).toContain('BI /W 100 /H 80 /CS /RGB /BPC 8 /F /AHx ID')
    expect(poster).not.toContain(' h B')
  })

  it('reconstructs compressed point colors and applies them to the poster', function () {
    const scene = decodeU3dScene(buildColoredPointU3dFixture())
    expect(scene.primitives).toEqual([{ kind: 'points', name: 'ColoredPoints', positions: [[1, 2, 0]], colors: [[1, 0, 0, 1]] }])
    expect(renderPdf3DPoster(scene, 80, 80).content).toContain('1 0 0 rg')
  })

  it('connects U3D decoding to PDF generation, import, and the normal appearance', function () {
    const data = buildU3dFixture()
    const backend = new PdfBackend({
      fonts: {},
      annotations: [{
        subtype: '3D', pageIndex: 0, x: 10, y: 10, width: 100, height: 80,
        format: 'U3D', data, viewName: 'Default view', activateOnPageOpen: true, poster: 'scene',
      }],
    })
    backend.beginDocument()
    backend.beginPage(150, 120)
    backend.endPage()
    backend.endDocument()
    const pdf = backend.toUint8Array()

    const imported = PdfImporter.open(pdf).importAnnotations(0)[0]!
    expect(imported.threeDimensional).toMatchObject({ format: 'U3D', viewName: 'Default view', activateOnPageOpen: true })
    expect(imported.threeDimensional!.data).toEqual(data)
    expect(imported.threeDimensional!.scene!.bounds).toEqual({ minimum: [-2, -1, -3], maximum: [4, 5, 6] })

    const document = parsePdf(pdf)
    const page = collectPdfPages(document)[0]!
    const annotations = document.resolve(page.dict.get('Annots') ?? null) as unknown[]
    const annotation = document.resolve(annotations[0] as never) as Map<string, unknown>
    const appearance = document.resolve((annotation.get('AP') as Map<string, unknown>).get('N') as never)
    expect(appearance).toBeInstanceOf(PdfStream)
    expect(new TextDecoder().decode(document.decodeStream(appearance as PdfStream))).toContain('0 0 100 80 re f')
  })

  it('rejects malformed size, padding, and encoding', function () {
    const wrongSize = buildU3dFixture()
    wrongSize[24] = 0
    expect(function () { decodeU3dScene(wrongSize) }).toThrow(/File Size/)

    const wrongEncoding = buildU3dFixture()
    wrongEncoding[32] = 0
    expect(function () { decodeU3dScene(wrongEncoding) }).toThrow(/UTF-8/)

    const wrongPadding = buildU3dFixture()
    wrongPadding[94] = 1
    expect(function () { decodeU3dScene(wrongPadding) }).toThrow(/padding/)
  })
})
