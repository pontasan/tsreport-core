import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BinaryReader } from '../../../src/binary/reader.js'
import { BinaryWriter } from '../../../src/binary/writer.js'
import { parseFont } from '../../../src/parsers/index.js'
import { getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parsePost } from '../../../src/parsers/tables/post.js'
import { buildSfntFromTables } from '../../../src/subset/ttf-subset.js'

const PYTHON = process.env['PYTHON'] ?? 'python3'
const FONTTOOLS_AVAILABLE = spawnSync(PYTHON, ['-c', 'from fontTools.ttLib import TTFont']).status === 0
if (process.env['CONFORMANCE'] === '1' && !FONTTOOLS_AVAILABLE) {
  throw new Error('OpenType conformance requires Python fontTools')
}

const FONTTOOLS_POST_SCRIPT = [
  'import json, sys',
  'from fontTools.ttLib import TTFont',
  'font = TTFont(sys.argv[1], lazy=False)',
  'post = font["post"]',
  'print(json.dumps({',
  '  "version": post.formatType,',
  '  "italicAngle": post.italicAngle,',
  '  "underlinePosition": post.underlinePosition,',
  '  "underlineThickness": post.underlineThickness,',
  '  "isFixedPitch": post.isFixedPitch,',
  '  "minMemType42": post.minMemType42,',
  '  "maxMemType42": post.maxMemType42,',
  '  "minMemType1": post.minMemType1,',
  '  "maxMemType1": post.maxMemType1,',
  '  "glyphOrder": font.getGlyphOrder(),',
  '}))',
].join('\n')

const tempDirectory = mkdtempSync(join(tmpdir(), 'tsreport-post-oracle-'))
afterAll(() => rmSync(tempDirectory, { recursive: true, force: true }))

function fontToolsPost(path: string): Record<string, unknown> {
  return JSON.parse(execFileSync(PYTHON, ['-c', FONTTOOLS_POST_SCRIPT, path], { encoding: 'utf8' })) as Record<string, unknown>
}

function buildFormat4Font(): ArrayBuffer {
  const maxp = new BinaryWriter(6)
  maxp.writeUint32(0x00005000)
  maxp.writeUint16(3)
  const post = new BinaryWriter(38)
  post.writeUint32(0x00040000)
  post.writeUint32(0xFFFF8000)
  post.writeInt16(-120)
  post.writeInt16(40)
  post.writeUint32(1)
  post.writeUint32(11)
  post.writeUint32(22)
  post.writeUint32(33)
  post.writeUint32(44)
  post.writeUint16(0x0041)
  post.writeUint16(0x4E00)
  post.writeUint16(0xFFFF)
  return buildSfntFromTables(0x00010000, [
    { tag: 'maxp', data: maxp.toUint8Array() },
    { tag: 'post', data: post.toUint8Array() },
  ])
}

describe.skipIf(!FONTTOOLS_AVAILABLE)('post table fontTools oracle', () => {
  for (const file of ['NotoSans-Regular.ttf', 'SourceSans3-Regular.otf']) {
    it(`matches every post header field and glyph-name availability for ${file}`, () => {
      const path = resolve(import.meta.dirname, `../../fixtures/fonts/${file}`)
      const sfnt = parseFont(readFileSync(path).buffer as ArrayBuffer)
      const post = parsePost(getTableReader(sfnt, 'post')!)
      const expected = fontToolsPost(path)
      expect(post).toMatchObject({
        version: expected['version'],
        italicAngle: expected['italicAngle'],
        underlinePosition: expected['underlinePosition'],
        underlineThickness: expected['underlineThickness'],
        isFixedPitch: expected['isFixedPitch'],
        minMemType42: expected['minMemType42'],
        maxMemType42: expected['maxMemType42'],
        minMemType1: expected['minMemType1'],
        maxMemType1: expected['maxMemType1'],
      })
      if (post.version === 2) expect(post.glyphNames).toEqual(expected['glyphOrder'])
      else expect(post.glyphNames).toBeUndefined()
    })
  }

  it('matches fontTools format 4 decoding for character-code names', () => {
    const buffer = buildFormat4Font()
    const path = join(tempDirectory, 'format4.ttf')
    writeFileSync(path, new Uint8Array(buffer))
    const expected = fontToolsPost(path)
    const sfnt = parseFont(buffer)
    const post = parsePost(getTableReader(sfnt, 'post')!, { expectedGlyphCount: 3 })
    expect(expected['version']).toBe(4)
    expect(expected['glyphOrder']).toEqual(['A', 'uni4E00', 'glyph00002'])
    expect(Array.from(post.glyphNameCharacterCodes!)).toEqual([0x0041, 0x4E00, 0xFFFF])
    expect(post.glyphNames).toEqual(['a0041', 'a4E00', null])
  })
})
