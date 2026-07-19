export type ExpressionAstNode =
  | LiteralExpressionNode
  | IdentifierExpressionNode
  | MemberExpressionNode
  | CallExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | ConditionalExpressionNode
  | TemplateExpressionNode

export interface LiteralExpressionNode {
  type: 'literal'
  value: boolean | number | string | null | undefined
}

export interface IdentifierExpressionNode {
  type: 'identifier'
  name: string
}

export interface MemberExpressionNode {
  type: 'member'
  object: ExpressionAstNode
  property: string
}

export interface CallExpressionNode {
  type: 'call'
  callee: ExpressionAstNode
  arguments: ExpressionAstNode[]
}

export interface UnaryExpressionNode {
  type: 'unary'
  operator: '+' | '-' | '!'
  argument: ExpressionAstNode
}

export interface BinaryExpressionNode {
  type: 'binary'
  operator: '+' | '-' | '*' | '/' | '===' | '!==' | '>' | '>=' | '<' | '<=' | '&&' | '||' | '??'
  left: ExpressionAstNode
  right: ExpressionAstNode
}

export interface ConditionalExpressionNode {
  type: 'conditional'
  test: ExpressionAstNode
  consequent: ExpressionAstNode
  alternate: ExpressionAstNode
}

export interface TemplateExpressionNode {
  type: 'template'
  parts: TemplateExpressionPart[]
}

export type TemplateExpressionPart = TemplateTextPart | TemplateValuePart

export interface TemplateTextPart {
  type: 'text'
  value: string
}

export interface TemplateValuePart {
  type: 'expression'
  expression: ExpressionAstNode
}

export interface ParsedExpression {
  source: string
  ast: ExpressionAstNode
}

export type ExpressionReferenceMap = Record<string, unknown>

export interface ExpressionEvaluationOptions {
  readonly now?: () => Date
}

export class ExpressionLanguageError extends Error {
  readonly code: 'syntax' | 'security'
  readonly position: number

  constructor(code: 'syntax' | 'security', message: string, position: number) {
    super(message)
    this.name = 'ExpressionLanguageError'
    this.code = code
    this.position = position
  }
}

const parsedExpressionCache = new Map<string, ParsedExpression>()
const FORBIDDEN_MEMBER_1 = '__proto__'
const FORBIDDEN_MEMBER_2 = 'prototype'
const FORBIDDEN_MEMBER_3 = 'constructor'

// Bounds recursive-descent nesting so a pathological expression (deeply nested
// parentheses/unary/ternary) cannot overflow the call stack. Every level of
// nesting passes through parseUnaryExpression exactly once, so the guard lives
// there. Far above any legitimate report expression.
const MAX_PARSE_DEPTH = 256
const ESCAPE_BACKSPACE = '\b'
const ESCAPE_FORM_FEED = '\f'
const ESCAPE_NEWLINE = '\n'
const ESCAPE_CARRIAGE_RETURN = '\r'
const ESCAPE_TAB = '\t'
const ESCAPE_VERTICAL_TAB = '\v'
const IDENTIFIER_START_REGEX = /[$_\p{L}]/u
const IDENTIFIER_PART_REGEX = /[$_\p{L}\p{N}]/u

export function parseExpressionSource(source: string): ParsedExpression {
  const cached = parsedExpressionCache.get(source)
  if (cached !== undefined) return cached

  const parser = new ExpressionParser(source)
  const ast = parser.parse()
  const parsed: ParsedExpression = { source, ast }
  parsedExpressionCache.set(source, parsed)
  return parsed
}

export function validateExpressionSource(source: string): ExpressionLanguageError | null {
  try {
    parseExpressionSource(source)
    return null
  } catch (error) {
    if (error instanceof ExpressionLanguageError) return error
    throw error
  }
}

export function evaluateScopedExpression(
  expression: string | ParsedExpression,
  references: ExpressionReferenceMap,
  options?: ExpressionEvaluationOptions,
): unknown {
  const parsed = typeof expression === 'string' ? parseExpressionSource(expression) : expression
  return evaluateExpressionAst(parsed.ast, references, options)
}

export function evaluateExpressionAst(
  ast: ExpressionAstNode,
  references: ExpressionReferenceMap,
  options?: ExpressionEvaluationOptions,
): unknown {
  switch (ast.type) {
    case 'literal':
      return ast.value
    case 'identifier':
      return resolveTopLevelReference(references, ast.name)
    case 'member':
      return resolveMemberReference(evaluateExpressionAst(ast.object, references, options), ast.property)
    case 'call':
      return evaluateCallExpression(ast, references, options)
    case 'unary':
      return evaluateUnaryExpression(ast, references, options)
    case 'binary':
      return evaluateBinaryExpression(ast, references, options)
    case 'conditional':
      return evaluateExpressionAst(ast.test, references, options)
        ? evaluateExpressionAst(ast.consequent, references, options)
        : evaluateExpressionAst(ast.alternate, references, options)
    case 'template':
      return evaluateTemplateExpression(ast, references, options)
  }
}

export function clearParsedExpressionCache(): void {
  parsedExpressionCache.clear()
}

function evaluateUnaryExpression(
  ast: UnaryExpressionNode,
  references: ExpressionReferenceMap,
  options?: ExpressionEvaluationOptions,
): unknown {
  const value = evaluateExpressionAst(ast.argument, references, options)
  switch (ast.operator) {
    case '+':
      return +(value as number)
    case '-':
      return -(value as number)
    case '!':
      return !value
  }
}

function evaluateBinaryExpression(
  ast: BinaryExpressionNode,
  references: ExpressionReferenceMap,
  options?: ExpressionEvaluationOptions,
): unknown {
  if (ast.operator === '&&') {
    const left = evaluateExpressionAst(ast.left, references, options)
    return left ? evaluateExpressionAst(ast.right, references, options) : left
  }
  if (ast.operator === '||') {
    const left = evaluateExpressionAst(ast.left, references, options)
    return left ? left : evaluateExpressionAst(ast.right, references, options)
  }
  if (ast.operator === '??') {
    const left = evaluateExpressionAst(ast.left, references, options)
    return left == null ? evaluateExpressionAst(ast.right, references, options) : left
  }

  const left = evaluateExpressionAst(ast.left, references, options)
  const right = evaluateExpressionAst(ast.right, references, options)

  switch (ast.operator) {
    case '+':
      return (left as never) + (right as never)
    case '-':
      return (left as never) - (right as never)
    case '*':
      return (left as never) * (right as never)
    case '/':
      return (left as never) / (right as never)
    case '===':
      return left === right
    case '!==':
      return left !== right
    case '>':
      return (left as never) > (right as never)
    case '>=':
      return (left as never) >= (right as never)
    case '<':
      return (left as never) < (right as never)
    case '<=':
      return (left as never) <= (right as never)
  }
}

function evaluateTemplateExpression(
  ast: TemplateExpressionNode,
  references: ExpressionReferenceMap,
  options?: ExpressionEvaluationOptions,
): string {
  let result = ''
  for (let i = 0; i < ast.parts.length; i++) {
    const part = ast.parts[i]!
    if (part.type === 'text') {
      result += part.value
    } else {
      result += String(evaluateExpressionAst(part.expression, references, options))
    }
  }
  return result
}

function evaluateCallExpression(
  ast: CallExpressionNode,
  references: ExpressionReferenceMap,
  options?: ExpressionEvaluationOptions,
): unknown {
  if (ast.callee.type !== 'identifier') {
    throw new ExpressionLanguageError('security', 'Only built-in function calls are allowed', 0)
  }

  const builtin = resolveBuiltinFunction(ast.callee.name, options)
  if (builtin === undefined) {
    throw new ExpressionLanguageError('security', `Unknown function "${ast.callee.name}"`, 0)
  }

  const args = new Array<unknown>(ast.arguments.length)
  for (let i = 0; i < ast.arguments.length; i++) {
    args[i] = evaluateExpressionAst(ast.arguments[i]!, references, options)
  }
  return builtin(args)
}

function resolveTopLevelReference(references: ExpressionReferenceMap, name: string): unknown {
  if (isForbiddenMemberName(name)) {
    throw new ExpressionLanguageError('security', `Forbidden reference name "${name}"`, 0)
  }
  return getOwnPropertyValue(references, name)
}

function resolveMemberReference(base: unknown, property: string): unknown {
  if (isForbiddenMemberName(property)) {
    throw new ExpressionLanguageError('security', `Forbidden property name "${property}"`, 0)
  }
  if (base === null) return null
  if (base === undefined) return undefined
  if ((typeof base !== 'object' && typeof base !== 'function') || base === null) return undefined
  return getOwnPropertyValue(base as Record<string, unknown>, property)
}

function getOwnPropertyValue(target: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined
}

function isForbiddenMemberName(name: string): boolean {
  return name === FORBIDDEN_MEMBER_1 || name === FORBIDDEN_MEMBER_2 || name === FORBIDDEN_MEMBER_3
}

type BuiltinFunction = (args: unknown[]) => unknown

function resolveBuiltinFunction(name: string, options?: ExpressionEvaluationOptions): BuiltinFunction | undefined {
  switch (name) {
    case 'format':
      return builtinFormat
    case 'round':
      return builtinRound
    case 'roundUp':
      return builtinRoundUp
    case 'roundDown':
      return builtinRoundDown
    case 'roundHalfEven':
      return builtinRoundHalfEven
    case 'ceil':
      return builtinCeil
    case 'floor':
      return builtinFloor
    case 'trunc':
      return builtinTrunc
    case 'now':
      return function (): Date {
        return options?.now ? options.now() : new Date()
      }
    default:
      return undefined
  }
}

function builtinFormat(args: unknown[]): string {
  return formatExpressionValue(args[0], args[1] == null ? '' : String(args[1]))
}

function builtinRound(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'half-up')
}

function builtinRoundUp(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'up')
}

function builtinRoundDown(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'down')
}

function builtinRoundHalfEven(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'half-even')
}

function builtinCeil(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'ceil')
}

function builtinFloor(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'floor')
}

function builtinTrunc(args: unknown[]): number {
  return roundWithMode(toNumber(args[0]), toIntegerDigits(args[1]), 'trunc')
}

function toNumber(value: unknown): number {
  return Number(value)
}

function toIntegerDigits(value: unknown): number {
  if (value == null) return 0
  return Math.trunc(Number(value))
}

type RoundMode = 'half-up' | 'half-even' | 'up' | 'down' | 'ceil' | 'floor' | 'trunc'

function roundWithMode(value: number, digits: number, mode: RoundMode): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** digits
  const scaled = value * factor
  switch (mode) {
    case 'half-up':
      return Math.round(scaled) / factor
    case 'half-even':
      return roundHalfEvenValue(scaled) / factor
    case 'up':
      return (scaled >= 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor
    case 'down':
      return (scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor
    case 'ceil':
      return Math.ceil(scaled) / factor
    case 'floor':
      return Math.floor(scaled) / factor
    case 'trunc':
      return Math.trunc(scaled) / factor
  }
}

function roundHalfEvenValue(value: number): number {
  const floorValue = Math.floor(value)
  const diff = value - floorValue
  if (diff < 0.5) return floorValue
  if (diff > 0.5) return floorValue + 1
  return floorValue % 2 === 0 ? floorValue : floorValue + 1
}

export function formatExpressionValue(value: unknown, pattern: string): string {
  if (value == null) return ''
  if (pattern === '') return String(value)

  if (value instanceof Date || isDatePattern(pattern)) {
    return formatDateValue(value, pattern)
  }
  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))) {
    return formatNumberValue(Number(value), pattern)
  }
  return String(value)
}

function isDatePattern(pattern: string): boolean {
  return pattern.includes('yyyy') || pattern.includes('MM') || pattern.includes('dd') ||
    pattern.includes('HH') || pattern.includes('mm') || pattern.includes('ss')
}

function formatDateValue(value: unknown, pattern: string): string {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)

  let result = pattern
  result = result.replace('yyyy', String(date.getFullYear()))
  result = replaceDateToken(result, 'MM', String(date.getMonth() + 1).padStart(2, '0'), 'M', String(date.getMonth() + 1))
  result = replaceDateToken(result, 'dd', String(date.getDate()).padStart(2, '0'), 'd', String(date.getDate()))
  result = result.replace('HH', String(date.getHours()).padStart(2, '0'))
  result = result.replace('mm', String(date.getMinutes()).padStart(2, '0'))
  result = result.replace('ss', String(date.getSeconds()).padStart(2, '0'))
  return result
}

function replaceDateToken(result: string, longToken: string, longValue: string, shortToken: string, shortValue: string): string {
  const hasLongToken = result.includes(longToken)
  result = result.replace(longToken, longValue)
  if (!hasLongToken) {
    result = result.replace(shortToken, shortValue)
  }
  return result
}

function formatNumberValue(value: number, pattern: string): string {
  if (!Number.isFinite(value)) return String(value)
  const match = pattern.match(/([^#0,.]*)([#0,.]+)(.*)/)
  if (match === null) return String(value)

  const prefix = match[1]!
  const numericPattern = match[2]!
  const suffix = match[3]!
  const dotIndex = numericPattern.indexOf('.')
  const integerPattern = dotIndex >= 0 ? numericPattern.slice(0, dotIndex) : numericPattern
  const fractionPattern = dotIndex >= 0 ? numericPattern.slice(dotIndex + 1) : ''
  const minimumIntegerDigits = countPatternDigits(integerPattern, '0')
  const minimumFractionDigits = countPatternDigits(fractionPattern, '0')
  const maximumFractionDigits = fractionPattern.length
  const useGrouping = integerPattern.includes(',')
  const roundedValue = maximumFractionDigits > 0 ? roundWithMode(value, maximumFractionDigits, 'half-up') : Math.round(value)
  const negative = roundedValue < 0
  const absoluteValue = Math.abs(roundedValue)
  const integerValue = Math.trunc(absoluteValue)
  const fractionValue = absoluteValue - integerValue
  let integerText = String(integerValue).padStart(minimumIntegerDigits, '0')
  if (useGrouping) {
    integerText = applyGrouping(integerText)
  }
  let fractionText = ''
  if (maximumFractionDigits > 0) {
    fractionText = String(Math.round(fractionValue * 10 ** maximumFractionDigits)).padStart(maximumFractionDigits, '0')
    while (fractionText.length > minimumFractionDigits && fractionText.endsWith('0')) {
      fractionText = fractionText.slice(0, -1)
    }
  }
  return `${negative ? '-' : ''}${prefix}${integerText}${fractionText === '' ? '' : `.${fractionText}`}${suffix}`
}

function countPatternDigits(pattern: string, char: '0' | '#'): number {
  let count = 0
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === char) count++
  }
  return count
}

function applyGrouping(integerText: string): string {
  let result = ''
  let digitCount = 0
  for (let i = integerText.length - 1; i >= 0; i--) {
    result = integerText[i]! + result
    digitCount++
    if (digitCount === 3 && i > 0) {
      result = `,${result}`
      digitCount = 0
    }
  }
  return result
}

class ExpressionParser {
  private readonly source: string
  private readonly length: number
  private position: number
  private depth: number

  constructor(source: string) {
    this.source = source
    this.length = source.length
    this.position = 0
    this.depth = 0
  }

  parse(): ExpressionAstNode {
    this.skipWhitespace()
    if (this.position >= this.length) {
      return { type: 'literal', value: undefined }
    }

    const expression = this.parseConditionalExpression()
    this.skipWhitespace()
    if (this.position < this.length) {
      throw this.syntaxError(`Unexpected token "${this.source[this.position]!}"`, this.position)
    }
    return expression
  }

  private parseConditionalExpression(): ExpressionAstNode {
    const test = this.parseNullishCoalescingExpression()
    this.skipWhitespace()
    if (!this.consumeChar(0x3F)) return test

    const consequent = this.parseConditionalExpression()
    this.skipWhitespace()
    this.expectChar(0x3A, 'Expected ":" in conditional expression')
    const alternate = this.parseConditionalExpression()
    return {
      type: 'conditional',
      test,
      consequent,
      alternate,
    }
  }

  private parseNullishCoalescingExpression(): ExpressionAstNode {
    let left = this.parseLogicalOrExpression()
    for (;;) {
      this.skipWhitespace()
      if (!this.consumeString('??')) return left
      left = {
        type: 'binary',
        operator: '??',
        left,
        right: this.parseLogicalOrExpression(),
      }
    }
  }

  private parseLogicalOrExpression(): ExpressionAstNode {
    let left = this.parseLogicalAndExpression()
    for (;;) {
      this.skipWhitespace()
      if (!this.consumeString('||')) return left
      left = {
        type: 'binary',
        operator: '||',
        left,
        right: this.parseLogicalAndExpression(),
      }
    }
  }

  private parseLogicalAndExpression(): ExpressionAstNode {
    let left = this.parseEqualityExpression()
    for (;;) {
      this.skipWhitespace()
      if (!this.consumeString('&&')) return left
      left = {
        type: 'binary',
        operator: '&&',
        left,
        right: this.parseEqualityExpression(),
      }
    }
  }

  private parseEqualityExpression(): ExpressionAstNode {
    let left = this.parseComparisonExpression()
    for (;;) {
      this.skipWhitespace()
      if (this.consumeString('===')) {
        left = {
          type: 'binary',
          operator: '===',
          left,
          right: this.parseComparisonExpression(),
        }
        continue
      }
      if (this.consumeString('!==')) {
        left = {
          type: 'binary',
          operator: '!==',
          left,
          right: this.parseComparisonExpression(),
        }
        continue
      }
      return left
    }
  }

  private parseComparisonExpression(): ExpressionAstNode {
    let left = this.parseAdditiveExpression()
    for (;;) {
      this.skipWhitespace()
      if (this.consumeString('>=')) {
        left = {
          type: 'binary',
          operator: '>=',
          left,
          right: this.parseAdditiveExpression(),
        }
        continue
      }
      if (this.consumeString('<=')) {
        left = {
          type: 'binary',
          operator: '<=',
          left,
          right: this.parseAdditiveExpression(),
        }
        continue
      }
      if (this.consumeChar(0x3E)) {
        left = {
          type: 'binary',
          operator: '>',
          left,
          right: this.parseAdditiveExpression(),
        }
        continue
      }
      if (this.consumeChar(0x3C)) {
        left = {
          type: 'binary',
          operator: '<',
          left,
          right: this.parseAdditiveExpression(),
        }
        continue
      }
      return left
    }
  }

  private parseAdditiveExpression(): ExpressionAstNode {
    let left = this.parseMultiplicativeExpression()
    for (;;) {
      this.skipWhitespace()
      if (this.consumeChar(0x2B)) {
        left = {
          type: 'binary',
          operator: '+',
          left,
          right: this.parseMultiplicativeExpression(),
        }
        continue
      }
      if (this.consumeChar(0x2D)) {
        left = {
          type: 'binary',
          operator: '-',
          left,
          right: this.parseMultiplicativeExpression(),
        }
        continue
      }
      return left
    }
  }

  private parseMultiplicativeExpression(): ExpressionAstNode {
    let left = this.parseUnaryExpression()
    for (;;) {
      this.skipWhitespace()
      if (this.consumeChar(0x2A)) {
        left = {
          type: 'binary',
          operator: '*',
          left,
          right: this.parseUnaryExpression(),
        }
        continue
      }
      if (this.consumeChar(0x2F)) {
        left = {
          type: 'binary',
          operator: '/',
          left,
          right: this.parseUnaryExpression(),
        }
        continue
      }
      return left
    }
  }

  private parseUnaryExpression(): ExpressionAstNode {
    if (++this.depth > MAX_PARSE_DEPTH) {
      throw new ExpressionLanguageError('security', 'Expression nesting too deep', this.position)
    }
    try {
      this.skipWhitespace()
      if (this.consumeChar(0x21)) {
        return {
          type: 'unary',
          operator: '!',
          argument: this.parseUnaryExpression(),
        }
      }
      if (this.consumeChar(0x2B)) {
        return {
          type: 'unary',
          operator: '+',
          argument: this.parseUnaryExpression(),
        }
      }
      if (this.consumeChar(0x2D)) {
        return {
          type: 'unary',
          operator: '-',
          argument: this.parseUnaryExpression(),
        }
      }
      return this.parsePostfixExpression()
    } finally {
      this.depth--
    }
  }

  private parsePostfixExpression(): ExpressionAstNode {
    let expression = this.parsePrimaryExpression()
    for (;;) {
      this.skipWhitespace()
      if (this.consumeChar(0x2E)) {
        const propertyPosition = this.position
        const property = this.readIdentifier('Expected property name after "."')
        this.assertSafeIdentifier(property, propertyPosition)
        expression = {
          type: 'member',
          object: expression,
          property,
        }
        continue
      }
      if (this.consumeChar(0x28)) {
        expression = {
          type: 'call',
          callee: expression,
          arguments: this.readCallArguments(),
        }
        continue
      }
      return expression
    }
  }

  private readCallArguments(): ExpressionAstNode[] {
    const args: ExpressionAstNode[] = []
    this.skipWhitespace()
    if (this.consumeChar(0x29)) return args

    for (;;) {
      args.push(this.parseConditionalExpression())
      this.skipWhitespace()
      if (this.consumeChar(0x29)) return args
      this.expectChar(0x2C, 'Expected "," in function call')
    }
  }

  private parsePrimaryExpression(): ExpressionAstNode {
    this.skipWhitespace()
    if (this.position >= this.length) {
      throw this.syntaxError('Unexpected end of expression', this.position)
    }

    const charCode = this.source.charCodeAt(this.position)
    if (charCode === 0x28) {
      return this.parseParenthesizedExpression()
    }
    if (charCode === 0x27 || charCode === 0x22) {
      return {
        type: 'literal',
        value: this.readQuotedString(charCode),
      }
    }
    if (charCode === 0x60) {
      return this.parseTemplateLiteral()
    }
    if (isDecimalDigit(charCode)) {
      return {
        type: 'literal',
        value: this.readNumberLiteral(),
      }
    }
    if (this.isIdentifierStartAt(this.position)) {
      return this.parseIdentifierOrKeyword()
    }

    throw this.syntaxError(`Unexpected token "${this.source[this.position]!}"`, this.position)
  }

  private parseParenthesizedExpression(): ExpressionAstNode {
    this.position++
    const expression = this.parseConditionalExpression()
    this.skipWhitespace()
    this.expectChar(0x29, 'Expected ")"')
    return expression
  }

  private parseIdentifierOrKeyword(): ExpressionAstNode {
    const identifierPosition = this.position
    const identifier = this.readIdentifier('Expected identifier')

    if (identifier === 'true' || identifier === 'TRUE') return { type: 'literal', value: true }
    if (identifier === 'false' || identifier === 'FALSE') return { type: 'literal', value: false }
    if (identifier === 'null' || identifier === 'NULL') return { type: 'literal', value: null }
    if (identifier === 'undefined' || identifier === 'UNDEFINED') return { type: 'literal', value: undefined }

    this.assertSafeIdentifier(identifier, identifierPosition)
    return {
      type: 'identifier',
      name: identifier,
    }
  }

  private parseTemplateLiteral(): ExpressionAstNode {
    const parts: TemplateExpressionPart[] = []
    let text = ''
    this.position++

    while (this.position < this.length) {
      const charCode = this.source.charCodeAt(this.position)
      if (charCode === 0x60) {
        this.position++
        if (text.length > 0) {
          parts.push({ type: 'text', value: text })
        }
        return { type: 'template', parts }
      }
      if (charCode === 0x24 && this.position + 1 < this.length && this.source.charCodeAt(this.position + 1) === 0x7B) {
        this.position += 2
        if (text.length > 0) {
          parts.push({ type: 'text', value: text })
          text = ''
        }
        const expression = this.parseConditionalExpression()
        this.skipWhitespace()
        this.expectChar(0x7D, 'Expected "}" in template literal')
        parts.push({ type: 'expression', expression })
        continue
      }
      if (charCode === 0x5C) {
        this.position++
        text += this.readEscapedCharacter()
        continue
      }
      text += this.source[this.position]!
      this.position++
    }

    throw this.syntaxError('Unterminated template literal', this.length)
  }

  private readQuotedString(quoteChar: number): string {
    let result = ''
    this.position++

    while (this.position < this.length) {
      const charCode = this.source.charCodeAt(this.position)
      if (charCode === quoteChar) {
        this.position++
        return result
      }
      if (charCode === 0x5C) {
        this.position++
        result += this.readEscapedCharacter()
        continue
      }
      result += this.source[this.position]!
      this.position++
    }

    throw this.syntaxError('Unterminated string literal', this.length)
  }

  private readEscapedCharacter(): string {
    if (this.position >= this.length) {
      throw this.syntaxError('Unterminated escape sequence', this.length)
    }

    const escaped = this.source[this.position]!
    this.position++
    switch (escaped) {
      case 'b':
        return ESCAPE_BACKSPACE
      case 'f':
        return ESCAPE_FORM_FEED
      case 'n':
        return ESCAPE_NEWLINE
      case 'r':
        return ESCAPE_CARRIAGE_RETURN
      case 't':
        return ESCAPE_TAB
      case 'v':
        return ESCAPE_VERTICAL_TAB
      case '0':
        return '\0'
      case '\\':
      case '\'':
      case '"':
      case '`':
      case '$':
        return escaped
      default:
        return escaped
    }
  }

  private readNumberLiteral(): number {
    const start = this.position
    while (this.position < this.length && isDecimalDigit(this.source.charCodeAt(this.position))) {
      this.position++
    }
    if (this.position < this.length && this.source.charCodeAt(this.position) === 0x2E) {
      this.position++
      while (this.position < this.length && isDecimalDigit(this.source.charCodeAt(this.position))) {
        this.position++
      }
    }

    const raw = this.source.slice(start, this.position)
    const value = Number(raw)
    if (Number.isNaN(value)) {
      throw this.syntaxError(`Invalid number literal "${raw}"`, start)
    }
    return value
  }

  private readIdentifier(message: string): string {
    if (this.position >= this.length || !this.isIdentifierStartAt(this.position)) {
      throw this.syntaxError(message, this.position)
    }

    const start = this.position
    this.position++
    while (this.position < this.length && this.isIdentifierPartAt(this.position)) {
      this.position++
    }
    return this.source.slice(start, this.position)
  }

  private assertSafeIdentifier(identifier: string, position: number): void {
    if (isForbiddenMemberName(identifier)) {
      throw new ExpressionLanguageError('security', `Forbidden identifier "${identifier}"`, position)
    }
  }

  private skipWhitespace(): void {
    while (this.position < this.length) {
      const charCode = this.source.charCodeAt(this.position)
      if (
        charCode === 0x20 ||
        charCode === 0x09 ||
        charCode === 0x0A ||
        charCode === 0x0D ||
        charCode === 0x0C
      ) {
        this.position++
        continue
      }
      return
    }
  }

  private consumeChar(charCode: number): boolean {
    if (this.position >= this.length || this.source.charCodeAt(this.position) !== charCode) {
      return false
    }
    this.position++
    return true
  }

  private consumeString(text: string): boolean {
    if (!this.source.startsWith(text, this.position)) return false
    this.position += text.length
    return true
  }

  private expectChar(charCode: number, message: string): void {
    if (!this.consumeChar(charCode)) {
      throw this.syntaxError(message, this.position)
    }
  }

  private isIdentifierStartAt(index: number): boolean {
    return IDENTIFIER_START_REGEX.test(this.source[index]!)
  }

  private isIdentifierPartAt(index: number): boolean {
    return IDENTIFIER_PART_REGEX.test(this.source[index]!)
  }

  private syntaxError(message: string, position: number): ExpressionLanguageError {
    return new ExpressionLanguageError('syntax', message, position)
  }
}

function isDecimalDigit(charCode: number): boolean {
  return charCode >= 0x30 && charCode <= 0x39
}
