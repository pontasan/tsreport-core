import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'
import { parseFont } from '../src/parsers/index.js'
import { getCff2PrivateDictEntries, parseCff2, parseCff2GlyphWithHints } from '../src/parsers/cff2-parser.js'
import { getTableReader } from '../src/parsers/sfnt-parser.js'
import type { GlyphOutline } from '../src/types/glyph.js'

const FIXTURE = resolve(__dirname, 'fixtures/fonts/SFIndiaBangla-CFF2.otf.base64')
const FONT_PATH = join(tmpdir(), `tsreport-cff2-${process.pid}.otf`)
const SUBSET_PATH = join(tmpdir(), `tsreport-cff2-subset-${process.pid}.otf`)
const CODE_POINTS = [0x0995, 0x09aa, 0x09b2, 0x09be]
const LOCATIONS = [
  { opsz: 17, wght: 1 },
  { opsz: 28, wght: 400 },
  { opsz: 28, wght: 1000 },
]

interface OracleGlyph {
  readonly codePoint: number
  readonly glyphId: number
  readonly advance: number
  readonly bounds: readonly [number, number, number, number] | null
}

const PYTHON_ORACLE = `
import json,sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
font=TTFont(sys.argv[1])
location=json.loads(sys.argv[2])
glyphSet=font.getGlyphSet(location=location)
cmap=font.getBestCmap()
order=font.getGlyphOrder()
result=[]
for cp in json.loads(sys.argv[3]):
    name=cmap[cp]
    pen=BoundsPen(glyphSet)
    glyphSet[name].draw(pen)
    result.append({'codePoint':cp,'glyphId':order.index(name),'advance':glyphSet[name].width,'bounds':pen.bounds})
print(json.dumps(result))
`

const PYTHON_PRIVATE_ORACLE = `
import json,sys
from fontTools.ttLib import TTFont
from fontTools.varLib.models import normalizeLocation
from fontTools.varLib.varStore import VarStoreInstancer
font=TTFont(sys.argv[1])
location=json.loads(sys.argv[2])
axes={axis.axisTag:(axis.minValue,axis.defaultValue,axis.maxValue) for axis in font['fvar'].axes}
normalized=normalizeLocation(location,axes)
top=font['CFF2'].cff.topDictIndex[0]
private=top.FDArray[0].Private
instancer=VarStoreInstancer(top.VarStore.otVarStore,font['fvar'].axes,normalized)
result={}
for name in ('BlueValues','OtherBlues','BlueScale','BlueFuzz','StdHW','StdVW'):
    value=private.rawDict.get(name)
    if isinstance(value,list) and value and isinstance(value[0],list):
        if name in ('BlueValues','OtherBlues'):
            previous=0
            evaluated=[]
            for row in value:
                evaluated.append(row[0]-previous+instancer.interpolateFromDeltas(0,row[1:]))
                previous=row[0]
            result[name]=evaluated
        else:
            result[name]=[row[0]+instancer.interpolateFromDeltas(0,row[1:]) for row in value]
    elif isinstance(value,list):
        result[name]=[value[0]+instancer.interpolateFromDeltas(0,value[1:])]
    elif value is not None:
        result[name]=[value]
print(json.dumps(result))
`

describe('real CFF2 variable font oracle', function () {
  let bytes: Uint8Array

  beforeAll(function () {
    bytes = Uint8Array.from(Buffer.from(readFileSync(FIXTURE, 'utf8').trim(), 'base64'))
    writeFileSync(FONT_PATH, bytes)
  })

  afterAll(function () {
    rmSync(FONT_PATH, { force: true })
    rmSync(SUBSET_PATH, { force: true })
  })

  it('matches fontTools CFF2 outlines and HVAR advances across the variation space', function () {
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect(font.isCff2).toBe(true)
    expect(font.variationAxes.map(function (axis) { return axis.tag })).toEqual(['opsz', 'wght'])

    for (let locationIndex = 0; locationIndex < LOCATIONS.length; locationIndex++) {
      const location = LOCATIONS[locationIndex]!
      const oracle = JSON.parse(execFileSync('python3', [
        '-c', PYTHON_ORACLE, FONT_PATH, JSON.stringify(location), JSON.stringify(CODE_POINTS),
      ], { encoding: 'utf8' })) as OracleGlyph[]
      font.setVariation(location)
      for (let i = 0; i < oracle.length; i++) {
        const expected = oracle[i]!
        const glyphId = font.getGlyphId(expected.codePoint)
        const glyph = font.getGlyph(glyphId)
        expect(glyphId).toBe(expected.glyphId)
        expect(font.getAdvanceWidth(glyphId)).toBeCloseTo(expected.advance, 4)
        expect(exactBounds(glyph.outline)).toEqual(expected.bounds?.map(roundFour) ?? null)
      }
    }
  })

  it('bakes the selected CFF2 instance into compact CFF outlines and horizontal metrics', function () {
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    font.setVariation({ opsz: 17, wght: 1000 })
    const codePoints = [0x0995, 0x09b2]
    const source = codePoints.map(function (codePoint) {
      const glyphId = font.getGlyphId(codePoint)
      return { codePoint, bounds: exactBounds(font.getGlyph(glyphId).outline), advance: font.getAdvanceWidth(glyphId) }
    })
    const result = font.subsetWithMapping('কল')
    writeFileSync(SUBSET_PATH, new Uint8Array(result.buffer))
    const subset = Font.load(result.buffer)

    expect(result.buffer.byteLength).toBeLessThan(bytes.byteLength)
    expect(subset.isCff).toBe(true)
    expect(subset.isCff2).toBe(false)
    expect(subset.isVariable).toBe(false)
    const oracle = JSON.parse(execFileSync('python3', [
      '-c', PYTHON_ORACLE, SUBSET_PATH, '{}', JSON.stringify(codePoints),
    ], { encoding: 'utf8' })) as OracleGlyph[]
    for (let i = 0; i < source.length; i++) {
      const expected = source[i]!
      const glyphId = subset.getGlyphId(expected.codePoint)
      expect(exactBounds(subset.getGlyph(glyphId).outline)).toEqual(expected.bounds)
      expect(subset.getAdvanceWidth(glyphId)).toBeCloseTo(expected.advance, 0)
      expect(oracle[i]!.advance).toBeCloseTo(expected.advance, 0)
      expect(oracle[i]!.bounds?.map(roundFour)).toEqual(expected.bounds)
    }
  })

  it('matches fontTools PrivateDICT blends and connects selected hint data to raster hinting', function () {
    const sfnt = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const reader = getTableReader(sfnt, 'CFF2')
    if (reader === null) throw new Error('CFF2 fixture is missing its CFF2 table')
    const cff2 = parseCff2(reader, 2)
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const glyphId = font.getGlyphId(0x0995)

    for (let locationIndex = 0; locationIndex < LOCATIONS.length; locationIndex++) {
      const location = LOCATIONS[locationIndex]!
      font.setVariation(location)
      const normalized = font.getNormalizedVariationCoordinates()
      if (normalized === null) throw new Error('CFF2 variation coordinates were not selected')
      const actual = getCff2PrivateDictEntries(cff2, glyphId, normalized)
      const oracle = JSON.parse(execFileSync('python3', [
        '-c', PYTHON_PRIVATE_ORACLE, FONT_PATH, JSON.stringify(location),
      ], { encoding: 'utf8' })) as Record<string, number[]>
      expectRounded(actual.get(6), oracle.BlueValues)
      expectRounded(actual.get(7), oracle.OtherBlues)
      expectRounded(actual.get(1209), oracle.BlueScale)
      expectRounded(actual.get(1211), oracle.BlueFuzz)
      expectRounded(actual.get(10), oracle.StdHW)
      expectRounded(actual.get(11), oracle.StdVW)

      const parsed = parseCff2GlyphWithHints(cff2, glyphId, normalized)
      expect(parsed.privateDictEntries.get(10)?.[0]).toBeCloseTo(oracle.StdHW![0]!, 5)
      const hinted = font.getHintedGlyph(glyphId, 12)
      expect(hinted.glyphId).toBe(glyphId)
      const deviceAdvance = font.getDeviceAdvanceWidth(glyphId, 12)
      const expectedAdvance = deviceAdvance === null
        ? font.getAdvanceWidth(glyphId)
        : deviceAdvance * font.metrics.unitsPerEm / 12
      expect(hinted.advanceWidth).toBe(expectedAdvance)
    }
  })
})

function expectRounded(actual: number[] | undefined, expected: number[] | undefined): void {
  expect(actual?.map(roundFour)).toEqual(expected?.map(roundFour))
}

function exactBounds(outline: GlyphOutline): readonly [number, number, number, number] | null {
  let x = 0
  let y = 0
  let coordIndex = 0
  let bounds: [number, number, number, number] | null = null
  const include = function (px: number, py: number): void {
    if (bounds === null) bounds = [px, py, px, py]
    else {
      if (px < bounds[0]) bounds[0] = px
      if (py < bounds[1]) bounds[1] = py
      if (px > bounds[2]) bounds[2] = px
      if (py > bounds[3]) bounds[3] = py
    }
  }
  for (let i = 0; i < outline.commands.length; i++) {
    const command = outline.commands[i]!
    if (command === 0 || command === 1) {
      x = outline.coords[coordIndex++]!
      y = outline.coords[coordIndex++]!
      include(x, y)
    } else if (command === 2) {
      const x1 = outline.coords[coordIndex++]!
      const y1 = outline.coords[coordIndex++]!
      const x2 = outline.coords[coordIndex++]!
      const y2 = outline.coords[coordIndex++]!
      const x3 = outline.coords[coordIndex++]!
      const y3 = outline.coords[coordIndex++]!
      const parameters = [...cubicExtrema(x, x1, x2, x3), ...cubicExtrema(y, y1, y2, y3)]
      for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex++) {
        const t = parameters[parameterIndex]!
        include(cubicAt(x, x1, x2, x3, t), cubicAt(y, y1, y2, y3, t))
      }
      include(x3, y3)
      x = x3
      y = y3
    }
  }
  return bounds?.map(roundFour) as [number, number, number, number] | null
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const result: number[] = []
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b
      if (t > 0 && t < 1) result.push(t)
    }
    return result
  }
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return result
  const root = Math.sqrt(discriminant)
  const first = (-b + root) / (2 * a)
  const second = (-b - root) / (2 * a)
  if (first > 0 && first < 1) result.push(first)
  if (second > 0 && second < 1) result.push(second)
  return result
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m = 1 - t
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3
}

function roundFour(value: number): number {
  return Math.round(value * 10000) / 10000
}
