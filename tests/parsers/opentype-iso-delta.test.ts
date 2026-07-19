import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface DeltaRow {
  id: string
  direction: string
  scope: string[]
  requirements: string[]
  openTypeChangeLogAnchors: string[]
  workIds: string[]
  evidence: string[]
  status: string
}

interface DeltaManifest {
  schemaVersion: number
  comparisonDate: string
  opentypeBaseline: { version: string, status: string, source: string, relationship: string }
  adoptedIsoSet: Array<{ document: string, edition: number, status: string, source: string }>
  trackedSuccessor: { document: string, status: string, source: string, adoptionRule: string }
  deltaRows: DeltaRow[]
  isoOnlyRequirements: unknown[]
  isoOnlyConclusion: string
}

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(
  resolve(root, 'conformance/opentype-iso14496-22-delta.json'), 'utf8',
)) as DeltaManifest

describe('OpenType 1.9.1 and ISO/IEC 14496-22 delta', function () {
  it('pins the published ISO edition and both adopted amendments', function () {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.opentypeBaseline.version).toBe('1.9.1')
    expect(manifest.opentypeBaseline.relationship).toContain('edition 5')
    expect(manifest.adoptedIsoSet.map(function (entry) { return entry.document })).toEqual([
      'ISO/IEC 14496-22:2019',
      'ISO/IEC 14496-22:2019/Amd 1:2020',
      'ISO/IEC 14496-22:2019/Amd 2:2023',
    ])
    expect(manifest.adoptedIsoSet.every(function (entry) {
      return entry.edition === 4 && entry.status === 'published'
    })).toBe(true)
    expect(manifest.trackedSuccessor.document).toBe('ISO/IEC 14496-22 edition 5')
    expect(manifest.trackedSuccessor.status).toBe('under publication')
  })

  it('assigns every semantic 1.9.1 delta and erratum to completed O work', function () {
    expect(manifest.deltaRows.map(function (row) { return row.id })).toEqual([
      'ISO-OT-01', 'ISO-OT-02', 'ISO-OT-03', 'ISO-OT-04', 'ISO-OT-05',
      'ISO-OT-06', 'ISO-OT-07', 'ISO-OT-08', 'ISO-OT-09',
    ])
    for (const row of manifest.deltaRows) {
      expect(row.status, row.id).toBe('complete')
      expect(row.scope.length, row.id).toBeGreaterThan(0)
      expect(row.requirements.length, row.id).toBeGreaterThan(0)
      expect(row.openTypeChangeLogAnchors.length, row.id).toBeGreaterThan(0)
      expect(row.workIds.length, row.id).toBeGreaterThan(0)
      expect(row.workIds.every(function (id) { return /^O-0[0-9]$/.test(id) }), row.id).toBe(true)
      expect(row.evidence.length, row.id).toBeGreaterThan(0)
      for (const path of row.evidence) expect(existsSync(resolve(root, path)), `${row.id}: ${path}`).toBe(true)
    }
  })

  it('records no unassigned ISO-only requirement and preserves a publication re-diff gate', function () {
    expect(manifest.isoOnlyRequirements).toEqual([])
    expect(manifest.isoOnlyConclusion).toContain('No normative binary-format or processing requirement')
    expect(manifest.trackedSuccessor.adoptionRule).toContain('until publication completes')
    for (const source of [
      manifest.opentypeBaseline.source,
      manifest.trackedSuccessor.source,
      ...manifest.adoptedIsoSet.map(function (entry) { return entry.source }),
    ]) expect(source).toMatch(/^https:\/\//)
  })
})
