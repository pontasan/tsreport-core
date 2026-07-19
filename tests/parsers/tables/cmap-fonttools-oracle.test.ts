import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync as runFile, spawnSync as runSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseFont } from '../../../src/parsers/index.js'
import { getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseCmap } from '../../../src/parsers/tables/cmap.js'

const PYTHON = process.env['PYTHON'] ?? 'python3'
const FONTTOOLS_AVAILABLE = runSync(PYTHON, ['-c', 'from fontTools.ttLib import TTFont']).status === 0
if (process.env['CONFORMANCE'] === '1' && !FONTTOOLS_AVAILABLE) {
  throw new Error('OpenType conformance requires Python fontTools')
}

interface OracleRecord {
  platformId: number
  encodingId: number
  format: number
  language: number | null
  entries: [number, number][] | null
}

interface OracleResult {
  records: OracleRecord[]
  best: [number, number][]
  variationSequences: Array<{
    codePoint: number
    variationSelector: number
    glyphId: number
    isDefault: boolean
  }>
}

const FONTTOOLS_SCRIPT = [
  'import json, sys',
  'from fontTools.ttLib import TTFont',
  'font = TTFont(sys.argv[1], lazy=False)',
  'records = []',
  'variations = []',
  'for table in font["cmap"].tables:',
  '  entries = None if table.format == 14 else sorted((cp, font.getGlyphID(name)) for cp, name in table.cmap.items())',
  '  records.append({"platformId": table.platformID, "encodingId": table.platEncID, "format": table.format, "language": None if table.format == 14 else table.language, "entries": entries})',
  '  if table.format == 14:',
  '    for selector, values in sorted(table.uvsDict.items()):',
  '      for cp, name in values:',
  '        variations.append({"codePoint": cp, "variationSelector": selector, "glyphId": font.getBestCmap().get(cp) and font.getGlyphID(font.getBestCmap()[cp]) if name is None else font.getGlyphID(name), "isDefault": name is None})',
  'variations.sort(key=lambda value: (value["variationSelector"], value["codePoint"], value["isDefault"]))',
  'best = sorted((cp, font.getGlyphID(name)) for cp, name in font.getBestCmap().items())',
  'print(json.dumps({"records": records, "best": best, "variationSequences": variations}, separators=(",", ":")))',
].join('\n')

function oracle(path: string): OracleResult {
  return JSON.parse(runFile(PYTHON, ['-c', FONTTOOLS_SCRIPT, path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })) as OracleResult
}

describe.skipIf(!FONTTOOLS_AVAILABLE)('cmap fontTools oracle', () => {
  for (const file of ['NotoSans-Regular.ttf', 'NotoSansJP-Regular.otf', 'NotoSans-VariableFont_wdth,wght.ttf']) {
    it(`matches all encoding records, mappings, UVSes, and best mapping in ${file}`, () => {
      const path = resolve(import.meta.dirname, `../../fixtures/fonts/${file}`)
      const bytes = readFileSync(path)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const cmap = parseCmap(getTableReader(parseFont(buffer), 'cmap')!)
      const actualRecords: OracleRecord[] = cmap.encodingRecords.map(function (record) {
        return {
          platformId: record.platformId,
          encodingId: record.encodingId,
          format: record.format,
          language: record.language,
          entries: record.mapping === null ? null : [...record.mapping.entries()],
        }
      })
      const expected = oracle(path)

      expect(actualRecords).toEqual(expected.records)
      expect([...cmap.entries()]).toEqual(expected.best)
      const actualVariations = [...cmap.variationSequences()].sort(function (left, right) {
        return left.variationSelector - right.variationSelector || left.codePoint - right.codePoint || Number(left.isDefault) - Number(right.isDefault)
      })
      expect(actualVariations).toEqual(expected.variationSequences)
    })
  }
})
