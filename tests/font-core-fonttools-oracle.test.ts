import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { parseFont } from '../src/parsers/index.js'
import { SfntTableManager } from '../src/parsers/ttf-parser.js'

const FIXTURES = resolve(import.meta.dirname, 'fixtures/fonts')

interface CoreOracle {
  readonly head: Record<string, number>
  readonly hhea: Record<string, number>
  readonly maxp: Record<string, number>
  readonly hmtx: readonly (readonly [number, number])[]
  readonly names: Record<string, string | null>
}

const ORACLE = `
import json,sys
from fontTools.ttLib import TTFont
font=TTFont(sys.argv[1])
head=font['head']
hhea=font['hhea']
maxp=font['maxp']
result={
  'head':{name:getattr(head,name) for name in ('tableVersion','fontRevision','flags','unitsPerEm','xMin','yMin','xMax','yMax','macStyle','lowestRecPPEM','fontDirectionHint','indexToLocFormat','glyphDataFormat')},
  'hhea':{name:getattr(hhea,name) for name in ('tableVersion','ascent','descent','lineGap','advanceWidthMax','minLeftSideBearing','minRightSideBearing','xMaxExtent','caretSlopeRise','caretSlopeRun','caretOffset','metricDataFormat','numberOfHMetrics')},
  'maxp':{name:getattr(maxp,name) for name in ('tableVersion','numGlyphs','maxPoints','maxContours','maxCompositePoints','maxCompositeContours','maxZones','maxTwilightPoints','maxStorage','maxFunctionDefs','maxInstructionDefs','maxStackElements','maxSizeOfInstructions','maxComponentElements','maxComponentDepth') if hasattr(maxp,name)},
  'hmtx':[font['hmtx'][name] for name in font.getGlyphOrder()],
  'names':{str(name_id):font['name'].getDebugName(name_id) for name_id in (1,2,4,6)},
}
print(json.dumps(result))
`

describe('required OpenType tables match fontTools', function () {
  for (const name of ['NotoSans-Regular.ttf', 'SourceSans3-Regular.otf']) {
    it(`matches every head/hhea/maxp/hmtx field and public name for ${name}`, function () {
      const path = resolve(FIXTURES, name)
      const bytes = readFileSync(path)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const font = Font.load(buffer)
      const manager = new SfntTableManager(parseFont(buffer))
      const expected = JSON.parse(execFileSync('python3', ['-c', ORACLE, path], { encoding: 'utf8' })) as CoreOracle

      const head = font.fontHeader
      expect({
        tableVersion: head.majorVersion + head.minorVersion / 65536,
        fontRevision: head.fontRevision,
        flags: head.flags,
        unitsPerEm: head.unitsPerEm,
        xMin: head.xMin,
        yMin: head.yMin,
        xMax: head.xMax,
        yMax: head.yMax,
        macStyle: head.macStyle,
        lowestRecPPEM: head.lowestRecPPEM,
        fontDirectionHint: head.fontDirectionHint,
        indexToLocFormat: head.indexToLocFormat,
        glyphDataFormat: head.glyphDataFormat,
      }).toEqual(expected.head)

      const hhea = font.horizontalHeader
      expect({
        tableVersion: hhea.majorVersion * 65536 + hhea.minorVersion,
        ascent: hhea.ascender,
        descent: hhea.descender,
        lineGap: hhea.lineGap,
        advanceWidthMax: hhea.advanceWidthMax,
        minLeftSideBearing: hhea.minLeftSideBearing,
        minRightSideBearing: hhea.minRightSideBearing,
        xMaxExtent: hhea.xMaxExtent,
        caretSlopeRise: hhea.caretSlopeRise,
        caretSlopeRun: hhea.caretSlopeRun,
        caretOffset: hhea.caretOffset,
        metricDataFormat: hhea.metricDataFormat,
        numberOfHMetrics: hhea.numberOfHMetrics,
      }).toEqual(expected.hhea)

      const maxp = font.maximumProfile as unknown as Record<string, number>
      expect(maxp.version).toBe(expected.maxp.tableVersion === 0x5000 ? 0.5 : expected.maxp.tableVersion / 65536)
      for (const [field, value] of Object.entries(expected.maxp)) {
        if (field !== 'tableVersion') expect(maxp[field], field).toBe(value)
      }
      expect(font.numGlyphs).toBe(expected.hmtx.length)
      for (let glyphId = 0; glyphId < font.numGlyphs; glyphId++) {
        expect([manager.hmtx.getAdvanceWidth(glyphId), manager.hmtx.getLsb(glyphId)], `glyph ${glyphId}`).toEqual(expected.hmtx[glyphId])
      }
      expect([font.familyName, font.subfamilyName, font.fullName, font.postScriptName]).toEqual([
        expected.names['1'], expected.names['2'], expected.names['4'], expected.names['6'],
      ])
    })
  }
})
