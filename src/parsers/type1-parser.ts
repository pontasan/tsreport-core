/**
 * Adobe Type 1 font program parser (Adobe Type 1 Font Format specification).
 *
 * Handles the PDF /FontFile payload: a cleartext PostScript header followed by
 * an eexec-encrypted private portion (binary or ASCII-hex) holding /Subrs and
 * /CharStrings. Charstrings are decrypted (r=4330, lenIV skip) and interpreted
 * into cubic outlines — Type 1 charstrings are natively cubic, so no curve
 * conversion is needed. Flex is resolved through OtherSubrs 0-2 and seac
 * composes accented glyphs via StandardEncoding codes.
 */

import { PATH_COMMAND_COORDS, PathCommand } from '../types/glyph.js'
import type { GlyphOutline } from '../types/index.js'
import { applyCffHints, type CffHintParams, type StemHint } from '../hinting/cff-hinter.js'

// ─── Types ───

export interface Type1Font {
  /** Built-in /Encoding: code → glyph name ('.notdef' when unmapped). */
  encoding: string[]
  /** /FontMatrix (defaults to [0.001, 0, 0, 0.001, 0, 0]). */
  fontMatrix: number[]
  /** All glyph names defined in /CharStrings. */
  glyphNames: string[]
  /** Charstring-derived cubic outline in font units; null for unknown names. */
  getOutline(glyphName: string): GlyphOutline | null
  /** hsbw/sbw advance width in font units; null for unknown names. */
  getAdvanceWidth(glyphName: string): number | null
  /** Decoded Type 1 hint program for inspection and raster consumers. */
  getHintProgram(glyphName: string): Type1HintProgram | null
  /** Applies the embedded Type 1 stem/blue-zone hints at a target ppem. */
  getHintedOutline(glyphName: string, ppem: number): GlyphOutline | null
}

export interface Type1HintProgram {
  hStems: StemHint[]
  vStems: StemHint[]
  segments: Type1HintSegment[]
  dotSectionUsed: boolean
  hintReplacementUsed: boolean
}

export interface Type1HintSegment {
  startCommand: number
  endCommand: number
  hStems: StemHint[]
  vStems: StemHint[]
  enabled: boolean
}

// ─── eexec / charstring decryption ───

const EEXEC_R = 55665
const CHARSTRING_R = 4330
const C1 = 52845
const C2 = 22719

function decrypt(data: Uint8Array, r: number, skip: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, data.length - skip))
  let key = r
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!
    const p = c ^ (key >> 8)
    key = ((c + key) * C1 + C2) & 0xFFFF
    if (i >= skip) out[i - skip] = p & 0xFF
  }
  return out
}

function decodeCharstring(data: Uint8Array, lenIV: number): Uint8Array {
  if (lenIV === -1) return new Uint8Array(data)
  if (lenIV < -1) throw new Error(`Type1 parse error: invalid /lenIV ${lenIV}`)
  return decrypt(data, CHARSTRING_R, lenIV)
}

// ─── Program text scanning ───

const enum Ch {
  Space = 32, Tab = 9, LF = 10, CR = 13, FF = 12,
}

function isWhitespace(c: number): boolean {
  return c === Ch.Space || c === Ch.Tab || c === Ch.LF || c === Ch.CR || c === Ch.FF || c === 0
}

function isHexDigit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

/** Strips PFB segment headers (0x80 0x01/0x02 + length) when present. */
function stripPfb(data: Uint8Array): Uint8Array {
  if (data.length < 6 || data[0] !== 0x80) return data
  const parts: Uint8Array[] = []
  let pos = 0
  while (pos + 6 <= data.length && data[pos] === 0x80) {
    const kind = data[pos + 1]!
    if (kind === 0x03) break // EOF segment
    const len = data[pos + 2]! | (data[pos + 3]! << 8) | (data[pos + 4]! << 16) | (data[pos + 5]! << 24)
    parts.push(data.subarray(pos + 6, pos + 6 + len))
    pos += 6 + len
  }
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ─── Charstring interpreter ───

interface CharstringEntry {
  data: Uint8Array
}

interface InterpContext {
  charstrings: Map<string, CharstringEntry>
  subrs: Uint8Array[]
  standardEncoding: string[]
  outlineCache: Map<string, GlyphOutline>
  widths: Map<string, number>
  hintCache: Map<string, Type1HintProgram>
  hintParams: CffHintParams
  unitsPerEm: number
}

interface InterpState {
  commands: number[]
  coords: number[]
  x: number
  y: number
  open: boolean
  sbx: number
  width: number
  /** PostScript operand stack shared with othersubr flex handling. */
  psStack: number[]
  flexPoints: number[]
  inFlex: boolean
  seac: { asb: number, adx: number, ady: number, bchar: number, achar: number } | null
  activeStems: Array<{ direction: 'horizontal' | 'vertical', pos: number, width: number }>
  declaredStems: Array<{ direction: 'horizontal' | 'vertical', pos: number, width: number }>
  hintStates: Array<{
    commandIndex: number
    stems: Array<{ direction: 'horizontal' | 'vertical', pos: number, width: number }>
    enabled: boolean
  }>
  dotSection: boolean
  dotSectionUsed: boolean
  hintReplacementUsed: boolean
  replaceHintsOnNextSubr: boolean
}

function recordHintState(st: InterpState): void {
  const state = {
    commandIndex: st.commands.length,
    stems: st.activeStems.map(stem => ({ ...stem })),
    enabled: !st.dotSection,
  }
  const last = st.hintStates[st.hintStates.length - 1]
  if (last?.commandIndex === state.commandIndex) st.hintStates[st.hintStates.length - 1] = state
  else st.hintStates.push(state)
}

function addStem(
  st: InterpState,
  direction: 'horizontal' | 'vertical',
  pos: number,
  width: number,
): void {
  const stem = { direction, pos, width }
  st.activeStems.push(stem)
  st.declaredStems.push(stem)
  recordHintState(st)
}

function closeIfOpen(st: InterpState): void {
  if (st.open) {
    st.commands.push(PathCommand.Close)
    st.open = false
  }
}

function requireOperands(stack: number[], count: number, operator: string): void {
  if (stack.length !== count) {
    throw new Error(`Type1 parse error: ${operator} requires ${count} operands, got ${stack.length}`)
  }
}

function takeOperands(stack: number[], count: number, operator: string): number[] {
  requireOperands(stack, count, operator)
  const operands = stack.slice()
  stack.length = 0
  return operands
}

function pushOperand(stack: number[], value: number): void {
  if (stack.length >= 24) throw new Error('Type1 parse error: charstring operand stack exceeds 24 entries')
  stack.push(value)
}

function runCharstring(
  data: Uint8Array,
  ctx: InterpContext,
  st: InterpState,
  stack: number[],
  depth: number,
): 'return' | 'endchar' | 'seac' | 'eof' {
  if (depth > 10) throw new Error('Type1 parse error: subr call depth exceeds 10')
  let i = 0
  while (i < data.length) {
    const v = data[i]!
    if (v >= 32) {
      // Number encodings
      if (v <= 246) { pushOperand(stack, v - 139); i += 1 }
      else if (v <= 250) {
        if (i + 1 >= data.length) throw new Error('Type1 parse error: truncated positive number')
        pushOperand(stack, (v - 247) * 256 + data[i + 1]! + 108)
        i += 2
      }
      else if (v <= 254) {
        if (i + 1 >= data.length) throw new Error('Type1 parse error: truncated negative number')
        pushOperand(stack, -(v - 251) * 256 - data[i + 1]! - 108)
        i += 2
      }
      else {
        if (i + 4 >= data.length) throw new Error('Type1 parse error: truncated 32-bit number')
        const n = (data[i + 1]! << 24) | (data[i + 2]! << 16) | (data[i + 3]! << 8) | data[i + 4]!
        pushOperand(stack, n | 0)
        i += 5
      }
      continue
    }
    i += 1
    switch (v) {
      case 13: { // hsbw: sbx wx
        const [sbx, width] = takeOperands(stack, 2, 'hsbw')
        st.sbx = sbx!
        st.width = width!
        st.x = st.sbx
        st.y = 0
        break
      }
      case 9: // closepath
        requireOperands(stack, 0, 'closepath')
        closeIfOpen(st)
        break
      case 1: case 3: { // hstem / vstem
        const [edge, width] = takeOperands(stack, 2, v === 1 ? 'hstem' : 'vstem')
        addStem(st, v === 1 ? 'horizontal' : 'vertical', edge!, width!)
        break
      }
      case 21: { // rmoveto
        const [dx, dy] = takeOperands(stack, 2, 'rmoveto')
        if (st.inFlex) {
          st.x += dx!
          st.y += dy!
          st.flexPoints.push(st.x, st.y)
        } else {
          closeIfOpen(st)
          st.x += dx!
          st.y += dy!
          st.commands.push(PathCommand.MoveTo)
          st.coords.push(st.x, st.y)
          st.open = true
        }
        break
      }
      case 22: { // hmoveto
        const [dx] = takeOperands(stack, 1, 'hmoveto')
        closeIfOpen(st)
        st.x += dx!
        st.commands.push(PathCommand.MoveTo)
        st.coords.push(st.x, st.y)
        st.open = true
        break
      }
      case 4: { // vmoveto
        const [dy] = takeOperands(stack, 1, 'vmoveto')
        closeIfOpen(st)
        st.y += dy!
        st.commands.push(PathCommand.MoveTo)
        st.coords.push(st.x, st.y)
        st.open = true
        break
      }
      case 5: { // rlineto
        const [dx, dy] = takeOperands(stack, 2, 'rlineto')
        st.x += dx!
        st.y += dy!
        st.commands.push(PathCommand.LineTo)
        st.coords.push(st.x, st.y)
        break
      }
      case 6: { // hlineto
        const [dx] = takeOperands(stack, 1, 'hlineto')
        st.x += dx!
        st.commands.push(PathCommand.LineTo)
        st.coords.push(st.x, st.y)
        break
      }
      case 7: { // vlineto
        const [dy] = takeOperands(stack, 1, 'vlineto')
        st.y += dy!
        st.commands.push(PathCommand.LineTo)
        st.coords.push(st.x, st.y)
        break
      }
      case 8: { // rrcurveto
        const [dx1, dy1, dx2, dy2, dx3, dy3] = takeOperands(stack, 6, 'rrcurveto')
        const x1 = st.x + dx1!, y1 = st.y + dy1!
        const x2 = x1 + dx2!, y2 = y1 + dy2!
        st.x = x2 + dx3!
        st.y = y2 + dy3!
        st.commands.push(PathCommand.CubicTo)
        st.coords.push(x1, y1, x2, y2, st.x, st.y)
        break
      }
      case 30: { // vhcurveto: dy1 dx2 dy2 dx3
        const [dy1, dx2, dy2, dx3] = takeOperands(stack, 4, 'vhcurveto')
        const x1 = st.x, y1 = st.y + dy1!
        const x2 = x1 + dx2!, y2 = y1 + dy2!
        st.x = x2 + dx3!
        st.y = y2
        st.commands.push(PathCommand.CubicTo)
        st.coords.push(x1, y1, x2, y2, st.x, st.y)
        break
      }
      case 31: { // hvcurveto: dx1 dx2 dy2 dy3
        const [dx1, dx2, dy2, dy3] = takeOperands(stack, 4, 'hvcurveto')
        const x1 = st.x + dx1!, y1 = st.y
        const x2 = x1 + dx2!, y2 = y1 + dy2!
        st.x = x2
        st.y = y2 + dy3!
        st.commands.push(PathCommand.CubicTo)
        st.coords.push(x1, y1, x2, y2, st.x, st.y)
        break
      }
      case 10: { // callsubr
        const idx = stack.pop()
        if (idx === undefined || idx < 0 || idx >= ctx.subrs.length) {
          throw new Error(`Type1 parse error: callsubr index ${String(idx)} out of range`)
        }
        if (st.replaceHintsOnNextSubr) {
          st.activeStems.length = 0
          st.replaceHintsOnNextSubr = false
          recordHintState(st)
        }
        const completion = runCharstring(ctx.subrs[idx]!, ctx, st, stack, depth + 1)
        if (completion === 'endchar' || completion === 'seac') return completion
        break
      }
      case 11: // return
        if (depth === 0) throw new Error('Type1 parse error: return outside subroutine')
        return 'return'
      case 14: // endchar
        requireOperands(stack, 0, 'endchar')
        if (st.inFlex) throw new Error('Type1 parse error: endchar encountered during flex')
        if (st.replaceHintsOnNextSubr) throw new Error('Type1 parse error: hint replacement has no following callsubr')
        closeIfOpen(st)
        return 'endchar'
      case 12: { // escape
        if (i >= data.length) throw new Error('Type1 parse error: truncated escape operator')
        const op2 = data[i]!
        i += 1
        switch (op2) {
          case 12: { // div
            if (stack.length < 2) throw new Error(`Type1 parse error: div requires 2 operands, got ${stack.length}`)
            const b = stack.pop()!
            const a = stack.pop()!
            if (b === 0) throw new Error('Type1 parse error: division by zero')
            pushOperand(stack, a / b)
            break
          }
          case 6: { // seac: asb adx ady bchar achar
            const [asb, adx, ady, bchar, achar] = takeOperands(stack, 5, 'seac')
            st.seac = {
              asb: asb!, adx: adx!, ady: ady!, bchar: bchar!, achar: achar!,
            }
            return 'seac'
          }
          case 7: { // sbw: sbx sby wx wy
            const [sbx, sby, wx] = takeOperands(stack, 4, 'sbw')
            st.sbx = sbx!
            st.width = wx!
            st.x = st.sbx
            st.y = sby!
            break
          }
          case 1: case 2: { // vstem3 / hstem3
            const values = takeOperands(stack, 6, op2 === 1 ? 'vstem3' : 'hstem3')
            for (let k = 0; k < values.length; k += 2) {
              addStem(st, op2 === 1 ? 'vertical' : 'horizontal', values[k]!, values[k + 1]!)
            }
            break
          }
          case 16: { // callothersubr
            if (stack.length < 2) throw new Error(`Type1 parse error: callothersubr requires at least 2 operands, got ${stack.length}`)
            const othersubr = stack.pop()!
            const n = stack.pop()!
            if (!Number.isInteger(n) || n < 0 || n > stack.length) {
              throw new Error(`Type1 parse error: invalid callothersubr argument count ${n}`)
            }
            const args: number[] = []
            for (let k = 0; k < n; k++) args.unshift(stack.pop()!)
            if (othersubr === 1) {
              if (args.length !== 0) throw new Error(`Type1 parse error: flex-start OtherSubr requires 0 arguments, got ${args.length}`)
              if (st.inFlex) throw new Error('Type1 parse error: nested flex start')
              st.inFlex = true
              st.flexPoints.length = 0
            } else if (othersubr === 2) {
              if (args.length !== 0) throw new Error(`Type1 parse error: flex-point OtherSubr requires 0 arguments, got ${args.length}`)
              if (!st.inFlex || st.flexPoints.length === 0) throw new Error('Type1 parse error: flex point outside flex')
            } else if (othersubr === 0) {
              if (args.length !== 3) throw new Error(`Type1 parse error: flex-end OtherSubr requires 3 arguments, got ${args.length}`)
              if (!st.inFlex) throw new Error('Type1 parse error: flex end outside flex')
              st.inFlex = false
              const p = st.flexPoints
              if (p.length !== 14) throw new Error(`Type1 parse error: flex expected 7 points, got ${p.length / 2}`)
              st.commands.push(PathCommand.CubicTo)
              st.coords.push(p[2]!, p[3]!, p[4]!, p[5]!, p[6]!, p[7]!)
              st.commands.push(PathCommand.CubicTo)
              st.coords.push(p[8]!, p[9]!, p[10]!, p[11]!, p[12]!, p[13]!)
              st.x = p[12]!
              st.y = p[13]!
              // The flex OtherSubr returns the absolute final point to the two
              // following pop operators; setcurrentpoint consumes it.
              st.psStack.push(args[2]!, args[1]!)
            } else if (othersubr === 3) {
              if (args.length !== 1) throw new Error(`Type1 parse error: hint-replacement OtherSubr requires 1 argument, got ${args.length}`)
              st.hintReplacementUsed = true
              st.replaceHintsOnNextSubr = true
              st.psStack.push(args[0]!)
            } else {
              // Unknown OtherSubrs entry: arguments transfer to the PS stack.
              for (let k = args.length - 1; k >= 0; k--) st.psStack.push(args[k]!)
            }
            break
          }
          case 17: { // pop
            const value = st.psStack.pop()
            if (value === undefined) throw new Error('Type1 parse error: pop from empty PostScript stack')
            pushOperand(stack, value)
            break
          }
          case 33: { // setcurrentpoint
            const [x, y] = takeOperands(stack, 2, 'setcurrentpoint')
            st.x = x!
            st.y = y!
            break
          }
          case 0: // dotsection
            requireOperands(stack, 0, 'dotsection')
            st.dotSection = !st.dotSection
            st.dotSectionUsed = true
            recordHintState(st)
            break
          default:
            throw new Error(`Type1 parse error: unsupported escape operator 12 ${op2}`)
        }
        break
      }
      default:
        throw new Error(`Type1 parse error: unsupported charstring operator ${v}`)
    }
  }
  return 'eof'
}

function buildOutline(glyphName: string, ctx: InterpContext, depth: number): { outline: GlyphOutline, width: number, hints: Type1HintProgram } {
  const entry = ctx.charstrings.get(glyphName)
  if (entry === undefined) throw new Error(`Type1 parse error: charstring /${glyphName} not found`)
  const st: InterpState = {
    commands: [], coords: [], x: 0, y: 0, open: false, sbx: 0, width: 0,
    psStack: [], flexPoints: [], inFlex: false, seac: null, activeStems: [], declaredStems: [],
    hintStates: [], dotSection: false, dotSectionUsed: false, hintReplacementUsed: false,
    replaceHintsOnNextSubr: false,
  }
  recordHintState(st)
  const stack: number[] = []
  const completion = runCharstring(entry.data, ctx, st, stack, depth)
  if (completion === 'eof') throw new Error(`Type1 parse error: charstring /${glyphName} has no endchar or seac`)
  if (st.seac !== null) {
    // Accented composite: base + accent placed by StandardEncoding codes.
    const baseName = ctx.standardEncoding[st.seac.bchar] ?? '.notdef'
    const accentName = ctx.standardEncoding[st.seac.achar] ?? '.notdef'
    const base = buildOutline(baseName, ctx, depth + 1)
    const accent = buildOutline(accentName, ctx, depth + 1)
    const dx = st.sbx - st.seac.asb + st.seac.adx
    const dy = st.seac.ady
    const commands = new Uint8Array(base.outline.commands.length + accent.outline.commands.length)
    commands.set(base.outline.commands, 0)
    commands.set(accent.outline.commands, base.outline.commands.length)
    const coords = new Float32Array(base.outline.coords.length + accent.outline.coords.length)
    coords.set(base.outline.coords, 0)
    for (let k = 0; k < accent.outline.coords.length; k += 2) {
      coords[base.outline.coords.length + k] = accent.outline.coords[k]! + dx
      coords[base.outline.coords.length + k + 1] = accent.outline.coords[k + 1]! + dy
    }
    return {
      outline: { commands, coords },
      width: st.width,
      hints: compositeHintProgram(hintProgram(st), base.hints, accent.hints, dx, dy, base.outline.commands.length),
    }
  }
  return {
    outline: { commands: new Uint8Array(st.commands), coords: new Float32Array(st.coords) },
    width: st.width,
    hints: hintProgram(st),
  }
}

function compositeHintProgram(
  local: Type1HintProgram,
  base: Type1HintProgram,
  accent: Type1HintProgram,
  dx: number,
  dy: number,
  accentCommandOffset: number,
): Type1HintProgram {
  const accentHStems = accent.hStems.map(stem => ({ pos: stem.pos + dy, width: stem.width }))
  const accentVStems = accent.vStems.map(stem => ({ pos: stem.pos + dx, width: stem.width }))
  const segments = base.segments.map(segment => ({
    ...segment,
    hStems: segment.hStems.map(stem => ({ ...stem })),
    vStems: segment.vStems.map(stem => ({ ...stem })),
  }))
  for (let i = 0; i < accent.segments.length; i++) {
    const segment = accent.segments[i]!
    segments.push({
      startCommand: segment.startCommand + accentCommandOffset,
      endCommand: segment.endCommand + accentCommandOffset,
      hStems: segment.hStems.map(stem => ({ pos: stem.pos + dy, width: stem.width })),
      vStems: segment.vStems.map(stem => ({ pos: stem.pos + dx, width: stem.width })),
      enabled: segment.enabled,
    })
  }
  return {
    hStems: [...local.hStems.map(stem => ({ ...stem })), ...base.hStems.map(stem => ({ ...stem })), ...accentHStems],
    vStems: [...local.vStems.map(stem => ({ ...stem })), ...base.vStems.map(stem => ({ ...stem })), ...accentVStems],
    segments,
    dotSectionUsed: local.dotSectionUsed || base.dotSectionUsed || accent.dotSectionUsed,
    hintReplacementUsed: local.hintReplacementUsed || base.hintReplacementUsed || accent.hintReplacementUsed,
  }
}

function hintProgram(st: InterpState): Type1HintProgram {
  const hStems: StemHint[] = []
  const vStems: StemHint[] = []
  for (let i = 0; i < st.declaredStems.length; i++) {
    const stem = st.declaredStems[i]!
    ;(stem.direction === 'horizontal' ? hStems : vStems).push({ pos: stem.pos, width: stem.width })
  }
  const segments: Type1HintSegment[] = []
  for (let i = 0; i < st.hintStates.length; i++) {
    const state = st.hintStates[i]!
    const endCommand = st.hintStates[i + 1]?.commandIndex ?? st.commands.length
    if (state.commandIndex >= endCommand) continue
    const segmentHStems: StemHint[] = []
    const segmentVStems: StemHint[] = []
    for (let k = 0; k < state.stems.length; k++) {
      const stem = state.stems[k]!
      ;(stem.direction === 'horizontal' ? segmentHStems : segmentVStems).push({ pos: stem.pos, width: stem.width })
    }
    segments.push({
      startCommand: state.commandIndex,
      endCommand,
      hStems: segmentHStems,
      vStems: segmentVStems,
      enabled: state.enabled,
    })
  }
  return { hStems, vStems, segments, dotSectionUsed: st.dotSectionUsed, hintReplacementUsed: st.hintReplacementUsed }
}

function applyType1HintProgram(
  outline: GlyphOutline,
  program: Type1HintProgram,
  params: CffHintParams,
  ppem: number,
  unitsPerEm: number,
): GlyphOutline {
  const commandCoordOffsets = new Uint32Array(outline.commands.length + 1)
  let coordOffset = 0
  for (let i = 0; i < outline.commands.length; i++) {
    commandCoordOffsets[i] = coordOffset
    coordOffset += PATH_COMMAND_COORDS[outline.commands[i] as PathCommand]
  }
  commandCoordOffsets[outline.commands.length] = coordOffset

  const coords = new Float32Array(outline.coords)
  for (let i = 0; i < program.segments.length; i++) {
    const segment = program.segments[i]!
    if (!segment.enabled || segment.startCommand === segment.endCommand) continue
    const startCoord = commandCoordOffsets[segment.startCommand]!
    const endCoord = commandCoordOffsets[segment.endCommand]!
    const segmentOutline: GlyphOutline = {
      commands: outline.commands.slice(segment.startCommand, segment.endCommand),
      coords: outline.coords.slice(startCoord, endCoord),
    }
    const hinted = applyCffHints(segmentOutline, {
      hStems: segment.hStems,
      vStems: segment.vStems,
      hintMasks: [],
      counterMasks: [],
    }, params, ppem, unitsPerEm)
    coords.set(hinted.coords, startCoord)
  }
  return { commands: outline.commands, coords }
}

// ─── Font program parsing ───

function findToken(text: string, token: string, from: number): number {
  return text.indexOf(token, from)
}

/** Reads `count` binary bytes after the RD/-| token that follows position `pos`. */
function readBinary(bytes: Uint8Array, text: string, pos: number, count: number): { data: Uint8Array, next: number } {
  // The RD token is followed by exactly one space, then the binary bytes.
  let p = pos
  while (p < text.length && text[p] !== ' ') p++
  p += 1
  return { data: bytes.subarray(p, p + count), next: p + count }
}

function parseNumberBefore(text: string, pos: number): number {
  // Walks back over "<count> RD" style tokens: returns the integer preceding pos.
  const slice = text.substring(Math.max(0, pos - 32), pos)
  const m = /(\d+)\s*$/.exec(slice)
  if (m === null) throw new Error('Type1 parse error: expected a length before RD token')
  return parseInt(m[1]!, 10)
}

function parseType1HintParams(privateProgram: string): CffHintParams {
  function array(name: string): number[] {
    const match = new RegExp(`/${name}\\s*\\[([^\\]]*)\\]`).exec(privateProgram)
    if (match === null) return []
    const source = match[1]!.trim()
    if (source === '') return []
    const values = source.split(/\s+/).map(Number)
    if (values.some(value => !Number.isFinite(value))) throw new Error(`Type1 parse error: /${name} must contain numbers`)
    return values
  }
  function scalar(name: string, fallback: number): number {
    const match = new RegExp(`/${name}\\s+([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?)`).exec(privateProgram)
    if (match === null) return fallback
    const value = Number(match[1])
    if (!Number.isFinite(value)) throw new Error(`Type1 parse error: /${name} must be a finite number`)
    return value
  }
  function boolean(name: string, fallback: boolean): boolean {
    const match = new RegExp(`/${name}\\s+(true|false)\\b`).exec(privateProgram)
    return match === null ? fallback : match[1] === 'true'
  }
  return {
    blueValues: array('BlueValues'),
    otherBlues: array('OtherBlues'),
    familyBlues: array('FamilyBlues'),
    familyOtherBlues: array('FamilyOtherBlues'),
    blueScale: scalar('BlueScale', 0.039625),
    blueShift: scalar('BlueShift', 7),
    blueFuzz: scalar('BlueFuzz', 1),
    stdHW: array('StdHW')[0] ?? 0,
    stdVW: array('StdVW')[0] ?? 0,
    stemSnapH: array('StemSnapH'),
    stemSnapV: array('StemSnapV'),
    forceBold: boolean('ForceBold', false),
    languageGroup: scalar('LanguageGroup', 0),
  }
}

/**
 * @param standardGlyphNames Adobe StandardEncoding code → glyph name table,
 *        used for the built-in "/Encoding StandardEncoding def" form and for
 *        seac accent composition (both defined against StandardEncoding).
 */
export function parseType1(input: Uint8Array, standardGlyphNames: string[]): Type1Font {
  const data = stripPfb(input)
  const text = latin1(data, 0, data.length)
  const eexecAt = text.indexOf('eexec')
  if (eexecAt < 0) throw new Error('Type1 parse error: eexec section not found')

  // ── Cleartext: /FontMatrix and /Encoding ──
  const clear = text.substring(0, eexecAt)
  let fontMatrix = [0.001, 0, 0, 0.001, 0, 0]
  const fmAt = clear.indexOf('/FontMatrix')
  if (fmAt >= 0) {
    const open = clear.indexOf('[', fmAt)
    const close = clear.indexOf(']', open)
    if (open < 0 || close < 0) throw new Error('Type1 parse error: malformed /FontMatrix')
    const parts = clear.substring(open + 1, close).trim().split(/\s+/).map(Number)
    if (parts.length !== 6 || parts.some(Number.isNaN)) throw new Error('Type1 parse error: /FontMatrix must hold six numbers')
    fontMatrix = parts
  }
  const encoding = new Array<string>(256).fill('.notdef')
  const encAt = clear.indexOf('/Encoding')
  if (encAt >= 0) {
    if (/\/Encoding\s+StandardEncoding\b/.test(clear.substring(encAt, encAt + 40))) {
      for (let i = 0; i < 256; i++) encoding[i] = standardGlyphNames[i] ?? '.notdef'
    } else {
      const defRe = /dup\s+(\d+)\s*\/([^\s/]+)\s+put/g
      defRe.lastIndex = encAt
      let m: RegExpExecArray | null
      const end = clear.indexOf('readonly def', encAt)
      while ((m = defRe.exec(clear)) !== null) {
        if (end >= 0 && m.index > end) break
        const code = parseInt(m[1]!, 10)
        if (code >= 0 && code < 256) encoding[code] = m[2]!
      }
    }
  }

  // ── eexec-encrypted portion (binary or ASCII-hex) ──
  let encStart = eexecAt + 5
  while (encStart < data.length && isWhitespace(data[encStart]!)) encStart++
  // Hex form: the first four bytes are all hex digits per the spec's test.
  let encrypted: Uint8Array
  if (isHexDigit(data[encStart]!) && isHexDigit(data[encStart + 1]!) && isHexDigit(data[encStart + 2]!) && isHexDigit(data[encStart + 3]!)) {
    const hex: number[] = []
    for (let i = encStart; i < data.length; i++) {
      const c = data[i]!
      if (isWhitespace(c)) continue
      if (!isHexDigit(c)) break
      hex.push(c)
    }
    const bytes = new Uint8Array(hex.length >> 1)
    for (let k = 0; k + 1 < hex.length; k += 2) {
      bytes[k >> 1] = parseInt(String.fromCharCode(hex[k]!, hex[k + 1]!), 16)
    }
    encrypted = bytes
  } else {
    encrypted = data.subarray(encStart)
  }
  const priv = decrypt(encrypted, EEXEC_R, 4)
  const privText = latin1(priv, 0, priv.length)

  // ── /lenIV ──
  let lenIV = 4
  const lenIVMatch = /\/lenIV\s+([+-]?\d+)/.exec(privText)
  if (lenIVMatch !== null) lenIV = parseInt(lenIVMatch[1]!, 10)
  if (lenIV < -1) throw new Error(`Type1 parse error: invalid /lenIV ${lenIV}`)

  // ── /Subrs ──
  const subrs: Uint8Array[] = []
  const subrsAt = findToken(privText, '/Subrs', 0)
  if (subrsAt >= 0) {
    const dupRe = /dup\s+(\d+)\s+(\d+)\s+(RD|-\|)[ ]/g
    dupRe.lastIndex = subrsAt
    let m: RegExpExecArray | null
    const charstringsAt0 = findToken(privText, '/CharStrings', 0)
    while ((m = dupRe.exec(privText)) !== null) {
      if (charstringsAt0 >= 0 && m.index > charstringsAt0) break
      const idx = parseInt(m[1]!, 10)
      const len = parseInt(m[2]!, 10)
      const start = m.index + m[0].length
      subrs[idx] = decodeCharstring(priv.subarray(start, start + len), lenIV)
      dupRe.lastIndex = start + len
    }
  }

  // ── /CharStrings ──
  const charstrings = new Map<string, CharstringEntry>()
  const charstringsAt = findToken(privText, '/CharStrings', 0)
  if (charstringsAt < 0) throw new Error('Type1 parse error: /CharStrings not found')
  const csRe = /\/([^\s/{}()[\]]+)\s+(\d+)\s+(RD|-\|)[ ]/g
  csRe.lastIndex = charstringsAt
  let cm: RegExpExecArray | null
  while ((cm = csRe.exec(privText)) !== null) {
    const name = cm[1]!
    const len = parseInt(cm[2]!, 10)
    const start = cm.index + cm[0].length
    charstrings.set(name, { data: decodeCharstring(priv.subarray(start, start + len), lenIV) })
    csRe.lastIndex = start + len
  }
  if (charstrings.size === 0) throw new Error('Type1 parse error: /CharStrings holds no glyphs')

  const ctx: InterpContext = {
    charstrings,
    subrs,
    standardEncoding: standardGlyphNames,
    outlineCache: new Map(),
    widths: new Map(),
    hintCache: new Map(),
    hintParams: parseType1HintParams(privText),
    unitsPerEm: 1 / Math.max(Number.EPSILON, Math.hypot(fontMatrix[0]!, fontMatrix[1]!)),
  }

  function ensureGlyph(glyphName: string): { outline: GlyphOutline, width: number, hints: Type1HintProgram } | null {
    if (!charstrings.has(glyphName)) return null
    let outline = ctx.outlineCache.get(glyphName)
    let width = ctx.widths.get(glyphName)
    let hints = ctx.hintCache.get(glyphName)
    if (outline === undefined || width === undefined || hints === undefined) {
      const built = buildOutline(glyphName, ctx, 0)
      outline = built.outline
      width = built.width
      hints = built.hints
      ctx.outlineCache.set(glyphName, outline)
      ctx.widths.set(glyphName, width)
      ctx.hintCache.set(glyphName, hints)
    }
    return { outline, width, hints }
  }

  const font: Type1Font = {
    encoding,
    fontMatrix,
    glyphNames: [...charstrings.keys()],
    getOutline(glyphName: string): GlyphOutline | null {
      return ensureGlyph(glyphName)?.outline ?? null
    },
    getAdvanceWidth(glyphName: string): number | null {
      return ensureGlyph(glyphName)?.width ?? null
    },
    getHintProgram(glyphName: string): Type1HintProgram | null {
      const hints = ensureGlyph(glyphName)?.hints
      if (hints === undefined) return null
      return {
        hStems: hints.hStems.map(stem => ({ ...stem })),
        vStems: hints.vStems.map(stem => ({ ...stem })),
        segments: hints.segments.map(segment => ({
          ...segment,
          hStems: segment.hStems.map(stem => ({ ...stem })),
          vStems: segment.vStems.map(stem => ({ ...stem })),
        })),
        dotSectionUsed: hints.dotSectionUsed,
        hintReplacementUsed: hints.hintReplacementUsed,
      }
    },
    getHintedOutline(glyphName: string, ppem: number): GlyphOutline | null {
      if (!Number.isFinite(ppem) || ppem <= 0) throw new RangeError('Type1 hinting ppem must be a positive finite number')
      const glyph = ensureGlyph(glyphName)
      if (glyph === null) return null
      return applyType1HintProgram(glyph.outline, glyph.hints, ctx.hintParams, ppem, ctx.unitsPerEm)
    },
  }
  return font
}
