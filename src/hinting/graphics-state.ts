/**
 * TrueType Hinting Graphics State
 * Manages the graphics state of the hinting interpreter
 */

/** 2D vector (unit vector equivalent to F2Dot14) */
export interface Vec2 {
  x: number
  y: number
}

/** Point within a zone */
export interface ZonePoint {
  x: number       // Current X coordinate (F26Dot6)
  y: number       // Current Y coordinate (F26Dot6)
  origX: number   // Original X coordinate
  origY: number   // Original Y coordinate
  orusX: number   // Original unscaled X coordinate in font units
  orusY: number   // Original unscaled Y coordinate in font units
  touchedX: boolean // X-axis touch flag referenced by IUP[x]
  touchedY: boolean // Y-axis touch flag referenced by IUP[y]
  onCurve: boolean // Contour point kind modified by FLIP instructions
}

/** Zone (twilight=0, glyph=1) */
export interface Zone {
  points: ZonePoint[]
}

/** Round state */
export const enum RoundState {
  TO_HALF_GRID = 0,
  TO_GRID = 1,
  TO_DOUBLE_GRID = 2,
  DOWN_TO_GRID = 3,
  UP_TO_GRID = 4,
  OFF = 5,
  SUPER = 6,
  SUPER_45 = 7,
}

/** Graphics State — state referenced and modified by all hinting instructions */
export class GraphicsState {
  // ── Vectors ──
  freedomVector: Vec2 = { x: 1, y: 0 }
  projectionVector: Vec2 = { x: 1, y: 0 }
  dualProjectionVector: Vec2 = { x: 1, y: 0 }

  // ── Zone pointers ──
  zp0 = 1
  zp1 = 1
  zp2 = 1

  // ── Reference points ──
  rp0 = 0
  rp1 = 0
  rp2 = 0

  // ── Loop counter ──
  loop = 1

  // ── Rounding ──
  roundState: RoundState = RoundState.TO_GRID
  superRoundPhase = 0
  superRoundPeriod = 0
  superRoundThreshold = 0

  // ── Minimum distance ──
  minimumDistance = 64 // 1 pixel in F26Dot6

  // ── CVT cut-in ──
  controlValueCutIn = 68 // 17/16 pixel in F26Dot6

  // ── Single width ──
  singleWidthCutIn = 0
  singleWidthValue = 0

  // ── Deprecated angle weight (retained for SANGW semantics) ──
  angleWeight = 0

  // ── Delta base ──
  deltaBase = 9
  deltaShift = 3

  // ── Auto flip ──
  autoFlip = true

  // ── Scan conversion ──
  scanControl = 0
  scanType = 0

  // ── InstructControl ──
  instructControl = 0

  /** Reset the Graphics State to default values */
  reset(): void {
    this.freedomVector = { x: 1, y: 0 }
    this.projectionVector = { x: 1, y: 0 }
    this.dualProjectionVector = { x: 1, y: 0 }
    this.zp0 = 1
    this.zp1 = 1
    this.zp2 = 1
    this.rp0 = 0
    this.rp1 = 0
    this.rp2 = 0
    this.loop = 1
    this.roundState = RoundState.TO_GRID
    this.minimumDistance = 64
    this.controlValueCutIn = 68
    this.singleWidthCutIn = 0
    this.singleWidthValue = 0
    this.angleWeight = 0
    this.deltaBase = 9
    this.deltaShift = 3
    this.autoFlip = true
    this.scanControl = 0
    this.scanType = 0
    this.instructControl = 0
  }

  copyFrom(source: GraphicsState): void {
    this.freedomVector = { ...source.freedomVector }
    this.projectionVector = { ...source.projectionVector }
    this.dualProjectionVector = { ...source.dualProjectionVector }
    this.zp0 = source.zp0
    this.zp1 = source.zp1
    this.zp2 = source.zp2
    this.rp0 = source.rp0
    this.rp1 = source.rp1
    this.rp2 = source.rp2
    this.loop = source.loop
    this.roundState = source.roundState
    this.superRoundPhase = source.superRoundPhase
    this.superRoundPeriod = source.superRoundPeriod
    this.superRoundThreshold = source.superRoundThreshold
    this.minimumDistance = source.minimumDistance
    this.controlValueCutIn = source.controlValueCutIn
    this.singleWidthCutIn = source.singleWidthCutIn
    this.singleWidthValue = source.singleWidthValue
    this.angleWeight = source.angleWeight
    this.deltaBase = source.deltaBase
    this.deltaShift = source.deltaShift
    this.autoFlip = source.autoFlip
    this.scanControl = source.scanControl
    this.scanType = source.scanType
    this.instructControl = source.instructControl
  }
}
