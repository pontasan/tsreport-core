import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'

const ROBOTO_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const NOTO_SANS_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-Regular.ttf')

describe('Font.jstf', () => {
  // Verifies the jstf accessor returns null for Roboto, which has no JSTF table.
  it('Roboto には JSTF テーブルがない → null', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.jstf).toBeNull()
  })

  // Verifies the jstf accessor returns null for NotoSans-Regular, which has no JSTF table.
  it('NotoSans-Regular には JSTF テーブルがない → null', () => {
    const buffer = readFileSync(NOTO_SANS_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.jstf).toBeNull()
  })

  // Verifies the jstf property conforms to the JstfTable | null contract (methods present when non-null).
  it('jstf プロパティの型が JstfTable | null であること', () => {
    const buffer = readFileSync(ROBOTO_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    const jstf = font.jstf
    if (jstf !== null) {
      expect(typeof jstf.getPriorities).toBe('function')
      expect(typeof jstf.getExtenderGlyphs).toBe('function')
    } else {
      expect(jstf).toBeNull()
    }
  })
})
