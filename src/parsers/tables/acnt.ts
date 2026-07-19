import { BinaryReader } from '../../binary/reader.js'

/**
 * acnt table: Accent Attachment (Apple Advanced Typography)
 *
 * Header: version(Fixed) + firstAccentGlyphIndex(2) + lastAccentGlyphIndex(2)
 *         + descriptionOffset(4) + extensionOffset(4) + secondaryOffset(4)
 * The description subtable holds one 4-byte entry per glyph in the range:
 *   bit 31 = 0: primaryGlyphIndex(15) + primaryAttachmentPoint(8) + secondaryInfoIndex(8)
 *   bit 31 = 1: primaryGlyphIndex(15) + extension offset(16) into the extension subtable
 * Extension entries (2 bytes each): last flag(1) + secondaryInfoIndex(7)
 *   + primaryAttachmentPoint(8), repeated until the last flag is set.
 * Secondary entries (3 bytes each): secondaryGlyphIndex(2) + attachment point(1).
 */

export interface AcntComponent {
  /** Attachment control point in the primary glyph */
  readonly primaryAttachmentPoint: number
  /** Accent glyph index */
  readonly secondaryGlyphIndex: number
  /** Attachment control point in the accent glyph */
  readonly secondaryGlyphAttachmentNumber: number
}

export interface AcntGlyphAttachment {
  /** Base (primary) glyph index the accented glyph is composed from */
  readonly primaryGlyphIndex: number
  /** Accent components attached to the primary glyph */
  readonly components: readonly AcntComponent[]
}

export interface AcntTable {
  readonly version: number
  readonly firstAccentGlyphIndex: number
  readonly lastAccentGlyphIndex: number
  getAttachment(glyphId: number): AcntGlyphAttachment | null
}

export function parseAcnt(reader: BinaryReader): AcntTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, 20, 'acnt header')
  const rawVersion = reader.readUint32()
  if (rawVersion !== 0x00010000) {
    throw new Error(`Unsupported acnt table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }
  const firstAccentGlyphIndex = reader.readUint16()
  const lastAccentGlyphIndex = reader.readUint16()
  if (firstAccentGlyphIndex > lastAccentGlyphIndex) {
    throw new Error(`acnt firstAccentGlyphIndex must be <= lastAccentGlyphIndex, got ${firstAccentGlyphIndex} > ${lastAccentGlyphIndex}`)
  }
  const descriptionOffset = reader.readUint32()
  const extensionOffset = reader.readUint32()
  const secondaryOffset = reader.readUint32()

  validateSubtableOffset(reader, tableStart, descriptionOffset, 20, 'acnt descriptionOffset')
  validateSubtableOffset(reader, tableStart, secondaryOffset, 20, 'acnt secondaryOffset')
  if (extensionOffset !== 0) {
    validateSubtableOffset(reader, tableStart, extensionOffset, 20, 'acnt extensionOffset')
  }

  const accentedGlyphCount = lastAccentGlyphIndex - firstAccentGlyphIndex + 1
  const descriptionStart = tableStart + descriptionOffset
  const descriptionEnd = descriptionStart + accentedGlyphCount * 4
  validateRange(reader, descriptionStart, accentedGlyphCount * 4, 'acnt description data')
  if (tableStart + secondaryOffset < descriptionEnd) {
    throw new Error('acnt secondaryOffset overlaps description data')
  }
  if (extensionOffset !== 0) {
    const extensionStartCandidate = tableStart + extensionOffset
    if (extensionStartCandidate < descriptionEnd) {
      throw new Error('acnt extensionOffset overlaps description data')
    }
    if (extensionStartCandidate >= tableStart + secondaryOffset) {
      throw new Error('acnt extensionOffset must precede secondaryOffset')
    }
  }
  const secondaryEntryCount = Math.floor((reader.length - (tableStart + secondaryOffset)) / 3)
  if (secondaryEntryCount === 0) {
    throw new Error('acnt secondary data must contain at least one entry')
  }
  if (secondaryEntryCount > 255) {
    throw new Error(`acnt secondary data must contain at most 255 entries, got ${secondaryEntryCount}`)
  }

  const secondaryStart = tableStart + secondaryOffset
  const extensionStart = tableStart + extensionOffset

  const attachments = new Map<number, AcntGlyphAttachment>()

  for (let glyph = firstAccentGlyphIndex; glyph <= lastAccentGlyphIndex; glyph++) {
    const descPos = tableStart + descriptionOffset + (glyph - firstAccentGlyphIndex) * 4
    const desc = reader.getUint32At(descPos)

    const primaryGlyphIndex = (desc >>> 16) & 0x7FFF
    if (primaryGlyphIndex >= firstAccentGlyphIndex) {
      throw new Error(`acnt glyph ${glyph} primaryGlyphIndex ${primaryGlyphIndex} must be outside the accented glyph range`)
    }
    const components: AcntComponent[] = []

    if ((desc & 0x80000000) === 0) {
      // Format 0: single accent, secondary info index inline
      const primaryAttachmentPoint = (desc >>> 8) & 0xFF
      const secondaryInfoIndex = desc & 0xFF
      validateSecondaryIndex(secondaryInfoIndex, secondaryEntryCount)
      const secPos = secondaryStart + secondaryInfoIndex * 3
      const secondaryGlyphIndex = reader.getUint16At(secPos)
      validateSecondaryGlyphIndex(secondaryGlyphIndex, firstAccentGlyphIndex, glyph)
      components.push({
        primaryAttachmentPoint,
        secondaryGlyphIndex,
        secondaryGlyphAttachmentNumber: reader.getUint8At(secPos + 2),
      })
    } else {
      // Format 1: multiple accents via the extension subtable
      if (extensionOffset === 0) {
        throw new Error(`acnt glyph ${glyph} uses extension data but extensionOffset is zero`)
      }
      let extPos = extensionStart + (desc & 0xFFFF)
      if (extPos >= secondaryStart) {
        throw new Error(`acnt glyph ${glyph} extension offset exceeds extension data`)
      }
      validateRange(reader, extPos, 2, `acnt glyph ${glyph} extension entry 0`)
      let last = false
      let extensionEntryCount = 0
      while (!last) {
        const entry = reader.getUint16At(extPos)
        extPos += 2
        last = (entry & 0x8000) !== 0
        const secondaryInfoIndex = (entry >>> 8) & 0x7F
        const primaryAttachmentPoint = entry & 0xFF
        validateSecondaryIndex(secondaryInfoIndex, secondaryEntryCount)
        const secPos = secondaryStart + secondaryInfoIndex * 3
        const secondaryGlyphIndex = reader.getUint16At(secPos)
        validateSecondaryGlyphIndex(secondaryGlyphIndex, firstAccentGlyphIndex, glyph)
        components.push({
          primaryAttachmentPoint,
          secondaryGlyphIndex,
          secondaryGlyphAttachmentNumber: reader.getUint8At(secPos + 2),
        })
        extensionEntryCount++
        if (!last) {
          if (extPos >= secondaryStart) {
            throw new Error(`acnt glyph ${glyph} extension data is missing a terminating last component flag`)
          }
          validateRange(reader, extPos, 2, `acnt glyph ${glyph} extension entry ${extensionEntryCount}`)
        }
      }
    }

    attachments.set(glyph, { primaryGlyphIndex, components })
  }

  return {
    version: 1,
    firstAccentGlyphIndex,
    lastAccentGlyphIndex,
    getAttachment(glyphId: number): AcntGlyphAttachment | null {
      return attachments.get(glyphId) ?? null
    },
  }
}

function validateSecondaryIndex(index: number, secondaryEntryCount: number): void {
  if (index >= secondaryEntryCount) {
    throw new Error(`acnt secondaryInfoIndex ${index} exceeds secondary entry count ${secondaryEntryCount}`)
  }
}

function validateSecondaryGlyphIndex(secondaryGlyphIndex: number, firstAccentGlyphIndex: number, glyph: number): void {
  if (secondaryGlyphIndex >= firstAccentGlyphIndex) {
    throw new Error(`acnt glyph ${glyph} secondaryGlyphIndex ${secondaryGlyphIndex} must be outside the accented glyph range`)
  }
}

function validateSubtableOffset(
  reader: BinaryReader,
  tableStart: number,
  offset: number,
  minimumOffset: number,
  label: string,
): void {
  if (offset < minimumOffset) {
    throw new Error(`${label} overlaps acnt header`)
  }
  if (tableStart + offset >= reader.length) {
    throw new Error(`${label} exceeds acnt table length: ${offset}`)
  }
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds acnt table length: need ${offset + length}, got ${reader.length}`)
  }
}
