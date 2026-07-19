import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface UnicodeRequirement {
  id: string
  sources: string[]
  runtime: string[]
  generator?: string
  tests: string[]
}

interface UnicodeCoverage {
  schemaVersion: number
  unicodeVersion: string
  requirements: UnicodeRequirement[]
}

const root = resolve(import.meta.dirname, '../..')
const coverage = JSON.parse(readFileSync(resolve(root, 'conformance/unicode-17.0-coverage.json'), 'utf8')) as UnicodeCoverage

describe('Unicode 17.0 normative dependency coverage', function () {
  it('pins every OpenType shaping dependency to generated runtime data and conformance tests', function () {
    expect(coverage.schemaVersion).toBe(1)
    expect(coverage.unicodeVersion).toBe('17.0.0')
    expect(coverage.requirements.map(function (row) { return row.id })).toEqual([
      'Unicode-Script-Shaping', 'UAX-9', 'UAX-15', 'UAX-29-Grapheme',
    ])
    for (const row of coverage.requirements) {
      expect(row.sources.length, row.id).toBeGreaterThan(0)
      expect(row.runtime.length, row.id).toBeGreaterThan(0)
      expect(row.tests.length, row.id).toBeGreaterThan(0)
      for (const path of [...row.runtime, ...row.tests]) expect(existsSync(resolve(root, path)), path).toBe(true)
      if (row.generator !== undefined) expect(existsSync(resolve(root, row.generator)), row.generator).toBe(true)
    }
  })

  it('does not delegate normalization semantics to the host JavaScript Unicode version', function () {
    const implementation = readFileSync(resolve(root, 'src/layout/unicode-normalization.ts'), 'utf8')
    expect(implementation).not.toMatch(/\.normalize\s*\(/u)
  })
})
