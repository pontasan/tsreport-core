import { BinaryReader } from '../../binary/reader.js'

const VDMX_HEADER_SIZE = 6
const VDMX_RATIO_SIZE = 4
const VDMX_OFFSET_SIZE = 2
const VDMX_GROUP_HEADER_SIZE = 4
const VDMX_RECORD_SIZE = 6

/**
 * VDMX record (yMax/yMin for a yPelHeight)
 */
export interface VdmxRecord {
  readonly yPelHeight: number
  readonly yMax: number
  readonly yMin: number
}

/**
 * VDMX group
 */
export interface VdmxGroup {
  readonly recs: number
  readonly startsz: number
  readonly endsz: number
  readonly entries: readonly VdmxRecord[]
}

/**
 * VDMX Ratio Range
 */
export interface VdmxRatioRange {
  readonly bCharSet: number
  readonly xRatio: number
  readonly yStartRatio: number
  readonly yEndRatio: number
}

/**
 * VDMX table: Vertical Device Metrics
 * Provides the rasterizer with exact vertical bounds at each PPEM
 */
export interface VdmxTable {
  /** Version */
  readonly version: number
  /** List of Ratio Ranges */
  readonly ratioRanges: readonly VdmxRatioRange[]
  /** List of VDMX groups */
  readonly groups: readonly VdmxGroup[]
  /** Get yMax/yMin for the given PPEM and Ratio */
  getYBounds(ppem: number, xRatio?: number, yRatio?: number, characterSet?: 0 | 1): { yMax: number; yMin: number } | null
}

/**
 * Parse the VDMX table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/vdmx
 */
export function parseVdmx(reader: BinaryReader): VdmxTable {
  if (reader.length < VDMX_HEADER_SIZE) {
    throw new Error(`VDMX table length must be at least ${VDMX_HEADER_SIZE}, got ${reader.length}`)
  }

  const version = reader.readUint16()
  const numRecs = reader.readUint16()
  const numRatios = reader.readUint16()
  if (numRecs === 0) {
    throw new Error('VDMX table must contain at least one group')
  }
  if (numRatios === 0) {
    throw new Error('VDMX table must contain at least one ratio range')
  }
  const groupDataStart = VDMX_HEADER_SIZE + numRatios * (VDMX_RATIO_SIZE + VDMX_OFFSET_SIZE)
  if (groupDataStart > reader.length) {
    throw new Error(`VDMX ratio and offset arrays exceed table length: need ${groupDataStart}, got ${reader.length}`)
  }

  // Ratio Range records
  const ratioRanges: VdmxRatioRange[] = []
  let hasDefaultRatio = false
  for (let i = 0; i < numRatios; i++) {
    const bCharSet = reader.readUint8()
    const xRatio = reader.readUint8()
    const yStartRatio = reader.readUint8()
    const yEndRatio = reader.readUint8()
    if (bCharSet > 1) {
      throw new Error(`VDMX ratio ${i} has unsupported character set: ${bCharSet}`)
    }
    const isDefaultRatio = xRatio === 0 && yStartRatio === 0 && yEndRatio === 0
    if (isDefaultRatio) {
      if (i !== numRatios - 1) {
        throw new Error('VDMX default ratio group must be the last ratio range')
      }
      hasDefaultRatio = true
    } else {
      if (xRatio === 0 || yStartRatio === 0 || yEndRatio === 0) {
        throw new Error(`VDMX ratio ${i} must use all-zero values only for the default ratio range`)
      }
      if (yStartRatio > yEndRatio) {
        throw new Error(`VDMX ratio ${i} yStartRatio must be <= yEndRatio`)
      }
    }
    ratioRanges.push({ bCharSet, xRatio, yStartRatio, yEndRatio })
  }
  if (hasDefaultRatio && numRatios > 1) {
    const previous = ratioRanges[numRatios - 2]!
    if (previous.xRatio === 0 && previous.yStartRatio === 0 && previous.yEndRatio === 0) {
      throw new Error('VDMX table must not contain duplicate default ratio ranges')
    }
  }

  // Group offsets (from start of table)
  const offsets: number[] = []
  for (let i = 0; i < numRatios; i++) {
    const offset = reader.readUint16()
    if (offset < groupDataStart || offset + VDMX_GROUP_HEADER_SIZE > reader.length) {
      throw new Error(`VDMX group offset ${i} out of range: ${offset}`)
    }
    offsets.push(offset)
  }
  const uniqueOffsets = new Set(offsets)
  if (uniqueOffsets.size !== numRecs) {
    throw new Error(`VDMX numRecs mismatch: expected ${numRecs} unique groups, got ${uniqueOffsets.size}`)
  }

  // Parse VDMX groups (deduplicate by offset)
  const groupByOffset = new Map<number, VdmxGroup>()
  const groups: VdmxGroup[] = []
  const ratioToGroup = new Map<number, VdmxGroup>()

  for (let i = 0; i < numRatios; i++) {
    const offset = offsets[i]!
    let group = groupByOffset.get(offset)
    if (!group) {
      reader.seek(offset)
      const recs = reader.readUint16()
      const startsz = reader.readUint8()
      const endsz = reader.readUint8()
      if (recs === 0) {
        throw new Error(`VDMX group at offset ${offset} must contain at least one record`)
      }
      if (startsz > endsz) {
        throw new Error(`VDMX group at offset ${offset} startsz must be <= endsz`)
      }
      const groupEnd = offset + VDMX_GROUP_HEADER_SIZE + recs * VDMX_RECORD_SIZE
      if (groupEnd > reader.length) {
        throw new Error(`VDMX group at offset ${offset} exceeds table length: need ${groupEnd}, got ${reader.length}`)
      }

      const entries: VdmxRecord[] = []
      let previousYPelHeight = -1
      for (let j = 0; j < recs; j++) {
        const yPelHeight = reader.readUint16()
        const yMax = reader.readInt16()
        const yMin = reader.readInt16()
        if (yPelHeight <= previousYPelHeight) {
          throw new Error(`VDMX group at offset ${offset} records must be sorted by yPelHeight at index ${j}`)
        }
        if (yPelHeight < startsz || yPelHeight > endsz) {
          throw new Error(`VDMX group at offset ${offset} yPelHeight ${yPelHeight} is outside ${startsz}..${endsz}`)
        }
        if (yMax < yMin) {
          throw new Error(`VDMX group at offset ${offset} record ${j} yMax must be >= yMin`)
        }
        previousYPelHeight = yPelHeight
        entries.push({ yPelHeight, yMax, yMin })
      }
      group = { recs, startsz, endsz, entries }
      groupByOffset.set(offset, group)
      groups.push(group)
    }
    ratioToGroup.set(i, group)
  }

  return {
    version,
    ratioRanges,
    groups,
    getYBounds(ppem: number, xRatio?: number, yRatio?: number, characterSet?: 0 | 1): { yMax: number; yMin: number } | null {
      // Ratio matching
      let matchedGroup: VdmxGroup | undefined

      // Version 0 distinguishes all-glyph symbol data (0) from the Windows
      // ANSI subset (1). Version 1 defines both values as all-glyph data, but
      // value 1 is the preferred form for newly-created fonts.
      const preferredCharacterSet = characterSet ?? 1

      for (let i = 0; i < ratioRanges.length; i++) {
        const r = ratioRanges[i]!
        if (r.bCharSet !== preferredCharacterSet) continue
        // xRatio=0, yStartRatio=0, yEndRatio=0 matches everything
        if (r.xRatio === 0 && r.yStartRatio === 0 && r.yEndRatio === 0) {
          matchedGroup = ratioToGroup.get(i)
          break
        }

        if (xRatio !== undefined && yRatio !== undefined) {
          const matchX = r.xRatio === 0 || r.xRatio === xRatio
          const matchY = yRatio >= r.yStartRatio && yRatio <= r.yEndRatio
          if (matchX && matchY) {
            matchedGroup = ratioToGroup.get(i)
            break
          }
        }
      }

      if (!matchedGroup && version >= 1 && characterSet === undefined) {
        for (let i = 0; i < ratioRanges.length; i++) {
          const r = ratioRanges[i]!
          if (r.bCharSet !== 0) continue
          if (r.xRatio === 0 && r.yStartRatio === 0 && r.yEndRatio === 0) {
            matchedGroup = ratioToGroup.get(i)
            break
          }
          if (xRatio !== undefined && yRatio !== undefined && r.xRatio === xRatio && yRatio >= r.yStartRatio && yRatio <= r.yEndRatio) {
            matchedGroup = ratioToGroup.get(i)
            break
          }
        }
      }

      // When no Ratio is specified, use the first "match-all" group, or group 0
      if (!matchedGroup) {
        if (xRatio === undefined && yRatio === undefined) {
          // Default: the match-all group, otherwise the first group
          for (let i = 0; i < ratioRanges.length; i++) {
            const r = ratioRanges[i]!
            if (r.bCharSet === preferredCharacterSet && r.xRatio === 0 && r.yStartRatio === 0 && r.yEndRatio === 0) {
              matchedGroup = ratioToGroup.get(i)
              break
            }
          }
          if (!matchedGroup) {
            for (let i = 0; i < ratioRanges.length; i++) {
              if (ratioRanges[i]!.bCharSet === preferredCharacterSet) {
                matchedGroup = ratioToGroup.get(i)
                break
              }
            }
          }
          if (!matchedGroup && version >= 1 && characterSet === undefined) {
            for (let i = 0; i < ratioRanges.length; i++) {
              if (ratioRanges[i]!.bCharSet === 0) {
                matchedGroup = ratioToGroup.get(i)
                break
              }
            }
          }
        }
        if (!matchedGroup) return null
      }

      // Binary search by PPEM (entries are sorted by yPelHeight ascending)
      if (ppem < matchedGroup.startsz || ppem > matchedGroup.endsz) return null

      const entries = matchedGroup.entries
      let lo = 0
      let hi = entries.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const entry = entries[mid]!
        if (entry.yPelHeight === ppem) {
          return { yMax: entry.yMax, yMin: entry.yMin }
        } else if (entry.yPelHeight < ppem) {
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return null
    },
  }
}
