import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/font.js'

const HB_SHAPE = '/opt/homebrew/bin/hb-shape'
const FONT_PATH = resolve(__dirname, 'fixtures/fonts/NotoSansJP-Regular.otf')
const available = existsSync(HB_SHAPE) && existsSync(FONT_PATH)

interface HbGlyph {
  g: string
  dx: number
  dy: number
  ax: number
  ay: number
}

interface FontToolsVerticalMetrics {
  vhea: [number, number, number]
  advances: number[]
  topSideBearings: number[]
  origins: number[]
}

function hbShape(text: string, features?: string): HbGlyph[] {
  const args = [FONT_PATH, text, '--direction=ttb', '--output-format=json']
  if (features !== undefined) args.push(`--features=${features}`)
  return JSON.parse(execFileSync(HB_SHAPE, args, { encoding: 'utf8' })) as HbGlyph[]
}

function gid(value: string): number {
  const match = /^gid(\d+)$/.exec(value)
  if (match === null) throw new Error(`Unexpected HarfBuzz glyph name: ${value}`)
  return Number(match[1])
}

describe.skipIf(!available)('vertical OpenType feature oracle', function () {
  it('matches fontTools vhea, vmtx, and VORG values for every glyph', function () {
    const script = [
      'import json, sys',
      'from fontTools.ttLib import TTFont',
      'font = TTFont(sys.argv[1])',
      'order = font.getGlyphOrder()',
      'metrics = font["vmtx"].metrics',
      'vorg = font["VORG"]',
      'records = {font.getGlyphID(name): value for name, value in vorg.VOriginRecords.items()}',
      'print(json.dumps({',
      '  "vhea": [font["vhea"].ascent, font["vhea"].descent, font["vhea"].lineGap],',
      '  "advances": [metrics[name][0] for name in order],',
      '  "topSideBearings": [metrics[name][1] for name in order],',
      '  "origins": [records.get(gid, vorg.defaultVertOriginY) for gid in range(len(order))],',
      '}))',
    ].join('\n')
    const expected = JSON.parse(execFileSync('python3', ['-c', script, FONT_PATH], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })) as FontToolsVerticalMetrics
    const bytes = readFileSync(FONT_PATH)
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

    expect([font.metrics.verticalAscender, font.metrics.verticalDescender, font.metrics.verticalLineGap])
      .toEqual(expected.vhea)
    for (let glyphId = 0; glyphId < expected.advances.length; glyphId++) {
      expect(font.getAdvanceHeight(glyphId), `advance gid ${glyphId}`).toBe(expected.advances[glyphId])
      expect(font.getTopSideBearing(glyphId), `top side bearing gid ${glyphId}`).toBe(expected.topSideBearings[glyphId])
      expect(font.getVerticalOrigin(glyphId), `vertical origin gid ${glyphId}`).toBe(expected.origins[glyphId])
    }
  })

  it('matches explicit vrt2 substitution and suppresses geometric Tr rotation', function () {
    const bytes = readFileSync(FONT_PATH)
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const text = '〈〉（）「」ー'
    const expected = hbShape(text, 'vrt2')
    const actual = font.shapeText(text, { direction: 'vertical', features: new Set(['vrt2']) })

    expect(actual.map(function map(g) { return g.glyphId }))
      .toEqual(expected.map(function map(g) { return gid(g.g) }))
    expect(actual.map(function map(g) { return g.yAdvance }))
      .toEqual(expected.map(function map(g) { return -g.ay }))
    expect(actual.map(function map(g) { return g.verticalRotation })).toEqual(new Array<number>(text.length).fill(0))
  })

  it('matches explicit vpal/vkrn placement and advance deltas from HarfBuzz', function () {
    const bytes = readFileSync(FONT_PATH)
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const text = '（）、。あいう'
    const hbDefault = hbShape(text)
    const hbAdjusted = hbShape(text, 'vpal,vkrn')
    const actualDefault = font.shapeText(text, { direction: 'vertical' })
    const actualAdjusted = font.shapeText(text, { direction: 'vertical', features: new Set(['vpal', 'vkrn']) })

    expect(actualAdjusted.map(function map(g) { return g.glyphId }))
      .toEqual(hbAdjusted.map(function map(g) { return gid(g.g) }))
    for (let i = 0; i < actualAdjusted.length; i++) {
      expect(actualAdjusted[i]!.xOffset - actualDefault[i]!.xOffset).toBe(hbAdjusted[i]!.dx - hbDefault[i]!.dx)
      expect(actualAdjusted[i]!.yOffset - actualDefault[i]!.yOffset).toBe(hbAdjusted[i]!.dy - hbDefault[i]!.dy)
      expect(actualAdjusted[i]!.yAdvance - actualDefault[i]!.yAdvance).toBe(-(hbAdjusted[i]!.ay - hbDefault[i]!.ay))
    }
  })
})
