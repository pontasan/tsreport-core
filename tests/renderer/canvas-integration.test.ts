/**
 * Canvas integration tests
 *
 * Verifies the CanvasBackend drawTextWithFont path using real Font instances.
 * Covers glyph outline drawing via the font engine, horizontal alignment,
 * decoration lines, Japanese text, mixed fonts, subset + reload, CSS fallback,
 * and renderPage integration.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { CanvasBackend } from '../../src/renderer/canvas-backend.js'
import { renderPage } from '../../src/renderer/renderer.js'
import type { RenderPage } from '../../src/types/render.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

// ─── Test fonts ───

let ttfFont: Font   // TrueType (Roboto)
let cffFont: Font   // CFF/OTF (SourceSans3)
let jpFont: Font    // CFF/OTF (NotoSansJP - Japanese CJK)

beforeAll(() => {
  const ttfBuf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  ttfFont = Font.load(ttfBuf.buffer as ArrayBuffer)

  const cffBuf = readFileSync(join(FIXTURES, 'SourceSans3-Regular.otf'))
  cffFont = Font.load(cffBuf.buffer as ArrayBuffer)

  const jpBuf = readFileSync(join(FIXTURES, 'NotoSansJP-Regular.otf'))
  jpFont = Font.load(jpBuf.buffer as ArrayBuffer)
})

// ─── Mock Canvas 2D context ───

function createMockCtx() {
  const calls: [string, ...unknown[]][] = []

  const ctx = {
    canvas: {
      width: 0,
      height: 0,
      style: { width: '', height: '' },
    },
    _calls: calls,
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textBaseline: '' as string,
    save: vi.fn(() => calls.push(['save'])),
    restore: vi.fn(() => calls.push(['restore'])),
    setTransform: vi.fn((...args: unknown[]) => calls.push(['setTransform', ...args])),
    translate: vi.fn((x: number, y: number) => calls.push(['translate', x, y])),
    beginPath: vi.fn(() => calls.push(['beginPath'])),
    closePath: vi.fn(() => calls.push(['closePath'])),
    moveTo: vi.fn((x: number, y: number) => calls.push(['moveTo', x, y])),
    lineTo: vi.fn((x: number, y: number) => calls.push(['lineTo', x, y])),
    bezierCurveTo: vi.fn((...args: unknown[]) => calls.push(['bezierCurveTo', ...args])),
    rect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(['rect', x, y, w, h])),
    ellipse: vi.fn((...args: unknown[]) => calls.push(['ellipse', ...args])),
    roundRect: vi.fn((...args: unknown[]) => calls.push(['roundRect', ...args])),
    clip: vi.fn(() => calls.push(['clip'])),
    fill: vi.fn(() => calls.push(['fill'])),
    stroke: vi.fn(() => calls.push(['stroke'])),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(['fillRect', x, y, w, h])),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(['strokeRect', x, y, w, h])),
    fillText: vi.fn((text: string, x: number, y: number) => calls.push(['fillText', text, x, y])),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    setLineDash: vi.fn((segments: number[]) => calls.push(['setLineDash', segments])),
    arcTo: vi.fn((...args: unknown[]) => calls.push(['arcTo', ...args])),
  }

  return ctx
}

// ─── Helpers ───

/** Filter recorded calls by method name */
function getCallsOfType(calls: [string, ...unknown[]][], method: string): [string, ...unknown[]][] {
  return calls.filter(c => c[0] === method)
}

/** Extract beginPath → fill cycles (one per drawn glyph) */
function extractGlyphDrawCycles(calls: [string, ...unknown[]][]): Array<{
  beginPathIdx: number
  fillIdx: number
  moveToCount: number
  lineToCount: number
  bezierCount: number
  closePathCount: number
}> {
  const cycles: Array<{
    beginPathIdx: number
    fillIdx: number
    moveToCount: number
    lineToCount: number
    bezierCount: number
    closePathCount: number
  }> = []

  let i = 0
  while (i < calls.length) {
    if (calls[i]![0] === 'beginPath') {
      const start = i
      let moveToCount = 0
      let lineToCount = 0
      let bezierCount = 0
      let closePathCount = 0
      i++
      while (i < calls.length && calls[i]![0] !== 'fill' && calls[i]![0] !== 'beginPath') {
        if (calls[i]![0] === 'moveTo') moveToCount++
        if (calls[i]![0] === 'lineTo') lineToCount++
        if (calls[i]![0] === 'bezierCurveTo') bezierCount++
        if (calls[i]![0] === 'closePath') closePathCount++
        i++
      }
      if (i < calls.length && calls[i]![0] === 'fill') {
        cycles.push({ beginPathIdx: start, fillIdx: i, moveToCount, lineToCount, bezierCount, closePathCount })
        i++
      }
    } else {
      i++
    }
  }

  return cycles
}

// ─── Tests ───

describe('Canvas Integration', () => {

  // ═══ 1. Glyph outline drawing - basic ═══
  describe('Glyph Outline Drawing - Basic', () => {
    it('reuses one Path2D for repeated instances of the same immutable glyph outline', () => {
      let constructionCount = 0
      class MockPath2D {
        moveTo = vi.fn()
        lineTo = vi.fn()
        bezierCurveTo = vi.fn()
        closePath = vi.fn()
        constructor() { constructionCount++ }
      }
      vi.stubGlobal('Path2D', MockPath2D)

      const ctx1 = createMockCtx()
      const transform1 = vi.fn((...args: unknown[]) => ctx1._calls.push(['transform', ...args]))
      ;(ctx1 as unknown as { transform: typeof transform1 }).transform = transform1
      const backend1 = new CanvasBackend(ctx1, { fonts: { default: ttfFont } })
      backend1.drawText(10, 20, 'AA', 'default', 12, '#000000')
      expect(constructionCount).toBe(1)
      expect(ctx1.fill).toHaveBeenCalledTimes(2)
      expect(transform1).toHaveBeenCalledTimes(2)

      const ctx2 = createMockCtx()
      const transform2 = vi.fn()
      ;(ctx2 as unknown as { transform: typeof transform2 }).transform = transform2
      new CanvasBackend(ctx2, { fonts: { default: ttfFont } }).drawText(10, 20, 'A', 'default', 12, '#000000')
      expect(constructionCount).toBe(1)
      expect(ctx2.fill).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    })

    // Verifies a TTF glyph produces one beginPath→fill cycle containing outline path commands.
    it('TTF "A" → beginPath/moveTo/lineTo/bezierCurveTo/closePath/fill 呼び出しシーケンス', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0  // clear beginPage calls
      backend.drawText(10, 20, 'A', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(1)
      // 'A' has an outline
      expect(cycles[0]!.moveToCount).toBeGreaterThanOrEqual(1)
      expect(cycles[0]!.lineToCount + cycles[0]!.bezierCount).toBeGreaterThan(0)
    })

    // Verifies a CFF glyph is also drawn as a beginPath→fill outline cycle.
    it('CFF "A" → beginPath/fill 呼び出しシーケンス', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: cffFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'A', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(1)
      expect(cycles[0]!.moveToCount).toBeGreaterThanOrEqual(1)
    })

    // Verifies glyph coordinates are mapped to canvas space via (cx + glyphX * s, baseY - glyphY * s).
    it('座標変換: (cx + glyphX * s, baseY - glyphY * s)', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      const fontSize = 24
      const m = ttfFont.metrics
      const s = fontSize / m.unitsPerEm
      const ascent = m.ascender * s

      ctx._calls.length = 0
      backend.drawText(50, 100, 'A', 'default', fontSize, '#000000')

      // verify the Y coordinate of the first moveTo
      // baseY = y + ascent = 100 + ascent
      const baseY = 100 + ascent
      const moveToCalls = getCallsOfType(ctx._calls, 'moveTo')
      expect(moveToCalls.length).toBeGreaterThan(0)

      // moveTo Y should be baseY - glyphY * s
      // glyphY is positive (upward), so the Canvas Y is usually <= baseY
      const firstMoveToY = moveToCalls[0]![2] as number
      // should be near baseY (within about ±fontSize)
      expect(firstMoveToY).toBeGreaterThan(baseY - fontSize * 2)
      expect(firstMoveToY).toBeLessThan(baseY + fontSize)
    })

    // Verifies the text color is applied to fillStyle for glyph outline fills.
    it('fillStyle にテキスト色が設定される', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      backend.drawText(10, 20, 'A', 'default', 12, '#FF0000')

      expect(ctx.fillStyle).toBe('#FF0000')
    })

    // Verifies a glyph with an empty outline (space) produces no beginPath→fill cycle.
    it('空アウトライン（スペース文字）→ beginPath/fill が呼ばれない', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, ' ', 'default', 12, '#000000')

      // space has no outline, so no beginPath → fill cycle
      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(0)
    })
  })

  // ═══ 2. Horizontal alignment + advance width ═══
  describe('Horizontal Layout + Advance Width', () => {
    // Verifies consecutive glyphs advance in X: the second glyph starts to the right of the first.
    it('"AB" → 2 つの beginPath/fill、X 座標が advanceWidth 分ずれる', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'AB', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(2)

      // the second glyph's moveTo X must be greater than the first's
      const firstCycleMoves = ctx._calls
        .slice(cycles[0]!.beginPathIdx, cycles[0]!.fillIdx)
        .filter(c => c[0] === 'moveTo')
      const secondCycleMoves = ctx._calls
        .slice(cycles[1]!.beginPathIdx, cycles[1]!.fillIdx)
        .filter(c => c[0] === 'moveTo')

      expect(firstCycleMoves.length).toBeGreaterThan(0)
      expect(secondCycleMoves.length).toBeGreaterThan(0)

      const firstX = firstCycleMoves[0]![1] as number
      const secondX = secondCycleMoves[0]![1] as number
      expect(secondX).toBeGreaterThan(firstX)
    })

    // Verifies hAlign=center positions glyphs at x + (width - measured textWidth) / 2.
    it('hAlign="center" → drawX = x + (width - textWidth) / 2', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      // compute text width
      const fontSize = 12
      const s = fontSize / ttfFont.metrics.unitsPerEm
      let textWidth = 0
      for (const ch of 'AB') {
        const gid = ttfFont.getGlyphId(ch.codePointAt(0)!)
        textWidth += ttfFont.getAdvanceWidth(gid) * s
      }

      ctx._calls.length = 0
      backend.drawText(10, 20, 'AB', 'default', fontSize, '#000', { hAlign: 'center', width: 200 })

      // the first moveTo X should be centered
      const moveToCalls = getCallsOfType(ctx._calls, 'moveTo')
      expect(moveToCalls.length).toBeGreaterThan(0)

      const expectedDrawX = 10 + (200 - textWidth) / 2
      // first glyph's first moveTo X is drawX + glyphX * s
      // confirm drawX itself is near expectedDrawX
      const firstMoveToX = moveToCalls[0]![1] as number
      expect(firstMoveToX).toBeGreaterThanOrEqual(expectedDrawX - 1)
      expect(firstMoveToX).toBeLessThan(expectedDrawX + textWidth)
    })

    // Verifies hAlign=right positions glyphs at x + width - measured textWidth.
    it('hAlign="right" → drawX = x + width - textWidth', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      const fontSize = 12
      const s = fontSize / ttfFont.metrics.unitsPerEm
      let textWidth = 0
      for (const ch of 'AB') {
        const gid = ttfFont.getGlyphId(ch.codePointAt(0)!)
        textWidth += ttfFont.getAdvanceWidth(gid) * s
      }

      ctx._calls.length = 0
      backend.drawText(10, 20, 'AB', 'default', fontSize, '#000', { hAlign: 'right', width: 200 })

      const moveToCalls = getCallsOfType(ctx._calls, 'moveTo')
      expect(moveToCalls.length).toBeGreaterThan(0)

      const expectedDrawX = 10 + 200 - textWidth
      const firstMoveToX = moveToCalls[0]![1] as number
      expect(firstMoveToX).toBeGreaterThanOrEqual(expectedDrawX - 1)
      expect(firstMoveToX).toBeLessThan(expectedDrawX + textWidth)
    })

    // Verifies the pen advance matches Σ(advanceWidth × fontSize / unitsPerEm) by checking the second glyph's start X.
    it('textWidth = Σ(advanceWidth × fontSize / unitsPerEm)', () => {
      // hand-compute advance widths of "AB" and compare against the second glyph's start position
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      const fontSize = 24
      const s = fontSize / ttfFont.metrics.unitsPerEm
      const gidA = ttfFont.getGlyphId('A'.codePointAt(0)!)
      const gidB = ttfFont.getGlyphId('B'.codePointAt(0)!)
      const awA = ttfFont.getAdvanceWidth(gidA) * s
      const awB = ttfFont.getAdvanceWidth(gidB) * s

      ctx._calls.length = 0
      backend.drawText(0, 0, 'AB', 'default', fontSize, '#000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(2)

      // the second glyph starts at X = awA (the first glyph's advance width)
      const secondCycleMoves = ctx._calls
        .slice(cycles[1]!.beginPathIdx, cycles[1]!.fillIdx)
        .filter(c => c[0] === 'moveTo')
      const secondGlyphStartX = secondCycleMoves[0]![1] as number
      // 'B' first moveTo X ≈ awA + glyphX * s
      // glyphX is a glyph-internal coordinate, so the X is at least around awA
      expect(secondGlyphStartX).toBeGreaterThanOrEqual(awA * 0.8)  // margin for glyph internal coord
      void awB  // keep variable used
    })
  })

  // ═══ 3. Underline / strikethrough ═══
  describe('Underline / Strikethrough', () => {
    // Verifies the underline option strokes a line with the text color and a positive line width.
    it('underline → moveTo/lineTo/stroke が呼ばれる', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'Test', 'default', 12, '#000000', { underline: true })

      // stroke is called (underline line)
      expect(ctx.stroke).toHaveBeenCalled()
      // strokeStyle is set
      expect(ctx.strokeStyle).toBe('#000000')
      // lineWidth is set
      expect(ctx.lineWidth).toBeGreaterThan(0)
    })

    // Verifies the strikethrough option also strokes a decoration line.
    it('strikethrough → stroke が呼ばれる', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'Test', 'default', 12, '#000000', { strikethrough: true })

      expect(ctx.stroke).toHaveBeenCalled()
    })

    // Verifies underline and strikethrough are drawn at different Y positions.
    it('underline と strikethrough の Y 座標が異なる', () => {
      // underline
      const ctx1 = createMockCtx()
      const backend1 = new CanvasBackend(ctx1, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend1.beginPage(595, 842)
      ctx1._calls.length = 0
      backend1.drawText(10, 20, 'Test', 'default', 12, '#000000', { underline: true })

      // strikethrough
      const ctx2 = createMockCtx()
      const backend2 = new CanvasBackend(ctx2, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend2.beginPage(595, 842)
      ctx2._calls.length = 0
      backend2.drawText(10, 20, 'Test', 'default', 12, '#000000', { strikethrough: true })

      // find the stroke moveTo emitted after the glyph fills
      // underline: beginPath → moveTo after fill
      const ulStrokeMoves = ctx1._calls.filter((c, i) => {
        if (c[0] !== 'moveTo') return false
        // find moveTo calls occurring after a fill
        const prevFillIdx = ctx1._calls.slice(0, i).findLastIndex(cc => cc[0] === 'fill')
        return prevFillIdx >= 0
      })
      const stStrokeMoves = ctx2._calls.filter((c, i) => {
        if (c[0] !== 'moveTo') return false
        const prevFillIdx = ctx2._calls.slice(0, i).findLastIndex(cc => cc[0] === 'fill')
        return prevFillIdx >= 0
      })

      expect(ulStrokeMoves.length).toBeGreaterThan(0)
      expect(stStrokeMoves.length).toBeGreaterThan(0)

      // underline Y and strikethrough Y must differ
      const ulY = ulStrokeMoves[ulStrokeMoves.length - 1]![2] as number
      const stY = stStrokeMoves[stStrokeMoves.length - 1]![2] as number
      expect(ulY).not.toBe(stY)
    })
  })

  // ═══ 4. Japanese text drawing ═══
  describe('Japanese Text Drawing', () => {
    // Verifies a hiragana glyph from NotoSansJP produces an outline draw cycle.
    it('NotoSansJP で "あ" → グリフアウトライン Canvas API 呼び出しあり', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: jpFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'あ', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(1)
      // '' (CFF with MoveTo without with from case)
      
      const total = cycles[0]!.moveToCount + cycles[0]!.lineToCount + cycles[0]!.bezierCount
      expect(total).toBeGreaterThan(0)
    })

    // Verifies three consecutive Japanese glyphs are drawn with monotonically increasing X positions.
    it('"あいう" → 3 つの beginPath/fill、全角幅で X 送り', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: jpFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'あいう', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(3)

      // each glyph's starting X increases monotonically
      // CFF glyphs may lack moveTo, so use the first draw command's X
      const xPositions: number[] = []
      for (const cycle of cycles) {
        const drawCmds = ctx._calls
          .slice(cycle.beginPathIdx, cycle.fillIdx)
          .filter(c => c[0] === 'moveTo' || c[0] === 'lineTo' || c[0] === 'bezierCurveTo')
        if (drawCmds.length > 0) {
          xPositions.push(drawCmds[0]![1] as number)
        }
      }
      expect(xPositions.length).toBe(3)
      expect(xPositions[1]!).toBeGreaterThan(xPositions[0]!)
      expect(xPositions[2]!).toBeGreaterThan(xPositions[1]!)
    })

    // Verifies cmap resolution maps U+3042 to a real glyph, not .notdef.
    it('GID 解決: getGlyphId(0x3042) !== 0（.notdef でない）', () => {
      const gid = jpFont.getGlyphId(0x3042)
      expect(gid).not.toBe(0)
    })

    // Verifies a kanji glyph yields a complex outline with many path commands.
    it('漢字 "漢" → 複雑なアウトライン（多数の moveTo/bezierCurveTo）', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: jpFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, '漢', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(1)
      // kanji have complex outlines (many commands)
      const total = cycles[0]!.moveToCount + cycles[0]!.lineToCount + cycles[0]!.bezierCount
      expect(total).toBeGreaterThan(10)
    })
  })

  // ═══ 5. Mixed fonts ═══
  describe('Multi-font', () => {
    // Verifies switching fontId selects the corresponding registered font for glyph drawing.
    it('fontId 切替で正しいフォントのグリフ使用', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { jp: jpFont, en: ttfFont },
      })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'A', 'en', 12, '#000000')
      const cyclesEn = extractGlyphDrawCycles(ctx._calls)

      ctx._calls.length = 0
      backend.drawText(10, 40, 'あ', 'jp', 12, '#000000')
      const cyclesJp = extractGlyphDrawCycles(ctx._calls)

      // a glyph is drawn with each font
      expect(cyclesEn.length).toBe(1)
      expect(cyclesJp.length).toBe(1)
    })

    // Verifies TTF and CFF fonts can both draw glyphs on the same page.
    it('同一ページで TTF + CFF の描画が混在', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { ttf: ttfFont, cff: cffFont },
      })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'AB', 'ttf', 12, '#000000')
      backend.drawText(10, 40, 'CD', 'cff', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      // A, B, C, D → 4 glyph draws
      expect(cycles.length).toBe(4)
    })

    // Verifies CFF fonts use the same coordinate transform rule (baseY from ascender) as TTF fonts.
    it('CFF フォントの座標変換が TTF と同じルールで動作', () => {
      const fontSize = 24

      // TTF
      const ctx1 = createMockCtx()
      const backend1 = new CanvasBackend(ctx1, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend1.beginPage(595, 842)
      ctx1._calls.length = 0
      backend1.drawText(10, 20, 'A', 'default', fontSize, '#000000')

      // CFF
      const ctx2 = createMockCtx()
      const backend2 = new CanvasBackend(ctx2, { scale: 1, devicePixelRatio: 1, fonts: { default: cffFont } })
      backend2.beginPage(595, 842)
      ctx2._calls.length = 0
      backend2.drawText(10, 20, 'A', 'default', fontSize, '#000000')

      // both share the same structure (beginPath → moveTo/lineTo/bezierCurveTo → fill)
      const cycles1 = extractGlyphDrawCycles(ctx1._calls)
      const cycles2 = extractGlyphDrawCycles(ctx2._calls)
      expect(cycles1.length).toBe(1)
      expect(cycles2.length).toBe(1)

      // baseY rule is identical: y + ascender * fontSize / unitsPerEm
      const baseY1 = 20 + ttfFont.metrics.ascender * fontSize / ttfFont.metrics.unitsPerEm
      const baseY2 = 20 + cffFont.metrics.ascender * fontSize / cffFont.metrics.unitsPerEm

      const moveToCalls1 = ctx1._calls.filter(c => c[0] === 'moveTo')
      const moveToCalls2 = ctx2._calls.filter(c => c[0] === 'moveTo')

      // each font's moveTo Y is near its baseY
      const firstY1 = moveToCalls1[0]![2] as number
      const firstY2 = moveToCalls2[0]![2] as number
      expect(firstY1).toBeLessThan(baseY1 + fontSize)
      expect(firstY2).toBeLessThan(baseY2 + fontSize)
    })
  })

  // ═══ 6. Font subset + reload ═══
  describe('Font Subset + Reload', () => {
    // Verifies a reloaded TTF subset still draws every subsetted glyph.
    it('TTF: subset("ABC") → Font.load() → drawTextWithFont 正常動作', () => {
      const subsetBuf = ttfFont.subset('ABC')
      const subsetFont = Font.load(subsetBuf)

      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: subsetFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'ABC', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(3)
    })

    // Verifies a reloaded CFF subset still draws every subsetted glyph.
    it('CFF: subset("ABC") → Font.load() → drawTextWithFont 正常動作', () => {
      const subsetBuf = cffFont.subset('ABC')
      const subsetFont = Font.load(subsetBuf)

      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: subsetFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'ABC', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(3)
    })

    // Verifies a reloaded Japanese (CJK) subset still draws every subsetted glyph.
    it('日本語: subset("あいう") → Font.load() → drawTextWithFont 正常動作', () => {
      const subsetBuf = jpFont.subset('あいう')
      const subsetFont = Font.load(subsetBuf)

      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: subsetFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'あいう', 'default', 12, '#000000')

      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBe(3)
    })

    // Verifies characters excluded from the subset resolve to GID 0 (.notdef).
    it('サブセット後のフォントで元にない文字 → GID 0 (.notdef)', () => {
      const subsetBuf = ttfFont.subset('ABC')
      const subsetFont = Font.load(subsetBuf)

      // 'Z' is not in the subset, so GID should be 0
      const gid = subsetFont.getGlyphId('Z'.codePointAt(0)!)
      expect(gid).toBe(0)
    })
  })

  // ═══ 7. CSS fallback ═══
  describe('CSS Fallback', () => {
    // Verifies an unregistered fontId falls back to the CSS fillText path.
    it('fonts に fontId がない場合 → ctx.fillText() が呼ばれる', () => {
      const ctx = createMockCtx()
      // no 'missing' key in fonts
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'Hello', 'missing', 12, '#000000')

      expect(ctx.fillText).toHaveBeenCalledWith('Hello', 10, 20)
    })

    // Verifies a registered fontId uses the glyph outline path, never fillText.
    it('fonts に fontId がある場合 → ctx.fillText() は呼ばれない', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, { scale: 1, devicePixelRatio: 1, fonts: { default: ttfFont } })
      backend.beginPage(595, 842)

      ctx._calls.length = 0
      backend.drawText(10, 20, 'Hello', 'default', 12, '#000000')

      // fillText is not called (drawTextWithFont path)
      const fillTextCalls = ctx._calls.filter(c => c[0] === 'fillText')
      expect(fillTextCalls.length).toBe(0)
    })
  })

  // ═══ 8. renderPage integration ═══
  describe('renderPage Integration', () => {
    // Verifies renderPage draws grouped text via glyph outlines with group save/translate/restore.
    it('renderPage でグループ内テキストノード → save/translate + drawTextWithFont', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { default: ttfFont },
      })

      const page: RenderPage = {
        width: 595, height: 842,
        children: [{
          type: 'group', x: 72, y: 72, width: 451, height: 698,
          children: [{
            type: 'text', x: 0, y: 0,
            text: 'Title', fontId: 'default', fontSize: 24, color: '#333333',
          }],
        }],
      }

      renderPage(page, backend)

      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.translate).toHaveBeenCalledWith(72, 72)
      expect(ctx.restore).toHaveBeenCalled()

      // fillText is not called (drawTextWithFont path)
      const fillTextCalls = ctx._calls.filter(c => c[0] === 'fillText')
      expect(fillTextCalls.length).toBe(0)

      // instead, glyph drawing via beginPath → fill occurs
      const cycles = extractGlyphDrawCycles(ctx._calls)
      // 'Title' = 5 chars
      expect(cycles.length).toBeGreaterThanOrEqual(4)  // i may or may not have an outline depending on font
    })

    // Verifies text inside a clipped group is drawn as glyph outlines after the clip is applied.
    it('クリッピング付きグループ内テキスト → clip パス + グリフ描画', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { default: ttfFont },
      })

      const page: RenderPage = {
        width: 595, height: 842,
        children: [{
          type: 'group', x: 10, y: 10, width: 200, height: 50,
          clip: true,
          children: [{
            type: 'text', x: 0, y: 0,
            text: 'Clip', fontId: 'default', fontSize: 12, color: '#000000',
          }],
        }],
      }

      renderPage(page, backend)

      expect(ctx.clip).toHaveBeenCalled()
      // glyph drawing occurred
      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBeGreaterThanOrEqual(3)  // C, l, i, p
    })

    // Verifies a page mixing text, rect, and line nodes renders without errors.
    it('混合ノード: テキスト + 矩形 + 線が 1 ページ内で正常描画', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { default: ttfFont },
      })

      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'rect', x: 0, y: 0, width: 595, height: 842, fill: '#FFFFFF' },
          { type: 'text', x: 72, y: 72, text: 'Hello', fontId: 'default', fontSize: 12, color: '#000000' },
          { type: 'line', x1: 72, y1: 90, x2: 523, y2: 90, lineWidth: 1, color: '#999999' },
        ],
      }

      // verify completion without errors
      expect(() => renderPage(page, backend)).not.toThrow()

      // rect fill present
      const rectCalls = ctx._calls.filter(c => c[0] === 'rect')
      expect(rectCalls.length).toBeGreaterThanOrEqual(1)

      // line stroke present
      expect(ctx.stroke).toHaveBeenCalled()
    })

    // Verifies a full page containing Japanese text renders all glyphs without errors.
    it('日本語テキスト入り完全ページ → エラーなく完了', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { jp: jpFont },
      })

      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'rect', x: 0, y: 0, width: 595, height: 842, fill: '#FFFFFF' },
          {
            type: 'group', x: 72, y: 72, width: 451, height: 698,
            children: [
              { type: 'text', x: 0, y: 0, text: 'テスト検証', fontId: 'jp', fontSize: 14, color: '#000000' },
              { type: 'text', x: 0, y: 20, text: 'あいうえお', fontId: 'jp', fontSize: 12, color: '#333333' },
            ],
          },
        ],
      }

      expect(() => renderPage(page, backend)).not.toThrow()

      // glyph drawing occurred
      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBeGreaterThanOrEqual(10)  // 10 characters
    })

    // Verifies each text node on a multi-font page is drawn with its own font via glyph outlines.
    it('複数フォント入りページ → 各テキストが対応フォントで描画', () => {
      const ctx = createMockCtx()
      const backend = new CanvasBackend(ctx, {
        scale: 1, devicePixelRatio: 1,
        fonts: { en: ttfFont, jp: jpFont },
      })

      const page: RenderPage = {
        width: 595, height: 842,
        children: [
          { type: 'text', x: 72, y: 72, text: 'Hello', fontId: 'en', fontSize: 12, color: '#000000' },
          { type: 'text', x: 72, y: 92, text: '世界', fontId: 'jp', fontSize: 12, color: '#000000' },
        ],
      }

      expect(() => renderPage(page, backend)).not.toThrow()

      // fillText is not called (both use the drawTextWithFont path)
      const fillTextCalls = ctx._calls.filter(c => c[0] === 'fillText')
      expect(fillTextCalls.length).toBe(0)

      // Glyphdraw (Hello=5, =2)
      
      const cycles = extractGlyphDrawCycles(ctx._calls)
      expect(cycles.length).toBeGreaterThanOrEqual(7)
    })
  })
})
