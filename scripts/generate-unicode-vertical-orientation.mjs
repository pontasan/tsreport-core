import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const VERSION = '17.0.0'
const SOURCE = `https://www.unicode.org/Public/${VERSION}/ucd/VerticalOrientation.txt`
const OUTPUT = fileURLToPath(new URL('../src/shaping/unicode-vertical-orientation.ts', import.meta.url))

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`Unable to fetch ${SOURCE}: HTTP ${response.status}`)
const rows = []
for (const line of (await response.text()).split(/\r?\n/)) {
  const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(U|Tu|Tr|R)\b/.exec(line)
  if (match === null || match[3] === 'R') continue
  const start = Number.parseInt(match[1], 16)
  const end = Number.parseInt(match[2] ?? match[1], 16)
  const value = match[3]
  const previous = rows[rows.length - 1]
  if (previous !== undefined && previous[1] + 1 === start && previous[2] === value) previous[1] = end
  else rows.push([start, end, value])
}

const codes = { U: 1, Tu: 2, Tr: 3 }
const values = rows.flatMap(function flatten(row) { return [row[0], row[1], codes[row[2]]] })
const chunks = []
for (let i = 0; i < values.length; i += 18) chunks.push(`  ${values.slice(i, i + 18).join(', ')},`)
const output = `// Generated from Unicode ${VERSION} VerticalOrientation.txt. Do not edit.\n` +
`export type UnicodeVerticalOrientation = 'U' | 'R' | 'Tu' | 'Tr'\n\n` +
`// Triples: inclusive start, inclusive end, U=1/Tu=2/Tr=3. Missing values are R.\n` +
`const RANGES = new Uint32Array([\n${chunks.join('\n')}\n])\n\n` +
`export function getUnicodeVerticalOrientation(codePoint: number): UnicodeVerticalOrientation {\n` +
`  let low = 0\n  let high = RANGES.length / 3 - 1\n` +
`  while (low <= high) {\n    const middle = (low + high) >> 1\n    const offset = middle * 3\n` +
`    const start = RANGES[offset]!\n    const end = RANGES[offset + 1]!\n` +
`    if (codePoint < start) high = middle - 1\n    else if (codePoint > end) low = middle + 1\n` +
`    else {\n      const value = RANGES[offset + 2]!\n      return value === 1 ? 'U' : value === 2 ? 'Tu' : 'Tr'\n    }\n` +
`  }\n  return 'R'\n}\n`
await writeFile(OUTPUT, output)
