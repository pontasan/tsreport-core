// ICCBased real-profile interpretation and Indexed color spaces for vector
// content: colors flow through the embedded ICC transform (matrix-TRC, gray
// TRC, mft1 LUT) or the palette lookup instead of a component-count
// approximation. Unprocessable profiles use the Alternate color space, the
// behavior ISO 32000-1 8.6.5.5 prescribes.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PdfImporter } from '../../src/index.js'
import { inspectIccProfile, parseIccOutputProfile, parseIccProfile } from '../../src/pdf/icc-profile-reader.js'
import { parsePdfColorSpace, pdfColorToRgb } from '../../src/pdf/pdf-colorspace.js'
import { parsePdf } from '../../src/pdf/pdf-parser.js'
import { generateSRGBIccProfile, generateCmykIccProfile } from '../../src/renderer/icc-profile.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import type { PathDef, PdfSpecialColorDef } from '../../src/types/template.js'

const SYSTEM_SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc'
const ICC_ORACLE_AVAILABLE = existsSync(SYSTEM_SRGB) && spawnSync('convert', ['-version']).status === 0

// ─── Direct profile transform ───

describe('parseIccProfile', () => {
  it('validates profile class, version, data color space, PCS, intent, illuminant, and reserved header bytes', () => {
    expect(inspectIccProfile(generateSRGBIccProfile())).toMatchObject({
      versionMajor: 2,
      versionMinor: 4,
      profileClass: 'display',
      dataColorSpace: 'RGB',
      connectionSpace: 'XYZ',
      components: 3,
      renderingIntent: 'Perceptual',
    })
    expect(inspectIccProfile(generateCmykIccProfile())).toMatchObject({
      profileClass: 'output', dataColorSpace: 'CMYK', connectionSpace: 'Lab', components: 4,
    })
    const invalidSize = generateSRGBIccProfile().slice()
    new DataView(invalidSize.buffer).setUint32(0, invalidSize.length - 1)
    expect(() => inspectIccProfile(invalidSize)).toThrow('size does not match')
    const invalidReserved = generateSRGBIccProfile().slice()
    invalidReserved[127] = 1
    expect(() => inspectIccProfile(invalidReserved)).toThrow('reserved header bytes')
  })

  it('interprets an RGB matrix-TRC profile (self-generated sRGB)', () => {
    const transform = parseIccProfile(generateSRGBIccProfile())
    expect(transform).not.toBeNull()
    expect(transform!.components).toBe(3)
    const white = transform!.toRgb([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 1)
    expect(white[1]).toBeCloseTo(1, 1)
    expect(white[2]).toBeCloseTo(1, 1)
    const black = transform!.toRgb([0, 0, 0])
    expect(black[0]).toBeCloseTo(0, 2)
    expect(black[1]).toBeCloseTo(0, 2)
    expect(black[2]).toBeCloseTo(0, 2)
    // sRGB primaries survive the D50 round trip: red stays dominantly red
    const red = transform!.toRgb([1, 0, 0])
    expect(red[0]).toBeGreaterThan(0.95)
    expect(red[1]).toBeLessThan(0.15)
    expect(red[2]).toBeLessThan(0.15)
  })

  it('interprets a CMYK mft1 LUT profile (self-generated output profile)', () => {
    const transform = parseIccProfile(generateCmykIccProfile())
    expect(transform).not.toBeNull()
    expect(transform!.components).toBe(4)
    const paper = transform!.toRgb([0, 0, 0, 0])
    expect(paper[0]).toBeGreaterThan(0.9)
    expect(paper[1]).toBeGreaterThan(0.9)
    expect(paper[2]).toBeGreaterThan(0.9)
    const ink = transform!.toRgb([0, 0, 0, 1])
    expect(ink[0]).toBeLessThan(0.1)
    expect(ink[1]).toBeLessThan(0.1)
    expect(ink[2]).toBeLessThan(0.1)
    // M+Y = red: with only 2 grid points per axis the naive corner colors apply
    const red = transform!.toRgb([0, 1, 1, 0])
    expect(red[0]).toBeGreaterThan(0.7)
    expect(red[1]).toBeLessThan(0.35)
    expect(red[2]).toBeLessThan(0.35)
  })

  it('uses the output profile B2A transform for sRGB-to-device conversion', () => {
    const transform = parseIccOutputProfile(generateCmykIccProfile())
    expect(transform.destinationColorSpace).toBe('CMYK')
    expect(transform.components).toBe(4)

    const paper = transform.fromRgb([1, 1, 1], 'RelativeColorimetric')
    expect(Math.max(...paper)).toBeLessThan(0.08)

    const black = transform.fromRgb([0, 0, 0], 'RelativeColorimetric')
    expect(black[3]).toBeGreaterThan(0.9)

    const red = transform.fromRgb([1, 0, 0], 'RelativeColorimetric')
    expect(red[0]).toBeLessThan(0.2)
    expect(red[1]).toBeGreaterThan(0.65)
    expect(red[2]).toBeGreaterThan(0.65)
  })

  it('returns null for a profile class it does not model (ISO alternate path)', () => {
    const bytes = new Uint8Array(132)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 132)          // size
    view.setUint32(8, 0x04000000)   // version 4
    view.setUint32(12, 0x6C696E6B)  // 'link' device class
    view.setUint32(16, 0x52474220)  // 'RGB '
    view.setUint32(20, 0x58595A20)  // 'XYZ '
    view.setUint32(36, 0x61637370)  // 'acsp'
    view.setUint32(128, 0)          // tag count
    expect(parseIccProfile(bytes)).toBeNull()
  })

  it('selects A2B0, A2B1, and A2B2 from the PDF rendering intent', () => {
    const transform = parseIccProfile(buildIntentProfile())!
    const perceptual = transform.toRgb([0.5, 0.5, 0.5], 'Perceptual')
    const relative = transform.toRgb([0.5, 0.5, 0.5], 'RelativeColorimetric')
    const absolute = transform.toRgb([0.5, 0.5, 0.5], 'AbsoluteColorimetric')
    const saturation = transform.toRgb([0.5, 0.5, 0.5], 'Saturation')
    expect(perceptual[1]).toBeLessThan(relative[1])
    expect(relative[1]).toBeLessThan(saturation[1])
    expect(absolute[1]).toBeLessThan(relative[1])
    expect(transform.toRgb([0.5, 0.5, 0.5])).toEqual(relative)
  })

  it('maps the source black point to sRGB black with ISO 18619 compensation', () => {
    const transform = parseIccProfile(buildIntentProfile())!
    const uncorrectedBlack = transform.toRgb([0, 0, 0], 'RelativeColorimetric')
    const correctedBlack = transform.toRgb([0, 0, 0], 'RelativeColorimetric', true)
    const uncorrectedMid = transform.toRgb([0.5, 0.5, 0.5], 'RelativeColorimetric')
    const correctedMid = transform.toRgb([0.5, 0.5, 0.5], 'RelativeColorimetric', true)
    expect(uncorrectedBlack[1]).toBeGreaterThan(0.2)
    expect(correctedBlack[0]).toBeLessThan(0.15)
    expect(correctedBlack[1]).toBeLessThan(0.15)
    expect(correctedBlack[2]).toBeLessThan(0.15)
    expect(correctedMid[1]).toBeLessThan(uncorrectedMid[1])
    expect(transform.toRgb([0.5, 0.5, 0.5], 'AbsoluteColorimetric', true))
      .toEqual(transform.toRgb([0.5, 0.5, 0.5], 'AbsoluteColorimetric', false))
  })

  it('interprets deterministic mft2 and mAB profile transforms', () => {
    const mft2 = parseIccProfile(buildSingleLutProfile('mft2'))!
    const mab = parseIccProfile(buildSingleLutProfile('mAB'))!
    expect(mft2.sourceColorSpace).toBe('RGB')
    expect(mab.sourceColorSpace).toBe('RGB')
    const a = mft2.toRgb([0.2, 0.6, 0.9])
    const b = mab.toRgb([0.2, 0.6, 0.9])
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(a[channel]! - b[channel]!)).toBeLessThan(0.01)
  })

  it.skipIf(!ICC_ORACLE_AVAILABLE)('matches an independent ICC engine for real RGB and CMYK profiles', () => {
    const rgbProfiles = [
      '/System/Library/ColorSync/Profiles/Display P3.icc',
      '/System/Library/ColorSync/Profiles/AdobeRGB1998.icc',
      '/System/Library/ColorSync/Profiles/Generic RGB Profile.icc',
      '/System/Library/ColorSync/Profiles/ROMM RGB.icc',
      '/System/Library/ColorSync/Profiles/ITU-2020.icc',
    ]
    const rgbSample = [180, 90, 30]
    const ppm = Buffer.concat([Buffer.from('P6\n1 1\n255\n'), Buffer.from(rgbSample)])
    for (const profile of rgbProfiles) {
      const transform = parseIccProfile(readFileSync(profile))!
      const oracle = spawnSync('convert', ['ppm:-', '+profile', '*', '-profile', profile, '-profile', SYSTEM_SRGB, 'ppm:-'], { input: ppm })
      expect(oracle.status, oracle.stderr.toString()).toBe(0)
      const expected = oracle.stdout.subarray(oracle.stdout.length - 3)
      const actual = transform.toRgb(rgbSample.map(function (value) { return value / 255 })).map(function (value) { return Math.round(value * 255) })
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[channel]! - expected[channel]!), `${profile} channel ${channel}`).toBeLessThanOrEqual(2)
    }

    const cmykProfile = '/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc'
    const cmykSample = [30, 80, 120, 40]
    const transform = parseIccProfile(readFileSync(cmykProfile))!
    const oracle = spawnSync('convert', ['-size', '1x1', '-depth', '8', 'cmyk:-', '+profile', '*', '-profile', cmykProfile, '-profile', SYSTEM_SRGB, 'ppm:-'], { input: Buffer.from(cmykSample) })
    expect(oracle.status, oracle.stderr.toString()).toBe(0)
    const expected = oracle.stdout.subarray(oracle.stdout.length - 3)
    const actual = transform.toRgb(cmykSample.map(function (value) { return value / 255 })).map(function (value) { return Math.round(value * 255) })
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[channel]! - expected[channel]!), `CMYK channel ${channel}`).toBeLessThanOrEqual(2)

    const darkSample = [160, 160, 160, 160]
    const bpcOracle = spawnSync('convert', [
      '-size', '1x1', '-depth', '8', 'cmyk:-', '+profile', '*',
      '-profile', cmykProfile, '-intent', 'relative', '-black-point-compensation',
      '-profile', SYSTEM_SRGB, 'ppm:-',
    ], { input: Buffer.from(darkSample) })
    expect(bpcOracle.status, bpcOracle.stderr.toString()).toBe(0)
    const bpcExpected = bpcOracle.stdout.subarray(bpcOracle.stdout.length - 3)
    const bpcActual = transform.toRgb(
      darkSample.map(function (value) { return value / 255 }),
      'RelativeColorimetric',
      true,
    ).map(function (value) { return Math.round(value * 255) })
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(bpcActual[channel]! - bpcExpected[channel]!), `CMYK BPC channel ${channel}`).toBeLessThanOrEqual(5)
    }
  })
})

// ─── Vector content through the interpreter ───

function firstFilledPath(pdf: Uint8Array): PathDef {
  const page = PdfImporter.open(pdf).importPage(0)
  const paths: PathDef[] = []
  const walk = function (elements: typeof page.elements): void {
    for (const el of elements) {
      if (el.type === 'path' && el.fill !== undefined) paths.push(el)
      if (el.type === 'frame' && el.elements !== undefined) walk(el.elements)
    }
  }
  walk(page.elements)
  expect(paths.length).toBeGreaterThan(0)
  return paths[0]!
}

function hexChannel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
}

describe('ICCBased and Indexed vector fills', () => {
  it('fills through an embedded sRGB matrix-TRC profile', () => {
    const profile = generateSRGBIccProfile()
    const pdf = buildColorSpacePdf(
      `[/ICCBased 5 0 R]`,
      '/CS0 cs 1 0 0 scn 10 10 30 30 re f',
      [iccStreamObject(5, profile, 3)],
    )
    const fill = firstFilledPath(pdf).fill as string
    expect(hexChannel(fill, 0)).toBeGreaterThan(240)
    expect(hexChannel(fill, 1)).toBeLessThan(40)
    expect(hexChannel(fill, 2)).toBeLessThan(40)
  })

  it('normalizes ICCBased operands through the profile Range before conversion', () => {
    const profile = generateSRGBIccProfile()
    const pdf = buildColorSpacePdf(
      `[/ICCBased 5 0 R]`,
      '/CS0 cs 255 0 0 scn 10 10 30 30 re f',
      [iccStreamObject(5, profile, 3, '/Range [0 255 0 255 0 255] ')],
    )
    const fill = firstFilledPath(pdf).fill as string
    expect(hexChannel(fill, 0)).toBeGreaterThan(240)
    expect(hexChannel(fill, 1)).toBeLessThan(40)
    expect(hexChannel(fill, 2)).toBeLessThan(40)
  })

  it('fills through an embedded CMYK LUT profile', () => {
    const profile = generateCmykIccProfile()
    const pdf = buildColorSpacePdf(
      `[/ICCBased 5 0 R]`,
      '/CS0 cs 0 0 0 1 scn 10 10 30 30 re f',
      [iccStreamObject(5, profile, 4)],
    )
    const fill = firstFilledPath(pdf).fill as string
    expect(hexChannel(fill, 0)).toBeLessThan(30)
    expect(hexChannel(fill, 1)).toBeLessThan(30)
    expect(hexChannel(fill, 2)).toBeLessThan(30)
  })

  it('uses the Alternate color space for an unprocessable profile', () => {
    const link = new Uint8Array(132)
    const view = new DataView(link.buffer)
    view.setUint32(0, 132)
    view.setUint32(8, 0x04000000)
    view.setUint32(12, 0x6C696E6B)
    view.setUint32(16, 0x52474220)
    view.setUint32(20, 0x58595A20)
    view.setUint32(36, 0x61637370)
    const pdf = buildColorSpacePdf(
      `[/ICCBased 5 0 R]`,
      '/CS0 cs 0 1 0 scn 10 10 30 30 re f',
      [iccStreamObject(5, link, 3, '/Alternate /DeviceRGB ')],
    )
    expect(firstFilledPath(pdf).fill).toBe('#00ff00')
  })

  it('requires ICCBased N and validates Alternate component count', () => {
    const link = new Uint8Array(132)
    const view = new DataView(link.buffer)
    view.setUint32(0, 132)
    view.setUint32(8, 0x04000000)
    view.setUint32(12, 0x6C696E6B)
    view.setUint32(16, 0x52474220)
    view.setUint32(20, 0x58595A20)
    view.setUint32(36, 0x61637370)
    const missingN = buildColorSpacePdf(
      `[/ICCBased 5 0 R]`,
      '/CS0 cs 0 0 0 scn 10 10 30 30 re f',
      [iccStreamObject(5, link, 3).replace('/N 3 ', '')],
    )
    expect(() => firstFilledPath(missingN)).toThrow(/ICCBased \/N must be 1, 3, or 4/)
    const wrongAlternate = buildColorSpacePdf(
      `[/ICCBased 5 0 R]`,
      '/CS0 cs 0 0 0 scn 10 10 30 30 re f',
      [iccStreamObject(5, link, 3, '/Alternate /DeviceCMYK ')],
    )
    expect(() => firstFilledPath(wrongAlternate)).toThrow(/Alternate must be a non-Pattern color space matching \/N/)
  })

  it('rejects nCLR profile signatures that PDF does not permit for ICCBased', () => {
    const profile = buildIntentProfile()
    new DataView(profile.buffer, profile.byteOffset, profile.byteLength).setUint32(16, 0x33434C52) // 3CLR
    const pdf = buildColorSpacePdf(
      '[/ICCBased 5 0 R]',
      '/CS0 cs 0 0 0 scn 10 10 30 30 re f',
      [iccStreamObject(5, profile, 3)],
    )
    expect(() => firstFilledPath(pdf)).toThrow(/profile color space 3CLR is not permitted/)
  })

  it('fills through an Indexed palette (sc with a palette index)', () => {
    const pdf = buildColorSpacePdf(
      '[/Indexed /DeviceRGB 1 <FF000000FF00>]',
      '/CS0 cs 1 sc 10 10 30 30 re f',
      [],
    )
    expect(firstFilledPath(pdf).fill).toBe('#00ff00')
  })

  it('rejects an Indexed lookup shorter than hival requires', () => {
    const pdf = buildColorSpacePdf(
      '[/Indexed /DeviceRGB 2 <FF000000FF00>]',
      '/CS0 cs 1 sc 10 10 30 30 re f',
      [],
    )
    expect(function () { PdfImporter.open(pdf).importPage(0) })
      .toThrow(/Indexed color space lookup table is shorter/)
  })

  it('applies DefaultRGB to both rg and DeviceRGB/sc operators', () => {
    const replacement = '[/CalRGB << /WhitePoint [0.9505 1 1.089] /Matrix [0 1 0 1 0 0 0 0 1] >>]'
    const direct = buildColorSpacePdf('/DeviceRGB', '1 0 0 rg 10 10 30 30 re f', [], `/DefaultRGB ${replacement}`)
    const selected = buildColorSpacePdf('/DeviceRGB', '/DeviceRGB cs 1 0 0 sc 10 10 30 30 re f', [], `/DefaultRGB ${replacement}`)
    expect(firstFilledPath(direct).fill).not.toBe('#ff0000')
    expect(firstFilledPath(selected).fill).toBe(firstFilledPath(direct).fill)
  })

  it('retains NChannel Colorants, Process, and MixingHints dictionaries', () => {
    const colorSpace = `[/DeviceN [/Cyan /Spot] /DeviceCMYK 5 0 R <<
      /Subtype /NChannel
      /Colorants << /Spot [/Separation /Spot /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0 1 0] /N 1 >>] >>
      /Process << /ColorSpace /DeviceCMYK /Components [/Cyan /Magenta /Yellow /Black] >>
      /MixingHints <<
        /Solidities << /Spot 0.82 >>
        /PrintingOrder [/Cyan /Spot]
        /DotGain << /Spot << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >>
      >>
    >>]`
    const tint = '{ 2 copy pop 0 0 4 -1 roll 4 -1 roll }'
    const pdf = buildColorSpacePdf(colorSpace, '/CS0 cs 0.25 0.75 scn 10 10 30 30 re f', [functionStreamObject(5, tint, '[0 1 0 1]', '[0 1 0 1 0 1 0 1]')])
    const doc = parsePdf(pdf)
    const page = doc.resolve(doc.getObject(3))
    expect(page).toBeInstanceOf(Map)
    const resources = doc.resolve((page as Map<string, unknown>).get('Resources') as never)
    const spaces = doc.resolve((resources as Map<string, unknown>).get('ColorSpace') as never)
    const parsed = parsePdfColorSpace(doc, (spaces as Map<string, unknown>).get('CS0') as never, resources as never)
    expect(parsed.kind).toBe('deviceN')
    if (parsed.kind !== 'deviceN') return
    expect(parsed.names).toEqual(['Cyan', 'Spot'])
    expect(parsed.attributes?.subtype).toBe('NChannel')
    expect(parsed.attributes?.colorants.get('Spot')?.name).toBe('Spot')
    expect(parsed.attributes?.process?.components).toEqual(['Cyan', 'Magenta', 'Yellow', 'Black'])
    expect(parsed.attributes?.mixingHints?.solidities.get('Spot')).toBe(0.82)
    expect(parsed.attributes?.mixingHints?.printingOrder).toEqual(['Cyan', 'Spot'])
    expect(parsed.attributes?.mixingHints?.dotGain.has('Spot')).toBe(true)
    expect(pdfColorToRgb(doc, parsed, [0.25, 0.75])).toEqual([0.75, 0.75, 0])

    const imported = firstFilledPath(pdf).fill as PdfSpecialColorDef
    expect(imported.type).toBe('pdfSpecialColor')
    expect(imported.components).toEqual([0.25, 0.75])
    expect(imported.colorSpace.kind).toBe('deviceN')
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.drawPathWithPaints(
      Uint8Array.from([0, 1, 1, 1, 3]),
      Float32Array.from([10, 10, 40, 10, 40, 40, 10, 40]),
      { fill: imported },
    )
    backend.endPage()
    backend.endDocument()
    const roundTripped = firstFilledPath(backend.toUint8Array()).fill as PdfSpecialColorDef
    expect(roundTripped.type).toBe('pdfSpecialColor')
    expect(roundTripped.components).toEqual([0.25, 0.75])
    expect(roundTripped.colorSpace).toEqual(imported.colorSpace)
    expect(roundTripped.displayColor).toBe(imported.displayColor)
  })

  it('rejects a tint transform whose output dimension differs from its alternate space', () => {
    const pdf = buildColorSpacePdf(
      '[/Separation /Spot /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>]',
      '/CS0 cs 0.5 scn 10 10 30 30 re f',
      [],
    )
    expect(() => firstFilledPath(pdf)).toThrow(/tint transform produced 3 components; alternate color space requires 4/)
  })

  it('retains calibrated-space BlackPoint data inside a Separation alternate', () => {
    const pdf = buildColorSpacePdf(
      '[/Separation /Spot [/CalRGB << /WhitePoint [1 1 1] /BlackPoint [0.1 0.2 0.3] >>] << /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>]',
      '/CS0 cs 0.5 scn 10 10 30 30 re f',
      [],
    )
    const fill = firstFilledPath(pdf).fill as PdfSpecialColorDef
    expect(fill.colorSpace).toMatchObject({
      kind: 'separation',
      alternate: { kind: 'calrgb', whitePoint: [1, 1, 1], blackPoint: [0.1, 0.2, 0.3] },
    })
    const invalid = buildColorSpacePdf(
      '[/CalGray << /WhitePoint [1 1 1] /BlackPoint [0 -0.1 0] >>]',
      '/CS0 cs 0.5 scn 10 10 30 30 re f',
      [],
    )
    expect(() => firstFilledPath(invalid)).toThrow(/BlackPoint values must be non-negative/)
  })
})

// ─── Minimal hand-built PDF ───

function iccStreamObject(num: number, profile: Uint8Array, n: number, extraEntries = ''): string {
  const data = binaryString(profile)
  return `${num} 0 obj\n<< /N ${n} ${extraEntries}/Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`
}

function functionStreamObject(num: number, expression: string, domain: string, range: string): string {
  return `${num} 0 obj\n<< /FunctionType 4 /Domain ${domain} /Range ${range} /Length ${expression.length} >>\nstream\n${expression}\nendstream\nendobj\n`
}

function buildColorSpacePdf(colorSpace: string, content: string, extraObjects: string[], extraColorSpaces = ''): Uint8Array {
  const pageStream = `${content}\n`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /CS0 ${colorSpace} ${extraColorSpaces} >> >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${pageStream.length} >>\nstream\n${pageStream}endstream\nendobj\n`,
    ...extraObjects,
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

function binaryString(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function enc(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF
  return bytes
}

function buildIntentProfile(): Uint8Array {
  const tagSize = 48 + 3 * 256 + 2 * 2 * 2 * 3 + 3 * 256
  const firstOffset = 132 + 4 * 12
  const bytes = new Uint8Array(firstOffset + tagSize * 3 + 20)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  view.setUint32(8, 0x04000000)
  view.setUint32(12, 0x6D6E7472) // mntr
  view.setUint32(16, 0x52474220) // RGB
  view.setUint32(20, 0x58595A20) // XYZ PCS
  view.setUint32(36, 0x61637370) // acsp
  view.setUint32(128, 4)
  const tags = ['A2B0', 'A2B1', 'A2B2']
  const levels = [0.02, 0.08, 0.14]
  for (let tagIndex = 0; tagIndex < tags.length; tagIndex++) {
    const table = 132 + tagIndex * 12
    const tag = tags[tagIndex]!
    for (let i = 0; i < 4; i++) bytes[table + i] = tag.charCodeAt(i)
    const offset = firstOffset + tagIndex * tagSize
    view.setUint32(table + 4, offset)
    view.setUint32(table + 8, tagSize)
    view.setUint32(offset, 0x6D667431) // mft1
    bytes[offset + 8] = 3
    bytes[offset + 9] = 3
    bytes[offset + 10] = 2
    for (let i = 0; i < 9; i++) view.setInt32(offset + 12 + i * 4, (i % 4 === 0 ? 1 : 0) * 65536)
    let cursor = offset + 48
    for (let channel = 0; channel < 3; channel++) {
      for (let i = 0; i < 256; i++) bytes[cursor++] = i
    }
    const level = levels[tagIndex]!
    const encoded = [0.9642 * level, level, 0.8249 * level].map(function (component) {
      return Math.round(component * 32768 / 65535 * 255)
    })
    for (let point = 0; point < 8; point++) {
      bytes[cursor++] = encoded[0]!
      bytes[cursor++] = encoded[1]!
      bytes[cursor++] = encoded[2]!
    }
    for (let channel = 0; channel < 3; channel++) {
      for (let i = 0; i < 256; i++) bytes[cursor++] = i
    }
  }
  const whiteTable = 132 + 3 * 12
  bytes.set([0x77, 0x74, 0x70, 0x74], whiteTable) // wtpt
  const whiteOffset = firstOffset + tagSize * 3
  view.setUint32(whiteTable + 4, whiteOffset)
  view.setUint32(whiteTable + 8, 20)
  view.setUint32(whiteOffset, 0x58595A20)
  view.setInt32(whiteOffset + 8, Math.round(0.9642 * 0.8 * 65536))
  view.setInt32(whiteOffset + 12, Math.round(0.8 * 65536))
  view.setInt32(whiteOffset + 16, Math.round(0.8249 * 0.8 * 65536))
  return bytes
}

function buildSingleLutProfile(kind: 'mft2' | 'mAB'): Uint8Array {
  const tag = kind === 'mft2' ? buildMft2Tag() : buildMabTag()
  const offset = 144
  const bytes = new Uint8Array(offset + tag.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  view.setUint32(8, 0x04000000)
  view.setUint32(12, 0x6D6E7472)
  view.setUint32(16, 0x52474220)
  view.setUint32(20, 0x58595A20)
  view.setUint32(36, 0x61637370)
  view.setUint32(128, 1)
  bytes.set([0x41, 0x32, 0x42, 0x31], 132)
  view.setUint32(136, offset)
  view.setUint32(140, tag.length)
  bytes.set(tag, offset)
  return bytes
}

function buildMft2Tag(): Uint8Array {
  const bytes = new Uint8Array(52 + 3 * 2 * 2 + 8 * 3 * 2 + 3 * 2 * 2)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x6D667432)
  bytes[8] = 3
  bytes[9] = 3
  bytes[10] = 2
  for (let i = 0; i < 9; i++) view.setInt32(12 + i * 4, (i % 4 === 0 ? 1 : 0) * 65536)
  view.setUint16(48, 2)
  view.setUint16(50, 2)
  let cursor = 52
  for (let channel = 0; channel < 3; channel++) {
    view.setUint16(cursor, 0); view.setUint16(cursor + 2, 65535); cursor += 4
  }
  const xyz = [0.25, 0.26, 0.21]
  for (let point = 0; point < 8; point++) {
    for (let channel = 0; channel < 3; channel++) {
      view.setUint16(cursor, Math.round(xyz[channel]! * 65535)); cursor += 2
    }
  }
  for (let channel = 0; channel < 3; channel++) {
    view.setUint16(cursor, 0); view.setUint16(cursor + 2, 65535); cursor += 4
  }
  return bytes
}

function buildMabTag(): Uint8Array {
  const bytes = new Uint8Array(148)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x6D414220)
  bytes[8] = 3
  bytes[9] = 3
  view.setUint32(12, 32) // B curves
  view.setUint32(24, 68) // CLUT
  view.setUint32(28, 112) // A curves
  writeIdentityCurveSet(bytes, 32, 3)
  bytes[68] = 2; bytes[69] = 2; bytes[70] = 2
  bytes[84] = 1
  let cursor = 88
  const xyz = [0.25, 0.26, 0.21]
  for (let point = 0; point < 8; point++) {
    for (let channel = 0; channel < 3; channel++) bytes[cursor++] = Math.round(xyz[channel]! * 255)
  }
  writeIdentityCurveSet(bytes, 112, 3)
  return bytes
}

function writeIdentityCurveSet(bytes: Uint8Array, offset: number, count: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < count; i++) view.setUint32(offset + i * 12, 0x63757276)
}
