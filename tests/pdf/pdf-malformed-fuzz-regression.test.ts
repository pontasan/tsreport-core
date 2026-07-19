import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePdfObject } from '../../src/pdf/pdf-parser.js'

interface PdfExecutionCoverage {
  schemaVersion: number
  normalCorpus: string[]
  malformedCorpus: string[]
  fuzzRegression: string[]
}

const encoder = new TextEncoder()

describe('PDF malformed and fuzz regression classes', function () {
  it('keeps normal, malformed, and fuzz regression inventories separate', function () {
    const manifest = JSON.parse(readFileSync(
      resolve(process.cwd(), 'conformance/pdf-execution-coverage.json'), 'utf8',
    )) as PdfExecutionCoverage
    expect(manifest.schemaVersion).toBe(1)
    const classes = [manifest.normalCorpus, manifest.malformedCorpus, manifest.fuzzRegression]
    for (let i = 0; i < classes.length; i++) {
      expect(classes[i]!.length).toBeGreaterThan(0)
      expect(new Set(classes[i]).size).toBe(classes[i]!.length)
      for (let p = 0; p < classes[i]!.length; p++) expect(existsSync(resolve(process.cwd(), classes[i]![p]!))).toBe(true)
    }
    expect(new Set(classes.flat()).size).toBe(classes[0]!.length + classes[1]!.length + classes[2]!.length)
  })

  it.each([
    '[0 0 R]',
    '<< /A 1 0 R /B [2 65536 R] >>',
    '<< /A /bad#0G >>',
    '[(unterminated]',
    '<00112233445566778899AABBCCDDEEF',
    '<< /Length 4 >> stream\nabc\nendstream',
    '1.2.3',
    '9007199254740992',
  ])('retains a crashing-parser regression seed as an explicit rejection: %s', function (source) {
    expect(function () { parsePdfObject(encoder.encode(source)) }).toThrow(/PDF parse error/)
  })
})
