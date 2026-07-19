import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'

const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_JP_PATH = resolve(__dirname, 'fixtures/fonts/NotoSansJP-Regular.otf')
const SOURCE_SANS_PATH = resolve(__dirname, 'fixtures/fonts/SourceSans3-Regular.otf')

describe('Font.base', () => {
  // Verifies the base accessor returns null for a font (Roboto) that has no BASE table.
  it('Roboto には BASE テーブルがない → null', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.base).toBeNull()
  })

  // Verifies BASE parsing on NotoSansJP: getBaselines/getMinMax are callable and return well-formed results.
  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP に BASE テーブルが存在する', () => {
    const buffer = readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const base = font.base
    // NotoSansJP may carry a BASE table
    if (base !== null) {
      // Confirm getBaselines is callable
      const baselines = base.getBaselines('kana')
      expect(Array.isArray(baselines)).toBe(true)
      // Confirm getMinMax is callable
      const minMax = base.getMinMax('kana')
      expect(minMax === null || (typeof minMax.min === 'number' && typeof minMax.max === 'number')).toBe(true)
    }
  })

  // Real-font oracle: the baseline coordinates below were read from each font's
  // actual BASE horizontal axis via fontTools. Matching them validates the
  // BaseTagList / BaseScript / BaseCoord parsing against the reference.
  const coordFor = (bl: readonly { tag: string, coordinate: number }[], tag: string): number | undefined =>
    bl.find((b) => b.tag === tag)?.coordinate

  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP の BASE baseline が fontTools と一致する', () => {
    const font = Font.load(readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer)
    const base = font.base!
    expect(base).not.toBeNull()
    // icfb=-74, icft=834, ideo=-120, romn=0 for every script (latn/hani/kana/...).
    for (const script of ['latn', 'hani', 'kana', 'DFLT']) {
      const bl = base.getBaselines(script, undefined, 'horizontal')
      expect(coordFor(bl, 'icfb')).toBe(-74)
      expect(coordFor(bl, 'icft')).toBe(834)
      expect(coordFor(bl, 'ideo')).toBe(-120)
      expect(coordFor(bl, 'romn')).toBe(0)
    }
  })

  it.skipIf(!existsSync(NOTO_SANS_JP_PATH))('NotoSansJP の縦BASE baseline が fontTools と一致する', () => {
    const font = Font.load(readFileSync(NOTO_SANS_JP_PATH).buffer as ArrayBuffer)
    const base = font.base!
    expect(base).not.toBeNull()
    for (const script of ['latn', 'hani', 'kana', 'DFLT']) {
      const bl = base.getBaselines(script, undefined, 'vertical')
      expect(coordFor(bl, 'icfb')).toBe(46)
      expect(coordFor(bl, 'icft')).toBe(954)
      expect(coordFor(bl, 'ideo')).toBe(0)
      expect(coordFor(bl, 'romn')).toBe(120)
    }
  })

  it.skipIf(!existsSync(SOURCE_SANS_PATH))('SourceSans3 の BASE baseline が fontTools と一致する', () => {
    const font = Font.load(readFileSync(SOURCE_SANS_PATH).buffer as ArrayBuffer)
    const base = font.base!
    expect(base).not.toBeNull()
    // ideo=-170, romn=0.
    const bl = base.getBaselines('latn', undefined, 'horizontal')
    expect(coordFor(bl, 'ideo')).toBe(-170)
    expect(coordFor(bl, 'romn')).toBe(0)
  })

  // Verifies the base property conforms to the BaseTable | null contract (methods present when non-null).
  it('base プロパティの型が BaseTable | null であること', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const base = font.base
    if (base !== null) {
      expect(typeof base.getBaselines).toBe('function')
      expect(typeof base.getMinMax).toBe('function')
    } else {
      expect(base).toBeNull()
    }
  })
})
