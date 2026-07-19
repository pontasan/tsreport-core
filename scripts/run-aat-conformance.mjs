import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const parserTables = [
  'aat-common', 'acnt', 'ankr', 'bsln', 'feat', 'fdsc', 'fmtx', 'gcid', 'just',
  'kern', 'kern-format1', 'kerx', 'lcar', 'ltag', 'merg', 'mort', 'morx', 'opbd',
  'prop', 'trak', 'zapf',
]
const tests = parserTables.map(function (table) { return `tests/parsers/tables/${table}.test.ts` })
tests.push(
  'tests/aat-malformed-corpus.test.ts',
  'tests/aat-coretext-oracle.test.ts',
  'tests/aat-harfbuzz-oracle.test.ts',
  'tests/font-aat-consumption-oracle.test.ts',
  'tests/subset/aat-subset.test.ts',
  'tests/subset/aat-real-font-subset.test.ts',
  'tests/subset/subset-integrity.test.ts',
)

const runner = join(process.cwd(), 'scripts', 'run-conformance.mjs')
const result = spawnSync(process.execPath, [runner, ...tests], {
  cwd: process.cwd(),
  env: { ...process.env, TSREPORT_AAT_CONFORMANCE: '1' },
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})
if (result.error !== undefined) throw result.error
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
