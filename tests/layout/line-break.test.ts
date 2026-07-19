import { describe, expect, it } from 'vitest'
import { canBreakAt } from '../../src/layout/line-break.js'

function boundaries(text: string): boolean[] {
  const chars = [...text]
  const result: boolean[] = []
  for (let i = 1; i < chars.length; i++) result.push(canBreakAt(chars, i))
  return result
}

describe('UAX#14 line breaking', () => {
  it('breaks after spaces but not before spaces', () => {
    expect(boundaries('A B')).toEqual([false, true])
  })

  it('keeps alphabetic words together', () => {
    expect(boundaries('abc')).toEqual([false, false])
  })

  it('allows ideographic breaks and keeps closing punctuation off line starts', () => {
    expect(boundaries('漢字')).toEqual([true])
    expect(boundaries('（漢）')).toEqual([false, false])
  })

  it('keeps combining marks attached to their base sequence', () => {
    expect(boundaries('a\u0301b')).toEqual([false, false])
  })

  it('honors zero-width space and word joiner controls', () => {
    expect(boundaries('a\u200bb')).toEqual([false, true])
    expect(boundaries('a\u2060b')).toEqual([false, false])
  })

  it('keeps numeric expressions intact', () => {
    expect(boundaries('1,234')).toEqual([false, false, false, false])
    expect(boundaries('$100%')).toEqual([false, false, false, false])
  })

  it('keeps Hangul jamo and syllable sequences together', () => {
    expect(boundaries('\u1100\u1161\u11a8')).toEqual([false, false])
    expect(boundaries('\uac00\u11a8')).toEqual([false])
  })

  it('groups regional indicators in pairs', () => {
    expect(boundaries('\ud83c\uddef\ud83c\uddf5\ud83c\uddfa\ud83c\uddf8')).toEqual([false, true, false])
  })

  it('keeps emoji modifier sequences together', () => {
    expect(boundaries('\ud83d\udc4d\ud83c\udffd')).toEqual([false])
  })
})
