import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PdfXCoverageUnit {
  section: string
  title: string
  status: 'complete'
  requirements: string[]
  implementation: string[]
  tests: string[]
}

interface PdfXCoverageManifest {
  specification: string
  independentPreflight: {
    status: 'configured-not-executed' | 'complete'
    validator: string
    script: string
    test: string
    environmentVariable: string
    verificationRun: {
      verifiedAt: string
      profile: string
      fixtures: Array<{
        name: string
        sha256: string
        expected: 'compliant' | 'non-compliant'
        errors: number
        warnings: number
        information: number
        fixed: number
        notFixed: number
      }>
    }
  }
  units: PdfXCoverageUnit[]
}

const path = resolve(process.cwd(), 'conformance/pdfx-15930-4-coverage.json')
const manifest = JSON.parse(readFileSync(path, 'utf8')) as PdfXCoverageManifest
const expectedSections = ['5', '6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9', '6.10', '6.11', '6.12', '6.13', '6.14', '6.15', '6.16', '6.17']

describe('ISO 15930-4 PDF/X-1a:2003 coverage', function () {
  it('closes clause 5 and every technical requirement section', function () {
    expect(manifest.specification).toBe('ISO 15930-4:2003 PDF/X-1a:2003')
    expect(manifest.units.map(function (unit) { return unit.section })).toEqual(expectedSections)
    expect(new Set(manifest.units.map(function (unit) { return unit.section })).size).toBe(expectedSections.length)
    for (const unit of manifest.units) {
      expect(unit.status, unit.section).toBe('complete')
      expect(unit.title.length, unit.section).toBeGreaterThan(0)
      expect(unit.requirements.length, unit.section).toBeGreaterThan(0)
      expect(unit.implementation.length, unit.section).toBeGreaterThan(0)
      expect(unit.tests.length, unit.section).toBeGreaterThan(0)
      for (const evidence of [...unit.implementation, ...unit.tests]) {
        expect(existsSync(resolve(process.cwd(), evidence)), `${unit.section}: ${evidence}`).toBe(true)
      }
    }
  })

  it('keeps independent preflight as a distinct executable gate', function () {
    expect(manifest.independentPreflight.status).toBe('complete')
    expect(manifest.independentPreflight.validator).toBe('independent PDF/X-1a:2003 preflight')
    expect(manifest.independentPreflight.environmentVariable).toBe('PDFX_PREFLIGHT_BIN')
    expect(existsSync(resolve(process.cwd(), manifest.independentPreflight.script))).toBe(true)
    expect(existsSync(resolve(process.cwd(), manifest.independentPreflight.test))).toBe(true)
    expect(manifest.independentPreflight.verificationRun.profile).toBe('PDF/X-1a:2003 への準拠を確認')
    expect(manifest.independentPreflight.verificationRun.fixtures).toHaveLength(4)
    expect(manifest.independentPreflight.verificationRun.fixtures.map(function (fixture) {
      return [fixture.expected, fixture.errors, fixture.fixed, fixture.notFixed]
    })).toEqual([
      ['compliant', 0, 0, 0],
      ['compliant', 0, 0, 0],
      ['compliant', 0, 0, 0],
      ['non-compliant', 1, 0, 0],
    ])
    for (const fixture of manifest.independentPreflight.verificationRun.fixtures) {
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(fixture.warnings).toBe(0)
      expect(fixture.information).toBe(0)
    }
  })
})
