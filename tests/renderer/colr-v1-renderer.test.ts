import { describe, it, expect, vi } from 'vitest'
import type { Font } from '../../src/font.js'
import type { PaintNode, ClipBox } from '../../src/parsers/tables/colr.js'
import {
  resolveColor,
  resolveColorLine,
  sampleColorLine,
  colorToRgba,
  parseForegroundColor,
  renderColrV1Glyph,
  type ColrV1PaintOps,
  type ResolvedColor,
  type ResolvedColorStop,
} from '../../src/renderer/colr-v1-renderer.js'

// ─── Helpers ───

function createMockFont(options?: {
  paletteColors?: Map<number, { r: number, g: number, b: number, a: number }>
  paintTree?: PaintNode | null
  clipBox?: ClipBox | null
}): Font {
  const paletteColors = options?.paletteColors ?? new Map()
  return {
    getColorFromSelectedPalette: (colorIdx: number) => {
      return paletteColors.get(colorIdx) ?? null
    },
    getPaintTree: (_gid: number) => options?.paintTree ?? null,
    getClipBox: (_gid: number) => options?.clipBox ?? null,
    getGlyph: (_gid: number) => ({
      outline: {
        commands: new Uint8Array([0, 1, 1, 1, 3]),
        coords: new Float32Array([0, 0, 500, 0, 500, 700, 0, 700]),
      },
    }),
  } as unknown as Font
}

function createMockOps(): ColrV1PaintOps & { calls: { method: string, args: unknown[] }[] } {
  const calls: { method: string, args: unknown[] }[] = []
  return {
    calls,
    save() { calls.push({ method: 'save', args: [] }) },
    restore() { calls.push({ method: 'restore', args: [] }) },
    transform(xx, yx, xy, yy, dx, dy) { calls.push({ method: 'transform', args: [xx, yx, xy, yy, dx, dy] }) },
    clipGlyph(font, glyphId, scale, cx, baseY) { calls.push({ method: 'clipGlyph', args: [glyphId, scale, cx, baseY] }) },
    clipRect(xMin, yMin, xMax, yMax, scale, cx, baseY) { calls.push({ method: 'clipRect', args: [xMin, yMin, xMax, yMax, scale, cx, baseY] }) },
    fillSolid(color) { calls.push({ method: 'fillSolid', args: [color] }) },
    fillLinearGradient(x0, y0, x1, y1, x2, y2, stops, extend, scale, cx, baseY) {
      calls.push({ method: 'fillLinearGradient', args: [x0, y0, x1, y1, x2, y2, stops, extend, scale, cx, baseY] })
    },
    fillRadialGradient(x0, y0, r0, x1, y1, r1, stops, extend, scale, cx, baseY) {
      calls.push({ method: 'fillRadialGradient', args: [x0, y0, r0, x1, y1, r1, stops, extend, scale, cx, baseY] })
    },
    fillSweepGradient(centerX, centerY, startAngle, endAngle, stops, extend, scale, cx, baseY) {
      calls.push({ method: 'fillSweepGradient', args: [centerX, centerY, startAngle, endAngle, stops, extend, scale, cx, baseY] })
    },
    setCompositeMode(mode) { calls.push({ method: 'setCompositeMode', args: [mode] }) },
    resetCompositeMode() { calls.push({ method: 'resetCompositeMode', args: [] }) },
  }
}

// ─── Color resolution tests ───

describe('resolveColor', () => {
  const fg: ResolvedColor = { r: 1, g: 0.5, b: 0, a: 1 }

  // Verifies the special palette index 0xFFFF resolves to the foreground color with alpha applied.
  it('paletteIndex=0xFFFF でフォアグラウンド色を返す', () => {
    const font = createMockFont()
    const c = resolveColor(font, 0xFFFF, 0.8, fg)
    expect(c.r).toBe(1)
    expect(c.g).toBe(0.5)
    expect(c.b).toBe(0)
    expect(c.a).toBeCloseTo(0.8)
  })

  // Verifies a CPAL palette entry is resolved and normalized from 0-255 to 0-1 range.
  it('パレットカラーを解決する', () => {
    const font = createMockFont({
      paletteColors: new Map([[2, { r: 255, g: 128, b: 0, a: 255 }]]),
    })
    const c = resolveColor(font, 2, 1.0, fg)
    expect(c.r).toBe(1)
    expect(c.g).toBeCloseTo(128 / 255)
    expect(c.b).toBe(0)
    expect(c.a).toBe(1)
  })

  // Verifies an invalid COLR palette reference is rejected instead of inventing a color.
  it('パレットカラーが見つからない場合は拒否する', () => {
    const font = createMockFont()
    expect(() => resolveColor(font, 99, 0.5, fg)).toThrow('requires a CPAL color')
  })

  // Verifies the paint alpha is multiplied with the palette entry's own alpha.
  it('alpha が乗算される（パレットカラー）', () => {
    const font = createMockFont({
      paletteColors: new Map([[0, { r: 255, g: 255, b: 255, a: 128 }]]),
    })
    const c = resolveColor(font, 0, 0.5, fg)
    expect(c.a).toBeCloseTo((128 / 255) * 0.5)
  })
})

describe('resolveColorLine', () => {
  // Verifies each ColorLine stop is resolved to an offset + RGBA color and extend mode is preserved.
  it('ColorLine の stops を解決する', () => {
    const font = createMockFont({
      paletteColors: new Map([
        [0, { r: 255, g: 0, b: 0, a: 255 }],
        [1, { r: 0, g: 0, b: 255, a: 255 }],
      ]),
    })
    const fg: ResolvedColor = { r: 0, g: 0, b: 0, a: 1 }
    const result = resolveColorLine(font, {
      extend: 0, // PAD
      stops: [
        { stopOffset: 0, paletteIndex: 0, alpha: 1 },
        { stopOffset: 1, paletteIndex: 1, alpha: 0.5 },
      ],
    }, fg)

    expect(result.extend).toBe(0)
    expect(result.stops).toHaveLength(2)
    expect(result.stops[0]!.offset).toBe(0)
    expect(result.stops[0]!.color.r).toBe(1) // 255/255
    expect(result.stops[1]!.offset).toBe(1)
    expect(result.stops[1]!.color.b).toBe(1) // 255/255
    expect(result.stops[1]!.color.a).toBe(0.5)
  })
})

// ─── Color sampling tests ───

describe('sampleColorLine', () => {
  const stops: ResolvedColorStop[] = [
    { offset: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { offset: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
  ]

  // Verifies sampling at t=0 returns the first stop's color.
  it('t=0 で最初の色を返す', () => {
    const c = sampleColorLine(stops, 0)
    expect(c.r).toBe(1)
    expect(c.b).toBe(0)
  })

  // Verifies sampling at t=1 returns the last stop's color.
  it('t=1 で最後の色を返す', () => {
    const c = sampleColorLine(stops, 1)
    expect(c.r).toBe(0)
    expect(c.b).toBe(1)
  })

  // Verifies sampling at t=0.5 linearly interpolates between the two stops.
  it('t=0.5 で中間色を返す', () => {
    const c = sampleColorLine(stops, 0.5)
    expect(c.r).toBeCloseTo(0.5)
    expect(c.b).toBeCloseTo(0.5)
  })

  // Verifies an empty stop list yields transparent black.
  it('空の stops で黒透明を返す', () => {
    const c = sampleColorLine([], 0.5)
    expect(c.r).toBe(0)
    expect(c.a).toBe(0)
  })

  // Verifies a single stop always returns that stop's color regardless of t.
  it('1つの stop で常にその色を返す', () => {
    const single = [{ offset: 0.5, color: { r: 0, g: 1, b: 0, a: 1 } }]
    const c = sampleColorLine(single, 0.8)
    expect(c.g).toBe(1)
  })

  // Verifies t values outside [0,1] are clamped to the edge stop colors.
  it('t が範囲外のとき端の色を返す', () => {
    expect(sampleColorLine(stops, -1).r).toBe(1)
    expect(sampleColorLine(stops, 2).b).toBe(1)
  })
})

// ─── CSS conversion tests ───

describe('colorToRgba', () => {
  // Verifies a normalized RGBA color is formatted as a CSS rgba() string with 0-255 channels.
  it('RGBA を CSS 文字列に変換する', () => {
    expect(colorToRgba({ r: 1, g: 0, b: 0.5, a: 0.8 })).toBe('rgba(255,0,128,0.8)')
  })
})

describe('parseForegroundColor', () => {
  // Verifies 3-digit #RGB hex notation is parsed with full opacity.
  it('#RGB をパースする', () => {
    const c = parseForegroundColor('#F00')
    expect(c.r).toBe(1)
    expect(c.g).toBe(0)
    expect(c.b).toBe(0)
    expect(c.a).toBe(1)
  })

  // Verifies 6-digit #RRGGBB hex notation is parsed into normalized channels.
  it('#RRGGBB をパースする', () => {
    const c = parseForegroundColor('#FF8000')
    expect(c.r).toBe(1)
    expect(c.g).toBeCloseTo(128 / 255)
    expect(c.b).toBe(0)
  })

  // Verifies 8-digit #RRGGBBAA hex notation parses the alpha channel.
  it('#RRGGBBAA をパースする', () => {
    const c = parseForegroundColor('#FF000080')
    expect(c.r).toBe(1)
    expect(c.a).toBeCloseTo(128 / 255)
  })

  // Verifies an unrecognized color string falls back to opaque black.
  it('不明な形式で黒を返す', () => {
    const c = parseForegroundColor('invalid')
    expect(c.r).toBe(0)
    expect(c.a).toBe(1)
  })
})

// ─── Paint tree walker tests ───

describe('renderColrV1Glyph', () => {
  // Verifies a glyph without a COLR v1 paint tree emits no paint operations.
  it('paintTree がない場合は何もしない', () => {
    const font = createMockFont({ paintTree: null })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 100, 200, { r: 0, g: 0, b: 0, a: 1 })
    expect(ops.calls).toHaveLength(0)
  })

  // Verifies a ClipBox wraps the entire paint sequence in save/clipRect ... restore.
  it('ClipBox がある場合は save/clipRect/restore で囲む', () => {
    const font = createMockFont({
      paintTree: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
      clipBox: { format: 1, xMin: 0, yMin: 0, xMax: 1000, yMax: 1000 },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 100, 200, { r: 0, g: 0, b: 0, a: 1 })

    expect(ops.calls[0]!.method).toBe('save')
    expect(ops.calls[1]!.method).toBe('clipRect')
    expect(ops.calls[ops.calls.length - 1]!.method).toBe('restore')
  })

  // Verifies a PaintSolid node results in a fillSolid call with the resolved color.
  it('Solid ノードで fillSolid が呼ばれる', () => {
    const font = createMockFont({
      paintTree: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 100, 200, { r: 1, g: 0, b: 0, a: 1 })

    const fillCall = ops.calls.find(c => c.method === 'fillSolid')
    expect(fillCall).toBeTruthy()
    expect((fillCall!.args[0] as ResolvedColor).r).toBe(1)
  })

  // Verifies PaintColrLayers paints its child layers in order (bottom to top).
  it('ColrLayers ノードで子を順番に描画する', () => {
    const font = createMockFont({
      paintTree: {
        type: 'ColrLayers',
        layers: [
          { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
          { type: 'Solid', paletteIndex: 0xFFFF, alpha: 0.5 },
        ],
      },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 100, 200, { r: 1, g: 0, b: 0, a: 1 })

    const fills = ops.calls.filter(c => c.method === 'fillSolid')
    expect(fills).toHaveLength(2)
    expect((fills[0]!.args[0] as ResolvedColor).a).toBe(1)
    expect((fills[1]!.args[0] as ResolvedColor).a).toBe(0.5)
  })

  // Verifies a PaintGlyph node clips to the glyph outline before painting, wrapped in save/restore.
  it('Glyph ノードで save/clipGlyph/paint/restore が実行される', () => {
    const font = createMockFont({
      paintTree: {
        type: 'Glyph',
        glyphId: 42,
        paint: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
      },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 100, 200, { r: 0, g: 0, b: 0, a: 1 })

    const methods = ops.calls.map(c => c.method)
    expect(methods).toContain('save')
    expect(methods).toContain('clipGlyph')
    expect(methods).toContain('fillSolid')
    expect(methods).toContain('restore')
  })

  // Verifies PaintTranslate scales the offsets and negates dy for the Y-down device space.
  it('Translate ノードで transform(1,0,0,1,dx,-dy) が実行される', () => {
    const font = createMockFont({
      paintTree: {
        type: 'Translate',
        dx: 100,
        dy: 200,
        paint: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
      },
    })
    const ops = createMockOps()
    const scale = 0.02
    renderColrV1Glyph(font, 1, ops, scale, 0, 0, { r: 0, g: 0, b: 0, a: 1 })

    const transformCall = ops.calls.find(c => c.method === 'transform')
    expect(transformCall).toBeTruthy()
    expect(transformCall!.args[0]).toBe(1)  // xx
    expect(transformCall!.args[1]).toBe(0)  // yx
    expect(transformCall!.args[2]).toBe(0)  // xy
    expect(transformCall!.args[3]).toBe(1)  // yy
    expect(transformCall!.args[4]).toBeCloseTo(100 * scale)  // dx
    expect(transformCall!.args[5]).toBeCloseTo(-200 * scale) // -dy (Y flip)
  })

  // Verifies PaintScale emits a transform with scaleX/scaleY on the diagonal.
  it('Scale ノードで transform(scaleX,0,0,scaleY,0,0) が実行される', () => {
    const font = createMockFont({
      paintTree: {
        type: 'Scale',
        scaleX: 2,
        scaleY: 0.5,
        paint: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
      },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 0, 0, { r: 0, g: 0, b: 0, a: 1 })

    const transformCall = ops.calls.find(c => c.method === 'transform')
    expect(transformCall!.args[0]).toBe(2)   // scaleX
    expect(transformCall!.args[3]).toBe(0.5) // scaleY
  })

  // Verifies PaintComposite order: backdrop paint, setCompositeMode, source paint, then resetCompositeMode.
  it('Composite ノードで backdrop → setCompositeMode → source → resetCompositeMode が実行される', () => {
    const font = createMockFont({
      paintTree: {
        type: 'Composite',
        compositeMode: 3, // SRC_OVER
        backdrop: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
        source: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 0.5 },
      },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 0, 0, { r: 0, g: 0, b: 0, a: 1 })

    const methods = ops.calls.map(c => c.method)
    const backdropIdx = methods.indexOf('fillSolid')
    const modeIdx = methods.indexOf('setCompositeMode')
    const sourceIdx = methods.lastIndexOf('fillSolid')
    const resetIdx = methods.indexOf('resetCompositeMode')

    expect(backdropIdx).toBeLessThan(modeIdx)
    expect(modeIdx).toBeLessThan(sourceIdx)
    expect(sourceIdx).toBeLessThan(resetIdx)
  })

  // Verifies a PaintLinearGradient node dispatches to the fillLinearGradient op.
  it('LinearGradient ノードで fillLinearGradient が呼ばれる', () => {
    const font = createMockFont({
      paletteColors: new Map([
        [0, { r: 255, g: 0, b: 0, a: 255 }],
        [1, { r: 0, g: 0, b: 255, a: 255 }],
      ]),
      paintTree: {
        type: 'LinearGradient',
        x0: 0, y0: 0, x1: 1000, y1: 0, x2: 0, y2: 1000,
        colorLine: {
          extend: 0,
          stops: [
            { stopOffset: 0, paletteIndex: 0, alpha: 1 },
            { stopOffset: 1, paletteIndex: 1, alpha: 1 },
          ],
        },
      },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 0, 0, { r: 0, g: 0, b: 0, a: 1 })

    const gradCall = ops.calls.find(c => c.method === 'fillLinearGradient')
    expect(gradCall).toBeTruthy()
  })

  // Verifies PaintRotate converts turns to a cos/sin rotation matrix with Y-axis handedness flipped.
  it('Rotate ノードで正しい cos/sin 行列が設定される', () => {
    const font = createMockFont({
      paintTree: {
        type: 'Rotate',
        angle: 0.25, // 90 degrees (in turns)
        paint: { type: 'Solid', paletteIndex: 0xFFFF, alpha: 1 },
      },
    })
    const ops = createMockOps()
    renderColrV1Glyph(font, 1, ops, 0.01, 0, 0, { r: 0, g: 0, b: 0, a: 1 })

    const transformCall = ops.calls.find(c => c.method === 'transform')
    expect(transformCall).toBeTruthy()
    // angle=0.25 turns → rad = -0.25*2*PI = -PI/2
    // cos(-PI/2) ≈ 0, sin(-PI/2) ≈ -1
    expect(transformCall!.args[0]).toBeCloseTo(0)   // cos
    expect(transformCall!.args[1]).toBeCloseTo(-1)  // sin
    expect(transformCall!.args[2]).toBeCloseTo(1)   // -sin
    expect(transformCall!.args[3]).toBeCloseTo(0)   // cos
  })
})
