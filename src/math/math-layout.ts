/**
 * Math layout engine
 *
 * MathNode AST → RenderNode[] (RenderText + RenderLine + RenderPath + RenderGroup)
 *
 * TeX-style box model: each element has (width, height, depth)
 * - height = from baseline to top edge
 * - depth = from baseline to bottom edge
 * - width = horizontal width
 *
 * Uses MATH table constants for TeX-compliant placement calculations.
 *
 * Performance-focused: no closures, all pure functions with state passed via arguments.
 */

import type { MathNode, MathStyle } from './math-ast.js'
import type { RenderNode, RenderGroup, RenderText, RenderLine, RenderRect } from '../types/render.js'
import type { MathTable, GlyphAssembly, GlyphPartRecord, MathKernInfo, MathKernRecord, MathValueContext } from '../parsers/tables/math.js'
import type { Font } from '../font.js'

// ─── Type definitions ───

/** Laid-out box */
export interface MathBox {
  /** Width (pt) */
  width: number
  /** Baseline to top edge (pt) */
  height: number
  /** Baseline to bottom edge (pt, positive value) */
  depth: number
  /** Render nodes */
  nodes: RenderNode[]
  /** Edge glyphs used by ExtendedShapeCoverage script positioning. */
  leftGlyphId?: number
  rightGlyphId?: number
}

/** Layout context (passed via arguments) */
export interface MathLayoutContext {
  /** Math font */
  font: Font
  /** MATH table */
  math: MathTable
  /** Font ID (for RenderText) */
  fontId: string
  /** Base font size (pt) */
  baseFontSize: number
  /** Text color */
  color: string
  /** Device pixels per em for MATH Device tables. */
  devicePpem?: number
  /** Resolved font-instance inputs shared by all MATH value lookups. */
  mathValueContext?: MathValueContext
}

// ─── Constants ───

/** Font size scale factor per style */
function getStyleScale(style: MathStyle, ctx: MathLayoutContext): number {
  const math = ctx.math
  switch (style & 3) {
    case 0: return 1.0 // Display
    case 1: return 1.0 // Text
    case 2: return (math.constants.get('scriptPercentScaleDown') ?? 70) / 100
    case 3: return (math.constants.get('scriptScriptPercentScaleDown') ?? 50) / 100
    default: return 1.0
  }
}

/** Lower the style by one level (for fractions: D→T, T→S, S→SS) */
function subStyle(style: MathStyle): MathStyle {
  const base = style & 3
  const cramped = style & 4
  if (base === 0) return (1 | cramped) as MathStyle
  if (base <= 2) return (base + 1 | cramped) as MathStyle
  return (3 | cramped) as MathStyle
}

/** Script style (TeX Rule 17: D/T→S, S→SS, SS→SS) */
function scriptStyle(style: MathStyle): MathStyle {
  return ((style & 3) <= 1 ? 6 : 7) as MathStyle
}

function crampedStyle(style: MathStyle): MathStyle {
  return (style | 4) as MathStyle
}

/** Convert a MATH constant value to pt */
function mathConst(name: string, ctx: MathLayoutContext, scale: number): number {
  const val = ctx.math.getConstant(name, getMathValueContext(ctx))
  return val * scale * ctx.baseFontSize / ctx.font.metrics.unitsPerEm
}

function superscriptShiftUp(ctx: MathLayoutContext, style: MathStyle, scale: number): number {
  return mathConst((style & 4) !== 0 ? 'superscriptShiftUpCramped' : 'superscriptShiftUp', ctx, scale)
}

function getMathValueContext(ctx: MathLayoutContext): MathValueContext {
  if (ctx.mathValueContext !== undefined) return ctx.mathValueContext
  return {
    ppem: ctx.devicePpem,
    unitsPerEm: ctx.font.metrics.unitsPerEm,
    normalizedCoords: ctx.font.getNormalizedVariationCoordinates() ?? undefined,
    gdef: ctx.font.gdef,
  }
}

/** Convert font units to pt */
function fuToPt(fu: number, fontSize: number, upem: number): number {
  return fu * fontSize / upem
}

/**
 * RenderText.y represents the text top edge (not the baseline).
 * Since the renderer computes the baseline as y + ascent,
 * the ascent must be subtracted to place text at the intended baseline position.
 */
function textTopY(baselineY: number, fontSize: number, ctx: MathLayoutContext): number {
  return baselineY - fuToPt(ctx.font.metrics.ascender, fontSize, ctx.font.metrics.unitsPerEm)
}

// ─── Main entry point ───

/**
 * Lay out a MathNode AST into RenderNodes
 *
 * @returns Laid-out box (width, height, depth + RenderNode[])
 */
export function layoutMath(
  node: MathNode,
  ctx: MathLayoutContext,
  style: MathStyle = 0 as MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm

  switch (node.type) {
    case 'glyph': return layoutGlyph(node.codePoint, node.atomType, fontSize, upem, ctx, style)
    case 'row': return layoutRow(node.children, ctx, style)
    case 'frac': return layoutFraction(node, ctx, style)
    case 'script': return layoutScript(node, ctx, style)
    case 'radical': return layoutRadical(node, ctx, style)
    case 'operator': return layoutOperator(node, ctx, style)
    case 'delimited': return layoutDelimited(node, ctx, style)
    case 'accent': return layoutAccent(node, ctx, style)
    case 'matrix': return layoutMatrix(node, ctx, style)
    case 'space': return layoutSpace(node.width, fontSize)
    case 'text': return layoutText(node.content, fontSize, ctx)
    default: return emptyBox()
  }
}

// ─── Mathematical Italic mapping ───

/**
 * Map math-mode variable characters to Mathematical Italic Unicode code points.
 * Like MathJax/KaTeX/TeX, converts ord (variable) type Latin/Greek characters to italic.
 * Digits, operators, and relation symbols stay upright.
 */
function toMathItalic(cp: number, atomType: string): number {
  if (atomType !== 'ord') return cp

  // Latin Capital A-Z → Mathematical Italic Capital (U+1D434–U+1D44D)
  if (cp >= 0x41 && cp <= 0x5A) {
    return 0x1D434 + (cp - 0x41)
  }

  // Latin Small a-z → Mathematical Italic Small (U+1D44E–U+1D467, h=U+210E)
  if (cp >= 0x61 && cp <= 0x7A) {
    if (cp === 0x68) return 0x210E // h → PLANCK CONSTANT
    return 0x1D44E + (cp - 0x61)  // U+1D455 (position of h) is reserved, but the offset calculation is the same
  }

  // Greek Small α(U+03B1)–ω(U+03C9) → Mathematical Italic Small Greek (U+1D6FC–U+1D714)
  if (cp >= 0x03B1 && cp <= 0x03C9) {
    return 0x1D6FC + (cp - 0x03B1)
  }

  // Greek Capital Α(U+0391)–Ω(U+03A9) → Mathematical Italic Capital Greek (U+1D6E2–U+1D6FA)
  // Note: U+03A2 is unassigned in Unicode and has no counterpart in the math block → skip it in the offset
  if (cp >= 0x0391 && cp <= 0x03A9) {
    if (cp === 0x03A2) return cp // reserved
    const offset = cp - 0x0391
    // U+03A2 gap: before 03A2 use the offset as-is, from 03A3 onward subtract 1
    if (cp < 0x03A2) return 0x1D6E2 + offset
    return 0x1D6E2 + offset - 1
  }

  return cp
}

/**
 * Evaluate the MathKern step function — get the kern value based on correctionHeight
 * heights[0..n-1] are ascending thresholds, kerns[0..n] are the kern values for each interval
 * height < heights[0] → kerns[0], heights[0] <= height < heights[1] → kerns[1], ...
 */
function evalMathKern(kern: MathKernRecord | null, height: number): number {
  if (kern === null) return 0
  for (let i = 0; i < kern.heights.length; i++) {
    if (height < kern.heights[i]!) return kern.kerns[i]!
  }
  return kern.kerns[kern.heights.length]!
}

// ─── Individual layout functions ───

function layoutGlyph(
  codePoint: number, atomType: string,
  fontSize: number, upem: number,
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  // Map variable characters to Mathematical Italic
  const mappedCp = toMathItalic(codePoint, atomType)
  // Use the italic glyph if the font has one, otherwise fall back
  let displayCp = mappedCp
  const mappedGid = ctx.font.getGlyphId(mappedCp)
  if (mappedGid === 0 && mappedCp !== codePoint) {
    displayCp = codePoint // Fallback
  }

  const glyphId = ctx.font.getGlyphId(displayCp)
  const advanceWidth = ctx.font.getAdvanceWidth(glyphId)
  const width = fuToPt(advanceWidth, fontSize, upem)

  const char = String.fromCodePoint(displayCp)

  // Estimate height/depth from the glyph bounding box
  const glyph = ctx.font.getGlyph(glyphId)
  let height = fuToPt(ctx.font.metrics.ascender, fontSize, upem)
  let depth = fuToPt(-ctx.font.metrics.descender, fontSize, upem)

  if (glyph.outline) {
    const bounds = getOutlineBounds(glyph.outline.coords, glyph.outline.commands)
    if (bounds) {
      height = fuToPt(bounds.yMax, fontSize, upem)
      depth = fuToPt(-bounds.yMin, fontSize, upem)
      if (height < 0) height = 0
      if (depth < 0) depth = 0
    }
  }

  const textNode: RenderText = {
    type: 'text',
    x: 0,
    y: textTopY(0, fontSize, ctx),
    text: char,
    fontId: ctx.fontId,
    fontSize,
    color: ctx.color,
  }

  return { width, height, depth, nodes: [textNode], leftGlyphId: glyphId, rightGlyphId: glyphId }
}

function layoutRow(
  children: readonly MathNode[],
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  if (children.length === 0) return emptyBox()

  const boxes: MathBox[] = []
  for (let i = 0; i < children.length; i++) {
    boxes.push(layoutMath(children[i]!, ctx, style))
  }

  // Inter-atom spacing
  let totalWidth = 0
  let maxHeight = 0
  let maxDepth = 0

  const resultNodes: RenderNode[] = []

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!
    const child = children[i]!

    // Insert inter-atom space
    if (i > 0) {
      const prev = children[i - 1]!
      const space = getInterAtomSpace(prev, child, ctx, style)
      totalWidth += space
    }

    // Place the child node (x = totalWidth, y aligned to the baseline)
    for (let j = 0; j < box.nodes.length; j++) {
      resultNodes.push(offsetNode(box.nodes[j]!, totalWidth, 0))
    }

    totalWidth += box.width
    if (box.height > maxHeight) maxHeight = box.height
    if (box.depth > maxDepth) maxDepth = box.depth
  }

  return {
    width: totalWidth,
    height: maxHeight,
    depth: maxDepth,
    nodes: resultNodes,
    leftGlyphId: boxes[0]?.leftGlyphId,
    rightGlyphId: boxes[boxes.length - 1]?.rightGlyphId,
  }
}

function layoutFraction(
  node: {
    readonly numerator: MathNode
    readonly denominator: MathNode
    readonly ruleThickness: number | null
    readonly kind: 'fraction' | 'stack' | 'skewed'
  },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const upem = ctx.font.metrics.unitsPerEm
  const fontSize = ctx.baseFontSize * scale
  const isDisplay = (style & 3) === 0

  const numStyle = isDisplay ? 1 as MathStyle : subStyle(style)
  const denStyle = crampedStyle(numStyle)

  const numBox = layoutMath(node.numerator, ctx, numStyle)
  const denBox = layoutMath(node.denominator, ctx, denStyle)

  if (node.kind === 'stack') {
    return layoutMathStack(numBox, denBox, ctx, scale, isDisplay)
  }
  if (node.kind === 'skewed') {
    return layoutSkewedFraction(numBox, denBox, ctx, style, scale, fontSize, upem)
  }

  // MATH table constants
  const ruleThickness = node.ruleThickness != null
    ? node.ruleThickness
    : mathConst('fractionRuleThickness', ctx, scale)
  const axisHeight = mathConst('axisHeight', ctx, scale)
  const numShiftUp = isDisplay
    ? mathConst('fractionNumeratorDisplayStyleShiftUp', ctx, scale)
    : mathConst('fractionNumeratorShiftUp', ctx, scale)
  const denShiftDown = isDisplay
    ? mathConst('fractionDenominatorDisplayStyleShiftDown', ctx, scale)
    : mathConst('fractionDenominatorShiftDown', ctx, scale)
  const numGapMin = isDisplay
    ? mathConst('fractionNumDisplayStyleGapMin', ctx, scale)
    : mathConst('fractionNumeratorGapMin', ctx, scale)
  const denGapMin = isDisplay
    ? mathConst('fractionDenomDisplayStyleGapMin', ctx, scale)
    : mathConst('fractionDenominatorGapMin', ctx, scale)

  // Fraction bar Y position = axisHeight
  const ruleY = axisHeight

  // Numerator: baseline at ruleY + ruleThickness/2 + gap + depth
  let numShift = numShiftUp
  const numBottom = numShift - numBox.depth
  const gapAbove = numBottom - (ruleY + ruleThickness / 2)
  if (gapAbove < numGapMin) {
    numShift += numGapMin - gapAbove
  }

  // Denominator: baseline at ruleY - ruleThickness/2 - gap - height
  let denShift = denShiftDown
  const denTop = -denShift + denBox.height
  const gapBelow = (ruleY - ruleThickness / 2) - denTop
  if (gapBelow < denGapMin) {
    denShift += denGapMin - gapBelow
  }

  const width = Math.max(numBox.width, denBox.width)
  const sidePad = ruleThickness // Left/right padding
  const totalWidth = width + sidePad * 2

  // Center the numerator
  const numX = sidePad + (width - numBox.width) / 2
  const numY = -numShift // y is positive downward, so upward is negative

  // Center the denominator
  const denX = sidePad + (width - denBox.width) / 2
  const denY = denShift

  const resultNodes: RenderNode[] = []

  // Numerator nodes
  for (let i = 0; i < numBox.nodes.length; i++) {
    resultNodes.push(offsetNode(numBox.nodes[i]!, numX, numY))
  }

  // Denominator nodes
  for (let i = 0; i < denBox.nodes.length; i++) {
    resultNodes.push(offsetNode(denBox.nodes[i]!, denX, denY))
  }

  // Fraction bar
  const lineNode: RenderLine = {
    type: 'line',
    x1: 0,
    y1: -ruleY,
    x2: totalWidth,
    y2: -ruleY,
    lineWidth: ruleThickness,
    color: ctx.color,
  }
  resultNodes.push(lineNode)

  const height = numShift + numBox.height
  const depth = denShift + denBox.depth

  return { width: totalWidth, height, depth, nodes: resultNodes }
}

function layoutMathStack(
  topBox: MathBox,
  bottomBox: MathBox,
  ctx: MathLayoutContext,
  scale: number,
  display: boolean,
): MathBox {
  let topShift = mathConst(display ? 'stackTopDisplayStyleShiftUp' : 'stackTopShiftUp', ctx, scale)
  let bottomShift = mathConst(display ? 'stackBottomDisplayStyleShiftDown' : 'stackBottomShiftDown', ctx, scale)
  const gapMin = mathConst(display ? 'stackDisplayStyleGapMin' : 'stackGapMin', ctx, scale)
  const gap = (topShift - topBox.depth) - (-bottomShift + bottomBox.height)
  if (gap < gapMin) {
    const adjustment = (gapMin - gap) / 2
    topShift += adjustment
    bottomShift += adjustment
  }
  const width = Math.max(topBox.width, bottomBox.width)
  const nodes: RenderNode[] = []
  const topX = (width - topBox.width) / 2
  const bottomX = (width - bottomBox.width) / 2
  for (let i = 0; i < topBox.nodes.length; i++) nodes.push(offsetNode(topBox.nodes[i]!, topX, -topShift))
  for (let i = 0; i < bottomBox.nodes.length; i++) nodes.push(offsetNode(bottomBox.nodes[i]!, bottomX, bottomShift))
  return {
    width,
    height: topShift + topBox.height,
    depth: bottomShift + bottomBox.depth,
    nodes,
  }
}

function layoutSkewedFraction(
  numerator: MathBox,
  denominator: MathBox,
  ctx: MathLayoutContext,
  style: MathStyle,
  scale: number,
  fontSize: number,
  upem: number,
): MathBox {
  const horizontalGap = mathConst('skewedFractionHorizontalGap', ctx, scale)
  const verticalGap = mathConst('skewedFractionVerticalGap', ctx, scale)
  const slash = layoutGlyph(0x2044, 'ord', fontSize, upem, ctx, style)
  const numeratorShift = verticalGap / 2
  const denominatorShift = verticalGap / 2
  const slashX = numerator.width + horizontalGap
  const denominatorX = slashX + slash.width + horizontalGap
  const nodes: RenderNode[] = []
  for (let i = 0; i < numerator.nodes.length; i++) nodes.push(offsetNode(numerator.nodes[i]!, 0, -numeratorShift))
  for (let i = 0; i < slash.nodes.length; i++) nodes.push(offsetNode(slash.nodes[i]!, slashX, 0))
  for (let i = 0; i < denominator.nodes.length; i++) nodes.push(offsetNode(denominator.nodes[i]!, denominatorX, denominatorShift))
  return {
    width: denominatorX + denominator.width,
    height: Math.max(numeratorShift + numerator.height, slash.height, denominator.height - denominatorShift),
    depth: Math.max(numerator.depth - numeratorShift, slash.depth, denominatorShift + denominator.depth),
    nodes,
  }
}

function getMathNodeGlyphId(node: MathNode | null, ctx: MathLayoutContext): number | null {
  if (node === null || node.type !== 'glyph') return null
  const mapped = toMathItalic(node.codePoint, node.atomType)
  const mappedGlyph = ctx.font.getGlyphId(mapped)
  return mappedGlyph !== 0 || mapped === node.codePoint ? mappedGlyph : ctx.font.getGlyphId(node.codePoint)
}

function superscriptMathKern(
  base: MathKernInfo | null,
  script: MathKernInfo | null,
  baseBox: MathBox,
  scriptBox: MathBox,
  shift: number,
  fontSize: number,
  upem: number,
): number {
  const first = evalMathKern(base?.topRight ?? null, (shift - scriptBox.depth) * upem / fontSize)
    + evalMathKern(script?.bottomLeft ?? null, -scriptBox.depth * upem / fontSize)
  const second = evalMathKern(base?.topRight ?? null, baseBox.height * upem / fontSize)
    + evalMathKern(script?.bottomLeft ?? null, (baseBox.height - shift) * upem / fontSize)
  return fuToPt(Math.min(first, second), fontSize, upem)
}

function subscriptMathKern(
  base: MathKernInfo | null,
  script: MathKernInfo | null,
  baseBox: MathBox,
  scriptBox: MathBox,
  shift: number,
  fontSize: number,
  upem: number,
): number {
  const first = evalMathKern(base?.bottomRight ?? null, (-shift + scriptBox.height) * upem / fontSize)
    + evalMathKern(script?.topLeft ?? null, scriptBox.height * upem / fontSize)
  const second = evalMathKern(base?.bottomRight ?? null, -baseBox.depth * upem / fontSize)
    + evalMathKern(script?.topLeft ?? null, (shift - baseBox.depth) * upem / fontSize)
  return fuToPt(Math.min(first, second), fontSize, upem)
}

function layoutScript(
  node: { readonly base: MathNode, readonly sup: MathNode | null, readonly sub: MathNode | null },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm
  const baseBox = layoutMath(node.base, ctx, style)
  const ssStyle = scriptStyle(style)

  const supBox = node.sup ? layoutMath(node.sup, ctx, ssStyle) : null
  const subBox = node.sub ? layoutMath(node.sub, ctx, ssStyle) : null

  if (!supBox && !subBox) return baseBox

  let width = baseBox.width
  let height = baseBox.height
  let depth = baseBox.depth

  const resultNodes: RenderNode[] = []
  for (let i = 0; i < baseBox.nodes.length; i++) {
    resultNodes.push(baseBox.nodes[i]!)
  }

  // Italic correction
  let italicCorr = 0
  const mathValueContext = getMathValueContext(ctx)
  const baseGlyphId = getMathNodeGlyphId(node.base, ctx)
  const supGlyphId = getMathNodeGlyphId(node.sup, ctx)
  const subGlyphId = getMathNodeGlyphId(node.sub, ctx)
  const baseKernInfo = baseGlyphId === null ? null : ctx.math.getMathKernInfo(baseGlyphId, mathValueContext)
  const supKernInfo = supGlyphId === null ? null : ctx.math.getMathKernInfo(supGlyphId, mathValueContext)
  const subKernInfo = subGlyphId === null ? null : ctx.math.getMathKernInfo(subGlyphId, mathValueContext)
  const extendedBase = baseBox.rightGlyphId !== undefined && ctx.math.isExtendedShape(baseBox.rightGlyphId)
  const superscriptDropPosition = extendedBase
    ? baseBox.height
    : baseBox.height - mathConst('superscriptBaselineDropMax', ctx, scale)
  const subscriptDropPosition = extendedBase
    ? baseBox.depth
    : baseBox.depth + mathConst('subscriptBaselineDropMin', ctx, scale)
  if (baseGlyphId !== null) {
    const ic = ctx.math.getItalicCorrection(baseGlyphId, mathValueContext)
    if (ic > 0) {
      italicCorr = fuToPt(ic, fontSize, upem)
    }
  }

  if (supBox && subBox) {
    // Superscript and subscript together — drop adjustment based on base height/depth (OpenType MATH spec)
    let supShift = Math.max(
      superscriptShiftUp(ctx, style, scale),
      superscriptDropPosition,
    )
    let subShift = Math.max(
      mathConst('subscriptShiftDown', ctx, scale),
      subscriptDropPosition,
    )

    // Superscript bottom must be at least superscriptBottomMin
    const supBottomMin = mathConst('superscriptBottomMin', ctx, scale)
    if (supShift - supBox.depth < supBottomMin) {
      supShift = supBottomMin + supBox.depth
    }

    // Subscript top must be at most subscriptTopMax
    const subTopMax = mathConst('subscriptTopMax', ctx, scale)
    if (subShift - subBox.height < -subTopMax) {
      subShift = subBox.height - subTopMax
    }

    // Gap between sup and sub must be at least subSuperscriptGapMin
    const gapMin = mathConst('subSuperscriptGapMin', ctx, scale)
    const gap = (supShift - supBox.depth) - (-subShift + subBox.height)
    if (gap < gapMin) {
      const adjust = (gapMin - gap) / 2
      supShift += adjust
      subShift += adjust

      // superscriptBottomMaxWithSubscript check
      const maxBottom = mathConst('superscriptBottomMaxWithSubscript', ctx, scale)
      if (supShift - supBox.depth > maxBottom) {
        const diff = (supShift - supBox.depth) - maxBottom
        supShift -= diff
        subShift += diff
      }
    }

    // Superscript
    const supKern = superscriptMathKern(baseKernInfo, supKernInfo, baseBox, supBox, supShift, fontSize, upem)
    const subKern = subscriptMathKern(baseKernInfo, subKernInfo, baseBox, subBox, subShift, fontSize, upem)
    const supX = width + italicCorr + supKern
    const supY = -supShift
    for (let i = 0; i < supBox.nodes.length; i++) {
      resultNodes.push(offsetNode(supBox.nodes[i]!, supX, supY))
    }

    // Subscript
    const subX = width + subKern
    const subY = subShift
    for (let i = 0; i < subBox.nodes.length; i++) {
      resultNodes.push(offsetNode(subBox.nodes[i]!, subX, subY))
    }

    const scriptWidth = Math.max(supBox.width + italicCorr + supKern, subBox.width + subKern)
    width += scriptWidth + mathConst('spaceAfterScript', ctx, scale)
    if (supShift + supBox.height > height) height = supShift + supBox.height
    if (subShift + subBox.depth > depth) depth = subShift + subBox.depth

  } else if (supBox) {
    // Superscript only — drop adjustment
    let supShift = Math.max(
      superscriptShiftUp(ctx, style, scale),
      superscriptDropPosition,
    )
    const supBottomMin = mathConst('superscriptBottomMin', ctx, scale)
    if (supShift - supBox.depth < supBottomMin) {
      supShift = supBottomMin + supBox.depth
    }

    const supKern = superscriptMathKern(baseKernInfo, supKernInfo, baseBox, supBox, supShift, fontSize, upem)
    const supX = width + italicCorr + supKern
    const supY = -supShift
    for (let i = 0; i < supBox.nodes.length; i++) {
      resultNodes.push(offsetNode(supBox.nodes[i]!, supX, supY))
    }

    width += supBox.width + italicCorr + supKern + mathConst('spaceAfterScript', ctx, scale)
    if (supShift + supBox.height > height) height = supShift + supBox.height

  } else if (subBox) {
    // Subscript only — drop adjustment
    let subShift = Math.max(
      mathConst('subscriptShiftDown', ctx, scale),
      subscriptDropPosition,
    )
    const subTopMax = mathConst('subscriptTopMax', ctx, scale)
    if (subShift - subBox.height < -subTopMax) {
      subShift = subBox.height - subTopMax
    }

    const subKern = subscriptMathKern(baseKernInfo, subKernInfo, baseBox, subBox, subShift, fontSize, upem)
    const subX = width + subKern
    const subY = subShift
    for (let i = 0; i < subBox.nodes.length; i++) {
      resultNodes.push(offsetNode(subBox.nodes[i]!, subX, subY))
    }

    width += subBox.width + subKern + mathConst('spaceAfterScript', ctx, scale)
    if (subShift + subBox.depth > depth) depth = subShift + subBox.depth
  }

  return { width, height, depth, nodes: resultNodes }
}

function layoutRadical(
  node: { readonly radicand: MathNode, readonly degree: MathNode | null },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm

  const radicandBox = layoutMath(node.radicand, ctx, crampedStyle(style))

  const ruleThickness = mathConst('radicalRuleThickness', ctx, scale)
  const verticalGap = (style & 3) === 0
    ? mathConst('radicalDisplayStyleVerticalGap', ctx, scale)
    : mathConst('radicalVerticalGap', ctx, scale)
  const extraAscender = mathConst('radicalExtraAscender', ctx, scale)

  // Determine the radical sign size
  const requiredHeight = radicandBox.height + radicandBox.depth + verticalGap + ruleThickness

  // Get the radical glyph (√ = U+221A)
  const sqrtGid = ctx.font.getGlyphId(0x221A)
  const sqrtAdvance = fuToPt(ctx.font.getAdvanceWidth(sqrtGid), fontSize, upem)

  // Select the best size from vertical variants
  let radicalWidth = sqrtAdvance
  let selectedSqrtGid = sqrtGid
  let variantFound = false
  const variants = ctx.math.getVerticalVariants(sqrtGid)
  if (variants.length > 0) {
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!
      selectedSqrtGid = v.variantGlyph
      radicalWidth = fuToPt(ctx.font.getAdvanceWidth(v.variantGlyph), fontSize, upem)
      // Judge by the actual outline height (yMax - yMin) — advanceMeasurement can be off
      const varGlyph = ctx.font.getGlyph(v.variantGlyph)
      let vExtent = fuToPt(v.advanceMeasurement, fontSize, upem)
      if (varGlyph.outline) {
        const bounds = getOutlineBounds(varGlyph.outline.coords, varGlyph.outline.commands)
        if (bounds) {
          vExtent = fuToPt(bounds.yMax - bounds.yMin, fontSize, upem)
        }
      }
      if (vExtent >= requiredHeight) { variantFound = true; break }
    }
  }

  // If variants are insufficient, try an assembly
  if (!variantFound) {
    const assembly = ctx.math.getVerticalAssembly(sqrtGid)
    if (assembly && assembly.partRecords.length > 0) {
      const radicalBox = buildVerticalAssembly(assembly, 0x221A, requiredHeight, fontSize, upem, ctx)
      // Combine the assembled radical + overbar + radicand
      const contentX = radicalBox.width
      const overbarTopEdge = radicandBox.height + verticalGap + ruleThickness
      const overlineY = -(overbarTopEdge - ruleThickness / 2)

      const resultNodes: RenderNode[] = []

      // Radical assembly — align the top edge with the overbar
      const assemblyShiftY = (radicalBox.height - overbarTopEdge)
      for (let i = 0; i < radicalBox.nodes.length; i++) {
        resultNodes.push(offsetNode(radicalBox.nodes[i]!, 0, -assemblyShiftY))
      }

      // overbar
      const overline: RenderLine = {
        type: 'line',
        x1: contentX,
        y1: overlineY,
        x2: contentX + radicandBox.width,
        y2: overlineY,
        lineWidth: ruleThickness,
        color: ctx.color,
      }
      resultNodes.push(overline)

      // radicand
      for (let i = 0; i < radicandBox.nodes.length; i++) {
        resultNodes.push(offsetNode(radicandBox.nodes[i]!, contentX, 0))
      }

      const totalWidth = contentX + radicandBox.width
      const height = overbarTopEdge + extraAscender
      const radicalBottom = radicalBox.depth - assemblyShiftY
      const depth = radicalBottom > radicandBox.depth ? radicalBottom : radicandBox.depth

      // Degree (nth root)
      if (node.degree) {
        const degStyle = 3 as MathStyle
        const degBox = layoutMath(node.degree, ctx, degStyle)
        const degRaise = mathConst('radicalDegreeBottomRaisePercent', ctx, 1) / 100
        const degY = -(height * degRaise) + degBox.depth
        const degKernBefore = mathConst('radicalKernBeforeDegree', ctx, scale)
        for (let i = 0; i < degBox.nodes.length; i++) {
          resultNodes.push(offsetNode(degBox.nodes[i]!, degKernBefore, degY))
        }
      }

      return { width: totalWidth, height, depth, nodes: resultNodes }
    }
  }

  // Get the actual bounding box of the √ glyph
  const sqrtGlyph = ctx.font.getGlyph(selectedSqrtGid)
  let sqrtBbTop = fuToPt(ctx.font.metrics.ascender, fontSize, upem)
  let sqrtBbBottom = fuToPt(-ctx.font.metrics.descender, fontSize, upem)
  if (sqrtGlyph.outline) {
    const bounds = getOutlineBounds(sqrtGlyph.outline.coords, sqrtGlyph.outline.commands)
    if (bounds) {
      sqrtBbTop = fuToPt(bounds.yMax, fontSize, upem)    // Distance above the baseline
      sqrtBbBottom = fuToPt(-bounds.yMin, fontSize, upem) // Distance below the baseline
    }
  }
  const sqrtGlyphExtent = sqrtBbTop + sqrtBbBottom // Total glyph height

  // Overbar position = radicand top + fixed gap + rule thickness
  // The gap is fixed to the MATH table's radicalVerticalGap; any excess is pushed toward the depth.
  // (Computing the clearance dynamically from sqrtGlyphExtent would raise the overbar
  //  too far when the variant is large, creating an unnatural gap)
  const overbarTopEdge = radicandBox.height + verticalGap + ruleThickness
  const sqrtShiftY = sqrtBbTop - overbarTopEdge

  // Y position of the overbar centerline (y-down: negative = upward)
  const overlineY = -(overbarTopEdge - ruleThickness / 2)

  const contentX = radicalWidth
  const resultNodes: RenderNode[] = []

  // Radical sign (drawn with a vertical shift)
  const sqrtChar = String.fromCodePoint(0x221A)
  const sqrtNode: RenderText = {
    type: 'text',
    x: 0,
    y: textTopY(sqrtShiftY, fontSize, ctx),
    text: sqrtChar,
    fontId: ctx.fontId,
    fontSize,
    color: ctx.color,
    glyphIds: selectedSqrtGid !== sqrtGid ? [selectedSqrtGid] : undefined,
  }
  resultNodes.push(sqrtNode)

  // Overbar — connects to the top of the √ glyph
  const overline: RenderLine = {
    type: 'line',
    x1: contentX,
    y1: overlineY,
    x2: contentX + radicandBox.width,
    y2: overlineY,
    lineWidth: ruleThickness,
    color: ctx.color,
  }
  resultNodes.push(overline)
  for (let i = 0; i < radicandBox.nodes.length; i++) {
    resultNodes.push(offsetNode(radicandBox.nodes[i]!, contentX, 0))
  }

  const totalWidth = contentX + radicandBox.width
  const height = overbarTopEdge + extraAscender
  // Account for the shifted √ glyph bottom extending below the radicand
  const sqrtBottomAfterShift = sqrtShiftY + sqrtBbBottom
  const depth = sqrtBottomAfterShift > radicandBox.depth ? sqrtBottomAfterShift : radicandBox.depth

  // Degree (nth root)
  if (node.degree) {
    const degStyle = 3 as MathStyle // scriptscript
    const degBox = layoutMath(node.degree, ctx, degStyle)
    const degRaise = mathConst('radicalDegreeBottomRaisePercent', ctx, 1) / 100
    const degY = -(height * degRaise) + degBox.depth
    const degKernBefore = mathConst('radicalKernBeforeDegree', ctx, scale)
    const degKernAfter = mathConst('radicalKernAfterDegree', ctx, scale)

    for (let i = 0; i < degBox.nodes.length; i++) {
      resultNodes.push(offsetNode(degBox.nodes[i]!, degKernBefore, degY))
    }
  }

  return { width: totalWidth, height, depth, nodes: resultNodes }
}

function layoutOperator(
  node: {
    readonly codePoint: number,
    readonly above: MathNode | null,
    readonly below: MathNode | null,
    readonly largeop: boolean,
    readonly limits: boolean,
  },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm
  const isDisplay = (style & 3) === 0

  let opBox: MathBox
  let opAssembly: GlyphAssembly | null = null
  let opSelectedGid = 0 // Glyph ID actually rendered (for italic correction lookup)

  if (node.codePoint === 0) {
    // Function name (lim, sup, etc.) — codePoint=0 means a text operator
    opBox = emptyBox()
  } else {
    // Large operator glyph
    const gid = ctx.font.getGlyphId(node.codePoint)
    opSelectedGid = gid
    let displayFontSize = fontSize

    if (isDisplay && node.largeop) {
      // Use the large version in display style
      const minHeight = mathConst('displayOperatorMinHeight', ctx, scale)
      const variants = ctx.math.getVerticalVariants(gid)
      if (variants.length > 0) {
        // Select the best size
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i]!
          const vHeight = fuToPt(v.advanceMeasurement, displayFontSize, upem)
          if (vHeight >= minHeight) {
            // Use this variant — center on the math axis
            const char = String.fromCodePoint(node.codePoint)
            const advW = fuToPt(ctx.font.getAdvanceWidth(v.variantGlyph), displayFontSize, upem)
            opSelectedGid = v.variantGlyph

            // Use the actual bounds of the variant glyph
            let opHeight = fuToPt(ctx.font.metrics.ascender, displayFontSize, upem)
            let opDepth = fuToPt(-ctx.font.metrics.descender, displayFontSize, upem)
            const varGlyph = ctx.font.getGlyph(v.variantGlyph)
            if (varGlyph.outline) {
              const bounds = getOutlineBounds(varGlyph.outline.coords, varGlyph.outline.commands)
              if (bounds) {
                opHeight = fuToPt(bounds.yMax, displayFontSize, upem)
                opDepth = fuToPt(-bounds.yMin, displayFontSize, upem)
              }
            }

            // TeX: center large operators on the math axis
            // Glyph center = (height - depth) / 2, aligned to axisHeight
            const axisH = mathConst('axisHeight', ctx, scale)
            const centerShift = axisH - (opHeight - opDepth) / 2

            const textNode: RenderText = {
              type: 'text',
              x: 0, y: textTopY(-centerShift, displayFontSize, ctx),
              text: char,
              fontId: ctx.fontId,
              fontSize: displayFontSize,
              color: ctx.color,
              glyphIds: v.variantGlyph !== gid ? [v.variantGlyph] : undefined,
            }

            opBox = {
              width: advW,
              height: opHeight + centerShift,
              depth: opDepth - centerShift,
              nodes: [textNode],
            }
            break
          }
        }
      }
    }

    if (!opBox!) {
      // If variants are insufficient, try an assembly
      const assembly = ctx.math.getVerticalAssembly(gid)
      if (assembly && assembly.partRecords.length > 0 && isDisplay && node.largeop) {
        const minHeight = mathConst('displayOperatorMinHeight', ctx, scale)
        opAssembly = assembly
        opBox = buildVerticalAssembly(assembly, node.codePoint, minHeight, fontSize, upem, ctx)
      } else {
        opBox = layoutGlyph(node.codePoint, 'op', fontSize, upem, ctx, style)
      }
    }
  }

  // No limits
  if (!node.above && !node.below) return opBox

  const mathValueContext = getMathValueContext(ctx)
  let operatorItalicCorrection = 0
  if (opSelectedGid !== 0) {
    const correction = opAssembly === null
      ? ctx.math.getItalicCorrection(opSelectedGid, mathValueContext)
      : ctx.math.resolveValue(opAssembly.italicsCorrection, mathValueContext)
    if (correction > 0) operatorItalicCorrection = fuToPt(correction, fontSize, upem)
  }

  // limits: above/below placement (display style) vs side placement
  if (node.limits && isDisplay) {
    return layoutLimitsAboveBelow(opBox, node.above, node.below, ctx, style, operatorItalicCorrection)
  }

  // Side placement — place scripts directly using opBox (including large variants) as the base
  // Note: delegating to layoutScript would discard opBox, so place them directly
  const ssStyle = scriptStyle(style)
  const supBox = node.above ? layoutMath(node.above, ctx, ssStyle) : null
  const subBox = node.below ? layoutMath(node.below, ctx, ssStyle) : null

  if (!supBox && !subBox) return opBox

  let width = opBox.width
  let height = opBox.height
  let depth = opBox.depth
  const resultNodes: RenderNode[] = []
  for (let i = 0; i < opBox.nodes.length; i++) {
    resultNodes.push(opBox.nodes[i]!)
  }

  // Precise horizontal script placement via MathKern
  // Look up MathKernInfo on the variant glyph first, then the base glyph
  // (fonts usually carry MathKernInfo only on the base glyph)
  // If there is no MathKernInfo, use half the italic correction as a fallback
  const baseGid = node.codePoint !== 0 ? ctx.font.getGlyphId(node.codePoint) : 0
  let kernInfo = opSelectedGid !== 0 ? ctx.math.getMathKernInfo(opSelectedGid, mathValueContext) : null
  if (!kernInfo && baseGid !== 0 && baseGid !== opSelectedGid) {
    kernInfo = ctx.math.getMathKernInfo(baseGid, mathValueContext)
  }
  const supGlyphId = getMathNodeGlyphId(node.above, ctx)
  const subGlyphId = getMathNodeGlyphId(node.below, ctx)
  const supKernInfo = supGlyphId === null ? null : ctx.math.getMathKernInfo(supGlyphId, mathValueContext)
  const subKernInfo = subGlyphId === null ? null : ctx.math.getMathKernInfo(subGlyphId, mathValueContext)
  const italicCorr = operatorItalicCorrection

  if (supBox && subBox) {
    // Drop adjustment based on operator height/depth — spreads scripts vertically for large operators
    let supShift = Math.max(
      superscriptShiftUp(ctx, style, scale),
      opBox.height - mathConst('superscriptBaselineDropMax', ctx, scale),
    )
    let subShift = Math.max(
      mathConst('subscriptShiftDown', ctx, scale),
      opBox.depth + mathConst('subscriptBaselineDropMin', ctx, scale),
    )
    const supBottomMin = mathConst('superscriptBottomMin', ctx, scale)
    if (supShift - supBox.depth < supBottomMin) supShift = supBottomMin + supBox.depth
    const subTopMax = mathConst('subscriptTopMax', ctx, scale)
    if (subShift - subBox.height < -subTopMax) subShift = subBox.height - subTopMax
    const gapMin = mathConst('subSuperscriptGapMin', ctx, scale)
    const gap = (supShift - supBox.depth) - (-subShift + subBox.height)
    if (gap < gapMin) {
      const adjust = (gapMin - gap) / 2
      supShift += adjust
      subShift += adjust
      const maxBottom = mathConst('superscriptBottomMaxWithSubscript', ctx, scale)
      if (supShift - supBox.depth > maxBottom) {
        const diff = (supShift - supBox.depth) - maxBottom
        supShift -= diff
        subShift += diff
      }
    }

    const supXKern = superscriptMathKern(kernInfo, supKernInfo, opBox, supBox, supShift, fontSize, upem)
    const subXKern = subscriptMathKern(kernInfo, subKernInfo, opBox, subBox, subShift, fontSize, upem)

    const supX = width + italicCorr + supXKern
    const subX = width + subXKern
    for (let i = 0; i < supBox.nodes.length; i++) {
      resultNodes.push(offsetNode(supBox.nodes[i]!, supX, -supShift))
    }
    for (let i = 0; i < subBox.nodes.length; i++) {
      resultNodes.push(offsetNode(subBox.nodes[i]!, subX, subShift))
    }
    const rightEdge = Math.max(supX + supBox.width, subX + subBox.width)
    width = rightEdge + mathConst('spaceAfterScript', ctx, scale)
    if (supShift + supBox.height > height) height = supShift + supBox.height
    if (subShift + subBox.depth > depth) depth = subShift + subBox.depth
  } else if (supBox) {
    // Drop adjustment
    let supShift = Math.max(
      superscriptShiftUp(ctx, style, scale),
      opBox.height - mathConst('superscriptBaselineDropMax', ctx, scale),
    )
    const supBottomMin = mathConst('superscriptBottomMin', ctx, scale)
    if (supShift - supBox.depth < supBottomMin) supShift = supBottomMin + supBox.depth

    const supXKern = superscriptMathKern(kernInfo, supKernInfo, opBox, supBox, supShift, fontSize, upem)
    const supX = width + italicCorr + supXKern
    for (let i = 0; i < supBox.nodes.length; i++) {
      resultNodes.push(offsetNode(supBox.nodes[i]!, supX, -supShift))
    }
    width = supX + supBox.width + mathConst('spaceAfterScript', ctx, scale)
    if (supShift + supBox.height > height) height = supShift + supBox.height
  } else if (subBox) {
    // Drop adjustment
    let subShift = Math.max(
      mathConst('subscriptShiftDown', ctx, scale),
      opBox.depth + mathConst('subscriptBaselineDropMin', ctx, scale),
    )
    const subTopMax = mathConst('subscriptTopMax', ctx, scale)
    if (subShift - subBox.height < -subTopMax) subShift = subBox.height - subTopMax

    const subXKern = subscriptMathKern(kernInfo, subKernInfo, opBox, subBox, subShift, fontSize, upem)
    const subX = width + subXKern
    for (let i = 0; i < subBox.nodes.length; i++) {
      resultNodes.push(offsetNode(subBox.nodes[i]!, subX, subShift))
    }
    width = Math.max(width, subX + subBox.width) + mathConst('spaceAfterScript', ctx, scale)
    if (subShift + subBox.depth > depth) depth = subShift + subBox.depth
  }

  return { width, height, depth, nodes: resultNodes }
}

function layoutLimitsAboveBelow(
  opBox: MathBox,
  above: MathNode | null,
  below: MathNode | null,
  ctx: MathLayoutContext, style: MathStyle,
  italicCorrection: number,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const ssStyle = scriptStyle(style)

  const aboveBox = above ? layoutMath(above, ctx, ssStyle) : null
  const belowBox = below ? layoutMath(below, ctx, ssStyle) : null

  let maxWidth = opBox.width
  if (aboveBox && aboveBox.width > maxWidth) maxWidth = aboveBox.width
  if (belowBox && belowBox.width > maxWidth) maxWidth = belowBox.width

  const upperGapMin = mathConst('upperLimitGapMin', ctx, scale)
  const upperRise = mathConst('upperLimitBaselineRiseMin', ctx, scale)
  const lowerGapMin = mathConst('lowerLimitGapMin', ctx, scale)
  const lowerDrop = mathConst('lowerLimitBaselineDropMin', ctx, scale)

  const resultNodes: RenderNode[] = []
  let totalHeight = 0
  let totalDepth = 0

  // Center the operator
  const opX = (maxWidth - opBox.width) / 2
  for (let i = 0; i < opBox.nodes.length; i++) {
    resultNodes.push(offsetNode(opBox.nodes[i]!, opX, 0))
  }
  totalHeight = opBox.height
  totalDepth = opBox.depth

  // Upper limit
  if (aboveBox) {
    let gap = upperGapMin
    const aboveShift = opBox.height + gap + aboveBox.depth
    if (aboveShift < opBox.height + upperRise) {
      gap = opBox.height + upperRise - opBox.height
    }
    const finalShift = opBox.height + gap + aboveBox.depth
    const aboveX = (maxWidth - aboveBox.width) / 2 + italicCorrection / 2
    const aboveY = -finalShift

    for (let i = 0; i < aboveBox.nodes.length; i++) {
      resultNodes.push(offsetNode(aboveBox.nodes[i]!, aboveX, aboveY))
    }

    totalHeight = finalShift + aboveBox.height
  }

  // Lower limit
  if (belowBox) {
    let gap = lowerGapMin
    const belowShift = opBox.depth + gap + belowBox.height
    if (belowShift < opBox.depth + lowerDrop) {
      gap = opBox.depth + lowerDrop - opBox.depth
    }
    const finalShift = opBox.depth + gap + belowBox.height
    const belowX = (maxWidth - belowBox.width) / 2 - italicCorrection / 2
    const belowY = finalShift

    for (let i = 0; i < belowBox.nodes.length; i++) {
      resultNodes.push(offsetNode(belowBox.nodes[i]!, belowX, belowY))
    }

    totalDepth = finalShift + belowBox.depth
  }

  return { width: maxWidth, height: totalHeight, depth: totalDepth, nodes: resultNodes }
}

function layoutDelimited(
  node: { readonly open: number, readonly close: number, readonly body: MathNode },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm

  const bodyBox = layoutMath(node.body, ctx, style)
  const targetHeight = Math.max(
    bodyBox.height + bodyBox.depth,
    mathConst('delimitedSubFormulaMinHeight', ctx, scale),
  )

  const resultNodes: RenderNode[] = []
  let x = 0
  let height = bodyBox.height
  let depth = bodyBox.depth
  let leftGlyphId = bodyBox.leftGlyphId
  let rightGlyphId = bodyBox.rightGlyphId

  // Left delimiter
  if (node.open !== 0) {
    const delimBox = layoutDelimiter(node.open, targetHeight, fontSize, upem, ctx, style)
    // Vertically center the delimiter (y-down: body center - delim center)
    const delimY = (delimBox.height - delimBox.depth) / 2 - (bodyBox.height - bodyBox.depth) / 2
    for (let i = 0; i < delimBox.nodes.length; i++) {
      resultNodes.push(offsetNode(delimBox.nodes[i]!, x, delimY))
    }
    x += delimBox.width
    if (delimBox.height > height) height = delimBox.height
    if (delimBox.depth > depth) depth = delimBox.depth
    leftGlyphId = delimBox.leftGlyphId
  }

  // Body
  for (let i = 0; i < bodyBox.nodes.length; i++) {
    resultNodes.push(offsetNode(bodyBox.nodes[i]!, x, 0))
  }
  x += bodyBox.width

  // Right delimiter
  if (node.close !== 0) {
    const delimBox = layoutDelimiter(node.close, targetHeight, fontSize, upem, ctx, style)
    const delimY = (delimBox.height - delimBox.depth) / 2 - (bodyBox.height - bodyBox.depth) / 2
    for (let i = 0; i < delimBox.nodes.length; i++) {
      resultNodes.push(offsetNode(delimBox.nodes[i]!, x, delimY))
    }
    x += delimBox.width
    if (delimBox.height > height) height = delimBox.height
    if (delimBox.depth > depth) depth = delimBox.depth
    rightGlyphId = delimBox.rightGlyphId
  }

  return { width: x, height, depth, nodes: resultNodes, leftGlyphId, rightGlyphId }
}

/**
 * Vertical Glyph Assembly — build a glyph of arbitrary height by combining parts
 *
 * Based on the OpenType MATH table's GlyphAssembly.
 * Parts are ordered bottom to top (partRecords[0] = bottommost).
 * isExtender parts are repeated to reach targetHeight.
 * The height is fine-tuned by adjusting the connector overlap.
 */
function buildVerticalAssembly(
  assembly: GlyphAssembly, codePoint: number, targetHeight: number,
  fontSize: number, upem: number, ctx: MathLayoutContext,
): MathBox {
  const parts = assembly.partRecords
  const minOverlap = fuToPt(ctx.math.minConnectorOverlap, fontSize, upem)

  // Step 1: Determine the extender repeat count
  let extRepeat = 0
  let partList: GlyphPartRecord[] = []
  let totalAdvance = 0
  let numJunctions = 0

  for (let iter = 0; iter < 50; iter++) {
    partList = []
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]!
      if (part.partFlags & 1) {
        for (let r = 0; r <= extRepeat; r++) partList.push(part)
      } else {
        partList.push(part)
      }
    }

    totalAdvance = 0
    for (let i = 0; i < partList.length; i++) {
      totalAdvance += fuToPt(partList[i]!.fullAdvance, fontSize, upem)
    }
    numJunctions = partList.length - 1
    const h = totalAdvance - numJunctions * minOverlap

    if (h >= targetHeight) break
    extRepeat++
  }

  // Step 2: Fine-tune the overlap — approach targetHeight
  let overlap = minOverlap
  const rawHeight = totalAdvance - numJunctions * minOverlap
  if (numJunctions > 0 && rawHeight > targetHeight) {
    overlap = minOverlap + (rawHeight - targetHeight) / numJunctions
    // Clamp by the connector lengths at each junction
    for (let i = 0; i < numJunctions; i++) {
      const maxOvl = Math.min(
        fuToPt(partList[i]!.endConnectorLength, fontSize, upem),
        fuToPt(partList[i + 1]!.startConnectorLength, fontSize, upem),
      )
      if (maxOvl > 0 && overlap > maxOvl) overlap = maxOvl
    }
  }

  // Step 3: Compute the final height and part positions (bottom to top, font coords: y-up)
  const assemblyHeight = totalAdvance - numJunctions * overlap
  const halfH = assemblyHeight / 2

  // Stack parts bottom to top. baselineOffset[i] = baseline position of part i (y-up, 0 = bottommost)
  const positions: number[] = []
  let pos = 0
  for (let i = 0; i < partList.length; i++) {
    positions.push(pos)
    if (i < partList.length - 1) {
      pos += fuToPt(partList[i]!.fullAdvance, fontSize, upem) - overlap
    }
  }

  // Step 4: Rendering — draw each part as RenderText + clip group
  //
  // Parts are stacked bottom to top (positions[i] = bottom edge of part i, y-up).
  // With the glyph baseline at 0, the glyph is drawn from yMin (bottom) to yMax (top).
  // To align the part's bottom edge to positions[i]:
  //   baseline (y-up) = positions[i] - yMin  (if yMin is negative, the baseline is above positions[i])
  // Conversion to render coords (y-down):
  //   baselineY (y-down) = -(baseline_yUp - halfH)
  //
  const nodes: RenderNode[] = []
  let width = 0
  const char = String.fromCodePoint(codePoint)

  for (let i = 0; i < partList.length; i++) {
    const part = partList[i]!
    const partAdvPt = fuToPt(part.fullAdvance, fontSize, upem)
    const partW = fuToPt(ctx.font.getAdvanceWidth(part.glyphId), fontSize, upem)
    if (partW > width) width = partW

    // Get the actual yMin/yMax of the part glyph
    const partGlyph = ctx.font.getGlyph(part.glyphId)
    let partYMin = 0
    let partYMax = fuToPt(part.fullAdvance, fontSize, upem)
    if (partGlyph.outline) {
      const bounds = getOutlineBounds(partGlyph.outline.coords, partGlyph.outline.commands)
      if (bounds) {
        partYMin = fuToPt(bounds.yMin, fontSize, upem)
        partYMax = fuToPt(bounds.yMax, fontSize, upem)
      }
    }

    // Place the part's bottom edge at positions[i]
    // baseline (y-up) = positions[i] - partYMin
    const baselineYUp = positions[i]! - partYMin
    // Render coords (y-down): center the whole assembly around halfH
    const baselineY = -(baselineYUp - halfH)

    const textNode: RenderText = {
      type: 'text',
      x: 0,
      y: textTopY(baselineY, fontSize, ctx),
      text: char,
      fontId: ctx.fontId,
      fontSize,
      color: ctx.color,
      glyphIds: [part.glyphId],
    }

    // Restrict the visible area with a clip group (prevents double-drawing of overlaps)
    const clipTopYUp = positions[i]! + partAdvPt // Part top edge (y-up)
    const clipTop = -(clipTopYUp - halfH) // render y-down
    const clipH = partAdvPt
    const clipGroup: RenderGroup = {
      type: 'group',
      x: 0, y: clipTop,
      width: partW,
      height: clipH,
      clip: true,
      children: [{ ...textNode, y: textNode.y - clipTop }],
    }
    nodes.push(clipGroup)
  }

  return {
    width,
    height: halfH,
    depth: halfH,
    nodes,
    leftGlyphId: partList[0]?.glyphId,
    rightGlyphId: partList[partList.length - 1]?.glyphId,
  }
}

/**
 * Horizontal Glyph Assembly — build a glyph of arbitrary width by combining parts
 *
 * Based on the OpenType MATH table's GlyphAssembly.
 * Parts are ordered left to right (partRecords[0] = leftmost).
 * isExtender parts are repeated to reach targetWidth.
 * The width is fine-tuned by adjusting the connector overlap.
 */
function buildHorizontalAssembly(
  assembly: GlyphAssembly, codePoint: number, targetWidth: number,
  fontSize: number, upem: number, ctx: MathLayoutContext,
): MathBox {
  const parts = assembly.partRecords
  const minOverlap = fuToPt(ctx.math.minConnectorOverlap, fontSize, upem)

  // Step 1: Determine the extender repeat count
  let extRepeat = 0
  let partList: GlyphPartRecord[] = []
  let totalAdvance = 0
  let numJunctions = 0

  for (let iter = 0; iter < 50; iter++) {
    partList = []
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]!
      if (part.partFlags & 1) {
        for (let r = 0; r <= extRepeat; r++) partList.push(part)
      } else {
        partList.push(part)
      }
    }

    totalAdvance = 0
    for (let i = 0; i < partList.length; i++) {
      totalAdvance += fuToPt(partList[i]!.fullAdvance, fontSize, upem)
    }
    numJunctions = partList.length - 1
    const w = totalAdvance - numJunctions * minOverlap

    if (w >= targetWidth) break
    extRepeat++
  }

  // Step 2: Fine-tune the overlap — approach targetWidth
  let overlap = minOverlap
  const rawWidth = totalAdvance - numJunctions * minOverlap
  if (numJunctions > 0 && rawWidth > targetWidth) {
    overlap = minOverlap + (rawWidth - targetWidth) / numJunctions
    // Clamp by the connector lengths at each junction
    for (let i = 0; i < numJunctions; i++) {
      const maxOvl = Math.min(
        fuToPt(partList[i]!.endConnectorLength, fontSize, upem),
        fuToPt(partList[i + 1]!.startConnectorLength, fontSize, upem),
      )
      if (maxOvl > 0 && overlap > maxOvl) overlap = maxOvl
    }
  }

  // Step 3: Compute the final width and part positions (left to right)
  const assemblyWidth = totalAdvance - numJunctions * overlap

  const positions: number[] = []
  let pos = 0
  for (let i = 0; i < partList.length; i++) {
    positions.push(pos)
    if (i < partList.length - 1) {
      pos += fuToPt(partList[i]!.fullAdvance, fontSize, upem) - overlap
    }
  }

  // Step 4: Pre-pass — compute maxHeight/maxDepth over all parts first
  let maxHeight = 0
  let maxDepth = 0
  for (let i = 0; i < partList.length; i++) {
    const part = partList[i]!
    const partGlyph = ctx.font.getGlyph(part.glyphId)
    let partHeight = fuToPt(ctx.font.metrics.ascender, fontSize, upem)
    let partDepth = fuToPt(-ctx.font.metrics.descender, fontSize, upem)
    if (partGlyph.outline) {
      const bounds = getOutlineBounds(partGlyph.outline.coords, partGlyph.outline.commands)
      if (bounds) {
        partHeight = fuToPt(bounds.yMax, fontSize, upem)
        partDepth = fuToPt(-bounds.yMin, fontSize, upem)
      }
    }
    if (partHeight > maxHeight) maxHeight = partHeight
    if (partDepth > maxDepth) maxDepth = partDepth
  }

  // Step 5: Rendering — draw each part as RenderText + clip group
  const nodes: RenderNode[] = []
  const char = String.fromCodePoint(codePoint)
  const clipTop = -maxHeight // render y-down: top edge
  const clipH = maxHeight + maxDepth

  for (let i = 0; i < partList.length; i++) {
    const part = partList[i]!
    const partAdvPt = fuToPt(part.fullAdvance, fontSize, upem)

    const textX = positions[i]!
    const textY = textTopY(0, fontSize, ctx)

    // Restrict the visible area with a clip group (prevents double-drawing of overlaps)
    const clipX = positions[i]!
    const clipW = partAdvPt
    const clipGroup: RenderGroup = {
      type: 'group',
      x: clipX, y: clipTop,
      width: clipW,
      height: clipH,
      clip: true,
      children: [{
        type: 'text' as const,
        x: textX - clipX,
        y: textY - clipTop,
        text: char,
        fontId: ctx.fontId,
        fontSize,
        color: ctx.color,
        glyphIds: [part.glyphId],
      }],
    }
    nodes.push(clipGroup)
  }

  return {
    width: assemblyWidth,
    height: maxHeight,
    depth: maxDepth,
    nodes,
    leftGlyphId: partList[0]?.glyphId,
    rightGlyphId: partList[partList.length - 1]?.glyphId,
  }
}

/**
 * Build the accent layout using an accent box (e.g. an assembly)
 * Called from layoutAccent() when a horizontal assembly could be built
 */
function layoutAccentWithBox(
  node: { readonly base: MathNode, readonly accentCodePoint: number, readonly position: 'over' | 'under' },
  baseBox: MathBox, accentBox: MathBox,
  ctx: MathLayoutContext, style: MathStyle,
  fontSize: number, upem: number,
): MathBox {
  const scale = getStyleScale(style, ctx)
  // Center the assembly over the base
  const accentX = (baseBox.width - accentBox.width) / 2
  const resultNodes: RenderNode[] = []

  if (node.position === 'over') {
    const accentBaseHeight = mathConst('accentBaseHeight', ctx, scale)
    const shiftUp = node.accentCodePoint === 0x23DE
      ? Math.max(
        mathConst('stretchStackTopShiftUp', ctx, scale),
        baseBox.height + mathConst('stretchStackGapAboveMin', ctx, scale) + accentBox.depth,
      )
      : Math.max(baseBox.height, accentBaseHeight)

    // base
    for (let i = 0; i < baseBox.nodes.length; i++) {
      resultNodes.push(baseBox.nodes[i]!)
    }
    // Assembly accent
    for (let i = 0; i < accentBox.nodes.length; i++) {
      resultNodes.push(offsetNode(accentBox.nodes[i]!, accentX, -shiftUp))
    }

    const height = shiftUp + accentBox.height
    return { width: baseBox.width, height, depth: baseBox.depth, nodes: resultNodes }
  } else {
    const underGap = node.accentCodePoint === 0x23DF
      ? Math.max(
        mathConst('stretchStackBottomShiftDown', ctx, scale) - baseBox.depth - accentBox.height,
        mathConst('stretchStackGapBelowMin', ctx, scale),
      )
      : mathConst('underbarVerticalGap', ctx, scale)

    // base
    for (let i = 0; i < baseBox.nodes.length; i++) {
      resultNodes.push(baseBox.nodes[i]!)
    }
    // Assembly accent
    for (let i = 0; i < accentBox.nodes.length; i++) {
      resultNodes.push(offsetNode(accentBox.nodes[i]!, accentX, baseBox.depth + underGap))
    }

    const depth = baseBox.depth + underGap + accentBox.depth
    return { width: baseBox.width, height: baseBox.height, depth, nodes: resultNodes }
  }
}

function layoutDelimiter(
  codePoint: number, targetHeight: number,
  fontSize: number, upem: number,
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  // Select the best size from vertical variants
  const gid = ctx.font.getGlyphId(codePoint)
  const variants = ctx.math.getVerticalVariants(gid)

  let bestGid = gid
  let found = false
  if (variants.length > 0) {
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!
      bestGid = v.variantGlyph
      const vHeight = fuToPt(v.advanceMeasurement, fontSize, upem)
      if (vHeight >= targetHeight) { found = true; break }
    }
  }

  // If variants are insufficient, try an assembly
  if (!found) {
    const assembly = ctx.math.getVerticalAssembly(gid)
    if (assembly && assembly.partRecords.length > 0) {
      return buildVerticalAssembly(assembly, codePoint, targetHeight, fontSize, upem, ctx)
    }
  }

  const advW = fuToPt(ctx.font.getAdvanceWidth(bestGid), fontSize, upem)
  const char = String.fromCodePoint(codePoint)

  const textNode: RenderText = {
    type: 'text',
    x: 0, y: textTopY(0, fontSize, ctx),
    text: char,
    fontId: ctx.fontId,
    fontSize,
    color: ctx.color,
    glyphIds: bestGid !== gid ? [bestGid] : undefined,
  }

  const glyph = ctx.font.getGlyph(bestGid)
  let height = fuToPt(ctx.font.metrics.ascender, fontSize, upem)
  let depth = fuToPt(-ctx.font.metrics.descender, fontSize, upem)

  if (glyph.outline) {
    const bounds = getOutlineBounds(glyph.outline.coords, glyph.outline.commands)
    if (bounds) {
      height = fuToPt(bounds.yMax, fontSize, upem)
      depth = fuToPt(-bounds.yMin, fontSize, upem)
    }
  }

  return { width: advW, height, depth, nodes: [textNode], leftGlyphId: bestGid, rightGlyphId: bestGid }
}

/**
 * Get the accent attachment point from a MathNode (font units)
 * For a single glyph: use topAccentAttachment (advanceWidth/2 if 0)
 * For a compound expression: return null (falls back to centering)
 */
function getAccentAttachPoint(node: MathNode, ctx: MathLayoutContext): number | null {
  if (node.type === 'glyph') {
    // Get the actual display glyph via the same mapping as toMathItalic
    const mappedCp = toMathItalic(node.codePoint, node.atomType)
    let displayCp = mappedCp
    const mappedGid = ctx.font.getGlyphId(mappedCp)
    if (mappedGid === 0 && mappedCp !== node.codePoint) {
      displayCp = node.codePoint
    }
    const gid = ctx.font.getGlyphId(displayCp)
    const attach = ctx.math.getTopAccentAttachment(gid, getMathValueContext(ctx))
    // 0 usually means "not in coverage" → fall back to advanceWidth/2
    if (attach !== 0) return attach
    return ctx.font.getAdvanceWidth(gid) / 2
  }
  // Script nodes use the base's attachment point
  if (node.type === 'script') {
    return getAccentAttachPoint(node.base, ctx)
  }
  // Compound expression (row, frac, radical, etc.) → null (centered)
  return null
}

function layoutAccent(
  node: { readonly base: MathNode, readonly accentCodePoint: number, readonly position: 'over' | 'under' },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm

  const baseBox = layoutMath(node.base, ctx, style)

  if (node.accentCodePoint === 0x0305 || node.accentCodePoint === 0x0332) {
    return layoutRuleAccent(node, baseBox, ctx, scale)
  }

  // Accent character glyph info
  const accentGid = ctx.font.getGlyphId(node.accentCodePoint)

  // Horizontal variant selection: if the accent is narrower than the base, look for a larger variant
  let selectedAccentGid = accentGid
  const flattenedThreshold = mathConst('flattenedAccentBaseHeight', ctx, scale)
  if (node.position === 'over' && baseBox.height >= flattenedThreshold) {
    const flattened = ctx.font.shapeText(String.fromCodePoint(node.accentCodePoint), {
      features: new Set(['flac']),
    })
    if (flattened.length === 1) selectedAccentGid = flattened[0]!.glyphId
  }
  const baseWidthFu = baseBox.width * upem / fontSize // Convert the base width to font units
  const accentAdvFu = ctx.font.getAdvanceWidth(accentGid)
  if (accentAdvFu < baseWidthFu) {
    // Look for a horizontal variant at least as wide as the base
    const variants = ctx.math.getHorizontalVariants(accentGid)
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!
      selectedAccentGid = v.variantGlyph
      if (v.advanceMeasurement >= baseWidthFu) break
    }
    // Variants insufficient → try a horizontal assembly
    if (ctx.font.getAdvanceWidth(selectedAccentGid) < baseWidthFu) {
      const assembly = ctx.math.getHorizontalAssembly(accentGid)
      if (assembly && assembly.partRecords.length > 0) {
        const targetWidth = baseBox.width
        const assemblyBox = buildHorizontalAssembly(assembly, node.accentCodePoint, targetWidth, fontSize, upem, ctx)
        // If the assembly could be built, use it as the accent
        return layoutAccentWithBox(node, baseBox, assemblyBox, ctx, style, fontSize, upem)
      }
    }
  }

  const accentAdvance = fuToPt(ctx.font.getAdvanceWidth(selectedAccentGid), fontSize, upem)
  const accentChar = String.fromCodePoint(node.accentCodePoint)

  // Accent placement using topAccentAttachment
  const baseAttachFu = getAccentAttachPoint(node.base, ctx)
  let accentX: number
  if (baseAttachFu !== null) {
    // Precise placement: align the attachment points of base and accent
    const baseAttachPt = fuToPt(baseAttachFu, fontSize, upem)
    const accentAttachFu = ctx.math.getTopAccentAttachment(selectedAccentGid, getMathValueContext(ctx))
    const accentAttachPt = accentAttachFu !== 0
      ? fuToPt(accentAttachFu, fontSize, upem)
      : accentAdvance / 2
    accentX = baseAttachPt - accentAttachPt
  } else {
    // Compound expression: fall back to centering
    accentX = (baseBox.width - accentAdvance) / 2
  }

  const resultNodes: RenderNode[] = []

  if (node.position === 'over') {
    // Over accent
    const accentBaseHeight = mathConst('accentBaseHeight', ctx, scale)
    const shiftUp = Math.max(baseBox.height, accentBaseHeight)

    // base
    for (let i = 0; i < baseBox.nodes.length; i++) {
      resultNodes.push(baseBox.nodes[i]!)
    }

    // Accent
    const accentNode: RenderText = {
      type: 'text',
      x: accentX,
      y: textTopY(-shiftUp, fontSize, ctx),
      text: accentChar,
      fontId: ctx.fontId,
      fontSize,
      color: ctx.color,
      glyphIds: selectedAccentGid !== accentGid ? [selectedAccentGid] : undefined,
    }
    resultNodes.push(accentNode)

    // Use the actual height of the accent glyph
    let accentGlyphHeight = fuToPt(ctx.font.metrics.ascender, fontSize, upem) * 0.3
    const accentGlyph = ctx.font.getGlyph(selectedAccentGid)
    if (accentGlyph.outline) {
      const bounds = getOutlineBounds(accentGlyph.outline.coords, accentGlyph.outline.commands)
      if (bounds) {
        accentGlyphHeight = fuToPt(bounds.yMax, fontSize, upem)
      }
    }
    const height = shiftUp + accentGlyphHeight
    return { width: baseBox.width, height, depth: baseBox.depth, nodes: resultNodes }

  } else {
    // Under accent
    const underGap = mathConst('underbarVerticalGap', ctx, scale)

    // base
    for (let i = 0; i < baseBox.nodes.length; i++) {
      resultNodes.push(baseBox.nodes[i]!)
    }

    // Accent
    const accentNode: RenderText = {
      type: 'text',
      x: accentX,
      y: textTopY(baseBox.depth + underGap, fontSize, ctx),
      text: accentChar,
      fontId: ctx.fontId,
      fontSize,
      color: ctx.color,
      glyphIds: selectedAccentGid !== accentGid ? [selectedAccentGid] : undefined,
    }
    resultNodes.push(accentNode)

    // Use the actual depth of the accent glyph
    let accentGlyphDepth = fuToPt(-ctx.font.metrics.descender, fontSize, upem) * 0.3
    const accentGlyph2 = ctx.font.getGlyph(selectedAccentGid)
    if (accentGlyph2.outline) {
      const bounds = getOutlineBounds(accentGlyph2.outline.coords, accentGlyph2.outline.commands)
      if (bounds) {
        accentGlyphDepth = fuToPt(-bounds.yMin, fontSize, upem)
      }
    }
    const depth = baseBox.depth + underGap + accentGlyphDepth
    return { width: baseBox.width, height: baseBox.height, depth, nodes: resultNodes }
  }
}

function layoutRuleAccent(
  node: { readonly position: 'over' | 'under' },
  baseBox: MathBox,
  ctx: MathLayoutContext,
  scale: number,
): MathBox {
  const over = node.position === 'over'
  const gap = mathConst(over ? 'overbarVerticalGap' : 'underbarVerticalGap', ctx, scale)
  const thickness = mathConst(over ? 'overbarRuleThickness' : 'underbarRuleThickness', ctx, scale)
  const extra = mathConst(over ? 'overbarExtraAscender' : 'underbarExtraDescender', ctx, scale)
  const nodes = baseBox.nodes.slice()
  const y = over ? -(baseBox.height + gap) : baseBox.depth + gap
  nodes.push({
    type: 'line',
    x1: 0,
    y1: y,
    x2: baseBox.width,
    y2: y,
    lineWidth: thickness,
    color: ctx.color,
  })
  return over
    ? { width: baseBox.width, height: baseBox.height + gap + thickness + extra, depth: baseBox.depth, nodes }
    : { width: baseBox.width, height: baseBox.height, depth: baseBox.depth + gap + thickness + extra, nodes }
}

function layoutMatrix(
  node: {
    readonly cells: readonly (readonly MathNode[])[],
    readonly delimiters: string,
    readonly colAlign: readonly ('l' | 'c' | 'r')[],
  },
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale

  const numRows = node.cells.length
  if (numRows === 0) return emptyBox()

  let numCols = 0
  for (let r = 0; r < numRows; r++) {
    if (node.cells[r]!.length > numCols) numCols = node.cells[r]!.length
  }
  if (numCols === 0) return emptyBox()

  // Lay out each cell
  const cellBoxes: MathBox[][] = []
  for (let r = 0; r < numRows; r++) {
    const row: MathBox[] = []
    for (let c = 0; c < numCols; c++) {
      if (c < node.cells[r]!.length) {
        row.push(layoutMath(node.cells[r]![c]!, ctx, style))
      } else {
        row.push(emptyBox())
      }
    }
    cellBoxes.push(row)
  }

  // Compute column widths
  const colWidths: number[] = new Array(numCols).fill(0)
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < numRows; r++) {
      if (cellBoxes[r]![c]!.width > colWidths[c]!) {
        colWidths[c] = cellBoxes[r]![c]!.width
      }
    }
  }

  // Compute row heights
  const rowHeights: number[] = new Array(numRows).fill(0)
  const rowDepths: number[] = new Array(numRows).fill(0)
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const box = cellBoxes[r]![c]!
      if (box.height > rowHeights[r]!) rowHeights[r] = box.height
      if (box.depth > rowDepths[r]!) rowDepths[r] = box.depth
    }
  }

  // Spacing
  const colGap = fontSize * 0.8  // Column gap
  const rowGap = fontSize * 0.4 + mathConst('mathLeading', ctx, scale)

  // Placement
  const resultNodes: RenderNode[] = []
  let y = 0

  // Precompute the total height for vertical centering
  let totalHeight = 0
  for (let r = 0; r < numRows; r++) {
    totalHeight += rowHeights[r]! + rowDepths[r]!
    if (r > 0) totalHeight += rowGap
  }
  const axisHeight = mathConst('axisHeight', ctx, scale)
  // Vertically center the matrix on the math axis (y = -axisHeight)
  const yOffset = -(totalHeight / 2 + axisHeight)

  y = yOffset

  for (let r = 0; r < numRows; r++) {
    if (r > 0) y += rowGap

    const baselineY = y + rowHeights[r]!
    let x = 0

    for (let c = 0; c < numCols; c++) {
      if (c > 0) x += colGap
      const box = cellBoxes[r]![c]!
      const align = c < node.colAlign.length ? node.colAlign[c]! : 'c'

      let cellX = x
      if (align === 'c') cellX += (colWidths[c]! - box.width) / 2
      else if (align === 'r') cellX += colWidths[c]! - box.width

      for (let i = 0; i < box.nodes.length; i++) {
        resultNodes.push(offsetNode(box.nodes[i]!, cellX, baselineY))
      }

      x += colWidths[c]!
    }

    y += rowHeights[r]! + rowDepths[r]!
  }

  let totalWidth = colGap * (numCols - 1)
  for (let ci = 0; ci < colWidths.length; ci++) totalWidth += colWidths[ci]!
  const halfH = totalHeight / 2 + axisHeight
  const halfD = totalHeight / 2 - axisHeight

  // If delimited, wrap the content with delimiters
  const delimPair = MATRIX_DELIM_MAP.get(node.delimiters)
  if (delimPair && (delimPair[0] !== 0 || delimPair[1] !== 0)) {
    const innerBox: MathBox = { width: totalWidth, height: halfH, depth: halfD, nodes: resultNodes }
    return wrapWithDelimiters(innerBox, delimPair[0], delimPair[1], ctx, style)
  }

  return { width: totalWidth, height: halfH, depth: halfD, nodes: resultNodes }
}

const MATRIX_DELIM_MAP = new Map<string, [number, number]>([
  ['pmatrix', [0x0028, 0x0029]],
  ['bmatrix', [0x005B, 0x005D]],
  ['Bmatrix', [0x007B, 0x007D]],
  ['vmatrix', [0x007C, 0x007C]],
  ['Vmatrix', [0x2016, 0x2016]],
  ['matrix', [0, 0]],
  ['cases', [0x007B, 0]],
])

function wrapWithDelimiters(
  innerBox: MathBox,
  openCp: number, closeCp: number,
  ctx: MathLayoutContext, style: MathStyle,
): MathBox {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale
  const upem = ctx.font.metrics.unitsPerEm
  const targetHeight = innerBox.height + innerBox.depth

  const resultNodes: RenderNode[] = []
  let x = 0

  if (openCp !== 0) {
    const delimBox = layoutDelimiter(openCp, targetHeight, fontSize, upem, ctx, style)
    const delimY = (delimBox.height - delimBox.depth) / 2 - (innerBox.height - innerBox.depth) / 2
    for (let i = 0; i < delimBox.nodes.length; i++) {
      resultNodes.push(offsetNode(delimBox.nodes[i]!, x, delimY))
    }
    x += delimBox.width
  }

  for (let i = 0; i < innerBox.nodes.length; i++) {
    resultNodes.push(offsetNode(innerBox.nodes[i]!, x, 0))
  }
  x += innerBox.width

  if (closeCp !== 0) {
    const delimBox = layoutDelimiter(closeCp, targetHeight, fontSize, upem, ctx, style)
    const delimY = (delimBox.height - delimBox.depth) / 2 - (innerBox.height - innerBox.depth) / 2
    for (let i = 0; i < delimBox.nodes.length; i++) {
      resultNodes.push(offsetNode(delimBox.nodes[i]!, x, delimY))
    }
    x += delimBox.width
  }

  return { width: x, height: innerBox.height, depth: innerBox.depth, nodes: resultNodes }
}

function layoutSpace(widthEm: number, fontSize: number): MathBox {
  const width = widthEm * fontSize
  return { width, height: 0, depth: 0, nodes: [] }
}

function layoutText(content: string, fontSize: number, ctx: MathLayoutContext): MathBox {
  const upem = ctx.font.metrics.unitsPerEm

  let width = 0
  let height = 0
  let depth = 0
  for (let i = 0; i < content.length; i++) {
    const cp = content.codePointAt(i)!
    const gid = ctx.font.getGlyphId(cp)
    width += fuToPt(ctx.font.getAdvanceWidth(gid), fontSize, upem)
    // Compute height/depth from each glyph's actual bounds
    const glyph = ctx.font.getGlyph(gid)
    if (glyph.outline) {
      const bounds = getOutlineBounds(glyph.outline.coords, glyph.outline.commands)
      if (bounds) {
        const gh = fuToPt(bounds.yMax, fontSize, upem)
        const gd = fuToPt(-bounds.yMin, fontSize, upem)
        if (gh > height) height = gh
        if (gd > depth) depth = gd
      }
    }
    if (cp > 0xFFFF) i++ // Surrogate pair
  }
  // Fallback (when the glyph has no outline)
  if (height === 0) height = fuToPt(ctx.font.metrics.ascender, fontSize, upem)
  if (depth === 0) depth = fuToPt(-ctx.font.metrics.descender, fontSize, upem)

  const textNode: RenderText = {
    type: 'text',
    x: 0, y: textTopY(0, fontSize, ctx),
    text: content,
    fontId: ctx.fontId,
    fontSize,
    color: ctx.color,
  }

  return { width, height, depth, nodes: [textNode] }
}

// ─── Utilities ───

function emptyBox(): MathBox {
  return { width: 0, height: 0, depth: 0, nodes: [] }
}

/** Offset a node by (dx, dy) */
function offsetNode(node: RenderNode, dx: number, dy: number): RenderNode {
  if (dx === 0 && dy === 0) return node

  switch (node.type) {
    case 'text':
      return { ...node, x: node.x + dx, y: node.y + dy }
    case 'line':
      return { ...node, x1: node.x1 + dx, y1: node.y1 + dy, x2: node.x2 + dx, y2: node.y2 + dy }
    case 'rect':
      return { ...node, x: node.x + dx, y: node.y + dy }
    case 'group':
      return { ...node, x: node.x + dx, y: node.y + dy }
    case 'ellipse':
      return { ...node, cx: node.cx + dx, cy: node.cy + dy }
    case 'image':
      return { ...node, x: node.x + dx, y: node.y + dy }
    case 'path':
      // All path coordinates would need offsetting → wrap in a group
      return {
        type: 'group',
        x: dx, y: dy,
        width: 0, height: 0,
        children: [node],
      }
    default:
      return node
  }
}

/**
 * Full TeX spacing matrix (The TeXbook, Appendix G)
 *
 * Rows: preceding atom (ord, op, bin, rel, open, close, punct, inner)
 * Columns: following atom (same order)
 * Values: 0=none, 1=thin, 2=med(*), 3=thick(*)
 * (*) med/thick become 0 in script/scriptscript styles
 */
//                     ord op  bin rel opn cls pnc inn
const SPACING_TABLE = [
  /* ord   */         [ 0,  1,  2,  3,  0,  0,  0,  1 ],
  /* op    */         [ 1,  1,  0,  3,  0,  0,  0,  1 ],
  /* bin   */         [ 2,  2,  0,  0,  2,  0,  0,  2 ],
  /* rel   */         [ 3,  3,  0,  0,  3,  0,  0,  3 ],
  /* open  */         [ 0,  0,  0,  0,  0,  0,  0,  0 ],
  /* close */         [ 0,  1,  2,  3,  0,  0,  0,  1 ],
  /* punct */         [ 1,  1,  0,  1,  1,  1,  1,  1 ],
  /* inner */         [ 1,  1,  2,  3,  1,  0,  1,  1 ],
]

const ATOM_INDEX: Record<string, number> = {
  ord: 0, op: 1, bin: 2, rel: 3, open: 4, close: 5, punct: 6, inner: 7,
}

/** Inter-atom spacing (full TeX matrix) */
function getInterAtomSpace(prev: MathNode, cur: MathNode, ctx: MathLayoutContext, style: MathStyle): number {
  const scale = getStyleScale(style, ctx)
  const fontSize = ctx.baseFontSize * scale

  const pi = ATOM_INDEX[getAtomType(prev)]
  const ci = ATOM_INDEX[getAtomType(cur)]
  if (pi === undefined || ci === undefined) return 0

  const code = SPACING_TABLE[pi]![ci]!
  if (code === 0) return 0

  // med and thick are omitted in script/scriptscript (TeX spec)
  if (code >= 2 && style >= 2) return 0

  const thin = fontSize * 3 / 18    // \,
  if (code === 1) return thin
  if (code === 2) return fontSize * 4 / 18  // \: (med)
  return fontSize * 5 / 18  // \; (thick)
}

function getAtomType(node: MathNode): string {
  switch (node.type) {
    case 'glyph': return node.atomType
    case 'frac': return 'ord'
    case 'script': return getAtomType(node.base)
    case 'radical': return 'ord'
    case 'operator': return 'op'
    case 'delimited': return 'inner'
    case 'accent': return 'ord'
    case 'text': return 'ord'
    case 'space': return 'ord'
    case 'row':
      if (node.children.length > 0) return getAtomType(node.children[node.children.length - 1]!)
      return 'ord'
    case 'matrix': return 'ord'
    default: return 'ord'
  }
}

/** Get the bounding box of a glyph outline */
function getOutlineBounds(
  coords: Float32Array,
  commands: Uint8Array,
): { xMin: number, yMin: number, xMax: number, yMax: number } | null {
  if (coords.length < 2) return null

  let xMin = Infinity, yMin = Infinity
  let xMax = -Infinity, yMax = -Infinity
  let ci = 0

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    let numCoords: number
    switch (cmd) {
      case 0: numCoords = 2; break // MoveTo
      case 1: numCoords = 2; break // LineTo
      case 2: numCoords = 6; break // CubicTo
      case 3: numCoords = 0; break // Close
      default: numCoords = 0
    }
    for (let j = 0; j < numCoords; j += 2) {
      const x = coords[ci + j]!
      const y = coords[ci + j + 1]!
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
    ci += numCoords
  }

  if (xMin === Infinity) return null
  return { xMin, yMin, xMax, yMax }
}

// ─── High-level API ───

/**
 * Lay out a LaTeX math string into render nodes
 *
 * @param formula LaTeX math string
 * @param font Math font
 * @param fontId Font ID
 * @param fontSize Font size (pt)
 * @param color Text color
 * @returns Laid-out box
 */
export function layoutMathFormula(
  ast: MathNode,
  font: Font,
  fontId: string,
  fontSize: number,
  color: string,
  devicePpem?: number,
): MathBox {
  const math = font.math
  if (!math) {
    // No MATH table: fall back to text
    return layoutText(String(ast), fontSize, {
      font, math: null!, fontId, baseFontSize: fontSize, color,
    })
  }

  const mathValueContext: MathValueContext = {
    ppem: devicePpem,
    unitsPerEm: font.metrics.unitsPerEm,
    normalizedCoords: font.getNormalizedVariationCoordinates() ?? undefined,
    gdef: font.gdef,
  }
  const ctx: MathLayoutContext = {
    font, math, fontId, baseFontSize: fontSize, color, devicePpem, mathValueContext,
  }

  return layoutMath(ast, ctx, 0 as MathStyle)
}
