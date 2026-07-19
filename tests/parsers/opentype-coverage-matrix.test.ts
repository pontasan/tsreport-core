import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface CoverageProfile {
  consumer: string[]
  subset: string[]
  oracle: string[]
}

interface CoverageRow {
  profile: string
  forms: string[]
  parser: string[]
  test: string[]
  status: 'complete' | 'partial' | 'missing'
  remainingIds: string[]
}

interface TableCoverageRow extends CoverageRow {
  tag: string
  family: string
}

interface CommonFormatCoverageRow extends CoverageRow {
  id: string
}

interface OpenTypeCoverage {
  schemaVersion: number
  specification: string
  inventorySource: string
  profiles: Record<string, CoverageProfile>
  commonFormats: CommonFormatCoverageRow[]
  tables: TableCoverageRow[]
}

const root = resolve(import.meta.dirname, '../..')
const coverage = JSON.parse(readFileSync(resolve(root, 'conformance/opentype-1.9.1-coverage.json'), 'utf8')) as OpenTypeCoverage

const expectedTableTags = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'gasp',
  'CFF ', 'CFF2', 'VORG', 'SVG ',
  'EBDT', 'EBLC', 'EBSC', 'CBDT', 'CBLC', 'sbix',
  'BASE', 'GDEF', 'GPOS', 'GSUB', 'JSTF', 'MATH',
  'avar', 'cvar', 'fvar', 'gvar', 'HVAR', 'MVAR', 'STAT', 'VVAR',
  'COLR', 'CPAL',
  'DSIG', 'hdmx', 'kern', 'LTSH', 'MERG', 'meta', 'PCLT', 'VDMX', 'vhea', 'vmtx',
]

const expectedCommonFormatIds = [
  'sfnt-directory',
  'ttc-header',
  'otl-coverage',
  'otl-class-definition',
  'otl-device-variation',
  'otl-layout-lists',
  'otl-feature-variations',
  'variation-item-store',
  'variation-delta-index-map',
  'variation-tuple-store',
]

describe('OpenType 1.9.1 coverage matrix', () => {
  it('enumerates every standard OpenType table exactly once in specification order', () => {
    expect(coverage.schemaVersion).toBe(1)
    expect(coverage.specification).toBe('Microsoft OpenType 1.9.1')
    expect(coverage.inventorySource).toBe('https://learn.microsoft.com/en-us/typography/opentype/spec/otff')
    expect(coverage.tables.map((row) => row.tag)).toEqual(expectedTableTags)
    expect(new Set(coverage.tables.map((row) => row.tag)).size).toBe(50)
  })

  it('keeps non-OpenType ecosystem tables out of the standard inventory', () => {
    const standardTags = new Set(coverage.tables.map((row) => row.tag))
    const nonStandardTags = [
      'acnt', 'ankr', 'bsln', 'feat', 'just', 'kerx', 'lcar', 'morx', 'opbd', 'prop', 'trak',
      'Silf', 'Glat', 'Gloc', 'Sill', 'Feat',
    ]
    for (const tag of nonStandardTags) expect(standardTags.has(tag), tag).toBe(false)
  })

  it('enumerates the shared container, layout and variation formats', () => {
    expect(coverage.commonFormats.map((row) => row.id)).toEqual(expectedCommonFormatIds)
    expect(new Set(coverage.commonFormats.map((row) => row.id)).size).toBe(expectedCommonFormatIds.length)
  })

  it('maps every row through parser, consumer, subset, test and oracle evidence', () => {
    for (const profile of Object.values(coverage.profiles)) {
      expect(profile.consumer.length).toBeGreaterThan(0)
      expect(profile.subset.length).toBeGreaterThan(0)
      expect(profile.oracle.length).toBeGreaterThan(0)
      assertEvidenceExists([...profile.consumer, ...profile.subset, ...profile.oracle])
    }

    for (const row of [...coverage.tables, ...coverage.commonFormats]) {
      const profile = coverage.profiles[row.profile]
      expect(profile, `unknown profile ${row.profile}`).toBeDefined()
      expect(row.forms.length).toBeGreaterThan(0)
      expect(row.parser.length).toBeGreaterThan(0)
      expect(row.test.length).toBeGreaterThan(0)
      if (row.status === 'complete') expect(row.remainingIds).toEqual([])
      else expect(row.remainingIds.length).toBeGreaterThan(0)
      expect(row.status).toMatch(/^(complete|partial|missing)$/)
      expect(row.remainingIds.every((id) => /^O-0[0-9]$/.test(id) || id === 'R-05')).toBe(true)
      assertEvidenceExists([...row.parser, ...row.test])
    }
  })

  it('records the normative format families that otherwise hide behind table names', () => {
    expect(formsForTable('cmap')).toContain('formats 0/2/4/6/8/10/12/13/14')
    expect(formsForTable('GPOS')).toContain('lookup types 1-9')
    expect(formsForTable('GPOS')).toEqual(expect.arrayContaining([
      'SinglePos formats 1/2',
      'PairPos formats 1/2',
      'ContextPos formats 1/2/3',
      'ChainContextPos formats 1/2/3',
      'PosExtension format 1',
      'Anchor formats 1/2/3',
    ]))
    expect(formsForTable('GSUB')).toContain('lookup types 1-8')
    expect(formsForTable('GSUB')).toEqual(expect.arrayContaining([
      'SingleSubst formats 1/2',
      'ContextSubst formats 1/2/3',
      'ChainContextSubst formats 1/2/3',
      'SubstExtension format 1',
      'ReverseChainSingleSubst format 1',
    ]))
    expect(formsForTable('COLR')).toContain('Paint formats 1-32')
    expect(formsForTable('STAT')).toContain('AxisValue formats 1/2/3/4')
    expect(formsForCommon('otl-coverage')).toEqual(expect.arrayContaining(['Coverage format 1 glyph array', 'Coverage format 2 range records']))
    expect(formsForCommon('otl-class-definition')).toEqual(expect.arrayContaining(['ClassDef format 1 glyph array', 'ClassDef format 2 range records']))
    expect(formsForCommon('otl-device-variation')).toEqual(expect.arrayContaining([
      'Device deltaFormat 1 two-bit deltas',
      'Device deltaFormat 2 four-bit deltas',
      'Device deltaFormat 3 eight-bit deltas',
      'VariationIndex deltaFormat 0x8000',
    ]))
    expect(formsForCommon('variation-delta-index-map')).toContain('DeltaSetIndexMap formats 0/1')
    expect(formsForCommon('variation-tuple-store')).toEqual(expect.arrayContaining([
      'embedded and shared peak tuples',
      'intermediate regions',
      'packed point-number byte/word runs',
      'packed delta zero/byte/word runs',
    ]))
  })

  it('has no remaining partial or missing OpenType row', () => {
    const rows = [...coverage.tables, ...coverage.commonFormats]
    expect(rows.every((row) => row.status === 'complete')).toBe(true)
    expect(rows.every((row) => row.remainingIds.length === 0)).toBe(true)
  })
})

function formsForTable(tag: string): string[] {
  return coverage.tables.find((row) => row.tag === tag)!.forms
}

function formsForCommon(id: string): string[] {
  return coverage.commonFormats.find((row) => row.id === id)!.forms
}

function assertEvidenceExists(paths: string[]): void {
  for (const path of paths) expect(existsSync(resolve(root, path)), path).toBe(true)
}
