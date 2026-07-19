/**
  * Test font download and generation script.
  * Called from vitest globalSetup.
  * A. General test fonts downloaded directly from URLs.
  * B. Cross-format test fonts generated as WOFF and WOFF2 from Roboto TTF.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { deflateSync } from 'node:zlib'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { fileURLToPath } from 'node:url'
import { brotliCompress } from '../src/compression/brotli.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const FONTS_DIR = resolve(SCRIPT_DIR, 'fixtures/fonts')

// HarfBuzz 13.2.1 test fonts are pinned by commit. They are oracle inputs only;
// the library and its tests never load or link HarfBuzz at runtime.
const HARFBUZZ_REVISION = '907579859f604633ad511f2f49fa0299d799d9b8'
const HARFBUZZ_SHAPE_DATA = `https://raw.githubusercontent.com/harfbuzz/harfbuzz/${HARFBUZZ_REVISION}/test/shape/data`
const AOTS_ORACLE_FONTS = [
  'gsub1_1_simple_f1.otf',
  'gsub1_2_simple_f1.otf',
  'gsub2_1_simple_f1.otf',
  'gsub3_1_simple_f1.otf',
  'gsub4_1_multiple_ligatures_f2.otf',
  'gsub_context1_successive_f1.otf',
  'gsub_context2_successive_f1.otf',
  'gsub_context3_successive_f1.otf',
  'gsub_chaining1_successive_f1.otf',
  'gsub_chaining2_successive_f1.otf',
  'gsub_chaining3_successive_f1.otf',
  'gsub7_font1.otf',
  'gpos1_1_simple_f1.otf',
  'gpos1_2_font1.otf',
  'gpos2_1_simple_f1.otf',
  'gpos2_2_font1.otf',
  'gpos3_font1.otf',
  'gpos4_simple_1.otf',
  'gpos5_font1.otf',
  'gpos6_font1.otf',
  'gpos_context1_successive_f1.otf',
  'gpos_context2_successive_f1.otf',
  'gpos_context3_successive_f1.otf',
  'gpos_chaining1_successive_f1.otf',
  'gpos_chaining2_successive_f1.otf',
  'gpos_chaining3_successive_f1.otf',
  'gpos9_font1.otf',
  'lookupflag_ignore_base_f1.otf',
  'lookupflag_ignore_ligatures_f1.otf',
  'lookupflag_ignore_marks_f1.otf',
  'lookupflag_ignore_attach_f1.otf',
  'lookupflag_ignore_combination_f1.otf',
] as const

const HARFBUZZ_ORACLE_DOWNLOADS: { file: string; url: string }[] = AOTS_ORACLE_FONTS.map(file => ({
  file: `hb-aots-${file}`,
  url: `${HARFBUZZ_SHAPE_DATA}/aots/fonts/${file}`,
}))
HARFBUZZ_ORACLE_DOWNLOADS.push(
  {
    file: 'hb-reverse-substitution.ttf',
    url: `${HARFBUZZ_SHAPE_DATA}/in-house/fonts/a706511c65fb278fda87eaf2180ca6684a80f423.ttf`,
  },
  {
    file: 'hb-mark-filtering-set.ttf',
    url: `${HARFBUZZ_SHAPE_DATA}/text-rendering-tests/fonts/TestGPOSFour.ttf`,
  },
  {
    file: 'hb-cursive-right-to-left.ttf',
    url: `${HARFBUZZ_SHAPE_DATA}/text-rendering-tests/fonts/TestShapeAran.ttf`,
  },
  {
    file: 'hb-feature-variations.otf',
    url: `${HARFBUZZ_SHAPE_DATA}/text-rendering-tests/fonts/AdobeVFPrototype-Subset.otf`,
  },
)

// A. Download targets.


const DOWNLOADS: { file: string; url: string }[] = [
  {
    file: 'Roboto-Regular.ttf',
    url: 'https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Regular.ttf',
  },
  {
    file: 'SourceSans3-Regular.otf',
    url: 'https://raw.githubusercontent.com/adobe-fonts/source-sans/release/OTF/SourceSans3-Regular.otf',
  },
  {
    file: 'NotoSans-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf',
  },
  {
    file: 'NotoSansJP-Regular.otf',
    url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf',
  },
  {
    // Google Fonts variable Roboto: GPOS PairPos format 1 with VariationIndex
    // device tables in pair sets (regression coverage for device table bases)
    file: 'Roboto-VariableFont.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf',
  },
  {
    file: 'NotoSans-VariableFont_wdth,wght.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/full/variable-ttf/NotoSans%5Bwdth%2Cwght%5D.ttf',
  },
  {
    file: 'NotoSansArabic-Regular.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf',
  },
  {
    file: 'FiraMath-Regular.otf',
    url: 'https://github.com/firamath/FiraMath/releases/download/v0.3.4/FiraMath-Regular.otf',
  },
  {
    // v2.13 b171 — later commits removed static OTFs from the repository, so pin the commit.
    file: 'STIXTwoMath-Regular.otf',
    url: 'https://raw.githubusercontent.com/stipub/stixfonts/744a22a4dd626cd14d75728aef34fc8ad7c85db0/fonts/static_otf/STIXTwoMath-Regular.otf',
  },
  ...HARFBUZZ_ORACLE_DOWNLOADS,
]

// --- WOFF2 Known tags (spec table, KNOWN_TAGS[index] → tag) ---

const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

// ============================================================
// vitest globalSetup entrypoint.
// ============================================================

export async function setup(): Promise<void> {
  mkdirSync(FONTS_DIR, { recursive: true })
  await ensureDownloads()
  ensureCrossFormatFonts()
}

// ============================================================
// A: download general fonts.
// ============================================================

async function ensureDownloads(): Promise<void> {
  const tasks: Promise<void>[] = []
  for (const { file, url } of DOWNLOADS) {
    const dest = resolve(FONTS_DIR, file)
    if (existsSync(dest)) continue
    console.log(`[download-test-fonts] Downloading ${file}...`)
    tasks.push(download(url, dest))
  }
  await Promise.all(tasks)
}

// ============================================================
// B: WOFF/WOFF2 generation, dependent on Roboto TTF.

// ============================================================

function ensureCrossFormatFonts(): void {
  const ttfPath = resolve(FONTS_DIR, 'Roboto-Regular.ttf')
  if (!existsSync(ttfPath)) {
    throw new Error('[download-test-fonts] Roboto-Regular.ttf not found — download failed?')
  }
  const ttfData = readFileSync(ttfPath)

  const woffPath = resolve(FONTS_DIR, 'Roboto-Regular.woff')
  if (process.env.REGENERATE_WEBFONT_FIXTURES === '1' || !existsSync(woffPath)) {
    console.log('[download-test-fonts] Generating Roboto-Regular.woff from TTF...')
    generateWoff(ttfData, woffPath)
  }

  const woff2Path = resolve(FONTS_DIR, 'Roboto-Regular.woff2')
  if (process.env.REGENERATE_WEBFONT_FIXTURES === '1' || !existsSync(woff2Path)) {
    console.log('[download-test-fonts] Generating Roboto-Regular.woff2 from TTF...')
    generateWoff2(ttfData, woff2Path)
  }
}

// ============================================================
// HTTP download with redirect support.
// ============================================================

function download(url: string, dest: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects for ${url}`))
  }
  const client = url.startsWith('https:') ? httpsGet : httpGet

  return new Promise<void>((resolve, reject) => {
    client(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Redirect.
        let redirectUrl = res.headers.location
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url)
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`
        }
        res.resume()
        download(redirectUrl, dest, redirectCount + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        writeFileSync(dest, Buffer.concat(chunks))
        console.log(`[download-test-fonts] Saved ${dest.split('/').pop()}`)
        resolve()
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ============================================================
// Parse SFNT (TTF/OTF) tables.
// ============================================================

interface SfntTable {
  tag: string
  checksum: number
  offset: number
  length: number
}

function parseSfntTables(data: Uint8Array): { flavor: number; tables: SfntTable[] } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flavor = view.getUint32(0, false)
  const numTables = view.getUint16(4, false)

  const tables: SfntTable[] = []
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16
    const tag = String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    )
    tables.push({
      tag,
      checksum: view.getUint32(off + 4, false),
      offset: view.getUint32(off + 8, false),
      length: view.getUint32(off + 12, false),
    })
  }

  return { flavor, tables }
}

// ============================================================
// TTF -> WOFF conversion.

// ============================================================

function generateWoff(ttfData: Uint8Array, outPath: string): void {
  const { flavor, tables } = parseSfntTables(ttfData)
  const numTables = tables.length

  // Compress each table with zlib.
  const compressed: {
    tag: string
    checksum: number
    origLength: number
    data: Uint8Array
  }[] = []

  for (const table of tables) {
    const raw = ttfData.subarray(table.offset, table.offset + table.length)
    const deflated = deflateSync(raw)

    if (deflated.length < raw.length) {
      compressed.push({
        tag: table.tag,
        checksum: table.checksum,
        origLength: table.length,
        data: deflated,
      })
    } else {
      // Store uncompressed when compression is not effective.
      compressed.push({
        tag: table.tag,
        checksum: table.checksum,
        origLength: table.length,
        data: new Uint8Array(raw),
      })
    }
  }

  // totalSfntSize = SFNT header + table directory + table data, 4-byte aligned.
  
  let totalSfntSize = 12 + numTables * 16
  for (const t of tables) {
    totalSfntSize += t.length + ((4 - (t.length % 4)) % 4)
  }

  // Calculate WOFF file size.
  
  const woffHeaderSize = 44
  const woffDirSize = numTables * 20 // WOFF directory entry = 20 bytes
  let woffDataSize = 0
  for (const t of compressed) {
    woffDataSize += t.data.length
    woffDataSize += (4 - (t.data.length % 4)) % 4
  }
  const totalLength = woffHeaderSize + woffDirSize + woffDataSize

  const buf = new ArrayBuffer(totalLength)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let pos = 0

  // --- WOFF Header (44 bytes) ---
  view.setUint32(pos, 0x774F4646, false); pos += 4 // signature "wOFF"
  view.setUint32(pos, flavor, false); pos += 4      // flavor
  view.setUint32(pos, totalLength, false); pos += 4  // length
  view.setUint16(pos, numTables, false); pos += 2    // numTables
  view.setUint16(pos, 0, false); pos += 2            // reserved
  view.setUint32(pos, totalSfntSize, false); pos += 4 // totalSfntSize
  view.setUint16(pos, 1, false); pos += 2            // majorVersion
  view.setUint16(pos, 0, false); pos += 2            // minorVersion
  view.setUint32(pos, 0, false); pos += 4            // metaOffset
  view.setUint32(pos, 0, false); pos += 4            // metaLength
  view.setUint32(pos, 0, false); pos += 4            // metaOrigLength
  view.setUint32(pos, 0, false); pos += 4            // privOffset
  view.setUint32(pos, 0, false); pos += 4            // privLength

  // --- Table Directory (20 bytes × numTables) ---
  let dataOffset = woffHeaderSize + woffDirSize
  for (const t of compressed) {
    // tag (4 bytes)
    for (let i = 0; i < 4; i++) {
      view.setUint8(pos + i, t.tag.charCodeAt(i))
    }
    pos += 4
    view.setUint32(pos, dataOffset, false); pos += 4       // offset
    view.setUint32(pos, t.data.length, false); pos += 4    // compLength
    view.setUint32(pos, t.origLength, false); pos += 4     // origLength
    view.setUint32(pos, t.checksum, false); pos += 4       // origChecksum

    dataOffset += t.data.length + ((4 - (t.data.length % 4)) % 4)
  }

  // --- Table Data ---
  for (const t of compressed) {
    bytes.set(t.data, pos)
    pos += t.data.length
    pos += (4 - (pos % 4)) % 4 // pad to 4-byte boundary (zeros from ArrayBuffer)
  }

  writeFileSync(outPath, Buffer.from(buf))
}

// ============================================================
// TTF -> WOFF2 conversion, transformVersion=3 for glyf/loca and 0 for others.

// ============================================================

function encodeUIntBase128(value: number): number[] {
  if (value === 0) return [0]
  const result: number[] = []
  let v = value
  while (v > 0) {
    result.unshift(v & 0x7F)
    v >>>= 7
  }
  // Set the continuation bit except on the last byte.
  for (let i = 0; i < result.length - 1; i++) {
    result[i]! |= 0x80
  }
  return result
}

function generateWoff2(ttfData: Uint8Array, outPath: string): void {
  const { flavor, tables } = parseSfntTables(ttfData)
  const numTables = tables.length

  // Build the variable-length table directory as bytes.
  
  const dirBytes: number[] = []
  for (const table of tables) {
    const tagIndex = WOFF2_KNOWN_TAGS.indexOf(table.tag)
    // glyf/loca use transformVersion=3 for null transform; others use 0.
    
    const transformVersion = (table.tag === 'glyf' || table.tag === 'loca') ? 3 : 0

    const flags = (transformVersion << 6) | (tagIndex >= 0 ? tagIndex : 63)
    dirBytes.push(flags)

    // For unknown tags, append the 4-byte tag.
    if (tagIndex < 0) {
      for (let i = 0; i < 4; i++) {
        dirBytes.push(table.tag.charCodeAt(i))
      }
    }

    // origLength (UIntBase128)
    dirBytes.push(...encodeUIntBase128(table.length))

    // A transformLength is present only for a non-null transform. Version 3
    // is the null transform for glyf/loca; version 0 is null for other tables.
    const hasTransformLength = table.tag === 'glyf' || table.tag === 'loca'
      ? transformVersion !== 3
      : transformVersion !== 0
    if (hasTransformLength) {
      // For null transform, transformLength equals origLength.
      
      dirBytes.push(...encodeUIntBase128(table.length))
    }
  }

  // Concatenate table data without padding, then Brotli-compress it.
  
  let totalRawSize = 0
  for (const t of tables) totalRawSize += t.length
  const rawConcat = new Uint8Array(totalRawSize)
  let off = 0
  for (const table of tables) {
    rawConcat.set(ttfData.subarray(table.offset, table.offset + table.length), off)
    off += table.length
  }

  const compressedData = brotliCompress(rawConcat, { quality: 11, mode: 'font' })

  // --- totalSfntSize ---
  let totalSfntSize = 12 + numTables * 16
  for (const t of tables) {
    totalSfntSize += t.length + ((4 - (t.length % 4)) % 4)
  }

  // Build the WOFF2 file.
  
  const woff2HeaderSize = 48
  const totalLength = woff2HeaderSize + dirBytes.length + compressedData.length

  const buf = new ArrayBuffer(totalLength)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let pos = 0

  // --- WOFF2 Header (48 bytes) ---
  view.setUint32(pos, 0x774F4632, false); pos += 4   // signature "wOF2"
  view.setUint32(pos, flavor, false); pos += 4        // flavor
  view.setUint32(pos, totalLength, false); pos += 4    // length
  view.setUint16(pos, numTables, false); pos += 2      // numTables
  view.setUint16(pos, 0, false); pos += 2              // reserved
  view.setUint32(pos, totalSfntSize, false); pos += 4  // totalSfntSize
  view.setUint32(pos, compressedData.length, false); pos += 4 // totalCompressedSize
  view.setUint16(pos, 1, false); pos += 2              // majorVersion
  view.setUint16(pos, 0, false); pos += 2              // minorVersion
  view.setUint32(pos, 0, false); pos += 4              // metaOffset
  view.setUint32(pos, 0, false); pos += 4              // metaLength
  view.setUint32(pos, 0, false); pos += 4              // metaOrigLength
  view.setUint32(pos, 0, false); pos += 4              // privOffset
  view.setUint32(pos, 0, false); pos += 4              // privLength

  // --- Table Directory ---
  bytes.set(dirBytes, pos)
  pos += dirBytes.length

  // --- Compressed Data ---
  bytes.set(compressedData, pos)

  writeFileSync(outPath, Buffer.from(buf))
}
