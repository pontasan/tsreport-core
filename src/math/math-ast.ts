/**
 * Math AST (Abstract Syntax Tree)
 *
 * Intermediate representation produced by the LaTeX parser and consumed by the math layout engine.
 * Represents the TeX math structure as a tree.
 */

/** Math style (display/text/script/scriptscript) */
export const enum MathStyle {
  Display = 0,
  Text = 1,
  Script = 2,
  ScriptScript = 3,
  DisplayCramped = 4,
  TextCramped = 5,
  ScriptCramped = 6,
  ScriptScriptCramped = 7,
}

/** Union type of math nodes */
export type MathNode =
  | MathGlyph
  | MathRow
  | MathFraction
  | MathScript
  | MathRadical
  | MathOperator
  | MathDelimited
  | MathAccent
  | MathMatrix
  | MathSpace
  | MathText

/** Single character (variable, digit, operator) */
export interface MathGlyph {
  readonly type: 'glyph'
  /** Unicode code point */
  readonly codePoint: number
  /** 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' */
  readonly atomType: AtomType
}

/** Atom type — TeX atom classification */
export type AtomType = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct'

/** Horizontal list (list of child nodes) */
export interface MathRow {
  readonly type: 'row'
  readonly children: readonly MathNode[]
}

/** Fraction (numerator/denominator + fraction bar) */
export interface MathFraction {
  readonly type: 'frac'
  readonly numerator: MathNode
  readonly denominator: MathNode
  /** Fraction bar thickness (null = font default) */
  readonly ruleThickness: number | null
  /** OpenType MATH layout family used for this two-part construct. */
  readonly kind: 'fraction' | 'stack' | 'skewed'
}

/** Superscript/subscript (base + sup? + sub?) */
export interface MathScript {
  readonly type: 'script'
  readonly base: MathNode
  readonly sup: MathNode | null
  readonly sub: MathNode | null
}

/** Radical (radicand + degree?) */
export interface MathRadical {
  readonly type: 'radical'
  readonly radicand: MathNode
  /** Degree of the nth root (null = square root) */
  readonly degree: MathNode | null
}

/** Large operator (∑, ∫, ∏, etc., with limits above/below) */
export interface MathOperator {
  readonly type: 'operator'
  /** Operator code point */
  readonly codePoint: number
  /** Upper limit (e.g. ^{n}) */
  readonly above: MathNode | null
  /** Lower limit (e.g. _{i=0}) */
  readonly below: MathNode | null
  /** Render as a large operator (display style) */
  readonly largeop: boolean
  /** Whether limits are placed above/below or to the side */
  readonly limits: boolean
}

/** Stretchy brackets (left/right delimiters + body) */
export interface MathDelimited {
  readonly type: 'delimited'
  readonly open: number   // codePoint (0 = none ".")
  readonly close: number  // codePoint (0 = none ".")
  readonly body: MathNode
}

/** Accent (hat, tilde, vec, dot, etc.) */
export interface MathAccent {
  readonly type: 'accent'
  readonly base: MathNode
  /** Accent character code point */
  readonly accentCodePoint: number
  /** Whether the accent goes above or below */
  readonly position: 'over' | 'under'
}

/** Matrix (rows × columns cell array) */
export interface MathMatrix {
  readonly type: 'matrix'
  readonly cells: readonly (readonly MathNode[])[]
  /** Matrix bracket kind */
  readonly delimiters: MatrixDelimiters
  /** Column alignment */
  readonly colAlign: readonly ('l' | 'c' | 'r')[]
}

/** Matrix delimiter kind */
export type MatrixDelimiters = 'pmatrix' | 'bmatrix' | 'Bmatrix' | 'vmatrix' | 'Vmatrix' | 'matrix' | 'cases'

/** Math space (thin/med/thick/quad) */
export interface MathSpace {
  readonly type: 'space'
  /** Space width in em units */
  readonly width: number
}

/** Text mode (\text{...}) */
export interface MathText {
  readonly type: 'text'
  readonly content: string
}

// ─── Helper functions (factories) ───

export function mkGlyph(codePoint: number, atomType: AtomType): MathGlyph {
  return { type: 'glyph', codePoint, atomType }
}

export function mkRow(children: readonly MathNode[]): MathNode {
  if (children.length === 1) return children[0]!
  return { type: 'row', children }
}

export function mkFrac(
  numerator: MathNode,
  denominator: MathNode,
  ruleThickness: number | null = null,
  kind: MathFraction['kind'] = 'fraction',
): MathFraction {
  return { type: 'frac', numerator, denominator, ruleThickness, kind }
}

export function mkScript(base: MathNode, sup: MathNode | null, sub: MathNode | null): MathScript {
  return { type: 'script', base, sup, sub }
}

export function mkRadical(radicand: MathNode, degree: MathNode | null = null): MathRadical {
  return { type: 'radical', radicand, degree }
}

export function mkOperator(codePoint: number, above: MathNode | null, below: MathNode | null, largeop: boolean, limits: boolean): MathOperator {
  return { type: 'operator', codePoint, above, below, largeop, limits }
}

export function mkDelimited(open: number, close: number, body: MathNode): MathDelimited {
  return { type: 'delimited', open, close, body }
}

export function mkAccent(base: MathNode, accentCodePoint: number, position: 'over' | 'under' = 'over'): MathAccent {
  return { type: 'accent', base, accentCodePoint, position }
}

export function mkMatrix(cells: readonly (readonly MathNode[])[], delimiters: MatrixDelimiters, colAlign: readonly ('l' | 'c' | 'r')[]): MathMatrix {
  return { type: 'matrix', cells, delimiters, colAlign }
}

export function mkSpace(width: number): MathSpace {
  return { type: 'space', width }
}

export function mkText(content: string): MathText {
  return { type: 'text', content }
}
