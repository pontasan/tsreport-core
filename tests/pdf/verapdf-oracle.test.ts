import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Font } from '../../src/font.js'
import { PdfBackend, type PdfAConformance } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'
import { parseXmlDocument, type XmlElement } from '../../src/xml/xml-parser.js'

const conformance = process.env.TSREPORT_PDF_CONFORMANCE === '1'
const veraPdf = process.env.VERAPDF_BIN
const expectedVeraPdfVersion = '1.30.2'
let directory = ''
let font: Font

beforeAll(function () {
  if (!conformance) return
  if (veraPdf === undefined) throw new Error('veraPDF conformance requires VERAPDF_BIN')
  const version = spawnSync(veraPdf, ['--version'], { encoding: 'utf8' })
  if (version.error !== undefined) throw version.error
  if (version.status !== 0 || !version.stdout.startsWith(`veraPDF ${expectedVeraPdfVersion}\n`)) {
    throw new Error(`veraPDF conformance requires version ${expectedVeraPdfVersion}`)
  }
  directory = mkdtempSync(join(tmpdir(), 'tsreport-verapdf-'))
  font = Font.load(readFileSync(join(__dirname, '..', 'fixtures', 'fonts', 'Roboto-Regular.ttf')).buffer as ArrayBuffer)
})

afterAll(function () {
  if (directory !== '') rmSync(directory, { recursive: true, force: true })
})

describe('veraPDF PDF/A oracle', function () {
  for (const fixture of [
    { conformance: 'PDF/A-1b' as const, flavour: '1b', ruleCount: 129 },
    { conformance: 'PDF/A-2b' as const, flavour: '2b', ruleCount: 144 },
    { conformance: 'PDF/A-3b' as const, flavour: '3b', ruleCount: 146 },
  ]) {
    it(`validates generated ${fixture.conformance} with the independent profile`, function () {
      if (!conformance) return
      const file = join(directory, `${fixture.flavour}.pdf`)
      writeFileSync(file, buildFixture(fixture.conformance))
      const result = spawnSync(veraPdf!, [
        '--format', 'xml',
        '--flavour', fixture.flavour,
        '--maxfailures', '100',
        file,
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (result.error !== undefined) throw result.error
      expect(result.status, result.stderr).toBe(0)
      const report = parseXmlDocument(result.stdout)
      expect(report.name).toBe('report')
      const release = xmlElements(report, 'releaseDetails').find(function (element) {
        return element.attributes.id === 'core'
      })
      expect(release?.attributes.version).toBe(expectedVeraPdfVersion)
      const validationReports = xmlElements(report, 'validationReport')
      expect(validationReports).toHaveLength(1)
      expect(validationReports[0]!.attributes).toMatchObject({
        profileName: `${fixture.conformance} validation profile`,
        isCompliant: 'true',
        jobEndStatus: 'normal',
      })
      const details = xmlElements(validationReports[0]!, 'details')
      expect(details).toHaveLength(1)
      expect(details[0]!.attributes).toMatchObject({
        passedRules: String(fixture.ruleCount),
        failedRules: '0',
        failedChecks: '0',
      })
      expect(Number(details[0]!.attributes.passedChecks)).toBeGreaterThan(0)
      const summaries = xmlElements(report, 'validationReports')
      expect(summaries).toHaveLength(1)
      expect(summaries[0]!.attributes).toMatchObject({ compliant: '1', nonCompliant: '0', failedJobs: '0' })
    }, 60_000)
  }
})

function xmlElements(root: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = []
  const stack: XmlElement[] = [root]
  while (stack.length > 0) {
    const element = stack.pop()!
    if (element.name === name) result.push(element)
    for (let index = element.children.length - 1; index >= 0; index--) {
      const child = element.children[index]!
      if (typeof child !== 'string') stack.push(child)
    }
  }
  return result
}

function buildFixture(conformance: PdfAConformance): Uint8Array {
  const embeddedFiles = conformance === 'PDF/A-3b'
    ? [{ name: 'source.txt', data: new TextEncoder().encode('archival source'), mimeType: 'text/plain', relationship: 'Source' as const }]
    : undefined
  const backend = new PdfBackend({ fonts: { default: font }, pdfaConformance: conformance, embeddedFiles })
  const document: RenderDocument = {
    pages: [{
      width: 300,
      height: 200,
      children: [{
        type: 'text', x: 24, y: 24, text: `Independent ${conformance}`,
        fontId: 'default', fontSize: 12, color: '#202020',
      }],
    }],
  }
  render(document, backend)
  return backend.toUint8Array()
}
