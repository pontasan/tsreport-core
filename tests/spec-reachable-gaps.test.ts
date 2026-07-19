import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface GapEvidence {
  file: string
  needle: string
}

interface ReachableGap {
  id: string
  kind: 'throw' | 'skip' | 'fixed'
  summary: string
  evidence: GapEvidence[]
  remainingIds: string[]
}

interface GapManifest {
  schemaVersion: number
  scope: string[]
  classification: {
    included: string
    excluded: string[]
  }
  gaps: ReachableGap[]
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'conformance/spec-reachable-gaps.json'), 'utf8')) as GapManifest

const expectedGapIds: string[] = []

describe('spec-reachable unsupported branch inventory', () => {
  it('pins the complete reviewed gap set and its source scope', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.scope).toEqual([
      'src/pdf',
      'src/image',
      'src/compression',
      'src/parsers',
      'src/hinting',
      'src/shaping',
      'src/subset',
    ])
    expect(manifest.gaps.map((gap) => gap.id)).toEqual(expectedGapIds)
    expect(new Set(manifest.gaps.map((gap) => gap.id)).size).toBe(expectedGapIds.length)
  })

  it('binds every reachable branch to existing P, O, or R work IDs', () => {
    const idPattern = /^(?:P-(?:0[0-9]|1[0-2])|O-0[0-9]|R-0[1-5])$/
    for (const gap of manifest.gaps) {
      expect(gap.summary.length, gap.id).toBeGreaterThan(0)
      expect(['throw', 'skip', 'fixed']).toContain(gap.kind)
      expect(gap.remainingIds.length, gap.id).toBeGreaterThan(0)
      expect(gap.remainingIds.every((id) => idPattern.test(id)), gap.id).toBe(true)
    }
    expect(new Set(manifest.gaps.map((gap) => gap.kind))).toEqual(new Set())
  })

  it('keeps every evidence needle connected to a real in-scope source branch', () => {
    for (const gap of manifest.gaps) {
      expect(gap.evidence.length, gap.id).toBeGreaterThan(0)
      for (const evidence of gap.evidence) {
        expect(manifest.scope.some((scope) => evidence.file === scope || evidence.file.startsWith(`${scope}/`)), evidence.file).toBe(true)
        const path = resolve(root, evidence.file)
        expect(existsSync(path), evidence.file).toBe(true)
        expect(readFileSync(path, 'utf8'), `${gap.id}: ${evidence.needle}`).toContain(evidence.needle)
      }
    }
  })

  it('records why false-positive unsupported branches are not completion blockers', () => {
    expect(manifest.classification.included).toContain('permitted')
    expect(manifest.classification.excluded).toEqual(expect.arrayContaining([
      'malformed input and reserved-value rejection',
      'unknown future version or extension rejection',
      'a value the normative specification explicitly requires consumers to ignore',
    ]))
  })
})
