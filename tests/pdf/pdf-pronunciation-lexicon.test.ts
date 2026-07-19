import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../../src/font.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { parsePdfPronunciationLexicon, resolvePdfPronunciation } from '../../src/pdf/pdf-pronunciation-lexicon.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { render } from '../../src/renderer/renderer.js'

const english = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0" alphabet="ipa" xml:lang="en-US">
  <lexeme><grapheme>record</grapheme><phoneme ph="ˈrɛkərd"/></lexeme>
  <lexeme><grapheme>SQL</grapheme><alias>sequel</alias></lexeme>
</lexicon>`)

const fallback = new TextEncoder().encode(`<pls:lexicon xmlns:pls="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0" alphabet="x-sampa" xml:lang="en-US">
  <pls:lexeme><pls:grapheme>record</pls:grapheme><pls:phoneme ph="rI'kO:d"/></pls:lexeme>
</pls:lexicon>`)

function font(): Font {
  const bytes = readFileSync(resolve(__dirname, '../fixtures/fonts/Roboto-Regular.ttf'))
  return Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

describe('PDF 2.0 pronunciation lexicons', () => {
  it('parses PLS 1.0 namespaces and resolves the first document-order match', () => {
    const first = parsePdfPronunciationLexicon(english)
    const second = parsePdfPronunciationLexicon(fallback)
    expect(first).toMatchObject({ language: 'en-US', alphabet: 'ipa' })
    expect(resolvePdfPronunciation([first, second], 'record', 'en-US')).toMatchObject({
      lexiconIndex: 0, phoneme: 'ˈrɛkərd', alphabet: 'ipa',
    })
    expect(resolvePdfPronunciation([first, second], 'SQL')).toMatchObject({ lexiconIndex: 0, alias: 'sequel' })
    expect(resolvePdfPronunciation([first, second], 'missing')).toBeNull()
  })

  it('rejects malformed or semantically incomplete PLS documents', () => {
    expect(() => parsePdfPronunciationLexicon(new TextEncoder().encode('<lexicon/>'))).toThrow(/namespace/)
    expect(() => parsePdfPronunciationLexicon(new TextEncoder().encode(
      '<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0" xml:lang="en"><lexeme><grapheme>x</grapheme></lexeme></lexicon>',
    ))).toThrow(/either phonemes or aliases/)
  })

  it('connects PronunciationLexicon and Phoneme through generation and import', () => {
    const backend = new PdfBackend({
      fonts: { d: font() },
      embeddedFiles: [
        { name: 'english.pls', data: english, mimeType: 'application/pls+xml' },
        { name: 'fallback.pls', data: fallback, mimeType: 'application/pls+xml' },
      ],
    })
    render({
      tagged: true,
      pronunciationLexiconFileIndexes: [0, 1],
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'record', fontId: 'd', fontSize: 12, color: '#000000',
        tag: { role: 'Span', phoneme: "rI'kO:d", phoneticAlphabet: 'x-sampa' },
      }] }],
    }, backend)
    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const importer = PdfImporter.open(bytes)
    const model = importer.importStructureModel()!
    expect(model.pronunciationLexiconFileIndexes).toEqual([0, 1])
    expect(model.pronunciationLexicons.map(function (item) { return item.lexicon.alphabet })).toEqual(['ipa', 'x-sampa'])
    expect(model.roots[0]).toMatchObject({ phoneme: "rI'kO:d", phoneticAlphabet: 'x-sampa' })

    const rewritten = new PdfBackend({ fonts: { d: font() }, embeddedFiles: importer.importEmbeddedFiles() })
    render({
      tagged: true,
      pronunciationLexiconFileIndexes: model.pronunciationLexiconFileIndexes,
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'record', fontId: 'd', fontSize: 12, color: '#000000',
        tag: { role: 'Span', phoneme: model.roots[0]!.phoneme, phoneticAlphabet: model.roots[0]!.phoneticAlphabet },
      }] }],
    }, rewritten)
    expect(PdfImporter.open(rewritten.toUint8Array()).importStructureModel()!.pronunciationLexiconFileIndexes).toEqual([0, 1])
  })
})
