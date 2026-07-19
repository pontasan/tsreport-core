import { describe, expect, it } from 'vitest'
import {
  findElementById,
  getElementChildren,
  type ElementDef,
  type ReportTemplate,
} from '../src/index.js'

function staticText(id: string | undefined, text: string): ElementDef {
  return {
    id,
    type: 'staticText',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text,
  }
}

function templateWithNestedElements(): ReportTemplate {
  const frameChild = staticText('frame-child', 'frame child')
  const nestedChild = staticText('nested-child', 'nested child')
  const nestedFrame: ElementDef = {
    id: 'nested-frame',
    type: 'frame',
    x: 0,
    y: 20,
    width: 100,
    height: 40,
    elements: [nestedChild],
  }
  const maskChild = staticText('mask-child', 'mask child')
  const frame: ElementDef = {
    id: 'frame',
    type: 'frame',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    elements: [frameChild, nestedFrame],
    softMask: {
      type: 'alpha',
      elements: [maskChild],
    },
  }
  const tableHeaderChild = staticText('table-header-child', 'header')
  const tableDetailChild = staticText('table-detail-child', 'detail')
  const tableFooterChild = staticText('table-footer-child', 'footer')
  const table: ElementDef = {
    id: 'table',
    type: 'table',
    x: 0,
    y: 100,
    width: 100,
    height: 100,
    columns: [{ width: 100 }],
    headerRows: [{ height: 20, cells: [{ elements: [tableHeaderChild] }] }],
    detailRows: [{ height: 20, cells: [{ elements: [tableDetailChild] }] }],
    footerRows: [{ height: 20, cells: [{ elements: [tableFooterChild] }] }],
  }

  return {
    page: { size: 'A4' },
    bands: {
      background: { height: 10, elements: [staticText('duplicate', 'background')] },
      details: [{ height: 200, elements: [frame, table, staticText(undefined, 'without id')] }],
    },
    groups: [{
      name: 'category',
      expression: 'field.category',
      header: { height: 20, elements: [staticText('group-header-child', 'group')] },
      footer: { height: 20, elements: [staticText('duplicate', 'group duplicate')] },
    }],
  }
}

describe('template element selectors', function () {
  it('returns directly owned frame, soft-mask, and table elements in source order', function () {
    const template = templateWithNestedElements()
    const frame = findElementById(template, 'frame')!
    const table = findElementById(template, 'table')!

    expect(getElementChildren(frame).map(function (element) { return element.id })).toEqual([
      'frame-child',
      'nested-frame',
      'mask-child',
    ])
    expect(getElementChildren(table).map(function (element) { return element.id })).toEqual([
      'table-header-child',
      'table-detail-child',
      'table-footer-child',
    ])
    expect(getElementChildren(findElementById(template, 'frame-child')!)).toEqual([])
  })

  it('searches every element container depth-first and returns the stored object', function () {
    const template = templateWithNestedElements()
    const nested = findElementById(template, 'nested-child')!
    const mask = findElementById(template, 'mask-child')!
    const tableCell = findElementById(template, 'table-detail-child')!
    const group = findElementById(template, 'group-header-child')!

    expect(nested.type).toBe('staticText')
    expect(mask.type).toBe('staticText')
    expect(tableCell.type).toBe('staticText')
    expect(group.type).toBe('staticText')

    if (nested.type !== 'staticText') throw new Error('Expected nested staticText element')
    nested.text = 'changed before layout'
    expect(findElementById(template, 'nested-child')).toBe(nested)
    expect(nested.text).toBe('changed before layout')
  })

  it('returns undefined for an unknown id and the first element for duplicate ids', function () {
    const template = templateWithNestedElements()

    expect(findElementById(template, 'unknown')).toBeUndefined()
    const duplicate = findElementById(template, 'duplicate')!
    expect(duplicate.type).toBe('staticText')
    if (duplicate.type !== 'staticText') throw new Error('Expected duplicate staticText element')
    expect(duplicate.text).toBe('background')
  })
})
