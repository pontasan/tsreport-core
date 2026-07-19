import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const suites = [
  'tests/parsers/opentype-coverage-matrix.test.ts',
  'tests/parsers/opentype-execution-coverage.test.ts',
  'tests/parsers/opentype-iso-delta.test.ts',
  'tests/parsers/sfnt-conformance.test.ts',
  'tests/parsers/table-version-compatibility.test.ts',
  'tests/layout/unicode-coverage.test.ts',
  'tests/hinting/interpreter.test.ts',
  'tests/font-core-fonttools-oracle.test.ts',
  'tests/parsers/tables/cmap-fonttools-oracle.test.ts',
  'tests/parsers/tables/os2-fonttools-oracle.test.ts',
  'tests/parsers/tables/post-fonttools-oracle.test.ts',
  'tests/font-feature-params-fonttools-oracle.test.ts',
  'tests/font-cff2-fonttools-oracle.test.ts',
  'tests/font-subset-fonttools-oracle.test.ts',
  'tests/font-otl-aots-oracle.test.ts',
  'tests/hb-compat.test.ts',
  'tests/font-truetype-freetype-oracle.test.ts',
  'tests/font-truetype-raster-freetype-oracle.test.ts',
  'tests/renderer/colr-v1-raster-oracle.test.ts',
  'tests/subset/subset-integrity.test.ts',
]

const vitest = join(process.cwd(), 'node_modules', '.bin', 'vitest')
const result = spawnSync(vitest, ['run', ...suites, '--reporter=json'], {
  cwd: process.cwd(),
  env: { ...process.env, TSREPORT_CONFORMANCE: '1' },
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})

if (result.error !== undefined) throw result.error
if (result.status !== 0) {
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const report = JSON.parse(result.stdout)
const skipped = []
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status === 'skipped' || assertion.status === 'pending' || assertion.status === 'todo') {
      skipped.push(`${file.name}: ${assertion.fullName}`)
    }
  }
}

if (skipped.length !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0) {
  process.stderr.write(`OpenType conformance contains ${skipped.length} skipped or pending tests:\n`)
  process.stderr.write(`${skipped.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`OpenType conformance passed: ${report.numPassedTests} tests, zero skipped or pending tests.\n`)
