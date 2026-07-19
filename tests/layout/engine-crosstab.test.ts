/**
 * Crosstab engine integration tests.
 *
 * Places a type: 'crosstab' element in a createReport() template and verifies that
 * layoutCrosstab is invoked correctly and its RenderGroup is integrated into the render tree.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { createReport, type FontMap } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderGroup, RenderText, RenderRect } from '../../src/types/render.js'

const fontBuf = readFileSync('tests/fixtures/fonts/Roboto-Regular.ttf')
const font = Font.load(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength) as ArrayBuffer)
const fontMap: FontMap = new Map()
fontMap.set('default', new TextMeasurer(font))

const salesData = [
  { region: 'East', product: 'Widget', amount: 100 },
  { region: 'East', product: 'Gadget', amount: 200 },
  { region: 'West', product: 'Widget', amount: 150 },
  { region: 'West', product: 'Gadget', amount: 250 },
  { region: 'East', product: 'Widget', amount: 50 },
]

describe('Crosstab engine integration', () => {
  // Verifies that a crosstab in the title band renders row/column headers and summed cell values.
  it('renders a basic crosstab in title band', () => {
    const template: ReportTemplate = {
      page: { width: 400, height: 300, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
      bands: {
        title: {
          height: 200,
          elements: [{
            type: 'crosstab',
            x: 0, y: 0, width: 380, height: 200,
            rowGroups: [{ field: 'region' }],
            columnGroups: [{ field: 'product' }],
            measures: [{ field: 'amount', calculation: 'sum' }],
            border: { color: '#000000', width: 0.5 },
          }],
        },
        details: [],
      },
    }

    const doc = createReport(template, { rows: salesData }, fontMap)
    expect(doc.pages.length).toBe(1)

    const page = doc.pages[0]!

    // Collect all text nodes from the page
    const textNodes: RenderText[] = []
    function collectTexts(node: any): void {
      if (node.type === 'text') textNodes.push(node)
      if (node.children) for (const c of node.children) collectTexts(c)
    }
    collectTexts(page)

    const texts = textNodes.map(t => t.text)
    expect(texts).toContain('East')
    expect(texts).toContain('West')
    expect(texts).toContain('Widget')
    expect(texts).toContain('Gadget')
    // East+Widget = 100+50 = 150
    expect(texts).toContain('150')
    // East+Gadget = 200
    expect(texts).toContain('200')
    // West+Widget = 150
    // West+Gadget = 250
    expect(texts).toContain('250')
  })

  // Verifies that showGrandTotal adds Total row/column headers and the overall grand total value.
  it('renders crosstab with showGrandTotal', () => {
    const template: ReportTemplate = {
      page: { width: 500, height: 300, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
      bands: {
        title: {
          height: 200,
          elements: [{
            type: 'crosstab',
            x: 0, y: 0, width: 480, height: 200,
            rowGroups: [{ field: 'region' }],
            columnGroups: [{ field: 'product' }],
            measures: [{ field: 'amount', calculation: 'sum' }],
            showGrandTotal: true,
            border: { color: '#000000', width: 0.5 },
          }],
        },
        details: [],
      },
    }

    const doc = createReport(template, { rows: salesData }, fontMap)

    const textNodes: RenderText[] = []
    function collectTexts(node: any): void {
      if (node.type === 'text') textNodes.push(node)
      if (node.children) for (const c of node.children) collectTexts(c)
    }
    collectTexts(doc.pages[0]!)

    const texts = textNodes.map(t => t.text)
    // Grand total row/column header
    expect(texts.filter(t => t === 'Total').length).toBeGreaterThanOrEqual(2)
    // Grand total: 100+200+150+250+50 = 750
    expect(texts).toContain('750')
  })

  // Verifies that the count calculation aggregates row counts per cell instead of summing values.
  it('renders crosstab with count calculation', () => {
    const template: ReportTemplate = {
      page: { width: 400, height: 300, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
      bands: {
        title: {
          height: 200,
          elements: [{
            type: 'crosstab',
            x: 0, y: 0, width: 380, height: 200,
            rowGroups: [{ field: 'region' }],
            columnGroups: [{ field: 'product' }],
            measures: [{ field: 'amount', calculation: 'count' }],
          }],
        },
        details: [],
      },
    }

    const doc = createReport(template, { rows: salesData }, fontMap)

    const textNodes: RenderText[] = []
    function collectTexts(node: any): void {
      if (node.type === 'text') textNodes.push(node)
      if (node.children) for (const c of node.children) collectTexts(c)
    }
    collectTexts(doc.pages[0]!)

    const texts = textNodes.map(t => t.text)
    // East+Widget has 2 rows, East+Gadget has 1
    expect(texts).toContain('2')
    expect(texts).toContain('1')
  })

  // Verifies that dataSourceExpression overrides the main datasource as the crosstab input.
  it('renders crosstab with dataSourceExpression', () => {
    const customData = [
      { cat: 'A', type: 'X', val: 10 },
      { cat: 'A', type: 'Y', val: 20 },
      { cat: 'B', type: 'X', val: 30 },
    ]

    const template: ReportTemplate = {
      page: { width: 400, height: 300, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
      bands: {
        title: {
          height: 200,
          elements: [{
            type: 'crosstab',
            x: 0, y: 0, width: 380, height: 200,
            rowGroups: [{ field: 'cat' }],
            columnGroups: [{ field: 'type' }],
            measures: [{ field: 'val', calculation: 'sum' }],
            dataSourceExpression: () => customData,
          }],
        },
        details: [],
      },
    }

    // Main data is different — crosstab should use dataSourceExpression
    const doc = createReport(template, { rows: salesData }, fontMap)

    const textNodes: RenderText[] = []
    function collectTexts(node: any): void {
      if (node.type === 'text') textNodes.push(node)
      if (node.children) for (const c of node.children) collectTexts(c)
    }
    collectTexts(doc.pages[0]!)

    const texts = textNodes.map(t => t.text)
    expect(texts).toContain('A')
    expect(texts).toContain('B')
    expect(texts).toContain('X')
    expect(texts).toContain('Y')
    expect(texts).toContain('10')
    expect(texts).toContain('20')
    expect(texts).toContain('30')
  })

  // Verifies that a crosstab placed in a detail band renders once per detail row.
  it('renders crosstab in detail band with per-row data', () => {
    // Each detail row renders a crosstab — but with same main datasource
    const template: ReportTemplate = {
      page: { width: 400, height: 400, margins: { top: 10, bottom: 10, left: 10, right: 10 } },
      bands: {
        title: {
          height: 20,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 200, height: 16, text: 'Sales Crosstab' },
          ],
        },
        details: [{
          height: 150,
          elements: [{
            type: 'crosstab',
            x: 0, y: 0, width: 380, height: 150,
            rowGroups: [{ field: 'region' }],
            columnGroups: [{ field: 'product' }],
            measures: [{ field: 'amount', calculation: 'sum' }],
            dataSourceExpression: () => salesData,
          }],
        }],
      },
    }

    // Minimal data to trigger detail bands
    const doc = createReport(template, { rows: [{ dummy: 1 }] }, fontMap)
    expect(doc.pages.length).toBeGreaterThanOrEqual(1)

    const textNodes: RenderText[] = []
    function collectTexts(node: any): void {
      if (node.type === 'text') textNodes.push(node)
      if (node.children) for (const c of node.children) collectTexts(c)
    }
    collectTexts(doc.pages[0]!)

    const texts = textNodes.map(t => t.text)
    expect(texts).toContain('East')
    expect(texts).toContain('West')
  })
})
