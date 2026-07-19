import { getBrotliStaticDictionary } from '../brotli-decode.js'
import { unpackBrotliTransforms } from '../brotli-transforms.js'
import { type BackwardMatch } from './match.js'

const HASH_BITS = 15
const HASH_MULTIPLIER = 0x1e35a7bd
const BUCKET_COUNT = 1 << HASH_BITS
const INVALID_MATCH = 0x0fffffff
const MAX_MATCH_LENGTH = 37
const TRANSFORM_COUNT = 121
const OFFSETS_BY_LENGTH = new Uint32Array([
  0, 0, 0, 0, 0, 4096, 9216, 21504, 35840, 44032,
  53248, 63488, 74752, 87040, 93696, 100864, 104704, 106752, 108928, 113536,
  115968, 118528, 119872, 121280, 122016,
])
const SIZE_BITS_BY_LENGTH = new Uint8Array([
  0, 0, 0, 0, 10, 10, 11, 11, 10, 10,
  10, 10, 10, 9, 9, 8, 7, 7, 8, 7,
  7, 6, 6, 5, 5,
])

const PREFIX_SUFFIX_BYTES = new Uint8Array(167)
const PREFIX_SUFFIX_OFFSETS = new Uint16Array(51)
const PREFIX_SUFFIX_LENGTHS = new Uint8Array(50)
const TRANSFORM_PREFIXES = new Uint8Array(TRANSFORM_COUNT)
const TRANSFORM_TYPES = new Uint8Array(TRANSFORM_COUNT)
const TRANSFORM_SUFFIXES = new Uint8Array(TRANSFORM_COUNT)
const TRANSFORM_TRIPLETS = new Uint8Array(TRANSFORM_COUNT * 3)
const PREFIX_HAS_TRANSFORMS = new Uint8Array(50)
const TRANSFORMS_BY_PREFIX_AND_INDEXED: number[][] = Array.from({ length: 50 * 12 }, function createTransformGroup() {
  return []
})
const PREFIXES_BY_FIRST_BYTE: number[][] = Array.from({ length: 256 }, function createPrefixGroup() {
  return []
})

function initializeTransforms(): void {
  unpackBrotliTransforms(PREFIX_SUFFIX_BYTES, PREFIX_SUFFIX_OFFSETS, TRANSFORM_TRIPLETS)

  for (let transform = 0; transform < TRANSFORM_COUNT; transform++) {
    const sourceOffset = transform * 3
    const prefix = TRANSFORM_TRIPLETS[sourceOffset]!
    const type = TRANSFORM_TRIPLETS[sourceOffset + 1]!
    const suffix = TRANSFORM_TRIPLETS[sourceOffset + 2]!
    TRANSFORM_PREFIXES[transform] = prefix
    TRANSFORM_TYPES[transform] = type
    TRANSFORM_SUFFIXES[transform] = suffix
    if (type <= 11) {
      PREFIX_HAS_TRANSFORMS[prefix] = 1
      const indexedTransform = type <= 9 ? 0 : type
      TRANSFORMS_BY_PREFIX_AND_INDEXED[prefix * 12 + indexedTransform]!.push(transform)
    }
  }

  for (let prefix = 0; prefix < PREFIX_HAS_TRANSFORMS.length; prefix++) {
    PREFIX_SUFFIX_LENGTHS[prefix] = PREFIX_SUFFIX_OFFSETS[prefix + 1]! - PREFIX_SUFFIX_OFFSETS[prefix]!
    if (PREFIX_HAS_TRANSFORMS[prefix] === 0) continue
    const start = PREFIX_SUFFIX_OFFSETS[prefix]!
    const end = PREFIX_SUFFIX_OFFSETS[prefix + 1]!
    if (start === end) {
      for (let value = 0; value < PREFIXES_BY_FIRST_BYTE.length; value++) {
        PREFIXES_BY_FIRST_BYTE[value]!.push(prefix)
      }
    } else {
      PREFIXES_BY_FIRST_BYTE[PREFIX_SUFFIX_BYTES[start]!]!.push(prefix)
    }
  }
}

initializeTransforms()

interface DictionaryIndex {
  readonly offsets: Uint32Array
  readonly words: Uint32Array
}

export interface StaticDictionaryMatcher {
  readonly dictionary: Uint8Array
  readonly index: DictionaryIndex
  readonly matchCodes: Uint32Array
}

let dictionaryIndex: DictionaryIndex | undefined

function transformedByte(dictionary: Uint8Array, offset: number, index: number, transform: number): number {
  const value = dictionary[offset + index]!
  if (transform === 10) return index === 0 ? value ^ 32 : value
  if (transform === 11 && value >= 97 && value <= 122) return value ^ 32
  return value
}

function dictionaryHash(dictionary: Uint8Array, offset: number, transform: number): number {
  const value =
    (transformedByte(dictionary, offset, 3, transform) << 24) |
    (transformedByte(dictionary, offset, 2, transform) << 16) |
    (transformedByte(dictionary, offset, 1, transform) << 8) |
    transformedByte(dictionary, offset, 0, transform)
  return ((value * HASH_MULTIPLIER) >>> 0) >>> (32 - HASH_BITS)
}

function dataHash(data: Uint8Array, position: number): number {
  const value =
    (data[position + 3]! << 24) |
    (data[position + 2]! << 16) |
    (data[position + 1]! << 8) |
    data[position]!
  return ((value * HASH_MULTIPLIER) >>> 0) >>> (32 - HASH_BITS)
}

function createDictionaryCandidates(dictionary: Uint8Array): { keys: Uint32Array; words: Uint32Array } {
  let capacity = 0
  for (let length = 4; length <= 24; length++) {
    capacity += 3 * (1 << SIZE_BITS_BY_LENGTH[length]!)
  }
  const keys = new Uint32Array(capacity)
  const words = new Uint32Array(capacity)
  let count = 0
  for (let length = 4; length <= 24; length++) {
    const wordCount = 1 << SIZE_BITS_BY_LENGTH[length]!
    const baseOffset = OFFSETS_BY_LENGTH[length]!
    for (let id = 0; id < wordCount; id++) {
      const offset = baseOffset + length * id
      keys[count] = dictionaryHash(dictionary, offset, 0)
      words[count++] = (id << 9) | length

      const first = dictionary[offset]!
      if (first >= 97 && first <= 122) {
        keys[count] = dictionaryHash(dictionary, offset, 10)
        words[count++] = (id << 9) | (10 << 5) | length
      }

      let hasLowercase = false
      for (let index = 0; index < length; index++) {
        const value = dictionary[offset + index]!
        if (value >= 97 && value <= 122) {
          hasLowercase = true
          break
        }
      }
      if (hasLowercase) {
        keys[count] = dictionaryHash(dictionary, offset, 11)
        words[count++] = (id << 9) | (11 << 5) | length
      }
    }
  }
  return { keys: keys.subarray(0, count), words: words.subarray(0, count) }
}

function getDictionaryIndex(): DictionaryIndex {
  if (dictionaryIndex !== undefined) return dictionaryIndex

  const dictionary = getBrotliStaticDictionary()
  const candidates = createDictionaryCandidates(dictionary)
  const counts = new Uint32Array(BUCKET_COUNT)
  for (let candidate = 0; candidate < candidates.keys.length; candidate++) {
    const key = candidates.keys[candidate]!
    counts[key] = counts[key]! + 1
  }

  const offsets = new Uint32Array(BUCKET_COUNT + 1)
  for (let key = 0; key < BUCKET_COUNT; key++) offsets[key + 1] = offsets[key]! + counts[key]!
  const positions = offsets.slice(0, BUCKET_COUNT)
  const words = new Uint32Array(candidates.words.length)
  for (let candidate = 0; candidate < candidates.keys.length; candidate++) {
    const key = candidates.keys[candidate]!
    const position = positions[key]!
    words[position] = candidates.words[candidate]!
    positions[key] = position + 1
  }

  dictionaryIndex = { offsets, words }
  return dictionaryIndex
}

export function createStaticDictionaryMatcher(): StaticDictionaryMatcher {
  return {
    dictionary: getBrotliStaticDictionary(),
    index: getDictionaryIndex(),
    matchCodes: new Uint32Array(MAX_MATCH_LENGTH + 1),
  }
}

function addMatch(matches: Uint32Array, distance: number, length: number, lengthCode: number): void {
  if (length >= matches.length) return
  matches[length] = Math.min(matches[length]!, distance * 32 + lengthCode)
}

function matchesAffix(data: Uint8Array, position: number, affix: number): boolean {
  const start = PREFIX_SUFFIX_OFFSETS[affix]!
  const length = PREFIX_SUFFIX_LENGTHS[affix]!
  const end = start + length
  if (position + length > data.length) return false
  for (let index = start; index < end; index++) {
    if (data[position + index - start] !== PREFIX_SUFFIX_BYTES[index]) return false
  }
  return true
}

function isTransformedMatch(
  dictionary: Uint8Array,
  dictionaryOffset: number,
  data: Uint8Array,
  dataOffset: number,
  length: number,
  transform: number,
): boolean {
  if (transform === 0) {
    for (let index = 0; index < length; index++) {
      if (dictionary[dictionaryOffset + index] !== data[dataOffset + index]) return false
    }
    return true
  }
  if (transform === 10) {
    if ((dictionary[dictionaryOffset]! ^ 32) !== data[dataOffset]) return false
    for (let index = 1; index < length; index++) {
      if (dictionary[dictionaryOffset + index] !== data[dataOffset + index]) return false
    }
    return true
  }
  for (let index = 0; index < length; index++) {
    const value = dictionary[dictionaryOffset + index]!
    const transformed = value >= 97 && value <= 122 ? value ^ 32 : value
    if (transformed !== data[dataOffset + index]) return false
  }
  return true
}

/** Appends all static-dictionary references whose transformed output extends the current match. */
export function appendAllStaticDictionaryMatches(
  data: Uint8Array,
  position: number,
  minLength: number,
  maxLength: number,
  maxBackward: number,
  matcher: StaticDictionaryMatcher,
  result: BackwardMatch[],
): void {
  const dictionary = matcher.dictionary
  const index = matcher.index
  const matchCodes = matcher.matchCodes
  matchCodes.fill(INVALID_MATCH)

  const candidatePrefixes = PREFIXES_BY_FIRST_BYTE[data[position]!]!
  for (let prefixIndex = 0; prefixIndex < candidatePrefixes.length; prefixIndex++) {
    const prefix = candidatePrefixes[prefixIndex]!
    if (!matchesAffix(data, position, prefix)) continue
    const prefixLength = PREFIX_SUFFIX_LENGTHS[prefix]!
    const corePosition = position + prefixLength
    if (corePosition + 4 > data.length) continue
    const key = dataHash(data, corePosition)

    for (let candidate = index.offsets[key]!; candidate < index.offsets[key + 1]!; candidate++) {
      const packed = index.words[candidate]!
      const wordLength = packed & 31
      const indexedTransform = (packed >>> 5) & 15
      const id = packed >>> 9
      const dictionaryOffset = OFFSETS_BY_LENGTH[wordLength]! + wordLength * id
      const wordsOfLength = 1 << SIZE_BITS_BY_LENGTH[wordLength]!
      const transforms = TRANSFORMS_BY_PREFIX_AND_INDEXED[prefix * 12 + indexedTransform]!

      for (let transformIndex = 0; transformIndex < transforms.length; transformIndex++) {
        const transform = transforms[transformIndex]!
        const transformType = TRANSFORM_TYPES[transform]!
        const omitted = transformType <= 9 ? transformType : 0
        const coreLength = wordLength - omitted
        if (coreLength < 4) continue
        const suffix = TRANSFORM_SUFFIXES[transform]!
        const resultLength = prefixLength + coreLength + PREFIX_SUFFIX_LENGTHS[suffix]!
        if (resultLength < minLength || resultLength > maxLength) continue
        if (!isTransformedMatch(dictionary, dictionaryOffset, data, corePosition, coreLength, indexedTransform)) continue
        if (!matchesAffix(data, corePosition + coreLength, suffix)) continue

        addMatch(matchCodes, id + transform * wordsOfLength, resultLength, wordLength)
      }
    }
  }

  for (let length = Math.max(4, minLength); length <= Math.min(MAX_MATCH_LENGTH, maxLength); length++) {
    const code = matchCodes[length]!
    if (code < INVALID_MATCH) {
      const lengthCode = code & 31
      result.push({
        distance: maxBackward + (code >>> 5) + 1,
        length,
        lenCodeDelta: lengthCode - length,
        score: 0,
      })
    }
  }
}
