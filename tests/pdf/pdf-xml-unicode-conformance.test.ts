import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateBcp47LanguageTag } from '../../src/pdf/language-tag.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { parsePdfDateText } from '../../src/pdf/pdf-page-importer.js'
import { parsePdfXmpPacket } from '../../src/pdf/pdf-xmp.js'
import { parseXmlDocument, xmlTextContent } from '../../src/xml/xml-parser.js'

interface FixtureCorpus {
  references: Record<string, string>
  xmlValid: Array<{ xml: string, root: string, text: string }>
  xmlInvalid: string[]
  languageTagsValid: string[]
  languageTagsInvalid: string[]
  pdfDates: Array<{ value: string, iso: string }>
  xmp: { title: string, author: string, date: string }
}

const corpus = JSON.parse(readFileSync(join(__dirname, '../../conformance/pdf-xml-unicode-fixtures.json'), 'utf8')) as FixtureCorpus

describe('fixed PDF XML/RDF/Unicode/date/language reference corpus', function () {
  it('pins every normative reference version used by the corpus', function () {
    expect(corpus.references).toEqual({
      xml: 'XML 1.0 Fifth Edition',
      xmlNamespaces: 'Namespaces in XML 1.0 Third Edition',
      rdf: 'RDF 1.1 XML Syntax',
      unicode: 'Unicode 17.0.0',
      dateTime: 'ISO 8601-1:2019',
      languageTags: 'BCP 47 / RFC 5646',
    })
  })

  it('accepts valid Unicode XML and rejects each malformed XML class', function () {
    for (const fixture of corpus.xmlValid) {
      const root = parseXmlDocument(fixture.xml)
      expect(root.name).toBe(fixture.root)
      expect(xmlTextContent(root)).toBe(fixture.text)
    }
    for (const xml of corpus.xmlInvalid) expect(() => parseXmlDocument(xml), xml).toThrow('XML parse error')
  })

  it('validates the fixed BCP 47 grammar corpus', function () {
    for (const tag of corpus.languageTagsValid) expect(() => validateBcp47LanguageTag(tag)).not.toThrow()
    for (const tag of corpus.languageTagsInvalid) expect(() => validateBcp47LanguageTag(tag), tag).toThrow('BCP 47')
  })

  it('enforces BCP 47 at the tagged-content generation and catalog import boundaries', function () {
    const backend = new PdfBackend({ fonts: {} })
    backend.setTagged('zh-Hant-TW')
    backend.beginDocument(); backend.beginPage(100, 100)
    backend.beginTaggedContent({ role: 'P', lang: 'ja-JP' }); backend.endTaggedContent()
    backend.endPage(); backend.endDocument()
    expect(PdfImporter.open(backend.toUint8Array()).importCatalogModel().language).toBe('zh-Hant-TW')

    const invalidDocument = new PdfBackend({ fonts: {} })
    expect(() => invalidDocument.setTagged('en_US')).toThrow('BCP 47')
    const invalidStructure = new PdfBackend({ fonts: {} })
    invalidStructure.setTagged('en'); invalidStructure.beginDocument(); invalidStructure.beginPage(100, 100)
    expect(() => invalidStructure.beginTaggedContent({ role: 'P', lang: 'en--US' })).toThrow('BCP 47')
  })

  it('normalizes PDF calendar dates and RDF/XMP ISO 8601 dates to instants', function () {
    for (const fixture of corpus.pdfDates) expect(parsePdfDateText(fixture.value).toISOString()).toBe(fixture.iso)
    const xmp = corpus.xmp
    const packet = new TextEncoder().encode(`<?xpacket begin="﻿"?>
<meta:xmpmeta xmlns:meta="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description
xmlns:d="http://purl.org/dc/elements/1.1/" xmlns:x="http://ns.adobe.com/xap/1.0/">
<d:title><r:Alt><r:li xml:lang="x-default">${xmp.title}</r:li></r:Alt></d:title>
<d:creator><r:Seq><r:li>${xmp.author}</r:li></r:Seq></d:creator><x:CreateDate>${xmp.date}</x:CreateDate>
</r:Description></r:RDF></meta:xmpmeta><?xpacket end="w"?>`)
    expect(parsePdfXmpPacket(packet)).toMatchObject({
      title: xmp.title,
      author: xmp.author,
      creationDate: new Date(xmp.date),
    })
  })

  it('rejects malformed XML before extracting RDF properties', function () {
    const malformed = new TextEncoder().encode('<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>')
    expect(() => parsePdfXmpPacket(malformed)).toThrow('XML parse error')
  })
})
