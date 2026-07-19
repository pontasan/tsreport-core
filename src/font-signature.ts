import type { SfntData } from './types/index.js'
import { parseDsig, type DsigTable } from './parsers/tables/dsig.js'
import { getTableReader, parseSfntDirectory } from './parsers/sfnt-parser.js'
import { parseFont } from './parsers/index.js'
import { buildSfntFromTables } from './subset/ttf-subset.js'
import { buildFontCollection } from './subset/collection.js'
import { BinaryWriter } from './binary/writer.js'
import { sha256 } from './encryption/sha256.js'
import { buildCmsSignedData, extractCertIdentity, parseRsaPrivateKey } from './pdf/pdf-signer.js'
import { verifyCmsDetachedSignature, type CmsDetachedSignatureVerification } from './pdf/pdf-signature.js'

export interface OpenTypeSignatureVerification extends CmsDetachedSignatureVerification {
  readonly format: number
  readonly scope: 'font' | 'collection'
  readonly cannotBeResigned: boolean
}

export interface OpenTypeSigningOptions {
  readonly privateKeyDer: Uint8Array
  readonly certDer: Uint8Array
  readonly signingTime: Date
  readonly cannotBeResigned?: boolean
}

/** Verifies every Format 1 DSIG signature attached to a font or collection resource. */
export function verifyOpenTypeSignatures(sfnt: SfntData, dsig: DsigTable | null): OpenTypeSignatureVerification[] {
  const collectionSignature = sfnt.collection?.signature ?? null
  const table = collectionSignature?.table ?? dsig
  if (table === null) return []
  const scope = collectionSignature === null ? 'font' : 'collection'
  const content = scope === 'collection'
    ? buildUnsignedCollectionContent(sfnt, table.flags)
    : buildUnsignedFontContent(sfnt, table.flags)
  const results = new Array<OpenTypeSignatureVerification>(table.signatures.length)
  for (let i = 0; i < table.signatures.length; i++) {
    const signature = table.signatures[i]!
    const result = verifyCmsDetachedSignature(signature.signature, content)
    results[i] = {
      ...result,
      format: signature.format,
      scope,
      cannotBeResigned: (table.flags & 1) !== 0,
    }
  }
  return results
}

/** Signs a standalone sfnt or TTC/OTC resource with an OpenType Format 1 DSIG. */
export function signOpenTypeResource(data: ArrayBuffer | Uint8Array, options: OpenTypeSigningOptions): ArrayBuffer {
  const input = data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    : data
  const tag = input.byteLength >= 4 ? new DataView(input).getUint32(0, false) : 0
  return tag === 0x74746366
    ? signCollection(input, options)
    : signStandalone(input, options)
}

function signStandalone(input: ArrayBuffer, options: OpenTypeSigningOptions): ArrayBuffer {
  const sfnt = parseSfntDirectory(input)
  const existing = getTableReader(sfnt, 'DSIG')
  if (existing !== null) {
    const table = parseDsig(existing)
    if ((table.flags & 1) !== 0) throw new Error('OpenType DSIG forbids re-signing this font')
  }
  const unsigned = rebuildStandaloneWithoutDsig(sfnt)
  const flags = options.cannotBeResigned === true ? 1 : 0
  const cms = createCms(unsigned, flags, options)
  const tables = copyTables(parseSfntDirectory(unsigned), false)
  clearHeadChecksumAdjustment(tables)
  tables.push({ tag: 'DSIG', data: buildDsigTable(flags, cms) })
  tables.sort(compareTables)
  return buildSfntFromTables(sfnt.sfntVersion, tables)
}

function signCollection(input: ArrayBuffer, options: OpenTypeSigningOptions): ArrayBuffer {
  const first = parseFont(input, { fontIndex: 0 })
  const collection = first.collection
  if (collection === undefined) throw new Error('OpenType collection metadata is missing')
  if (collection.signature !== null && (collection.signature.table.flags & 1) !== 0) {
    throw new Error('OpenType DSIG forbids re-signing this collection')
  }
  const faces = new Array<ArrayBuffer>(collection.numFonts)
  for (let fontIndex = 0; fontIndex < collection.numFonts; fontIndex++) {
    faces[fontIndex] = rebuildStandaloneWithoutDsig(parseFont(input, { fontIndex }))
  }
  const unsigned = buildFontCollection(faces, { majorVersion: 2 })
  const flags = options.cannotBeResigned === true ? 1 : 0
  const cms = createCms(unsigned, flags, options)
  const dsig = buildDsigTable(flags, cms)
  const offset = align4(unsigned.byteLength)
  const result = new Uint8Array(offset + dsig.length)
  result.set(new Uint8Array(unsigned))
  result.set(dsig, offset)
  const view = new DataView(result.buffer)
  const fields = 12 + collection.numFonts * 4
  view.setUint32(fields, 0x44534947, false)
  view.setUint32(fields + 4, dsig.length, false)
  view.setUint32(fields + 8, offset, false)
  return result.buffer
}

function createCms(unsigned: ArrayBuffer, flags: number, options: OpenTypeSigningOptions): Uint8Array {
  const content = appendFlags(new Uint8Array(unsigned), flags)
  const key = parseRsaPrivateKey(options.privateKeyDer)
  const identity = extractCertIdentity(options.certDer)
  return buildCmsSignedData(
    key, options.certDer, identity.issuerDer, identity.serial,
    sha256(content), options.signingTime,
  )
}

function buildUnsignedFontContent(sfnt: SfntData, flags: number): Uint8Array {
  return appendFlags(new Uint8Array(rebuildStandaloneWithoutDsig(sfnt)), flags)
}

function buildUnsignedCollectionContent(sfnt: SfntData, flags: number): Uint8Array {
  const collection = sfnt.collection
  if (collection === undefined || collection.signature === null) throw new Error('OpenType collection DSIG metadata is missing')
  const offset = collection.signature.offset
  const unsigned = new Uint8Array(offset)
  unsigned.set(new Uint8Array(sfnt.buffer, 0, offset))
  const fields = 12 + collection.numFonts * 4
  new DataView(unsigned.buffer).setUint32(fields, 0, false)
  new DataView(unsigned.buffer).setUint32(fields + 4, 0, false)
  new DataView(unsigned.buffer).setUint32(fields + 8, 0, false)
  return appendFlags(unsigned, flags)
}

function rebuildStandaloneWithoutDsig(sfnt: SfntData): ArrayBuffer {
  const tables = copyTables(sfnt, false)
  clearHeadChecksumAdjustment(tables)
  return buildSfntFromTables(sfnt.sfntVersion, tables)
}

function copyTables(sfnt: SfntData, includeDsig: boolean): { tag: string, data: Uint8Array }[] {
  const tables: { tag: string, data: Uint8Array }[] = []
  for (const tag of sfnt.tableDirectory.keys()) {
    if (!includeDsig && tag === 'DSIG') continue
    const reader = getTableReader(sfnt, tag)!
    const data = new Uint8Array(reader.length)
    for (let i = 0; i < data.length; i++) data[i] = reader.getUint8At(i)
    tables.push({ tag, data })
  }
  tables.sort(compareTables)
  return tables
}

function buildDsigTable(flags: number, cms: Uint8Array): Uint8Array {
  const blockLength = 8 + cms.length
  const writer = new BinaryWriter(20 + blockLength)
  writer.writeUint32(1)
  writer.writeUint16(1)
  writer.writeUint16(flags)
  writer.writeUint32(1)
  writer.writeUint32(blockLength)
  writer.writeUint32(20)
  writer.writeUint16(0)
  writer.writeUint16(0)
  writer.writeUint32(cms.length)
  writer.writeBytes(cms)
  return writer.toUint8Array()
}

function clearHeadChecksumAdjustment(tables: { tag: string, data: Uint8Array }[]): void {
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!
    if (table.tag !== 'head') continue
    if (table.data.length < 12) throw new Error('OpenType head table is truncated')
    new DataView(table.data.buffer, table.data.byteOffset, table.data.byteLength).setUint32(8, 0, false)
    return
  }
}

function appendFlags(data: Uint8Array, flags: number): Uint8Array {
  const content = new Uint8Array(data.length + 2)
  content.set(data)
  new DataView(content.buffer).setUint16(data.length, flags, false)
  return content
}

function compareTables(a: { tag: string }, b: { tag: string }): number {
  return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0
}

function align4(value: number): number {
  return (value + 3) & ~3
}
