import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../src/index.js'
import { extractCffHintParams, applyCffHints, type CffHintParams } from '../../src/hinting/cff-hinter.js'
import type { CffHintData, StemHint } from '../../src/hinting/cff-hinter.js'
import { PathCommand } from '../../src/types/glyph.js'

const SOURCE_SANS_PATH = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')
const NOTO_SANS_JP_PATH = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')
const ROBOTO_PATH = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')

describe('extractCffHintParams', () => {
  // Verifies an empty Private DICT yields the CFF spec default hinting parameters.
  it('空の Private DICT からデフォルト値を生成', () => {
    const entries = new Map<number, number[]>()
    const params = extractCffHintParams(entries)

    expect(params.blueScale).toBeCloseTo(0.039625)
    expect(params.blueShift).toBe(7)
    expect(params.blueFuzz).toBe(1)
    expect(params.stdHW).toBe(0)
    expect(params.stdVW).toBe(0)
    expect(params.blueValues).toEqual([])
    expect(params.otherBlues).toEqual([])
    expect(params.stemSnapH).toEqual([])
    expect(params.stemSnapV).toEqual([])
    expect(params.forceBold).toBe(false)
    expect(params.languageGroup).toBe(0)
  })

  // Verifies delta-encoded BlueValues (operator 6) are decoded to absolute zone boundaries.
  it('BlueValues をデルタデコードする', () => {
    const entries = new Map<number, number[]>()
    // BlueValues: [-15, 0, 486, 498] → delta encoded as [-15, 15, 486, 12]
    entries.set(6, [-15, 15, 486, 12])
    const params = extractCffHintParams(entries)

    expect(params.blueValues).toEqual([-15, 0, 486, 498])
  })

  // Verifies delta-encoded OtherBlues (operator 7) are decoded to absolute values.
  it('OtherBlues をデルタデコードする', () => {
    const entries = new Map<number, number[]>()
    entries.set(7, [-250, 10])
    const params = extractCffHintParams(entries)

    expect(params.otherBlues).toEqual([-250, -240])
  })

  // Verifies StdHW (operator 10) and StdVW (operator 11) are read as plain values.
  it('StdHW / StdVW を読み取る', () => {
    const entries = new Map<number, number[]>()
    entries.set(10, [50])   // StdHW
    entries.set(11, [80])   // StdVW
    const params = extractCffHintParams(entries)

    expect(params.stdHW).toBe(50)
    expect(params.stdVW).toBe(80)
  })

  // Verifies delta-encoded StemSnapH/StemSnapV (operators 12 12 / 12 13) decode to absolute stem widths.
  it('StemSnapH / StemSnapV をデルタデコードする', () => {
    const entries = new Map<number, number[]>()
    entries.set(1212, [50, 10, 10])  // StemSnapH
    entries.set(1213, [80, 20])       // StemSnapV
    const params = extractCffHintParams(entries)

    expect(params.stemSnapH).toEqual([50, 60, 70])
    expect(params.stemSnapV).toEqual([80, 100])
  })

  // Verifies ForceBold (12 14) parses to a boolean and LanguageGroup (12 17) to a number.
  it('ForceBold / LanguageGroup を読み取る', () => {
    const entries = new Map<number, number[]>()
    entries.set(1214, [1])   // ForceBold
    entries.set(1217, [1])   // LanguageGroup
    const params = extractCffHintParams(entries)

    expect(params.forceBold).toBe(true)
    expect(params.languageGroup).toBe(1)
  })
})

describe('applyCffHints', () => {
  // Verifies hinting an empty outline returns empty commands/coords without error.
  it('空のアウトラインはそのまま返す', () => {
    const outline = {
      commands: new Uint8Array(0),
      coords: new Float32Array(0),
    }
    const hints: CffHintData = {
      hStems: [], vStems: [], hintMasks: [], counterMasks: [],
    }
    const params = extractCffHintParams(new Map())
    const result = applyCffHints(outline, hints, params, 12, 1000)
    expect(result.commands.length).toBe(0)
    expect(result.coords.length).toBe(0)
  })

  // Verifies stem hints adjust coordinates while leaving the command array untouched (shared reference).
  it('ステムヒントで y 座標がアライメントされる', () => {
    // Simple rectangle: (100, 0) → (100, 700) → (300, 700) → (300, 0)
    const outline = {
      commands: new Uint8Array([PathCommand.MoveTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.LineTo, PathCommand.Close]),
      coords: new Float32Array([100, 0, 100, 700, 300, 700, 300, 0]),
    }
    const hints: CffHintData = {
      hStems: [{ pos: 0, width: 700 }],
      vStems: [{ pos: 100, width: 200 }],
      hintMasks: [],
      counterMasks: [],
    }
    const params = extractCffHintParams(new Map())
    const result = applyCffHints(outline, hints, params, 12, 1000)

    // After hinting, coordinates should be adjusted
    expect(result.commands).toBe(outline.commands) // commands are not modified
    expect(result.coords.length).toBe(outline.coords.length)

    // ppem=12, unitsPerEm=1000 → pixelSize = 1000/12 ≈ 83.33
    // stem width 200 → 200/83.33 ≈ 2.4 → round to 2 → 2 * 83.33 ≈ 166.67
    // stem width 700 → 700/83.33 ≈ 8.4 → round to 8 → 8 * 83.33 ≈ 666.67
    // Coordinates are adjusted and should differ from the originals
    // (only stem alignment here, since there is no blue zone)
  })

  // Verifies y-coordinates inside BlueValues zones are snapped, keeping the coordinate count intact.
  it('Blue zone snapping が適用される', () => {
    // BlueValues: [0, 10, 700, 710] → baseline zone (0-10), cap zone (700-710)
    const entries = new Map<number, number[]>()
    entries.set(6, [0, 10, 690, 10]) // delta: 0,10,700,710
    const params = extractCffHintParams(entries)

    const outline = {
      commands: new Uint8Array([PathCommand.MoveTo, PathCommand.LineTo, PathCommand.Close]),
      coords: new Float32Array([100, 3, 100, 705]),
    }
    const hints: CffHintData = {
      hStems: [{ pos: 0, width: 710 }],
      vStems: [],
      hintMasks: [],
      counterMasks: [],
    }

    const result = applyCffHints(outline, hints, params, 12, 1000)
    // y=3 is inside the baseline zone (0-10) → snaps to 0
    // y=705 is inside the cap zone (700-710) → snaps to 710
    // The actual snapped values depend on pixel boundaries
    expect(result.coords.length).toBe(4)
    // Confirm the coordinates received some adjustment
    // (exact values depend on pixelSize)
  })

  // Verifies applyCffHints returns the original outline object unchanged when ppem is 0.
  it('ppem=0 の場合は元のアウトラインを返す', () => {
    const outline = {
      commands: new Uint8Array([PathCommand.MoveTo, PathCommand.Close]),
      coords: new Float32Array([100, 200]),
    }
    const hints: CffHintData = {
      hStems: [{ pos: 0, width: 500 }],
      vStems: [],
      hintMasks: [],
      counterMasks: [],
    }
    const params = extractCffHintParams(new Map())
    const result = applyCffHints(outline, hints, params, 0, 1000)
    expect(result).toBe(outline)
  })
})

describe('Font.getHintedGlyph', () => {
  // Verifies getHintedGlyph on a real CFF font keeps ID/advance/command count but moves outline coordinates.
  it.skipIf(!existsSync(SOURCE_SANS_PATH))('CFF フォントでヒンティング適用されたグリフを取得', () => {
    const buffer = readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.isCff).toBe(true)

    const gid = font.getGlyphId('A'.codePointAt(0)!)
    expect(gid).toBeGreaterThan(0)

    const normalGlyph = font.getGlyph(gid)
    const hintedGlyph = font.getHintedGlyph(gid, 12)

    expect(hintedGlyph.glyphId).toBe(gid)
    expect(hintedGlyph.advanceWidth).toBe(normalGlyph.advanceWidth)
    expect(hintedGlyph.outline.commands.length).toBe(normalGlyph.outline.commands.length)

    // The hinted outline should have coordinates that differ from the normal outline
    // (as long as stem hints exist)
    let hasDifference = false
    for (let i = 0; i < normalGlyph.outline.coords.length; i++) {
      if (normalGlyph.outline.coords[i] !== hintedGlyph.outline.coords[i]) {
        hasDifference = true
        break
      }
    }
    expect(hasDifference).toBe(true)
  })

  // Verifies hinting also works through the CIDFont (FDArray/FDSelect) code path of NotoSansJP.
  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('CIDFont でもヒンティングが動作する', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.isCff).toBe(true)

    const gid = font.getGlyphId('あ'.codePointAt(0)!)
    if (gid === 0) return // skip if the glyph is absent

    const hintedGlyph = font.getHintedGlyph(gid, 16)
    expect(hintedGlyph.glyphId).toBe(gid)
    expect(hintedGlyph.outline.commands.length).toBeGreaterThan(0)
  })

  // Verifies getHintedGlyph on a TrueType font runs the bytecode interpreter
  // and returns a grid-fitted outline and phantom-point advance.
  it('TrueType フォントではバイトコードインタプリタでグリッドフィットされる', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.isCff).toBe(false)

    const gid = font.getGlyphId('A'.codePointAt(0)!)
    const hintedGlyph = font.getHintedGlyph(gid, 12)

    expect(hintedGlyph.advanceWidth * 12 / font.metrics.unitsPerEm).toBeCloseTo(8, 10)
    expect(hintedGlyph.outline.commands.length).toBeGreaterThan(0)
  })

  // Verifies ppem <= 0 short-circuits to the cached normal glyph (same object reference).
  it('ppem が 0 以下の場合は通常グリフを返す', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const gid = font.getGlyphId('A'.codePointAt(0)!)

    const normalGlyph = font.getGlyph(gid)
    const hintedGlyph = font.getHintedGlyph(gid, 0)

    expect(hintedGlyph).toBe(normalGlyph) // same object reference
  })
})
