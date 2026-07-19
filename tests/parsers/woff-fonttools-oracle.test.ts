import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font } from '../../src/index.js'

const PYTHON = process.env.PYTHON ?? 'python3'
const FONTTOOLS_PROBE = 'from fontTools.ttLib import TTFont'
const FONTTOOLS_AVAILABLE = spawnSync(PYTHON, ['-c', FONTTOOLS_PROBE]).status === 0

if (!FONTTOOLS_AVAILABLE) throw new Error('WOFF conformance requires Python fontTools')

const FIXTURES = [
  resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf'),
  resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf'),
]

function loadFile(path: string): Font {
  return Font.load(Uint8Array.from(readFileSync(path)).buffer)
}

function expectSameSemantics(actual: Font, expected: Font): void {
  expect(actual.numGlyphs).toBe(expected.numGlyphs)
  expect(actual.metrics).toEqual(expected.metrics)
  expect(actual.familyName).toBe(expected.familyName)
  for (const codePoint of [0x20, 0x41, 0x67, 0xe9, 0x3a9]) {
    const actualGlyph = actual.getGlyphByCodePoint(codePoint)
    const expectedGlyph = expected.getGlyphByCodePoint(codePoint)
    expect(actualGlyph.id).toBe(expectedGlyph.id)
    expect(actualGlyph.advanceWidth).toBe(expectedGlyph.advanceWidth)
    expect(actualGlyph.outline).toEqual(expectedGlyph.outline)
  }
}

describe('WOFF fontTools oracle', function () {
  let directory = ''

  beforeAll(function () {
    directory = mkdtempSync(join(tmpdir(), 'tsreport-woff-oracle-'))
  })

  afterAll(function () {
    rmSync(directory, { recursive: true, force: true })
  })

  for (const fixture of FIXTURES) {
    const name = fixture.endsWith('.ttf') ? 'TrueType' : 'CFF OpenType'

    it(`decodes a fontTools-produced ${name} WOFF`, function () {
      const oracleWoff = join(directory, `${name.replaceAll(' ', '-')}-fonttools.woff`)
      execFileSync(PYTHON, ['-c', [
        'from fontTools.ttLib import TTFont',
        'import sys',
        'font = TTFont(sys.argv[1], recalcTimestamp=False)',
        "font.flavor = 'woff'",
        'font.save(sys.argv[2], reorderTables=False)',
      ].join('\n'), fixture, oracleWoff])

      const decoded = loadFile(oracleWoff)
      expect(decoded.format).toBe('woff')
      expectSameSemantics(decoded, loadFile(fixture))
    })

    it(`fontTools decodes this encoder's ${name} WOFF`, function () {
      const source = loadFile(fixture)
      const encoded = source.toWoff({
        majorVersion: 1,
        minorVersion: 0,
        metadata: '<?xml version="1.0" encoding="UTF-8"?><metadata version="1.0"></metadata>',
        privateData: Uint8Array.from([0x54, 0x53, 0x52]),
      })
      const encodedPath = join(directory, `${name.replaceAll(' ', '-')}-tsreport.woff`)
      const oracleSfnt = join(directory, `${name.replaceAll(' ', '-')}-fonttools-decoded.${fixture.endsWith('.ttf') ? 'ttf' : 'otf'}`)
      writeFileSync(encodedPath, new Uint8Array(encoded))
      execFileSync(PYTHON, ['-c', [
        'from fontTools.ttLib import TTFont',
        'import sys',
        'font = TTFont(sys.argv[1], recalcTimestamp=False)',
        'assert font.flavor == "woff"',
        'font.flavor = None',
        'font.save(sys.argv[2], reorderTables=False)',
      ].join('\n'), encodedPath, oracleSfnt])

      expectSameSemantics(loadFile(oracleSfnt), source)
    })
  }

  it('fontTools decodes a WOFF face derived from a mixed-outline TTC', function () {
    const collectionPath = join(directory, 'mixed.ttc')
    execFileSync(PYTHON, ['-c', [
      'from fontTools.ttLib import TTCollection, TTFont',
      'import sys',
      'collection = TTCollection()',
      'collection.fonts = [TTFont(sys.argv[1], recalcTimestamp=False), TTFont(sys.argv[2], recalcTimestamp=False)]',
      'collection.save(sys.argv[3], shareTables=True)',
    ].join('\n'), FIXTURES[0]!, FIXTURES[1]!, collectionPath])
    const collectionBytes = Uint8Array.from(readFileSync(collectionPath))
    const source = Font.load(collectionBytes.buffer, { fontIndex: 1 })
    const encodedPath = join(directory, 'mixed-face.woff')
    const decodedPath = join(directory, 'mixed-face.otf')
    writeFileSync(encodedPath, new Uint8Array(source.toWoff()))
    execFileSync(PYTHON, ['-c', [
      'from fontTools.ttLib import TTFont',
      'import sys',
      'font = TTFont(sys.argv[1], recalcTimestamp=False)',
      'font.flavor = None',
      'font.save(sys.argv[2], reorderTables=False)',
    ].join('\n'), encodedPath, decodedPath])
    expectSameSemantics(loadFile(decodedPath), source)
  })
})
