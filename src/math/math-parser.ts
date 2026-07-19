/**
 * LaTeX subset parser
 *
 * Converts a LaTeX math string into a MathNode AST.
 * Performance-focused: no closures, hand-written recursive descent parser.
 */

import {
  type MathNode, type AtomType, type MatrixDelimiters,
  mkGlyph, mkRow, mkFrac, mkScript, mkRadical,
  mkOperator, mkDelimited, mkAccent, mkMatrix, mkSpace, mkText,
} from './math-ast.js'

// ─── Command → code point mappings ───

/** Greek lowercase letters */
const GREEK_LOWER: ReadonlyMap<string, number> = new Map([
  ['alpha', 0x03B1], ['beta', 0x03B2], ['gamma', 0x03B3], ['delta', 0x03B4],
  ['epsilon', 0x03F5], ['varepsilon', 0x03B5], ['zeta', 0x03B6], ['eta', 0x03B7],
  ['theta', 0x03B8], ['vartheta', 0x03D1], ['iota', 0x03B9], ['kappa', 0x03BA],
  ['lambda', 0x03BB], ['mu', 0x03BC], ['nu', 0x03BD], ['xi', 0x03BE],
  ['pi', 0x03C0], ['varpi', 0x03D6], ['rho', 0x03C1], ['varrho', 0x03F1],
  ['sigma', 0x03C3], ['varsigma', 0x03C2], ['tau', 0x03C4], ['upsilon', 0x03C5],
  ['phi', 0x03D5], ['varphi', 0x03C6], ['chi', 0x03C7], ['psi', 0x03C8],
  ['omega', 0x03C9],
])

/** Greek uppercase letters */
const GREEK_UPPER: ReadonlyMap<string, number> = new Map([
  ['Gamma', 0x0393], ['Delta', 0x0394], ['Theta', 0x0398], ['Lambda', 0x039B],
  ['Xi', 0x039E], ['Pi', 0x03A0], ['Sigma', 0x03A3], ['Upsilon', 0x03A5],
  ['Phi', 0x03A6], ['Psi', 0x03A8], ['Omega', 0x03A9],
])

/** Binary operators */
const BINARY_OPS: ReadonlyMap<string, number> = new Map([
  ['times', 0x00D7], ['cdot', 0x22C5], ['pm', 0x00B1], ['mp', 0x2213],
  ['div', 0x00F7], ['ast', 0x2217], ['star', 0x22C6], ['circ', 0x2218],
  ['bullet', 0x2219], ['cap', 0x2229], ['cup', 0x222A], ['wedge', 0x2227],
  ['vee', 0x2228], ['oplus', 0x2295], ['otimes', 0x2297],
])

/** Relation operators */
const RELATION_OPS: ReadonlyMap<string, number> = new Map([
  ['leq', 0x2264], ['le', 0x2264], ['geq', 0x2265], ['ge', 0x2265],
  ['neq', 0x2260], ['ne', 0x2260], ['approx', 0x2248], ['equiv', 0x2261],
  ['sim', 0x223C], ['simeq', 0x2243], ['cong', 0x2245], ['propto', 0x221D],
  ['in', 0x2208], ['notin', 0x2209], ['ni', 0x220B], ['subset', 0x2282],
  ['supset', 0x2283], ['subseteq', 0x2286], ['supseteq', 0x2287],
  ['ll', 0x226A], ['gg', 0x226B], ['prec', 0x227A], ['succ', 0x227B],
  ['preceq', 0x2AAF], ['succeq', 0x2AB0], ['parallel', 0x2225],
  ['perp', 0x22A5], ['mid', 0x2223],
])

/** Large operators */
const LARGE_OPS: ReadonlyMap<string, number> = new Map([
  ['sum', 0x2211], ['prod', 0x220F], ['coprod', 0x2210],
  ['int', 0x222B], ['iint', 0x222C], ['iiint', 0x222D], ['oint', 0x222E],
  ['bigcup', 0x22C3], ['bigcap', 0x22C2], ['bigvee', 0x22C1], ['bigwedge', 0x22C0],
  ['bigoplus', 0x2A01], ['bigotimes', 0x2A02],
])

/** Operators whose limits are placed above/below by default */
const DEFAULT_LIMITS: ReadonlySet<string> = new Set([
  'sum', 'prod', 'coprod', 'bigcup', 'bigcap', 'bigvee', 'bigwedge',
  'bigoplus', 'bigotimes', 'lim', 'sup', 'inf', 'max', 'min',
  'limsup', 'liminf',
])

/** Function names (\sin, \cos, etc.) */
const MATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth',
  'log', 'ln', 'exp', 'det', 'dim', 'ker', 'hom',
  'deg', 'arg', 'gcd', 'mod',
  'lim', 'sup', 'inf', 'max', 'min', 'limsup', 'liminf',
])

/** Accent commands */
const ACCENT_MAP: ReadonlyMap<string, number> = new Map([
  ['hat', 0x0302], ['widehat', 0x0302],
  ['tilde', 0x0303], ['widetilde', 0x0303],
  ['bar', 0x0304], ['overline', 0x0305],
  ['vec', 0x20D7],
  ['dot', 0x0307], ['ddot', 0x0308],
  ['acute', 0x0301], ['grave', 0x0300],
  ['breve', 0x0306], ['check', 0x030C],
  ['overbrace', 0x23DE], ['underbrace', 0x23DF],
])

/** Other symbols */
const SYMBOLS: ReadonlyMap<string, number> = new Map([
  ['infty', 0x221E], ['partial', 0x2202], ['nabla', 0x2207],
  ['forall', 0x2200], ['exists', 0x2203], ['nexists', 0x2204],
  ['emptyset', 0x2205], ['varnothing', 0x2205],
  ['ell', 0x2113], ['wp', 0x2118], ['Re', 0x211C], ['Im', 0x2111],
  ['aleph', 0x2135], ['hbar', 0x210F],
  ['imath', 0x0131], ['jmath', 0x0237],
  ['cdots', 0x22EF], ['ldots', 0x2026], ['vdots', 0x22EE], ['ddots', 0x22F1],
  ['to', 0x2192], ['rightarrow', 0x2192], ['leftarrow', 0x2190],
  ['Rightarrow', 0x21D2], ['Leftarrow', 0x21D0],
  ['leftrightarrow', 0x2194], ['Leftrightarrow', 0x21D4],
  ['uparrow', 0x2191], ['downarrow', 0x2193],
  ['mapsto', 0x21A6], ['hookrightarrow', 0x21AA], ['hookleftarrow', 0x21A9],
  ['neg', 0x00AC], ['lnot', 0x00AC],
  ['triangle', 0x25B3], ['square', 0x25A1], ['diamond', 0x22C4],
  ['angle', 0x2220], ['measuredangle', 0x2221],
  ['prime', 0x2032],
])

/** Space commands (in em units) */
const SPACE_MAP: ReadonlyMap<string, number> = new Map([
  [',', 3 / 18],        // thin space
  [':', 4 / 18],        // medium space
  [';', 5 / 18],        // thick space
  ['!', -3 / 18],       // negative thin space
  ['quad', 1],           // 1em
  ['qquad', 2],          // 2em
  ['enspace', 0.5],      // 0.5em
])

/** Delimiter command → code point */
const DELIMITER_MAP: ReadonlyMap<string, number> = new Map([
  ['(', 0x0028], [')', 0x0029],
  ['[', 0x005B], [']', 0x005D],
  ['\\{', 0x007B], ['\\}', 0x007D],
  ['lbrace', 0x007B], ['rbrace', 0x007D],
  ['langle', 0x27E8], ['rangle', 0x27E9],
  ['lfloor', 0x230A], ['rfloor', 0x230B],
  ['lceil', 0x2308], ['rceil', 0x2309],
  ['|', 0x007C], ['\\|', 0x2016],
  ['lvert', 0x007C], ['rvert', 0x007C],
  ['lVert', 0x2016], ['rVert', 0x2016],
  ['.', 0], // invisible delimiter
])

/** Matrix delimiter → open/close code points */
const MATRIX_DELIMITERS: ReadonlyMap<string, [number, number]> = new Map([
  ['pmatrix', [0x0028, 0x0029]],  // ( )
  ['bmatrix', [0x005B, 0x005D]],  // [ ]
  ['Bmatrix', [0x007B, 0x007D]],  // { }
  ['vmatrix', [0x007C, 0x007C]],  // | |
  ['Vmatrix', [0x2016, 0x2016]],  // ‖ ‖
  ['matrix', [0, 0]],             // none
  ['cases', [0x007B, 0]],         // { only
])

// ─── Parser ───

/**
 * Parse a LaTeX math string into a MathNode AST
 */
export function parseMathLaTeX(input: string): MathNode {
  const state: ParseState = { input, pos: 0 }
  const result = parseExpressionList(state)
  return result
}

interface ParseState {
  readonly input: string
  pos: number
}

function parseExpressionList(state: ParseState): MathNode {
  const children: MathNode[] = []
  while (state.pos < state.input.length) {
    skipSpaces(state)
    if (state.pos >= state.input.length) break

    const ch = state.input.charCodeAt(state.pos)

    // End of group or end of special context
    if (ch === 0x7D /* } */ || ch === 0x26 /* & */) break

    // Stop without consuming \right, \\, \end (handled by the parent parser)
    if (ch === 0x5C /* \ */ && peekStopCommand(state)) break

    // ^, _ are not handled at this level (they modify the preceding atom),
    // but if there is no preceding element, create an empty base
    if (ch === 0x5E /* ^ */ || ch === 0x5F /* _ */) {
      if (children.length === 0) {
        children.push(mkRow([]))
      }
      const base = children.pop()!
      children.push(parseScripts(state, base))
      continue
    }

    let node = parseAtom(state)
    if (node === null) break

    // \limits / \nolimits modifiers: override the limits flag of the operator node
    if (node.type === 'operator') {
      skipSpaces(state)
      if (state.pos < state.input.length && state.input.charCodeAt(state.pos) === 0x5C /* \ */) {
        const saved = state.pos
        state.pos++
        const nameStart = state.pos
        while (state.pos < state.input.length && isAlpha(state.input.charCodeAt(state.pos))) state.pos++
        const modName = state.input.slice(nameStart, state.pos)
        if (modName === 'limits') {
          node = mkOperator(node.codePoint, node.above, node.below, node.largeop, true)
        } else if (modName === 'nolimits') {
          node = mkOperator(node.codePoint, node.above, node.below, node.largeop, false)
        } else {
          state.pos = saved
        }
      }
    }

    // Check whether ^ or _ follows the atom
    skipSpaces(state)
    if (state.pos < state.input.length) {
      const next = state.input.charCodeAt(state.pos)
      if (next === 0x5E /* ^ */ || next === 0x5F /* _ */) {
        children.push(parseScripts(state, node))
        continue
      }
    }

    children.push(node)
  }
  return mkRow(children)
}

/** Look ahead for \right, \\, \end to decide whether to stop (does not change the position) */
function peekStopCommand(state: ParseState): boolean {
  const pos = state.pos
  if (pos + 1 >= state.input.length) return false
  const next = state.input.charCodeAt(pos + 1)

  // \\ (row separator)
  if (next === 0x5C) return true

  // Check for \right, \end
  if (!isAlpha(next)) return false
  let end = pos + 2
  while (end < state.input.length && isAlpha(state.input.charCodeAt(end))) end++
  const name = state.input.slice(pos + 1, end)
  return name === 'right' || name === 'end'
}

function parseAtom(state: ParseState): MathNode | null {
  skipSpaces(state)
  if (state.pos >= state.input.length) return null

  const ch = state.input.charCodeAt(state.pos)

  // { ... } group
  if (ch === 0x7B /* { */) {
    return parseGroup(state)
  }

  // \command
  if (ch === 0x5C /* \ */) {
    return parseCommand(state)
  }

  // Digits 0-9
  if (ch >= 0x30 && ch <= 0x39) {
    state.pos++
    return mkGlyph(ch, 'ord')
  }

  // Lowercase letters a-z
  if (ch >= 0x61 && ch <= 0x7A) {
    state.pos++
    return mkGlyph(ch, 'ord')
  }

  // Uppercase letters A-Z
  if (ch >= 0x41 && ch <= 0x5A) {
    state.pos++
    return mkGlyph(ch, 'ord')
  }

  // Operators and punctuation
  state.pos++
  switch (ch) {
    case 0x2B: return mkGlyph(0x2B, 'bin')     // +
    case 0x2D: return mkGlyph(0x2212, 'bin')    // - → minus sign
    case 0x2A: return mkGlyph(0x2217, 'bin')    // * → ∗
    case 0x2F: return mkGlyph(0x2F, 'bin')      // /
    case 0x3D: return mkGlyph(0x3D, 'rel')      // =
    case 0x3C: return mkGlyph(0x3C, 'rel')      // <
    case 0x3E: return mkGlyph(0x3E, 'rel')      // >
    case 0x21: return mkGlyph(0x21, 'ord')      // !
    case 0x27: return mkGlyph(0x2032, 'ord')    // ' → prime
    case 0x28: return mkGlyph(0x28, 'open')     // (
    case 0x29: return mkGlyph(0x29, 'close')    // )
    case 0x5B: return mkGlyph(0x5B, 'open')     // [
    case 0x5D: return mkGlyph(0x5D, 'close')    // ]
    case 0x2C: return mkGlyph(0x2C, 'punct')    // ,
    case 0x2E: return mkGlyph(0x2E, 'ord')      // .
    case 0x3A: return mkGlyph(0x3A, 'rel')      // :
    case 0x7C: return mkGlyph(0x7C, 'ord')      // |
    // Large operator Unicode characters → operator node
    case 0x2211: return mkOperator(0x2211, null, null, true, true)    // ∑
    case 0x220F: return mkOperator(0x220F, null, null, true, true)    // ∏
    case 0x2210: return mkOperator(0x2210, null, null, true, true)    // ∐
    case 0x222B: return mkOperator(0x222B, null, null, true, false)   // ∫
    case 0x222C: return mkOperator(0x222C, null, null, true, false)   // ∬
    case 0x222D: return mkOperator(0x222D, null, null, true, false)   // ∭
    case 0x222E: return mkOperator(0x222E, null, null, true, false)   // ∮
    case 0x22C3: return mkOperator(0x22C3, null, null, true, true)    // ⋃
    case 0x22C2: return mkOperator(0x22C2, null, null, true, true)    // ⋂
    case 0x22C1: return mkOperator(0x22C1, null, null, true, true)    // ⋁
    case 0x22C0: return mkOperator(0x22C0, null, null, true, true)    // ⋀
    // Relation operators
    case 0x2264: return mkGlyph(0x2264, 'rel')   // ≤
    case 0x2265: return mkGlyph(0x2265, 'rel')   // ≥
    case 0x2260: return mkGlyph(0x2260, 'rel')   // ≠
    case 0x2248: return mkGlyph(0x2248, 'rel')   // ≈
    case 0x2261: return mkGlyph(0x2261, 'rel')   // ≡
    case 0x2282: return mkGlyph(0x2282, 'rel')   // ⊂
    case 0x2283: return mkGlyph(0x2283, 'rel')   // ⊃
    case 0x2286: return mkGlyph(0x2286, 'rel')   // ⊆
    case 0x2287: return mkGlyph(0x2287, 'rel')   // ⊇
    case 0x2208: return mkGlyph(0x2208, 'rel')   // ∈
    case 0x2209: return mkGlyph(0x2209, 'rel')   // ∉
    // Binary operators
    case 0x00B1: return mkGlyph(0x00B1, 'bin')   // ±
    case 0x2213: return mkGlyph(0x2213, 'bin')   // ∓
    case 0x00D7: return mkGlyph(0x00D7, 'bin')   // ×
    case 0x00F7: return mkGlyph(0x00F7, 'bin')   // ÷
    case 0x2229: return mkGlyph(0x2229, 'bin')   // ∩
    case 0x222A: return mkGlyph(0x222A, 'bin')   // ∪
    // Opening/closing brackets
    case 0x7B: return mkGlyph(0x7B, 'open')      // {
    case 0x7D: return mkGlyph(0x7D, 'close')     // }
    case 0x2308: return mkGlyph(0x2308, 'open')   // ⌈
    case 0x2309: return mkGlyph(0x2309, 'close')  // ⌉
    case 0x230A: return mkGlyph(0x230A, 'open')   // ⌊
    case 0x230B: return mkGlyph(0x230B, 'close')  // ⌋
    default:
      // Treat other Unicode characters as ord as-is
      return mkGlyph(ch, 'ord')
  }
}

function parseGroup(state: ParseState): MathNode {
  // Consume {
  state.pos++
  const result = parseExpressionList(state)
  // Consume }
  if (state.pos < state.input.length && state.input.charCodeAt(state.pos) === 0x7D) {
    state.pos++
  }
  return result
}

function parseRequiredGroup(state: ParseState): MathNode {
  skipSpaces(state)
  if (state.pos < state.input.length && state.input.charCodeAt(state.pos) === 0x7B) {
    return parseGroup(state)
  }
  // Single token
  return parseAtom(state) ?? mkRow([])
}

function parseOptionalBracket(state: ParseState): MathNode | null {
  skipSpaces(state)
  if (state.pos >= state.input.length) return null
  if (state.input.charCodeAt(state.pos) !== 0x5B /* [ */) return null

  state.pos++ // Consume [
  const children: MathNode[] = []
  while (state.pos < state.input.length) {
    if (state.input.charCodeAt(state.pos) === 0x5D /* ] */) {
      state.pos++
      break
    }
    const node = parseAtom(state)
    if (node === null) break
    children.push(node)
  }
  return mkRow(children)
}

function parseScripts(state: ParseState, base: MathNode): MathNode {
  let sup: MathNode | null = null
  let sub: MathNode | null = null

  // Handle multiple ^ _
  while (state.pos < state.input.length) {
    skipSpaces(state)
    if (state.pos >= state.input.length) break
    const ch = state.input.charCodeAt(state.pos)

    if (ch === 0x5E /* ^ */ && sup === null) {
      state.pos++
      sup = parseRequiredGroup(state)
    } else if (ch === 0x5F /* _ */ && sub === null) {
      state.pos++
      sub = parseRequiredGroup(state)
    } else {
      break
    }
  }

  // If base is a MathOperator with largeop, treat as limits syntax
  if (base.type === 'operator' && base.largeop) {
    return mkOperator(base.codePoint, sup, sub, base.largeop, base.limits)
  }

  return mkScript(base, sup, sub)
}

function parseCommand(state: ParseState): MathNode | null {
  // Consume \
  state.pos++
  if (state.pos >= state.input.length) return null

  const ch = state.input.charCodeAt(state.pos)

  // Single-character commands: \, \: \; \! \  \{ \} \| \\
  if (!isAlpha(ch)) {
    state.pos++
    const char = state.input[state.pos - 1]!

    // Space commands
    const spaceWidth = SPACE_MAP.get(char)
    if (spaceWidth !== undefined) {
      return mkSpace(spaceWidth)
    }

    // \\ (line break — used as a matrix row separator etc.; ignored here)
    if (char === '\\') return null

    // \{ \}
    if (char === '{') return mkGlyph(0x007B, 'open')
    if (char === '}') return mkGlyph(0x007D, 'close')
    if (char === '|') return mkGlyph(0x2016, 'ord')

    // \  (backslash space) = space
    if (char === ' ') return mkSpace(1 / 4)

    return null
  }

  // Read a multi-character command name
  const nameStart = state.pos
  while (state.pos < state.input.length && isAlpha(state.input.charCodeAt(state.pos))) {
    state.pos++
  }
  const name = state.input.slice(nameStart, state.pos)

  // frac
  if (name === 'frac') {
    const num = parseRequiredGroup(state)
    const den = parseRequiredGroup(state)
    return mkFrac(num, den)
  }

  if (name === 'sfrac') {
    return mkFrac(parseRequiredGroup(state), parseRequiredGroup(state), null, 'skewed')
  }

  if (name === 'binom') {
    const stack = mkFrac(parseRequiredGroup(state), parseRequiredGroup(state), null, 'stack')
    return mkDelimited(0x28, 0x29, stack)
  }

  if (name === 'stackrel') {
    return mkFrac(parseRequiredGroup(state), parseRequiredGroup(state), null, 'stack')
  }

  // dfrac (display style fraction)
  if (name === 'dfrac') {
    const num = parseRequiredGroup(state)
    const den = parseRequiredGroup(state)
    return mkFrac(num, den)
  }

  // tfrac (text style fraction)
  if (name === 'tfrac') {
    const num = parseRequiredGroup(state)
    const den = parseRequiredGroup(state)
    return mkFrac(num, den)
  }

  // sqrt
  if (name === 'sqrt') {
    const degree = parseOptionalBracket(state)
    const radicand = parseRequiredGroup(state)
    return mkRadical(radicand, degree)
  }

  // left ... right
  if (name === 'left') {
    return parseDelimited(state)
  }

  // right is handled inside left; reaching here is an error
  if (name === 'right') {
    return null
  }

  // text
  if (name === 'text' || name === 'textrm' || name === 'textit' || name === 'textbf' || name === 'mathrm' || name === 'mathit' || name === 'mathbf') {
    skipSpaces(state)
    if (state.pos < state.input.length && state.input.charCodeAt(state.pos) === 0x7B) {
      state.pos++
      const start = state.pos
      let depth = 1
      while (state.pos < state.input.length && depth > 0) {
        const c = state.input.charCodeAt(state.pos)
        if (c === 0x7B) depth++
        else if (c === 0x7D) depth--
        if (depth > 0) state.pos++
      }
      const content = state.input.slice(start, state.pos)
      if (state.pos < state.input.length) state.pos++ // Consume }
      return mkText(content)
    }
    return mkText('')
  }

  // begin ... end (matrix)
  if (name === 'begin') {
    return parseEnvironment(state)
  }

  // end is handled inside begin
  if (name === 'end') {
    return null
  }

  // Large operators
  const largeOpCp = LARGE_OPS.get(name)
  if (largeOpCp !== undefined) {
    const limits = DEFAULT_LIMITS.has(name)
    return mkOperator(largeOpCp, null, null, true, limits)
  }

  // Function names (\sin, \cos, \lim, etc.)
  if (MATH_FUNCTIONS.has(name)) {
    const limits = DEFAULT_LIMITS.has(name)
    if (limits) {
      // lim family: treat as a large operator (limits placed above/below)
      // Rendered as text but represented as an operator node
      // Use a text node instead
      return mkOperator(0, null, null, false, true)
    }
    // Regular function name: render in text mode
    return mkText(name)
  }

  // Accents
  const accentCp = ACCENT_MAP.get(name)
  if (accentCp !== undefined) {
    const base = parseRequiredGroup(state)
    const position: 'over' | 'under' = name === 'underbrace' || name === 'underline' ? 'under' : 'over'
    return mkAccent(base, accentCp, position)
  }

  // overline / underline
  if (name === 'overline') {
    const base = parseRequiredGroup(state)
    return mkAccent(base, 0x0305, 'over')
  }
  if (name === 'underline') {
    const base = parseRequiredGroup(state)
    return mkAccent(base, 0x0332, 'under')
  }

  // Greek lowercase letters
  const greekLower = GREEK_LOWER.get(name)
  if (greekLower !== undefined) return mkGlyph(greekLower, 'ord')

  // Greek uppercase letters
  const greekUpper = GREEK_UPPER.get(name)
  if (greekUpper !== undefined) return mkGlyph(greekUpper, 'ord')

  // Binary operators
  const binOp = BINARY_OPS.get(name)
  if (binOp !== undefined) return mkGlyph(binOp, 'bin')

  // Relation operators
  const relOp = RELATION_OPS.get(name)
  if (relOp !== undefined) return mkGlyph(relOp, 'rel')

  // Other symbols
  const sym = SYMBOLS.get(name)
  if (sym !== undefined) {
    // Arrows are rel
    if (name.includes('arrow') || name === 'to' || name === 'mapsto') {
      return mkGlyph(sym, 'rel')
    }
    return mkGlyph(sym, 'ord')
  }

  // Space commands (named)
  const spWidth = SPACE_MAP.get(name)
  if (spWidth !== undefined) return mkSpace(spWidth)

  // Unknown command: render as text
  return mkText('\\' + name)
}

function parseDelimited(state: ParseState): MathNode {
  skipSpaces(state)
  const openCp = parseDelimiterChar(state)
  const body = parseExpressionList(state)

  // Look for \right
  let closeCp = 0
  skipSpaces(state)
  if (state.pos < state.input.length && state.input.charCodeAt(state.pos) === 0x5C /* \ */) {
    const saved = state.pos
    state.pos++
    if (state.pos < state.input.length) {
      const nameStart = state.pos
      while (state.pos < state.input.length && isAlpha(state.input.charCodeAt(state.pos))) {
        state.pos++
      }
      const name = state.input.slice(nameStart, state.pos)
      if (name === 'right') {
        skipSpaces(state)
        closeCp = parseDelimiterChar(state)
      } else {
        state.pos = saved
      }
    }
  }

  return mkDelimited(openCp, closeCp, body)
}

function parseDelimiterChar(state: ParseState): number {
  if (state.pos >= state.input.length) return 0

  const ch = state.input.charCodeAt(state.pos)

  // . (invisible)
  if (ch === 0x2E) {
    state.pos++
    return 0
  }

  // \ + command
  if (ch === 0x5C) {
    const saved = state.pos
    state.pos++
    if (state.pos < state.input.length) {
      const next = state.input.charCodeAt(state.pos)
      // \{ \} \|
      if (next === 0x7B) { state.pos++; return 0x007B }
      if (next === 0x7D) { state.pos++; return 0x007D }
      if (next === 0x7C) { state.pos++; return 0x2016 }

      // \langle, \rangle, etc.
      const nameStart = state.pos
      while (state.pos < state.input.length && isAlpha(state.input.charCodeAt(state.pos))) {
        state.pos++
      }
      const name = state.input.slice(nameStart, state.pos)
      const cp = DELIMITER_MAP.get(name)
      if (cp !== undefined) return cp

      state.pos = saved
    }
  }

  // Literal character
  const directCp = DELIMITER_MAP.get(state.input[state.pos]!)
  if (directCp !== undefined) {
    state.pos++
    return directCp
  }

  // Use the ASCII character as-is
  state.pos++
  return ch
}

function parseEnvironment(state: ParseState): MathNode {
  skipSpaces(state)
  // Read {envName}
  const envName = parseBracedText(state)

  switch (envName) {
    case 'pmatrix': case 'bmatrix': case 'Bmatrix':
    case 'vmatrix': case 'Vmatrix': case 'matrix':
    case 'cases':
      return parseMatrixEnv(state, envName as MatrixDelimiters)
    case 'array':
      return parseArrayEnv(state)
    default:
      // Unknown environment: skip to \end{...} and return as text
      skipToEnd(state, envName)
      return mkText('[' + envName + ']')
  }
}

function parseMatrixEnv(state: ParseState, envName: MatrixDelimiters): MathNode {
  const rows: MathNode[][] = []
  let currentRow: MathNode[] = []

  while (state.pos < state.input.length) {
    skipSpaces(state)
    if (state.pos >= state.input.length) break

    // Check for \end{...}
    if (isEndEnv(state, envName)) break

    // \\ row separator
    if (state.input.charCodeAt(state.pos) === 0x5C &&
        state.pos + 1 < state.input.length &&
        state.input.charCodeAt(state.pos + 1) === 0x5C) {
      state.pos += 2
      rows.push(currentRow)
      currentRow = []
      // optional [spacing] after \\ e.g. \\[6pt]
      parseOptionalBracket(state)
      continue
    }

    // & column separator
    if (state.input.charCodeAt(state.pos) === 0x26 /* & */) {
      state.pos++
      currentRow.push(parseExpressionList(state))
      continue
    }

    // Parse cell content (until &, \\, or \end)
    const before = state.pos
    const cell = parseExpressionList(state)
    // A malformed/unterminated environment (e.g. "\begin{pmatrix}}") leaves an
    // unconsumable char such as '}' here: parseExpressionList returns without
    // advancing. Stop instead of spinning forever.
    if (state.pos === before) break
    if (cell.type === 'row' && (cell as any).children.length === 0) {
      // Empty cell — e.g. right before \\
    } else {
      currentRow.push(cell)
    }
  }

  // Last row
  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  // Normalize the column count
  let maxCols = 0
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.length > maxCols) maxCols = rows[i]!.length
  }

  // cases is left-aligned
  const colAlign: ('l' | 'c' | 'r')[] = []
  if (envName === 'cases') {
    for (let i = 0; i < maxCols; i++) colAlign.push('l')
  } else {
    for (let i = 0; i < maxCols; i++) colAlign.push('c')
  }

  return mkMatrix(rows, envName, colAlign)
}

function parseArrayEnv(state: ParseState): MathNode {
  // Read a column spec like {lccr}
  skipSpaces(state)
  const alignStr = parseBracedText(state)
  const colAlign: ('l' | 'c' | 'r')[] = []
  for (let i = 0; i < alignStr.length; i++) {
    const a = alignStr[i]
    if (a === 'l' || a === 'c' || a === 'r') colAlign.push(a)
    // | is a column separator (ignored for now)
  }

  // Same matrix parsing as the matrix environment
  const rows: MathNode[][] = []
  let currentRow: MathNode[] = []

  while (state.pos < state.input.length) {
    skipSpaces(state)
    if (state.pos >= state.input.length) break
    if (isEndEnv(state, 'array')) break

    if (state.input.charCodeAt(state.pos) === 0x5C &&
        state.pos + 1 < state.input.length &&
        state.input.charCodeAt(state.pos + 1) === 0x5C) {
      state.pos += 2
      rows.push(currentRow)
      currentRow = []
      parseOptionalBracket(state)
      continue
    }

    if (state.input.charCodeAt(state.pos) === 0x26) {
      state.pos++
      currentRow.push(parseExpressionList(state))
      continue
    }

    const before = state.pos
    const cell = parseExpressionList(state)
    // Stop on a non-advancing parse (unconsumable char such as '}') so a
    // malformed array environment cannot spin forever.
    if (state.pos === before) break
    if (cell.type === 'row' && (cell as any).children.length === 0) {
      // empty
    } else {
      currentRow.push(cell)
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  return mkMatrix(rows, 'matrix', colAlign)
}

function parseBracedText(state: ParseState): string {
  skipSpaces(state)
  if (state.pos >= state.input.length || state.input.charCodeAt(state.pos) !== 0x7B) return ''
  state.pos++
  const start = state.pos
  let depth = 1
  while (state.pos < state.input.length && depth > 0) {
    const c = state.input.charCodeAt(state.pos)
    if (c === 0x7B) depth++
    else if (c === 0x7D) depth--
    if (depth > 0) state.pos++
  }
  const text = state.input.slice(start, state.pos)
  if (state.pos < state.input.length) state.pos++ // }
  return text
}

function isEndEnv(state: ParseState, envName: string): boolean {
  const remaining = state.input.length - state.pos
  const target = '\\end{' + envName + '}'
  if (remaining < target.length) return false

  for (let i = 0; i < target.length; i++) {
    if (state.input.charCodeAt(state.pos + i) !== target.charCodeAt(i)) return false
  }
  state.pos += target.length
  return true
}

function skipToEnd(state: ParseState, envName: string): void {
  const target = '\\end{' + envName + '}'
  const idx = state.input.indexOf(target, state.pos)
  if (idx >= 0) {
    state.pos = idx + target.length
  } else {
    state.pos = state.input.length
  }
}

function skipSpaces(state: ParseState): void {
  while (state.pos < state.input.length && state.input.charCodeAt(state.pos) === 0x20) {
    state.pos++
  }
}

function isAlpha(ch: number): boolean {
  return (ch >= 0x41 && ch <= 0x5A) || (ch >= 0x61 && ch <= 0x7A)
}
