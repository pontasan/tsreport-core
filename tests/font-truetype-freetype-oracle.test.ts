import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font } from '../src/font.js'

const CC = '/usr/bin/cc'
const PKG_CONFIG = '/opt/homebrew/bin/pkg-config'
const FONT_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const VARIABLE_FONT_PATH = resolve(__dirname, 'fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')
const ORACLE_SOURCE = `
#include <stdio.h>
#include <stdlib.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_BBOX_H
#include FT_GASP_H
int main(int argc, char **argv) {
  FT_Library library;
  FT_Face face;
  if (FT_Init_FreeType(&library) != 0 || FT_New_Face(library, argv[1], 0, &face) != 0) return 2;
  int ppem = atoi(argv[2]);
  if (FT_Set_Pixel_Sizes(face, 0, ppem) != 0) return 3;
  for (int i = 3; i < argc; i++) {
    unsigned long cp = strtoul(argv[i], NULL, 16);
    FT_Int32 load_flags = FT_LOAD_NO_BITMAP | FT_LOAD_NO_AUTOHINT;
    if (!(FT_Get_Gasp(face, ppem) & FT_GASP_DO_GRIDFIT)) load_flags |= FT_LOAD_NO_HINTING;
    if (FT_Load_Char(face, cp, load_flags) != 0) return 4;
    FT_BBox box;
    FT_Outline_Get_BBox(&face->glyph->outline, &box);
    FT_Outline *outline = &face->glyph->outline;
    printf("G %lu %u %ld %ld %ld %ld %ld %d %d\\n", cp, face->glyph->glyph_index,
      face->glyph->advance.x, box.xMin, box.yMin, box.xMax, box.yMax,
      outline->n_points, outline->n_contours);
    for (int point = 0; point < outline->n_points; point++) {
      printf("P %ld %ld %d\\n", outline->points[point].x, outline->points[point].y,
        FT_CURVE_TAG(outline->tags[point]));
    }
    printf("C");
    for (int contour = 0; contour < outline->n_contours; contour++) printf(" %d", outline->contours[contour]);
    printf("\\n");
  }
  FT_Done_Face(face);
  FT_Done_FreeType(library);
  return 0;
}
`

const VARIABLE_ORACLE_SOURCE = `
#include <stdio.h>
#include <stdlib.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H
int main(int argc, char **argv) {
  FT_Library library;
  FT_Face face;
  if (FT_Init_FreeType(&library) != 0 || FT_New_Face(library, argv[1], 0, &face) != 0) return 2;
  FT_Fixed coordinates[2];
  coordinates[0] = (FT_Fixed)(atof(argv[2]) * 65536.0);
  coordinates[1] = (FT_Fixed)(atof(argv[3]) * 65536.0);
  if (FT_Set_Var_Design_Coordinates(face, 2, coordinates) != 0) return 3;
  for (int i = 4; i < argc; i++) {
    unsigned long cp = strtoul(argv[i], NULL, 16);
    if (FT_Load_Char(face, cp, FT_LOAD_NO_SCALE | FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP) != 0) return 4;
    FT_Glyph_Metrics m = face->glyph->metrics;
    printf("%lu %u %ld %ld %ld\\n", cp, face->glyph->glyph_index,
      m.horiAdvance, m.horiBearingX, m.horiAdvance - m.horiBearingX - m.width);
  }
  FT_Done_Face(face);
  FT_Done_FreeType(library);
  return 0;
}
`

const oracleAvailable = existsSync(CC) && existsSync(PKG_CONFIG) && existsSync(FONT_PATH)

describe.skipIf(!oracleAvailable)('TrueType hinting FreeType oracle', function () {
  const directory = join(tmpdir(), `tsreport-freetype-${process.pid}`)
  const source = join(directory, 'oracle.c')
  const executable = join(directory, 'oracle')
  const variableSource = join(directory, 'variable-oracle.c')
  const variableExecutable = join(directory, 'variable-oracle')

  beforeAll(function () {
    execFileSync('mkdir', ['-p', directory])
    writeFileSync(source, ORACLE_SOURCE)
    writeFileSync(variableSource, VARIABLE_ORACLE_SOURCE)
    const cflags = execFileSync(PKG_CONFIG, ['--cflags', 'freetype2'], { encoding: 'utf8' }).trim().split(/\s+/)
    const libs = execFileSync(PKG_CONFIG, ['--libs', 'freetype2'], { encoding: 'utf8' }).trim().split(/\s+/)
    execFileSync(CC, [source, '-o', executable, ...cflags, ...libs])
    execFileSync(CC, [variableSource, '-o', variableExecutable, ...cflags, ...libs])
  })

  afterAll(function () { rmSync(directory, { recursive: true, force: true }) })

  for (const ppem of [5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 27]) {
    it(`matches grid-fitted points, phantom advance, bounds and advances at ${ppem} ppem`, function () {
      const codePoints = [0x21, 0x2E, 0x38, 0x3A, 0x40, 0x41, 0x49, 0x57, 0x67, 0x6D, 0x2DA, 0xC5, 0xE9]
      const output = execFileSync(executable, [FONT_PATH, String(ppem), ...codePoints.map(function (cp) { return cp.toString(16) })], { encoding: 'utf8' })
      const oracle = parseHintingOracle(output)
      const bytes = readFileSync(FONT_PATH)
      const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      const scale = ppem * 64 / font.metrics.unitsPerEm
      for (let i = 0; i < codePoints.length; i++) {
        const expected = oracle[i]!
        const glyphId = font.getGlyphId(codePoints[i]!)
        const glyph = font.getHintedGlyph(glyphId, ppem)
        const state = font.getTrueTypeHintingState(glyphId, ppem)
        expect(state).not.toBeNull()
        const device = font.getDeviceMetrics(glyphId, ppem)
        const expectedDeviceAdvance = device.gridFit ? expected.advance : Math.round(expected.advance / 64) * 64
        expect(glyphId).toBe(expected.glyphId)
        expect(Math.round(glyph.advanceWidth * scale)).toBe(expected.advance)
        expect(device.advanceWidthPixels * 64, `device advance U+${codePoints[i]!.toString(16)}`).toBe(expectedDeviceAdvance)
        expect(state!.phantomX[1]! - state!.phantomX[0]!, `phantom advance U+${codePoints[i]!.toString(16)}`).toBe(expected.advance)
        expect(state!.x, `point x U+${codePoints[i]!.toString(16)}`).toEqual(expected.x)
        expect(state!.y, `point y U+${codePoints[i]!.toString(16)}`).toEqual(expected.y)
        expect(state!.onCurve, `point tags U+${codePoints[i]!.toString(16)}`).toEqual(expected.onCurve)
        expect(state!.contourEnds, `contours U+${codePoints[i]!.toString(16)}`).toEqual(expected.contourEnds)
        expect([
          Math.round(glyph.xMin * scale), Math.round(glyph.yMin * scale),
          Math.round(glyph.xMax * scale), Math.round(glyph.yMax * scale),
        ], `U+${codePoints[i]!.toString(16)}`).toEqual(expected.bounds)
      }
    })
  }

  it.skipIf(!existsSync(VARIABLE_FONT_PATH))('matches variable advance and side bearings across design regions', function () {
    const codePoints = Array.from('AáéÅǼüg8', function toCodePoint(char) { return char.codePointAt(0)! })
    const locations = [[100, 62.5], [650, 87.5], [900, 100]]
    const bytes = readFileSync(VARIABLE_FONT_PATH)
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
      const location = locations[locationIndex]!
      const output = execFileSync(variableExecutable, [
        VARIABLE_FONT_PATH, String(location[0]), String(location[1]),
        ...codePoints.map(function toHex(cp) { return cp.toString(16) }),
      ], { encoding: 'utf8' })
      const expected = output.trim().split('\n').map(function parse(line) { return line.split(' ').map(Number) })
      font.setVariation({ wght: location[0]!, wdth: location[1]! })
      for (let i = 0; i < codePoints.length; i++) {
        const row = expected[i]!
        const glyphId = font.getGlyphId(codePoints[i]!)
        expect(glyphId).toBe(row[1])
        expect(Math.round(font.getAdvanceWidth(glyphId))).toBe(row[2])
        expect(font.getLeftSideBearing(glyphId)).toBe(row[3])
        expect(font.getRightSideBearing(glyphId)).toBe(row[4])
      }
    }
  })
})

interface HintingOracleGlyph {
  glyphId: number
  advance: number
  bounds: number[]
  x: number[]
  y: number[]
  onCurve: boolean[]
  contourEnds: number[]
}

function parseHintingOracle(output: string): HintingOracleGlyph[] {
  const lines = output.trim().split('\n')
  const result: HintingOracleGlyph[] = []
  let lineIndex = 0
  while (lineIndex < lines.length) {
    const header = lines[lineIndex++]!.split(' ')
    if (header[0] !== 'G') throw new Error(`Unexpected FreeType oracle record ${header[0]}`)
    const glyphId = Number(header[2])
    const advance = Number(header[3])
    const pointCount = Number(header[8])
    const contourCount = Number(header[9])
    const x = new Array<number>(pointCount)
    const y = new Array<number>(pointCount)
    const onCurve = new Array<boolean>(pointCount)
    for (let point = 0; point < pointCount; point++) {
      const row = lines[lineIndex++]!.split(' ')
      if (row[0] !== 'P') throw new Error(`Expected FreeType point record, got ${row[0]}`)
      x[point] = Number(row[1])
      y[point] = Number(row[2])
      onCurve[point] = Number(row[3]) === 1
    }
    const contours = lines[lineIndex++]!.split(' ')
    if (contours[0] !== 'C') throw new Error(`Expected FreeType contour record, got ${contours[0]}`)
    const contourEnds = contours.slice(1).map(Number)
    if (contourEnds.length !== contourCount) throw new Error('FreeType contour count does not match its contour records')
    result.push({
      glyphId,
      advance,
      bounds: header.slice(4, 8).map(Number),
      x,
      y,
      onCurve,
      contourEnds,
    })
  }
  return result
}
