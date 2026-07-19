import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeUnicodeText, type UnicodeNormalizationForm } from '../../src/layout/unicode-normalization.js'

const TEST_PATH = resolve(__dirname, '../fixtures/ucd/NormalizationTest.txt')

describe('Unicode 17.0 UAX #15 normalization conformance', function () {
  it('matches every official NormalizationTest.txt conformance relation', function () {
    const rows = parseNormalizationTest(readFileSync(TEST_PATH, 'utf8'))
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const columns = rows[rowIndex]!
      assertNormalization('NFC', columns, [1, 1, 1, 3, 3], rowIndex)
      assertNormalization('NFD', columns, [2, 2, 2, 4, 4], rowIndex)
      assertNormalization('NFKC', columns, [3, 3, 3, 3, 3], rowIndex)
      assertNormalization('NFKD', columns, [4, 4, 4, 4, 4], rowIndex)
    }
  }, 15000)
})

function assertNormalization(
  form: UnicodeNormalizationForm,
  columns: readonly string[],
  expectedColumns: readonly number[],
  rowIndex: number,
): void {
  for (let inputIndex = 0; inputIndex < columns.length; inputIndex++) {
    expect(
      normalizeUnicodeText(columns[inputIndex]!, form),
      `${form} row ${rowIndex + 1}, column ${inputIndex + 1}`,
    ).toBe(columns[expectedColumns[inputIndex]!]!)
  }
}

function parseNormalizationTest(source: string): string[][] {
  const result: string[][] = []
  for (const sourceLine of source.split(/\r?\n/u)) {
    const line = sourceLine.replace(/#.*/u, '').trim()
    if (line === '' || line.startsWith('@')) continue
    const fields = line.split(';')
    result.push(fields.slice(0, 5).map(decodeCodePoints))
  }
  return result
}

function decodeCodePoints(field: string): string {
  const values = field.trim().split(' ')
  const codePoints = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) codePoints[i] = Number.parseInt(values[i]!, 16)
  return String.fromCodePoint(...codePoints)
}
