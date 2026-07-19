import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font, wrapWoff2Collection } from '../../src/index.js'

const PYTHON = process.env.PYTHON ?? 'python3'
const CMAKE = process.env.CMAKE ?? 'cmake'
const REFERENCE_SOURCE = resolve(__dirname, '../fixtures/google-woff2')
const fontToolsAvailable = spawnSync(PYTHON, ['-c', 'from fontTools.ttLib import TTCollection, TTFont']).status === 0

if (!fontToolsAvailable) throw new Error('WOFF2 conformance requires Python fontTools')

describe('Google woff2 collection oracle', function () {
  let directory = ''
  let collectionPath = ''
  let compress = ''
  let decompress = ''
  const trueTypePath = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
  const cffPath = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')

  beforeAll(function () {
    directory = mkdtempSync(join(tmpdir(), 'tsreport-google-woff2-'))
    const buildDirectory = join(directory, 'build')
    execFileSync(CMAKE, [
      '-S', REFERENCE_SOURCE,
      '-B', buildDirectory,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
    ], { encoding: 'utf8' })
    execFileSync(CMAKE, ['--build', buildDirectory, '--config', 'Release', '--parallel', '4'], { encoding: 'utf8' })
    compress = join(buildDirectory, 'woff2_compress')
    decompress = join(buildDirectory, 'woff2_decompress')
    collectionPath = join(directory, 'mixed.ttc')
    execFileSync(PYTHON, ['-c', [
      'from fontTools.ttLib import TTCollection, TTFont',
      'import sys',
      'collection = TTCollection()',
      'collection.fonts = [TTFont(sys.argv[1], recalcTimestamp=False), TTFont(sys.argv[2], recalcTimestamp=False)]',
      'collection.save(sys.argv[3], shareTables=True)',
    ].join('\n'), trueTypePath, cffPath, collectionPath])
  }, 30_000)

  afterAll(function () {
    rmSync(directory, { recursive: true, force: true })
  })

  for (const file of ['Roboto-Regular.ttf', 'SourceSans3-Regular.otf']) {
    it(`decodes this encoder's ${file} output`, function () {
      const sourcePath = resolve(__dirname, `../fixtures/fonts/${file}`)
      const source = Font.load(Uint8Array.from(readFileSync(sourcePath)).buffer)
      const encoded = source.toWoff2()
      const baseName = file.replace(/\.(?:ttf|otf)$/u, '')
      const encodedPath = join(directory, `${baseName}.woff2`)
      writeFileSync(encodedPath, new Uint8Array(encoded))
      execFileSync(decompress, [encodedPath])
      const decoded = Font.load(Uint8Array.from(readFileSync(join(directory, `${baseName}.ttf`))).buffer)
      expect(decoded.numGlyphs).toBe(source.numGlyphs)
      expect(decoded.metrics).toEqual(source.metrics)
      for (const codePoint of [0x20, 0x41, 0x67, 0xe9, 0x3a9]) {
        expect(decoded.getGlyphByCodePoint(codePoint)).toEqual(source.getGlyphByCodePoint(codePoint))
      }
    }, 30_000)
  }

  it('decodes a Google-encoded mixed-outline collection', function () {
    execFileSync(compress, [collectionPath])
    const encoded = Uint8Array.from(readFileSync(join(directory, 'mixed.woff2'))).buffer
    expect(Font.load(encoded, { fontIndex: 0 }).getGlyphByCodePoint(0x41)).toEqual(
      Font.load(Uint8Array.from(readFileSync(trueTypePath)).buffer).getGlyphByCodePoint(0x41),
    )
    expect(Font.load(encoded, { fontIndex: 1 }).getGlyphByCodePoint(0x41)).toEqual(
      Font.load(Uint8Array.from(readFileSync(cffPath)).buffer).getGlyphByCodePoint(0x41),
    )
  }, 30_000)

  it('Google decodes this encoder\'s mixed-outline collection', function () {
    const collectionBytes = Uint8Array.from(readFileSync(collectionPath))
    const encoded = wrapWoff2Collection(collectionBytes.buffer)
    const encodedPath = join(directory, 'ours.woff2')
    writeFileSync(encodedPath, new Uint8Array(encoded))
    execFileSync(decompress, [encodedPath])
    const decodedPath = join(directory, 'ours.ttf')
    const decodedBytes = Uint8Array.from(readFileSync(decodedPath)).buffer
    for (let fontIndex = 0; fontIndex < 2; fontIndex++) {
      const actual = Font.load(decodedBytes, { fontIndex })
      const expected = Font.load(collectionBytes.buffer, { fontIndex })
      expect(actual.numGlyphs).toBe(expected.numGlyphs)
      expect(actual.metrics).toEqual(expected.metrics)
      expect(actual.getGlyphByCodePoint(0x41)).toEqual(expected.getGlyphByCodePoint(0x41))
    }
  }, 30_000)
})
