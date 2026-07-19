/**
 * Expectation generator for the HarfBuzz shaping compatibility suite.
 *
 * Runs hb-shape (the oracle) for every case in cases.ts and stores the raw
 * output under tests/hb-compat/expectations/<id>.json. The JSON files are
 * committed so that running the test suite does not require hb-shape.
 *
 * Manual regeneration (requires hb-shape on PATH or HB_SHAPE env override):
 *   node tests/hb-compat/generate-expectations.ts
 *
 * hb-shape defaults to the font's unitsPerEm as font size, so all values
 * (ax/ay/dx/dy) are integer font units — directly comparable to shapeText().
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CASES, buildHbFeatureList, type HbCompatCase } from './cases.ts'
import { EXPECTATIONS_DIR, type Expectation, type HbGlyph } from './compare.ts'
import { setup as downloadFonts, FONTS_DIR } from './download-fonts.ts'

const HB_SHAPE = process.env['HB_SHAPE'] ?? 'hb-shape'

function buildHbArgs(c: HbCompatCase, fontPath: string): string[] {
  const args = ['--output-format=json', '--no-glyph-names']
  args.push(`--direction=${c.direction ?? 'ltr'}`)
  if (c.hbScript) args.push(`--script=${c.hbScript}`)
  if (c.hbLanguage) args.push(`--language=${c.hbLanguage}`)
  const features = buildHbFeatureList(c)
  if (features.length > 0) args.push(`--features=${features}`)
  if (c.variations) {
    const vars = Object.entries(c.variations).map(([tag, v]) => `${tag}=${v}`).join(',')
    args.push(`--variations=${vars}`)
  }
  args.push(fontPath, c.text)
  return args
}

function runHbShape(c: HbCompatCase): HbGlyph[] {
  const fontPath = resolve(FONTS_DIR, c.font)
  if (!existsSync(fontPath)) {
    throw new Error(`[generate-expectations] Font not found: ${fontPath}`)
  }
  const out = execFileSync(HB_SHAPE, buildHbArgs(c, fontPath), { encoding: 'utf8' })
  return JSON.parse(out.trim()) as HbGlyph[]
}

async function main(): Promise<void> {
  await downloadFonts()
  mkdirSync(EXPECTATIONS_DIR, { recursive: true })

  const ids = new Set<string>()
  for (const c of CASES) {
    if (ids.has(c.id)) throw new Error(`[generate-expectations] Duplicate case id: ${c.id}`)
    ids.add(c.id)

    const expectation: Expectation = {
      font: c.font,
      text: c.text,
      options: {
        direction: c.direction ?? 'ltr',
        ...(c.script !== undefined ? { script: c.script } : {}),
        ...(c.hbScript !== undefined ? { hbScript: c.hbScript } : {}),
        ...(c.language !== undefined ? { language: c.language } : {}),
        ...(c.hbLanguage !== undefined ? { hbLanguage: c.hbLanguage } : {}),
        features: [...c.features],
        hbFeatures: buildHbFeatureList(c),
        ...(c.variations !== undefined ? { variations: c.variations } : {}),
      },
      glyphs: runHbShape(c),
    }

    const dest = resolve(EXPECTATIONS_DIR, `${c.id}.json`)
    writeFileSync(dest, `${JSON.stringify(expectation, null, 2)}\n`)
    console.log(`[generate-expectations] ${c.id}: ${expectation.glyphs.length} glyphs`)
  }
  console.log(`[generate-expectations] Wrote ${CASES.length} expectation files to ${EXPECTATIONS_DIR}`)
}

await main()
