// Device print-production ExtGState parameters (A6.4-A6.7): transfer function
// (/TR), black generation (/BG), undercolor removal (/UCR), and halftone (/HT).
// These affect device color separation, not the on-screen page, so preview
// backends ignore them; the PDF backend emits them as an ExtGState.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter, createReport, render } from '../../src/index.js'
import type { ReportTemplate, RenderDocument, RenderGroup } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'

function renderPdf(group: RenderGroup): string {
  const doc: RenderDocument = { pages: [{ width: 100, height: 100, children: [group] }] }
  const backend = new PdfBackend({ fonts: {} })
  render(doc, backend)
  return pdfToText(backend.toUint8Array())
}

function groupWith(deviceParams: RenderGroup['deviceParams']): RenderGroup {
  return {
    type: 'group', x: 0, y: 0, width: 100, height: 100, deviceParams,
    children: [{ type: 'rect', x: 10, y: 10, width: 30, height: 30, fill: '#808080' }],
  }
}

describe('Device ExtGState parameters (A6.4-A6.7)', () => {
  it('emits /TR /Identity and references the ExtGState with gs', () => {
    const text = renderPdf(groupWith({ transferFunction: 'Identity' }))
    expect(text).toContain('/TR /Identity')
    expect(text).toMatch(/\/GS\d+ gs/)
  })

  it('emits a transfer function as a FunctionType 4 calculator', () => {
    const text = renderPdf(groupWith({ transferFunction: { expression: '{ 1 exch sub }' } }))
    expect(text).toMatch(/\/TR \d+ 0 R/)
    expect(text).toContain('/FunctionType 4')
    expect(text).toContain('{ 1 exch sub }')
  })

  it('emits black generation and undercolor removal functions', () => {
    const text = renderPdf(groupWith({
      blackGeneration: { expression: '{ }' },
      undercolorRemoval: { expression: '{ 0 mul }' },
    }))
    expect(text).toMatch(/\/BG \d+ 0 R/)
    expect(text).toMatch(/\/UCR \d+ 0 R/)
  })

  it('emits /Default separation parameters as the /TR2 /BG2 /UCR2 variants', () => {
    const text = renderPdf(groupWith({ transferFunction: 'Default', blackGeneration: 'Default', undercolorRemoval: 'Default' }))
    expect(text).toContain('/TR2 /Default')
    expect(text).toContain('/BG2 /Default')
    expect(text).toContain('/UCR2 /Default')
  })

  it('emits /HT /Default', () => {
    const text = renderPdf(groupWith({ halftone: 'Default' }))
    expect(text).toContain('/HT /Default')
  })

  it('emits PDF 2.0 /UseBlackPtComp and promotes the header', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ useBlackPointCompensation: 'on' })] }] }, backend)
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text.slice(0, 8)).toBe('%PDF-2.0')
    expect(text).toContain('/UseBlackPtComp /ON')
  })

  it('emits /FL /SM /SA rendering hints', () => {
    const text = renderPdf(groupWith({ flatness: 25, smoothness: 0.5, strokeAdjustment: true }))
    expect(text).toContain('/FL 25')
    expect(text).toContain('/SM 0.5')
    expect(text).toContain('/SA true')
  })

  it('emits and imports PDF 2.0 /HTO halftone origin', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ halftoneOrigin: [7, 11] })] }] }, backend)
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text.slice(0, 8)).toBe('%PDF-2.0')
    expect(text).toContain('/HTO [7 11]')
    const page = PdfImporter.open(bytes).importPage(0)
    expect(findFrameWithDeviceParams(page.elements)!.deviceParams).toMatchObject({ halftoneOrigin: [7, 11] })
  })

  it('emits a type-1 halftone screen dictionary', () => {
    const text = renderPdf(groupWith({ halftone: { frequency: 60, angle: 45, spotFunction: 'Round' } }))
    expect(text).toMatch(/\/HT \d+ 0 R/)
    expect(text).toContain('/Type /Halftone')
    expect(text).toContain('/HalftoneType 1')
    expect(text).toContain('/Frequency 60')
    expect(text).toContain('/Angle 45')
    expect(text).toContain('/SpotFunction /Round')
  })

  it('emits and imports the Type 1 /AccurateScreens algorithm selection', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ halftone: { frequency: 60, angle: 45, spotFunction: 'Round', accurateScreens: true } })] }] }, backend)
    const bytes = backend.toUint8Array()
    expect(pdfToText(bytes)).toContain('/AccurateScreens true')
    const page = PdfImporter.open(bytes).importPage(0)
    expect(findFrameWithDeviceParams(page.elements)!.deviceParams).toMatchObject({
      halftone: { frequency: 60, angle: 45, spotFunction: 'Round', accurateScreens: true },
    })
  })

  it('emits a type-1 halftone with a calculator spot function', () => {
    const text = renderPdf(groupWith({ halftone: { frequency: 60, angle: 45, spotFunction: { expression: '{ dup mul exch dup mul add sqrt neg }' } } }))
    expect(text).toContain('/HalftoneType 1')
    expect(text).toMatch(/\/SpotFunction \d+ 0 R/)
    expect(text).toContain('/FunctionType 4')
    expect(text).toContain('/Domain [-1 1 -1 1]')
    expect(text).toContain('/Range [-1 1]')
  })

  it('emits a halftone /TransferFunction as a name and as a function', () => {
    const ident = renderPdf(groupWith({ halftone: { frequency: 60, angle: 45, spotFunction: 'Round', transferFunction: 'Identity' } }))
    expect(ident).toContain('/HalftoneType 1')
    expect(ident).toContain('/TransferFunction /Identity')
    const fn = renderPdf(groupWith({ halftone: { type: 6, width: 2, height: 2, thresholds: [0, 85, 170, 255], transferFunction: { expression: '{ 1 exch sub }' } } }))
    expect(fn).toContain('/HalftoneType 6')
    expect(fn).toMatch(/\/TransferFunction \d+ 0 R/)
  })

  it.each([
    { functionType: 0, domain: [0, 1], range: [0, 1], size: [2], bitsPerSample: 8, order: 1, encode: [0, 1], decode: [0, 1], data: new Uint8Array([0, 255]) },
    { functionType: 2, domain: [0, 1] as [number, number], range: [0, 1], c0: [0], c1: [1], exponent: 2 },
    { functionType: 3, domain: [0, 1] as [number, number], range: [0, 1], functions: [
      { functionType: 2, domain: [0, 1] as [number, number], c0: [0], c1: [0.5], exponent: 1 },
      { functionType: 2, domain: [0, 1] as [number, number], c0: [0.5], c1: [1], exponent: 1 },
    ], bounds: [0.5], encode: [0, 1, 0, 1] },
    { functionType: 4, domain: [0, 1], range: [0, 1], expression: '{ dup mul }' },
  ] satisfies import('../../src/types/template.js').PdfFunctionDef[])('emits FunctionType $functionType without lowering for /TR and halftone TransferFunction', (fn) => {
    const tr = renderPdf(groupWith({ transferFunction: fn }))
    expect(tr).toContain(`/FunctionType ${fn.functionType}`)
    const ht = renderPdf(groupWith({ halftone: { type: 6, width: 2, height: 2, thresholds: [0, 85, 170, 255], transferFunction: fn } }))
    expect(ht).toContain('/TransferFunction')
    expect(ht).toContain(`/FunctionType ${fn.functionType}`)
  })
})

describe('Device params template reachability', () => {
  it('a frame element carries deviceParams through the layout engine to the ExtGState', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 50,
          elements: [{
            type: 'frame', x: 10, y: 5, width: 200, height: 40,
            deviceParams: { transferFunction: { expression: '{ 1 exch sub }' }, halftone: { frequency: 53, angle: 0, spotFunction: 'Ellipse' } },
            elements: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 20, forecolor: '#808080' }],
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const backend = new PdfBackend({ fonts: {} })
    render(doc, backend)
    const text = pdfToText(backend.toUint8Array())
    expect(text).toMatch(/\/TR \d+ 0 R/)
    expect(text).toContain('/SpotFunction /Ellipse')
  })
})

describe('Device params PDF/A · PDF/X conformance', () => {
  it('PDF/A rejects transfer functions', () => {
    const backend = new PdfBackend({ fonts: {}, pdfaConformance: 'PDF/A-1b' })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ transferFunction: { expression: '{ 1 exch sub }' } })] }] }, backend)
    expect(() => backend.toUint8Array()).toThrow(/forbids ExtGState transfer functions/)

    const identity = new PdfBackend({ fonts: {}, pdfaConformance: 'PDF/A-1b' })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ transferFunction: 'Identity' })] }] }, identity)
    expect(() => identity.toUint8Array()).toThrow(/forbids ExtGState transfer functions/)
  })

  it('PDF/A allows black-generation, undercolor-removal, Default /TR2, and halftones', () => {
    const ok = new PdfBackend({ fonts: {}, pdfaConformance: 'PDF/A-1b' })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({
      transferFunction: 'Default',
      blackGeneration: { expression: '{ }' },
      undercolorRemoval: { expression: '{ 0 mul }' },
      halftone: { frequency: 53, angle: 0, spotFunction: 'Round' },
    })] }] }, ok)
    expect(() => ok.toUint8Array()).not.toThrow()
  })

  it('PDF/X rejects black-generation and undercolor-removal functions', () => {
    const bg = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ blackGeneration: { expression: '{ }' } })] }] }, bg)
    expect(() => bg.toUint8Array()).toThrow(/forbids ExtGState black-generation/)

    const ucr = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ undercolorRemoval: { expression: '{ 0 mul }' } })] }] }, ucr)
    expect(() => ucr.toUint8Array()).toThrow(/forbids ExtGState undercolor-removal/)
  })
})

describe('Device params import round-trip', () => {
  it('re-imports /TR /HT into a frame carrying deviceParams', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({
      transferFunction: { expression: '{ 1 exch sub }' },
      halftone: { frequency: 53, angle: 15, spotFunction: 'Ellipse' },
    })] }] }, backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const frame = findFrameWithDeviceParams(page.elements)
    expect(frame).not.toBeNull()
    const dp = frame!.deviceParams as { transferFunction?: { expression: string }, halftone?: { frequency: number, angle: number, spotFunction: string } }
    expect((dp.transferFunction as { expression: string }).expression).toContain('1 exch sub')
    expect(dp.halftone).toMatchObject({ frequency: 53, angle: 15, spotFunction: 'Ellipse' })
  })

  it('round-trips /UseBlackPtComp', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ useBlackPointCompensation: 'default' })] }] }, backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const frame = findFrameWithDeviceParams(page.elements)
    expect(frame!.deviceParams).toMatchObject({ useBlackPointCompensation: 'default' })
  })

  it('round-trips /FL /SM /SA rendering hints', () => {
    const backend = new PdfBackend({ fonts: {} })
    render({ pages: [{ width: 100, height: 100, children: [groupWith({ flatness: 10, smoothness: 0.25, strokeAdjustment: false })] }] }, backend)
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    expect(findFrameWithDeviceParams(page.elements)!.deviceParams).toMatchObject({ flatness: 10, smoothness: 0.25, strokeAdjustment: false })
  })
})

function findFrameWithDeviceParams(elements: unknown[]): (Record<string, unknown> & { deviceParams?: unknown }) | null {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (e.type === 'frame' && e.deviceParams) return e as never
    if (Array.isArray(e.elements)) {
      const inner = findFrameWithDeviceParams(e.elements as unknown[])
      if (inner) return inner
    }
  }
  return null
}

// Importing a type-2 (exponential) transfer function: converted losslessly to
// the equivalent type-4 calculator expression y = C0 + x^N × (C1 − C0).
import { PdfImporter as PdfImporter2 } from '../../src/index.js'
import { evaluateCalculatorSource, evaluateTransferFunctionDef } from '../../src/pdf/pdf-function.js'
import type { TransferFunctionDef } from '../../src/types/template.js'

function encLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF
  return out
}

function buildTransferFnPdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /TR 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0.1] /C1 [0.9] /N 2 >>\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function findFrameDp(elements: unknown[]): { transferFunction?: TransferFunctionDef | TransferFunctionDef[] | 'Identity' | 'Default' } | null {
  for (const el of elements) {
    const e = el as Record<string, unknown>
    if (e.type === 'frame' && e.deviceParams) return e.deviceParams as { transferFunction?: TransferFunctionDef | TransferFunctionDef[] | 'Identity' | 'Default' }
    const kids = (e.elements ?? e.children) as unknown[] | undefined
    if (Array.isArray(kids)) { const f = findFrameDp(kids); if (f) return f }
  }
  return null
}

describe('type-2 transfer function import', () => {
  it('retains an exponential /TR as FunctionType 2', () => {
    const page = PdfImporter2.open(buildTransferFnPdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[])
    const fn = dp!.transferFunction as TransferFunctionDef
    expect(fn).toMatchObject({ functionType: 2, exponent: 2 })
    // y = 0.1 + x^2 × 0.8 — evaluate at a few inputs.
    for (const [x, y] of [[0, 0.1], [0.5, 0.3], [1, 0.9]] as const) {
      expect(evaluateTransferFunctionDef(fn, x)).toBeCloseTo(y, 6)
    }
  })
})

// Importing a type-0 sampled transfer function retains its sample stream.
function buildSampledFnPdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const samples = String.fromCharCode(255, 128, 0) // 8-bit → decoded 1.0, 128/255, 0.0
  const fnDict = `<< /FunctionType 0 /Domain [0 1] /Size [3] /BitsPerSample 8 /Range [0 1] /Length ${samples.length} >>`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /TR 6 0 R >>\nendobj\n',
    `6 0 obj\n${fnDict}\nstream\n${samples}endstream\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('type-0 sampled transfer function import', () => {
  it('retains a sampled /TR as FunctionType 0', () => {
    const page = PdfImporter2.open(buildSampledFnPdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[])
    const fn = dp!.transferFunction as TransferFunctionDef
    expect(fn).toMatchObject({ functionType: 0, size: [3], bitsPerSample: 8 })
    const mid = 128 / 255
    // Decoded samples 1.0, 128/255, 0.0 at x = 0, 0.5, 1 with linear interpolation.
    for (const [x, y] of [[0, 1], [0.5, mid], [1, 0], [0.25, (1 + mid) / 2], [0.75, mid / 2]] as const) {
      expect(evaluateTransferFunctionDef(fn, x)).toBeCloseTo(y, 6)
    }
  })
})

// The /TR2 /BG2 /UCR2 variants supersede /TR /BG /UCR and accept /Default.
function buildTr2Pdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /TR 6 0 R /TR2 /Default /BG2 /Default /UCR 6 0 R /UCR2 /Default >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('secondary device parameters (/TR2 /BG2 /UCR2)', () => {
  it('prefers the -2 variant over the base key and captures /Default', () => {
    const page = PdfImporter2.open(buildTr2Pdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[]) as Record<string, unknown> | null
    // /TR2 /Default supersedes the /TR function; /BG2 and /UCR2 give /Default.
    expect(dp?.transferFunction).toBe('Default')
    expect(dp?.blackGeneration).toBe('Default')
    expect(dp?.undercolorRemoval).toBe('Default')
  })
})

// A type-1 halftone whose /SpotFunction is a calculator function (not a name).
function buildSpotFunctionPdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const spot = '{ dup mul exch dup mul add sqrt neg }'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /HT 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Halftone /HalftoneType 1 /Frequency 60 /Angle 45 /SpotFunction 7 0 R >>\nendobj\n',
    `7 0 obj\n<< /FunctionType 4 /Domain [-1 1 -1 1] /Range [-1 1] /Length ${spot.length} >>\nstream\n${spot}endstream\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('type-1 halftone with a calculator spot function import', () => {
  it('captures a function /SpotFunction as a calculator expression', () => {
    const page = PdfImporter2.open(buildSpotFunctionPdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[]) as Record<string, unknown> | null
    const ht = dp?.halftone as { frequency: number, angle: number, spotFunction: { expression: string } | string } | undefined
    expect(ht?.frequency).toBe(60)
    expect(ht?.angle).toBe(45)
    expect(typeof ht?.spotFunction === 'object' && ht.spotFunction.expression).toContain('sqrt neg')
  })
})

// A type-1 halftone dictionary carrying a /TransferFunction (name Identity).
function buildHtTransferPdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /HT 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Halftone /HalftoneType 1 /Frequency 60 /Angle 45 /SpotFunction /Round /TransferFunction /Identity >>\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('halftone /TransferFunction import', () => {
  it('captures a halftone dictionary /TransferFunction', () => {
    const page = PdfImporter2.open(buildHtTransferPdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[]) as Record<string, unknown> | null
    const ht = dp?.halftone as { spotFunction: string, transferFunction?: string } | undefined
    expect(ht?.spotFunction).toBe('Round')
    expect(ht?.transferFunction).toBe('Identity')
  })
})

// A type-3 (stitching) transfer function of two type-2 sub-functions is
// converted to a piecewise calculator expression.
function buildStitchingFnPdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /TR 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 3 /Domain [0 1] /Functions [7 0 R 8 0 R] /Bounds [0.5] /Encode [0 1 0 1] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [0.5] /N 1 >>\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('type-3 stitching transfer function import', () => {
  it('retains a piecewise /TR as FunctionType 3', () => {
    const page = PdfImporter2.open(buildStitchingFnPdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[])
    const fn = dp!.transferFunction as TransferFunctionDef
    expect(fn).toMatchObject({ functionType: 3, bounds: [0.5] })
    // Segment 0 (x<0.5): y = 2x. Segment 1 (x>=0.5): y = (2x-1)/2.
    for (const [x, y] of [[0.25, 0.5], [0.4, 0.8], [0.5, 0], [0.75, 0.25], [1, 0.5]] as const) {
      expect(evaluateTransferFunctionDef(fn, x)).toBeCloseTo(y, 6)
    }
  })
})

// A per-colorant /TR array of four functions is captured on import and
// re-emitted on output as a /TR array.
function buildPerChannelTrPdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const fn = '<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /TR [6 0 R 7 0 R 8 0 R 9 0 R] >>\nendobj\n',
    `6 0 obj\n${fn}\nendobj\n`, `7 0 obj\n${fn}\nendobj\n`, `8 0 obj\n${fn}\nendobj\n`, `9 0 obj\n${fn}\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('per-colorant /TR array', () => {
  it('imports a four-function /TR array without lowering', () => {
    const page = PdfImporter2.open(buildPerChannelTrPdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[]) as { transferFunction?: unknown }
    const tr = dp?.transferFunction
    expect(Array.isArray(tr)).toBe(true)
    expect((tr as unknown[]).length).toBe(4)
    for (const fn of tr as TransferFunctionDef[]) {
      expect(fn).toMatchObject({ functionType: 2 })
      expect(evaluateTransferFunctionDef(fn, 0.5)).toBeCloseTo(0.5, 6)
    }
  })

  it('emits a /TR array on output', () => {
    const expr = { expression: '{ 1 exch sub }' }
    const text = renderPdf(groupWith({ transferFunction: [expr, expr, expr, expr] }))
    expect(text).toMatch(/\/TR \[\d+ 0 R \d+ 0 R \d+ 0 R \d+ 0 R\]/)
  })
})

// Type-6 threshold-array halftone: captured on import, re-emitted as a halftone
// stream on output.
function buildType6HalftonePdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const thr = String.fromCharCode(64, 128, 192, 255) // 2x2 threshold bytes
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /HT 6 0 R >>\nendobj\n',
    `6 0 obj\n<< /Type /Halftone /HalftoneType 6 /Width 2 /Height 2 /Length 4 >>\nstream\n${thr}\nendstream\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('type-6 threshold halftone', () => {
  it('imports a threshold-array /HT with its dimensions and bytes', () => {
    const page = PdfImporter2.open(buildType6HalftonePdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[]) as { halftone?: { type?: number, width?: number, height?: number, thresholds?: number[] } }
    const ht = dp?.halftone
    expect(ht?.type).toBe(6)
    expect(ht?.width).toBe(2)
    expect(ht?.height).toBe(2)
    expect(ht?.thresholds).toEqual([64, 128, 192, 255])
  })

  it('emits a type-6 halftone stream on output', () => {
    const text = renderPdf(groupWith({ halftone: { type: 6, width: 2, height: 2, thresholds: [64, 128, 192, 255] } }))
    expect(text).toContain('/HalftoneType 6')
    expect(text).toMatch(/\/Width 2/)
    expect(text).toMatch(/\/Height 2/)
  })
})

// Type-5 per-colorant halftone: a dictionary of colorant → halftone (type 1/6).
function buildType5HalftonePdf(): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const ht1 = (a: number) => `<< /Type /Halftone /HalftoneType 1 /Frequency 60 /Angle ${a} /SpotFunction /Round >>`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /HT 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Halftone /HalftoneType 5 /Cyan 7 0 R /Magenta 8 0 R /Default 9 0 R >>\nendobj\n',
    `7 0 obj\n${ht1(15)}\nendobj\n`, `8 0 obj\n${ht1(75)}\nendobj\n`, `9 0 obj\n${ht1(45)}\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('type-5 per-colorant halftone', () => {
  it('imports a per-colorant /HT collection', () => {
    const page = PdfImporter2.open(buildType5HalftonePdf()).importPage(0)
    const dp = findFrameDp(page.elements as unknown[]) as { halftone?: { type?: number, halftones?: Array<{ colorant: string, halftone: { angle: number } }> } }
    const ht = dp?.halftone
    expect(ht?.type).toBe(5)
    const byColorant = new Map((ht!.halftones ?? []).map(e => [e.colorant, e.halftone.angle]))
    expect(byColorant.get('Cyan')).toBe(15)
    expect(byColorant.get('Magenta')).toBe(75)
    expect(byColorant.get('Default')).toBe(45)
  })

  it('emits a type-5 halftone dictionary with colorant references', () => {
    const screen = (angle: number) => ({ frequency: 60, angle, spotFunction: 'Round' })
    const text = renderPdf(groupWith({ halftone: { type: 5, halftones: [
      { colorant: 'Cyan', halftone: screen(15) },
      { colorant: 'Default', halftone: screen(45) },
    ] } }))
    expect(text).toContain('/HalftoneType 5')
    expect(text).toMatch(/\/Cyan \d+ 0 R/)
    expect(text).toMatch(/\/Default \d+ 0 R/)
  })
})

function buildHalftonePdf(htObj: string, dataBytes: number[]): Uint8Array {
  const content = '/GS1 gs 10 10 50 50 re f\n'
  const data = String.fromCharCode(...dataBytes)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /HT 6 0 R >>\nendobj\n',
    `6 0 obj\n${htObj} /Length ${dataBytes.length} >>\nstream\n${data}\nendstream\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return encLatin1(`%PDF-1.7\n${body}${xref}${trailer}`)
}

describe('type-10 / type-16 threshold halftones', () => {
  it('imports a type-10 angled threshold /HT (Xsquare²+Ysquare² bytes)', () => {
    // Xsquare 2, Ysquare 1 → 2*2 + 1*1 = 5 threshold bytes.
    const pdf = buildHalftonePdf('<< /Type /Halftone /HalftoneType 10 /Xsquare 2 /Ysquare 1', [10, 20, 30, 40, 50])
    const dp = findFrameDp(PdfImporter2.open(pdf).importPage(0).elements as unknown[]) as { halftone?: { type?: number, xsquare?: number, ysquare?: number, thresholds?: number[] } }
    expect(dp?.halftone?.type).toBe(10)
    expect(dp?.halftone?.xsquare).toBe(2)
    expect(dp?.halftone?.ysquare).toBe(1)
    expect(dp?.halftone?.thresholds).toEqual([10, 20, 30, 40, 50])
  })

  it('imports a type-16 16-bit threshold /HT', () => {
    // Width 2, Height 2 → 4 16-bit values → 8 bytes.
    const pdf = buildHalftonePdf('<< /Type /Halftone /HalftoneType 16 /Width 2 /Height 2', [0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0xFF, 0xFF])
    const dp = findFrameDp(PdfImporter2.open(pdf).importPage(0).elements as unknown[]) as { halftone?: { type?: number, width?: number, thresholds?: number[] } }
    expect(dp?.halftone?.type).toBe(16)
    expect(dp?.halftone?.width).toBe(2)
    expect(dp?.halftone?.thresholds).toEqual([256, 512, 768, 65535])
  })

  it('emits type-10 and type-16 halftone streams on output', () => {
    const t10 = renderPdf(groupWith({ halftone: { type: 10, xsquare: 2, ysquare: 1, thresholds: [10, 20, 30, 40, 50] } }))
    expect(t10).toContain('/HalftoneType 10')
    expect(t10).toMatch(/\/Xsquare 2/)
    const t16 = renderPdf(groupWith({ halftone: { type: 16, width: 2, height: 2, thresholds: [256, 512, 768, 65535] } }))
    expect(t16).toContain('/HalftoneType 16')
  })
})
