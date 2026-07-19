/**
 * Text line-breaking engine
 *
 * Splits text into lines that fit within a maximum width and returns layout information.
 * Supports English word wrapping, Japanese kinsoku (line-breaking rules), and mixed CJK text.
 */

import type { TextMeasurer, ShapedMeasurement } from '../measure/text-measurer.js'
import type { RenderGlyphRun } from '../types/render.js'
import { applyMergeGroupsToRun, buildGlyphRunFromShaped, shapeGlyphRun } from '../measure/glyph-run.js'
import { applyAatJustification } from './aat-justification.js'
import { PROP_ATTACHES_ON_RIGHT } from '../parsers/tables/prop.js'
import { resolveBidi, getMirrorChar } from './bidi.js'
import { canBreakAt, isLineBreakJustificationGap } from './line-break.js'
import { buildGraphemeBoundaryFlags } from './grapheme-break.js'
import { normalizeUnicodeText, type UnicodeNormalizationForm } from './unicode-normalization.js'
import type { JstfPriority } from '../parsers/tables/jstf.js'
import type { ShapeOptions } from '../font.js'

// ─── Public types ───

export interface TextLayoutOptions {
  /** Maximum line width (pt) */
  maxWidth: number
  /** Maximum height (pt, 0 = unlimited) */
  maxHeight?: number
  /** Horizontal alignment */
  hAlign?: 'left' | 'center' | 'right' | 'justify'
  /** Vertical alignment */
  vAlign?: 'top' | 'middle' | 'bottom'
  /** Line spacing settings */
  lineSpacing?: LineSpacingDef
  /** Letter spacing (pt) */
  letterSpacing?: number
  /** AAT trak track value. Converted from FUnits to pt and added per glyph. */
  tracking?: number
  /** Word spacing (pt, extra width added to space characters) */
  wordSpacing?: number
  /** Horizontal text scale multiplier. Default is 1. */
  horizontalScale?: number
  /** First-line indent (pt) */
  firstLineIndent?: number
  /** Left indent (pt) */
  leftIndent?: number
  /** Right indent (pt) */
  rightIndent?: number
  /** Text truncation */
  textTruncate?: 'none' | 'truncate' | 'ellipsisChar' | 'ellipsisWord'
  /** Whether to stretch the element on overflow */
  stretchWithOverflow?: boolean
  /** Element height (pt, used for vAlign/truncate calculations) */
  elementHeight?: number
  /** Text direction */
  direction?: 'ltr' | 'rtl' | 'auto'
  /** Writing mode */
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  /** Tab stop definitions */
  tabStops?: { position: number; alignment?: 'left' | 'center' | 'right' }[]
  /** Default tab interval (pt). Defaults to 40pt when unspecified */
  tabStopWidth?: number
  /** Unicode normalization applied before layout. Defaults to NFC. */
  unicodeNormalization?: UnicodeNormalizationForm | 'none'
  /** Device pixels per em used to resolve OpenType Device adjustments in layout metrics. */
  devicePpem?: number
  /** OpenType script tag used to select script-specific JSTF data. */
  openTypeScript?: string
  /** OpenType language-system tag used to select language-specific JSTF data. */
  openTypeLanguage?: string
  /** OpenType feature values applied globally during measurement, line breaking, and rendering. */
  openTypeFeatures?: Readonly<Record<string, number>>
}

type LayoutShapeOptions = Omit<ShapeOptions, 'direction' | 'trackingAdjustment' | 'ppem'>

function buildLayoutShapeOptions(options: TextLayoutOptions): LayoutShapeOptions | undefined {
  const values = options.openTypeFeatures
  const tags = values === undefined ? [] : Object.keys(values)
  if (options.openTypeScript === undefined && options.openTypeLanguage === undefined && tags.length === 0) return undefined
  const shapeOptions: LayoutShapeOptions = {
    script: options.openTypeScript,
    language: options.openTypeLanguage,
  }
  if (values !== undefined) {
    const settings = new Array<{ tag: string, value: number }>(tags.length)
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i]!
      settings[i] = { tag, value: values[tag]! }
    }
    shapeOptions.featureSettings = settings
  }
  return shapeOptions
}

export interface LineSpacingDef {
  /** Line spacing mode */
  type: 'single' | '1.5' | 'double' | 'proportional' | 'fixed' | 'minimum'
  /** Value used for fixed/minimum/proportional */
  value?: number
}

export interface TextLayoutResult {
  /** The broken lines */
  lines: LayoutLine[]
  /** Total text height (pt) */
  totalHeight: number
  /** Whether truncation occurred */
  truncated: boolean
}

export interface LayoutLine {
  /** Line text */
  text: string
  /** Line width (pt) */
  width: number
  /** Line Y coordinate (relative to element top, pt) */
  y: number
  /** Column X coordinate (for vertical writing, relative to element right/left edge) */
  x?: number
  /** Extra width between characters when justified (pt) */
  justifySpacing?: number
  /** Base direction of the line */
  direction?: 'ltr' | 'rtl'
  /** Tab-separated segments (only for lines containing tab characters) */
  segments?: { text: string; x: number; run?: RenderGlyphRun }[]
  /** Shaped glyph run for this line (advances include letter/word/justify spacing) */
  run?: RenderGlyphRun
  /** Visual inline-axis caret stops, including OpenType GDEF and AAT lcar ligature divisions. */
  caretPositions?: Float64Array
}

// ─── Main layout function ───

/**
 * Splits text into lines
 */
export function layoutText(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  options: TextLayoutOptions,
): TextLayoutResult {
  if (options.unicodeNormalization !== 'none') {
    text = normalizeUnicodeText(text, options.unicodeNormalization ?? 'NFC')
  }
  if (text === '') {
    return { lines: [], totalHeight: 0, truncated: false }
  }

  // Vertical text mode
  if (options.writingMode === 'vertical-rl' || options.writingMode === 'vertical-lr') {
    return layoutTextVertical(text, measurer, fontSize, options)
  }

  const lineHeight = computeLineHeight(measurer, fontSize, options.lineSpacing)
  const ascent = measurer.getAscent(fontSize)
  const letterSpacing = effectiveLetterSpacing(measurer, fontSize, options.letterSpacing, options.tracking, false)
  const wordSpacing = options.wordSpacing ?? 0
  const horizontalScale = options.horizontalScale ?? 1
  const shapeOptions = buildLayoutShapeOptions(options)
  const leftIndent = options.leftIndent ?? 0
  const rightIndent = options.rightIndent ?? 0
  const firstLineIndent = options.firstLineIndent ?? 0

  // Split into paragraphs at explicit mandatory line separators.
  const paragraphs = splitParagraphs(text)

  const allLines: LayoutLine[] = []
  let truncated = false

  for (const para of paragraphs) {
    if (para === '') {
      // Empty line
      allLines.push({ text: '', width: 0, y: 0 })
      continue
    }

    const isFirstLine = allLines.length === 0
    const indent = leftIndent + (isFirstLine ? firstLineIndent : 0)
    const effectiveWidth = options.maxWidth - indent - rightIndent

    if (effectiveWidth <= 0) {
      allLines.push({ text: para, width: 0, y: 0 })
      continue
    }

    const lines = breakLines(para, measurer, fontSize, effectiveWidth, letterSpacing, wordSpacing, horizontalScale, options.tabStops, options.tabStopWidth, options.devicePpem, shapeOptions)
    for (let i = 0; i < lines.length; i++) {
      // Add firstLineIndent only for the first line of the first paragraph
      const lineIndent = leftIndent + ((allLines.length === 0 && i === 0) ? firstLineIndent : 0)
      const lineEffectiveWidth = options.maxWidth - lineIndent - rightIndent

      // No recomputation needed for the line's extra indent (breakLines already used the effective width)
      // However, lines after the first use only leftIndent, so re-breaking may be needed
      // → breakLines splits the whole paragraph with effectiveWidth, but
      //   when firstLineIndent is set, only the first line is narrower
      // Simplification: process each line independently

      allLines.push(lines[i]!)
    }
  }

  // firstLineIndent support: re-break when only the first line has a different width
  if (firstLineIndent !== 0) {
    const rebuiltLines: LayoutLine[] = []
    let remainingText = text

    for (const para of splitParagraphs(text)) {
      if (para === '') {
        rebuiltLines.push({ text: '', width: 0, y: 0 })
        continue
      }

      const isFirstLine = rebuiltLines.length === 0
      const firstWidth = options.maxWidth - leftIndent - rightIndent - (isFirstLine ? firstLineIndent : 0)
      const normalWidth = options.maxWidth - leftIndent - rightIndent

      const lines = breakLinesWithVaryingWidth(
        para, measurer, fontSize,
        isFirstLine ? firstWidth : normalWidth,
        normalWidth,
        letterSpacing, wordSpacing, horizontalScale,
        isFirstLine,
        options.tabStops,
        options.tabStopWidth,
        options.devicePpem,
        shapeOptions,
      )
      rebuiltLines.push(...lines)
    }

    allLines.length = 0
    allLines.push(...rebuiltLines)
  }

  // Height calculation and Y coordinate assignment
  const maxHeight = options.stretchWithOverflow
    ? Infinity
    : (options.maxHeight ?? options.elementHeight ?? Infinity)

  // Height actually occupied by the line's glyphs (ascent + |descent|, excluding lineGap)
  const descent = measurer.getDescent(fontSize)
  const glyphHeight = ascent - descent

  const resultLines: LayoutLine[] = []
  let totalHeight = 0

  for (let i = 0; i < allLines.length; i++) {
    const lineY = i * lineHeight
    // Line-fit check uses the actual bottom edge of the glyphs (lineGap is the spacing to the next line, not part of this line's occupied height)
    const lineBottom = lineY + glyphHeight

    if (lineBottom > maxHeight && !options.stretchWithOverflow) {
      truncated = true
      // Text truncation handling
      if (options.textTruncate === 'ellipsisChar' || options.textTruncate === 'ellipsisWord') {
        // Append an ellipsis to the end of the previous line
        if (resultLines.length > 0) {
          const lastLine = resultLines[resultLines.length - 1]!
          const ellipsis = '...'
          const effectiveWidth = options.maxWidth - (options.leftIndent ?? 0) - (options.rightIndent ?? 0)
          const wordBoundary = options.textTruncate === 'ellipsisWord'

          // If text + ellipsis fits within the width, append it as-is
          const textWithEllipsis = lastLine.text + ellipsis
          const totalWidth = measureText(textWithEllipsis, measurer, fontSize, letterSpacing, wordSpacing, horizontalScale, shapeOptions)
          if (totalWidth <= effectiveWidth) {
            resultLines[resultLines.length - 1] = {
              text: textWithEllipsis,
              width: totalWidth,
              y: lastLine.y,
              run: shapeGlyphRun(measurer.font, textWithEllipsis, fontSize, letterSpacing, wordSpacing, false, horizontalScale, 'ltr', shapeOptions),
            }
          } else {
            const truncatedLine = truncateWithEllipsis(
              lastLine.text, measurer, fontSize, effectiveWidth,
              letterSpacing, wordSpacing, horizontalScale, ellipsis, wordBoundary,
              shapeOptions,
            )
            truncatedLine.y = lastLine.y
            resultLines[resultLines.length - 1] = truncatedLine
          }
        }
      }
      // truncate / none also break here
      break
    }

    resultLines.push({
      ...allLines[i]!,
      y: lineY,
    })
    totalHeight = lineBottom
  }

  // No lines at all (everything was truncated)
  if (resultLines.length === 0 && allLines.length > 0) {
    totalHeight = 0
  }

  // Y-direction offset from vAlign
  const containerHeight = options.elementHeight ?? totalHeight
  let vOffset = 0
  if (options.vAlign === 'middle') {
    vOffset = (containerHeight - totalHeight) / 2
  } else if (options.vAlign === 'bottom') {
    vOffset = containerHeight - totalHeight
  }
  if (vOffset > 0) {
    for (const line of resultLines) {
      line.y += vOffset
    }
  }

  // Graphite justification reshapes logical text and therefore runs before
  // visual BiDi reordering. AAT/JSTF/generic spacing runs after reordering so
  // physical before/after sides and prop attachment use visual neighbours.
  const graphiteJustified = new Uint8Array(resultLines.length)
  const selectedJstfPriorities = new Map<LayoutLine, JstfPriority>()
  if (options.hAlign === 'justify') {
    const effectiveWidth = options.maxWidth - (options.leftIndent ?? 0) - (options.rightIndent ?? 0)
    for (let i = 0; i < resultLines.length; i++) {
      const line = resultLines[i]!
      const isLastLine = i === resultLines.length - 1
      if (!isLastLine && line.text.length > 1 && line.width < effectiveWidth) {
        const delta = effectiveWidth - line.width
        if (applyGraphiteJustificationToLine(
          line, measurer, fontSize, effectiveWidth, letterSpacing, wordSpacing, horizontalScale,
        )) {
          graphiteJustified[i] = 1
          line.justifySpacing = delta
        }
      }
    }
  }

  // JSTF lookup modifications reshape the original logical string. Select a
  // standalone priority before BiDi reordering; its JstfMax is applied later
  // to the corresponding visual run.
  if (options.hAlign === 'justify' && measurer.font.just === null) {
    const effectiveWidth = options.maxWidth - (options.leftIndent ?? 0) - (options.rightIndent ?? 0)
    for (let i = 0; i < resultLines.length - 1; i++) {
      if (graphiteJustified[i] === 1) continue
      const line = resultLines[i]!
      if (line.run === undefined || line.text.length <= 1) continue
      const priority = selectJstfLookupSuggestion(
        line, measurer, fontSize, effectiveWidth, letterSpacing, wordSpacing,
        horizontalScale, options.openTypeScript, options.openTypeLanguage, options.devicePpem,
        shapeOptions,
      )
      if (priority !== null) selectedJstfPriorities.set(line, priority)
    }
  }

  // BiDi processing: reorder RTL text into visual order
  const dir = options.direction
  if (dir === 'rtl' || dir === 'auto') {
    for (const line of resultLines) {
      if (line.text === '') continue
      const bidi = resolveBidi(line.text, { direction: dir })
      if (bidi.paragraphLevel > 0 || hasRtlLevel(bidi.levels)) {
        // Reorder characters into visual order
        const chars: string[] = []
        for (const ch of line.text) chars.push(ch)
        const reordered: string[] = []
        for (const idx of bidi.visualOrder) {
          const ch = chars[idx]!
          const cp = ch.codePointAt(0)!
          // Mirror characters at RTL levels
          if (bidi.levels[idx]! & 1) {
            const mirrorCp = getMirrorChar(cp)
            reordered.push(mirrorCp !== cp ? String.fromCodePoint(mirrorCp) : ch)
          } else {
            reordered.push(ch)
          }
        }
        line.text = reordered.join('')
        line.direction = bidi.paragraphLevel > 0 ? 'rtl' : 'ltr'
        // The run was shaped in logical order (Arabic joining and ligatures are
        // resolved there); reorder its glyphs into visual order so renderers
        // draw the shaped forms. Lines without a run (tab segments) keep the
        // text-based drawing path.
        if (line.run !== undefined) {
          line.run = reorderRunToVisual(line.run, bidi.visualOrder, bidi.levels, chars, measurer.font, fontSize, horizontalScale)
        }
      }
    }
  }

  // Apply visual-order justification after BiDi reordering. This is required
  // by AAT before/after width factors, repeated glyph insertion, and the prop
  // attaches-on-right rule, all of which are defined in physical order.
  if (options.hAlign === 'justify') {
    const effectiveWidth = options.maxWidth - (options.leftIndent ?? 0) - (options.rightIndent ?? 0)
    for (let i = 0; i < resultLines.length; i++) {
      if (graphiteJustified[i] === 1) continue
      const line = resultLines[i]!
      const isLastLine = i === resultLines.length - 1
      if (isLastLine || line.text.length <= 1 || line.width >= effectiveWidth) continue
      const delta = effectiveWidth - line.width
      if (line.run) {
        const runDelta = effectiveWidth - sumRunAdvances(line.run)
        const remaining = applyFontJustificationToRun(
          line.run, measurer.font, line.text, runDelta, fontSize, horizontalScale,
          'horizontal', options.openTypeScript, options.openTypeLanguage, options.devicePpem,
          selectedJstfPriorities.get(line),
        )
        if (remaining > 0) {
          const gaps = applyJustifyDeltaToRun(line.run, line.text, remaining, measurer.font)
          if (gaps > 0) line.justifySpacing = remaining / gaps
        } else {
          line.justifySpacing = runDelta
        }
        line.width = sumRunAdvances(line.run)
      } else {
        const gaps = countJustifyGaps(line.text)
        if (gaps > 0) line.justifySpacing = delta / gaps
      }
    }
  }

  for (let i = 0; i < resultLines.length; i++) {
    const line = resultLines[i]!
    if (line.run !== undefined) applyMergeGroupsToRun(line.run, measurer.font, line.direction ?? 'ltr')
    if (line.segments !== undefined) {
      for (let j = 0; j < line.segments.length; j++) {
        const run = line.segments[j]!.run
        if (run !== undefined) applyMergeGroupsToRun(run, measurer.font, line.direction ?? 'ltr')
      }
    }
  }

  for (let i = 0; i < resultLines.length; i++) {
    const line = resultLines[i]!
    if (line.run !== undefined) {
      line.caretPositions = buildCaretPositions(line.run, measurer, fontSize, false, horizontalScale, options.devicePpem)
    } else if (line.segments !== undefined) {
      const positions: number[] = []
      for (let s = 0; s < line.segments.length; s++) {
        const segment = line.segments[s]!
        if (segment.run === undefined) continue
        const segmentCarets = buildCaretPositions(segment.run, measurer, fontSize, false, horizontalScale, options.devicePpem)
        for (let c = 0; c < segmentCarets.length; c++) positions.push(segment.x + segmentCarets[c]!)
      }
      positions.sort(ascendingNumber)
      line.caretPositions = Float64Array.from(positions)
    }
  }

  return {
    lines: resultLines,
    totalHeight: options.stretchWithOverflow ? totalHeight : Math.min(totalHeight, containerHeight),
    truncated,
  }
}

/** Whether the BiDi level array contains any RTL level */
function hasRtlLevel(levels: Uint8Array): boolean {
  for (let i = 0; i < levels.length; i++) {
    if (levels[i]! & 1) return true
  }
  return false
}

function splitParagraphs(text: string): string[] {
  return text.split(/\r\n|\r|\n|\u0085|\u2028|\u2029/u)
}

function effectiveLetterSpacing(
  measurer: TextMeasurer,
  fontSize: number,
  letterSpacing: number | undefined,
  tracking: number | undefined,
  vertical: boolean,
): number {
  const explicitSpacing = letterSpacing ?? 0
  if (tracking === undefined) return explicitSpacing
  const direction = vertical ? 'vertical' : 'horizontal'
  return explicitSpacing + measurer.font.getTracking(tracking, fontSize, direction) * fontSize / measurer.font.metrics.unitsPerEm
}

/**
 * Reorder a logical-order glyph run into visual order using the BiDi result.
 *
 * Glyphs are emitted in the visual order of the code points they cover: each
 * glyph is emitted once, at the first visual occurrence of one of its source
 * code points (the components of a ligature share one BiDi level, so this is
 * well defined). All glyphs sharing one source cluster move together; RTL
 * clusters reverse their internal glyph order exactly as the shaping buffer.
 * Characters at RTL levels with a paired mirror swap to the mirror glyph,
 * matching the mirrored line text.
 */
function reorderRunToVisual(
  run: RenderGlyphRun,
  visualOrder: number[],
  levels: Uint8Array,
  chars: string[],
  font: TextMeasurer['font'],
  fontSize: number,
  horizontalScale: number,
): RenderGlyphRun {
  const srcGlyphIds = run.glyphIds
  const srcClusters = run.clusters
  const nGlyphs = srcGlyphIds.length
  const nChars = chars.length

  const srcSourceClusters = run.sourceClusters ?? new Uint32Array(nGlyphs)
  if (run.sourceClusters === undefined) {
    let source = 0
    for (let g = 0; g < nGlyphs; g++) {
      srcSourceClusters[g] = source
      source += srcClusters[g]!
    }
  }

  const groupStarts: number[] = []
  const groupEnds: number[] = []
  const groupSources: number[] = []
  for (let start = 0; start < nGlyphs;) {
    const source = srcSourceClusters[start]!
    let end = start + 1
    while (end < nGlyphs && srcSourceClusters[end] === source) end++
    groupStarts.push(start)
    groupEnds.push(end)
    groupSources.push(source)
    start = end
  }

  // Source code point index → shaping-cluster group.
  const cpToGroup = new Int32Array(nChars)
  cpToGroup.fill(-1)
  for (let group = 0; group < groupStarts.length; group++) {
    const start = groupSources[group]!
    const end = group + 1 < groupSources.length ? groupSources[group + 1]! : nChars
    for (let source = start; source < end && source < nChars; source++) cpToGroup[source] = group
  }

  const glyphIds = new Uint16Array(nGlyphs)
  const advances = new Float64Array(nGlyphs)
  const xOffsets = new Float64Array(nGlyphs)
  const yOffsets = new Float64Array(nGlyphs)
  const clusters = new Uint16Array(nGlyphs)
  const sourceClusters = new Uint32Array(nGlyphs)
  const rotations = run.rotations === undefined ? undefined : new Uint8Array(nGlyphs)
  const xScales = run.xScales === undefined ? undefined : new Float64Array(nGlyphs)
  const yScales = run.yScales === undefined ? undefined : new Float64Array(nGlyphs)
  const outlineOverrides = run.outlineOverrides === undefined
    ? undefined
    : new Array<{ commands: Uint8Array, coords: Float32Array } | null>(nGlyphs).fill(null)
  const mergeGroups = run.mergeGroups === undefined ? undefined : new Uint32Array(nGlyphs)
  const emitted = new Uint8Array(groupStarts.length)
  const scale = fontSize / font.metrics.unitsPerEm
  let out = 0

  for (let vi = 0; vi < nChars; vi++) {
    const li = visualOrder[vi]!
    const group = cpToGroup[li]!
    if (group < 0 || emitted[group] === 1) continue
    emitted[group] = 1
    const groupStart = groupStarts[group]!
    const groupEnd = groupEnds[group]!
    const rtl = (levels[li]! & 1) === 1
    const sourceEnd = group + 1 < groupSources.length ? groupSources[group + 1]! : nChars
    for (
      let g = rtl ? groupEnd - 1 : groupStart;
      rtl ? g >= groupStart : g < groupEnd;
      g += rtl ? -1 : 1
    ) {
      let gid = srcGlyphIds[g]!
      let advance = run.advances[g]!
      if (rtl && groupEnd - groupStart === 1 && sourceEnd - groupSources[group]! === 1) {
        const srcCp = chars[li]!.codePointAt(0)!
        const mirrorCp = getMirrorChar(srcCp)
        const propMirrorGid = font.prop == null
          ? null
          : font.getAatGlyphPropertyInfo(gid)?.complementaryGlyphId ?? null
        if (propMirrorGid !== null || mirrorCp !== srcCp) {
          const mirrorGid = propMirrorGid ?? font.getGlyphId(mirrorCp)
          advance += (font.getAdvanceWidth(mirrorGid) - font.getAdvanceWidth(gid)) * scale * horizontalScale
          gid = mirrorGid
        }
      }
      glyphIds[out] = gid
      advances[out] = advance
      xOffsets[out] = run.xOffsets[g]!
      yOffsets[out] = run.yOffsets[g]!
      clusters[out] = srcClusters[g]!
      sourceClusters[out] = srcSourceClusters[g]!
      if (rotations !== undefined) rotations[out] = run.rotations![g]!
      if (xScales !== undefined) xScales[out] = run.xScales![g]!
      if (yScales !== undefined) yScales[out] = run.yScales![g]!
      if (outlineOverrides !== undefined) outlineOverrides[out] = run.outlineOverrides![g] ?? null
      if (mergeGroups !== undefined) mergeGroups[out] = run.mergeGroups![g]!
      out++
    }
  }

  return { glyphIds, advances, xOffsets, yOffsets, clusters, sourceClusters, rotations, xScales, yScales, outlineOverrides, mergeGroups }
}

// ─── Glyph run slicing ───

/**
 * Build the glyph run for the code point range [cpStart, cpEnd) of a shaped paragraph.
 * When a boundary falls inside a ligature (only possible on a forced character-level
 * break), the range cannot be sliced from the paragraph shaping result, so that
 * single line is reshaped to match its text exactly.
 */
function sliceLineRun(
  ms: ShapedMeasurement,
  measurer: TextMeasurer,
  fontSize: number,
  chars: string[],
  cpStart: number,
  cpEnd: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
): RenderGlyphRun {
  const cpToGlyph = ms.cpToGlyph
  const total = cpToGlyph.length
  const gStart = cpToGlyph[cpStart]!
  const gEnd = cpEnd >= total ? ms.shaped.length : cpToGlyph[cpEnd]!
  const startClean = cpStart === 0 || cpToGlyph[cpStart - 1]! !== gStart
  const endClean = cpEnd >= total || cpToGlyph[cpEnd - 1]! !== gEnd
  if (startClean && endClean) {
    const scale = fontSize / measurer.font.metrics.unitsPerEm
    return buildGlyphRunFromShaped(ms.shaped, gStart, gEnd, scale, letterSpacing, wordSpacing, chars, cpStart, false, horizontalScale)
  }
  return shapeGlyphRun(
    measurer.font, chars.slice(cpStart, cpEnd).join(''), fontSize,
    letterSpacing, wordSpacing, false, horizontalScale, 'ltr', ms.shapeOptions,
  )
}

function applyHorizontalOpticalBoundsToRun(
  run: RenderGlyphRun,
  measurer: TextMeasurer,
  fontSize: number,
  horizontalScale: number,
): void {
  const opbd = measurer.font.opbd
  if (opbd == null || run.glyphIds.length === 0) return

  let first = -1
  for (let i = 0; i < run.glyphIds.length; i++) {
    if (run.clusters[i]! !== 0) {
      first = i
      break
    }
  }
  if (first < 0) return

  let last = first
  for (let i = run.glyphIds.length - 1; i >= first; i--) {
    if (run.clusters[i]! !== 0) {
      last = i
      break
    }
  }

  const scale = fontSize / measurer.font.metrics.unitsPerEm * horizontalScale
  const firstBounds = measurer.font.getOpticalBounds(run.glyphIds[first]!)
  if (firstBounds !== null && firstBounds.left !== 0) {
    run.xOffsets[first]! += firstBounds.left * scale
  }
  const lastBounds = measurer.font.getOpticalBounds(run.glyphIds[last]!)
  if (lastBounds !== null && lastBounds.right !== 0) {
    run.xOffsets[last]! += lastBounds.right * scale
  }
}

function applyVerticalOpticalBoundsToRun(
  run: RenderGlyphRun,
  measurer: TextMeasurer,
  fontSize: number,
): void {
  if (measurer.font.opbd == null || run.glyphIds.length === 0) return
  let first = -1
  for (let i = 0; i < run.glyphIds.length; i++) {
    if (run.clusters[i]! !== 0) {
      first = i
      break
    }
  }
  if (first < 0) return
  let last = first
  for (let i = run.glyphIds.length - 1; i >= first; i--) {
    if (run.clusters[i]! !== 0) {
      last = i
      break
    }
  }
  const scale = fontSize / measurer.font.metrics.unitsPerEm
  const firstBounds = measurer.font.getOpticalBounds(run.glyphIds[first]!)
  if (firstBounds !== null && firstBounds.top !== 0) run.yOffsets[first]! += firstBounds.top * scale
  const lastBounds = measurer.font.getOpticalBounds(run.glyphIds[last]!)
  if (lastBounds !== null && lastBounds.bottom !== 0) run.yOffsets[last]! += lastBounds.bottom * scale
}

/**
 * Distribute justify spacing into the glyph run advances.
 * Gap positions must mirror countJustifyGaps: after spaces and across
 * expandable UAX #14 boundaries; when no such gap exists, every inter-character
 * gap receives the spacing.
 */
function applyJustifyDeltaToRun(
  run: RenderGlyphRun,
  text: string,
  delta: number,
  font: TextMeasurer['font'],
): number {
  const chars = [...text]
  const len = chars.length
  if (len <= 1) return 0

  const graphemeBoundaries = buildGraphemeBoundaryFlags(chars)
  const flags = new Uint8Array(len - 1)
  let gaps = 0
  for (let i = 0; i < len - 1; i++) {
    if (graphemeBoundaries[i + 1] !== 1) continue
    if (chars[i] === ' ') {
      flags[i] = 1
      gaps++
    } else {
      if (isLineBreakJustificationGap(chars, i)) {
        flags[i] = 1
        gaps++
      }
    }
  }
  if (gaps === 0) {
    for (let i = 0; i < len - 1; i++) {
      if (graphemeBoundaries[i + 1] === 1) flags[i] = 1
    }
  }

  const clusters = run.clusters
  const eligibleGlyphs: number[] = []
  let cpIdx = 0
  for (let g = 0; g < clusters.length;) {
    if (clusters[g] === 0) {
      g++
      continue
    }
    const cpEnd = cpIdx + clusters[g]!
    let finalGlyph = g
    while (finalGlyph + 1 < clusters.length && clusters[finalGlyph + 1] === 0) finalGlyph++
    for (let j = cpIdx; j < cpEnd && j < len - 1; j++) {
      if (flags[j] !== 1 || j + 1 !== cpEnd) continue
      const properties = font.getAatGlyphProperties(run.glyphIds[finalGlyph]!) ?? 0
      if ((properties & PROP_ATTACHES_ON_RIGHT) === 0) eligibleGlyphs.push(finalGlyph)
    }
    cpIdx = cpEnd
    g = finalGlyph + 1
  }
  if (eligibleGlyphs.length === 0) return 0
  const spacing = delta / eligibleGlyphs.length
  for (let i = 0; i < eligibleGlyphs.length; i++) run.advances[eligibleGlyphs[i]!]! += spacing
  return eligibleGlyphs.length
}

function applyGraphiteJustificationToLine(
  line: LayoutLine,
  measurer: TextMeasurer,
  fontSize: number,
  targetWidth: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
): boolean {
  if (line.run === undefined || measurer.font.silf === null) return false
  const chars = [...line.text]
  let externalSpacing = letterSpacing * chars.length
  if (wordSpacing !== 0) {
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === ' ') externalSpacing += wordSpacing
    }
  }
  const scale = fontSize / measurer.font.metrics.unitsPerEm
  const designWidth = (targetWidth / horizontalScale - externalSpacing) / scale
  const shaped = measurer.font.shapeText(line.text, {
    graphiteJustification: { width: designWidth },
  })
  line.run = buildGlyphRunFromShaped(
    shaped, 0, shaped.length, scale, letterSpacing, wordSpacing, chars, 0, false, horizontalScale,
  )
  applyHorizontalOpticalBoundsToRun(line.run, measurer, fontSize, horizontalScale)
  let width = 0
  for (let i = 0; i < line.run.advances.length; i++) width += line.run.advances[i]!
  line.width = width
  return true
}

function applyFontJustificationToRun(
  run: RenderGlyphRun,
  font: TextMeasurer['font'],
  text: string,
  delta: number,
  fontSize: number,
  horizontalScale: number,
  direction: 'horizontal' | 'vertical' = 'horizontal',
  requestedScript?: string,
  language?: string,
  ppem?: number,
  selectedPriority?: JstfPriority,
): number {
  if (delta === 0 || run.glyphIds.length === 0) return delta
  const just = direction === 'horizontal' ? font.just?.horizontal : font.just?.vertical
  if (just !== null && just !== undefined) {
    return applyAatJustification(
      run, font, just, delta, fontSize, horizontalScale, direction === 'vertical',
    ).remainingDelta
  }
  let remaining = applyJstfMaximumToRun(
    run, font, text, delta, fontSize, horizontalScale, direction,
    requestedScript, language, ppem, selectedPriority,
  )
  if (remaining > 0 && applyJstfExtenderJustificationToRun(run, font, text, remaining, requestedScript)) return 0
  return remaining
}

function selectJstfLookupSuggestion(
  line: LayoutLine,
  measurer: TextMeasurer,
  fontSize: number,
  targetWidth: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
  requestedScript?: string,
  language?: string,
  ppem?: number,
  shapeOptions?: LayoutShapeOptions,
): JstfPriority | null {
  const font = measurer.font
  const jstf = font.jstf
  const script = requestedScript ?? inferJstfScriptTag(line.text)
  if (jstf === null || script === null) return null
  const mode = targetWidth >= line.width ? 'extend' : 'shrink'
  const priorities = jstf.getPriorities(script, language)
  let selectedRun: RenderGlyphRun | null = null
  let selectedPriority: JstfPriority | null = null
  let selectedDistance = Math.abs(targetWidth - line.width)
  for (let i = 0; i < priorities.length; i++) {
    const priority = priorities[i]!
    const candidate = shapeGlyphRun(
      font, line.text, fontSize, letterSpacing, wordSpacing, false,
      horizontalScale, 'ltr', {
        ...shapeOptions,
        script,
        language,
        jstf: { priority, mode },
        ppem,
      },
    )
    const width = sumRunAdvances(candidate)
    const remaining = targetWidth - width
    if ((mode === 'extend' && remaining < 0) || (mode === 'shrink' && remaining > 0)) continue
    const distance = Math.abs(remaining)
    if (distance < selectedDistance) {
      selectedRun = candidate
      selectedPriority = priority
      selectedDistance = distance
    }
    const capacity = getJstfMaximumInlineCapacity(
      candidate, font, priority, mode, fontSize, horizontalScale, false, ppem,
    )
    if (capacity !== 0 && Math.sign(capacity) === Math.sign(remaining) && Math.abs(capacity) >= distance) {
      selectedRun = candidate
      selectedPriority = priority
      break
    }
    if (mode === 'extend' && hasJstfExtender(candidate, jstf.getExtenderGlyphs(script))) {
      selectedRun = candidate
      selectedPriority = priority
      break
    }
  }
  if (selectedRun === null || selectedPriority === null) return null
  line.run = selectedRun
  line.width = sumRunAdvances(selectedRun)
  return selectedPriority
}

function hasJstfExtender(run: RenderGlyphRun, extenders: readonly number[]): boolean {
  for (let i = 0; i < run.glyphIds.length; i++) {
    if (containsGlyphId(extenders, run.glyphIds[i]!)) return true
  }
  return false
}

function getJstfMaximumInlineCapacity(
  run: RenderGlyphRun,
  font: TextMeasurer['font'],
  priority: JstfPriority,
  mode: 'shrink' | 'extend',
  fontSize: number,
  horizontalScale: number,
  vertical: boolean,
  ppem?: number,
): number {
  const maximum = mode === 'shrink' ? priority.shrinkageJstfMax : priority.extensionJstfMax
  if (maximum === null) return 0
  const advances = new Array<number>(run.glyphIds.length)
  for (let i = 0; i < advances.length; i++) {
    advances[i] = vertical ? font.getAdvanceHeight(run.glyphIds[i]!) : font.getAdvanceWidth(run.glyphIds[i]!)
  }
  const adjustments = maximum.getPositionAdjustments(
    Array.from(run.glyphIds), font.gdef, vertical ? 'ttb' : 'ltr', advances,
    font.getNormalizedVariationCoordinates(), ppem, font,
  )
  const scale = fontSize / font.metrics.unitsPerEm
  let capacity = 0
  for (let i = 0; i < adjustments.length; i++) {
    capacity += vertical
      ? adjustments[i]!.yAdvance * scale
      : adjustments[i]!.xAdvance * scale * horizontalScale
  }
  return capacity
}

function applyJstfMaximumToRun(
  run: RenderGlyphRun,
  font: TextMeasurer['font'],
  text: string,
  delta: number,
  fontSize: number,
  horizontalScale: number,
  direction: 'horizontal' | 'vertical',
  requestedScript?: string,
  language?: string,
  ppem?: number,
  selectedPriority?: JstfPriority,
): number {
  const jstf = font.jstf
  const script = requestedScript ?? inferJstfScriptTag(text)
  if (jstf === null || script === null) return delta
  const priorities = selectedPriority === undefined ? jstf.getPriorities(script, language) : [selectedPriority]
  const scale = fontSize / font.metrics.unitsPerEm
  const advances = new Array<number>(run.glyphIds.length)
  for (let i = 0; i < advances.length; i++) {
    advances[i] = direction === 'horizontal'
      ? font.getAdvanceWidth(run.glyphIds[i]!)
      : font.getAdvanceHeight(run.glyphIds[i]!)
  }
  let selected: ReturnType<NonNullable<typeof priorities[number]['extensionJstfMax']>['getPositionAdjustments']> | null = null
  let selectedInline = 0
  for (let i = 0; i < priorities.length; i++) {
    const maximum = delta < 0 ? priorities[i]!.shrinkageJstfMax : priorities[i]!.extensionJstfMax
    if (maximum === null) continue
    const adjustments = maximum.getPositionAdjustments(
      Array.from(run.glyphIds), font.gdef, direction === 'vertical' ? 'ttb' : 'ltr',
      advances, font.getNormalizedVariationCoordinates(), ppem, font,
    )
    let inline = 0
    for (let glyph = 0; glyph < adjustments.length; glyph++) {
      inline += direction === 'horizontal'
        ? adjustments[glyph]!.xAdvance * scale * horizontalScale
        : adjustments[glyph]!.yAdvance * scale
    }
    if (inline === 0 || Math.sign(inline) !== Math.sign(delta)) continue
    selected = adjustments
    selectedInline = inline
    if (Math.abs(inline) >= Math.abs(delta)) break
  }
  if (selected === null) return delta
  const factor = Math.min(1, Math.abs(delta / selectedInline))
  for (let i = 0; i < selected.length; i++) {
    const adjustment = selected[i]!
    run.xOffsets[i]! += adjustment.xPlacement * scale * (direction === 'horizontal' ? horizontalScale : 1) * factor
    run.yOffsets[i]! += adjustment.yPlacement * scale * factor
    run.advances[i]! += (direction === 'horizontal'
      ? adjustment.xAdvance * scale * horizontalScale
      : adjustment.yAdvance * scale) * factor
  }
  return delta - selectedInline * factor
}

function sumRunAdvances(run: RenderGlyphRun): number {
  let width = 0
  for (let i = 0; i < run.advances.length; i++) width += run.advances[i]!
  return width
}

function buildCaretPositions(
  run: RenderGlyphRun,
  measurer: TextMeasurer,
  fontSize: number,
  vertical: boolean,
  horizontalScale: number,
  devicePpem?: number,
): Float64Array {
  const positions: number[] = [0]
  const scale = fontSize / measurer.font.metrics.unitsPerEm * (vertical ? 1 : horizontalScale)
  const hasCaretTable = measurer.font.gdef != null || measurer.font.lcar != null
  let pen = 0
  for (let i = 0; i < run.glyphIds.length; i++) {
    const carets = hasCaretTable
      ? measurer.font.getLigatureCaretPositions(run.glyphIds[i]!, vertical ? 'vertical' : 'horizontal', devicePpem)
      : null
    if (carets !== null) {
      const placement = vertical ? -run.yOffsets[i]! : run.xOffsets[i]!
      for (let c = 0; c < carets.length; c++) positions.push(pen + placement + carets[c]! * scale)
    }
    pen += run.advances[i]!
    if (i === run.glyphIds.length - 1 || run.clusters[i + 1] !== 0) positions.push(pen)
  }
  positions.sort(ascendingNumber)
  let unique = 1
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] !== positions[unique - 1]) positions[unique++] = positions[i]!
  }
  positions.length = unique
  return Float64Array.from(positions)
}

function ascendingNumber(a: number, b: number): number {
  return a - b
}

function applyJstfExtenderJustificationToRun(
  run: RenderGlyphRun,
  font: TextMeasurer['font'],
  text: string,
  delta: number,
  requestedScript?: string,
): boolean {
  const jstf = font.jstf
  if (jstf === null) return false
  const script = requestedScript ?? inferJstfScriptTag(text)
  if (script === null) return false
  const extenders = jstf.getExtenderGlyphs(script)
  if (extenders.length === 0) return false

  let extenderCount = 0
  for (let i = 0; i < run.glyphIds.length; i++) {
    if (containsGlyphId(extenders, run.glyphIds[i]!)) extenderCount++
  }
  if (extenderCount === 0) return false

  const perGlyph = delta / extenderCount
  for (let i = 0; i < run.advances.length; i++) {
    if (containsGlyphId(extenders, run.glyphIds[i]!)) run.advances[i]! += perGlyph
  }
  return true
}

function containsGlyphId(sortedGlyphIds: readonly number[], glyphId: number): boolean {
  let lo = 0
  let hi = sortedGlyphIds.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const value = sortedGlyphIds[mid]!
    if (glyphId < value) {
      hi = mid - 1
    } else if (glyphId > value) {
      lo = mid + 1
    } else {
      return true
    }
  }
  return false
}

function inferJstfScriptTag(text: string): string | null {
  for (const char of text) {
    const cp = char.codePointAt(0)!
    if ((cp >= 0x0041 && cp <= 0x005A) || (cp >= 0x0061 && cp <= 0x007A) ||
        (cp >= 0x00C0 && cp <= 0x024F) || (cp >= 0x1E00 && cp <= 0x1EFF)) return 'latn'
    if (cp >= 0x0370 && cp <= 0x03FF) return 'grek'
    if (cp >= 0x0400 && cp <= 0x052F) return 'cyrl'
    if (cp >= 0x0590 && cp <= 0x05FF) return 'hebr'
    if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F) ||
        (cp >= 0x0870 && cp <= 0x08FF)) return 'arab'
    if (cp >= 0x0900 && cp <= 0x097F) return 'deva'
    if (cp >= 0x0980 && cp <= 0x09FF) return 'beng'
    if (cp >= 0x0A00 && cp <= 0x0A7F) return 'guru'
    if (cp >= 0x0A80 && cp <= 0x0AFF) return 'gujr'
    if (cp >= 0x0B00 && cp <= 0x0B7F) return 'orya'
    if (cp >= 0x0B80 && cp <= 0x0BFF) return 'taml'
    if (cp >= 0x0C00 && cp <= 0x0C7F) return 'telu'
    if (cp >= 0x0C80 && cp <= 0x0CFF) return 'knda'
    if (cp >= 0x0D00 && cp <= 0x0D7F) return 'mlym'
    if (cp >= 0x0D80 && cp <= 0x0DFF) return 'sinh'
    if (cp >= 0x0E00 && cp <= 0x0E7F) return 'thai'
    if (cp >= 0x0E80 && cp <= 0x0EFF) return 'lao '
    if (cp >= 0x0F00 && cp <= 0x0FFF) return 'tibt'
    if ((cp >= 0x1000 && cp <= 0x109F) || (cp >= 0xA9E0 && cp <= 0xA9FF) ||
        (cp >= 0xAA60 && cp <= 0xAA7F)) return 'mymr'
    if (cp >= 0x1780 && cp <= 0x17FF) return 'khmr'
    if ((cp >= 0x3040 && cp <= 0x30FF) || (cp >= 0x31F0 && cp <= 0x31FF) ||
        (cp >= 0xFF66 && cp <= 0xFF9F)) return 'kana'
    if ((cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0x4E00 && cp <= 0x9FFF) ||
        (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2EBEF) ||
        (cp >= 0x30000 && cp <= 0x3134F)) return 'hani'
    if ((cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF) ||
        (cp >= 0x3130 && cp <= 0x318F) || (cp >= 0xA960 && cp <= 0xA97F) ||
        (cp >= 0xD7B0 && cp <= 0xD7FF)) return 'hang'
  }
  return null
}

// ─── Line breaking ───

/**
 * Scans text character by character and breaks it into lines.
 */
/** Default tab interval (per common report behavior: 40pt) */
const DEFAULT_TAB_INTERVAL = 40

function breakLines(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  maxWidth: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
  tabStops?: { position: number; alignment?: 'left' | 'center' | 'right' }[],
  tabStopWidth?: number,
  devicePpem?: number,
  shapeOptions?: LayoutShapeOptions,
): LayoutLine[] {
  if (text === '') return [{ text: '', width: 0, y: 0 }]

  const chars = [...text]
  const graphemeBoundaries = buildGraphemeBoundaryFlags(chars)
  const ms = measurer.measureShaped(text, fontSize, false, letterSpacing, devicePpem, shapeOptions)
  const advances = ms.advances

  const lines: LayoutLine[] = []
  let lineStart = 0
  let lineWidth = 0
  let lastBreakPos = -1
  let widthAtLastBreak = 0

  for (let i = 0; i < chars.length; i++) {
    let charWidth: number
    if (chars[i] === '\t') {
      charWidth = resolveTabWidth(lineWidth, tabStops, tabStopWidth)
    } else {
      charWidth = scaledAdvance(advances[i]!, letterSpacing, chars[i] === ' ' ? wordSpacing : 0, horizontalScale)
    }

    if (lineWidth + charWidth > maxWidth && i > lineStart && (lastBreakPos > lineStart || graphemeBoundaries[i] === 1)) {
      // Exceeded the line width
      if (lastBreakPos > lineStart) {
        // Break at the last break opportunity
        const lineText = chars.slice(lineStart, lastBreakPos).join('')
        const line: LayoutLine = { text: lineText, width: widthAtLastBreak, y: 0 }
        const segs = buildTabSegments(chars, advances, lineStart, lastBreakPos, letterSpacing, wordSpacing, horizontalScale, tabStops, tabStopWidth, ms, measurer, fontSize)
        if (segs) line.segments = segs
        else {
          line.run = sliceLineRun(ms, measurer, fontSize, chars, lineStart, lastBreakPos, letterSpacing, wordSpacing, horizontalScale)
          applyHorizontalOpticalBoundsToRun(line.run, measurer, fontSize, horizontalScale)
        }
        lines.push(line)
        lineStart = lastBreakPos
        // Skip leading spaces
        while (lineStart < chars.length && chars[lineStart] === ' ') {
          lineStart++
        }
        // Recompute the width of the new line
        lineWidth = 0
        for (let j = lineStart; j <= i; j++) {
          if (j < chars.length) {
            lineWidth += scaledAdvance(advances[j]!, letterSpacing, chars[j] === ' ' ? wordSpacing : 0, horizontalScale)
          }
        }
        lastBreakPos = -1
        widthAtLastBreak = 0
      } else {
        // No break opportunity → force a break at character level
        const lineText = chars.slice(lineStart, i).join('')
        const fline: LayoutLine = { text: lineText, width: lineWidth, y: 0 }
        const fsegs = buildTabSegments(chars, advances, lineStart, i, letterSpacing, wordSpacing, horizontalScale, tabStops, tabStopWidth, ms, measurer, fontSize)
        if (fsegs) fline.segments = fsegs
        else {
          fline.run = sliceLineRun(ms, measurer, fontSize, chars, lineStart, i, letterSpacing, wordSpacing, horizontalScale)
          applyHorizontalOpticalBoundsToRun(fline.run, measurer, fontSize, horizontalScale)
        }
        lines.push(fline)
        lineStart = i
        lineWidth = charWidth
        lastBreakPos = -1
        widthAtLastBreak = 0
      }
    } else {
      lineWidth += charWidth
    }

    // Check for a break opportunity
    if (graphemeBoundaries[i + 1] === 1 && canBreakAt(chars, i + 1)) {
      lastBreakPos = i + 1
      widthAtLastBreak = lineWidth
    }
  }

  // Last line
  if (lineStart < chars.length) {
    const lineText = chars.slice(lineStart).join('')
    const lastLine: LayoutLine = { text: lineText, width: lineWidth, y: 0 }
    const lsegs = buildTabSegments(chars, advances, lineStart, chars.length, letterSpacing, wordSpacing, horizontalScale, tabStops, tabStopWidth, ms, measurer, fontSize)
    if (lsegs) lastLine.segments = lsegs
    else {
      lastLine.run = sliceLineRun(ms, measurer, fontSize, chars, lineStart, chars.length, letterSpacing, wordSpacing, horizontalScale)
      applyHorizontalOpticalBoundsToRun(lastLine.run, measurer, fontSize, horizontalScale)
    }
    lines.push(lastLine)
  }

  return lines
}

/**
 * Line breaking where the first line has a different width from subsequent lines
 * Used for firstLineIndent support
 */
function breakLinesWithVaryingWidth(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  firstLineWidth: number,
  normalWidth: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
  isFirstParagraphLine: boolean,
  tabStops?: { position: number; alignment?: 'left' | 'center' | 'right' }[],
  tabStopWidth?: number,
  devicePpem?: number,
  shapeOptions?: LayoutShapeOptions,
): LayoutLine[] {
  if (text === '') return [{ text: '', width: 0, y: 0 }]

  const chars = [...text]
  const graphemeBoundaries = buildGraphemeBoundaryFlags(chars)
  const ms = measurer.measureShaped(text, fontSize, false, letterSpacing, devicePpem, shapeOptions)
  const advances = ms.advances

  const lines: LayoutLine[] = []
  let lineStart = 0
  let lineWidth = 0
  let lastBreakPos = -1
  let widthAtLastBreak = 0
  let isFirstLine = true

  for (let i = 0; i < chars.length; i++) {
    let charWidth: number
    if (chars[i] === '\t') {
      charWidth = resolveTabWidth(lineWidth, tabStops, tabStopWidth)
    } else {
      charWidth = scaledAdvance(advances[i]!, letterSpacing, chars[i] === ' ' ? wordSpacing : 0, horizontalScale)
    }
    const currentMaxWidth = (isFirstLine && isFirstParagraphLine) ? firstLineWidth : normalWidth

    if (lineWidth + charWidth > currentMaxWidth && i > lineStart && (lastBreakPos > lineStart || graphemeBoundaries[i] === 1)) {
      if (lastBreakPos > lineStart) {
        const lineText = chars.slice(lineStart, lastBreakPos).join('')
        const vline: LayoutLine = { text: lineText, width: widthAtLastBreak, y: 0 }
        const vsegs = buildTabSegments(chars, advances, lineStart, lastBreakPos, letterSpacing, wordSpacing, horizontalScale, tabStops, tabStopWidth, ms, measurer, fontSize)
        if (vsegs) vline.segments = vsegs
        else {
          vline.run = sliceLineRun(ms, measurer, fontSize, chars, lineStart, lastBreakPos, letterSpacing, wordSpacing, horizontalScale)
          applyHorizontalOpticalBoundsToRun(vline.run, measurer, fontSize, horizontalScale)
        }
        lines.push(vline)
        lineStart = lastBreakPos
        while (lineStart < chars.length && chars[lineStart] === ' ') {
          lineStart++
        }
        lineWidth = 0
        for (let j = lineStart; j <= i; j++) {
          if (j < chars.length) {
            lineWidth += scaledAdvance(advances[j]!, letterSpacing, chars[j] === ' ' ? wordSpacing : 0, horizontalScale)
          }
        }
        lastBreakPos = -1
        widthAtLastBreak = 0
      } else {
        const lineText = chars.slice(lineStart, i).join('')
        const vfline: LayoutLine = { text: lineText, width: lineWidth, y: 0 }
        const vfsegs = buildTabSegments(chars, advances, lineStart, i, letterSpacing, wordSpacing, horizontalScale, tabStops, tabStopWidth, ms, measurer, fontSize)
        if (vfsegs) vfline.segments = vfsegs
        else {
          vfline.run = sliceLineRun(ms, measurer, fontSize, chars, lineStart, i, letterSpacing, wordSpacing, horizontalScale)
          applyHorizontalOpticalBoundsToRun(vfline.run, measurer, fontSize, horizontalScale)
        }
        lines.push(vfline)
        lineStart = i
        lineWidth = charWidth
        lastBreakPos = -1
        widthAtLastBreak = 0
      }
      isFirstLine = false
    } else {
      lineWidth += charWidth
    }

    if (graphemeBoundaries[i + 1] === 1 && canBreakAt(chars, i + 1)) {
      lastBreakPos = i + 1
      widthAtLastBreak = lineWidth
    }
  }

  if (lineStart < chars.length) {
    const lineText = chars.slice(lineStart).join('')
    const vlastLine: LayoutLine = { text: lineText, width: lineWidth, y: 0 }
    const vlsegs = buildTabSegments(chars, advances, lineStart, chars.length, letterSpacing, wordSpacing, horizontalScale, tabStops, tabStopWidth, ms, measurer, fontSize)
    if (vlsegs) vlastLine.segments = vlsegs
    else {
      vlastLine.run = sliceLineRun(ms, measurer, fontSize, chars, lineStart, chars.length, letterSpacing, wordSpacing, horizontalScale)
      applyHorizontalOpticalBoundsToRun(vlastLine.run, measurer, fontSize, horizontalScale)
    }
    lines.push(vlastLine)
  }

  return lines
}

// ─── Helpers ───

/**
 * Computes the width from the current line width to the tab stop position.
 * When tabStops is defined: find the smallest position greater than lineWidth.
 * When tabStops is undefined: use tabStopWidth or DEFAULT_TAB_INTERVAL (40pt) intervals.
 */
function resolveTabWidth(
  lineWidth: number,
  tabStops?: { position: number; alignment?: 'left' | 'center' | 'right' }[],
  tabStopWidth?: number,
): number {
  if (tabStops && tabStops.length > 0) {
    for (let i = 0; i < tabStops.length; i++) {
      if (tabStops[i]!.position > lineWidth) {
        return tabStops[i]!.position - lineWidth
      }
    }
    // Past all tab stops → use the default interval
  }
  const interval = tabStopWidth ?? DEFAULT_TAB_INTERVAL
  const nextTab = Math.ceil((lineWidth + 1) / interval) * interval
  return nextTab - lineWidth
}

/**
 * Builds segment information for a line containing tabs.
 * Returns undefined if the line has no tabs.
 */
function buildTabSegments(
  chars: string[],
  advances: Float64Array,
  start: number,
  end: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
  tabStops: { position: number; alignment?: 'left' | 'center' | 'right' }[] | undefined,
  tabStopWidth: number | undefined,
  ms: ShapedMeasurement,
  measurer: TextMeasurer,
  fontSize: number,
): { text: string; x: number; run?: RenderGlyphRun }[] | undefined {
  let hasTab = false
  for (let j = start; j < end; j++) {
    if (chars[j] === '\t') { hasTab = true; break }
  }
  if (!hasTab) return undefined

  const segs: { text: string; x: number; run?: RenderGlyphRun }[] = []
  let w = 0
  let segStart = start
  let segX = 0
  for (let j = start; j < end; j++) {
    if (chars[j] === '\t') {
      const seg: { text: string; x: number; run?: RenderGlyphRun } = { text: chars.slice(segStart, j).join(''), x: segX }
      if (j > segStart) seg.run = sliceLineRun(ms, measurer, fontSize, chars, segStart, j, letterSpacing, wordSpacing, horizontalScale)
      segs.push(seg)
      w += resolveTabWidth(w, tabStops, tabStopWidth)
      segX = w
      segStart = j + 1
    } else {
      w += scaledAdvance(advances[j]!, letterSpacing, chars[j] === ' ' ? wordSpacing : 0, horizontalScale)
    }
  }
  const lastSeg: { text: string; x: number; run?: RenderGlyphRun } = { text: chars.slice(segStart, end).join(''), x: segX }
  if (end > segStart) lastSeg.run = sliceLineRun(ms, measurer, fontSize, chars, segStart, end, letterSpacing, wordSpacing, horizontalScale)
  segs.push(lastSeg)
  return segs
}

/**
 * Measures text width (including letterSpacing/wordSpacing)
 */
function measureText(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
  shapeOptions?: LayoutShapeOptions,
): number {
  if (text === '') return 0
  const m = measurer.measure(text, fontSize, shapeOptions)
  const chars = [...text]
  let extra = Math.max(0, chars.length - 1) * letterSpacing
  for (const ch of chars) {
    if (ch === ' ') extra += wordSpacing
  }
  return (m.width + extra) * horizontalScale
}

function scaledAdvance(baseAdvance: number, letterSpacing: number, wordSpacing: number, horizontalScale: number): number {
  return (baseAdvance + letterSpacing + wordSpacing) * horizontalScale
}

/**
 * Computes the line height
 */
function computeLineHeight(
  measurer: TextMeasurer,
  fontSize: number,
  lineSpacing?: LineSpacingDef,
): number {
  const defaultHeight = measurer.getLineHeight(fontSize)

  if (!lineSpacing) return defaultHeight

  switch (lineSpacing.type) {
    case 'single':
      return defaultHeight
    case '1.5':
      return defaultHeight * 1.5
    case 'double':
      return defaultHeight * 2
    case 'proportional':
      return defaultHeight * (lineSpacing.value ?? 1)
    case 'fixed':
      return lineSpacing.value ?? defaultHeight
    case 'minimum':
      return Math.max(lineSpacing.value ?? 0, defaultHeight)
    default:
      return defaultHeight
  }
}

/**
 * Truncates text with an ellipsis
 */
function truncateWithEllipsis(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  maxWidth: number,
  letterSpacing: number,
  wordSpacing: number,
  horizontalScale: number,
  ellipsis: string,
  wordBoundary: boolean,
  shapeOptions?: LayoutShapeOptions,
): LayoutLine {
  const ellipsisWidth = measureText(ellipsis, measurer, fontSize, letterSpacing, wordSpacing, horizontalScale, shapeOptions)
  const availableWidth = maxWidth - ellipsisWidth

  if (availableWidth <= 0) {
    return {
      text: ellipsis, width: ellipsisWidth, y: 0,
      run: shapeGlyphRun(measurer.font, ellipsis, fontSize, letterSpacing, wordSpacing, false, horizontalScale, 'ltr', shapeOptions),
    }
  }

  const chars = [...text]
  const graphemeBoundaries = buildGraphemeBoundaryFlags(chars)
  const measurement = measurer.measure(text, fontSize, shapeOptions)
  let width = 0
  let lastWordEnd = 0
  let lastWordWidth = 0
  let lastGraphemeBoundary = 0

  for (let i = 0; i < chars.length; i++) {
    if (graphemeBoundaries[i] === 1) lastGraphemeBoundary = i
    const charWidth = scaledAdvance(measurement.advances[i]!, letterSpacing, chars[i] === ' ' ? wordSpacing : 0, horizontalScale)
    if (width + charWidth > availableWidth) {
      if (wordBoundary && lastWordEnd > 0) {
        const truncatedText = chars.slice(0, lastWordEnd).join('').trimEnd() + ellipsis
        const truncatedWidth = measureText(truncatedText, measurer, fontSize, letterSpacing, wordSpacing, horizontalScale, shapeOptions)
        return {
          text: truncatedText, width: truncatedWidth, y: 0,
          run: shapeGlyphRun(measurer.font, truncatedText, fontSize, letterSpacing, wordSpacing, false, horizontalScale, 'ltr', shapeOptions),
        }
      }
      const cutIndex = graphemeBoundaries[i] === 1 ? i : lastGraphemeBoundary
      const truncatedText = chars.slice(0, cutIndex).join('') + ellipsis
      const truncatedWidth = measureText(truncatedText, measurer, fontSize, letterSpacing, wordSpacing, horizontalScale, shapeOptions)
      return {
        text: truncatedText, width: truncatedWidth, y: 0,
        run: shapeGlyphRun(measurer.font, truncatedText, fontSize, letterSpacing, wordSpacing, false, horizontalScale, 'ltr', shapeOptions),
      }
    }
    width += charWidth
    if (chars[i] === ' ') {
      lastWordEnd = i
      lastWordWidth = width
    }
  }

  // The whole text fits
  return {
    text, width: measureText(text, measurer, fontSize, letterSpacing, wordSpacing, horizontalScale, shapeOptions), y: 0,
    run: shapeGlyphRun(measurer.font, text, fontSize, letterSpacing, wordSpacing, false, horizontalScale, 'ltr', shapeOptions),
  }
}

/**
 * Counts the number of gaps for justification
 * - English: number of spaces
 * - CJK: number of inter-character gaps
 * - Mixed: both
 */
function countJustifyGaps(text: string): number {
  const chars = [...text]
  if (chars.length <= 1) return 0

  const graphemeBoundaries = buildGraphemeBoundaryFlags(chars)
  let gaps = 0
  for (let i = 0; i < chars.length - 1; i++) {
    if (graphemeBoundaries[i + 1] !== 1) continue
    if (chars[i] === ' ') {
      gaps++
    } else {
      if (isLineBreakJustificationGap(chars, i)) {
        gaps++
      }
    }
  }

  // If there are no gaps (all contiguous ASCII), distribute evenly between characters
  if (gaps === 0) {
    for (let i = 0; i < chars.length - 1; i++) {
      if (graphemeBoundaries[i + 1] === 1) gaps++
    }
  }

  return gaps
}

// ─── Vertical writing layout ───

interface VerticalColumn {
  text: string
  height: number // total vertical advance
  run: RenderGlyphRun // vertically shaped glyphs (vert/vrt2 applied)
  justify: boolean
}

/**
 * Vertical text layout
 *
 * Places characters top to bottom, wrapping to the next column when maxHeight is exceeded.
 * vertical-rl: columns flow right to left
 * vertical-lr: columns flow left to right
 */
function layoutTextVertical(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  options: TextLayoutOptions,
): TextLayoutResult {
  const maxHeight = options.maxHeight ?? options.elementHeight ?? Infinity
  const maxWidth = options.maxWidth ?? Infinity
  const lineHeight = computeLineHeight(measurer, fontSize, options.lineSpacing)
  const isRL = options.writingMode === 'vertical-rl'

  // Split on explicit mandatory line separators first
  const paragraphs = splitParagraphs(text)

  // Break text into vertical columns
  const letterSpacing = effectiveLetterSpacing(measurer, fontSize, options.letterSpacing, options.tracking, true)
  const columns = breakColumnsVertical(
    paragraphs, measurer, fontSize, maxHeight, letterSpacing,
    options.devicePpem, buildLayoutShapeOptions(options),
  )

  if (columns.length === 0) {
    return { lines: [], totalHeight: 0, truncated: false }
  }

  // Assign X positions to columns
  // Column width = lineHeight (each column is one "line" wide)
  const colWidth = lineHeight

  // The renderer draws each glyph centered within a 1em cell starting at line.x.
  // Center that em cell within the column pitch so that leading
  // (lineHeight − 1em) is distributed evenly on both sides of the column
  const cellOffset = (colWidth - fontSize) / 2

  const resultLines: LayoutLine[] = []
  let truncated = false

  for (let ci = 0; ci < columns.length; ci++) {
    // Check if this column fits within maxWidth
    if ((ci + 1) * colWidth > maxWidth) {
      truncated = true
      break
    }

    const columnX = cellOffset + (isRL
      ? maxWidth - (ci + 1) * colWidth  // right-to-left: first column at right edge
      : ci * colWidth)                    // left-to-right: first column at left edge

    const col = columns[ci]!
    applyVerticalOpticalBoundsToRun(col.run, measurer, fontSize)
    let justifySpacing: number | undefined
    if (options.hAlign === 'justify' && col.justify && Number.isFinite(maxHeight) && col.height < maxHeight) {
      const delta = maxHeight - sumRunAdvances(col.run)
      const remaining = applyFontJustificationToRun(
        col.run, measurer.font, col.text, delta, fontSize, 1, 'vertical',
        options.openTypeScript, options.openTypeLanguage, options.devicePpem,
      )
      if (remaining > 0) {
        const gaps = applyJustifyDeltaToRun(col.run, col.text, remaining, measurer.font)
        if (gaps > 0) justifySpacing = remaining / gaps
      } else {
        justifySpacing = delta
      }
      col.height = sumRunAdvances(col.run)
    }
    resultLines.push({
      text: col.text,
      width: col.height, // "width" in vertical mode is the column's vertical extent
      y: 0,              // Y is always 0 (top of column)
      x: columnX,
      run: col.run,
      justifySpacing,
      caretPositions: buildCaretPositions(col.run, measurer, fontSize, true, 1, options.devicePpem),
    })
  }

  // totalHeight for vertical layout is the max column height
  let maxColHeight = 0
  for (let i = 0; i < resultLines.length; i++) {
    if (resultLines[i]!.width > maxColHeight) maxColHeight = resultLines[i]!.width
  }

  return {
    lines: resultLines,
    totalHeight: maxColHeight,
    truncated,
  }
}

/**
 * Breaks text into vertical columns
 * Starts a new column when maxHeight is exceeded
 * Each paragraph is shaped once with vertical features (vert/vrt2);
 * columns reuse slices of that single shaping result
 */
function breakColumnsVertical(
  paragraphs: string[],
  measurer: TextMeasurer,
  fontSize: number,
  maxHeight: number,
  letterSpacing: number,
  devicePpem?: number,
  shapeOptions?: LayoutShapeOptions,
): VerticalColumn[] {
  const columns: VerticalColumn[] = []

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!
    if (para === '') continue

    const ms = measurer.measureShaped(para, fontSize, true, letterSpacing, devicePpem, shapeOptions)
    const chars = [...para]
    const graphemeBoundaries = buildGraphemeBoundaryFlags(chars)
    let colStart = 0
    let currentHeight = 0
    let lastBreakPos = -1
    let heightAtLastBreak = 0

    for (let ci = 0; ci < chars.length; ci++) {
      // For vertical text, use the shaped vertical advance
      const advance = ms.advances[ci]! + letterSpacing

      // Start a new column when adding this character exceeds maxHeight
      if (currentHeight + advance > maxHeight && ci > colStart && (lastBreakPos > colStart || graphemeBoundaries[ci] === 1)) {
        if (lastBreakPos > colStart) {
          columns.push({
            text: chars.slice(colStart, lastBreakPos).join(''),
            height: heightAtLastBreak,
            run: sliceVerticalRun(ms, measurer, fontSize, chars, colStart, lastBreakPos, letterSpacing),
            justify: true,
          })
          colStart = lastBreakPos
          while (colStart < chars.length && chars[colStart] === ' ') colStart++
          currentHeight = 0
          for (let j = colStart; j < ci; j++) {
            if (j < chars.length) currentHeight += ms.advances[j]! + letterSpacing
          }
          lastBreakPos = -1
          heightAtLastBreak = 0
        } else {
          columns.push({
            text: chars.slice(colStart, ci).join(''),
            height: currentHeight,
            run: sliceVerticalRun(ms, measurer, fontSize, chars, colStart, ci, letterSpacing),
            justify: true,
          })
          colStart = ci
          currentHeight = 0
          lastBreakPos = -1
          heightAtLastBreak = 0
        }
      }

      currentHeight += advance
      if (graphemeBoundaries[ci + 1] === 1 && canBreakAt(chars, ci + 1)) {
        lastBreakPos = ci + 1
        heightAtLastBreak = currentHeight
      }
    }

    // Last column of the paragraph
    if (colStart < chars.length) {
      columns.push({
        text: chars.slice(colStart).join(''),
        height: currentHeight,
        run: sliceVerticalRun(ms, measurer, fontSize, chars, colStart, chars.length, letterSpacing),
        justify: false,
      })
    }
  }

  return columns
}

/**
 * Build the vertical glyph run for the code point range [cpStart, cpEnd)
 * of a vertically shaped paragraph
 */
function sliceVerticalRun(
  ms: ShapedMeasurement,
  measurer: TextMeasurer,
  fontSize: number,
  chars: string[],
  cpStart: number,
  cpEnd: number,
  letterSpacing: number,
): RenderGlyphRun {
  const cpToGlyph = ms.cpToGlyph
  const total = cpToGlyph.length
  const gStart = cpToGlyph[cpStart]!
  const gEnd = cpEnd >= total ? ms.shaped.length : cpToGlyph[cpEnd]!
  const startClean = cpStart === 0 || cpToGlyph[cpStart - 1]! !== gStart
  const endClean = cpEnd >= total || cpToGlyph[cpEnd - 1]! !== gEnd
  if (startClean && endClean) {
    const scale = fontSize / measurer.font.metrics.unitsPerEm
    return buildGlyphRunFromShaped(ms.shaped, gStart, gEnd, scale, letterSpacing, 0, null, cpStart, true)
  }
  return shapeGlyphRun(
    measurer.font, chars.slice(cpStart, cpEnd).join(''), fontSize,
    letterSpacing, 0, true, 1, 'ltr', ms.shapeOptions,
  )
}
