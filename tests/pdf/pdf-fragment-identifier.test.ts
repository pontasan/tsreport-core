import { describe, expect, it } from 'vitest'
import {
  parsePdfFragmentIdentifier,
  resolvePdfFragmentIdentifier,
  serializePdfFragmentIdentifier,
} from '../../src/pdf/pdf-fragment-identifier.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'

describe('ISO 32000-2 Annex O fragment identifiers', function () {
  it('parses and serializes every object identifier and open parameter in order', function () {
    const source = '#page=2&nameddest=Table%20A&structelem=heading%2F1&comment=review-1'
      + '&zoom=125,10,20&view=FitH,42&viewrect=1,2,300,400'
      + '&highlight=1,20,2,30&search=%22annual%20report%22&fdf=forms%2Fdata.fdf'
    const parsed = parsePdfFragmentIdentifier(source)
    expect(parsed.parameters).toEqual([
      { name: 'page', pageNumber: 2 },
      { name: 'nameddest', destinationName: 'Table A' },
      { name: 'structelem', structureId: new TextEncoder().encode('heading/1') },
      { name: 'comment', annotationName: 'review-1' },
      { name: 'zoom', scale: 125, left: 10, top: 20 },
      { name: 'view', fit: 'FitH', parameters: [42] },
      { name: 'viewrect', left: 1, top: 2, width: 300, height: 400 },
      { name: 'highlight', left: 1, right: 20, top: 2, bottom: 30 },
      { name: 'search', words: ['annual', 'report'] },
      { name: 'fdf', uri: 'forms/data.fdf' },
    ])
    expect(serializePdfFragmentIdentifier(parsed)).toBe(source.slice(1))
  })

  it('stops PDF parsing after ef and retains the embedded media fragment', function () {
    const parsed = parsePdfFragmentIdentifier('page=1#ef=chapter.pdf#page=3&zoom=200')
    expect(parsed.parameters).toEqual([
      { name: 'page', pageNumber: 1 },
      { name: 'ef', embeddedFileName: 'chapter.pdf' },
    ])
    expect(parsed.embeddedFragment).toBe('page=3&zoom=200')
    expect(serializePdfFragmentIdentifier(parsed)).toBe('page=1&ef=chapter.pdf&page=3&zoom=200')
  })

  it('resolves page, named destination, structure, annotation, embedded file, and view semantics', function () {
    const resolved = resolvePdfFragmentIdentifier(parsePdfFragmentIdentifier(
      'page=2&comment=note&nameddest=summary&structelem=heading&ef=source.xml',
    ), {
      pageCount: 3,
      namedDestinations: [{
        name: 'summary',
        destination: { kind: 'explicit', page: { kind: 'local', pageIndex: 2 }, fit: 'FitH', parameters: [40] },
      }],
      structureElements: [{ id: new TextEncoder().encode('heading'), index: 7, pageIndex: 2 }],
      annotations: [{ name: 'note', index: 4, pageIndex: 1 }],
      embeddedFiles: [{ name: 'source.xml', index: 5 }],
    })
    expect(resolved).toMatchObject({
      pageIndex: 2,
      structureElementIndex: 7,
      annotationIndex: 4,
      embeddedFileIndex: 5,
      destination: { kind: 'explicit', page: { kind: 'local', pageIndex: 2 }, fit: 'FitH' },
    })
  })

  it('connects fragment resolution to a generated PDF catalog, structure tree, annotation, and embedded file', function () {
    const backend = new PdfBackend({
      fonts: {},
      namedDestinations: [{
        name: 'target',
        destination: { kind: 'explicit', page: { kind: 'local', pageIndex: 0 }, fit: 'FitH', parameters: [40] },
      }],
      annotations: [{ subtype: 'Text', pageIndex: 0, x: 5, y: 5, width: 10, height: 10, name: 'review' }],
      embeddedFiles: [{ name: 'data.xml', data: new TextEncoder().encode('<data/>'), mimeType: 'application/xml' }],
    })
    const document: RenderDocument = {
      tagged: true,
      pages: [{
        width: 200,
        height: 100,
        children: [{
          type: 'rect', x: 10, y: 10, width: 30, height: 20, fill: '#000000',
          tag: { role: 'Figure', id: 'figure-one', alt: 'Black rectangle' },
        }],
      }],
    }
    render(document, backend)
    const importer = PdfImporter.open(backend.toUint8Array())
    expect(importer.resolveFragmentIdentifier(
      'page=1&comment=review&nameddest=target&structelem=figure-one&ef=data.xml',
    )).toMatchObject({
      pageIndex: 0,
      annotationIndex: 0,
      structureElementIndex: 0,
      embeddedFileIndex: 0,
      destination: { kind: 'explicit', page: { kind: 'local', pageIndex: 0 }, fit: 'FitH', parameters: [40] },
    })
  })

  it('rejects malformed, out-of-range, unknown, and semantically unresolved parameters', function () {
    expect(() => parsePdfFragmentIdentifier('page=0')).toThrow(/positive integer/)
    expect(() => parsePdfFragmentIdentifier('zoom=100,10')).toThrow(/scale or scale,left,top/)
    expect(() => parsePdfFragmentIdentifier('view=FitR,1,2,3')).toThrow(/requires 4/)
    expect(() => parsePdfFragmentIdentifier('viewrect=1,2,0,4')).toThrow(/positive/)
    expect(() => parsePdfFragmentIdentifier('search=word')).toThrow(/quotation marks/)
    expect(() => parsePdfFragmentIdentifier('fdf=data.fdf&page=1')).toThrow(/shall be last/)
    expect(() => parsePdfFragmentIdentifier('future=value')).toThrow(/Unknown/)
    expect(() => resolvePdfFragmentIdentifier(parsePdfFragmentIdentifier('page=2'), { pageCount: 1 })).toThrow(/out of range/)
    expect(() => resolvePdfFragmentIdentifier(parsePdfFragmentIdentifier('nameddest=missing'), { pageCount: 1 })).toThrow(/does not exist/)
  })
})
