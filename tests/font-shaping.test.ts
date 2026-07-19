import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'
import type { BaseTable, BaselineValue, MinMaxValue } from '../src/parsers/tables/base.js'
import type { KerxTable } from '../src/parsers/tables/kerx.js'
import type { MorxFeatureSelector } from '../src/parsers/tables/morx.js'
import type { GsubTable } from '../src/parsers/tables/gsub.js'
import type { JstfPriority } from '../src/parsers/tables/jstf.js'

const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-Regular.ttf')
const NOTO_SANS_JP_PATH = resolve(__dirname, 'fixtures/fonts/NotoSansJP-Regular.otf')
const NOTO_SANS_SINHALA_PATH = resolve(__dirname, 'fixtures/fonts/NotoSansSinhala-Regular.ttf')

function setParsedFontTable(font: Font, tag: 'gpos' | 'gsub' | 'kern' | 'kerx' | 'morx' | 'mort' | 'base' | 'feat' | 'ltag', value: unknown): void {
  Object.defineProperty((font as unknown as { tableManager: object }).tableManager, tag, {
    value,
    configurable: true,
  })
}

function makeKerxPairTable(leftGlyphId: number, rightGlyphId: number, value: number): KerxTable {
  return {
    version: 2,
    subtables: [],
    getKerning(left: number, right: number): number {
      return left === leftGlyphId && right === rightGlyphId ? value : 0
    },
    getPairAdjustment(left: number, right: number): { advance: number, crossStream: null } {
      return { advance: left === leftGlyphId && right === rightGlyphId ? value : 0, crossStream: null }
    },
    applyContextualKerning(glyphIds: readonly number[]): number[] {
      return new Array<number>(glyphIds.length).fill(0)
    },
    applyContextualPositioning(glyphIds: readonly number[]) {
      const n = glyphIds.length
      return {
        xAdvance: new Array<number>(n).fill(0),
        yAdvance: new Array<number>(n).fill(0),
        xOffset: new Array<number>(n).fill(0),
        yOffset: new Array<number>(n).fill(0),
      }
    },
    getAttachments(): [] {
      return []
    },
  }
}

function makeBaseTable(): BaseTable {
  const baselines = new Map<string, BaselineValue[]>([
    ['latn', [{ tag: 'ideo', coordinate: -120 }, { tag: 'romn', coordinate: 0 }]],
    ['hani', [{ tag: 'ideo', coordinate: 0 }, { tag: 'romn', coordinate: 120 }]],
  ])
  return {
    getBaselines(script: string): readonly BaselineValue[] {
      return baselines.get(script) ?? []
    },
    getDefaultBaseline(script: string): BaselineValue | null {
      if (script === 'latn') return { tag: 'romn', coordinate: 0 }
      if (script === 'hani') return { tag: 'ideo', coordinate: 0 }
      return null
    },
    getMinMax(): MinMaxValue | null {
      return null
    },
  }
}

function makeJstfPriority(overrides: Partial<JstfPriority>): JstfPriority {
  return {
    gsubShrinkageEnableLookups: [],
    gsubShrinkageDisableLookups: [],
    gposShrinkageEnableLookups: [],
    gposShrinkageDisableLookups: [],
    shrinkageJstfMax: null,
    gsubExtensionEnableLookups: [],
    gsubExtensionDisableLookups: [],
    gposExtensionEnableLookups: [],
    gposExtensionDisableLookups: [],
    extensionJstfMax: null,
    ...overrides,
  }
}

describe('shapeText() 統合テスト', () => {
  describe('JSTF lookup plans', () => {
    it('reshapes the unmodified text with disabled GSUB ligature lookups', () => {
      const font = Font.load(readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer)
      const manager = (font as unknown as { tableManager: { gsub: GsubTable } }).tableManager
      const ligaLookups = manager.gsub.getFeatureLookupIndexList('liga', 'latn')
      expect(ligaLookups.length).toBeGreaterThan(0)
      expect(font.shapeText('ffi', { script: 'latn' })).toHaveLength(1)

      const priority = makeJstfPriority({ gsubExtensionDisableLookups: ligaLookups })
      const extended = font.shapeText('ffi', {
        script: 'latn',
        jstf: { priority, mode: 'extend' },
      })

      expect(extended).toHaveLength(3)
      expect(extended.map(glyph => glyph.glyphId)).toEqual([
        font.getGlyphId(0x66), font.getGlyphId(0x66), font.getGlyphId(0x69),
      ])
    })
  })

  describe('基本シェーピング', () => {
    // Verifies shaping plain ASCII yields one valid glyph (positive advance) per character.
    it('ASCII テキストをシェーピングできる', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('Hello World')
      expect(shaped.length).toBe(11) // 11 characters including the space

      // All glyphs are valid
      for (const g of shaped) {
        expect(g.glyphId).toBeGreaterThanOrEqual(0)
        expect(g.xAdvance).toBeGreaterThan(0)
      }
    })

    // Verifies shaping an empty string returns an empty array.
    it('空文字列のシェーピングは空配列', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('')
      expect(shaped).toEqual([])
    })

    // Verifies shaping is deterministic: repeated identical characters map to the same glyph ID.
    it('同じ文字は同じグリフIDを返す', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('aaa')
      expect(shaped.length).toBe(3)
      expect(shaped[0]!.glyphId).toBe(shaped[1]!.glyphId)
      expect(shaped[1]!.glyphId).toBe(shaped[2]!.glyphId)
    })

    it('Unicode Decimal_Numberをautomatic fractionのmaskへ接続する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const manager = (font as unknown as { tableManager: { gsub: {
        applyShapingFeatures: (...args: unknown[]) => void
      } } }).tableManager
      const gsub = manager.gsub
      const original = gsub.applyShapingFeatures.bind(gsub)
      let capturedMasks: number[] | null = null
      let capturedFeatures: string[] | null = null
      gsub.applyShapingFeatures = function (...args: unknown[]): void {
        const buffer = args[0] as { masks: number[] | null }
        const features = args[1] as { tag: string }[]
        if (features.some(function (feature) { return feature.tag === 'frac' })) {
          capturedMasks = buffer.masks?.slice() ?? null
          capturedFeatures = features.map(function (feature) { return feature.tag })
        }
        original(...args)
      }

      font.shapeText('1\u20442')
      expect(capturedFeatures).toEqual(['numr', 'dnom', 'frac'])
      expect(capturedMasks).toEqual([11, 9, 13])

      capturedMasks = null
      font.shapeText('\u0661\u2044\u0662')
      expect(capturedMasks).toEqual([11, 9, 13])
      capturedMasks = null
      capturedFeatures = null
      font.shapeText('\u0661\u2044\u0662')
      expect(capturedFeatures).toEqual(['numr', 'dnom', 'frac'])
      expect(capturedMasks).toEqual([11, 9, 13])
    })
  })

  describe('リガチャ', () => {
    // Verifies the GSUB 'liga' feature can merge "fi" into one ligature glyph with a plausible width.
    it('Roboto で "fi" リガチャが適用される', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shapedFi = font.shapeText('fi')
      const shapedF = font.shapeText('f')
      const shapedI = font.shapeText('i')

      // If the ligature applied, we get a single glyph
      if (shapedFi.length === 1) {
        expect(shapedFi[0]!.glyphId).not.toBe(shapedF[0]!.glyphId)
        expect(shapedFi[0]!.glyphId).not.toBe(shapedI[0]!.glyphId)
        // The ligature glyph's xAdvance is close to the sum of f + i
        const sumAdvance = shapedF[0]!.xAdvance + shapedI[0]!.xAdvance
        expect(shapedFi[0]!.xAdvance).toBeGreaterThan(0)
        // The ligature width should not deviate greatly from the individual sum
        expect(Math.abs(shapedFi[0]!.xAdvance - sumAdvance)).toBeLessThan(sumAdvance * 0.5)
      }
    })

    // Verifies shaping "office" produces a glyph count consistent with optional ffi/fi ligature substitution.
    it('"office" に "ffi" リガチャが適用される可能性がある', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('office')
      // "office" = o, ffi or f+fi, c, e → 4 or 5 or 6 glyphs
      expect(shaped.length).toBeLessThanOrEqual(6)
      expect(shaped.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('カーニング', () => {
    // Verifies negative kerning for the "AV" pair reduces xAdvance below the base advance width.
    it('Roboto で "AV" にカーニングが適用される', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('AV')
      expect(shaped.length).toBe(2)

      const aGid = shaped[0]!.glyphId
      const aBaseWidth = font.getAdvanceWidth(aGid)

      // After kerning, xAdvance is smaller than the base width
      expect(shaped[0]!.xAdvance).toBeLessThan(aBaseWidth)
    })

    // Verifies kerning applies within a longer string containing multiple pairs (AVAT).
    it('Roboto で "AVAT" のカーニングが正しく適用される', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('AVAT')
      expect(shaped.length).toBe(4)

      // Kerning applies to the AV pair
      const aWidth = font.getAdvanceWidth(shaped[0]!.glyphId)
      expect(shaped[0]!.xAdvance).toBeLessThan(aWidth)
    })

    // Verifies xAdvance equals the raw hmtx advance when no kerning pair exists ("III").
    it('カーニングがない文字列では advanceWidth と一致する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // "III" — normally has no kerning
      const shaped = font.shapeText('III')
      for (const g of shaped) {
        const baseWidth = font.getAdvanceWidth(g.glyphId)
        expect(g.xAdvance).toBe(baseWidth)
      }
    })
  })

  describe('テキスト幅計算', () => {
    // Verifies summing shaped xAdvance values gives a text width close to the naive advance sum (kerning-adjusted).
    it('shapeText の xAdvance 合計でテキスト幅が計算できる', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('Hello')
      const totalWidth = shaped.reduce((sum, g) => sum + g.xAdvance, 0)
      expect(totalWidth).toBeGreaterThan(0)

      // Should not deviate greatly from the sum of each character's advanceWidth
      const naiveWidth = shaped.reduce((sum, g) => sum + font.getAdvanceWidth(g.glyphId), 0)
      // The kerning-induced difference should be small
      expect(Math.abs(totalWidth - naiveWidth)).toBeLessThan(naiveWidth * 0.2)
    })
  })

  // Guards the fix for kerning being silently dropped whenever a GPOS table was present.
  describe('regression: kern fallback when GPOS exists', () => {
    // Verifies shapeText applies AV kerning even in fonts where GPOS provides the kern feature (previously skipped).
    it('shapeText should apply kerning even when GPOS has kern feature', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // "AV" must have negative kerning applied through shapeText
      // Previously, kern table was never used when GPOS existed
      const shaped = font.shapeText('AV')
      expect(shaped.length).toBe(2)

      const aBaseWidth = font.getAdvanceWidth(shaped[0]!.glyphId)
      // xAdvance should be less than base width (kerning applied)
      expect(shaped[0]!.xAdvance).toBeLessThan(aBaseWidth)
    })

    // Verifies getKerning consults GPOS before the legacy kern table and that shapeText reflects the same value.
    it('getKerning should check GPOS first, then kern table', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)

      // getKerning should return non-zero for "AV"
      const kern = font.getKerning(aGid, vGid)
      expect(kern).toBeLessThan(0)

      // shapeText result should reflect this kerning
      const shaped = font.shapeText('AV')
      const shapedKern = shaped[0]!.xAdvance - font.getAdvanceWidth(aGid)
      expect(shapedKern).toBeLessThan(0)
    })
  })

  describe('AAT kerx consumption', () => {
    // Verifies the public kerning API consumes parsed AAT kerx pairs before the legacy kern table.
    it('getKerning は kerx を kern より優先して消費する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)

      setParsedFontTable(font, 'gpos', null)
      setParsedFontTable(font, 'kern', { getKerning: () => -10 })
      setParsedFontTable(font, 'kerx', makeKerxPairTable(aGid, vGid, -123))

      expect(font.getKerning(aGid, vGid)).toBe(-123)
    })

    // Verifies shaping uses parsed AAT kerx pair kerning when GPOS positioning has no xAdvance.
    it('shapeText は GPOS xAdvance がない場合に kerx ペアカーニングを適用する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      const aBaseWidth = font.getAdvanceWidth(aGid)
      const vBaseWidth = font.getAdvanceWidth(vGid)

      setParsedFontTable(font, 'gpos', null)
      setParsedFontTable(font, 'kern', null)
      setParsedFontTable(font, 'kerx', makeKerxPairTable(aGid, vGid, -111))

      const shaped = font.shapeText('AV')
      expect(shaped.length).toBe(2)
      expect(shaped[0]!.glyphId).toBe(aGid)
      expect(shaped[1]!.glyphId).toBe(vGid)
      expect(shaped[0]!.xAdvance).toBe(aBaseWidth - 56)
      expect(shaped[1]!.xAdvance).toBe(vBaseWidth - 55)
      expect(shaped[1]!.xOffset).toBe(-55)
    })

    // Verifies shaping consumes kerx format-1 contextual kerning (a per-position
    // x-advance adjustment over the whole run, not a pair value).
    it('shapeText は kerx format 1 の文脈依存カーニングを消費する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      const aBaseWidth = font.getAdvanceWidth(aGid)
      const vBaseWidth = font.getAdvanceWidth(vGid)

      setParsedFontTable(font, 'gpos', null)
      setParsedFontTable(font, 'kern', null)
      // Contextual table: +40 on the first position, -70 on the second.
      const contextual: KerxTable = {
        version: 2,
        subtables: [],
        getKerning(): number { return 0 },
        getPairAdjustment(): { advance: number, crossStream: null } {
          return { advance: 0, crossStream: null }
        },
        applyContextualKerning(glyphIds: readonly number[]): number[] {
          return glyphIds.map((_, i) => (i === 0 ? 40 : i === 1 ? -70 : 0))
        },
        applyContextualPositioning(glyphIds: readonly number[]) {
          return {
            xAdvance: glyphIds.map((_, i) => (i === 0 ? 40 : i === 1 ? -70 : 0)),
            yAdvance: new Array<number>(glyphIds.length).fill(0),
            xOffset: new Array<number>(glyphIds.length).fill(0),
            yOffset: new Array<number>(glyphIds.length).fill(0),
          }
        },
        getAttachments(): [] { return [] },
      }
      setParsedFontTable(font, 'kerx', contextual)

      const shaped = font.shapeText('AV')
      expect(shaped[0]!.xAdvance).toBe(aBaseWidth + 40)
      expect(shaped[1]!.xAdvance).toBe(vBaseWidth - 70)
    })

    it('shapeText は vertical kerx advance と cross-stream offset を縦書き座標へ接続する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      const aBaseHeight = font.getAdvanceHeight(aGid)
      const vBaseHeight = font.getAdvanceHeight(vGid)
      const table = makeKerxPairTable(aGid, vGid, 0)
      table.getPairAdjustment = function (left: number, right: number, direction: 'horizontal' | 'vertical') {
        return left === aGid && right === vGid && direction === 'vertical'
          ? { advance: -100, crossStream: 25 }
          : { advance: 0, crossStream: null }
      }

      setParsedFontTable(font, 'gpos', null)
      setParsedFontTable(font, 'kern', null)
      setParsedFontTable(font, 'kerx', table)

      const shaped = font.shapeText('AV', { direction: 'vertical' })
      expect(shaped[0]!.yAdvance).toBe(aBaseHeight - 50)
      expect(shaped[1]!.yAdvance).toBe(vBaseHeight - 50)
      expect(shaped[1]!.yOffset).toBe(-50)
      expect(shaped[1]!.xOffset).toBe(25)
    })

    it('shapeText は kerx format 4 control-point attachment を変形後outline点へ接続する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      const aPoint = font.getGlyphControlPoint(aGid, 0)
      const vPoint = font.getGlyphControlPoint(vGid, 0)
      const aAdvance = font.getAdvanceWidth(aGid)
      const table = makeKerxPairTable(aGid, vGid, 0)
      table.getAttachments = function () {
        return [{ markIndex: 0, currentIndex: 1, actionType: 0, values: [0, 0] }]
      }

      setParsedFontTable(font, 'gpos', null)
      setParsedFontTable(font, 'kern', null)
      setParsedFontTable(font, 'kerx', table)

      const shaped = font.shapeText('AV')
      expect(shaped[1]!.xOffset).toBe(aPoint.x - aAdvance - vPoint.x)
      expect(shaped[1]!.yOffset).toBe(aPoint.y - vPoint.y)
    })

    it('shapeText は kerx format 4 inline coordinate attachment をglyph位置へ接続する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const aGid = font.getGlyphId('A'.codePointAt(0)!)
      const vGid = font.getGlyphId('V'.codePointAt(0)!)
      const aAdvance = font.getAdvanceWidth(aGid)
      const table = makeKerxPairTable(aGid, vGid, 0)
      table.getAttachments = function () {
        return [{ markIndex: 0, currentIndex: 1, actionType: 2, values: [100, 200, -20, 30] }]
      }

      setParsedFontTable(font, 'gpos', null)
      setParsedFontTable(font, 'kern', null)
      setParsedFontTable(font, 'kerx', table)

      const shaped = font.shapeText('AV')
      expect(shaped[1]!.xOffset).toBe(100 - aAdvance + 20)
      expect(shaped[1]!.yOffset).toBe(170)
    })
  })

  describe('AAT morx consumption', () => {
    // Verifies explicit AAT feature selectors reach the morx fallback when GSUB is absent.
    it('shapeText は aatFeatures を morx feature selector として渡す', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      let selected: readonly MorxFeatureSelector[] | undefined
      let boundary: 'text' | 'line' | undefined

      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'morx', {
        chains: [],
        applySubstitutions(glyphIds: number[], features?: readonly MorxFeatureSelector[]): number[] {
          selected = features
          return glyphIds
        },
        applySubstitutionsTracked(
          run: { glyphs: number[], clusters: number[] },
          features?: readonly MorxFeatureSelector[],
          _rightToLeft?: boolean,
          context?: { boundary?: 'text' | 'line' },
        ) {
          selected = features
          boundary = context?.boundary
          return run
        },
      })

      font.shapeText('A', { aatFeatures: [{ featureType: 1, featureSetting: 2 }], aatBoundary: 'line' })
      expect(selected).toEqual([{ featureType: 1, featureSetting: 2 }])
      expect(boundary).toBe('line')
    })

    // Verifies OpenType feature tags are converted to AAT Ligatures selectors for morx.
    it('shapeText は liga tag を AAT Common Ligatures selector に変換する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      let selected: readonly MorxFeatureSelector[] | undefined

      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'morx', {
        chains: [],
        applySubstitutions(glyphIds: number[], features?: readonly MorxFeatureSelector[]): number[] {
          selected = features
          return glyphIds
        },
        applySubstitutionsTracked(run: { glyphs: number[], clusters: number[] }, features?: readonly MorxFeatureSelector[]) {
          selected = features
          return run
        },
      })

      font.shapeText('A', { features: new Set(['liga']) })
      expect(selected).toContainEqual({ featureType: 1, featureSetting: 2 })
    })

    // Verifies BCP 47 matching is case-insensitive and uses ltag index + 1.
    it('shapeText は language を feat type 39 の ltag selector に変換する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      let selected: readonly MorxFeatureSelector[] | undefined
      const languageFeature = {
        featureType: 39,
        nSettings: 2,
        settingTableOffset: 0,
        featureFlags: 0x8000,
        nameIndex: 256,
        selectors: [
          { selectorValue: 0, nameIndex: 257 },
          { selectorValue: 1, nameIndex: 258 },
        ],
      }

      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'feat', {
        features: [languageFeature],
        getFeature: (featureType: number) => featureType === 39 ? languageFeature : null,
      })
      setParsedFontTable(font, 'ltag', { version: 1, flags: 0, tags: ['sr'], getTag: (index: number) => index === 0 ? 'sr' : null })
      setParsedFontTable(font, 'morx', {
        chains: [],
        applySubstitutions: (glyphIds: number[]) => glyphIds,
        applySubstitutionsTracked(run: { glyphs: number[], clusters: number[] }, features?: readonly MorxFeatureSelector[]) {
          selected = features
          return run
        },
      })

      font.shapeText('A', { language: 'SR' })
      expect(selected).toContainEqual({ featureType: 39, featureSetting: 1 })
    })

    // Verifies an explicit language selector is authoritative over automatic ltag selection.
    it('shapeText は明示的な type 39 selector を language より優先する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      let selected: readonly MorxFeatureSelector[] | undefined
      const languageFeature = {
        featureType: 39,
        nSettings: 2,
        settingTableOffset: 0,
        featureFlags: 0x8000,
        nameIndex: 256,
        selectors: [
          { selectorValue: 0, nameIndex: 257 },
          { selectorValue: 1, nameIndex: 258 },
        ],
      }

      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'feat', {
        features: [languageFeature],
        getFeature: (featureType: number) => featureType === 39 ? languageFeature : null,
      })
      setParsedFontTable(font, 'ltag', { version: 1, flags: 0, tags: ['sr'], getTag: (index: number) => index === 0 ? 'sr' : null })
      setParsedFontTable(font, 'morx', {
        chains: [],
        applySubstitutions: (glyphIds: number[]) => glyphIds,
        applySubstitutionsTracked(run: { glyphs: number[], clusters: number[] }, features?: readonly MorxFeatureSelector[]) {
          selected = features
          return run
        },
      })

      font.shapeText('A', { language: 'sr', aatFeatures: [{ featureType: 39, featureSetting: 0 }] })
      expect(selected?.filter(feature => feature.featureType === 39)).toEqual([{ featureType: 39, featureSetting: 0 }])
    })

    // Verifies public numeric selectors are checked against feat metadata.
    it('shapeText は feat にない明示selectorを拒否する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const languageFeature = {
        featureType: 39,
        nSettings: 1,
        settingTableOffset: 0,
        featureFlags: 0x8000,
        nameIndex: 256,
        selectors: [{ selectorValue: 0, nameIndex: 257 }],
      }
      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'feat', {
        features: [languageFeature],
        getFeature: (featureType: number) => featureType === 39 ? languageFeature : null,
      })
      setParsedFontTable(font, 'morx', {
        chains: [],
        applySubstitutions: (glyphIds: number[]) => glyphIds,
        applySubstitutionsTracked: (run: { glyphs: number[], clusters: number[] }) => run,
      })

      expect(() => font.shapeText('A', { aatFeatures: [{ featureType: 39, featureSetting: 2 }] }))
        .toThrow('does not declare selector 2')
    })

    // Verifies feat flags and name IDs are resolved through the public font API.
    it('getAatFeatureDescriptions はexclusive defaultとsettingを公開する', () => {
      const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
      const feature = {
        featureType: 6,
        nSettings: 2,
        settingTableOffset: 0,
        featureFlags: 0xC001,
        nameIndex: 256,
        selectors: [
          { selectorValue: 0, nameIndex: 257 },
          { selectorValue: 3, nameIndex: 258 },
        ],
      }
      setParsedFontTable(font, 'feat', { features: [feature], getFeature: () => feature })

      expect(font.getAatFeatureDescriptions()).toEqual([{
        featureType: 6,
        nameId: 256,
        name: null,
        exclusive: true,
        defaultSelector: 3,
        settings: [
          { selector: 0, nameId: 257, name: null, languageTag: null },
          { selector: 3, nameId: 258, name: null, languageTag: null },
        ],
      }])
    })
  })

  describe('AAT mort consumption', () => {
    // Verifies explicit AAT feature selectors reach the mort fallback when GSUB and morx are absent.
    it('shapeText は aatFeatures を mort feature selector として渡す', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      let selected: readonly MorxFeatureSelector[] | undefined

      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'morx', null)
      setParsedFontTable(font, 'mort', {
        chains: [],
        applySubstitutions(glyphIds: number[], features?: readonly MorxFeatureSelector[]): number[] {
          selected = features
          return glyphIds
        },
        applySubstitutionsTracked(run: { glyphs: number[], clusters: number[] }, features?: readonly MorxFeatureSelector[]) {
          selected = features
          return run
        },
      })

      font.shapeText('A', { aatFeatures: [{ featureType: 1, featureSetting: 2 }] })
      expect(selected).toEqual([{ featureType: 1, featureSetting: 2 }])
    })

    // Verifies OpenType feature tags are converted to AAT Ligatures selectors for mort.
    it('shapeText は liga tag を mort fallback 用の AAT Common Ligatures selector に変換する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      let selected: readonly MorxFeatureSelector[] | undefined

      setParsedFontTable(font, 'gsub', null)
      setParsedFontTable(font, 'morx', null)
      setParsedFontTable(font, 'mort', {
        chains: [],
        applySubstitutions(glyphIds: number[], features?: readonly MorxFeatureSelector[]): number[] {
          selected = features
          return glyphIds
        },
        applySubstitutionsTracked(run: { glyphs: number[], clusters: number[] }, features?: readonly MorxFeatureSelector[]) {
          selected = features
          return run
        },
      })

      font.shapeText('A', { features: new Set(['liga']) })
      expect(selected).toContainEqual({ featureType: 1, featureSetting: 2 })
    })
  })

  describe('BASE consumption', () => {
    // Verifies mixed-script horizontal shaping aligns glyphs through BASE baseline coordinates.
    it('shapeText は混在スクリプトの baseline を BASE 座標で補正する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      setParsedFontTable(font, 'base', makeBaseTable())

      const shaped = font.shapeText('A日')

      expect(shaped).toHaveLength(2)
      expect(shaped[0]!.yOffset).toBe(0)
      expect(shaped[1]!.yOffset).toBe(-120)
    })

    // Verifies the first script's default baseline becomes the reference baseline tag.
    it('shapeText は先頭スクリプトの既定 baseline tag を基準にする', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      setParsedFontTable(font, 'base', makeBaseTable())

      const shaped = font.shapeText('日A')

      expect(shaped).toHaveLength(2)
      expect(shaped[0]!.yOffset).toBe(0)
      expect(shaped[1]!.yOffset).toBe(120)
    })

    it('shapeText は縦BASE座標をcross-stream x offsetへ接続する', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)
      const base = makeBaseTable()
      const directions: string[] = []
      const originalBaselines = base.getBaselines
      const originalDefault = base.getDefaultBaseline
      base.getBaselines = function getBaselines(script, language, direction, coords) {
        directions.push(direction ?? 'horizontal')
        return originalBaselines(script, language, direction, coords)
      }
      base.getDefaultBaseline = function getDefaultBaseline(script, language, direction, coords) {
        directions.push(direction ?? 'horizontal')
        return originalDefault(script, language, direction, coords)
      }
      setParsedFontTable(font, 'base', base)

      const shaped = font.shapeText('A日', { direction: 'vertical' })

      expect(shaped).toHaveLength(2)
      expect(shaped[0]!.xOffset).toBe(0)
      expect(shaped[1]!.xOffset).toBe(-120)
      expect(directions.every(function isVertical(direction) { return direction === 'vertical' })).toBe(true)
    })
  })

  describe('Sinhala shaping', () => {
    // Verifies Sinhala uses its script shaping feature set without requiring caller-specified features.
    it('shapeText は Sinhala rakaransaya を既定featureで形成する', () => {
      const buffer = readFileSync(NOTO_SANS_SINHALA_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('ක්‍ර', { script: 'sinh' })

      expect(shaped.map((g) => g.glyphId)).toEqual([23, 130])
      expect(shaped[1]!.xOffset).toBe(-865)
    })
  })

  describe('NotoSans', () => {
    // Verifies shaping works on a second Latin font (NotoSans), not just Roboto.
    it('NotoSans でもシェーピングが動作する', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('The quick brown fox')
      expect(shaped.length).toBe(19)
      for (const g of shaped) {
        expect(g.xAdvance).toBeGreaterThan(0)
      }
    })
  })

  describe('CJK テキスト (NotoSansJP)', () => {
    // Verifies Japanese hiragana shapes to one mapped glyph with positive advance per character.
    it('日本語テキストの基本グリフ取得', () => {
      const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('こんにちは')
      expect(shaped.length).toBe(5)
      for (const g of shaped) {
        expect(g.glyphId).toBeGreaterThan(0)
        expect(g.xAdvance).toBeGreaterThan(0)
      }
    })

    // Verifies CJK ideographs share the same full-width advance.
    it('CJK 文字の幅は等幅 (全角)', () => {
      const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('漢字')
      expect(shaped.length).toBe(2)
      // CJK ideographs are basically the same (full) width
      expect(shaped[0]!.xAdvance).toBe(shaped[1]!.xAdvance)
    })

    // Verifies mixed ASCII + CJK text shapes correctly and CJK advances exceed ASCII advances.
    it('ASCII と CJK 混在テキスト', () => {
      const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('Hello世界')
      expect(shaped.length).toBe(7) 
      for (const g of shaped) {
        expect(g.glyphId).toBeGreaterThan(0)
        expect(g.xAdvance).toBeGreaterThan(0)
      }

      // CJK characters should be wider than ASCII
      const asciiAdvance = shaped[0]!.xAdvance // 'H'
      const cjkAdvance = shaped[5]!.xAdvance   
      expect(cjkAdvance).toBeGreaterThan(asciiAdvance)
    })
  })

  describe('マーク結合', () => {
    // Verifies GPOS mark positioning gives a combining acute accent zero xAdvance after the base glyph.
    it('NotoSans で combining acute のグリフが取得できる', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // é = e + combining acute accent (U+0301)
      // NotoSans has \u00e9 (U+00E9), so the default shaper composes e + acute into
      // one precomposed glyph (font-aware NFC, matches hb-shape).
      const composed = font.shapeText('e\u0301')
      expect(composed.length).toBe(1)
      expect(composed[0]!.glyphId).toBe(font.getGlyphId(0x00E9))
      // A base with no precomposed form (k + acute) stays as base + GPOS mark.
      const attached = font.shapeText('q\u0301')
      expect(attached.length).toBe(2)
      expect(attached[1]!.xAdvance).toBe(0)
    })

    // Verifies a base letter plus combining grave shapes to two glyphs with a positive base advance.
    it('複数のダイアクリティカルマーク', () => {
      const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // e + circumflex + acute recompose sequentially into ế (U+1EBF), a single
      // precomposed glyph the font has (matches hb-shape).
      const shaped = font.shapeText('ế')
      expect(shaped.length).toBe(1)
      expect(shaped[0]!.glyphId).toBe(font.getGlyphId(0x1EBF))
      expect(shaped[0]!.xAdvance).toBeGreaterThan(0)
    })

    // Font-aware NFC composition depends on cmap/glyph presence, not GSUB:
    // a font with no GSUB still composes base + mark into a precomposed glyph.
    it('NFC合成はGSUB非依存（GSUBなしでも精合成グリフへ合成）', () => {
      const font = Font.load(readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer)
      setParsedFontTable(font, 'gsub', null)
      const decomposed = String.fromCodePoint(0x65, 0x0301) // e + combining acute
      const shaped = font.shapeText(decomposed)
      expect(shaped.length).toBe(1)
      expect(shaped[0]!.glyphId).toBe(font.getGlyphId(0x00E9)) // é
    })
  })

  describe('Feature toggling', () => {
    // Verifies passing an empty feature set disables the default liga feature, splitting "fi" back into two glyphs.
    it('liga=off でリガチャが抑制される (features に liga を含めない)', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // Shaping with defaults (liga enabled)
      const shapedDefault = font.shapeText('fi')

      // With liga disabled (empty features set → no default features)
      // Note: an empty features set disables all default features
      const shapedNoLiga = font.shapeText('fi', { features: new Set<string>() })

      // With empty features, no ligature applies → 2 glyphs
      if (shapedDefault.length === 1) {
        // If the ligature applied by default, empty features should restore 2 glyphs
        expect(shapedNoLiga.length).toBe(2)
      }
    })

    // Verifies disabling the kern feature leaves xAdvance exactly at the base advance width.
    it('kern feature 無効でカーニングが適用されない', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      // Empty features → kern feature not included
      const shapedNoKern = font.shapeText('AV', { features: new Set<string>() })
      expect(shapedNoKern.length).toBe(2)

      const aBaseWidth = font.getAdvanceWidth(shapedNoKern[0]!.glyphId)
      // Without the kern feature, xAdvance stays at baseWidth
      expect(shapedNoKern[0]!.xAdvance).toBe(aBaseWidth)
    })
  })

  describe('Script 指定', () => {
    // Verifies shaping works when the script is explicitly set to 'latn'.
    it('script="latn" で Latin テキストをシェーピング', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('Hello', { script: 'latn' })
      expect(shaped.length).toBe(5)
      for (const g of shaped) {
        expect(g.xAdvance).toBeGreaterThan(0)
      }
    })

    // Verifies script auto-detection produces the same glyphs and advances as an explicit 'latn' script.
    it('明示的 script 指定とデフォルトで同じ結果', () => {
      const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shapedDefault = font.shapeText('Hello World')
      const shapedLatn = font.shapeText('Hello World', { script: 'latn' })

      expect(shapedDefault.length).toBe(shapedLatn.length)
      for (let i = 0; i < shapedDefault.length; i++) {
        expect(shapedDefault[i]!.glyphId).toBe(shapedLatn[i]!.glyphId)
        expect(shapedDefault[i]!.xAdvance).toBe(shapedLatn[i]!.xAdvance)
      }
    })
  })

  describe('縦書きシェーピング', () => {
    // Verifies vertical-direction shaping of kana returns mapped glyphs without error.
    it('direction="vertical" で縦書きシェーピング', () => {
      const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('あいう', { direction: 'vertical' })
      expect(shaped.length).toBe(3)
      for (const g of shaped) {
        expect(g.glyphId).toBeGreaterThan(0)
      }
    })

    
    it('縦書きと横書きで異なるグリフ/メトリクスになりうる', () => {
      const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shapedH = font.shapeText('ー', { direction: 'horizontal' })
      const shapedV = font.shapeText('ー', { direction: 'vertical' })

      expect(shapedH.length).toBe(1)
      expect(shapedV.length).toBe(1)

      // 「」 vert feature with forglyph possible.
      // Glyph ID, check.
      
      // Confirm the glyph ID differs or the metrics differ
      const hGlyph = shapedH[0]!
      const vGlyph = shapedV[0]!
      const isDifferent = hGlyph.glyphId !== vGlyph.glyphId ||
                          hGlyph.xAdvance !== vGlyph.xAdvance ||
                          hGlyph.yAdvance !== vGlyph.yAdvance
      expect(isDifferent).toBe(true)
    })

    // HarfBuzz applies only the `vert` GSUB feature (plus the common GPOS
    // features) for vertical text — never vpal/valt/vkrn/vrt2. Matching that
    // keeps full-width CJK glyphs on a 1em vertical advance (a proportional
    // vpal/valt would shrink e.g. 。 to a half-em advance and break the grid).
    it('縦書き既定シェーピングは vert のみ適用しCJK送りを比例化しない', () => {
      const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
      const font = Font.load(buffer)

      const shaped = font.shapeText('日本語。', { direction: 'vertical', script: 'hani' })
      // No proportional re-spacing: every glyph advances by its vmtx height.
      for (const g of shaped) {
        expect(g.yAdvance).toBe(font.getAdvanceHeight(g.glyphId))
      }
      // The `vert` feature still substitutes 。 for its vertical presentation form.
      const dotHorizontal = font.getGlyphId('。'.codePointAt(0)!)
      expect(shaped[shaped.length - 1]!.glyphId).not.toBe(dotHorizontal)
    })
  })

  describe('アラビア文字の接合形（文脈形）', () => {
    const NOTO_ARABIC_PATH = resolve(__dirname, 'fixtures/fonts/NotoSansArabic-Regular.ttf')

    function loadArabicFont(): Font {
      const buffer = readFileSync(NOTO_ARABIC_PATH).buffer as ArrayBuffer
      return Font.load(buffer)
    }

    // Verifies joining analysis produces contextual forms for مرحبا, matching
    // the HarfBuzz ground truth for this font: م init=79, ر fina=31, ح init=27,
    // ب medi = ccmp-decomposed skeleton 16 + dot mark 317, ا fina=9.
    it('مرحبا が文脈形（init/fina/medi）でシェーピングされる', () => {
      const font = loadArabicFont()
      const shaped = font.shapeText('مرحبا')
      expect(shaped.map(g => g.glyphId)).toEqual([79, 31, 27, 16, 317, 9])
      // Exact cluster tracking: the dot mark is a continuation glyph (count 0)
      expect(shaped.map(g => g.componentCount)).toEqual([1, 1, 1, 1, 0, 1])
      // The mark advances by zero and is positioned via GPOS mark attachment
      expect(shaped[4]!.xAdvance).toBe(0)
    })

    // Verifies a lone letter keeps its isolated (cmap) form.
    it('単独のアラビア文字は孤立形のまま', () => {
      const font = loadArabicFont()
      const isolated = font.getGlyphId('م'.codePointAt(0)!)
      const shaped = font.shapeText('م')
      expect(shaped.length).toBe(1)
      expect(shaped[0]!.glyphId).toBe(isolated)
    })

    // Verifies a right-joining letter does not cause an init form on the next
    // letter: alef (R) joins only on its right side, so in 'ار' both letters
    // stay isolated.
    it('右接合文字（R）の直後の文字は init にならない', () => {
      const font = loadArabicFont()
      const alefIsol = font.getGlyphId('ا'.codePointAt(0)!)
      const rehIsol = font.getGlyphId('ر'.codePointAt(0)!)
      const shaped = font.shapeText('ار')
      expect(shaped.map(g => g.glyphId)).toEqual([alefIsol, rehIsol])
    })

    // Verifies transparent characters (combining marks) are skipped by the
    // joining analysis: a fatha between meem and reh must not break the join.
    it('間に結合記号（transparent）があっても接合が維持される', () => {
      const font = loadArabicFont()
      const shaped = font.shapeText('مَر') // meem + fatha + reh
      expect(shaped.length).toBe(3)
      expect(shaped[0]!.glyphId).toBe(79) // meem.init
      expect(shaped[2]!.glyphId).toBe(31) // reh.fina
    })

    // Verifies tatweel (join-causing) creates joining context on both sides.
    it('タトウィール（C）を挟んでも接合される', () => {
      const font = loadArabicFont()
      const shaped = font.shapeText('مـر') // meem + tatweel + reh
      expect(shaped.length).toBe(3)
      expect(shaped[0]!.glyphId).toBe(79) // meem.init
      expect(shaped[2]!.glyphId).toBe(31) // reh.fina
    })

    // Verifies ZWNJ (non-joining) blocks the join: both letters stay isolated.
    it('ZWNJ（U+200C）は接合を遮断する', () => {
      const font = loadArabicFont()
      const meemIsol = font.getGlyphId('م'.codePointAt(0)!)
      const rehIsol = font.getGlyphId('ر'.codePointAt(0)!)
      const shaped = font.shapeText('م‌ر')
      expect(shaped.length).toBe(3)
      expect(shaped[0]!.glyphId).toBe(meemIsol)
      expect(shaped[2]!.glyphId).toBe(rehIsol)
    })

    // Verifies non-Arabic text is unaffected by the joining path (gate check).
    it('アラビア文字を含まないテキストのシェーピングは従来どおり', () => {
      const font = loadArabicFont()
      const shaped = font.shapeText('ABC 123')
      expect(shaped.length).toBe(7)
      for (let i = 0; i < shaped.length; i++) {
        const cp = 'ABC 123'.codePointAt(i)!
        expect(shaped[i]!.glyphId).toBe(font.getGlyphId(cp))
      }
    })
  })
})

describe('AAT variation positioning integration', () => {
  it('kerxが無くてもkern variationへgvar shared tuple scalarを渡す', () => {
    const font = Font.load(readFileSync(ROBOTO_PATH).buffer as ArrayBuffer)
    const manager = (font as unknown as { tableManager: object }).tableManager
    const define = (name: string, value: unknown): void => {
      Object.defineProperty(manager, name, { value, configurable: true })
    }
    let receivedScalars: readonly number[] | undefined
    define('gpos', null)
    define('kerx', null)
    define('normalizedCoords', [0.75])
    define('gvar', {
      getSharedTupleScalars(coords: readonly number[]): number[] {
        expect(coords).toEqual([0.75])
        return [0.75]
      },
    })
    define('kern', {
      applyContextualPositioning(glyphIds: readonly number[]) {
        const zeros = (): number[] => new Array<number>(glyphIds.length).fill(0)
        return { xAdvance: zeros(), yAdvance: zeros(), xOffset: zeros(), yOffset: zeros() }
      },
      getPairAdjustment(
        _left: number,
        _right: number,
        _direction: string,
        tupleScalars?: readonly number[],
      ) {
        receivedScalars = tupleScalars
        return { advance: -40 * tupleScalars![0]!, crossStream: null, minimum: null }
      },
    })

    const gidA = font.getGlyphId(0x41)
    const gidV = font.getGlyphId(0x56)
    const shaped = font.shapeText('AV')
    expect(receivedScalars).toEqual([0.75])
    expect(shaped[0]!.xAdvance + shaped[1]!.xAdvance).toBe(
      font.getAdvanceWidth(gidA) + font.getAdvanceWidth(gidV) - 30,
    )
  })
})

// A ligature formed by an AAT morx font must carry its source-component count
// (derived from morx cluster tracking) so glyphs map back to the right source
// characters for ToUnicode. Zapfino uses morx and ligates within "Hamburge".
const ZAPFINO = '/System/Library/Fonts/Supplemental/Zapfino.ttf'
describe.skipIf(!existsSync(ZAPFINO))('AAT morx ligature source-component counts', () => {
  const font = Font.load(readFileSync(ZAPFINO).buffer as ArrayBuffer)

  it('sums component counts to the source character count across a ligature', () => {
    const text = 'Hamburgefonts 2024'
    const shaped = font.shapeText(text)
    // One ligature reduces the glyph count below the character count.
    expect(shaped.length).toBeLessThan(text.length)
    const total = shaped.reduce((s, g) => s + g.componentCount, 0)
    expect(total).toBe(text.length)
    // Exactly one glyph spans two source characters (the ligature).
    expect(shaped.filter(g => g.componentCount === 2)).toHaveLength(1)
  })
})
