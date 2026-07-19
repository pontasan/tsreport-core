import { BinaryReader } from '../../binary/reader.js'

/**
 * EBSC table: Embedded Bitmap Scaling
 * Scaling map from requested ppem to an available strike ppem
 */

export interface SbitLineMetrics {
  ascender: number
  descender: number
  widthMax: number
  caretSlopeNumerator: number
  caretSlopeDenominator: number
  caretOffset: number
  minOriginSB: number
  minAdvanceSB: number
  maxBeforeBL: number
  minAfterBL: number
  pad1: number
  pad2: number
}

export interface EbscStrike {
  hori: SbitLineMetrics
  vert: SbitLineMetrics
  ppemX: number
  ppemY: number
  substitutePpemX: number
  substitutePpemY: number
}

export interface EbscTable {
  readonly strikes: EbscStrike[]
  /**
   * Returns the substitute strike ppem for the given ppem
   * @returns [substitutePpemX, substitutePpemY] or null
   */
  getSubstitutePpem(ppemX: number, ppemY: number): { substitutePpemX: number, substitutePpemY: number } | null
}

function parseSbitLineMetrics(reader: BinaryReader): SbitLineMetrics {
  return {
    ascender: reader.readInt8(),
    descender: reader.readInt8(),
    widthMax: reader.readUint8(),
    caretSlopeNumerator: reader.readInt8(),
    caretSlopeDenominator: reader.readInt8(),
    caretOffset: reader.readInt8(),
    minOriginSB: reader.readInt8(),
    minAdvanceSB: reader.readInt8(),
    maxBeforeBL: reader.readInt8(),
    minAfterBL: reader.readInt8(),
    pad1: reader.readInt8(),
    pad2: reader.readInt8(),
  }
}

export function parseEbsc(reader: BinaryReader): EbscTable {
  if (reader.length < 8) throw new Error('EBSC header is truncated')
  const rawVersion = reader.readUint32()
  const majorVersion = rawVersion >>> 16
  const minorVersion = rawVersion & 0xFFFF
  if (majorVersion !== 2) throw new Error(`Unsupported EBSC version: ${majorVersion}.${minorVersion}`)
  const numSizes = reader.readUint32()
  const knownLength = 8 + numSizes * 28
  if (reader.length < knownLength || (minorVersion === 0 && reader.length !== knownLength)) {
    throw new Error(`EBSC table length must be ${minorVersion === 0 ? '' : 'at least '}${knownLength}, got ${reader.length}`)
  }

  const strikes: EbscStrike[] = []
  for (let i = 0; i < numSizes; i++) {
    const hori = parseSbitLineMetrics(reader)
    const vert = parseSbitLineMetrics(reader)
    const ppemX = reader.readUint8()
    const ppemY = reader.readUint8()
    const substitutePpemX = reader.readUint8()
    const substitutePpemY = reader.readUint8()
    strikes.push({ hori, vert, ppemX, ppemY, substitutePpemX, substitutePpemY })
  }

  return {
    strikes,
    getSubstitutePpem(ppemX: number, ppemY: number): { substitutePpemX: number, substitutePpemY: number } | null {
      for (let i = 0; i < strikes.length; i++) {
        const s = strikes[i]!
        if (s.ppemX === ppemX && s.ppemY === ppemY) {
          return { substitutePpemX: s.substitutePpemX, substitutePpemY: s.substitutePpemY }
        }
      }
      return null
    },
  }
}
