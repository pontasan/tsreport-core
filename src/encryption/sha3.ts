/** FIPS 202 SHA-3 and SHAKE256 implemented without runtime dependencies. */

const MASK_64 = (1n << 64n) - 1n

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
] as const

const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
] as const

function rotateLeft64(value: bigint, amount: number): bigint {
  if (amount === 0) return value
  const shift = BigInt(amount)
  return ((value << shift) | (value >> (64n - shift))) & MASK_64
}

function keccakF1600(state: bigint[]): void {
  const c = new Array<bigint>(5)
  const d = new Array<bigint>(5)
  const b = new Array<bigint>(25)
  for (let round = 0; round < ROUND_CONSTANTS.length; round++) {
    for (let x = 0; x < 5; x++) {
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!
    }
    for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5]! ^ rotateLeft64(c[(x + 1) % 5]!, 1)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) state[x + 5 * y] = (state[x + 5 * y]! ^ d[x]!) & MASK_64
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const destinationX = y
        const destinationY = (2 * x + 3 * y) % 5
        b[destinationX + 5 * destinationY] = rotateLeft64(state[x + 5 * y]!, ROTATION[x + 5 * y]!)
      }
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        state[x + 5 * y] = b[x + 5 * y]! ^ ((~b[(x + 1) % 5 + 5 * y]! & MASK_64) & b[(x + 2) % 5 + 5 * y]!)
      }
    }
    state[0] = state[0]! ^ ROUND_CONSTANTS[round]!
  }
}

function xorBlock(state: bigint[], block: Uint8Array): void {
  for (let offset = 0; offset < block.length; offset += 8) {
    let lane = 0n
    const end = Math.min(offset + 8, block.length)
    for (let i = offset; i < end; i++) lane |= BigInt(block[i]!) << BigInt((i - offset) * 8)
    state[offset >>> 3] = state[offset >>> 3]! ^ lane
  }
}

function sponge(data: Uint8Array, rateBytes: number, suffix: number, outputLength: number): Uint8Array {
  if (!Number.isSafeInteger(outputLength) || outputLength < 0) throw new Error('SHA-3 output length must be a non-negative safe integer')
  const state = new Array<bigint>(25).fill(0n)
  let offset = 0
  while (offset + rateBytes <= data.length) {
    xorBlock(state, data.subarray(offset, offset + rateBytes))
    keccakF1600(state)
    offset += rateBytes
  }
  const finalBlock = new Uint8Array(rateBytes)
  finalBlock.set(data.subarray(offset))
  finalBlock[data.length - offset] = finalBlock[data.length - offset]! ^ suffix
  finalBlock[rateBytes - 1] = finalBlock[rateBytes - 1]! ^ 0x80
  xorBlock(state, finalBlock)
  keccakF1600(state)

  const result = new Uint8Array(outputLength)
  let written = 0
  while (written < outputLength) {
    const blockLength = Math.min(rateBytes, outputLength - written)
    for (let i = 0; i < blockLength; i++) {
      result[written + i] = Number((state[i >>> 3]! >> BigInt((i & 7) * 8)) & 0xffn)
    }
    written += blockLength
    if (written < outputLength) keccakF1600(state)
  }
  return result
}

export function sha3_256(data: Uint8Array): Uint8Array {
  return sponge(data, 136, 0x06, 32)
}

export function sha3_384(data: Uint8Array): Uint8Array {
  return sponge(data, 104, 0x06, 48)
}

export function sha3_512(data: Uint8Array): Uint8Array {
  return sponge(data, 72, 0x06, 64)
}

/** FIPS 202 SHAKE256 with an explicit output length in bytes. */
export function shake256(data: Uint8Array, outputLength: number): Uint8Array {
  return sponge(data, 136, 0x1f, outputLength)
}
