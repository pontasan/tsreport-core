import { BinaryReader } from '../../binary/reader.js'
import type { PostTable } from '../../types/index.js'

/**
 * Macintosh standard glyph names (all 258 entries, in standard order)
 * v1.0: used directly as the full glyph name list
 * v2.0: referenced when nameIndex < 258
 * v2.5: indexed via per-glyph offsets
 */
export const POST_STANDARD_NAMES = [
  '.notdef', '.null', 'nonmarkingreturn', 'space', 'exclam', 'quotedbl', 'numbersign',
  'dollar', 'percent', 'ampersand', 'quotesingle', 'parenleft', 'parenright', 'asterisk',
  'plus', 'comma', 'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine', 'colon', 'semicolon', 'less', 'equal',
  'greater', 'question', 'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'grave',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
  'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'braceleft', 'bar', 'braceright',
  'asciitilde', 'Adieresis', 'Aring', 'Ccedilla', 'Eacute', 'Ntilde', 'Odieresis',
  'Udieresis', 'aacute', 'agrave', 'acircumflex', 'adieresis', 'atilde', 'aring',
  'ccedilla', 'eacute', 'egrave', 'ecircumflex', 'edieresis', 'iacute', 'igrave',
  'icircumflex', 'idieresis', 'ntilde', 'oacute', 'ograve', 'ocircumflex', 'odieresis',
  'otilde', 'uacute', 'ugrave', 'ucircumflex', 'udieresis', 'dagger', 'degree', 'cent',
  'sterling', 'section', 'bullet', 'paragraph', 'germandbls', 'registered', 'copyright',
  'trademark', 'acute', 'dieresis', 'notequal', 'AE', 'Oslash', 'infinity', 'plusminus',
  'lessequal', 'greaterequal', 'yen', 'mu', 'partialdiff', 'summation', 'product', 'pi',
  'integral', 'ordfeminine', 'ordmasculine', 'Omega', 'ae', 'oslash', 'questiondown',
  'exclamdown', 'logicalnot', 'radical', 'florin', 'approxequal', 'Delta', 'guillemotleft',
  'guillemotright', 'ellipsis', 'nonbreakingspace', 'Agrave', 'Atilde', 'Otilde', 'OE',
  'oe', 'endash', 'emdash', 'quotedblleft', 'quotedblright', 'quoteleft', 'quoteright',
  'divide', 'lozenge', 'ydieresis', 'Ydieresis', 'fraction', 'currency', 'guilsinglleft',
  'guilsinglright', 'fi', 'fl', 'daggerdbl', 'periodcentered', 'quotesinglbase',
  'quotedblbase', 'perthousand', 'Acircumflex', 'Ecircumflex', 'Aacute', 'Edieresis',
  'Egrave', 'Iacute', 'Icircumflex', 'Idieresis', 'Igrave', 'Oacute', 'Ocircumflex',
  'apple', 'Ograve', 'Uacute', 'Ucircumflex', 'Ugrave', 'dotlessi', 'circumflex',
  'tilde', 'macron', 'breve', 'dotaccent', 'ring', 'cedilla', 'hungarumlaut', 'ogonek',
  'caron', 'Lslash', 'lslash', 'Scaron', 'scaron', 'Zcaron', 'zcaron', 'brokenbar',
  'Eth', 'eth', 'Yacute', 'yacute', 'Thorn', 'thorn', 'minus', 'multiply', 'onesuperior',
  'twosuperior', 'threesuperior', 'onehalf', 'onequarter', 'threequarters', 'franc',
  'Gbreve', 'gbreve', 'Idotaccent', 'Scedilla', 'scedilla', 'Cacute', 'cacute', 'Ccaron',
  'ccaron', 'dcroat',
]

/**
 * Parse the post table
 */
export interface PostParseOptions {
  readonly expectedGlyphCount?: number
  readonly outlineKind?: 'truetype' | 'cff1' | 'cff2'
}

export function parsePost(reader: BinaryReader, options: PostParseOptions = {}): PostTable {
  if (reader.length < 32) {
    throw new Error(`post table length must be at least 32, got ${reader.length}`)
  }
  const version = reader.readFixed()
  const italicAngle = reader.readFixed()
  const underlinePosition = reader.readFWord()
  const underlineThickness = reader.readFWord()
  const isFixedPitch = reader.readUint32()
  const minMemType42 = reader.readUint32()
  const maxMemType42 = reader.readUint32()
  const minMemType1 = reader.readUint32()
  const maxMemType1 = reader.readUint32()
  if (maxMemType42 !== 0 && maxMemType42 < minMemType42) {
    throw new Error(`post maxMemType42 ${maxMemType42} must be greater than or equal to minMemType42 ${minMemType42}`)
  }
  if (maxMemType1 !== 0 && maxMemType1 < minMemType1) {
    throw new Error(`post maxMemType1 ${maxMemType1} must be greater than or equal to minMemType1 ${minMemType1}`)
  }

  // A CFF-outline font is expected to use post version 3.0 (glyph names come
  // from the CFF charset), but shipping fonts (e.g. LastResort) carry a version
  // 2.0 post regardless, so any version is parsed rather than rejected.
  let glyphNames: (string | null)[] | undefined
  let glyphNameCharacterCodes: Uint16Array | undefined
  const versionFixed = Math.round(version * 65536)
  if (options.outlineKind === 'cff1' && versionFixed !== 0x00030000) {
    throw new Error(`CFF version 1 outlines require post table version 3.0, got ${version}`)
  }
  if (options.outlineKind !== undefined && options.outlineKind !== 'truetype'
      && (versionFixed === 0x00025000 || versionFixed === 0x00040000)) {
    throw new Error(`post table version ${version} requires TrueType outlines`)
  }

  if (versionFixed === 0x00010000) {
    if (reader.length !== 32) {
      throw new Error(`post version 1.0 table length must be 32, got ${reader.length}`)
    }
    if (options.expectedGlyphCount !== undefined && options.expectedGlyphCount !== POST_STANDARD_NAMES.length) {
      throw new Error(`post version 1.0 requires maxp.numGlyphs ${POST_STANDARD_NAMES.length}, got ${options.expectedGlyphCount}`)
    }
    // Version 1.0: the glyph order is exactly the Macintosh standard order,
    // so the names are the standard 258 glyph names
    glyphNames = POST_STANDARD_NAMES
  } else if (versionFixed === 0x00025000) {
    if (reader.remaining < 2) {
      throw new Error('post version 2.5 table is missing numGlyphs')
    }
    // Version 2.5 (deprecated): per-glyph signed offsets into the standard
    // glyph name table (name index = glyph index + offset)
    const numGlyphs = reader.readUint16()
    validatePostNumGlyphs(numGlyphs, options.expectedGlyphCount, 'post version 2.5')
    const expectedLength = 34 + numGlyphs
    if (reader.length !== expectedLength) {
      throw new Error(`post version 2.5 table length must be ${expectedLength}, got ${reader.length}`)
    }
    glyphNames = new Array(numGlyphs)
    for (let i = 0; i < numGlyphs; i++) {
      const offset = reader.readInt8()
      const nameIndex = i + offset
      if (nameIndex < 0 || nameIndex >= POST_STANDARD_NAMES.length) {
        throw new Error(`post v2.5: glyph ${i} name index ${nameIndex} out of standard glyph names range`)
      }
      glyphNames[i] = POST_STANDARD_NAMES[nameIndex]!
    }
  } else if (versionFixed === 0x00020000) {
    if (reader.remaining < 2) {
      throw new Error('post version 2.0 table is missing numGlyphs')
    }
    // Version 2.0: glyphNameIndex + string data
    const numGlyphs = reader.readUint16()
    validatePostNumGlyphs(numGlyphs, options.expectedGlyphCount, 'post version 2.0')
    const minimumLength = 34 + numGlyphs * 2
    if (reader.length < minimumLength) {
      throw new Error(`post version 2.0 table length must be at least ${minimumLength}, got ${reader.length}`)
    }
    const nameIndices = new Uint16Array(numGlyphs)
    let customNameCount = 0
    for (let i = 0; i < numGlyphs; i++) {
      nameIndices[i] = reader.readUint16()
      const idx = nameIndices[i]!
      if (idx >= 258) {
        customNameCount = Math.max(customNameCount, idx - 257)
      }
    }

    // Read custom name strings (index >= 258)
    const customNames: string[] = []
    for (let i = 0; i < customNameCount; i++) {
      if (reader.remaining < 1) {
        throw new Error(`post version 2.0 custom glyph name ${i} is missing length byte`)
      }
      const len = reader.readUint8()
      if (len > 63) {
        throw new Error(`post version 2.0 custom glyph name ${i} length must be <= 63, got ${len}`)
      }
      if (reader.remaining < len) {
        throw new Error(`post version 2.0 custom glyph name ${i} exceeds table length`)
      }
      // post glyph names are identifiers used only for lookup; the Adobe naming
      // convention ([A-Za-z0-9._]) is advisory and shipping fonts include other
      // characters, so the raw name is kept without character validation.
      const name = reader.readAscii(len)
      customNames.push(name)
    }
    // Trailing bytes after the last referenced name are padding in real fonts
    // (e.g. macOS Kailasa leaves 1 byte); ignore them rather than reject.

    glyphNames = []
    for (let i = 0; i < numGlyphs; i++) {
      const idx = nameIndices[i]!
      if (idx < 258) {
        glyphNames.push(POST_STANDARD_NAMES[idx]!)
      } else {
        glyphNames.push(customNames[idx - 258]!)
      }
    }
  } else if (versionFixed === 0x00030000) {
    if (reader.length !== 32) {
      throw new Error(`post version 3.0 table length must be 32, got ${reader.length}`)
    }
  } else if (versionFixed === 0x00040000) {
    if ((reader.length - 32) % 2 !== 0) {
      throw new Error(`post version 4.0 table length must contain complete uint16 character codes, got ${reader.length}`)
    }
    const numGlyphs = options.expectedGlyphCount ?? ((reader.length - 32) / 2)
    const expectedLength = 32 + numGlyphs * 2
    if (reader.length !== expectedLength) {
      throw new Error(`post version 4.0 table length must be ${expectedLength}, got ${reader.length}`)
    }
    glyphNameCharacterCodes = new Uint16Array(numGlyphs)
    glyphNames = new Array<string | null>(numGlyphs)
    for (let i = 0; i < numGlyphs; i++) {
      const characterCode = reader.readUint16()
      glyphNameCharacterCodes[i] = characterCode
      glyphNames[i] = characterCode === 0xFFFF
        ? null
        : `a${characterCode.toString(16).toUpperCase().padStart(4, '0')}`
    }
  } else {
    throw new Error(`Unsupported post table version: 0x${versionFixed.toString(16).padStart(8, '0')}`)
  }

  return {
    version,
    italicAngle,
    underlinePosition,
    underlineThickness,
    isFixedPitch,
    minMemType42,
    maxMemType42,
    minMemType1,
    maxMemType1,
    glyphNames,
    glyphNameCharacterCodes,
  }
}

function validatePostNumGlyphs(numGlyphs: number, expectedGlyphCount: number | undefined, label: string): void {
  if (expectedGlyphCount !== undefined && numGlyphs !== expectedGlyphCount) {
    throw new Error(`${label} numGlyphs must match maxp.numGlyphs ${expectedGlyphCount}, got ${numGlyphs}`)
  }
}
