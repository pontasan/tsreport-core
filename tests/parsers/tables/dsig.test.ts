import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseDsig } from '../../../src/parsers/tables/dsig.js'

/**
 * Builds a synthetic DSIG table binary.
 */
function buildDsigTable(signatures: { format: number; data: Uint8Array }[]): ArrayBuffer {
  // Header: version(4) + numSignatures(2) + flags(2) = 8
  // SignatureRecord: format(4) + length(4) + offset(4) = 12 each
  // SignatureBlock: reserved1(2) + reserved2(2) + signatureLength(4) + signature(...)
  const headerSize = 8
  const recordsSize = 12 * signatures.length

  // Calculate SignatureBlock offsets
  let blockOffset = headerSize + recordsSize
  const blocks: { offset: number; blockSize: number }[] = []
  for (const sig of signatures) {
    const blockSize = 8 + sig.data.length // reserved(4) + length(4) + data
    blocks.push({ offset: blockOffset, blockSize })
    blockOffset += blockSize
  }

  const totalSize = blockOffset
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint32(pos, 1); pos += 4 // version
  view.setUint16(pos, signatures.length); pos += 2
  view.setUint16(pos, 0); pos += 2 // flags

  // Signature records
  for (let i = 0; i < signatures.length; i++) {
    view.setUint32(pos, signatures[i]!.format); pos += 4 // format
    view.setUint32(pos, blocks[i]!.blockSize); pos += 4 // length
    view.setUint32(pos, blocks[i]!.offset); pos += 4 // offset
  }

  // Signature blocks
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i]!
    pos = blocks[i]!.offset
    view.setUint16(pos, 0); pos += 2 // reserved1
    view.setUint16(pos, 0); pos += 2 // reserved2
    view.setUint32(pos, sig.data.length); pos += 4
    new Uint8Array(buf).set(sig.data, pos)
  }

  return buf
}

describe('DSIG table parser', () => {
  // Verifies header fields (version, flags) and that the signature bytes are extracted from the SignatureBlock.
  it('should parse synthetic DSIG table with one signature', () => {
    const sigData = new Uint8Array([0x30, 0x82, 0x01, 0x00, 0xAA, 0xBB])
    const buf = buildDsigTable([{ format: 1, data: sigData }])
    const reader = new BinaryReader(buf)
    const dsig = parseDsig(reader)

    expect(dsig.version).toBe(1)
    expect(dsig.flags).toBe(0)
    expect(dsig.signatures).toHaveLength(1)
    expect(dsig.signatures[0]!.format).toBe(1)
    expect(dsig.signatures[0]!.signature).toEqual(sigData)
  })

  // Verifies that multiple SignatureRecords each resolve to their own block via per-record offsets.
  it('should parse multiple signatures', () => {
    const sig1 = new Uint8Array([1, 2, 3])
    const sig2 = new Uint8Array([4, 5, 6, 7, 8])
    const buf = buildDsigTable([
      { format: 1, data: sig1 },
      { format: 1, data: sig2 },
    ])
    const reader = new BinaryReader(buf)
    const dsig = parseDsig(reader)

    expect(dsig.signatures).toHaveLength(2)
    expect(dsig.signatures[0]!.signature).toEqual(sig1)
    expect(dsig.signatures[1]!.signature).toEqual(sig2)
  })

  // Verifies that numSignatures=0 (common for dummy DSIG tables) parses to an empty list.
  it('should handle empty signatures', () => {
    const buf = buildDsigTable([])
    const reader = new BinaryReader(buf)
    const dsig = parseDsig(reader)

    expect(dsig.signatures).toHaveLength(0)
  })

  it('rejects an undefined signature format', () => {
    const sigData = new Uint8Array([0xDE, 0xAD])
    const buf = buildDsigTable([{ format: 2, data: sigData }])
    const reader = new BinaryReader(buf)
    expect(() => parseDsig(reader)).toThrow('Unsupported DSIG signature format: 2')
  })

  it('reads future compatible versions and rejects invalid current-version fields', () => {
    const version = buildDsigTable([])
    new DataView(version).setUint32(0, 2)
    new DataView(version).setUint16(6, 2)
    expect(parseDsig(new BinaryReader(version))).toMatchObject({ version: 2, flags: 2 })

    const obsolete = buildDsigTable([])
    new DataView(obsolete).setUint32(0, 0)
    expect(() => parseDsig(new BinaryReader(obsolete))).toThrow('Unsupported DSIG version')

    const flags = buildDsigTable([])
    new DataView(flags).setUint16(6, 2)
    expect(() => parseDsig(new BinaryReader(flags))).toThrow('reserved flag bits')

    const reserved = buildDsigTable([{ format: 1, data: new Uint8Array([1]) }])
    new DataView(reserved).setUint16(20, 1)
    expect(() => parseDsig(new BinaryReader(reserved))).toThrow('reserved fields')

    const length = buildDsigTable([{ format: 1, data: new Uint8Array([1]) }])
    new DataView(length).setUint32(12, 8)
    expect(() => parseDsig(new BinaryReader(length))).toThrow('does not match its record')
  })
})
