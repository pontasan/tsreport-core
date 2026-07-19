import { describe, expect, it, vi } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import { render, renderPage, renderToPdf } from '../../src/renderer/renderer.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import type { RenderPage } from '../../src/types/render.js'
import type { ReportTemplate } from '../../src/types/template.js'
import { pdfToText } from './pdf-test-utils.js'

describe('path-backed gradient shapes', () => {
  it('renders rectangle gradients as PDF axial shading', () => {
    const doc = createReport(gradientTemplate('rectangle'), { rows: [{}] })
    const pdf = renderToPdf(doc, { fonts: {} })
    const text = pdfToText(pdf)
    expect(text).toContain('/ShadingType 2')
    expect(text).toContain('/Pattern cs')
    expect(text).toContain('scn')
  })

  it('renders ellipse gradients as SVG radialGradient definitions', () => {
    const doc = createReport(gradientTemplate('ellipse'), { rows: [{}] })
    const backend = new SvgBackend({ background: null })
    render(doc, backend)
    const svg = backend.getPages()[0]!
    expect(svg).toContain('<radialGradient')
    expect(svg).toContain('<path d=')
  })

  it('routes rectangle gradients through Canvas createLinearGradient', () => {
    const gradient = { addColorStop: vi.fn() }
    const ctx = createMockCanvasContext(gradient)
    const page: RenderPage = {
      width: 100,
      height: 100,
      children: [{
        type: 'rect',
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        fill: {
          type: 'linear-gradient',
          x1: 10,
          y1: 20,
          x2: 40,
          y2: 20,
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 1, color: '#0000ff' },
          ],
        },
      }],
    }

    const backend = new CanvasBackend(ctx, { background: null })
    renderPage(page, backend)

    expect(ctx.createLinearGradient).toHaveBeenCalledWith(10, 20, 40, 20)
    expect(gradient.addColorStop).toHaveBeenCalledWith(0, '#ff0000')
    expect(gradient.addColorStop).toHaveBeenCalledWith(1, '#0000ff')
  })
})

function gradientTemplate(kind: 'rectangle' | 'ellipse'): ReportTemplate {
  return {
    page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{
        height: 100,
        elements: [{
          type: kind,
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          fill: kind === 'rectangle'
            ? {
                type: 'linearGradient',
                stops: [
                  { offset: 0, color: '#ff0000' },
                  { offset: 1, color: '#0000ff' },
                ],
              }
            : {
                type: 'radialGradient',
                stops: [
                  { offset: 0, color: '#ff0000' },
                  { offset: 1, color: '#0000ff' },
                ],
              },
        }],
      }],
    },
  }
}

function createMockCanvasContext(gradient: { addColorStop: ReturnType<typeof vi.fn> }) {
  const calls: [string, ...unknown[]][] = []
  return {
    canvas: { width: 0, height: 0, style: { width: '', height: '' } },
    _calls: calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
  }
}
