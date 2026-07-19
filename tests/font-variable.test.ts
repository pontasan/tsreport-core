import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'
import type { AvarTable } from '../src/parsers/tables/avar.js'
import type { FvarTable } from '../src/parsers/tables/fvar.js'

const VF_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')
const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')

function setParsedFontTable(font: Font, tag: 'fvar' | 'avar', value: unknown): void {
  Object.defineProperty((font as unknown as { tableManager: object }).tableManager, tag, {
    value,
    configurable: true,
  })
}

function getNormalizedCoords(font: Font): number[] | null {
  return (font as unknown as { tableManager: { normalizedCoords: number[] | null } }).tableManager.normalizedCoords
}

describe('Variable Fonts', () => {
  describe('setVariation()', () => {
    // Verifies changing the wght axis applies HVAR/gvar advance deltas so advanceWidth differs from default.
    it.skipIf(!existsSync(VF_PATH))('wght を変更すると advanceWidth が変化する', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('A'.codePointAt(0)!)
      expect(gid).toBeGreaterThan(0)

      // advanceWidth at default (wght=400)
      const defaultWidth = font.getAdvanceWidth(gid)
      expect(defaultWidth).toBeGreaterThan(0)

      // Switch to Bold (wght=700)
      font.setVariation({ wght: 700 })
      const boldWidth = font.getAdvanceWidth(gid)
      expect(boldWidth).toBeGreaterThan(0)

      // Bold is usually wider than Regular
      expect(boldWidth).not.toBe(defaultWidth)
    })

    // Verifies setVariation invalidates cached glyphs and gvar deltas change the outline coordinates.
    it.skipIf(!existsSync(VF_PATH))('wght を変更するとグリフアウトラインが変化する', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('H'.codePointAt(0)!)

      // Default outline
      const defaultGlyph = font.getGlyph(gid)
      const defaultCoords = Array.from(defaultGlyph.outline.coords)

      // Switch to Bold → cache cleared → new outline
      font.setVariation({ wght: 700 })
      const boldGlyph = font.getGlyph(gid)
      const boldCoords = Array.from(boldGlyph.outline.coords)

      // The outline coordinates should have changed
      expect(boldCoords).not.toEqual(defaultCoords)
    })

    // Verifies the wdth axis works too: a condensed setting narrows the advance width.
    it.skipIf(!existsSync(VF_PATH))('wdth を変更すると advanceWidth が変化する', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('M'.codePointAt(0)!)

      const defaultWidth = font.getAdvanceWidth(gid)

      // Condensed
      font.setVariation({ wdth: 75 })
      const condensedWidth = font.getAdvanceWidth(gid)

      // Condensed is narrower than Regular
      expect(condensedWidth).toBeLessThan(defaultWidth)
    })

    // Verifies restoring the default axis value exactly reproduces the original advance width (no residual state).
    it.skipIf(!existsSync(VF_PATH))('デフォルト値に戻すと元の幅に戻る', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('A'.codePointAt(0)!)
      const defaultWidth = font.getAdvanceWidth(gid)

      // Switch to Bold
      font.setVariation({ wght: 700 })
      const boldWidth = font.getAdvanceWidth(gid)
      expect(boldWidth).not.toBe(defaultWidth)

      // Restore the default
      font.setVariation({ wght: 400 })
      const restoredWidth = font.getAdvanceWidth(gid)
      expect(restoredWidth).toBe(defaultWidth)
    })

    // Verifies out-of-range axis values are clamped to fvar maxValue, matching the explicit max result.
    it.skipIf(!existsSync(VF_PATH))('範囲外の値はクランプされる', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('A'.codePointAt(0)!)

      // Extremely large value
      font.setVariation({ wght: 99999 })
      const maxWidth = font.getAdvanceWidth(gid)
      expect(maxWidth).toBeGreaterThan(0)

      // maxValue yields the same result
      const wghtAxis = font.variationAxes.find(a => a.tag === 'wght')!
      font.setVariation({ wght: wghtAxis.maxValue })
      const maxAxisWidth = font.getAdvanceWidth(gid)
      expect(maxAxisWidth).toBe(maxWidth)
    })

    // Verifies avar v2 is consumed by setVariation and receives v1-remapped intermediate coordinates.
    it('avar v2 の座標 delta を normalizedCoords に反映する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const fvar: FvarTable = {
        axes: [
          { tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900, flags: 0, axisNameId: 256 },
          { tag: 'wdth', minValue: 50, defaultValue: 75, maxValue: 100, flags: 0, axisNameId: 257 },
        ],
        instances: [],
        getAxisIndex(tag: string): number {
          return tag === 'wght' ? 0 : tag === 'wdth' ? 1 : -1
        },
      }
      const avar: AvarTable = {
        axisSegmentMaps: [],
        hasV2: true,
        mapAxisValue(axisIndex: number, normalizedValue: number): number {
          return axisIndex === 1 ? normalizedValue * 0.5 : normalizedValue
        },
        mapAxisValueV2(axisIndex: number, normalizedValue: number, coords: number[]): number {
          const mapped = this.mapAxisValue(axisIndex, normalizedValue)
          return axisIndex === 0 ? mapped + coords[1]! * 0.25 : mapped
        },
      }

      setParsedFontTable(font, 'fvar', fvar)
      setParsedFontTable(font, 'avar', avar)
      font.setVariation({ wght: 700, wdth: 100 })

      expect(getNormalizedCoords(font)).toEqual([0.725, 0.5])
    })
  })

  describe('metrics', () => {
    // Verifies font metrics remain accessible and sane after applying a variation.
    it.skipIf(!existsSync(VF_PATH))('wght 変更後もメトリクスが取得できる', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      font.setVariation({ wght: 700 })
      const metrics = font.metrics
      expect(metrics.unitsPerEm).toBeGreaterThan(0)
      expect(metrics.ascender).toBeGreaterThan(0)
      expect(metrics.descender).toBeLessThan(0)
    })
  })

  describe('shaping with variation', () => {
    // Verifies shapeText still works after setVariation, producing positive advances at wght=700.
    it.skipIf(!existsSync(VF_PATH))('Variable Font でシェーピングが動作する', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      font.setVariation({ wght: 700 })
      const shaped = font.shapeText('Hello')
      expect(shaped.length).toBe(5)
      for (const g of shaped) {
        expect(g.xAdvance).toBeGreaterThan(0)
      }
    })

    // Verifies variation-adjusted advances flow into shaping: total width at wght=900 exceeds Regular.
    it.skipIf(!existsSync(VF_PATH))('Bold のシェーピング幅は Regular より広い', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const regularShaped = font.shapeText('Hello')
      const regularWidth = regularShaped.reduce((s, g) => s + g.xAdvance, 0)

      font.setVariation({ wght: 900 })
      const boldShaped = font.shapeText('Hello')
      const boldWidth = boldShaped.reduce((s, g) => s + g.xAdvance, 0)

      expect(boldWidth).toBeGreaterThan(regularWidth)
    })
  })

  // Guards the fix for gvar point deltas overflowing Int16 arithmetic at extreme axis positions.
  describe('regression: gvar delta does not overflow Int16', () => {
    // Verifies extreme wght/wdth settings still yield finite coordinates and a sane advance width.
    it.skipIf(!existsSync(VF_PATH))('extreme variation values produce valid outlines', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // Set extreme weight — large gvar deltas
      font.setVariation({ wght: 900, wdth: 62.5 })

      const gid = font.getGlyphId('M'.codePointAt(0)!)
      const glyph = font.getGlyph(gid)

      // Outline should be valid (no Int16 overflow artifacts)
      expect(glyph.outline.commands.length).toBeGreaterThan(0)
      for (let i = 0; i < glyph.outline.coords.length; i++) {
        expect(Number.isFinite(glyph.outline.coords[i])).toBe(true)
      }

      // advanceWidth should be reasonable (not negative or huge from overflow)
      expect(glyph.advanceWidth).toBeGreaterThan(0)
      expect(glyph.advanceWidth).toBeLessThan(10000) // reasonable range
    })
  })

  describe('IUP (Interpolation of Untouched Points)', () => {
    // Verifies glyphs users reported as broken keep contour structure and bounded per-point deltas at wght=700 (IUP regression).
    it.skipIf(!existsSync(VF_PATH))('wght=700 でグリフポイントが滑らかに変化する (IUP regression)', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // T, 0, n — glyphs where users reported broken rendering
      const testChars = ['T', '0', 'n', '6']

      for (const ch of testChars) {
        const gid = font.getGlyphId(ch.codePointAt(0)!)
        if (gid === 0) continue

        // Outline at default (wght=400)
        font.setVariation({ wght: 400 })
        const defaultGlyph = font.getGlyph(gid)
        const defaultCoords = defaultGlyph.outline.coords

        // Outline at Bold (wght=700)
        font.setVariation({ wght: 700 })
        const boldGlyph = font.getGlyph(gid)
        const boldCoords = boldGlyph.outline.coords

        // Same point count (contour structure does not change)
        expect(boldGlyph.outline.commands.length).toBe(defaultGlyph.outline.commands.length)

        // Bold outline must be finite and within a reasonable range
        for (let i = 0; i < boldCoords.length; i++) {
          expect(Number.isFinite(boldCoords[i])).toBe(true)
        }

        // Per-point movement must be gentle (a sharp jump means missing IUP)
        // No delta should vastly exceed the unitsPerEm range
        const upm = font.metrics.unitsPerEm
        for (let i = 0; i < boldCoords.length; i += 2) {
          const diffX = Math.abs(boldCoords[i]! - defaultCoords[i]!)
          const diffY = Math.abs(boldCoords[i + 1]! - defaultCoords[i + 1]!)
          // Deltas normally stay within about 20% of UPM
          expect(diffX).toBeLessThan(upm * 0.5)
          expect(diffY).toBeLessThan(upm * 0.5)
        }
      }
    })

    // Verifies IUP interpolates untouched points: most coordinates change between wght=400 and 900.
    it.skipIf(!existsSync(VF_PATH))('IUP により全ポイントにデルタが適用される', () => {
      const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('T'.codePointAt(0)!)

      // Default outline
      font.setVariation({ wght: 400 })
      const defaultCoords = Array.from(font.getGlyph(gid).outline.coords)

      // Extreme bold
      font.setVariation({ wght: 900 })
      const boldCoords = Array.from(font.getGlyph(gid).outline.coords)

      // Going wght=400 → 900 should change all coordinates
      // Without IUP, some points would stay unchanged (delta=0)
      let changedCount = 0
      for (let i = 0; i < defaultCoords.length; i++) {
        if (defaultCoords[i] !== boldCoords[i]) changedCount++
      }

      // The majority of points should have changed (thanks to IUP)
      const changeRatio = changedCount / defaultCoords.length
      expect(changeRatio).toBeGreaterThan(0.5)
    })
  })

  describe('non-variable font', () => {
    // Verifies setVariation is a harmless no-op on a font without fvar/gvar tables.
    it('非 Variable Font で setVariation は無操作', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const gid = font.getGlyphId('A'.codePointAt(0)!)
      const width1 = font.getAdvanceWidth(gid)

      // setVariation does nothing for a non-variable font
      font.setVariation({ wght: 700 })
      const width2 = font.getAdvanceWidth(gid)

      expect(width1).toBe(width2)
    })
  })
})

function loadVariableFont(): Font {
  return Font.load(readFileSync(VF_PATH).buffer as ArrayBuffer)
}

describe('STAT consumption', () => {
  // The variable NotoSans carries a STAT table: style names for arbitrary
  // coordinates compose from the AxisValue names, and the wght coordinate
  // drives isBold so synthetic bold does not double up.
  it('composes a style name from STAT axis values', () => {
    const font = loadVariableFont()
    font.setVariation({ wght: 700 })
    const name = font.getVariationStyleName()
    expect(name).toBe('Bold')
    font.setVariation({})
    expect(font.getVariationStyleName()).toBeNull()
  })

  it('combines names across axes in ordering', () => {
    const font = loadVariableFont()
    font.setVariation({ wght: 700, wdth: 87.5 })
    const name = font.getVariationStyleName()
    expect(name).toContain('Bold')
    expect(name).toContain('SemiCondensed')
    font.setVariation({})
  })

  it('metrics.isBold follows the wght coordinate (style linking)', () => {
    const font = loadVariableFont()
    expect(font.metrics.isBold).toBe(false)
    font.setVariation({ wght: 700 })
    expect(font.metrics.isBold).toBe(true)
    font.setVariation({ wght: 400 })
    expect(font.metrics.isBold).toBe(false)
    font.setVariation({})
  })
})

describe('MVAR registered metric consumers', () => {
  it('applies clipping, vertical, caret, and gasp deltas through public APIs', () => {
    const baseline = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer).metrics
    const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
    const manager = (font as unknown as { tableManager: object }).tableManager
    Object.defineProperty(manager, 'normalizedCoords', { value: [1], configurable: true })
    Object.defineProperty(manager, 'vhea', {
      value: {
        ascender: 800, descender: -200, lineGap: 20,
        caretSlopeRise: 1, caretSlopeRun: 0, caretOffset: 2,
      },
      configurable: true,
    })
    Object.defineProperty(manager, 'gasp', {
      value: {
        ranges: [
          { rangeMaxPPEM: 10, rangeGaspBehavior: 1 },
          { rangeMaxPPEM: 0xffff, rangeGaspBehavior: 2 },
        ],
      },
      configurable: true,
    })
    const deltas: Record<string, number> = {
      hcla: 11, hcld: 12,
      vasc: 13, vdsc: 14, vlgp: 15,
      hcrs: 16, hcrn: 17, hcof: 18,
      vcrs: 19, vcrn: 20, vcof: 21,
      gsp0: 5,
    }
    Object.defineProperty(manager, 'mvar', {
      value: { getMetricDelta(tag: string): number { return deltas[tag] ?? 0 } },
      configurable: true,
    })

    expect(font.metrics).toMatchObject({
      horizontalClippingAscent: baseline.horizontalClippingAscent + 11,
      horizontalClippingDescent: baseline.horizontalClippingDescent + 12,
      verticalAscender: 813,
      verticalDescender: -186,
      verticalLineGap: 35,
      horizontalCaretSlopeRise: baseline.horizontalCaretSlopeRise + 16,
      horizontalCaretSlopeRun: baseline.horizontalCaretSlopeRun + 17,
      horizontalCaretOffset: baseline.horizontalCaretOffset + 18,
      verticalCaretSlopeRise: 20,
      verticalCaretSlopeRun: 20,
      verticalCaretOffset: 23,
    })
    expect(font.getGaspBehavior(14)).toBe(1)
    expect(font.getGaspBehavior(16)).toBe(2)
  })
})

describe('HVAR side-bearing consumers', () => {
  it('applies explicit HVAR LSB and RSB mappings through Font metrics', () => {
    const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
    const glyphId = font.getGlyphId(0x41)
    const manager = (font as unknown as { tableManager: {
      hmtx: { getAdvanceWidth(glyphId: number): number, getLsb(glyphId: number): number }
    } }).tableManager
    const glyph = font.getGlyph(glyphId)
    const baseLsb = manager.hmtx.getLsb(glyphId)
    const baseRsb = manager.hmtx.getAdvanceWidth(glyphId) - baseLsb - (glyph.xMax - glyph.xMin)
    Object.defineProperty(manager, 'normalizedCoords', { value: [1], configurable: true })
    Object.defineProperty(manager, 'hvar', {
      value: {
        hasLsbMapping: true,
        hasRsbMapping: true,
        getAdvanceWidthDelta(): number { return 0 },
        getLsbDelta(): number { return 17 },
        getRsbDelta(): number { return -23 },
      },
      configurable: true,
    })

    expect(font.getLeftSideBearing(glyphId)).toBe(baseLsb + 17)
    expect(font.getRightSideBearing(glyphId)).toBe(baseRsb - 23)
  })

  it.skipIf(!existsSync(VF_PATH))('shares one normalized coordinate vector across metric and layout variation stores', () => {
    const font = Font.load(readFileSync(VF_PATH).buffer as ArrayBuffer)
    font.setVariation({ wght: 650, wdth: 87.5 })
    const manager = (font as unknown as { tableManager: { normalizedCoords: number[] } }).tableManager
    const normalized = manager.normalizedCoords
    const consumers = new Set<string>()
    const record = function record(name: string, coords: number[]): number {
      expect(coords).toBe(normalized)
      consumers.add(name)
      return 0
    }
    const define = function define(name: string, value: unknown): void {
      Object.defineProperty(manager, name, { value, configurable: true })
    }
    define('hvar', {
      hasLsbMapping: true, hasRsbMapping: true,
      getAdvanceWidthDelta(_glyphId: number, coords: number[]) { return record('HVAR advance', coords) },
      getLsbDelta(_glyphId: number, coords: number[]) { return record('HVAR LSB', coords) },
      getRsbDelta(_glyphId: number, coords: number[]) { return record('HVAR RSB', coords) },
    })
    define('vmtx', { getAdvanceHeight() { return 1000 }, getTopSideBearing() { return 0 } })
    define('vvar', {
      hasTsbMapping: true, hasBsbMapping: true, hasVOrgMapping: true,
      getAdvanceHeightDelta(_glyphId: number, coords: number[]) { return record('VVAR advance', coords) },
      getTsbDelta(_glyphId: number, coords: number[]) { return record('VVAR TSB', coords) },
      getBsbDelta(_glyphId: number, coords: number[]) { return record('VVAR BSB', coords) },
      getVOrgDelta(_glyphId: number, coords: number[]) { return record('VVAR origin', coords) },
    })
    define('mvar', { getMetricDelta(_tag: string, coords: number[]) { return record('MVAR', coords) } })
    define('base', {
      getDefaultBaseline(_script: string, _language: string | undefined, _direction: string, coords: number[]) {
        record('BASE default', coords)
        return { tag: 'romn', coordinate: 0 }
      },
      getBaselines(_script: string, _language: string | undefined, _direction: string, coords: number[]) {
        record('BASE values', coords)
        return [{ tag: 'romn', coordinate: 0 }]
      },
      getMinMax() { return null },
    })
    const gdef = {
      getGlyphClass() { return 0 },
      getMarkAttachClass() { return 0 },
      isMarkInSet() { return false },
      getVarDelta(_outer: number, _inner: number, coords: number[]) { return record('GDEF', coords) },
    }
    define('gdef', gdef)
    define('gpos', {
      hasKernFeature: false,
      getPositionAdjustments(glyphIds: number[], ...args: unknown[]) {
        const coords = args[7] as number[]
        gdef.getVarDelta(0, 0, coords)
        return glyphIds.map(function zero() { return { xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0 } })
      },
    })
    define('colr', {
      getColorLayers() { return null },
      getPaintTree(_glyphId: number, coords: number[]) { record('COLR paint', coords); return null },
      getClipBox(_glyphId: number, coords: number[]) { record('COLR clip', coords); return null },
    })

    const glyphId = font.getGlyphId(0x41)
    void font.metrics
    font.getAdvanceWidth(glyphId)
    font.getLeftSideBearing(glyphId)
    font.getRightSideBearing(glyphId)
    font.getAdvanceHeight(glyphId)
    font.getTopSideBearing(glyphId)
    font.getBottomSideBearing(glyphId)
    font.getPaintTree(glyphId)
    font.getClipBox(glyphId)
    font.shapeText('A')

    expect(consumers).toEqual(new Set([
      'HVAR advance', 'HVAR LSB', 'HVAR RSB',
      'VVAR advance', 'VVAR TSB', 'VVAR BSB',
      'MVAR', 'BASE default', 'BASE values', 'GDEF', 'COLR paint', 'COLR clip',
    ]))
  })
})

describe('gvar interpolation matches the reference instancer', () => {
  it.skipIf(!existsSync(VF_PATH))('matches fontTools metrics across simple/composite glyphs and variation regions', () => {
    const codePoints = Array.from('AáéÅǼüg8', function toCodePoint(char) { return char.codePointAt(0)! })
    const locations = [
      { wght: 100, wdth: 62.5 },
      { wght: 650, wdth: 87.5 },
      { wght: 900, wdth: 100 },
    ]
    const script = [
      'import json, sys',
      'from fontTools.ttLib import TTFont',
      'from fontTools.varLib.instancer import instantiateVariableFont',
      'path, locations_json, cps_json = sys.argv[1:]',
      'source = TTFont(path)',
      'locations = json.loads(locations_json)',
      'code_points = json.loads(cps_json)',
      'result = []',
      'for location in locations:',
      '  font = instantiateVariableFont(source, location, inplace=False)',
      '  glyf = font["glyf"]',
      '  rows = []',
      '  for cp in code_points:',
      '    name = font.getBestCmap()[cp]',
      '    glyph = glyf[name]',
      '    glyph.recalcBounds(glyf)',
      '    advance, lsb = font["hmtx"].metrics[name]',
      '    width = 0 if glyph.numberOfContours == 0 else glyph.xMax - glyph.xMin',
      '    rows.append([cp, advance, lsb, advance - lsb - width])',
      '  result.append(rows)',
      'print(json.dumps(result))',
    ].join('\n')
    const expected = JSON.parse(execFileSync('python3', [
      '-c', script, VF_PATH, JSON.stringify(locations), JSON.stringify(codePoints),
    ], { encoding: 'utf8' })) as number[][][]
    const font = Font.load(readFileSync(VF_PATH).buffer as ArrayBuffer)

    for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
      font.setVariation(locations[locationIndex]!)
      for (let i = 0; i < codePoints.length; i++) {
        const row = expected[locationIndex]![i]!
        const glyphId = font.getGlyphId(codePoints[i]!)
        expect(Math.round(font.getAdvanceWidth(glyphId)), `advance U+${codePoints[i]!.toString(16)}`).toBe(row[1])
        expect(font.getLeftSideBearing(glyphId), `LSB U+${codePoints[i]!.toString(16)}`).toBe(row[2])
        expect(font.getRightSideBearing(glyphId), `RSB U+${codePoints[i]!.toString(16)}`).toBe(row[3])
      }
    }
  }, 30_000)

  // The expected advance widths and tight glyph bounds below were produced by
  // fontTools' instantiateVariableFont at the same interpolated location
  // (wght=650 between masters, wdth=87.5 between 62.5 and 100). Matching them
  // exactly validates gvar tuple interpolation, region-scalar computation and
  // HVAR advance-delta interpolation against the reference implementation.
  const ORACLE: Record<string, { adv: number, lsb: number, rsb: number, bbox: [number, number, number, number] }> = {
    A: { adv: 619, lsb: 0, rsb: 0, bbox: [0, 0, 619, 716] },
    g: { adv: 579, lsb: 44, rsb: 69, bbox: [44, -240, 510, 555] },
    e: { adv: 539, lsb: 45, rsb: 42, bbox: [45, -10, 497, 554] },
    o: { adv: 569, lsb: 44, rsb: 44, bbox: [44, -10, 525, 555] },
    B: { adv: 609, lsb: 79, rsb: 47, bbox: [79, 0, 562, 714] },
    '8': { adv: 529, lsb: 34, rsb: 35, bbox: [34, -10, 494, 723] },
  }

  // Tight bounds of a cubic-normalized outline: flatten each curve and track extents.
  function tightBounds(outline: { commands: Uint8Array, coords: Float32Array }): [number, number, number, number] {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
    let ci = 0, cx = 0, cy = 0
    for (let i = 0; i < outline.commands.length; i++) {
      const c = outline.commands[i]!
      if (c === 0 || c === 1) {
        cx = outline.coords[ci++]!; cy = outline.coords[ci++]!
        if (cx < xMin) xMin = cx; if (cy < yMin) yMin = cy
        if (cx > xMax) xMax = cx; if (cy > yMax) yMax = cy
      } else if (c === 2) {
        const x1 = outline.coords[ci++]!, y1 = outline.coords[ci++]!
        const x2 = outline.coords[ci++]!, y2 = outline.coords[ci++]!
        const x = outline.coords[ci++]!, y = outline.coords[ci++]!
        for (let t = 1; t <= 20; t++) {
          const u = t / 20, m = 1 - u
          const bx = m * m * m * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x
          const by = m * m * m * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y
          if (bx < xMin) xMin = bx; if (by < yMin) yMin = by
          if (bx > xMax) xMax = bx; if (by > yMax) yMax = by
        }
        cx = x; cy = y
      }
    }
    return [Math.round(xMin), Math.round(yMin), Math.round(xMax), Math.round(yMax)]
  }

  it.skipIf(!existsSync(VF_PATH))('advance widths and tight bounds equal fontTools at wght=650, wdth=87.5', () => {
    const font = Font.load(readFileSync(VF_PATH).buffer as ArrayBuffer)
    font.setVariation({ wght: 650, wdth: 87.5 })
    for (const ch of Object.keys(ORACLE)) {
      const gid = font.getGlyphId(ch.codePointAt(0)!)
      expect(Math.round(font.getAdvanceWidth(gid))).toBe(ORACLE[ch]!.adv)
      expect(font.getLeftSideBearing(gid)).toBe(ORACLE[ch]!.lsb)
      expect(font.getRightSideBearing(gid)).toBe(ORACLE[ch]!.rsb)
      expect(tightBounds(font.getGlyph(gid).outline)).toEqual(ORACLE[ch]!.bbox)
    }
    font.setVariation({})
  })
})
