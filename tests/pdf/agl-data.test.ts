// Validates the embedded Adobe Glyph List against the official glyphlist.txt
// (AGL 2.0) as an oracle: every entry must be present with the exact Unicode
// value, and the embedded table must contain nothing else.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { aglNameToUnicode } from '../../src/pdf/agl-data.js'

const GLYPHLIST_PATH = resolve(__dirname, '../fixtures/glyphlist.txt')

describe('embedded Adobe Glyph List', () => {
  it('matches every entry of the official glyphlist.txt', () => {
    const txt = readFileSync(GLYPHLIST_PATH, 'utf8')
    let entries = 0
    for (const line of txt.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue
      entries++
      const sep = line.indexOf(';')
      const name = line.slice(0, sep)
      let value = ''
      for (const hex of line.slice(sep + 1).trim().split(' ')) value += String.fromCodePoint(parseInt(hex, 16))
      expect(aglNameToUnicode(name), name).toBe(value)
    }
    expect(entries).toBe(4281)
  })

  it('returns undefined for names outside the AGL', () => {
    expect(aglNameToUnicode('doubledanda')).toBeUndefined()
    expect(aglNameToUnicode('somefontprivateglyph')).toBeUndefined()
    expect(aglNameToUnicode('uni0041')).toBeUndefined()
  })
})
