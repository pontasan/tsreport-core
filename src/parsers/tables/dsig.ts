import { BinaryReader } from '../../binary/reader.js'

/**
 * DSIG signature record
 */
export interface DsigSignature {
  /** Signature format (currently only 1) */
  readonly format: number
  /** Signature binary data (PKCS#7 DER) */
  readonly signature: Uint8Array
}

/**
 * DSIG table: digital signature
 * Signature data for verifying font authenticity
 */
export interface DsigTable {
  /** Table version */
  readonly version: number
  /** Flags */
  readonly flags: number
  /** Signature records */
  readonly signatures: readonly DsigSignature[]
}

/**
 * Parses the DSIG table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/dsig
 */
export function parseDsig(reader: BinaryReader): DsigTable {
  if (reader.length < 8) throw new Error('DSIG header is truncated')
  const version = reader.readUint32()
  if (version < 1) throw new Error(`Unsupported DSIG version: ${version}`)
  const numSignatures = reader.readUint16()
  const flags = reader.readUint16()
  if (version === 1 && (flags & 0xFFFE) !== 0) throw new Error('DSIG reserved flag bits must be zero')
  if (numSignatures > Math.floor((reader.length - 8) / 12)) {
    throw new Error('DSIG signature records extend beyond table data')
  }

  // SignatureRecord: format(4) + length(4) + offset(4) = 12 bytes each
  const records: { format: number; length: number; offset: number }[] = []
  for (let i = 0; i < numSignatures; i++) {
    const format = reader.readUint32()
    if (format !== 1) throw new Error(`Unsupported DSIG signature format: ${format}`)
    const length = reader.readUint32()
    const offset = reader.readUint32()
    if (length < 8 || offset > reader.length || length > reader.length - offset) {
      throw new Error('DSIG signature block extends beyond table data')
    }
    records.push({ format, length, offset })
  }

  // Parse signature blocks
  const signatures: DsigSignature[] = []
  for (const rec of records) {
    reader.seek(rec.offset)
    // SignatureBlock: reserved1(2) + reserved2(2) + signatureLength(4) + signature(...)
    const reserved1 = reader.readUint16()
    const reserved2 = reader.readUint16()
    if (reserved1 !== 0 || reserved2 !== 0) throw new Error('DSIG signature block reserved fields must be zero')
    const signatureLength = reader.readUint32()
    if (signatureLength !== rec.length - 8) {
      throw new Error('DSIG signature block length does not match its record')
    }
    const signature = reader.readBytes(signatureLength)
    signatures.push({ format: rec.format, signature })
  }

  return { version, flags, signatures }
}
