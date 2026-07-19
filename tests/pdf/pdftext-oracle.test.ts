// External text-extraction oracle: verify that text placed in a generated PDF
// is recoverable by poppler's pdftotext. This exercises the /ToUnicode CMap and
// content-stream text encoding against an independent implementation (skipped
// when pdftotext is not installed).

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { Font } from '../../src/font.js'
import type { RenderDocument } from '../../src/types/render.js'
import { decodePng } from '../../src/image/png-parser.js'

function pdftotextPath(): string | null {
  for (const p of ['/opt/homebrew/bin/pdftotext', '/usr/bin/pdftotext', '/usr/local/bin/pdftotext']) {
    try { execFileSync(p, ['-v'], { stdio: 'ignore' }); return p } catch { /* not here */ }
  }
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return 'pdftotext' } catch { return null }
}

function pdftoppmPath(): string | null {
  for (const p of ['/opt/homebrew/bin/pdftoppm', '/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm']) {
    try { execFileSync(p, ['-v'], { stdio: 'ignore' }); return p } catch { /* not here */ }
  }
  try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return 'pdftoppm' } catch { return null }
}

const PDFTOTEXT = pdftotextPath()
const PDFTOPPM = pdftoppmPath()
const JP_FONT = resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')
const ROBOTO = resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')
const AR_FONT = resolve(__dirname, '../fixtures/fonts/NotoSansArabic-Regular.ttf')

function extract(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdftext-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    // -layout preserves order; read the produced text file.
    execFileSync(PDFTOTEXT!, [file, join(dir, 'out.txt')])
    return readFileSync(join(dir, 'out.txt'), 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

interface WordBox { text: string, xMin: number, yMin: number, xMax: number, yMax: number }

// Run pdftotext -bbox and parse the <word> boxes (top-left origin, points).
function extractWordBoxes(bytes: Uint8Array): WordBox[] {
  const dir = mkdtempSync(join(tmpdir(), 'pdfbbox-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    const xml = execFileSync(PDFTOTEXT!, ['-bbox', file, '-'], { encoding: 'utf8' })
    const boxes: WordBox[] = []
    const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
      boxes.push({ xMin: +m[1]!, yMin: +m[2]!, xMax: +m[3]!, yMax: +m[4]!, text: m[5]! })
    }
    return boxes
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(PDFTOTEXT === null)('pdftotext text-extraction oracle', () => {
  it('recovers mixed CJK + Latin text via /ToUnicode (embedded CID font)', () => {
    const font = Font.load(readFileSync(JP_FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    const doc: RenderDocument = {
      pages: [{ width: 400, height: 200, children: [
        { type: 'text', x: 20, y: 40, text: '日本語 abc 記号', fontId: 'd', fontSize: 20, color: '#000000' },
      ] }],
    }
    render(doc, backend)
    expect(extract(backend.toUint8Array())).toContain('日本語 abc 記号')
  })

  it('recovers Latin text with punctuation (embedded TrueType)', () => {
    const font = Font.load(readFileSync(ROBOTO).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 400, height: 200, children: [
      { type: 'text', x: 20, y: 40, text: 'Invoice #12,345.67 (paid)', fontId: 'd', fontSize: 14, color: '#000000' },
    ] }] }, backend)
    expect(extract(backend.toUint8Array())).toContain('Invoice #12,345.67 (paid)')
  })

  it('does not misrepresent .notdef: missing characters extract as nothing, not a wrong char', () => {
    // Roboto lacks CJK, so 中 and 文 both map to glyph 0 (.notdef). GID 0 must be
    // left out of /ToUnicode: otherwise it would map to the first missing char
    // (中), and 文 would wrongly extract as 中. The present Latin stays intact.
    const font = Font.load(readFileSync(ROBOTO).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 400, height: 200, children: [
      { type: 'text', x: 20, y: 40, text: 'A中文B', fontId: 'd', fontSize: 20, color: '#000000' },
    ] }] }, backend)
    const got = extract(backend.toUint8Array())
    expect(got).toContain('A')
    expect(got).toContain('B')
    // The missing characters do not surface as a duplicated/garbage character.
    expect(got).not.toContain('中')
    expect(got).not.toContain('文')
  })

  it('recovers vertical (tate-gaki) CJK text via /ToUnicode (Identity-V)', () => {
    // Vertical writing shapes via the `vert` feature and emits an Identity-V CID
    // font; the /ToUnicode CMap must still map each vertical-form glyph back to
    // its source code point so the column extracts in logical order.
    const font = Font.load(readFileSync(JP_FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    backend.beginDocument()
    backend.beginPage(200, 300)
    backend.drawText(100, 20, '縦書き報告書', 'd', 18, '#000000', { writingMode: 'vertical-rl' })
    backend.endPage()
    backend.endDocument()
    expect(extract(backend.toUint8Array()).replace(/\s+/g, '')).toContain('縦書き報告書')
  })

  // A font that decomposes a presentation-form ligature (U+FB01 -> f + i via a
  // GSUB multiple substitution) must map both output glyphs back to the single
  // source code point, so the text extracts as "ﬁnance" rather than shifting a
  // character off (previously "ﬁnanae"). San Francisco does this decomposition.
  const SFNS = '/System/Library/Fonts/SFNS.ttf'
  it.skipIf(!existsSync(SFNS))('round-trips a decomposed ﬁ ligature through ToUnicode', () => {
    const font = Font.load(readFileSync(SFNS).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 300, height: 100, children: [
      { type: 'text', x: 20, y: 40, text: 'ﬁnance', fontId: 'd', fontSize: 20, color: '#000000' },
    ] }] }, backend)
    expect(extract(backend.toUint8Array()).replace(/\s+/g, '')).toContain('ﬁnance')
  })

  // A font that decomposes distinct Arabic letters onto one shared base skeleton
  // glyph (medial TA and BA differ only by dot glyphs) cannot round-trip through
  // a per-glyph /ToUnicode CMap: the shared base maps to a single code point, so
  // one letter corrupts to the other on extraction (مكتبة -> مكببة). A
  // /Span /ActualText marked-content sequence restores the logical text.
  const SFAR = '/System/Library/Fonts/SFArabic.ttf'
  it.skipIf(!existsSync(SFAR))('round-trips Arabic shared-skeleton letters via /ActualText', () => {
    const font = Font.load(readFileSync(SFAR).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 300, height: 100, children: [
      { type: 'text', x: 20, y: 40, text: 'مكتبة', fontId: 'd', fontSize: 24, color: '#000000' },
    ] }] }, backend)
    // Strip bidi control marks; extractors may emit visual (RTL-reversed) order,
    // so compare the character multiset rather than the exact sequence. The
    // regression is that ت (TA) survives instead of corrupting to a second ب (BA).
    const got = extract(backend.toUint8Array()).replace(/[‎‏‪-‮\s]/g, '')
    expect(got).toContain('ت')
    const sortChars = (s: string): string => [...s].sort().join('')
    expect(sortChars(got)).toBe(sortChars('مكتبة'))
  })

  // The Arabic lam-alef ligature substitutes lam + alef into a single glyph, so
  // its /ToUnicode entry must expand that one glyph back to two code points
  // (U+0644 U+0627). A per-glyph mapping that emitted a single code point would
  // lose a letter on extraction.
  it('round-trips the Arabic lam-alef ligature via a two-code-point /ToUnicode', () => {
    const font = Font.load(readFileSync(AR_FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 200, height: 100, children: [
      { type: 'text', x: 20, y: 40, text: 'لا', fontId: 'd', fontSize: 24, color: '#000000',
        direction: 'rtl', script: 'arab' } as never,
    ] }] }, backend)
    // Strip bidi control marks; extractors may emit visual order, so compare the
    // character multiset. Both lam and alef must survive the single-glyph run.
    const got = extract(backend.toUint8Array()).replace(/[‎‏‪-‮\s]/g, '')
    const sortChars = (s: string): string => [...s].sort().join('')
    expect(sortChars(got)).toBe(sortChars('لا'))
  })

  // Coordinate-system round-trip: text placed at a known top-left position must
  // land there when an independent renderer (poppler) reads it back. This
  // exercises the pt units, the text matrix and its y-flip end to end. Our
  // text `y` is the top of the ascent box (baseline = y + ascent), which is
  // what pdftotext -bbox reports as the word's yMin.
  it('places text at the requested top-left coordinate (poppler -bbox oracle)', () => {
    const font = Font.load(readFileSync(ROBOTO).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { r: font } })
    render({ pages: [{ width: 200, height: 300, children: [
      { type: 'text', x: 40, y: 100, text: 'Marker', fontId: 'r', fontSize: 20, color: '#000000' },
    ] }] } as never, backend)
    const boxes = extractWordBoxes(backend.toUint8Array())
    const marker = boxes.find((b) => b.text === 'Marker')
    expect(marker, 'Marker word present').toBeDefined()
    // x is exact; the ascent-box top equals y within sub-point rounding.
    expect(Math.abs(marker!.xMin - 40)).toBeLessThan(0.5)
    expect(Math.abs(marker!.yMin - 100)).toBeLessThan(1)
    // The word has positive extent and sits inside the page.
    expect(marker!.xMax).toBeGreaterThan(marker!.xMin)
    expect(marker!.yMax).toBeGreaterThan(marker!.yMin)
    expect(marker!.xMax).toBeLessThanOrEqual(200)
    expect(marker!.yMax).toBeLessThanOrEqual(300)
  })

  // Vertical (tate-gaki) placement: rasterize through poppler and measure the
  // actual ink extent with our own PNG decoder. The column top must sit at the
  // requested y and the column must occupy x .. x+fontSize. (pdftotext -bbox is
  // not usable here: its vertical word boxes are origin-based approximations.)
  it.skipIf(PDFTOPPM === null)('places a vertical column at the requested x/y (poppler raster oracle)', () => {
    const font = Font.load(readFileSync(JP_FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    backend.beginDocument()
    backend.beginPage(200, 300)
    backend.drawText(100, 20, '縦書き', 'd', 20, '#000000', { writingMode: 'vertical-rl' })
    backend.endPage()
    backend.endDocument()

    const dir = mkdtempSync(join(tmpdir(), 'pdfvert-'))
    try {
      const file = join(dir, 'doc.pdf')
      writeFileSync(file, backend.toUint8Array())
      execFileSync(PDFTOPPM!, ['-png', '-r', '72', file, join(dir, 'out')])
      const png = decodePng(new Uint8Array(readFileSync(join(dir, 'out-1.png'))))
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
      for (let py = 0; py < png.height; py++) {
        for (let px = 0; px < png.width; px++) {
          const i = (py * png.width + px) * 4
          // Dark ink over white background.
          if (png.pixels[i]! < 128) {
            if (px < xMin) xMin = px; if (px > xMax) xMax = px
            if (py < yMin) yMin = py; if (py > yMax) yMax = py
          }
        }
      }
      // 72 dpi = 1 px per pt. Ink starts at the requested top y within 2pt and
      // the column stays inside x .. x+fontSize.
      expect(Math.abs(yMin - 20)).toBeLessThanOrEqual(2)
      expect(xMin).toBeGreaterThanOrEqual(100)
      expect(xMax).toBeLessThanOrEqual(120)
      // Three 20pt full-width glyphs: the column is roughly 60pt tall.
      expect(yMax).toBeGreaterThan(60)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Path-mode text (synthetic bold/italic, variable-font instances or color
  // glyphs) is painted as vector paths with no text-showing operator, so
  // the /ToUnicode CMap is never exercised and the run would extract as nothing.
  // An invisible text overlay (render mode 3) keeps such text searchable.
  it('recovers synthetic-bold (path-mode) text via the invisible text overlay', () => {
    const font = Font.load(readFileSync(ROBOTO).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 400, height: 100, children: [
      { type: 'text', x: 20, y: 40, text: 'Bold Invoice 2026', fontId: 'd', fontSize: 16, color: '#000000', bold: true },
    ] }] }, backend)
    expect(extract(backend.toUint8Array())).toContain('Bold Invoice 2026')
  })

  it('keeps explicit outline text as pure vectors without a hidden text layer', () => {
    const font = Font.load(readFileSync(ROBOTO).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    render({ pages: [{ width: 400, height: 100, children: [
      { type: 'text', x: 20, y: 40, text: 'Outlined 42', fontId: 'd', fontSize: 16, color: '#000000', outlineText: true },
    ] }] }, backend)
    expect(extract(backend.toUint8Array()).trim()).toBe('')
  })

  // Vertical synthetic-bold text is drawn in path mode; the invisible overlay
  // must use the Identity-V vertical font variant so the column still extracts.
  it('recovers vertical synthetic-bold (path-mode) text via the invisible overlay', () => {
    const font = Font.load(readFileSync(JP_FONT).buffer as ArrayBuffer)
    const backend = new PdfBackend({ fonts: { d: font } })
    backend.beginDocument()
    backend.beginPage(200, 300)
    backend.drawText(100, 20, '縦書き報告', 'd', 18, '#000000', { writingMode: 'vertical-rl', bold: true })
    backend.endPage()
    backend.endDocument()
    expect(extract(backend.toUint8Array()).replace(/\s+/g, '')).toContain('縦書き報告')
  })
})
