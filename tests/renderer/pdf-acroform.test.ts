// AcroForm output: formField template elements emit real /AcroForm widget
// annotations with appearance streams; the document round-trips through
// importFormFields with names, types and values intact.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createReport, Font, TextMeasurer, PdfBackend, PdfImporter } from '../../src/index.js'
import { render } from '../../src/renderer/renderer.js'
import type { ReportTemplate } from '../../src/types/template.js'
import { pdfToText } from './pdf-test-utils.js'

const font = Font.load(readFileSync(join(__dirname, '..', 'fixtures', 'fonts', 'NotoSansJP-Regular.otf')).buffer as ArrayBuffer)

function buildPdf(pdfaConformance?: 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b'): Uint8Array {
  const template: ReportTemplate = {
    page: { size: 'A4', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
    styles: [{ name: 'base', fontFamily: 'jp', fontSize: 12 }],
    bands: {
      title: {
        height: 120,
        elements: [
          {
            type: 'formField', x: 10, y: 10, width: 200, height: 24,
            fieldType: 'text', fieldName: 'customer', value: '"山田太郎"',
            style: 'base', borderColor: '#333333', backgroundColor: '#f5f5f5',
          },
          {
            type: 'formField', x: 10, y: 44, width: 200, height: 48,
            fieldType: 'text', fieldName: 'note', multiline: true, maxLength: 100,
            style: 'base',
          },
          {
            type: 'formField', x: 10, y: 100, width: 16, height: 16,
            fieldType: 'checkbox', fieldName: 'agree', checked: 'true',
            style: 'base', borderColor: '#333333',
          },
        ],
      },
    },
  }
  const doc = createReport(template, { rows: [{}] }, new Map([['jp', new TextMeasurer(font)]]))
  const backend = new PdfBackend({ fonts: { jp: font }, pdfaConformance })
  render(doc, backend)
  return backend.toUint8Array()
}

describe('AcroForm output', () => {
  it('emits widgets, appearances and the catalog /AcroForm', () => {
    const text = pdfToText(buildPdf())
    expect(text).toContain('/AcroForm')
    expect(text).toContain('/FT /Tx')
    expect(text).toContain('/FT /Btn')
    expect(text).toContain('/T (customer)')
    expect(text).toContain('/MaxLen 100')
    expect(text).toContain('/AS /Yes')
    // Appearance streams exist for the widgets
    expect(text.match(/\/Subtype \/Form/g)!.length).toBeGreaterThanOrEqual(4) // customer + note + checkbox on/off
    // Multiline flag (bit 13 = 4096)
    expect(text).toContain('/Ff 4096')
  })

  it('round trips through importFormFields', () => {
    const fields = PdfImporter.open(buildPdf()).importFormFields()
    expect(fields.length).toBe(3)
    const byName = new Map(fields.map(f => [f.name, f]))
    expect(byName.get('customer')!.type).toBe('Tx')
    expect(byName.get('customer')!.value).toBe('山田太郎')
    expect(byName.get('customer')!.pageIndex).toBe(0)
    expect(byName.get('note')!.type).toBe('Tx')
    expect(byName.get('agree')!.type).toBe('Btn')
    expect(byName.get('agree')!.value).toBe('Yes')
  })

  it('uses embedded default-appearance fonts in PDF/A', () => {
    const text = pdfToText(buildPdf('PDF/A-2b'))
    expect(text).toContain('/AcroForm')
    expect(text).toContain('/FontFile')
    expect(text).not.toContain('/BaseFont /Helvetica')
    expect(text).not.toContain('/NeedAppearances true')
  })

  it('connects keystroke, format, validate, and calculate JavaScript actions through layout and import', () => {
    const script = function (source: string) {
      return { subtype: 'JavaScript' as const, entries: { JS: { kind: 'string' as const, bytes: new TextEncoder().encode(source) } } }
    }
    const template: ReportTemplate = {
      page: { size: 'A4' },
      styles: [{ name: 'base', fontFamily: 'jp', fontSize: 12 }],
      bands: {
        title: {
          height: 30,
          elements: [{
            type: 'formField', x: 10, y: 5, width: 200, height: 20,
            fieldType: 'text', fieldName: 'amount', style: 'base', calculationOrder: 0,
            additionalActions: {
              K: script('event.change = event.change.replace(/[^0-9]/g, "");'),
              F: script('event.value = Number(event.value).toFixed(2);'),
              V: script('event.rc = Number(event.value) >= 0;'),
              C: script('event.value = Number(this.getField("quantity").value) * 10;'),
            },
          }],
        },
      },
    }
    const document = createReport(template, { rows: [{}] }, new Map([['jp', new TextMeasurer(font)]]))
    const backend = new PdfBackend({ fonts: { jp: font } })
    render(document, backend)
    const fields = PdfImporter.open(backend.toUint8Array()).importFormFields()
    const actions = fields[0]!.additionalActionModels!
    expect(Object.keys(actions)).toEqual(['K', 'F', 'V', 'C'])
    expect(actions.K).toMatchObject({ subtype: 'JavaScript', entries: { JS: { kind: 'string' } } })
    expect(new TextDecoder().decode((actions.C!.entries.JS as { kind: 'string', bytes: Uint8Array }).bytes)).toContain('quantity')
    expect(fields[0]!.calculationOrderIndex).toBe(0)
  })

  it('rejects duplicate field names explicitly', () => {
    const backend = new PdfBackend({ fonts: { jp: font } })
    backend.beginDocument()
    backend.beginPage(200, 200)
    backend.drawFormField!(10, 10, 100, 20, { type: 'formField', x: 10, y: 10, width: 100, height: 20, fieldType: 'text', name: 'dup', fontId: 'jp', fontSize: 12, color: '#000000' })
    backend.drawFormField!(10, 40, 100, 20, { type: 'formField', x: 10, y: 40, width: 100, height: 20, fieldType: 'text', name: 'dup', fontId: 'jp', fontSize: 12, color: '#000000' })
    backend.endPage()
    expect(() => { backend.endDocument(); backend.toUint8Array() }).toThrow(/Duplicate form field name/)
  })
})

describe('AcroForm all field types', () => {
  function fieldPdf(fields: Array<Partial<import('../../src/types/render.js').RenderFormField> & { fieldType: import('../../src/types/render.js').RenderFormField['fieldType'], name: string }>): Uint8Array {
    const backend = new PdfBackend({ fonts: { jp: font } })
    backend.beginDocument()
    backend.beginPage(400, 400)
    let y = 10
    for (const f of fields) {
      backend.drawFormField!(10, y, 120, 20, {
        type: 'formField', x: 10, y, width: 120, height: 20,
        fontId: 'jp', fontSize: 12, color: '#000000', ...f,
      })
      y += 30
    }
    backend.endPage()
    backend.endDocument()
    return backend.toUint8Array()
  }

  it('emits a radio group as one field with widget kids', () => {
    const text = pdfToText(fieldPdf([
      { fieldType: 'radio', name: 'plan', exportValue: 'A', checked: true },
      { fieldType: 'radio', name: 'plan', exportValue: 'B' },
      { fieldType: 'radio', name: 'plan', exportValue: 'C' },
    ]))
    // Single Btn field with the Radio flag and three kids
    expect(text).toContain('/Kids [')
    expect(text).toContain('/V /A')          // selected export value
    expect(text).toMatch(/\/Ff 49152/)       // Radio(1<<15) | NoToggleToOff(1<<14)
    expect((text.match(/\/Subtype \/Widget/g) ?? []).length).toBe(3)
    expect(text).toContain('/AS /A')
    expect(text).toContain('/AS /Off')
  })

  it('emits a dropdown (combo) with options and selection', () => {
    const text = pdfToText(fieldPdf([
      { fieldType: 'dropdown', name: 'pref', value: 'tokyo',
        options: [{ value: 'tokyo', label: '東京' }, { value: 'osaka', label: '大阪' }] },
    ]))
    expect(text).toContain('/FT /Ch')
    expect(text).toMatch(/\/Ff 131072/) // Combo
    expect(text).toContain('/Opt [')
    expect(text).toContain('/V (tokyo)')
  })

  it('emits a listbox with multi-select', () => {
    const text = pdfToText(fieldPdf([
      { fieldType: 'listbox', name: 'tags', multiSelect: true, value: 'a\nc',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] },
    ]))
    expect(text).toContain('/FT /Ch')
    expect(text).toMatch(/\/Ff 2097152/) // MultiSelect
    expect(text).toContain('/V [(a) (c)]')
  })

  it('emits a pushbutton with a caption and URI action', () => {
    const text = pdfToText(fieldPdf([
      { fieldType: 'pushbutton', name: 'go', caption: 'Submit', action: 'https://example.com/' },
    ]))
    expect(text).toContain('/FT /Btn')
    expect(text).toMatch(/\/Ff 65536/) // Pushbutton
    expect(text).toContain('/MK << /CA (Submit) >>')
    expect(text).toContain('/S /URI /URI (https://example.com/)')
  })

  it('emits a signature field', () => {
    const text = pdfToText(fieldPdf([
      { fieldType: 'signature', name: 'sign' },
    ]))
    expect(text).toContain('/FT /Sig')
    expect(text).toContain('/T (sign)')
  })

  it('a custom checkbox export value is honored', () => {
    const text = pdfToText(fieldPdf([
      { fieldType: 'checkbox', name: 'agree', exportValue: 'ACCEPTED', checked: true },
    ]))
    expect(text).toContain('/V /ACCEPTED')
    expect(text).toContain('/AS /ACCEPTED')
    expect(text).toContain('/N << /ACCEPTED ')
  })

  it('round trips a radio group and choice fields through the importer', () => {
    const pdf = fieldPdf([
      { fieldType: 'radio', name: 'size', exportValue: 'S' },
      { fieldType: 'radio', name: 'size', exportValue: 'M', checked: true },
      { fieldType: 'dropdown', name: 'color', value: 'red',
        options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }] },
    ])
    const fields = PdfImporter.open(pdf).importFormFields()
    const byName = new Map(fields.map(f => [f.name, f]))
    expect(byName.get('size')!.type).toBe('Btn')
    expect(byName.get('size')!.value).toBe('M')
    expect(byName.get('color')!.type).toBe('Ch')
    expect(byName.get('color')!.value).toBe('red')
  })

  it('round trips every field-flag family, rich/stream values, and calculation order', () => {
    const pdf = fieldPdf([
      {
        fieldType: 'text', name: 'rich', readOnly: true, required: true, noExport: true,
        multiline: true, doNotSpellCheck: true, doNotScroll: true,
        valueStream: new TextEncoder().encode('stream-value'),
        richTextStream: new TextEncoder().encode('<p>rich</p>'),
        defaultStyle: 'font: 12pt sans-serif', defaultValue: 'default', calculationOrder: 1,
      },
      { fieldType: 'text', name: 'file', fileSelect: true, calculationOrder: 0 },
      { fieldType: 'text', name: 'comb', comb: true, maxLength: 8 },
      { fieldType: 'text', name: 'password', password: true },
      {
        fieldType: 'dropdown', name: 'choice', editable: true, sort: true,
        doNotSpellCheck: true, commitOnSelectionChange: true,
        options: [{ value: 'a', label: 'A' }],
      },
      { fieldType: 'radio', name: 'radio', exportValue: 'A', radiosInUnison: true, noExport: true },
      { fieldType: 'radio', name: 'radio', exportValue: 'B', radiosInUnison: true, noExport: true },
    ])
    const fields = PdfImporter.open(pdf).importFormFields()
    const byName = new Map(fields.map(field => [field.name, field]))
    expect(byName.get('rich')).toMatchObject({
      flagNames: ['ReadOnly', 'Required', 'NoExport', 'Multiline', 'DoNotSpellCheck', 'DoNotScroll', 'RichText'],
      defaultStyle: 'font: 12pt sans-serif', calculationOrderIndex: 1,
      defaultValueRaw: { kind: 'string' }, richValue: { kind: 'stream' },
    })
    expect(new TextDecoder().decode(byName.get('rich')!.valueStream)).toBe('stream-value')
    expect(byName.get('file')).toMatchObject({ flagNames: ['FileSelect'], calculationOrderIndex: 0 })
    expect(byName.get('comb')).toMatchObject({ flagNames: ['Comb'], entries: { MaxLen: 8 } })
    expect(byName.get('password')).toMatchObject({ flagNames: ['Password'] })
    expect(byName.get('choice')).toMatchObject({
      flagNames: ['Combo', 'Edit', 'Sort', 'DoNotSpellCheck', 'CommitOnSelChange'],
    })
    expect(byName.get('radio')).toMatchObject({ flagNames: ['NoExport', 'NoToggleToOff', 'Radio', 'RadiosInUnison'] })
  })
})
