import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { Font } from '../../src/index.js'

const PYTHON = process.env.PYTHON ?? 'python3'
const PYTHON_ADAPTER = resolve(__dirname, '../python')
const PYTHON_ENV = {
  ...process.env,
  PYTHONPATH: [PYTHON_ADAPTER, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  TSREPORT_NODE: process.execPath,
}
const PROBE = 'import brotli; from fontTools.ttLib import TTFont'
const FONTTOOLS_WOFF2_AVAILABLE = spawnSync(PYTHON, ['-c', PROBE], { env: PYTHON_ENV }).status === 0

if (!FONTTOOLS_WOFF2_AVAILABLE) throw new Error('WOFF2 conformance requires Python fontTools; Brotli is supplied by tests/python/brotli.py')

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
    expect(actual.getGlyphByCodePoint(codePoint)).toEqual(expected.getGlyphByCodePoint(codePoint))
  }
}

describe('WOFF2 fontTools oracle', function () {
  let directory = ''

  beforeAll(function () {
    directory = mkdtempSync(join(tmpdir(), 'tsreport-woff2-fonttools-'))
  })

  afterAll(function () {
    rmSync(directory, { recursive: true, force: true })
  })

  for (const fixture of FIXTURES) {
    const name = fixture.endsWith('.ttf') ? 'TrueType' : 'CFF OpenType'

    it(`decodes a fontTools-produced ${name} WOFF2`, function () {
      const oracleWoff2 = join(directory, `${name.replaceAll(' ', '-')}-fonttools.woff2`)
      execFileSync(PYTHON, ['-c', [
        'from fontTools.ttLib import TTFont',
        'import sys',
        'font = TTFont(sys.argv[1], recalcTimestamp=False)',
        "font.flavor = 'woff2'",
        'font.save(sys.argv[2], reorderTables=False)',
      ].join('\n'), fixture, oracleWoff2], { env: PYTHON_ENV })
      expectSameSemantics(loadFile(oracleWoff2), loadFile(fixture))
    })

    it(`fontTools decodes this encoder's ${name} WOFF2`, function () {
      const source = loadFile(fixture)
      const encoded = source.toWoff2()
      const encodedPath = join(directory, `${name.replaceAll(' ', '-')}-tsreport.woff2`)
      const oracleSfnt = join(directory, `${name.replaceAll(' ', '-')}-decoded.${fixture.endsWith('.ttf') ? 'ttf' : 'otf'}`)
      writeFileSync(encodedPath, new Uint8Array(encoded))
      execFileSync(PYTHON, ['-c', [
        'from fontTools.ttLib import TTFont',
        'import sys',
        'font = TTFont(sys.argv[1], recalcTimestamp=False)',
        'assert font.flavor == "woff2"',
        'font.flavor = None',
        'font.save(sys.argv[2], reorderTables=False)',
      ].join('\n'), encodedPath, oracleSfnt], { env: PYTHON_ENV })
      expectSameSemantics(loadFile(oracleSfnt), source)
    }, 30_000)
  }
})
