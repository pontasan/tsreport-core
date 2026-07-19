// Outline (bookmark) import: /Outlines chains with /Dest arrays, named
// destinations, GoTo and URI actions resolve to titles, 0-based page indices
// and top-down y coordinates. Round trips against our own outline output.

import { describe, expect, it } from 'vitest'
import { PdfBackend, PdfImporter } from '../../src/index.js'

describe('outline import', () => {
  it('round trips bookmarks produced by the PDF backend', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(200, 300)
    backend.endPage()
    backend.beginPage(200, 300)
    backend.endPage()
    backend.setBookmarks([
      { label: '第1章', level: 0, pageIndex: 0, y: 40 },
      { label: '1.1 節', level: 1, pageIndex: 0, y: 120 },
      { label: '第2章', level: 0, pageIndex: 1, y: 60 },
    ])
    backend.endDocument()
    const outlines = PdfImporter.open(backend.toUint8Array()).importOutlines()
    expect(outlines.length).toBe(2)
    expect(outlines[0]!.title).toBe('第1章')
    expect(outlines[0]!.pageIndex).toBe(0)
    expect(outlines[0]!.y).toBeCloseTo(40, 1)
    expect(outlines[0]!.children.length).toBe(1)
    expect(outlines[0]!.children[0]!.title).toBe('1.1 節')
    expect(outlines[0]!.children[0]!.y).toBeCloseTo(120, 1)
    expect(outlines[1]!.title).toBe('第2章')
    expect(outlines[1]!.pageIndex).toBe(1)
  })

  it('resolves named destinations and URI actions', () => {
    const pdf = buildOutlinePdf()
    const outlines = PdfImporter.open(pdf).importOutlines()
    expect(outlines.length).toBe(2)
    expect(outlines[0]!.title).toBe('Named')
    expect(outlines[0]!.pageIndex).toBe(0)
    expect(outlines[0]!.y).toBeCloseTo(100 - 70, 1) // /FitH 70 on a 100pt page
    expect(outlines[1]!.title).toBe('Site')
    expect(outlines[1]!.uri).toBe('https://example.com/')
    expect(outlines[1]!.pageIndex).toBeUndefined()
  })

  it('returns an empty list when the document has no outline', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(100, 100)
    backend.endPage()
    backend.endDocument()
    expect(PdfImporter.open(backend.toUint8Array()).importOutlines()).toEqual([])
  })

  it('retains non-navigation outline actions without executing them', () => {
    const pdf = buildLaunchOutlinePdf()
    const outline = PdfImporter.open(pdf).importOutlines()[0]!
    expect(outline.actionModel?.subtype).toBe('Launch')
    expect(outline.pageIndex).toBeUndefined()
  })
})

function buildOutlinePdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R /Dests << /sec1 [3 0 R /FitH 70] >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Outlines /First 6 0 R /Last 7 0 R /Count 2 >>\nendobj\n',
    '6 0 obj\n<< /Title (Named) /Parent 5 0 R /Next 7 0 R /Dest /sec1 >>\nendobj\n',
    '7 0 obj\n<< /Title (Site) /Parent 5 0 R /Prev 6 0 R /A << /S /URI /URI (https://example.com/) >> >>\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildLaunchOutlinePdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Outlines /First 6 0 R /Last 6 0 R /Count 1 >>\nendobj\n',
    '6 0 obj\n<< /Title (App) /Parent 5 0 R /A << /S /Launch /F (calc.exe) >> >>\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildObjectsPdf(objects: string[]): Uint8Array {
  let offset = '%PDF-1.7\n'.length
  const offsets: number[] = [0]
  let body = ''
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    body += objects[i]
    offset += objects[i]!.length
  }
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  const s = `%PDF-1.7\n${body}${xref}${trailer}`
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF
  return bytes
}

describe('AcroForm field value import', () => {
  it('imports the field tree with inherited types and values', () => {
    const pdf = buildAcroFormPdf()
    const fields = PdfImporter.open(pdf).importFormFields()
    expect(fields.length).toBe(3)
    expect(fields[0]!.name).toBe('customer')
    expect(fields[0]!.type).toBe('Tx')
    expect(fields[0]!.value).toBe('山田太郎')
    expect(fields[0]!.pageIndex).toBe(0)
    // Hierarchical field: parent group with an inherited /FT
    expect(fields[1]!.name).toBe('opts')
    expect(fields[1]!.children.length).toBe(1)
    expect(fields[1]!.children[0]!.name).toBe('opts.agree')
    expect(fields[1]!.children[0]!.type).toBe('Btn')
    expect(fields[1]!.children[0]!.value).toBe('On')
    expect(new TextDecoder().decode(fields[2]!.valueStream)).toBe('data')
  })

  it('returns an empty list without an AcroForm', () => {
    const pdf = buildOutlinePdf()
    expect(PdfImporter.open(pdf).importFormFields()).toEqual([])
  })

  it('retains inherited flags/defaults, widget appearances, rich values, and calculation order', () => {
    const fields = PdfImporter.open(buildCompleteAcroFormPdf()).importFormFields()
    expect(fields.map(field => field.type)).toEqual(['Tx', 'Btn', 'Ch', 'Sig'])

    const group = fields[0]!
    expect(group).toMatchObject({
      name: 'group', flags: 7, flagNames: ['ReadOnly', 'Required', 'NoExport'],
      defaultAppearance: '/Helv 10 Tf 0 g', quadding: 2,
      defaultValueRaw: { kind: 'string' },
    })
    expect(group.children).toHaveLength(2)
    expect(group.children[0]).toMatchObject({
      name: 'group.first', type: 'Tx', flags: 7,
      value: 'one', richValue: { kind: 'string' }, calculationOrderIndex: 1,
      defaultStyle: 'font: 10pt sans-serif',
      entries: { MaxLen: 25 },
      widgets: [{ pageIndex: 0, appearanceState: 'On', appearance: { N: { kind: 'stream' } } }],
      additionalActionModels: { K: { subtype: 'JavaScript', entries: { JS: { kind: 'string' } } } },
    })
    expect(group.children[1]).toMatchObject({
      name: 'group.second', type: 'Tx', calculationOrderIndex: 0,
      valueStream: expect.any(Uint8Array), richValue: { kind: 'stream' },
    })
    expect(new TextDecoder().decode(group.children[1]!.valueStream)).toBe('rich-data')

    expect(fields[1]).toMatchObject({
      type: 'Btn',
      flagNames: ['NoToggleToOff', 'Radio', 'Pushbutton', 'RadiosInUnison'],
      widgets: [{ pageIndex: 0, appearanceState: 'Choice', appearance: { N: { kind: 'dictionary' } } }],
    })
    expect(fields[2]).toMatchObject({
      type: 'Ch', flagNames: ['Combo', 'Edit', 'Sort', 'MultiSelect', 'DoNotSpellCheck', 'CommitOnSelChange'],
      entries: { Opt: { kind: 'array' }, I: { kind: 'array', items: [1] }, TI: 1 },
    })
    expect(fields[3]).toMatchObject({ type: 'Sig', flags: 0, flagNames: [] })
  })
})

function buildAcroFormPdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 8 0 R] >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    // Text field with a UTF-16BE value and a widget /P
    '5 0 obj\n<< /FT /Tx /T (customer) /V <FEFF5C71 7530592A90CE> /Subtype /Widget /P 3 0 R /Rect [10 10 90 30] >>\nendobj\n',
    // Group with inherited /FT /Btn and a named child holding /V
    '6 0 obj\n<< /FT /Btn /T (opts) /Kids [7 0 R] >>\nendobj\n',
    '7 0 obj\n<< /T (agree) /V /On /Parent 6 0 R >>\nendobj\n',
    '8 0 obj\n<< /FT /Tx /T (streamValue) /V 9 0 R >>\nendobj\n',
    '9 0 obj\n<< /Length 4 >>\nstream\ndata\nendstream\nendobj\n',
  ]
  return buildObjectsPdf(objects)
}

function buildCompleteAcroFormPdf(): Uint8Array {
  const appearance = '0 0 10 10 re f'
  const richData = 'rich-data'
  return buildObjectsPdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 10 0 R 12 0 R 13 0 R] /CO [7 0 R 6 0 R] >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /Annots [6 0 R 7 0 R 11 0 R] >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
    '5 0 obj\n<< /FT /Tx /T (group) /Ff 7 /DV (default) /DA (/Helv 10 Tf 0 g) /Q 2 /Kids [6 0 R 7 0 R] >>\nendobj\n',
    '6 0 obj\n<< /T (first) /Parent 5 0 R /Subtype /Widget /P 3 0 R /Rect [0 0 10 10] /V (one) /RV (<b>one</b>) /DS (font: 10pt sans-serif) /MaxLen 25 /AS /On /AP << /N 8 0 R >> /AA << /K << /S /JavaScript /JS (event.change;) >> >> >>\nendobj\n',
    '7 0 obj\n<< /T (second) /Parent 5 0 R /Subtype /Widget /P 3 0 R /Rect [10 0 20 10] /V 9 0 R /RV 9 0 R /AP << /N 8 0 R >> >>\nendobj\n',
    `8 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream\nendobj\n`,
    `9 0 obj\n<< /Length ${richData.length} >>\nstream\n${richData}\nendstream\nendobj\n`,
    `10 0 obj\n<< /FT /Btn /T (button) /Ff ${(1 << 14) | (1 << 15) | (1 << 16) | (1 << 25)} /Kids [11 0 R] >>\nendobj\n`,
    '11 0 obj\n<< /Type /Annot /Subtype /Widget /Parent 10 0 R /P 3 0 R /Rect [20 0 30 10] /AS /Choice /AP << /N << /Choice 8 0 R /Off 8 0 R >> >> >>\nendobj\n',
    `12 0 obj\n<< /FT /Ch /T (choice) /Ff ${(1 << 17) | (1 << 18) | (1 << 19) | (1 << 21) | (1 << 22) | (1 << 26)} /Opt [(a) [(b) (Bee)]] /I [1] /TI 1 >>\nendobj\n`,
    '13 0 obj\n<< /FT /Sig /T (signature) >>\nendobj\n',
  ])
}

describe('logical structure tree import', () => {
  it('round trips the structure our tagged output produces', async () => {
    // Build a tagged PDF via the renderer, then read the structure back
    const { render } = await import('../../src/renderer/renderer.js')
    const backend = new PdfBackend({ fonts: {} })
    render({
      tagged: true,
      pages: [{
        width: 200, height: 200,
        children: [{
          type: 'rect', x: 10, y: 10, width: 50, height: 20, fill: '#ff0000',
          tag: { role: 'P', alt: '段落' },
        }],
      }],
    }, backend)
    const tree = PdfImporter.open(backend.toUint8Array()).importStructureTree()
    expect(tree.length).toBeGreaterThan(0)
    // Find the P element (the root may be a Document container)
    const findRole = function (nodes: typeof tree, role: string): (typeof tree)[number] | null {
      for (const node of nodes) {
        if (node.role === role) return node
        const hit = findRole(node.children, role)
        if (hit !== null) return hit
      }
      return null
    }
    const p = findRole(tree, 'P')
    expect(p).not.toBeNull()
    expect(p!.alt).toBe('段落')
    expect(p!.content.length).toBeGreaterThan(0)
    expect(p!.content[0]).toEqual({ kind: 'mcid', pageIndex: 0, mcid: 0 })
  })

  it('resolves RoleMap-mapped custom roles', () => {
    const pdf = buildStructPdf()
    const tree = PdfImporter.open(pdf).importStructureTree()
    expect(tree.length).toBe(1)
    expect(tree[0]!.role).toBe('Chapter')
    expect(tree[0]!.mappedRole).toBe('Sect')
    expect(tree[0]!.content).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 3 }])
  })

  it('rejects mismatched marked-content, StructParents, and ParentTree links', () => {
    expect(() => PdfImporter.open(buildStructPdf(4, 3)).importStructureTree())
      .toThrow(/MCID 4 is missing from ParentTree/)
    expect(() => PdfImporter.open(buildStructPdf(3, 3, 9)).importStructureTree())
      .toThrow(/ParentTree key 9/)
  })

  it('decodes PDFDocEncoding text strings (bullet, trademark, Euro)', () => {
    // /Title bytes 0x80 (bullet), 0x92 (trademark), 0xA0 (Euro) are octal-escaped.
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>\nendobj\n',
      '4 0 obj\n<< /Type /Outlines /First 5 0 R /Last 5 0 R /Count 1 >>\nendobj\n',
      '5 0 obj\n<< /Title (\\200\\222\\240) /Parent 4 0 R /Dest [3 0 R /Fit] >>\nendobj\n',
    ]
    const outlines = PdfImporter.open(buildObjectsPdf(objects)).importOutlines()
    expect(outlines[0]!.title).toBe('•™€')
  })

  it('round trips /T title, Table /Summary, and /ID attributes', async () => {
    const { render } = await import('../../src/renderer/renderer.js')
    const backend = new PdfBackend({ fonts: {} })
    render({
      tagged: true,
      pages: [{
        width: 200, height: 200,
        children: [{
          type: 'group', x: 0, y: 0, width: 180, height: 60,
          tag: { role: 'Table', title: 'Sales', summary: 'Quarterly sales', id: 'tbl-1' },
          children: [{
            type: 'rect', x: 0, y: 0, width: 50, height: 20, fill: '#ff0000',
            tag: { role: 'TD' },
          }],
        }],
      }],
    }, backend)
    const tree = PdfImporter.open(backend.toUint8Array()).importStructureTree()
    const findRole = function (nodes: typeof tree, role: string): (typeof tree)[number] | null {
      for (const node of nodes) {
        if (node.role === role) return node
        const hit = findRole(node.children, role)
        if (hit !== null) return hit
      }
      return null
    }
    const table = findRole(tree, 'Table')
    expect(table).not.toBeNull()
    expect(table!.title).toBe('Sales')
    expect(table!.summary).toBe('Quarterly sales')
    expect(table!.id).toBe('tbl-1')
  })

  it('returns an empty list without a structure tree', () => {
    const pdf = buildOutlinePdf()
    expect(PdfImporter.open(pdf).importStructureTree()).toEqual([])
  })
})

function buildStructPdf(contentMcid = 3, parentMcid = 3, structParents = 0): Uint8Array {
  const content = `/Chapter << /MCID ${contentMcid} >> BDC\nEMC\n`
  const parentEntries = new Array(parentMcid).fill('null').concat('6 0 R').join(' ')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R /StructParents ${structParents} >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /StructTreeRoot /K 6 0 R /RoleMap << /Chapter /Sect >> /ParentTree 7 0 R /ParentTreeNextKey 1 >>\nendobj\n',
    `6 0 obj\n<< /Type /StructElem /S /Chapter /P 5 0 R /Pg 3 0 R /K ${contentMcid} >>\nendobj\n`,
    `7 0 obj\n<< /Nums [0 [${parentEntries}]] >>\nendobj\n`,
  ]
  return buildObjectsPdf(objects)
}
