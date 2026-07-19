/**
 * CFF (Compact Font Format) parser
 * Parses glyph outlines of OTF fonts
 * Type 2 Charstring -> cubic Bezier curves (native support)
 */
import { BinaryReader } from '../binary/reader.js'
import { PathCommand } from '../types/glyph.js'
import type { GlyphOutline } from '../types/index.js'

// --- CFF INDEX structure ---

export interface CffIndex {
  count: number
  offsets: Uint32Array
  data: BinaryReader
}

function parseIndex(reader: BinaryReader): CffIndex {
  if (reader.remaining < 2) throw new Error('CFF INDEX count is truncated')
  const count = reader.readUint16()
  if (count === 0) {
    return { count: 0, offsets: new Uint32Array(0), data: reader.subReader(reader.position, 0) }
  }

  const offSize = reader.readUint8()
  if (offSize < 1 || offSize > 4) throw new Error(`CFF INDEX offsetSize must be from 1 to 4, got ${offSize}`)
  if (reader.remaining < (count + 1) * offSize) throw new Error('CFF INDEX offset array is truncated')
  const offsets = new Uint32Array(count + 1)

  for (let i = 0; i <= count; i++) {
    let offset = 0
    for (let j = 0; j < offSize; j++) {
      offset = (offset << 8) | reader.readUint8()
    }
    offsets[i] = offset
  }

  if (offsets[0] !== 1) throw new Error(`CFF INDEX first offset must be 1, got ${offsets[0]}`)
  for (let i = 1; i <= count; i++) {
    if (offsets[i]! < offsets[i - 1]!) throw new Error('CFF INDEX offsets must be nondecreasing')
  }

  // data starts at the current reader.position; offsets are 1-based, so getIndexEntry subtracts 1
  const dataStart = reader.position
  const dataLength = offsets[count]! - 1 // actual data size
  if (dataLength > reader.remaining) throw new Error('CFF INDEX object data exceeds table length')
  const data = reader.subReader(dataStart, dataLength)

  // Advance the reader position to the end of the INDEX
  reader.seek(dataStart + dataLength)

  return { count, offsets, data }
}

function getIndexEntry(index: CffIndex, i: number): BinaryReader {
  if (!Number.isInteger(i) || i < 0 || i >= index.count) throw new Error(`CFF INDEX entry ${i} exceeds count ${index.count}`)
  const offset = index.offsets[i]! - 1 // 1-based to 0-based
  const length = index.offsets[i + 1]! - index.offsets[i]!
  return index.data.subReader(offset, length)
}

// --- CFF DICT parsing ---

interface CffDict {
  entries: Map<number, number[]>
}

function parseDict(reader: BinaryReader): CffDict {
  const entries = new Map<number, number[]>()
  const operands: number[] = []

  while (reader.remaining > 0) {
    const b0 = reader.readUint8()

    if (b0 === 12) {
      // 2-byte operator
      const b1 = reader.readUint8()
      const op = 1200 + b1
      if (entries.has(op)) throw new Error(`CFF DICT operator ${op} is duplicated`)
      entries.set(op, [...operands])
      operands.length = 0
    } else if (b0 <= 21) {
      // 1-byte operator
      if (entries.has(b0)) throw new Error(`CFF DICT operator ${b0} is duplicated`)
      entries.set(b0, [...operands])
      operands.length = 0
    } else if (b0 === 28) {
      // Int16
      const hi = reader.readUint8()
      const lo = reader.readUint8()
      operands.push((hi << 8 | lo) << 16 >> 16)
    } else if (b0 === 29) {
      // Int32
      const b1 = reader.readUint8()
      const b2 = reader.readUint8()
      const b3 = reader.readUint8()
      const b4 = reader.readUint8()
      operands.push(((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >> 0)
    } else if (b0 === 30) {
      // Real number
      operands.push(parseCffReal(reader))
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139)
    } else if (b0 >= 247 && b0 <= 250) {
      const b1 = reader.readUint8()
      operands.push((b0 - 247) * 256 + b1 + 108)
    } else if (b0 >= 251 && b0 <= 254) {
      const b1 = reader.readUint8()
      operands.push(-(b0 - 251) * 256 - b1 - 108)
    }
  }

  if (operands.length !== 0) throw new Error('CFF DICT ends with operands that have no operator')

  return { entries }
}

export function parseCffReal(reader: BinaryReader): number {
  let str = ''
  let done = false

  while (!done) {
    const byte = reader.readUint8()
    for (let shift = 4; shift >= 0; shift -= 4) {
      const nibble = (byte >> shift) & 0x0F
      if (nibble === 0x0F) {
        done = true
        break
      } else if (nibble <= 9) str += String.fromCharCode(0x30 + nibble)
      else if (nibble === 0x0A) str += '.'
      else if (nibble === 0x0B) str += 'E'
      else if (nibble === 0x0C) str += 'E-'
      else if (nibble === 0x0D) throw new Error('CFF real number uses reserved nibble 0xD')
      else if (nibble === 0x0E) str += '-'
    }
  }
  if (str === '' || str === '.') return 0
  if (!/^-?(?:[1-9][0-9]*|0)?(?:\.[0-9]*)?(?:E-?[1-9][0-9]*)?$/.test(str) || !/[0-9.]/.test(str)) {
    throw new Error(`CFF real number is malformed: ${str}`)
  }
  return Number(str)
}

function getDictValue(dict: CffDict, key: number, defaultValue: number = 0): number {
  const val = dict.entries.get(key)
  return val && val.length > 0 ? val[0]! : defaultValue
}

function getDictArray(dict: CffDict, key: number): number[] {
  return dict.entries.get(key) ?? []
}

// --- CFF DICT operator constants ---
const CFF_OP_CHARSET = 15
const CFF_OP_ENCODING = 16
const CFF_OP_CHARSTRINGS = 17
const CFF_OP_PRIVATE = 18
const CFF_OP_SUBRS = 19 // in Private DICT
const CFF_OP_DEFAULT_WIDTH_X = 20 // in Private DICT
const CFF_OP_NOMINAL_WIDTH_X = 21 // in Private DICT
const CFF_OP_FONT_MATRIX = 1207 // 12 7 — FontMatrix
const CFF_OP_ROS = 1230       // 12 30 — indicates a CIDFont
const CFF_OP_FDARRAY = 1236   // 12 36 — FDArray offset
const CFF_OP_FDSELECT = 1237  // 12 37 — FDSelect offset

// CFF 1 Appendix A standard strings. SIDs 0..390 index this table; higher
// SIDs index the font's String INDEX starting at 391.
const CFF_STANDARD_STRINGS = '.notdef|space|exclam|quotedbl|numbersign|dollar|percent|ampersand|quoteright|parenleft|parenright|asterisk|plus|comma|hyphen|period|slash|zero|one|two|three|four|five|six|seven|eight|nine|colon|semicolon|less|equal|greater|question|at|A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z|bracketleft|backslash|bracketright|asciicircum|underscore|quoteleft|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z|braceleft|bar|braceright|asciitilde|exclamdown|cent|sterling|fraction|yen|florin|section|currency|quotesingle|quotedblleft|guillemotleft|guilsinglleft|guilsinglright|fi|fl|endash|dagger|daggerdbl|periodcentered|paragraph|bullet|quotesinglbase|quotedblbase|quotedblright|guillemotright|ellipsis|perthousand|questiondown|grave|acute|circumflex|tilde|macron|breve|dotaccent|dieresis|ring|cedilla|hungarumlaut|ogonek|caron|emdash|AE|ordfeminine|Lslash|Oslash|OE|ordmasculine|ae|dotlessi|lslash|oslash|oe|germandbls|onesuperior|logicalnot|mu|trademark|Eth|onehalf|plusminus|Thorn|onequarter|divide|brokenbar|degree|thorn|threequarters|twosuperior|registered|minus|eth|multiply|threesuperior|copyright|Aacute|Acircumflex|Adieresis|Agrave|Aring|Atilde|Ccedilla|Eacute|Ecircumflex|Edieresis|Egrave|Iacute|Icircumflex|Idieresis|Igrave|Ntilde|Oacute|Ocircumflex|Odieresis|Ograve|Otilde|Scaron|Uacute|Ucircumflex|Udieresis|Ugrave|Yacute|Ydieresis|Zcaron|aacute|acircumflex|adieresis|agrave|aring|atilde|ccedilla|eacute|ecircumflex|edieresis|egrave|iacute|icircumflex|idieresis|igrave|ntilde|oacute|ocircumflex|odieresis|ograve|otilde|scaron|uacute|ucircumflex|udieresis|ugrave|yacute|ydieresis|zcaron|exclamsmall|Hungarumlautsmall|dollaroldstyle|dollarsuperior|ampersandsmall|Acutesmall|parenleftsuperior|parenrightsuperior|twodotenleader|onedotenleader|zerooldstyle|oneoldstyle|twooldstyle|threeoldstyle|fouroldstyle|fiveoldstyle|sixoldstyle|sevenoldstyle|eightoldstyle|nineoldstyle|commasuperior|threequartersemdash|periodsuperior|questionsmall|asuperior|bsuperior|centsuperior|dsuperior|esuperior|isuperior|lsuperior|msuperior|nsuperior|osuperior|rsuperior|ssuperior|tsuperior|ff|ffi|ffl|parenleftinferior|parenrightinferior|Circumflexsmall|hyphensuperior|Gravesmall|Asmall|Bsmall|Csmall|Dsmall|Esmall|Fsmall|Gsmall|Hsmall|Ismall|Jsmall|Ksmall|Lsmall|Msmall|Nsmall|Osmall|Psmall|Qsmall|Rsmall|Ssmall|Tsmall|Usmall|Vsmall|Wsmall|Xsmall|Ysmall|Zsmall|colonmonetary|onefitted|rupiah|Tildesmall|exclamdownsmall|centoldstyle|Lslashsmall|Scaronsmall|Zcaronsmall|Dieresissmall|Brevesmall|Caronsmall|Dotaccentsmall|Macronsmall|figuredash|hypheninferior|Ogoneksmall|Ringsmall|Cedillasmall|questiondownsmall|oneeighth|threeeighths|fiveeighths|seveneighths|onethird|twothirds|zerosuperior|foursuperior|fivesuperior|sixsuperior|sevensuperior|eightsuperior|ninesuperior|zeroinferior|oneinferior|twoinferior|threeinferior|fourinferior|fiveinferior|sixinferior|seveninferior|eightinferior|nineinferior|centinferior|dollarinferior|periodinferior|commainferior|Agravesmall|Aacutesmall|Acircumflexsmall|Atildesmall|Adieresissmall|Aringsmall|AEsmall|Ccedillasmall|Egravesmall|Eacutesmall|Ecircumflexsmall|Edieresissmall|Igravesmall|Iacutesmall|Icircumflexsmall|Idieresissmall|Ethsmall|Ntildesmall|Ogravesmall|Oacutesmall|Ocircumflexsmall|Otildesmall|Odieresissmall|OEsmall|Oslashsmall|Ugravesmall|Uacutesmall|Ucircumflexsmall|Udieresissmall|Yacutesmall|Thornsmall|Ydieresissmall|001.000|001.001|001.002|001.003|Black|Bold|Book|Light|Medium|Regular|Roman|Semibold'.split('|')

// --- Type 2 Charstring interpreter ---

const EMPTY_OUTLINE: GlyphOutline = {
  commands: new Uint8Array(0),
  coords: new Float32Array(0),
}

/** Stem hint (position + width) — used when capturing hints */
export interface CffStemHint {
  pos: number
  width: number
}

/** Hint data captured from the charstring */
export interface CffCharstringHints {
  hStems: CffStemHint[]
  vStems: CffStemHint[]
  hintMasks: Uint8Array[]
  counterMasks: Uint8Array[]
}

/**
 * Accent composition arguments captured from a 4-argument endchar
 * (Type 2 charstring spec, Appendix C — seac-equivalent functionality)
 */
export interface CffSeac {
  adx: number
  ady: number
  bchar: number
  achar: number
}

/**
 * Interprets a Type 2 Charstring and generates a glyph outline
 * @param captureHints If true, captures and returns stem hint data
 */
function interpretCharstring(
  data: BinaryReader,
  globalSubrs: CffIndex,
  localSubrs: CffIndex,
  globalBias: number,
  localBias: number,
  defaultWidthX: number,
  nominalWidthX: number,
  captureHints?: boolean,
): { outline: GlyphOutline; width: number; hints?: CffCharstringHints; seac: CffSeac | null } {
  const commands: number[] = []
  const coords: number[] = []
  const stack: number[] = []
  let width = defaultWidthX
  let widthParsed = false
  let x = 0
  let y = 0
  let open = false
  let numStems = 0
  let seac: CffSeac | null = null

  // For hint capture
  const hStems: CffStemHint[] = captureHints ? [] : []
  const vStems: CffStemHint[] = captureHints ? [] : []
  const hintMasks: Uint8Array[] = captureHints ? [] : []
  const counterMasks: Uint8Array[] = captureHints ? [] : []
  let hStemPos = 0  // cumulative hstem position
  let vStemPos = 0  // cumulative vstem position

  // The Type 2 charstring spec (section 4.3) limits subroutine call nesting to
  // 10. Enforcing it stops a self-referential subr from growing the call stack
  // without bound.
  const MAX_SUBR_DEPTH = 10
  const callStack: { reader: BinaryReader; }[] = []
  const transientArray: number[] = [] // put/get storage

  function moveTo(dx: number, dy: number) {
    if (open) {
      commands.push(PathCommand.Close)
    }
    x += dx
    y += dy
    commands.push(PathCommand.MoveTo)
    coords.push(x, y)
    open = true
  }

  function lineTo(dx: number, dy: number) {
    x += dx
    y += dy
    commands.push(PathCommand.LineTo)
    coords.push(x, y)
  }

  function cubicTo(dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number) {
    const cp1x = x + dx1
    const cp1y = y + dy1
    const cp2x = cp1x + dx2
    const cp2y = cp1y + dy2
    x = cp2x + dx3
    y = cp2y + dy3
    commands.push(PathCommand.CubicTo)
    coords.push(cp1x, cp1y, cp2x, cp2y, x, y)
  }

  function checkWidth() {
    if (!widthParsed) {
      widthParsed = true
    }
  }

  function execute(reader: BinaryReader) {
    while (reader.remaining > 0) {
      const b0 = reader.readUint8()

      if (b0 === 1 || b0 === 3 || b0 === 18 || b0 === 23) {
        // hstem(1), vstem(3), hstemhm(18), vstemhm(23)
        if (!widthParsed && stack.length % 2 !== 0) {
          width = nominalWidthX + stack.shift()!
        }
        checkWidth()
        if (captureHints) {
          const isH = (b0 === 1 || b0 === 18)
          let pos = isH ? hStemPos : vStemPos
          for (let si = 0; si < stack.length; si += 2) {
            pos += stack[si]!
            const w = stack[si + 1]!
            if (isH) {
              hStems.push({ pos, width: w })
            } else {
              vStems.push({ pos, width: w })
            }
            pos += w
          }
          if (isH) hStemPos = pos; else vStemPos = pos
        }
        numStems += stack.length >> 1
        stack.length = 0
      } else if (b0 === 4) {
        // vmoveto
        if (!widthParsed && stack.length > 1) {
          width = nominalWidthX + stack.shift()!
        }
        checkWidth()
        moveTo(0, stack.pop()!)
        stack.length = 0
      } else if (b0 === 5) {
        // rlineto
        checkWidth()
        for (let i = 0; i < stack.length; i += 2) {
          lineTo(stack[i]!, stack[i + 1]!)
        }
        stack.length = 0
      } else if (b0 === 6) {
        // hlineto
        checkWidth()
        let horizontal = true
        for (let i = 0; i < stack.length; i++) {
          if (horizontal) {
            lineTo(stack[i]!, 0)
          } else {
            lineTo(0, stack[i]!)
          }
          horizontal = !horizontal
        }
        stack.length = 0
      } else if (b0 === 7) {
        // vlineto
        checkWidth()
        let vertical = true
        for (let i = 0; i < stack.length; i++) {
          if (vertical) {
            lineTo(0, stack[i]!)
          } else {
            lineTo(stack[i]!, 0)
          }
          vertical = !vertical
        }
        stack.length = 0
      } else if (b0 === 8) {
        // rrcurveto
        checkWidth()
        for (let i = 0; i < stack.length; i += 6) {
          cubicTo(stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, stack[i + 4]!, stack[i + 5]!)
        }
        stack.length = 0
      } else if (b0 === 10) {
        // callsubr (local)
        const subrIndex = stack.pop()! + localBias
        if (subrIndex >= 0 && subrIndex < localSubrs.count) {
          if (callStack.length >= MAX_SUBR_DEPTH) {
            throw new Error('CFF subroutine nesting depth exceeded (max ' + MAX_SUBR_DEPTH + ')')
          }
          callStack.push({ reader })
          reader = getIndexEntry(localSubrs, subrIndex)
          continue
        }
      } else if (b0 === 11) {
        // return
        if (callStack.length > 0) {
          reader = callStack.pop()!.reader
          continue
        }
        return
      } else if (b0 === 14) {
        // endchar — takes 0 or 4 args (adx ady bchar achar, Type 2 spec
        // Appendix C accent composition), plus an optional leading width
        if (!widthParsed && (stack.length === 1 || stack.length === 5)) {
          width = nominalWidthX + stack.shift()!
        }
        checkWidth()
        if (stack.length >= 4) {
          seac = { adx: stack[0]!, ady: stack[1]!, bchar: stack[2]!, achar: stack[3]! }
        }
        if (open) {
          commands.push(PathCommand.Close)
          open = false
        }
        return
      } else if (b0 === 19 || b0 === 20) {
        // hintmask, cntrmask
        if (!widthParsed && stack.length % 2 !== 0) {
          width = nominalWidthX + stack.shift()!
        }
        checkWidth()
        // Handle implicit vstems preceding hintmask/cntrmask
        if (captureHints && stack.length > 0) {
          let pos = vStemPos
          for (let si = 0; si < stack.length; si += 2) {
            pos += stack[si]!
            const w = stack[si + 1]!
            vStems.push({ pos, width: w })
            pos += w
          }
          vStemPos = pos
        }
        numStems += stack.length >> 1
        stack.length = 0
        // Mask byte count is derived from the cumulative stem count
        const maskBytes = Math.max(1, Math.ceil(numStems / 8))
        if (captureHints) {
          const mask = new Uint8Array(maskBytes)
          for (let mi = 0; mi < maskBytes; mi++) {
            mask[mi] = reader.readUint8()
          }
          if (b0 === 19) hintMasks.push(mask)
          else counterMasks.push(mask)
        } else {
          reader.skip(maskBytes)
        }
      } else if (b0 === 21) {
        // rmoveto
        if (!widthParsed && stack.length > 2) {
          width = nominalWidthX + stack.shift()!
        }
        checkWidth()
        const dy = stack.pop()!
        const dx = stack.pop()!
        moveTo(dx, dy)
        stack.length = 0
      } else if (b0 === 22) {
        // hmoveto
        if (!widthParsed && stack.length > 1) {
          width = nominalWidthX + stack.shift()!
        }
        checkWidth()
        moveTo(stack.pop()!, 0)
        stack.length = 0
      } else if (b0 === 24) {
        // rcurveline
        checkWidth()
        const curveCount = stack.length - 2
        let i = 0
        for (; i < curveCount; i += 6) {
          cubicTo(stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, stack[i + 4]!, stack[i + 5]!)
        }
        lineTo(stack[i]!, stack[i + 1]!)
        stack.length = 0
      } else if (b0 === 25) {
        // rlinecurve
        checkWidth()
        const lineCount = stack.length - 6
        let i = 0
        for (; i < lineCount; i += 2) {
          lineTo(stack[i]!, stack[i + 1]!)
        }
        cubicTo(stack[i]!, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, stack[i + 4]!, stack[i + 5]!)
        stack.length = 0
      } else if (b0 === 26) {
        // vvcurveto
        checkWidth()
        let i = 0
        let dx1 = 0
        if (stack.length % 4 !== 0) {
          dx1 = stack[i++]!
        }
        while (i < stack.length) {
          cubicTo(dx1, stack[i]!, stack[i + 1]!, stack[i + 2]!, 0, stack[i + 3]!)
          dx1 = 0
          i += 4
        }
        stack.length = 0
      } else if (b0 === 27) {
        // hhcurveto
        checkWidth()
        let i = 0
        let dy1 = 0
        if (stack.length % 4 !== 0) {
          dy1 = stack[i++]!
        }
        while (i < stack.length) {
          cubicTo(stack[i]!, dy1, stack[i + 1]!, stack[i + 2]!, stack[i + 3]!, 0)
          dy1 = 0
          i += 4
        }
        stack.length = 0
      } else if (b0 === 28) {
        // Int16
        const hi = reader.readUint8()
        const lo = reader.readUint8()
        stack.push((hi << 8 | lo) << 16 >> 16)
      } else if (b0 === 29) {
        // callgsubr (global)
        const subrIndex = stack.pop()! + globalBias
        if (subrIndex >= 0 && subrIndex < globalSubrs.count) {
          if (callStack.length >= MAX_SUBR_DEPTH) {
            throw new Error('CFF subroutine nesting depth exceeded (max ' + MAX_SUBR_DEPTH + ')')
          }
          callStack.push({ reader })
          reader = getIndexEntry(globalSubrs, subrIndex)
          continue
        }
      } else if (b0 === 30) {
        // vhcurveto: alternating v→h / h→v curves
        checkWidth()
        let i = 0
        let phase = 0
        while (i < stack.length) {
          const lastCurve = stack.length - i === 5
          if (phase === 0) {
            // v→h: cubicTo(0, dy1, dx2, dy2, dx3, dyf|0)
            cubicTo(
              0, stack[i]!,
              stack[i + 1]!, stack[i + 2]!,
              stack[i + 3]!,
              lastCurve ? stack[i + 4]! : 0,
            )
          } else {
            // h→v: cubicTo(dxa, 0, dxb, dyb, dxf|0, dyc)
            cubicTo(
              stack[i]!, 0,
              stack[i + 1]!, stack[i + 2]!,
              lastCurve ? stack[i + 4]! : 0,
              stack[i + 3]!,
            )
          }
          i += lastCurve ? 5 : 4
          phase = 1 - phase
        }
        stack.length = 0
      } else if (b0 === 31) {
        // hvcurveto: alternating h→v / v→h curves
        checkWidth()
        let i = 0
        let phase = 0
        while (i < stack.length) {
          const lastCurve = stack.length - i === 5
          if (phase === 0) {
            // h→v: cubicTo(dxa, 0, dxb, dyb, dxf|0, dyc)
            cubicTo(
              stack[i]!, 0,
              stack[i + 1]!, stack[i + 2]!,
              lastCurve ? stack[i + 4]! : 0,
              stack[i + 3]!,
            )
          } else {
            // v→h: cubicTo(0, dya, dxb, dyb, dxc, dyf|0)
            cubicTo(
              0, stack[i]!,
              stack[i + 1]!, stack[i + 2]!,
              stack[i + 3]!,
              lastCurve ? stack[i + 4]! : 0,
            )
          }
          i += lastCurve ? 5 : 4
          phase = 1 - phase
        }
        stack.length = 0
      } else if (b0 === 12) {
        // 2-byte operator
        const b1 = reader.readUint8()
        if (b1 === 34) {
          // hflex: dx1 dx2 dy2 dx3 dx4 dx5 dx6
          checkWidth()
          cubicTo(stack[0]!, 0, stack[1]!, stack[2]!, stack[3]!, 0)
          cubicTo(stack[4]!, 0, stack[5]!, -stack[2]!, stack[6]!, 0)
          stack.length = 0
        } else if (b1 === 35) {
          // flex
          checkWidth()
          cubicTo(stack[0]!, stack[1]!, stack[2]!, stack[3]!, stack[4]!, stack[5]!)
          cubicTo(stack[6]!, stack[7]!, stack[8]!, stack[9]!, stack[10]!, stack[11]!)
          stack.length = 0
        } else if (b1 === 36) {
          // hflex1: dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6
          checkWidth()
          cubicTo(stack[0]!, stack[1]!, stack[2]!, stack[3]!, stack[4]!, 0)
          cubicTo(stack[5]!, 0, stack[6]!, stack[7]!, stack[8]!, -(stack[1]! + stack[3]! + stack[7]!))
          stack.length = 0
        } else if (b1 === 37) {
          // flex1
          checkWidth()
          const dx1 = stack[0]!
          const dy1 = stack[1]!
          const dx2 = stack[2]!
          const dy2 = stack[3]!
          const dx3 = stack[4]!
          const dy3 = stack[5]!
          const dx4 = stack[6]!
          const dy4 = stack[7]!
          const dx5 = stack[8]!
          const dy5 = stack[9]!
          const d6 = stack[10]!
          const sumDx = Math.abs(dx1 + dx2 + dx3 + dx4 + dx5)
          const sumDy = Math.abs(dy1 + dy2 + dy3 + dy4 + dy5)
          let dx6: number, dy6: number
          if (sumDx > sumDy) {
            dx6 = d6
            dy6 = -(dy1 + dy2 + dy3 + dy4 + dy5)
          } else {
            dx6 = -(dx1 + dx2 + dx3 + dx4 + dx5)
            dy6 = d6
          }
          cubicTo(dx1, dy1, dx2, dy2, dx3, dy3)
          cubicTo(dx4, dy4, dx5, dy5, dx6, dy6)
          stack.length = 0
        } else if (b1 === 3) {
          // and
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(a && b ? 1 : 0)
        } else if (b1 === 4) {
          // or
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(a || b ? 1 : 0)
        } else if (b1 === 5) {
          // not
          const a = stack.pop()!
          stack.push(a ? 0 : 1)
        } else if (b1 === 9) {
          // abs
          stack.push(Math.abs(stack.pop()!))
        } else if (b1 === 10) {
          // add
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(a + b)
        } else if (b1 === 11) {
          // sub
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(a - b)
        } else if (b1 === 12) {
          // div
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(b !== 0 ? a / b : 0)
        } else if (b1 === 14) {
          // neg
          stack.push(-stack.pop()!)
        } else if (b1 === 15) {
          // eq
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(a === b ? 1 : 0)
        } else if (b1 === 18) {
          // drop
          stack.pop()
        } else if (b1 === 20) {
          // put
          const i = stack.pop()!
          const val = stack.pop()!
          transientArray[i] = val
        } else if (b1 === 21) {
          // get
          const i = stack.pop()!
          stack.push(transientArray[i] ?? 0)
        } else if (b1 === 22) {
          // ifelse
          const v2 = stack.pop()!
          const v1 = stack.pop()!
          const s2 = stack.pop()!
          const s1 = stack.pop()!
          stack.push(v1 <= v2 ? s1 : s2)
        } else if (b1 === 23) {
          // random — deterministic substitute (spec says implementation-defined)
          stack.push(1)
        } else if (b1 === 24) {
          // mul
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(a * b)
        } else if (b1 === 26) {
          // sqrt
          stack.push(Math.sqrt(stack.pop()!))
        } else if (b1 === 27) {
          // dup
          const a = stack[stack.length - 1]!
          stack.push(a)
        } else if (b1 === 28) {
          // exch
          const b = stack.pop()!
          const a = stack.pop()!
          stack.push(b, a)
        } else if (b1 === 29) {
          // index
          const idx = stack.pop()!
          const n = idx < 0 ? 0 : idx
          stack.push(stack[stack.length - 1 - n]!)
        } else if (b1 === 30) {
          // roll
          const j = stack.pop()!
          const n = stack.pop()!
          if (n > 0 && stack.length >= n) {
            const start = stack.length - n
            const segment = stack.splice(start, n)
            const shift = ((j % n) + n) % n
            const rotated = [...segment.slice(n - shift), ...segment.slice(0, n - shift)]
            stack.push(...rotated)
          }
        }
      } else if (b0 >= 32 && b0 <= 246) {
        stack.push(b0 - 139)
      } else if (b0 >= 247 && b0 <= 250) {
        const b1 = reader.readUint8()
        stack.push((b0 - 247) * 256 + b1 + 108)
      } else if (b0 >= 251 && b0 <= 254) {
        const b1 = reader.readUint8()
        stack.push(-(b0 - 251) * 256 - b1 - 108)
      } else if (b0 === 255) {
        // Fixed 16.16
        const val = (reader.readUint8() << 24 | reader.readUint8() << 16 | reader.readUint8() << 8 | reader.readUint8()) >> 0
        stack.push(val / 65536)
      }
    }

    // Subroutine data ended without a return -> treat as an implicit return
    if (callStack.length > 0) {
      reader = callStack.pop()!.reader
      execute(reader)
    }
  }

  execute(data)

  if (open) {
    commands.push(PathCommand.Close)
  }

  const result: { outline: GlyphOutline; width: number; hints?: CffCharstringHints; seac: CffSeac | null } = {
    outline: {
      commands: new Uint8Array(commands),
      coords: new Float32Array(coords),
    },
    width,
    seac,
  }

  if (captureHints) {
    result.hints = { hStems, vStems, hintMasks, counterMasks }
  }

  return result
}

/**
 * Computes the subroutine bias
 */
function calcSubrBias(count: number): number {
  if (count < 1240) return 107
  if (count < 33900) return 1131
  return 32768
}

// --- Per-FD data for CIDFonts ---

export interface CffFDData {
  localSubrs: CffIndex
  localBias: number
  defaultWidthX: number
  nominalWidthX: number
  /** All Private DICT entries (retained for hinting data) */
  privateDictEntries: Map<number, number[]>
}

// --- FDSelect parsing ---

function parseFDSelect(reader: BinaryReader, offset: number, numGlyphs: number): Uint8Array {
  reader.seek(offset)
  const format = reader.readUint8()
  const fdSelect = new Uint8Array(numGlyphs)

  if (format === 0) {
    for (let i = 0; i < numGlyphs; i++) {
      fdSelect[i] = reader.readUint8()
    }
  } else if (format === 3) {
    const nRanges = reader.readUint16()
    if (nRanges === 0) throw new Error('CFF FDSelect format 3 requires at least one range')
    let first = reader.readUint16()
    if (first !== 0) throw new Error('CFF FDSelect first range must start at glyph 0')
    for (let i = 0; i < nRanges; i++) {
      const fd = reader.readUint8()
      const next = reader.readUint16()
      if (next <= first) throw new Error('CFF FDSelect ranges must be strictly increasing')
      if (next > numGlyphs) throw new Error('CFF FDSelect range exceeds CharString count')
      for (let g = first; g < next; g++) {
        fdSelect[g] = fd
      }
      first = next
    }
    if (first !== numGlyphs) throw new Error('CFF FDSelect sentinel must equal CharString count')
  } else {
    throw new Error(`Unsupported CFF FDSelect format: ${format}`)
  }

  return fdSelect
}

// --- CFF Encoding parsing ---

/**
 * Standard Encoding (predefined, offset=0)
 */
const STANDARD_ENCODING: number[] = (() => {
  const enc = new Array(256).fill(0)
  // Primary mappings of the Adobe Standard Encoding
  const map: [number, number][] = [
    [32, 1], [33, 2], [34, 3], [35, 4], [36, 5], [37, 6], [38, 7], [39, 8],
    [40, 9], [41, 10], [42, 11], [43, 12], [44, 13], [45, 14], [46, 15], [47, 16],
    [48, 17], [49, 18], [50, 19], [51, 20], [52, 21], [53, 22], [54, 23], [55, 24],
    [56, 25], [57, 26], [58, 27], [59, 28], [60, 29], [61, 30], [62, 31], [63, 32],
    [64, 33], [65, 34], [66, 35], [67, 36], [68, 37], [69, 38], [70, 39], [71, 40],
    [72, 41], [73, 42], [74, 43], [75, 44], [76, 45], [77, 46], [78, 47], [79, 48],
    [80, 49], [81, 50], [82, 51], [83, 52], [84, 53], [85, 54], [86, 55], [87, 56],
    [88, 57], [89, 58], [90, 59], [91, 60], [92, 61], [93, 62], [94, 63], [95, 64],
    [96, 65], [97, 66], [98, 67], [99, 68], [100, 69], [101, 70], [102, 71], [103, 72],
    [104, 73], [105, 74], [106, 75], [107, 76], [108, 77], [109, 78], [110, 79], [111, 80],
    [112, 81], [113, 82], [114, 83], [115, 84], [116, 85], [117, 86], [118, 87], [119, 88],
    [120, 89], [121, 90], [122, 91], [123, 92], [124, 93], [125, 94], [126, 95],
    [161, 96], [162, 97], [163, 98], [164, 99], [165, 100], [166, 101], [167, 102],
    [168, 103], [169, 104], [170, 105], [171, 106], [172, 107], [173, 108], [174, 109],
    [175, 110], [177, 111], [178, 112], [179, 113], [180, 114], [182, 115], [183, 116],
    [184, 117], [185, 118], [186, 119], [187, 120], [188, 121], [189, 122], [191, 123],
    [193, 124], [194, 125], [195, 126], [196, 127], [197, 128], [198, 129], [199, 130],
    [200, 131], [202, 132], [203, 133], [205, 134], [206, 135], [207, 136], [208, 137],
    [225, 138], [227, 139], [232, 140], [233, 141], [234, 142], [235, 143], [241, 144],
    [245, 145], [248, 146], [249, 147], [250, 148], [251, 149],
  ]
  for (const [code, sid] of map) enc[code] = sid
  return enc
})()

/**
 * Expert Encoding (predefined, offset=1)
 */
const EXPERT_ENCODING: number[] = (() => {
  const enc = new Array(256).fill(0)
  const map: [number, number][] = [
    [32, 1], [33, 229], [34, 230], [36, 231], [37, 232], [38, 233], [39, 234],
    [40, 235], [41, 236], [42, 237], [43, 238], [44, 13], [45, 14], [46, 15],
    [47, 99], [48, 239], [49, 240], [50, 241], [51, 242], [52, 243], [53, 244],
    [54, 245], [55, 246], [56, 247], [57, 248], [58, 27], [59, 28], [60, 249],
    [61, 250], [62, 251], [63, 252], [64, 253], [65, 254], [66, 255], [67, 256],
    [68, 257], [69, 258], [70, 259], [71, 260], [72, 261], [73, 262], [74, 263],
    [75, 264], [76, 265], [77, 266], [78, 109], [79, 110], [80, 267], [81, 268],
    [82, 269], [83, 270], [84, 271], [85, 272], [86, 273], [87, 274], [88, 275],
    [89, 276], [90, 277], [91, 278], [92, 279], [93, 280], [94, 281], [95, 282],
    [96, 283], [97, 284], [98, 285], [99, 286], [100, 287], [101, 288], [102, 289],
    [103, 290], [104, 291], [105, 292], [106, 293], [107, 294], [108, 295], [109, 296],
    [110, 297], [111, 298], [112, 299], [113, 300], [114, 301], [115, 302], [116, 303],
    [117, 304], [118, 305], [119, 306], [120, 307], [121, 308], [122, 309], [123, 310],
    [124, 311], [125, 312], [126, 313],
    [161, 314], [162, 315], [163, 316], [164, 317], [165, 318], [166, 158],
    [167, 155], [168, 163], [169, 319], [170, 320], [171, 321], [172, 322],
    [173, 323], [174, 324], [175, 325], [176, 326], [177, 150], [178, 164],
    [179, 169], [180, 327], [181, 328], [182, 329], [183, 330], [184, 331],
    [185, 332], [186, 333], [187, 334], [188, 335], [189, 336], [190, 337],
    [191, 338], [192, 339], [193, 340], [194, 341], [195, 342], [196, 343],
    [197, 344], [198, 345], [199, 346], [200, 347], [201, 348], [202, 349],
    [203, 350], [204, 351], [205, 352], [206, 353], [207, 354], [208, 355],
    [209, 356], [210, 357], [211, 358], [212, 359], [213, 360], [214, 361],
    [215, 362], [216, 363], [217, 364], [218, 365], [219, 366], [220, 367],
    [221, 368], [222, 369], [223, 370], [224, 371], [225, 372], [226, 373],
    [227, 374], [228, 375], [229, 376], [230, 377], [231, 378],
  ]
  for (const [code, sid] of map) enc[code] = sid
  return enc
})()

function parseEncoding(reader: BinaryReader, offset: number, charset: readonly number[]): CffEncoding {
  if (offset === 0) {
    return sidEncoding(-1, STANDARD_ENCODING, charset)
  }
  if (offset === 1) {
    return sidEncoding(-1, EXPERT_ENCODING, charset)
  }

  reader.seek(offset)
  const formatByte = reader.readUint8()
  const format = formatByte & 0x7F
  const hasSupplement = (formatByte & 0x80) !== 0
  const mapping = new Uint16Array(256)

  if (format === 0) {
    const nCodes = reader.readUint8()
    if (nCodes > charset.length - 1) throw new Error('CFF Encoding format 0 maps more codes than available glyphs')
    for (let i = 0; i < nCodes; i++) {
      const code = reader.readUint8()
      if (mapping[code] !== 0) throw new Error(`CFF Encoding code ${code} is duplicated`)
      mapping[code] = i + 1 // GID = 1-based (0 = .notdef)
    }
  } else if (format === 1) {
    const nRanges = reader.readUint8()
    let gid = 1
    for (let i = 0; i < nRanges; i++) {
      const first = reader.readUint8()
      const nLeft = reader.readUint8()
      if (first + nLeft > 255) throw new Error('CFF Encoding format 1 range exceeds code 255')
      if (gid + nLeft > charset.length - 1) throw new Error('CFF Encoding format 1 maps more codes than available glyphs')
      for (let j = 0; j <= nLeft; j++) {
        if (mapping[first + j] !== 0) throw new Error(`CFF Encoding code ${first + j} is duplicated`)
        mapping[first + j] = gid
        gid++
      }
    }
  } else {
    throw new Error(`Unsupported CFF Encoding format: ${format}`)
  }

  if (hasSupplement) {
    const count = reader.readUint8()
    for (let i = 0; i < count; i++) {
      const code = reader.readUint8()
      const sid = reader.readUint16()
      const gid = charset.indexOf(sid)
      if (gid < 0) throw new Error(`CFF Encoding supplement SID ${sid} is not present in charset`)
      if (mapping[code] !== 0) throw new Error(`CFF Encoding supplement code ${code} is duplicated`)
      mapping[code] = gid
    }
  }

  return {
    format,
    getGlyphId(code: number): number {
      if (code < 0 || code > 255) return 0
      return mapping[code]!
    },
  }
}

function sidEncoding(format: number, sids: readonly number[], charset: readonly number[]): CffEncoding {
  const mapping = new Uint16Array(256)
  for (let code = 0; code < 256; code++) {
    const sid = sids[code] ?? 0
    if (sid !== 0) {
      const gid = charset.indexOf(sid)
      if (gid >= 0) mapping[code] = gid
    }
  }
  return {
    format,
    getGlyphId(code: number): number {
      return code >= 0 && code <= 255 ? mapping[code]! : 0
    },
  }
}

// --- Parser for the whole CFF table ---

/** CFF Encoding table */
export interface CffEncoding {
  format: number
  /** code -> GID mapping (code 0-255) */
  getGlyphId(code: number): number
}

export interface CffData {
  charstrings: CffIndex
  globalSubrs: CffIndex
  globalBias: number
  charset: number[]
  /** Custom strings addressed by SIDs 391 and above. */
  strings: string[]
  encoding: CffEncoding | null
  // For non-CIDFonts (single Private DICT)
  localSubrs: CffIndex
  localBias: number
  defaultWidthX: number
  nominalWidthX: number
  /** All Private DICT entries (retained for hinting data) */
  privateDictEntries: Map<number, number[]>
  // For CIDFonts
  isCIDFont: boolean
  fdSelect: Uint8Array | null
  fdArray: CffFDData[] | null
  /** Top DICT FontMatrix (6 values), or null when absent (default [0.001 0 0 0.001 0 0]) */
  fontMatrix: number[] | null
}

/**
 * Parses the CFF table
 */
export function parseCff(reader: BinaryReader): CffData {
  const startOffset = reader.position

  // CFF header
  if (reader.remaining < 4) throw new Error('CFF header is truncated')
  const major = reader.readUint8()
  const minor = reader.readUint8()
  const hdrSize = reader.readUint8()
  const offSize = reader.readUint8()
  if (major !== 1) throw new Error(`Unsupported CFF major version: ${major}.${minor}`)
  if (hdrSize < 4 || hdrSize > reader.length - startOffset) throw new Error(`CFF header size ${hdrSize} is invalid`)
  if (minor === 0 && hdrSize !== 4) throw new Error(`CFF version 1.0 header size must be 4, got ${hdrSize}`)
  if (offSize < 1 || offSize > 4) throw new Error(`CFF header offSize must be from 1 to 4, got ${offSize}`)

  reader.seek(hdrSize)

  // Name INDEX
  const nameIndex = parseIndex(reader)

  // Top DICT INDEX
  const topDictIndex = parseIndex(reader)
  if (nameIndex.count !== 1 || topDictIndex.count !== 1) {
    throw new Error('OpenType CFF requires exactly one Name INDEX and one Top DICT INDEX entry')
  }

  // String INDEX
  const stringIndex = parseIndex(reader)
  const strings = new Array<string>(stringIndex.count)
  for (let i = 0; i < stringIndex.count; i++) {
    const entry = getIndexEntry(stringIndex, i)
    strings[i] = entry.readAscii(entry.length)
  }

  // Global Subr INDEX
  const globalSubrs = parseIndex(reader)
  const globalBias = calcSubrBias(globalSubrs.count)

  // Parse the Top DICT
  const topDictReader = getIndexEntry(topDictIndex, 0)
  const topDict = parseDict(topDictReader)

  // CharStrings INDEX
  const charstringsEntry = topDict.entries.get(CFF_OP_CHARSTRINGS)
  if (charstringsEntry?.length !== 1 || !Number.isInteger(charstringsEntry[0]) || charstringsEntry[0]! <= 0) {
    throw new Error('CFF Top DICT requires one positive CharStrings offset')
  }
  const charstringsOffset = charstringsEntry[0]!
  reader.seek(charstringsOffset)
  const charstrings = parseIndex(reader)

  const numGlyphs = charstrings.count

  // CIDFont detection
  const isCIDFont = topDict.entries.has(CFF_OP_ROS)
  if (isCIDFont && topDict.entries.get(CFF_OP_ROS)?.length !== 3) throw new Error('CFF ROS requires registry, ordering and supplement operands')

  let localSubrs: CffIndex = { count: 0, offsets: new Uint32Array(0), data: reader.subReader(0, 0) }
  let defaultWidthX = 0
  let nominalWidthX = 0
  let localBias = 0
  let privateDictEntries: Map<number, number[]> = new Map()
  let fdSelect: Uint8Array | null = null
  let fdArray: CffFDData[] | null = null

  if (isCIDFont) {
    // --- CIDFont: FDSelect + FDArray ---
    const fdSelectEntry = topDict.entries.get(CFF_OP_FDSELECT)
    const fdArrayEntry = topDict.entries.get(CFF_OP_FDARRAY)
    if (fdSelectEntry?.length !== 1 || fdArrayEntry?.length !== 1) throw new Error('CID-keyed CFF requires FDSelect and FDArray offsets')
    const fdSelectOffset = fdSelectEntry[0]!
    fdSelect = parseFDSelect(reader, fdSelectOffset, numGlyphs)

    const fdArrayOffset = fdArrayEntry[0]!
    reader.seek(fdArrayOffset)
    const fdArrayIndex = parseIndex(reader)
    if (fdArrayIndex.count === 0) throw new Error('CID-keyed CFF FDArray must contain at least one Font DICT')
    fdArray = []

    for (let i = 0; i < fdArrayIndex.count; i++) {
      const fdDictReader = getIndexEntry(fdArrayIndex, i)
      const fdDict = parseDict(fdDictReader)
      const privArr = getDictArray(fdDict, CFF_OP_PRIVATE)

      let fdLocalSubrs: CffIndex = { count: 0, offsets: new Uint32Array(0), data: reader.subReader(0, 0) }
      let fdDefaultWidthX = 0
      let fdNominalWidthX = 0
      let fdLocalBias = 0
      let fdPrivDictEntries: Map<number, number[]> = new Map()

      if (privArr.length >= 2) {
        const privSize = privArr[0]!
        const privOffset = privArr[1]!
        const privReader = reader.subReader(privOffset, privSize)
        const privDict = parseDict(privReader)
        fdPrivDictEntries = privDict.entries

        fdDefaultWidthX = getDictValue(privDict, CFF_OP_DEFAULT_WIDTH_X)
        fdNominalWidthX = getDictValue(privDict, CFF_OP_NOMINAL_WIDTH_X)

        const subrsOff = privDict.entries.get(CFF_OP_SUBRS)
        if (subrsOff && subrsOff.length > 0) {
          reader.seek(privOffset + subrsOff[0]!)
          fdLocalSubrs = parseIndex(reader)
          fdLocalBias = calcSubrBias(fdLocalSubrs.count)
        }
      }

      fdArray.push({
        localSubrs: fdLocalSubrs,
        localBias: fdLocalBias,
        defaultWidthX: fdDefaultWidthX,
        nominalWidthX: fdNominalWidthX,
        privateDictEntries: fdPrivDictEntries,
      })
    }
    for (let glyphId = 0; glyphId < fdSelect.length; glyphId++) {
      if (fdSelect[glyphId]! >= fdArray.length) throw new Error(`CFF FDSelect glyph ${glyphId} exceeds FDArray count`)
    }
  } else {
    // --- Non-CIDFont: single Private DICT ---
    const privateArr = getDictArray(topDict, CFF_OP_PRIVATE)
    if (privateArr.length >= 2) {
      const privateSize = privateArr[0]!
      const privateOffset = privateArr[1]!
      const privateReader = reader.subReader(privateOffset, privateSize)
      const privateDict = parseDict(privateReader)
      privateDictEntries = privateDict.entries

      defaultWidthX = getDictValue(privateDict, CFF_OP_DEFAULT_WIDTH_X)
      nominalWidthX = getDictValue(privateDict, CFF_OP_NOMINAL_WIDTH_X)

      const subrsOffset = privateDict.entries.get(CFF_OP_SUBRS)
      if (subrsOffset && subrsOffset.length > 0) {
        reader.seek(privateOffset + subrsOffset[0]!)
        localSubrs = parseIndex(reader)
        localBias = calcSubrBias(localSubrs.count)
      }
    }
  }

  // FontMatrix (kept so subsetting preserves non-default scaling)
  const fontMatrixArr = topDict.entries.get(CFF_OP_FONT_MATRIX)
  const fontMatrix = fontMatrixArr && fontMatrixArr.length === 6 ? fontMatrixArr : null

  // Charset
  const charsetOffset = getDictValue(topDict, CFF_OP_CHARSET)
  const charset = parseCharset(reader, charsetOffset, numGlyphs)

  // Encoding (non-CIDFonts only)
  let encoding: CffEncoding | null = null
  if (!isCIDFont) {
    const encodingOffset = getDictValue(topDict, CFF_OP_ENCODING)
    encoding = parseEncoding(reader, encodingOffset, charset)
  }

  return {
    charstrings,
    globalSubrs,
    globalBias,
    charset,
    strings,
    encoding,
    localSubrs,
    localBias,
    defaultWidthX,
    nominalWidthX,
    privateDictEntries,
    isCIDFont,
    fdSelect,
    fdArray,
    fontMatrix,
  }
}

/** Returns the CFF charset glyph name for a GID. */
export function cffGlyphName(cff: CffData, glyphId: number): string {
  if (glyphId < 0 || glyphId >= cff.charset.length) throw new Error(`CFF glyph ID ${glyphId} exceeds charset`)
  const sid = cff.charset[glyphId]!
  if (sid < CFF_STANDARD_STRINGS.length) return CFF_STANDARD_STRINGS[sid]!
  const custom = cff.strings[sid - CFF_STANDARD_STRINGS.length]
  if (custom === undefined) throw new Error(`CFF SID ${sid} exceeds String INDEX`)
  return custom
}

export function parseCharset(reader: BinaryReader, offset: number, numGlyphs: number): number[] {
  if (!Number.isInteger(numGlyphs) || numGlyphs < 1) throw new Error('CFF charset requires at least the .notdef glyph')
  if (offset === 0) {
    // ISOAdobe charset (predefined)
    if (numGlyphs > 229) throw new Error('CFF ISOAdobe charset contains at most 229 glyphs')
    const charset: number[] = [0]
    for (let i = 1; i < numGlyphs; i++) charset.push(i)
    return charset
  }
  if (offset === 1) {
    // Expert charset (predefined)
    const expertSids = [
      0, 1, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 13, 14, 15, 99,
      239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 27, 28, 249, 250, 251,
      252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266,
      109, 110, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279,
      280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294,
      295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309,
      310, 311, 312, 313, 314, 315, 316, 317, 318, 158, 155, 163, 319, 320, 321,
      322, 323, 324, 325, 326, 150, 164, 169, 327, 328, 329, 330, 331, 332, 333,
      334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348,
      349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363,
      364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378,
    ]
    if (numGlyphs > expertSids.length) throw new Error(`CFF Expert charset contains at most ${expertSids.length} glyphs`)
    const charset: number[] = []
    for (let i = 0; i < numGlyphs; i++) {
      charset.push(expertSids[i]!)
    }
    return charset
  }
  if (offset === 2) {
    // ExpertSubset charset (predefined)
    const expertSubsetSids = [
      0, 1, 231, 232, 235, 236, 237, 238, 13, 14, 15, 99, 239, 240, 241, 242,
      243, 244, 245, 246, 247, 248, 27, 28, 249, 250, 251, 253, 254, 255, 256,
      257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 109, 110, 267, 268, 269,
      270, 272, 300, 301, 302, 305, 314, 315, 158, 155, 163, 320, 321, 322, 323,
      324, 325, 326, 150, 164, 169, 327, 328, 329, 330, 331, 332, 333, 334, 335,
      336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346,
    ]
    if (numGlyphs > expertSubsetSids.length) throw new Error(`CFF Expert Subset charset contains at most ${expertSubsetSids.length} glyphs`)
    const charset: number[] = []
    for (let i = 0; i < numGlyphs; i++) {
      charset.push(expertSubsetSids[i]!)
    }
    return charset
  }

  reader.seek(offset)
  const format = reader.readUint8()
  const charset: number[] = [0] // .notdef is always GID 0 → SID 0

  if (format === 0) {
    for (let i = 1; i < numGlyphs; i++) {
      charset.push(reader.readUint16())
    }
  } else if (format === 1) {
    let i = 1
    while (i < numGlyphs) {
      const first = reader.readUint16()
      const nLeft = reader.readUint8()
      if (i + nLeft >= numGlyphs) throw new Error('CFF charset format 1 range exceeds glyph count')
      for (let j = 0; j <= nLeft && i < numGlyphs; j++, i++) {
        charset.push(first + j)
      }
    }
  } else if (format === 2) {
    let i = 1
    while (i < numGlyphs) {
      const first = reader.readUint16()
      const nLeft = reader.readUint16()
      if (i + nLeft >= numGlyphs) throw new Error('CFF charset format 2 range exceeds glyph count')
      for (let j = 0; j <= nLeft && i < numGlyphs; j++, i++) {
        charset.push(first + j)
      }
    }
  } else throw new Error(`Unsupported CFF charset format: ${format}`)

  if (new Set(charset).size !== charset.length) throw new Error('CFF charset SIDs/CIDs must be unique')

  return charset
}

/**
 * Resolves a Standard Encoding code to a GID via the charset
 * (Type 2 endchar accent composition selects glyphs by Standard Encoding)
 */
function seacCodeToGid(cff: CffData, code: number): number {
  if (code < 0 || code > 255) {
    throw new Error(`CFF seac: character code ${code} out of Standard Encoding range`)
  }
  const sid = STANDARD_ENCODING[code]!
  const gid = cff.charset.indexOf(sid)
  if (gid < 0) {
    throw new Error(`CFF seac: glyph for Standard Encoding code ${code} (SID ${sid}) not found in charset`)
  }
  return gid
}

/**
 * Composes base + accent outlines for a 4-argument endchar
 * (Type 2 charstring spec, Appendix C)
 */
function applySeac(cff: CffData, seac: CffSeac, width: number): { outline: GlyphOutline; width: number } {
  const baseGid = seacCodeToGid(cff, seac.bchar)
  const accentGid = seacCodeToGid(cff, seac.achar)
  const base = parseCffGlyph(cff, baseGid)
  const accent = parseCffGlyph(cff, accentGid)

  const baseCommands = base.outline.commands
  const accentCommands = accent.outline.commands
  const commands = new Uint8Array(baseCommands.length + accentCommands.length)
  commands.set(baseCommands, 0)
  commands.set(accentCommands, baseCommands.length)

  const baseCoords = base.outline.coords
  const accentCoords = accent.outline.coords
  const coords = new Float32Array(baseCoords.length + accentCoords.length)
  coords.set(baseCoords, 0)
  // The accent is drawn translated by (adx, ady) relative to the base origin
  for (let i = 0; i < accentCoords.length; i += 2) {
    coords[baseCoords.length + i] = accentCoords[i]! + seac.adx
    coords[baseCoords.length + i + 1] = accentCoords[i + 1]! + seac.ady
  }

  return { outline: { commands, coords }, width }
}

/**
 * Parses a CFF glyph outline
 */
export function parseCffGlyph(cff: CffData, glyphId: number): { outline: GlyphOutline; width: number } {
  if (glyphId < 0 || glyphId >= cff.charstrings.count) {
    return { outline: EMPTY_OUTLINE, width: cff.defaultWidthX }
  }

  const charstring = getIndexEntry(cff.charstrings, glyphId)

  // CIDFont: look up the FD via FDSelect and use the per-FD localSubrs/width
  let result: { outline: GlyphOutline; width: number; seac: CffSeac | null }
  if (cff.isCIDFont && cff.fdSelect && cff.fdArray) {
    const fdIndex = cff.fdSelect[glyphId]!
    const fd = cff.fdArray[fdIndex]!
    result = interpretCharstring(
      charstring,
      cff.globalSubrs,
      fd.localSubrs,
      cff.globalBias,
      fd.localBias,
      fd.defaultWidthX,
      fd.nominalWidthX,
    )
  } else {
    result = interpretCharstring(
      charstring,
      cff.globalSubrs,
      cff.localSubrs,
      cff.globalBias,
      cff.localBias,
      cff.defaultWidthX,
      cff.nominalWidthX,
    )
  }

  if (result.seac) {
    return applySeac(cff, result.seac, result.width)
  }
  return { outline: result.outline, width: result.width }
}

/**
 * Parses a CFF glyph outline together with hint data
 */
export function parseCffGlyphWithHints(cff: CffData, glyphId: number): {
  outline: GlyphOutline
  width: number
  hints: CffCharstringHints
  privateDictEntries: Map<number, number[]>
} {
  if (glyphId < 0 || glyphId >= cff.charstrings.count) {
    return {
      outline: EMPTY_OUTLINE,
      width: cff.defaultWidthX,
      hints: { hStems: [], vStems: [], hintMasks: [], counterMasks: [] },
      privateDictEntries: cff.privateDictEntries,
    }
  }

  const charstring = getIndexEntry(cff.charstrings, glyphId)

  if (cff.isCIDFont && cff.fdSelect && cff.fdArray) {
    const fdIndex = cff.fdSelect[glyphId]!
    const fd = cff.fdArray[fdIndex]!
    const result = interpretCharstring(
      charstring,
      cff.globalSubrs,
      fd.localSubrs,
      cff.globalBias,
      fd.localBias,
      fd.defaultWidthX,
      fd.nominalWidthX,
      true,
    )
    // seac composition (the hints stay those declared by the composite
    // charstring itself; base/accent hints belong to their own charstrings)
    const outline = result.seac ? applySeac(cff, result.seac, result.width).outline : result.outline
    return {
      outline,
      width: result.width,
      hints: result.hints!,
      privateDictEntries: fd.privateDictEntries,
    }
  }

  const result = interpretCharstring(
    charstring,
    cff.globalSubrs,
    cff.localSubrs,
    cff.globalBias,
    cff.localBias,
    cff.defaultWidthX,
    cff.nominalWidthX,
    true,
  )
  const outline = result.seac ? applySeac(cff, result.seac, result.width).outline : result.outline
  return {
    outline,
    width: result.width,
    hints: result.hints!,
    privateDictEntries: cff.privateDictEntries,
  }
}
