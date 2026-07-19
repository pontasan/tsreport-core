import { describe, it, expect, vi } from 'vitest'
import { Font } from '../../src/font.js'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import { buildTable, buildTestFont, encodeSimpleGlyph } from './synthetic-font.js'

/**
 * CanvasBackend hinting option: opt-in grid-fitting at the effective raster
 * ppem (fontSize x scale x devicePixelRatio). Default stays unhinted.
 */

// SVTCA[X], PUSHB[1] 0, MDAP[rnd]: rounds point 0's x to the pixel grid
const MDAP_INSTRUCTIONS = new Uint8Array([0xB1, 4, 3, 0x8E, 0x01, 0xB0, 0, 0x2F])

const SQUARE: [number, number][] = [[100, 100], [300, 100], [300, 300], [100, 300]]

function createRecordingCtx() {
  const moveTos: [number, number][] = []
  const fillRects: [number, number, number, number][] = []
  return {
    moveTos,
    fillRects,
    ctx: {
      canvas: { width: 0, height: 0, style: {} },
      save: vi.fn(), restore: vi.fn(),
      setTransform: vi.fn(), transform: vi.fn(), translate: vi.fn(),
      beginPath: vi.fn(), closePath: vi.fn(),
      moveTo: vi.fn((x: number, y: number) => moveTos.push([x, y])),
      lineTo: vi.fn(), bezierCurveTo: vi.fn(),
      rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      fillRect: vi.fn((x: number, y: number, width: number, height: number) => fillRects.push([x, y, width, height])), setLineDash: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 0,
    },
  }
}

function loadHintedFont(): Font {
  return Font.load(buildTestFont(
    [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
    [[0x41, 1]],
  ))
}

function buildDeviceTables(): [string, Uint8Array][] {
  const hdmx = buildTable(function build(w) {
    w.writeUint16(0); w.writeUint16(1); w.writeUint32(4)
    w.writeUint8(16); w.writeUint8(10); w.writeUint8(0); w.writeUint8(10)
  })
  const ltsh = buildTable(function build(w) {
    w.writeUint16(0); w.writeUint16(2); w.writeUint8(1); w.writeUint8(20)
  })
  return [['LTSH', ltsh], ['hdmx', hdmx]]
}

describe('CanvasBackend hinting option', () => {
  it('is off by default (plain outline coordinates)', () => {
    const font = loadHintedFont()
    const { ctx, moveTos } = createRecordingCtx()
    const backend = new CanvasBackend(ctx, { fonts: { f1: font }, background: null, devicePixelRatio: 1 })
    backend.beginPage(100, 100)
    moveTos.length = 0
    // fontSize 16 → s = 0.016; unhinted x = 100 → drawX 0 + 1.6
    backend.drawText(0, 0, 'A', 'f1', 16, '#000000')
    expect(moveTos.length).toBeGreaterThan(0)
    expect(moveTos[0]![0]).toBeCloseTo(1.6, 4)
  })

  it('applies grid-fitting at fontSize x scale x dpr when enabled', () => {
    const font = loadHintedFont()
    const { ctx, moveTos } = createRecordingCtx()
    const backend = new CanvasBackend(ctx, {
      fonts: { f1: font }, background: null, devicePixelRatio: 1, hinting: true,
    })
    backend.beginPage(100, 100)
    moveTos.length = 0
    // ppem 16: x = 100 units → 1.6px → grid-fits to 2px → 125 units → 2.0pt
    backend.drawText(0, 0, 'A', 'f1', 16, '#000000')
    expect(moveTos.length).toBeGreaterThan(0)
    expect(moveTos[0]![0]).toBeCloseTo(2.0, 4)
  })

  it('uses the devicePixelRatio for the hinting ppem', () => {
    const font = loadHintedFont()
    const { ctx, moveTos } = createRecordingCtx()
    const backend = new CanvasBackend(ctx, {
      fonts: { f1: font }, background: null, devicePixelRatio: 2, hinting: true,
    })
    backend.beginPage(100, 100)
    moveTos.length = 0
    // ppem 32: x = 100 units → 3.2px → grid-fits to 3px → 93.75 units → 1.5pt
    backend.drawText(0, 0, 'A', 'f1', 16, '#000000')
    expect(moveTos.length).toBeGreaterThan(0)
    expect(moveTos[0]![0]).toBeCloseTo(1.5, 4)
  })

  it('draws SCANCTRL/SCANTYPE dropout output as device pixels', () => {
    const scanInstructions = new Uint8Array([
      0xB1, 4, 3, 0x8E,
      0xB8, 0x01, 0xFF, 0x85,
      0xB0, 0, 0x8D,
    ])
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph([[110, 0], [130, 0], [130, 300], [110, 300]], [3], scanInstructions)],
      [[0x49, 1]],
    ))
    const recording = createRecordingCtx()
    const backend = new CanvasBackend(recording.ctx, {
      fonts: { f1: font }, background: null, devicePixelRatio: 1, hinting: true,
    })
    backend.beginPage(100, 100)
    recording.moveTos.length = 0
    recording.fillRects.length = 0
    backend.drawText(0, 20, 'I', 'f1', 16, '#000000')
    expect(recording.fillRects.length).toBeGreaterThan(0)
    expect(recording.moveTos).toHaveLength(0)
  })

  it('uses the shared hdmx/LTSH decision for direct raster glyph positioning', () => {
    const font = Font.load(buildTestFont(
      [null, encodeSimpleGlyph(SQUARE, [3], MDAP_INSTRUCTIONS)],
      [[0x41, 1]],
      buildDeviceTables(),
      0x0010,
    ))
    const { ctx, moveTos } = createRecordingCtx()
    const backend = new CanvasBackend(ctx, {
      fonts: { f1: font }, background: null, devicePixelRatio: 1, hinting: true,
    })
    backend.beginPage(100, 100)
    moveTos.length = 0
    backend.drawText(0, 0, 'AA', 'f1', 16, '#000000')
    expect(moveTos.length).toBeGreaterThanOrEqual(2)
    expect(moveTos[1]![0] - moveTos[0]![0]).toBeCloseTo(10, 4)
  })
})

// Invalid TrueType programs are rejected instead of being rendered through an
// unhinted fallback. macOS Courier.ttc face 2 exceeds its declared maxp stack
// profile and provides a stable negative fixture.
import { existsSync, readFileSync } from 'node:fs'
const COURIER = '/System/Library/Fonts/Courier.ttc'
describe.skipIf(!existsSync(COURIER))('invalid hint programs propagate interpreter errors', () => {
  it('rejects a hint program that exceeds its declared stack profile', () => {
    const font = Font.load(readFileSync(COURIER).buffer as ArrayBuffer, { fontIndex: 2 })
    const gid = font.getGlyphId(0x41)
    expect(() => font.getHintedGlyph(gid, 16)).toThrow('exceeds maxp.maxStackElements')
  })
})
