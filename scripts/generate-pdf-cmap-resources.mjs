import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const EXPECTED_COMMIT = 'f5cf3bca7fdfeaceb77aa82847e974f2306c20b4'
const sourceRoot = resolve(process.argv[2] ?? '')
if (sourceRoot === resolve('')) {
  throw new Error('Usage: node scripts/generate-pdf-cmap-resources.mjs /path/to/adobe-type-tools/cmap-resources')
}
const commit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (commit !== EXPECTED_COMMIT) throw new Error(`Expected cmap-resources commit ${EXPECTED_COMMIT}, got ${commit}`)

const files = walk(sourceRoot).filter(path => path.includes('/CMap/')).sort((a, b) => basename(a).localeCompare(basename(b)))
const names = new Set()
const records = []
for (const path of files) {
  const name = basename(path)
  if (names.has(name)) throw new Error(`Duplicate Adobe CMap resource name ${name}`)
  names.add(name)
  const bytes = readFileSync(path)
  const compressed = deflateRawSync(bytes, { level: 9 })
  records.push({ name, base64: compressed.toString('base64'), source: relative(sourceRoot, path) })
}

const lines = [
  '/**',
  ' * Generated from Adobe CMap Resources. Do not edit manually.',
  ` * Source: https://github.com/adobe-type-tools/cmap-resources/tree/${commit}`,
  ' * License: BSD-3-Clause; see adobe-cmap-LICENSE.txt.',
  ' */',
  "import { inflate } from '../compression/inflate.js'",
  "import { decodeBase64 } from '../image/image-utils.js'",
  '',
  `export const ADOBE_CMAP_RESOURCE_COMMIT = '${commit}'`,
  '',
  'const COMPRESSED_CMAPS: Readonly<Record<string, string>> = Object.freeze({',
]
for (const record of records) lines.push(`  ${JSON.stringify(record.name)}: ${JSON.stringify(record.base64)}, // ${record.source}`)
lines.push(
  '})',
  '',
  'export const ADOBE_CMAP_RESOURCE_NAMES: readonly string[] = Object.freeze(Object.keys(COMPRESSED_CMAPS))',
  'const CACHE = new Map<string, Uint8Array>()',
  '',
  'export function adobeCMapResource(name: string): Uint8Array | null {',
  '  const cached = CACHE.get(name)',
  '  if (cached !== undefined) return cached',
  '  const encoded = COMPRESSED_CMAPS[name]',
  '  if (encoded === undefined) return null',
  '  const decoded = inflate(decodeBase64(encoded))',
  '  CACHE.set(name, decoded)',
  '  return decoded',
  '}',
  '',
)

writeFileSync(resolve('src/pdf/adobe-cmap-resources.ts'), `${lines.join('\n')}\n`)
console.log(`Generated ${records.length} Adobe CMap resources from ${commit}`)

function walk(directory) {
  const result = []
  for (const name of readdirSync(directory)) {
    if (name === '.git') continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) result.push(...walk(path))
    else result.push(path)
  }
  return result
}
