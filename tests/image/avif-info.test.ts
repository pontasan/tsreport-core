import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAvifInfo } from '../../src/image/avif-parser.js'
import { getImageDimensions } from '../../src/image/image-utils.js'
import { readRasterInfoWithExternalDecoder } from '../../src/image/external-image-decoder.js'

function loadSample(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../sample/images/${name}`, import.meta.url)))
}

/** Build an ISOBMFF box: 32-bit size + fourcc type + payload */
function makeBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  const size = out.length
  out[0] = (size >> 24) & 0xFF; out[1] = (size >> 16) & 0xFF
  out[2] = (size >> 8) & 0xFF; out[3] = size & 0xFF
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  return out
}

function concatBoxes(boxes: Uint8Array[]): Uint8Array {
  let total = 0
  for (const b of boxes) total += b.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const b of boxes) { out.set(b, pos); pos += b.length }
  return out
}

function makeFtyp(brands: string[]): Uint8Array {
  const payload = new Uint8Array(4 + 4 + brands.length * 4)
  const major = brands[0]!
  for (let i = 0; i < 4; i++) payload[i] = major.charCodeAt(i)
  // minor_version = 0, then compatible_brands
  for (let b = 0; b < brands.length; b++) {
    for (let i = 0; i < 4; i++) payload[8 + b * 4 + i] = brands[b]!.charCodeAt(i)
  }
  return makeBox('ftyp', payload)
}

function makeIspe(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(12) // version + flags + width + height
  payload[4] = (width >> 24) & 0xFF; payload[5] = (width >> 16) & 0xFF
  payload[6] = (width >> 8) & 0xFF; payload[7] = width & 0xFF
  payload[8] = (height >> 24) & 0xFF; payload[9] = (height >> 16) & 0xFF
  payload[10] = (height >> 8) & 0xFF; payload[11] = height & 0xFF
  return makeBox('ispe', payload)
}

/** av1C payload: marker+version, profile byte, then high_bitdepth (0x40) / twelve_bit (0x20) flags */
function makeAv1c(highBitdepth: boolean, twelveBit: boolean): Uint8Array {
  const byte2 = (highBitdepth ? 0x40 : 0) | (twelveBit ? 0x20 : 0)
  return makeBox('av1C', new Uint8Array([0x81, 0x00, byte2, 0x00]))
}

function makeAuxc(auxType: string): Uint8Array {
  const payload = new Uint8Array(4 + auxType.length + 1) // version + flags + urn + NUL
  for (let i = 0; i < auxType.length; i++) payload[4 + i] = auxType.charCodeAt(i)
  return makeBox('auxC', payload)
}

/** colr payload with colour_type 'nclx' + CICP triple + full_range flag */
function makeColrNclx(primaries: number, transfer: number, matrix: number, fullRange: boolean): Uint8Array {
  return makeBox('colr', new Uint8Array([
    0x6E, 0x63, 0x6C, 0x78, // 'nclx'
    (primaries >> 8) & 0xFF, primaries & 0xFF,
    (transfer >> 8) & 0xFF, transfer & 0xFF,
    (matrix >> 8) & 0xFF, matrix & 0xFF,
    fullRange ? 0x80 : 0x00,
  ]))
}

function makeMeta(ipcoChildren: Uint8Array[]): Uint8Array {
  const ipco = makeBox('ipco', concatBoxes(ipcoChildren))
  const iprp = makeBox('iprp', ipco)
  const metaPayload = new Uint8Array(4 + iprp.length) // FullBox version + flags
  metaPayload.set(iprp, 4)
  return makeBox('meta', metaPayload)
}

function makeAvif(brands: string[], ipcoChildren: Uint8Array[]): Uint8Array {
  return concatBoxes([makeFtyp(brands), makeMeta(ipcoChildren)])
}

describe('AVIF info: real files', () => {
  // Verifies parseAvifInfo agrees with getImageDimensions and the external
  // (sharp-based) decoder metadata for the sample files, including bit depth
  // (8-bit av1C) and alpha absence.
  for (const file of ['format_check.avif', 'format_check2.avif']) {
    it(`parses ${file} consistently with getImageDimensions and the external decoder`, () => {
      const data = loadSample(file)
      const info = parseAvifInfo(data)

      const dims = getImageDimensions(data)
      expect(dims).not.toBeNull()
      expect(info.width).toBe(dims!.width)
      expect(info.height).toBe(dims!.height)

      const external = readRasterInfoWithExternalDecoder(data, 'avif')
      expect(info.width).toBe(external.width)
      expect(info.height).toBe(external.height)
      expect(info.hasAlpha).toBe(external.hasAlpha)

      expect(info.bitDepth).toBe(8)
      expect(info.isAnimated).toBeUndefined()
    })
  }
})

describe('AVIF info: synthetic containers', () => {
  // Verifies dimensions come from the ispe property.
  it('parses dimensions from ispe', () => {
    const info = parseAvifInfo(makeAvif(['avif'], [makeIspe(123, 456)]))
    expect(info.width).toBe(123)
    expect(info.height).toBe(456)
    expect(info.hasAlpha).toBe(false)
    expect(info.bitDepth).toBeUndefined()
    expect(info.cicp).toBeUndefined()
    expect(info.isAnimated).toBeUndefined()
  })

  // Verifies bit depth decoding from the av1C high_bitdepth / twelve_bit flags.
  it('parses bit depth from av1C', () => {
    const cases: Array<[boolean, boolean, number]> = [[false, false, 8], [true, false, 10], [true, true, 12]]
    for (const [high, twelve, expected] of cases) {
      const info = parseAvifInfo(makeAvif(['avif'], [makeIspe(4, 4), makeAv1c(high, twelve)]))
      expect(info.bitDepth).toBe(expected)
    }
  })

  // Verifies alpha detection from an auxC property with an alpha aux_type URN.
  it('detects alpha from auxC', () => {
    const alpha = parseAvifInfo(makeAvif(['avif'], [
      makeIspe(4, 4),
      makeAuxc('urn:mpeg:mpegB:cicp:systems:auxiliary:alpha'),
    ]))
    expect(alpha.hasAlpha).toBe(true)

    const depth = parseAvifInfo(makeAvif(['avif'], [
      makeIspe(4, 4),
      makeAuxc('urn:mpeg:mpegB:cicp:systems:auxiliary:depth'),
    ]))
    expect(depth.hasAlpha).toBe(false)
  })

  // Verifies CICP extraction from a colr box with colour_type 'nclx'.
  it('parses CICP from colr (nclx)', () => {
    const info = parseAvifInfo(makeAvif(['avif'], [
      makeIspe(4, 4),
      makeColrNclx(9, 16, 9, true), // BT.2020 / PQ / BT.2020 NCL, full range
    ]))
    expect(info.cicp).toEqual({
      colorPrimaries: 9,
      transferCharacteristics: 16,
      matrixCoefficients: 9,
      colorRange: 1,
    })

    const limited = parseAvifInfo(makeAvif(['avif'], [
      makeIspe(4, 4),
      makeColrNclx(1, 13, 6, false), // BT.709 / sRGB / BT.601, limited range
    ]))
    expect(limited.cicp!.colorRange).toBe(0)
  })

  // Verifies animation detection via the 'avis' brand in ftyp.
  it('detects animation from the avis brand', () => {
    const animated = parseAvifInfo(makeAvif(['avis', 'avif'], [makeIspe(4, 4)]))
    expect(animated.isAnimated).toBe(true)

    const still = parseAvifInfo(makeAvif(['avif', 'mif1'], [makeIspe(4, 4)]))
    expect(still.isAnimated).toBeUndefined()
  })
})

describe('AVIF info: error handling', () => {
  // Verifies a missing ftyp box is rejected.
  it('rejects data without ftyp', () => {
    expect(() => parseAvifInfo(new Uint8Array(32))).toThrow('AVIF: missing ftyp box')
  })

  // Verifies a missing meta box is rejected.
  it('rejects data without meta', () => {
    expect(() => parseAvifInfo(makeFtyp(['avif']))).toThrow('AVIF: missing meta box')
  })

  // Verifies a meta box without iprp is rejected.
  it('rejects data without iprp', () => {
    const metaPayload = new Uint8Array(4)
    const data = concatBoxes([makeFtyp(['avif']), makeBox('meta', metaPayload)])
    expect(() => parseAvifInfo(data)).toThrow('AVIF: missing iprp box')
  })

  // Verifies an iprp box without ipco is rejected.
  it('rejects data without ipco', () => {
    const iprp = makeBox('iprp', makeBox('free', new Uint8Array(0)))
    const metaPayload = new Uint8Array(4 + iprp.length)
    metaPayload.set(iprp, 4)
    const data = concatBoxes([makeFtyp(['avif']), makeBox('meta', metaPayload)])
    expect(() => parseAvifInfo(data)).toThrow('AVIF: missing ipco box')
  })

  // Verifies an ipco box without ispe is rejected.
  it('rejects data without ispe', () => {
    const data = makeAvif(['avif'], [makeAv1c(false, false)])
    expect(() => parseAvifInfo(data)).toThrow('AVIF: missing ispe box')
  })

  // Verifies zero ispe dimensions are rejected.
  it('rejects zero dimensions', () => {
    expect(() => parseAvifInfo(makeAvif(['avif'], [makeIspe(0, 4)]))).toThrow('AVIF: invalid dimensions')
    expect(() => parseAvifInfo(makeAvif(['avif'], [makeIspe(4, 0)]))).toThrow('AVIF: invalid dimensions')
  })
})
