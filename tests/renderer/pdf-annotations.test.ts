import { describe, expect, it } from 'vitest'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { parsePdf, PdfStream } from '../../src/pdf/pdf-parser.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { pdfToText } from './pdf-test-utils.js'
import type { PdfActionDef, PdfActionSubtypeDef, PdfDestinationDef, PdfDestinationFitDef, PdfOptionalContentPropertiesDef } from '../../src/types/template.js'
import type { PdfAFRelationship, PdfAnnotationSubtype, PdfPreservedAnnotation } from '../../src/renderer/pdf-backend.js'
import { buildU3dFixture } from '../helpers/u3d-fixture.js'

describe('PDF annotation output', () => {
  it('round-trips every PDF 2.0 action subtype and preserves single/array Next chains without executing them', () => {
    const subtypes: PdfActionSubtypeDef[] = [
      'GoTo', 'GoToR', 'GoToE', 'GoToDp', 'Launch', 'Thread', 'URI', 'Sound', 'Movie', 'Hide',
      'Named', 'SubmitForm', 'ResetForm', 'ImportData', 'JavaScript', 'SetOCGState',
      'Rendition', 'Trans', 'GoTo3DView', 'RichMediaExecute',
    ]
    const action = function (subtype: PdfActionSubtypeDef, index: number): PdfActionDef {
      const result: PdfActionDef = {
        subtype,
        entries: { Marker: { kind: 'string', bytes: new TextEncoder().encode(`action-${index}`) } },
      }
      if (subtype === 'GoTo') {
        result.destination = { kind: 'explicit', page: { kind: 'local', pageIndex: 0 }, fit: 'Fit', parameters: [] }
      } else if (subtype === 'GoToR' || subtype === 'GoToE') {
        result.destination = { kind: 'explicit', page: { kind: 'remote', pageNumber: 0 }, fit: 'Fit', parameters: [] }
        if (subtype === 'GoToR') {
          result.entries.F = { kind: 'string', bytes: new TextEncoder().encode('remote.pdf') }
          result.structureDestination = {
            target: { kind: 'remote', structureElementId: new TextEncoder().encode('remote-heading') },
            fit: 'FitH', parameters: [72],
          }
        }
        if (subtype === 'GoToE') {
          result.embeddedTarget = {
            relationship: 'C', page: 1,
            annotation: { kind: 'string', bytes: new TextEncoder().encode('attachment') },
            target: { relationship: 'P', target: { relationship: 'C', name: new TextEncoder().encode('child.pdf') } },
          }
        }
      } else if (subtype === 'GoToDp') {
        result.documentPartIndex = 0
      } else if (subtype === 'Launch') {
        result.launchParameters = {
          windows: {
            file: new TextEncoder().encode('viewer.exe'),
            defaultDirectory: new TextEncoder().encode('C:\\Reports'),
            operation: new TextEncoder().encode('open'),
            parameters: new TextEncoder().encode('/safe'),
          },
          mac: { F: { kind: 'string', bytes: new TextEncoder().encode('Viewer.app') } },
          unix: { F: { kind: 'string', bytes: new TextEncoder().encode('/usr/bin/viewer') } },
        }
      } else if (subtype === 'SetOCGState') {
        result.optionalContentState = [{ kind: 'operator', value: 'Toggle' }, { kind: 'group', groupId: 'layer' }]
      } else if (subtype === 'Rendition') {
        result.annotationTarget = { entry: 'AN', annotationIndex: 2 }
        result.entries.OP = 1
      } else if (subtype === 'GoTo3DView' || subtype === 'RichMediaExecute') {
        result.annotationTarget = { entry: 'TA', annotationIndex: 1 }
        if (subtype === 'GoTo3DView') result.entries.V = { kind: 'name', value: 'D' }
        else {
          result.richMediaInstanceIndex = 0
          result.entries.CMD = {
            kind: 'dictionary',
            entries: { C: { kind: 'string', bytes: new TextEncoder().encode('play') } },
          }
        }
      } else if (subtype === 'Movie') {
        result.annotationTarget = { entry: 'Annotation', annotationIndex: 3 }
      } else if (subtype === 'Hide') {
        result.fieldTargets = { entry: 'T', names: ['form.one', 'form.two'], scalar: false }
      } else if (subtype === 'SubmitForm' || subtype === 'ResetForm') {
        result.fieldTargets = { entry: 'Fields', names: ['form.one'], scalar: false }
        if (subtype === 'SubmitForm') {
          result.entries.F = { kind: 'string', bytes: new TextEncoder().encode('https://example.test/submit') }
        }
      } else if (subtype === 'Thread') {
        result.articleTarget = { threadIndex: 0, beadIndex: 0 }
      } else if (subtype === 'URI') {
        result.entries.URI = { kind: 'string', bytes: new TextEncoder().encode('https://example.test/') }
      } else if (subtype === 'Sound') {
        result.entries.Sound = {
          kind: 'stream',
          entries: { R: 8000, C: 1, B: 8, E: { kind: 'name', value: 'Raw' } },
          data: new Uint8Array([128]),
        }
      } else if (subtype === 'Named') {
        result.entries.N = { kind: 'name', value: 'NextPage' }
      } else if (subtype === 'ImportData') {
        result.entries.F = { kind: 'string', bytes: new TextEncoder().encode('values.fdf') }
      } else if (subtype === 'JavaScript') {
        result.entries.JS = { kind: 'string', bytes: new TextEncoder().encode('void 0') }
      } else if (subtype === 'Trans') {
        result.entries.Trans = { kind: 'dictionary', entries: { S: { kind: 'name', value: 'Fade' } } }
      }
      return result
    }
    const root = action(subtypes[0]!, 0)
    root.structureDestination = { target: { kind: 'local', structureElementIndex: 0 }, fit: 'Fit', parameters: [] }
    root.next = subtypes.slice(1).map(action)
    ;(root.next as PdfActionDef[])[0]!.next = action('Named', 100)
    const annotationAction = action('URI', 200)
    const pageAction = action('Trans', 201)
    const optionalContentProperties: PdfOptionalContentPropertiesDef = {
      groups: [{ kind: 'group', id: 'layer', name: 'Layer', intents: ['View'] }],
      defaultConfiguration: { baseState: 'ON', on: [], off: [], intents: ['View'], applications: [], order: [], listMode: 'AllPages', radioButtonGroups: [], locked: [] },
      configurations: [],
    }
    const backend = new PdfBackend({
      fonts: {},
      optionalContentProperties,
      documentParts: [{ startPage: 0, endPage: 0 }],
      articleThreads: [{ beads: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] }],
      documentOpenAction: root,
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 1, y: 1, width: 10, height: 10, action: annotationAction },
        {
          subtype: 'RichMedia', pageIndex: 0, x: 20, y: 1, width: 10, height: 10,
          contentType: 'Video', assetName: 'clip', mimeType: 'video/mp4', data: new Uint8Array([1]),
        },
        { subtype: 'Screen', pageIndex: 0, x: 40, y: 1, width: 10, height: 10 },
        {
          subtype: 'Movie', pageIndex: 0, x: 60, y: 1, width: 10, height: 10,
          movie: { file: { name: 'clip.mov', data: new Uint8Array([2]) } },
        },
      ],
    })
    backend.beginDocument()
    backend.setTagged('en')
    backend.beginPage(100, 100, { additionalActionModels: { O: pageAction } })
    backend.beginTaggedContent({ role: 'P', id: 'target-heading' })
    backend.endTaggedContent()
    backend.endPage()
    backend.endDocument()

    const importer = PdfImporter.open(backend.toUint8Array())
    const imported = importer.importOpenActionModel()!
    expect(imported.subtype).toBe('GoTo')
    expect(imported.destination).toEqual({ kind: 'explicit', page: { kind: 'local', pageIndex: 0 }, fit: 'Fit', parameters: [] })
    expect(imported.structureDestination).toEqual({ target: { kind: 'local', structureElementIndex: 0 }, fit: 'Fit', parameters: [] })
    expect(Array.isArray(imported.next)).toBe(true)
    expect((imported.next as PdfActionDef[]).map(function (entry) { return entry.subtype })).toEqual(subtypes.slice(1))
    const importedActions = imported.next as PdfActionDef[]
    expect(importedActions.find(function (entry) { return entry.subtype === 'GoToR' })?.structureDestination).toEqual({
      target: { kind: 'remote', structureElementId: new TextEncoder().encode('remote-heading') }, fit: 'FitH', parameters: [72],
    })
    expect(importedActions.find(function (entry) { return entry.subtype === 'SetOCGState' })?.optionalContentState).toEqual([
      { kind: 'operator', value: 'Toggle' }, { kind: 'group', groupId: expect.stringMatching(/^ocg-\d+-0$/) },
    ])
    expect(importedActions.find(function (entry) { return entry.subtype === 'GoTo3DView' })?.annotationTarget).toEqual({ entry: 'TA', annotationIndex: 1 })
    expect(importedActions.find(function (entry) { return entry.subtype === 'RichMediaExecute' })?.annotationTarget).toEqual({ entry: 'TA', annotationIndex: 1 })
    expect(importedActions.find(function (entry) { return entry.subtype === 'Rendition' })?.annotationTarget).toEqual({ entry: 'AN', annotationIndex: 2 })
    expect(importedActions.find(function (entry) { return entry.subtype === 'Movie' })?.annotationTarget).toEqual({ entry: 'Annotation', annotationIndex: 3 })
    expect(importedActions.find(function (entry) { return entry.subtype === 'RichMediaExecute' })?.richMediaInstanceIndex).toBe(0)
    expect(importedActions.find(function (entry) { return entry.subtype === 'GoToDp' })?.documentPartIndex).toBe(0)
    expect(importedActions.find(function (entry) { return entry.subtype === 'GoToE' })?.embeddedTarget).toMatchObject({
      relationship: 'C', page: 1, annotation: { kind: 'string' },
      target: { relationship: 'P', target: { relationship: 'C', name: expect.any(Uint8Array) } },
    })
    expect(importedActions.find(function (entry) { return entry.subtype === 'Launch' })?.launchParameters).toMatchObject({
      windows: { file: expect.any(Uint8Array), operation: expect.any(Uint8Array) },
      mac: { F: { kind: 'string' } }, unix: { F: { kind: 'string' } },
    })
    expect(importedActions.find(function (entry) { return entry.subtype === 'Hide' })?.fieldTargets).toEqual({
      entry: 'T', names: ['form.one', 'form.two'], scalar: false,
    })
    expect(importedActions.find(function (entry) { return entry.subtype === 'Thread' })?.articleTarget).toEqual({ threadIndex: 0, beadIndex: 0 })
    expect(((imported.next as PdfActionDef[])[0]!.next as PdfActionDef).subtype).toBe('Named')
    expect(importer.importPageProperties(0).additionalActionModels?.O.subtype).toBe('Trans')
    expect(importer.importAnnotations(0)[0]!.actionModel?.subtype).toBe('URI')

    const importedProperties = importer.importPage(0).optionalContentProperties
    const reoutput = new PdfBackend({
      fonts: {}, documentOpenAction: imported, optionalContentProperties: importedProperties,
      documentParts: [{ startPage: 0, endPage: 0 }],
      articleThreads: [{ beads: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] }],
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 1, y: 1, width: 10, height: 10 },
        {
          subtype: 'RichMedia', pageIndex: 0, x: 20, y: 1, width: 10, height: 10,
          contentType: 'Video', assetName: 'clip', mimeType: 'video/mp4', data: new Uint8Array([1]),
        },
        { subtype: 'Screen', pageIndex: 0, x: 40, y: 1, width: 10, height: 10 },
        {
          subtype: 'Movie', pageIndex: 0, x: 60, y: 1, width: 10, height: 10,
          movie: { file: { name: 'clip.mov', data: new Uint8Array([2]) } },
        },
      ],
    })
    reoutput.beginDocument()
    reoutput.setTagged('en')
    reoutput.beginPage(100, 100)
    reoutput.beginTaggedContent({ role: 'P', id: 'target-heading' })
    reoutput.endTaggedContent()
    reoutput.endPage()
    reoutput.endDocument()
    const importedAgain = PdfImporter.open(reoutput.toUint8Array()).importOpenActionModel()!
    expect((importedAgain.next as PdfActionDef[]).map(function (entry) { return entry.subtype })).toEqual(subtypes.slice(1))
    expect((importedAgain.entries.Marker as { kind: 'string'; bytes: Uint8Array }).bytes).toEqual(new TextEncoder().encode('action-0'))
  })

  it('round-trips every destination form across name trees, outlines, actions, and Link annotations', () => {
    const parameters: Record<PdfDestinationFitDef, (number | null)[]> = {
      XYZ: [12, null, 1.5], Fit: [], FitH: [72], FitV: [24], FitR: [1, 2, 90, 95],
      FitB: [], FitBH: [80], FitBV: [30],
    }
    const fits = Object.keys(parameters) as PdfDestinationFitDef[]
    const destinations = fits.map(function (fit, index) {
      return {
        name: `destination-${fit}`,
        destination: {
          kind: 'explicit', page: { kind: 'local', pageIndex: index % 2 }, fit,
          parameters: parameters[fit],
        } as PdfDestinationDef,
      }
    })
    const backend = new PdfBackend({
      fonts: {},
      namedDestinations: destinations,
      documentOpenAction: {
        subtype: 'GoToR', entries: { F: { kind: 'string', bytes: new TextEncoder().encode('remote.pdf') } },
        destination: { kind: 'named', name: 'remote-chapter', representation: 'name' },
      },
      annotations: [{
        subtype: 'Link', pageIndex: 0, x: 5, y: 5, width: 20, height: 10,
        destination: { kind: 'explicit', page: { kind: 'local', pageIndex: 1 }, fit: 'FitR', parameters: [3, 4, 50, 60] },
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.beginPage(120, 140)
    backend.endPage()
    backend.setBookmarks([
      { label: 'fit bookmark', level: 1, pageIndex: 0, y: 0, destination: destinations[2]!.destination },
      {
        label: 'named action', level: 1, pageIndex: 0, y: 0,
        action: { subtype: 'Named', entries: { N: { kind: 'name', value: 'Print' } } },
      },
    ])
    backend.endDocument()

    const importer = PdfImporter.open(backend.toUint8Array())
    expect(importer.importNamedDestinations()).toEqual(destinations.slice().sort(function (a, b) { return a.name.localeCompare(b.name) }))
    expect(importer.importOpenActionModel()?.destination).toEqual({ kind: 'named', name: 'remote-chapter', representation: 'name' })
    expect(importer.importAnnotations(0)[0]!.destination).toEqual({
      kind: 'explicit', page: { kind: 'local', pageIndex: 1 }, fit: 'FitR', parameters: [3, 4, 50, 60],
    })
    const outlines = importer.importOutlines()
    expect(outlines[0]!.destination).toEqual(destinations[2]!.destination)
    expect(outlines[1]!.actionModel).toMatchObject({ subtype: 'Named', entries: { N: { kind: 'name', value: 'Print' } } })
  })

  it('imports Launch, Hide, SubmitForm, and ResetForm Link actions structurally', () => {
    const annotations = PdfImporter.open(buildLinkActionPdf()).importAnnotations(0)
    expect(annotations.map(a => a.action)).toEqual([
      { type: 'launch', file: 'app.bin', newWindow: true },
      { type: 'hide', targets: ['field.one', 'field.two'], hide: false },
      { type: 'submitForm', url: 'https://example.test/submit', fields: ['field.one'], flags: 4 },
      { type: 'resetForm', fields: ['field.two'], flags: 1 },
    ])
  })

  it('emits text, free text, line, square, circle, highlight, stamp, and ink annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'Text',
          pageIndex: 0,
          x: 10,
          y: 20,
          width: 18,
          height: 18,
          contents: 'Review note',
          name: 'note-1',
          color: '#ffcc00',
          icon: 'Comment',
          open: true,
        },
        {
          subtype: 'FreeText',
          pageIndex: 0,
          x: 40,
          y: 20,
          width: 80,
          height: 30,
          contents: 'Free text',
          defaultAppearance: '/Helv 12 Tf 0 g',
          defaultStyle: 'font: 12pt sans-serif;',
          quadding: 1,
        },
        {
          subtype: 'Line',
          pageIndex: 0,
          x: 10,
          y: 60,
          width: 100,
          height: 20,
          contents: 'Line',
          start: [10, 70],
          end: [110, 70],
          lineEndings: ['OpenArrow', 'ClosedArrow'],
          color: '#0033ff',
          interiorColor: '#ffeecc',
        },
        {
          subtype: 'Square',
          pageIndex: 0,
          x: 10,
          y: 90,
          width: 30,
          height: 20,
          interiorColor: '#00ff00',
        },
        {
          subtype: 'Circle',
          pageIndex: 0,
          x: 50,
          y: 90,
          width: 30,
          height: 20,
          interiorColor: '#0000ff',
        },
        {
          subtype: 'Highlight',
          pageIndex: 0,
          x: 10,
          y: 120,
          width: 100,
          height: 20,
          color: '#ffff00',
          quadPoints: [[10, 120, 110, 120, 10, 140, 110, 140]],
        },
        {
          subtype: 'Stamp',
          pageIndex: 0,
          x: 10,
          y: 150,
          width: 60,
          height: 30,
          icon: 'Draft',
          contents: 'Draft stamp',
        },
        {
          subtype: 'Ink',
          pageIndex: 0,
          x: 80,
          y: 150,
          width: 80,
          height: 30,
          paths: [[[80, 160], [100, 155], [120, 165]]],
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.drawRect(0, 0, 10, 10, { fill: '#000000' })
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toContain('/Subtype /Text')
    expect(text).toContain('/Subtype /FreeText')
    expect(text).toContain('/Subtype /Line')
    expect(text).toContain('/Subtype /Square')
    expect(text).toContain('/Subtype /Circle')
    expect(text).toContain('/Subtype /Highlight')
    expect(text).toContain('/Subtype /Stamp')
    expect(text).toContain('/Subtype /Ink')

    const doc = parsePdf(bytes)
    const pages = collectPdfPages(doc)
    const annots = doc.resolve(pages[0]!.dict.get('Annots') ?? null)
    expect(annots).toBeInstanceOf(Array)
    const values = annots as unknown[]
    expect(values).toHaveLength(8)
    const first = doc.resolve(values[0] as never) as Map<string, unknown>
    expect(first.get('Subtype')).toMatchObject({ name: 'Text' })
    expect(first.get('Rect')).toEqual([10, 162, 28, 180])
    expect(first.get('C')).toEqual([1, 0.8, 0])
    expect(first.get('Name')).toMatchObject({ name: 'Comment' })
    expect(first.get('Open')).toBe(true)
    const freeText = doc.resolve(values[1] as never) as Map<string, unknown>
    expect(freeText.get('Subtype')).toMatchObject({ name: 'FreeText' })
    expect(freeText.get('Q')).toBe(1)
    const line = doc.resolve(values[2] as never) as Map<string, unknown>
    expect(line.get('L')).toEqual([10, 130, 110, 130])
    expect(line.get('LE')).toEqual([{ name: 'OpenArrow' }, { name: 'ClosedArrow' }])
    expect(line.get('IC')).toEqual([1, 0.933333333333, 0.8])
    const highlight = doc.resolve(values[5] as never) as Map<string, unknown>
    expect(highlight.get('QuadPoints')).toEqual([10, 80, 110, 80, 10, 60, 110, 60])
    const ink = doc.resolve(values[7] as never) as Map<string, unknown>
    expect(ink.get('InkList')).toEqual([[80, 40, 100, 45, 120, 35]])
  })

  it('emits file attachment annotations with embedded file streams', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [{
        subtype: 'FileAttachment',
        pageIndex: 0,
        x: 10,
        y: 20,
        width: 18,
        height: 18,
        contents: 'Attachment',
        icon: 'Paperclip',
        file: {
          name: 'note.txt',
          data: new Uint8Array([72, 105]),
          mimeType: 'text/plain',
          description: 'Attached note',
        },
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    const annot = doc.resolve(annots[0] as never) as Map<string, unknown>
    expect(annot.get('Subtype')).toMatchObject({ name: 'FileAttachment' })
    expect(annot.get('Name')).toMatchObject({ name: 'Paperclip' })
    const fs = annot.get('FS')
    expect(fs).toBeInstanceOf(Map)
    expect(latin1(((fs as Map<string, unknown>).get('F') as { bytes: Uint8Array }).bytes)).toBe('note.txt')
    expect(latin1(((fs as Map<string, unknown>).get('Desc') as { bytes: Uint8Array }).bytes)).toBe('Attached note')
    const ef = (fs as Map<string, unknown>).get('EF')
    expect(ef).toBeInstanceOf(Map)
    const stream = doc.resolve((ef as Map<string, unknown>).get('F') as never)
    expect(stream).toBeInstanceOf(PdfStream)
    expect((stream as PdfStream).dict.get('Subtype')).toMatchObject({ name: 'text/plain' })
    expect((stream as PdfStream).dict.get('Params')).toBeInstanceOf(Map)
    expect(((stream as PdfStream).dict.get('Params') as Map<string, unknown>).get('Size')).toBe(2)
    expect(doc.decodeStream(stream as PdfStream)).toEqual(new Uint8Array([72, 105]))
  })

  it('importAnnotations round-trips subtype, rectangle, contents, colors, and overlay text', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 10, y: 20, width: 18, height: 18, contents: 'Hello', name: 'n1', color: '#ff0000' },
        { subtype: 'Square', pageIndex: 0, x: 30, y: 40, width: 50, height: 25, color: '#0000ff', interiorColor: '#00ff00' },
        { subtype: 'Redact', pageIndex: 0, x: 10, y: 70, width: 60, height: 15, interiorColor: '#000000', overlayText: 'REDACTED', defaultAppearance: '/Helv 10 Tf 1 1 1 rg' },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.endPage()
    backend.endDocument()

    const annots = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)
    expect(annots.length).toBe(3)
    const text = annots.find(a => a.subtype === 'Text')!
    expect(text.contents).toBe('Hello')
    expect(text.name).toBe('n1')
    expect(text.color).toBe('#ff0000')
    expect(text.x).toBeCloseTo(10, 5)
    expect(text.y).toBeCloseTo(20, 5)
    expect(text.width).toBeCloseTo(18, 5)
    const square = annots.find(a => a.subtype === 'Square')!
    expect(square.color).toBe('#0000ff')
    expect(square.interiorColor).toBe('#00ff00')
    const redact = annots.find(a => a.subtype === 'Redact')!
    expect(redact.interiorColor).toBe('#000000')
    expect(redact.overlayText).toBe('REDACTED')
    expect(redact.defaultAppearance).toBe('/Helv 10 Tf 1 1 1 rg')
  })

  it('importAnnotations round-trips /BS styles and /BE cloudy effects', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [{
        subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 40, height: 30,
        color: '#000000', borderWidth: 3, borderStyle: 'beveled',
        borderEffect: { style: 'cloudy', intensity: 2 },
      }],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const annotation = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)[0]!
    expect(annotation.borderWidth).toBe(3)
    expect(annotation.borderStyle).toBe('beveled')
    expect(annotation.borderEffect).toEqual({ style: 'cloudy', intensity: 2 })
  })

  it('importAnnotations round-trips text-markup /QuadPoints in page coordinates', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Highlight', pageIndex: 0, x: 30, y: 40, width: 50, height: 12, color: '#ffff00',
          quadPoints: [[30, 40, 80, 40, 30, 52, 80, 52]] },
        { subtype: 'StrikeOut', pageIndex: 0, x: 30, y: 70, width: 50, height: 10, color: '#ff0000',
          quadPoints: [[30, 70, 80, 70, 30, 80, 80, 80], [30, 85, 80, 85, 30, 95, 80, 95]] },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.endPage()
    backend.endDocument()

    const annots = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)
    const hl = annots.find(a => a.subtype === 'Highlight')!
    expect(hl.quadPoints).toHaveLength(1)
    hl.quadPoints![0]!.forEach((v, i) => expect(v).toBeCloseTo([30, 40, 80, 40, 30, 52, 80, 52][i]!, 5))
    const so = annots.find(a => a.subtype === 'StrikeOut')!
    expect(so.quadPoints).toHaveLength(2)
    so.quadPoints![1]!.forEach((v, i) => expect(v).toBeCloseTo([30, 85, 80, 85, 30, 95, 80, 95][i]!, 5))
  })

  it('importAnnotations round-trips /InkList and /Vertices in page coordinates', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Ink', pageIndex: 0, x: 10, y: 10, width: 80, height: 40, color: '#ff0000',
          paths: [[[10, 10], [50, 30], [90, 10]], [[20, 40], [60, 45]]] },
        { subtype: 'Polygon', pageIndex: 0, x: 10, y: 60, width: 60, height: 30, color: '#0000ff',
          vertices: [[10, 60], [70, 60], [40, 90]] },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.endPage()
    backend.endDocument()

    const annots = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)
    const ink = annots.find(a => a.subtype === 'Ink')!
    expect(ink.inkList).toHaveLength(2)
    ink.inkList![0]!.forEach((v, i) => expect(v).toBeCloseTo([10, 10, 50, 30, 90, 10][i]!, 5))
    ink.inkList![1]!.forEach((v, i) => expect(v).toBeCloseTo([20, 40, 60, 45][i]!, 5))
    const poly = annots.find(a => a.subtype === 'Polygon')!
    poly.vertices!.forEach((v, i) => expect(v).toBeCloseTo([10, 60, 70, 60, 40, 90][i]!, 5))
  })

  it('importAnnotations round-trips /CA opacity, /BS /D dash, /M date, and /F flags', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Square', pageIndex: 0, x: 10, y: 10, width: 50, height: 30, color: '#ff0000',
          opacity: 0.5, dashArray: [4, 2], borderWidth: 2, flags: 4,
          modifiedDate: new Date(Date.UTC(2026, 6, 11, 7, 0, 0)) },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 100)
    backend.endPage()
    backend.endDocument()

    const annot = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)[0]!
    expect(annot.opacity).toBe(0.5)
    expect(annot.dashArray).toEqual([4, 2])
    expect(annot.borderWidth).toBe(2)
    expect(annot.flags).toBe(4)
    expect(annot.modifiedDate).toMatch(/^D:20260711/)
  })

  it('importAnnotations round-trips Line /L, /LE endings, and /BS border width', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Line', pageIndex: 0, x: 10, y: 10, width: 80, height: 30, color: '#ff0000',
          start: [10, 40], end: [90, 10], lineEndings: ['OpenArrow', 'None'], borderWidth: 2 },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.endPage()
    backend.endDocument()

    const annots = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)
    const line = annots.find(a => a.subtype === 'Line')!
    line.line!.forEach((v, i) => expect(v).toBeCloseTo([10, 40, 90, 10][i]!, 5))
    expect(line.lineEndings).toEqual(['OpenArrow', 'None'])
    expect(line.borderWidth).toBe(2)
  })

  it('emits redaction annotations with QuadPoints, interior color, and overlay text', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'Redact',
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 80,
          height: 20,
          quadPoints: [[10, 10, 90, 10, 10, 30, 90, 30]],
          interiorColor: '#000000',
          overlayText: 'REDACTED',
          defaultAppearance: '/Helv 10 Tf 1 1 1 rg',
          repeatOverlay: true,
          overlayQuadding: 1,
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    const annot = doc.resolve(annots[0] as never) as Map<string, unknown>
    expect(annot.get('Subtype')).toMatchObject({ name: 'Redact' })
    expect(annot.get('QuadPoints')).toBeInstanceOf(Array)
    expect(annot.get('IC')).toBeInstanceOf(Array)
    expect(latin1((annot.get('OverlayText') as { bytes: Uint8Array }).bytes)).toBe('REDACTED')
    expect(latin1((annot.get('DA') as { bytes: Uint8Array }).bytes)).toBe('/Helv 10 Tf 1 1 1 rg')
    expect(annot.get('Repeat')).toBe(true)
    expect(annot.get('Q')).toBe(1)
  })

  it('emits text markup variants and polygon annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'Underline',
          pageIndex: 0,
          x: 10,
          y: 20,
          width: 90,
          height: 14,
          quadPoints: [[10, 20, 100, 20, 10, 34, 100, 34]],
        },
        {
          subtype: 'Squiggly',
          pageIndex: 0,
          x: 10,
          y: 40,
          width: 90,
          height: 14,
          quadPoints: [[10, 40, 100, 40, 10, 54, 100, 54]],
        },
        {
          subtype: 'StrikeOut',
          pageIndex: 0,
          x: 10,
          y: 60,
          width: 90,
          height: 14,
          quadPoints: [[10, 60, 100, 60, 10, 74, 100, 74]],
        },
        {
          subtype: 'Polygon',
          pageIndex: 0,
          x: 10,
          y: 90,
          width: 60,
          height: 40,
          vertices: [[10, 90], [70, 100], [40, 130]],
          interiorColor: '#ff0000',
        },
        {
          subtype: 'PolyLine',
          pageIndex: 0,
          x: 90,
          y: 90,
          width: 80,
          height: 40,
          vertices: [[90, 130], [120, 90], [170, 120]],
          lineEndings: ['Circle', 'OpenArrow'],
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    expect(annots).toHaveLength(5)
    const underline = doc.resolve(annots[0] as never) as Map<string, unknown>
    const squiggly = doc.resolve(annots[1] as never) as Map<string, unknown>
    const strikeOut = doc.resolve(annots[2] as never) as Map<string, unknown>
    const polygon = doc.resolve(annots[3] as never) as Map<string, unknown>
    const polyLine = doc.resolve(annots[4] as never) as Map<string, unknown>
    expect(underline.get('Subtype')).toMatchObject({ name: 'Underline' })
    expect(underline.get('QuadPoints')).toEqual([10, 180, 100, 180, 10, 166, 100, 166])
    expect(squiggly.get('Subtype')).toMatchObject({ name: 'Squiggly' })
    expect(squiggly.get('QuadPoints')).toEqual([10, 160, 100, 160, 10, 146, 100, 146])
    expect(strikeOut.get('Subtype')).toMatchObject({ name: 'StrikeOut' })
    expect(strikeOut.get('QuadPoints')).toEqual([10, 140, 100, 140, 10, 126, 100, 126])
    expect(polygon.get('Subtype')).toMatchObject({ name: 'Polygon' })
    expect(polygon.get('Vertices')).toEqual([10, 110, 70, 100, 40, 70])
    expect(polygon.get('IC')).toEqual([1, 0, 0])
    expect(polyLine.get('Subtype')).toMatchObject({ name: 'PolyLine' })
    expect(polyLine.get('Vertices')).toEqual([90, 70, 120, 110, 170, 80])
    expect(polyLine.get('LE')).toEqual([{ name: 'Circle' }, { name: 'OpenArrow' }])
  })

  it('emits popup, caret, and sound annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'Text',
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 18,
          height: 18,
          contents: 'Parent note',
        },
        {
          subtype: 'Popup',
          pageIndex: 0,
          x: 30,
          y: 10,
          width: 80,
          height: 40,
          parentIndex: 0,
          open: true,
        },
        {
          subtype: 'Caret',
          pageIndex: 0,
          x: 10,
          y: 60,
          width: 12,
          height: 18,
          symbol: 'P',
          rectDifferences: [1, 2, 3, 4],
        },
        {
          subtype: 'Sound',
          pageIndex: 0,
          x: 40,
          y: 60,
          width: 18,
          height: 18,
          contents: 'Audio note',
          icon: 'Speaker',
          data: new Uint8Array([0x00, 0x7f, 0x80, 0xff]),
          sampleRate: 8000,
          channels: 1,
          bitsPerSample: 8,
          encoding: 'Signed',
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(120, 120)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    expect(annots).toHaveLength(4)
    const text = doc.resolve(annots[0] as never) as Map<string, unknown>
    const popup = doc.resolve(annots[1] as never) as Map<string, unknown>
    const caret = doc.resolve(annots[2] as never) as Map<string, unknown>
    const soundAnnot = doc.resolve(annots[3] as never) as Map<string, unknown>

    expect(text.get('Popup')).toEqual(annots[1])
    expect(popup.get('Subtype')).toMatchObject({ name: 'Popup' })
    expect(popup.get('Parent')).toEqual(annots[0])
    expect(popup.get('Open')).toBe(true)
    expect(caret.get('Subtype')).toMatchObject({ name: 'Caret' })
    expect(caret.get('Sy')).toMatchObject({ name: 'P' })
    expect(caret.get('RD')).toEqual([1, 2, 3, 4])
    expect(soundAnnot.get('Subtype')).toMatchObject({ name: 'Sound' })
    expect(soundAnnot.get('Name')).toMatchObject({ name: 'Speaker' })
    const sound = doc.resolve(soundAnnot.get('Sound') as never)
    expect(sound).toBeInstanceOf(PdfStream)
    expect((sound as PdfStream).dict.get('Type')).toMatchObject({ name: 'Sound' })
    expect((sound as PdfStream).dict.get('R')).toBe(8000)
    expect((sound as PdfStream).dict.get('C')).toBe(1)
    expect((sound as PdfStream).dict.get('B')).toBe(8)
    expect((sound as PdfStream).dict.get('E')).toMatchObject({ name: 'Signed' })
    expect(doc.decodeStream(sound as PdfStream)).toEqual(new Uint8Array([0x00, 0x7f, 0x80, 0xff]))
  })

  it('round-trips preserved appearance, additional actions, Popup relationships, and Projection dictionaries', () => {
    const uriAction: PdfActionDef = {
      subtype: 'URI',
      entries: { URI: { kind: 'string', bytes: new TextEncoder().encode('https://example.test/projection') } },
    }
    const annotations: PdfPreservedAnnotation[] = [
      {
        model: 'preserved', subtype: 'Text', pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
        entries: { Name: { kind: 'name', value: 'Comment' }, Open: true },
        appearanceState: 'Visible',
        appearanceDictionary: {
          N: {
            kind: 'stream',
            entries: { Type: { kind: 'name', value: 'XObject' }, Subtype: { kind: 'name', value: 'Form' }, BBox: { kind: 'array', items: [0, 0, 20, 20] } },
            data: new TextEncoder().encode('0 0 20 20 re S'),
          },
        },
      },
      {
        model: 'preserved', subtype: 'Popup', pageIndex: 0, x: 35, y: 10, width: 40, height: 30,
        parentIndex: 0, entries: { Open: true },
      },
      {
        model: 'preserved', subtype: 'Projection', pageIndex: 0, x: 10, y: 50, width: 60, height: 30,
        additionalActions: { E: uriAction },
        associatedFiles: [{
          name: 'projection.json', mimeType: 'application/json', relationship: 'Data',
          data: new TextEncoder().encode('{"projection":true}'),
        }],
        entries: {
          ExData: { kind: 'dictionary', entries: { Type: { kind: 'name', value: 'ExData' }, Subtype: { kind: 'name', value: 'Markup3D' } } },
        },
      },
      {
        model: 'preserved', subtype: 'Widget', pageIndex: 0, x: 75, y: 50, width: 20, height: 15,
        entries: {
          FT: { kind: 'name', value: 'Tx' },
          T: { kind: 'string', bytes: new TextEncoder().encode('projection.note') },
          V: { kind: 'string', bytes: new TextEncoder().encode('ready') },
        },
      },
    ]
    const backend = new PdfBackend({ fonts: {}, annotations })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()

    const imported = PdfImporter.open(backend.toUint8Array()).importAnnotations(0)
    expect(imported.map(function (annotation) { return annotation.subtype })).toEqual(['Text', 'Popup', 'Projection', 'Widget'])
    expect(imported[0]!.popupIndex).toBe(1)
    expect(imported[1]!.parentIndex).toBe(0)
    expect(imported[0]!.appearanceState).toBe('Visible')
    expect(imported[0]!.appearance?.N).toMatchObject({ kind: 'stream' })
    expect(imported[0]!.entries).toMatchObject({ Name: { kind: 'name', value: 'Comment' }, Open: true })
    expect(imported[2]!.entries.ExData).toMatchObject({ kind: 'dictionary' })
    expect(imported[2]!.additionalActionModels?.E.subtype).toBe('URI')
    expect(imported[2]!.associatedFiles).toMatchObject([{ name: 'projection.json', mimeType: 'application/json', relationship: 'Data' }])
    expect(imported[3]!.entries).toMatchObject({ FT: { kind: 'name', value: 'Tx' }, T: { kind: 'string' }, V: { kind: 'string' } })
    expect(PdfImporter.open(backend.toUint8Array()).importFormFields()).toMatchObject([{ name: 'projection.note', type: 'Tx', value: 'ready' }])

    const preserved = imported.map(function (annotation): PdfPreservedAnnotation {
      return {
        model: 'preserved', subtype: annotation.subtype as PdfAnnotationSubtype, pageIndex: 0,
        x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height,
        ...(annotation.contents === undefined ? {} : { contents: annotation.contents }),
        ...(annotation.name === undefined ? {} : { name: annotation.name }),
        ...(annotation.color === undefined ? {} : { color: annotation.color }),
        ...(annotation.opacity === undefined ? {} : { opacity: annotation.opacity }),
        ...(annotation.flags === undefined ? {} : { flags: annotation.flags }),
        ...(annotation.actionModel === undefined ? {} : { action: annotation.actionModel }),
        ...(annotation.destination === undefined ? {} : { destination: annotation.destination }),
        ...(annotation.additionalActionModels === undefined ? {} : { additionalActions: annotation.additionalActionModels }),
        ...(annotation.associatedFiles === undefined ? {} : {
          associatedFiles: annotation.associatedFiles.map(function (file) {
            return {
              name: file.name, data: file.data, description: file.description, mimeType: file.mimeType,
              relationship: file.relationship as PdfAFRelationship,
            }
          }),
        }),
        ...(annotation.appearance === undefined ? {} : { appearanceDictionary: annotation.appearance }),
        ...(annotation.appearanceState === undefined ? {} : { appearanceState: annotation.appearanceState }),
        ...(annotation.popupIndex === undefined ? {} : { popupIndex: annotation.popupIndex }),
        ...(annotation.parentIndex === undefined ? {} : { parentIndex: annotation.parentIndex }),
        ...(annotation.replyToIndex === undefined ? {} : { replyToIndex: annotation.replyToIndex }),
        entries: annotation.entries,
      }
    })
    const reoutput = new PdfBackend({ fonts: {}, annotations: preserved })
    reoutput.beginDocument()
    reoutput.beginPage(100, 100)
    reoutput.endPage()
    reoutput.endDocument()
    const importedAgain = PdfImporter.open(reoutput.toUint8Array()).importAnnotations(0)
    expect(importedAgain[0]!.popupIndex).toBe(1)
    expect(importedAgain[1]!.parentIndex).toBe(0)
    expect(importedAgain[2]!.additionalActionModels?.E.subtype).toBe('URI')
    expect(importedAgain[2]!.associatedFiles?.[0]!.data).toEqual(new TextEncoder().encode('{"projection":true}'))
    expect(importedAgain[2]!.entries.ExData).toMatchObject({ kind: 'dictionary' })
    expect(importedAgain[3]!.entries.FT).toMatchObject({ kind: 'name', value: 'Tx' })
  })

  it('round-trips complete nested multimedia dictionaries and renders their appearances', () => {
    const string = function (value: string) { return { kind: 'string' as const, bytes: new TextEncoder().encode(value) } }
    const name = function (value: string) { return { kind: 'name' as const, value } }
    const dictionary = function (entries: Record<string, import('../../src/types/template.js').PdfRawValueDef>) {
      return { kind: 'dictionary' as const, entries }
    }
    const array = function (items: import('../../src/types/template.js').PdfRawValueDef[]) { return { kind: 'array' as const, items } }
    const mediaStream = {
      kind: 'stream' as const,
      entries: { Type: name('EmbeddedFile'), Subtype: name('video/mp4') },
      data: new Uint8Array([0, 1, 2, 3]),
    }
    const fileSpec = dictionary({
      Type: name('Filespec'), F: string('clip.mp4'), UF: string('clip.mp4'),
      EF: dictionary({ F: mediaStream }),
    })
    const mediaClip = dictionary({
      Type: name('MediaClip'), S: name('MCD'), N: string('primary clip'), CT: string('video/mp4'), D: fileSpec,
      P: dictionary({ Type: name('MediaPermissions'), TF: string('TEMPACCESS') }),
      Alt: array([string('en-US'), string('A demonstration clip'), string('ja-JP'), string('説明映像')]),
      PL: dictionary({ Type: name('MediaPlayers'), A: array([dictionary({ Type: name('MediaPlayerInfo'), PID: dictionary({ U: string('player:example') }) })]) }),
    })
    const section = dictionary({
      Type: name('MediaClip'), S: name('MCS'), N: string('section'), D: mediaClip,
      MH: dictionary({ B: dictionary({ Type: name('MediaOffset'), S: name('T'), T: dictionary({ Type: name('Timespan'), S: name('S'), V: 1 }) }) }),
      BE: dictionary({ E: dictionary({ Type: name('MediaOffset'), S: name('F'), F: 120 }) }),
    })
    const play = dictionary({
      Type: name('MediaPlayParams'),
      MH: dictionary({ V: 100, C: true, F: 2, D: dictionary({ Type: name('MediaDuration'), S: name('T'), T: dictionary({ Type: name('Timespan'), S: name('S'), V: 4 }) }) }),
      BE: dictionary({ V: 80, C: false }),
    })
    const screen = dictionary({
      Type: name('MediaScreenParams'), MH: dictionary({ W: 0, B: array([0, 0, 0]), O: 1, M: 0 }),
      BE: dictionary({ W: 1, F: dictionary({ Type: name('FWParams'), D: array([320, 180]), P: 4, RT: 0, TT: string('Clip') }) }),
    })
    const mediaRendition = dictionary({ Type: name('Rendition'), S: name('MR'), N: string('media'), C: section, P: play, SP: screen })
    const selectorRendition = dictionary({ Type: name('Rendition'), S: name('SR'), N: string('selector'), R: array([mediaRendition]) })
    const renditionAction: PdfActionDef = {
      subtype: 'Rendition', annotationTarget: { entry: 'AN', annotationIndex: 2 },
      entries: { OP: 0, R: selectorRendition },
    }
    const richMediaAction: PdfActionDef = {
      subtype: 'RichMediaExecute', annotationTarget: { entry: 'TA', annotationIndex: 4 },
      richMediaInstanceIndex: 1,
      entries: { CMD: dictionary({ C: string('play'), A: array([string('chapter'), 2, true]) }) },
    }
    const appearance = function (): Record<string, import('../../src/types/template.js').PdfRawValueDef> {
      return {
        N: {
          kind: 'stream', entries: {
            Type: name('XObject'), Subtype: name('Form'), BBox: array([0, 0, 40, 20]), Resources: dictionary({}),
          }, data: new TextEncoder().encode('0 0 1 rg 0 0 40 20 re f'),
        },
      }
    }
    const annotations: PdfPreservedAnnotation[] = [
      {
        model: 'preserved', subtype: 'Sound', pageIndex: 0, x: 5, y: 5, width: 40, height: 20,
        appearanceDictionary: appearance(), entries: {
          Name: name('Speaker'), Sound: { kind: 'stream', entries: { Type: name('Sound'), R: 8000, C: 1, B: 8, E: name('Raw') }, data: new Uint8Array([128]) },
        },
      },
      {
        model: 'preserved', subtype: 'Movie', pageIndex: 0, x: 50, y: 5, width: 40, height: 20,
        appearanceDictionary: appearance(), entries: {
          T: string('movie'), Movie: dictionary({ F: fileSpec, Aspect: array([320, 180]), Rotate: 90, Poster: true }),
          A: true,
        },
      },
      {
        model: 'preserved', subtype: 'Screen', pageIndex: 0, x: 5, y: 35, width: 40, height: 20,
        appearanceDictionary: appearance(), action: renditionAction,
        entries: { T: string('screen'), MK: dictionary({ R: 0, BG: array([0, 0, 0]), CA: string('Play') }) },
      },
      {
        model: 'preserved', subtype: '3D', pageIndex: 0, x: 50, y: 35, width: 40, height: 20,
        appearanceDictionary: appearance(), entries: {
          '3DD': { kind: 'stream', entries: { Type: name('3D'), Subtype: name('U3D'), VA: array([dictionary({ Type: name('3DView'), XN: string('Front'), MS: name('M'), C2W: array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) })]) }, data: buildU3dFixture() },
          '3DV': name('Front'), '3DA': dictionary({ A: name('PO'), DIS: name('PI'), TB: true, NP: true }),
        },
      },
      {
        model: 'preserved', subtype: 'RichMedia', pageIndex: 0, x: 5, y: 65, width: 85, height: 20,
        appearanceDictionary: appearance(), additionalActions: { U: richMediaAction },
        entries: {
          RichMediaContent: dictionary({
            Assets: dictionary({ Names: array([string('clip.mp4'), fileSpec]) }),
            Configurations: array([dictionary({ Type: name('RichMediaConfiguration'), Subtype: name('Video'), Instances: array([
              dictionary({ Type: name('RichMediaInstance'), Subtype: name('Video'), Asset: fileSpec, Params: dictionary({ Binding: name('Foreground'), FlashVars: string('autoplay=false') }) }),
              dictionary({ Type: name('RichMediaInstance'), Subtype: name('Video'), Asset: fileSpec, Params: dictionary({ Binding: name('Background'), FlashVars: string('autoplay=true') }) }),
            ]) })]),
            Views: array([dictionary({ Type: name('3DView'), XN: string('Default') })]),
          }),
          RichMediaSettings: dictionary({ Activation: dictionary({ Condition: name('PV'), Animation: dictionary({ Subtype: name('Linear'), Speed: 1, PlayCount: 1 }) }), Deactivation: dictionary({ Condition: name('PI') }) }),
        },
      },
    ]
    const backend = new PdfBackend({ fonts: {}, annotations })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    const pdf = backend.toUint8Array()
    const importer = PdfImporter.open(pdf)
    const imported = importer.importAnnotations(0)
    expect(imported.map(function (annotation) { return annotation.subtype })).toEqual(['Sound', 'Movie', 'Screen', '3D', 'RichMedia'])
    expect(imported[0]!.entries.Sound).toMatchObject({ kind: 'stream' })
    expect(imported[1]!.entries.Movie).toMatchObject({ kind: 'dictionary', entries: { Poster: true } })
    expect(imported[2]!.actionModel?.subtype).toBe('Rendition')
    expect(imported[2]!.actionModel?.entries.R).toMatchObject({ kind: 'dictionary', entries: { S: { kind: 'name', value: 'SR' } } })
    expect(imported[3]!.entries['3DD']).toMatchObject({ kind: 'stream', entries: { Subtype: { kind: 'name', value: 'U3D' } } })
    expect(imported[4]!.entries.RichMediaContent).toMatchObject({ kind: 'dictionary' })
    expect(imported[4]!.additionalActionModels?.U.subtype).toBe('RichMediaExecute')
    expect(imported[4]!.additionalActionModels?.U.richMediaInstanceIndex).toBe(1)
    const rendered = importer.importPage(0)
    expect(rendered.elements.length).toBeGreaterThan(0)

    const reoutput = new PdfBackend({
      fonts: {},
      annotations: imported.map(function (annotation): PdfPreservedAnnotation {
        return {
          model: 'preserved', subtype: annotation.subtype as PdfAnnotationSubtype, pageIndex: 0,
          x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height,
          ...(annotation.actionModel === undefined ? {} : { action: annotation.actionModel }),
          ...(annotation.additionalActionModels === undefined ? {} : { additionalActions: annotation.additionalActionModels }),
          ...(annotation.appearance === undefined ? {} : { appearanceDictionary: annotation.appearance }),
          ...(annotation.appearanceState === undefined ? {} : { appearanceState: annotation.appearanceState }),
          entries: annotation.entries,
        }
      }),
    })
    reoutput.beginDocument()
    reoutput.beginPage(100, 100)
    reoutput.endPage()
    reoutput.endDocument()
    const importedAgain = PdfImporter.open(reoutput.toUint8Array()).importAnnotations(0)
    expect(importedAgain[2]!.actionModel?.entries.R).toMatchObject({ kind: 'dictionary', entries: { S: { kind: 'name', value: 'SR' } } })
    expect(importedAgain[3]!.threeDimensional?.data).toEqual(buildU3dFixture())
    expect(importedAgain[4]!.entries.RichMediaSettings).toMatchObject({ kind: 'dictionary' })
    expect(importedAgain[4]!.additionalActionModels?.U.entries.CMD).toMatchObject({ kind: 'dictionary' })
    expect(importedAgain[4]!.additionalActionModels?.U.richMediaInstanceIndex).toBe(1)
  })

  it('emits movie and screen annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'Movie',
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 80,
          height: 45,
          title: 'Training clip',
          contents: 'Movie annotation',
          movie: {
            file: {
              name: 'clip.mov',
              data: new Uint8Array([1, 2, 3, 4]),
              mimeType: 'video/quicktime',
              description: 'Movie clip',
            },
            aspect: [16, 9],
            rotate: 90,
            poster: true,
          },
          activation: true,
        },
        {
          subtype: 'Screen',
          pageIndex: 0,
          x: 10,
          y: 70,
          width: 80,
          height: 45,
          title: 'Playback screen',
          appearance: {
            rotation: 90,
            borderColor: '#112233',
            backgroundColor: '#445566',
            normalCaption: 'Play',
            rolloverCaption: 'Hover',
            alternateCaption: 'Down',
          },
          media: {
            name: 'Intro video',
            mimeType: 'video/mp4',
            fileName: 'intro.mp4',
            data: new Uint8Array([9, 8, 7, 6, 5]),
          },
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(120, 140)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    expect(annots).toHaveLength(2)
    const movieAnnot = doc.resolve(annots[0] as never) as Map<string, unknown>
    const screenAnnot = doc.resolve(annots[1] as never) as Map<string, unknown>
    expect(movieAnnot.get('Subtype')).toMatchObject({ name: 'Movie' })
    expect(latin1((movieAnnot.get('T') as { bytes: Uint8Array }).bytes)).toBe('Training clip')
    expect(movieAnnot.get('A')).toBe(true)
    const movie = movieAnnot.get('Movie') as Map<string, unknown>
    expect(movie.get('Aspect')).toEqual([16, 9])
    expect(movie.get('Rotate')).toBe(90)
    expect(movie.get('Poster')).toBe(true)
    const fileSpec = movie.get('F') as Map<string, unknown>
    expect(latin1((fileSpec.get('F') as { bytes: Uint8Array }).bytes)).toBe('clip.mov')
    expect(latin1((fileSpec.get('Desc') as { bytes: Uint8Array }).bytes)).toBe('Movie clip')
    const ef = fileSpec.get('EF') as Map<string, unknown>
    const stream = doc.resolve(ef.get('F') as never)
    expect(stream).toBeInstanceOf(PdfStream)
    expect((stream as PdfStream).dict.get('Subtype')).toMatchObject({ name: 'video/quicktime' })
    expect(doc.decodeStream(stream as PdfStream)).toEqual(new Uint8Array([1, 2, 3, 4]))

    expect(screenAnnot.get('Subtype')).toMatchObject({ name: 'Screen' })
    expect(latin1((screenAnnot.get('T') as { bytes: Uint8Array }).bytes)).toBe('Playback screen')
    const appearance = screenAnnot.get('MK') as Map<string, unknown>
    expect(appearance.get('R')).toBe(90)
    expect(appearance.get('BC')).toEqual([0.066666666667, 0.133333333333, 0.2])
    expect(appearance.get('BG')).toEqual([0.266666666667, 0.333333333333, 0.4])
    expect(latin1((appearance.get('CA') as { bytes: Uint8Array }).bytes)).toBe('Play')
    expect(latin1((appearance.get('RC') as { bytes: Uint8Array }).bytes)).toBe('Hover')
    expect(latin1((appearance.get('AC') as { bytes: Uint8Array }).bytes)).toBe('Down')

    // /Rendition action chain (ISO 32000 12.6.4.14 / 13.2): action -> media
    // rendition -> media clip data -> embedded file specification.
    const action = doc.resolve(screenAnnot.get('A') as never) as Map<string, unknown>
    expect(action.get('S')).toMatchObject({ name: 'Rendition' })
    expect(action.get('OP')).toBe(0)
    expect(doc.resolve(action.get('AN') as never)).toBe(screenAnnot)
    const rendition = doc.resolve(action.get('R') as never) as Map<string, unknown>
    expect(rendition.get('Type')).toMatchObject({ name: 'Rendition' })
    expect(rendition.get('S')).toMatchObject({ name: 'MR' })
    expect(latin1((rendition.get('N') as { bytes: Uint8Array }).bytes)).toBe('Intro video')
    const clip = doc.resolve(rendition.get('C') as never) as Map<string, unknown>
    expect(clip.get('Type')).toMatchObject({ name: 'MediaClip' })
    expect(clip.get('S')).toMatchObject({ name: 'MCD' })
    expect(latin1((clip.get('CT') as { bytes: Uint8Array }).bytes)).toBe('video/mp4')
    const perms = clip.get('P') as Map<string, unknown>
    expect(latin1((perms.get('TF') as { bytes: Uint8Array }).bytes)).toBe('TEMPACCESS')
    const clipSpec = clip.get('D') as Map<string, unknown>
    expect(latin1((clipSpec.get('F') as { bytes: Uint8Array }).bytes)).toBe('intro.mp4')
    const clipEf = clipSpec.get('EF') as Map<string, unknown>
    const mediaStream = doc.resolve(clipEf.get('F') as never)
    expect(mediaStream).toBeInstanceOf(PdfStream)
    expect(doc.decodeStream(mediaStream as PdfStream)).toEqual(new Uint8Array([9, 8, 7, 6, 5]))
  })

  it('emits decoded 3D annotations with a default view and activation', () => {
    const u3d = buildU3dFixture()
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: '3D',
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 100,
          height: 80,
          format: 'U3D',
          data: u3d,
          viewName: 'Default view',
          activateOnPageOpen: true,
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(150, 120)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    const annot = doc.resolve(annots[0] as never) as Map<string, unknown>
    expect(annot.get('Subtype')).toMatchObject({ name: '3D' })
    // /3DD artwork stream contains a validated ECMA-363 scene.
    const artwork = doc.resolve(annot.get('3DD') as never)
    expect(artwork).toBeInstanceOf(PdfStream)
    expect((artwork as PdfStream).dict.get('Type')).toMatchObject({ name: '3D' })
    expect((artwork as PdfStream).dict.get('Subtype')).toMatchObject({ name: 'U3D' })
    expect(doc.decodeStream(artwork as PdfStream)).toEqual(u3d)
    // Default view and page-open activation.
    const view = annot.get('3DV') as Map<string, unknown>
    expect(view.get('Type')).toMatchObject({ name: '3DView' })
    expect(latin1((view.get('XN') as { bytes: Uint8Array }).bytes)).toBe('Default view')
    const activation = annot.get('3DA') as Map<string, unknown>
    expect(activation.get('A')).toMatchObject({ name: 'PO' })
  })

  it('emits RichMedia annotations with shared asset, configuration, and settings', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'RichMedia',
          pageIndex: 0,
          x: 5,
          y: 5,
          width: 120,
          height: 90,
          contentType: 'Video',
          assetName: 'promo.mp4',
          mimeType: 'video/mp4',
          data: new Uint8Array([11, 22, 33]),
          activationCondition: 'PV',
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(150, 120)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    const annot = doc.resolve(annots[0] as never) as Map<string, unknown>
    expect(annot.get('Subtype')).toMatchObject({ name: 'RichMedia' })
    // Content: assets name tree and configuration/instance share one file spec.
    const content = annot.get('RichMediaContent') as Map<string, unknown>
    const assets = content.get('Assets') as Map<string, unknown>
    const names = assets.get('Names') as unknown[]
    expect(latin1((names[0] as { bytes: Uint8Array }).bytes)).toBe('promo.mp4')
    const assetSpec = doc.resolve(names[1] as never) as Map<string, unknown>
    expect(latin1((assetSpec.get('F') as { bytes: Uint8Array }).bytes)).toBe('promo.mp4')
    const ef = assetSpec.get('EF') as Map<string, unknown>
    const stream = doc.resolve(ef.get('F') as never)
    expect(stream).toBeInstanceOf(PdfStream)
    expect(doc.decodeStream(stream as PdfStream)).toEqual(new Uint8Array([11, 22, 33]))
    const configs = content.get('Configurations') as unknown[]
    const config = doc.resolve(configs[0] as never) as Map<string, unknown>
    expect(config.get('Type')).toMatchObject({ name: 'RichMediaConfiguration' })
    expect(config.get('Subtype')).toMatchObject({ name: 'Video' })
    const instance = doc.resolve((config.get('Instances') as unknown[])[0] as never) as Map<string, unknown>
    expect(instance.get('Type')).toMatchObject({ name: 'RichMediaInstance' })
    expect(doc.resolve(instance.get('Asset') as never)).toBe(assetSpec)
    // Settings: explicit activation override, default deactivation.
    const settings = annot.get('RichMediaSettings') as Map<string, unknown>
    expect((settings.get('Activation') as Map<string, unknown>).get('Condition')).toMatchObject({ name: 'PV' })
    expect((settings.get('Deactivation') as Map<string, unknown>).get('Condition')).toMatchObject({ name: 'XD' })
  })

  it('emits printer mark, watermark, and trap network annotations', () => {
    const backend = new PdfBackend({
      fonts: {},
      annotations: [
        {
          subtype: 'TrapNet',
          pageIndex: 0,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          lastModified: new Date(Date.UTC(2026, 6, 8, 12, 0, 0)),
          appearanceState: 'Default',
          appearances: [{ name: 'Default', bbox: [0, 0, 10, 10], content: new TextEncoder().encode('q Q') }],
        },
        {
          subtype: 'Watermark',
          pageIndex: 0,
          x: 10,
          y: 20,
          width: 60,
          height: 20,
          fixedPrint: {
            matrix: [1, 0, 0, 1, 3, 4],
            horizontalTranslation: 0.25,
            verticalTranslation: 0.75,
          },
        },
        {
          subtype: 'PrinterMark',
          pageIndex: 0,
          x: 80,
          y: 20,
          width: 20,
          height: 20,
          contents: 'registration mark',
          markName: 'RegistrationTarget',
          appearances: [{ name: 'Default', bbox: [0, 0, 20, 20], content: new TextEncoder().encode('q Q') }],
        },
      ],
    })
    backend.beginDocument()
    backend.beginPage(120, 120)
    backend.endPage()
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const page = collectPdfPages(doc)[0]!
    const annots = doc.resolve(page.dict.get('Annots') ?? null) as unknown[]
    expect(annots).toHaveLength(3)
    const watermark = doc.resolve(annots[0] as never) as Map<string, unknown>
    const printerMark = doc.resolve(annots[1] as never) as Map<string, unknown>
    const trapNet = doc.resolve(annots[2] as never) as Map<string, unknown>

    expect(watermark.get('Subtype')).toMatchObject({ name: 'Watermark' })
    const fixedPrint = watermark.get('FixedPrint') as Map<string, unknown>
    expect(fixedPrint.get('Type')).toMatchObject({ name: 'FixedPrint' })
    expect(fixedPrint.get('Matrix')).toEqual([1, 0, 0, 1, 3, 4])
    expect(fixedPrint.get('H')).toBe(0.25)
    expect(fixedPrint.get('V')).toBe(0.75)
    expect(printerMark.get('Subtype')).toMatchObject({ name: 'PrinterMark' })
    expect(trapNet.get('Subtype')).toMatchObject({ name: 'TrapNet' })
    expect(latin1((trapNet.get('LastModified') as { bytes: Uint8Array }).bytes)).toContain('D:20260708210000')
  })

  it('rejects invalid annotation page indices and empty annotation geometry lists', () => {
    const outOfRange = new PdfBackend({
      fonts: {},
      annotations: [{ subtype: 'Text', pageIndex: 1, x: 0, y: 0, width: 10, height: 10 }],
    })
    outOfRange.beginDocument()
    outOfRange.beginPage(100, 100)
    outOfRange.endPage()
    outOfRange.endDocument()
    expect(() => outOfRange.toUint8Array()).toThrow(/page index 1 out of range/)

    const emptyInk = new PdfBackend({
      fonts: {},
      annotations: [{ subtype: 'Ink', pageIndex: 0, x: 0, y: 0, width: 10, height: 10, paths: [] }],
    })
    emptyInk.beginDocument()
    emptyInk.beginPage(100, 100)
    emptyInk.endPage()
    emptyInk.endDocument()
    expect(() => emptyInk.toUint8Array()).toThrow(/requires at least one path/)

    const emptyPolygon = new PdfBackend({
      fonts: {},
      annotations: [{ subtype: 'Polygon', pageIndex: 0, x: 0, y: 0, width: 10, height: 10, vertices: [] }],
    })
    emptyPolygon.beginDocument()
    emptyPolygon.beginPage(100, 100)
    emptyPolygon.endPage()
    emptyPolygon.endDocument()
    expect(() => emptyPolygon.toUint8Array()).toThrow(/requires at least one vertex/)

    const invalidPopup = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'Text', pageIndex: 0, x: 0, y: 0, width: 10, height: 10 },
        { subtype: 'Popup', pageIndex: 0, x: 0, y: 0, width: 10, height: 10, parentIndex: 3 },
      ],
    })
    invalidPopup.beginDocument()
    invalidPopup.beginPage(100, 100)
    invalidPopup.endPage()
    invalidPopup.endDocument()
    expect(() => invalidPopup.toUint8Array()).toThrow(/parent index 3 out of range/)

    const emptySound = new PdfBackend({
      fonts: {},
      annotations: [{
        subtype: 'Sound',
        pageIndex: 0,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        data: new Uint8Array(),
        sampleRate: 8000,
        channels: 1,
        bitsPerSample: 8,
        encoding: 'Raw',
      }],
    })
    emptySound.beginDocument()
    emptySound.beginPage(100, 100)
    emptySound.endPage()
    emptySound.endDocument()
    expect(() => emptySound.toUint8Array()).toThrow(/Sound annotation data must not be empty/)

    const duplicateTrapNet = new PdfBackend({
      fonts: {},
      annotations: [
        { subtype: 'TrapNet', pageIndex: 0, x: 0, y: 0, width: 10, height: 10, lastModified: new Date(0), appearanceState: 'Default', appearances: [{ name: 'Default', bbox: [0, 0, 10, 10], content: new TextEncoder().encode('q Q') }] },
        { subtype: 'TrapNet', pageIndex: 0, x: 10, y: 0, width: 10, height: 10, lastModified: new Date(0), appearanceState: 'Default', appearances: [{ name: 'Default', bbox: [0, 0, 10, 10], content: new TextEncoder().encode('q Q') }] },
      ],
    })
    duplicateTrapNet.beginDocument()
    duplicateTrapNet.beginPage(100, 100)
    duplicateTrapNet.endPage()
    duplicateTrapNet.endDocument()
    expect(() => duplicateTrapNet.toUint8Array()).toThrow(/more than one TrapNet annotation/)
  })
})

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

function buildLinkActionPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Annots [4 0 R 5 0 R 6 0 R 7 0 R] >>',
    '<< /Type /Annot /Subtype /Link /Rect [0 80 10 90] /A << /S /Launch /F (app.bin) /NewWindow true >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [20 80 30 90] /A << /S /Hide /T [(field.one) (field.two)] /H false >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 80 50 90] /A << /S /SubmitForm /F (https://example.test/submit) /Fields [(field.one)] /Flags 4 >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [60 80 70 90] /A << /S /ResetForm /Fields [(field.two)] /Flags 1 >> >>',
  ]
  let body = ''
  let offset = 9
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    const object = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
    body += object
    offset += object.length
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  const pdf = `%PDF-1.7\n${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}
