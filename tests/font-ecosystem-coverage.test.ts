import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface CoverageProfile {
  read: string[]
  generation: string[]
  shaping: string[]
  rendering: string[]
  metrics: string[]
  subsetRebuild: string[]
  oracle: string[]
}

interface CoverageManifest {
  profiles: Record<string, CoverageProfile>
  rows: Array<{ id: string, profile: string, normativeUnit: string }>
}

const path = resolve(process.cwd(), 'conformance/font-ecosystem-coverage.json')
const manifest = JSON.parse(readFileSync(path, 'utf8')) as CoverageManifest
const columns: Array<keyof CoverageProfile> = ['read', 'generation', 'shaping', 'rendering', 'metrics', 'subsetRebuild', 'oracle']

describe('mandatory font ecosystem coverage manifest', function () {
  it('has one unique machine-verifiable row for every adopted normative unit', function () {
    expect(manifest.rows.length).toBeGreaterThanOrEqual(50)
    expect(new Set(manifest.rows.map(function (row) { return row.id })).size).toBe(manifest.rows.length)
    expect(new Set(manifest.rows.map(function (row) { return row.profile }))).toEqual(new Set(['woff1', 'woff2', 'aat', 'graphite']))
  })

  for (const row of manifest.rows) {
    it(`${row.id} fills read/generation/shaping/rendering/metrics/subset/oracle`, function () {
      expect(row.normativeUnit.length).toBeGreaterThan(0)
      const profile = manifest.profiles[row.profile]
      expect(profile).toBeDefined()
      for (const column of columns) {
        expect(profile![column].length, `${row.id}.${column}`).toBeGreaterThan(0)
        for (const evidence of profile![column]) expect(existsSync(resolve(process.cwd(), evidence)), `${row.id}.${column}: ${evidence}`).toBe(true)
      }
    })
  }
})
