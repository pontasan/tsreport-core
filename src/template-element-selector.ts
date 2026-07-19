import type {
  BandDef,
  ElementDef,
  ReportTemplate,
  TableRowElementDef,
} from './types/template.js'

function appendTableRowElements(rows: TableRowElementDef[] | undefined, children: ElementDef[]): void {
  if (rows === undefined) return
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex]!.cells
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const elements = cells[cellIndex]!.elements
      if (elements === undefined) continue
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
        children.push(elements[elementIndex]!)
      }
    }
  }
}

/**
 * Returns the elements directly owned by an element.
 *
 * The returned array contains the original element objects. Mutating an object
 * in the array therefore updates the template. Frame content is followed by
 * soft-mask content. Table content follows header, detail, and footer row order.
 */
export function getElementChildren(element: ElementDef): ElementDef[] {
  if (element.type === 'frame') {
    const elements = element.elements
    const maskElements = element.softMask?.elements
    const children: ElementDef[] = []
    if (elements !== undefined) {
      for (let i = 0; i < elements.length; i++) children.push(elements[i]!)
    }
    if (maskElements !== undefined) {
      for (let i = 0; i < maskElements.length; i++) children.push(maskElements[i]!)
    }
    return children
  }

  if (element.type === 'table') {
    const children: ElementDef[] = []
    appendTableRowElements(element.headerRows, children)
    appendTableRowElements(element.detailRows, children)
    appendTableRowElements(element.footerRows, children)
    return children
  }

  return []
}

function findInElements(elements: ElementDef[] | undefined, id: string): ElementDef | undefined {
  if (elements === undefined) return undefined

  const pending: ElementDef[] = []
  for (let i = elements.length - 1; i >= 0; i--) pending.push(elements[i]!)

  while (pending.length > 0) {
    const element = pending.pop()!
    if (element.id === id) return element

    const children = getElementChildren(element)
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!)
  }

  return undefined
}

function findInBand(band: BandDef | undefined, id: string): ElementDef | undefined {
  return findInElements(band?.elements, id)
}

/**
 * Finds the first element with the requested ID in a report template.
 *
 * Search is depth-first and follows band declaration order, then group order.
 * The returned object is the element stored in the template, not a copy, so
 * changes made before createReport() are used by layout and rendering.
 */
export function findElementById(template: ReportTemplate, id: string): ElementDef | undefined {
  const bands = template.bands
  let found = findInBand(bands.background, id)
  if (found !== undefined) return found
  found = findInBand(bands.title, id)
  if (found !== undefined) return found
  found = findInBand(bands.pageHeader, id)
  if (found !== undefined) return found
  found = findInBand(bands.columnHeader, id)
  if (found !== undefined) return found

  const details = bands.details
  if (details !== undefined) {
    for (let i = 0; i < details.length; i++) {
      found = findInBand(details[i], id)
      if (found !== undefined) return found
    }
  }

  found = findInBand(bands.columnFooter, id)
  if (found !== undefined) return found
  found = findInBand(bands.pageFooter, id)
  if (found !== undefined) return found
  found = findInBand(bands.lastPageFooter, id)
  if (found !== undefined) return found
  found = findInBand(bands.summary, id)
  if (found !== undefined) return found
  found = findInBand(bands.noData, id)
  if (found !== undefined) return found

  const groups = template.groups
  if (groups !== undefined) {
    for (let i = 0; i < groups.length; i++) {
      found = findInBand(groups[i]!.header, id)
      if (found !== undefined) return found
      found = findInBand(groups[i]!.footer, id)
      if (found !== undefined) return found
    }
  }

  return undefined
}
