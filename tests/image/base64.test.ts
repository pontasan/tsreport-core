import { describe, it, expect } from 'vitest'
import { decodeBase64 } from '../../src/image/image-utils.js'

describe('decodeBase64', () => {
  // Verifies a standard base64 string decodes to the expected bytes.
  it('decodes valid base64', () => {
    // "Man" -> "TWFu"
    expect(Array.from(decodeBase64('TWFu'))).toEqual([0x4D, 0x61, 0x6E])
  })

  // Verifies padding is handled and the byte count is correct.
  it('decodes padded base64', () => {
    // "M" -> "TQ=="
    expect(Array.from(decodeBase64('TQ=='))).toEqual([0x4D])
  })

  // Regression: an invalid character (in-range delimiter or code >= 128) used to
  // decode silently as 'A' (0) / 0xFF garbage instead of being rejected.
  it('rejects an invalid in-range character', () => {
    expect(() => decodeBase64('TW*u')).toThrow()
  })

  it('rejects a character code >= 128', () => {
    expect(() => decodeBase64('TWÿu')).toThrow()
  })
})
