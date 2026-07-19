import { describe, expect, it } from 'vitest'
import { analyzePdfPageTransparency } from '../../src/pdf/pdf-transparency-analysis.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { importPdfPage } from '../../src/pdf/pdf-page-importer.js'
import { parsePdf } from '../../src/pdf/pdf-parser.js'
import { createReport } from '../../src/layout/engine.js'
import { renderToPdf } from '../../src/renderer/renderer.js'

const latin1 = new TextEncoder()

function stream(dictionary: string, content: string): string {
  return `<< ${dictionary}/Length ${latin1.encode(content).length} >>\nstream\n${content}endstream`
}

function buildPdf(objects: string[]): Uint8Array {
  const header = '%PDF-2.0\n'
  let body = ''
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(latin1.encode(header + body).length)
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = latin1.encode(header + body).length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  return latin1.encode(`${header}${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
}

function pagePdf(content: string, resources: string, extraObjects: string[] = [], annotations = ''): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources ${resources} /Contents 4 0 R${annotations} >>`,
    stream('', content),
    ...extraObjects,
  ])
}

describe('ISO 32000-2 Annex Q page transparency analysis', () => {
  it('reports an opaque page and ignores unused transparent resources', () => {
    const pdf = pagePdf(
      '0 0 10 10 re f\n',
      '<< /ExtGState << /Unused << /ca 0.1 /BM /Multiply >> >> /XObject << /UnusedForm 5 0 R >> >>',
      [stream('/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Group << /S /Transparency >> ', '')],
    )
    expect(analyzePdfPageTransparency(pdf, 0)).toEqual({ transparent: false, findings: [] })
  })

  it('checks the effective graphics state only when a graphical element is painted', () => {
    const resources = '<< /ExtGState << /Unused << /ca 0.1 >> /Used << /ca 0.5 /CA 0.25 /BM /Multiply /SMask << /S /Alpha /G 5 0 R >> >> >> >>'
    const maskGroup = stream('/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Group << /S /Transparency /I true >> ', '0 0 1 1 re f\n')
    const noPaint = pagePdf('/Unused gs\n', resources, [maskGroup])
    expect(analyzePdfPageTransparency(noPaint, 0)).toEqual({ transparent: false, findings: [] })

    const painted = pagePdf('/Unused gs q Q /Used gs 0 0 10 10 re B\n', resources, [maskGroup])
    const result = analyzePdfPageTransparency(painted, 0)
    expect(result.transparent).toBe(true)
    expect(result.findings.map(finding => finding.reason).sort()).toEqual([
      'non-normal-blend-mode',
      'non-unit-fill-alpha',
      'non-unit-stroke-alpha',
      'soft-mask',
    ])
  })

  it('recurses through tiling patterns, images, forms, Type3 CharProcs, and annotation appearances', () => {
    const resources = [
      '<<',
      '/Pattern << /P1 5 0 R >>',
      '/XObject << /Im1 6 0 R /Fm1 8 0 R >>',
      '/Font << /F3 9 0 R >>',
      '>>',
    ].join(' ')
    const pattern = stream(
      '/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1 /Resources << /ExtGState << /PGS << /ca 0.5 >> >> >> ',
      '/PGS gs 0 0 1 1 re f\n',
    )
    const image = stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /SMask 7 0 R ', '\u0000')
    const imageMask = stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 ', '\u00FF')
    const form = stream('/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Group << /S /Transparency >> /Resources << >> ', '')
    const type3 = '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [1 0 0 1 0 0] /CharProcs << /A 10 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [1] /Resources << /ExtGState << /TGS << /BM /Screen >> >> >> >>'
    const charProc = stream('', '/TGS gs 0 0 1 1 re f\n')
    const annotation = '<< /Type /Annot /Subtype /Square /Rect [0 0 10 10] /BM /Multiply /AP << /N << /On 12 0 R /Off 13 0 R >> >> >>'
    const transparentAppearance = stream('/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /ExtGState << /AGS << /CA 0.5 >> >> >> ', '/AGS gs 0 0 m 1 1 l S\n')
    const opaqueAppearance = stream('/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << >> ', '')
    const pdf = pagePdf(
      '/Pattern cs /P1 scn 0 0 10 10 re f /Im1 Do /Fm1 Do BT /F3 10 Tf (A) Tj ET\n',
      resources,
      [pattern, image, imageMask, form, type3, charProc, annotation, transparentAppearance, opaqueAppearance],
      ' /Annots [11 0 R]',
    )
    const reasons = analyzePdfPageTransparency(pdf, 0).findings.map(finding => finding.reason)
    expect(reasons).toContain('non-unit-fill-alpha')
    expect(reasons).toContain('image-soft-mask')
    expect(reasons).toContain('transparency-group')
    expect(reasons).toContain('non-normal-blend-mode')
    expect(reasons).toContain('annotation-blend-mode')
    expect(reasons).toContain('non-unit-stroke-alpha')
  })

  it('detects JPEG 2000 alpha embedded through SMaskInData', () => {
    const pdf = pagePdf(
      '/Im1 Do\n',
      '<< /XObject << /Im1 5 0 R >> >>',
      [stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /SMaskInData 1 ', '\u0000')],
    )
    expect(analyzePdfPageTransparency(pdf, 0).findings).toEqual([
      { reason: 'image-smask-in-data', location: 'page 1 content 1 Image Im1' },
    ])
  })

  it('round-trips alpha-is-shape and text-knockout through import, layout, and PDF output', () => {
    const input = pagePdf(
      '/GS1 gs 0 0 10 10 re f\n',
      '<< /ExtGState << /GS1 << /AIS true /TK false >> >> >>',
    )
    const imported = importPdfPage(input, 0)
    expect(imported.elements[0]).toMatchObject({ alphaIsShape: true, textKnockout: false })
    const report = createReport({
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: 100, elements: imported.elements }] },
    }, { rows: [{}] })
    const output = renderToPdf(report, { fonts: {} })
    const parsed = parsePdf(output)
    const page = collectPdfPages(parsed)[0]!
    const resources = parsed.resolve(page.resources) as Map<string, unknown>
    const extGState = parsed.resolve(resources.get('ExtGState') as never) as Map<string, unknown>
    const states = Array.from(extGState.values()).map(value => parsed.resolve(value as never) as Map<string, unknown>)
    expect(states.some(state => state.get('AIS') === true && state.get('TK') === false)).toBe(true)
  })

  it('rejects changing text-knockout inside a text object', () => {
    const input = pagePdf(
      'BT /GS1 gs ET\n',
      '<< /ExtGState << /GS1 << /TK false >> >> >>',
    )
    expect(() => importPdfPage(input, 0)).toThrow(/TK may not be set inside a text object/)
  })

  it('validates the requested page index', () => {
    const pdf = pagePdf('', '<< >>')
    expect(() => analyzePdfPageTransparency(pdf, 1)).toThrow(/page index 1 out of range/)
  })
})
