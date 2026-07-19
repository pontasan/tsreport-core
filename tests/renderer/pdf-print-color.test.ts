import { describe, expect, it } from 'vitest'
import {
  compositePdfOverprintRgba,
  compositePdfPrintPlates,
  createPdfPrintColorTransform,
  resolvePdfPrintColor,
} from '../../src/renderer/pdf-print-color.js'
import type { PdfSpecialColorDef } from '../../src/types/template.js'
import { generateCmykIccProfile } from '../../src/renderer/icc-profile.js'

describe('PDF native print-color compositing', () => {
  it('retains native CMYK, Separation, and DeviceN colorants', () => {
    expect(resolvePdfPrintColor('cmyk(10,20,30,40)')).toMatchObject({
      kind: 'cmyk',
      colorants: ['Cyan', 'Magenta', 'Yellow', 'Black'],
      components: [0.1, 0.2, 0.3, 0.4],
    })
    expect(resolvePdfPrintColor('spot(Gold,0,20,100,0)')).toMatchObject({
      kind: 'separation', colorants: ['Gold'], components: [1],
    })
    expect(resolvePdfPrintColor('devicen(Orange,Varnish;75,25;0,50,100,0)')).toMatchObject({
      kind: 'deviceN', colorants: ['Orange', 'Varnish'], components: [0.75, 0.25],
    })
  })

  it('evaluates imported DeviceN tint transforms for the process preview', () => {
    const paint: PdfSpecialColorDef = {
      type: 'pdfSpecialColor',
      colorSpace: {
        kind: 'deviceN', names: ['Orange', 'Varnish'], alternate: { kind: 'cmyk' },
        tintTransform: {
          functionType: 4, domain: [0, 1, 0, 1], range: [0, 1, 0, 1, 0, 1, 0, 1],
          expression: '{ exch 0 exch 0 }',
        },
        subtype: 'DeviceN', colorants: {},
      },
      components: [0.75, 0.25],
      displayColor: '#40ffbf',
    }
    expect(resolvePdfPrintColor(paint).processCmyk).toEqual([0.25, 0, 0.75, 0])
  })

  it('uses the supplied ICC output transform for RGB process previews', () => {
    const transform = createPdfPrintColorTransform(zeroB2aClut(generateCmykIccProfile()))
    expect(resolvePdfPrintColor('#ff0000', transform).processCmyk).toEqual([0, 0, 0, 0])
  })

  it('applies OPM 0/1 and knockout to every native plate', () => {
    const names = ['Cyan', 'Magenta', 'Yellow', 'Black', 'Gold']
    const magenta = resolvePdfPrintColor('cmyk(0,100,0,0)')
    const opm1 = new Float64Array([1, 0, 0, 0, 0.8])
    compositePdfPrintPlates(opm1, names, magenta, 1, true, 1)
    expect(Array.from(opm1)).toEqual([1, 1, 0, 0, 0.8])

    const opm0 = new Float64Array([1, 0, 0, 0, 0.8])
    compositePdfPrintPlates(opm0, names, magenta, 1, true, 0)
    expect(Array.from(opm0)).toEqual([0, 1, 0, 0, 0.8])

    const knockout = new Float64Array([1, 0, 0, 0, 0.8])
    compositePdfPrintPlates(knockout, names, magenta, 1, false, 1)
    expect(Array.from(knockout)).toEqual([0, 1, 0, 0, 0])
  })

  it('updates only named DeviceN plates under overprint', () => {
    const names = ['Cyan', 'Magenta', 'Yellow', 'Black', 'Orange', 'Varnish']
    const plates = new Float64Array([0.4, 0.3, 0.2, 0.1, 0, 0.9])
    const color = resolvePdfPrintColor('devicen(Orange,Varnish;75,0;0,50,100,0)')
    compositePdfPrintPlates(plates, names, color, 1, true, 1)
    expect(Array.from(plates)).toEqual([0.4, 0.3, 0.2, 0.1, 0.75, 0])
  })

  it('produces different actual pixels for OPM 0 and OPM 1', () => {
    const source = new Uint8ClampedArray([255, 0, 255, 255])
    const paint = [{ color: resolvePdfPrintColor('cmyk(0,100,0,0)'), stroke: false }]
    const opm0 = new Uint8ClampedArray([0, 255, 255, 255])
    const opm1 = opm0.slice()
    compositePdfOverprintRgba(opm0, source, paint, true, false, 0, 'normal')
    compositePdfOverprintRgba(opm1, source, paint, true, false, 1, 'normal')
    expect(Array.from(opm0)).toEqual([255, 0, 255, 255])
    expect(opm1[0]).toBeLessThan(60)
    expect(opm1[1]).toBeLessThan(10)
    expect(opm1[2]).toBeGreaterThan(240)
    expect(opm1[3]).toBe(255)
  })

  it('adds a named spot alternate without erasing existing process ink', () => {
    const target = new Uint8ClampedArray([0, 255, 255, 255])
    const source = new Uint8ClampedArray([255, 255, 0, 255])
    const paint = [{ color: resolvePdfPrintColor('spot(Gold,0,0,100,0)'), stroke: false }]
    compositePdfOverprintRgba(target, source, paint, true, false, 1, 'normal')
    expect(target[0]).toBeLessThan(60)
    expect(target[1]).toBeGreaterThan(240)
    expect(target[2]).toBeLessThan(10)
    expect(target[3]).toBe(255)
  })
})

function zeroB2aClut(source: Uint8Array): Uint8Array {
  const profile = source.slice()
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
  const tagCount = view.getUint32(128)
  for (let index = 0; index < tagCount; index++) {
    const entry = 132 + index * 12
    const signature = String.fromCharCode(profile[entry]!, profile[entry + 1]!, profile[entry + 2]!, profile[entry + 3]!)
    if (signature !== 'B2A0') continue
    const offset = view.getUint32(entry + 4)
    const inputs = profile[offset + 8]!
    const outputs = profile[offset + 9]!
    const grid = profile[offset + 10]!
    const clutStart = offset + 48 + inputs * 256
    profile.fill(0, clutStart, clutStart + Math.pow(grid, inputs) * outputs)
    return profile
  }
  throw new Error('test fixture error: B2A0 tag not found')
}
