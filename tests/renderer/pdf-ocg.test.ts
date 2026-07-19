// Optional content group output: PDF layers use /OCProperties plus marked
// content so viewers and the importer can apply initial visibility.

import { describe, expect, it } from 'vitest'
import { createReport, PdfBackend, PdfImporter, render, renderToPdf } from '../../src/index.js'
import type { ReportTemplate } from '../../src/index.js'
import type { RenderDocument, RenderNode } from '../../src/types/render.js'
import type { OptionalContentDef, PdfOptionalContentGroupDef, PdfOptionalContentPropertiesDef, PdfRawValueDef } from '../../src/types/template.js'
import { pdfToText } from './pdf-test-utils.js'

function renderLayeredPdf(): Uint8Array {
  const doc: RenderDocument = {
    pages: [{
      width: 100,
      height: 100,
      children: [
        {
          type: 'group',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          optionalContent: { name: 'Visible layer', visible: true, print: true },
          children: [{ type: 'rect', x: 10, y: 10, width: 20, height: 20, fill: '#00ff00' }],
        },
        {
          type: 'group',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          optionalContent: { name: 'Hidden layer', visible: false, print: false },
          children: [{ type: 'rect', x: 40, y: 10, width: 20, height: 20, fill: '#ff0000' }],
        },
      ],
    }],
  }
  const backend = new PdfBackend({ fonts: {} })
  render(doc, backend)
  return backend.toUint8Array()
}

describe('PDF Optional Content Group output', () => {
  it('emits OCG resources, catalog properties, and marked content', () => {
    const text = pdfToText(renderLayeredPdf())
    expect(text).toContain('/OCProperties <<')
    expect(text).toContain('/Type /OCG')
    expect(text).toContain('/Name (Visible layer)')
    expect(text).toContain('/Name (Hidden layer)')
    expect(text).toContain('/Properties << /OC0')
    expect(text).toContain('/OC /OC0 BDC')
    expect(text).toContain('/OC /OC1 BDC')
    expect(text).toContain('/OFF [')
    expect(text).toContain('/PrintState /OFF')
  })

  it('promotes an explicitly requested PDF 1.4 header to the OCG minimum PDF 1.5', () => {
    const doc: RenderDocument = { pages: [{ width: 10, height: 10, children: [{
      type: 'group', x: 0, y: 0, width: 10, height: 10, optionalContent: { name: 'Layer' }, children: [],
    }] }] }
    const bytes = renderToPdf(doc, { fonts: {}, pdfVersion: '1.4' })
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-1.5')
  })

  it('round trips hidden OCG content without discarding it', () => {
    const page = PdfImporter.open(renderLayeredPdf()).importPage(0)
    const fills: string[] = []
    collectImportedFills(page.elements, fills)
    expect(fills).toContain('#00ff00')
    expect(fills).toContain('#ff0000')
    const layers = collectImportedLayers(page.elements)
    expect(layers.map((layer) => layer.optionalContent?.visible)).toEqual([true, false])
  })

  it('carries template optionalContent through layout into PDF output', () => {
    const template: ReportTemplate = {
      page: { width: 100, height: 100, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: {
        details: [{
          height: 40,
          elements: [
            {
              type: 'rectangle',
              x: 10,
              y: 10,
              width: 20,
              height: 20,
              fill: '#ff0000',
              optionalContent: { name: 'Template hidden layer', visible: false },
            },
          ],
        }],
      },
    }
    const pdf = renderToPdf(createReport(template, { rows: [{}] }), { fonts: {} })
    const text = pdfToText(pdf)
    expect(text).toContain('/Name (Template hidden layer)')
    expect(text).toContain('/OC /OC0 BDC')
    const page = PdfImporter.open(pdf).importPage(0)
    const fills: string[] = []
    collectImportedFills(page.elements, fills)
    expect(fills).toContain('#ff0000')
    expect(collectImportedLayers(page.elements)[0]!.optionalContent?.visible).toBe(false)
  })

  it('rejects OCG output for PDF 1.4 conformance modes', () => {
    const doc: RenderDocument = {
      pages: [{
        width: 100,
        height: 100,
        children: [{
          type: 'group',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          optionalContent: { name: 'Layer' },
          children: [{ type: 'rect', x: 10, y: 10, width: 20, height: 20, fill: '#00ff00' }],
        }],
      }],
    }
    const backend = new PdfBackend({ fonts: {}, pdfxConformance: 'PDF/X-1a' })
    render(doc, backend)
    expect(() => backend.toUint8Array()).toThrow(/does not allow optional content groups/)
  })

  it('emits PDF/A-2 optional-content configurations without AS applications', () => {
    const doc: RenderDocument = { pages: [{ width: 100, height: 100, children: [{
      type: 'group', x: 0, y: 0, width: 100, height: 100,
      optionalContent: { name: 'Archive layer', visible: true },
      children: [{ type: 'rect', x: 5, y: 5, width: 20, height: 20, fill: '#00ff00' }],
    }] }] }
    const backend = new PdfBackend({ fonts: {}, pdfaConformance: 'PDF/A-2b' })
    render(doc, backend)
    const text = pdfToText(backend.toUint8Array())
    expect(text).toContain('/OCProperties <<')
    expect(text).toContain('/Name (Default)')
    expect(text).toContain('/Order [')
    expect(text).not.toContain('/AS [')
  })

  it('round trips OCG intent/usage, OCMD VE, and complete configuration dictionaries', () => {
    const encoder = new TextEncoder()
    const g1: PdfOptionalContentGroupDef = {
      kind: 'group', id: 'view-ja', name: 'Japanese detail', intents: ['View'],
      usage: {
        View: rawDict({ ViewState: rawName('ON') }),
        Print: rawDict({ PrintState: rawName('OFF'), Subtype: rawName('Watermark') }),
        Zoom: rawDict({ min: 0.5, max: 2 }),
        Language: rawDict({ Lang: rawString(encoder.encode('ja-JP')), Preferred: rawName('ON') }),
        User: rawDict({ Type: rawName('Org'), Name: rawString(encoder.encode('Example Org')) }),
      },
    }
    const g2: PdfOptionalContentGroupDef = {
      kind: 'group', id: 'design', name: 'Design guides', intents: ['Design'],
      usage: { View: rawDict({ ViewState: rawName('OFF') }) },
    }
    const properties: PdfOptionalContentPropertiesDef = {
      groups: [g1, g2],
      defaultConfiguration: {
        name: 'Default layers', creator: 'tsreport-core', baseState: 'ON', on: ['view-ja'], off: ['design'], intents: ['View'],
        applications: [
          { event: 'View', groupIds: ['view-ja'], categories: ['View', 'Zoom', 'Language', 'User'] },
          { event: 'Print', groupIds: ['view-ja'], categories: ['Print'] },
        ],
        order: [{ kind: 'branch', label: 'Localized', children: [{ kind: 'group', groupId: 'view-ja' }] }, { kind: 'group', groupId: 'design' }],
        listMode: 'VisiblePages', radioButtonGroups: [['view-ja', 'design']], locked: ['design'],
      },
      configurations: [{
        name: 'Design mode', baseState: 'OFF', on: ['design'], off: [], intents: 'All', applications: [], order: [],
        listMode: 'AllPages', radioButtonGroups: [], locked: [],
      }],
    }
    const doc: RenderDocument = { pages: [{ width: 100, height: 100, children: [
      {
        type: 'group', x: 0, y: 0, width: 20, height: 20,
        optionalContent: { name: g1.name, membership: g1, properties, visible: true, print: false },
        children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#00ff00' }],
      },
      {
        type: 'group', x: 30, y: 0, width: 20, height: 20,
        optionalContent: {
          name: 'Composite membership', properties, visible: true, print: false,
          membership: { kind: 'membership', groups: [g1, g2], policy: 'AllOn', expression: { operator: 'Or', operands: [g1, { operator: 'Not', operands: [g2] }] } },
        },
        children: [{ type: 'rect', x: 0, y: 0, width: 20, height: 20, fill: '#0000ff' }],
      },
    ] }] }
    const pdf = renderToPdf(doc, { fonts: {} })
    const text = pdfToText(pdf)
    expect(text).toContain('/Type /OCMD')
    expect(text).toMatch(/\/VE \[\/Or \d+ 0 R \[\/Not \d+ 0 R\]\]/)
    expect(text).toContain('/Intent /Design')
    expect(text).toContain('/Zoom << /min 0.5 /max 2 >>')
    expect(text).toContain('/Name (Default layers)')
    expect(text).toContain('/Creator (tsreport-core)')
    expect(text).toContain('/ListMode /VisiblePages')
    expect(text).toMatch(/\/RBGroups \[\[\d+ 0 R \d+ 0 R\]\]/)
    expect(text).toMatch(/\/Locked \[\d+ 0 R\]/)
    expect(text).toContain('/Configs [<< /Name (Design mode) /BaseState /OFF')

    const imported = PdfImporter.open(pdf).importPage(0, { optionalContentContext: { event: 'View', zoom: 3, language: 'ja-JP', user: { organization: 'Example Org' } } })
    const layers = collectImportedLayers(imported.elements)
    expect(layers).toHaveLength(2)
    expect(layers[0]!.optionalContent?.visible).toBe(false)
    expect(layers[1]!.optionalContent?.membership).toMatchObject({ kind: 'membership', policy: 'AllOn', expression: { operator: 'Or' } })
    expect(imported.optionalContentProperties).toMatchObject({
      defaultConfiguration: { name: 'Default layers', creator: 'tsreport-core', listMode: 'VisiblePages' },
      configurations: [{ name: 'Design mode', baseState: 'OFF', intents: 'All' }],
    })
    const importedDesign = imported.optionalContentProperties!.groups.find((group) => group.name === 'Design guides')!
    expect(imported.optionalContentProperties!.defaultConfiguration.locked).toEqual([importedDesign.id])
    const report = createReport({
      page: { width: imported.width, height: imported.height, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      bands: { details: [{ height: imported.height, elements: imported.elements }] },
    }, { rows: [{}] })
    const secondPdf = renderToPdf(report, { fonts: {} })
    const secondImport = PdfImporter.open(secondPdf).importPage(0)
    expect(secondImport.optionalContentProperties).toMatchObject({
      defaultConfiguration: { name: 'Default layers', listMode: 'VisiblePages' },
      configurations: [{ name: 'Design mode', baseState: 'OFF' }],
    })
  })

  it('emits catalog optional-content configurations even when no page content references a group', () => {
    const group: PdfOptionalContentGroupDef = { kind: 'group', id: 'unreferenced', name: 'Unreferenced layer', intents: ['View'] }
    const properties: PdfOptionalContentPropertiesDef = {
      groups: [group],
      defaultConfiguration: { baseState: 'ON', on: [], off: [], intents: ['View'], applications: [], order: [], listMode: 'AllPages', radioButtonGroups: [], locked: [] },
      configurations: [],
    }
    const text = pdfToText(renderToPdf({ pages: [{ width: 10, height: 10, children: [] }] }, { fonts: {}, optionalContentProperties: properties }))
    expect(text).toContain('/Name (Unreferenced layer)')
    expect(text).toContain('/OCProperties <<')
  })
})

function rawName(value: string): PdfRawValueDef { return { kind: 'name', value } }
function rawString(bytes: Uint8Array): PdfRawValueDef { return { kind: 'string', bytes } }
function rawDict(entries: Record<string, PdfRawValueDef>): PdfRawValueDef { return { kind: 'dictionary', entries } }

function collectFills(nodes: RenderNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === 'rect' && typeof node.fill === 'string') out.push(node.fill)
    if (node.type === 'path' && typeof node.fill === 'string') out.push(node.fill)
    if (node.type === 'group') collectFills(node.children, out)
  }
}

function collectImportedFills(nodes: Array<{ type: string, fill?: unknown, elements?: unknown[] }>, out: string[]): void {
  for (const node of nodes) {
    if ((node.type === 'rectangle' || node.type === 'path') && typeof node.fill === 'string') out.push(node.fill)
    if (node.elements !== undefined) collectImportedFills(node.elements as Array<{ type: string, fill?: unknown, elements?: unknown[] }>, out)
  }
}

function collectImportedLayers(nodes: Array<{ type: string, optionalContent?: OptionalContentDef, elements?: unknown[] }>): Array<{ optionalContent?: OptionalContentDef }> {
  const out: Array<{ optionalContent?: OptionalContentDef }> = []
  for (const node of nodes) {
    if (node.optionalContent !== undefined) out.push(node)
    if (node.elements !== undefined) out.push(...collectImportedLayers(node.elements as Array<{ type: string, optionalContent?: OptionalContentDef, elements?: unknown[] }>))
  }
  return out
}
