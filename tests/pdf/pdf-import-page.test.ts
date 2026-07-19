import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPdfXmpPacket, createReport, Font, PdfBackend, PdfImporter, importPdfPage, renderToPdf, TextMeasurer, type PdfImportProgressStage } from '../../src/index.js'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'
import { decodePng } from '../../src/image/png-parser.js'
import type { ElementDef, FillDef, FrameDef, ImageDef, PathDef, StaticTextDef } from '../../src/types/template.js'
import { evaluateCalculatorSource, evaluateTransferFunctionDef } from '../../src/pdf/pdf-function.js'
import { decodeJbig2 } from '../../src/compression/jbig2-decoder.js'
import { decodeJpx } from '../../src/compression/jpx-decoder.js'
import { pdfToText } from '../renderer/pdf-test-utils.js'
import { parsePdf, type PdfDict } from '../../src/pdf/pdf-parser.js'
import { simpleFontGlyphName } from '../../src/pdf/pdf-encoding.js'
import { generateCmykIccProfile } from '../../src/renderer/icc-profile.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')
let font: Font
let fontBytes: Uint8Array
let cffOpenTypeBytes: Uint8Array
let bareCffBytes: Uint8Array
let symbolicTrueTypeBytes: Uint8Array

function displayFill(fill: FillDef | undefined): string | undefined {
  if (typeof fill === 'string' || fill === undefined) return fill
  return fill.type === 'pdfSpecialColor' ? fill.displayColor : undefined
}

beforeAll(() => {
  const buffer = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  fontBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  font = Font.load(buffer.buffer as ArrayBuffer)
  symbolicTrueTypeBytes = makeWindowsSymbolFont(fontBytes)
  const cffBuffer = readFileSync(join(FIXTURES, 'SourceSans3-Regular.otf'))
  cffOpenTypeBytes = new Uint8Array(cffBuffer.buffer, cffBuffer.byteOffset, cffBuffer.byteLength)
  bareCffBytes = sfntTableBytes(cffOpenTypeBytes, 'CFF ')
})

describe('PDF page importer', () => {
  it('interprets PDF/X DeviceCMYK through the OutputIntent A2B transform', () => {
    const profile = constantA2bClut(generateCmykIccProfile(), [255, 128, 128])
    const backend = new PdfBackend({
      fonts: {},
      pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: { data: profile, outputConditionIdentifier: 'CONSTANT-WHITE' },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 40, 30, { fill: 'cmyk(100,0,0,0)' })
    backend.endPage()
    backend.endDocument()

    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    expect(displayFill(collectPaths(page.elements)[0]!.fill)).toBe('#ffffff')
  })

  it('requires an explicit profile resolver for a registered PDF/X output condition', () => {
    const content = '1 0 0 0 k 10 10 40 30 re f\n'
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OutputIntents [5 0 R] >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (CGATS-TR-001) /RegistryName (http://www.color.org) >>\nendobj\n',
    ])
    const importer = PdfImporter.open(pdf)
    expect(() => importer.importPage(0)).toThrow(/requires pdfxOutputProfileResolver/)

    let resolvedRegistry = ''
    const page = importer.importPage(0, {
      pdfxOutputProfileResolver: function (condition) {
        resolvedRegistry = `${condition.registryName}|${condition.outputConditionIdentifier}`
        return constantA2bClut(generateCmykIccProfile(), [255, 128, 128])
      },
    })
    expect(resolvedRegistry).toBe('http://www.color.org|CGATS-TR-001')
    expect(displayFill(collectPaths(page.elements)[0]!.fill)).toBe('#ffffff')
  })

  it('propagates the PDF/X OutputIntent transform to shadings and image samples', () => {
    const profile = constantA2bClut(generateCmykIccProfile(), [255, 128, 128])
    const pixel = encodePngRgba(1, 1, new Uint8Array([255, 0, 0, 255]))
    const backend = new PdfBackend({
      fonts: {}, images: { pixel }, pdfxConformance: 'PDF/X-1a',
      pdfxOutputProfile: { data: profile, outputConditionIdentifier: 'CONSTANT-WHITE' },
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(
      new Uint8Array([0, 1, 1, 1, 3]),
      new Float32Array([0, 0, 50, 0, 50, 50, 0, 50]),
      {
        fill: {
          type: 'linear-gradient', x1: 0, y1: 0, x2: 50, y2: 0,
          stops: [
            { offset: 0, color: 'cmyk(100,0,0,0)' },
            { offset: 1, color: 'cmyk(0,100,0,0)' },
          ],
        },
      },
    )
    backend.drawImage(60, 10, 20, 20, 'pixel')
    backend.endPage()
    backend.endDocument()

    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const gradient = collectPaths(page.elements).find(function (path) {
      return typeof path.fill !== 'string' && path.fill?.type === 'linearGradient'
    })?.fill
    if (typeof gradient === 'string' || gradient?.type !== 'linearGradient') throw new Error('expected imported gradient')
    expect(gradient.stops.map(function (stop) { return stop.color })).toEqual(['#ffffff', '#ffffff'])
    const image = collectImages(page.elements)[0]
    if (image === undefined || image.source === undefined) throw new Error('expected imported image')
    const decoded = decodePng(page.images[image.source]!)
    expect(Array.from(decoded.pixels.subarray(0, 4))).toEqual([255, 255, 255, 255])
  })

  it('ignores unknown operators only inside a BX/EX compatibility section', () => {
    const compatible = buildContentPdf('BX 12 /FutureValue FutureOperator EX 10 10 m 30 10 l S')
    expect(() => importPdfPage(compatible, 0)).not.toThrow()

    const outside = buildContentPdf('12 /FutureValue FutureOperator')
    expect(() => importPdfPage(outside, 0)).toThrow(/unsupported content operator FutureOperator/)

    const unmatchedEnd = buildContentPdf('EX')
    expect(() => importPdfPage(unmatchedEnd, 0)).toThrow(/EX without a matching BX/)

    const unterminated = buildContentPdf('BX FutureOperator')
    expect(() => importPdfPage(unterminated, 0)).toThrow(/unterminated BX/)
  })

  it('enforces text-object operator boundaries', () => {
    expect(() => importPdfPage(buildContentPdf('<41> Tj'), 0)).toThrow(/Tj requires a text object/)
    expect(() => importPdfPage(buildContentPdf('BT 0 g ET'), 0)).not.toThrow()
    expect(() => importPdfPage(buildContentPdf('BT 0 0 m ET'), 0)).toThrow(/m is not permitted inside a text object/)
    expect(() => importPdfPage(buildContentPdf('BT BT ET'), 0)).toThrow(/BT is not permitted inside a text object/)
    expect(() => importPdfPage(buildContentPdf('BT'), 0)).toThrow(/unterminated BT/)
  })

  it('retains text-state operators set outside a text object', () => {
    const page = importPdfPage(buildSimpleFontStreamPdf(
      '/F1 10 Tf 1 Tc 2 Tw 80 Tz 20 TL 0 Tr 3 Ts BT 10 80 Td <41> Tj T* <42> Tj ET',
    ), 0)
    const texts = collectStaticTexts(page.elements)
    expect(texts.map(function (text) { return text.text })).toEqual(['A', 'B'])
    expect(texts[1]!.y - texts[0]!.y).toBeCloseTo(20, 6)
  })

  it('rejects missing and extra operands for fixed-arity content operators', () => {
    expect(() => importPdfPage(buildContentPdf('10 m'), 0)).toThrow(/operator m requires 2 operands, got 1/)
    expect(() => importPdfPage(buildContentPdf('10 20 30 m'), 0)).toThrow(/operator m requires 2 operands, got 3/)
    expect(() => importPdfPage(buildContentPdf('1 q'), 0)).toThrow(/operator q requires 0 operands, got 1/)
  })

  it('preserves marked-content ActualText separately from visible glyph text', () => {
    const page = importPdfPage(buildActualTextPdf('<< /ActualText <FEFF03A9> >>'), 0)
    expect(collectStaticTexts(page.elements)[0]).toMatchObject({ text: 'A', actualText: 'Ω' })
    expect(() => importPdfPage(buildActualTextPdf('<< /ActualText 42 >>'), 0)).toThrow(/ActualText must be a string/)
  })

  it('imports Type0 text through ToUnicode CMap', () => {
    const doc = createReport({
      page: { width: 240, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            { type: 'staticText', x: 30, y: 40, width: 160, height: 20, text: 'Hello PDF' },
          ],
        }],
      },
    }, { rows: [{}] }, { fontMap: new Map([['default', new TextMeasurer(font)]]) })
    const pdf = renderToPdf(doc, { fonts: { default: font } })

    const page = importPdfPage(pdf, 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: 'Hello PDF', x: 30 })
    expect(text!.y).toBeGreaterThan(35)
    expect(text!.y).toBeLessThan(45)
    expect(page.fonts.length).toBe(1)
    expect(page.fonts[0]).toMatchObject({ familyName: expect.stringContaining('Roboto'), subtype: 'Type0' })
    expect(page.fonts[0]!.fontFile!.byteLength).toBeGreaterThan(0)
  })

  it('imports Standard Security Handler encrypted pages with a password', () => {
    const doc = createReport({
      page: { width: 240, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            { type: 'staticText', x: 30, y: 40, width: 160, height: 20, text: 'Encrypted Page' },
          ],
        }],
      },
    }, { rows: [{}] }, { fontMap: new Map([['default', new TextMeasurer(font)]]) })
    const pdf = renderToPdf(doc, {
      fonts: { default: font },
      encryption: { userPassword: 'secret', ownerPassword: 'owner', method: 'aes-256' },
    })

    expect(() => importPdfPage(pdf, 0)).toThrow(/password/)
    const page = importPdfPage(pdf, 0, { password: 'secret' })
    expect(collectStaticTexts(page.elements)[0]).toMatchObject({ type: 'staticText', text: 'Encrypted Page', x: 30 })
  })

  it('reports progress while opening and importing a page', () => {
    const doc = createReport({
      page: { width: 240, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            { type: 'staticText', x: 30, y: 40, width: 160, height: 20, text: 'Progress Page' },
          ],
        }],
      },
    }, { rows: [{}] }, { fontMap: new Map([['default', new TextMeasurer(font)]]) })
    const pdf = renderToPdf(doc, { fonts: { default: font } })
    const stages: PdfImportProgressStage[] = []

    const importer = PdfImporter.open(pdf, {
      onProgress(progress) {
        stages.push(progress.stage)
        expect(progress.done).toBeGreaterThanOrEqual(0)
        expect(progress.total).toBeGreaterThan(0)
      },
    })
    importer.importPage(0, {
      onProgress(progress) {
        stages.push(progress.stage)
        expect(progress.done).toBeGreaterThanOrEqual(0)
        expect(progress.total).toBeGreaterThan(0)
      },
    })

    expect(stages).toContain('open-parse')
    expect(stages).toContain('open-pages')
    expect(stages).toContain('page-contents')
    expect(stages).toContain('page-interpret')
    expect(stages).toContain('page-complete')
  })

  it('tolerates a degenerate (zero-area) image CTM instead of failing the page', () => {
    const pixel = zlibDeflate(new Uint8Array([255, 0, 0])) // 1x1 red RGB
    const binary = Array.from(pixel, b => String.fromCharCode(b)).join('')
    // The image is drawn with a zero y-scale CTM, collapsing it to a line.
    const content = 'q 20 0 0 0 5 5 cm /Im0 Do Q'
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Length ${binary.length} >>\nstream\n${binary}endstream\nendobj\n`,
    ]
    let offset = '%PDF-1.7\n'.length
    const offsets: number[] = [0]
    let body = ''
    for (const o of objects) { offsets.push(offset); body += o; offset += o.length }
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
    const pdf = enc(`%PDF-1.7\n${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
    // Import must succeed; the collapsed image has zero height (invisible).
    const page = importPdfPage(pdf, 0)
    const image = page.elements.find((e): e is Extract<ElementDef, { type: 'image' }> => e.type === 'image')
    expect(image?.height).toBe(0)
  })

  it('imports semi-transparent text (ExtGState /ca) as an opacity frame', () => {
    const page = importPdfPage(buildFadedTextPdf(), 0)
    const frame = page.elements.find((e): e is Extract<ElementDef, { type: 'frame' }> =>
      e.type === 'frame' && (e as { opacity?: number }).opacity !== undefined)
    expect(frame?.opacity).toBeCloseTo(0.4, 5)
    const text = collectStaticTexts(frame!.elements ?? [])[0]
    expect(text).toMatchObject({ type: 'staticText', text: 'Faded' })
  })

  it('imports simple font text through WinAnsiEncoding without ToUnicode', () => {
    const pdf = buildSimpleFontTextPdf('/WinAnsiEncoding', '<8041>')

    const page = importPdfPage(pdf, 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: '€A' })
    expect(page.styles.find(s => s.name === text!.style)).toMatchObject({ fontFamily: 'Helvetica', fontSize: 12 })
  })

  it('uses the complete PDF WinAnsiEncoding including reserved bullet slots and duplicate glyph names', () => {
    const pdf = buildSimpleFontTextPdf('/WinAnsiEncoding', '<7F818D8F909DA0AD>')
    const page = importPdfPage(pdf, 0)
    expect(collectStaticTexts(page.elements)[0]!.text).toBe('\u2022\u2022\u2022\u2022\u2022\u2022\u00A0\u00AD')

    const doc = parsePdf(pdf)
    const font = doc.getObject(5) as PdfDict
    expect([0x7F, 0x81, 0x8D, 0x8F, 0x90, 0x9D].map(code => simpleFontGlyphName(doc, font, code)))
      .toEqual(new Array(6).fill('bullet'))
    expect(simpleFontGlyphName(doc, font, 0xA0)).toBe('space')
    expect(simpleFontGlyphName(doc, font, 0xAD)).toBe('hyphen')
  })

  it('uses PDF\'s frozen MacRomanEncoding and its nonbreaking-space glyph slot', () => {
    const pdf = buildSimpleFontTextPdf('/MacRomanEncoding', '<80C6CADB>')
    const page = importPdfPage(pdf, 0)
    expect(collectStaticTexts(page.elements)[0]!.text).toBe('\u00C4\u2206\u00A0\u00A4')

    const doc = parsePdf(pdf)
    const font = doc.getObject(5) as PdfDict
    expect(simpleFontGlyphName(doc, font, 0xCA)).toBe('space')
    expect(simpleFontGlyphName(doc, font, 0xDB)).toBe('currency')
  })

  it('applies named encodings to MMType1 and nonsymbolic TrueType simple fonts', () => {
    const multipleMaster = importPdfPage(buildSimpleFontTextPdf('/WinAnsiEncoding', '<8041>', 'MMType1'), 0)
    expect(collectStaticTexts(multipleMaster.elements)[0]!.text).toBe('\u20ACA')
    const trueType = importPdfPage(buildSimpleFontTextPdf('/MacRomanEncoding', '<80C6>', 'TrueType', 32), 0)
    expect(collectStaticTexts(trueType.elements)[0]!.text).toBe('\u00C4\u2206')
  })

  it.each([
    ['bare CFF', 'Type1C', () => bareCffBytes],
    ['CFF OpenType', 'OpenType', () => cffOpenTypeBytes],
  ])('maps and executes embedded %s simple-font outlines', (_label, fontFileSubtype, bytes) => {
    const page = importPdfPage(buildEmbeddedSimpleCffClipPdf(bytes(), fontFileSubtype), 0)
    const frame = collectFrames(page.elements)[0]!
    expect(frame.clipPath?.d).toContain('Z')
    expect(frame.width).toBeGreaterThan(10)
    expect(collectPaths(frame.elements)[0]).toMatchObject({ fill: '#0000ff' })
  })

  it('maps an embedded nonsymbolic TrueType simple font through its Windows Unicode cmap', () => {
    const page = importPdfPage(buildEmbeddedSimpleTrueTypeClipPdf(), 0)
    const frame = collectFrames(page.elements)[0]!
    expect(frame.clipPath?.d).toContain('Z')
    expect(frame.width).toBeGreaterThan(10)
  })

  it('ignores Encoding and maps bytes directly through an embedded symbolic TrueType cmap', () => {
    const page = importPdfPage(buildEmbeddedSimpleTrueTypeClipPdf(symbolicTrueTypeBytes, 4), 0)
    const frame = collectFrames(page.elements)[0]!
    expect(frame.clipPath?.d).toContain('Z')
    expect(frame.width).toBeGreaterThan(10)
  })

  it('rejects FontFile3 programs whose subtype is outside the PDF font-file set', () => {
    expect(() => importPdfPage(buildEmbeddedSimpleCffClipPdf(cffOpenTypeBytes, 'FutureFont'), 0))
      .toThrow(/unsupported FontFile3 Subtype \/FutureFont/)
  })

  it('rejects malformed simple-font encoding dictionaries independently of unknown glyph names', () => {
    expect(() => importPdfPage(buildSimpleFontTextPdf('<< /Differences [/A] >>', '<41>'), 0))
      .toThrow(/Differences name has no code/)
    expect(() => importPdfPage(buildSimpleFontTextPdf('<< /Differences [256 /A] >>', '<41>'), 0))
      .toThrow(/Differences code must be an integer from 0 to 255/)
    expect(() => importPdfPage(buildSimpleFontTextPdf('<< /Differences [255 /A /B] >>', '<41>'), 0))
      .toThrow(/Differences name has no code/)
    expect(() => importPdfPage(buildSimpleFontTextPdf('/StandardEncoding', '<41>'), 0))
      .toThrow(/unsupported simple font encoding \/StandardEncoding/)
    expect(() => importPdfPage(buildSimpleFontTextPdf('<< /Type /Font /Differences [65 /A] >>', '<41>'), 0))
      .toThrow(/Encoding dictionary Type must be \/Encoding/)
  })

  it('imports simple font text through Encoding Differences without ToUnicode', () => {
    const pdf = buildSimpleFontTextPdf('<< /BaseEncoding /WinAnsiEncoding /Differences [65 /Euro /A] >>', '<4142>')

    const page = importPdfPage(pdf, 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: '€A' })
    expect(page.styles.find(s => s.name === text!.style)).toMatchObject({ fontFamily: 'Helvetica', fontSize: 12 })
  })

  it('imports simple font text through MacExpertEncoding without ToUnicode', () => {
    const pdf = buildSimpleFontTextPdf('/MacExpertEncoding', '<565761>')

    const page = importPdfPage(pdf, 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: '\uFB00\uFB01\uF761' })
  })

  it('imports expert glyph names from Encoding Differences without ToUnicode', () => {
    const pdf = buildSimpleFontTextPdf('<< /BaseEncoding /WinAnsiEncoding /Differences [65 /zerooldstyle /oneeighth /ffl] >>', '<414243>')

    const page = importPdfPage(pdf, 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: '\uF730\u215B\uFB04' })
  })

  it('uses simple font Widths and TJ adjustments for imported text width', () => {
    const page = importPdfPage(buildSimpleFontWidthPdf(), 0)
    const texts = collectStaticTexts(page.elements)
    expect(texts[0]).toMatchObject({ text: 'AB', width: 10 })
    // Kerning-scale TJ adjustment (0.1em) stays merged with reduced width
    expect(texts[1]).toMatchObject({ text: 'AB', width: 9 })
    // Positioning-scale TJ adjustment (0.3em) splits into separate elements
    expect(texts[2]).toMatchObject({ text: 'A' })
    expect(texts[3]).toMatchObject({ text: 'B' })
    // A advance (250/1000*10 = 2.5pt) plus the 3pt adjustment gap
    expect(texts[3]!.x - texts[2]!.x).toBeCloseTo(5.5, 5)
  })

  it('preserves Tz as horizontalScale on imported text', () => {
    const page = importPdfPage(buildSimpleFontHorizontalScalePdf(), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ text: 'AB', width: 8, horizontalScale: 0.8, baselineOffset: 10 })
  })

  it('keeps Tc and Tw unscaled so template layout applies Tz exactly once', () => {
    const pageStream = 'BT /F1 10 Tf 2 Tc 3 Tw 80 Tz 10 50 Td <412042> Tj ET'
    const page = importPdfPage(buildSimpleFontStreamPdf(pageStream), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ text: 'A B', horizontalScale: 0.8, letterSpacing: 2, wordSpacing: 3 })
    // The importer keeps the PDF text cursor's authoritative scaled advance;
    // the exact base glyph widths come from the fixture's simple font.
    expect(text!.width).toBeCloseTo(15.2, 5)
  })

  it('merges adjacent show-text runs on the same baseline into one staticText', () => {
    // Two Tj runs positioned back to back plus a distant third run
    const pageStream = 'BT /F1 10 Tf 10 50 Td <41> Tj <42> Tj 30 0 Td <41> Tj ET'
    const page = importPdfPage(buildSimpleFontStreamPdf(pageStream), 0)
    const texts = collectStaticTexts(page.elements)
    expect(texts.length).toBe(2)
    expect(texts[0]).toMatchObject({ text: 'AB', x: 10, width: 10 })
    expect(texts[1]).toMatchObject({ text: 'A' })
  })

  it('derives the effective font size from the text and transformation matrices', () => {
    // Tf size 1 scaled up by the text matrix, as emitted by scale-based writers
    const pageStream = 'BT /F1 1 Tf 8 0 0 8 10 50 Tm <4142> Tj ET'
    const page = importPdfPage(buildSimpleFontStreamPdf(pageStream), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(page.styles.find(s => s.name === text!.style)).toMatchObject({ fontSize: 8 })
    expect(text!.width).toBeCloseTo(8, 5)
    expect(text!.height).toBeCloseTo(9.6, 5)
  })

  it('imports arbitrary-angle text as a rotated frame containing staticText', () => {
    const page = importPdfPage(buildArbitraryAngleSimpleTextPdf(), 0)
    const frame = collectFrames(page.elements)[0]!
    expect(frame).toMatchObject({
      type: 'frame',
      rotationOriginX: 0,
    })
    expect(frame.x).toBeCloseTo(30, 5)
    expect(frame.y).toBeCloseTo(40, 5)
    expect(frame.width).toBeCloseTo(10, 5)
    expect(frame.height).toBeCloseTo(12, 5)
    expect(frame.rotation).toBeCloseTo(30, 5)
    expect(frame.rotationOriginY).toBeCloseTo(10, 5)
    const text = collectStaticTexts(page.elements)[0]!
    expect(text).toMatchObject({ type: 'staticText', text: 'AB', x: 0, y: 0 })
    expect(text.width).toBeCloseTo(10, 5)
    expect(text.height).toBeCloseTo(12, 5)
    expect(text.rotation).toBeUndefined()
  })

  it('imports Type3 CharProcs as painted path content', () => {
    const page = importPdfPage(buildType3CharProcPdf(), 0)
    expect(collectStaticTexts(page.elements).length).toBe(0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ type: 'path', x: 10, y: 43, width: 5, height: 7, fill: '#ff0000' })
  })

  it('executes Type3 CharProc painting unchanged in every text rendering mode', () => {
    for (let renderMode = 0; renderMode <= 7; renderMode++) {
      const page = importPdfPage(buildType3CharProcPdf('500 0 0 0 500 700 d1 0 0 500 700 re f', renderMode), 0)
      expect(collectPaths(page.elements)[0]).toMatchObject({ fill: '#ff0000', width: 5, height: 7 })
      expect(collectFrames(page.elements)).toHaveLength(0)
    }
  })

  it('enforces Type3 d0/d1 colour and declaration semantics', () => {
    const coloured = importPdfPage(buildType3CharProcPdf('500 0 d0 0 0 1 rg 0 0 500 700 re f'), 0)
    expect(collectPaths(coloured.elements)[0]).toMatchObject({ fill: '#0000ff' })

    expect(() => importPdfPage(buildType3CharProcPdf('500 0 0 0 500 700 d1 0 0 1 rg 0 0 500 700 re f'), 0))
      .toThrow(/uncoloured Type3 CharProc.*cannot use colour operator rg/)
    expect(() => importPdfPage(buildType3CharProcPdf('0 0 500 700 re f'), 0))
      .toThrow(/Type3 CharProc must begin with d0 or d1/)
    expect(() => importPdfPage(buildType3CharProcPdf('500 0 d0 500 0 d0'), 0))
      .toThrow(/may declare d0 or d1 only once/)
    expect(() => importPdfPage(buildSimpleFontStreamPdf('500 0 d0'), 0))
      .toThrow(/d0 is only valid in a Type3 CharProc/)
  })

  it('applies embedded-font glyph outlines as the clipping path after ET', () => {
    const page = importPdfPage(buildEmbeddedTextClipPdf(), 0)
    expect(collectStaticTexts(page.elements)).toHaveLength(0)
    const frame = collectFrames(page.elements)[0]!
    expect(frame.clipPath?.d).toContain('Z')
    expect((frame.clipPath?.d.match(/M/g) ?? [])).toHaveLength(2)
    expect(frame.width).toBeGreaterThan(5)
    expect(frame.width).toBeLessThan(40)
    expect(collectPaths(frame.elements)[0]).toMatchObject({ fill: '#0000ff' })
  })

  it('paints and then clips for text rendering mode 4', () => {
    const page = importPdfPage(buildEmbeddedTextClipPdf(4), 0)
    expect(collectStaticTexts(page.elements)[0]).toMatchObject({ text: 'A' })
    expect(collectFrames(page.elements)[0]!.clipPath?.d).toContain('Z')
  })

  it('uses the public font resolver for clipping with a non-embedded font', () => {
    const requests: string[] = []
    const page = importPdfPage(buildUnembeddedSimpleTextClipPdf(), 0, {
      fontResolver(info) {
        requests.push(`${info.baseFont}|${info.subtype}`)
        return { data: fontBytes, format: 'truetype' }
      },
    })
    expect(requests).toEqual(['Helvetica|Type1'])
    const frame = collectFrames(page.elements)[0]!
    expect(frame.clipPath?.d).toContain('Z')
    expect(collectPaths(frame.elements)[0]).toMatchObject({ fill: '#0000ff' })
  })

  it('preserves stroke and fill-stroke text paint modes', () => {
    const stroke = collectStaticTexts(importPdfPage(buildEmbeddedTextClipPdf(1), 0).elements)[0]!
    expect(stroke).toMatchObject({ text: 'A', forecolor: '#00ff00', textPaintMode: 'stroke', textStrokeColor: '#00ff00', textStrokeWidth: 2 })
    const both = collectStaticTexts(importPdfPage(buildEmbeddedTextClipPdf(2), 0).elements)[0]!
    expect(both).toMatchObject({ text: 'A', forecolor: '#ff0000', textPaintMode: 'fillStroke', textStrokeColor: '#00ff00', textStrokeWidth: 2 })
  })

  it.each([
    ['ASCIIHexDecode', asciiHexEncode(enc('1 0 0 rg 10 10 20 10 re f\n'))],
    ['ASCII85Decode', ascii85Encode(enc('1 0 0 rg 10 10 20 10 re f\n'))],
    ['RunLengthDecode', runLengthEncode(enc('1 0 0 rg 10 10 20 10 re f\n'))],
    ['LZWDecode', lzwLiteralEncode(enc('1 0 0 rg 10 10 20 10 re f\n'))],
  ])('imports content streams filtered with %s', (filterName, encodedContent) => {
    const page = importPdfPage(buildFilteredContentPdf(filterName, encodedContent), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ x: 10, y: 80, width: 20, height: 10, fill: '#ff0000' })
  })

  it('drops rectangular clips that fully contain the painted element', () => {
    // Near-page-size clip must not wrap the contained rectangle in a frame
    const pageStream = '2 2 96 96 re W n 1 0 0 rg 10 10 20 20 re f'
    const page = importPdfPage(buildSimpleFontStreamPdf(pageStream), 0)
    expect(page.elements.filter(e => e.type === 'frame').length).toBe(0)
    expect(collectPaths(page.elements)[0]).toMatchObject({ x: 10, y: 70, width: 20, height: 20 })
  })

  it('imports ExtGState blend modes onto painted elements', () => {
    const page = importPdfPage(buildBlendModePdf(), 0)
    const paths = collectPaths(page.elements)
    expect(paths[0]).toMatchObject({ fill: '#ff0000', blendMode: 'multiply' })
    expect(paths[1]).toMatchObject({ fill: '#00ff00', blendMode: 'color-dodge' })
    expect(paths[2]).toMatchObject({ fill: '#0000ff' })
    expect(paths[2]!.blendMode).toBeUndefined()
  })

  it('keeps parent ExtGState opacity on transparency group Form XObjects', () => {
    const page = importPdfPage(buildTransparencyGroupFormOpacityPdf(), 0)
    const frame = page.elements.find((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(frame).toMatchObject({ x: 0, y: 0, width: 10, height: 10, opacity: 0.3, affineTransform: [1, 0, 0, 1, 0, 90] })
    expect(frame!.pdfForm).toMatchObject({ bbox: [0, 0, 10, 10], matrix: [1, 0, 0, 1, 0, 0] })
    const path = collectPaths(frame!.elements ?? [])[0]!
    expect(path).toMatchObject({ x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' })
    expect(path.fillOpacity).toBeUndefined()
    const doc = createReport({
      page: { width: page.width, height: page.height, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: { details: [{ height: page.height, elements: page.elements }] },
    }, { rows: [{}] })
    const group = findGroupWithOpacity(doc.pages[0]!.children, 0.3)
    expect(group).toMatchObject({ type: 'group', opacity: 0.3 })
  })

  it('imports ExtGState overprint flags onto painted elements', () => {
    const page = importPdfPage(buildOverprintPdf(), 0)
    const paths = collectPaths(page.elements)
    expect(paths[0]).toMatchObject({
      fill: '#ff0000',
      stroke: '#000000',
      overprintFill: true,
      overprintStroke: true,
      overprintMode: 1,
    })
    expect(paths[1]).toMatchObject({ fill: '#00ff00' })
    expect(paths[1]!.overprintFill).toBeUndefined()
    expect(paths[1]!.overprintStroke).toBeUndefined()
  })

  it('accepts ExtGState soft mask reset', () => {
    const page = importPdfPage(buildSoftMaskNonePdf(), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ fill: '#ff0000', fillOpacity: 0.5 })
  })

  it('imports constant luminosity ExtGState soft mask dictionaries as opacity', () => {
    const page = importPdfPage(buildSoftMaskDictionaryPdf(), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ fill: '#ff0000' })
    expect(path.fillOpacity).toBeCloseTo(128 / 255, 5)
  })

  it('imports constant alpha ExtGState soft mask dictionaries as opacity', () => {
    const page = importPdfPage(buildAlphaSoftMaskDictionaryPdf(), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ fill: '#ff0000' })
    expect(path.fillOpacity).toBeCloseTo(0.25, 5)
  })

  it('applies ExtGState soft mask transfer functions to constant masks', () => {
    const page = importPdfPage(buildSoftMaskTransferFunctionPdf(), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ fill: '#ff0000' })
    expect(path.fillOpacity).toBeCloseTo((128 / 255) * (128 / 255), 5)
  })

  it('captures a per-pixel ExtGState soft mask transfer function and re-emits /TR', () => {
    const page = importPdfPage(buildRealSoftMaskWithTransferPdf(), 0)
    const frame = page.elements.find((e): e is Extract<ElementDef, { type: 'frame' }> => e.type === 'frame')
    expect(frame?.softMask?.type).toBe('luminosity')
    const transfer = frame!.softMask!.transferFunction!
    expect(transfer).toMatchObject({ functionType: 2, exponent: 2 })
    expect(evaluateTransferFunctionDef(transfer, 0.5)).toBeCloseTo(0.25, 5)
    // Round-trips through PDF output: re-importing the rendered PDF recovers the
    // per-pixel soft mask together with its /TR transfer function.
    const pdf = renderToPdf(createReport({
      page: { width: page.width, height: page.height, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: { details: [{ height: page.height, elements: page.elements }] },
    }, { rows: [{}] }), { fonts: {} })
    const reimported = importPdfPage(pdf, 0)
    const reframe = reimported.elements.find((e): e is Extract<ElementDef, { type: 'frame' }> =>
      e.type === 'frame' && (e as { softMask?: unknown }).softMask !== undefined)
    const reTransfer = reframe!.softMask!.transferFunction!
    expect(reTransfer).toMatchObject({ functionType: 2, exponent: 2 })
    expect(evaluateTransferFunctionDef(reTransfer, 0.5)).toBeCloseTo(0.25, 5)
  })

  it('imports constant image luminosity ExtGState soft mask dictionaries as opacity', () => {
    const page = importPdfPage(buildImageLuminositySoftMaskDictionaryPdf(), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ fill: '#ff0000' })
    expect(path.fillOpacity).toBeCloseTo(128 / 255, 5)
  })

  it('imports constant image alpha ExtGState soft mask dictionaries as opacity', () => {
    const page = importPdfPage(buildImageAlphaSoftMaskDictionaryPdf(), 0)
    const path = collectPaths(page.elements)[0]!
    expect(path).toMatchObject({ fill: '#ff0000' })
    expect(path.fillOpacity).toBeCloseTo(64 / 255, 5)
  })

  it('uses CIDFont W and DW for imported Type0 text width', () => {
    const page = importPdfPage(buildCidFontWidthPdf(), 0)
    const texts = collectStaticTexts(page.elements)
    expect(texts[0]).toMatchObject({ text: 'AB', width: 10 })
    expect(texts[1]).toMatchObject({ text: 'C', width: 10 })
  })

  it('uses a stream CMap to split variable-length codes and map them to CIDs for text and metrics', () => {
    const page = importPdfPage(buildVariableLengthCMapPdf(), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: 'Aβγ' })
    expect(text!.width).toBeCloseTo(12, 4)
  })

  it('applies a stream CIDToGIDMap after the encoding CMap', () => {
    const page = importPdfPage(buildStreamCidToGidPdf(), 0)
    expect(collectStaticTexts(page.elements)[0]).toMatchObject({ text: 'A' })
  })

  it('uses the bundled Adobe predefined CMap for CID metrics and Unicode-source extraction', () => {
    const page = importPdfPage(buildPredefinedCMapPdf(), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: 'あ' })
    expect(text!.width).toBeCloseTo(10, 4)
  })

  it('imports rotated Identity-V text as vertical staticText', () => {
    const page = importPdfPage(buildRotatedVerticalCidTextPdf(), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({
      type: 'staticText',
      text: 'A',
      rotation: 90,
      x: 40,
      y: 15,
      width: 10,
      height: 10,
    })
    expect(page.styles.find(s => s.name === text!.style)).toMatchObject({
      fontFamily: 'VerticalTest',
      writingMode: 'vertical-rl',
    })
  })

  it('decodes Type0 text through an embedded cmap when ToUnicode is absent', () => {
    const gidA = font.getGlyphId(0x41)
    const gidB = font.getGlyphId(0x42)
    const page = importPdfPage(buildEmbeddedCmapType0Pdf(`${hex4(gidA)}${hex4(gidB)}`), 0)
    const text = collectStaticTexts(page.elements)[0]
    expect(text).toMatchObject({ type: 'staticText', text: 'AB' })
    expect(page.styles.find(s => s.name === text!.style)).toMatchObject({ fontFamily: expect.stringContaining('Roboto') })
  })

  it('maps a ToUnicode bfrange whose destination is a UTF-16 surrogate pair', () => {
    // A bfrange <0001> <0002> <D83DDE00> maps CID 1 → U+1F600 and CID 2 → U+1F601
    // by incrementing the LAST UTF-16 code unit. The old code point-based path
    // both crashed on malformed values and mis-walked the supplementary plane.
    const page = importPdfPage(buildBfrangeToUnicodePdf(), 0)
    const text = collectStaticTexts(page.elements).map(t => t.text).join('')
    expect(text).toBe('\u{1F600}\u{1F601}')
  })

  it('recovers a stream whose /Length is wrong by scanning for endstream', () => {
    // A deliberately wrong /Length (5, far shorter than the real content). The
    // parser must fall back to the "endstream" keyword scan, the same repair real
    // readers do, and still recover the full content stream.
    const content = '10 10 30 30 re f'
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length 5 >>\nstream\n${content}\nendstream\nendobj\n`,
    ])
    const page = importPdfPage(pdf, 0)
    expect(page.elements.filter(e => e.type === 'path').length).toBeGreaterThan(0)
  })

  it('parses boolean/null literals in a content-stream marked-content property list', () => {
    // Some producers emit marked-content property lists with boolean values
    // (/Visible true ...). The content lexer must accept true/false/null as
    // operand objects, not choke on them as unknown operators.
    const content = stream('/Layer << /Visible true /Editable false /Meta null >> BDC\n10 10 30 30 re f\nEMC')
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    ])
    const page = importPdfPage(pdf, 0)
    expect(page.elements.filter(e => e.type === 'path').length).toBeGreaterThan(0)
  })

  it('imports Type0 glyphs as outline paths when there is no ToUnicode AND no embedded cmap', () => {
    // An embedded subset with neither /ToUnicode nor a 'cmap' carries no Unicode
    // (common in real PDFs). Rather than throwing, the run is imported as glyph
    // outline paths so the page still renders.
    const gidA = font.getGlyphId(0x41)
    const gidB = font.getGlyphId(0x42)
    const page = importPdfPage(buildNoCmapType0Pdf(`${hex4(gidA)}${hex4(gidB)}`), 0)
    expect(collectStaticTexts(page.elements).length).toBe(0)
    const paths = collectPaths(page.elements)
    expect(paths.length).toBeGreaterThan(0)
    expect(paths[0]!.pdfSourceVector).toBeDefined()
    expect(paths[0]!.pdfSourceVector!.definitions).toHaveLength(2)
    expect(paths[0]!.pdfSourceVector!.instances).toHaveLength(2)
  })

  it('imports vector paths from a PDF generated by the renderer', () => {
    const doc = createReport({
      page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            { type: 'rectangle', x: 10, y: 20, width: 80, height: 40, fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2 },
            { type: 'path', x: 120, y: 20, width: 40, height: 40, d: 'M0 0 C20 0 20 40 40 40', stroke: '#00aa00', strokeWidth: 3 },
          ],
        }],
      },
    }, { rows: [{}] })
    const pdf = renderToPdf(doc, { fonts: {} })

    const page = importPdfPage(pdf, 0)
    expect(page.width).toBe(200)
    expect(page.height).toBe(120)
    const paths = collectPaths(page.elements)
    expect(paths.length).toBe(2)
    expect(paths[0]).toMatchObject({ x: 10, y: 20, width: 80, height: 40, fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2 })
    expect(paths[1]).toMatchObject({ x: 120, y: 20, width: 40, height: 40, stroke: '#00aa00', strokeWidth: 3 })
    expect(paths[1]!.d).toContain('C')
  })

  it('imports JPEG image XObjects from a PDF generated by the renderer', () => {
    const jpeg = createMinimalJpeg(3, 2, 3)
    const doc = createReport({
      page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            { type: 'image', x: 25, y: 35, width: 60, height: 40, source: 'photo', scaleMode: 'fillFrame' },
          ],
        }],
      },
    }, { rows: [{}] }, { images: { photo: jpeg } })
    const pdf = renderToPdf(doc, { fonts: {}, images: { photo: jpeg } })

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'img' })
    const image = collectImages(page.elements)[0]
    expect(image).toMatchObject({ type: 'image', x: 25, y: 35, width: 60, height: 40, source: 'img0.jpg', scaleMode: 'fillFrame' })
    expect(page.images['img0.jpg']).toEqual(jpeg)
  })

  it('imports DCTDecode image XObjects after preceding stream filters', () => {
    const jpeg = createMinimalJpeg(3, 2, 3)
    const pdf = buildDctFilteredImagePdf('[/ASCII85Decode /DCTDecode]', ascii85Encode(jpeg))

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'dct' })
    const image = collectImages(page.elements)[0]
    expect(image).toMatchObject({ type: 'image', x: 10, y: 50, width: 30, height: 20, source: 'dct0.jpg' })
    expect(page.images['dct0.jpg']).toEqual(jpeg)
  })

  it('preserves a directly renderable JPEG when its rendering intent is retained as metadata', () => {
    const jpeg = createMinimalJpeg(3, 2, 3)
    const pdf = buildDctFilteredImagePdf('/DCTDecode', jpeg, '/Intent /Perceptual')

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'intent' })
    const image = collectImages(page.elements)[0]
    expect(image).toMatchObject({ source: 'intent0.jpg', renderingIntent: 'Perceptual' })
    expect(page.images['intent0.jpg']).toEqual(jpeg)
  })

  it('rejects image filter chains with non-terminal DCTDecode', () => {
    const jpeg = createMinimalJpeg(3, 2, 3)
    const pdf = buildDctFilteredImagePdf('[/DCTDecode /ASCIIHexDecode]', jpeg)

    expect(() => importPdfPage(pdf, 0)).toThrow(/DCTDecode image filter must be terminal/)
  })

  it('imports DCTDecode image XObjects with soft masks as PNG resources', () => {
    const pdf = buildDctSoftMaskImagePdf(
      tinyDecodedJpeg(),
      zlibDeflate(new Uint8Array([255, 0])),
    )

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'jpegmask' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', x: 10, y: 70, width: 20, height: 10, source: 'jpegmask0.png' })
    const decoded = decodePng(page.images['jpegmask0.png']!)
    expect(decoded.pixels[0]).toBeGreaterThan(240)
    expect(decoded.pixels[1]).toBeLessThan(10)
    expect(decoded.pixels[2]).toBeLessThan(10)
    expect(decoded.pixels[3]).toBe(255)
    expect(decoded.pixels[4]).toBeLessThan(10)
    expect(decoded.pixels[5]).toBeGreaterThan(240)
    expect(decoded.pixels[7]).toBe(0)
  })

  it('imports an image whose soft mask is itself JPEG (DCTDecode) encoded', () => {
    // A DCTDecode soft mask must be decoded through the JPEG decoder (its
    // luminance is the alpha), not the generic stream decoder which rejects the
    // image filter. The result is a valid PNG with per-pixel alpha applied.
    const pdf = buildDctJpegSoftMaskImagePdf(tinyDecodedJpeg(), tinyDecodedJpeg())
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'jpegjpegmask' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'jpegjpegmask0.png' })
    const decoded = decodePng(page.images['jpegjpegmask0.png']!)
    // Alpha channel is populated from the mask (not left fully opaque everywhere).
    expect(decoded.pixels.length).toBeGreaterThan(0)
  })

  it('imports DCTDecode image XObjects with explicit image masks as PNG resources', () => {
    const pdf = buildDctExplicitMaskImagePdf(
      tinyDecodedJpeg(),
      zlibDeflate(new Uint8Array([0x80])),
    )

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'jpegmask' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'jpegmask0.png' })
    const decoded = decodePng(page.images['jpegmask0.png']!)
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[4]).toBeLessThan(10)
    expect(decoded.pixels[5]).toBeGreaterThan(240)
    expect(decoded.pixels[7]).toBe(255)
  })

  it('imports progressive DCTDecode image XObjects through the JPEG decoder', () => {
    const pdf = buildDctProgressiveSoftMaskImagePdf(
      progressiveRedJpeg(),
      zlibDeflate(new Uint8Array(64).fill(255)),
    )

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'jpegprog' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'jpegprog0.png' })
    const decoded = decodePng(page.images['jpegprog0.png']!)
    expect(decoded.width).toBe(8)
    expect(decoded.height).toBe(8)
    const p = (4 * decoded.width + 4) * 4
    expect(Math.abs(decoded.pixels[p]! - 204)).toBeLessThanOrEqual(3)
    expect(Math.abs(decoded.pixels[p + 1]! - 34)).toBeLessThanOrEqual(3)
    expect(Math.abs(decoded.pixels[p + 2]! - 17)).toBeLessThanOrEqual(3)
    expect(decoded.pixels[p + 3]).toBe(255)
  })

  it('applies DCTDecode ColorTransform before PDF color-space conversion', () => {
    const pdf = buildDctColorTransformPdf(progressiveRedJpeg(), 0)
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'jpegtransform' })
    const image = collectImages(page.elements)[0]!
    expect(image.source).toBe('jpegtransform0.png')
    const decoded = decodePng(page.images['jpegtransform0.png']!)
    const pixel = (4 * decoded.width + 4) * 4
    // With ColorTransform 0, the encoded Y, Cb, and Cr samples are DeviceRGB
    // components. They must not be converted to the red RGB preview.
    expect(decoded.pixels[pixel]).toBeGreaterThan(50)
    expect(decoded.pixels[pixel + 1]).toBeGreaterThan(50)
    expect(decoded.pixels[pixel + 2]).toBeGreaterThan(50)
  })

  it('rejects an invalid DCTDecode ColorTransform value', () => {
    const pdf = buildDctColorTransformPdf(progressiveRedJpeg(), 2)
    expect(() => importPdfPage(pdf, 0)).toThrow(/ColorTransform must be 0 or 1/)
  })

  it('applies color-key /Mask ranges to DCTDecode image samples', () => {
    const pdf = buildDctColorKeyMaskImagePdf(tinyDecodedJpeg())

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'jpegkey' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'jpegkey0.png' })
    const decoded = decodePng(page.images['jpegkey0.png']!)
    expect(decoded.pixels[0]).toBeGreaterThan(240)
    expect(decoded.pixels[1]).toBeLessThan(10)
    expect(decoded.pixels[2]).toBeLessThan(10)
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[4]).toBeLessThan(10)
    expect(decoded.pixels[5]).toBeGreaterThan(240)
    expect(decoded.pixels[7]).toBe(255)
  })

  it('imports Flate image XObjects as PNG resources', () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 128,
    ])
    const png = encodePngRgba(2, 1, rgba)
    const doc = createReport({
      page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            { type: 'image', x: 10, y: 15, width: 20, height: 10, source: 'pixels', scaleMode: 'fillFrame' },
          ],
        }],
      },
    }, { rows: [{}] }, { images: { pixels: png } })
    const pdf = renderToPdf(doc, { fonts: {}, images: { pixels: png } })

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'png' })
    const image = collectImages(page.elements)[0]
    expect(image).toMatchObject({ type: 'image', source: 'png0.png', x: 10, y: 15, width: 20, height: 10 })
    const decoded = decodePng(page.images['png0.png']!)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels]).toEqual([...rgba])
  })

  it('imports image streams through the Crypt Identity filter', () => {
    const pdf = buildCryptIdentityImagePdf(zlibDeflate(new Uint8Array([
      255, 0, 0,
      0, 255, 0,
    ])))
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'crypt' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'crypt0.png', x: 10, y: 70, width: 20, height: 10 })
    const decoded = decodePng(page.images['crypt0.png']!)
    expect([...decoded.pixels]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ])
  })

  it('imports CCITTFaxDecode Group 3 one-dimensional image XObjects', () => {
    // T.4 runs: white 64 = 11011 + white 0 = 00110101, black 8 = 000101.
    const pdf = buildCcittFaxImagePdf(new Uint8Array([0xD9, 0xA8, 0xA0]))
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'ccitt' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'ccitt0.png', x: 10, y: 70, width: 72, height: 10 })
    const decoded = decodePng(page.images['ccitt0.png']!)
    expect(decoded.width).toBe(72)
    expect([...decoded.pixels.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(63 * 4, 63 * 4 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(64 * 4, 64 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(71 * 4, 71 * 4 + 4)]).toEqual([0, 0, 0, 255])
  })

  it('imports CCITTFaxDecode Group 4 image XObjects', () => {
    // T.6: first line V(0) keeps the imaginary white reference line; second line uses horizontal mode.
    const pdf = buildCcittFaxImagePdf(new Uint8Array([0x9D, 0x9A, 0x8A]), -1, 2)
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'g4' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'g40.png', x: 10, y: 70, width: 72, height: 10 })
    const decoded = decodePng(page.images['g40.png']!)
    expect(decoded.width).toBe(72)
    expect(decoded.height).toBe(2)
    expect([...decoded.pixels.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(71 * 4, 71 * 4 + 4)]).toEqual([255, 255, 255, 255])
    const row2 = 72 * 4
    expect([...decoded.pixels.slice(row2, row2 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(row2 + 63 * 4, row2 + 63 * 4 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(row2 + 64 * 4, row2 + 64 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(row2 + 71 * 4, row2 + 71 * 4 + 4)]).toEqual([0, 0, 0, 255])
  })

  it('decodes CCITTFaxDecode Group 4 pass mode', () => {
    // First line paints columns 10-19 black. The second all-white line passes over that reference span.
    const pdf = buildCcittFaxImagePdf(new Uint8Array([0x27, 0x09, 0x18]), -1, 2)
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'g4pass' })
    const decoded = decodePng(page.images['g4pass0.png']!)
    expect([...decoded.pixels.slice(9 * 4, 9 * 4 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(10 * 4, 10 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(19 * 4, 19 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(20 * 4, 20 * 4 + 4)]).toEqual([255, 255, 255, 255])
    const row2 = 72 * 4
    expect([...decoded.pixels.slice(row2 + 10 * 4, row2 + 10 * 4 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(row2 + 19 * 4, row2 + 19 * 4 + 4)]).toEqual([255, 255, 255, 255])
  })

  it('imports CCITTFaxDecode Group 3 two-dimensional image XObjects', () => {
    // T.4 EOL+1 marks the first MH row, and EOL+0 marks the following MR row.
    const pdf = buildCcittFaxImagePdf(new Uint8Array([0x00, 0x19, 0xC2, 0x2A, 0x80, 0x08, 0x60]), 2, 2, true)
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'g32d' })
    const decoded = decodePng(page.images['g32d0.png']!)
    expect([...decoded.pixels.slice(9 * 4, 9 * 4 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(10 * 4, 10 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(19 * 4, 19 * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.slice(20 * 4, 20 * 4 + 4)]).toEqual([255, 255, 255, 255])
    const row2 = 72 * 4
    expect([...decoded.pixels.slice(row2 + 10 * 4, row2 + 10 * 4 + 4)]).toEqual([255, 255, 255, 255])
    expect([...decoded.pixels.slice(row2 + 19 * 4, row2 + 19 * 4 + 4)]).toEqual([255, 255, 255, 255])
  })

  it('imports mirrored image CTMs by flipping resource pixels', () => {
    const pdf = buildMirroredImagePdf(zlibDeflate(new Uint8Array([255, 0, 0, 0, 255, 0])), '-20 0 0 10 30 20')
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'mirror' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'mirror0.png', x: 10, y: 70, width: 20, height: 10 })
    expect(image.rotation).toBeUndefined()
    const decoded = decodePng(page.images['mirror0.png']!)
    expect([...decoded.pixels]).toEqual([
      0, 255, 0, 255,
      255, 0, 0, 255,
    ])
  })

  it('imports vertically mirrored image CTMs using a flipped resource and rotation', () => {
    const pdf = buildMirroredImagePdf(zlibDeflate(new Uint8Array([255, 0, 0, 0, 255, 0])), '20 0 0 -10 10 30')
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'vmirror' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'vmirror0.png', x: 10, y: 70, width: 20, height: 10, rotation: 180 })
    const decoded = decodePng(page.images['vmirror0.png']!)
    expect([...decoded.pixels]).toEqual([
      0, 255, 0, 255,
      255, 0, 0, 255,
    ])
  })

  it('imports skewed image CTMs as affine image placement', () => {
    const pdf = buildMirroredImagePdf(zlibDeflate(new Uint8Array([255, 0, 0, 0, 255, 0])), '20 5 4 10 10 20')
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'affine' })
    const image = collectImages(page.elements)[0]!
    expect(image).toMatchObject({ type: 'image', source: 'affine0.png', x: 10, y: 65, width: 24, height: 15 })
    expect(image.rotation).toBeUndefined()
    expect(image.affineTransform).toEqual([20, -5, 4, -10, 10, 80])
  })

  it('applies color-key /Mask ranges as transparency', () => {
    // 2x1 DeviceRGB image: white pixel masked transparent, red pixel kept
    const pdf = buildColorKeyMaskImagePdf(zlibDeflate(new Uint8Array([255, 255, 255, 255, 0, 0])))
    const page = importPdfPage(pdf, 0)
    const image = collectImages(page.elements)[0]!
    const decoded = decodePng(page.images[image.source!]!)
    expect(decoded.pixels[3]).toBe(0)
    expect([...decoded.pixels.slice(4, 8)]).toEqual([255, 0, 0, 255])
  })

  it('retains image Intent and Interpolate and rejects malformed sample contracts', () => {
    const metadata = importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([20, 40, 60])), 8, '/Intent /Saturation /Interpolate false'), 0)
    expect(collectImages(metadata.elements)[0]).toMatchObject({ renderingIntent: 'Saturation', interpolate: false })
    const defaultInterpolation = importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([20, 40, 60])), 8), 0)
    expect(collectImages(defaultInterpolation.elements)[0]).toMatchObject({ interpolate: false })

    expect(() => importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([0, 0, 0])), 3), 0)).toThrow(/BitsPerComponent must be 1, 2, 4, 8, or 16/)
    expect(() => importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([0, 0, 0])), 8, '/Decode [0 1]'), 0)).toThrow(/Decode length must be twice/)
    expect(() => importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([0, 0])), 8), 0)).toThrow(/sample data is truncated/)
    expect(() => importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([0, 0, 0])), 8, '/Mask [0 1]'), 0)).toThrow(/Mask range count must be twice/)
  })

  it('decodes every permitted image bit depth with exact Decode mapping', () => {
    for (const bits of [1, 2, 4, 8, 16]) {
      const maximum = Math.pow(2, bits) - 1
      const packed = packImageSamples([0, maximum, maximum], bits)
      const page = importPdfPage(buildRawImagePdf(zlibDeflate(packed), bits, '/Decode [1 0 0 1 1 0]'), 0, { imageIdPrefix: `bpc${bits}-` })
      const image = collectImages(page.elements)[0]!
      expect([...decodePng(page.images[image.source!]!).pixels.slice(0, 4)], `BPC ${bits}`).toEqual([255, 255, 0, 255])
    }
  })

  it('round trips alternate image streams and DefaultForPrinting', () => {
    const page = importPdfPage(buildAlternateImagePdf(), 0, { imageIdPrefix: 'alt' })
    const image = collectImages(page.elements)[0]!
    expect(image.alternates).toEqual([{ source: 'alt1.png', defaultForPrinting: true }])
    const backend = new PdfBackend({ fonts: {}, images: page.images })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawImage(10, 10, 20, 20, image.source!, {
      alternates: image.alternates!.map(function (alternate) { return { imageId: alternate.source, defaultForPrinting: alternate.defaultForPrinting } }),
    })
    backend.endPage()
    backend.endDocument()
    const roundTrip = PdfImporter.open(backend.toUint8Array()).importPage(0, { imageIdPrefix: 'rt' })
    expect(collectImages(roundTrip.elements)[0]!.alternates).toEqual([{ source: 'rt1.png', defaultForPrinting: true }])
  })

  it('validates and round trips OPI 1.3 and 2.0 image metadata', () => {
    const opi13 = '/OPI << /1.3 << /Type /OPI /Version 1.3 /F (high.tif) /ID <0102> /Size [100 200] /CropRect [0 0 100 200] /Position [0 0 0 20 10 20 10 0] /ColorType /Spot /Color [0 0 0 1 (Black)] /Tint 0.5 /Overprint true /ImageType [4 8] /Transparency false /Tags [270 (caption)] >> >>'
    const page = importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([20, 40, 60])), 8, opi13), 0, { imageIdPrefix: 'opi' })
    const image = collectImages(page.elements)[0]!
    expect(image.opi).toMatchObject({ version: '1.3', entries: { Version: 1.3, Size: { kind: 'array' } } })
    const backend = new PdfBackend({ fonts: {}, images: page.images })
    backend.beginDocument(); backend.beginPage(100, 100)
    backend.drawImage(0, 0, 20, 20, image.source!, { opi: image.opi })
    backend.endPage(); backend.endDocument()
    const roundTrip = PdfImporter.open(backend.toUint8Array()).importPage(0, { imageIdPrefix: 'opi-rt' })
    expect(collectImages(roundTrip.elements)[0]!.opi).toEqual(image.opi)

    const opi20 = '/OPI << /2.0 << /Type /OPI /Version 2 /F (proxy.tif) /MainImage (full.tif) /Size [100 200] /CropRect [10 20 90 180] /Overprint false /Inks [/monochrome (Gold) 0.75] /IncludedImageDimensions [50 100] /IncludedImageQuality 3 /Tags [270 [(a) (b)]] >> >>'
    expect(collectImages(importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([1, 2, 3])), 8, opi20), 0).elements)[0]!.opi?.version).toBe('2.0')
    const invalidWriter = new PdfBackend({ fonts: {}, images: page.images })
    invalidWriter.beginDocument(); invalidWriter.beginPage(100, 100)
    expect(() => invalidWriter.drawImage(0, 0, 20, 20, image.source!, { opi: {
      version: '2.0',
      entries: {
        Version: 2,
        F: { kind: 'string', bytes: new TextEncoder().encode('proxy.tif') },
        Size: { kind: 'array', items: [100, 200] },
      },
    } })).toThrow(/Size and CropRect must both/)
    const invalid = '/OPI << /2.0 << /Version 2 /F (proxy.tif) /Size [100 200] >> >>'
    expect(() => importPdfPage(buildRawImagePdf(zlibDeflate(new Uint8Array([1, 2, 3])), 8, invalid), 0)).toThrow(/Size and CropRect must both/)
  })

  it('selects the first visible alternate when the base image OC is hidden', () => {
    const page = importPdfPage(buildOptionalAlternateImagePdf(), 0, { imageIdPrefix: 'oc-alt' })
    const image = collectImages(page.elements)[0]!
    const pixels = decodePng(page.images[image.source!]!).pixels
    expect([...pixels.slice(0, 4)]).toEqual([0, 255, 0, 255])
  })

  it('applies explicit /Mask image streams as transparency', () => {
    // 2x1 DeviceRGB image with a 2x1 ImageMask: bit 1 is masked out by default Decode [0 1].
    const pdf = buildExplicitMaskImagePdf(
      zlibDeflate(new Uint8Array([255, 0, 0, 0, 255, 0])),
      zlibDeflate(new Uint8Array([0x80])),
      2,
      2,
    )
    const page = importPdfPage(pdf, 0)
    const image = collectImages(page.elements)[0]!
    const decoded = decodePng(page.images[image.source!]!)
    expect(decoded.pixels[3]).toBe(0)
    expect([...decoded.pixels.slice(4, 8)]).toEqual([0, 255, 0, 255])
  })

  it('maps explicit /Mask image streams over the base image bounds', () => {
    const pdf = buildExplicitMaskImagePdf(
      zlibDeflate(new Uint8Array([
        255, 0, 0,
        0, 255, 0,
        0, 0, 255,
        255, 255, 255,
      ])),
      zlibDeflate(new Uint8Array([0x40])),
      4,
      2,
    )
    const page = importPdfPage(pdf, 0)
    const image = collectImages(page.elements)[0]!
    const decoded = decodePng(page.images[image.source!]!)
    expect([...decoded.pixels]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 0,
      255, 255, 255, 0,
    ])
  })

  it('maps soft mask image streams over the base image bounds', () => {
    const pdf = buildSoftMaskImagePdf(
      zlibDeflate(new Uint8Array([
        255, 0, 0,
        0, 255, 0,
        0, 0, 255,
        255, 255, 255,
      ])),
      zlibDeflate(new Uint8Array([255, 0])),
      4,
      2,
    )
    const page = importPdfPage(pdf, 0)
    const image = collectImages(page.elements)[0]!
    const decoded = decodePng(page.images[image.source!]!)
    expect([...decoded.pixels]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 0,
      255, 255, 255, 0,
    ])
  })

  it('undoes soft-mask Matte preblending in the parent color space', () => {
    const pdf = buildSoftMaskImagePdf(
      zlibDeflate(new Uint8Array([255, 128, 128])),
      zlibDeflate(new Uint8Array([128])),
      1,
      1,
      '/Matte [1 1 1]',
    )
    const page = importPdfPage(pdf, 0)
    const image = collectImages(page.elements)[0]!
    expect([...decodePng(page.images[image.source!]!).pixels]).toEqual([255, 2, 2, 128])
  })

  it('interpolates explicit masks when their Interpolate flag is true', () => {
    const pdf = buildExplicitMaskImagePdf(
      zlibDeflate(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255])),
      zlibDeflate(new Uint8Array([0x40])),
      3,
      2,
      '/Interpolate true',
    )
    const page = importPdfPage(pdf, 0)
    const image = collectImages(page.elements)[0]!
    const pixels = decodePng(page.images[image.source!]!).pixels
    expect([pixels[3], pixels[7], pixels[11]]).toEqual([255, 128, 0])
  })

  it('applies JPX and JBIG2 image-dictionary semantics to independent-oracle fixtures', () => {
    const jpxBytes = new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'jpx', 'gray8-lossless.j2k')))
    const jpx = decodeJpx(jpxBytes)
    const jpxPage = importPdfPage(buildTerminalImagePdf('JPXDecode', jpxBytes, jpx.width, jpx.height, '/BitsPerComponent 3 /Decode [1 0]'), 0, { imageIdPrefix: 'jpx-pdf' })
    const jpxPixels = decodePng(jpxPage.images[collectImages(jpxPage.elements)[0]!.source!]!).pixels
    expect(jpxPixels[0]).toBe(jpx.data[0])
    expect(() => importPdfPage(buildTerminalImagePdf('JPXDecode', jpxBytes, jpx.width, jpx.height, '/ColorSpace /DeviceRGB'), 0)).toThrow(/color channels do not match/)

    const jbigBytes = Uint8Array.from(Buffer.from(readFileSync(join(__dirname, '..', 'fixtures', 'jbig2', 'striped-jbig2dec-oracle.jb2.base64'), 'utf8').trim(), 'base64'))
    const jbig = decodeJbig2(jbigBytes)
    const jbigPage = importPdfPage(buildTerminalImagePdf('JBIG2Decode', jbigBytes, jbig.width, jbig.height, '/BitsPerComponent 1 /ColorSpace /DeviceGray /Decode [1 0]'), 0, { imageIdPrefix: 'jbig-pdf' })
    const jbigPixels = decodePng(jbigPage.images[collectImages(jbigPage.elements)[0]!.source!]!).pixels
    for (let i = 0; i < jbig.width * jbig.height; i++) {
      const expected = jbig.pixels[i] === 1 ? 255 : 0
      expect(jbigPixels[i * 4]).toBe(expected)
    }
  })

  it('imports Flate image XObjects with ICCBased color spaces', () => {
    const pdf = buildIccBasedImagePdf(zlibDeflate(new Uint8Array([
      255, 0, 0,
      0, 255, 0,
    ])))

    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'icc' })
    const image = collectImages(page.elements)[0]
    expect(image).toMatchObject({ type: 'image', source: 'icc0.png', x: 10, y: 70, width: 20, height: 10 })
    const decoded = decodePng(page.images['icc0.png']!)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.pixels]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ])
  })

  it('imports Indexed image XObjects with Separation base color spaces', () => {
    const pdf = buildIndexedSeparationImagePdf(zlibDeflate(new Uint8Array([0, 1])))
    const page = importPdfPage(pdf, 0, { imageIdPrefix: 'idx' })
    const image = collectImages(page.elements)[0]
    expect(image).toMatchObject({ type: 'image', source: 'idx0.png', x: 10, y: 70, width: 20, height: 10 })
    const decoded = decodePng(page.images['idx0.png']!)
    expect([...decoded.pixels]).toEqual([
      0, 0, 0, 255,
      0, 255, 0, 255,
    ])
  })

  it('imports axial and radial shading patterns as path gradients', () => {
    const doc = createReport({
      page: { width: 160, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 120,
          elements: [
            {
              type: 'rectangle',
              x: 10,
              y: 20,
              width: 50,
              height: 30,
              fill: {
                type: 'linearGradient',
                stops: [
                  { offset: 0, color: '#ff0000' },
                  { offset: 1, color: '#0000ff' },
                ],
              },
            },
            {
              type: 'ellipse',
              x: 80,
              y: 20,
              width: 40,
              height: 40,
              fill: {
                type: 'radialGradient',
                stops: [
                  { offset: 0, color: '#ffffff' },
                  { offset: 1, color: '#000000' },
                ],
              },
            },
          ],
        }],
      },
    }, { rows: [{}] })
    const pdf = renderToPdf(doc, { fonts: {} })

    const page = importPdfPage(pdf, 0)
    const paths = collectPaths(page.elements)
    const linear = paths.find(p => typeof p.fill !== 'string' && p.fill?.type === 'linearGradient')
    const radial = paths.find(p => typeof p.fill !== 'string' && p.fill?.type === 'radialGradient')
    expect(linear?.fill).toMatchObject({ type: 'linearGradient', stops: [{ color: '#ff0000' }, { color: '#0000ff' }] })
    expect(radial?.fill).toMatchObject({ type: 'radialGradient', stops: [{ color: '#ffffff' }, { color: '#000000' }] })
  })

  it.each([2, 3] as const)('retains ShadingType %i Domain, one-sided Extend, function arrays, and common entries', (shadingType) => {
    const page = importPdfPage(buildAxialRadialMetadataPdf(shadingType), 0)
    const path = collectPaths(page.elements)[0]!
    const fill = path.fill
    if (typeof fill === 'string' || (fill?.type !== 'linearGradient' && fill?.type !== 'radialGradient')) throw new Error('expected gradient')
    expect(fill.pdfShading).toMatchObject({
      domain: [2, 4], extend: [true, false], background: [0.1, 0.2, 0.3], bbox: [0, 0, 20, 20], antiAlias: true,
    })
    expect(fill.pdfShading?.functions).toHaveLength(3)
    const report = createReport({
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: 100, elements: page.elements }] },
    }, { rows: [{}] })
    const output = renderToPdf(report, { fonts: {} })
    const text = pdfToText(output)
    expect(text).toContain('/Domain [2 4]')
    expect(text).toContain('/Extend [true false]')
    expect(text).toContain('/Background [0.1 0.2 0.3]')
    expect(text).toMatch(/\/Function \[\d+ 0 R \d+ 0 R \d+ 0 R\]/)
    const second = collectPaths(importPdfPage(output, 0).elements)[0]!.fill
    if (typeof second === 'string' || (second?.type !== 'linearGradient' && second?.type !== 'radialGradient')) throw new Error('expected gradient')
    expect(second.pdfShading?.extend).toEqual([true, false])
  })

  it('retains a non-RGB axial shading color space, function, and component values', () => {
    const page = importPdfPage(buildCmykAxialMetadataPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    if (typeof fill === 'string' || fill?.type !== 'linearGradient') throw new Error('expected linear gradient')
    expect(fill.pdfShading).toMatchObject({
      colorSpace: { kind: 'cmyk' },
      background: [0.1, 0.2, 0.3, 0.4],
      extend: [false, true],
    })
    const report = createReport({
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: 100, elements: page.elements }] },
    }, { rows: [{}] })
    const output = renderToPdf(report, { fonts: {} })
    const text = pdfToText(output)
    expect(text).toContain('/ColorSpace /DeviceCMYK')
    expect(text).toContain('/Background [0.1 0.2 0.3 0.4]')
    expect(text).toContain('/C0 [0 0 0 0]')
    const second = collectPaths(importPdfPage(output, 0).elements)[0]!.fill
    if (typeof second === 'string' || second?.type !== 'linearGradient') throw new Error('expected linear gradient')
    expect(second.pdfShading?.colorSpace).toEqual({ kind: 'cmyk' })
  })

  it('retains radial shading coordinates and affine pattern placement without radius approximation', () => {
    const firstPage = importPdfPage(buildAffineRadialShadingPdf(), 0)
    const firstPath = collectPaths(firstPage.elements)[0]!
    const firstFill = firstPath.fill
    if (typeof firstFill === 'string' || firstFill?.type !== 'radialGradient') throw new Error('expected radial gradient')
    expect(firstFill.pdfShading?.native).toMatchObject({
      shadingType: 3,
      coords: [1, 2, 3, 11, 12, 13],
      bbox: [0, 0, 20, 30],
    })
    const report = createReport({
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: 100, elements: firstPage.elements }] },
    }, { rows: [{}] })
    const output = renderToPdf(report, { fonts: {} })
    const text = pdfToText(output)
    expect(text).toContain('/Coords [1 2 3 11 12 13]')
    expect(text).toContain('/BBox [0 0 20 30]')
    const secondPath = collectPaths(importPdfPage(output, 0).elements)[0]!
    const secondFill = secondPath.fill
    if (typeof secondFill === 'string' || secondFill?.type !== 'radialGradient') throw new Error('expected radial gradient')
    expect(secondFill.pdfShading?.native?.coords).toEqual([1, 2, 3, 11, 12, 13])
    expect(nativeShadingPoint(firstPath, firstFill.pdfShading!.native!.patternMatrix, 11, 12)).toEqual(
      nativeShadingPoint(secondPath, secondFill.pdfShading!.native!.patternMatrix, 11, 12),
    )
    expect(nativeShadingPoint(firstPath, firstFill.pdfShading!.native!.patternMatrix, 24, 12)).toEqual(
      nativeShadingPoint(secondPath, secondFill.pdfShading!.native!.patternMatrix, 24, 12),
    )
  })

  it('imports sh operator shading resources as path gradients', () => {
    const page = importPdfPage(buildShadingOperatorPdf(), 0)
    const path = collectPaths(page.elements)[0]
    expect(path).toMatchObject({ type: 'path', x: 0, y: 0, width: 100, height: 100 })
    expect(path!.fill).toMatchObject({
      type: 'linearGradient',
      x1: 0,
      y1: 1,
      x2: 1,
      y2: 1,
      stops: [{ color: '#ff0000' }, { color: '#0000ff' }],
    })
  })

  it('does not apply or re-emit Background for the direct sh operator', () => {
    const page = importPdfPage(buildShadingOperatorPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    if (typeof fill === 'string' || fill?.type !== 'linearGradient') throw new Error('expected linear gradient')
    expect(fill.pdfShading?.background).toBeUndefined()
    const report = createReport({
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: 100, elements: page.elements }] },
    }, { rows: [{}] })
    expect(pdfToText(renderToPdf(report, { fonts: {} }))).not.toContain('/Background')
  })

  it('bounds sh operator shading fills to the current clip bbox', () => {
    const page = importPdfPage(buildClippedShadingOperatorPdf(), 0)
    const path = collectPaths(page.elements)[0]
    expect(path).toMatchObject({ type: 'path', x: 10, y: 40, width: 30, height: 40 })
    expect(path!.fill).toMatchObject({
      type: 'linearGradient',
      x1: -1 / 3,
      y1: 1.5,
      x2: 3,
      y2: 1.5,
      stops: [{ color: '#ff0000' }, { color: '#0000ff' }],
    })
  })

  it('imports sampled shading functions as gradient stops', () => {
    const page = importPdfPage(buildSampledFunctionShadingPdf(), 0)
    const path = collectPaths(page.elements)[0]
    expect(path!.fill).toMatchObject({
      type: 'linearGradient',
      stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
    })
  })

  it('imports sampled shading function Decode arrays as gradient stops', () => {
    const page = importPdfPage(buildDecodedSampledFunctionShadingPdf(), 0)
    const path = collectPaths(page.elements)[0]
    expect(path!.fill).toMatchObject({
      type: 'linearGradient',
      stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
    })
  })

  it('imports sampled shading function Encode arrays as gradient stops', () => {
    const page = importPdfPage(buildEncodedSampledFunctionShadingPdf(), 0)
    const path = collectPaths(page.elements)[0]
    expect(path!.fill).toMatchObject({
      type: 'linearGradient',
      stops: [{ offset: 0, color: '#0000ff' }, { offset: 1, color: '#ff0000' }],
    })
  })

  it('imports calculator shading functions as sampled gradient stops', () => {
    const page = importPdfPage(buildCalculatorFunctionShadingPdf(), 0)
    const path = collectPaths(page.elements)[0]
    expect(path!.fill).toMatchObject({ type: 'linearGradient' })
    const fill = path!.fill
    if (typeof fill === 'string' || fill?.type !== 'linearGradient') throw new Error('expected linear gradient')
    expect(fill.stops[0]).toMatchObject({ offset: 0, color: '#ff0000' })
    expect(fill.stops[fill.stops.length - 1]).toMatchObject({ offset: 1, color: '#0000ff' })
    expect(fill.stops.some(stop => stop.color === '#ff0000')).toBe(true)
    expect(fill.stops.some(stop => stop.color === '#0000ff')).toBe(true)
  })

  it('samples nonlinear exponential shading functions for non-PDF preview backends', () => {
    const page = importPdfPage(buildNonlinearExponentialShadingPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    if (typeof fill === 'string' || fill?.type !== 'linearGradient') throw new Error('expected linear gradient')
    expect(fill.stops).toHaveLength(33)
    expect(fill.stops[0]).toEqual({ offset: 0, color: '#000000' })
    expect(fill.stops[16]).toEqual({ offset: 0.5, color: '#400000' })
    expect(fill.stops[32]).toEqual({ offset: 1, color: '#ff0000' })
    expect(fill.pdfShading?.functions?.[0]).toMatchObject({ functionType: 2, exponent: 2 })
  })

  it('imports stitching shading functions with Domain, Bounds, and Encode', () => {
    const page = importPdfPage(buildStitchingFunctionShadingPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    if (typeof fill === 'string' || fill?.type !== 'linearGradient') throw new Error('expected linear gradient')
    expect(fill.stops).toEqual([
      { offset: 0, color: '#000000' },
      { offset: 0.5, color: '#ff0000' },
      { offset: 0.5, color: '#0000ff' },
      { offset: 1, color: '#00ff00' },
    ])
  })

  it('collapses a smooth stitching boundary to a single stop (no duplicate)', () => {
    const page = importPdfPage(buildSmoothStitchingFunctionShadingPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    if (typeof fill === 'string' || fill?.type !== 'linearGradient') throw new Error('expected linear gradient')
    // The shared boundary at 0.5 carries the same colour in both sub-functions,
    // so it must appear once — not duplicated as end-of-seg0 and start-of-seg1.
    expect(fill.stops).toEqual([
      { offset: 0, color: '#000000' },
      { offset: 0.5, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ])
  })

  it('rejects stitching shading functions without Encode', () => {
    expect(() => importPdfPage(buildStitchingFunctionWithoutEncodePdf(), 0)).toThrow(/Encode/)
  })

  it('imports calibrated and separation color spaces for path fills', () => {
    const page = importPdfPage(buildColorSpacePathPdf(), 0)
    const fills = collectPaths(page.elements).map(function (path) { return displayFill(path.fill) })
    expect(fills).toContain('#ff0047')
    expect(fills).toContain('#000000')
    expect(fills).toContain('#00ff00')
  })

  it('imports Separation tint transforms with stitching functions', () => {
    const page = importPdfPage(buildStitchingTintTransformPathPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    expect(displayFill(fill)).toBe('#808000')
    expect(fill).toMatchObject({ type: 'pdfSpecialColor', colorSpace: { kind: 'separation', tintTransform: { functionType: 3 } } })
  })

  it('imports Separation tint transforms with sampled functions', () => {
    const page = importPdfPage(buildSampledTintTransformPathPdf(), 0)
    const fill = collectPaths(page.elements)[0]!.fill
    expect(displayFill(fill)).toBe('#008000')
    expect(fill).toMatchObject({ type: 'pdfSpecialColor', colorSpace: { kind: 'separation', tintTransform: { functionType: 0 } } })
  })

  it('applies CalGray gamma and white point to path fills', () => {
    const page = importPdfPage(buildCalGrayGammaPathPdf(), 0)
    expect(collectPaths(page.elements)[0]).toMatchObject({ fill: '#898989' })
  })

  it('applies CalRGB gamma, matrix, and white point to path fills', () => {
    const page = importPdfPage(buildCalRgbMatrixPathPdf(), 0)
    expect(collectPaths(page.elements)[0]).toMatchObject({ fill: '#bc0000' })
  })

  it('requires WhitePoint for calibrated color spaces', () => {
    expect(() => importPdfPage(buildCalGrayWithoutWhitePointPdf(), 0)).toThrow(/CalGray WhitePoint is required/)
  })

  it('imports link annotations as hyperlink frames', () => {
    const page = importPdfPage(buildLinkAnnotationPdf(), 0)
    const frames = page.elements.filter((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(frames.length).toBe(2)
    expect(frames[0]).toMatchObject({
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      hyperlink: { type: 'reference', target: '"https://example.test/form"' },
    })
    expect(frames[1]).toMatchObject({
      x: 20,
      y: 40,
      width: 40,
      height: 20,
      hyperlink: { type: 'localPage', target: '"2"' },
    })
  })

  it('resolves Named page-navigation actions relative to the annotation page', () => {
    const page = importPdfPage(buildNamedActionLinkPdf(), 1)
    const frames = page.elements
      .filter((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
      .sort((a, b) => a.x - b.x)
    expect(frames.length).toBe(4)
    // Annots on page 2 of 3: Next -> 3, Prev -> 1, First -> 1, Last -> 3
    expect(frames[0]!.hyperlink).toEqual({ type: 'localPage', target: '"3"' })
    expect(frames[1]!.hyperlink).toEqual({ type: 'localPage', target: '"1"' })
    expect(frames[2]!.hyperlink).toEqual({ type: 'localPage', target: '"1"' })
    expect(frames[3]!.hyperlink).toEqual({ type: 'localPage', target: '"3"' })
  })

  it('resolves Link annotation named destinations from Dests dictionaries and name trees', () => {
    const page = importPdfPage(buildNamedDestinationLinkPdf(), 0)
    const frames = page.elements.filter((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(frames.length).toBe(3)
    expect(frames[0]).toMatchObject({
      x: 10,
      y: 10,
      width: 30,
      height: 10,
      hyperlink: { type: 'localPage', target: '"2"' },
    })
    expect(frames[1]).toMatchObject({
      x: 10,
      y: 30,
      width: 30,
      height: 10,
      hyperlink: { type: 'localPage', target: '"2"' },
    })
    expect(frames[2]).toMatchObject({
      x: 10,
      y: 50,
      width: 30,
      height: 10,
      hyperlink: { type: 'localAnchor', target: '"missingDest"' },
    })
  })

  it('renders Link annotation appearance streams while preserving the hyperlink frame', () => {
    const appearance = '0 0 1 RG 2 w 0 0 20 10 re S'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Link /Rect [30 40 70 60] /A << /S /URI /URI (https://example.test/visible-link) >> /AP << /N 6 0 R >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 20 10] /Length ${appearance.length} >>\nstream\n${appearance}\nendstream\nendobj\n`,
    ]), 0)

    const path = collectPaths(page.elements)[0]
    expect(path).toMatchObject({ x: 30, y: 40, width: 40, height: 20, stroke: '#0000ff' })
    const frame = page.elements.find((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(frame).toMatchObject({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
      hyperlink: { type: 'reference', target: '"https://example.test/visible-link"' },
    })
  })

  it('skips hidden Link annotations including their hyperlink frames and appearances', () => {
    const appearance = '1 0 0 rg 0 0 20 10 re f'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Link /F 2 /Rect [30 40 70 60] /A << /S /URI /URI (https://example.test/hidden-link) >> /AP << /N 6 0 R >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 20 10] /Length ${appearance.length} >>\nstream\n${appearance}\nendstream\nendobj\n`,
    ]), 0)

    expect(collectPaths(page.elements).length).toBe(0)
    expect(page.elements.some(element => element.type === 'frame')).toBe(false)
  })

  it('retains annotation appearances controlled by an OCG and marks them hidden', () => {
    const appearance = stream('1 0 0 rg 0 0 20 10 re f')
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /OFF [7 0 R] >> >> >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Square /Rect [10 10 30 20] /OC 7 0 R /AP << /N 6 0 R >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 20 10] /Length ${appearance.length} >>\nstream\n${appearance}endstream\nendobj\n`,
      '7 0 obj\n<< /Type /OCG /Name (Hidden annotation) >>\nendobj\n',
    ]), 0)
    expect(collectPaths(page.elements)).toHaveLength(1)
    expect(collectOptionalContentFrames(page.elements)[0]!.optionalContent).toMatchObject({ name: 'Hidden annotation', visible: false })
  })

  it('retains hidden optional content groups while marking their current visibility', () => {
    const page = importPdfPage(buildOptionalContentPdf(), 0)
    const paths = collectPaths(page.elements)
    expect(paths.length).toBe(5)
    expect(paths[0]).toMatchObject({ x: 0, y: 90, width: 10, height: 10, fill: '#ff0000' })
    expect(paths.some(path => path.fill === '#0000ff')).toBe(true)
    const optionalFrames = collectOptionalContentFrames(page.elements)
    expect(optionalFrames).toHaveLength(3)
    expect(optionalFrames.every((frame) => frame.optionalContent?.visible === false)).toBe(true)
    expect(optionalFrames.some((frame) => frame.optionalContent?.membership?.kind === 'membership')).toBe(true)
  })

  it.each([
    ['<< /Type /OCG >>', '<< >>', '<< /Type /OCMD /OCGs [5 0 R] >>', /requires text string Name/],
    ['<< /Type /OCG /Name (Layer) >>', '<< /BaseState /OFF >>', '<< /Type /OCMD /OCGs [5 0 R] >>', /BaseState must be \/ON/],
    ['<< /Type /OCG /Name (Layer) >>', '<< /Intent /Design >>', '<< /Type /OCMD /OCGs [5 0 R] >>', /Intent must be \/View/],
    ['<< /Type /OCG /Name (Layer) >>', '<< /ListMode /Invalid >>', '<< /Type /OCMD /OCGs [5 0 R] >>', /ListMode is invalid/],
    ['<< /Type /OCG /Name (Layer) >>', '<< /RBGroups [5 0 R] >>', '<< /Type /OCMD /OCGs [5 0 R] >>', /RBGroups entries must be arrays/],
    ['<< /Type /OCG /Name (Layer) >>', '<< >>', '<< /Type /OCMD /OCGs [5 0 R] /VE [/Not 5 0 R 5 0 R] >>', /Not expression requires one operand/],
    ['<< /Type /OCG /Name (Layer) >>', '<< /AS [<< /Event /Invalid /Category [/View] /OCGs [5 0 R] >>] >>', '<< /Type /OCMD /OCGs [5 0 R] >>', /Event is invalid/],
  ])('rejects malformed optional-content structures', (group, config, membership, error) => {
    expect(() => importPdfPage(buildMalformedOptionalContentPdf(group, config, membership), 0)).toThrow(error)
  })

  it('renders annotation appearance streams fitted to their Rect', () => {
    // FreeText-style annotation whose appearance paints a red rectangle
    const appearance = '1 0 0 rg 0 0 20 10 re f'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /FreeText /Rect [30 40 70 60] /AP << /N 6 0 R >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 20 10] /Length ${appearance.length} >>\nstream\n${appearance}\nendstream\nendobj\n`,
    ]), 0)
    // Rect [30 40 70 60] in PDF space maps to top-left origin (30, 40) with size 40x20
    const path = collectPaths(page.elements).find(p => p.fill === '#ff0000')
    expect(path).toMatchObject({ x: 30, y: 40, width: 40, height: 20 })
  })

  it('clips annotation appearance streams to their BBox', () => {
    const appearance = '1 0 0 rg 0 0 20 10 re f'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /FreeText /Rect [30 40 50 60] /AP << /N 6 0 R >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${appearance.length} >>\nstream\n${appearance}\nendstream\nendobj\n`,
    ]), 0)
    const frame = page.elements.find((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(frame).toMatchObject({ x: 30, y: 40, width: 20, height: 20, clipPath: { d: expect.stringContaining('M0 20') } })
    const path = collectPaths(frame!.elements ?? [])[0]!
    expect(path).toMatchObject({ x: 0, y: 0, width: 40, height: 20, fill: '#ff0000' })
  })

  it('selects annotation appearance states through AS', () => {
    const offAppearance = '1 0 0 rg 0 0 10 10 re f'
    const onAppearance = '0 1 0 rg 0 0 10 10 re f'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [10 10 30 30] /AS /Yes /AP << /N << /Off 6 0 R /Yes 7 0 R >> >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${offAppearance.length} >>\nstream\n${offAppearance}\nendstream\nendobj\n`,
      `7 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${onAppearance.length} >>\nstream\n${onAppearance}\nendstream\nendobj\n`,
    ]), 0)
    const paths = collectPaths(page.elements)
    expect(paths.length).toBe(1)
    expect(paths[0]).toMatchObject({ x: 10, y: 70, width: 20, height: 20, fill: '#00ff00' })
  })

  it('does not fall back to another annotation appearance state when AS is missing from AP', () => {
    const onAppearance = '0 1 0 rg 0 0 10 10 re f'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [10 10 30 30] /AS /Off /AP << /N << /Yes 6 0 R >> >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${onAppearance.length} >>\nstream\n${onAppearance}\nendstream\nendobj\n`,
    ]), 0)
    expect(collectPaths(page.elements).length).toBe(0)
  })

  it('requires AS for annotation normal appearance state dictionaries', () => {
    const onAppearance = '0 1 0 rg 0 0 10 10 re f'
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [10 10 30 30] /AP << /N << /Yes 6 0 R >> >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${onAppearance.length} >>\nstream\n${onAppearance}\nendstream\nendobj\n`,
    ])

    expect(() => importPdfPage(pdf, 0)).toThrow(/requires \/AS/)
  })

  it('rejects non-stream annotation appearance state entries', () => {
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Widget /Rect [10 10 30 30] /AS /Yes /AP << /N << /Yes << /BBox [0 0 10 10] >> >> >> >>\nendobj\n',
    ])

    expect(() => importPdfPage(pdf, 0)).toThrow(/appearance state \/Yes must be a stream/)
  })

  it('skips hidden annotations', () => {
    const appearance = '1 0 0 rg 0 0 20 10 re f'
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /FreeText /F 2 /Rect [30 40 70 60] /AP << /N 6 0 R >> >>\nendobj\n',
      `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 20 10] /Length ${appearance.length} >>\nstream\n${appearance}\nendstream\nendobj\n`,
    ]), 0)
    expect(collectPaths(page.elements).length).toBe(0)
  })

  it('applies annotation visibility flags for screen and print intents', () => {
    const printOnlyAppearance = '1 0 0 rg 0 0 10 10 re f'
    const screenOnlyAppearance = '0 1 0 rg 0 0 10 10 re f'
    const hiddenAppearance = '0 0 1 rg 0 0 10 10 re f'
    const invisibleUnknownAppearance = '1 1 0 rg 0 0 10 10 re f'
    const pdf = buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R 6 0 R 7 0 R 8 0 R] >>\nendobj\n',
      '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /FreeText /F 36 /Rect [10 80 20 90] /AP << /N 9 0 R >> >>\nendobj\n',
      '6 0 obj\n<< /Type /Annot /Subtype /FreeText /Rect [30 80 40 90] /AP << /N 10 0 R >> >>\nendobj\n',
      '7 0 obj\n<< /Type /Annot /Subtype /FreeText /F 6 /Rect [50 80 60 90] /AP << /N 11 0 R >> >>\nendobj\n',
      '8 0 obj\n<< /Type /Annot /Subtype /Custom /F 5 /Rect [70 80 80 90] /AP << /N 12 0 R >> >>\nendobj\n',
      `9 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${printOnlyAppearance.length} >>\nstream\n${printOnlyAppearance}\nendstream\nendobj\n`,
      `10 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${screenOnlyAppearance.length} >>\nstream\n${screenOnlyAppearance}\nendstream\nendobj\n`,
      `11 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${hiddenAppearance.length} >>\nstream\n${hiddenAppearance}\nendstream\nendobj\n`,
      `12 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${invisibleUnknownAppearance.length} >>\nstream\n${invisibleUnknownAppearance}\nendstream\nendobj\n`,
    ])

    const screenPaths = collectPaths(importPdfPage(pdf, 0).elements)
    expect(screenPaths.map(path => path.fill)).toEqual(['#00ff00'])

    const printPaths = collectPaths(importPdfPage(pdf, 0, { annotationIntent: 'print' }).elements)
    expect(printPaths.map(path => path.fill)).toEqual(['#ff0000'])
  })

  it('applies MediaBox origin and UserUnit to imported content', () => {
    const pageStream = stream('1 0 0 rg 110 210 10 5 re f')
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [100 200 150 240] /UserUnit 2 /Resources << >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    ]), 0)

    const path = collectPaths(page.elements)[0]
    expect(page).toMatchObject({ width: 100, height: 80 })
    expect(path).toMatchObject({ x: 20, y: 50, width: 20, height: 10, fill: '#ff0000' })
  })

  it('applies page rotation to imported content and link annotations', () => {
    const pageStream = stream('1 0 0 rg 10 5 20 10 re f')
    const page = importPdfPage(buildObjectsPdf([
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 50] /Rotate 90 /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n',
      `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
      '5 0 obj\n<< /Type /Annot /Subtype /Link /Rect [10 5 30 15] /A << /S /URI /URI (https://example.test/rotated) >> >>\nendobj\n',
    ]), 0)

    const path = collectPaths(page.elements)[0]
    const frame = page.elements.find((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(page).toMatchObject({ width: 50, height: 100 })
    expect(path).toMatchObject({ x: 5, y: 10, width: 10, height: 20, fill: '#ff0000' })
    expect(frame).toMatchObject({
      x: 5,
      y: 10,
      width: 10,
      height: 20,
      hyperlink: { type: 'reference', target: '"https://example.test/rotated"' },
    })
  })

  it('imports re, v, y, clipping, and Form XObject content streams', () => {
    const content = [
      '1 0 0 rg',
      '10 10 40 20 re f',
      '0 0 1 RG 2 w',
      '10 40 m 20 50 30 60 v S',
      '10 70 m 20 80 30 70 y S',
      '5 5 20 20 re W n',
      '0 1 0 rg 0 0 50 50 re f',
      'q 1 0 0 1 20 30 cm /Fm1 Do Q',
    ].join('\n')
    const form = '0 0 10 10 re f\n'
    const pdf = buildPdf(content, form)

    const page = importPdfPage(pdf, 0)
    const paths = collectPaths(page.elements)
    expect(paths.some(p => p.x === 10 && p.y === 70 && p.width === 40 && p.height === 20 && p.fill === '#ff0000')).toBe(true)
    expect(paths.filter(p => p.d.includes('C')).length).toBe(2)
    // Both clipped elements share one frame sized to the clip bbox, with
    // element coordinates local to the frame
    const frames = page.elements.filter(e => e.type === 'frame')
    expect(frames.length).toBe(1)
    expect(frames[0]).toMatchObject({ x: 5, y: 75, width: 20, height: 20, clipPath: { d: expect.stringContaining('M0 20') } })
    expect((frames[0] as Extract<ElementDef, { type: 'frame' }>).elements!.length).toBe(2)
    expect(paths.some(p => p.x === 0 && p.y === 0 && p.width === 10 && p.height === 10)).toBe(true)
  })

  it('clips Form XObject content streams to their BBox', () => {
    const pdf = buildPdf('q 1 0 0 1 20 30 cm /Fm1 Do Q', '0 1 0 rg 0 0 20 10 re f')
    const page = importPdfPage(pdf, 0)
    const frame = page.elements.find((element): element is Extract<ElementDef, { type: 'frame' }> => element.type === 'frame')
    expect(frame).toMatchObject({ x: 0, y: 0, width: 10, height: 10, affineTransform: [1, 0, 0, 1, 20, 60] })
    expect(frame!.pdfForm).toMatchObject({ bbox: [0, 0, 10, 10], invocationMatrix: [1, 0, 0, 1, 20, 30] })
    const path = collectPaths(frame!.elements ?? [])[0]!
    expect(path).toMatchObject({ x: 0, y: 0, width: 20, height: 10, fill: '#00ff00' })
  })

  it('preserves the complete Form XObject boundary and dictionary metadata on round trip', () => {
    const page = importPdfPage(buildFormDictionaryPdf(), 0)
    const frame = page.elements[0] as FrameDef
    expect(frame.pdfForm).toMatchObject({
      bbox: [2, 3, 12, 13],
      matrix: [2, 0, 0, 3, 4, 5],
      invocationMatrix: [1, 0, 0, 1, 7, 11],
      formType: 1,
      structParent: 7,
      name: 'OriginalForm',
      group: { Type: { kind: 'name', value: 'Group' }, S: { kind: 'name', value: 'Transparency' }, I: true, K: true },
      reference: { Page: 0 },
    })
    expect(frame).toMatchObject({ isolated: true, knockout: true })
    expect(frame.affineTransform).toEqual([2, 0, 0, 3, 15, 145])
    expect(frame.pdfForm!.metadata).toMatchObject({ kind: 'stream' })
    expect(frame.pdfForm!.pieceInfo).toBeDefined()
    expect(frame.pdfForm!.lastModified).toMatchObject({ kind: 'string' })

    const report = createReport({
      page: { width: page.width, height: page.height, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: { details: [{ height: page.height, elements: page.elements }] },
    }, { rows: [{}] })
    const output = renderToPdf(report, { fonts: {} })
    const text = pdfToText(output)
    expect(text).toContain('/Subtype /Form /BBox [2 3 12 13] /Matrix [2 0 0 3 4 5]')
    expect(text).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceRGB /I true /K true >>')
    expect(text).toContain('/Ref << /F <65787465726E616C2E706466> /Page 0 /ID [<0102> <0304>] >>')
    expect(text).toContain('/PieceInfo << /App << /Private << /Key /Value >> >> >>')
    expect(text).toContain('/LastModified <443A32303236303731333039303030302B303927303027>')
    expect(text).toContain('/StructParent 7')
    expect(text).toContain('/Name /OriginalForm')
    expect(text).toContain('/Type /Metadata /Subtype /XML')
    const roundTripped = importPdfPage(output, 0)
    const retained = collectFormFrames(roundTripped.elements).find((candidate) => candidate.pdfForm?.name === 'OriginalForm')
    expect(retained?.pdfForm).toMatchObject({
      bbox: [2, 3, 12, 13], matrix: [2, 0, 0, 3, 4, 5], structParent: 7, name: 'OriginalForm',
    })
    expect(collectPaths(retained?.elements ?? [])[0]).toMatchObject({ fill: '#0000ff', x: 0, y: 0, width: 10, height: 10 })
  })

  it('uses an explicit Form Resources dictionary as a shadowing scope and inherits only when absent', () => {
    const page = importPdfPage(buildFormResourceScopePdf(), 0)
    const forms = page.elements.filter((element): element is FrameDef => element.type === 'frame' && element.pdfForm !== undefined)
    expect(forms).toHaveLength(2)
    expect(collectPaths(forms[0]!.elements ?? [])[0]).toMatchObject({ fillOpacity: 0.8 })
    expect(collectPaths(forms[1]!.elements ?? [])[0]).toMatchObject({ fillOpacity: 0.2 })
    expect(forms[1]!.affineTransform).toEqual([1, 0, 0, 1, 20, 90])
  })

  it.each([true, false])('resolves all seven resource categories in a nested Form scope (own=%s)', ownResources => {
    const page = importPdfPage(buildAllCategoryFormResourcePdf(ownResources), 0)
    const outer = page.elements.find((element): element is FrameDef => element.type === 'frame' && element.pdfForm !== undefined)
    expect(outer).toBeDefined()
    const texts = collectStaticTexts(outer!.elements ?? [])
    expect(texts.map(text => text.text)).toEqual(['A', 'B'])
    expect(texts[1]).toMatchObject({ actualText: 'Z' })
    expect(collectFormFrames(outer!.elements ?? [])).toHaveLength(1)
    const paths = collectPaths(outer!.elements ?? [])
    expect(paths.some(path => path.fillOpacity === 0.75)).toBe(true)
    expect(paths.some(path => typeof path.fill === 'object' && path.fill?.type === 'tilingPattern')).toBe(true)
    expect(paths.some(path => typeof path.fill === 'object' && path.fill?.type === 'linearGradient')).toBe(true)
  })

  it('retains nested Form boundaries and rejects recursive Form resource graphs', () => {
    const page = importPdfPage(buildNestedFormPdf(false), 0)
    const outer = page.elements[0] as FrameDef
    const inner = outer.elements![0] as FrameDef
    expect(outer.pdfForm).toBeDefined()
    expect(inner.pdfForm).toBeDefined()
    expect(collectPaths(inner.elements ?? [])[0]).toMatchObject({ fill: '#0000ff', x: 0, y: 0, width: 4, height: 4 })
    expect(() => importPdfPage(buildNestedFormPdf(true), 0)).toThrow(/circular Form XObject reference 5/)
  })

  it('normalizes either pair of diagonal corners in a Form XObject BBox', () => {
    const page = importPdfPage(buildMalformedFormPdf('/BBox [10 10 0 0]'), 0)
    const form = page.elements[0] as FrameDef
    expect(form).toMatchObject({ type: 'frame', width: 10, height: 10 })
    expect(form.pdfForm?.bbox).toEqual([0, 0, 10, 10])
    expect(collectPaths(form.elements ?? [])[0]).toMatchObject({ width: 1, height: 1 })
  })

  it('positions device-parameter scopes from transformed Form XObject bounds', () => {
    const page = importPdfPage(buildDeviceParamsFormPdf(), 0)
    const deviceFrame = collectFrames(page.elements).find(function (frame) { return frame.deviceParams !== undefined })
    expect(deviceFrame).toMatchObject({
      x: 10,
      y: 80,
      width: 10,
      height: 10,
      clip: false,
      deviceParams: { strokeAdjustment: true },
    })
    const form = collectFormFrames(deviceFrame?.elements ?? [])[0]
    expect(form).toMatchObject({
      x: -10,
      y: -80,
      width: 10,
      height: 10,
      affineTransform: [1, 0, 0, 1, 10, 80],
      transparencyGroup: true,
    })
    const report = createReport({
      page: { width: page.width, height: page.height, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: { title: { height: page.height, elements: page.elements } },
    }, { rows: [{}] })
    expect(report.pages[0]?.children[0]).toMatchObject({
      children: [{ x: 10, y: 80, width: 10, height: 10, clip: false, deviceParams: { strokeAdjustment: true } }],
    })
  })

  it.each([
    ['/BBox [0 0 10]', /BBox requires exactly four numbers/],
    ['/BBox [0 0 10 10] /Matrix [1 0 0 1 0]', /Matrix requires exactly six numbers/],
    ['/BBox [0 0 10 10] /FormType 2', /FormType must be 1/],
    ['/BBox [0 0 10 10] /StructParent 1 /StructParents 2', /cannot contain both StructParent and StructParents/],
  ])('rejects malformed Form XObject dictionaries: %s', (entries, error) => {
    expect(() => importPdfPage(buildMalformedFormPdf(entries), 0)).toThrow(error)
  })

  it('applies W to the complete path at the following path-ending operator', () => {
    const pdf = buildPdf('0 0 10 10 re W 20 20 10 10 re n 1 0 0 rg 0 0 30 30 re f', '')
    const page = importPdfPage(pdf, 0)
    const frame = page.elements.find((element): element is FrameDef => element.type === 'frame')
    expect(frame).toMatchObject({ x: 0, y: 70, width: 30, height: 30 })
    expect((frame!.clipPath!.d.match(/M/g) ?? []).length).toBe(2)
  })

  it('treats an empty clipping path as clipping all subsequent painting', () => {
    const pdf = buildPdf('W n 1 0 0 rg 0 0 30 30 re f', '')
    expect(importPdfPage(pdf, 0).elements).toEqual([])
  })

  it('treats painting operators with an empty current path as no-ops', () => {
    const pdf = buildPdf('S f B b n 1 0 0 rg 0 0 10 10 re f', '')
    const paths = collectPaths(importPdfPage(pdf, 0).elements)
    expect(paths).toHaveLength(1)
    expect(paths[0]!.fill).toBe('#ff0000')
  })

  it('accepts direct flatness changes across nested graphics-state scopes without altering exact vector geometry', () => {
    const content = '2 i 0 0 10 10 re f q 5 i 20 0 10 10 re f Q 40 0 10 10 re f'
    const paths = collectPaths(importPdfPage(buildPdf(content, ''), 0).elements)
    expect(paths).toHaveLength(3)
    expect(paths.map((path) => path.width)).toEqual([10, 10, 10])
  })

  it('forces numeric graphics-state parameters into their valid ranges', () => {
    const path = collectPaths(importPdfPage(buildPdf('-2 w -3 M 9 J -4 j 0 0 m 10 0 l S', ''), 0).elements)[0]!
    expect(path).toMatchObject({ strokeWidth: 0, strokeMiterLimit: 1, strokeLinecap: 'butt', strokeLinejoin: 'miter' })
  })

  it('rejects negative and all-zero dash arrays', () => {
    expect(() => importPdfPage(buildPdf('[-1 2] 0 d 0 0 m 10 0 l S', ''), 0)).toThrow(/dash array values must be non-negative/)
    expect(() => importPdfPage(buildPdf('[0 0] 0 d 0 0 m 10 0 l S', ''), 0)).toThrow(/dash array values must not all be zero/)
  })

  it('preserves a non-uniform CTM on stroked paths so width and dashes transform with the path', () => {
    const content = 'q 2 0.5 1 3 10 20 cm 4 w [3 2] 1 d 0 0 m 10 0 l S Q'
    const path = collectPaths(importPdfPage(buildPdf(content, ''), 0).elements)[0]!
    expect(path.affineTransform).toBeDefined()
    expect(path.strokeWidth).toBe(4)
    expect(path.strokeDasharray).toEqual([3, 2])
    expect(path.strokeDashoffset).toBe(1)
    expect(path.d).toBe('M0 0L10 0')
  })
})

function constantA2bClut(profile: Uint8Array, lab: readonly [number, number, number]): Uint8Array {
  const result = profile.slice()
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
  const tagCount = view.getUint32(128)
  for (let index = 0; index < tagCount; index++) {
    const entry = 132 + index * 12
    if (ascii4(result, entry) !== 'A2B0') continue
    const offset = view.getUint32(entry + 4)
    if (ascii4(result, offset) !== 'mft1') throw new Error('test fixture error: A2B0 must be mft1')
    const inputs = result[offset + 8]!
    const outputs = result[offset + 9]!
    const grid = result[offset + 10]!
    if (outputs !== 3) throw new Error('test fixture error: A2B0 must produce Lab')
    const start = offset + 48 + inputs * 256
    const samples = Math.pow(grid, inputs)
    for (let sample = 0; sample < samples; sample++) {
      const position = start + sample * outputs
      result[position] = lab[0]
      result[position + 1] = lab[1]
      result[position + 2] = lab[2]
    }
    return result
  }
  throw new Error('test fixture error: A2B0 tag not found')
}

function ascii4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
}

function collectPaths(elements: ElementDef[]): PathDef[] {
  const out: PathDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'path') out.push(element)
    else if (element.type === 'frame') out.push(...collectPaths(element.elements ?? []))
  }
  return out
}

function collectImages(elements: ElementDef[]): ImageDef[] {
  const out: ImageDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'image') out.push(element)
    else if (element.type === 'frame') out.push(...collectImages(element.elements ?? []))
  }
  return out
}

function collectFormFrames(elements: ElementDef[]): FrameDef[] {
  const out: FrameDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type !== 'frame') continue
    if (element.pdfForm !== undefined) out.push(element)
    out.push(...collectFormFrames(element.elements ?? []))
  }
  return out
}

function collectOptionalContentFrames(elements: ElementDef[]): FrameDef[] {
  const out: FrameDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type !== 'frame') continue
    if (element.optionalContent !== undefined) out.push(element)
    out.push(...collectOptionalContentFrames(element.elements ?? []))
  }
  return out
}

function findGroupWithOpacity(nodes: Array<{ type: string, opacity?: number, children?: unknown[] }>, opacity: number): { type: string, opacity?: number } | undefined {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'group' && node.opacity === opacity) return node
    if (node.children !== undefined) {
      const found = findGroupWithOpacity(node.children as Array<{ type: string, opacity?: number, children?: unknown[] }>, opacity)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function collectStaticTexts(elements: ElementDef[]): StaticTextDef[] {
  const out: StaticTextDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'staticText') out.push(element)
    else if (element.type === 'frame') out.push(...collectStaticTexts(element.elements ?? []))
  }
  return out
}

function collectFrames(elements: ElementDef[]): FrameDef[] {
  const out: FrameDef[] = []
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!
    if (element.type === 'frame') {
      out.push(element)
      out.push(...collectFrames(element.elements ?? []))
    }
  }
  return out
}

function createMinimalJpeg(width: number, height: number, components: number): Uint8Array {
  const data: number[] = []
  data.push(0xFF, 0xD8)
  const sofLen = 8 + components * 3
  data.push(0xFF, 0xC0)
  data.push((sofLen >> 8) & 0xFF, sofLen & 0xFF)
  data.push(8)
  data.push((height >> 8) & 0xFF, height & 0xFF)
  data.push((width >> 8) & 0xFF, width & 0xFF)
  data.push(components)
  for (let i = 0; i < components; i++) data.push(i + 1, 0x11, 0)
  data.push(0xFF, 0xDA)
  data.push(0x00, 0x02 + components * 2 + 1)
  data.push(components)
  for (let i = 0; i < components; i++) data.push(i + 1, 0x00)
  data.push(0x00, 0x3F, 0x00)
  data.push(0xFF, 0xD9)
  return new Uint8Array(data)
}

function tinyDecodedJpeg(): Uint8Array {
  return new Uint8Array(Buffer.from(
    '/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABoQAAEFAQAAAAAAAAAAAAAAAAcABQY3d7b/xAAUAQEAAAAAAAAAAAAAAAAAAAAK/8QAHxEAAAMJAAAAAAAAAAAAAAAAAAYJBAcINjl2eLW3/9oADAMBAAIRAxEAPwBmDFPCjNYLy7UjEHmdjhdJg2zWDIqi1MlE86ouO/vBH//Z',
    'base64',
  ))
}

function progressiveRedJpeg(): Uint8Array {
  return new Uint8Array(Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAAIAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABv/EABUBAQEAAAAAAAAAAAAAAAAAAAYH/9oADAMBAAIQAxAAAAEGNuX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
    'base64',
  ))
}

function buildPdf(pageContent: string, formContent: string): Uint8Array {
  const pageStream = stream(pageContent)
  const formStream = stream(formContent)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return enc(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function buildDeviceParamsFormPdf(): Uint8Array {
  const pageStream = stream('/GS0 gs /Fm1 Do')
  const formStream = stream('1 1 1 rg 20 20 -10 -10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Fm1 5 0 R >> /ExtGState << /GS0 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [10 20 20 10] /Group << /S /Transparency /I false /K false >> /Resources << >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '6 0 obj\n<< /Type /ExtGState /SA true >>\nendobj\n',
  ])
}

function buildFormDictionaryPdf(): Uint8Array {
  const pageStream = stream('q 1 0 0 1 7 11 cm /Fm1 Do Q')
  const formStream = stream('0 0 1 rg 2 3 10 10 re f')
  const metadata = stream(binaryString(buildPdfXmpPacket({})))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /FormType 1 /BBox [2 3 12 13] /Matrix [2 0 0 3 4 5] /Resources << >> /Group << /Type /Group /S /Transparency /CS /DeviceRGB /I true /K true >> /Ref << /F (external.pdf) /Page 0 /ID [<0102> <0304>] >> /Metadata 6 0 R /PieceInfo << /App << /Private << /Key /Value >> >> >> /LastModified (D:20260713090000+09'00') /StructParent 7 /Name /OriginalForm /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    `6 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${metadata.length} >>\nstream\n${metadata}endstream\nendobj\n`,
  ])
}

function buildFormResourceScopePdf(): Uint8Array {
  const pageStream = stream('/F1 Do q 1 0 0 1 20 0 cm /F2 Do Q')
  const formStream = stream('/GS gs 1 0 0 rg 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS 7 0 R >> /XObject << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /ExtGState << /GS 8 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '7 0 obj\n<< /Type /ExtGState /ca 0.2 >>\nendobj\n',
    '8 0 obj\n<< /Type /ExtGState /ca 0.8 >>\nendobj\n',
  ])
}

function buildAllCategoryFormResourcePdf(ownResources: boolean): Uint8Array {
  const pageStream = stream('/Outer Do')
  const formStream = stream([
    '/R gs',
    '/R cs 1 0 0 scn 0 0 4 4 re f',
    'BT /R 4 Tf 1 0 0 1 0 6 Tm (A) Tj ET',
    '/Pattern cs /R scn 5 0 4 4 re f',
    '/R sh',
    '/R Do',
    '/Span /R BDC BT /R 4 Tf 1 0 0 1 0 12 Tm (B) Tj ET EMC',
  ].join('\n'))
  const patternStream = stream('0 0 1 rg 0 0 2 2 re f')
  const innerStream = stream('1 0 1 rg 0 0 2 2 re f')
  const validResourceCategories = '/Font << /R 6 0 R >> /ColorSpace << /R /DeviceRGB >> /ExtGState << /R 7 0 R >> /Pattern << /R 8 0 R >> /Shading << /R 9 0 R >> /Properties << /R 12 0 R >>'
  const validResources = `${validResourceCategories} /XObject << /R 11 0 R >>`
  const pageResources = ownResources
    ? '/Font << /R 13 0 R >> /ColorSpace << /R 13 0 R >> /ExtGState << /R 13 0 R >> /Pattern << /R 13 0 R >> /Shading << /R 13 0 R >> /XObject << /Outer 5 0 R /R 13 0 R >> /Properties << /R 13 0 R >>'
    : `${validResourceCategories} /XObject << /Outer 5 0 R /R 11 0 R >>`
  const formResources = ownResources ? `/Resources << ${validResources} >> ` : ''
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 100 100] /Resources << ${pageResources} >> >>\nendobj\n`,
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] ${formResources}/Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '7 0 obj\n<< /Type /ExtGState /ca 0.75 >>\nendobj\n',
    `8 0 obj\n<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << >> /Length ${patternStream.length} >>\nstream\n${patternStream}endstream\nendobj\n`,
    '9 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 20 0] /Function 10 0 R /Extend [true true] >>\nendobj\n',
    '10 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 1 0] /C1 [0 0 1] /N 1 >>\nendobj\n',
    `11 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 2 2] /Resources << >> /Length ${innerStream.length} >>\nstream\n${innerStream}endstream\nendobj\n`,
    '12 0 obj\n<< /ActualText (Z) >>\nendobj\n',
    '13 0 obj\n0\nendobj\n',
  ])
}

function buildNestedFormPdf(recursive: boolean): Uint8Array {
  const pageStream = stream('/Outer Do')
  const outerStream = stream(recursive ? '/Self Do' : '/Inner Do')
  const innerStream = stream('0 0 1 rg 0 0 4 4 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Outer 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /XObject << /${recursive ? 'Self 5' : 'Inner 6'} 0 R >> >> /Length ${outerStream.length} >>\nstream\n${outerStream}endstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 4 4] /Resources << >> /Length ${innerStream.length} >>\nstream\n${innerStream}endstream\nendobj\n`,
  ])
}

function buildMalformedFormPdf(entries: string): Uint8Array {
  const pageStream = stream('/Fm1 Do')
  const formStream = stream('0 0 1 1 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form ${entries} /Resources << >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
  ])
}

function buildColorKeyMaskImagePdf(imageData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Mask [250 255 250 255 250 255] /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildRawImagePdf(imageData: Uint8Array, bitsPerComponent: number, extraEntries = ''): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent ${bitsPerComponent} /ColorSpace /DeviceRGB /Filter /FlateDecode ${extraEntries} /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ])
}

function buildTerminalImagePdf(filter: string, imageData: Uint8Array, width: number, height: number, entries: string): Uint8Array {
  const pageStream = stream('q 20 0 0 20 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /Filter /${filter} ${entries} /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ])
}

function packImageSamples(samples: number[], bits: number): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(samples.length * bits / 8))
  let bit = 0
  for (const sample of samples) {
    for (let shift = bits - 1; shift >= 0; shift--) {
      bytes[bit >> 3] |= ((sample >> shift) & 1) << (7 - (bit & 7))
      bit++
    }
  }
  return bytes
}

function buildAlternateImagePdf(): Uint8Array {
  const pageStream = stream('q 20 0 0 20 10 20 cm /Im1 Do Q')
  const base = binaryString(zlibDeflate(new Uint8Array([255, 0, 0])))
  const alternate = binaryString(zlibDeflate(new Uint8Array([0, 255, 0])))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Alternates [<< /Image 6 0 R /DefaultForPrinting true >>] /Length ${base.length} >>\nstream\n${base}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Length ${alternate.length} >>\nstream\n${alternate}\nendstream\nendobj\n`,
  ])
}

function buildOptionalAlternateImagePdf(): Uint8Array {
  const pageStream = stream('q 20 0 0 20 10 20 cm /Im1 Do Q')
  const base = binaryString(zlibDeflate(new Uint8Array([255, 0, 0])))
  const alternate = binaryString(zlibDeflate(new Uint8Array([0, 255, 0])))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R 8 0 R] /D << /OFF [7 0 R] >> >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /OC 7 0 R /Alternates [<< /Image 6 0 R /OC 8 0 R >>] /Length ${base.length} >>\nstream\n${base}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Length ${alternate.length} >>\nstream\n${alternate}\nendstream\nendobj\n`,
    '7 0 obj\n<< /Type /OCG /Name (Hidden base) >>\nendobj\n',
    '8 0 obj\n<< /Type /OCG /Name (Visible alternate) >>\nendobj\n',
  ])
}

function buildDctFilteredImagePdf(filter: string, imageData: Uint8Array, extraEntries = ''): Uint8Array {
  const pageStream = stream('q 30 0 0 20 10 30 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 3 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter ${filter} ${extraEntries} /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ])
}

function buildDctColorTransformPdf(imageData: Uint8Array, colorTransform: number): Uint8Array {
  const pageStream = stream('q 20 0 0 20 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /DecodeParms << /ColorTransform ${colorTransform} >> /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ])
}

// The soft mask itself is JPEG-encoded (DCTDecode), not a raw/Flate stream.
function buildDctJpegSoftMaskImagePdf(imageData: Uint8Array, maskJpeg: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const maskStream = binaryString(maskJpeg)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /SMask 6 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /DCTDecode /Length ${maskStream.length} >>\nstream\n${maskStream}\nendstream\nendobj\n`,
  ])
}

function buildDctSoftMaskImagePdf(imageData: Uint8Array, maskData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const maskStream = binaryString(maskData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /SMask 6 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${maskStream.length} >>\nstream\n${maskStream}\nendstream\nendobj\n`,
  ])
}

function buildDctProgressiveSoftMaskImagePdf(imageData: Uint8Array, maskData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 20 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const maskStream = binaryString(maskData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /SMask 6 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${maskStream.length} >>\nstream\n${maskStream}\nendstream\nendobj\n`,
  ])
}

function buildDctExplicitMaskImagePdf(imageData: Uint8Array, maskData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const maskStream = binaryString(maskData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /Mask 6 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /ImageMask true /BitsPerComponent 1 /Filter /FlateDecode /Length ${maskStream.length} >>\nstream\n${maskStream}\nendstream\nendobj\n`,
  ])
}

function buildDctColorKeyMaskImagePdf(imageData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /Mask [250 255 0 5 0 5] /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ])
}

function buildBlendModePdf(): Uint8Array {
  const pageStream = stream([
    '/GS1 gs 1 0 0 rg 0 0 10 10 re f',
    '/GS2 gs 0 1 0 rg 20 0 10 10 re f',
    '/GS3 gs 0 0 1 rg 40 0 10 10 re f',
  ].join('\n'))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R /GS2 6 0 R /GS3 7 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /BM /Multiply >>\nendobj\n',
    '6 0 obj\n<< /Type /ExtGState /BM [/ColorDodge /Multiply] >>\nendobj\n',
    '7 0 obj\n<< /Type /ExtGState /BM /Normal >>\nendobj\n',
  ])
}

function buildTransparencyGroupFormOpacityPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs /Fm1 Do')
  const formStream = stream('/GS0 gs 1 1 1 rg 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 6 0 R >> /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Resources << /ExtGState << /GS0 7 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '6 0 obj\n<< /Type /ExtGState /BM /Normal /ca 0.3 /CA 0.3 /SMask /None >>\nendobj\n',
    '7 0 obj\n<< /Type /ExtGState /BM /Normal /ca 1 /CA 1 /SMask /None >>\nendobj\n',
  ])
}

function buildOverprintPdf(): Uint8Array {
  const pageStream = stream([
    '/GS1 gs 1 0 0 rg 0 G 0 0 10 10 re B',
    '/GS2 gs 0 1 0 rg 20 0 10 10 re f',
  ].join('\n'))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R /GS2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /OP true /op true /OPM 1 >>\nendobj\n',
    '6 0 obj\n<< /Type /ExtGState /OP false /op false /OPM 0 >>\nendobj\n',
  ])
}

function buildSoftMaskNonePdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask /None /ca 0.5 >>\nendobj\n',
  ])
}

function buildSoftMaskDictionaryPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  const formStream = stream('0.5 g 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask << /S /Luminosity /G 6 0 R >> >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
  ])
}

function buildAlphaSoftMaskDictionaryPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  const formStream = stream('/M1 gs 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask << /S /Alpha /G 6 0 R >> >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Resources << /ExtGState << /M1 7 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '7 0 obj\n<< /Type /ExtGState /ca 0.25 >>\nendobj\n',
  ])
}

function buildRealSoftMaskWithTransferPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  // Two different grays make the mask non-constant, forcing the per-pixel path.
  const formStream = stream('0.3 g 0 0 5 10 re f 0.8 g 5 0 5 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask << /S /Luminosity /G 6 0 R /TR 7 0 R >> >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 2 >>\nendobj\n',
  ])
}

function buildSoftMaskTransferFunctionPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  const formStream = stream('0.5 g 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask << /S /Luminosity /G 6 0 R /TR 7 0 R >> >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 2 >>\nendobj\n',
  ])
}

function buildImageLuminositySoftMaskDictionaryPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  const formStream = stream('q 10 0 0 10 0 0 cm /Im1 Do Q')
  const imageStream = binaryString(zlibDeflate(new Uint8Array([128])))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask << /S /Luminosity /G 6 0 R >> >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Resources << /XObject << /Im1 7 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    `7 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ])
}

function buildImageAlphaSoftMaskDictionaryPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs 1 0 0 rg 0 0 10 10 re f')
  const formStream = stream('q 10 0 0 10 0 0 cm /Im1 Do Q')
  const imageStream = binaryString(zlibDeflate(new Uint8Array([255])))
  const alphaStream = binaryString(zlibDeflate(new Uint8Array([64])))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /GS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /ExtGState /SMask << /S /Alpha /G 6 0 R >> >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency >> /Resources << /XObject << /Im1 7 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    `7 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /SMask 8 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `8 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${alphaStream.length} >>\nstream\n${alphaStream}\nendstream\nendobj\n`,
  ])
}

function buildMirroredImagePdf(imageData: Uint8Array, matrix: string): Uint8Array {
  const pageStream = stream(`q ${matrix} cm /Im1 Do Q`)
  const imageStream = binaryString(imageData)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildCryptIdentityImagePdf(imageData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter [/Crypt /FlateDecode] /DecodeParms [<< /Name /Identity >> null] /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildCcittFaxImagePdf(imageData: Uint8Array, k = 0, height = 1, endOfLine = false): Uint8Array {
  const pageStream = stream('q 72 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const eolParam = endOfLine ? ' /EndOfLine true' : ''
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 72 /Height ${height} /BitsPerComponent 1 /ColorSpace /DeviceGray /Filter /CCITTFaxDecode /DecodeParms << /K ${k} /Columns 72 /Rows ${height}${eolParam} >> /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildExplicitMaskImagePdf(imageData: Uint8Array, maskData: Uint8Array, imageWidth: number, maskWidth: number, maskEntries = ''): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const maskStream = binaryString(maskData)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Mask 6 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${maskWidth} /Height 1 /ImageMask true /BitsPerComponent 1 /Filter /FlateDecode ${maskEntries} /Length ${maskStream.length} >>\nstream\n${maskStream}\nendstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildSoftMaskImagePdf(imageData: Uint8Array, maskData: Uint8Array, imageWidth: number, maskWidth: number, maskEntries = ''): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const maskStream = binaryString(maskData)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /SMask 6 0 R /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${maskWidth} /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode ${maskEntries} /Length ${maskStream.length} >>\nstream\n${maskStream}\nendstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildIccBasedImagePdf(imageData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace [/ICCBased 6 0 R] /Filter /FlateDecode /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    '6 0 obj\n<< /N 3 /Length 0 >>\nstream\nendstream\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return enc(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function buildIndexedSeparationImagePdf(imageData: Uint8Array): Uint8Array {
  const pageStream = stream('q 20 0 0 10 10 20 cm /Im1 Do Q')
  const imageStream = binaryString(imageData)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace [/Indexed [/Separation /SpotGreen /DeviceRGB 6 0 R] 1 <00FF>] /Filter /FlateDecode /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream\nendobj\n`,
    '6 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 1 0] /N 1 >>\nendobj\n',
  ])
}

function buildFadedTextPdf(): Uint8Array {
  const pageStream = stream('/GS1 gs BT /F1 12 Tf 10 50 Td (Faded) Tj ET')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> /ExtGState << /GS1 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '6 0 obj\n<< /Type /ExtGState /ca 0.4 /CA 0.4 >>\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) { offsets.push(offset); body += objects[i]; offset += objects[i]!.length }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  return enc(`%PDF-1.7\n${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
}

function buildSimpleFontTextPdf(
  encoding: string,
  textObject: string,
  subtype = 'Type1',
  descriptorFlags: number | null = null,
): Uint8Array {
  const pageStream = stream(`BT /F1 12 Tf 10 50 Td ${textObject} Tj ET`)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /${subtype} /BaseFont /Helvetica /Encoding ${encoding}${descriptorFlags === null ? '' : ' /FontDescriptor 6 0 R'} >>\nendobj\n`,
  ]
  if (descriptorFlags !== null) {
    objects.push(`6 0 obj\n<< /Type /FontDescriptor /FontName /Helvetica /Flags ${descriptorFlags} /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>\nendobj\n`)
  }
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return enc(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function buildSimpleFontStreamPdf(content: string): Uint8Array {
  const pageStream = stream(content)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 66 /Widths [500 500] >>\nendobj\n',
  ])
}

function buildBfrangeToUnicodePdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 10 50 Td <00010002> Tj ET')
  // bfrange maps CID 1 → U+1F600, CID 2 → U+1F601 via a surrogate-pair start:
  // incrementing the LAST UTF-16 code unit must walk the supplementary plane.
  const cmap = stream([
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '1 beginbfrange',
    '<0001> <0002> <D83DDE00>',
    'endbfrange',
    'endcmap end end',
  ].join('\n'))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Sub /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Sub /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>\nendobj\n',
    `7 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}endstream\nendobj\n`,
  ])
}

function buildType3CharProcPdf(charProcSource = '500 0 0 0 500 700 d1 0 0 500 700 re f', renderMode = 0): Uint8Array {
  const pageStream = stream(`1 0 0 rg BT /F1 10 Tf 10 50 Td ${renderMode} Tr <41> Tj ET`)
  const charProc = stream(charProcSource)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type3 /Name /F1 /FontBBox [0 0 500 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [500] >>\nendobj\n',
    `6 0 obj\n<< /Length ${charProc.length} >>\nstream\n${charProc}endstream\nendobj\n`,
  ])
}

function buildSimpleFontWidthPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 10 50 Td <4142> Tj 0 -20 Td [<41> 100 <42>] TJ 0 -20 Td [<41> -300 <42>] TJ ET')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 66 /Widths [250 750] >>\nendobj\n',
  ])
}

function buildSimpleFontHorizontalScalePdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 80 Tz 10 50 Td <4142> Tj ET')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 66 /Widths [500 500] >>\nendobj\n',
  ])
}

function buildArbitraryAngleSimpleTextPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 0.8660254038 0.5 -0.5 0.8660254038 30 50 Tm <4142> Tj ET')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 66 /Widths [500 500] >>\nendobj\n',
  ])
}

function buildCidFontWidthPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 10 50 Td <00010002> Tj 0 -20 Td <0005> Tj ET')
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '3 beginbfchar',
    '<0001> <0041>',
    '<0002> <0042>',
    '<0005> <0043>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end end',
  ].join('\n')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Subset /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Subset /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [1 [300 700] 3 4 500] >>\nendobj\n',
    `7 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}endstream\nendobj\n`,
  ])
}

function buildVariableLengthCMapPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 10 50 Td <41810000810001> Tj ET')
  const encoding = stream([
    '/WMode 0 def',
    '2 begincodespacerange <00> <7F> <810000> <81FFFF> endcodespacerange',
    '1 begincidchar <41> 1 endcidchar',
    '1 begincidrange <810000> <810001> 2 endcidrange',
  ].join('\n'))
  const toUnicode = stream([
    '2 begincodespacerange <00> <7F> <810000> <81FFFF> endcodespacerange',
    '3 beginbfchar <41> <0041> <810000> <03B2> <810001> <03B3> endbfchar',
  ].join('\n'))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /VariableCodes /Encoding 7 0 R /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VariableCodes /CIDSystemInfo << /Registry (Test) /Ordering (Variable) /Supplement 0 >> /DW 1000 /W [1 [300 400 500]] >>\nendobj\n',
    `7 0 obj\n<< /Length ${encoding.length} >>\nstream\n${encoding}endstream\nendobj\n`,
    `8 0 obj\n<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}endstream\nendobj\n`,
  ])
}

function buildPredefinedCMapPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 10 50 Td <3042> Tj ET')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Japanese /Encoding /UniJIS-UTF16-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Japanese /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 7 >> /DW 1000 >>\nendobj\n',
  ])
}

function buildStreamCidToGidPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 10 50 Td <41> Tj ET')
  const encoding = stream('1 begincodespacerange <00> <FF> endcodespacerange\n1 begincidchar <41> 5 endcidchar')
  const gid = font.getGlyphId(0x41)
  const cidToGid = new Uint8Array(12)
  cidToGid[10] = gid >>> 8
  cidToGid[11] = gid & 0xFF
  const fontStream = binaryString(fontBytes)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Roboto-Regular /Encoding 9 0 R /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Roboto-Regular /CIDSystemInfo << /Registry (Test) /Ordering (Map) /Supplement 0 >> /DW 1000 /W [5 [600]] /CIDToGIDMap 10 0 R /FontDescriptor 7 0 R >>\nendobj\n',
    '7 0 obj\n<< /Type /FontDescriptor /FontName /Roboto-Regular /Flags 32 /FontBBox [0 -216 1146 964] /ItalicAngle 0 /Ascent 927 /Descent -244 /CapHeight 710 /StemV 80 /FontFile2 8 0 R >>\nendobj\n',
    `8 0 obj\n<< /Length ${fontStream.length} >>\nstream\n${fontStream}\nendstream\nendobj\n`,
    `9 0 obj\n<< /Length ${encoding.length} >>\nstream\n${encoding}endstream\nendobj\n`,
    `10 0 obj\n<< /Length ${cidToGid.length} >>\nstream\n${binaryString(cidToGid)}\nendstream\nendobj\n`,
  ])
}

function buildRotatedVerticalCidTextPdf(): Uint8Array {
  const pageStream = stream('BT /F1 10 Tf 0 1 -1 0 40 80 Tm <0001> Tj ET')
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '1 beginbfchar',
    '<0001> <0041>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end end',
  ].join('\n')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /VerticalTest /Encoding /Identity-V /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VerticalTest /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [1 [1000]] /DW2 [880 -1000] >>\nendobj\n',
    `7 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}endstream\nendobj\n`,
  ])
}

function buildEmbeddedCmapType0Pdf(hexText: string): Uint8Array {
  const pageStream = stream(`BT /F1 10 Tf 10 50 Td <${hexText}> Tj ET`)
  const fontStream = binaryString(fontBytes)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Roboto-Regular /Encoding /Identity-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Roboto-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity /FontDescriptor 7 0 R >>\nendobj\n',
    '7 0 obj\n<< /Type /FontDescriptor /FontName /Roboto-Regular /Flags 32 /FontBBox [0 -216 1146 964] /ItalicAngle 0 /Ascent 927 /Descent -244 /CapHeight 710 /StemV 80 /FontFile2 8 0 R >>\nendobj\n',
    `8 0 obj\n<< /Length ${fontStream.length} >>\nstream\n${fontStream}\nendstream\nendobj\n`,
  ])
}

function buildEmbeddedTextClipPdf(renderMode = 7): Uint8Array {
  const gid = font.getGlyphId(0x41)
  const hex = gid.toString(16).padStart(4, '0')
  const pageStream = stream(`1 0 0 rg 0 1 0 RG 2 w BT /F1 40 Tf 10 50 Td ${renderMode} Tr <${hex}> Tj ET 0 0 1 rg 0 0 100 100 re f`)
  const fontStream = binaryString(fontBytes)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Roboto-Regular /Encoding /Identity-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Roboto-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity /FontDescriptor 7 0 R >>\nendobj\n',
    '7 0 obj\n<< /Type /FontDescriptor /FontName /Roboto-Regular /Flags 32 /FontBBox [0 -216 1146 964] /ItalicAngle 0 /Ascent 927 /Descent -244 /CapHeight 710 /StemV 80 /FontFile2 8 0 R >>\nendobj\n',
    `8 0 obj\n<< /Length ${fontStream.length} >>\nstream\n${fontStream}\nendstream\nendobj\n`,
  ])
}

function buildEmbeddedSimpleCffClipPdf(program: Uint8Array, fontFileSubtype: string): Uint8Array {
  const pageStream = stream('BT /F1 40 Tf 10 50 Td 7 Tr <41> Tj ET 0 0 1 rg 0 0 100 100 re f')
  const fontStream = binaryString(program)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /SourceSans3-Regular /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 65 /Widths [600] /FontDescriptor 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /Type /FontDescriptor /FontName /SourceSans3-Regular /Flags 32 /FontBBox [-500 -500 1500 1500] /ItalicAngle 0 /Ascent 1000 /Descent -500 /CapHeight 700 /StemV 80 /FontFile3 7 0 R >>\nendobj\n',
    `7 0 obj\n<< /Subtype /${fontFileSubtype} /Length ${fontStream.length} >>\nstream\n${fontStream}\nendstream\nendobj\n`,
  ])
}

function buildEmbeddedSimpleTrueTypeClipPdf(program = fontBytes, flags = 32): Uint8Array {
  const pageStream = stream('BT /F1 40 Tf 10 50 Td 7 Tr <41> Tj ET 0 0 1 rg 0 0 100 100 re f')
  const fontStream = binaryString(program)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /Roboto-Regular /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 65 /Widths [652] /FontDescriptor 6 0 R >>\nendobj\n',
    `6 0 obj\n<< /Type /FontDescriptor /FontName /Roboto-Regular /Flags ${flags} /FontBBox [-500 -500 1500 1500] /ItalicAngle 0 /Ascent 1000 /Descent -500 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>\nendobj\n`,
    `7 0 obj\n<< /Length ${fontStream.length} >>\nstream\n${fontStream}\nendstream\nendobj\n`,
  ])
}

function buildUnembeddedSimpleTextClipPdf(): Uint8Array {
  const pageStream = stream('BT /F1 40 Tf 10 50 Td 7 Tr <41> Tj ET 0 0 1 rg 0 0 100 100 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
  ])
}

function sfntTableBytes(sfnt: Uint8Array, tag: string): Uint8Array {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength)
  const numTables = view.getUint16(4, false)
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    const recordTag = String.fromCharCode(sfnt[record]!, sfnt[record + 1]!, sfnt[record + 2]!, sfnt[record + 3]!)
    if (recordTag !== tag) continue
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    return sfnt.slice(offset, offset + length)
  }
  throw new Error(`Fixture font does not contain table ${tag}`)
}

function makeWindowsSymbolFont(source: Uint8Array): Uint8Array {
  const sfnt = new Uint8Array(source)
  const view = new DataView(sfnt.buffer)
  const numTables = view.getUint16(4, false)
  let cmapRecord = -1
  let headRecord = -1
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    const tag = String.fromCharCode(sfnt[record]!, sfnt[record + 1]!, sfnt[record + 2]!, sfnt[record + 3]!)
    if (tag === 'cmap') cmapRecord = record
    if (tag === 'head') headRecord = record
  }
  if (cmapRecord < 0 || headRecord < 0) throw new Error('Fixture font requires cmap and head tables')
  const cmapOffset = view.getUint32(cmapRecord + 8, false)
  const cmapLength = view.getUint32(cmapRecord + 12, false)
  const recordCount = view.getUint16(cmapOffset + 2, false)
  let changed = false
  for (let i = 0; i < recordCount; i++) {
    const encodingRecord = cmapOffset + 4 + i * 8
    if (view.getUint16(encodingRecord, false) === 3 && view.getUint16(encodingRecord + 2, false) === 1) {
      view.setUint16(encodingRecord + 2, 0, false)
      changed = true
      break
    }
  }
  if (!changed) throw new Error('Fixture font requires a Windows Unicode BMP cmap')
  view.setUint32(cmapRecord + 4, sfntChecksum(sfnt, cmapOffset, cmapLength), false)

  const headOffset = view.getUint32(headRecord + 8, false)
  const headLength = view.getUint32(headRecord + 12, false)
  view.setUint32(headOffset + 8, 0, false)
  view.setUint32(headRecord + 4, sfntChecksum(sfnt, headOffset, headLength), false)
  view.setUint32(headOffset + 8, (0xB1B0AFBA - sfntChecksum(sfnt, 0, sfnt.length)) >>> 0, false)
  return sfnt
}

function sfntChecksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0
  const end = offset + ((length + 3) & ~3)
  for (let i = offset; i < end; i += 4) {
    const word = ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)
    sum = (sum + (word >>> 0)) >>> 0
  }
  return sum
}

// Roboto with its 'cmap' record renamed ('cmap' → 'cma ', preserving the sorted
// table order) so the loaded font reports hasCmap === false, as PDF subsets do.
function cmapStrippedFontBytes(): Uint8Array {
  const out = new Uint8Array(fontBytes.length)
  out.set(fontBytes)
  const numTables = (out[4]! << 8) | out[5]!
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (out[rec] === 0x63 && out[rec + 1] === 0x6d && out[rec + 2] === 0x61 && out[rec + 3] === 0x70) {
      out[rec + 3] = 0x20 // 'p' → ' '
      break
    }
  }
  return out
}

function buildNoCmapType0Pdf(hexText: string): Uint8Array {
  const pageStream = stream(`BT /F1 10 Tf 10 50 Td <${hexText}> Tj ET`)
  const fontStream = binaryString(cmapStrippedFontBytes())
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Roboto-Regular /Encoding /Identity-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Roboto-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity /FontDescriptor 7 0 R >>\nendobj\n',
    '7 0 obj\n<< /Type /FontDescriptor /FontName /Roboto-Regular /Flags 4 /FontBBox [0 -216 1146 964] /ItalicAngle 0 /Ascent 927 /Descent -244 /CapHeight 710 /StemV 80 /FontFile2 8 0 R >>\nendobj\n',
    `8 0 obj\n<< /Length ${fontStream.length} >>\nstream\n${fontStream}\nendstream\nendobj\n`,
  ])
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, '0')
}

function buildShadingOperatorPdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  return buildShadingOperatorPdfWithContent(pageStream)
}

function buildAxialRadialMetadataPdf(shadingType: 2 | 3): Uint8Array {
  const pageStream = stream('/Pattern cs /P scn 0 0 20 20 re f')
  const coords = shadingType === 2 ? '[0 0 20 0]' : '[0 0 0 20 20 20]'
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Pattern /PatternType 2 /Shading 6 0 R >>\nendobj\n',
    `6 0 obj\n<< /ShadingType ${shadingType} /ColorSpace /DeviceRGB /Coords ${coords} /Domain [2 4] /Function [7 0 R 8 0 R 9 0 R] /Extend [true false] /Background [0.1 0.2 0.3] /BBox [0 0 20 20] /AntiAlias true >>\nendobj\n`,
    '7 0 obj\n<< /FunctionType 2 /Domain [0 5] /Range [0 1] /C0 [0] /C1 [1] /N 1 >>\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 5] /Range [0 1] /C0 [0] /C1 [1] /N 2 >>\nendobj\n',
    '9 0 obj\n<< /FunctionType 2 /Domain [0 5] /Range [0 1] /C0 [1] /C1 [0] /N 1 >>\nendobj\n',
  ])
}

function buildCmykAxialMetadataPdf(): Uint8Array {
  const pageStream = stream('/Pattern cs /P scn 0 0 20 20 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Pattern /PatternType 2 /Shading 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceCMYK /Coords [0 0 20 0] /Domain [0 1] /Function 7 0 R /Extend [false true] /Background [0.1 0.2 0.3 0.4] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /Range [0 1 0 1 0 1 0 1] /C0 [0 0 0 0] /C1 [1 0.5 0.25 0.1] /N 2 >>\nendobj\n',
  ])
}

function buildNonlinearExponentialShadingPdf(): Uint8Array {
  const pageStream = stream('/Pattern cs /P scn 0 0 100 100 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Pattern /PatternType 2 /Shading 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 7 0 R /Extend [true true] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 0 0] /N 2 >>\nendobj\n',
  ])
}

function buildAffineRadialShadingPdf(): Uint8Array {
  const pageStream = stream('/Pattern cs /P scn 0 0 100 100 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Pattern /PatternType 2 /Matrix [2 0.5 0.25 3 5 7] /Shading 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [1 2 3 11 12 13] /Function 7 0 R /Extend [true true] /BBox [0 0 20 30] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>\nendobj\n',
  ])
}

function nativeShadingPoint(
  path: PathDef,
  matrix: [number, number, number, number, number, number],
  x: number,
  y: number,
): [number, number] {
  return [
    Math.round((path.x + matrix[0] * x + matrix[2] * y + matrix[4]) * 1e6) / 1e6,
    Math.round((path.y + matrix[1] * x + matrix[3] * y + matrix[5]) * 1e6) / 1e6,
  ]
}

function buildClippedShadingOperatorPdf(): Uint8Array {
  const pageStream = stream('10 20 30 40 re W n\n/S1 sh')
  return buildShadingOperatorPdfWithContent(pageStream)
}

function buildShadingOperatorPdfWithContent(pageStream: string): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] /Background [0.2 0.4 0.6] >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>\nendobj\n',
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return enc(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function buildSampledFunctionShadingPdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  const sampleBytes = binaryString(new Uint8Array([255, 0, 0, 0, 0, 255]))
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    `6 0 obj\n<< /FunctionType 0 /Domain [0 1] /Range [0 1 0 1 0 1] /Size [2] /BitsPerSample 8 /Length ${sampleBytes.length} >>\nstream\n${sampleBytes}endstream\nendobj\n`,
  ]
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return enc(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function buildDecodedSampledFunctionShadingPdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  const sampleBytes = binaryString(new Uint8Array([0, 0, 0, 255, 255, 255]))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    `6 0 obj\n<< /FunctionType 0 /Domain [0 1] /Range [0 1 0 1 0 1] /Decode [1 0 0 0 0 1] /Size [2] /BitsPerSample 8 /Length ${sampleBytes.length} >>\nstream\n${sampleBytes}endstream\nendobj\n`,
  ])
}

function buildEncodedSampledFunctionShadingPdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  const sampleBytes = binaryString(new Uint8Array([255, 0, 0, 0, 0, 255]))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    `6 0 obj\n<< /FunctionType 0 /Domain [0 1] /Range [0 1 0 1 0 1] /Encode [1 0] /Size [2] /BitsPerSample 8 /Length ${sampleBytes.length} >>\nstream\n${sampleBytes}endstream\nendobj\n`,
  ])
}

function buildCalculatorFunctionShadingPdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  const fn = '{ dup 0.5 lt { pop 1 0 0 } { pop 0 0 1 } ifelse }'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    `6 0 obj\n<< /FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1] /Length ${fn.length} >>\nstream\n${fn}endstream\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}

function buildStitchingFunctionShadingPdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 3 /Domain [0 2] /Functions [7 0 R 8 0 R] /Bounds [1] /Encode [0 1 0 1] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 0 0] /N 1 >>\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [0 1 0] /N 1 >>\nendobj\n',
  ])
}

function buildSmoothStitchingFunctionShadingPdf(): Uint8Array {
  // Two sub-functions whose shared boundary carries the same colour
  // (subfn0 ends red, subfn1 starts red): a smooth three-stop gradient.
  const pageStream = stream('/S1 sh')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 3 /Domain [0 2] /Functions [7 0 R 8 0 R] /Bounds [1] /Encode [0 1 0 1] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 0 0] /N 1 >>\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>\nendobj\n',
  ])
}

function buildStitchingFunctionWithoutEncodePdf(): Uint8Array {
  const pageStream = stream('/S1 sh')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>\nendobj\n',
    '6 0 obj\n<< /FunctionType 3 /Domain [0 2] /Functions [7 0 R 8 0 R] /Bounds [1] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 0 0] /N 1 >>\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [0 1 0] /N 1 >>\nendobj\n',
  ])
}

function buildColorSpacePathPdf(): Uint8Array {
  const pageStream = stream([
    'q /CS1 cs 1 0 0 scn 0 0 10 10 re f Q',
    'q /CS2 cs 0 0 0 scn 20 0 10 10 re f Q',
    'q /Spot cs 1 scn 40 0 10 10 re f Q',
  ].join('\n'))
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /CS1 5 0 R /CS2 6 0 R /Spot 7 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n[/CalRGB << /WhitePoint [1 1 1] >>]\nendobj\n',
    '6 0 obj\n[/Lab << /WhitePoint [0.9642 1 0.8249] /Range [-100 100 -100 100] >>]\nendobj\n',
    '7 0 obj\n[/Separation /SpotGreen /DeviceRGB 8 0 R]\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 1 0] /N 1 >>\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildCalGrayGammaPathPdf(): Uint8Array {
  const pageStream = stream('q /CS1 cs 0.5 scn 0 0 10 10 re f Q')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /CS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n[/CalGray << /WhitePoint [0.95047 1 1.08883] /Gamma 2 >>]\nendobj\n',
  ])
}

function buildStitchingTintTransformPathPdf(): Uint8Array {
  const pageStream = stream('q /Spot cs 0.75 scn 0 0 10 10 re f Q')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /Spot 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n[/Separation /SpotBlend /DeviceRGB 6 0 R]\nendobj\n',
    '6 0 obj\n<< /FunctionType 3 /Domain [0 1] /Functions [7 0 R 8 0 R] /Bounds [0.5] /Encode [0 1 0 1] >>\nendobj\n',
    '7 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 0 0] /N 1 >>\nendobj\n',
    '8 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 1 0] /N 1 >>\nendobj\n',
  ])
}

function buildSampledTintTransformPathPdf(): Uint8Array {
  const pageStream = stream('q /Spot cs 0.5 scn 0 0 10 10 re f Q')
  const samples = binaryString(new Uint8Array([0, 0, 0, 0, 255, 0]))
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /Spot 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n[/Separation /SampledSpot /DeviceRGB 6 0 R]\nendobj\n',
    `6 0 obj\n<< /FunctionType 0 /Domain [0 1] /Range [0 1 0 1 0 1] /Size [2] /BitsPerSample 8 /Length ${samples.length} >>\nstream\n${samples}endstream\nendobj\n`,
  ])
}

function buildCalRgbMatrixPathPdf(): Uint8Array {
  const pageStream = stream('q /CS1 cs 0.5 0 0 scn 0 0 10 10 re f Q')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /CS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n[/CalRGB << /WhitePoint [0.95047 1 1.08883] /Gamma [1 1 1] /Matrix [0.4124564 0.2126729 0.0193339 0.3575761 0.7151522 0.1191920 0.1804375 0.0721750 0.9503041] >>]\nendobj\n',
  ])
}

function buildCalGrayWithoutWhitePointPdf(): Uint8Array {
  const pageStream = stream('q /CS1 cs 0.5 scn 0 0 10 10 re f Q')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /CS1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n[/CalGray << /Gamma 2 >>]\nendobj\n',
  ])
}

function buildLinkAnnotationPdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 5 0 R /Annots [6 0 R 7 0 R] >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 8 0 R >>\nendobj\n',
    '5 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    '6 0 obj\n<< /Type /Annot /Subtype /Link /Rect [10 70 60 90] /A << /S /URI /URI (https://example.test/form) >> >>\nendobj\n',
    '7 0 obj\n<< /Type /Annot /Subtype /Link /Rect [20 40 60 60] /Dest [4 0 R /XYZ 0 100 null] >>\nendobj\n',
    '8 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildNamedDestinationLinkPdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Dests << /chapterDict << /D [4 0 R /Fit] >> >> /Names << /Dests << /Kids [9 0 R] >> >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 5 0 R /Annots [6 0 R 7 0 R 8 0 R] >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 10 0 R >>\nendobj\n',
    '5 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    '6 0 obj\n<< /Type /Annot /Subtype /Link /Rect [10 80 40 90] /Dest /chapterDict >>\nendobj\n',
    '7 0 obj\n<< /Type /Annot /Subtype /Link /Rect [10 60 40 70] /Dest (chapter-string) >>\nendobj\n',
    '8 0 obj\n<< /Type /Annot /Subtype /Link /Rect [10 40 40 50] /Dest /missingDest >>\nendobj\n',
    '9 0 obj\n<< /Limits [(chapter-string) (chapter-string)] /Names [(chapter-string) [4 0 R /XYZ null null null]] >>\nendobj\n',
    '10 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildNamedActionLinkPdf(): Uint8Array {
  // 3 pages; the middle page carries Next/Prev/First/LastPage named actions so
  // the relative ones resolve against the annotation's own page (index 1).
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R /Annots [7 0 R 8 0 R 9 0 R 10 0 R] >>\nendobj\n',
    '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>\nendobj\n',
    '6 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    '7 0 obj\n<< /Type /Annot /Subtype /Link /Rect [0 80 15 90] /A << /S /Named /N /NextPage >> >>\nendobj\n',
    '8 0 obj\n<< /Type /Annot /Subtype /Link /Rect [20 80 35 90] /A << /S /Named /N /PrevPage >> >>\nendobj\n',
    '9 0 obj\n<< /Type /Annot /Subtype /Link /Rect [40 80 55 90] /A << /S /Named /N /FirstPage >> >>\nendobj\n',
    '10 0 obj\n<< /Type /Annot /Subtype /Link /Rect [60 80 75 90] /A << /S /Named /N /LastPage >> >>\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildOptionalContentPdf(): Uint8Array {
  const pageStream = stream([
    '1 0 0 rg 0 0 10 10 re f',
    '/OC /MC0 BDC',
    '0 1 0 rg 20 0 10 10 re f',
    'EMC',
    'q 1 0 0 1 40 0 cm /Fm1 Do Q',
    '0 0 1 rg 60 0 10 10 re f',
    '/OC /MC1 BDC',
    '1 1 0 rg 80 0 10 10 re f',
    'EMC',
  ].join('\n'))
  const formStream = stream('0 1 0 rg 0 0 10 10 re f')
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /OFF [5 0 R] >> >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /MC0 5 0 R /MC1 7 0 R >> /XObject << /Fm1 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /OCG /Name (Hidden layer) >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /OC 5 0 R /Resources << >> /Length ${formStream.length} >>\nstream\n${formStream}endstream\nendobj\n`,
    '7 0 obj\n<< /Type /OCMD /OCGs [5 0 R] /P /AllOn >>\nendobj\n',
  ])
}

function buildMalformedOptionalContentPdf(group: string, config: string, membership: string): Uint8Array {
  const pageStream = stream('/OC /MC BDC 0 0 10 10 re f EMC')
  return buildObjectsPdf([
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D ${config} >> >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /MC 7 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    `5 0 obj\n${group}\nendobj\n`,
    '6 0 obj\nnull\nendobj\n',
    `7 0 obj\n${membership}\nendobj\n`,
  ])
}

function buildFilteredContentPdf(filterName: string, encodedContent: Uint8Array): Uint8Array {
  const content = binaryString(encodedContent)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${encodedContent.length} /Filter /${filterName} >>\nstream\n${content}\nendstream\nendobj\n`,
  ])
}

function buildContentPdf(contentSource: string): Uint8Array {
  const content = stream(contentSource)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
  ])
}

function buildActualTextPdf(properties: string): Uint8Array {
  const content = stream(`/Span ${properties} BDC BT /F1 12 Tf 10 50 Td <41> Tj ET EMC`)
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
  ])
}

function asciiHexEncode(data: Uint8Array): Uint8Array {
  const hex = '0123456789ABCDEF'
  const out = new Uint8Array(data.length * 2 + 1)
  let pos = 0
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!
    out[pos++] = hex.charCodeAt(b >> 4)
    out[pos++] = hex.charCodeAt(b & 15)
  }
  out[pos] = 0x3E
  return out
}

function ascii85Encode(data: Uint8Array): Uint8Array {
  const chars: number[] = []
  let pos = 0
  while (pos < data.length) {
    const remaining = data.length - pos
    const count = remaining >= 4 ? 4 : remaining
    let value = 0
    for (let i = 0; i < 4; i++) value = value * 256 + (i < count ? data[pos + i]! : 0)
    if (count === 4 && value === 0) {
      chars.push(0x7A)
    } else {
      const group = new Array<number>(5)
      for (let i = 4; i >= 0; i--) {
        group[i] = (value % 85) + 33
        value = Math.floor(value / 85)
      }
      const emit = count === 4 ? 5 : count + 1
      for (let i = 0; i < emit; i++) chars.push(group[i]!)
    }
    pos += count
  }
  chars.push(0x7E, 0x3E)
  return new Uint8Array(chars)
}

function runLengthEncode(data: Uint8Array): Uint8Array {
  const chunks: number[] = []
  let pos = 0
  while (pos < data.length) {
    const count = Math.min(128, data.length - pos)
    chunks.push(count - 1)
    for (let i = 0; i < count; i++) chunks.push(data[pos + i]!)
    pos += count
  }
  chunks.push(128)
  return new Uint8Array(chunks)
}

function lzwLiteralEncode(data: Uint8Array): Uint8Array {
  const codes = new Array<number>(data.length + 2)
  codes[0] = 256
  for (let i = 0; i < data.length; i++) codes[i + 1] = data[i]!
  codes[codes.length - 1] = 257
  const out = new Uint8Array(Math.ceil(codes.length * 9 / 8))
  let bitPos = 0
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    for (let bit = 8; bit >= 0; bit--) {
      if (((code >> bit) & 1) !== 0) out[bitPos >> 3] |= 1 << (7 - (bitPos & 7))
      bitPos++
    }
  }
  return out
}

function stream(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`
}

function buildObjectsPdf(objects: string[]): Uint8Array {
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return enc(`%PDF-1.7\n${body}${xref}${trailer}`)
}

function enc(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF
  return bytes
}

function binaryString(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!)
  return out
}
