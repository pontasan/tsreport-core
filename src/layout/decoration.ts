/**
 * Element decoration builders.
 *
 * Border geometry (half-width extensions at the corners), dash patterns, and
 * background rectangles are defined here once and shared by the layout engine,
 * the table layout, and external design-time renderers (e.g. an editor canvas)
 * so the decoration rules can never diverge between the design view and the
 * final output.
 */

import type { RenderNode, RenderRect } from '../types/render.js'
import type { BorderDef } from '../types/template.js'

/** Dash pattern for a line style (independent of line width). */
export function lineStyleDash(style: 'solid' | 'dashed' | 'dotted' | undefined): number[] | undefined {
  if (style === 'dashed') return [4, 2]
  if (style === 'dotted') return [1, 1]
  return undefined
}

/** Background fill rectangle covering the decorated area. */
export function buildBackgroundRect(width: number, height: number, fill: string): RenderRect {
  return { type: 'rect', x: 0, y: 0, width, height, fill }
}

/**
 * Append the four border lines of a box to `children`.
 *
 * Horizontal lines extend by half the left/right border widths and vertical
 * lines extend by half the top/bottom border widths, so corners meet without
 * gaps or overshoot regardless of the per-side widths.
 */
export function appendBorderNodes(
  children: RenderNode[],
  width: number,
  height: number,
  border: BorderDef,
): void {
  const defaultWidth = border.width ?? 1
  const defaultColor = border.color ?? '#000000'
  const defaultStyle = border.style ?? 'solid'

  const topWidth = border.top === null ? 0 : (border.top?.width ?? defaultWidth)
  const bottomWidth = border.bottom === null ? 0 : (border.bottom?.width ?? defaultWidth)
  const leftWidth = border.left === null ? 0 : (border.left?.width ?? defaultWidth)
  const rightWidth = border.right === null ? 0 : (border.right?.width ?? defaultWidth)

  const sides = [
    {
      side: border.top,
      x1: leftWidth > 0 ? -leftWidth / 2 : 0,
      y1: 0,
      x2: width + (rightWidth > 0 ? rightWidth / 2 : 0),
      y2: 0,
    },
    {
      side: border.bottom,
      x1: leftWidth > 0 ? -leftWidth / 2 : 0,
      y1: height,
      x2: width + (rightWidth > 0 ? rightWidth / 2 : 0),
      y2: height,
    },
    {
      side: border.left,
      x1: 0,
      y1: topWidth > 0 ? -topWidth / 2 : 0,
      x2: 0,
      y2: height + (bottomWidth > 0 ? bottomWidth / 2 : 0),
    },
    {
      side: border.right,
      x1: width,
      y1: topWidth > 0 ? -topWidth / 2 : 0,
      x2: width,
      y2: height + (bottomWidth > 0 ? bottomWidth / 2 : 0),
    },
  ]

  for (let i = 0; i < sides.length; i++) {
    const sideDef = sides[i]!
    const side = sideDef.side
    if (side === null) continue

    const lineWidth = side?.width ?? defaultWidth
    const color = side?.color ?? defaultColor
    const lineStyle = side?.style ?? defaultStyle

    children.push({
      type: 'line',
      x1: sideDef.x1,
      y1: sideDef.y1,
      x2: sideDef.x2,
      y2: sideDef.y2,
      lineWidth,
      color,
      dash: lineStyleDash(lineStyle),
    })
  }
}
