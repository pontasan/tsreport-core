import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PdfAProfile = 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b'

interface PdfARuleFamily {
  id: string
  profiles: PdfAProfile[]
  implemented: string[]
  reachable: string[]
  tested: string[]
  negative: string[]
  noOpenBranch: boolean
}

interface PdfACoverage {
  schemaVersion: number
  specifications: Record<PdfAProfile, string>
  independentProfileSource: string
  independentValidator: {
    name: string
    version: string
    installerSha256: string
    signingFingerprint: string
  }
  independentCorpus: {
    repository: string
    commit: string
    license: string
    profiles: Record<PdfAProfile, { total: number; pass: number; fail: number }>
    supplementalSuites: Record<string, { total: number; pass: number; fail: number }>
    total: { fixtures: number; pass: number; fail: number }
  }
  ruleFamilies: PdfARuleFamily[]
}

interface PdfAProfileRule {
  id: string
  object: string
  family: string
}

interface PdfAProfileInventory {
  profile: PdfAProfile
  file: string
  sha256: string
  ruleIdSha256: string
  rules: PdfAProfileRule[]
}

interface PdfAProfileInventories {
  schemaVersion: number
  source: { repository: string; commit: string; license: string }
  profiles: PdfAProfileInventory[]
}

const coverage = JSON.parse(readFileSync(
  resolve(process.cwd(), 'conformance/pdfa-19005-coverage.json'),
  'utf8',
)) as PdfACoverage

const inventories = JSON.parse(readFileSync(
  resolve(process.cwd(), 'conformance/pdfa-verapdf-profile-rules.json'),
  'utf8',
)) as PdfAProfileInventories

const requiredFamilies = [
  'file-framing-and-trailers',
  'object-syntax-and-limits',
  'filters-encryption-and-filespec-boundary',
  'output-intents-icc-and-device-colour',
  'images-xobjects-and-jpeg2000',
  'content-graphics-state-halftones-and-overprint',
  'fonts-cmaps-glyphs-widths-and-rendering-mode',
  'transparency-blend-and-page-groups',
  'annotations-actions-and-appearances',
  'acroform-appearance-and-action-boundary',
  'xmp-identification-synchronization-and-extension-schemas',
  'signatures-permissions-and-whole-file-byte-range',
  'optional-content-configurations',
  'embedded-and-associated-files',
]

describe('ISO 19005 PDF/A internal coverage', function () {
  it('fixes the complete rule-family inventory for the three public profiles', function () {
    expect(coverage.schemaVersion).toBe(1)
    expect(Object.keys(coverage.specifications)).toEqual(['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'])
    expect(coverage.independentProfileSource).toBe('veraPDF validation profiles')
    expect(coverage.independentValidator).toEqual({
      name: 'veraPDF Greenfield',
      version: '1.30.2',
      installerSha256: '6cc6341cb1af644044054b81f00a6590a7918abb18f762243de115258bcad838',
      signingFingerprint: '13DD102B4DD69354D12DE5A83184863278B17FE7',
    })
    expect(coverage.independentCorpus).toEqual({
      repository: 'https://github.com/veraPDF/veraPDF-corpus',
      commit: '49de56cd987929932c9e4fbbbe67d052bf44ef83',
      license: 'CC-BY-4.0',
      profiles: {
        'PDF/A-1b': { total: 569, pass: 263, fail: 306 },
        'PDF/A-2b': { total: 986, pass: 377, fail: 609 },
        'PDF/A-3b': { total: 12, pass: 7, fail: 5 },
      },
      supplementalSuites: {
        'Isartor PDF/A-1b': { total: 204, pass: 0, fail: 204 },
        'TWG PDF/A-1b': { total: 33, pass: 16, fail: 17 },
        'TWG PDF/A-2b': { total: 40, pass: 22, fail: 18 },
        'TWG PDF/A-3b': { total: 12, pass: 7, fail: 5 },
      },
      total: { fixtures: 1856, pass: 692, fail: 1164 },
    })
    expect(coverage.ruleFamilies.map(function (family) { return family.id })).toEqual(requiredFamilies)
  })

  it('binds every internal conformance column to repository evidence', function () {
    for (const family of coverage.ruleFamilies) {
      expect(family.profiles.length, family.id).toBeGreaterThan(0)
      expect(new Set(family.profiles).size, family.id).toBe(family.profiles.length)
      expect(family.noOpenBranch, family.id).toBe(true)
      for (const column of ['implemented', 'reachable', 'tested', 'negative'] as const) {
        expect(family[column].length, `${family.id}.${column}`).toBeGreaterThan(0)
        for (const evidence of family[column]) {
          expect(existsSync(resolve(process.cwd(), evidence)), `${family.id}.${column}: ${evidence}`).toBe(true)
        }
      }
    }
  })

  it('covers every common, PDF/A-2, and PDF/A-3 rule family in each applicable profile', function () {
    const common = requiredFamilies.slice(0, 11)
    for (const profile of ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'] as const) {
      const ids = coverage.ruleFamilies.filter(function (family) {
        return family.profiles.includes(profile)
      }).map(function (family) { return family.id })
      for (const id of common) expect(ids, `${profile}: ${id}`).toContain(id)
      if (profile !== 'PDF/A-1b') {
        expect(ids).toContain('signatures-permissions-and-whole-file-byte-range')
        expect(ids).toContain('optional-content-configurations')
        expect(ids).toContain('embedded-and-associated-files')
      }
    }
  })

  it('pins every official PDF/A-1b, PDF/A-2b, and PDF/A-3b profile rule including deferred rules', function () {
    expect(inventories.schemaVersion).toBe(1)
    expect(inventories.source).toEqual({
      creator: 'veraPDF Consortium',
      copyright: 'Copyright © 2015 veraPDF Consortium',
      repository: 'https://github.com/veraPDF/veraPDF-validation-profiles',
      commit: 'c4b3ab5164e4f0ae9bb235f8154db587e0ea483e',
      license: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      modifications: 'Extracted PDF/A-1b, PDF/A-2b, and PDF/A-3b rule identifiers and object names; assigned tsreport-core coverage-family labels; recorded source hashes.',
    })
    const expected = {
      'PDF/A-1b': { count: 129, digest: '47e33277c7944455aaac798625d9d715fcb901738555a8419f0d15126ebf8879' },
      'PDF/A-2b': { count: 144, digest: 'c02bcee8d96649eebeeb18d3803083b081edb2d1f4ecf6c1b00c49251d727ae5' },
      'PDF/A-3b': { count: 146, digest: 'd27063cf209d23c0e2d4ba69f92487e033efb60a04d6338a1387b0f97d33e53d' },
    } as const
    expect(inventories.profiles.map(function (profile) { return profile.profile }))
      .toEqual(['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'])
    for (const profile of inventories.profiles) {
      expect(profile.rules, profile.profile).toHaveLength(expected[profile.profile].count)
      expect(profile.ruleIdSha256, profile.profile).toBe(expected[profile.profile].digest)
      expect(new Set(profile.rules.map(function (rule) { return rule.id })).size, profile.profile)
        .toBe(profile.rules.length)
      const specification = profile.profile === 'PDF/A-1b' ? 'ISO_19005_1' : profile.profile === 'PDF/A-2b' ? 'ISO_19005_2' : 'ISO_19005_3'
      for (const rule of profile.rules) {
        expect(rule.id, profile.profile).toMatch(new RegExp(`^${specification}:6\\.`))
        expect(rule.object.length, rule.id).toBeGreaterThan(0)
        expect(requiredFamilies, rule.id).toContain(rule.family)
        const family = coverage.ruleFamilies.find(function (candidate) { return candidate.id === rule.family })
        expect(family?.profiles, rule.id).toContain(profile.profile)
      }
    }
  })
})
