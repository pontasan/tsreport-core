/**
 * Table layout module
 *
 * Builds a RenderNode tree from a table definition.
 * A table consists of column definitions + header rows + detail rows + footer rows.
 * Supports cell merging (rowSpan, colSpan).
 *
 * rowSpan implementation approach:
 * 1. Flatten all rows (header → detail × data → footer)
 * 2. Track column occupancy from rowSpan with a cell occupancy map (Uint8Array)
 * 3. Skip occupied columns when placing cells
 * 4. Cell height is the sum of row heights spanned by rowSpan
 * 5. Bottom borders skip column ranges extended by rowSpan when drawing
 */

import type { RenderNode, RenderGroup, RenderText } from '../types/render.js'
import type { BorderDef, BorderSideDef, LineSpacingDef } from '../types/template.js'
import type { TextMeasurer } from '../measure/text-measurer.js'
import { layoutText } from './text-layout.js'
import { lineStyleDash } from './decoration.js'

// ─── Table definitions ───

export interface TableDef {
  /** Column definitions (list of widths) */
  columns: TableColumnDef[]
  /** Header rows */
  headerRows?: TableRowDef[]
  /** Detail rows (rendered for each data row) */
  detailRows?: TableRowDef[]
  /** Footer rows */
  footerRows?: TableRowDef[]
  /** Borders for the whole table */
  border?: BorderDef
}

export interface TableColumnDef {
  /** Column width (pt) */
  width: number
  /** Default cell style for the column */
  style?: TableCellStyleDef
}

export interface TableRowDef {
  /** Row height (pt) */
  height: number
  cells: TableCellDef[]
}

export interface TableCellStyleDef {
  /** Horizontal alignment */
  hAlign?: 'left' | 'center' | 'right'
  /** Vertical alignment */
  vAlign?: 'top' | 'middle' | 'bottom'
  /** Rotation */
  rotation?: 0 | 90 | 180 | 270
  /** Background color */
  backcolor?: string
  /** Foreground color */
  forecolor?: string
  /** Font ID */
  fontId?: string
  /** Font size (pt) */
  fontSize?: number
  /** Bold */
  bold?: boolean
  /** Italic */
  italic?: boolean
  /** Underline */
  underline?: boolean
  /** Strikethrough */
  strikethrough?: boolean
  /** Line spacing settings */
  lineSpacing?: LineSpacingDef
  /** Letter spacing (pt) */
  letterSpacing?: number
  /** AAT trak track value for font-provided size-dependent tracking */
  tracking?: number
  /** Word spacing (pt) */
  wordSpacing?: number
  /** First line indent (pt) */
  firstLineIndent?: number
  /** Left indent (pt) */
  leftIndent?: number
  /** Right indent (pt) */
  rightIndent?: number
  /** Text wrapping (default: true) */
  wrap?: boolean
  /** Shrink to fit */
  shrinkToFit?: boolean
  /** Minimum font size when shrinking (pt) */
  minFontSize?: number
  /** Fit to width */
  fitWidth?: boolean
  /** Outline the text */
  outlineText?: boolean
  /** Padding (pt) */
  padding?: number
  /** Per-cell borders */
  border?: BorderDef
  /** Opacity (0.0 to 1.0) */
  opacity?: number
}

export interface TableCellDef extends TableCellStyleDef {
  /** Cell content text */
  text?: string
  /** Expression (for data binding) */
  expression?: string
  /** Number of columns to merge */
  colSpan?: number
  /** Number of rows to merge */
  rowSpan?: number
  /** Child elements inside the cell (opaque to table-layout, handled via callbacks) */
  elements?: unknown[]
}

// ─── Internal types ───

/** Cell placement info (computed while building the occupancy map) */
interface CellPlacement {
  cell: TableCellDef
  column: TableColumnDef
  startCol: number
  cellWidth: number
  cellHeight: number
}

type ResolvedTableCellStyle = {
  hAlign?: 'left' | 'center' | 'right'
  vAlign?: 'top' | 'middle' | 'bottom'
  rotation?: 0 | 90 | 180 | 270
  backcolor?: string
  forecolor?: string
  fontId?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  lineSpacing?: LineSpacingDef
  letterSpacing?: number
  tracking?: number
  wordSpacing?: number
  firstLineIndent?: number
  leftIndent?: number
  rightIndent?: number
  wrap?: boolean
  shrinkToFit?: boolean
  minFontSize?: number
  fitWidth?: boolean
  outlineText?: boolean
  padding: number
  border?: BorderDef
  opacity?: number
}

type BorderRole = 'top' | 'bottom' | 'left' | 'right'

function resolveTableCellStyle(column: TableColumnDef, cell: TableCellDef): ResolvedTableCellStyle {
  const columnStyle = column.style
  return {
    hAlign: cell.hAlign ?? columnStyle?.hAlign,
    vAlign: cell.vAlign ?? columnStyle?.vAlign,
    rotation: cell.rotation ?? columnStyle?.rotation,
    backcolor: cell.backcolor ?? columnStyle?.backcolor,
    forecolor: cell.forecolor ?? columnStyle?.forecolor,
    fontId: cell.fontId ?? columnStyle?.fontId,
    fontSize: cell.fontSize ?? columnStyle?.fontSize,
    bold: cell.bold ?? columnStyle?.bold,
    italic: cell.italic ?? columnStyle?.italic,
    underline: cell.underline ?? columnStyle?.underline,
    strikethrough: cell.strikethrough ?? columnStyle?.strikethrough,
    lineSpacing: cell.lineSpacing ?? columnStyle?.lineSpacing,
    letterSpacing: cell.letterSpacing ?? columnStyle?.letterSpacing,
    tracking: cell.tracking ?? columnStyle?.tracking,
    wordSpacing: cell.wordSpacing ?? columnStyle?.wordSpacing,
    firstLineIndent: cell.firstLineIndent ?? columnStyle?.firstLineIndent,
    leftIndent: cell.leftIndent ?? columnStyle?.leftIndent,
    rightIndent: cell.rightIndent ?? columnStyle?.rightIndent,
    wrap: cell.wrap ?? columnStyle?.wrap,
    shrinkToFit: cell.shrinkToFit ?? columnStyle?.shrinkToFit,
    minFontSize: cell.minFontSize ?? columnStyle?.minFontSize,
    fitWidth: cell.fitWidth ?? columnStyle?.fitWidth,
    outlineText: cell.outlineText ?? columnStyle?.outlineText,
    padding: cell.padding ?? columnStyle?.padding ?? 2,
    border: mergeTableCellBorder(columnStyle?.border, cell.border),
    opacity: cell.opacity ?? columnStyle?.opacity,
  }
}

function mergeTableCellBorder(base: BorderDef | undefined, override: BorderDef | undefined): BorderDef | undefined {
  if (base === undefined && override === undefined) return undefined
  return {
    width: override?.width ?? base?.width,
    color: override?.color ?? base?.color,
    style: override?.style ?? base?.style,
    top: override?.top !== undefined ? override.top : base?.top,
    bottom: override?.bottom !== undefined ? override.bottom : base?.bottom,
    left: override?.left !== undefined ? override.left : base?.left,
    right: override?.right !== undefined ? override.right : base?.right,
  }
}

function resolveBorderSide(
  styleBorder: BorderDef | undefined,
  side: BorderRole,
): BorderSideDef | null {
  if (!styleBorder) return null

  const explicitSide = styleBorder[side]
  if (explicitSide !== undefined) {
    return explicitSide
  }
  if (styleBorder.width === undefined || styleBorder.color === undefined) {
    return null
  }
  return {
    width: styleBorder.width,
    color: styleBorder.color,
    style: styleBorder.style ?? 'solid',
  }
}

function pushBorderLine(
  children: RenderNode[],
  side: BorderSideDef | null,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (side === null) return
  children.push({
    type: 'line',
    x1,
    y1,
    x2,
    y2,
    lineWidth: side.width,
    color: side.color,
    dash: lineStyleDash(side.style),
  })
}

// ─── Table layout ───

export interface TableLayoutContext {
  /** Callback that resolves text from row data */
  resolveExpression?: (expression: string) => string
  /** Text measurer (for text wrapping; fallback when fontMap is not provided) */
  measurer?: TextMeasurer
  /** Font ID → text measurer map (per-cell font support) */
  fontMap?: Map<string, TextMeasurer>
  /** Page-break continuation: start index of data rows (0-based) */
  startDataRow?: number
  /** Page-break continuation: maximum render height (pt). Rendering is cut off when exceeded */
  maxHeight?: number
  /** Renders child elements inside a cell (injected by the engine) */
  renderCellElements?: (elements: unknown[], cellWidth: number, cellHeight: number) => RenderNode[]
  /** Measures the required height of child elements inside a cell (injected by the engine) */
  measureCellElements?: (elements: unknown[], cellWidth: number) => number
}

/** Return value of layoutTable (page-break support) */
export interface TableLayoutResult {
  group: RenderGroup
  /** Number of data rows rendered */
  renderedDataRows: number
  /** Whether all data rows have been rendered */
  complete: boolean
}

/**
 * Generates a RenderGroup from a table definition
 */
export function layoutTable(
  table: TableDef,
  x: number,
  y: number,
  width: number,
  rows?: Record<string, unknown>[],
  context?: TableLayoutContext,
): RenderGroup {
  const children: RenderNode[] = []

  // Precompute column X coordinates
  const colXPositions = computeColumnPositions(table.columns, width)
  const numCols = table.columns.length
  const colWidths: number[] = []
  for (let i = 0; i < numCols; i++) {
    colWidths.push(i < numCols - 1 ? colXPositions[i + 1]! - colXPositions[i]! : width - colXPositions[i]!)
  }

  // ─── Flatten all rows ───
  const flatRowDefs: TableRowDef[] = []
  const flatDataRows: Array<Record<string, unknown> | undefined> = []

  if (table.headerRows) {
    for (let i = 0; i < table.headerRows.length; i++) {
      flatRowDefs.push(table.headerRows[i]!)
      flatDataRows.push(undefined)
    }
  }
  if (table.detailRows && rows) {
    for (let d = 0; d < rows.length; d++) {
      for (let r = 0; r < table.detailRows.length; r++) {
        flatRowDefs.push(table.detailRows[r]!)
        flatDataRows.push(rows[d])
      }
    }
  }
  if (table.footerRows) {
    for (let i = 0; i < table.footerRows.length; i++) {
      flatRowDefs.push(table.footerRows[i]!)
      flatDataRows.push(undefined)
    }
  }

  const totalRows = flatRowDefs.length

  // ─── Precompute row heights and Y coordinates ───
  const rowHeights: number[] = new Array(totalRows)
  const rowYPositions: number[] = new Array(totalRows)
  let totalHeight = 0
  for (let i = 0; i < totalRows; i++) {
    rowYPositions[i] = totalHeight
    rowHeights[i] = flatRowDefs[i]!.height
    totalHeight += rowHeights[i]!
  }

  // ─── Build cell occupancy map + compute cell placements ───
  // occupied[rowIdx * numCols + colIdx] = 1 means occupied by a rowSpan
  const occupied = numCols > 0 ? new Uint8Array(totalRows * numCols) : new Uint8Array(0)
  const rowPlacements: CellPlacement[][] = new Array(totalRows)

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const rowDef = flatRowDefs[rowIdx]!
    const placements: CellPlacement[] = []
    let colIdx = 0

    for (let ci = 0; ci < rowDef.cells.length; ci++) {
      const cell = rowDef.cells[ci]!

      // Skip occupied columns
      while (colIdx < numCols && occupied[rowIdx * numCols + colIdx]) colIdx++
      if (colIdx >= numCols) break

      const colSpan = cell.colSpan ?? 1
      const rowSpan = cell.rowSpan ?? 1

      // Cell width (sum of column widths spanned by colSpan)
      let cellWidth = 0
      for (let c = 0; c < colSpan && colIdx + c < numCols; c++) {
        cellWidth += colWidths[colIdx + c]!
      }

      // Cell height (sum of row heights spanned by rowSpan)
      let cellHeight = 0
      for (let r = 0; r < rowSpan && rowIdx + r < totalRows; r++) {
        cellHeight += rowHeights[rowIdx + r]!
      }

      placements.push({
        cell,
        column: table.columns[colIdx]!,
        startCol: colIdx,
        cellWidth,
        cellHeight,
      })

      // rowSpan > 1: mark occupancy in subsequent rows
      if (rowSpan > 1) {
        for (let r = 1; r < rowSpan && rowIdx + r < totalRows; r++) {
          for (let c = 0; c < colSpan && colIdx + c < numCols; c++) {
            occupied[(rowIdx + r) * numCols + (colIdx + c)] = 1
          }
        }
      }

      colIdx += colSpan
    }

    rowPlacements[rowIdx] = placements
  }

  // ─── Row height adjustment for text wrapping and child elements ───
  if (context?.measurer || context?.fontMap || context?.measureCellElements) {

    for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
      const placements = rowPlacements[rowIdx]!
      const dataRow = flatDataRows[rowIdx]
      let maxTextHeight = rowHeights[rowIdx]!

      for (let pi = 0; pi < placements.length; pi++) {
        const p = placements[pi]!
        const rowSpan = p.cell.rowSpan ?? 1
        if (rowSpan > 1) continue
        const required = measureCellRequiredHeight(p, dataRow, context)
        if (required !== null && required > maxTextHeight) {
          maxTextHeight = required
        }
      }

      if (maxTextHeight > rowHeights[rowIdx]!) {
        rowHeights[rowIdx] = maxTextHeight
      }
    }

    // rowSpan cells: when the content exceeds the combined height of the
    // spanned rows, grow the last spanned row by the deficit so the content
    // is not clipped away.
    for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
      const placements = rowPlacements[rowIdx]!
      const dataRow = flatDataRows[rowIdx]
      for (let pi = 0; pi < placements.length; pi++) {
        const p = placements[pi]!
        const rowSpan = p.cell.rowSpan ?? 1
        if (rowSpan <= 1) continue
        const required = measureCellRequiredHeight(p, dataRow, context)
        if (required === null) continue
        let spannedTotal = 0
        let lastRow = rowIdx
        for (let r = 0; r < rowSpan && rowIdx + r < totalRows; r++) {
          spannedTotal += rowHeights[rowIdx + r]!
          lastRow = rowIdx + r
        }
        if (required > spannedTotal) {
          rowHeights[lastRow] = rowHeights[lastRow]! + (required - spannedTotal)
        }
      }
    }

    // Recompute row Y coordinates and total height
    totalHeight = 0
    for (let i = 0; i < totalRows; i++) {
      rowYPositions[i] = totalHeight
      totalHeight += rowHeights[i]!
    }

    // Recompute heights of rowSpan cells
    for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
      const placements = rowPlacements[rowIdx]!
      for (let pi = 0; pi < placements.length; pi++) {
        const p = placements[pi]!
        const rowSpan = p.cell.rowSpan ?? 1
        if (rowSpan > 1) {
          let cellHeight = 0
          for (let r = 0; r < rowSpan && rowIdx + r < totalRows; r++) {
            cellHeight += rowHeights[rowIdx + r]!
          }
          p.cellHeight = cellHeight
        } else {
          p.cellHeight = rowHeights[rowIdx]!
        }
      }
    }
  }

  // ─── Render each row ───
  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const dataRow = flatDataRows[rowIdx]
    const placements = rowPlacements[rowIdx]!
    const rowChildren: RenderNode[] = []
    const rowHeight = rowHeights[rowIdx]!

    for (let pi = 0; pi < placements.length; pi++) {
      const p = placements[pi]!
      const cell = p.cell
      const cellX = colXPositions[p.startCol]!
      const colSpan = cell.colSpan ?? 1
      const resolvedStyle = resolveTableCellStyle(p.column, cell)
      const endCol = Math.min(numCols - 1, p.startCol + colSpan - 1)
      const cellOpacity = resolvedStyle.opacity
      const hasCellOpacity = cellOpacity !== undefined && cellOpacity < 1
      const cellChildren: RenderNode[] | null = hasCellOpacity ? [] : null

      // Cell background
      if (resolvedStyle.backcolor) {
        const bgRect: RenderNode = {
          type: 'rect',
          x: hasCellOpacity ? 0 : cellX, y: 0,
          width: p.cellWidth, height: p.cellHeight,
          fill: resolvedStyle.backcolor,
        }
        if (hasCellOpacity) {
          cellChildren!.push(bgRect)
        } else {
          rowChildren.push(bgRect)
        }
      }

      // Cell text
      let text = cell.text ?? ''
      if (cell.expression && dataRow) {
        const match = cell.expression.match(/^field\.(\w+)$/)
        if (match) {
          const val = dataRow[match[1]!]
          text = val != null ? String(val) : ''
        } else if (context?.resolveExpression) {
          text = context.resolveExpression(cell.expression)
        }
      } else if (cell.expression && context?.resolveExpression) {
        text = context.resolveExpression(cell.expression)
      }

      const target = hasCellOpacity ? cellChildren! : rowChildren
      const xOffset = hasCellOpacity ? 0 : cellX

      // Cell with child elements: render with renderCellElements
      if (cell.elements && cell.elements.length > 0 && context?.renderCellElements) {
        const pad = resolvedStyle.padding
        const contentW = p.cellWidth - pad * 2
        const contentH = p.cellHeight - pad * 2
        const elemNodes = context.renderCellElements(cell.elements, contentW, contentH)
        if (elemNodes.length > 0) {
          const clipGroup: RenderGroup = {
            type: 'group',
            x: xOffset + pad, y: pad,
            width: contentW, height: contentH,
            clip: true,
            children: elemNodes,
          }
          target.push(clipGroup)
        }
      } else if (text) {
        const pad = resolvedStyle.padding
        let fontSize = resolvedStyle.fontSize ?? 10
        const color = resolvedStyle.forecolor ?? '#000000'
        const rotation = resolvedStyle.rotation ?? 0
        const swapDims = rotation === 90 || rotation === 270
        const layoutW = swapDims ? p.cellHeight - pad * 2 : p.cellWidth - pad * 2
        const layoutH = swapDims ? p.cellWidth - pad * 2 : p.cellHeight - pad * 2
        const textWidth = p.cellWidth - pad * 2
        const wrapEnabled = resolvedStyle.wrap !== false
        const cellFontId = resolvedStyle.fontId ?? 'default'
        const cellMeasurer = context?.fontMap?.get(cellFontId) ?? context?.measurer

        if (cellMeasurer && layoutW > 0) {
          // For the shrinkToFit check: no elementHeight (to avoid layoutText truncation and obtain the natural height)
          const measureOptions: Parameters<typeof layoutText>[3] = {
            maxWidth: wrapEnabled ? layoutW : Infinity,
            lineSpacing: resolvedStyle.lineSpacing,
            letterSpacing: resolvedStyle.letterSpacing,
            tracking: resolvedStyle.tracking,
            wordSpacing: resolvedStyle.wordSpacing,
            firstLineIndent: resolvedStyle.firstLineIndent,
            leftIndent: resolvedStyle.leftIndent,
            rightIndent: resolvedStyle.rightIndent,
          }

          // fitWidth: auto-adjust the font size so the longest line fits the cell width (shrink/grow)
          if (resolvedStyle.fitWidth && layoutW > 0) {
            let fittedSize = fontSize
            for (let iter = 0; iter < 20; iter++) {
              const fitResult = layoutText(text, cellMeasurer, fittedSize, measureOptions)
              let maxLineWidth = 0
              for (let li = 0; li < fitResult.lines.length; li++) {
                if (fitResult.lines[li]!.width > maxLineWidth) maxLineWidth = fitResult.lines[li]!.width
              }
              if (maxLineWidth <= 0) break
              const nextSize = fittedSize * (layoutW / maxLineWidth)
              if (nextSize < 0.1) { fittedSize = 0.1; break }
              if (Math.abs(nextSize - fittedSize) <= 0.05) { fittedSize = nextSize; break }
              fittedSize = nextSize
            }
            fontSize = fittedSize
          }

          // shrinkToFit: reduce the font size to fit within the cell
          if (resolvedStyle.shrinkToFit) {
            const minSize = resolvedStyle.minFontSize ?? 4
            const firstResult = layoutText(text, cellMeasurer, fontSize, measureOptions)
            const heightOverflow = firstResult.totalHeight > layoutH
            let horizontalOverflow = false
            if (!wrapEnabled) {
              for (let li = 0; li < firstResult.lines.length; li++) {
                if (firstResult.lines[li]!.width > layoutW) { horizontalOverflow = true; break }
              }
            }
            if (heightOverflow || horizontalOverflow) {
              let lo = minSize
              let hi = fontSize
              for (let iter = 0; iter < 20 && hi - lo > 0.25; iter++) {
                const mid = (lo + hi) / 2
                const midResult = layoutText(text, cellMeasurer, mid, measureOptions)
                const midHeightOverflow = midResult.totalHeight > layoutH
                let midHorizOverflow = false
                if (!wrapEnabled) {
                  for (let li = 0; li < midResult.lines.length; li++) {
                    if (midResult.lines[li]!.width > layoutW) { midHorizOverflow = true; break }
                  }
                }
                if (midHeightOverflow || midHorizOverflow) {
                  hi = mid
                } else {
                  lo = mid
                }
              }
              fontSize = lo
            }
          }

          // Final layout: with elementHeight (for vAlign calculation)
          // With fitWidth, enable stretchWithOverflow to prevent text truncation by the height constraint
          const isFitWidth = resolvedStyle.fitWidth === true
          const result = layoutText(text, cellMeasurer, fontSize, {
            ...measureOptions,
            elementHeight: layoutH,
            hAlign: resolvedStyle.hAlign,
            vAlign: resolvedStyle.vAlign,
            stretchWithOverflow: isFitWidth,
          })
          const textNodes: RenderText[] = []

          for (let li = 0; li < result.lines.length; li++) {
            const line = result.lines[li]!
            if (line.text === '') continue
            let fitAlignOffset = 0
            if (isFitWidth) {
              const lineWidth = line.width
              if (resolvedStyle.hAlign === 'right') {
                fitAlignOffset = layoutW - lineWidth
              } else if (resolvedStyle.hAlign === 'center') {
                fitAlignOffset = (layoutW - lineWidth) / 2
              }
            }
            const textNode: RenderText = {
              type: 'text',
              x: (rotation ? 0 : xOffset + pad) + fitAlignOffset,
              y: line.y,
              text: line.text,
              fontId: resolvedStyle.fontId ?? 'default',
              fontSize,
              color,
              bold: resolvedStyle.bold,
              italic: resolvedStyle.italic,
              underline: resolvedStyle.underline,
              strikethrough: resolvedStyle.strikethrough || undefined,
              hAlign: isFitWidth ? 'left' : resolvedStyle.hAlign,
              width: isFitWidth ? line.width : layoutW,
              outlineText: resolvedStyle.outlineText || undefined,
              glyphRun: line.run,
            }
            if (resolvedStyle.letterSpacing) textNode.letterSpacing = resolvedStyle.letterSpacing
            textNodes.push(textNode)
          }

          if (textNodes.length > 0) {
            if (rotation) {
              // Wrap rotated text in a group (with clip)
              const rotGroup: RenderGroup = {
                type: 'group',
                x: xOffset + pad, y: pad,
                width: textWidth, height: p.cellHeight - pad * 2,
                clip: true,
                children: textNodes,
              }
              switch (rotation) {
                case 90:
                  rotGroup.rotation = -90
                  rotGroup.rotationOriginX = layoutH / 2
                  rotGroup.rotationOriginY = layoutH / 2
                  break
                case 180:
                  rotGroup.rotation = 180
                  rotGroup.rotationOriginX = textWidth / 2
                  rotGroup.rotationOriginY = (p.cellHeight - pad * 2) / 2
                  break
                case 270:
                  rotGroup.rotation = 90
                  rotGroup.rotationOriginX = textWidth / 2
                  rotGroup.rotationOriginY = textWidth / 2
                  break
              }
              target.push(rotGroup)
            } else {
              // No rotation: wrap in a clipping group (convert coordinates to group-local)
              for (let ti = 0; ti < textNodes.length; ti++) {
                textNodes[ti]!.x = pad
                textNodes[ti]!.y += pad
              }
              const clipGroup: RenderGroup = {
                type: 'group',
                x: hasCellOpacity ? 0 : cellX, y: 0,
                width: p.cellWidth, height: p.cellHeight,
                clip: true,
                children: textNodes,
              }
              target.push(clipGroup)
            }
          }
        } else {
          // No measurer: fallback
          let textY = 0
          if (resolvedStyle.vAlign === 'middle') {
            textY = (layoutH - fontSize) / 2
          } else if (resolvedStyle.vAlign === 'bottom') {
            textY = layoutH - fontSize
          }

          const textNode: RenderText = {
            type: 'text',
            x: 0,
            y: textY,
            text,
            fontId: resolvedStyle.fontId ?? 'default',
            fontSize,
            color,
            bold: resolvedStyle.bold,
            italic: resolvedStyle.italic,
            underline: resolvedStyle.underline,
            strikethrough: resolvedStyle.strikethrough || undefined,
            hAlign: resolvedStyle.hAlign,
            width: layoutW,
            outlineText: resolvedStyle.outlineText || undefined,
          }
          if (resolvedStyle.letterSpacing) textNode.letterSpacing = resolvedStyle.letterSpacing
          const clipGroup: RenderGroup = {
            type: 'group',
            x: (rotation ? 0 : xOffset) + pad, y: pad,
            width: textWidth, height: p.cellHeight - pad * 2,
            clip: true,
            children: [textNode],
          }
          target.push(clipGroup)
        }
      }

      pushBorderLine(
        target,
        resolveBorderSide(resolvedStyle.border, 'right'),
        xOffset + p.cellWidth,
        0,
        xOffset + p.cellWidth,
        p.cellHeight,
      )
      pushBorderLine(
        target,
        resolveBorderSide(resolvedStyle.border, 'bottom'),
        xOffset,
        p.cellHeight,
        xOffset + p.cellWidth,
        p.cellHeight,
      )

      pushBorderLine(
        target,
        resolveBorderSide(resolvedStyle.border, 'top'),
        xOffset,
        0,
        xOffset + p.cellWidth,
        0,
      )
      pushBorderLine(
        target,
        resolveBorderSide(resolvedStyle.border, 'left'),
        xOffset,
        0,
        xOffset,
        p.cellHeight,
      )

      if (hasCellOpacity) {
        rowChildren.push({
          type: 'group',
          x: cellX,
          y: 0,
          width: p.cellWidth,
          height: p.cellHeight,
          opacity: cellOpacity,
          children: cellChildren!,
        })
      }
    }

    children.push({
      type: 'group',
      x: 0,
      y: rowYPositions[rowIdx]!,
      width,
      height: rowHeight,
      children: rowChildren,
    })
  }

  return {
    type: 'group',
    x, y,
    width,
    height: totalHeight,
    children,
  }
}

/**
 * Lays out the table with page-break support.
 * Renders data rows starting at startDataRow, cutting off when maxHeight
 * is exceeded. Header rows are rendered on every page; footer rows only
 * on the last page.
 */
export function layoutTablePaged(
  table: TableDef,
  x: number,
  y: number,
  width: number,
  rows: Record<string, unknown>[],
  context: TableLayoutContext,
  startDataRow: number,
  maxHeight: number,
): TableLayoutResult {
  const totalDataRows = rows.length
  const headerHeight = computeRowsHeight(table.headerRows)
  const footerHeight = computeRowsHeight(table.footerRows)
  const detailRowDefs = table.detailRows ?? []
  const detailPerData = detailRowDefs.length || 1

  // If the headers alone exceed maxHeight, render everything
  if (headerHeight >= maxHeight) {
    const group = layoutTable(table, x, y, width, rows.slice(startDataRow), context)
    return { group, renderedDataRows: totalDataRows - startDataRow, complete: true }
  }

  // Binary-search for the maximum number of rows that fit within maxHeight, adding one row at a time
  let lo = 0
  let hi = totalDataRows - startDataRow

  // Check whether all data fits
  const allRows = rows.slice(startDataRow)
  const fullGroup = layoutTable(table, x, y, width, allRows, context)
  if (fullGroup.height <= maxHeight) {
    return { group: fullGroup, renderedDataRows: hi, complete: true }
  }

  // Binary search: maximum number of data rows that fit within maxHeight without the footer
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const subRows = rows.slice(startDataRow, startDataRow + mid)
    // Layout without the footer (intermediate page)
    const tableDef: TableDef = {
      columns: table.columns,
      headerRows: table.headerRows,
      detailRows: table.detailRows,
    }
    const testGroup = layoutTable(tableDef, x, y, width, subRows, context)
    if (testGroup.height <= maxHeight) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  // lo = number of data rows that fit (if 0, render at least one row)
  let fitCount = lo > 0 ? lo : 1
  let isComplete = startDataRow + fitCount >= totalDataRows

  // The footer belongs to the final chunk: when appending it would overflow
  // maxHeight, move trailing data rows (and the footer) to the next page
  // instead of drawing past the page bottom.
  if (isComplete && footerHeight > 0) {
    for (;;) {
      const testRows = rows.slice(startDataRow, startDataRow + fitCount)
      const testDef: TableDef = {
        columns: table.columns,
        headerRows: table.headerRows,
        detailRows: table.detailRows,
        footerRows: table.footerRows,
        border: table.border,
      }
      const testGroup = layoutTable(testDef, x, y, width, testRows, context)
      if (testGroup.height <= maxHeight || fitCount <= 1) break
      fitCount--
      isComplete = false
    }
  }

  // With footer on the last page, without footer otherwise
  const subRows = rows.slice(startDataRow, startDataRow + fitCount)
  const pageDef: TableDef = {
    columns: table.columns,
    headerRows: table.headerRows,
    detailRows: table.detailRows,
    footerRows: isComplete ? table.footerRows : undefined,
    border: table.border,
  }
  const group = layoutTable(pageDef, x, y, width, subRows, context)

  return { group, renderedDataRows: fitCount, complete: isComplete }
}

function computeRowsHeight(rows?: TableRowDef[]): number {
  if (!rows) return 0
  let h = 0
  for (let i = 0; i < rows.length; i++) h += rows[i]!.height
  return h
}

/**
 * Measures the height a cell's content requires (including padding).
 * Returns null when the cell does not drive row height (no measurable text,
 * fitWidth cells, or no measurer available).
 */
function measureCellRequiredHeight(
  p: CellPlacement,
  dataRow: Record<string, unknown> | undefined,
  context: TableLayoutContext | undefined,
): number | null {
  const cell = p.cell

  // Cell with child elements: measure the height with measureCellElements
  if (cell.elements && cell.elements.length > 0 && context?.measureCellElements) {
    const resolvedStyle = resolveTableCellStyle(p.column, cell)
    const pad = resolvedStyle.padding
    const elemHeight = context.measureCellElements(cell.elements, p.cellWidth - pad * 2)
    return elemHeight + pad * 2
  }

  const resolvedStyle = resolveTableCellStyle(p.column, cell)

  let text = cell.text ?? ''
  if (cell.expression && dataRow) {
    const match = cell.expression.match(/^field\.(\w+)$/)
    if (match) {
      const val = dataRow[match[1]!]
      text = val != null ? String(val) : ''
    } else if (context?.resolveExpression) {
      text = context.resolveExpression(cell.expression)
    }
  } else if (cell.expression && context?.resolveExpression) {
    text = context.resolveExpression(cell.expression)
  }

  if (!text) return null

  const cellFontId = resolvedStyle.fontId ?? 'default'
  const measurer = context?.fontMap?.get(cellFontId) ?? context?.measurer
  if (!measurer) return null

  const pad = resolvedStyle.padding
  let fontSize = resolvedStyle.fontSize ?? 10
  const availableWidth = p.cellWidth - pad * 2

  if (availableWidth <= 0) return null

  const wrapEnabled = resolvedStyle.wrap !== false
  const layoutOptions: Parameters<typeof layoutText>[3] = {
    maxWidth: wrapEnabled ? availableWidth : Infinity,
    lineSpacing: resolvedStyle.lineSpacing,
    letterSpacing: resolvedStyle.letterSpacing,
    tracking: resolvedStyle.tracking,
    wordSpacing: resolvedStyle.wordSpacing,
    firstLineIndent: resolvedStyle.firstLineIndent,
    leftIndent: resolvedStyle.leftIndent,
    rightIndent: resolvedStyle.rightIndent,
  }

  // fitWidth fits the text to the cell width; it does not contribute to row height growth.
  if (resolvedStyle.fitWidth && availableWidth > 0) {
    return null
  }

  // shrinkToFit: reflect the font size reduction when measuring height as well
  if (resolvedStyle.shrinkToFit) {
    const availableHeight = p.cellHeight - pad * 2
    const minSize = resolvedStyle.minFontSize ?? 4
    const firstResult = layoutText(text, measurer, fontSize, layoutOptions)
    const heightOverflow = firstResult.totalHeight > availableHeight
    let horizontalOverflow = false
    if (!wrapEnabled) {
      for (let li = 0; li < firstResult.lines.length; li++) {
        if (firstResult.lines[li]!.width > availableWidth) { horizontalOverflow = true; break }
      }
    }
    if (heightOverflow || horizontalOverflow) {
      let lo = minSize
      let hi = fontSize
      for (let iter = 0; iter < 20 && hi - lo > 0.25; iter++) {
        const mid = (lo + hi) / 2
        const midResult = layoutText(text, measurer, mid, layoutOptions)
        const midHeightOverflow = midResult.totalHeight > availableHeight
        let midHorizOverflow = false
        if (!wrapEnabled) {
          for (let li = 0; li < midResult.lines.length; li++) {
            if (midResult.lines[li]!.width > availableWidth) { midHorizOverflow = true; break }
          }
        }
        if (midHeightOverflow || midHorizOverflow) {
          hi = mid
        } else {
          lo = mid
        }
      }
      fontSize = lo
    }
  }

  const result = layoutText(text, measurer, fontSize, layoutOptions)
  return result.totalHeight + pad * 2
}

/**
 * Computes column X coordinates
 */
function computeColumnPositions(columns: TableColumnDef[], totalWidth: number): number[] {
  const positions: number[] = []
  let x = 0

  // Sum of fixed widths
  let fixedWidth = 0
  for (const col of columns) {
    fixedWidth += col.width
  }

  // Scaling (fit to the table width)
  const scale = fixedWidth > 0 ? totalWidth / fixedWidth : 1

  for (const col of columns) {
    positions.push(x)
    x += col.width * scale
  }

  return positions
}
