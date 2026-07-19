// Transparency groups + soft masks (A6.2/A6.3).
// A group that is isolated/knockout or carries a soft mask is composited into a
// /Group Form XObject and drawn under an ExtGState (/ca for opacity, /SMask for
// the mask), so overlapping children composite as a unit. Preview backends
// (SVG <mask>/<g opacity>, Canvas offscreen layers) reproduce the same result.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter, SvgBackend, CanvasBackend, render } from '../../src/index.js'
import type { RenderDocument, RenderNode, RenderGroup } from '../../src/types/render.js'
import type { PdfFunctionDef } from '../../src/types/template.js'
import { evaluateTransferFunctionDef } from '../../src/pdf/pdf-function.js'
import { pdfToText } from './pdf-test-utils.js'

function docWith(child: RenderNode): RenderDocument {
  return { pages: [{ width: 120, height: 120, children: [child] }] }
}

function isolatedGroup(overrides: Partial<RenderGroup> = {}): RenderGroup {
  return {
    type: 'group', x: 10, y: 10, width: 80, height: 80,
    isolated: true,
    children: [
      { type: 'rect', x: 0, y: 0, width: 60, height: 60, fill: '#ff0000' },
      { type: 'rect', x: 20, y: 20, width: 60, height: 60, fill: '#0000ff' },
    ],
    ...overrides,
  }
}

function luminositySoftMaskGroup(): RenderGroup {
  return {
    type: 'group', x: 10, y: 10, width: 80, height: 80,
    isolated: true,
    opacity: 1,
    softMask: {
      type: 'luminosity',
      content: [{ type: 'rect', x: 0, y: 0, width: 80, height: 40, fill: '#ffffff' }],
    },
    children: [{ type: 'rect', x: 0, y: 0, width: 80, height: 80, fill: '#00aa00' }],
  }
}

function renderPdf(child: RenderNode): string {
  const backend = new PdfBackend({ fonts: {} })
  render(docWith(child), backend)
  return pdfToText(backend.toUint8Array())
}

describe('PDF transparency group output (A6.2)', () => {
  it('connects a RenderPage transparency group through output and import', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({
      pages: [{
        width: 120,
        height: 120,
        transparencyGroup: { colorSpace: { kind: 'cmyk' }, isolated: true, knockout: true },
        children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: 'cmyk(100,0,0,0)' }],
      }],
    }, backend)
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceCMYK /I true /K true >>')
    expect(PdfImporter.open(bytes).importPageProperties(0).transparencyGroup).toEqual({
      colorSpace: { kind: 'cmyk' }, isolated: true, knockout: true,
    })
  })

  it('emits a /Group /S /Transparency Form XObject invoked with Do', () => {
    const text = renderPdf(isolatedGroup())
    expect(text).toContain('/Subtype /Form')
    expect(text).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceRGB /I true /K false >>')
    expect(text).toMatch(/\/Tp0 Do/)
    // The transparency form is listed in the page XObject resources.
    expect(text).toMatch(/\/XObject <<[^>]*\/Tp0 /)
  })

  it('applies group opacity once via an ExtGState /ca on the Do, not per child', () => {
    const text = renderPdf(isolatedGroup({ opacity: 0.4 }))
    expect(text).toContain('/ca 0.4 /CA 0.4')
    expect(text).toMatch(/q \/GS\d+ gs \/Tp0 Do Q/)
  })

  it('marks knockout groups with /K true', () => {
    const text = renderPdf(isolatedGroup({ knockout: true }))
    expect(text).toContain('/K true')
  })

  it('preserves a non-isolated, non-knockout transparency-group boundary', () => {
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(isolatedGroup({ transparencyGroup: true, isolated: false, knockout: false })), backend)
    const bytes = backend.toUint8Array()
    expect(pdfToText(bytes)).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceRGB /I false /K false >>')
    const frame = findFrame(PdfImporter.open(bytes).importPage(0).elements)
    expect(frame).toMatchObject({ transparencyGroup: true })
  })

  it('reuses one Form XObject for a group without opacity or mask', () => {
    const text = renderPdf(isolatedGroup())
    // No ExtGState gs is needed when there is no opacity/mask.
    expect(text).toMatch(/q \/Tp0 Do Q/)
  })
})

describe('PDF soft mask output (A6.3)', () => {
  it('keeps a soft mask aligned inside a retained Form placed by an affine transform', () => {
    const child = luminositySoftMaskGroup()
    child.x = 0
    child.y = 0
    child.width = 20
    child.height = 10
    child.softMask!.content = [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' }]
    child.children = [{ type: 'rect', x: 0, y: 0, width: 20, height: 10, fill: '#00aa00' }]
    const form: RenderGroup = {
      type: 'group', x: 0, y: 0, width: 20, height: 10,
      affineTransform: [1, 0, 0, 1, 20, 30],
      pdfForm: {
        bbox: [100, 300, 120, 310],
        matrix: [1, 0, 0, 1, 0, 0],
        invocationMatrix: [1, 0, 0, 1, 0, 0],
      },
      children: [child],
    }
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(form), backend)
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('1 0 0 1 20 30 cm')
    expect(text).toMatch(/1 0 0 -1 -100 310 cm \/Fx0 Do/)
    const imported = PdfImporter.open(bytes).importPage(0)
    const retained = findPdfForm(imported.elements)
    expect(retained?.affineTransform).toEqual([1, 0, 0, 1, 20, 30])
    expect(findFrameWithSoftMask(retained?.elements ?? [])).not.toBeNull()
  })

  it('emits a luminosity /SMask ExtGState referencing a mask Form XObject', () => {
    const text = renderPdf(luminositySoftMaskGroup())
    expect(text).toMatch(/\/SMask << \/Type \/Mask \/S \/Luminosity \/G \d+ 0 R >>/)
    // Two transparency groups: the content group and the mask group.
    expect(text).toContain('/Tp0')
    expect(text).toContain('/Tp1')
    const groups = text.match(/\/S \/Transparency/g) ?? []
    expect(groups.length).toBeGreaterThanOrEqual(2)
  })

  it('emits an alpha soft mask with /S /Alpha', () => {
    const g = luminositySoftMaskGroup()
    g.softMask!.type = 'alpha'
    const text = renderPdf(g)
    expect(text).toMatch(/\/SMask << \/Type \/Mask \/S \/Alpha \/G \d+ 0 R >>/)
  })

  it('emits a /BC backdrop for a luminosity mask', () => {
    const g = luminositySoftMaskGroup()
    g.softMask!.backdrop = [0.5, 0.25, 0]
    const text = renderPdf(g)
    expect(text).toMatch(/\/SMask << \/Type \/Mask \/S \/Luminosity \/G \d+ 0 R \/BC \[0\.5 0\.25 0\] >>/)
  })

  it('preserves soft-mask transparency-group color space and group flags', () => {
    const group = luminositySoftMaskGroup()
    group.softMask!.colorSpace = { kind: 'gray' }
    group.softMask!.isolated = false
    group.softMask!.knockout = false
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(group), backend)
    const bytes = backend.toUint8Array()
    expect(pdfToText(bytes)).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceGray /I false /K false >>')
    const frame = findFrameWithSoftMask(PdfImporter.open(bytes).importPage(0).elements)!
    expect((frame.softMask as { colorSpace?: unknown, isolated?: unknown, knockout?: unknown })).toMatchObject({
      colorSpace: { kind: 'gray' },
      isolated: false,
      knockout: false,
    })
  })

  it('preserves an explicit soft-mask /TR /Identity', () => {
    const group = luminositySoftMaskGroup()
    group.softMask!.transferFunction = 'Identity'
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(group), backend)
    const bytes = backend.toUint8Array()
    expect(pdfToText(bytes)).toContain('/TR /Identity')
    const frame = findFrameWithSoftMask(PdfImporter.open(bytes).importPage(0).elements)!
    expect((frame.softMask as { transferFunction?: unknown }).transferFunction).toBe('Identity')
  })

  it.each([
    { functionType: 0, domain: [0, 1], range: [0, 1], size: [2], bitsPerSample: 8, order: 1, encode: [0, 1], decode: [0, 1], data: new Uint8Array([0, 255]) },
    { functionType: 2, domain: [0, 1] as [number, number], range: [0, 1], c0: [0], c1: [1], exponent: 2 },
    { functionType: 3, domain: [0, 1] as [number, number], range: [0, 1], functions: [
      { functionType: 2, domain: [0, 1] as [number, number], c0: [0], c1: [0.5], exponent: 1 },
      { functionType: 2, domain: [0, 1] as [number, number], c0: [0.5], c1: [1], exponent: 1 },
    ], bounds: [0.5], encode: [0, 1, 0, 1] },
    { functionType: 4, domain: [0, 1], range: [0, 1], expression: '{ dup mul }' },
  ] satisfies PdfFunctionDef[])('preserves soft-mask FunctionType $functionType through output and import', (fn) => {
    const group = luminositySoftMaskGroup()
    group.softMask!.transferFunction = fn
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(group), backend)
    const bytes = backend.toUint8Array()
    expect(pdfToText(bytes)).toContain(`/FunctionType ${fn.functionType}`)
    const page = PdfImporter.open(bytes).importPage(0)
    const frame = findFrameWithSoftMask(page.elements)!
    const retained = (frame.softMask as { transferFunction: PdfFunctionDef }).transferFunction
    expect(retained).toMatchObject({ functionType: fn.functionType })
    expect(evaluateTransferFunctionDef(retained, 0.5)).toBeCloseTo(evaluateTransferFunctionDef(fn, 0.5), 5)
  })

  it('rejects soft masks under PDF/A-1b conformance', () => {
    const backend = new PdfBackend({ fonts: {}, pdfaConformance: 'PDF/A-1b' })
    expect(() => render(docWith(luminositySoftMaskGroup()), backend)).toThrow(/PDF\/A-1b forbids/)
  })

  it('supports nested transparency groups', () => {
    const inner = isolatedGroup({ x: 0, y: 0, opacity: 0.6 })
    const outer = isolatedGroup({ opacity: 0.5, children: [inner] })
    const text = renderPdf(outer)
    expect(text).toContain('/Tp0')
    expect(text).toContain('/Tp1')
  })
})

describe('Transparency group round-trip through the importer', () => {
  it('re-imports an isolated group with opacity as an isolated frame', () => {
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(isolatedGroup({ opacity: 0.5 })), backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const frame = findFrame(page.elements)
    expect(frame).not.toBeNull()
    expect(frame!.isolated).toBe(true)
    expect(frame!.opacity).toBeCloseTo(0.5, 5)
  })

  it('re-imports a non-uniform luminosity soft mask as a real per-pixel mask', () => {
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(luminositySoftMaskGroup()), backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const frame = findFrameWithSoftMask(page.elements)
    expect(frame).not.toBeNull()
    expect(frame!.isolated).toBe(false)
    const mask = frame!.softMask as { type: string, elements: unknown[] }
    expect(mask.type).toBe('luminosity')
    // The mask group (a half-covering white rect) is reconstructed as vector
    // content, not collapsed to a single alpha.
    expect(mask.elements.length).toBeGreaterThan(0)
    // The masked (green) content is preserved inside the frame.
    const fills: string[] = []
    collectFills((frame as Record<string, unknown>).elements as unknown[], fills)
    expect(fills.some(f => f.toLowerCase() === '#00aa00')).toBe(true)
  })

  it('re-imports a non-uniform alpha soft mask as a real per-pixel mask', () => {
    const g = luminositySoftMaskGroup()
    g.softMask!.type = 'alpha'
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(g), backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const frame = findFrameWithSoftMask(page.elements)
    expect(frame).not.toBeNull()
    expect((frame!.softMask as { type: string }).type).toBe('alpha')
  })

  it('re-imports a nested transparency group as nested isolated frames', () => {
    const inner = isolatedGroup({ x: 0, y: 0, opacity: 0.6 })
    const outer = isolatedGroup({ opacity: 0.5, children: [inner] })
    const backend = new PdfBackend({ fonts: {} })
    render(docWith(outer), backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const frame = findFrame(page.elements)
    expect(frame).not.toBeNull()
    expect(frame!.isolated).toBe(true)
    // The inner isolated group survives as a nested isolated frame.
    const innerFrame = findFrame((frame as Record<string, unknown>).elements as unknown[])
    expect(innerFrame).not.toBeNull()
    expect(innerFrame!.isolated).toBe(true)
  })
})

describe('SVG transparency group output (preview parity)', () => {
  function renderSvg(child: RenderNode): string {
    const backend = new SvgBackend({ fonts: {}, background: null })
    render(docWith(child), backend)
    return backend.getPages()[0]!
  }

  it('wraps an opacity group in an isolated <g opacity>', () => {
    const svg = renderSvg(isolatedGroup({ opacity: 0.4 }))
    expect(svg).toMatch(/<g opacity="0\.4" style="isolation:isolate">/)
  })

  it('does not isolate an explicitly non-isolated transparency group', () => {
    const svg = renderSvg(isolatedGroup({ transparencyGroup: true, isolated: false }))
    expect(svg).toContain('style="isolation:auto"')
  })

  it('emits a luminance <mask> and references it', () => {
    const svg = renderSvg(luminositySoftMaskGroup())
    expect(svg).toContain('<mask id="m0" maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="80">')
    expect(svg).toMatch(/<g mask="url\(#m0\)"/)
  })

  it('closes clip groups inside soft-mask and transparency captures', () => {
    const group = luminositySoftMaskGroup()
    group.clip = true
    const svg = renderSvg(group)
    expect(svg).toMatch(/<mask [^>]*><g clip-path="url\(#c\d+\)">.*<\/g><\/mask>/)
    expect(svg).toMatch(/<g mask="url\(#m\d+\)"[^>]*><g clip-path="url\(#c\d+\)">.*<\/g><\/g>/)
    expect((svg.match(/<g(?: |\>)/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length)
  })

  it('emits an alpha <mask> with mask-type:alpha', () => {
    const g = luminositySoftMaskGroup()
    g.softMask!.type = 'alpha'
    const svg = renderSvg(g)
    expect(svg).toContain('style="mask-type:alpha"')
  })

  it('samples a retained FunctionType 0 into the SVG mask transfer table', () => {
    const g = luminositySoftMaskGroup()
    g.softMask!.transferFunction = { functionType: 0, domain: [0, 1], range: [0, 1], size: [2], bitsPerSample: 8, order: 1, encode: [0, 1], decode: [0, 1], data: new Uint8Array([0, 255]) }
    const svg = renderSvg(g)
    expect(svg).toContain('<feComponentTransfer>')
    expect(svg).toContain('tableValues="0 0.063 0.125')
  })
})

describe('Canvas transparency group output (preview parity)', () => {
  it('composites a RenderPage transparency group as one page-level unit', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    render({
      pages: [{
        width: 120,
        height: 120,
        transparencyGroup: { isolated: true, knockout: true },
        children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#ff0000' }],
      }],
    }, backend)
    expect(log).toContain('createElement:canvas')
    expect(log).toContain('putImageData')
    expect(log).toContain('drawImage')
  })

  it('captures overprint objects for native-plate pixel compositing', () => {
    const { ctx, log } = createRecordingCanvas()
    render(docWith({
      type: 'rect', x: 0, y: 0, width: 20, height: 20,
      fill: 'cmyk(0,100,0,0)', overprintFill: true, overprintMode: 1,
    }), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))
    expect(log).toContain('createElement:canvas')
    expect(log).toContain('putImageData')
    expect(log).not.toContain('globalCompositeOperation=multiply')
  })

  it('composites the group through an offscreen layer with one globalAlpha', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    render(docWith(isolatedGroup({ opacity: 0.5 })), backend)
    // An offscreen layer was created and drawn back onto the target.
    expect(log.some(l => l.startsWith('createElement:canvas'))).toBe(true)
    expect(log.some(l => l.startsWith('drawImage'))).toBe(true)
    expect(log.some(l => l === 'globalAlpha=0.5')).toBe(true)
  })

  it('initializes a non-isolated transparency group from the current backdrop', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    render(docWith(isolatedGroup({ transparencyGroup: true, isolated: false })), backend)
    expect(log.filter(function (entry) { return entry === 'drawImage' })).toHaveLength(2)
  })

  it('applies the group clip inside the offscreen compositing layer', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    render(docWith(isolatedGroup({ clip: true })), backend)
    expect(log.indexOf('createElement:canvas')).toBeLessThan(log.indexOf('clip'))
  })

  it('connects PDF flatness to Canvas path scan conversion in device pixels', () => {
    const { ctx, log } = createRecordingCanvas()
    const group = isolatedGroup({
      deviceParams: { flatness: 0.25 },
      children: [{
        type: 'path', x: 0, y: 0, width: 10, height: 10,
        commands: new Uint8Array([0, 2]),
        coords: new Float32Array([0, 0, 0, 10, 10, 10, 10, 0]),
        stroke: '#000000', strokeWidth: 1,
      }],
    })
    render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))
    expect(log).not.toContain('bezierCurveTo')
    expect(log.filter(function (entry) { return entry === 'lineTo' }).length).toBeGreaterThan(1)
  })

  it('connects stroke adjustment to arbitrary Canvas path coordinates and widths', () => {
    const { ctx, log } = createRecordingCanvas()
    const group = isolatedGroup({
      deviceParams: { strokeAdjustment: true },
      children: [{
        type: 'path', x: 0, y: 0, width: 10, height: 10,
        commands: new Uint8Array([0, 1]),
        coords: new Float32Array([0.1, 0.2, 9.1, 8.2]),
        stroke: '#000000', strokeWidth: 0.2,
      }],
    })
    render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))
    expect(log).toContain('moveTo:0.5,0.5')
    expect(log).toContain('lineTo:9.5,8.5')
    expect(log).toContain('lineWidth=1')
  })

  it('keeps geometry-only device parameters inside the current transparency backdrop', () => {
    const { ctx, log } = createRecordingCanvas()
    const group = isolatedGroup({
      transparencyGroup: true,
      isolated: false,
      blendMode: 'multiply',
      deviceParams: { strokeAdjustment: true, flatness: 1, smoothness: 0.25 },
      children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#ffffff' }],
    })
    render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))

    // The transparency group and its direct object need two surfaces.
    // Geometry parameters must not add a third isolating device surface.
    expect(log.filter(function (entry) { return entry === 'createElement:canvas' })).toHaveLength(2)
  })

  it('uses a device-raster surface when a transfer function changes pixels', () => {
    const { ctx, log } = createRecordingCanvas()
    const group = isolatedGroup({
      transparencyGroup: false,
      isolated: false,
      deviceParams: { transferFunction: { functionType: 4, domain: [0, 1], range: [0, 1], expression: '{ 1 exch sub }' } },
      children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#ffffff' }],
    })
    render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))

    expect(log).toContain('createElement:canvas')
    expect(log).toContain('putImageData')
  })

  it('connects PDF smoothness to Canvas function-shading precision', () => {
    const renderWithSmoothness = function (smoothness: number): number {
      const { ctx, log } = createRecordingCanvas()
      const fill = {
        type: 'function-shading' as const,
        domain: [0, 1, 0, 1] as [number, number, number, number],
        matrix: [30, 0, 0, 30, 0, 0] as [number, number, number, number, number, number],
        expression: '{ pop dup dup }',
      }
      const group = isolatedGroup({
        deviceParams: { smoothness },
        children: [{
          type: 'path', x: 0, y: 0, width: 30, height: 30,
          commands: new Uint8Array([0, 1, 1, 1, 3]),
          coords: new Float32Array([0, 0, 30, 0, 30, 30, 0, 30]),
          fill,
        }],
      })
      render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))
      return log.filter(function (entry) { return entry === 'fill' }).length
    }
    expect(renderWithSmoothness(0.05)).toBeGreaterThan(renderWithSmoothness(0.5))
  })

  it('applies a soft mask with destination-in', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    render(docWith(luminositySoftMaskGroup()), backend)
    expect(log).toContain('globalCompositeOperation=destination-in')
  })

  it('renders a luminosity mask group over its opaque /BC backdrop', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    backend.beginPage(120, 120)
    backend.beginSoftMask('luminosity', 40, 40, [0.25, 0.5, 0.75])

    const backdropStyle = log.indexOf('fillStyle=rgb(63.75, 127.5, 191.25)')
    expect(backdropStyle).toBeGreaterThanOrEqual(0)
    expect(log.slice(backdropStyle + 1).some(function (entry) { return entry.startsWith('fillRect:0,0,') })).toBe(true)
  })

  it('keeps an alpha mask group transparent before mask content is drawn', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    backend.beginPage(120, 120)
    const fillsBeforeMask = log.filter(function (entry) { return entry.startsWith('fillRect:') }).length
    backend.beginSoftMask('alpha', 40, 40, [0.25, 0.5, 0.75])

    expect(log.filter(function (entry) { return entry.startsWith('fillRect:') })).toHaveLength(fillsBeforeMask)
  })

  it('composites a clipped page-level blend group through the target clip', () => {
    const { ctx, log } = createRecordingCanvas()
    const group = isolatedGroup({
      blendMode: 'multiply',
      clip: true,
      children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#6699cc' }],
    })
    render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))
    expect(log).toContain('clip')
    expect(log).toContain('globalCompositeOperation=multiply')
  })

  it('uses the accumulated parent-group backdrop for a nested non-isolated object', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    backend.beginPage(120, 120)
    backend.beginTransparencyGroup(120, 120, { isolated: false, knockout: false, hasSoftMask: false })
    backend.beginTransparencyObject()
    backend.beginTransparencyGroup(40, 40, { isolated: false, knockout: false, hasSoftMask: false })

    // The outer group copies the page once. The nested group then copies the
    // accumulated parent backdrop followed by paints in its current object.
    expect(log.filter(function (entry) { return entry === 'drawImage' })).toHaveLength(3)
  })

  it('treats a soft-mask surface as a transparency-backdrop boundary', () => {
    const { ctx, log } = createRecordingCanvas()
    const backend = new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 })
    backend.beginPage(120, 120)
    backend.beginTransparencyGroup(120, 120, { isolated: false, knockout: false, hasSoftMask: false })
    backend.beginTransparencyObject()
    backend.beginSoftMask('luminosity', 40, 40)
    backend.beginTransparencyGroup(40, 40, { isolated: false, knockout: false, hasSoftMask: false })

    // The mask's nested group copies only the independent mask surface; the
    // colored outer-group backdrop must never enter a luminosity mask.
    expect(log.filter(function (entry) { return entry === 'drawImage' })).toHaveLength(2)
  })

  it('aligns a cropped soft mask to the content layer device origin', () => {
    const { ctx, maskOffsets } = createTransformTrackingCanvas()
    const masked = luminositySoftMaskGroup()
    masked.x = 20
    masked.y = 30
    masked.width = 40
    masked.height = 40
    masked.softMask!.content = [{ type: 'rect', x: 0, y: 0, width: 40, height: 20, fill: '#ffffff' }]
    masked.children = [{ type: 'rect', x: 0, y: 0, width: 40, height: 40, fill: '#00aa00' }]
    const parent = isolatedGroup({
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      children: [masked],
    })

    render(docWith(parent), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))

    // createLayer includes one device pixel of antialiasing padding, hence
    // the cropped mask for (20,30) begins at (19,29).
    expect(maskOffsets).toContainEqual([19, 29])
  })

  it('applies a retained FunctionType 2 to Canvas mask pixels', () => {
    const { ctx, log } = createRecordingCanvas()
    const group = luminositySoftMaskGroup()
    group.softMask!.transferFunction = { functionType: 2, domain: [0, 1], range: [0, 1], c0: [0], c1: [1], exponent: 2 }
    render(docWith(group), new CanvasBackend(ctx, { fonts: {}, devicePixelRatio: 1 }))
    expect(log).toContain('putImageData')
  })
})

// ─── Helpers ───

function findFrame(elements: unknown[]): (Record<string, unknown> & { transparencyGroup?: boolean, isolated?: boolean, opacity?: number }) | null {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (e.type === 'frame') return e as never
    if (Array.isArray(e.elements)) {
      const inner = findFrame(e.elements as unknown[])
      if (inner) return inner
    }
  }
  return null
}

function findFrameWithSoftMask(elements: unknown[]): (Record<string, unknown> & { softMask?: unknown }) | null {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (e.type === 'frame' && e.softMask) return e as never
    if (Array.isArray(e.elements)) {
      const inner = findFrameWithSoftMask(e.elements as unknown[])
      if (inner) return inner
    }
  }
  return null
}

function findPdfForm(elements: unknown[]): (Record<string, unknown> & { affineTransform?: number[], elements?: unknown[] }) | null {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (e.type === 'frame' && e.pdfForm !== undefined) return e as never
    if (Array.isArray(e.elements)) {
      const inner = findPdfForm(e.elements as unknown[])
      if (inner) return inner
    }
  }
  return null
}

function collectFills(elements: unknown[], out: string[]): void {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (typeof e.fill === 'string') out.push(e.fill)
    if (typeof e.backcolor === 'string') out.push(e.backcolor)
    if (Array.isArray(e.elements)) collectFills(e.elements as unknown[], out)
  }
}

/** A recording Canvas 2D context + canvas that supports offscreen layers. */
function createRecordingCanvas(): { ctx: RecordingCtx, log: string[] } {
  const log: string[] = []
  function makeCanvas(width: number, height: number): RecordingCanvas {
    const canvas: RecordingCanvas = {
      width, height,
      style: {},
      ownerDocument: {
        createElement(tag: string) {
          log.push(`createElement:${tag}`)
          return makeCanvas(width, height)
        },
      },
      getContext() { return makeCtx(canvas) },
    }
    return canvas
  }
  function makeCtx(canvas: RecordingCanvas): RecordingCtx {
    const ctx: RecordingCtx = {
      canvas,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '',
      save() {}, restore() {},
      beginPath() {}, closePath() {}, moveTo(x: number, y: number) { log.push(`moveTo:${x},${y}`) }, lineTo(x: number, y: number) { log.push('lineTo', `lineTo:${x},${y}`) }, bezierCurveTo() { log.push('bezierCurveTo') },
      rect() {}, ellipse() {}, roundRect() {}, arcTo() {}, clip() { log.push('clip') }, fill() { log.push('fill') }, stroke() {},
      fillRect(x: number, y: number, width: number, height: number) { log.push(`fillRect:${x},${y},${width},${height}`) }, strokeRect() {}, fillText() {}, setLineDash() {},
      measureText(t: string) { return { width: t.length * 6 } },
      translate() {}, rotate() {}, transform() {},
      setTransform() { log.push('setTransform') },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }
      },
      putImageData() { log.push('putImageData') },
      drawImage() { log.push('drawImage') },
    }
    // Proxy scalar setters we care about into the log.
    return new Proxy(ctx, {
      set(target, prop, value) {
        if (prop === 'globalAlpha') log.push(`globalAlpha=${value}`)
        if (prop === 'globalCompositeOperation') log.push(`globalCompositeOperation=${value}`)
        if (prop === 'fillStyle') log.push(`fillStyle=${value}`)
        if (prop === 'lineWidth') log.push(`lineWidth=${value}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(target as any)[prop] = value
        return true
      },
    })
  }
  const canvas = makeCanvas(120, 120)
  return { ctx: makeCtx(canvas), log }
}

function createTransformTrackingCanvas(): { ctx: RecordingCtx, maskOffsets: Array<[number, number]> } {
  const maskOffsets: Array<[number, number]> = []
  function makeCanvas(width: number, height: number): RecordingCanvas {
    const canvas: RecordingCanvas = {
      width,
      height,
      style: {},
      ownerDocument: { createElement() { return makeCanvas(width, height) } },
      getContext() { return makeContext(canvas) },
    }
    return canvas
  }
  function makeContext(canvas: RecordingCanvas): RecordingCtx {
    let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    let composite = 'source-over'
    let alpha = 1
    const stack: Array<{ matrix: typeof matrix, composite: string, alpha: number }> = []
    const ctx: RecordingCtx = {
      canvas,
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '',
      get globalAlpha() { return alpha },
      set globalAlpha(value: number) { alpha = value },
      get globalCompositeOperation() { return composite },
      set globalCompositeOperation(value: string) { composite = value },
      save() { stack.push({ matrix: { ...matrix }, composite, alpha }) },
      restore() {
        const saved = stack.pop()
        if (saved !== undefined) { matrix = saved.matrix; composite = saved.composite; alpha = saved.alpha }
      },
      translate(x: number, y: number) {
        matrix = { ...matrix, e: matrix.e + matrix.a * x + matrix.c * y, f: matrix.f + matrix.b * x + matrix.d * y }
      },
      rotate(angle: number) {
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        this.transform(cos, sin, -sin, cos, 0, 0)
      },
      transform(a: number, b: number, c: number, d: number, e: number, f: number) {
        const m = matrix
        matrix = {
          a: m.a * a + m.c * b,
          b: m.b * a + m.d * b,
          c: m.a * c + m.c * d,
          d: m.b * c + m.d * d,
          e: m.a * e + m.c * f + m.e,
          f: m.b * e + m.d * f + m.f,
        }
      },
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { matrix = { a, b, c, d, e, f } },
      getTransform() { return { ...matrix } },
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, rect() {}, ellipse() {}, roundRect() {}, arcTo() {},
      clip() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, fillText() {}, setLineDash() {},
      measureText(text: string) { return { width: text.length * 6 } },
      getImageData(_x: number, _y: number, width: number, height: number) {
        return { data: new Uint8ClampedArray(width * height * 4), width, height }
      },
      putImageData() {},
      drawImage(_image: unknown, x = 0, y = 0) {
        if (composite === 'destination-in') maskOffsets.push([x, y])
      },
    }
    return ctx
  }
  const canvas = makeCanvas(120, 120)
  return { ctx: makeContext(canvas), maskOffsets }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecordingCanvas = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecordingCtx = any
