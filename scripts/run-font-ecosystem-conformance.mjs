import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const WOFF2_REVISION = '1fd8cd583645618f4df36c65a297479840ad5510'
const GRAPHITE2_REVISION = 'ca8d821e60a15b6c24e404c9086992c975d8e1cf'

function requirePath(name, path) {
  if (path === undefined || !existsSync(path)) throw new Error(`${name} must point to an existing conformance dependency`)
  return path
}

function gitRevision(path) {
  const result = spawnSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Unable to read the pinned revision from ${path}`)
  return result.stdout.trim()
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'scripts', script), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error !== undefined) throw result.error
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const woff2 = requirePath('WOFF2_W3C_CORPUS', process.env.WOFF2_W3C_CORPUS)
const graphite2 = requirePath('GRAPHITE2_CORPUS', process.env.GRAPHITE2_CORPUS)
requirePath('GRAPHITE2_HB_SHAPE', process.env.GRAPHITE2_HB_SHAPE)
if (gitRevision(woff2) !== WOFF2_REVISION) throw new Error(`WOFF2 corpus revision must be ${WOFF2_REVISION}`)
if (gitRevision(graphite2) !== GRAPHITE2_REVISION) throw new Error(`Graphite2 corpus revision must be ${GRAPHITE2_REVISION} (Graphite2 1.3.15)`)

run('run-aat-conformance.mjs')
run('run-conformance.mjs', [
  'tests/parsers/woff.test.ts',
  'tests/parsers/woff-metadata.test.ts',
  'tests/parsers/woff-fonttools-oracle.test.ts',
  'tests/parsers/woff2.test.ts',
  'tests/parsers/woff2-collection.test.ts',
  'tests/parsers/woff2-w3c-corpus.test.ts',
  'tests/parsers/woff2-fonttools-oracle.test.ts',
  'tests/graphite-harfbuzz-oracle.test.ts',
  'tests/font-ecosystem-coverage.test.ts',
])
