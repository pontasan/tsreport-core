import { describe, expect, it } from 'vitest'
import { saslprep } from '../../src/encryption/saslprep.js'

describe('RFC 4013 SASLprep', () => {
  it('matches the RFC mapping and normalization examples', () => {
    expect(saslprep('I\u00ADX')).toBe('IX')
    expect(saslprep('\u00AA')).toBe('a')
    expect(saslprep('\u2168')).toBe('IX')
    expect(saslprep('a\u00A0b')).toBe('a b')
  })

  it('rejects prohibited and Unicode 3.2 unassigned code points', () => {
    expect(() => saslprep('\u0007')).toThrow(/prohibited/)
    expect(() => saslprep('\u0221')).toThrow(/unassigned/)
  })

  it('enforces the RFC 3454 bidirectional-character rule', () => {
    expect(saslprep('\u0627\u0031\u0628')).toBe('\u0627\u0031\u0628')
    expect(() => saslprep('\u0627a\u0628')).toThrow(/bidirectional/)
    expect(() => saslprep('\u0627\u0031')).toThrow(/bidirectional/)
  })
})
