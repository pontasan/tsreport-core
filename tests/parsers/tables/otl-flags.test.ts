import { describe, it, expect } from 'vitest'
import { Font } from '../../../src/index.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { GLYPH_FLAG_DEFAULT_IGNORABLE, parseGsub } from '../../../src/parsers/tables/gsub.js'
import { buildCompactGposTable, parseGpos } from '../../../src/parsers/tables/gpos.js'
import { parseGdef } from '../../../src/parsers/tables/gdef.js'
import { buildTestFont, encodeSimpleGlyph } from '../../renderer/synthetic-font.js'

/**
 * Synthetic-binary tests for OpenType Layout lookupFlag processing (GDEF glyph
 * filtering), context/chain-context subtable formats 1 and 2, and nested
 * lookup records of every substitution type.
 */

// --- binary builder helpers ---

class Buf {
  bytes: number[] = []

  u8(v: number): this { this.bytes.push(v & 0xFF); return this }

  u16(v: number): this { this.bytes.push((v >> 8) & 0xFF, v & 0xFF); return this }

  i16(v: number): this { return this.u16(v < 0 ? v + 0x10000 : v) }

  u32(v: number): this {
    this.bytes.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF)
    return this
  }

  tag(t: string): this {
    for (let i = 0; i < 4; i++) this.bytes.push(t.charCodeAt(i))
    return this
  }

  raw(b: Uint8Array): this {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]!)
    return this
  }

  get length(): number { return this.bytes.length }

  /** Patch a previously written uint16 at `at`. */
  patch16(at: number, v: number): void {
    this.bytes[at] = (v >> 8) & 0xFF
    this.bytes[at + 1] = v & 0xFF
  }

  toArrayBuffer(): ArrayBuffer {
    return Uint8Array.from(this.bytes).buffer
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

/** Coverage format 1 */
function coverage(glyphs: number[]): Uint8Array {
  const b = new Buf()
  b.u16(1).u16(glyphs.length)
  for (const g of glyphs) b.u16(g)
  return b.toUint8Array()
}

/** ClassDef format 2 from explicit glyph → class pairs */
function classDef(pairs: [number, number][]): Uint8Array {
  const b = new Buf()
  b.u16(2).u16(pairs.length)
  const sortedPairs = [...pairs].sort((a, b) => a[0] - b[0])
  for (const [g, c] of sortedPairs) b.u16(g).u16(g).u16(c)
  return b.toUint8Array()
}

interface LookupDef {
  type: number
  flag: number
  markFilteringSet?: number
  subtable: Uint8Array
}

/**
 * Build a GSUB or GPOS table: DFLT script, one feature referencing
 * `featureLookups` (default: all lookups), and the given lookup list.
 */
function buildOtl(featureTag: string, lookups: LookupDef[], featureLookups?: number[]): ArrayBuffer {
  const b = new Buf()
  b.u16(1).u16(0) // version 1.0
  const scriptListAt = b.length; b.u16(0)
  const featureListAt = b.length; b.u16(0)
  const lookupListAt = b.length; b.u16(0)

  // ScriptList
  b.patch16(scriptListAt, b.length)
  const scriptListStart = b.length
  b.u16(1) // scriptCount
  b.tag('DFLT')
  b.u16(8) // Script table offset from ScriptList start (2 + 6-byte record)
  // Script table (at scriptListStart + 8)
  b.u16(4) // defaultLangSys offset from Script table start
  b.u16(0) // langSysCount
  // LangSys
  b.u16(0) // lookupOrder
  b.u16(0xFFFF) // requiredFeatureIndex
  b.u16(1) // featureIndexCount
  b.u16(0) // featureIndices[0]

  // FeatureList
  b.patch16(featureListAt, b.length)
  b.u16(1) // featureCount
  b.tag(featureTag)
  b.u16(8) // Feature table offset from FeatureList start
  const refs = featureLookups ?? lookups.map((_, i) => i)
  b.u16(0) // featureParams
  b.u16(refs.length)
  for (const li of refs) b.u16(li)

  // LookupList
  b.patch16(lookupListAt, b.length)
  const lookupListStart = b.length
  b.u16(lookups.length)
  const lookupOffsetAts: number[] = []
  for (let i = 0; i < lookups.length; i++) {
    lookupOffsetAts.push(b.length)
    b.u16(0)
  }
  for (let i = 0; i < lookups.length; i++) {
    const lk = lookups[i]!
    b.patch16(lookupOffsetAts[i]!, b.length - lookupListStart)
    const lookupStart = b.length
    b.u16(lk.type)
    b.u16(lk.flag)
    b.u16(1) // subtableCount
    const subOffAt = b.length; b.u16(0)
    if (lk.flag & 0x0010) b.u16(lk.markFilteringSet ?? 0)
    b.patch16(subOffAt, b.length - lookupStart)
    b.raw(lk.subtable)
  }

  return b.toArrayBuffer()
}

/** GDEF with GlyphClassDef, MarkAttachClassDef and MarkGlyphSets (v1.2) */
function buildGdef(
  glyphClasses: [number, number][],
  markAttachClasses: [number, number][],
  markGlyphSets: number[][],
): ArrayBuffer {
  const b = new Buf()
  b.u16(1).u16(2) // version 1.2
  const glyphClassAt = b.length; b.u16(0)
  b.u16(0) // attachListOffset
  b.u16(0) // ligCaretListOffset
  const markAttachAt = b.length; b.u16(0)
  const markSetsAt = b.length; b.u16(0)

  b.patch16(glyphClassAt, b.length)
  b.raw(classDef(glyphClasses))

  if (markAttachClasses.length > 0) {
    b.patch16(markAttachAt, b.length)
    b.raw(classDef(markAttachClasses))
  }

  if (markGlyphSets.length > 0) {
    b.patch16(markSetsAt, b.length)
    const setsStart = b.length
    b.u16(1) // format
    b.u16(markGlyphSets.length)
    const covOffAts: number[] = []
    for (let i = 0; i < markGlyphSets.length; i++) {
      covOffAts.push(b.length)
      b.u32(0)
    }
    for (let i = 0; i < markGlyphSets.length; i++) {
      const at = covOffAts[i]!
      const off = b.length - setsStart
      b.bytes[at] = (off >>> 24) & 0xFF
      b.bytes[at + 1] = (off >>> 16) & 0xFF
      b.bytes[at + 2] = (off >>> 8) & 0xFF
      b.bytes[at + 3] = off & 0xFF
      b.raw(coverage(markGlyphSets[i]!))
    }
  }

  return b.toArrayBuffer()
}

// --- GSUB subtable builders ---

/** SingleSubst format 2 */
function singleSubst(from: number[], to: number[]): Uint8Array {
  const b = new Buf()
  b.u16(2)
  const covAt = b.length; b.u16(0)
  b.u16(to.length)
  for (const g of to) b.u16(g)
  b.patch16(covAt, b.length)
  b.raw(coverage(from))
  return b.toUint8Array()
}

/** MultipleSubst format 1 (single covered glyph) */
function multipleSubst(from: number, seq: number[]): Uint8Array {
  const b = new Buf()
  b.u16(1)
  const covAt = b.length; b.u16(0)
  b.u16(1) // sequenceCount
  const seqAt = b.length; b.u16(0)
  b.patch16(seqAt, b.length)
  b.u16(seq.length)
  for (const g of seq) b.u16(g)
  b.patch16(covAt, b.length)
  b.raw(coverage([from]))
  return b.toUint8Array()
}

/** LigatureSubst format 1 (single first glyph, single ligature) */
function ligatureSubst(first: number, components: number[], ligGlyph: number): Uint8Array {
  const b = new Buf()
  b.u16(1)
  const covAt = b.length; b.u16(0)
  b.u16(1) // ligatureSetCount
  const setAt = b.length; b.u16(0)
  b.patch16(setAt, b.length)
  const setStart = b.length
  b.u16(1) // ligatureCount
  const ligAt = b.length; b.u16(0)
  b.patch16(ligAt, b.length - setStart)
  b.u16(ligGlyph)
  b.u16(components.length + 1)
  for (const c of components) b.u16(c)
  b.patch16(covAt, b.length)
  b.raw(coverage([first]))
  return b.toUint8Array()
}

interface SubstRecord { sequenceIndex: number, lookupListIndex: number }
interface PosRecord { sequenceIndex: number, lookupListIndex: number }

/** ContextSubst format 1 (single first glyph, single rule) */
function contextSubstFmt1(first: number, inputRest: number[], records: SubstRecord[]): Uint8Array {
  const b = new Buf()
  b.u16(1)
  const covAt = b.length; b.u16(0)
  b.u16(1) // ruleSetCount
  const setAt = b.length; b.u16(0)
  b.patch16(setAt, b.length)
  const setStart = b.length
  b.u16(1) // ruleCount
  const ruleAt = b.length; b.u16(0)
  b.patch16(ruleAt, b.length - setStart)
  b.u16(inputRest.length + 1) // glyphCount
  b.u16(records.length)
  for (const g of inputRest) b.u16(g)
  for (const r of records) b.u16(r.sequenceIndex).u16(r.lookupListIndex)
  b.patch16(covAt, b.length)
  b.raw(coverage([first]))
  return b.toUint8Array()
}

/**
 * ChainContextSubst format 2 (class-based, single rule attached to the class
 * of the first input glyph)
 */
function chainContextSubstFmt2(
  coverageGlyphs: number[],
  backtrackClasses: [number, number][],
  inputClasses: [number, number][],
  lookaheadClasses: [number, number][],
  firstInputClass: number,
  rule: { backtrack: number[], inputRest: number[], lookahead: number[], records: SubstRecord[] },
): Uint8Array {
  const b = new Buf()
  b.u16(2)
  const covAt = b.length; b.u16(0)
  const backDefAt = b.length; b.u16(0)
  const inputDefAt = b.length; b.u16(0)
  const lookDefAt = b.length; b.u16(0)
  const setCount = firstInputClass + 1
  b.u16(setCount)
  const setAts: number[] = []
  for (let i = 0; i < setCount; i++) {
    setAts.push(b.length)
    b.u16(0)
  }
  // Only the target class gets a rule set
  b.patch16(setAts[firstInputClass]!, b.length)
  const setStart = b.length
  b.u16(1) // ruleCount
  const ruleAt = b.length; b.u16(0)
  b.patch16(ruleAt, b.length - setStart)
  b.u16(rule.backtrack.length)
  for (const c of rule.backtrack) b.u16(c)
  b.u16(rule.inputRest.length + 1)
  for (const c of rule.inputRest) b.u16(c)
  b.u16(rule.lookahead.length)
  for (const c of rule.lookahead) b.u16(c)
  b.u16(rule.records.length)
  for (const r of rule.records) b.u16(r.sequenceIndex).u16(r.lookupListIndex)

  b.patch16(covAt, b.length)
  b.raw(coverage(coverageGlyphs))
  b.patch16(backDefAt, b.length)
  b.raw(classDef(backtrackClasses))
  b.patch16(inputDefAt, b.length)
  b.raw(classDef(inputClasses))
  b.patch16(lookDefAt, b.length)
  b.raw(classDef(lookaheadClasses))
  return b.toUint8Array()
}

// --- GPOS subtable builders ---

/** Anchor format 1 */
function anchor(b: Buf, x: number, y: number, point?: number): number {
  const at = b.length
  b.u16(point === undefined ? 1 : 2).i16(x).i16(y)
  if (point !== undefined) b.u16(point)
  return at
}

/** PairPos format 1, valueFormat1 = xAdvance only, optional valueFormat2 */
function pairPos(
  pairsList: { left: number, right: number, xAdv1: number, xAdv2?: number }[],
  withValue2: boolean,
): Uint8Array {
  const lefts = [...new Set(pairsList.map(p => p.left))].sort((a, b2) => a - b2)
  const b = new Buf()
  b.u16(1)
  const covAt = b.length; b.u16(0)
  b.u16(0x0004) // valueFormat1: XAdvance
  b.u16(withValue2 ? 0x0004 : 0)
  b.u16(lefts.length)
  const setAts: number[] = []
  for (let i = 0; i < lefts.length; i++) {
    setAts.push(b.length)
    b.u16(0)
  }
  for (let i = 0; i < lefts.length; i++) {
    b.patch16(setAts[i]!, b.length)
    const mine = pairsList.filter(p => p.left === lefts[i])
    b.u16(mine.length)
    for (const p of mine) {
      b.u16(p.right).i16(p.xAdv1)
      if (withValue2) b.i16(p.xAdv2 ?? 0)
    }
  }
  b.patch16(covAt, b.length)
  b.raw(coverage(lefts))
  return b.toUint8Array()
}

/** ContextPos format 1 (single first glyph, single rule) */
function contextPosFmt1(first: number, inputRest: number[], records: PosRecord[]): Uint8Array {
  const b = new Buf()
  b.u16(1)
  const covAt = b.length; b.u16(0)
  b.u16(1) // ruleSetCount
  const setAt = b.length; b.u16(0)
  b.patch16(setAt, b.length)
  const setStart = b.length
  b.u16(1) // ruleCount
  const ruleAt = b.length; b.u16(0)
  b.patch16(ruleAt, b.length - setStart)
  b.u16(inputRest.length + 1) // glyphCount
  b.u16(records.length)
  for (const g of inputRest) b.u16(g)
  for (const r of records) b.u16(r.sequenceIndex).u16(r.lookupListIndex)
  b.patch16(covAt, b.length)
  b.raw(coverage([first]))
  return b.toUint8Array()
}

/** MarkBasePos format 1: one mark class, explicit anchors */
function markBasePos(
  marks: { glyph: number, x: number, y: number, point?: number }[],
  bases: { glyph: number, x: number, y: number, point?: number }[],
): Uint8Array {
  const b = new Buf()
  b.u16(1)
  const markCovAt = b.length; b.u16(0)
  const baseCovAt = b.length; b.u16(0)
  b.u16(1) // markClassCount
  const markArrAt = b.length; b.u16(0)
  const baseArrAt = b.length; b.u16(0)

  b.patch16(markArrAt, b.length)
  const markArrStart = b.length
  b.u16(marks.length)
  const markAnchorAts: number[] = []
  for (const _m of marks) {
    b.u16(0) // markClass 0
    markAnchorAts.push(b.length)
    b.u16(0)
  }
  for (let i = 0; i < marks.length; i++) {
    b.patch16(markAnchorAts[i]!, b.length - markArrStart)
    anchor(b, marks[i]!.x, marks[i]!.y, marks[i]!.point)
  }

  b.patch16(baseArrAt, b.length)
  const baseArrStart = b.length
  b.u16(bases.length)
  const baseAnchorAts: number[] = []
  for (const _base of bases) {
    baseAnchorAts.push(b.length)
    b.u16(0)
  }
  for (let i = 0; i < bases.length; i++) {
    b.patch16(baseAnchorAts[i]!, b.length - baseArrStart)
    anchor(b, bases[i]!.x, bases[i]!.y, bases[i]!.point)
  }

  b.patch16(markCovAt, b.length)
  b.raw(coverage(marks.map(m => m.glyph)))
  b.patch16(baseCovAt, b.length)
  b.raw(coverage(bases.map(base => base.glyph)))
  return b.toUint8Array()
}

/** MarkMarkPos format 1: one mark class */
function markMarkPos(
  mark1s: { glyph: number, x: number, y: number }[],
  mark2s: { glyph: number, x: number, y: number }[],
): Uint8Array {
  // Identical wire layout to MarkBasePos
  const st = markBasePos(mark1s, mark2s)
  return st
}

/** CursivePos format 1 */
function cursivePos(
  entries: { glyph: number, entry: { x: number, y: number } | null, exit: { x: number, y: number } | null }[],
): Uint8Array {
  const b = new Buf()
  b.u16(1)
  const covAt = b.length; b.u16(0)
  b.u16(entries.length)
  const anchorAts: number[] = []
  for (const _e of entries) {
    anchorAts.push(b.length)
    b.u16(0).u16(0)
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.entry) {
      b.patch16(anchorAts[i]!, b.length)
      anchor(b, e.entry.x, e.entry.y)
    }
    if (e.exit) {
      b.patch16(anchorAts[i]! + 2, b.length)
      anchor(b, e.exit.x, e.exit.y)
    }
  }
  b.patch16(covAt, b.length)
  b.raw(coverage(entries.map(e => e.glyph)))
  return b.toUint8Array()
}

function emptySubtable(): Uint8Array {
  return new Uint8Array([0, 0])
}

function formatOnlySubtable(format: number): Uint8Array {
  return new Uint8Array([(format >> 8) & 0xFF, format & 0xFF])
}

// --- glyph id constants for readability ---

const F = 10, I = 11, FI = 12, A = 20, V = 21, X = 30, Y = 31, Z = 32
const MARK_A = 100, MARK_B = 101 // combining marks
const BASE = 50

function loadGdef(buf: ArrayBuffer, axisCount?: number) {
  return parseGdef(new BinaryReader(buf), axisCount)
}

describe('OTL lookupFlag / GDEF filtering (GSUB)', () => {
  const gdef = loadGdef(buildGdef(
    [[F, 1], [I, 1], [A, 1], [V, 1], [BASE, 1], [FI, 2], [MARK_A, 3], [MARK_B, 3]],
    [[MARK_A, 1], [MARK_B, 2]],
    [[MARK_A]],
  ))

  // A ligature lookup with IgnoreMarks must match components across an
  // intervening mark and keep the mark after the ligature glyph.
  it('LigatureSubst with IgnoreMarks matches across marks and keeps them', () => {
    const table = buildOtl('liga', [
      { type: 4, flag: 0x0008, subtable: ligatureSubst(F, [I], FI) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    const out = gsub.applySubstitutions([F, MARK_A, I], new Set(['liga']), null, null, gdef)
    expect(out).toEqual([FI, MARK_A])
  })

  // Without IgnoreMarks the mark interrupts the component sequence.
  it('LigatureSubst without IgnoreMarks is blocked by marks', () => {
    const table = buildOtl('liga', [
      { type: 4, flag: 0, subtable: ligatureSubst(F, [I], FI) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    const out = gsub.applySubstitutions([F, MARK_A, I], new Set(['liga']), null, null, gdef)
    expect(out).toEqual([F, MARK_A, I])
  })

  // UseMarkFilteringSet: marks NOT in the set are skipped; marks in the set
  // participate in matching (and block a non-matching sequence).
  it('UseMarkFilteringSet skips only marks outside the set', () => {
    const table = buildOtl('liga', [
      { type: 4, flag: 0x0010, markFilteringSet: 0, subtable: ligatureSubst(F, [I], FI) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    // MARK_B is not in set 0 → skipped → ligature forms
    expect(gsub.applySubstitutions([F, MARK_B, I], new Set(['liga']), null, null, gdef))
      .toEqual([FI, MARK_B])
    // MARK_A is in set 0 → not skipped → blocks the ligature
    expect(gsub.applySubstitutions([F, MARK_A, I], new Set(['liga']), null, null, gdef))
      .toEqual([F, MARK_A, I])
  })

  // MarkAttachmentType: only marks of the given attachment class participate;
  // all other marks are skipped.
  it('MarkAttachmentType filter skips marks of other attachment classes', () => {
    const table = buildOtl('liga', [
      // attach type 1 → MARK_A participates, MARK_B skipped
      { type: 4, flag: 0x0100, subtable: ligatureSubst(F, [I], FI) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    expect(gsub.applySubstitutions([F, MARK_B, I], new Set(['liga']), null, null, gdef))
      .toEqual([FI, MARK_B])
    expect(gsub.applySubstitutions([F, MARK_A, I], new Set(['liga']), null, null, gdef))
      .toEqual([F, MARK_A, I])
  })

  // IgnoreMarks on a SingleSubst leaves marks untouched even when covered.
  it('SingleSubst with IgnoreMarks does not substitute marks', () => {
    const table = buildOtl('ccmp', [
      { type: 1, flag: 0x0008, subtable: singleSubst([A, MARK_A], [V, MARK_B]) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    expect(gsub.applySubstitutions([A, MARK_A], new Set(['ccmp']), null, null, gdef))
      .toEqual([V, MARK_A])
  })

  // IgnoreBaseGlyphs skips GDEF class-1 glyphs.
  it('IgnoreBaseGlyphs skips base glyphs during matching', () => {
    const table = buildOtl('liga', [
      // F(base), A(base) between MARK_A and MARK_B are skipped
      { type: 4, flag: 0x0002, subtable: ligatureSubst(MARK_A, [MARK_B], FI) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    expect(gsub.applySubstitutions([MARK_A, F, A, MARK_B], new Set(['liga']), null, null, gdef))
      .toEqual([FI, F, A])
  })
})

describe('OTL context formats 1/2 and nested lookups (GSUB)', () => {
  it('carries default-ignorable provenance to every MultipleSubst output', () => {
    const table = buildOtl('ccmp', [
      { type: 2, flag: 0, subtable: multipleSubst(X, [Y, Z]) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    const result = gsub.applySubstitutionsWithMetadata(
      [X], new Set(['ccmp']), null, null, null, null, null,
      Uint8Array.of(GLYPH_FLAG_DEFAULT_IGNORABLE),
    )

    expect(result.glyphIds).toEqual([Y, Z])
    expect(Array.from(result.flags, flag => flag & GLYPH_FLAG_DEFAULT_IGNORABLE)).toEqual([
      GLYPH_FLAG_DEFAULT_IGNORABLE,
      GLYPH_FLAG_DEFAULT_IGNORABLE,
    ])
  })

  it('carries the first component provenance to a LigatureSubst output', () => {
    const table = buildOtl('liga', [
      { type: 4, flag: 0, subtable: ligatureSubst(F, [I], FI) },
    ])
    const gsub = parseGsub(new BinaryReader(table))
    const leadingIgnorable = gsub.applySubstitutionsWithMetadata(
      [F, I], new Set(['liga']), null, null, null, null, null,
      Uint8Array.of(GLYPH_FLAG_DEFAULT_IGNORABLE, 0),
    )
    const trailingIgnorable = gsub.applySubstitutionsWithMetadata(
      [F, I], new Set(['liga']), null, null, null, null, null,
      Uint8Array.of(0, GLYPH_FLAG_DEFAULT_IGNORABLE),
    )

    expect(Array.from(leadingIgnorable.flags, flag => flag & GLYPH_FLAG_DEFAULT_IGNORABLE))
      .toEqual([GLYPH_FLAG_DEFAULT_IGNORABLE])
    expect(Array.from(trailingIgnorable.flags, flag => flag & GLYPH_FLAG_DEFAULT_IGNORABLE)).toEqual([0])
  })

  it('preserves explicitly substituted default-ignorable outputs in the public shaping path', () => {
    const space = BASE
    const expandingTable = buildOtl('ccmp', [
      { type: 2, flag: 0, subtable: multipleSubst(X, [Y, Z]) },
    ])
    const expandingFont = Font.load(buildTestFont(
      new Array<Uint8Array | null>(BASE + 1).fill(null),
      [[0x2060, X], [0x20, space]],
      [['GSUB', new Uint8Array(expandingTable)]],
    ))
    const expanded = expandingFont.shapeText('\u2060')
    expect(expanded.map(glyph => glyph.glyphId)).toEqual([Y, Z])

    const ligatureTable = buildOtl('liga', [
      { type: 4, flag: 0, subtable: ligatureSubst(F, [I], FI) },
    ])
    const ligatureFont = Font.load(buildTestFont(
      new Array<Uint8Array | null>(BASE + 1).fill(null),
      [[0x2060, F], [0x69, I], [0x20, space]],
      [['GSUB', new Uint8Array(ligatureTable)]],
    ))
    const ligated = ligatureFont.shapeText('\u2060i')
    expect(ligated).toHaveLength(1)
    expect(ligated[0]!.glyphId).toBe(FI)
  })

  it('rejects lookup types outside the GSUB specification range', () => {
    const table = buildOtl('calt', [
      { type: 9, flag: 0, subtable: emptySubtable() },
    ])

    expect(() => parseGsub(new BinaryReader(table))).toThrow(
      'Unsupported GSUB lookup type: 9',
    )
  })

  it('rejects GSUB subtable formats outside each lookup specification', () => {
    const table = buildOtl('calt', [
      { type: 1, flag: 0, subtable: formatOnlySubtable(3) },
    ])

    expect(() => parseGsub(new BinaryReader(table))).toThrow(
      'Unsupported SingleSubst format: 3',
    )
  })

  it('Context format 1 rejects out-of-range nested lookup indices', () => {
    const table = buildOtl('calt', [
      { type: 5, flag: 0, subtable: contextSubstFmt1(X, [Y], [{ sequenceIndex: 1, lookupListIndex: 1 }]) },
    ])

    expect(() => parseGsub(new BinaryReader(table))).toThrow(
      'GSUB contextual lookup index 1 out of LookupList range 1',
    )
  })

  // ContextSubst format 1 with a nested MultipleSubst: X Y → X (Y→Z Z) via a
  // record at sequenceIndex 1; buffer length grows.
  it('Context format 1 applies a nested MultipleSubst', () => {
    const table = buildOtl(
      'calt',
      [
        { type: 5, flag: 0, subtable: contextSubstFmt1(X, [Y], [{ sequenceIndex: 1, lookupListIndex: 1 }]) },
        { type: 2, flag: 0, subtable: multipleSubst(Y, [Z, Z]) },
      ],
      [0],
    )
    const gsub = parseGsub(new BinaryReader(table))
    expect(gsub.applySubstitutions([X, Y], new Set(['calt']), null, null, null))
      .toEqual([X, Z, Z])
  })

  // ContextSubst format 1 with a nested LigatureSubst consuming the first two
  // matched positions. SequenceIndex addresses the evolving match-position
  // array, so record 2 becomes out of range when the array shrinks to length 2.
  it('Context format 1 applies a nested LigatureSubst and shrinks the record domain', () => {
    const table = buildOtl(
      'calt',
      [
        {
          type: 5, flag: 0, subtable: contextSubstFmt1(F, [I, X], [
            { sequenceIndex: 0, lookupListIndex: 1 }, // F I → FI (length -1)
            { sequenceIndex: 2, lookupListIndex: 2 }, // X → Y (position shifted by the ligature)
          ]),
        },
        { type: 4, flag: 0, subtable: ligatureSubst(F, [I], FI) },
        { type: 1, flag: 0, subtable: singleSubst([X], [Y]) },
      ],
      [0],
    )
    const gsub = parseGsub(new BinaryReader(table))
    expect(gsub.applySubstitutions([F, I, X], new Set(['calt']), null, null, null))
      .toEqual([FI, X])
  })

  // ChainContextSubst format 2 (class-based) with backtrack and lookahead
  // classes and a nested SingleSubst.
  it('ChainContext format 2 matches classes and applies a nested lookup', () => {
    const table = buildOtl(
      'calt',
      [
        {
          type: 6, flag: 0, subtable: chainContextSubstFmt2(
            [Y], // coverage: first input glyph
            [[X, 1]], // backtrack classes
            [[Y, 2]], // input classes
            [[Z, 3]], // lookahead classes
            2, // rule set attached to input class 2
            { backtrack: [1], inputRest: [], lookahead: [3], records: [{ sequenceIndex: 0, lookupListIndex: 1 }] },
          ),
        },
        { type: 1, flag: 0, subtable: singleSubst([Y], [A]) },
      ],
      [0],
    )
    const gsub = parseGsub(new BinaryReader(table))
    // X Y Z matches (backtrack X=class1, input Y=class2, lookahead Z=class3)
    expect(gsub.applySubstitutions([X, Y, Z], new Set(['calt']), null, null, null))
      .toEqual([X, A, Z])
    // Without the backtrack context there is no match
    expect(gsub.applySubstitutions([Y, Z], new Set(['calt']), null, null, null))
      .toEqual([Y, Z])
    // Without the lookahead context there is no match
    expect(gsub.applySubstitutions([X, Y], new Set(['calt']), null, null, null))
      .toEqual([X, Y])
  })

  // Chain context matching must skip ignored glyphs in backtrack, input and
  // lookahead when the context lookup carries IgnoreMarks.
  it('ChainContext format 2 with IgnoreMarks skips marks in all sequences', () => {
    const gdef = loadGdef(buildGdef(
      [[X, 1], [Y, 1], [Z, 1], [MARK_A, 3]],
      [],
      [],
    ))
    const table = buildOtl(
      'calt',
      [
        {
          type: 6, flag: 0x0008, subtable: chainContextSubstFmt2(
            [Y],
            [[X, 1]],
            [[Y, 2]],
            [[Z, 3]],
            2,
            { backtrack: [1], inputRest: [], lookahead: [3], records: [{ sequenceIndex: 0, lookupListIndex: 1 }] },
          ),
        },
        { type: 1, flag: 0, subtable: singleSubst([Y], [A]) },
      ],
      [0],
    )
    const gsub = parseGsub(new BinaryReader(table))
    expect(gsub.applySubstitutions([X, MARK_A, Y, MARK_A, Z], new Set(['calt']), null, null, gdef))
      .toEqual([X, MARK_A, A, MARK_A, Z])
  })
})

describe('OTL lookupFlag / GDEF filtering (GPOS)', () => {
  const gdef = loadGdef(buildGdef(
    [[A, 1], [V, 1], [BASE, 1], [MARK_A, 3], [MARK_B, 3]],
    [[MARK_A, 1], [MARK_B, 2]],
    [],
  ))

  it('rejects lookup types outside the GPOS specification range', () => {
    const table = buildOtl('kern', [
      { type: 10, flag: 0, subtable: emptySubtable() },
    ])

    expect(() => parseGpos(new BinaryReader(table))).toThrow(
      'Unsupported GPOS lookup type: 10',
    )
  })

  it('rejects GPOS subtable formats outside each lookup specification', () => {
    const table = buildOtl('kern', [
      { type: 1, flag: 0, subtable: formatOnlySubtable(3) },
    ])

    expect(() => parseGpos(new BinaryReader(table))).toThrow(
      'Unsupported SinglePos format: 3',
    )
  })

  it('Context format 1 rejects out-of-range nested lookup indices', () => {
    const table = buildOtl('kern', [
      { type: 7, flag: 0, subtable: contextPosFmt1(A, [V], [{ sequenceIndex: 1, lookupListIndex: 1 }]) },
    ])

    expect(() => parseGpos(new BinaryReader(table))).toThrow(
      'GPOS contextual lookup index 1 out of LookupList range 1',
    )
  })

  // Kerning must apply across an intervening mark when the pair lookup
  // carries IgnoreMarks.
  it('PairPos with IgnoreMarks kerns across marks', () => {
    const table = buildOtl('kern', [
      { type: 2, flag: 0x0008, subtable: pairPos([{ left: A, right: V, xAdv1: -80 }], false) },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    const adj = gpos.getPositionAdjustments([A, MARK_A, V], null, null, null, null, gdef)
    expect(adj[0]!.xAdvance).toBe(-80)
    expect(adj[1]!.xAdvance).toBe(0)
  })

  // Without IgnoreMarks the mark splits the pair.
  it('PairPos without IgnoreMarks is blocked by marks', () => {
    const table = buildOtl('kern', [
      { type: 2, flag: 0, subtable: pairPos([{ left: A, right: V, xAdv1: -80 }], false) },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    const adj = gpos.getPositionAdjustments([A, MARK_A, V], null, null, null, null, gdef)
    expect(adj[0]!.xAdvance).toBe(0)
  })

  // A pair with a second value record applies it to the second glyph.
  it('PairPos applies value2 to the second glyph', () => {
    const table = buildOtl('kern', [
      { type: 2, flag: 0, subtable: pairPos([{ left: A, right: V, xAdv1: -80, xAdv2: -20 }], true) },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    const adj = gpos.getPositionAdjustments([A, V], null, null, null, null, null)
    expect(adj[0]!.xAdvance).toBe(-80)
    expect(adj[1]!.xAdvance).toBe(-20)
  })

  // A mark must attach to its base across another mark (the base scan passes
  // over marks).
  it('MarkBasePos attaches across intervening marks', () => {
    const table = buildOtl('mark', [
      {
        type: 4, flag: 0, subtable: markBasePos(
          [{ glyph: MARK_A, x: 10, y: 20 }, { glyph: MARK_B, x: 5, y: 5 }],
          [{ glyph: BASE, x: 300, y: 500 }],
        ),
      },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    const adj = gpos.getPositionAdjustments([BASE, MARK_B, MARK_A], null, null, null, null, gdef)
    // MARK_A attaches to BASE (not to MARK_B): offset = baseAnchor - markAnchor
    expect(adj[2]!.xPlacement).toBe(300 - 10)
    expect(adj[2]!.yPlacement).toBe(500 - 20)
  })

  it('Anchor format 2 uses the grid-fitted contour point at device size', () => {
    const table = buildOtl('mark', [{
      type: 4,
      flag: 0,
      subtable: markBasePos(
        [{ glyph: MARK_A, x: 10, y: 20, point: 2 }],
        [{ glyph: BASE, x: 300, y: 500, point: 7 }],
      ),
    }])
    const gpos = parseGpos(new BinaryReader(table))
    const resolver = {
      getGposAnchorPoint(glyphId: number, pointIndex: number, ppem: number) {
        expect(ppem).toBe(12)
        return glyphId === BASE && pointIndex === 7 ? { x: 330, y: 550 } : { x: 15, y: 25 }
      },
    }
    const adj = gpos.getPositionAdjustments(
      [BASE, MARK_A], null, null, null, null, gdef, 'ltr', null, null, 12,
      null, false, null, null, resolver,
    )
    expect(adj[1]!.xPlacement).toBe(315)
    expect(adj[1]!.yPlacement).toBe(525)

    const rebuilt = buildCompactGposTable(
      new BinaryReader(table), new Map([[BASE, BASE], [MARK_A, MARK_A]]),
    )
    const rebuiltGpos = parseGpos(new BinaryReader(rebuilt.buffer, rebuilt.byteOffset, rebuilt.byteLength))
    const rebuiltAdj = rebuiltGpos.getPositionAdjustments(
      [BASE, MARK_A], null, null, null, null, gdef, 'ltr', null, null, 12,
      null, false, null, null, resolver,
    )
    expect(rebuiltAdj[1]).toEqual(adj[1])
  })

  it('connects Anchor format 2 contour resolution through Font.shapeText', () => {
    const table = buildOtl('mark', [{
      type: 4,
      flag: 0,
      subtable: markBasePos(
        [{ glyph: MARK_A, x: 10, y: 20, point: 0 }],
        [{ glyph: BASE, x: 300, y: 500, point: 0 }],
      ),
    }])
    const glyphs = new Array<Uint8Array | null>(MARK_A + 1).fill(null)
    glyphs[BASE] = encodeSimpleGlyph([[330, 550], [430, 550], [330, 650]], [2])
    glyphs[MARK_A] = encodeSimpleGlyph([[15, 25], [35, 25], [15, 45]], [2])
    const font = Font.load(buildTestFont(
      glyphs,
      [[0x41, BASE], [0x42, MARK_A]],
      [['GPOS', new Uint8Array(table)]],
    ))
    const shaped = font.shapeText('AB', { ppem: 12 })
    const basePoint = font.getGposAnchorPoint(BASE, 0, 12)!
    const markPoint = font.getGposAnchorPoint(MARK_A, 0, 12)!
    expect(shaped[1]!.xOffset).toBeCloseTo(basePoint.x - markPoint.x - font.getAdvanceWidth(BASE), 8)
    expect(shaped[1]!.yOffset).toBeCloseTo(basePoint.y - markPoint.y, 8)
  })

  // MarkMark with MarkAttachmentType: mark1 of class 2 attaches to the
  // closest preceding mark of attachment class 2, skipping class-1 marks.
  it('MarkMarkPos with MarkAttachmentType skips other-class marks', () => {
    const table = buildOtl('mkmk', [
      {
        type: 6, flag: 0x0200, subtable: markMarkPos(
          [{ glyph: MARK_B, x: 1, y: 2 }],
          [{ glyph: MARK_B, x: 30, y: 40 }],
        ),
      },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    // Sequence: MARK_B (mark2), MARK_A (other class, skipped), MARK_B (mark1)
    const adj = gpos.getPositionAdjustments([MARK_B, MARK_A, MARK_B], null, null, null, null, gdef)
    expect(adj[2]!.xPlacement).toBe(30 - 1)
    expect(adj[2]!.yPlacement).toBe(40 - 2)
  })

  // Cursive attachment (LTR): the first glyph's total advance becomes the
  // exit-anchor x and the second glyph shifts so its entry anchor connects.
  it('CursivePos connects exit to entry anchors (LTR)', () => {
    const table = buildOtl('curs', [
      {
        type: 3, flag: 0, subtable: cursivePos([
          { glyph: X, entry: { x: 50, y: 10 }, exit: { x: 400, y: 30 } },
          { glyph: Y, entry: { x: 60, y: 70 }, exit: null },
        ]),
      },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    const advances = [500, 500]
    const adj = gpos.getPositionAdjustments(
      [X, Y], null, null, new Set(['curs']), null, null, 'ltr', advances,
    )
    // First glyph: advance becomes exit.x (400) → adjustment -100
    expect(adj[0]!.xAdvance).toBe(400 - 500)
    // Second glyph shifts left by its entry.x
    expect(adj[1]!.xPlacement).toBe(-60)
    expect(adj[1]!.xAdvance).toBe(-60)
    // Cross-stream: second glyph y aligns exit.y - entry.y = 30 - 70
    expect(adj[1]!.yPlacement).toBe(30 - 70)
  })
})

// --- Device / VariationIndex resolution ---

/** GDEF v1.3 with a one-axis Item Variation Store (one region, given deltas) */
function buildGdefV13(glyphClasses: [number, number][], regionPeaks: number[], deltaSets: number[][]): ArrayBuffer {
  const b = new Buf()
  b.u16(1).u16(3) // version 1.3
  const glyphClassAt = b.length; b.u16(0)
  b.u16(0) // attachListOffset
  b.u16(0) // ligCaretListOffset
  b.u16(0) // markAttachClassDefOffset
  b.u16(0) // markGlyphSetsDefOffset
  const ivsAt = b.length; b.u32(0)

  b.patch16(glyphClassAt, b.length)
  b.raw(classDef(glyphClasses))

  // Item Variation Store
  const ivsStart = b.length
  b.bytes[ivsAt] = (ivsStart >>> 24) & 0xFF
  b.bytes[ivsAt + 1] = (ivsStart >>> 16) & 0xFF
  b.bytes[ivsAt + 2] = (ivsStart >>> 8) & 0xFF
  b.bytes[ivsAt + 3] = ivsStart & 0xFF

  b.u16(1) // format
  const regionListOffAt = b.length; b.u32(0)
  b.u16(1) // itemVariationDataCount
  const dataOffAt = b.length; b.u32(0)

  // VariationRegionList (offsets relative to IVS start)
  const regionListOff = b.length - ivsStart
  b.bytes[regionListOffAt] = (regionListOff >>> 24) & 0xFF
  b.bytes[regionListOffAt + 1] = (regionListOff >>> 16) & 0xFF
  b.bytes[regionListOffAt + 2] = (regionListOff >>> 8) & 0xFF
  b.bytes[regionListOffAt + 3] = regionListOff & 0xFF
  b.u16(1) // axisCount
  b.u16(regionPeaks.length)
  for (const peak of regionPeaks) {
    const p = Math.round(peak * 16384)
    b.i16(peak >= 0 ? 0 : p) // startCoord
    b.i16(p)                 // peakCoord
    b.i16(peak >= 0 ? p : 0) // endCoord
  }

  // ItemVariationData 0
  const dataOff = b.length - ivsStart
  b.bytes[dataOffAt] = (dataOff >>> 24) & 0xFF
  b.bytes[dataOffAt + 1] = (dataOff >>> 16) & 0xFF
  b.bytes[dataOffAt + 2] = (dataOff >>> 8) & 0xFF
  b.bytes[dataOffAt + 3] = dataOff & 0xFF
  b.u16(deltaSets.length) // itemCount
  b.u16(regionPeaks.length) // wordDeltaCount (all int16)
  b.u16(regionPeaks.length) // regionIndexCount
  for (let r = 0; r < regionPeaks.length; r++) b.u16(r)
  for (const set of deltaSets) {
    for (const d of set) b.i16(d)
  }

  return b.toArrayBuffer()
}

/** SinglePos format 1 with XAdvance + XAdvDevice (device bytes appended) */
function singlePosWithDevice(glyphs: number[], xAdvance: number, device: Uint8Array): Uint8Array {
  const b = new Buf()
  b.u16(1) // posFormat
  const covAt = b.length; b.u16(0)
  b.u16(0x0044) // valueFormat: XAdvance | XAdvDevice
  b.i16(xAdvance)
  const devAt = b.length; b.u16(0)
  b.patch16(devAt, b.length)
  b.raw(device)
  b.patch16(covAt, b.length)
  b.raw(coverage(glyphs))
  return b.toUint8Array()
}

/** VariationIndex device table */
function variationIndexDevice(outer: number, inner: number): Uint8Array {
  const b = new Buf()
  b.u16(outer).u16(inner).u16(0x8000)
  return b.toUint8Array()
}

/** ppem Device table, deltaFormat 3 (8-bit) for a single size */
function ppemDevice(size: number, delta: number): Uint8Array {
  const b = new Buf()
  b.u16(size).u16(size).u16(3)
  b.u16((delta & 0xFF) << 8)
  return b.toUint8Array()
}

describe('OTL Device / VariationIndex resolution (GPOS)', () => {
  // A VariationIndex on XAdvance resolves through the GDEF v1.3 Item
  // Variation Store at the current normalized coordinates.
  it('VariationIndex device applies the IVS delta at the given coords', () => {
    const gdef = loadGdef(buildGdefV13([[A, 1]], [1.0], [[100]]), 1)
    const table = buildOtl('kern', [
      { type: 1, flag: 0, subtable: singlePosWithDevice([A], -50, variationIndexDevice(0, 0)) },
    ])
    const gpos = parseGpos(new BinaryReader(table))

    // At coord 1.0 the region scalar is 1 → delta 100
    const adjMax = gpos.getPositionAdjustments([A], null, null, null, null, gdef, 'ltr', null, [1.0])
    expect(adjMax[0]!.xAdvance).toBe(-50 + 100)

    // At coord 0.5 the scalar is 0.5 → delta 50
    const adjHalf = gpos.getPositionAdjustments([A], null, null, null, null, gdef, 'ltr', null, [0.5])
    expect(adjHalf[0]!.xAdvance).toBe(-50 + 50)

    // Without coords the device contributes nothing
    const adjNone = gpos.getPositionAdjustments([A], null, null, null, null, gdef)
    expect(adjNone[0]!.xAdvance).toBe(-50)
  })

  // A ppem-based Device table applies its delta only at matching sizes.
  it('ppem Device applies within its size range', () => {
    const table = buildOtl('kern', [
      { type: 1, flag: 0, subtable: singlePosWithDevice([A], -50, ppemDevice(12, 10)) },
    ])
    const gpos = parseGpos(new BinaryReader(table))

    const at12 = gpos.getPositionAdjustments([A], null, null, null, null, null, 'ltr', null, null, 12)
    expect(at12[0]!.xAdvance).toBe(-50 + 10)

    const at13 = gpos.getPositionAdjustments([A], null, null, null, null, null, 'ltr', null, null, 13)
    expect(at13[0]!.xAdvance).toBe(-50)

    const noPpem = gpos.getPositionAdjustments([A], null, null, null, null, null)
    expect(noPpem[0]!.xAdvance).toBe(-50)
  })
})

describe('default GPOS feature set', () => {
  // The default GPOS feature set applies cursive attachment without explicit
  // user features, matching HarfBuzz (checklist C3.1: curs is on by default).
  it('CursivePos applies with the default feature set (features = null)', () => {
    const table = buildOtl('curs', [
      {
        type: 3, flag: 0, subtable: cursivePos([
          { glyph: X, entry: { x: 50, y: 10 }, exit: { x: 400, y: 30 } },
          { glyph: Y, entry: { x: 60, y: 70 }, exit: null },
        ]),
      },
    ])
    const gpos = parseGpos(new BinaryReader(table))
    const advances = [500, 500]
    const adj = gpos.getPositionAdjustments(
      [X, Y], null, null, null, null, null, 'ltr', advances,
    )
    expect(adj[0]!.xAdvance).toBe(400 - 500)
    expect(adj[1]!.xPlacement).toBe(-60)
  })
})
