import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const vitest = join(process.cwd(), 'node_modules', '.bin', 'vitest')
const result = spawnSync(vitest, ['run', ...process.argv.slice(2), '--reporter=json'], {
  cwd: process.cwd(),
  env: { ...process.env, TSREPORT_CONFORMANCE: '1' },
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})

if (result.error !== undefined) throw result.error
const report = JSON.parse(result.stdout)
if (result.status !== 0) {
  for (const file of report.testResults ?? []) {
    if (file.status === 'passed') continue
    process.stderr.write(`${file.name}\n`)
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'passed') continue
      process.stderr.write(`${assertion.fullName}: ${assertion.status}\n`)
      for (const message of assertion.failureMessages ?? []) process.stderr.write(`${message}\n`)
    }
    if (file.message !== '') process.stderr.write(`${file.message}\n`)
  }
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const skipped = []
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status === 'skipped' || assertion.status === 'pending' || assertion.status === 'todo') {
      skipped.push(`${file.name}: ${assertion.fullName}`)
    }
  }
}

if (skipped.length !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0) {
  process.stderr.write(`Conformance run contains ${skipped.length} skipped or pending tests:\n`)
  process.stderr.write(`${skipped.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`Conformance passed: ${report.numPassedTests} tests, zero skipped or pending tests.\n`)
