import { describe, expect, it } from 'vitest'
import { shapeGraphite, type GraphiteFontSource } from '../src/shaping/graphite.js'
import type { GraphiteFeatTable, SilfPass, SilfSubtable, SilfTable } from '../src/parsers/tables/graphite.js'
import type { FontMetrics, Glyph } from '../src/types/index.js'

const metrics = {
  unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0,
} as FontMetrics

const glyph = {
  id: 1, xMin: 0, yMin: -20, xMax: 100, yMax: 200,
} as Glyph

function makePass(action: readonly number[]): SilfPass {
  return {
    flags: 0, maxRuleLoop: 5, maxRuleContext: 1, maxBackup: 0,
    numRules: 1, fsmOffset: 0, pcCode: 0, rcCode: 0, aCode: 0, oDebug: 0,
    numRows: 2, numTransitional: 1, numSuccess: 1, numColumns: 1,
    searchRange: 0, entrySelector: 0, rangeShift: 0,
    ranges: [{ firstId: 1, lastId: 1, colId: 0 }],
    oRuleMap: new Uint16Array([0, 1]), ruleMap: new Uint16Array([0]),
    minRulePreContext: 0, maxRulePreContext: 0, startStates: new Uint16Array([0]),
    ruleSortKeys: new Uint16Array([1]), rulePreContext: new Uint8Array([0]),
    collisionThreshold: 0, passConstraintLength: 0,
    oConstraints: new Uint16Array([0, 0]), oActions: new Uint16Array([0, action.length]),
    stateTransitions: new Uint16Array([1]), passConstraints: new Uint8Array(),
    ruleConstraints: new Uint8Array(), actions: new Uint8Array(action), debug: null,
  }
}

function makeSubtable(action: readonly number[]): SilfSubtable {
  const pass = makePass(action)
  return {
    ruleVersion: 0x00030000, passOffset: 0, pseudosOffset: 0,
    maxGlyphId: 1, extraAscent: 0, extraDescent: 0,
    numPasses: 1, iSubst: 0, iPos: 1, iJust: 1, iBidi: 0xff, flags: 0,
    maxPreContext: 0, maxPostContext: 0,
    attrPseudo: 0, attrBreakWeight: 0, attrDirectionality: 0, attrMirroring: 0, attrSkipPasses: 0,
    jLevels: [], numLigComp: 0, numUserDefn: 1, maxCompPerLig: 0,
    direction: 0, attCollisions: 0, critFeatures: new Uint16Array(), scriptTags: [], lbGID: 0,
    oPasses: new Uint32Array([0, 0]), searchPseudo: 0, pseudoSelector: 0, pseudoShift: 0,
    pseudoMaps: [],
    classMap: {
      numClass: 1, numLinear: 1, offsets: new Uint32Array([0, 2]),
      linearClasses: [new Uint16Array([1])], lookupClasses: [],
    },
    passes: [pass],
  }
}

function run(action: readonly number[]): number {
  const subtable = makeSubtable(action)
  const silf: SilfTable = { version: 0x00030000, compilerVersion: 0x00030000, subtables: [subtable] }
  const font: GraphiteFontSource = {
    silf,
    glat: {
      getAttr: function () { return 0 },
      getGlyphAttrs: function () { return { octabox: null, runs: [] } },
    } as GraphiteFontSource['glat'],
    sill: null,
    graphiteFeatures: {
      features: [{ id: 0x74657374, flags: 0, label: 0, settings: [{ value: 0, label: 0 }] }],
    } as unknown as GraphiteFeatTable,
    metrics,
    getGlyphId: function () { return 1 },
    getGlyph: function () { return glyph },
    getGlyphBoundingBox: function () { return glyph },
    getAdvanceWidth: function () { return 100 },
  }
  return shapeGraphite(font, [0x61], { language: null, rightToLeft: false })[0]!.xAdvance
}

function runDeepRule(length: number): number {
  const action = setAdvance([0x04, 0x03, 0x09])
  const pass = makePass(action)
  pass.maxRuleContext = length
  pass.numRows = length + 1
  pass.numTransitional = length
  pass.numSuccess = 1
  pass.oRuleMap = new Uint16Array([0, 1])
  pass.ruleMap = new Uint16Array([0])
  pass.ruleSortKeys = new Uint16Array([length])
  pass.stateTransitions = new Uint16Array(length)
  for (let i = 0; i < length; i++) pass.stateTransitions[i] = i + 1
  const subtable = makeSubtable(action)
  subtable.passes = [pass]
  const silf: SilfTable = { version: 0x00030000, compilerVersion: 0x00030000, subtables: [subtable] }
  const font: GraphiteFontSource = {
    silf,
    glat: {
      getAttr: function () { return 0 },
      getGlyphAttrs: function () { return { octabox: null, runs: [] } },
    } as GraphiteFontSource['glat'],
    sill: null,
    graphiteFeatures: {
      features: [{ id: 0x74657374, flags: 0, label: 0, settings: [{ value: 0, label: 0 }] }],
    } as unknown as GraphiteFeatTable,
    metrics,
    getGlyphId: function () { return 1 },
    getGlyph: function () { return glyph },
    getGlyphBoundingBox: function () { return glyph },
    getAdvanceWidth: function () { return 100 },
  }
  return shapeGraphite(font, new Array<number>(length).fill(0x61), {
    language: null, rightToLeft: false,
  })[0]!.xAdvance
}

function setAdvance(program: readonly number[]): number[] {
  return [...program, 0x23, 0x00, 0x31]
}

describe('Graphite VM opcode closure', function () {
  it.each([
    ['NOP', setAdvance([0x00, 0x02, 7]), 7],
    ['PUSH_SHORT_U', setAdvance([0x04, 0x01, 0x2c]), 300],
    ['PUSH_LONG', setAdvance([0x05, 0, 0, 3, 0xe8]), 1000],
    ['TRUNC8', setAdvance([0x04, 0x12, 0x34, 0x0d]), 0x34],
    ['TRUNC16', setAdvance([0x05, 0x12, 0x34, 0x01, 0x2c, 0x0e]), 300],
    ['PUSH_ATT_TO_GLYPH_METRIC', setAdvance([0x2d, 0x08, 0x00, 0x00]), 100],
    ['PUSH_PROC_STATE', setAdvance([0x36, 0x00]), 1],
    ['PUSH_VERSION', setAdvance([0x37, 0x05, 0x00, 0x03, 0x00, 0x00, 0x13]), 1],
    ['BITOR', setAdvance([0x02, 6, 0x02, 3, 0x3e]), 7],
    ['BITAND', setAdvance([0x02, 6, 0x02, 3, 0x3f]), 2],
    ['BITNOT', setAdvance([0x02, 0xfe, 0x40, 0x0d]), 1],
  ] as const)('executes %s', function (_name, program, expected) {
    expect(run(program)).toBe(expected)
  })

  it('executes RET_TRUE as a successful one-slot rule advance', function () {
    expect(run([0x32])).toBe(100)
  })

  it('applies per-character SET_FEAT mutations to subsequent PUSH_FEAT reads', function () {
    expect(run(setAdvance([0x02, 7, 0x42, 0x00, 0x00, 0x2b, 0x00, 0x00]))).toBe(7)
  })

  it('executes a rule whose context exceeds 64 slots without truncating the FSM', function () {
    expect(runDeepRule(71)).toBe(777)
  })

  it('rejects VM stack underflow deterministically', function () {
    expect(function () { run([0x06, 0x31]) }).toThrow(/stack underflow/)
  })

  it('rejects VM stack overflow at the Graphite2 1024-element limit', function () {
    const program: number[] = []
    for (let i = 0; i < 1025; i++) program.push(0x02, 1)
    program.push(0x31)
    expect(function () { run(program) }).toThrow(/stack overflow/)
  })
})
