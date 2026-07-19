/**
 * Shared appearance painter for interactive form fields (AcroForm widgets).
 *
 * The PDF backend uses this to build widget appearance streams and the
 * preview backends (Canvas/SVG) use the same code to draw the design-time /
 * preview representation, so what the user sees always matches the printed
 * output — the single-implementation guarantee the renderer relies on.
 */

import type { RenderFormField } from '../types/render.js'

/** The subset of RenderBackend the appearance painter needs. */
export interface FormFieldPaintSink {
  drawRect(x: number, y: number, width: number, height: number, options?: { fill?: string, stroke?: string, strokeWidth?: number }): void
  drawEllipse(cx: number, cy: number, rx: number, ry: number, options?: { fill?: string, stroke?: string, strokeWidth?: number }): void
  drawText(x: number, y: number, text: string, fontId: string, fontSize: number, color: string, options?: { horizontalScale?: number }): void
  drawPathWithPaints(commands: Uint8Array, coords: Float32Array, options: { stroke?: string, fill?: string, strokeWidth?: number, strokeLinecap?: 'butt' | 'round' | 'square', strokeLinejoin?: 'miter' | 'round' | 'bevel' }): void
}

/**
 * Paints one form field's appearance into the sink.
 * @param active For checkbox/radio: whether this widget is in its on state.
 */
export function paintFormFieldAppearance(
  sink: FormFieldPaintSink,
  x: number, y: number, width: number, height: number,
  field: RenderFormField, active: boolean,
): void {
  // Radio buttons render as a circle; others as a rectangle
  const isRadio = field.fieldType === 'radio'
  if (field.backgroundColor !== undefined) {
    if (isRadio) sink.drawEllipse(x + width / 2, y + height / 2, width / 2, height / 2, { fill: field.backgroundColor })
    else sink.drawRect(x, y, width, height, { fill: field.backgroundColor })
  }
  if (field.borderColor !== undefined) {
    if (isRadio) sink.drawEllipse(x + width / 2, y + height / 2, width / 2, height / 2, { stroke: field.borderColor, strokeWidth: 1 })
    else sink.drawRect(x, y, width, height, { stroke: field.borderColor, strokeWidth: 1 })
  }

  switch (field.fieldType) {
    case 'checkbox':
      if (active) paintCheckMark(sink, x, y, width, height, field.color)
      break
    case 'radio':
      if (active) {
        // Filled inner dot
        const r = Math.min(width, height) * 0.25
        sink.drawEllipse(x + width / 2, y + height / 2, r, r, { fill: field.color })
      }
      break
    case 'pushbutton': {
      const caption = field.caption ?? ''
      if (caption !== '') paintCenteredText(sink, x, y, width, height, caption, field)
      break
    }
    case 'dropdown': {
      // Selected value on the left, a down-arrow marker on the right
      const arrowWidth = Math.min(height, 14)
      if (field.value !== undefined && field.value !== '') {
        paintVerticallyCenteredLine(sink, x, y, width - arrowWidth, height, field.value, field)
      }
      paintDownArrow(sink, x + width - arrowWidth, y, arrowWidth, height, field.color)
      break
    }
    case 'listbox': {
      const options = field.options ?? []
      const lineHeight = field.fontSize * 1.25
      let textY = y + 2
      for (const option of options) {
        if (textY + lineHeight > y + height) break
        const selected = field.value !== undefined && splitSelection(field.value).includes(option.value)
        if (selected) {
          sink.drawRect(x + 1, textY, width - 2, lineHeight, { fill: '#b5d5ff' })
        }
        sink.drawText(x + 3, textY + (lineHeight - field.fontSize) / 2, option.label, field.fontId, field.fontSize, field.color)
        textY += lineHeight
      }
      break
    }
    case 'signature':
      // Empty signature area; leave the box (border/background already drawn)
      break
    case 'text':
    default:
      if (field.value !== undefined && field.value !== '') {
        const lines = field.multiline === true ? field.value.split('\n') : [field.value]
        const lineHeight = field.fontSize * 1.2
        let textY = field.multiline === true ? y + 2 : y + (height - lineHeight) / 2
        for (const line of lines) {
          sink.drawText(x + 2, textY, line, field.fontId, field.fontSize, field.color)
          textY += lineHeight
        }
      }
      break
  }
}

function paintCheckMark(sink: FormFieldPaintSink, x: number, y: number, width: number, height: number, color: string): void {
  const inset = Math.min(width, height) * 0.2
  const commands = new Uint8Array([0, 1, 1]) // M L L
  const coords = new Float32Array([
    x + inset, y + height * 0.55,
    x + width * 0.42, y + height - inset,
    x + width - inset, y + inset,
  ])
  sink.drawPathWithPaints(commands, coords, {
    stroke: color,
    strokeWidth: Math.max(1, Math.min(width, height) * 0.12),
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  })
}

function paintDownArrow(sink: FormFieldPaintSink, x: number, y: number, width: number, height: number, color: string): void {
  const cx = x + width / 2
  const cy = y + height / 2
  const s = Math.min(width, height) * 0.28
  const commands = new Uint8Array([0, 1, 1, 3]) // M L L Z
  const coords = new Float32Array([
    cx - s, cy - s * 0.5,
    cx + s, cy - s * 0.5,
    cx, cy + s * 0.7,
  ])
  sink.drawPathWithPaints(commands, coords, { fill: color })
}

function paintCenteredText(sink: FormFieldPaintSink, x: number, y: number, width: number, height: number, text: string, field: RenderFormField): void {
  // Approximate centering: 0.5em per character advance
  const approxWidth = text.length * field.fontSize * 0.5
  const textX = x + Math.max(2, (width - approxWidth) / 2)
  const textY = y + (height - field.fontSize) / 2
  sink.drawText(textX, textY, text, field.fontId, field.fontSize, field.color)
}

function paintVerticallyCenteredLine(sink: FormFieldPaintSink, x: number, y: number, width: number, height: number, text: string, field: RenderFormField): void {
  const textY = y + (height - field.fontSize) / 2
  sink.drawText(x + 2, textY, text, field.fontId, field.fontSize, field.color)
  void width
}

/** Listbox multi-selection is stored newline-separated in the value. */
export function splitSelection(value: string): string[] {
  return value.split('\n')
}
