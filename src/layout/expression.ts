/**
 * Expression Engine
 *
 * Evaluates expressions in two forms: a "mini language (string expressions)"
 * and "callbacks (TypeScript functions)". Since no string-to-code conversion
 * is ever performed, problems via eval / Function / prototype pollution are
 * fundamentally avoided.
 *
 * Shorthand reference root names = callback argument names:
 *   'field.customer.name'  ↔  (field) => field.customer.name
 *   'vars.total'           ↔  (field, vars) => vars.total
 *   'param.taxRate'        ↔  (field, vars, param) => param.taxRate
 *   'PAGE_NUMBER'          ↔  (field, vars, param, report) => report.PAGE_NUMBER
 */

import { clearParsedExpressionCache, evaluateScopedExpression, formatExpressionValue } from '../expression-language.js'
import type { Expression, ReportContext } from '../types/template.js'

// ─── Expression evaluation ───

export function evaluateExpression(
  expr: Expression,
  field: Record<string, unknown>,
  vars: Record<string, unknown>,
  param: Record<string, unknown>,
  report: ReportContext,
): unknown {
  if (typeof expr === 'function') {
    return expr(field, vars, param, report)
  }
  return evaluateScopedExpression(expr, {
    field,
    vars,
    var: vars,
    param,
    PAGE_NUMBER: report.PAGE_NUMBER,
    COLUMN_NUMBER: report.COLUMN_NUMBER,
    REPORT_COUNT: report.REPORT_COUNT,
    TOTAL_PAGES: report.TOTAL_PAGES,
    RETURN_VALUE: report.RETURN_VALUE,
  })
}

// ─── Built-in formatting ───

/**
  * Number and date formatting.
  * Number patterns such as #,##0, #,##0.00, and currency forms.
  * Date patterns such as yyyy/MM/dd and localized date forms.
 */

export function formatValue(value: unknown, pattern: string): string {
  return formatExpressionValue(value, pattern)
}

/**
 * Clears the expression cache (kept as a no-op wrapper for backward compatibility)
 */
export function clearExpressionCache(): void {
  clearParsedExpressionCache()
}
