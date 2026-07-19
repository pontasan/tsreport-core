import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canBreakGraphemeAt, graphemeBreaks, graphemeClusters } from '../../src/layout/grapheme-break.js'

function boundaries(text: string): boolean[] {
  const chars = [...text]
  const result: boolean[] = []
  for (let i = 1; i < chars.length; i++) result.push(canBreakGraphemeAt(chars, i))
  return result
}

describe('UAX#29 grapheme cluster boundaries', () => {
  it('keeps combining marks with their base', () => {
    expect(graphemeClusters('a\u0301b')).toEqual(['a\u0301', 'b'])
    expect(boundaries('a\u0301b')).toEqual([false, true])
  })

  it('keeps Hangul jamo syllable sequences together', () => {
    expect(graphemeClusters('\u1100\u1161\u11A8')).toEqual(['\u1100\u1161\u11A8'])
  })

  it('keeps emoji ZWJ sequences and modifier sequences together', () => {
    expect(graphemeClusters('👩‍💻👍🏽')).toEqual(['👩‍💻', '👍🏽'])
  })

  it('groups regional indicators in pairs', () => {
    expect(graphemeClusters('🇯🇵🇺🇸🇫')).toEqual(['🇯🇵', '🇺🇸', '🇫'])
  })

  it('keeps Indic conjunct clusters together', () => {
    expect(graphemeClusters('\u0915\u094D\u0937')).toEqual(['\u0915\u094D\u0937'])
  })

  it('matches every Unicode 17.0 GraphemeBreakTest.txt case', () => {
    const source = readFileSync(resolve(__dirname, '../fixtures/ucd/GraphemeBreakTest.txt'), 'utf8')
    let caseIndex = 0
    for (const sourceLine of source.split(/\r?\n/u)) {
      const line = sourceLine.replace(/#.*/u, '').trim()
      if (line === '') continue
      const tokens = line.split(/\s+/u)
      const codePoints: number[] = []
      const expected = [0]
      for (let i = 1; i < tokens.length; i += 2) {
        codePoints.push(Number.parseInt(tokens[i]!, 16))
        if (tokens[i + 1] === '÷') expected.push(codePoints.length)
      }
      const text = String.fromCodePoint(...codePoints)
      expect(graphemeBreaks(text), `GraphemeBreakTest case ${caseIndex + 1}`).toEqual(expected)
      caseIndex++
    }
    expect(caseIndex).toBeGreaterThan(0)
  })
})
