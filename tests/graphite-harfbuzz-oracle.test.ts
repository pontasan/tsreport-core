import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/index.js'
import { layoutText } from '../src/layout/text-layout.js'
import { TextMeasurer } from '../src/measure/text-measurer.js'

interface HarfBuzzGlyph {
  g: number
  cl: number
  dx: number
  dy: number
  ax: number
  ay: number
}

interface GraphiteStandardSlot {
  gid: number
  origin: [number, number]
  advance: [number, number]
}

const bundledCorpusRoot = resolve(__dirname, 'fixtures/graphite2-1.3.15')
const corpusRoot = process.env.GRAPHITE2_CORPUS ?? bundledCorpusRoot
const corpusPrefix = corpusRoot === bundledCorpusRoot ? '' : 'tests/'
const harfBuzzShape = process.env.GRAPHITE2_HB_SHAPE
  ?? ['/opt/homebrew/bin/hb-shape', '/usr/local/bin/hb-shape', '/usr/bin/hb-shape'].find(existsSync)
  ?? 'hb-shape'
const padaukPath = join(corpusRoot, corpusPrefix, 'fonts/Padauk.ttf')
const charisPath = join(corpusRoot, corpusPrefix, 'fonts/charis_r_gr.ttf')
const scheherazadePath = join(corpusRoot, corpusPrefix, 'fonts/Scheherazadegr.ttf')
const awamiPath = join(corpusRoot, corpusPrefix, 'fonts/AwamiNastaliq-Regular.ttf')
const awamiCompressedPath = join(corpusRoot, corpusPrefix, 'fonts/Awami_compressed_test.ttf')
const awamiTextPath = join(corpusRoot, corpusPrefix, 'texts/awami_tests.txt')

const officialCases: ReadonlyArray<readonly [string, string, readonly number[], boolean]> = [
  ['padauk1', 'Padauk.ttf', [0x1015, 0x102f, 0x100f, 0x1039, 0x100f, 0x1031, 0x1038], false],
  ['padauk2', 'Padauk.ttf', [0x1000, 0x103c, 0x102d, 0x102f], false],
  ['padauk3', 'Padauk.ttf', [0x101e, 0x1004, 0x103a, 0x1039, 0x1001, 0x103b, 0x102d, 0x102f, 0x1004, 0x103a, 0x1038], false],
  ['padauk4', 'Padauk.ttf', [0x1005, 0x1000, 0x1039, 0x1000, 0x1030], false],
  ['padauk5', 'Padauk.ttf', [0x1000, 0x103c, 0x1031, 0x102c, 0x1004, 0x1037, 0x103a], false],
  ['padauk6', 'Padauk.ttf', [0x1000, 0x102d, 0x1005, 0x1039, 0x1006, 0x102c], false],
  ['padauk7', 'Padauk.ttf', [0x1017, 0x1014, 0x103c, 0x103d, 0x102f], false],
  ['padauk8', 'Padauk.ttf', [0x1004, 0x103a, 0x1039, 0x1005], false],
  ['padauk9', 'Padauk.ttf', [0x1004, 0x103a, 0x1039], false],
  ['padauk11', 'Padauk.ttf', [0x100b, 0x1039, 0x100c, 0x1031, 0x102c], false],
  ['scher1', 'Scheherazadegr.ttf', [0x0628, 0x0628, 0x064e, 0x0644, 0x064e, 0x0654, 0x0627, 0x064e], true],
  ['scher2', 'Scheherazadegr.ttf', [0x0627, 0x0644, 0x0625, 0x0639, 0x0644, 0x0627, 0x0646], true],
  ['scher3', 'Scheherazadegr.ttf', [0x0627, 0x31, 0x32, 0x2d, 0x34, 0x35, 0x0627], true],
  ['scher4', 'Scheherazadegr.ttf', [0x0627, 0x0653, 0x06af], true],
  ['charis1', 'charis_r_gr.ttf', [0x69, 0x02e6, 0x02e8, 0x02e5], false],
  ['charis2', 'charis_r_gr.ttf', [0x1d510, 0x41, 0x1d513], false],
  ['charis4', 'charis_r_gr.ttf', [0x6b, 0x0361, 0x70], false],
  ['charis5', 'charis_r_gr.ttf', [0x20, 0x6c, 0x0325, 0x65], false],
  ['charis7', 'charis_fast.ttf', [0x49, 0x65, 0x6c, 0x6c, 0x6f], false],
  ['grtest1', 'grtest1gr.ttf', [0x62, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x62, 0x61], false],
  ['general1', 'general.ttf', [0x0e01, 0x62], false],
  ['piglatin1', 'PigLatinBenchmark_v3.ttf', [0x68, 0x65, 0x6c, 0x6c, 0x6f], false],
]

function loadFont(path: string): Font {
  const bytes = readFileSync(path)
  return Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function shapeWithHarfBuzz(path: string, text: string, rightToLeft = false): HarfBuzzGlyph[] {
  const args = ['--shaper=graphite2', '--output-format=json', '--no-glyph-names']
  if (rightToLeft) args.push('--direction=rtl')
  args.push(path, text)
  const output = execFileSync(harfBuzzShape, args, { encoding: 'utf8' })
  return JSON.parse(output) as HarfBuzzGlyph[]
}

function canonicalActual(path: string, text: string, rightToLeft: boolean): Array<Omit<HarfBuzzGlyph, 'cl'>> {
  return loadFont(path).shapeText(text, { rightToLeft }).map(function (glyph) {
    return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
  })
}

function canonicalExpected(path: string, text: string, rightToLeft: boolean): Array<Omit<HarfBuzzGlyph, 'cl'>> {
  return shapeWithHarfBuzz(path, text, rightToLeft).map(function (glyph) {
    return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
  })
}

function tag(value: string): number {
  return ((value.charCodeAt(0) << 24) | (value.charCodeAt(1) << 16) | (value.charCodeAt(2) << 8) | value.charCodeAt(3)) >>> 0
}

describe('Graphite HarfBuzz oracle', function () {
  it('has the official Graphite2 corpus and a Graphite-enabled HarfBuzz oracle', function () {
    expect(existsSync(harfBuzzShape)).toBe(true)
    expect(existsSync(padaukPath)).toBe(true)
    expect(existsSync(charisPath)).toBe(true)
    expect(existsSync(scheherazadePath)).toBe(true)
    expect(execFileSync(harfBuzzShape, ['--list-shapers'], { encoding: 'utf8' }).split(/\s+/)).toContain('graphite2')
  })

  it('matches attachment clusters, advances, and offsets', function () {
    const text = 'မြန်မာ'
    const expected = shapeWithHarfBuzz(padaukPath, text)
    const actual = loadFont(padaukPath).shapeText(text)
    expect(actual.map(function (glyph) {
      return {
        g: glyph.glyphId,
        dx: glyph.xOffset,
        dy: glyph.yOffset,
        ax: glyph.xAdvance,
        ay: glyph.yAdvance,
      }
    })).toEqual(expected.map(function (glyph) {
      return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
    }))
    expect(actual.map(function (glyph) { return glyph.componentCount })).toEqual([2, 0, 2, 0, 1, 1])
    expect(actual.map(function (glyph) { return glyph.graphite!.sourceStart })).toEqual([0, 0, 2, 2, 4, 5])
    expect(actual.map(function (glyph) { return glyph.graphite!.sourceEnd })).toEqual([2, 2, 4, 4, 5, 6])
    expect(actual.some(function (glyph) { return glyph.graphite!.attachmentParent >= 0 })).toBe(true)
    expect(actual.every(function (glyph) { return Number.isInteger(glyph.graphite!.breakWeight) })).toBe(true)
  })

  it('matches rearrangement cursors and nested LTR attachment clusters', function () {
    const text = 'စက္ခုန္ဒြေ'
    const expected = shapeWithHarfBuzz(padaukPath, text)
    const actual = loadFont(padaukPath).shapeText(text)
    expect(actual.map(function (glyph) {
      return {
        g: glyph.glyphId,
        dx: glyph.xOffset,
        dy: glyph.yOffset,
        ax: glyph.xAdvance,
        ay: glyph.yAdvance,
      }
    })).toEqual(expected.map(function (glyph) {
      return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
    }))
  })

  it('matches repeated deletion and ligature rules across a pass', function () {
    const text = 'ffi office affinity ffi'
    const expected = shapeWithHarfBuzz(charisPath, text)
    const actual = loadFont(charisPath).shapeText(text)
    expect(actual.map(function (glyph) {
      return {
        g: glyph.glyphId,
        dx: glyph.xOffset,
        dy: glyph.yOffset,
        ax: glyph.xAdvance,
        ay: glyph.yAdvance,
      }
    })).toEqual(expected.map(function (glyph) {
      return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
    }))
  })

  it('matches RTL nested attachment ordering and advances', function () {
    const text = 'السَّلَامُ عَلَيْكُمْ'
    const expected = shapeWithHarfBuzz(scheherazadePath, text, true)
    const actual = loadFont(scheherazadePath).shapeText(text, { rightToLeft: true })
    expect(actual.map(function (glyph) {
      return {
        g: glyph.glyphId,
        dx: glyph.xOffset,
        dy: glyph.yOffset,
        ax: glyph.xAdvance,
        ay: glyph.yAdvance,
      }
    })).toEqual(expected.map(function (glyph) {
      return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
    }))
  })

  it.each([
    'ببب', 'کسس', 'نبہ | ببہ', 'سبو | صبص | سبع',
    'صلج |صلھ | صلو', 'صنب | صنع | سنص | سنق',
    'صیط | صیو | سیع | سیب', 'خبِیثوں',
    'لا | بلا | جبصلاکب |لا', 'لآ | کجلآ',
    'لأ | کجلأص', 'آگ',
  ])('matches Awami collision shifting for %s', function (text) {
    expect(canonicalActual(awamiPath, text, true)).toEqual(canonicalExpected(awamiPath, text, true))
  })

  it.each(['نبہ', 'ببہ'])('matches Awami contextual deletion for %s', function (text) {
    expect(canonicalActual(awamiPath, text, true)).toEqual(canonicalExpected(awamiPath, text, true))
  })

  it.each([
    'آخرخَیل بخشَݨ\u200Eہار',
    'بچ\u200Eبچا | بخشَݨ\u200Eہار',
    '\u200Dب\u200D \u200Dقس \u200Dظمش\u200D',
  ])('preserves Awami Graphite substitutions of default-ignorable controls for %s', function (text) {
    expect(canonicalActual(awamiPath, text, true)).toEqual(canonicalExpected(awamiPath, text, true))
  })

  it('matches the complete official Awami collision corpus', function () {
    const texts = readFileSync(awamiTextPath, 'utf8').split(/\r?\n/)
    const output = execFileSync(harfBuzzShape, [
      '--shaper=graphite2', '--output-format=json', '--no-glyph-names', '--direction=rtl',
      `--text-file=${awamiTextPath}`, awamiPath,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split(/\r?\n/)
    const font = loadFont(awamiPath)
    const failures: string[] = []
    for (let line = 0; line < texts.length; line++) {
      if (texts[line] === '' || output[line] === '') continue
      const actual = font.shapeText(texts[line]!, { rightToLeft: true }).map(function (glyph) {
        return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
      })
      const expected = (JSON.parse(output[line]!) as HarfBuzzGlyph[]).map(function (glyph) {
        return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
      })
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        let glyph = 0
        while (glyph < actual.length && glyph < expected.length
          && JSON.stringify(actual[glyph]) === JSON.stringify(expected[glyph])) glyph++
        failures.push(`${line + 1}: ${texts[line]} @${glyph} ${JSON.stringify(actual[glyph])} != ${JSON.stringify(expected[glyph])}`)
      }
    }
    expect(failures).toEqual([])
  }, 120000)

  it.each(officialCases)('matches the official Graphite2 %s fonttest', function (_name, file, codePoints, rightToLeft) {
    const path = join(corpusRoot, corpusPrefix, 'fonts', file)
    const text = String.fromCodePoint(...codePoints)
    expect(canonicalActual(path, text, rightToLeft)).toEqual(canonicalExpected(path, text, rightToLeft))
  })

  it.each([
    ['padauk12', 'Padauk.ttf'],
    ['charis6', 'charis_r_gr.ttf'],
  ])('matches the official Graphite2 %s justification result', function (name, file) {
    const path = join(corpusRoot, corpusPrefix, 'fonts', file)
    const text = 'Hello Mum'
    const font = loadFont(path)
    const naturalWidth = font.shapeText(text).reduce(function (sum, glyph) { return sum + glyph.xAdvance }, 0)
    const actual = font.shapeText(text, {
      graphiteJustification: { width: naturalWidth * 1.07 },
    })
    const standard = JSON.parse(readFileSync(join(corpusRoot, corpusPrefix, 'standards', `${name}.json`), 'utf8')) as Array<{
      output?: GraphiteStandardSlot[]
    }>
    const output = standard[standard.length - 1]!.output!
    const expectedAdvances = output.map(function (slot, index) {
      if (index + 1 < output.length) return output[index + 1]!.origin[0] - slot.origin[0]
      return slot.advance[0]
    })
    expect(actual.map(function (glyph) { return glyph.glyphId })).toEqual(output.map(function (slot) { return slot.gid }))
    expect(actual.map(function (glyph) { return glyph.xAdvance })).toEqual(expectedAdvances)
    expect(actual.map(function (glyph) { return glyph.xOffset })).toEqual(output.map(function () { return 0 }))
  })

  it('connects Graphite justification to justified line layout', function () {
    const font = loadFont(charisPath)
    const measurer = new TextMeasurer(font)
    const naturalWidth = font.shapeText('Hello Mum').reduce(function (sum, glyph) { return sum + glyph.xAdvance }, 0)
    const result = layoutText('Hello Mum\nX', measurer, font.metrics.unitsPerEm, {
      maxWidth: naturalWidth * 1.07,
      maxHeight: 100000,
      hAlign: 'justify',
    })
    expect(result.lines[0]!.run).toBeDefined()
    expect(Array.from(result.lines[0]!.run!.advances)).toEqual([1563, 1045, 649, 649, 1537, 641, 1835, 1206, 1741])
    expect(result.lines[0]!.width).toBe(10866)
  })

  it('rebuilds a compact Graphite subset with remapped shaping semantics', function () {
    const text = 'Hello Mum'
    const original = loadFont(charisPath)
    const expected = original.shapeText(text)
    const result = original.subsetWithMapping(text)
    expect(result.oldToNewGlyphId.size).toBeLessThan(original.numGlyphs)
    const subset = Font.load(result.buffer)
    const actual = subset.shapeText(text)
    expect(actual.map(function (glyph) {
      return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
    })).toEqual(expected.map(function (glyph) {
      return {
        g: result.oldToNewGlyphId.get(glyph.glyphId),
        dx: glyph.xOffset,
        dy: glyph.yOffset,
        ax: glyph.xAdvance,
        ay: glyph.yAdvance,
      }
    }))

    const directory = mkdtempSync(join(tmpdir(), 'tsreport-graphite-subset-'))
    const path = join(directory, 'subset.ttf')
    try {
      writeFileSync(path, new Uint8Array(result.buffer))
      const oracle = shapeWithHarfBuzz(path, text)
      expect(actual.map(function (glyph) {
        return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
      })).toEqual(oracle.map(function (glyph) {
        return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
      }))
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('retains Graphite closure and stable glyph IDs in a table-preserving subset', function () {
    const text = 'မြန်မာ'
    const original = loadFont(padaukPath)
    const expected = original.shapeText(text)
    const result = original.subsetPreservingTables(text)
    const subset = Font.load(result.buffer)
    expect(subset.silf).not.toBeNull()
    expect(subset.glat).not.toBeNull()
    expect(subset.gloc).not.toBeNull()
    expect(subset.shapeText(text)).toEqual(expected)
    for (let i = 0; i < expected.length; i++) {
      expect(result.oldToNewGlyphId.get(expected[i]!.glyphId)).toBe(expected[i]!.glyphId)
    }
  })

  it('rebuilds compressed Graphite 5 tables as an oracle-readable compact subset', function () {
    const text = 'نبہ'
    const original = loadFont(awamiCompressedPath)
    const expected = original.shapeText(text, { script: 'arab' })
    const result = original.subsetWithMapping(text)
    const subset = Font.load(result.buffer)
    const actual = subset.shapeText(text, { script: 'arab' })
    expect(actual.map(function (glyph) {
      return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
    })).toEqual(expected.map(function (glyph) {
      return {
        g: result.oldToNewGlyphId.get(glyph.glyphId), dx: glyph.xOffset, dy: glyph.yOffset,
        ax: glyph.xAdvance, ay: glyph.yAdvance,
      }
    }))
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-graphite5-subset-'))
    const path = join(directory, 'subset.ttf')
    try {
      writeFileSync(path, new Uint8Array(result.buffer))
      const oracle = shapeWithHarfBuzz(path, text, true)
      expect(actual.map(function (glyph) {
        return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
      })).toEqual(oracle.map(function (glyph) {
        return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
      }))
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('rejects the official VM underflow font like HarfBuzz', function () {
    const path = join(corpusRoot, corpusPrefix, 'fonts/underflow.ttf')
    const text = 'baaaaaab'
    expect(function () { canonicalActual(path, text, false) }).toThrow()
    expect(function () { canonicalExpected(path, text, false) }).toThrow()
  })

  it('matches public Graphite feature settings', function () {
    const text = String.fromCodePoint(0x1004, 0x103d, 0x1000, 0x103a)
    const actual = loadFont(padaukPath).shapeText(text, {
      graphiteFeatures: new Map([[tag('kdot'), 1], [tag('wtri'), 1]]),
    }).map(function (glyph) {
      return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
    })
    const output = execFileSync(harfBuzzShape, [
      '--shaper=graphite2', '--output-format=json', '--no-glyph-names',
      '--features=kdot=1,wtri=1', padaukPath, text,
    ], { encoding: 'utf8' })
    const expected = (JSON.parse(output) as HarfBuzzGlyph[]).map(function (glyph) {
      return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
    })
    expect(actual).toEqual(expected)
  })

  it('matches Sill language defaults through the public language option', function () {
    const text = String.fromCodePoint(0x54, 0x69, 0x1ec3, 0x75)
    const expected = execFileSync(harfBuzzShape, [
      '--shaper=graphite2', '--output-format=json', '--no-glyph-names', '--language=vie', charisPath, text,
    ], { encoding: 'utf8' })
    const defaultGlyphs = loadFont(charisPath).shapeText(text).map(function (glyph) { return glyph.glyphId })
    const languageGlyphs = loadFont(charisPath).shapeText(text, { language: 'vie' })
    expect(languageGlyphs.map(function (glyph) { return glyph.glyphId })).not.toEqual(defaultGlyphs)
    expect(languageGlyphs.map(function (glyph) {
      return { g: glyph.glyphId, dx: glyph.xOffset, dy: glyph.yOffset, ax: glyph.xAdvance, ay: glyph.yAdvance }
    })).toEqual((JSON.parse(expected) as HarfBuzzGlyph[]).map(function (glyph) {
      return { g: glyph.g, dx: glyph.dx, dy: glyph.dy, ax: glyph.ax, ay: glyph.ay }
    }))
  })
})
