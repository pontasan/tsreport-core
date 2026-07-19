// cmyk() / spot() template colors: native DeviceCMYK / Separation output in
// PDF, RGB approximation in the display backends.

import { describe, expect, it } from 'vitest'
import { PdfBackend, SvgBackend } from '../../src/index.js'
import { isPrintColor, parseTemplateColor, toDisplayColor } from '../../src/renderer/color.js'
import { pdfToText } from './pdf-test-utils.js'

describe('template color parsing', () => {
  it('parses cmyk() with percent components and derives the RGB approximation', () => {
    const color = parseTemplateColor('cmyk(0,100,100,0)')
    expect(color.cmyk).toEqual([0, 1, 1, 0])
    expect(color.spotName).toBeNull()
    expect(color.r).toBeCloseTo(1, 6)
    expect(color.g).toBeCloseTo(0, 6)
    expect(color.b).toBeCloseTo(0, 6)
  })

  it('parses spot() with the alternate CMYK', () => {
    const color = parseTemplateColor('spot(Gold, 0, 20, 60, 20)')
    expect(color.spotName).toBe('Gold')
    expect(color.cmyk).toEqual([0, 0.2, 0.6, 0.2])
  })

  it('parses devicen() with tint values and a CMYK alternate', () => {
    const color = parseTemplateColor('devicen(Orange,Varnish;50,100;0,40,80,0)')
    expect(color.deviceN).toEqual({
      names: ['Orange', 'Varnish'],
      tints: [0.5, 1],
      alternateCmyk: [0, 0.4, 0.8, 0],
    })
    expect(color.r).toBeCloseTo(1, 6)
    expect(color.g).toBeCloseTo(0.6, 6)
    expect(color.b).toBeCloseTo(0.2, 6)
  })

  it('parses calibrated PDF color spaces', () => {
    const gray = parseTemplateColor('calgray(0.5,0.95047,1,1.08883,2.2)')
    expect(gray.calibrated).toMatchObject({ kind: 'calgray', gray: 0.5, gamma: 2.2 })
    const rgb = parseTemplateColor('calrgb(1,0,0,0.95047,1,1.08883,1,1,1)')
    expect(rgb.calibrated).toMatchObject({ kind: 'calrgb', components: [1, 0, 0] })
    const lab = parseTemplateColor('lab(60,20,30,0.9642,1,0.8249,-128,127,-128,127)')
    expect(lab.calibrated).toMatchObject({ kind: 'lab', components: [60, 20, 30] })
  })

  it('a spot() with an empty name behaves as a process color', () => {
    const color = parseTemplateColor('spot(,0,20,60,20)')
    expect(color.spotName).toBeNull()
    expect(color.cmyk).toEqual([0, 0.2, 0.6, 0.2])
    expect(isPrintColor('spot(,0,20,60,20)')).toBe(true)
  })

  it('toDisplayColor approximates print colors and passes hex through', () => {
    expect(toDisplayColor('cmyk(0,0,0,100)')).toBe('#000000')
    expect(toDisplayColor('devicen(Orange,Varnish;50,100;0,40,80,0)')).toBe('#ff9933')
    expect(toDisplayColor('#123456')).toBe('#123456')
    expect(isPrintColor('spot(X,0,0,0,0)')).toBe(true)
    expect(isPrintColor('devicen(Orange,Varnish;50,100;0,40,80,0)')).toBe(true)
    expect(isPrintColor('calgray(0.5,0.95047,1,1.08883,2.2)')).toBe(true)
    expect(toDisplayColor('lab(0,0,0,0.9642,1,0.8249)')).toBe('#000000')
    expect(isPrintColor('#fff')).toBe(false)
  })

  it('classifies print-color prefixes without changing ordinary CSS colors', () => {
    expect(isPrintColor(' CMYK(0,0,0,100) ')).toBe(true)
    expect(isPrintColor(' SPOT(Ink,0,0,0,100) ')).toBe(true)
    expect(isPrintColor(' DEVICEN(Ink;100;0,0,0,100) ')).toBe(true)
    expect(isPrintColor(' CALGRAY(0.5,0.95047,1,1.08883,2.2) ')).toBe(true)
    expect(isPrintColor(' CALRGB(1,0,0,0.95047,1,1.08883,1,1,1) ')).toBe(true)
    expect(isPrintColor(' LAB(60,20,30,0.9642,1,0.8249) ')).toBe(true)
    const ordinaryColors = ['cyan', 'darkred', 'lightblue', 'silver', 'rgb(1,2,3)', '#123456']
    for (let i = 0; i < ordinaryColors.length; i++) {
      expect(isPrintColor(ordinaryColors[i]!)).toBe(false)
      expect(toDisplayColor(ordinaryColors[i]!)).toBe(ordinaryColors[i])
    }
  })
})

describe('PDF output', () => {
  function renderPdf(draw: (backend: InstanceType<typeof PdfBackend>) => void): string {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    draw(backend)
    backend.endPage()
    backend.endDocument()
    return pdfToText(backend.toUint8Array())
  }

  it('cmyk() fills emit the DeviceCMYK k operator', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: 'cmyk(0,100,100,0)' })
    })
    expect(text).toContain('0 1 1 0 k')
  })

  it('cmyk() strokes emit the K operator', () => {
    const text = renderPdf(function (backend) {
      backend.drawLine(0, 0, 50, 0, 2, 'cmyk(100,0,0,20)')
    })
    expect(text).toContain('1 0 0 0.2 K')
  })

  it('spot() colors emit a Separation color space with the CMYK alternate', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: 'spot(Gold,0,20,60,20)' })
    })
    expect(text).toContain('/Separation /Gold /DeviceCMYK')
    expect(text).toContain('/CS0 cs')
    expect(text).toContain('1 scn')
    expect(text).toContain('/ColorSpace <<')
    expect(text).toContain('/C1 [0 0.2 0.6 0.2]')
  })

  it('the same spot color is registered once', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: 'spot(Gold,0,20,60,20)' })
      backend.drawRect(50, 10, 30, 20, { fill: 'spot(Gold,0,20,60,20)' })
    })
    expect((text.match(/\/Separation /g) ?? []).length).toBe(1)
  })

  it('devicen() colors emit a DeviceN color space with tint values', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: 'devicen(Orange,Varnish;50,100;0,40,80,0)' })
    })
    expect(text).toContain('/DeviceN [/Orange /Varnish] /DeviceCMYK')
    expect(text).toContain('/CSDN0 cs')
    expect(text).toContain('0.5 1 scn')
    expect(text).toContain('/FunctionType 4')
    expect(text).toContain('/Range [0 1 0 1 0 1 0 1]')
    expect(text).toContain('pop pop 0 0.4 0.8 0')
  })

  it('the same DeviceN color is registered once', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: 'devicen(Orange,Varnish;50,100;0,40,80,0)' })
      backend.drawRect(50, 10, 30, 20, { fill: 'devicen(Orange,Varnish;50,100;0,40,80,0)' })
    })
    expect((text.match(/\/DeviceN /g) ?? []).length).toBe(1)
  })

  it('round trips generated DeviceN fills through the importer', async () => {
    const { PdfImporter } = await import('../../src/index.js')
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: 'devicen(Orange,Varnish;50,100;0,40,80,0)' })
    backend.endPage()
    backend.endDocument()
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const rect = page.elements.find(function (el) { return el.type === 'rectangle' || el.type === 'path' })!
    const fill = (rect as { fill?: unknown }).fill
    expect(fill).toMatchObject({
      type: 'pdfSpecialColor',
      displayColor: '#ff9933',
      components: [0.5, 1],
      colorSpace: { kind: 'deviceN', names: ['Orange', 'Varnish'] },
    })
  })

  it('calibrated colors emit CalGray, CalRGB, and Lab color spaces', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, {
        fill: 'calgray(0.5,0.95047,1,1.08883,2.2)',
        stroke: 'calrgb(1,0,0,0.95047,1,1.08883,1,1,1)',
        strokeWidth: 1,
      })
      backend.drawRect(50, 10, 30, 20, { fill: 'lab(60,20,30,0.9642,1,0.8249,-128,127,-128,127)' })
    })
    expect(text).toContain('/CalGray')
    expect(text).toContain('/CalRGB')
    expect(text).toContain('/Lab')
    expect(text).toContain('/CSCal0 cs')
    expect(text).toContain('0.5 scn')
    expect(text).toContain('/CSCal1 CS')
    expect(text).toContain('1 0 0 SCN')
    expect(text).toContain('/CSCal2 cs')
    expect(text).toContain('60 20 30 scn')
    expect(text).toContain('/ColorSpace <<')
  })

  it('reuses equivalent calibrated color spaces', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: 'calgray(0.2,0.95047,1,1.08883,2.2)' })
      backend.drawRect(50, 10, 30, 20, { fill: 'calgray(0.8,0.95047,1,1.08883,2.2)' })
    })
    expect((text.match(/\/CalGray/g) ?? []).length).toBe(1)
  })

  it('round trips generated CalRGB fills through the importer', async () => {
    const { PdfImporter } = await import('../../src/index.js')
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, {
      fill: 'calrgb(1,0,0,0.95047,1,1.08883,1,1,1,0.4124564,0.2126729,0.0193339,0.3575761,0.7151522,0.119192,0.1804375,0.072175,0.9503041)',
    })
    backend.endPage()
    backend.endDocument()
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const rect = page.elements.find(function (el) { return el.type === 'rectangle' || el.type === 'path' })!
    const fill = (rect as { fill?: string }).fill as string
    expect(parseInt(fill.slice(1, 3), 16)).toBeGreaterThan(240)
    expect(parseInt(fill.slice(3, 5), 16)).toBeLessThan(40)
    expect(parseInt(fill.slice(5, 7), 16)).toBeLessThan(40)
  })
})

describe('display backends', () => {
  it('SVG approximates cmyk() as RGB in the markup', () => {
    const backend = new SvgBackend({ fonts: {}, background: null })
    backend.beginPage(100, 100)
    backend.drawLine(0, 0, 50, 0, 2, 'cmyk(0,100,100,0)')
    backend.endPage()
    const svg = backend.getPages()[0]!
    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).not.toContain('cmyk')
  })

  it('SVG shape fills and strokes approximate print colors', () => {
    const backend = new SvgBackend({ fonts: {}, background: null })
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 50, 30, { fill: 'cmyk(0,100,100,0)', stroke: 'spot(Gold,100,0,0,0)', strokeWidth: 1 })
    backend.drawEllipse(50, 50, 20, 10, { fill: 'devicen(Orange,Varnish;50,100;0,40,80,0)' })
    backend.endPage()
    const svg = backend.getPages()[0]!
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('stroke="#00ffff"')
    expect(svg).toContain('fill="#ff9933"')
    expect(svg).not.toContain('cmyk')
    expect(svg).not.toContain('spot(')
    expect(svg).not.toContain('devicen')
  })
})

describe('DeviceGray operators', () => {
  function renderPdf(draw: (backend: InstanceType<typeof PdfBackend>) => void): string {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    draw(backend)
    backend.endPage()
    backend.endDocument()
    return pdfToText(backend.toUint8Array())
  }

  it('achromatic fills and strokes use g/G (ISO 32000 8.6.4.2)', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: '#808080', stroke: '#000000', strokeWidth: 1 })
    })
    expect(text).toMatch(/0\.50\d* g\b/)
    expect(text).toContain('0 G')
    expect(text).not.toContain(' rg')
    expect(text).not.toContain(' RG')
  })

  it('chromatic colors still use rg/RG', () => {
    const text = renderPdf(function (backend) {
      backend.drawRect(10, 10, 30, 20, { fill: '#ff0000', stroke: '#0000ff', strokeWidth: 1 })
    })
    expect(text).toContain('1 0 0 rg')
    expect(text).toContain('0 0 1 RG')
  })
})

describe('ICCBased content color output (colorProfile: srgb-icc)', () => {
  it('wraps RGB content colors in an ICCBased sRGB color space', () => {
    const backend = new PdfBackend({ fonts: {}, colorProfile: 'srgb-icc' })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: '#ff0000', stroke: '#123456', strokeWidth: 1 })
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/CSicc cs')
    expect(text).toContain('1 0 0 scn')
    expect(text).toContain('/CSicc CS')
    expect(text).toContain('/ICCBased')
    expect(text).toContain('/N 3')
    expect(text).toContain('/ColorSpace <<')
    expect(text).not.toContain(' rg')
    expect(text).not.toContain(' RG')
  })

  it('cmyk() and spot() colors stay native under the profile', () => {
    const backend = new PdfBackend({ fonts: {}, colorProfile: 'srgb-icc' })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: 'cmyk(0,100,100,0)' })
    backend.endPage()
    backend.endDocument()
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('0 1 1 0 k')
  })

  it('round trips through the importer via the embedded profile', async () => {
    const { PdfImporter } = await import('../../src/index.js')
    const backend = new PdfBackend({ fonts: {}, colorProfile: 'srgb-icc' })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawRect(10, 10, 30, 20, { fill: '#ff0000' })
    backend.endPage()
    backend.endDocument()
    const page = PdfImporter.open(backend.toUint8Array()).importPage(0)
    const rect = page.elements.find(function (el) { return el.type === 'rectangle' || el.type === 'path' })!
    const fill = (rect as { fill?: string }).fill as string
    // sRGB profile round trip returns to (nearly) the original red
    expect(parseInt(fill.slice(1, 3), 16)).toBeGreaterThan(240)
    expect(parseInt(fill.slice(3, 5), 16)).toBeLessThan(40)
  })
})
