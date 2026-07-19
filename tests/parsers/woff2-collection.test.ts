import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font, wrapWoff2Collection } from '../../src/index.js'

const PYTHON = process.env.PYTHON ?? 'python3'
const FONTTOOLS_AVAILABLE = spawnSync(PYTHON, ['-c', 'from fontTools.ttLib import TTFont, TTCollection']).status === 0
if (!FONTTOOLS_AVAILABLE) throw new Error('WOFF2 collection conformance requires Python fontTools')

describe('WOFF2 collection', function () {
  let directory = ''
  let ttcPath = ''
  let collection: ArrayBuffer
  let encoded: ArrayBuffer
  const trueTypePath = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
  const cffPath = resolve(__dirname, '../fixtures/fonts/SourceSans3-Regular.otf')

  beforeAll(function () {
    directory = mkdtempSync(join(tmpdir(), 'tsreport-woff2-collection-'))
    ttcPath = join(directory, 'mixed.ttc')
    execFileSync(PYTHON, ['-c', [
      'from fontTools.ttLib import TTFont, TTCollection',
      'import sys',
      'collection = TTCollection()',
      'collection.fonts = [TTFont(sys.argv[1], recalcTimestamp=False), TTFont(sys.argv[2], recalcTimestamp=False)]',
      'collection.save(sys.argv[3], shareTables=True)',
    ].join('\n'), trueTypePath, cffPath, ttcPath])
    collection = Uint8Array.from(readFileSync(ttcPath)).buffer
    encoded = wrapWoff2Collection(collection)
  }, 30_000)

  afterAll(function () {
    rmSync(directory, { recursive: true, force: true })
  })

  it('preserves font order, mixed outlines, and shared tables', function () {
    const view = new DataView(encoded)
    expect(view.getUint32(4, false)).toBe(0x74746366)

    const first = Font.load(encoded, { fontIndex: 0 })
    const second = Font.load(encoded, { fontIndex: 1 })
    const expectedFirst = Font.load(Uint8Array.from(readFileSync(trueTypePath)).buffer)
    const expectedSecond = Font.load(Uint8Array.from(readFileSync(cffPath)).buffer)
    expect(first.familyName).toBe(expectedFirst.familyName)
    expect(second.familyName).toBe(expectedSecond.familyName)
    expect(first.getGlyphByCodePoint(0x41)).toEqual(expectedFirst.getGlyphByCodePoint(0x41))
    expect(second.getGlyphByCodePoint(0x41)).toEqual(expectedSecond.getGlyphByCodePoint(0x41))
  })

  it('rejects an out-of-range collection font index', function () {
    expect(() => Font.load(encoded, { fontIndex: 2 })).toThrow('out of range')
  })

  it('connects collection face access and WOFF2 collection generation through Font', function () {
    const source = Font.load(collection, { fontIndex: 0 })
    expect(source.getCollectionFont(1).familyName).toBe(Font.load(collection, { fontIndex: 1 }).familyName)
    const generated = source.toWoff2()
    expect(new DataView(generated).getUint32(4, false)).toBe(0x74746366)
    expect(Font.load(generated, { fontIndex: 0 }).familyName).toBe(source.familyName)
    expect(Font.load(generated, { fontIndex: 1 }).familyName).toBe(source.getCollectionFont(1).familyName)
  }, 30_000)

  it('subsets every face, rebuilds the collection, and removes the invalidated DSIG', function () {
    const source = Font.load(collection)
    const subset = source.subsetCollection(['ABC', 'ABC'])
    expect(subset.byteLength).toBeLessThan(collection.byteLength)
    const first = Font.load(subset, { fontIndex: 0 })
    const second = Font.load(subset, { fontIndex: 1 })
    expect(first.collection).toMatchObject({ majorVersion: 1, numFonts: 2, signature: null })
    expect(first.getGlyphByCodePoint(0x41).outline.commands.length).toBeGreaterThan(0)
    expect(second.getGlyphByCodePoint(0x41).outline.commands.length).toBeGreaterThan(0)
  })
})
