/**
 * UAX#29 official grapheme break conformance suite (Unicode 17.0).
 * Runs every boundary in GraphemeBreakTest.txt against canBreakGraphemeAt and
 * requires zero mismatches.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canBreakGraphemeAt } from '../../src/layout/grapheme-break.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const GRAPHEME_BREAK_TEST = resolve(SCRIPT_DIR, '../fixtures/ucd/GraphemeBreakTest.txt')
const FULL_CONFORMANCE_TIMEOUT_MS = 30000

type Mismatch = { label: string, detail: string }

function formatMismatches(total: number, mismatches: Mismatch[]): string {
  const samples = mismatches.slice(0, 20).map(function (m) { return `${m.label}: ${m.detail}` })
  return `${mismatches.length}/${total} mismatches\n` + samples.join('\n')
}

describe('UAX#29 official grapheme break conformance (Unicode 17.0)', () => {
  it.skipIf(!existsSync(GRAPHEME_BREAK_TEST))('GraphemeBreakTest.txt: every boundary matches', () => {
    const lines = readFileSync(GRAPHEME_BREAK_TEST, 'utf8').split('\n')
    let total = 0
    const mismatches: Mismatch[] = []
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo]!
      const line = raw.indexOf('#') === -1 ? raw.trim() : raw.substring(0, raw.indexOf('#')).trim()
      if (line === '') continue
      const tokens = line.match(/÷|×|[0-9A-Fa-f]+/g)
      if (tokens === null) continue
      const codePoints: number[] = []
      const breaks: boolean[] = []
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!
        if (token === '÷' || token === '×') {
          breaks.push(token === '÷')
        } else {
          codePoints.push(parseInt(token, 16))
        }
      }
      let text = ''
      for (let i = 0; i < codePoints.length; i++) {
        text += String.fromCodePoint(codePoints[i]!)
      }
      const chars = Array.from(text)
      for (let i = 0; i <= chars.length; i++) {
        const expected = breaks[i]!
        const actual = canBreakGraphemeAt(chars, i)
        total++
        if (actual !== expected) {
          const sequence = codePoints.map(function (cp) { return cp.toString(16).toUpperCase().padStart(4, '0') }).join(' ')
          mismatches.push({
            label: `L${lineNo + 1}@${i}`,
            detail: `${actual ? '÷' : '×'} (expected ${expected ? '÷' : '×'}) in [${sequence}]`,
          })
        }
      }
    }
    expect(total).toBeGreaterThan(2500)
    expect(mismatches.length, formatMismatches(total, mismatches)).toBe(0)
  }, FULL_CONFORMANCE_TIMEOUT_MS)
})
