// External font-embedding oracle: poppler's pdffonts reports how each font is
// embedded (type, encoding, embedded/subset/toUnicode flags). This validates
// the font-embedding pipeline against an independent implementation (skipped
// when pdffonts is not installed).

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'
import { Font } from '../../src/font.js'

function pdffontsPath(): string | null {
  for (const p of ['/opt/homebrew/bin/pdffonts', '/usr/bin/pdffonts', '/usr/local/bin/pdffonts']) {
    try { execFileSync(p, ['-v'], { stdio: 'ignore' }); return p } catch { /* not here */ }
  }
  try { execFileSync('pdffonts', ['-v'], { stdio: 'ignore' }); return 'pdffonts' } catch { return null }
}

const PDFFONTS = pdffontsPath()

interface FontRow { name: string, type: string, encoding: string, emb: string, sub: string, uni: string }

function reportFor(font: Font, text: string): FontRow[] {
  const backend = new PdfBackend({ fonts: { d: font } })
  render({ pages: [{ width: 400, height: 200, children: [{ type: 'text', x: 20, y: 40, text, fontId: 'd', fontSize: 16, color: '#000000' }] }] }, backend)
  const dir = mkdtempSync(join(tmpdir(), 'pdffonts-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, backend.toUint8Array())
    const out = execFileSync(PDFFONTS!, [file], { encoding: 'utf8' })
    const lines = out.split('\n').slice(2).filter(l => l.trim().length > 0)
    return lines.map((l) => {
      // Columns are whitespace-separated; the name may contain no spaces (subset+PostScript name).
      const cols = l.trim().split(/\s+/)
      // name type... encoding emb sub uni objid gen — parse from the right (type
      // is the variable-width run between name and encoding).
      const n = cols.length
      const uni = cols[n - 3]!, sub = cols[n - 4]!, emb = cols[n - 5]!, encoding = cols[n - 6]!
      return { name: cols[0]!, type: cols.slice(1, n - 6).join(' '), encoding, emb, sub, uni }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(PDFFONTS === null)('pdffonts font-embedding oracle', () => {
  it('embeds a TrueType font as a subset CID TrueType with Identity-H and ToUnicode', () => {
    const font = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf')).buffer as ArrayBuffer)
    const rows = reportFor(font, 'Embedding Test')
    expect(rows.length).toBe(1)
    const r = rows[0]!
    expect(r.type).toBe('CID TrueType')
    expect(r.encoding).toBe('Identity-H')
    expect(r.emb).toBe('yes')
    expect(r.sub).toBe('yes')
    expect(r.uni).toBe('yes')
    expect(r.name).toMatch(/^[A-Z]{6}\+Roboto-Regular$/) // subset tag
  })

  it('embeds an OpenType/CFF font as a subset CID Type 0C with Identity-H', () => {
    const font = Font.load(readFileSync(resolve(__dirname, '../fixtures/fonts/NotoSansJP-Regular.otf')).buffer as ArrayBuffer)
    const rows = reportFor(font, '日本語')
    expect(rows.length).toBe(1)
    const r = rows[0]!
    expect(r.type).toBe('CID Type 0C')
    expect(r.encoding).toBe('Identity-H')
    expect(r.emb).toBe('yes')
    expect(r.sub).toBe('yes')
    expect(r.uni).toBe('yes')
  })
})
