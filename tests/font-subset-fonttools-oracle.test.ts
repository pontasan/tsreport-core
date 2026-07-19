import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { getTableReader } from '../src/parsers/sfnt-parser.js'
import { parseFont } from '../src/parsers/index.js'
import { parsePost } from '../src/parsers/tables/post.js'

const FIXTURES = resolve(import.meta.dirname, 'fixtures/fonts')
const PYTHON_SUBSET = `
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
source, target, text = sys.argv[1:]
options = subset.Options()
options.glyph_names = True
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_languages = ['*']
font = TTFont(source)
worker = subset.Subsetter(options=options)
worker.populate(text=text)
worker.subset(font)
font.save(target)
`

describe('compact subset fontTools oracle', function () {
  let directory = ''

  beforeAll(function () {
    directory = mkdtempSync(join(tmpdir(), 'tsreport-fonttools-subset-'))
  })

  afterAll(function () {
    rmSync(directory, { recursive: true, force: true })
  })

  it('matches layout, outlines, metrics and table semantics while reducing a TrueType font', function () {
    const sourcePath = resolve(FIXTURES, 'NotoSans-Regular.ttf')
    const referencePath = join(directory, 'reference.ttf')
    const oursPath = join(directory, 'ours.ttf')
    const text = 'office affine Åé'
    execFileSync('python3', ['-c', PYTHON_SUBSET, sourcePath, referencePath, text])

    const sourceBytes = readFileSync(sourcePath)
    const source = Font.load(toArrayBuffer(sourceBytes))
    const oursResult = source.subsetWithMapping(text)
    writeFileSync(oursPath, new Uint8Array(oursResult.buffer))
    const ours = Font.load(oursResult.buffer)
    const referenceBytes = readFileSync(referencePath)
    const reference = Font.load(toArrayBuffer(referenceBytes))

    expect(oursResult.buffer.byteLength).toBeLessThan(sourceBytes.byteLength)
    expect(referenceBytes.byteLength).toBeLessThan(sourceBytes.byteLength)
    const oursSfnt = parseFont(oursResult.buffer)
    const referenceSfnt = parseFont(toArrayBuffer(referenceBytes))
    for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'GDEF', 'GPOS', 'GSUB']) {
      expect(oursSfnt.tableDirectory.has(tag), tag).toBe(referenceSfnt.tableDirectory.has(tag))
    }

    const oursNames = parsePost(getTableReader(oursSfnt, 'post')!).glyphNames
    const referenceNames = parsePost(getTableReader(referenceSfnt, 'post')!).glyphNames
    const oursShape = ours.shapeText(text, { script: 'latn' })
    const referenceShape = reference.shapeText(text, { script: 'latn' })
    expect(oursShape.map(function (glyph) {
      return [oursNames[glyph.glyphId], glyph.cluster, glyph.xAdvance, glyph.yAdvance, glyph.xOffset, glyph.yOffset]
    })).toEqual(referenceShape.map(function (glyph) {
      return [referenceNames[glyph.glyphId], glyph.cluster, glyph.xAdvance, glyph.yAdvance, glyph.xOffset, glyph.yOffset]
    }))

    for (const character of new Set(text)) {
      const codePoint = character.codePointAt(0)!
      const oursGlyph = ours.getGlyph(ours.getGlyphId(codePoint))
      const referenceGlyph = reference.getGlyph(reference.getGlyphId(codePoint))
      expect(oursGlyph.advanceWidth, character).toBe(referenceGlyph.advanceWidth)
      expect(outlineKey(oursGlyph.outline), character).toEqual(outlineKey(referenceGlyph.outline))
    }
  })

  it('matches embedded color bitmap bytes and metrics after subsetting', function () {
    const sourcePath = resolve(FIXTURES, 'NotoColorEmoji-CBDT-subset.ttf')
    const referencePath = join(directory, 'reference-color.ttf')
    const text = String.fromCodePoint(0x1F600)
    execFileSync('python3', ['-c', PYTHON_SUBSET, sourcePath, referencePath, text])
    const sourceBytes = readFileSync(sourcePath)
    const source = Font.load(toArrayBuffer(sourceBytes))
    const oursResult = source.subsetWithMapping(text)
    const ours = Font.load(oursResult.buffer)
    const referenceBytes = readFileSync(referencePath)
    const reference = Font.load(toArrayBuffer(referenceBytes))
    const oursBitmap = ours.getBitmapGlyphRender(ours.getGlyphId(0x1F600), 109)!
    const referenceBitmap = reference.getBitmapGlyphRender(reference.getGlyphId(0x1F600), 109)!
    expect(oursBitmap).toEqual(referenceBitmap)
    expect(oursResult.buffer.byteLength).toBeLessThan(sourceBytes.byteLength)
    expect(referenceBytes.byteLength).toBeLessThan(sourceBytes.byteLength)
  })
})

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function outlineKey(outline: { commands: Uint8Array, coords: Float32Array }): readonly unknown[] {
  return [Array.from(outline.commands), Array.from(outline.coords)]
}
