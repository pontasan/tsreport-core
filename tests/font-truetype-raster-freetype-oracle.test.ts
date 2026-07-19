import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Font } from '../src/font.js'

const CC = '/usr/bin/cc'
const PKG_CONFIG = '/opt/homebrew/bin/pkg-config'
const FONT_PATH = resolve(__dirname, 'fixtures/fonts/Roboto-Regular.ttf')
const SOURCE = `
#include <stdio.h>
#include <stdlib.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GASP_H
int main(int argc, char **argv) {
  FT_Library library; FT_Face face;
  if (FT_Init_FreeType(&library) || FT_New_Face(library, argv[1], 0, &face)) return 2;
  int ppem = atoi(argv[2]);
  if (FT_Set_Pixel_Sizes(face, 0, ppem)) return 3;
  int transform = atoi(argv[3]);
  FT_Matrix matrix;
  if (transform == 1) {
    matrix.xx = 56756; matrix.xy = -32768;
    matrix.yx = 32768; matrix.yy = 56756;
    FT_Set_Transform(face, &matrix, NULL);
  } else if (transform == 2) {
    matrix.xx = 65536; matrix.xy = 16384;
    matrix.yx = 0; matrix.yy = 65536;
    FT_Set_Transform(face, &matrix, NULL);
  }
  for (int i = 4; i < argc; i++) {
    unsigned long cp = strtoul(argv[i], NULL, 16);
    FT_Int32 load_flags = FT_LOAD_NO_BITMAP | FT_LOAD_NO_AUTOHINT | FT_LOAD_TARGET_NORMAL;
    if (!(FT_Get_Gasp(face, ppem) & FT_GASP_DO_GRIDFIT)) load_flags |= FT_LOAD_NO_HINTING;
    if (FT_Load_Char(face, cp, load_flags)) return 4;
    if (FT_Render_Glyph(face->glyph, FT_RENDER_MODE_MONO)) return 5;
    FT_Bitmap *bitmap = &face->glyph->bitmap;
    printf("G %lu %d %d %u %u\\n", cp, face->glyph->bitmap_left, face->glyph->bitmap_top, bitmap->width, bitmap->rows);
    for (unsigned int row = 0; row < bitmap->rows; row++) {
      const unsigned char *data = bitmap->buffer + row * bitmap->pitch;
      for (unsigned int column = 0; column < bitmap->width; column++) {
        if (data[column >> 3] & (0x80 >> (column & 7)))
          printf("P %d %d\\n", face->glyph->bitmap_left + (int)column, face->glyph->bitmap_top - (int)row - 1);
      }
    }
    printf("E\\n");
  }
  FT_Done_Face(face); FT_Done_FreeType(library); return 0;
}`

const available = existsSync(CC) && existsSync(PKG_CONFIG) && existsSync(FONT_PATH)

describe.skipIf(!available)('TrueType scan conversion FreeType oracle', function () {
  const directory = join(tmpdir(), `tsreport-freetype-raster-${process.pid}`)
  const source = join(directory, 'oracle.c')
  const executable = join(directory, 'oracle')

  beforeAll(function () {
    execFileSync('mkdir', ['-p', directory])
    writeFileSync(source, SOURCE)
    const cflags = execFileSync(PKG_CONFIG, ['--cflags', 'freetype2'], { encoding: 'utf8' }).trim().split(/\s+/)
    const libs = execFileSync(PKG_CONFIG, ['--libs', 'freetype2'], { encoding: 'utf8' }).trim().split(/\s+/)
    execFileSync(CC, [source, '-o', executable, ...cflags, ...libs])
  })
  afterAll(function () { rmSync(directory, { recursive: true, force: true }) })

  for (const ppem of [5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 27]) {
    it(`matches illuminated pixels at ${ppem} ppem`, function () {
      const codePoints = [0x21, 0x38, 0x3A, 0x40, 0x41, 0x49, 0x57, 0x67, 0x6D, 0xC5, 0xE9]
      const output = execFileSync(executable, [FONT_PATH, String(ppem), '0', ...codePoints.map(toHex)], { encoding: 'utf8' })
      const expected = parsePixels(output)
      const bytes = readFileSync(FONT_PATH)
      const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      for (let i = 0; i < codePoints.length; i++) {
        const glyphId = font.getGlyphId(codePoints[i]!)
        const bitmap = font.rasterizeTrueTypeGlyph(glyphId, ppem)
        expect(bitmap).not.toBeNull()
        const actual = new Set<string>()
        for (let row = 0; row < bitmap!.height; row++) {
          for (let column = 0; column < bitmap!.width; column++) {
            if (bitmap!.pixels[row * bitmap!.width + column] !== 0) actual.add(`${bitmap!.xMin + column},${bitmap!.yMin + row}`)
          }
        }
        expect([...actual].sort(), `U+${codePoints[i]!.toString(16)}`).toEqual([...expected[i]!].sort())
      }
    })
  }


  for (const transform of [
    { name: 'rotation', id: '1', matrix: { xx: 56756 / 65536, xy: -0.5, yx: 0.5, yy: 56756 / 65536 } },
    { name: 'shear', id: '2', matrix: { xx: 1, xy: 0.25, yx: 0, yy: 1 } },
  ]) {
    it(`matches ${transform.name} transformed dropout rasterization`, function () {
      const ppem = 8
      const codePoints = [0x21, 0x41, 0x67, 0xC5]
      const output = execFileSync(executable, [FONT_PATH, String(ppem), transform.id, ...codePoints.map(toHex)], { encoding: 'utf8' })
      const expected = parsePixels(output)
      const bytes = readFileSync(FONT_PATH)
      const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      for (let i = 0; i < codePoints.length; i++) {
        const bitmap = font.rasterizeTrueTypeGlyph(font.getGlyphId(codePoints[i]!), ppem, { matrix: transform.matrix })!
        const actual = new Set<string>()
        for (let row = 0; row < bitmap.height; row++) for (let column = 0; column < bitmap.width; column++) {
          if (bitmap.pixels[row * bitmap.width + column] !== 0) actual.add(`${bitmap.xMin + column},${bitmap.yMin + row}`)
        }
        expect([...actual].sort(), `U+${codePoints[i]!.toString(16)}`).toEqual([...expected[i]!].sort())
      }
    })
  }
})

function toHex(value: number): string { return value.toString(16) }

function parsePixels(output: string): Set<string>[] {
  const result: Set<string>[] = []
  let current: Set<string> | null = null
  for (const line of output.trim().split('\n')) {
    const fields = line.split(' ')
    if (fields[0] === 'G') {
      current = new Set<string>()
      result.push(current)
    } else if (fields[0] === 'P') {
      current!.add(`${fields[1]},${fields[2]}`)
    } else if (fields[0] === 'E') {
      current = null
    }
  }
  return result
}
