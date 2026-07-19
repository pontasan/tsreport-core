import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const UNICODE_VERSION = '17.0.0'
const OUTPUT = new URL('../src/layout/unicode-normalization-data.ts', import.meta.url)
const SOURCES = [
  ['UnicodeData.txt', '2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c'],
  ['DerivedNormalizationProps.txt', '71fd6a206a2c0cdd41feb6b7f656aa31091db45e9cedc926985d718397f9e488'],
]

async function loadSource(name, expectedHash, directory) {
  const bytes = directory === null
    ? new Uint8Array(await (await fetch(`https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/${name}`)).arrayBuffer())
    : new Uint8Array(await readFile(join(directory, name)))
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== expectedHash) throw new Error(`${name} SHA-256 mismatch: ${actualHash}`)
  return new TextDecoder().decode(bytes)
}

function parseCodePointRange(field) {
  const bounds = field.split('..')
  const start = Number.parseInt(bounds[0], 16)
  return [start, bounds.length === 1 ? start : Number.parseInt(bounds[1], 16)]
}

function formatUint32(name, values) {
  const rows = []
  for (let i = 0; i < values.length; i += 12) {
    rows.push(`  ${values.slice(i, i + 12).map(value => `0x${value.toString(16).toUpperCase()}`).join(', ')},`)
  }
  return `export const ${name} = new Uint32Array([\n${rows.join('\n')}\n])\n`
}

const directory = process.argv[2] ?? null
const unicodeData = await loadSource(SOURCES[0][0], SOURCES[0][1], directory)
const derivedNormalization = await loadSource(SOURCES[1][0], SOURCES[1][1], directory)
const fullCompositionExclusions = new Set()
for (const sourceLine of derivedNormalization.split(/\r?\n/u)) {
  const line = sourceLine.replace(/#.*/u, '').trim()
  if (line === '') continue
  const fields = line.split(';').map(field => field.trim())
  if (fields[1] !== 'Full_Composition_Exclusion') continue
  const [start, end] = parseCodePointRange(fields[0])
  for (let cp = start; cp <= end; cp++) fullCompositionExclusions.add(cp)
}

const decompositions = []
const compositions = []
for (const line of unicodeData.split(/\r?\n/u)) {
  if (line === '') continue
  const fields = line.split(';')
  const cp = Number.parseInt(fields[0], 16)
  const raw = fields[5]
  if (raw === '') continue
  const compatibility = raw.startsWith('<')
  const sequence = raw.replace(/^<[^>]+>\s*/u, '').split(' ').map(value => Number.parseInt(value, 16))
  decompositions.push({ cp, compatibility, sequence })
  if (!compatibility && sequence.length === 2 && !fullCompositionExclusions.has(cp)) {
    compositions.push([sequence[0], sequence[1], cp])
  }
}
decompositions.sort((a, b) => a.cp - b.cp)
compositions.sort((a, b) => a[0] - b[0] || a[1] - b[1])

const keys = []
const offsets = [0]
const values = []
const compatibility = []
for (const entry of decompositions) {
  keys.push(entry.cp)
  values.push(...entry.sequence)
  offsets.push(values.length)
  compatibility.push(entry.compatibility ? 1 : 0)
}
const compositionValues = compositions.flat()
const output = `/**\n * Generated Unicode normalization data (Unicode ${UNICODE_VERSION}). Do not edit by hand.\n * Sources: UnicodeData.txt and DerivedNormalizationProps.txt.\n * Regenerate with: node scripts/generate-unicode-normalization-data.mjs\n */\n\n`
  + formatUint32('NORMALIZATION_DECOMPOSITION_KEYS', keys) + '\n'
  + formatUint32('NORMALIZATION_DECOMPOSITION_OFFSETS', offsets) + '\n'
  + formatUint32('NORMALIZATION_DECOMPOSITION_VALUES', values) + '\n'
  + `export const NORMALIZATION_DECOMPOSITION_COMPATIBILITY = new Uint8Array([${compatibility.join(',')}])\n\n`
  + formatUint32('NORMALIZATION_COMPOSITIONS', compositionValues)
await writeFile(OUTPUT, output)
