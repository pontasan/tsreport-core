import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDefinedTrueTypeOpcode } from '../../src/hinting/interpreter.js'
import {
  UNICODE_SCRIPT_NAMES,
  UNICODE_SCRIPT_RANGES,
  UNICODE_SHAPING_DATA_VERSION,
} from '../../src/shaping/unicode-shaping-data.js'

interface EvidenceRow {
  id: string
  expected: Record<string, unknown>
  implementation: string[]
  tests: string[]
  oracle: string[]
}

interface ExecutionCoverage {
  schemaVersion: number
  specification: string
  unicodeVersion: string
  coverage: EvidenceRow[]
  corpus: {
    realFonts: string[]
    minimumFormatFixtures: string[]
    malformed: string[]
    fuzzRegression: string[]
  }
  classification: Record<string, string[]>
  requiredOracles: string[]
}

interface TableCoverage {
  commonFormats: Array<{ id: string, forms: string[], status: string, remainingIds: string[] }>
  tables: Array<{ tag: string, forms: string[], status: string, remainingIds: string[] }>
}

const root = resolve(import.meta.dirname, '../..')
const execution = readJson<ExecutionCoverage>('conformance/opentype-execution-coverage.json')
const tables = readJson<TableCoverage>('conformance/opentype-1.9.1-coverage.json')

describe('OpenType 1.9.1 execution coverage', function () {
  it('binds every execution domain to implementation, test, and independent evidence', function () {
    expect(execution.schemaVersion).toBe(1)
    expect(execution.specification).toBe('Microsoft OpenType 1.9.1')
    expect(execution.coverage.map(function (row) { return row.id })).toEqual([
      'unicode-scripts',
      'gsub-lookup-types',
      'gpos-lookup-types',
      'variation-formats',
      'color-formats',
      'bitmap-formats',
      'truetype-instructions',
    ])
    for (const row of execution.coverage) {
      expect(row.implementation.length, row.id).toBeGreaterThan(0)
      expect(row.tests.length, row.id).toBeGreaterThan(0)
      expect(row.oracle.length, row.id).toBeGreaterThan(0)
      assertPathsExist([...row.implementation, ...row.tests, ...row.oracle])
    }
  })

  it('covers every generated Unicode script range used by shaping', function () {
    const expected = row('unicode-scripts').expected as { scriptCount: number, rangeCount: number }
    expect(UNICODE_SHAPING_DATA_VERSION).toBe(execution.unicodeVersion)
    expect(UNICODE_SCRIPT_NAMES.length).toBe(expected.scriptCount)
    expect(UNICODE_SCRIPT_RANGES.length % 3).toBe(0)
    expect(UNICODE_SCRIPT_RANGES.length / 3).toBe(expected.rangeCount)
    const usedScriptIndices = new Set<number>()
    for (let index = 2; index < UNICODE_SCRIPT_RANGES.length; index += 3) {
      const scriptIndex = UNICODE_SCRIPT_RANGES[index]!
      expect(scriptIndex).toBeLessThan(UNICODE_SCRIPT_NAMES.length)
      usedScriptIndices.add(scriptIndex)
    }
    expect(usedScriptIndices.size).toBe(UNICODE_SCRIPT_NAMES.length)
  })

  it('covers all GSUB and GPOS lookup types with committed HarfBuzz oracle cases', function () {
    const gsubTypes = (row('gsub-lookup-types').expected.lookupTypes as number[])
    const gposTypes = (row('gpos-lookup-types').expected.lookupTypes as number[])
    expect(gsubTypes).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(gposTypes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const aots = readFileSync(resolve(root, 'tests/font-otl-aots-oracle.test.ts'), 'utf8')
    for (const lookupType of gsubTypes) expect(aots).toContain(`GSUB ${lookupType} `)
    for (const lookupType of gposTypes) expect(aots).toContain(`GPOS ${lookupType} `)
  })

  it('covers every variation, color, and bitmap format recorded by the table matrix', function () {
    const variationTags = row('variation-formats').expected.tables as string[]
    expect(variationTags).toEqual(['avar', 'cvar', 'fvar', 'gvar', 'HVAR', 'MVAR', 'STAT', 'VVAR'])
    for (const tag of variationTags) expect(table(tag).status, tag).toBe('complete')
    expect(table('COLR').forms).toContain('Paint formats 1-32')
    expect(row('color-formats').expected.colrPaintFormats).toBe(32)
    for (const tag of row('bitmap-formats').expected.tables as string[]) {
      expect(table(tag).status, tag).toBe('complete')
    }
    expect(row('bitmap-formats').expected.indexSubtableFormats).toEqual([1, 2, 3, 4, 5])
    expect(row('bitmap-formats').expected.ebdtImageFormats).toEqual([1, 2, 5, 6, 7, 8, 9])
    expect(row('bitmap-formats').expected.cbdtImageFormats).toEqual([17, 18, 19])
  })

  it('covers every assigned TrueType opcode and separately records reserved bytes', function () {
    const expected = row('truetype-instructions').expected as {
      assignedOpcodeCount: number
      reservedOpcodes: number[]
    }
    const assigned: number[] = []
    const reserved: number[] = []
    for (let opcode = 0; opcode <= 0xFF; opcode++) {
      if (isDefinedTrueTypeOpcode(opcode)) assigned.push(opcode)
      else reserved.push(opcode)
    }
    expect(assigned.length).toBe(expected.assignedOpcodeCount)
    expect(reserved).toEqual(expected.reservedOpcodes)
    expect(new Set([...assigned, ...reserved]).size).toBe(256)
  })

  it('closes every standard table row and keeps malformed/future input in separate classes', function () {
    for (const covered of [...tables.commonFormats, ...tables.tables]) {
      expect(covered.status, 'tag' in covered ? covered.tag : covered.id).toBe('complete')
      expect(covered.remainingIds).toEqual([])
    }
    expect(Object.keys(execution.classification)).toEqual(['supported', 'invalid', 'futureVersion'])
    for (const paths of Object.values(execution.classification)) assertPathsExist(paths)
    assertPathsExist([
      ...execution.corpus.realFonts,
      ...execution.corpus.minimumFormatFixtures,
      ...execution.corpus.malformed,
      ...execution.corpus.fuzzRegression,
    ])
    expect(execution.corpus.realFonts.length).toBeGreaterThanOrEqual(8)
    expect(execution.requiredOracles).toEqual([
      'fontTools', 'FreeType', 'HarfBuzz shaping', 'HarfBuzz color raster',
    ])
  })
})

function row(id: string): EvidenceRow {
  return execution.coverage.find(function (candidate) { return candidate.id === id })!
}

function table(tag: string): TableCoverage['tables'][number] {
  return tables.tables.find(function (candidate) { return candidate.tag === tag })!
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T
}

function assertPathsExist(paths: string[]): void {
  for (const path of paths) expect(existsSync(resolve(root, path)), path).toBe(true)
}
