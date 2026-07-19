import { describe, expect, it } from 'vitest'
import { Font } from '../../src/font.js'
import { parseFont } from '../../src/parsers/index.js'

function buildCollection(options: {
  majorVersion?: number
  minorVersion?: number
  signatureTag?: number
  signatureLength?: number
  signatureOffset?: number
  secondOffset?: number
  truncateTo?: number
} = {}): ArrayBuffer {
  const majorVersion = options.majorVersion ?? 2
  const headerLength = 12 + 2 * 4 + (majorVersion === 2 ? 12 : 0)
  const firstOffset = headerLength
  const secondOffset = options.secondOffset ?? firstOffset + 28
  const dataOffset = secondOffset + 28
  const signatureLength = options.signatureLength ?? 8
  const totalLength = Math.max(dataOffset + 4, (options.signatureOffset ?? dataOffset) + signatureLength)
  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)
  view.setUint32(0, 0x74746366)
  view.setUint16(4, majorVersion)
  view.setUint16(6, options.minorVersion ?? 0)
  view.setUint32(8, 2)
  view.setUint32(12, firstOffset)
  view.setUint32(16, secondOffset)
  if (majorVersion === 2) {
    view.setUint32(20, options.signatureTag ?? 0x44534947)
    view.setUint32(24, signatureLength)
    view.setUint32(28, options.signatureOffset ?? dataOffset)
  }
  writeSfntDirectory(view, firstOffset, 0x00010000, dataOffset)
  writeSfntDirectory(view, secondOffset, 0x4F54544F, dataOffset)
  view.setUint32(dataOffset, 0x00000001)
  return options.truncateTo === undefined ? buffer : buffer.slice(0, options.truncateTo)
}

function writeSfntDirectory(view: DataView, offset: number, version: number, tableOffset: number): void {
  view.setUint32(offset, version)
  view.setUint16(offset + 4, 1)
  view.setUint16(offset + 6, 16)
  view.setUint16(offset + 8, 0)
  view.setUint16(offset + 10, 0)
  view.setUint32(offset + 12, 0x6E616D65) // name
  view.setUint32(offset + 16, 0)
  view.setUint32(offset + 20, tableOffset)
  view.setUint32(offset + 24, 0)
}

describe('TTC/OTC header', () => {
  it('parses every face and exposes a version 2 collection signature', () => {
    const buffer = buildCollection()
    const first = parseFont(buffer, { fontIndex: 0 })
    const second = parseFont(buffer, { fontIndex: 1 })

    expect(first.format).toBe('ttc')
    expect(second.format).toBe('otc')
    expect(second.collection).toMatchObject({
      majorVersion: 2,
      minorVersion: 0,
      fontIndex: 1,
      numFonts: 2,
      signature: { tag: 'DSIG', offset: 88, table: { version: 1, flags: 0, signatures: [] } },
    })
    expect(Array.from(second.collection!.fontOffsets)).toEqual([32, 60])
    expect(Array.from(second.collection!.signature!.data)).toEqual([0, 0, 0, 1, 0, 0, 0, 0])
  })

  it('publishes collection metadata from Font', () => {
    const collection = Font.load(buildCollection(), { fontIndex: 1 }).collection
    expect(collection).toMatchObject({ majorVersion: 2, fontIndex: 1, numFonts: 2 })
  })

  it('accepts version 1 without collection DSIG fields', () => {
    const sfnt = parseFont(buildCollection({ majorVersion: 1, signatureLength: 0 }), { fontIndex: 0 })
    expect(sfnt.collection).toMatchObject({ majorVersion: 1, signature: null })
  })

  it('rejects unsupported versions, invalid indices, offsets, and DSIG ranges', () => {
    expect(() => parseFont(buildCollection({ majorVersion: 3 }))).toThrow('Unsupported TTC header version: 3.0')
    expect(() => parseFont(buildCollection(), { fontIndex: -1 })).toThrow('out of range')
    expect(() => parseFont(buildCollection({ secondOffset: 61 }))).toThrow('must be four-byte aligned')
    expect(() => parseFont(buildCollection({ secondOffset: 32 }))).toThrow('is duplicated')
    expect(() => parseFont(buildCollection({ signatureTag: 0, signatureLength: 4 }))).toThrow(
      'null DSIG fields must all be zero',
    )
    expect(() => parseFont(buildCollection({ signatureOffset: 89 }))).toThrow('must be four-byte aligned')
    expect(() => parseFont(buildCollection({ signatureOffset: 88, signatureLength: 16, truncateTo: 92 }))).toThrow(
      'DSIG data exceeds collection data',
    )
  })
})
