/**
 * TrueType Bytecode Interpreter
 * Complete implementation of ~200 opcodes based on the OpenType specification
 */

import { GraphicsState, RoundState } from './graphics-state.js'
import type { Vec2, Zone, ZonePoint } from './graphics-state.js'
import type { CvtTable } from '../parsers/tables/cvt.js'

// ── Opcode definitions ──

// Push
const NPUSHB = 0x40
const NPUSHW = 0x41
const PUSHB_BASE = 0xB0 // 0xB0..0xB7 → push n+1 bytes
const PUSHW_BASE = 0xB8 // 0xB8..0xBF → push n+1 words

// Stack manipulation
const DUP = 0x20
const POP = 0x21
const CLEAR = 0x22
const SWAP = 0x23
const DEPTH = 0x24
const CINDEX = 0x25
const MINDEX = 0x26
const ROLL = 0x8A

// Arithmetic
const ADD = 0x60
const SUB = 0x61
const DIV = 0x62
const MUL = 0x63
const ABS = 0x64
const NEG = 0x65
const FLOOR = 0x66
const CEILING = 0x67
const MAX = 0x8B
const MIN = 0x8C

// Comparison
const LT = 0x50
const LTEQ = 0x51
const GT = 0x52
const GTEQ = 0x53
const EQ = 0x54
const NEQ = 0x55

// Logical
const AND = 0x5A
const OR = 0x5B
const NOT = 0x5C
const ODD = 0x56
const EVEN = 0x57

// Control flow
const IF = 0x58
const EIF = 0x59
const ELSE = 0x1B
const JMPR = 0x1C
const JROT = 0x78
const JROF = 0x79
const FDEF = 0x2C
const ENDF = 0x2D
const CALL = 0x2B
const LOOPCALL = 0x2A
const IDEF = 0x89

// CVT & storage
const RCVT = 0x45
const WCVTP = 0x44
const WCVTF = 0x70
const RS = 0x43
const WS = 0x42
const GC_0 = 0x46
const GC_1 = 0x47
const SCFS = 0x48

// Graphics state setters
const SRP0 = 0x10
const SRP1 = 0x11
const SRP2 = 0x12
const SZP0 = 0x13
const SZP1 = 0x14
const SZP2 = 0x15
const SZPS = 0x16
const SLOOP = 0x17
const SMD = 0x1A
const INSTCTRL = 0x8E
const SCANCTRL = 0x85
const SCANTYPE = 0x8D

// Round state
const RTG = 0x18
const RTHG = 0x19
const RTDG = 0x3D
const RDTG = 0x7D
const RUTG = 0x7C
const ROFF = 0x7A
const SROUND = 0x76
const S45ROUND = 0x77

// Vector setting
const SVTCA_Y = 0x00
const SVTCA_X = 0x01
const SPVTCA_Y = 0x02
const SPVTCA_X = 0x03
const SFVTCA_Y = 0x04
const SFVTCA_X = 0x05
const SPVTL_0 = 0x06
const SPVTL_1 = 0x07
const SFVTL_0 = 0x08
const SFVTL_1 = 0x09
const SPVFS = 0x0A
const SFVFS = 0x0B
const GPV = 0x0C
const GFV = 0x0D
const SDPVTL_0 = 0x86
const SDPVTL_1 = 0x87
const ISECT = 0x0F

// Measurement
const MD_0 = 0x49
const MD_1 = 0x4A
const MPPEM = 0x4B
const MPS = 0x4C

// Point movement
const MDAP_0 = 0x2E
const MDAP_1 = 0x2F
const MIAP_0 = 0x3E
const MIAP_1 = 0x3F
const MDRP_BASE = 0xC0 // 0xC0..0xDF
const MIRP_BASE = 0xE0 // 0xE0..0xFF
const SHP_0 = 0x32
const SHP_1 = 0x33
const SHC_0 = 0x34
const SHC_1 = 0x35
const SHZ_0 = 0x36
const SHZ_1 = 0x37
const SHPIX = 0x38
const IP = 0x39
const MSIRP_0 = 0x3A
const MSIRP_1 = 0x3B
const ALIGNRP = 0x3C
const IUP_Y = 0x30
const IUP_X = 0x31
const ALIGNPTS = 0x27
const UTP = 0x29
const FLIPON = 0x4D
const FLIPOFF = 0x4E
const FLIPPT = 0x80
const FLIPRGON = 0x81
const FLIPRGOFF = 0x82

// Delta
const DELTAP1 = 0x5D
const DELTAP2 = 0x71
const DELTAP3 = 0x72
const DELTAC1 = 0x73
const DELTAC2 = 0x74
const DELTAC3 = 0x75

// Misc
const DEBUG = 0x4F
const GETINFO = 0x88
const GETVARIATION = 0x91
const SANGW = 0x7E

/** True for every opcode assigned by the OpenType 1.9.1 TrueType instruction set. */
export function isDefinedTrueTypeOpcode(opcode: number): boolean {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 0xFF) return false
  if (opcode <= 0x0D) return true
  if (opcode >= 0x0F && opcode <= 0x27) return true
  if (opcode >= 0x29 && opcode <= 0x7A) return true
  if (opcode === 0x7C || opcode === 0x7D || opcode === SANGW) return true
  if (opcode >= 0x80 && opcode <= 0x82) return true
  if (opcode >= 0x85 && opcode <= 0x8E) return true
  if (opcode === GETVARIATION) return true
  return opcode >= PUSHB_BASE
}

// ── Interpreter ──

/** Interpreter options */
export interface InterpreterOptions {
  ppem: number
  /** Current point size in points; defaults to ppem at 72 dpi. */
  pointSize?: number
  /** Horizontal pixels per em; defaults to ppem for isotropic scaling. */
  horizontalPpem?: number
  /** maxp.maxTwilightPoints */
  maxTwilightPoints: number
  /** maxp.maxStorage */
  maxStorage: number
  /** maxp.maxFunctionDefs */
  maxFunctionDefs: number
  /** maxp.maxInstructionDefs */
  maxInstructionDefs: number
  /** maxp.maxStackElements */
  maxStackElements: number
  /** CVT table (empty if absent; values are copied and scaled to F26Dot6) */
  cvt?: CvtTable | null
  /** Per-entry CVT deltas in font units (cvar table, variable fonts) */
  cvtDeltas?: number[] | null
  /** fpgm bytecode */
  fpgm?: Uint8Array | null
  /** prep bytecode */
  prep?: Uint8Array | null
  /** Scaler units per EM */
  unitsPerEm?: number
  /** Normalized fvar coordinates in axis order */
  normalizedCoords?: readonly number[] | null
  /** True when the current device transform rotates the glyph. */
  rotated?: boolean
  /** True when the current device transform stretches the glyph. */
  stretched?: boolean
  /** Rasterizer capabilities reported by GETINFO. */
  getInfo?: Readonly<{
    grayscale?: boolean
    clearType?: boolean
    compatibleWidths?: boolean
    verticalLcd?: boolean
    bgr?: boolean
    subpixelPositioned?: boolean
    symmetricRendering?: boolean
    clearTypeGray?: boolean
  }>
  /** Enables the v40 subpixel backward-compatibility movement restrictions. */
  backwardCompatibility?: boolean
}

export function multiplyFixed(value: number, fixed: number): number {
  const product = value * fixed
  return product < 0
    ? -Math.floor((-product + 0x8000) / 0x10000)
    : Math.floor((product + 0x8000) / 0x10000)
}

export function divideToFixed(numerator: number, denominator: number): number {
  const negative = (numerator < 0) !== (denominator < 0)
  const quotient = Math.floor((Math.abs(numerator) * 0x10000 + Math.abs(denominator) / 2) / Math.abs(denominator))
  return negative ? -quotient : quotient
}

function multiplyDivide(first: number, second: number, divisor: number): number {
  const negative = (first < 0) !== (second < 0) !== (divisor < 0)
  const absoluteDivisor = Math.abs(divisor)
  const quotient = Math.floor((Math.abs(first) * Math.abs(second) + Math.floor(absoluteDivisor / 2)) / absoluteDivisor)
  return negative ? -quotient : quotient
}

export class TrueTypeInterpreter {
  readonly gs = new GraphicsState()
  private readonly stack: number[] = []
  private readonly storage: number[]
  private readonly functions = new Map<number, { bytecode: Uint8Array, start: number, end: number }>()
  private readonly instructionDefs = new Map<number, { bytecode: Uint8Array, start: number, end: number }>()
  /**
   * Working copy of the CVT scaled to F26Dot6 pixel values (with cvar
   * deltas applied). RCVT/WCVTP operate on these pixel values directly;
   * WCVTF converts from font units — the FreeType scaled-CVT model.
   */
  private readonly cvtValues: Float64Array
  private zones: Zone[] = [
    { points: [] }, // twilight zone (0)
    { points: [] }, // glyph zone (1)
  ]
  /** Contour end point indices of the current glyph zone (IUP/SHC) */
  private glyphContourEnds: Uint16Array | number[] | null = null
  readonly ppem: number
  private readonly unitsPerEm: number
  private readonly scaleFixed: number // dominant 16.16 scale used for CVT distances
  private readonly xScaleFixed: number
  private readonly yScaleFixed: number
  private readonly maxFunctionDefs: number
  private readonly maxInstructionDefs: number
  private readonly maxStackElements: number
  private readonly normalizedCoords: readonly number[] | null
  private readonly pointSize: number
  private readonly rotated: boolean
  private readonly stretched: boolean
  private readonly getInfo: Required<NonNullable<InterpreterOptions['getInfo']>>
  /** instructControl value established by prep (persists across gs.reset) */
  private prepInstructControl = 0
  private readonly prepGraphicsState: GraphicsState
  private glyphProgramActive = false
  private backwardCompatibility: boolean
  private readonly initialBackwardCompatibility: boolean
  private iupXCalled = false
  private iupYCalled = false
  private callDepth = 0
  private static readonly MAX_CALL_DEPTH = 100
  private static readonly MAX_INSTRUCTIONS = 1_000_000

  constructor(options: InterpreterOptions) {
    this.ppem = options.ppem
    this.pointSize = options.pointSize ?? options.ppem
    this.unitsPerEm = options.unitsPerEm ?? 1000
    this.xScaleFixed = divideToFixed((options.horizontalPpem ?? options.ppem) * 64, this.unitsPerEm)
    this.yScaleFixed = divideToFixed(options.ppem * 64, this.unitsPerEm)
    this.scaleFixed = Math.max(this.xScaleFixed, this.yScaleFixed)
    this.maxFunctionDefs = options.maxFunctionDefs
    this.maxInstructionDefs = options.maxInstructionDefs
    this.maxStackElements = options.maxStackElements
    this.normalizedCoords = options.normalizedCoords ?? null
    this.rotated = options.rotated ?? false
    this.stretched = options.stretched ?? false
    const getInfo = options.getInfo
    this.getInfo = {
      grayscale: getInfo?.grayscale ?? true,
      clearType: getInfo?.clearType ?? true,
      compatibleWidths: getInfo?.compatibleWidths ?? false,
      verticalLcd: getInfo?.verticalLcd ?? false,
      bgr: getInfo?.bgr ?? false,
      subpixelPositioned: getInfo?.subpixelPositioned ?? true,
      symmetricRendering: getInfo?.symmetricRendering ?? true,
      clearTypeGray: getInfo?.clearTypeGray ?? false,
    }
    this.initialBackwardCompatibility = options.backwardCompatibility ?? false
    this.backwardCompatibility = this.initialBackwardCompatibility
    this.storage = new Array(options.maxStorage).fill(0)

    // Copy the CVT scaled to F26Dot6 pixels, applying cvar deltas
    const cvt = options.cvt ?? null
    const cvtDeltas = options.cvtDeltas ?? null
    const cvtLength = cvt ? cvt.length : 0
    this.cvtValues = new Float64Array(cvtLength)
    for (let i = 0; i < cvtLength; i++) {
      const delta = cvtDeltas ? (cvtDeltas[i] ?? 0) : 0
      this.cvtValues[i] = multiplyFixed(cvt!.get(i) + delta, this.scaleFixed)
    }

    // Allocate twilight zone points
    const twilightPoints: ZonePoint[] = new Array(options.maxTwilightPoints)
    for (let i = 0; i < twilightPoints.length; i++) {
      twilightPoints[i] = { x: 0, y: 0, origX: 0, origY: 0, orusX: 0, orusY: 0, touchedX: false, touchedY: false, onCurve: true }
    }
    this.zones[0]!.points = twilightPoints

    // Execute fpgm (font program) — defines functions
    if (options.fpgm && options.fpgm.length > 0) {
      this.execute(options.fpgm)
    }

    // Execute prep (CVT program) — adjusts CVT for current ppem
    if (options.prep && options.prep.length > 0) {
      this.stack.length = 0
      this.gs.reset()
      this.execute(options.prep)
    }

    // INSTCTRL is only executable in prep and persists for glyph programs
    this.prepInstructControl = this.gs.instructControl
    this.prepGraphicsState = new GraphicsState()
    this.prepGraphicsState.copyFrom(this.gs)
  }

  /** Whether prep inhibited glyph instruction execution (INSTCTRL selector 1) */
  get instructionsInhibited(): boolean {
    return (this.prepInstructControl & 1) !== 0
  }

  /**
   * Set the glyph outline points
   * @param points Zone points (scaled to F26Dot6, including the 4 phantom points)
   * @param contourEnds Contour end point indices (enables contour-exact IUP/SHC)
   */
  setGlyphZone(points: ZonePoint[], contourEnds?: Uint16Array | number[] | null): void {
    this.zones[1] = { points }
    this.glyphContourEnds = contourEnds ?? null
  }

  /** Execute the glyph program */
  executeGlyphProgram(bytecode: Uint8Array): void {
    this.stack.length = 0
    this.gs.copyFrom(this.prepGraphicsState)
    this.gs.zp0 = 1
    this.gs.zp1 = 1
    this.gs.zp2 = 1
    this.gs.projectionVector = { x: 1, y: 0 }
    this.gs.freedomVector = { x: 1, y: 0 }
    this.gs.dualProjectionVector = { x: 1, y: 0 }
    this.gs.roundState = RoundState.TO_GRID
    this.gs.loop = 1
    this.callDepth = 0
    this.backwardCompatibility = this.initialBackwardCompatibility
    this.iupXCalled = false
    this.iupYCalled = false
    this.glyphProgramActive = true
    try {
      this.execute(bytecode)
    } finally {
      this.glyphProgramActive = false
    }
  }

  /** Read a scaled CVT entry (F26Dot6 pixels) */
  private readCvt(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.cvtValues.length) {
      throw new Error(`TrueType hinting: CVT index ${index} is out of range`)
    }
    return this.cvtValues[index]!
  }

  /** Write a scaled CVT entry (F26Dot6 pixels) */
  private writeCvt(index: number, value: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cvtValues.length) {
      throw new Error(`TrueType hinting: CVT index ${index} is out of range`)
    }
    this.cvtValues[index] = value
  }

  /** Execute bytecode */
  execute(bytecode: Uint8Array): void {
    let ip = 0
    let instructionCount = 0

    while (ip < bytecode.length) {
      this.assertStackLimit()
      if (++instructionCount > TrueTypeInterpreter.MAX_INSTRUCTIONS) {
        throw new Error('TrueType hinting: max instruction count exceeded')
      }

      const opcode = bytecode[ip]!
      ip++

      // PUSHB[n]
      if (opcode >= PUSHB_BASE && opcode <= PUSHB_BASE + 7) {
        const n = opcode - PUSHB_BASE + 1
        this.assertInstructionBytes(bytecode, ip, n, opcode)
        for (let i = 0; i < n; i++) {
          this.stack.push(bytecode[ip++]!)
        }
        continue
      }

      // PUSHW[n]
      if (opcode >= PUSHW_BASE && opcode <= PUSHW_BASE + 7) {
        const n = opcode - PUSHW_BASE + 1
        this.assertInstructionBytes(bytecode, ip, n * 2, opcode)
        for (let i = 0; i < n; i++) {
          const hi = bytecode[ip++]!
          const lo = bytecode[ip++]!
          let val = (hi << 8) | lo
          if (val >= 0x8000) val -= 0x10000
          this.stack.push(val)
        }
        continue
      }

      // MDRP[abcde]
      if (opcode >= MDRP_BASE && opcode < MIRP_BASE) {
        this.opMDRP(opcode)
        continue
      }

      // MIRP[abcde]
      if (opcode >= MIRP_BASE) {
        this.opMIRP(opcode)
        continue
      }

      switch (opcode) {
        // ── Push ──
        case NPUSHB: {
          this.assertInstructionBytes(bytecode, ip, 1, opcode)
          const n = bytecode[ip++]!
          this.assertInstructionBytes(bytecode, ip, n, opcode)
          for (let i = 0; i < n; i++) {
            this.stack.push(bytecode[ip++]!)
          }
          break
        }
        case NPUSHW: {
          this.assertInstructionBytes(bytecode, ip, 1, opcode)
          const n = bytecode[ip++]!
          this.assertInstructionBytes(bytecode, ip, n * 2, opcode)
          for (let i = 0; i < n; i++) {
            const hi = bytecode[ip++]!
            const lo = bytecode[ip++]!
            let val = (hi << 8) | lo
            if (val >= 0x8000) val -= 0x10000
            this.stack.push(val)
          }
          break
        }

        // ── Stack manipulation ──
        case DUP: {
          const val = this.peek()
          this.stack.push(val)
          break
        }
        case POP:
          this.pop()
          break
        case CLEAR:
          this.stack.length = 0
          break
        case SWAP: {
          const a = this.pop()
          const b = this.pop()
          this.stack.push(a, b)
          break
        }
        case DEPTH:
          this.stack.push(this.stack.length)
          break
        case CINDEX: {
          const k = this.pop()
          if (k < 1 || k > this.stack.length) throw new Error(`CINDEX: invalid index ${k}`)
          this.stack.push(this.stack[this.stack.length - k]!)
          break
        }
        case MINDEX: {
          const k = this.pop()
          if (k < 1 || k > this.stack.length) throw new Error(`MINDEX: invalid index ${k}`)
          const idx = this.stack.length - k
          const val = this.stack[idx]!
          this.stack.splice(idx, 1)
          this.stack.push(val)
          break
        }
        case ROLL: {
          const a = this.pop()
          const b = this.pop()
          const c = this.pop()
          this.stack.push(b, a, c)
          break
        }

        // ── Arithmetic ──
        case ADD: {
          const n2 = this.pop()
          const n1 = this.pop()
          this.stack.push(n1 + n2)
          break
        }
        case SUB: {
          const n2 = this.pop()
          const n1 = this.pop()
          this.stack.push(n1 - n2)
          break
        }
        case MUL: {
          const n2 = this.pop()
          const n1 = this.pop()
          this.stack.push(Math.round((n1 * n2) / 64))
          break
        }
        case DIV: {
          const n2 = this.pop()
          const n1 = this.pop()
          if (n2 === 0) throw new Error('DIV: division by zero')
          this.stack.push(Math.trunc((n1 * 64) / n2))
          break
        }
        case ABS:
          this.stack.push(Math.abs(this.pop()))
          break
        case NEG:
          this.stack.push(-this.pop())
          break
        case FLOOR:
          this.stack.push(Math.floor(this.pop() / 64) * 64)
          break
        case CEILING:
          this.stack.push(Math.ceil(this.pop() / 64) * 64)
          break
        case MAX: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(Math.max(e1, e2))
          break
        }
        case MIN: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(Math.min(e1, e2))
          break
        }

        // ── Comparison ──
        case LT: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(e1 < e2 ? 1 : 0)
          break
        }
        case LTEQ: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(e1 <= e2 ? 1 : 0)
          break
        }
        case GT: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(e1 > e2 ? 1 : 0)
          break
        }
        case GTEQ: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(e1 >= e2 ? 1 : 0)
          break
        }
        case EQ: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(e1 === e2 ? 1 : 0)
          break
        }
        case NEQ: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push(e1 !== e2 ? 1 : 0)
          break
        }

        // ── Logical ──
        case AND: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push((e1 !== 0 && e2 !== 0) ? 1 : 0)
          break
        }
        case OR: {
          const e2 = this.pop()
          const e1 = this.pop()
          this.stack.push((e1 !== 0 || e2 !== 0) ? 1 : 0)
          break
        }
        case NOT:
          this.stack.push(this.pop() === 0 ? 1 : 0)
          break
        case ODD: {
          const val = this.roundValue(this.pop())
          this.stack.push(((val >> 6) & 1) === 1 ? 1 : 0)
          break
        }
        case EVEN: {
          const val = this.roundValue(this.pop())
          this.stack.push(((val >> 6) & 1) === 0 ? 1 : 0)
          break
        }

        // ── Control flow ──
        case IF: {
          const cond = this.pop()
          if (cond === 0) {
            ip = this.skipToElseOrEif(bytecode, ip)
          }
          break
        }
        case ELSE: {
          // Skip to matching EIF
          ip = this.skipToEif(bytecode, ip)
          break
        }
        case EIF:
          // No-op (end of IF block)
          break
        case JMPR: {
          const offset = this.pop()
          ip += offset - 1
          break
        }
        case JROT: {
          const cond = this.pop()
          const offset = this.pop()
          if (cond !== 0) ip += offset - 1
          break
        }
        case JROF: {
          const cond = this.pop()
          const offset = this.pop()
          if (cond === 0) ip += offset - 1
          break
        }
        case FDEF: {
          const funcId = this.pop()
          if (funcId < 0 || funcId >= this.maxFunctionDefs) {
            throw new Error(`TrueType hinting: function ${funcId} exceeds maxp.maxFunctionDefs ${this.maxFunctionDefs}`)
          }
          const start = ip
          // Skip to ENDF
          let depth = 1
          while (ip < bytecode.length && depth > 0) {
            const op = bytecode[ip]!
            ip++
            if (op === FDEF) depth++
            else if (op === ENDF) depth--
            else ip = this.skipPushData(bytecode, ip, op)
          }
          this.functions.set(funcId, { bytecode, start, end: ip - 1 })
          break
        }
        case ENDF:
          // Return from function/instruction — handled by execute call
          return
        case CALL: {
          const funcId = this.pop()
          this.callFunction(funcId)
          break
        }
        case LOOPCALL: {
          const funcId = this.pop()
          const count = this.pop()
          for (let i = 0; i < count; i++) {
            this.callFunction(funcId)
          }
          break
        }
        case IDEF: {
          const opId = this.pop()
          if (!Number.isInteger(opId) || opId < 0 || opId > 0xFF) {
            throw new Error(`TrueType hinting: IDEF opcode ${opId} is outside byte range`)
          }
          const alreadyDefined = isDefinedTrueTypeOpcode(opId)
          if (!alreadyDefined && !this.instructionDefs.has(opId) && this.instructionDefs.size >= this.maxInstructionDefs) {
            throw new Error(`TrueType hinting: instruction definitions exceed maxp.maxInstructionDefs ${this.maxInstructionDefs}`)
          }
          const start = ip
          let depth = 1
          while (ip < bytecode.length && depth > 0) {
            const op = bytecode[ip]!
            ip++
            if (op === FDEF || op === IDEF) depth++
            else if (op === ENDF) depth--
            else ip = this.skipPushData(bytecode, ip, op)
          }
          if (!alreadyDefined) this.instructionDefs.set(opId, { bytecode, start, end: ip - 1 })
          break
        }

        // ── CVT & Storage ──
        case RCVT: {
          const idx = this.pop()
          this.stack.push(this.readCvt(idx))
          break
        }
        case WCVTP: {
          const val = this.pop()
          const idx = this.pop()
          this.writeCvt(idx, val)
          break
        }
        case WCVTF: {
          const val = this.pop()
          const idx = this.pop()
          this.writeCvt(idx, multiplyFixed(val, this.scaleFixed))
          break
        }
        case RS: {
          const idx = this.pop()
          this.assertStorageIndex(idx)
          this.stack.push(this.storage[idx]!)
          break
        }
        case WS: {
          const val = this.pop()
          const idx = this.pop()
          this.assertStorageIndex(idx)
          this.storage[idx] = val
          break
        }
        case GC_0:
        case GC_1: {
          const ptIdx = this.pop()
          const zone = this.getZone(this.gs.zp2)
          const pt = this.pointAt(zone, ptIdx, 'GC')
          const coord = opcode === GC_0
            ? this.projectPoint(pt.x, pt.y)
            : this.dualProjectPoint(pt.origX, pt.origY)
          this.stack.push(coord)
          break
        }
        case SCFS: {
          const value = this.pop()
          const ptIdx = this.pop()
          const zone = this.getZone(this.gs.zp2)
          const pt = this.pointAt(zone, ptIdx, 'SCFS')
          this.movePointAlongFreedom(pt, value - this.projectPoint(pt.x, pt.y))
          this.markTouched(pt)
          break
        }

        // ── Graphics state setters ──
        case SRP0: this.gs.rp0 = this.pop(); break
        case SRP1: this.gs.rp1 = this.pop(); break
        case SRP2: this.gs.rp2 = this.pop(); break
        case SZP0: this.gs.zp0 = this.popZoneIndex('SZP0'); break
        case SZP1: this.gs.zp1 = this.popZoneIndex('SZP1'); break
        case SZP2: this.gs.zp2 = this.popZoneIndex('SZP2'); break
        case SZPS: {
          const z = this.popZoneIndex('SZPS')
          this.gs.zp0 = z
          this.gs.zp1 = z
          this.gs.zp2 = z
          break
        }
        case SLOOP:
          this.gs.loop = this.pop()
          if (!Number.isInteger(this.gs.loop) || this.gs.loop <= 0) {
            throw new Error(`TrueType hinting: SLOOP value ${this.gs.loop} must be a positive integer`)
          }
          break
        case SMD:
          this.gs.minimumDistance = this.pop()
          break
        case INSTCTRL: {
          const selector = this.pop()
          const value = this.pop()
          if (selector === 1) {
            this.gs.instructControl = (this.gs.instructControl & ~1) | (value & 1)
          } else if (selector === 2) {
            this.gs.instructControl = (this.gs.instructControl & ~2) | (value & 2)
          } else if (selector === 3 && this.glyphProgramActive) {
            this.backwardCompatibility = value !== 4
          }
          break
        }
        case SCANCTRL:
          this.gs.scanControl = this.pop()
          break
        case SCANTYPE:
          this.gs.scanType = this.pop()
          break

        // ── Round state ──
        case RTG:
          this.gs.roundState = RoundState.TO_GRID
          break
        case RTHG:
          this.gs.roundState = RoundState.TO_HALF_GRID
          break
        case RTDG:
          this.gs.roundState = RoundState.TO_DOUBLE_GRID
          break
        case RDTG:
          this.gs.roundState = RoundState.DOWN_TO_GRID
          break
        case RUTG:
          this.gs.roundState = RoundState.UP_TO_GRID
          break
        case ROFF:
          this.gs.roundState = RoundState.OFF
          break
        case SROUND: {
          const n = this.pop()
          this.gs.roundState = RoundState.SUPER
          this.decodeSuperRound(n, 1)
          break
        }
        case S45ROUND: {
          const n = this.pop()
          this.gs.roundState = RoundState.SUPER_45
          this.decodeSuperRound(n, Math.SQRT2 / 2)
          break
        }

        // ── Vector setting ──
        case SVTCA_Y:
          this.gs.projectionVector = { x: 0, y: 1 }
          this.gs.dualProjectionVector = { x: 0, y: 1 }
          this.gs.freedomVector = { x: 0, y: 1 }
          break
        case SVTCA_X:
          this.gs.projectionVector = { x: 1, y: 0 }
          this.gs.dualProjectionVector = { x: 1, y: 0 }
          this.gs.freedomVector = { x: 1, y: 0 }
          break
        case SPVTCA_Y:
          this.gs.projectionVector = { x: 0, y: 1 }
          this.gs.dualProjectionVector = { x: 0, y: 1 }
          break
        case SPVTCA_X:
          this.gs.projectionVector = { x: 1, y: 0 }
          this.gs.dualProjectionVector = { x: 1, y: 0 }
          break
        case SFVTCA_Y:
          this.gs.freedomVector = { x: 0, y: 1 }
          break
        case SFVTCA_X:
          this.gs.freedomVector = { x: 1, y: 0 }
          break
        case SPVTL_0:
        case SPVTL_1: {
          const p2 = this.pop()
          const p1 = this.pop()
          this.gs.projectionVector = this.computeLineVector(p1, p2, opcode === SPVTL_1, false)
          this.gs.dualProjectionVector = { ...this.gs.projectionVector }
          break
        }
        case SFVTL_0:
        case SFVTL_1: {
          const p2 = this.pop()
          const p1 = this.pop()
          this.gs.freedomVector = this.computeLineVector(p1, p2, opcode === SFVTL_1, false)
          break
        }
        case SDPVTL_0:
        case SDPVTL_1: {
          const p2 = this.pop()
          const p1 = this.pop()
          this.gs.projectionVector = this.computeLineVector(p1, p2, opcode === SDPVTL_1, false)
          this.gs.dualProjectionVector = this.computeLineVector(p1, p2, opcode === SDPVTL_1, true)
          break
        }
        case SPVFS: {
          const y = this.pop()
          const x = this.pop()
          this.gs.projectionVector = this.normalizeVector(x, y)
          this.gs.dualProjectionVector = { ...this.gs.projectionVector }
          break
        }
        case SFVFS: {
          const y = this.pop()
          const x = this.pop()
          this.gs.freedomVector = this.normalizeVector(x, y)
          break
        }
        case GPV:
          this.stack.push(Math.round(this.gs.projectionVector.x * 16384))
          this.stack.push(Math.round(this.gs.projectionVector.y * 16384))
          break
        case GFV:
          this.stack.push(Math.round(this.gs.freedomVector.x * 16384))
          this.stack.push(Math.round(this.gs.freedomVector.y * 16384))
          break
        case ISECT: {
          const b1 = this.pop()
          const b0 = this.pop()
          const a1 = this.pop()
          const a0 = this.pop()
          const ptIdx = this.pop()
          this.computeIntersection(ptIdx, a0, a1, b0, b1)
          break
        }

        // ── Measurement ──
        case MD_0:
        case MD_1: {
          const p2 = this.pop()
          const p1 = this.pop()
          this.stack.push(this.measureDistance(p1, p2, opcode === MD_0))
          break
        }
        case MPPEM:
          this.stack.push(this.ppem)
          break
        case MPS:
          this.stack.push(Math.round(this.pointSize * 64))
          break

        // ── Point movement ──
        case MDAP_0:
        case MDAP_1: {
          const ptIdx = this.pop()
          this.opMDAP(ptIdx, opcode === MDAP_1)
          break
        }
        case MIAP_0:
        case MIAP_1: {
          const cvtIdx = this.pop()
          const ptIdx = this.pop()
          this.opMIAP(ptIdx, cvtIdx, opcode === MIAP_1)
          break
        }
        case SHP_0:
        case SHP_1:
          this.opSHP(opcode === SHP_1 ? 1 : 0)
          break
        case SHC_0:
        case SHC_1: {
          const contour = this.pop()
          this.opSHC(contour, opcode === SHC_1 ? 1 : 0)
          break
        }
        case SHZ_0:
        case SHZ_1: {
          const zoneIdx = this.pop()
          this.opSHZ(zoneIdx, opcode === SHZ_1 ? 1 : 0)
          break
        }
        case SHPIX: {
          const dist = this.pop()
          const count = this.gs.loop
          this.gs.loop = 1
          for (let i = 0; i < count; i++) {
            const ptIdx = this.pop()
            const zone = this.getZone(this.gs.zp2)
            const pt = this.pointAt(zone, ptIdx, 'SHPIX')
            this.movePointAlongFreedom(pt, dist)
            this.markTouched(pt)
          }
          break
        }
        case IP:
          this.opIP()
          break
        case MSIRP_0:
        case MSIRP_1: {
          const dist = this.pop()
          const ptIdx = this.pop()
          this.opMSIRP(ptIdx, dist, opcode === MSIRP_1)
          break
        }
        case ALIGNRP:
          this.opALIGNRP()
          break
        case IUP_Y:
          this.opIUP(1) // Y axis
          break
        case IUP_X:
          this.opIUP(0) // X axis
          break
        case ALIGNPTS: {
          const p2 = this.pop()
          const p1 = this.pop()
          this.opALIGNPTS(p1, p2)
          break
        }
        case UTP: {
          const ptIdx = this.pop()
          const zone = this.getZone(this.gs.zp0)
          const pt = this.pointAt(zone, ptIdx, 'UTP')
          pt.touchedX = false
          pt.touchedY = false
          break
        }

        // ── Auto flip ──
        case FLIPON:
          this.gs.autoFlip = true
          break
        case FLIPOFF:
          this.gs.autoFlip = false
          break
        case FLIPPT: {
          const count = this.gs.loop
          this.gs.loop = 1
          const zone = this.getZone(this.gs.zp0)
          for (let i = 0; i < count; i++) {
            const pointIndex = this.pop()
            const point = zone.points[pointIndex]
            if (!point) throw new Error(`FLIPPT: point ${pointIndex} is out of range`)
            point.onCurve = !point.onCurve
          }
          break
        }
        case FLIPRGON:
        case FLIPRGOFF: {
          const hi = this.pop()
          const lo = this.pop()
          const zone = this.getZone(this.gs.zp0)
          if (lo < 0 || hi < lo || hi >= zone.points.length) {
            throw new Error(`FLIPRG: point range ${lo}..${hi} is out of range`)
          }
          const onCurve = opcode === FLIPRGON
          for (let pointIndex = lo; pointIndex <= hi; pointIndex++) zone.points[pointIndex]!.onCurve = onCurve
          break
        }

        // ── Delta ──
        case DELTAP1:
        case DELTAP2:
        case DELTAP3:
          this.opDeltaP(opcode)
          break
        case DELTAC1:
        case DELTAC2:
        case DELTAC3:
          this.opDeltaC(opcode)
          break

        // ── Control value cut-in / single width ──
        case 0x1D: // SCVTCI
          this.gs.controlValueCutIn = this.pop()
          break
        case 0x1E: // SSWCI
          this.gs.singleWidthCutIn = this.pop()
          break
        case 0x1F: // SSW (value in FUnits, scaled to pixels)
          this.gs.singleWidthValue = multiplyFixed(this.pop(), this.scaleFixed)
          break
        case SANGW:
          this.gs.angleWeight = this.pop()
          break

        // ── Round / no-round (engine compensation is zero) ──
        case 0x68: case 0x69: case 0x6A: case 0x6B: // ROUND[ab]
          this.stack.push(this.roundValue(this.pop()))
          break
        case 0x6C: case 0x6D: case 0x6E: case 0x6F: // NROUND[ab]
          // Only engine compensation applies, which is zero — value unchanged
          break

        // ── Delta base/shift ──
        case 0x5E: // SDB
          this.gs.deltaBase = this.pop()
          break
        case 0x5F: // SDS
          this.gs.deltaShift = this.pop()
          break

        // ── Misc ──
        case DEBUG:
          this.pop() // debug number — ignored
          break
        case GETINFO: {
          const selector = this.pop()
          let result = 0
          if (selector & 1) result |= 40
          if ((selector & 2) && this.rotated) result |= 0x0100
          if ((selector & 4) && this.stretched) result |= 0x0200
          if ((selector & 8) && this.normalizedCoords !== null) result |= 0x0400
          if ((selector & 32) && this.getInfo.grayscale) result |= 0x1000
          if ((selector & 64) && this.getInfo.clearType) result |= 0x2000
          if ((selector & 128) && this.getInfo.compatibleWidths) result |= 0x4000
          if ((selector & 256) && this.getInfo.verticalLcd) result |= 0x8000
          if ((selector & 512) && this.getInfo.bgr) result |= 0x10000
          if ((selector & 1024) && this.getInfo.subpixelPositioned) result |= 0x20000
          if ((selector & 2048) && this.getInfo.symmetricRendering) result |= 0x40000
          if ((selector & 4096) && this.getInfo.clearTypeGray) result |= 0x80000
          this.stack.push(result)
          break
        }
        case GETVARIATION: {
          const coords = this.normalizedCoords
          if (coords === null) break
          for (let i = 0; i < coords.length; i++) this.stack.push(Math.round(coords[i]! * 16384))
          break
        }

        // ── Unrecognized opcode ──
        default: {
          // Check instruction definitions
          const idef = this.instructionDefs.get(opcode)
          if (idef) {
            this.executeRange(idef.bytecode, idef.start, idef.end)
            break
          }
          throw new Error(`TrueType hinting: undefined opcode 0x${opcode.toString(16).padStart(2, '0')}`)
        }
      }
    }
    this.assertStackLimit()
  }

  // ── Stack helpers ──

  private pop(): number {
    if (this.stack.length === 0) throw new Error('TrueType hinting: stack underflow')
    return this.stack.pop()!
  }

  private assertInstructionBytes(bytecode: Uint8Array, offset: number, length: number, opcode: number): void {
    if (offset + length > bytecode.length) {
      throw new Error(`TrueType hinting: opcode 0x${opcode.toString(16).padStart(2, '0')} instruction data is truncated`)
    }
  }

  private popZoneIndex(instruction: string): number {
    const value = this.pop()
    if (value !== 0 && value !== 1) {
      throw new Error(`TrueType hinting: ${instruction} zone ${value} must be 0 or 1`)
    }
    return value
  }

  private pointAt(zone: Zone, index: number, instruction: string): ZonePoint {
    if (!Number.isInteger(index) || index < 0 || index >= zone.points.length) {
      throw new Error(`TrueType hinting: ${instruction} point ${index} is out of range`)
    }
    return zone.points[index]!
  }

  private peek(): number {
    if (this.stack.length === 0) throw new Error('TrueType hinting: stack underflow')
    return this.stack[this.stack.length - 1]!
  }

  private assertStackLimit(): void {
    if (this.stack.length > this.maxStackElements) {
      throw new Error(`TrueType hinting: stack depth ${this.stack.length} exceeds maxp.maxStackElements ${this.maxStackElements}`)
    }
  }

  private assertStorageIndex(index: number): void {
    if (index < 0 || index >= this.storage.length) {
      throw new Error(`TrueType hinting: storage index ${index} exceeds maxp.maxStorage ${this.storage.length}`)
    }
  }

  /** For tests: get the contents of the stack */
  getStack(): number[] {
    return [...this.stack]
  }

  /** For tests: get the contents of storage */
  getStorage(): number[] {
    return [...this.storage]
  }

  // ── Control flow helpers ──

  private skipToElseOrEif(bytecode: Uint8Array, ip: number): number {
    let depth = 1
    while (ip < bytecode.length && depth > 0) {
      const op = bytecode[ip]!
      ip++
      if (op === IF) {
        depth++
      } else if (op === EIF) {
        depth--
      } else if (op === ELSE && depth === 1) {
        return ip
      } else {
        ip = this.skipPushData(bytecode, ip, op)
      }
    }
    return ip
  }

  private skipToEif(bytecode: Uint8Array, ip: number): number {
    let depth = 1
    while (ip < bytecode.length && depth > 0) {
      const op = bytecode[ip]!
      ip++
      if (op === IF) depth++
      else if (op === EIF) depth--
      else ip = this.skipPushData(bytecode, ip, op)
    }
    return ip
  }

  /** Skip the data portion of push instructions */
  private skipPushData(bytecode: Uint8Array, ip: number, op: number): number {
    if (op === NPUSHB) {
      const n = bytecode[ip]!
      return ip + 1 + n
    }
    if (op === NPUSHW) {
      const n = bytecode[ip]!
      return ip + 1 + n * 2
    }
    if (op >= PUSHB_BASE && op <= PUSHB_BASE + 7) {
      return ip + (op - PUSHB_BASE + 1)
    }
    if (op >= PUSHW_BASE && op <= PUSHW_BASE + 7) {
      return ip + (op - PUSHW_BASE + 1) * 2
    }
    return ip
  }

  private callFunction(funcId: number): void {
    const func = this.functions.get(funcId)
    if (!func) throw new Error(`TrueType hinting: undefined function ${funcId}`)
    if (++this.callDepth > TrueTypeInterpreter.MAX_CALL_DEPTH) {
      throw new Error('TrueType hinting: max call depth exceeded')
    }
    this.executeRange(func.bytecode, func.start, func.end)
    this.callDepth--
  }

  private executeRange(bytecode: Uint8Array, start: number, end: number): void {
    // Create a sub-bytecode view and execute
    const subBytecode = bytecode.subarray(start, end)
    this.execute(subBytecode)
  }

  // ── Rounding ──

  roundValue(value: number): number {
    const sign = value < 0 ? -1 : 1
    const abs = Math.abs(value)

    switch (this.gs.roundState) {
      case RoundState.TO_GRID:
        return sign * (Math.round(abs / 64) * 64)
      case RoundState.TO_HALF_GRID:
        return sign * (Math.floor(abs / 64) * 64 + 32)
      case RoundState.TO_DOUBLE_GRID:
        return sign * (Math.round(abs / 32) * 32)
      case RoundState.DOWN_TO_GRID:
        return sign * (Math.floor(abs / 64) * 64)
      case RoundState.UP_TO_GRID:
        return sign * (Math.ceil(abs / 64) * 64)
      case RoundState.OFF:
        return value
      case RoundState.SUPER:
      case RoundState.SUPER_45:
        return sign * this.superRound(abs)
      default:
        return value
    }
  }

  private decodeSuperRound(n: number, gridPeriod: number): void {
    // Period
    switch ((n >> 6) & 3) {
      case 0: this.gs.superRoundPeriod = Math.round(gridPeriod * 32); break
      case 1: this.gs.superRoundPeriod = Math.round(gridPeriod * 64); break
      case 2: this.gs.superRoundPeriod = Math.round(gridPeriod * 128); break
      default: this.gs.superRoundPeriod = Math.round(gridPeriod * 64); break
    }
    // Phase
    switch ((n >> 4) & 3) {
      case 0: this.gs.superRoundPhase = 0; break
      case 1: this.gs.superRoundPhase = this.gs.superRoundPeriod >> 2; break
      case 2: this.gs.superRoundPhase = this.gs.superRoundPeriod >> 1; break
      case 3: this.gs.superRoundPhase = (this.gs.superRoundPeriod * 3) >> 2; break
    }
    // Threshold
    const t = n & 0xF
    if (t === 0) {
      this.gs.superRoundThreshold = this.gs.superRoundPeriod - 1
    } else {
      this.gs.superRoundThreshold = ((t - 4) * this.gs.superRoundPeriod) >> 3
    }
  }

  private superRound(value: number): number {
    const period = this.gs.superRoundPeriod
    const phase = this.gs.superRoundPhase
    const threshold = this.gs.superRoundThreshold

    if (value < 0) return 0
    const valMinusPhase = value - phase
    const rounded = valMinusPhase >= 0
      ? phase + Math.floor((valMinusPhase + threshold) / period) * period
      : phase - Math.ceil((-valMinusPhase - threshold) / period) * period
    return Math.max(rounded, 0)
  }

  // ── Vector/projection helpers ──

  private projectPoint(x: number, y: number): number {
    const pv = this.gs.projectionVector
    return Math.round(x * pv.x + y * pv.y)
  }

  private dualProjectPoint(x: number, y: number): number {
    const vector = this.gs.dualProjectionVector
    return Math.round(x * vector.x + y * vector.y)
  }

  private originalScaledDistance(point: ZonePoint, reference: ZonePoint, twilight: boolean): number {
    if (twilight) {
      return this.dualProjectPoint(point.origX - reference.origX, point.origY - reference.origY)
    }
    return this.dualProjectPoint(
      multiplyFixed(point.orusX - reference.orusX, this.xScaleFixed),
      multiplyFixed(point.orusY - reference.orusY, this.yScaleFixed),
    )
  }

  private movePointAlongFreedom(pt: ZonePoint, distance: number): void {
    const fv = this.gs.freedomVector
    const pv = this.gs.projectionVector
    const dot = fv.x * pv.x + fv.y * pv.y
    if (Math.abs(dot) < 0.001) return
    const factor = distance / dot
    if (!this.backwardCompatibility) pt.x += Math.round(fv.x * factor)
    if (!(this.backwardCompatibility && this.iupXCalled && this.iupYCalled)) {
      pt.y += Math.round(fv.y * factor)
    }
  }

  private markTouched(pt: ZonePoint): void {
    if (this.gs.freedomVector.x !== 0) pt.touchedX = true
    if (this.gs.freedomVector.y !== 0) pt.touchedY = true
  }

  private normalizeVector(x: number, y: number): Vec2 {
    const len = Math.sqrt(x * x + y * y)
    if (len === 0) throw new Error('TrueType hinting: cannot normalize a zero-length vector')
    return { x: x / len, y: y / len }
  }

  private computeLineVector(p1Idx: number, p2Idx: number, perpendicular: boolean, original: boolean): Vec2 {
    const z1 = this.getZone(this.gs.zp1)
    const z2 = this.getZone(this.gs.zp2)
    const pt1 = this.pointAt(z1, p1Idx, 'line-vector')
    const pt2 = this.pointAt(z2, p2Idx, 'line-vector')

    let dx = original ? pt2.origX - pt1.origX : pt2.x - pt1.x
    let dy = original ? pt2.origY - pt1.origY : pt2.y - pt1.y

    if (perpendicular) {
      const tmp = dx
      dx = -dy
      dy = tmp
    }

    return this.normalizeVector(dx, dy)
  }

  private computeIntersection(ptIdx: number, a0: number, a1: number, b0: number, b1: number): void {
    const zone = this.getZone(this.gs.zp2)
    const pt = this.pointAt(zone, ptIdx, 'ISECT destination')

    const zoneA = this.getZone(this.gs.zp0)
    const zoneB = this.getZone(this.gs.zp1)
    const za0 = this.pointAt(zoneA, a0, 'ISECT line A')
    const za1 = this.pointAt(zoneA, a1, 'ISECT line A')
    const zb0 = this.pointAt(zoneB, b0, 'ISECT line B')
    const zb1 = this.pointAt(zoneB, b1, 'ISECT line B')

    const dax = za1.x - za0.x
    const day = za1.y - za0.y
    const dbx = zb1.x - zb0.x
    const dby = zb1.y - zb0.y

    const det = dax * dby - day * dbx
    if (Math.abs(det) < 1) {
      pt.x = (za0.x + za1.x + zb0.x + zb1.x) >> 2
      pt.y = (za0.y + za1.y + zb0.y + zb1.y) >> 2
    } else {
      const t = ((zb0.x - za0.x) * dby - (zb0.y - za0.y) * dbx) / det
      pt.x = Math.round(za0.x + t * dax)
      pt.y = Math.round(za0.y + t * day)
    }
    this.markTouched(pt)
  }

  // ── Zone helpers ──

  private getZone(zp: number): Zone {
    if (zp !== 0 && zp !== 1) throw new Error(`TrueType hinting: zone ${zp} must be 0 or 1`)
    return this.zones[zp]!
  }

  // ── Measurement ──

  private measureDistance(p1Idx: number, p2Idx: number, useCurrent: boolean): number {
    const z1 = this.getZone(this.gs.zp0)
    const z2 = this.getZone(this.gs.zp1)
    const pt1 = this.pointAt(z1, p1Idx, 'MD')
    const pt2 = this.pointAt(z2, p2Idx, 'MD')

    if (useCurrent) {
      return this.projectPoint(pt1.x - pt2.x, pt1.y - pt2.y)
    } else {
      return this.dualProjectPoint(pt1.origX - pt2.origX, pt1.origY - pt2.origY)
    }
  }

  // ── Point movement opcodes ──

  private opMDAP(ptIdx: number, round: boolean): void {
    const zone = this.getZone(this.gs.zp0)
    const pt = this.pointAt(zone, ptIdx, 'MDAP')

    if (round) {
      const dist = this.projectPoint(pt.x, pt.y)
      const rounded = this.roundValue(dist)
      this.movePointAlongFreedom(pt, rounded - dist)
    }
    this.markTouched(pt)
    this.gs.rp0 = ptIdx
    this.gs.rp1 = ptIdx
  }

  private opMIAP(ptIdx: number, cvtIdx: number, round: boolean): void {
    const zone = this.getZone(this.gs.zp0)
    const pt = this.pointAt(zone, ptIdx, 'MIAP')

    let cvtDist = this.readCvt(cvtIdx)
    const origDist = this.projectPoint(pt.x, pt.y)

    if (round) {
      if (Math.abs(cvtDist - origDist) > this.gs.controlValueCutIn) {
        cvtDist = origDist
      }
      cvtDist = this.roundValue(cvtDist)
    }

    this.movePointAlongFreedom(pt, cvtDist - origDist)
    this.markTouched(pt)
    this.gs.rp0 = ptIdx
    this.gs.rp1 = ptIdx
  }

  private opMDRP(opcode: number): void {
    const ptIdx = this.pop()
    const zone1 = this.getZone(this.gs.zp1)
    const zone0 = this.getZone(this.gs.zp0)
    const pt = this.pointAt(zone1, ptIdx, 'MDRP')
    const rp0 = this.pointAt(zone0, this.gs.rp0, 'MDRP reference')

    let dist = this.originalScaledDistance(pt, rp0, this.gs.zp0 === 0 || this.gs.zp1 === 0)

    const setRp0 = (opcode & 0x10) !== 0
    const keepMinDist = (opcode & 0x08) !== 0
    const doRound = (opcode & 0x04) !== 0

    if (doRound) {
      dist = this.roundValue(dist)
    }

    if (keepMinDist) {
      const sign = dist < 0 ? -1 : 1
      if (Math.abs(dist) < this.gs.minimumDistance) {
        dist = sign * this.gs.minimumDistance
      }
    }

    const curDist = this.projectPoint(pt.x - rp0.x, pt.y - rp0.y)
    this.movePointAlongFreedom(pt, dist - curDist)
    this.markTouched(pt)
    this.gs.rp1 = this.gs.rp0
    this.gs.rp2 = ptIdx
    if (setRp0) this.gs.rp0 = ptIdx
  }

  private opMIRP(opcode: number): void {
    const cvtIdx = this.pop()
    const ptIdx = this.pop()
    const zone1 = this.getZone(this.gs.zp1)
    const zone0 = this.getZone(this.gs.zp0)
    const pt = this.pointAt(zone1, ptIdx, 'MIRP')
    const rp0 = this.pointAt(zone0, this.gs.rp0, 'MIRP reference')

    const origDist = this.originalScaledDistance(pt, rp0, this.gs.zp0 === 0 || this.gs.zp1 === 0)
    let cvtDist = this.readCvt(cvtIdx)

    if (this.gs.autoFlip && ((origDist < 0 && cvtDist > 0) || (origDist > 0 && cvtDist < 0))) {
      cvtDist = -cvtDist
    }

    const setRp0 = (opcode & 0x10) !== 0
    const keepMinDist = (opcode & 0x08) !== 0
    const doRound = (opcode & 0x04) !== 0

    if (Math.abs(cvtDist - origDist) > this.gs.controlValueCutIn) {
      cvtDist = origDist
    }

    if (doRound) {
      cvtDist = this.roundValue(cvtDist)
    }

    if (keepMinDist) {
      const sign = cvtDist < 0 ? -1 : 1
      if (Math.abs(cvtDist) < this.gs.minimumDistance) {
        cvtDist = sign * this.gs.minimumDistance
      }
    }

    const curDist = this.projectPoint(pt.x - rp0.x, pt.y - rp0.y)
    this.movePointAlongFreedom(pt, cvtDist - curDist)
    this.markTouched(pt)
    this.gs.rp1 = this.gs.rp0
    this.gs.rp2 = ptIdx
    if (setRp0) this.gs.rp0 = ptIdx
  }

  private opSHP(rpType: number): void {
    const zone0 = this.getZone(rpType === 1 ? this.gs.zp0 : this.gs.zp1)
    const rpIdx = rpType === 1 ? this.gs.rp1 : this.gs.rp2
    const rp = this.pointAt(zone0, rpIdx, 'SHP reference')

    const dist = this.projectPoint(rp.x - rp.origX, rp.y - rp.origY)

    const count = this.gs.loop
    this.gs.loop = 1
    const zone2 = this.getZone(this.gs.zp2)
    for (let i = 0; i < count; i++) {
      const ptIdx = this.pop()
      const pt = this.pointAt(zone2, ptIdx, 'SHP')
      this.movePointAlongFreedom(pt, dist)
      this.markTouched(pt)
    }
  }

  private opSHC(contour: number, rpType: number): void {
    const zone0 = this.getZone(rpType === 1 ? this.gs.zp0 : this.gs.zp1)
    const rpIdx = rpType === 1 ? this.gs.rp1 : this.gs.rp2
    const rp = this.pointAt(zone0, rpIdx, 'SHC reference')

    const dist = this.projectPoint(rp.x - rp.origX, rp.y - rp.origY)
    const zone2 = this.getZone(this.gs.zp2)
    const points = zone2.points

    // Contour range: glyph zone with contour data shifts only that contour;
    // otherwise (twilight zone / no contour data) the whole zone shifts
    let start = 0
    let end = points.length - 1
    const ends = this.gs.zp2 === 1 ? this.glyphContourEnds : null
    if (ends !== null) {
      if (!Number.isInteger(contour) || contour < 0 || contour >= ends.length) {
        throw new Error(`TrueType hinting: SHC contour ${contour} is out of range`)
      }
      start = contour === 0 ? 0 : ends[contour - 1]! + 1
      end = ends[contour]!
    } else if (this.gs.zp2 === 1) {
      throw new Error('TrueType hinting: SHC requires glyph contour endpoints')
    }

    // The reference point itself is not moved when it lies in the target zone
    const skipRp = zone0 === zone2 ? rpIdx : -1
    for (let i = start; i <= end && i < points.length; i++) {
      if (i === skipRp) continue
      const pt = points[i]!
      this.movePointAlongFreedom(pt, dist)
      this.markTouched(pt)
    }
  }

  private opSHZ(zoneIdx: number, rpType: number): void {
    const zone0 = this.getZone(rpType === 1 ? this.gs.zp0 : this.gs.zp1)
    const rpIdx = rpType === 1 ? this.gs.rp1 : this.gs.rp2
    const rp = this.pointAt(zone0, rpIdx, 'SHZ reference')

    const dist = this.projectPoint(rp.x - rp.origX, rp.y - rp.origY)
    const zone = this.getZone(zoneIdx)
    for (const pt of zone.points) this.movePointAlongFreedom(pt, dist)
  }

  private opIP(): void {
    const zone0 = this.getZone(this.gs.zp0)
    const zone1 = this.getZone(this.gs.zp1)
    const zone2 = this.getZone(this.gs.zp2)

    const rp1 = this.pointAt(zone0, this.gs.rp1, 'IP reference 1')
    const rp2 = this.pointAt(zone1, this.gs.rp2, 'IP reference 2')

    const twilight = this.gs.zp0 === 0 || this.gs.zp1 === 0 || this.gs.zp2 === 0
    const baseX = twilight ? rp1.origX : rp1.orusX
    const baseY = twilight ? rp1.origY : rp1.orusY
    const rp2X = twilight ? rp2.origX : rp2.orusX
    const rp2Y = twilight ? rp2.origY : rp2.orusY
    const origDist = this.dualProjectPoint(rp2X - baseX, rp2Y - baseY)
    const curDist = this.projectPoint(rp2.x - rp1.x, rp2.y - rp1.y)

    const count = this.gs.loop
    this.gs.loop = 1

    for (let i = 0; i < count; i++) {
      const ptIdx = this.pop()
      const pt = this.pointAt(zone2, ptIdx, 'IP')

      const pointX = twilight ? pt.origX : pt.orusX
      const pointY = twilight ? pt.origY : pt.orusY
      const origPtDist = this.dualProjectPoint(pointX - baseX, pointY - baseY)
      let newDist: number
      if (origPtDist === 0) {
        newDist = 0
      } else if (origDist === 0) {
        newDist = origPtDist
      } else {
        newDist = multiplyDivide(origPtDist, curDist, origDist)
      }
      const curPtDist = this.projectPoint(pt.x - rp1.x, pt.y - rp1.y)
      this.movePointAlongFreedom(pt, newDist - curPtDist)
      this.markTouched(pt)
    }
  }

  private opMSIRP(ptIdx: number, dist: number, setRp0: boolean): void {
    const zone1 = this.getZone(this.gs.zp1)
    const zone0 = this.getZone(this.gs.zp0)
    const pt = this.pointAt(zone1, ptIdx, 'MSIRP')
    const rp0 = this.pointAt(zone0, this.gs.rp0, 'MSIRP reference')

    const curDist = this.projectPoint(pt.x - rp0.x, pt.y - rp0.y)
    this.movePointAlongFreedom(pt, dist - curDist)
    this.markTouched(pt)
    this.gs.rp1 = this.gs.rp0
    this.gs.rp2 = ptIdx
    if (setRp0) this.gs.rp0 = ptIdx
  }

  private opALIGNRP(): void {
    const zone0 = this.getZone(this.gs.zp0)
    const zone1 = this.getZone(this.gs.zp1)
    const rp0 = this.pointAt(zone0, this.gs.rp0, 'ALIGNRP reference')

    const count = this.gs.loop
    this.gs.loop = 1

    for (let i = 0; i < count; i++) {
      const ptIdx = this.pop()
      const pt = this.pointAt(zone1, ptIdx, 'ALIGNRP')
      const dist = this.projectPoint(pt.x - rp0.x, pt.y - rp0.y)
      this.movePointAlongFreedom(pt, -dist)
      this.markTouched(pt)
    }
  }

  private opALIGNPTS(p1Idx: number, p2Idx: number): void {
    const zone0 = this.getZone(this.gs.zp0)
    const zone1 = this.getZone(this.gs.zp1)
    const pt1 = this.pointAt(zone0, p1Idx, 'ALIGNPTS')
    const pt2 = this.pointAt(zone1, p2Idx, 'ALIGNPTS')

    const dist = this.projectPoint(pt2.x - pt1.x, pt2.y - pt1.y)
    const half = dist >> 1
    this.movePointAlongFreedom(pt1, half)
    this.movePointAlongFreedom(pt2, -half)
    this.markTouched(pt1)
    this.markTouched(pt2)
  }

  private opIUP(axis: number): void {
    if (this.backwardCompatibility && this.iupXCalled && this.iupYCalled) return
    if (axis === 0) this.iupXCalled = true
    else this.iupYCalled = true
    const zone = this.getZone(1) // always glyph zone
    const points = zone.points
    if (points.length === 0) return

    const ends = this.glyphContourEnds
    if (!ends || ends.length === 0) {
      // No contour data: treat all points as a single contour
      this.iupContour(points, 0, points.length - 1, axis)
      return
    }

    // Interpolate each contour independently (phantom points are excluded
    // because they lie beyond the last contour end point)
    let start = 0
    for (let c = 0; c < ends.length; c++) {
      const end = ends[c]!
      if (end >= start && end < points.length) {
        this.iupContour(points, start, end, axis)
      }
      start = end + 1
    }
  }

  /** IUP over one contour [start..end] with wraparound inside the contour */
  private iupContour(points: ZonePoint[], start: number, end: number, axis: number): void {
    let firstTouched = -1
    let currentTouched = -1
    for (let i = start; i <= end; i++) {
      if (axis === 0 ? points[i]!.touchedX : points[i]!.touchedY) {
        if (firstTouched < 0) firstTouched = i
        if (currentTouched >= 0) this.interpolateUntouched(points, currentTouched + 1, i - 1, currentTouched, i, axis)
        currentTouched = i
      }
    }
    if (firstTouched < 0) return
    if (currentTouched === firstTouched) {
      const pt = points[firstTouched]!
      const delta = axis === 0 ? pt.x - pt.origX : pt.y - pt.origY
      if (delta !== 0) {
        for (let i = start; i <= end; i++) {
          if (i === firstTouched) continue
          const p = points[i]!
          if (axis === 0) p.x += delta
          else p.y += delta
        }
      }
      return
    }
    this.interpolateUntouched(points, currentTouched + 1, end, currentTouched, firstTouched, axis)
    this.interpolateUntouched(points, start, firstTouched - 1, currentTouched, firstTouched, axis)
  }

  private interpolateUntouched(
    points: ZonePoint[],
    firstPoint: number,
    lastPoint: number,
    firstReference: number,
    secondReference: number,
    axis: number,
  ): void {
    if (firstPoint > lastPoint) return
    let reference1 = points[firstReference]!
    let reference2 = points[secondReference]!
    let orus1 = axis === 0 ? reference1.orusX : reference1.orusY
    let orus2 = axis === 0 ? reference2.orusX : reference2.orusY
    if (orus1 > orus2) {
      const temporary = reference1
      reference1 = reference2
      reference2 = temporary
      const temporaryOrus = orus1
      orus1 = orus2
      orus2 = temporaryOrus
    }
    const orig1 = axis === 0 ? reference1.origX : reference1.origY
    const orig2 = axis === 0 ? reference2.origX : reference2.origY
    const current1 = axis === 0 ? reference1.x : reference1.y
    const current2 = axis === 0 ? reference2.x : reference2.y
    const delta1 = current1 - orig1
    const delta2 = current2 - orig2
    const direct = current1 === current2 || orus1 === orus2
    const scale = direct ? 0 : divideToFixed(current2 - current1, orus2 - orus1)
    for (let i = firstPoint; i <= lastPoint; i++) {
      const point = points[i]!
      const original = axis === 0 ? point.origX : point.origY
      let value: number
      if (original <= orig1) value = original + delta1
      else if (original >= orig2) value = original + delta2
      else if (direct) value = current1
      else {
        const unscaled = axis === 0 ? point.orusX : point.orusY
        value = current1 + multiplyFixed(unscaled - orus1, scale)
      }
      if (axis === 0) point.x = value
      else point.y = value
    }
  }

  // ── Delta instructions ──

  private opDeltaP(opcode: number): void {
    const base = opcode === DELTAP1 ? 0 : opcode === DELTAP2 ? 16 : 32
    const n = this.pop()
    for (let i = 0; i < n; i++) {
      const ptIdx = this.pop()
      const arg = this.pop()
      const ppemTarget = this.gs.deltaBase + base + ((arg >> 4) & 0xF)
      if (ppemTarget !== this.ppem) continue

      const zone = this.getZone(this.gs.zp0)
      const pt = this.pointAt(zone, ptIdx, 'DELTAP')

      let step = (arg & 0xF) - 8
      if (step >= 0) step++
      const amount = step * (1 << (6 - this.gs.deltaShift))
      this.movePointAlongFreedom(pt, amount)
      this.markTouched(pt)
    }
  }

  private opDeltaC(opcode: number): void {
    const base = opcode === DELTAC1 ? 0 : opcode === DELTAC2 ? 16 : 32
    const n = this.pop()
    for (let i = 0; i < n; i++) {
      const cvtIdx = this.pop()
      const arg = this.pop()
      const ppemTarget = this.gs.deltaBase + base + ((arg >> 4) & 0xF)
      if (ppemTarget !== this.ppem) continue

      let step = (arg & 0xF) - 8
      if (step >= 0) step++
      const amount = step * (1 << (6 - this.gs.deltaShift))
      this.writeCvt(cvtIdx, this.readCvt(cvtIdx) + amount)
    }
  }
}
