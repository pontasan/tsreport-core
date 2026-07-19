import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'

interface VeraPdfJob {
  itemDetails: { name: string }
  validationResult: [{ compliant: boolean; jobEndStatus: string }]
}

interface VeraPdfReport {
  buildInformation: { releaseDetails: Array<{ id: string; version: string }> }
  jobs: VeraPdfJob[]
}

const enabled = process.env.TSREPORT_PDF_CONFORMANCE === '1'
const veraPdf = process.env.VERAPDF_BIN
const corpus = process.env.VERAPDF_CORPUS_DIR
const corpusCommit = '49de56cd987929932c9e4fbbbe67d052bf44ef83'

beforeAll(function () {
  if (!enabled) return
  if (veraPdf === undefined || !existsSync(veraPdf)) throw new Error('VERAPDF_BIN is required')
  if (corpus === undefined || !existsSync(corpus)) throw new Error('VERAPDF_CORPUS_DIR is required')
  const revision = spawnSync('git', ['-C', corpus, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (revision.error !== undefined) throw revision.error
  expect(revision.status, revision.stderr).toBe(0)
  expect(revision.stdout.trim()).toBe(corpusCommit)
})

describe('official veraPDF PDF/A atomic corpus', function () {
  const profiles = [
    { flavour: '1b', directory: 'PDF_A-1b', total: 569, pass: 263, fail: 306 },
    { flavour: '2b', directory: 'PDF_A-2b', total: 986, pass: 377, fail: 609 },
    { flavour: '3b', directory: 'PDF_A-3b', total: 12, pass: 7, fail: 5 },
  ] as const

  for (const profile of profiles) {
    it(`matches all ${profile.total} PDF/A-${profile.flavour} atomic fixtures`, async function () {
      if (!enabled) return
      const result = await runVeraPdf([
        '--format', 'json', '--flavour', profile.flavour, '--recurse', '--processes', '8',
        join(corpus!, profile.directory),
      ])
      assertCorpusResult(result, profile.total, profile.pass, profile.fail)
    }, 180_000)
  }

  it('matches all 204 Isartor PDF/A-1b atomic fixtures', async function () {
    if (!enabled) return
    const result = await runVeraPdf([
      '--format', 'json', '--flavour', '1b', '--recurse', '--processes', '8',
      join(corpus!, 'Isartor test files', 'PDFA-1b'),
    ])
    assertCorpusResult(result, 204, 0, 204)
  }, 180_000)

  const twgProfiles = [
    { flavour: '1b', marker: 'pdfa1-', total: 33, pass: 16, fail: 17 },
    { flavour: '2b', marker: 'pdfa2-', total: 40, pass: 22, fail: 18 },
    { flavour: '3b', marker: 'pdfa3-', total: 12, pass: 7, fail: 5 },
  ] as const

  for (const profile of twgProfiles) {
    it(`matches all ${profile.total} TWG PDF/A-${profile.flavour} atomic fixtures`, async function () {
      if (!enabled) return
      const directory = join(corpus!, 'TWG test files')
      const files = readdirSync(directory)
        .filter(function (name) { return name.endsWith('.pdf') && name.includes(profile.marker) })
        .map(function (name) { return join(directory, name) })
      expect(files).toHaveLength(profile.total)
      const result = await runVeraPdf([
        '--format', 'json', '--flavour', profile.flavour, '--processes', '8', ...files,
      ])
      assertCorpusResult(result, profile.total, profile.pass, profile.fail)
    }, 180_000)
  }
})

function assertCorpusResult(
  result: { status: number | null; stdout: string; stderr: string },
  total: number,
  pass: number,
  fail: number,
): void {
  expect(result.status, result.stderr).toBe(fail === 0 ? 0 : 1)
  const document = JSON.parse(result.stdout) as { report?: VeraPdfReport; reports?: Array<{ report: VeraPdfReport }> }
  const reports = document.report === undefined
    ? document.reports!.map(function (entry) { return entry.report })
    : [document.report]
  for (const report of reports) {
    expect(report.buildInformation.releaseDetails.find(function (release) { return release.id === 'core' })?.version)
      .toBe('1.30.2')
  }
  const jobs = reports.flatMap(function (report) { return report.jobs })
  expect(jobs).toHaveLength(total)
  expect(jobs.filter(function (job) { return job.itemDetails.name.includes('-pass-') })).toHaveLength(pass)
  expect(jobs.filter(function (job) { return job.itemDetails.name.includes('-fail-') })).toHaveLength(fail)
  for (const job of jobs) {
    expect(job.validationResult).toHaveLength(1)
    expect(job.validationResult[0].jobEndStatus, job.itemDetails.name).toBe('normal')
    const expected = job.itemDetails.name.includes('-pass-')
    expect(job.validationResult[0].compliant, job.itemDetails.name).toBe(expected)
  }
}

function runVeraPdf(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(function (resolve, reject) {
    const child = spawn(veraPdf!, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', function (chunk: Buffer) { stdout.push(chunk) })
    child.stderr.on('data', function (chunk: Buffer) { stderr.push(chunk) })
    child.on('error', reject)
    child.on('close', function (status) {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}
