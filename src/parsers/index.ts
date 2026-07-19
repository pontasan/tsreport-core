import { BinaryReader } from '../binary/reader.js'
import type { SfntData, FontLoadOptions } from '../types/index.js'
import { parseSfntDirectory } from './sfnt-parser.js'
import { unwrapWoffContainer } from './woff-parser.js'
import { unwrapWoff2Container } from './woff2-parser.js'
import { unwrapEot, isEotFormat } from './eot-parser.js'
import { parseDsig } from './tables/dsig.js'

export type ParseFontOptions = FontLoadOptions

/**
 * Detects the font data format and returns SFNT data
 * Supports TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT
 */
export function parseFont(buffer: ArrayBuffer, options?: ParseFontOptions): SfntData {
  const reader = new BinaryReader(buffer)
  const signature = reader.readUint32()

  switch (signature) {
    case 0x00010000: // TrueType
    case 0x4F54544F: // 'OTTO' (OpenType/CFF)
    case 0x74727565: // 'true' (legacy Apple TrueType, e.g. macOS NISC18030)
      return parseSfntDirectory(buffer, 0)

    case 0x74746366: // 'ttcf' (TTC/OTC)
      return parseTtc(buffer, options?.fontIndex ?? 0)

    case 0x774F4646: { // 'wOFF' (WOFF)
      const container = unwrapWoffContainer(buffer)
      const sfnt = parseSfntDirectory(container.sfntBuffer, 0)
      return {
        ...sfnt,
        format: 'woff',
        webFontContainer: {
          majorVersion: container.majorVersion,
          minorVersion: container.minorVersion,
          metadata: container.metadata,
          metadataDocument: container.metadataDocument,
          privateData: container.privateData,
        },
      } as SfntData
    }

    case 0x774F4632: { // 'wOF2' (WOFF2)
      const container = unwrapWoff2Container(buffer)
      const reconstructedSignature = new DataView(container.sfntBuffer).getUint32(0, false)
      const sfnt = reconstructedSignature === 0x74746366
        ? parseTtc(container.sfntBuffer, options?.fontIndex ?? 0)
        : parseSfntDirectory(container.sfntBuffer, 0)
      return {
        ...sfnt,
        format: 'woff2',
        webFontContainer: {
          majorVersion: container.majorVersion,
          minorVersion: container.minorVersion,
          metadata: container.metadata,
          metadataDocument: container.metadataDocument,
          privateData: container.privateData,
        },
      } as SfntData
    }

    default:
      // EOT check (first 4 bytes are the file size; the signature is elsewhere)
      if (isEotFormat(buffer)) {
        const sfntBuffer = unwrapEot(buffer)
        const sfnt = parseSfntDirectory(sfntBuffer, 0)
        return { ...sfnt, format: 'eot' } as SfntData
      }
      throw new Error(`Unknown font format: 0x${signature.toString(16).padStart(8, '0')}`)
  }
}

function parseTtc(buffer: ArrayBuffer, fontIndex: number): SfntData {
  const reader = new BinaryReader(buffer)
  reader.skip(4) // 'ttcf'
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if ((majorVersion !== 1 && majorVersion !== 2) || minorVersion !== 0) {
    throw new Error(`Unsupported TTC header version: ${majorVersion}.${minorVersion}`)
  }
  const numFonts = reader.readUint32()
  if (numFonts === 0) throw new Error('TTC collection must contain at least one font')
  const headerLength = 12 + numFonts * 4 + (majorVersion === 2 ? 12 : 0)
  if (headerLength > buffer.byteLength) throw new Error('TTC header extends beyond collection data')

  if (!Number.isInteger(fontIndex) || fontIndex < 0 || fontIndex >= numFonts) {
    throw new Error(`Font index ${fontIndex} out of range (${numFonts} fonts in collection)`)
  }

  const offsets = new Uint32Array(numFonts)
  const seenOffsets = new Set<number>()
  for (let i = 0; i < numFonts; i++) {
    const offset = reader.readUint32()
    if ((offset & 3) !== 0) throw new Error(`TTC font directory offset ${i} must be four-byte aligned`)
    if (offset < headerLength || offset > buffer.byteLength - 12) {
      throw new Error(`TTC font directory offset ${i} exceeds collection data`)
    }
    if (seenOffsets.has(offset)) throw new Error(`TTC font directory offset ${i} is duplicated`)
    seenOffsets.add(offset)
    offsets[i] = offset
  }

  let signature: NonNullable<NonNullable<SfntData['collection']>['signature']> | null = null
  if (majorVersion === 2) {
    const signatureTag = reader.readUint32()
    const signatureLength = reader.readUint32()
    const signatureOffset = reader.readUint32()
    if (signatureTag === 0) {
      if (signatureLength !== 0 || signatureOffset !== 0) {
        throw new Error('TTC version 2 null DSIG fields must all be zero')
      }
    } else {
      if (signatureTag !== 0x44534947) throw new Error('TTC version 2 signature tag must be DSIG or zero')
      if (signatureLength === 0) throw new Error('TTC version 2 DSIG length must be greater than zero')
      if ((signatureOffset & 3) !== 0) throw new Error('TTC version 2 DSIG offset must be four-byte aligned')
      if (signatureOffset > buffer.byteLength || signatureLength > buffer.byteLength - signatureOffset) {
        throw new Error('TTC version 2 DSIG data exceeds collection data')
      }
      if (signatureOffset + signatureLength !== buffer.byteLength) {
        throw new Error('TTC version 2 DSIG table must be the last data in the collection')
      }
      signature = {
        tag: 'DSIG',
        offset: signatureOffset,
        data: new Uint8Array(buffer, signatureOffset, signatureLength),
        table: parseDsig(new BinaryReader(buffer, signatureOffset, signatureLength)),
      }
    }
  }

  const fonts = new Array<SfntData>(numFonts)
  for (let i = 0; i < numFonts; i++) fonts[i] = parseSfntDirectory(buffer, offsets[i]!)
  if (signature !== null) {
    for (let fontIndex = 0; fontIndex < fonts.length; fontIndex++) {
      for (const entry of fonts[fontIndex]!.tableDirectory.values()) {
        if (entry.offset + entry.length > signature.offset) {
          throw new Error(`TTC font ${fontIndex} table '${entry.tag}' overlaps the collection DSIG table`)
        }
      }
    }
  }
  const sfnt = fonts[fontIndex]!
  // Determine the format from sfntVersion
  const fmt = sfnt.sfntVersion === 0x4F54544F ? 'otc' : 'ttc'
  return {
    ...sfnt,
    format: fmt,
    collection: {
      majorVersion,
      minorVersion: 0,
      fontIndex,
      numFonts,
      fontOffsets: offsets,
      signature,
    },
  } as SfntData
}
