import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { brotliCompress, brotliDecompress } from '../dist/index.js'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(scriptDirectory, '../tests/fixtures/fonts/Roboto-Regular.woff2')
const woff2 = readFileSync(fixturePath)
const view = new DataView(woff2.buffer, woff2.byteOffset, woff2.byteLength)
let position = 48

function readBase128() {
  let result = 0
  for (let index = 0; index < 5; index++) {
    const value = woff2[position++]
    result = result * 128 + (value & 0x7f)
    if ((value & 0x80) === 0) return result
  }
  throw new Error('Invalid UIntBase128 value')
}

for (let index = 0; index < view.getUint16(12, false); index++) {
  const flags = woff2[position++]
  const tag = flags & 0x3f
  if (tag === 63) position += 4
  readBase128()
  const transformVersion = flags >>> 6
  if (tag === 10 || tag === 11 ? transformVersion === 0 : transformVersion !== 0) readBase128()
}

const compressedLength = view.getUint32(20, false)
const originalCompressed = woff2.subarray(position, position + compressedLength)
const source = Uint8Array.from(brotliDecompressSync(originalCompressed))

function median(times) {
  const sorted = times.slice().sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function measureDecode(compressed, expectedSize, mismatchMessage) {
  const implementationTimes = []
  const referenceTimes = []
  for (let iteration = 0; iteration < 7; iteration++) {
    let start = performance.now()
    const referenceDecoded = brotliDecompressSync(compressed)
    referenceTimes.push(performance.now() - start)

    start = performance.now()
    const implementationDecoded = brotliDecompress(compressed, expectedSize)
    implementationTimes.push(performance.now() - start)

    if (!Buffer.from(implementationDecoded).equals(referenceDecoded)) throw new Error(mismatchMessage)
  }
  return {
    implementationTimes,
    referenceTimes,
    implementationMedian: median(implementationTimes),
    referenceMedian: median(referenceTimes),
  }
}

const originalDecode = measureDecode(
  originalCompressed,
  source.length,
  'The TypeScript decoder did not match the reference decoder',
)

const largeSource = new Uint8Array(source.length * 16)
for (let index = 0; index < 16; index++) largeSource.set(source, index * source.length)
const largeCompressed = brotliCompressSync(largeSource, {
  params: {
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
    [constants.BROTLI_PARAM_QUALITY]: 5,
  },
})
const largeDecode = measureDecode(
  largeCompressed,
  largeSource.length,
  'The TypeScript decoder did not match the reference decoder for the large stream',
)
const largeDecodeSpeedRatio = largeDecode.implementationMedian / largeDecode.referenceMedian

const implementationTimes = []
const referenceTimes = []
let implementationEncoded
let referenceEncoded
for (let iteration = 0; iteration < 5; iteration++) {
  let start = performance.now()
  referenceEncoded = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  })
  referenceTimes.push(performance.now() - start)

  start = performance.now()
  implementationEncoded = brotliCompress(source, { quality: 11, mode: 'font' })
  implementationTimes.push(performance.now() - start)

  if (!brotliDecompressSync(implementationEncoded).equals(source)) {
    throw new Error('The reference decoder did not reproduce the WOFF2 source bytes')
  }
  if (!Buffer.from(brotliDecompress(implementationEncoded)).equals(source)) {
    throw new Error('The TypeScript decoder did not reproduce the WOFF2 source bytes')
  }
}

const implementationMedian = median(implementationTimes)
const referenceMedian = median(referenceTimes)
const speedRatio = implementationMedian / referenceMedian
const coldSpeedRatio = implementationTimes[0] / referenceTimes[0]
const sizeRatio = implementationEncoded.length / referenceEncoded.length
const originalSizeRatio = implementationEncoded.length / originalCompressed.length
const decodeSpeedRatio = originalDecode.implementationMedian / originalDecode.referenceMedian

console.log({
  sourceBytes: source.length,
  originalCompressedBytes: originalCompressed.length,
  implementationBytes: implementationEncoded.length,
  referenceBytes: referenceEncoded.length,
  sizeRatio,
  originalSizeRatio,
  implementationTimes,
  referenceTimes,
  implementationMedian,
  referenceMedian,
  speedRatio,
  coldSpeedRatio,
  implementationDecodeTimes: originalDecode.implementationTimes,
  referenceDecodeTimes: originalDecode.referenceTimes,
  implementationDecodeMedian: originalDecode.implementationMedian,
  referenceDecodeMedian: originalDecode.referenceMedian,
  decodeSpeedRatio,
  largeSourceBytes: largeSource.length,
  largeCompressedBytes: largeCompressed.length,
  largeImplementationDecodeTimes: largeDecode.implementationTimes,
  largeReferenceDecodeTimes: largeDecode.referenceTimes,
  largeImplementationDecodeMedian: largeDecode.implementationMedian,
  largeReferenceDecodeMedian: largeDecode.referenceMedian,
  largeDecodeSpeedRatio,
})

if (sizeRatio > 1.02) throw new Error(`Compressed-size ratio ${sizeRatio} exceeded 1.02`)
if (originalSizeRatio > 1.02) throw new Error(`Original-size ratio ${originalSizeRatio} exceeded 1.02`)
if (speedRatio > 1.2) throw new Error(`Median speed ratio ${speedRatio} exceeded 1.2`)
if (coldSpeedRatio > 1.35) throw new Error(`Cold speed ratio ${coldSpeedRatio} exceeded 1.35`)
if (decodeSpeedRatio > 5) throw new Error(`Decode speed ratio ${decodeSpeedRatio} exceeded 5`)
if (largeDecodeSpeedRatio > 5) throw new Error(`Large decode speed ratio ${largeDecodeSpeedRatio} exceeded 5`)
