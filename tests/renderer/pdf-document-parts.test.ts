// Document Part hierarchy output (ISO 32000-2 14.12): DPartRoot -> root DPart
// -> per-range DPart nodes, with page /DPart back-references and /DPM metadata.
import { describe, expect, it } from 'vitest'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { parsePdf, PdfName, PdfRef } from '../../src/pdf/pdf-parser.js'
import { collectPdfPages } from '../../src/pdf/pdf-import.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1')

describe('Document Part hierarchy', () => {
  it('emits DPartRoot, per-range DParts, page back-references, and DPM metadata', () => {
    const backend = new PdfBackend({
      fonts: {},
      documentParts: [
        { startPage: 0, endPage: 1, metadata: { Recipient: 'Alice', ChapterTitle: 'Intro' } },
        { startPage: 2, endPage: 2, metadata: { Recipient: 'Bob' } },
      ],
    })
    backend.beginDocument()
    for (let i = 0; i < 3; i++) { backend.beginPage(150, 80); backend.endPage() }
    backend.endDocument()

    const doc = parsePdf(backend.toUint8Array())
    const catalog = doc.getCatalog()
    // Catalog -> DPartRoot -> root DPart node with two child DParts.
    const dpartRoot = doc.resolve(catalog.get('DPartRoot') ?? null) as Map<string, unknown>
    expect(dpartRoot.get('Type')).toMatchObject({ name: 'DPartRoot' })
    const rootNode = doc.resolve(dpartRoot.get('DPartRootNode') ?? null) as Map<string, unknown>
    expect(rootNode.get('Type')).toMatchObject({ name: 'DPart' })
    expect(doc.resolve(rootNode.get('Parent') as never)).toBe(dpartRoot)
    const groups = doc.resolve(rootNode.get('DParts') ?? null) as unknown[]
    expect(groups).toHaveLength(1)
    const parts = doc.resolve(groups[0] as never) as unknown[]
    expect(parts).toHaveLength(2)

    const pages = collectPdfPages(doc)
    const part0 = doc.resolve(parts[0] as never) as Map<string, unknown>
    const part1 = doc.resolve(parts[1] as never) as Map<string, unknown>
    // Part 0 spans pages 0..1; Start/End reference those page objects.
    expect(doc.resolve(part0.get('Parent') as never)).toBe(rootNode)
    expect(doc.resolve(part0.get('Start') as never)).toBe(pages[0]!.dict)
    expect(doc.resolve(part0.get('End') as never)).toBe(pages[1]!.dict)
    // Single-page part 1 omits /End (Start == End).
    expect(doc.resolve(part1.get('Start') as never)).toBe(pages[2]!.dict)
    expect(part1.get('End')).toBeUndefined()
    // DPM metadata.
    const dpm0 = part0.get('DPM') as Map<string, unknown>
    expect(latin1((dpm0.get('Recipient') as { bytes: Uint8Array }).bytes)).toBe('Alice')
    expect(latin1((dpm0.get('ChapterTitle') as { bytes: Uint8Array }).bytes)).toBe('Intro')

    // Pages back-reference their DPart.
    expect(doc.resolve(pages[0]!.dict.get('DPart') as never)).toBe(part0)
    expect(doc.resolve(pages[1]!.dict.get('DPart') as never)).toBe(part0)
    expect(doc.resolve(pages[2]!.dict.get('DPart') as never)).toBe(part1)
  })

  it('rejects overlapping or out-of-range document parts', () => {
    const overlap = new PdfBackend({ fonts: {}, documentParts: [{ startPage: 0, endPage: 1 }, { startPage: 1, endPage: 2 }] })
    overlap.beginDocument()
    for (let i = 0; i < 3; i++) { overlap.beginPage(100, 100); overlap.endPage() }
    expect(() => { overlap.endDocument(); overlap.toUint8Array() }).toThrow(/without overlap|out-of-range/)
  })

  it('round-trips arbitrary depth, child grouping, namespaces, record level, and every DPM value type', () => {
    const backend = new PdfBackend({
      fonts: {},
      documentPartHierarchy: {
        nodeNameList: ['RootName', 'BatchName', 'LeafName'],
        recordLevel: 1,
        root: {
          metadata: {
            RootName: 'ProductionRun',
            Mode: { type: 'name', value: 'Duplex' },
          },
          children: [
            [{
              metadata: { BatchName: 'Batch-A', Count: 2, Enabled: true },
              children: [[
                {
                  startPage: 0,
                  metadata: {
                    LeafName: 'A-1',
                    Values: [1, false, { type: 'name', value: 'Approved' }],
                    Nested: { Copies: 3, Stock: 'A4' },
                    Timestamp: new Date('2026-07-14T00:00:00.000Z'),
                  },
                },
                { startPage: 1, metadata: { LeafName: 'A-2' } },
              ]],
            }],
            [{
              metadata: { BatchName: 'Batch-B' },
              children: [[{ startPage: 2, metadata: { LeafName: 'B-1' } }]],
            }],
          ],
        },
      },
    })
    backend.beginDocument()
    for (let i = 0; i < 3; i++) { backend.beginPage(100, 100); backend.endPage() }
    backend.endDocument()

    const bytes = backend.toUint8Array()
    expect(latin1(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const doc = parsePdf(bytes)
    const dpartRoot = doc.resolve(doc.getCatalog().get('DPartRoot') ?? null) as Map<string, unknown>
    expect(dpartRoot.get('RecordLevel')).toBe(1)
    expect((dpartRoot.get('NodeNameList') as PdfName[]).map(function (name) { return name.name })).toEqual([
      'RootName', 'BatchName', 'LeafName',
    ])
    const rootNode = doc.resolve(dpartRoot.get('DPartRootNode') as never) as Map<string, unknown>
    const rootGroups = rootNode.get('DParts') as unknown[]
    expect(rootGroups).toHaveLength(2)
    expect(doc.resolve(rootGroups[0] as never)).toHaveLength(1)
    expect(doc.resolve(rootGroups[1] as never)).toHaveLength(1)

    const importer = PdfImporter.open(bytes)
    const hierarchy = importer.importDocumentPartHierarchy()!
    expect(hierarchy.nodeNameList).toEqual(['RootName', 'BatchName', 'LeafName'])
    expect(hierarchy.recordLevel).toBe(1)
    expect(hierarchy.root.metadata).toEqual({
      RootName: 'ProductionRun',
      Mode: { type: 'name', value: 'Duplex' },
    })
    expect(hierarchy.root.children).toHaveLength(2)
    expect(hierarchy.root.children![0]![0]!.children![0]).toHaveLength(2)
    expect(hierarchy.root.children![0]![0]!.children![0]![0]!.metadata).toEqual({
      LeafName: 'A-1',
      Values: [1, false, { type: 'name', value: 'Approved' }],
      Nested: { Copies: 3, Stock: 'A4' },
      Timestamp: expect.stringMatching(/^D:20260714/),
    })
    expect(importer.importDocumentParts().map(function (part) { return [part.startPage, part.endPage] })).toEqual([
      [0, 0], [1, 1], [2, 2],
    ])
  })

  it('rejects incomplete, structurally ambiguous, and multiply-parented hierarchies', () => {
    const incomplete = new PdfBackend({
      fonts: {},
      documentPartHierarchy: { root: { children: [[{ startPage: 0 }]] } },
    })
    incomplete.beginDocument()
    incomplete.beginPage(100, 100); incomplete.endPage()
    incomplete.beginPage(100, 100); incomplete.endPage()
    expect(() => incomplete.toUint8Array()).toThrow(/does not assign page 1/)

    const ambiguous = new PdfBackend({
      fonts: {},
      documentPartHierarchy: { root: { startPage: 0, children: [[{ startPage: 0 }]] } },
    })
    ambiguous.beginDocument(); ambiguous.beginPage(100, 100); ambiguous.endPage()
    expect(() => ambiguous.toUint8Array()).toThrow(/both children and a page range/)

    const shared = { startPage: 0 }
    const multiplyParented = new PdfBackend({
      fonts: {},
      documentPartHierarchy: { root: { children: [[shared], [shared]] } },
    })
    multiplyParented.beginDocument(); multiplyParented.beginPage(100, 100); multiplyParented.endPage()
    expect(() => multiplyParented.toUint8Array()).toThrow(/exactly one parent/)
  })

  it('importDocumentParts and importArticleThreads read the structures back', () => {
    const backend = new PdfBackend({
      fonts: {},
      documentParts: [
        { startPage: 0, endPage: 1, metadata: { Recipient: 'Alice' } },
        { startPage: 2, endPage: 2 },
      ],
      articleThreads: [{
        info: { title: '連載記事', author: '編集部' },
        beads: [
          { pageIndex: 0, x: 10, y: 20, width: 80, height: 30 },
          { pageIndex: 2, x: 15, y: 25, width: 70, height: 40 },
        ],
      }],
    })
    backend.beginDocument()
    for (let i = 0; i < 3; i++) { backend.beginPage(100, 100); backend.endPage() }
    backend.endDocument()

    const importer = PdfImporter.open(backend.toUint8Array())
    expect(importer.importDocumentParts()).toEqual([
      { startPage: 0, endPage: 1, metadata: { Recipient: 'Alice' } },
      { startPage: 2, endPage: 2 },
    ])
    const threads = importer.importArticleThreads()
    expect(threads).toHaveLength(1)
    expect(threads[0]!.info).toEqual({ title: '連載記事', author: '編集部' })
    expect(threads[0]!.beads).toHaveLength(2)
    expect(threads[0]!.beads[0]).toMatchObject({ pageIndex: 0, x: 10, y: 20, width: 80, height: 30 })
    expect(threads[0]!.beads[1]).toMatchObject({ pageIndex: 2, x: 15, y: 25, width: 70, height: 40 })
  })
})
