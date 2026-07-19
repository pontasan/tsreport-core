import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'

const decoTypeNaskh = '/System/Library/Fonts/Supplemental/DecoTypeNaskh.ttc'

describe('Apple malformed AAT font corpus', () => {
  it.runIf(existsSync(decoTypeNaskh))('rejects non-zero just repeated-add flags in both collection faces', () => {
    const bytes = readFileSync(decoTypeNaskh)
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    for (const fontIndex of [0, 1]) {
      expect(() => Font.load(source, { fontIndex }).just).toThrow('just repeated-add action flags must be zero')
    }
  })
})
