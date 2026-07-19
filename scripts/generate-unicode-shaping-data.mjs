import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const UNICODE_VERSION = '17.0.0'
const OUTPUT = new URL('../src/shaping/unicode-shaping-data.ts', import.meta.url)
const SOURCES = [
  ['Scripts.txt', 'ucd/Scripts.txt', '9f5e50d3abaee7d6ce09480f325c706f485ae3240912527e651954d2d6b035bf'],
  ['Blocks.txt', 'ucd/Blocks.txt', 'c0edefaf1a19771e830a82735472716af6bf3c3975f6c2a23ffbe2580fbbcb15'],
  ['DerivedJoiningType.txt', 'ucd/extracted/DerivedJoiningType.txt', 'f39ebe974825d6736aee15582250307aa532b2cfab3caf3f86bd23fddc9c5c4d'],
  ['IndicSyllabicCategory.txt', 'ucd/IndicSyllabicCategory.txt', '3fc122f4cf58b0c19268d5f810263b04ab4e1e67743386ec0e0ada9c76aec5be'],
  ['IndicPositionalCategory.txt', 'ucd/IndicPositionalCategory.txt', '68cedc29a7e57f984d90fe2c7712f2e6d0c717e253db219607daea8997d6c480'],
  ['PropertyValueAliases.txt', 'ucd/PropertyValueAliases.txt', '64e9a5f76f7a1e8b5a47d6a1f9a26522a251208f5276bdfa1559dac7cf2e827a'],
  ['DerivedGeneralCategory.txt', 'ucd/extracted/DerivedGeneralCategory.txt', 'd62e5bab70ca74f099343f71224fa051cb1fdd61a1ab45c0488c44cfc0b6102e'],
  ['DerivedCoreProperties.txt', 'ucd/DerivedCoreProperties.txt', '24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08'],
  ['IndicSyllabicCategory-Additional.txt', 'https://raw.githubusercontent.com/harfbuzz/harfbuzz/13.2.1/src/ms-use/IndicSyllabicCategory-Additional.txt', '636691ace687eed883bfb34dc2f5f27833b323bf0c078eec63ee66cbca3bfc85'],
  ['IndicPositionalCategory-Additional.txt', 'https://raw.githubusercontent.com/harfbuzz/harfbuzz/13.2.1/src/ms-use/IndicPositionalCategory-Additional.txt', '59639508464202ec90a7d9e08a08cfbc377ea4536135c418bfdfc0f15db1ac3d'],
]

async function loadSource(name, relativeUrl, expectedHash, directory) {
  const bytes = directory === null
    ? new Uint8Array(await (await fetch(relativeUrl.startsWith('https://')
      ? relativeUrl
      : `https://www.unicode.org/Public/${UNICODE_VERSION}/${relativeUrl}`)).arrayBuffer())
    : new Uint8Array(await readFile(join(directory, name)))
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== expectedHash) throw new Error(`${name} SHA-256 mismatch: ${actualHash}`)
  return new TextDecoder().decode(bytes)
}

function parseRanges(text) {
  const ranges = []
  for (const sourceLine of text.split(/\r?\n/u)) {
    const line = sourceLine.replace(/#.*/u, '').trim()
    if (line === '' || line.startsWith('@missing:')) continue
    const fields = line.split(';').map(field => field.trim())
    if (fields.length < 2) continue
    const bounds = fields[0].split('..')
    const start = Number.parseInt(bounds[0], 16)
    const end = bounds.length === 1 ? start : Number.parseInt(bounds[1], 16)
    ranges.push([start, end, fields[1]])
  }
  ranges.sort((a, b) => a[0] - b[0])
  return ranges
}

function encodeNamedRanges(ranges) {
  const names = []
  const ids = new Map()
  const values = []
  for (const [start, end, name] of ranges) {
    let id = ids.get(name)
    if (id === undefined) {
      id = names.length
      names.push(name)
      ids.set(name, id)
    }
    values.push(start, end, id)
  }
  return { names, values }
}

function formatNames(name, names) {
  return `export const ${name} = ${JSON.stringify(names)} as const\n`
}

function formatRanges(name, values) {
  const rows = []
  for (let i = 0; i < values.length; i += 12) {
    rows.push(`  ${values.slice(i, i + 12).map(value => `0x${value.toString(16).toUpperCase()}`).join(', ')},`)
  }
  return `export const ${name} = new Uint32Array([\n${rows.join('\n')}\n])\n`
}

function rangeValue(codePoint, ranges, fallback) {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const range = ranges[middle]
    if (codePoint < range[0]) high = middle - 1
    else if (codePoint > range[1]) low = middle + 1
    else return range[2]
  }
  return fallback
}

function propertyMap(ranges, acceptedValue = null) {
  const result = new Map()
  for (const [start, end, value] of ranges) {
    if (acceptedValue !== null && value !== acceptedValue) continue
    for (let codePoint = start; codePoint <= end; codePoint++) result.set(codePoint, value)
  }
  return result
}

function buildUseRanges(data) {
  const syllabic = propertyMap(data.syllabic)
  for (const [codePoint, value] of propertyMap(data.additionalSyllabic)) {
    syllabic.set(codePoint, value === 'Consonant_Final_Modifier' ? 'Syllable_Modifier' : value)
  }
  const positional = propertyMap(data.positional)
  for (const [codePoint, value] of propertyMap(data.additionalPositional)) {
    positional.set(codePoint, value === 'NA' ? 'Not_Applicable' : value)
  }
  const joining = propertyMap(data.joining)
  const defaultIgnorable = propertyMap(data.core, 'Default_Ignorable_Code_Point')
  const codePoints = new Set([...syllabic.keys(), ...positional.keys(), ...joining.keys(), ...defaultIgnorable.keys()])
  const disabledScripts = new Set(['Arabic', 'Lao', 'Samaritan', 'Syriac', 'Thai'])
  const categories = new Map()

  function classify(codePoint) {
    let isc = syllabic.get(codePoint) ?? 'Other'
    let ipc = positional.get(codePoint) ?? 'Not_Applicable'
    const jt = joining.get(codePoint) ?? 'U'
    const gc = rangeValue(codePoint, data.general, 'Cn')
    const di = defaultIgnorable.has(codePoint)

    if (codePoint >= 0x1CE2 && codePoint <= 0x1CE8) isc = 'Cantillation_Mark'
    if ((codePoint >= 0x0F18 && codePoint <= 0x0F19) || (codePoint >= 0x0F3E && codePoint <= 0x0F3F)) isc = 'Vowel_Dependent'
    if (codePoint === 0x1CED) isc = 'Tone_Mark'
    if (codePoint === 0x11302 || codePoint === 0x11303 || codePoint === 0x114C1) ipc = 'Top'

    const isBase = ['Number', 'Consonant', 'Consonant_Head_Letter', 'Tone_Letter', 'Vowel_Independent'].includes(isc)
      || (['C', 'D', 'L', 'R'].includes(jt) && isc !== 'Joiner')
      || (gc === 'Lo' && ['Avagraha', 'Bindu', 'Consonant_Final', 'Consonant_Medial', 'Consonant_Subjoined', 'Vowel', 'Vowel_Dependent'].includes(isc))
    const isBaseOther = isc === 'Consonant_Placeholder' || [0x2015, 0x2022, 0x25FB, 0x25FC, 0x25FD, 0x25FE].includes(codePoint)
    const isCgj = isc === 'Joiner' || (di && ['Mc', 'Me', 'Mn'].includes(gc))
    const isSymbolModifier = isc === 'Symbol_Modifier'
    const isWordJoiner = (di
      && ![0x115F, 0x1160, 0x3164, 0xFFA0, 0x1BCA0, 0x1BCA1, 0x1BCA2, 0x1BCA3].includes(codePoint)
      && isc === 'Other' && !isCgj) || gc === 'Cn'

    let base
    if (isBase) base = 'B'
    else if (isc === 'Brahmi_Joining_Number') base = 'N'
    else if (isBaseOther) base = 'GB'
    else if (isCgj) base = 'CGJ'
    else if ((isc === 'Consonant_Final' && gc !== 'Lo') || isc === 'Consonant_Succeeding_Repha') base = 'F'
    else if (isc === 'Syllable_Modifier') base = 'FM'
    else if ((isc === 'Consonant_Medial' && gc !== 'Lo') || isc === 'Consonant_Initial_Postfixed') base = 'M'
    else if (['Nukta', 'Gemination_Mark', 'Consonant_Killer'].includes(isc)) base = 'CM'
    else if (isc === 'Consonant_Subjoined' && gc !== 'Lo') base = 'SUB'
    else if (isc === 'Consonant_With_Stacker') base = 'CS'
    else if (isc === 'Virama' && codePoint !== 0x0DCA) base = 'H'
    else if (codePoint === 0x0DCA) base = 'HVM'
    else if (isc === 'Number_Joiner') base = 'HN'
    else if (isc === 'Hieroglyph') base = 'G'
    else if (isc === 'Hieroglyph_Joiner') base = 'J'
    else if (isc === 'Hieroglyph_Mirror') base = 'HR'
    else if (isc === 'Hieroglyph_Modifier') base = 'HM'
    else if (isc === 'Hieroglyph_Mark_Begin' || isc === 'Hieroglyph_Segment_Begin') base = 'SB'
    else if (isc === 'Hieroglyph_Mark_End' || isc === 'Hieroglyph_Segment_End') base = 'SE'
    else if (isc === 'Invisible_Stacker' && codePoint !== 0x1A60) base = 'IS'
    else if (isc === 'Non_Joiner') base = 'ZWNJ'
    else if ((gc === 'Po' || ['Consonant_Dead', 'Joiner', 'Modifying_Letter', 'Other'].includes(isc))
      && !isBase && !isBaseOther && !isCgj && !isSymbolModifier && !isWordJoiner) base = 'O'
    else if (isc === 'Reordering_Killer') base = 'RK'
    else if (isc === 'Consonant_Preceding_Repha' || isc === 'Consonant_Prefixed') base = 'R'
    else if (codePoint === 0x1A60) base = 'Sk'
    else if (isSymbolModifier) base = 'SM'
    else if (isc === 'Pure_Killer' || (gc !== 'Lo' && (isc === 'Vowel' || isc === 'Vowel_Dependent'))) base = 'V'
    else if (['Tone_Mark', 'Cantillation_Mark', 'Register_Shifter', 'Visarga'].includes(isc) || (gc !== 'Lo' && isc === 'Bindu')) base = 'VM'
    else if (isWordJoiner) base = 'WJ'
    else throw new Error(`No USE class for U+${codePoint.toString(16).toUpperCase()}: ${isc}/${ipc}/${jt}/${gc}`)

    if (base === 'CGJ') {
      if (isc === 'Joiner') return 8
      if ((codePoint >= 0x180B && codePoint <= 0x180D) || codePoint === 0x180F || (codePoint >= 0xFE00 && codePoint <= 0xFE0F)) return 10
      return 9
    }
    const plain = new Map([
      ['O', 0], ['B', 1], ['N', 2], ['GB', 3], ['SUB', 4], ['H', 5], ['HN', 6], ['ZWNJ', 7],
      ['R', 11], ['CS', 12], ['HVM', 13], ['Sk', 14], ['IS', 15], ['WJ', 18],
      ['RK', 43], ['G', 44], ['J', 45], ['SB', 46], ['SE', 47], ['HM', 48], ['HR', 49],
    ])
    const direct = plain.get(base)
    if (direct !== undefined) return direct
    const positions = {
      F: { Top: 20, Bottom: 21, Right: 22 },
      M: { Top: 23, Bottom: 24, Bottom_And_Left: 24, Bottom_And_Right: 24, Right: 25, Left: 26, Top_And_Bottom_And_Left: 26 },
      CM: { Top: 27, Bottom: 28, Overstruck: 28 },
      V: {
        Top: 29, Top_And_Bottom: 29, Top_And_Bottom_And_Right: 29, Top_And_Right: 29,
        Bottom: 30, Overstruck: 30, Bottom_And_Right: 30, Right: 31,
        Left: 32, Top_And_Left: 32, Top_And_Left_And_Right: 32, Left_And_Right: 32,
      },
      VM: { Top: 33, Bottom: 34, Overstruck: 34, Right: 35, Left: 36 },
      SM: { Top: 37, Bottom: 38 },
      FM: { Top: 39, Bottom: 40, Not_Applicable: 41 },
    }
    const result = positions[base]?.[ipc]
    if (result === undefined) throw new Error(`No USE position for U+${codePoint.toString(16).toUpperCase()}: ${base}/${ipc}`)
    return result
  }

  for (const codePoint of [...codePoints].sort((a, b) => a - b)) {
    if (disabledScripts.has(rangeValue(codePoint, data.scripts, 'Unknown'))) continue
    categories.set(codePoint, classify(codePoint))
  }

  const ranges = []
  let start = -1
  let end = -1
  let value = -1
  for (const [codePoint, category] of categories) {
    if (category === 0) continue
    if (codePoint === end + 1 && category === value) {
      end = codePoint
      continue
    }
    if (start >= 0) ranges.push(start, end, value)
    start = codePoint
    end = codePoint
    value = category
  }
  if (start >= 0) ranges.push(start, end, value)
  return ranges
}

const directoryArg = process.argv.indexOf('--ucd-dir')
const directory = directoryArg === -1 ? null : process.argv[directoryArg + 1]
if (directoryArg !== -1 && directory === undefined) throw new Error('--ucd-dir requires a directory')

const loaded = new Map()
for (const source of SOURCES) loaded.set(source[0], await loadSource(...source, directory))

const script = encodeNamedRanges(parseRanges(loaded.get('Scripts.txt')))
const block = encodeNamedRanges(parseRanges(loaded.get('Blocks.txt')))
const joining = encodeNamedRanges(parseRanges(loaded.get('DerivedJoiningType.txt')))
const syllabic = encodeNamedRanges(parseRanges(loaded.get('IndicSyllabicCategory.txt')))
const positional = encodeNamedRanges(parseRanges(loaded.get('IndicPositionalCategory.txt')))
const generalRanges = parseRanges(loaded.get('DerivedGeneralCategory.txt'))
const coreRanges = parseRanges(loaded.get('DerivedCoreProperties.txt'))
const additionalSyllabicRanges = parseRanges(loaded.get('IndicSyllabicCategory-Additional.txt'))
const additionalPositionalRanges = parseRanges(loaded.get('IndicPositionalCategory-Additional.txt'))
const useRanges = buildUseRanges({
  syllabic: parseRanges(loaded.get('IndicSyllabicCategory.txt')),
  positional: parseRanges(loaded.get('IndicPositionalCategory.txt')),
  joining: parseRanges(loaded.get('DerivedJoiningType.txt')),
  general: generalRanges,
  core: coreRanges,
  additionalSyllabic: additionalSyllabicRanges,
  additionalPositional: additionalPositionalRanges,
  scripts: parseRanges(loaded.get('Scripts.txt')),
})
const scriptAliases = new Map()
for (const sourceLine of loaded.get('PropertyValueAliases.txt').split(/\r?\n/u)) {
  const fields = sourceLine.replace(/#.*/u, '').split(';').map(field => field.trim())
  if (fields[0] === 'sc' && fields.length >= 3) scriptAliases.set(fields[2], fields[1])
}
const scriptTags = script.names.map(name => scriptAliases.get(name) ?? 'Zzzz')

const sourceNames = SOURCES.map(source => basename(source[0])).join(', ')
const generated = `/**
 * Generated Unicode ${UNICODE_VERSION} shaping properties. Do not edit by hand.
 * Source files: ${sourceNames}.
 * Regenerate with: node scripts/generate-unicode-shaping-data.mjs
 */

export const UNICODE_SHAPING_DATA_VERSION = '${UNICODE_VERSION}'

${formatNames('UNICODE_SCRIPT_NAMES', script.names)}${formatNames('UNICODE_SCRIPT_TAGS', scriptTags)}${formatRanges('UNICODE_SCRIPT_RANGES', script.values)}
${formatNames('UNICODE_BLOCK_NAMES', block.names)}${formatRanges('UNICODE_BLOCK_RANGES', block.values)}
${formatNames('UNICODE_JOINING_TYPE_NAMES', joining.names)}${formatRanges('UNICODE_JOINING_TYPE_RANGES', joining.values)}
${formatNames('UNICODE_INDIC_SYLLABIC_CATEGORY_NAMES', syllabic.names)}${formatRanges('UNICODE_INDIC_SYLLABIC_CATEGORY_RANGES', syllabic.values)}
${formatNames('UNICODE_INDIC_POSITIONAL_CATEGORY_NAMES', positional.names)}${formatRanges('UNICODE_INDIC_POSITIONAL_CATEGORY_RANGES', positional.values)}
${formatRanges('UNICODE_USE_SHAPING_RANGES', useRanges)}
`

await writeFile(OUTPUT, generated)
