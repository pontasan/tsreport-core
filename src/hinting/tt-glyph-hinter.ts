/**
 * TrueType glyph grid-fitting.
 *
 * Connects the bytecode interpreter to the glyf table: runs fpgm/prep once
 * per ppem (with cvar-varied CVT for variable fonts), executes each glyph's
 * instructions over its scaled outline (composite components are hinted
 * recursively, then the composite's own instructions run over the composed
 * points), and returns the grid-fitted outline converted back to font units.
 *
 * The gasp table gates hinting per ppem (GASP_GRIDFIT); prep can inhibit
 * glyph instructions entirely via INSTCTRL.
 */

import type { BinaryReader } from '../binary/reader.js'
import type { GlyphOutline, LocaTable, MaxpTable } from '../types/index.js'
import type { CvtTable } from '../parsers/tables/cvt.js'
import type { GaspTable } from '../parsers/tables/gasp.js'
import type { GvarTable } from '../parsers/tables/gvar.js'
import { GASP_GRIDFIT } from '../parsers/tables/gasp.js'
import {
  parseCompositeComponents, composedGlyphToOutline, readSimpleGlyphData,
  type CompositeComponent,
  ARGS_ARE_XY_VALUES, ROUND_XY_TO_GRID,
  SCALED_COMPONENT_OFFSET, UNSCALED_COMPONENT_OFFSET,
  WE_HAVE_A_SCALE, WE_HAVE_AN_X_AND_Y_SCALE, WE_HAVE_A_TWO_BY_TWO,
  WE_HAVE_INSTRUCTIONS,
} from '../parsers/tables/glyf.js'
import { divideToFixed, multiplyFixed, TrueTypeInterpreter } from './interpreter.js'
import type { ZonePoint } from './graphics-state.js'

const ON_CURVE_POINT = 0x01

/** Dependencies resolved from the font's tables */
export interface TrueTypeGlyphHinterDeps {
  glyfReader: BinaryReader
  loca: LocaTable
  cvt: CvtTable | null
  /** Per-entry CVT deltas in font units (cvar, variable fonts) */
  cvtDeltas: number[] | null
  fpgm: Uint8Array | null
  prep: Uint8Array | null
  gasp: GaspTable | null
  gvar: GvarTable | null
  /** Normalized variation coordinates (variable fonts) */
  coords: number[] | null
  unitsPerEm: number
  maxp: MaxpTable
  /** Advance width lookup in font units (phantom point 2) */
  getAdvanceWidth: (glyphId: number) => number
  getLeftSideBearing: (glyphId: number) => number
  getAdvanceHeight: (glyphId: number) => number
  getTopSideBearing: (glyphId: number) => number
  /** Enables the v40 subpixel backward-compatibility movement restrictions. */
  backwardCompatibility?: boolean
}

/** Hinted glyph points in F26Dot6 pixel space */
interface HintedPoints {
  endPts: number[]
  flags: number[]
  /** F26Dot6 pixel coordinates */
  x: number[]
  y: number[]
  /** Original unscaled coordinates in font units (IUP interpolation domain). */
  orusX: number[]
  orusY: number[]
  /** Whether any instruction program actually ran */
  instructed: boolean
  /** Grid-fitted horizontal advance in F26Dot6 pixels. */
  advance: number
  phantomX: number[]
  phantomY: number[]
}

/** Grid-fitted contour and phantom points used by the TrueType scan converter. */
export interface TrueTypeHintingState {
  /** Contour points in F26Dot6 device pixels. */
  readonly x: readonly number[]
  readonly y: readonly number[]
  readonly onCurve: readonly boolean[]
  readonly contourEnds: readonly number[]
  /** Horizontal PP1/PP2 followed by vertical PP3/PP4, in F26Dot6 pixels. */
  readonly phantomX: readonly number[]
  readonly phantomY: readonly number[]
  readonly advance: number
  readonly scanControl: number
  readonly scanType: number
  readonly instructed: boolean
}

export interface TrueTypeHintingTransform {
  readonly horizontalPpem?: number
  /** Post-hinting affine matrix in device space. */
  readonly matrix?: {
    readonly xx: number
    readonly xy: number
    readonly yx: number
    readonly yy: number
  }
  /** Post-hinting device translation in pixels. */
  readonly translateX?: number
  readonly translateY?: number
  readonly rotated?: boolean
  readonly stretched?: boolean
}

export class TrueTypeGlyphHinter {
  private readonly deps: TrueTypeGlyphHinterDeps
  /** One interpreter per ppem (fpgm/prep executed once at creation) */
  private readonly interpreters = new Map<string, TrueTypeInterpreter>()

  constructor(deps: TrueTypeGlyphHinterDeps) {
    if (deps.maxp.version !== 1.0) {
      throw new Error(`TrueType outlines require maxp version 1.0, got ${deps.maxp.version}`)
    }
    this.deps = deps
  }

  /**
   * Grid-fits a glyph at the given ppem.
   * @returns The hinted outline in font units, or null when hinting does not
   * apply (gasp grid-fit disabled at this ppem, prep-inhibited instructions,
   * or the glyph carries no instructions)
   */
  getHintedGlyph(glyphId: number, ppem: number, horizontalPpem = ppem): {
    outline: GlyphOutline
    advanceWidth: number
    bounds: { xMin: number, yMin: number, xMax: number, yMax: number }
  } | null {
    if (ppem <= 0) return null

    const gasp = this.deps.gasp
    const gridFit = gasp === null || (gasp.getGaspBehavior(ppem) & GASP_GRIDFIT) !== 0

    const interp = this.getInterpreter(ppem, horizontalPpem, false, horizontalPpem !== ppem)
    const hinted = this.hintGlyphPoints(glyphId, ppem, horizontalPpem, interp, 0, gridFit && !interp.instructionsInhibited)
    if (hinted === null) return null
    if (!hinted.instructed) interp.executeGlyphProgram(EMPTY_BYTES)

    // Convert F26Dot6 pixels back to font units so existing scaling applies;
    // grid alignment is exact when drawn at the same ppem
    const xToFontUnits = this.deps.unitsPerEm / (horizontalPpem * 64)
    const yToFontUnits = this.deps.unitsPerEm / (ppem * 64)
    const n = hinted.x.length
    const xCoords: number[] = new Array(n)
    const yCoords: number[] = new Array(n)
    for (let i = 0; i < n; i++) {
      xCoords[i] = hinted.x[i]! * xToFontUnits
      yCoords[i] = hinted.y[i]! * yToFontUnits
    }

    const outline = composedGlyphToOutline({
      endPts: hinted.endPts,
      flags: hinted.flags,
      xCoords,
      yCoords,
      numPoints: n,
      metricsGlyphId: glyphId,
      advanceWidthDelta: 0,
      lsbDelta: 0,
      advanceHeightDelta: 0,
      verticalOriginDelta: 0,
    })
    const deviceBounds = getHintedPointBounds(hinted)
    return {
      outline,
      advanceWidth: hinted.advance * xToFontUnits,
      bounds: {
        xMin: deviceBounds.xMin * xToFontUnits,
        yMin: deviceBounds.yMin * yToFontUnits,
        xMax: deviceBounds.xMax * xToFontUnits,
        yMax: deviceBounds.yMax * yToFontUnits,
      },
    }
  }

  /** Returns the exact grid-fitted point zone consumed by monochrome scan conversion. */
  getHintingState(glyphId: number, ppem: number, transform: TrueTypeHintingTransform = {}): TrueTypeHintingState | null {
    if (ppem <= 0) return null
    const horizontalPpem = transform.horizontalPpem ?? ppem
    const gasp = this.deps.gasp
    const gridFit = gasp === null || (gasp.getGaspBehavior(ppem) & GASP_GRIDFIT) !== 0
    const matrix = transform.matrix
    const rotated = transform.rotated ?? (matrix !== undefined && (matrix.xy !== 0 || matrix.yx !== 0))
    const stretched = transform.stretched ?? (horizontalPpem !== ppem || (matrix !== undefined && matrixIsStretched(matrix)))
    const interp = this.getInterpreter(ppem, horizontalPpem, rotated, stretched)
    const hinted = this.hintGlyphPoints(glyphId, ppem, horizontalPpem, interp, 0, gridFit && !interp.instructionsInhibited)
    if (hinted === null) return null
    if (!hinted.instructed) interp.executeGlyphProgram(EMPTY_BYTES)
    const onCurve = new Array<boolean>(hinted.flags.length)
    for (let i = 0; i < hinted.flags.length; i++) onCurve[i] = (hinted.flags[i]! & ON_CURVE_POINT) !== 0
    return {
      x: hinted.x,
      y: hinted.y,
      onCurve,
      contourEnds: hinted.endPts,
      phantomX: hinted.phantomX,
      phantomY: hinted.phantomY,
      advance: hinted.advance,
      scanControl: hinted.instructed ? interp.gs.scanControl : 0x01FF,
      scanType: hinted.instructed ? interp.gs.scanType : 1,
      instructed: hinted.instructed,
    }
  }

  private getInterpreter(ppem: number, horizontalPpem: number, rotated: boolean, stretched: boolean): TrueTypeInterpreter {
    const key = `${horizontalPpem}|${ppem}|${rotated ? 1 : 0}|${stretched ? 1 : 0}`
    let interp = this.interpreters.get(key)
    if (!interp) {
      interp = new TrueTypeInterpreter({
        ppem,
        horizontalPpem,
        rotated,
        stretched,
        cvt: this.deps.cvt,
        cvtDeltas: this.deps.cvtDeltas,
        fpgm: this.deps.fpgm,
        prep: this.deps.prep,
        unitsPerEm: this.deps.unitsPerEm,
        maxTwilightPoints: this.deps.maxp.maxTwilightPoints!,
        maxStorage: this.deps.maxp.maxStorage!,
        maxFunctionDefs: this.deps.maxp.maxFunctionDefs!,
        maxInstructionDefs: this.deps.maxp.maxInstructionDefs!,
        maxStackElements: this.deps.maxp.maxStackElements!,
        normalizedCoords: this.deps.coords,
        backwardCompatibility: this.deps.backwardCompatibility,
      })
      this.interpreters.set(key, interp)
    }
    return interp
  }

  /**
   * Hints a glyph recursively and returns its points in F26Dot6 pixel space.
   * Returns null for empty glyphs.
   */
  private hintGlyphPoints(
    glyphId: number,
    ppem: number,
    horizontalPpem: number,
    interp: TrueTypeInterpreter,
    depth: number,
    executeInstructions = true,
  ): HintedPoints | null {
    if (depth > this.deps.maxp.maxComponentDepth!) {
      throw new Error(`Composite glyph ${glyphId}: depth ${depth} exceeds maxp.maxComponentDepth ${this.deps.maxp.maxComponentDepth}`)
    }

    const loca = this.deps.loca
    const offset = loca.getOffset(glyphId)
    const length = loca.getLength(glyphId)
    if (length === 0) {
      const xScaleFixed = divideToFixed(horizontalPpem * 64, this.deps.unitsPerEm)
      const yScaleFixed = divideToFixed(ppem * 64, this.deps.unitsPerEm)
      let phantomDeltaX = [0, 0, 0, 0]
      let phantomDeltaY = [0, 0, 0, 0]
      if (this.deps.gvar !== null && this.deps.coords !== null) {
        const deltas = this.deps.gvar.getGlyphDeltas(glyphId, this.deps.coords, 4)
        if (deltas !== null) {
          phantomDeltaX = deltas.deltaX
          phantomDeltaY = deltas.deltaY
        }
      }
      const phantoms = this.buildScaledPhantoms(glyphId, 0, 0, xScaleFixed, yScaleFixed, phantomDeltaX, phantomDeltaY, executeInstructions)
      return {
        endPts: [], flags: [], x: [], y: [], orusX: [], orusY: [], instructed: false,
        advance: phantoms.x[1]! - phantoms.x[0]!,
        phantomX: phantoms.x, phantomY: phantoms.y,
      }
    }

    const reader = this.deps.glyfReader.subReader(offset, length)
    const numberOfContours = reader.readInt16()
    const xMin = reader.readInt16()
    reader.readInt16()
    reader.readInt16()
    const yMax = reader.readInt16()

    if (numberOfContours >= 0) {
      return this.hintSimpleGlyph(glyphId, ppem, horizontalPpem, interp, reader, numberOfContours, xMin, yMax, executeInstructions)
    }
    return this.hintCompositeGlyph(glyphId, ppem, horizontalPpem, interp, reader, depth, xMin, yMax, executeInstructions)
  }

  private hintSimpleGlyph(
    glyphId: number,
    ppem: number,
    horizontalPpem: number,
    interp: TrueTypeInterpreter,
    reader: BinaryReader,
    numberOfContours: number,
    xMin: number,
    yMax: number,
    executeInstructions: boolean,
  ): HintedPoints | null {
    const raw = readSimpleGlyphData(reader, numberOfContours)
    if (numberOfContours > this.deps.maxp.maxContours!) {
      throw new Error(`Glyph ${glyphId}: ${numberOfContours} contours exceed maxp.maxContours ${this.deps.maxp.maxContours}`)
    }
    if (raw.numPoints > this.deps.maxp.maxPoints!) {
      throw new Error(`Glyph ${glyphId}: ${raw.numPoints} points exceed maxp.maxPoints ${this.deps.maxp.maxPoints}`)
    }
    this.assertInstructionLength(glyphId, raw.instructions.length)

    // Variable font: apply gvar deltas to the unscaled outline first
    const gvar = this.deps.gvar
    const coords = this.deps.coords
    let phantomDeltaX = [0, 0, 0, 0]
    let phantomDeltaY = [0, 0, 0, 0]
    if (gvar && coords) {
      const deltas = gvar.getGlyphDeltas(
        glyphId, coords, raw.numPoints + 4,
        raw.endPts, raw.xCoords, raw.yCoords,
      )
      if (deltas) {
        for (let i = 0; i < raw.numPoints; i++) {
          raw.xCoords[i] = raw.xCoords[i]! + Math.round(deltas.deltaX[i]!)
          raw.yCoords[i] = raw.yCoords[i]! + Math.round(deltas.deltaY[i]!)
        }
        phantomDeltaX = deltas.deltaX.slice(raw.numPoints, raw.numPoints + 4)
        phantomDeltaY = deltas.deltaY.slice(raw.numPoints, raw.numPoints + 4)
      }
    }

    // Scale to F26Dot6 pixels
    const xScaleFixed = divideToFixed(horizontalPpem * 64, this.deps.unitsPerEm)
    const yScaleFixed = divideToFixed(ppem * 64, this.deps.unitsPerEm)
    const n = raw.numPoints
    const x: number[] = new Array(n)
    const y: number[] = new Array(n)
    const flags = toNumberArray(raw.flags)
    const orusX = raw.xCoords.slice()
    const orusY = raw.yCoords.slice()
    for (let i = 0; i < n; i++) {
      x[i] = multiplyFixed(raw.xCoords[i]!, xScaleFixed)
      y[i] = multiplyFixed(raw.yCoords[i]!, yScaleFixed)
    }
    const phantoms = this.buildScaledPhantoms(glyphId, xMin, yMax, xScaleFixed, yScaleFixed, phantomDeltaX, phantomDeltaY, executeInstructions)

    if (raw.instructions.length === 0 || !executeInstructions) {
      return {
        endPts: toNumberArray(raw.endPts), flags, x, y, orusX, orusY,
        instructed: false, advance: multiplyFixed(this.deps.getAdvanceWidth(glyphId), xScaleFixed),
        phantomX: phantoms.x,
        phantomY: phantoms.y,
      }
    }

    const endPts = toNumberArray(raw.endPts)
    const result = this.runInstructions(
      interp, x, y, orusX, orusY, flags, endPts,
      phantoms.x, phantoms.y, phantoms.orusX, phantoms.orusY, raw.instructions,
    )
    return {
      endPts, flags, x, y, orusX, orusY, instructed: true, advance: result.advance,
      phantomX: result.phantomX, phantomY: result.phantomY,
    }
  }

  private hintCompositeGlyph(
    glyphId: number,
    ppem: number,
    horizontalPpem: number,
    interp: TrueTypeInterpreter,
    reader: BinaryReader,
    depth: number,
    xMin: number,
    yMax: number,
    executeInstructions: boolean,
  ): HintedPoints | null {
    const components = parseCompositeComponents(reader)
    if (components.length > this.deps.maxp.maxComponentElements!) {
      throw new Error(`Composite glyph ${glyphId}: ${components.length} components exceed maxp.maxComponentElements ${this.deps.maxp.maxComponentElements}`)
    }

    // Composite instructions follow the last component when flagged
    let instructions: Uint8Array = EMPTY_BYTES
    let hasInstructionsFlag = false
    for (let i = 0; i < components.length; i++) {
      if (components[i]!.flags & WE_HAVE_INSTRUCTIONS) hasInstructionsFlag = true
    }
    if (hasInstructionsFlag) {
      const numInstr = reader.readUint16()
      this.assertInstructionLength(glyphId, numInstr)
      instructions = reader.readBytes(numInstr)
    }

    // gvar: one delta per component offset (plus 4 phantoms), no IUP
    const gvar = this.deps.gvar
    const coords = this.deps.coords
    let compDeltaX: number[] | null = null
    let compDeltaY: number[] | null = null
    let phantomDeltaX = [0, 0, 0, 0]
    let phantomDeltaY = [0, 0, 0, 0]
    if (gvar && coords) {
      const deltas = gvar.getGlyphDeltas(glyphId, coords, components.length + 4)
      if (deltas) {
        compDeltaX = deltas.deltaX
        compDeltaY = deltas.deltaY
        phantomDeltaX = deltas.deltaX.slice(components.length, components.length + 4)
        phantomDeltaY = deltas.deltaY.slice(components.length, components.length + 4)
      }
    }

    const xScaleFixed = divideToFixed(horizontalPpem * 64, this.deps.unitsPerEm)
    const yScaleFixed = divideToFixed(ppem * 64, this.deps.unitsPerEm)
    const xScale = xScaleFixed / 0x10000
    const yScale = yScaleFixed / 0x10000
    let parentPhantoms = this.buildScaledPhantoms(glyphId, xMin, yMax, xScaleFixed, yScaleFixed, phantomDeltaX, phantomDeltaY, executeInstructions)
    const children = new Array<HintedPoints>(components.length)
    let totalPointCount = 0
    for (let ci = 0; ci < components.length; ci++) {
      const child = this.hintGlyphPoints(components[ci]!.glyphId, ppem, horizontalPpem, interp, depth + 1, executeInstructions)
      if (child === null) throw new Error(`Composite glyph ${glyphId}: component ${components[ci]!.glyphId} could not be resolved`)
      children[ci] = child
      totalPointCount += child.x.length
    }
    const endPts: number[] = []
    const flags: number[] = []
    const x: number[] = []
    const y: number[] = []
    const orusX: number[] = []
    const orusY: number[] = []
    let anyInstructed = false

    for (let ci = 0; ci < components.length; ci++) {
      const comp = components[ci]!
      const child = children[ci]!
      if (child.instructed) anyInstructed = true

      // Transform child points by the component matrix (pixel space is
      // linear, so the font-unit matrix applies directly)
      const cn = child.x.length
      const tx: number[] = new Array(cn)
      const ty: number[] = new Array(cn)
      const tux: number[] = new Array(cn)
      const tuy: number[] = new Array(cn)
      for (let i = 0; i < cn; i++) {
        tx[i] = comp.scaleX * child.x[i]! + comp.scale10 * child.y[i]!
        ty[i] = comp.scale01 * child.x[i]! + comp.scaleY * child.y[i]!
        tux[i] = comp.scaleX * child.orusX[i]! + comp.scale10 * child.orusY[i]!
        tuy[i] = comp.scale01 * child.orusX[i]! + comp.scaleY * child.orusY[i]!
      }

      let dx: number
      let dy: number
      let orusDx: number
      let orusDy: number
      if (comp.flags & ARGS_ARE_XY_VALUES) {
        // Offsets in font units (plus variation deltas), scaled to pixels
        let fdx = comp.arg1
        let fdy = comp.arg2
        if (compDeltaX && compDeltaY) {
          fdx += compDeltaX[ci]!
          fdy += compDeltaY[ci]!
        }
        if ((comp.flags & SCALED_COMPONENT_OFFSET)
          && !(comp.flags & UNSCALED_COMPONENT_OFFSET)
          && (comp.flags & (WE_HAVE_A_SCALE | WE_HAVE_AN_X_AND_Y_SCALE | WE_HAVE_A_TWO_BY_TWO))) {
          const sdx = comp.scaleX * fdx + comp.scale10 * fdy
          const sdy = comp.scale01 * fdx + comp.scaleY * fdy
          fdx = sdx
          fdy = sdy
        }
        orusDx = fdx
        orusDy = fdy
        dx = multiplyFixed(fdx, xScaleFixed)
        dy = multiplyFixed(fdy, yScaleFixed)
        if (executeInstructions && (comp.flags & ROUND_XY_TO_GRID) !== 0) {
          // Round the offset to the pixel grid (64 units per pixel)
          if (!this.deps.backwardCompatibility) dx = Math.round(dx / 64) * 64
          dy = Math.round(dy / 64) * 64
        } else {
          dx = Math.round(dx)
          dy = Math.round(dy)
        }
      } else {
        // Point matching in pixel space
        const parentIdx = comp.arg1
        const childIdx = comp.arg2
        const parentPoint = resolveHintedPoint(
          parentIdx, x, y, totalPointCount, parentPhantoms.x, parentPhantoms.y,
          `Composite glyph ${glyphId}: point-matching parent point`,
        )
        const childPoint = resolveHintedChildPoint(
          childIdx, tx, ty, child, comp,
          `Composite glyph ${glyphId}: point-matching child point`,
        )
        dx = parentPoint.x - childPoint.x
        dy = parentPoint.y - childPoint.y
        orusDx = dx / xScale
        orusDy = dy / yScale
      }

      const base = x.length
      for (let i = 0; i < cn; i++) {
        x.push(tx[i]! + dx)
        y.push(ty[i]! + dy)
        orusX.push(tux[i]! + orusDx)
        orusY.push(tuy[i]! + orusDy)
        flags.push(child.flags[i]!)
      }
      for (let c = 0; c < child.endPts.length; c++) {
        endPts.push(base + child.endPts[c]!)
      }
      if ((comp.flags & 0x0200) !== 0) {
        const px = new Array<number>(4)
        const py = new Array<number>(4)
        for (let p = 0; p < 4; p++) {
          px[p] = comp.scaleX * child.phantomX[p]! + comp.scale10 * child.phantomY[p]! + dx
          py[p] = comp.scale01 * child.phantomX[p]! + comp.scaleY * child.phantomY[p]! + dy
        }
        parentPhantoms = { x: px, y: py, orusX: px.slice(), orusY: py.slice() }
      }
    }

    if (x.length > this.deps.maxp.maxCompositePoints!) {
      throw new Error(`Composite glyph ${glyphId}: ${x.length} points exceed maxp.maxCompositePoints ${this.deps.maxp.maxCompositePoints}`)
    }
    if (endPts.length > this.deps.maxp.maxCompositeContours!) {
      throw new Error(`Composite glyph ${glyphId}: ${endPts.length} contours exceed maxp.maxCompositeContours ${this.deps.maxp.maxCompositeContours}`)
    }

    if (executeInstructions && instructions.length > 0) {
      const compositeOrusX = new Array<number>(x.length)
      const compositeOrusY = new Array<number>(y.length)
      for (let i = 0; i < x.length; i++) {
        compositeOrusX[i] = x[i]! / xScale
        compositeOrusY[i] = y[i]! / yScale
      }
      const compositePhantomOrusX = new Array<number>(4)
      const compositePhantomOrusY = new Array<number>(4)
      for (let i = 0; i < 4; i++) {
        compositePhantomOrusX[i] = parentPhantoms.x[i]! / xScale
        compositePhantomOrusY[i] = parentPhantoms.y[i]! / yScale
      }
      const result = this.runInstructions(
        interp, x, y, compositeOrusX, compositeOrusY, flags, endPts,
        parentPhantoms.x, parentPhantoms.y, compositePhantomOrusX, compositePhantomOrusY, instructions,
      )
      anyInstructed = true
      return {
        endPts, flags, x, y, orusX, orusY, instructed: anyInstructed, advance: result.advance,
        phantomX: result.phantomX, phantomY: result.phantomY,
      }
    }
    return {
      endPts, flags, x, y, orusX, orusY, instructed: anyInstructed,
      advance: parentPhantoms.x[1]! - parentPhantoms.x[0]!,
      phantomX: parentPhantoms.x,
      phantomY: parentPhantoms.y,
    }
  }

  /** Builds the glyph zone (with phantom points) and executes a glyph program */
  private runInstructions(
    interp: TrueTypeInterpreter,
    x: number[], y: number[],
    orusX: number[], orusY: number[],
    flags: number[],
    endPts: number[] | Uint16Array,
    phantomX: number[],
    phantomY: number[],
    phantomOrusX: readonly number[],
    phantomOrusY: readonly number[],
    instructions: Uint8Array,
  ): { advance: number, phantomX: number[], phantomY: number[] } {
    const n = x.length
    const points: ZonePoint[] = new Array(n + 4)
    for (let i = 0; i < n; i++) {
      points[i] = {
        x: x[i]!, y: y[i]!, origX: x[i]!, origY: y[i]!, orusX: orusX[i]!, orusY: orusY[i]!, touchedX: false, touchedY: false,
        onCurve: (flags[i]! & ON_CURVE_POINT) !== 0,
      }
    }

    for (let p = 0; p < 4; p++) {
      points[n + p] = {
        x: phantomX[p]!, y: phantomY[p]!, origX: phantomX[p]!, origY: phantomY[p]!,
        orusX: phantomOrusX[p]!, orusY: phantomOrusY[p]!,
        touchedX: false, touchedY: false, onCurve: true,
      }
    }

    interp.setGlyphZone(points, endPts)
    interp.executeGlyphProgram(instructions)

    for (let i = 0; i < n; i++) {
      x[i] = points[i]!.x
      y[i] = points[i]!.y
      flags[i] = points[i]!.onCurve ? flags[i]! | ON_CURVE_POINT : flags[i]! & ~ON_CURVE_POINT
    }
    for (let p = 0; p < 4; p++) {
      phantomX[p] = points[n + p]!.x
      phantomY[p] = points[n + p]!.y
    }
    return { advance: phantomX[1]! - phantomX[0]!, phantomX, phantomY }
  }

  private buildScaledPhantoms(
    glyphId: number,
    xMin: number,
    yMax: number,
    xScaleFixed: number,
    yScaleFixed: number,
    deltaX: readonly number[],
    deltaY: readonly number[],
    roundPhantoms: boolean,
  ): { x: number[], y: number[], orusX: number[], orusY: number[] } {
    const pp1 = xMin - this.deps.getLeftSideBearing(glyphId)
    const pp3 = yMax + this.deps.getTopSideBearing(glyphId)
    const orusX = [
      pp1 + deltaX[0]!,
      pp1 + this.deps.getAdvanceWidth(glyphId) + deltaX[1]!,
      deltaX[2]!,
      deltaX[3]!,
    ]
    const orusY = [
      deltaY[0]!,
      deltaY[1]!,
      pp3 + deltaY[2]!,
      pp3 - this.deps.getAdvanceHeight(glyphId) + deltaY[3]!,
    ]
    const x = [
      multiplyFixed(orusX[0]!, xScaleFixed),
      multiplyFixed(orusX[1]!, xScaleFixed),
      multiplyFixed(orusX[2]!, xScaleFixed),
      multiplyFixed(orusX[3]!, xScaleFixed),
    ]
    const y = [
      multiplyFixed(orusY[0]!, yScaleFixed),
      multiplyFixed(orusY[1]!, yScaleFixed),
      multiplyFixed(orusY[2]!, yScaleFixed),
      multiplyFixed(orusY[3]!, yScaleFixed),
    ]
    // The scaler rounds all four metric phantoms independently before the
    // glyph program: horizontal PP1/PP2 and vertical PP3/PP4.
    if (roundPhantoms) {
      x[0] = pixelRound(x[0]!)
      x[1] = pixelRound(x[1]!)
      y[2] = pixelRound(y[2]!)
      y[3] = pixelRound(y[3]!)
    }
    return { x, y, orusX, orusY }
  }

  private assertInstructionLength(glyphId: number, length: number): void {
    if (length > this.deps.maxp.maxSizeOfInstructions!) {
      throw new Error(`Glyph ${glyphId}: instruction length ${length} exceeds maxp.maxSizeOfInstructions ${this.deps.maxp.maxSizeOfInstructions}`)
    }
  }
}

function matrixIsStretched(matrix: NonNullable<TrueTypeHintingTransform['matrix']>): boolean {
  const xScaleSquared = matrix.xx * matrix.xx + matrix.yx * matrix.yx
  const yScaleSquared = matrix.xy * matrix.xy + matrix.yy * matrix.yy
  return Math.abs(xScaleSquared - yScaleSquared) > 1e-12
}

interface HintedBoundsPoint { x: number, y: number, on: boolean }
interface MutableHintedBounds { xMin: number, yMin: number, xMax: number, yMax: number }

function getHintedPointBounds(points: HintedPoints): { xMin: number, yMin: number, xMax: number, yMax: number } {
  if (points.x.length === 0) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  const bounds: MutableHintedBounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  let contourStart = 0
  for (let contour = 0; contour < points.endPts.length; contour++) {
    const contourEnd = points.endPts[contour]!
    const nodes: HintedBoundsPoint[] = []
    for (let i = contourStart; i <= contourEnd; i++) {
      nodes.push({ x: points.x[i]!, y: points.y[i]!, on: (points.flags[i]! & ON_CURVE_POINT) !== 0 })
    }
    const expanded: HintedBoundsPoint[] = []
    for (let i = 0; i < nodes.length; i++) {
      const current = nodes[i]!
      const next = nodes[(i + 1) % nodes.length]!
      expanded.push(current)
      if (!current.on && !next.on) expanded.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, on: true })
    }
    let firstOn = -1
    for (let i = 0; i < expanded.length; i++) if (expanded[i]!.on) { firstOn = i; break }
    if (firstOn >= 0) {
      let current = expanded[firstOn]!
      includeHintedBoundsPoint(bounds, current.x, current.y)
      let step = 1
      while (step <= expanded.length) {
        const next = expanded[(firstOn + step) % expanded.length]!
        if (next.on) {
          includeHintedBoundsPoint(bounds, next.x, next.y)
          current = next
          step++
        } else {
          const end = expanded[(firstOn + step + 1) % expanded.length]!
          includeQuadraticHintedBounds(bounds, current, next, end)
          current = end
          step += 2
        }
      }
    }
    contourStart = contourEnd + 1
  }
  return bounds
}

function includeHintedBoundsPoint(bounds: MutableHintedBounds, x: number, y: number): void {
  if (x < bounds.xMin) bounds.xMin = x
  if (x > bounds.xMax) bounds.xMax = x
  if (y < bounds.yMin) bounds.yMin = y
  if (y > bounds.yMax) bounds.yMax = y
}

function includeQuadraticHintedBounds(
  bounds: MutableHintedBounds,
  start: HintedBoundsPoint,
  control: HintedBoundsPoint,
  end: HintedBoundsPoint,
): void {
  includeHintedBoundsPoint(bounds, end.x, end.y)
  const xDenominator = start.x - 2 * control.x + end.x
  if (xDenominator !== 0) {
    const t = (start.x - control.x) / xDenominator
    if (t > 0 && t < 1) includeHintedBoundsPoint(bounds, quadraticValue(start.x, control.x, end.x, t), quadraticValue(start.y, control.y, end.y, t))
  }
  const yDenominator = start.y - 2 * control.y + end.y
  if (yDenominator !== 0) {
    const t = (start.y - control.y) / yDenominator
    if (t > 0 && t < 1) includeHintedBoundsPoint(bounds, quadraticValue(start.x, control.x, end.x, t), quadraticValue(start.y, control.y, end.y, t))
  }
}

function quadraticValue(start: number, control: number, end: number, t: number): number {
  const inverse = 1 - t
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end
}

const EMPTY_BYTES = new Uint8Array(0)

function pixelRound(value: number): number {
  return Math.floor((value + 32) / 64) * 64
}

function resolveHintedPoint(
  index: number,
  x: readonly number[],
  y: readonly number[],
  finalPointCount: number,
  phantomX: readonly number[],
  phantomY: readonly number[],
  label: string,
): { x: number, y: number } {
  if (index < x.length) return { x: x[index]!, y: y[index]! }
  const phantomIndex = index - finalPointCount
  if (phantomIndex >= 0 && phantomIndex < 4) {
    return { x: phantomX[phantomIndex]!, y: phantomY[phantomIndex]! }
  }
  throw new Error(`${label} ${index} out of range (${x.length} incorporated points, ${finalPointCount} final points)`)
}

function resolveHintedChildPoint(
  index: number,
  x: readonly number[],
  y: readonly number[],
  child: HintedPoints,
  transform: CompositeComponent,
  label: string,
): { x: number, y: number } {
  if (index < x.length) return { x: x[index]!, y: y[index]! }
  const phantomIndex = index - child.x.length
  if (phantomIndex >= 0 && phantomIndex < 4) {
    const px = child.phantomX[phantomIndex]!
    const py = child.phantomY[phantomIndex]!
    return {
      x: transform.scaleX * px + transform.scale10 * py,
      y: transform.scale01 * px + transform.scaleY * py,
    }
  }
  throw new Error(`${label} ${index} out of range (${child.x.length} contour points)`)
}

function toNumberArray(src: Uint16Array | Uint8Array | number[]): number[] {
  if (Array.isArray(src)) return src
  const out: number[] = new Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i]!
  return out
}
