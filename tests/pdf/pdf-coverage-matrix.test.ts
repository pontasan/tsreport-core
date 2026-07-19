import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type CoverageStatus = 'partial' | 'missing' | 'not-applicable'

interface CoverageCell {
  status: CoverageStatus
  evidence?: string[]
  reason?: string
}

interface CoverageProfile {
  reader: CoverageCell
  writer: CoverageCell
  renderer: CoverageCell
  publicApi: CoverageCell
  test: CoverageCell
  oracle: CoverageCell
}

interface CoverageManifest {
  profiles: Record<string, CoverageProfile>
  normativeUnits: Array<{ section: string, title: string, profile: string, remainingIds: string[] }>
  informativeUnits: Array<{ section: string, title: string }>
}

interface ErrataManifest {
  source: { revision: string }
  issueStatus: {
    isoApprovedCount: number
    industryApprovedCount: number
    industryApprovedIssueIds: number[]
  }
  clauses: Array<{ section: string, sourceFile: string, issueIds: number[], closureIds: string[] }>
  p08RegressionBindings: Array<{ unit: string, issueIds: number[], implementation: string[], tests: string[] }>
}

const manifestPath = resolve(process.cwd(), 'conformance/pdf-iso32000-2-coverage.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CoverageManifest
const errataPath = resolve(process.cwd(), 'conformance/pdf-iso32000-2-errata.json')
const errata = JSON.parse(readFileSync(errataPath, 'utf8')) as ErrataManifest
const columns: Array<keyof CoverageProfile> = ['reader', 'writer', 'renderer', 'publicApi', 'test', 'oracle']
const expectedClauses: Record<string, number> = {
  '7': 12,
  '8': 11,
  '9': 10,
  '10': 8,
  '11': 7,
  '12': 11,
  '13': 7,
  '14': 13,
}
const normativeAnnexes = ['Annex D', 'Annex E', 'Annex F', 'Annex I', 'Annex K', 'Annex L', 'Annex O', 'Annex Q']
const informativeAnnexes = ['Annex A', 'Annex B', 'Annex C', 'Annex G', 'Annex H', 'Annex J', 'Annex M', 'Annex N', 'Annex P']

describe('ISO 32000-2 coverage matrix', function () {
  it('contains every top-level normative subclause from clauses 7 through 14', function () {
    for (const [clause, expectedCount] of Object.entries(expectedClauses)) {
      const units = manifest.normativeUnits.filter(function (unit) { return unit.section.startsWith(`${clause}.`) })
      expect(units, `clause ${clause}`).toHaveLength(expectedCount)
      for (let index = 0; index < expectedCount; index++) expect(units[index]!.section).toBe(`${clause}.${index + 1}`)
    }
  })

  it('separates every normative and informative annex in the adopted inventory', function () {
    expect(manifest.normativeUnits.filter(function (unit) { return unit.section.startsWith('Annex ') }).map(function (unit) { return unit.section })).toEqual(normativeAnnexes)
    expect(manifest.informativeUnits.map(function (unit) { return unit.section })).toEqual(informativeAnnexes)
  })

  it('maps every normative unit to all six audit columns and an existing P-ID', function () {
    expect(manifest.normativeUnits).toHaveLength(87)
    expect(new Set(manifest.normativeUnits.map(function (unit) { return unit.section })).size).toBe(87)
    for (const unit of manifest.normativeUnits) {
      expect(unit.title.length, unit.section).toBeGreaterThan(0)
      expect(unit.remainingIds.length, unit.section).toBeGreaterThan(0)
      for (const id of unit.remainingIds) expect(id).toMatch(/^P-(0[0-9]|1[0-2])$/)
      const profile = manifest.profiles[unit.profile]
      expect(profile, `${unit.section}.profile`).toBeDefined()
      for (const column of columns) {
        const cell = profile![column]
        expect(['partial', 'missing', 'not-applicable'], `${unit.section}.${column}`).toContain(cell.status)
        if (cell.status === 'not-applicable') {
          expect(cell.reason?.length, `${unit.section}.${column}.reason`).toBeGreaterThan(0)
        } else {
          expect(cell.evidence?.length, `${unit.section}.${column}.evidence`).toBeGreaterThan(0)
          for (const evidence of cell.evidence!) {
            expect(existsSync(resolve(process.cwd(), evidence)), `${unit.section}.${column}: ${evidence}`).toBe(true)
          }
        }
      }
    }
  })

  it('does not claim clause completion while any implementation column is partial or missing', function () {
    for (const unit of manifest.normativeUnits) {
      const profile = manifest.profiles[unit.profile]!
      expect(columns.some(function (column) { return profile[column].status === 'partial' || profile[column].status === 'missing' }), unit.section).toBe(true)
    }
  })

  it('freezes every Errata Collection 3 correction at the audited source revision', function () {
    expect(errata.source.revision).toBe('d51d1ccf4a0c5bea5c9bb5ae4cb60ba26acb69ac')
    const issueIds = new Set<number>()
    for (const clause of errata.clauses) {
      expect(clause.sourceFile).toMatch(/^clause(?:[0-9]+|Annex[A-Z]|Bibliography)\.md$/)
      expect(new Set(clause.issueIds).size, clause.section).toBe(clause.issueIds.length)
      expect(clause.issueIds).toEqual([...clause.issueIds].sort(function (a, b) { return a - b }))
      expect(clause.closureIds.length, clause.section).toBeGreaterThan(0)
      for (const id of clause.closureIds) expect(id).toMatch(/^P-(0[0-9]|1[0-2])$/)
      for (const id of clause.issueIds) issueIds.add(id)
    }
    expect(issueIds.size).toBe(348)
    expect(errata.issueStatus.isoApprovedCount + errata.issueStatus.industryApprovedCount).toBe(issueIds.size)
    expect(errata.issueStatus.isoApprovedCount).toBe(287)
    expect(errata.issueStatus.industryApprovedCount).toBe(61)
    expect(new Set(errata.issueStatus.industryApprovedIssueIds).size).toBe(61)
    for (const id of errata.issueStatus.industryApprovedIssueIds) expect(issueIds.has(id), `issue ${id}`).toBe(true)
  })

  it('binds every P-08 errata expectation to connected implementation and regression tests', function () {
    const issueIds = new Set(errata.clauses.flatMap(function (clause) { return clause.issueIds }))
    expect(errata.p08RegressionBindings.map(function (binding) { return binding.unit })).toEqual([
      'lexical and object syntax',
      'filter chains and crypt placement',
      'file structure and revisions',
      'dates and file specifications',
      'Annex D encodings',
      'Annex F linearization',
    ])
    for (const binding of errata.p08RegressionBindings) {
      expect(binding.issueIds.length, binding.unit).toBeGreaterThan(0)
      for (const id of binding.issueIds) expect(issueIds.has(id), `${binding.unit}: issue ${id}`).toBe(true)
      for (const evidence of [...binding.implementation, ...binding.tests]) {
        expect(existsSync(resolve(process.cwd(), evidence)), `${binding.unit}: ${evidence}`).toBe(true)
      }
    }
  })
})
