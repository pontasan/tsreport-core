import { describe, expect, it } from 'vitest'
import {
  PdfBackend,
  PdfStream,
  collectPdfPages,
  computePdfMediaPlacement,
  parsePdf,
  resolvePdfMediaTemporalSelection,
  resolvePdfMediaUrl,
  validatePdfMediaMimeType,
} from '../../src/index.js'

describe('PDF media normative semantics', function () {
  it('validates MIME types and resolves media URLs against the normative base', function () {
    expect(function () { validatePdfMediaMimeType('video/mp4') }).not.toThrow()
    expect(function () { validatePdfMediaMimeType('application/vnd.example+json; charset=utf-8') }).not.toThrow()
    expect(function () { validatePdfMediaMimeType('video') }).toThrow(/malformed/)
    expect(resolvePdfMediaUrl('../captions/en.vtt', 'https://example.test/media/chapter/')).toBe('https://example.test/media/captions/en.vtt')
    expect(resolvePdfMediaUrl('https://cdn.example.test/a.mp4', 'https://example.test/')).toBe('https://cdn.example.test/a.mp4')
    expect(function () { resolvePdfMediaUrl('relative.mp4') }).toThrow(/absolute base URL/)
  })

  it('resolves nested time, frame, and marker selectors with MH viability', function () {
    const selected = resolvePdfMediaTemporalSelection([
      { begin: { kind: 'time', seconds: 2 }, end: { kind: 'frame', frame: 240 } },
      { begin: { kind: 'marker', marker: 'chapter' }, end: { kind: 'time', seconds: 5 }, mustHonorBegin: true },
    ], {
      intrinsicDurationSeconds: 30,
      frameRate: 24,
      markers: { chapter: 4 },
    })
    expect(selected).toEqual({ viable: true, beginSeconds: 4, endSeconds: 9, empty: false, ignoredOffsets: [] })

    const unsupported = resolvePdfMediaTemporalSelection([
      { begin: { kind: 'marker', marker: 'chapter' }, mustHonorBegin: true },
    ], { intrinsicDurationSeconds: 30, supportsMarkers: false })
    expect(unsupported.viable).toBe(false)

    const bestEffort = resolvePdfMediaTemporalSelection([
      { begin: { kind: 'marker', marker: 'missing' } },
    ], { intrinsicDurationSeconds: 30, markers: {} })
    expect(bestEffort).toMatchObject({ viable: true, beginSeconds: 0, endSeconds: 30, empty: false })
    expect(bestEffort.ignoredOffsets).toEqual([{ kind: 'marker', marker: 'missing' }])
  })

  it('computes all media fit modes used by screen placement', function () {
    expect(computePdfMediaPlacement(200, 100, 100, 100, 0)).toEqual({ x: 0, y: 25, width: 100, height: 50, clip: false, scroll: false })
    expect(computePdfMediaPlacement(200, 100, 100, 100, 1)).toEqual({ x: -50, y: 0, width: 200, height: 100, clip: true, scroll: false })
    expect(computePdfMediaPlacement(200, 100, 100, 100, 2)).toEqual({ x: 0, y: 0, width: 100, height: 100, clip: false, scroll: false })
    expect(computePdfMediaPlacement(200, 100, 100, 100, 3).scroll).toBe(true)
    expect(computePdfMediaPlacement(200, 100, 100, 100, 4).clip).toBe(true)
    expect(computePdfMediaPlacement(200, 100, 100, 100, 5).clip).toBe(false)
  })

  it('connects complete clip, section, play, and screen parameters to P-06 output', function () {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [{
        subtype: 'Screen', pageIndex: 0, x: 5, y: 5, width: 100, height: 60,
        media: {
          name: 'Chapter', mimeType: 'video/mp4', fileName: 'chapter.mp4', data: new Uint8Array([1, 2, 3]),
          temporaryFilePermission: 'TEMPEXTRACT',
          alternateText: [{ language: 'en-US', text: 'Training chapter' }],
          baseUrl: 'https://example.test/media/', baseUrlMustBeHonored: true,
          sections: [{
            begin: { kind: 'time', seconds: 1.5 }, mustHonorBegin: true,
            end: { kind: 'frame', frame: 240 },
          }],
          playParameters: {
            volumePercent: 80, showController: true, fit: 1,
            duration: { kind: 'time', seconds: 4 }, autoPlay: false, repeatCount: 2, mustHonor: true,
          },
          screenParameters: {
            window: 0, backgroundRgb: [0.1, 0.2, 0.3], opacity: 0.75, monitor: 0, mustHonor: true,
            floatingWindow: { width: 640, height: 360, position: 4, relativeTo: 0, offscreen: 1, title: 'Chapter' },
          },
        },
      }],
    })
    backend.beginDocument()
    backend.beginPage(120, 80)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annotations = doc.resolve(page.dict.get('Annots')!) as unknown[]
    const annotation = doc.resolve(annotations[0] as never) as Map<string, unknown>
    const action = doc.resolve(annotation.get('A') as never) as Map<string, unknown>
    const rendition = doc.resolve(action.get('R') as never) as Map<string, unknown>
    const section = doc.resolve(rendition.get('C') as never) as Map<string, unknown>
    expect(section.get('S')).toMatchObject({ name: 'MCS' })
    expect(section.get('MH')).toBeInstanceOf(Map)
    expect((section.get('MH') as Map<string, unknown>).get('B')).toBeInstanceOf(Map)
    expect(section.get('BE')).toBeInstanceOf(Map)
    expect((section.get('BE') as Map<string, unknown>).get('E')).toBeInstanceOf(Map)
    const clip = doc.resolve(section.get('D') as never) as Map<string, unknown>
    expect(clip.get('S')).toMatchObject({ name: 'MCD' })
    expect((clip.get('MH') as Map<string, unknown>).get('BU')).toBeDefined()
    expect((clip.get('P') as Map<string, unknown>).get('Type')).toMatchObject({ name: 'MediaPermissions' })
    expect(clip.get('Alt')).toHaveLength(2)
    const file = clip.get('D') as Map<string, unknown>
    const ef = file.get('EF') as Map<string, unknown>
    expect(doc.resolve(ef.get('F') as never)).toBeInstanceOf(PdfStream)
    const play = rendition.get('P') as Map<string, unknown>
    expect(play.get('Type')).toMatchObject({ name: 'MediaPlayParams' })
    expect(play.get('MH')).toBeInstanceOf(Map)
    const screen = rendition.get('SP') as Map<string, unknown>
    expect(screen.get('Type')).toMatchObject({ name: 'MediaScreenParams' })
    expect(screen.get('MH')).toBeInstanceOf(Map)
  })
})
