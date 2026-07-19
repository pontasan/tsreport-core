import { pdfToText } from '../renderer/pdf-test-utils.js'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSvg } from '../../src/svg/svg-parser.js'
import { renderSvg } from '../../src/svg/svg-renderer.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import type { RenderBackend, ShapeDrawOptions } from '../../src/renderer/backend.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'
import { decodePng } from '../../src/image/png-parser.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'

describe('renderSvg', () => {
  // Verifies that a filled rect renders into a valid PDF with the correct fill color operator.
  it('renders basic shapes to PDF backend', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <rect x="10" y="10" width="80" height="80" fill="red"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 10, 10, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('%PDF-1.7')
    // fill color (red = 1 0 0 rg)
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that a circle is approximated with cubic bezier ('c') operators and filled blue.
  it('renders circle as cubic bezier', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <circle cx="50" cy="50" r="30" fill="blue" stroke="none"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    // Blue fill
    expect(pdfStr).toContain('0 0 1 rg')
    // Should contain cubic bezier commands
    expect(pdfStr).toContain(' c')
  })

  // Verifies that a stroked path emits the stroke color (RG) and line width (w) operators.
  it('renders path with stroke', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <path d="M 10 10 L 90 90" fill="none" stroke="#00ff00" stroke-width="2"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    // Green stroke
    expect(pdfStr).toContain('0 1 0 RG')
    // Stroke width
    expect(pdfStr).toContain('2 w')
  })

  // Verifies that renderSvg prefers the backend's native drawPathData with the viewport transform instead of the drawPath fallback.
  it('uses drawPathData when backend supports native path data', () => {
    const svg = `<svg viewBox="0 0 10 10" width="10" height="10" preserveAspectRatio="none">
      <path d="M0 0 L10 0 L10 10 Z" fill="#000000"/>
    </svg>`
    const doc = parseSvg(svg)

    const calls: Array<{
      d: string
      transform: [number, number, number, number, number, number]
      options: ShapeDrawOptions | undefined
    }> = []

    const backend = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      clip() {},
      setOpacity() {},
      beginDocument() {},
      endDocument() {},
      beginPage() {},
      endPage() {},
      drawText() {},
      drawLine() {},
      drawRect() {},
      drawEllipse() {},
      drawPath() {
        throw new Error('drawPath fallback should not be used')
      },
      drawPathData(
        d: string,
        transform: [number, number, number, number, number, number],
        options?: ShapeDrawOptions,
      ) {
        calls.push({ d, transform, options })
        return true
      },
      drawImage() {},
    } as unknown as RenderBackend

    renderSvg(doc, backend, 0, 0, 20, 30)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.d).toContain('M0 0 L10 0 L10 10 Z')
    expect(calls[0]!.transform).toEqual([2, 0, 0, 3, 0, 0])
    expect(calls[0]!.options?.fill).toBe('#000000')
  })

  // Verifies that fill="currentColor" resolves to the element's color property at render time.
  it('resolves currentColor for fill paint', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <rect x="10" y="10" width="80" height="80" color="#336699" fill="currentColor"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('0.2 0.4 0.6 rg')
  })

  // Verifies that a url() paint referencing a missing def falls back to the currentColor value.
  it('uses currentColor as url paint fallback', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <rect x="10" y="10" width="80" height="80" color="#ff0000" fill="url(#missing) currentColor"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that a group translate transform renders without error to non-empty PDF output.
  it('respects transform', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <g transform="translate(10, 20)">
        <rect x="0" y="0" width="50" height="50" fill="red"/>
      </g>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    expect(pdf.length).toBeGreaterThan(0)
  })

  it('applies nested svg viewport, viewBox transform, and overflow clipping', () => {
    const doc = parseSvg(`<svg viewBox="0 0 100 100">
      <svg x="10" y="20" width="30" height="40" viewBox="0 0 10 10" preserveAspectRatio="none">
        <rect width="20" height="20" fill="#ff0000"/>
      </svg>
    </svg>`)
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument(); backend.beginPage(100, 100)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage(); backend.endDocument()
    const pdf = pdfToText(backend.toUint8Array())
    expect(pdf).toMatch(/10 20 m\s+40 20 l\s+40 60 l\s+10 60 l\s+h\s+W n/)
    expect(pdf).toContain('3 0 0 4 10 20 cm')
  })

  // Verifies that an SVG referenced as a document image is drawn as vector paths, not a raster XObject.
  it('SVG image via drawImage', () => {
    const svgData = '<svg viewBox="0 0 100 100" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="green"/></svg>'

    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 50, y: 100, width: 200, height: 150, imageId: 'test-svg',
        }],
      }],
      images: { 'test-svg': new TextEncoder().encode(svgData) },
    }

    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)

    // SVG is drawn as vector paths directly, not as an XObject
    expect(pdfStr).toContain('%PDF-1.7')
    // Green fill (#008000 = 0.50196078...)
    expect(pdfStr).toMatch(/0 0\.(?:502|501961|50196078|501960784314) 0 rg/)
  })

  // Verifies that an SVG with no drawable children still produces a valid non-empty PDF.
  it('empty SVG produces valid output', () => {
    const svg = '<svg viewBox="0 0 100 100" width="100" height="100"></svg>'
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    expect(pdf.length).toBeGreaterThan(0)
  })

  // Verifies that rendering a larger viewBox into a smaller viewport scales without error.
  it('viewBox scaling', () => {
    // viewBox is 200x200 but rendered into 100x100 → scale 0.5
    const svg = `<svg viewBox="0 0 200 200" width="200" height="200">
      <rect x="0" y="0" width="200" height="200" fill="red"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    expect(pdf.length).toBeGreaterThan(0)
  })

  // Verifies that preserveAspectRatio="none" applies non-uniform scale via the cm matrix while coordinates stay in user units.
  it('honors preserveAspectRatio="none"', () => {
    const svg = `<svg viewBox="0 0 100 50" width="100" height="100" preserveAspectRatio="none">
      <rect x="0" y="0" width="100" height="50" fill="#ff0000"/>
    </svg>`
    const doc = parseSvg(svg)
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    // none: viewBox 100x50 -> 100x100 = scaleY 2x. The transform goes into the cm matrix; coordinates keep their original values.
    expect(pdfStr).toContain('cm')
    expect(pdfStr).toContain('0 0 m')
    expect(pdfStr).toContain('100 50 l')
  })

  // Verifies that stroke-width and dash values are emitted unscaled because the viewBox scale lives in the cm matrix.
  it('scales stroke width and dash by viewBox transform', () => {
    const svg = `<svg viewBox="0 0 200 200" width="200" height="200">
      <path d="M 10 100 L 190 100" fill="none" stroke="#000" stroke-width="8" stroke-dasharray="20 10"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    // Render 200x200 viewBox into 100x100 => 0.5x scale
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    // The transform is applied via the cm matrix; stroke-width / dash are output with their original values.
    expect(pdfStr).toContain('8 w')
    expect(pdfStr).toContain('[20 10] 0 d')
  })

  // Verifies that an odd-length stroke-dasharray is duplicated as required by the SVG spec.
  it('duplicates odd-length stroke-dasharray per SVG spec', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <path d="M 10 50 L 90 50" fill="none" stroke="#000" stroke-width="2" stroke-dasharray="5"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('[5 5] 0 d')
  })

  // Verifies that fill="none" with a stroke produces stroke-only output using the RG operator.
  it('fill none produces stroke only', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <rect x="10" y="10" width="80" height="80" fill="none" stroke="black" stroke-width="1"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    // Stroke operator (S) without fill
    expect(pdfStr).toContain('0 G')
  })

  // Verifies that stroke and stroke-width presentation attributes inherit from a parent group to children.
  it('inherits stroke style from group', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <g stroke="black" stroke-width="3">
        <line x1="10" y1="10" x2="90" y2="90"/>
      </g>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('0 G')
    expect(pdfStr).toContain('3 w')
  })

  // Verifies that the fill set on a <use> element is inherited by the referenced content when rendered.
  it('applies style on <use> wrapper', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs><rect id="r1" x="0" y="0" width="20" height="20"/></defs>
      <use href="#r1" x="10" y="20" fill="#00ff00"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('0 1 0 rg')
  })

  // Verifies that gradient url() paints for fill and stroke both produce PDF shading patterns (scn/SCN).
  it('resolves gradient URL paint for fill and stroke', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g">
          <stop offset="0" stop-color="#ff0000"/>
          <stop offset="1" stop-color="#ff0000"/>
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="30" height="30" fill="url(#g)"/>
      <path d="M 50 20 L 90 20" fill="none" stroke="url(#g)" stroke-width="2"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('/Type /Pattern')
    expect(pdfStr).toContain('/Pattern cs')
    expect(pdfStr).toContain('/Pattern CS')
    expect(pdfStr).toContain('scn')
    expect(pdfStr).toContain('SCN')
  })

  // Verifies that a gradient stroke emits an axial (ShadingType 2) pattern and a stroke+fill operator.
  it('gradient stroke uses axial shading pattern', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="50" x2="100" y2="50" stroke="url(#g)" stroke-width="6" />
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('/ShadingType 2')
    expect(pdfStr).toContain('/Pattern CS')
    expect(pdfStr).toContain('SCN')
    expect(pdfStr).toContain('\nB')
  })

  // Verifies that an objectBoundingBox gradient is skipped when the geometry bbox is degenerate (zero width).
  it('does not paint objectBoundingBox gradient stroke when geometry bbox is degenerate', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <line x1="50" y1="10" x2="50" y2="90" stroke="url(#g)" stroke-width="10" />
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    // The geometry bbox degenerates, so the objectBoundingBox gradient cannot be resolved.
    expect(pdfStr).not.toContain('/Pattern CS')
    expect(pdfStr).not.toContain('/ShadingType 2')
  })

  // Verifies that gradient coordinates track the element's rotate transform when mapped into PDF user space.
  it('objectBoundingBox gradient follows element transform', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect x="10" y="30" width="60" height="20" fill="url(#g)" transform="rotate(90 40 40)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    const m = pdfStr.match(/\/ShadingType 2[\s\S]*?\/Coords \[([^\]]+)\]/)
    expect(m).toBeTruthy()
    if (!m) return
    const nums = m[1]!.trim().split(/\s+/).map(v => parseFloat(v))
    expect(nums.length).toBeGreaterThanOrEqual(4)
    const x1 = nums[0]!
    const y1 = nums[1]!
    const x2 = nums[2]!
    const y2 = nums[3]!
    // After rotate(90 40 40), local coordinates are (10,30)->(50,10) and (70,30)->(50,70).
    // PDF shading coordinates live in default user space (Y up), so accounting for
    // the Y-flip CTM of beginPage(200,200), y becomes 190 / 130.
    expect(Math.abs(x1 - 50)).toBeLessThan(1e-3)
    expect(Math.abs(y1 - 190)).toBeLessThan(1e-3)
    expect(Math.abs(x2 - 50)).toBeLessThan(1e-3)
    expect(Math.abs(y2 - 130)).toBeLessThan(1e-3)
  })

  // Verifies that gradient coordinates account for the render offset and page Y-flip when mapped to default user space.
  it('maps SVG gradient coordinates into PDF default user space under render translation', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#g)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 20, 30, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    const m = pdfStr.match(/\/ShadingType 2[\s\S]*?\/Coords \[([^\]]+)\]/)
    expect(m).toBeTruthy()
    if (!m) return
    const nums = m[1]!.trim().split(/\s+/).map(v => parseFloat(v))
    expect(nums.length).toBeGreaterThanOrEqual(4)
    // Local (0,0)->(100,0) mapped into default user space via translate(20,30)
    // plus the beginPage Y-flip.
    expect(Math.abs(nums[0]! - 20)).toBeLessThan(1e-3)
    expect(Math.abs(nums[1]! - 170)).toBeLessThan(1e-3)
    expect(Math.abs(nums[2]! - 120)).toBeLessThan(1e-3)
    expect(Math.abs(nums[3]! - 170)).toBeLessThan(1e-3)
  })

  // Verifies that the objectBoundingBox for a curved path uses the exact bezier extents, not control-point bounds.
  it('objectBoundingBox gradient uses geometric bezier bounds (not control points)', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <path d="M 0 10 Q 50 90 100 10" fill="none" stroke="url(#g)" stroke-width="2"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    const m = pdfStr.match(/\/ShadingType 2[\s\S]*?\/Coords \[([^\]]+)\]/)
    expect(m).toBeTruthy()
    if (!m) return
    const nums = m[1]!.trim().split(/\s+/).map(v => parseFloat(v))
    expect(nums.length).toBeGreaterThanOrEqual(4)
    const y1 = nums[1]!
    const y2 = nums[3]!
    // The geometric bbox of the curve is y=10..50 (height 40); control-point bounds would make this delta larger.
    expect(Math.abs(Math.abs(y2 - y1) - 40)).toBeLessThan(1e-3)
  })

  // Verifies that spreadMethod="repeat" still produces a usable axial shading pattern in PDF.
  it('supports repeat spreadMethod in PDF gradient', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%" spreadMethod="repeat">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#g)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/Type /Pattern')
    expect(pdfStr).toContain('/ShadingType 2')
  })

  // Verifies that the gradient direction under a non-uniform bbox scale uses the inverse-transpose mapping, not naive endpoint transformation.
  it('maps objectBoundingBox linear gradient with inverse-transpose under non-uniform bbox scale', () => {
    const svg = `<svg viewBox="0 0 220 120" width="220" height="120">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect x="10" y="20" width="180" height="60" fill="url(#g)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(240, 160)
    renderSvg(doc, backend, 0, 0, 220, 120)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    const m = pdfStr.match(/\/ShadingType 2[\s\S]*?\/Coords \[([^\]]+)\]/)
    expect(m).toBeTruthy()
    if (!m) return
    const nums = m[1]!.trim().split(/\s+/).map(v => parseFloat(v))
    expect(nums.length).toBeGreaterThanOrEqual(4)
    const dx = nums[2]! - nums[0]!
    const dy = nums[3]! - nums[1]!
    const slopeAbs = Math.abs(dy / dx)
    // Even with a 180x60 bbox (x:y = 3:1), mapping (0,0)->(1,1) uses the
    // inverse-transpose rather than a plain endpoint transform, so |dy/dx| ≈ 3.
    expect(slopeAbs).toBeGreaterThan(2.9)
    expect(slopeAbs).toBeLessThan(3.1)
  })

  // Verifies that stroke-linecap="round" maps to the PDF line cap operator '1 J'.
  it('applies stroke-linecap from SVG style', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <path d="M 10 50 L 90 50" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('1 J')
  })

  // Verifies that vector-effect="non-scaling-stroke" keeps the stroke width constant under a scale transform.
  it('supports vector-effect non-scaling-stroke on transformed geometry', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <path d="M 10 50 L 90 50" fill="none" stroke="#000" stroke-width="6"
        transform="scale(2)" vector-effect="non-scaling-stroke"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    // Even under scale(2), the line width stays 6 instead of being magnified.
    expect(pdfStr).toContain('6 w')
    expect(pdfStr).not.toContain('12 w')
  })

  // Verifies that the SVG default stroke-miterlimit of 4 is emitted when the attribute is absent.
  it('uses SVG default stroke-miterlimit=4 when unspecified', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <path d="M 10 90 L 50 10 L 90 90" fill="none" stroke="#000" stroke-width="6"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('4 M')
  })

  // Verifies that a gradient-stroked polygon is stroked as one closed path (h + S) so corner joins stay connected.
  it('gradient-stroked polygon remains a connected path stroke', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ff0000"/>
          <stop offset="100%" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <polygon points="50,10 90,90 10,90" fill="none" stroke="url(#g)" stroke-width="8" />
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    // Must be drawn as a single outline via ClosePath + stroke
    expect(pdfStr).toContain('h')
    expect(pdfStr).toContain('\nS')
  })

  // Verifies that a radial gradient fill produces a radial (ShadingType 3) shading pattern.
  it('radial gradient fill uses radial shading pattern', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <radialGradient id="rg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#000000"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="30" fill="url(#rg)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('/ShadingType 3')
    expect(pdfStr).toContain('/Pattern cs')
    expect(pdfStr).toContain('scn')
  })

  // Verifies as an integration case that a real sample file with gradients and strokes renders to valid PDF.
  it('renders sample2.svg with multiple stroked shapes', () => {
    const svg = readFileSync(resolve(import.meta.dirname!, '../sample/images/sample2.svg'), 'utf-8')
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 200, 200)
    backend.endPage()
    backend.endDocument()

    const pdf = backend.toUint8Array()
    const pdfStr = pdfToText(pdf)
    expect(pdfStr).toContain('%PDF-1.7')
    expect(pdfStr).toContain('/Type /Pattern')
    expect(pdfStr).toContain('\nS')
  })

  // Verifies that a base64 data URI SVG referenced by <image> is decoded and rendered inline.
  it('renders embedded data URI image inside SVG', () => {
    const inner = '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#ff0000"/></svg>'
    const b64 = Buffer.from(inner).toString('base64')
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <image x="10" y="10" width="80" height="80" href="data:image/svg+xml;base64,${b64}"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that a rotated <image> with a data URI applies its affine transform via a cm matrix.
  it('renders transformed data URI image with affine matrix', () => {
    const inner = '<svg viewBox="0 0 20 10"><rect x="0" y="0" width="20" height="10" fill="#ff0000"/></svg>'
    const b64 = Buffer.from(inner).toString('base64')
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <image x="20" y="20" width="40" height="20" transform="rotate(30 40 30)"
        href="data:image/svg+xml;base64,${b64}"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('1 0 0 rg')
    expect(pdfStr).toContain(' cm')
  })

  // Verifies that preserveAspectRatio="xMidYMid slice" on <image> clips the content to the image viewport rect.
  it('applies image preserveAspectRatio slice viewport clipping', () => {
    const inner = '<svg viewBox="0 0 20 10"><rect x="0" y="0" width="20" height="10" fill="#00ff00"/></svg>'
    const b64 = Buffer.from(inner).toString('base64')
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <image x="13" y="17" width="29" height="29" preserveAspectRatio="xMidYMid slice"
        href="data:image/svg+xml;base64,${b64}"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('13 17 m')
    expect(pdfStr).toContain('42 46 l')
  })

  // Verifies that clip-rule="evenodd" on a clipPath emits the even-odd clip operator W* n.
  it('supports clipPath clip-rule evenodd', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <clipPath id="c1" clip-rule="evenodd">
          <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 70 30 L 70 70 L 30 70 Z"/>
        </clipPath>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="#ff0000" clip-path="url(#c1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('W* n')
  })

  // Verifies that a userSpaceOnUse pattern fill renders its tile content (green rect) into the output.
  it('renders pattern fill', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <pattern id="p1" patternUnits="userSpaceOnUse" width="20" height="20">
          <rect x="0" y="0" width="20" height="20" fill="#00ff00"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#p1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('0 1 0 rg')
  })

  // Verifies that a pattern's viewBox-to-tile scaling is applied via a cm matrix, leaving tile coordinates unscaled.
  it('applies pattern viewBox transform when rendering tiles', () => {
    const svg = `<svg viewBox="0 0 40 40" width="40" height="40">
      <defs>
        <pattern id="p1" patternUnits="userSpaceOnUse" width="20" height="20" viewBox="0 0 10 10">
          <rect x="5" y="0" width="5" height="10" fill="#00ff00"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width="20" height="20" fill="url(#p1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 40, 40)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    // viewBox 0..10 → 20x20 tile (2x scale). The transform goes into the cm matrix; coordinates keep original values.
    expect(pdfStr).toContain('cm')
    expect(pdfStr).toContain('5 0 m')
    expect(pdfStr).toContain('10 10 l')
  })

  // Verifies that a filter chain not merging SourceGraphic renders only the black shadow, not the source fill.
  it('renders shadow-only filter chain when SourceGraphic is not merged', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
          <feOffset dx="3" dy="4" result="offsetblur"/>
          <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
        </filter>
      </defs>
      <rect x="10" y="10" width="40" height="40" fill="#ff0000" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('0 g')
    expect(pdfStr).not.toContain('1 0 0 rg')
  })

  // Verifies that merging SourceGraphic in feMerge renders both the shadow and the original red fill.
  it('renders drop-shadow + SourceGraphic when feMerge includes SourceGraphic', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
          <feOffset dx="3" dy="4" result="offsetblur"/>
          <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
          <feMerge><feMergeNode in="offsetblur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect x="10" y="10" width="40" height="40" fill="#ff0000" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('0 g')
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that a large blur radius switches the shadow to the raster pipeline (Image XObject with SMask).
  it('renders large-blur drop-shadow via raster image pipeline', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5"/>
          <feOffset dx="3" dy="4" result="offsetblur"/>
          <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
          <feMerge><feMergeNode in="offsetblur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect x="10" y="10" width="40" height="40" fill="#ff0000" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/Subtype /Image')
    expect(pdfStr).toContain('/SMask')
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that a feBlend mode in the filter chain maps to the PDF blend-mode graphics state (/BM).
  it('applies feBlend mode between shadow and source graphic', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur1"/>
          <feOffset in="blur1" dx="3" dy="4" result="shadow1"/>
          <feBlend in="shadow1" in2="SourceGraphic" mode="multiply"/>
        </filter>
      </defs>
      <rect x="10" y="10" width="40" height="40" fill="#ff0000" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/BM /Multiply')
  })

  // Verifies that both the shadow pass and the SourceGraphic pass are clipped to the userSpaceOnUse filter region.
  it('clips drop-shadow rendering to filter region', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow" filterUnits="userSpaceOnUse" x="5" y="6" width="20" height="22">
          <feDropShadow dx="2" dy="3" stdDeviation="0"/>
        </filter>
      </defs>
      <rect x="10" y="10" width="40" height="40" fill="#ff0000" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    const regionClipCount = (pdfStr.match(/5 6 m\s+25 6 l\s+25 28 l\s+5 28 l\s+h\s+W n/g) ?? []).length
    // The filter region clip is applied for both the shadow pass and the SourceGraphic pass
    expect(regionClipCount).toBeGreaterThanOrEqual(2)
  })

  // Verifies that primitiveUnits="objectBoundingBox" scales feDropShadow dx by the bbox width (0.5 * 40 = 20pt in the cm matrix).
  it('applies primitiveUnits="objectBoundingBox" to feDropShadow dx/dy/stdDeviation', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow" filterUnits="userSpaceOnUse" primitiveUnits="objectBoundingBox"
          x="0" y="0" width="100" height="100">
          <feDropShadow dx="0.5" dy="0" stdDeviation="0"/>
        </filter>
      </defs>
      <rect x="10" y="20" width="40" height="20" fill="#ff0000" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    // With objectBoundingBox, dx=0.5 means half of the bbox width 40 -> a 20pt shift.
    // The transform is applied via the cm matrix: both shadow and body are drawn at
    // the original coordinates 10 20, and the shadow offset lives in the cm matrix.
    expect(pdfStr).toContain('10 20 m')
    expect(pdfStr).toContain('0 g')
    expect(pdfStr).toContain('1 0 0 rg')
    // Confirm the 20pt shadow-offset translate is included in the cm matrix
    expect(pdfStr).toContain('20 0 cm') // shadow offset translation
  })

  it('uses filterRes as the intermediate raster resolution', () => {
    const doc = parseSvg(`<svg viewBox="0 0 100 100" width="100" height="100">
      <defs><filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" filterRes="8 6">
        <feColorMatrix type="saturate" values="0.5"/>
      </filter></defs>
      <rect width="100" height="100" fill="#ff0000" filter="url(#f)"/>
    </svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(100, 100)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    expect(match).not.toBeNull()
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    expect({ width: image.width, height: image.height }).toEqual({ width: 8, height: 6 })
  })

  it('connects the target fill and stroke paints to filter standard inputs', () => {
    const doc = parseSvg(`<svg viewBox="0 0 20 20">
      <defs><filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
        <feMerge><feMergeNode in="FillPaint"/><feMergeNode in="StrokePaint"/></feMerge>
      </filter></defs>
      <rect width="20" height="20" fill="#00ff00" stroke="#0000ff" filter="url(#f)"/>
    </svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(20, 20)
    renderSvg(doc, backend, 0, 0, 20, 20)
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    const center = (10 * image.width + 10) * 4
    expect(Array.from(image.pixels.subarray(center, center + 4))).toEqual([0, 0, 255, 255])
  })

  it('includes descendant filters, clipping, masks, and group opacity in SourceGraphic', () => {
    const doc = parseSvg(`<svg viewBox="0 0 20 20">
      <defs>
        <filter id="outer" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
        </filter>
        <filter id="inner" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <feFlood flood-color="#00ff00"/>
        </filter>
        <clipPath id="clip"><rect x="0" y="0" width="15" height="20"/></clipPath>
        <mask id="mask" mask-type="alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect x="0" y="0" width="10" height="20" fill="#000000"/>
        </mask>
      </defs>
      <g filter="url(#outer)">
        <g opacity="0.5">
          <rect width="20" height="20" fill="#ff0000" filter="url(#inner)" clip-path="url(#clip)" mask="url(#mask)"/>
        </g>
      </g>
    </svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(20, 20)
    renderSvg(doc, backend, 0, 0, 20, 20)
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    const inside = (10 * image.width + 5) * 4
    const outside = (10 * image.width + 12) * 4
    expect(Array.from(image.pixels.subarray(inside, inside + 3))).toEqual([0, 255, 0])
    expect(image.pixels[inside + 3]).toBeCloseTo(128, -1)
    expect(image.pixels[outside + 3]).toBe(0)
  })

  it('connects BackgroundImage to the enable-background accumulation buffer', () => {
    const doc = parseSvg(`<svg viewBox="0 0 20 20">
      <defs>
        <filter id="background" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <feColorMatrix in="BackgroundImage"/>
        </filter>
      </defs>
      <g enable-background="new 0 0 20 20">
        <rect width="10" height="20" fill="#ff0000"/>
        <rect x="10" width="10" height="20" fill="#0000ff" filter="url(#background)"/>
      </g>
    </svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(20, 20)
    renderSvg(doc, backend, 0, 0, 20, 20)
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    const left = (10 * image.width + 5) * 4
    const right = (10 * image.width + 15) * 4
    expect(Array.from(image.pixels.subarray(left, left + 4))).toEqual([255, 0, 0, 255])
    expect(image.pixels[right + 3]).toBe(0)
  })

  it('includes marker artwork in a filtered SourceGraphic', () => {
    const doc = parseSvg(`<svg viewBox="0 0 20 20">
      <defs>
        <marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <rect width="6" height="6" fill="#ff0000"/>
        </marker>
        <filter id="identity" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20"><feColorMatrix/></filter>
      </defs>
      <g filter="url(#identity)"><line x1="2" y1="10" x2="15" y2="10" stroke="#000000" marker-end="url(#arrow)"/></g>
    </svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(20, 20)
    renderSvg(doc, backend, 0, 0, 20, 20)
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    const marker = (10 * image.width + 15) * 4
    expect(Array.from(image.pixels.subarray(marker, marker + 4))).toEqual([255, 0, 0, 255])
  })

  it('renders feImage fragment references with use coordinate semantics', () => {
    const doc = parseSvg(`<svg viewBox="0 0 20 20">
      <defs>
        <g id="image-fragment" transform="translate(2 3)"><rect width="5" height="4" fill="#00ff00"/></g>
        <filter id="fragment" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <feImage href="#image-fragment"/>
        </filter>
      </defs>
      <rect width="20" height="20" filter="url(#fragment)"/>
    </svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(20, 20)
    renderSvg(doc, backend, 0, 0, 20, 20)
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    const inside = (4 * image.width + 3) * 4
    const outside = (10 * image.width + 10) * 4
    expect(Array.from(image.pixels.subarray(inside, inside + 4))).toEqual([0, 255, 0, 255])
    expect(image.pixels[outside + 3]).toBe(0)
  })

  it('uses explicitly supplied external raster resources in filtered SVG content', () => {
    const png = encodePngRgba(1, 1, new Uint8Array([255, 128, 0, 255]))
    const resources = new Map([['asset.png', { data: png, mimeType: 'image/png' }]])
    const doc = parseSvg(`<svg viewBox="0 0 10 10"><defs>
      <filter id="resource" filterUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><feImage href="asset.png"/></filter>
    </defs><rect width="10" height="10" filter="url(#resource)"/></svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(10, 10)
    renderSvg(doc, backend, 0, 0, 10, 10, { imageResources: resources })
    backend.endPage(); backend.endDocument()
    const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
    const image = decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    expect(Array.from(image.pixels.subarray(0, 4))).toEqual([255, 128, 0, 255])
  })

  it('clips marker artwork to the marker viewport unless overflow is visible', () => {
    const renderMarker = (overflow: string): ReturnType<typeof decodePng> => {
      const doc = parseSvg(`<svg viewBox="0 0 20 20"><defs>
        <marker id="m" markerUnits="userSpaceOnUse" markerWidth="4" markerHeight="4" refX="0" refY="2" overflow="${overflow}">
          <rect width="8" height="4" fill="#ff0000"/>
        </marker>
        <filter id="identity" filterUnits="userSpaceOnUse" x="0" y="0" width="20" height="20"><feColorMatrix/></filter>
      </defs><g filter="url(#identity)"><line x1="2" y1="10" x2="10" y2="10" stroke="#000" marker-end="url(#m)"/></g></svg>`)
      const backend = new SvgBackend({ background: null })
      backend.beginDocument(); backend.beginPage(20, 20)
      renderSvg(doc, backend, 0, 0, 20, 20)
      backend.endPage(); backend.endDocument()
      const match = /data:image\/png;base64,([^"']+)/.exec(backend.getPages()[0]!)
      return decodePng(Uint8Array.from(Buffer.from(match![1]!, 'base64')))
    }
    const hidden = renderMarker('hidden')
    const visible = renderMarker('visible')
    expect(hidden.pixels[(10 * hidden.width + 12) * 4 + 3]).toBe(255)
    expect(hidden.pixels[(10 * hidden.width + 16) * 4 + 3]).toBe(0)
    expect(visible.pixels[(10 * visible.width + 16) * 4 + 3]).toBe(255)
  })

  it('rejects negative filterRes and suppresses zero filterRes output', () => {
    const negative = parseSvg(`<svg viewBox="0 0 10 10"><defs><filter id="f" filterRes="-1"><feFlood/></filter></defs><rect width="10" height="10" filter="url(#f)"/></svg>`)
    const backend = new SvgBackend({ background: null })
    backend.beginDocument(); backend.beginPage(10, 10)
    expect(() => renderSvg(negative, backend, 0, 0, 10, 10)).toThrow(/negative filterRes/)

    const zero = parseSvg(`<svg viewBox="0 0 10 10"><defs><filter id="f" filterRes="0"><feFlood/></filter></defs><rect width="10" height="10" filter="url(#f)"/></svg>`)
    const zeroBackend = new SvgBackend({ background: null })
    zeroBackend.beginDocument(); zeroBackend.beginPage(10, 10)
    renderSvg(zero, zeroBackend, 0, 0, 10, 10)
    zeroBackend.endPage(); zeroBackend.endDocument()
    expect(zeroBackend.getPages()[0]).not.toContain('data:image/png')
  })

  // Verifies that a degenerate line's objectBoundingBox filter region falls back to stroke-inclusive bounds.
  it('objectBoundingBox filter region uses stroke bounds on degenerate line geometry', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow" filterUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
          <feDropShadow dx="0" dy="0" stdDeviation="0"/>
        </filter>
      </defs>
      <line x1="50" y1="10" x2="50" y2="90" stroke="#ff0000" stroke-width="10" filter="url(#shadow)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    // Object bbox including the stroke: x=45..55, y=5..95 (stroke-width=10)
    expect(pdfStr).toContain('45 5 m')
    expect(pdfStr).toContain('55 95 l')
    expect(pdfStr).toContain('W n')
  })

  // Verifies that a group's objectBoundingBox filter region includes the stroke width of its children.
  it('objectBoundingBox filter region on group accounts for child stroke width', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow" filterUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
          <feDropShadow dx="0" dy="0" stdDeviation="0"/>
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <line x1="50" y1="10" x2="50" y2="90" stroke="#ff0000" stroke-width="10"/>
      </g>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('45 5 m')
    expect(pdfStr).toContain('55 95 l')
  })

  // Verifies that a drop-shadow filter on a group renders shadows plus both children's original fills.
  it('supports drop-shadow filter on group geometry', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs><filter id="shadow"><feDropShadow dx="2" dy="3" stdDeviation="0"/></filter></defs>
      <g filter="url(#shadow)">
        <rect x="10" y="10" width="20" height="20" fill="#ff0000"/>
        <circle cx="60" cy="20" r="10" fill="#0000ff"/>
      </g>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('0 g')
    expect(pdfStr).toContain('1 0 0 rg')
    expect(pdfStr).toContain('0 0 1 rg')
  })

  // Verifies that a group filter without a SourceGraphic merge suppresses the children's own fills.
  it('group filter without SourceGraphic merge renders shadow-only result', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="shadow">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0"/>
          <feOffset dx="2" dy="3"/>
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <rect x="10" y="10" width="20" height="20" fill="#ff0000"/>
      </g>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('0 g')
    expect(pdfStr).not.toContain('1 0 0 rg')
  })

  // Verifies that a general color-matrix filter is rasterized instead of rejected.
  it('renders a general color-matrix filter graph', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <filter id="f1"><feColorMatrix type="saturate" values="0"/></filter>
      </defs>
      <rect x="10" y="10" width="40" height="40" fill="#ff0000" filter="url(#f1)"/>
    </svg>`
    const doc = parseSvg(svg)
    const backend = new SvgBackend({ fonts: {}, background: null })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const output = backend.getPages()[0]!
    expect(output).toContain('data:image/png;base64,')
    expect(output).not.toContain('#ff0000')
  })

  // Verifies that marker-end renders the marker's own geometry (red arrowhead fill) at the line end.
  it('renders marker-end geometry', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <marker id="m1" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="#ff0000"/>
        </marker>
      </defs>
      <line x1="10" y1="50" x2="90" y2="50" stroke="#000" stroke-width="2" marker-end="url(#m1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()
    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that a clip-path reference adds a clip operation beyond the root viewport clip.
  it('applies clipPath to target geometry', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <clipPath id="c1">
          <circle cx="50" cy="50" r="25"/>
        </clipPath>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="#ff0000" clip-path="url(#c1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    // At least two clips: root clip + clipPath (count "W n" at line boundaries too)
    const clipOps = pdfStr
      .split('\n')
      .filter((line) => /\bW\*? n\b/.test(line))
    expect(clipOps.length).toBeGreaterThan(1)
    expect(pdfStr).toContain('1 0 0 rg')
  })

  // Verifies that the mask's x/y/width/height region rectangle is clipped before the mask content is applied.
  it('applies mask region geometry before mask content clip', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <mask id="m1" x="13" y="17" width="23" height="29" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="100" height="100" fill="#ffffff"/>
        </mask>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="#ff0000" mask="url(#m1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/BBox [13 17 36 46]')
    expect(pdfStr).toContain('/SMask')
    expect(pdfStr).toContain('/S /Luminosity')
  })

  // Verifies that a fully black luminance mask hides the masked content (no red fill emitted).
  it('treats black fill as transparent for luminance mask', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <mask id="m1">
          <rect x="0" y="0" width="100" height="100" fill="#000000"/>
        </mask>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="#ff0000" mask="url(#m1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).not.toContain('1 0 0 rg')
  })

  // Verifies that mask-type="alpha" keeps opaque-black content visible because alpha, not luminance, is used.
  it('uses alpha channel for mask-type="alpha" regardless of luminance', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <mask id="m1" mask-type="alpha">
          <rect x="0" y="0" width="100" height="100" fill="#000000"/>
        </mask>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="#ff0000" mask="url(#m1)"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('/SMask')
    expect(pdfStr).toContain('/S /Alpha')
  })

  // Verifies that fill-rule="evenodd" emits the even-odd fill operator f* for a path with a hole.
  it('honors fill-rule evenodd for path fill', () => {
    const svg = `<svg viewBox="0 0 100 100" width="100" height="100">
      <path fill="#000" fill-rule="evenodd" d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 70 30 L 70 70 L 30 70 Z"/>
    </svg>`
    const doc = parseSvg(svg)

    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 200)
    renderSvg(doc, backend, 0, 0, 100, 100)
    backend.endPage()
    backend.endDocument()

    const pdfStr = pdfToText(backend.toUint8Array())
    expect(pdfStr).toContain('f*')
  })
})
