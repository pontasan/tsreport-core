import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync as runFile, spawnSync as runSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseFont } from '../../../src/parsers/index.js'
import { getTableReader } from '../../../src/parsers/sfnt-parser.js'
import { parseOs2 } from '../../../src/parsers/tables/os2.js'
import { buildSfntFromTables } from '../../../src/subset/ttf-subset.js'

const PYTHON = process.env['PYTHON'] ?? 'python3'
const FONTTOOLS_AVAILABLE = runSync(PYTHON, ['-c', 'from fontTools.ttLib import TTFont']).status === 0
if (process.env['CONFORMANCE'] === '1' && !FONTTOOLS_AVAILABLE) {
  throw new Error('OpenType conformance requires Python fontTools')
}

const FIELD_MAP: ReadonlyArray<readonly [string, string, number]> = [
  ['version', 'version', 0], ['avgCharWidth', 'xAvgCharWidth', 0],
  ['weightClass', 'usWeightClass', 0], ['widthClass', 'usWidthClass', 0], ['fsType', 'fsType', 0],
  ['subscriptXSize', 'ySubscriptXSize', 0], ['subscriptYSize', 'ySubscriptYSize', 0],
  ['subscriptXOffset', 'ySubscriptXOffset', 0], ['subscriptYOffset', 'ySubscriptYOffset', 0],
  ['superscriptXSize', 'ySuperscriptXSize', 0], ['superscriptYSize', 'ySuperscriptYSize', 0],
  ['superscriptXOffset', 'ySuperscriptXOffset', 0], ['superscriptYOffset', 'ySuperscriptYOffset', 0],
  ['strikeoutSize', 'yStrikeoutSize', 0], ['strikeoutPosition', 'yStrikeoutPosition', 0],
  ['familyClass', 'sFamilyClass', 0],
  ['unicodeRange1', 'ulUnicodeRange1', 0], ['unicodeRange2', 'ulUnicodeRange2', 0],
  ['unicodeRange3', 'ulUnicodeRange3', 0], ['unicodeRange4', 'ulUnicodeRange4', 0],
  ['achVendID', 'achVendID', 0], ['fsSelection', 'fsSelection', 0],
  ['firstCharIndex', 'usFirstCharIndex', 0], ['lastCharIndex', 'usLastCharIndex', 0],
  ['typoAscender', 'sTypoAscender', 0], ['typoDescender', 'sTypoDescender', 0],
  ['typoLineGap', 'sTypoLineGap', 0], ['winAscent', 'usWinAscent', 0], ['winDescent', 'usWinDescent', 0],
  ['codePageRange1', 'ulCodePageRange1', 0], ['codePageRange2', 'ulCodePageRange2', 0],
  ['xHeight', 'sxHeight', 0], ['capHeight', 'sCapHeight', 0],
  ['defaultChar', 'usDefaultChar', 0], ['breakChar', 'usBreakChar', 0], ['maxContext', 'usMaxContext', 0],
  ['lowerOpticalPointSize', 'usLowerOpticalPointSize', 0],
  ['upperOpticalPointSize', 'usUpperOpticalPointSize', 0xFFFF],
]

const FONTTOOLS_SCRIPT = [
  'import json, sys',
  'from fontTools.ttLib import TTFont',
  'font = TTFont(sys.argv[1], lazy=False)',
  'table = font["OS/2"]',
  `fields = ${JSON.stringify(FIELD_MAP)}`,
  'result = {target: getattr(table, source, default) for target, source, default in fields}',
  'if table.version >= 5:',
  '  result["lowerOpticalPointSize"] = round(result["lowerOpticalPointSize"] * 20)',
  '  result["upperOpticalPointSize"] = round(result["upperOpticalPointSize"] * 20)',
  'panose_fields = ["bFamilyType", "bSerifStyle", "bWeight", "bProportion", "bContrast", "bStrokeVariation", "bArmStyle", "bLetterForm", "bMidline", "bXHeight"]',
  'result["panose"] = [getattr(table.panose, field) for field in panose_fields]',
  'print(json.dumps(result))',
].join('\n')

const tempDirectory = mkdtempSync(join(tmpdir(), 'tsreport-os2-oracle-'))
afterAll(() => rmSync(tempDirectory, { recursive: true, force: true }))

function fontToolsOs2(path: string): Record<string, unknown> {
  return JSON.parse(runFile(PYTHON, ['-c', FONTTOOLS_SCRIPT, path], { encoding: 'utf8' })) as Record<string, unknown>
}

function actualOs2(buffer: ArrayBuffer): Record<string, unknown> {
  const table = parseOs2(getTableReader(parseFont(buffer), 'OS/2')!)
  return { ...table, panose: Array.from(table.panose) }
}

function buildOs2(version: number): Uint8Array {
  const size = version === 0 ? 78 : version === 1 ? 86 : version < 5 ? 96 : 100
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, version)
  view.setInt16(2, 512)
  view.setUint16(4, 450)
  view.setUint16(6, 6)
  view.setInt16(10, 600)
  view.setInt16(12, 650)
  view.setInt16(18, 600)
  view.setInt16(20, 650)
  view.setInt16(26, 50)
  view.setInt16(28, 300)
  for (let i = 0; i < 10; i++) bytes[32 + i] = i
  view.setUint32(42, 0x80000001)
  bytes.set([0x54, 0x45, 0x53, 0x54], 58)
  view.setUint16(62, 0x0040)
  view.setUint16(64, 0x0020)
  view.setUint16(66, 0x00FF)
  view.setInt16(68, 800)
  view.setInt16(70, -200)
  view.setInt16(72, 20)
  view.setUint16(74, 900)
  view.setUint16(76, 250)
  if (version >= 1) {
    view.setUint32(78, 1)
    view.setUint32(82, 0x80000000)
  }
  if (version >= 2) {
    view.setInt16(86, 500)
    view.setInt16(88, 700)
    view.setUint16(92, 32)
    view.setUint16(94, 4)
  }
  if (version >= 5) {
    view.setUint16(96, 120)
    view.setUint16(98, 480)
  }
  return bytes
}

function buildOracleFont(version: number): ArrayBuffer {
  const maxp = new Uint8Array([0x00, 0x00, 0x50, 0x00, 0x00, 0x01])
  return buildSfntFromTables(0x00010000, [
    { tag: 'OS/2', data: buildOs2(version) },
    { tag: 'maxp', data: maxp },
  ])
}

describe.skipIf(!FONTTOOLS_AVAILABLE)('OS/2 fontTools oracle', () => {
  for (const file of ['NotoSans-Regular.ttf', 'SourceSans3-Regular.otf', 'NotoSans-VariableFont_wdth,wght.ttf']) {
    it(`matches every OS/2 field in ${file}`, () => {
      const path = resolve(import.meta.dirname, `../../fixtures/fonts/${file}`)
      const bytes = readFileSync(path)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      expect(actualOs2(buffer)).toEqual(fontToolsOs2(path))
    })
  }

  for (const version of [0, 1, 2, 3, 4, 5]) {
    it(`matches version ${version} field presence and defaults`, () => {
      const buffer = buildOracleFont(version)
      const path = join(tempDirectory, `os2-v${version}.ttf`)
      writeFileSync(path, new Uint8Array(buffer))
      expect(actualOs2(buffer)).toEqual(fontToolsOs2(path))
    })
  }
})
