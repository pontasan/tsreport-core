/**
 * UAX#9 official conformance suites (Unicode 17.0).
 * Runs every case of BidiTest.txt (class sequences × applicable paragraph
 * directions) and BidiCharacterTest.txt (explicit code point sequences)
 * against resolveBidi and requires zero mismatches.
 *
 * Comparison rules per the file headers:
 * - Expected levels marked "x" (characters removed by rule X9) are excluded
 *   from the level comparison and from the visual reorder comparison.
 * - The @Reorder / reorder field lists the visual order of the remaining
 *   (non-"x") input positions.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveBidi } from '../../src/layout/bidi.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const BIDI_TEST = resolve(SCRIPT_DIR, '../fixtures/ucd/BidiTest.txt')
const BIDI_CHARACTER_TEST = resolve(SCRIPT_DIR, '../fixtures/ucd/BidiCharacterTest.txt')
const FULL_CONFORMANCE_TIMEOUT_MS = 30000

// One representative code point per bidi class (all classified accordingly
// by the engine's Unicode tables)
const CLASS_REPRESENTATIVES: Record<string, number> = {
  L: 0x0041, R: 0x05d0, AL: 0x0627, EN: 0x0030, ES: 0x002b, ET: 0x0025,
  AN: 0x0660, CS: 0x002c, NSM: 0x0300, BN: 0x00ad, B: 0x2029, S: 0x0009,
  WS: 0x0020, ON: 0x0021, LRE: 0x202a, RLE: 0x202b, PDF: 0x202c,
  LRO: 0x202d, RLO: 0x202e, LRI: 0x2066, RLI: 0x2067, FSI: 0x2068, PDI: 0x2069,
}

type Expected = {
  /** Expected level per input position; null = "x" (excluded from comparison) */
  levels: (number | null)[]
  /** Visual order of the non-"x" input positions */
  reorder: number[]
}

type Mismatch = { label: string, detail: string }

function checkCase(text: string, direction: 'ltr' | 'rtl' | 'auto', expected: Expected, label: string, mismatches: Mismatch[]): void {
  const result = resolveBidi(text, { direction })
  for (let i = 0; i < expected.levels.length; i++) {
    const want = expected.levels[i]
    if (want === null) continue
    if (result.levels[i] !== want) {
      mismatches.push({ label, detail: `levels[${i}] = ${result.levels[i]} (expected ${want})` })
      return
    }
  }
  // Visual order restricted to the positions the suite keeps
  const kept: number[] = []
  for (let i = 0; i < result.visualOrder.length; i++) {
    const index = result.visualOrder[i]!
    if (expected.levels[index] !== null) kept.push(index)
  }
  if (kept.length !== expected.reorder.length) {
    mismatches.push({ label, detail: `reorder length ${kept.length} (expected ${expected.reorder.length})` })
    return
  }
  for (let i = 0; i < kept.length; i++) {
    if (kept[i] !== expected.reorder[i]) {
      mismatches.push({ label, detail: `reorder [${kept.join(' ')}] (expected [${expected.reorder.join(' ')}])` })
      return
    }
  }
}

function parseExpectedLevels(field: string): (number | null)[] {
  const parts = field.trim().split(/\s+/)
  const levels: (number | null)[] = []
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '') continue
    levels.push(parts[i] === 'x' ? null : parseInt(parts[i]!, 10))
  }
  return levels
}

function parseReorder(field: string): number[] {
  const trimmed = field.trim()
  if (trimmed === '') return []
  return trimmed.split(/\s+/).map(function (value) { return parseInt(value, 10) })
}

function formatMismatches(total: number, mismatches: Mismatch[]): string {
  const samples = mismatches.slice(0, 20).map(function (m) { return `${m.label}: ${m.detail}` })
  return `${mismatches.length}/${total} mismatches\n` + samples.join('\n')
}

describe('UAX#9 official conformance (Unicode 17.0)', () => {
  it.skipIf(!existsSync(BIDI_TEST))('BidiTest.txt: every case matches levels and reorder', () => {
    const lines = readFileSync(BIDI_TEST, 'utf8').split('\n')
    let expectedLevels: (number | null)[] = []
    let expectedReorder: number[] = []
    let total = 0
    const mismatches: Mismatch[] = []
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo]!
      const line = raw.indexOf('#') === -1 ? raw.trim() : raw.substring(0, raw.indexOf('#')).trim()
      if (line === '') continue
      if (line.startsWith('@Levels:')) {
        expectedLevels = parseExpectedLevels(line.substring('@Levels:'.length))
        continue
      }
      if (line.startsWith('@Reorder:')) {
        expectedReorder = parseReorder(line.substring('@Reorder:'.length))
        continue
      }
      if (line.startsWith('@')) continue
      const semicolon = line.indexOf(';')
      const classes = line.substring(0, semicolon).trim().split(/\s+/)
      const bitset = parseInt(line.substring(semicolon + 1).trim(), 10)
      let text = ''
      for (let i = 0; i < classes.length; i++) {
        const codePoint = CLASS_REPRESENTATIVES[classes[i]!]
        if (codePoint === undefined) throw new Error(`Unknown bidi class ${classes[i]} at line ${lineNo + 1}`)
        text += String.fromCodePoint(codePoint)
      }
      const expected: Expected = { levels: expectedLevels, reorder: expectedReorder }
      if ((bitset & 1) !== 0) { total++; checkCase(text, 'auto', expected, `L${lineNo + 1}(auto)`, mismatches) }
      if ((bitset & 2) !== 0) { total++; checkCase(text, 'ltr', expected, `L${lineNo + 1}(ltr)`, mismatches) }
      if ((bitset & 4) !== 0) { total++; checkCase(text, 'rtl', expected, `L${lineNo + 1}(rtl)`, mismatches) }
    }
    // The Unicode 17.0 suite expands to over 770k cases; a sharply lower
    // count means the file was not parsed correctly
    expect(total).toBeGreaterThan(700000)
    expect(mismatches.length, formatMismatches(total, mismatches)).toBe(0)
  }, FULL_CONFORMANCE_TIMEOUT_MS)

  it.skipIf(!existsSync(BIDI_CHARACTER_TEST))('BidiCharacterTest.txt: every case matches levels and reorder', () => {
    const lines = readFileSync(BIDI_CHARACTER_TEST, 'utf8').split('\n')
    let total = 0
    const mismatches: Mismatch[] = []
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo]!
      const line = raw.indexOf('#') === -1 ? raw.trim() : raw.substring(0, raw.indexOf('#')).trim()
      if (line === '') continue
      const fields = line.split(';')
      const codePoints = fields[0]!.trim().split(/\s+/).map(function (hex) { return parseInt(hex, 16) })
      const directionValue = parseInt(fields[1]!.trim(), 10)
      const paragraphLevel = parseInt(fields[2]!.trim(), 10)
      const expected: Expected = { levels: parseExpectedLevels(fields[3]!), reorder: parseReorder(fields[4]!) }
      const direction = directionValue === 0 ? 'ltr' : directionValue === 1 ? 'rtl' : 'auto'
      let text = ''
      for (let i = 0; i < codePoints.length; i++) text += String.fromCodePoint(codePoints[i]!)
      total++
      const label = `L${lineNo + 1}`
      const result = resolveBidi(text, { direction })
      if (result.paragraphLevel !== paragraphLevel) {
        mismatches.push({ label, detail: `paragraphLevel ${result.paragraphLevel} (expected ${paragraphLevel})` })
        continue
      }
      checkCase(text, direction, expected, label, mismatches)
    }
    expect(total).toBeGreaterThan(90000)
    expect(mismatches.length, formatMismatches(total, mismatches)).toBe(0)
  }, FULL_CONFORMANCE_TIMEOUT_MS)
})
