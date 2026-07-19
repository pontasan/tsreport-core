/**
 * Crosstab (pivot table) layout module
 *
 * Pivots data based on row group / column group definitions and
 * places aggregated values in each cell. Supports multi-level groups
 * (hierarchical headers), subtotal rows/columns, grand totals, and
 * multiple measures.
 *
 * - Multi-level row groups: each level occupies one column from the left;
 *   outer group cells are merged vertically across the rows they cover
 *   (equivalent to rowSpan). rowHeaderWidth is applied to each level as
 *   the row header width.
 * - Multi-level column groups: outer groups are stacked on top, inner
 *   groups below; outer headers are merged across the width of the
 *   columns they cover (equivalent to colSpan).
 * - Subtotals (showSubtotals): a subtotal row/column is inserted at the
 *   end of each block for every group except the innermost. The label is
 *   "Total", following the same convention as the grand total.
 * - Multiple measures: displayed stacked vertically within the data cell,
 *   matching the common report default (crosstab wizard). Each measure
 *   occupies one slot (at least cellHeight) and applies its own
 *   calculation / format individually.
 * - Subtotal and grand total values are re-aggregated from raw values
 *   using each measure's calculation (like common report behavior, this yields
 *   correct totals even for average etc.).
 */

import type { RenderNode, RenderGroup, RenderText } from '../types/render.js'
import type { TextMeasurer } from '../measure/text-measurer.js'
import { layoutText, type TextLayoutOptions } from './text-layout.js'

// ─── Crosstab definitions ───

export interface CrosstabDef {
  /** Row group definitions */
  rowGroups: CrosstabGroupDef[]
  /** Column group definitions */
  columnGroups: CrosstabGroupDef[]
  /** Measure (aggregate cell) definitions */
  measures: CrosstabMeasureDef[]
  /** Row header width (pt, applied to each row group level) */
  rowHeaderWidth?: number
  /** Column header height (pt, applied to each column group level) */
  columnHeaderHeight?: number
  /** Data cell width (pt) */
  cellWidth?: number
  /** Data cell height (pt) */
  cellHeight?: number
  /** Borders */
  border?: CrosstabBorderDef
  /** Show subtotals */
  showSubtotals?: boolean
  /** Show grand total */
  showGrandTotal?: boolean
}

export interface CrosstabGroupDef {
  /** Group expression (field name) */
  field: string
  /** Header text format */
  headerFormat?: string
}

export interface CrosstabMeasureDef {
  /** Field name to aggregate */
  field: string
  /** Aggregation method */
  calculation: 'sum' | 'count' | 'average' | 'min' | 'max'
  /** Display format */
  format?: string
}

export interface CrosstabBorderDef {
  color?: string
  width?: number
}

export interface CrosstabLayoutContext {
  /** Text measurer (for text wrapping) */
  measurer?: TextMeasurer
}

/** Result of page-break-aware layout */
export interface CrosstabLayoutResult {
  group: RenderGroup
  /** Number of logical data rows rendered in this chunk (subtotal and grand total rows each count as one row) */
  renderedDataRows: number
  /** Whether all logical data rows have been rendered */
  complete: boolean
}

// ─── Internal model ───

const FONT_SIZE = 9
const PAD = 2
/** Separator joining row key and column key */
const SEP = '\u0001'
/** Separator for path values */
const KEY_SEP = '\u0000'

/**
 * Logical row/column. Either a data row/column (path covers all levels) or
 * a Total row/column (path covers only the continuing outer levels;
 * the grand total has path.length === 0).
 */
interface CrosstabLine {
  path: unknown[]
  isTotal: boolean
}

interface PivotResult {
  rowLines: CrosstabLine[]
  colLines: CrosstabLine[]
  rowLineKeys: string[]
  colLineKeys: string[]
  /** [measure index] → (rowLineKey SEP colLineKey) → aggregated value */
  values: Map<string, number>[]
  /** Normalized measure definitions (an implicit single entry when unspecified) */
  measures: CrosstabMeasureDef[]
  numRowLevels: number
  numColLevels: number
}

interface RowMetrics {
  /** Height of each logical row (pt) */
  heights: number[]
  /** Vertically stacked slot heights as [row][measure] (pt) */
  slotHeights: number[][]
}

// ─── Crosstab layout ───

/**
 * Generates a RenderGroup from a crosstab definition and data
 */
export function layoutCrosstab(
  def: CrosstabDef,
  x: number,
  y: number,
  rows: Record<string, unknown>[],
  context?: CrosstabLayoutContext,
): RenderGroup {
  // Pivot data.
  const pivot = pivotData(def, rows)
  const metrics = computeRowMetrics(def, pivot, context)
  return renderCrosstabRange(def, x, y, pivot, metrics, 0, pivot.rowLines.length, context)
}

/**
 * Lays out the crosstab with page-break support.
 * Renders logical data rows (data rows + subtotal rows + grand total row)
 * starting at startDataRow, cutting off at a row boundary when maxHeight
 * is exceeded. Column headers are rendered on every page.
 * Subtotal and grand total rows are each treated as a single logical row
 * and never straddle a split boundary.
 */
export function layoutCrosstabPaged(
  def: CrosstabDef,
  x: number,
  y: number,
  rows: Record<string, unknown>[],
  context: CrosstabLayoutContext | undefined,
  startDataRow: number,
  maxHeight: number,
): CrosstabLayoutResult {
  const pivot = pivotData(def, rows)
  const metrics = computeRowMetrics(def, pivot, context)
  const numDataRows = pivot.rowLines.length
  const headerHeight = (def.columnHeaderHeight ?? 20) * pivot.numColLevels

  // If the column headers alone exceed maxHeight, render all remaining rows
  if (headerHeight >= maxHeight) {
    const group = renderCrosstabRange(def, x, y, pivot, metrics, startDataRow, numDataRows, context)
    return { group, renderedDataRows: numDataRows - startDataRow, complete: true }
  }

  // Row heights are final values, so accumulate from the top to determine how many rows fit within maxHeight
  let fitCount = 0
  let usedHeight = headerHeight
  for (let r = startDataRow; r < numDataRows; r++) {
    usedHeight += metrics.heights[r]!
    if (usedHeight > maxHeight) break
    fitCount++
  }

  // Adjust row height based on text wrapping.
        // Row header text.
  // If not even one row fits, render at least one row (prevents infinite loop)
  if (fitCount === 0) fitCount = 1

        // Data cell.
  const endRow = startDataRow + fitCount
  const complete = endRow >= numDataRows
  const group = renderCrosstabRange(def, x, y, pivot, metrics, startDataRow, endRow, context)
  return { group, renderedDataRows: fitCount, complete }
}

// ─── Row height calculation ───

/**
 * Computes the heights and measure slot heights of all logical rows
 * (data rows + subtotal rows + grand total row).
 * Since multiple measures are stacked vertically, row height = sum of each
 * measure slot height. Includes height adjustment for text wrapping.
 */
function computeRowMetrics(
  def: CrosstabDef,
  pivot: PivotResult,
  context?: CrosstabLayoutContext,
): RowMetrics {
  const { rowLines, colLines, measures } = pivot
  const cellWidth = def.cellWidth ?? 60
  const cellHeight = def.cellHeight ?? 20
  const rowHeaderWidth = def.rowHeaderWidth ?? 80

  const measurer = context?.measurer
  const cellAvail = cellWidth - PAD * 2
  const headerAvail = rowHeaderWidth - PAD * 2

  const numRows = rowLines.length
  const heights: number[] = new Array(numRows)
  const slotHeights: number[][] = new Array(numRows)

  for (let r = 0; r < numRows; r++) {
    const slots: number[] = new Array(measures.length)
    for (let m = 0; m < measures.length; m++) slots[m] = cellHeight

    // Slot height adjustment for data cell text wrapping
    if (measurer !== undefined && cellAvail > 0) {
      for (let c = 0; c < colLines.length; c++) {
        for (let m = 0; m < measures.length; m++) {
          const text = formatValue(cellValue(pivot, m, r, c), measures[m]!.format)
          if (text !== '') {
            const result = layoutText(text, measurer, FONT_SIZE, { maxWidth: cellAvail })
            const h = result.totalHeight + PAD * 2
            if (h > slots[m]!) slots[m] = h
          }
        }
      }
    }

    let rowH = 0
    for (let m = 0; m < measures.length; m++) rowH += slots[m]!

    // Height adjustment for the deepest-level row header text (data rows only)
    const line = rowLines[r]!
    if (!line.isTotal && measurer !== undefined && headerAvail > 0) {
      const level = line.path.length - 1
      const headerText = formatHeaderValue(line.path[level], def.rowGroups[level]?.headerFormat)
      if (headerText !== '') {
        const result = layoutText(headerText, measurer, FONT_SIZE, { maxWidth: headerAvail })
        const h = result.totalHeight + PAD * 2
        if (h > rowH) rowH = h
      }
    }

  // Precompute row Y coordinates.
    heights[r] = rowH
    slotHeights[r] = slots
  }

  return { heights, slotHeights }
}

// ─── Range rendering ───

/**
 * Renders logical rows [startRow, endRow) with column headers.
 * Outer row group header cells are rendered merged vertically over
 * contiguous ranges within the chunk (if the chunk starts mid-block,
 * the group value is displayed again).
 */
function renderCrosstabRange(
  def: CrosstabDef,
  x: number,
  y: number,
  pivot: PivotResult,
  metrics: RowMetrics,
  startRow: number,
  endRow: number,
  context?: CrosstabLayoutContext,
): RenderGroup {
  const { rowLines, colLines, measures, numRowLevels, numColLevels } = pivot
  const cellWidth = def.cellWidth ?? 60
  const rowHeaderWidth = def.rowHeaderWidth ?? 80
  const colHeaderHeight = def.columnHeaderHeight ?? 20
  const measurer = context?.measurer

  const rowHeaderAreaWidth = rowHeaderWidth * numRowLevels
  const headerHeight = colHeaderHeight * numColLevels
  const totalWidth = rowHeaderAreaWidth + colLines.length * cellWidth

  // Precompute row Y coordinates within the chunk
  const chunkRowCount = endRow - startRow
  const rowYPositions: number[] = new Array(chunkRowCount)
  let rowsTotalHeight = 0
  for (let i = 0; i < chunkRowCount; i++) {
    rowYPositions[i] = headerHeight + rowsTotalHeight
    rowsTotalHeight += metrics.heights[startRow + i]!
  }
  const totalHeight = headerHeight + rowsTotalHeight

  const children: RenderNode[] = []

  // Column header.
    // Background.
    // Text.
  // ─── Column headers (outer levels on top, inner levels below) ───
  for (let l = 0; l < numColLevels; l++) {
    const bandY = l * colHeaderHeight
    for (let c = 0; c < colLines.length; c++) {
      const line = colLines[c]!
      const cellX = rowHeaderAreaWidth + c * cellWidth

      // Total header: merged vertically from this level down to the bottom row
      if (line.isTotal && line.path.length === l) {
        children.push({
          type: 'rect',
          x: cellX, y: bandY,
          width: cellWidth, height: headerHeight - bandY,
          fill: '#D0D0D0',
        })
        pushCellText(children, 'Total', cellX, bandY, cellWidth, headerHeight - bandY, true, false, measurer)
        continue
      }

      if (!coversLevel(line, l)) continue
      // Merge contiguous cells of the same outer group (render only the first)
      if (c > 0 && sharesPrefix(colLines[c - 1]!, line, l)) continue

      let span = 1
      for (let c2 = c + 1; c2 < colLines.length; c2++) {
        if (!sharesPrefix(line, colLines[c2]!, l)) break
        span++
      }
      const width = span * cellWidth
      children.push({
        type: 'rect',
        x: cellX, y: bandY,
        width, height: colHeaderHeight,
        fill: '#E8E8E8',
      })
      const text = formatHeaderValue(line.path[l], def.columnGroups[l]?.headerFormat)
      pushCellText(children, text, cellX, bandY, width, colHeaderHeight, true, false, measurer)
    }
  }

  // Grand total column header.
  // Top-left corner.
  // Top-left corner
  children.push({
    type: 'rect',
    x: 0, y: 0,
    width: rowHeaderAreaWidth, height: headerHeight,
    fill: '#D8D8D8',
  })

  // Data row.
    // Row header.
    // Data cell.
  // ─── Row headers (one column per level, outer groups merged vertically) ───
  for (let l = 0; l < numRowLevels; l++) {
    const headerX = l * rowHeaderWidth
    for (let i = 0; i < chunkRowCount; i++) {
      const r = startRow + i
      const line = rowLines[r]!
      const rowY = rowYPositions[i]!
      const rowH = metrics.heights[r]!

      // Total header: merged horizontally from this level to the right edge
      if (line.isTotal && line.path.length === l) {
        const width = rowHeaderAreaWidth - headerX
        children.push({
          type: 'rect',
          x: headerX, y: rowY,
          width, height: rowH,
          fill: '#D0D0D0',
        })
        pushCellText(children, 'Total', headerX, rowY, width, rowH, true, false, measurer)
        continue
      }

      if (!coversLevel(line, l)) continue
      // Merge contiguous cells of the same outer group (render only the first within the chunk)
      if (i > 0 && sharesPrefix(rowLines[r - 1]!, line, l)) continue

    // Row grand total.
      let spanH = rowH
      for (let i2 = i + 1; i2 < chunkRowCount; i2++) {
        if (!sharesPrefix(line, rowLines[startRow + i2]!, l)) break
        spanH += metrics.heights[startRow + i2]!
      }
      children.push({
        type: 'rect',
        x: headerX, y: rowY,
        width: rowHeaderWidth, height: spanH,
        fill: '#F0F0F0',
      })
      const text = formatHeaderValue(line.path[l], def.rowGroups[l]?.headerFormat)
      pushCellText(children, text, headerX, rowY, rowHeaderWidth, spanH, true, false, measurer)
    }
  }

  // Grand total row.
    // Row header.
  // ─── Data cells (multiple measures stacked vertically) ───
  for (let i = 0; i < chunkRowCount; i++) {
    const r = startRow + i
    const rowLine = rowLines[r]!
    const rowY = rowYPositions[i]!
    const rowH = metrics.heights[r]!
    const slots = metrics.slotHeights[r]!

    // Column total.
    for (let c = 0; c < colLines.length; c++) {
      const colLine = colLines[c]!
      const cellX = rowHeaderAreaWidth + c * cellWidth

      const fill = cellFill(rowLine.isTotal, colLine.isTotal)
      if (fill !== undefined) {
        children.push({
          type: 'rect',
          x: cellX, y: rowY,
          width: cellWidth, height: rowH,
          fill,
        })
      }

    // Bottom-right corner for grand total.
      const bold = rowLine.isTotal || colLine.isTotal
      let slotY = rowY
      for (let m = 0; m < measures.length; m++) {
        const text = formatValue(cellValue(pivot, m, r, c), measures[m]!.format)
        pushCellText(children, text, cellX, slotY, cellWidth, slots[m]!, bold, true, measurer)
        slotY += slots[m]!
      }
    }
  }

  // ─── Borders ───
  if (def.border) {
    const borderColor = def.border.color ?? '#000000'
    const borderWidth = def.border.width ?? 0.5

    // Outer frame
    children.push({
      type: 'rect',
      x: 0, y: 0,
      width: totalWidth, height: totalHeight,
      stroke: borderColor,
      strokeWidth: borderWidth,
    })

    // Horizontal rules (do not cross merged outer row header cells)
    for (let i = 0; i < chunkRowCount; i++) {
      const lineY = rowYPositions[i]!
      let startX = 0
      if (i > 0) {
        startX = sharedDepth(rowLines[startRow + i - 1]!, rowLines[startRow + i]!) * rowHeaderWidth
      }
      children.push({
        type: 'line',
        x1: startX, y1: lineY,
        x2: totalWidth, y2: lineY,
        lineWidth: borderWidth * 0.5,
        color: borderColor,
      })
    }
    // Bottom edge rule
    children.push({
      type: 'line',
      x1: 0, y1: totalHeight,
      x2: totalWidth, y2: totalHeight,
      lineWidth: borderWidth * 0.5,
      color: borderColor,
    })

    // Vertical rules (do not cross merged outer column header cells)
    for (let c = 0; c <= colLines.length; c++) {
      const lineX = rowHeaderAreaWidth + c * cellWidth
      let startY = 0
      if (c > 0 && c < colLines.length) {
        startY = sharedDepth(colLines[c - 1]!, colLines[c]!) * colHeaderHeight
      }
      children.push({
        type: 'line',
        x1: lineX, y1: startY,
        x2: lineX, y2: totalHeight,
        lineWidth: borderWidth * 0.5,
        color: borderColor,
      })
    }

    // Level dividers in the row headers (do not cross Total cells)
    for (let l = 1; l < numRowLevels; l++) {
      const lineX = l * rowHeaderWidth
      for (let i = 0; i < chunkRowCount; i++) {
        const line = rowLines[startRow + i]!
        if (line.isTotal && line.path.length < l) continue
        children.push({
          type: 'line',
          x1: lineX, y1: rowYPositions[i]!,
          x2: lineX, y2: rowYPositions[i]! + metrics.heights[startRow + i]!,
          lineWidth: borderWidth * 0.5,
          color: borderColor,
        })
      }
    }

    // Level dividers in the column headers (do not cross Total cells)
    for (let l = 1; l < numColLevels; l++) {
      const lineY = l * colHeaderHeight
      for (let c = 0; c < colLines.length; c++) {
        const line = colLines[c]!
        if (line.isTotal && line.path.length < l) continue
        const cellX = rowHeaderAreaWidth + c * cellWidth
        children.push({
          type: 'line',
          x1: cellX, y1: lineY,
          x2: cellX + cellWidth, y2: lineY,
          lineWidth: borderWidth * 0.5,
          color: borderColor,
        })
      }
    }

    // Divider between the row header area and the data area
    children.push({
      type: 'line',
      x1: rowHeaderAreaWidth, y1: 0,
      x2: rowHeaderAreaWidth, y2: totalHeight,
      lineWidth: borderWidth,
      color: borderColor,
    })

    // Divider between the column headers and the data rows
    children.push({
      type: 'line',
      x1: 0, y1: headerHeight,
      x2: totalWidth, y2: headerHeight,
      lineWidth: borderWidth,
      color: borderColor,
    })
  }

  return {
    type: 'group',
    x, y,
    width: totalWidth,
    height: totalHeight,
    clip: true,
    children,
  }
}

// ─── Cell rendering helpers ───

/**
 * Renders text inside a cell. Wraps when a measurer is available, otherwise uses a fixed position.
 */
function pushCellText(
  children: RenderNode[],
  text: string,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  bold: boolean,
  alignRight: boolean,
  measurer: TextMeasurer | undefined,
): void {
  const availWidth = cellW - PAD * 2
  if (measurer !== undefined && availWidth > 0) {
    const opts: TextLayoutOptions = {
      maxWidth: availWidth,
      elementHeight: cellH - PAD * 2,
      vAlign: 'top',
    }
    if (alignRight) opts.hAlign = 'right'
    const result = layoutText(text, measurer, FONT_SIZE, opts)
    for (let li = 0; li < result.lines.length; li++) {
      const line = result.lines[li]!
      if (line.text === '') continue
      const node: RenderText = {
        type: 'text',
        x: cellX + PAD, y: cellY + PAD + line.y,
        text: line.text,
        fontId: 'default',
        fontSize: FONT_SIZE,
        color: '#000000',
        width: availWidth,
      }
      if (bold) node.bold = true
      if (alignRight) node.hAlign = 'right'
      children.push(node)
    }
  } else {
    const node: RenderText = {
      type: 'text',
      x: cellX + PAD, y: cellY + 3,
      text,
      fontId: 'default',
      fontSize: FONT_SIZE,
      color: '#000000',
      width: availWidth,
    }
    if (bold) node.bold = true
    if (alignRight) node.hAlign = 'right'
    children.push(node)
  }
}

/** Data cell background color (based on whether the row/column is a Total) */
function cellFill(rowIsTotal: boolean, colIsTotal: boolean): string | undefined {
  if (rowIsTotal && colIsTotal) return '#E0E0D8'
  if (rowIsTotal) return '#F0F0E8'
  if (colIsTotal) return '#F8F8F0'
  return undefined
}

// ─── Logical row/column helpers ───

/** Whether the line has a group value at the given level (excluding Total cells themselves and anything below them) */
function coversLevel(line: CrosstabLine, level: number): boolean {
  return level < line.path.length
}

/** Whether two lines share outer group values up to the given level (merged cell check) */
function sharesPrefix(a: CrosstabLine, b: CrosstabLine, level: number): boolean {
  if (level >= a.path.length || level >= b.path.length) return false
  for (let l = 0; l <= level; l++) {
    if (a.path[l] !== b.path[l]) return false
  }
  return true
}

/** Depth of the outer group values shared by two lines (used to compute border start positions) */
function sharedDepth(a: CrosstabLine, b: CrosstabLine): number {
  const limit = a.path.length < b.path.length ? a.path.length : b.path.length
  for (let l = 0; l < limit; l++) {
    if (a.path[l] !== b.path[l]) return l
  }
  return limit
}

// ─── Pivot data processing ───

/** Node of the hierarchy tree that preserves group order */
interface KeyNode {
  value: unknown
  children: KeyNode[]
  index: Map<unknown, KeyNode>
}

function insertPath(roots: KeyNode[], rootIndex: Map<unknown, KeyNode>, path: unknown[]): void {
  let nodes = roots
  let index = rootIndex
  for (let l = 0; l < path.length; l++) {
    let node = index.get(path[l])
    if (node === undefined) {
      node = { value: path[l], children: [], index: new Map() }
      index.set(path[l], node)
      nodes.push(node)
    }
    nodes = node.children
    index = node.index
  }
}

/**
 * Expands the tree depth-first into logical rows/columns.
 * When showSubtotals is enabled, a Total row/column is inserted at the end
 * of each block for every group except the innermost (inner group Totals
 * come first, outer group Totals after).
 */
function flattenTree(
  nodes: KeyNode[],
  prefix: unknown[],
  numLevels: number,
  showSubtotals: boolean,
  out: CrosstabLine[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const path = prefix.concat([node.value])
    if (path.length === numLevels) {
      out.push({ path, isTotal: false })
    } else {
      flattenTree(node.children, path, numLevels, showSubtotals, out)
      if (showSubtotals) out.push({ path, isTotal: true })
    }
  }
}

function groupFields(groups: CrosstabGroupDef[]): string[] {
  if (groups.length === 0) return ['']
  const fields: string[] = new Array(groups.length)
  for (let i = 0; i < groups.length; i++) fields[i] = groups[i]!.field
  return fields
}

function dataLineKey(path: unknown[]): string {
  let key = 'D'
  for (let l = 0; l < path.length; l++) key += KEY_SEP + String(path[l])
  return key
}

function totalLineKey(path: unknown[], length: number): string {
  let key = 'T'
  for (let l = 0; l < length; l++) key += KEY_SEP + String(path[l])
  return key
}

function lineKey(line: CrosstabLine): string {
  return line.isTotal ? totalLineKey(line.path, line.path.length) : dataLineKey(line.path)
}

/**
 * List of logical row/column keys a single data row contributes to.
 * Besides the data row/column itself, it also contributes to the subtotal
 * buckets (each outer prefix) and the grand total bucket.
 */
function lineKeyVariants(path: unknown[], showSubtotals: boolean, showGrandTotal: boolean): string[] {
  const keys: string[] = [dataLineKey(path)]
  if (showSubtotals) {
    for (let len = path.length - 1; len >= 1; len--) keys.push(totalLineKey(path, len))
  }
  if (showGrandTotal) keys.push(totalLineKey(path, 0))
  return keys
}

function pivotData(def: CrosstabDef, rows: Record<string, unknown>[]): PivotResult {
  const rowFields = groupFields(def.rowGroups)
  const colFields = groupFields(def.columnGroups)
  const measures: CrosstabMeasureDef[] =
    def.measures.length > 0 ? def.measures : [{ field: '', calculation: 'sum' }]
  const showSubtotals = def.showSubtotals === true
  const showGrandTotal = def.showGrandTotal === true

  const rowRoots: KeyNode[] = []
  const rowRootIndex = new Map<unknown, KeyNode>()
  const colRoots: KeyNode[] = []
  const colRootIndex = new Map<unknown, KeyNode>()

  // Raw value buckets per measure: (rowLineKey SEP colLineKey) → list of raw values
  const buckets: Map<string, number[]>[] = new Array(measures.length)
  for (let m = 0; m < measures.length; m++) buckets[m] = new Map()

  const rowPath: unknown[] = new Array(rowFields.length)
  const colPath: unknown[] = new Array(colFields.length)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    for (let l = 0; l < rowFields.length; l++) rowPath[l] = row[rowFields[l]!]
    for (let l = 0; l < colFields.length; l++) colPath[l] = row[colFields[l]!]
    insertPath(rowRoots, rowRootIndex, rowPath)
    insertPath(colRoots, colRootIndex, colPath)

    const rowKeys = lineKeyVariants(rowPath, showSubtotals, showGrandTotal)
    const colKeys = lineKeyVariants(colPath, showSubtotals, showGrandTotal)

    for (let m = 0; m < measures.length; m++) {
      const raw = row[measures[m]!.field]
      const val = typeof raw === 'number' ? raw : Number(raw) || 0
      const bucket = buckets[m]!
      for (let rk = 0; rk < rowKeys.length; rk++) {
        for (let ck = 0; ck < colKeys.length; ck++) {
          const key = rowKeys[rk]! + SEP + colKeys[ck]!
          let list = bucket.get(key)
          if (list === undefined) {
            list = []
            bucket.set(key, list)
          }
          list.push(val)
        }
      }
    }
  }

  // Grand totals only exist when there is data to aggregate: with zero data
  // rows the tree is empty and no total line is emitted.
  const rowLines: CrosstabLine[] = []
  flattenTree(rowRoots, [], rowFields.length, showSubtotals, rowLines)
  if (showGrandTotal && rowLines.length > 0) rowLines.push({ path: [], isTotal: true })

  const colLines: CrosstabLine[] = []
  flattenTree(colRoots, [], colFields.length, showSubtotals, colLines)
  if (showGrandTotal && colLines.length > 0) colLines.push({ path: [], isTotal: true })

  const rowLineKeys: string[] = new Array(rowLines.length)
  for (let r = 0; r < rowLines.length; r++) rowLineKeys[r] = lineKey(rowLines[r]!)
  const colLineKeys: string[] = new Array(colLines.length)
  for (let c = 0; c < colLines.length; c++) colLineKeys[c] = lineKey(colLines[c]!)

  // Aggregation (subtotals and grand totals are also computed from raw values using each measure's calculation)
  const values: Map<string, number>[] = new Array(measures.length)
  for (let m = 0; m < measures.length; m++) {
    const aggregated = new Map<string, number>()
    const calculation = measures[m]!.calculation
    for (const [key, list] of buckets[m]!) {
      aggregated.set(key, aggregate(list, calculation))
    }
    values[m] = aggregated
  }

  return {
    rowLines,
    colLines,
    rowLineKeys,
    colLineKeys,
    values,
    measures,
    numRowLevels: rowFields.length,
    numColLevels: colFields.length,
  }
}

function cellValue(pivot: PivotResult, m: number, r: number, c: number): number {
  const value = pivot.values[m]!.get(pivot.rowLineKeys[r]! + SEP + pivot.colLineKeys[c]!)
  return value === undefined ? 0 : value
}

function aggregate(values: number[], calculation: string): number {
  if (values.length === 0) return 0
  switch (calculation) {
    case 'sum': return values.reduce((a, b) => a + b, 0)
    case 'count': return values.length
    case 'average': return values.reduce((a, b) => a + b, 0) / values.length
    case 'min': {
      let m = values[0]!
      for (let i = 1; i < values.length; i++) if (values[i]! < m) m = values[i]!
      return m
    }
    case 'max': {
      let m = values[0]!
      for (let i = 1; i < values.length; i++) if (values[i]! > m) m = values[i]!
      return m
    }
    default: return values.reduce((a, b) => a + b, 0)
  }
}

/** Display string for a group header value (headerFormat applies formatValue to numeric values) */
function formatHeaderValue(value: unknown, format: string | undefined): string {
  if (format !== undefined && typeof value === 'number') return formatValue(value, format)
  return String(value)
}

function formatValue(value: number, format?: string): string {
  if (!format) return String(value)
  // Simplified formatting: "#,##0" → thousands separators
  if (format.includes('#,##0') || format.includes(',')) {
    return value.toLocaleString()
  }
  // ".00" → two decimal places
  const decMatch = format.match(/\.(\d+)/)
  if (decMatch) {
    return value.toFixed(decMatch[1]!.length)
  }
  return String(value)
}
