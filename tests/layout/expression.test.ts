import { describe, it, expect } from 'vitest'
import { evaluateExpression, formatValue } from '../../src/layout/expression.js'
import { ExpressionLanguageError, evaluateScopedExpression, validateExpressionSource } from '../../src/expression-language.js'
import type { ReportContext } from '../../src/types/template.js'

// ─── Helpers ───

function makeReport(overrides?: Partial<ReportContext>): ReportContext {
  return {
    PAGE_NUMBER: overrides?.PAGE_NUMBER ?? 1,
    COLUMN_NUMBER: overrides?.COLUMN_NUMBER ?? 1,
    REPORT_COUNT: overrides?.REPORT_COUNT ?? 0,
    TOTAL_PAGES: overrides?.TOTAL_PAGES ?? 0,
    format: overrides?.format ?? formatValue,
    formatters: overrides?.formatters ?? {},
  }
}

const emptyField: Record<string, unknown> = {}
const emptyVars: Record<string, unknown> = {}
const emptyParam: Record<string, unknown> = {}

// ─── Tests ───

describe('Expression Engine', () => {
  // Literal parsing.
  describe('リテラル', () => {
    const report = makeReport()

    // Verifies integer and decimal number literals evaluate to numbers.
    it('数値', () => {
      expect(evaluateExpression('42', emptyField, emptyVars, emptyParam, report)).toBe(42)
      expect(evaluateExpression('3.14', emptyField, emptyVars, emptyParam, report)).toBeCloseTo(3.14)
    })

    // Verifies single-quoted string literals.
    it('文字列（シングルクォート）', () => {
      expect(evaluateExpression("'hello'", emptyField, emptyVars, emptyParam, report)).toBe('hello')
    })

    // Verifies double-quoted string literals.
    it('文字列（ダブルクォート）', () => {
      expect(evaluateExpression('"world"', emptyField, emptyVars, emptyParam, report)).toBe('world')
    })

    // Verifies boolean literals in both lowercase and uppercase forms.
    it('真偽値', () => {
      expect(evaluateExpression('true', emptyField, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('false', emptyField, emptyVars, emptyParam, report)).toBe(false)
      expect(evaluateExpression('TRUE', emptyField, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('FALSE', emptyField, emptyVars, emptyParam, report)).toBe(false)
    })

    // Verifies null literals in both lowercase and uppercase forms.
    it('null', () => {
      expect(evaluateExpression('null', emptyField, emptyVars, emptyParam, report)).toBe(null)
      expect(evaluateExpression('NULL', emptyField, emptyVars, emptyParam, report)).toBe(null)
    })
  })

  describe('簡易参照', () => {
    it('field参照', () => {
      const field = { name: '田中', age: 30 }
      const report = makeReport()
      expect(evaluateExpression('field.name', field, emptyVars, emptyParam, report)).toBe('田中')
      expect(evaluateExpression('field.age', field, emptyVars, emptyParam, report)).toBe(30)
    })

    it('ネストfield参照', () => {
      const field = { customer: { address: { city: '東京' } } }
      const report = makeReport()
      expect(evaluateExpression('field.customer.address.city', field, emptyVars, emptyParam, report)).toBe('東京')
    })

    it('vars参照', () => {
      const vars = { total: 12345 }
      const report = makeReport()
      expect(evaluateExpression('vars.total', emptyField, vars, emptyParam, report)).toBe(12345)
    })

    it('var参照エイリアス', () => {
      const vars = { total: 12345 }
      const report = makeReport()
      expect(evaluateExpression('var.total', emptyField, vars, emptyParam, report)).toBe(12345)
    })

    it('param参照', () => {
      const param = { title: 'レポート' }
      const report = makeReport()
      expect(evaluateExpression('param.title', emptyField, emptyVars, param, report)).toBe('レポート')
    })

    it('ビルトイン変数', () => {
      const report = makeReport({ PAGE_NUMBER: 3, REPORT_COUNT: 42 })
      expect(evaluateExpression('PAGE_NUMBER', emptyField, emptyVars, emptyParam, report)).toBe(3)
      expect(evaluateExpression('REPORT_COUNT', emptyField, emptyVars, emptyParam, report)).toBe(42)
    })

    it('存在しないフィールドはundefined', () => {
      const report = makeReport()
      expect(evaluateExpression('field.nothing', emptyField, emptyVars, emptyParam, report)).toBeUndefined()
    })

    it('nullフィールドのネスト参照はnull', () => {
      const field = { a: null }
      const report = makeReport()
      expect(evaluateExpression('field.a.b.c', field, emptyVars, emptyParam, report)).toBeNull()
    })

    it('未知のルートはundefined', () => {
      const report = makeReport()
      expect(evaluateExpression('unknown.foo', emptyField, emptyVars, emptyParam, report)).toBeUndefined()
    })
  })

  describe('コールバック', () => {
    it('field参照', () => {
      const field = { price: 500, qty: 3 }
      const report = makeReport()
      const expr = (f: Record<string, unknown>) => (f.price as number) * (f.qty as number)
      expect(evaluateExpression(expr, field, emptyVars, emptyParam, report)).toBe(1500)
    })

    it('vars参照', () => {
      const vars = { total: 999 }
      const report = makeReport()
      const expr = (_f: any, v: Record<string, unknown>) => v.total
      expect(evaluateExpression(expr, emptyField, vars, emptyParam, report)).toBe(999)
    })

    it('param参照', () => {
      const param = { taxRate: 0.1 }
      const report = makeReport()
      const expr = (_f: any, _v: any, p: Record<string, unknown>) => p.taxRate
      expect(evaluateExpression(expr, emptyField, emptyVars, param, report)).toBe(0.1)
    })

    it('report参照', () => {
      const report = makeReport({ PAGE_NUMBER: 5, TOTAL_PAGES: 10 })
      const expr = (_f: any, _v: any, _p: any, r: ReportContext) =>
        `${r.PAGE_NUMBER} / ${r.TOTAL_PAGES}`
      expect(evaluateExpression(expr, emptyField, emptyVars, emptyParam, report)).toBe('5 / 10')
    })

    it('複雑なロジック', () => {
      const field = { items: [{ price: 100 }, { price: 200 }, { price: 300 }] }
      const report = makeReport()
      const expr = (f: Record<string, unknown>) => {
        const items = f.items as { price: number }[]
        let sum = 0
        for (let i = 0; i < items.length; i++) sum += items[i]!.price
        return sum
      }
      expect(evaluateExpression(expr, field, emptyVars, emptyParam, report)).toBe(600)
    })

    it('条件分岐', () => {
      const report = makeReport()
      const expr = (f: Record<string, unknown>) =>
        (f.status as string) === '完了' ? '✓ ' + f.status : String(f.status)
      expect(evaluateExpression(expr, { status: '完了' }, emptyVars, emptyParam, report)).toBe('✓ 完了')
      expect(evaluateExpression(expr, { status: '進行中' }, emptyVars, emptyParam, report)).toBe('進行中')
    })
  })

  describe('ミニ言語', () => {
    const report = makeReport({ PAGE_NUMBER: 5, TOTAL_PAGES: 9 })

    it('四則演算と優先順位', () => {
      const field = { price: 500, qty: 3, discount: 50 }
      expect(evaluateExpression('field.price * field.qty - field.discount', field, emptyVars, emptyParam, report)).toBe(1450)
      expect(evaluateExpression('field.price * (field.qty - 1)', field, emptyVars, emptyParam, report)).toBe(1000)
      expect(evaluateExpression('10 / 4', field, emptyVars, emptyParam, report)).toBe(2.5)
      expect(evaluateExpression('2 + 3 * 4', field, emptyVars, emptyParam, report)).toBe(14)
      expect(evaluateExpression('(2 + 3) * 4', field, emptyVars, emptyParam, report)).toBe(20)
    })

    it('比較・論理演算子', () => {
      const field = { amount: 1200, enabled: true, name: '' }
      expect(evaluateExpression('field.amount >= 1000 && field.enabled', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount < 1000 || field.enabled', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('!field.name', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount > 1000', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount >= 1200', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount < 1300', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount <= 1200', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount === 1200', field, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('field.amount !== 1000', field, emptyVars, emptyParam, report)).toBe(true)
    })

    it('TRUE/FALSE と否定', () => {
      expect(evaluateExpression('TRUE', emptyField, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('FALSE', emptyField, emptyVars, emptyParam, report)).toBe(false)
      expect(evaluateExpression('!TRUE', emptyField, emptyVars, emptyParam, report)).toBe(false)
      expect(evaluateExpression('!FALSE', emptyField, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('FALSE || TRUE', emptyField, emptyVars, emptyParam, report)).toBe(true)
      expect(evaluateExpression('TRUE && FALSE', emptyField, emptyVars, emptyParam, report)).toBe(false)
    })

    it('三項演算子', () => {
      const field = { status: 'paid' }
      expect(evaluateExpression('field.status === "paid" ? "済" : "未"', field, emptyVars, emptyParam, report)).toBe('済')
      expect(evaluateExpression('TRUE ? (FALSE ? "A" : "B") : "C"', field, emptyVars, emptyParam, report)).toBe('B')
    })

    it('null合体演算子', () => {
      const field = { name: undefined }
      expect(evaluateExpression('field.name ?? "N/A"', field, emptyVars, emptyParam, report)).toBe('N/A')
    })

    it('テンプレートリテラル', () => {
      const field = { code: 'A-01', customer: { name: '田中' } }
      expect(
        evaluateExpression('`顧客:${field.customer.name} / ${field.code} / ${PAGE_NUMBER}`', field, emptyVars, emptyParam, report)
      ).toBe('顧客:田中 / A-01 / 5')
      expect(
        evaluateExpression('`${TRUE ? "T" : "F"}-${field.code}-${field.customer.name}`', field, emptyVars, emptyParam, report)
      ).toBe('T-A-01-田中')
    })

    it('文字列連結', () => {
      const field = { name: '山田' }
      expect(evaluateExpression('"顧客:" + field.name', field, emptyVars, emptyParam, report)).toBe('顧客:山田')
    })

    it('組み込み format 関数', () => {
      const field = {
        amount: 12345.678,
        code: 42,
        issuedAt: '2024-04-01T09:05:03',
      }
      expect(evaluateExpression('format(field.amount, "#,##0.00")', field, emptyVars, emptyParam, report)).toBe('12,345.68')
      expect(evaluateExpression('format(field.code, "0000")', field, emptyVars, emptyParam, report)).toBe('0042')
      expect(evaluateExpression('format(field.issuedAt, "yyyy/MM/dd HH:mm:ss")', field, emptyVars, emptyParam, report)).toBe('2024/04/01 09:05:03')
      expect(evaluateExpression('format(field.amount, "#,##0.##")', field, emptyVars, emptyParam, report)).toBe('12,345.68')
      expect(evaluateExpression('format(-12.5, "USD 0000.00 suffix")', field, emptyVars, emptyParam, report)).toBe('-USD 0012.50 suffix')
      expect(evaluateExpression('format(round(field.amount, 1), "#,##0.0")', field, emptyVars, emptyParam, report)).toBe('12,345.7')
    })

    it('組み込み丸め関数', () => {
      const field = { value: 123.456, negative: -123.456 }
      expect(evaluateExpression('round(field.value, 2)', field, emptyVars, emptyParam, report)).toBe(123.46)
      expect(evaluateExpression('roundUp(field.value, 2)', field, emptyVars, emptyParam, report)).toBe(123.46)
      expect(evaluateExpression('roundDown(field.value, 2)', field, emptyVars, emptyParam, report)).toBe(123.45)
      expect(evaluateExpression('ceil(field.value, 1)', field, emptyVars, emptyParam, report)).toBe(123.5)
      expect(evaluateExpression('floor(field.value, 1)', field, emptyVars, emptyParam, report)).toBe(123.4)
      expect(evaluateExpression('trunc(field.negative, 1)', field, emptyVars, emptyParam, report)).toBe(-123.4)
      expect(evaluateExpression('roundHalfEven(2.5, 0)', field, emptyVars, emptyParam, report)).toBe(2)
      expect(evaluateExpression('roundHalfEven(3.5, 0)', field, emptyVars, emptyParam, report)).toBe(4)
      expect(evaluateExpression('round(-1255, -2)', field, emptyVars, emptyParam, report)).toBe(-1300)
      expect(evaluateExpression('roundUp(-12.341, 2)', field, emptyVars, emptyParam, report)).toBe(-12.35)
      expect(evaluateExpression('roundDown(-12.349, 2)', field, emptyVars, emptyParam, report)).toBe(-12.34)
      expect(evaluateExpression('ceil(-12.31, 1)', field, emptyVars, emptyParam, report)).toBe(-12.3)
      expect(evaluateExpression('floor(-12.31, 1)', field, emptyVars, emptyParam, report)).toBe(-12.4)
      expect(evaluateExpression('trunc(1255, -2)', field, emptyVars, emptyParam, report)).toBe(1200)
      expect(evaluateExpression('roundHalfEven(-2.5, 0)', field, emptyVars, emptyParam, report)).toBe(-2)
      expect(evaluateExpression('roundHalfEven(-3.5, 0)', field, emptyVars, emptyParam, report)).toBe(-4)
    })

    it('汎用参照マップでも評価できる', () => {
      expect(evaluateScopedExpression('invoice.total * taxRate', {
        invoice: { total: 1000 },
        taxRate: 1.1,
      })).toBe(1100)
      expect(evaluateScopedExpression('enabled ? label : "NG"', {
        enabled: true,
        label: 'OK',
      })).toBe('OK')
    })

    it('組み込み now 関数', () => {
      const now = new Date(2024, 3, 1, 9, 5, 3)
      expect(evaluateScopedExpression('format(now(), "yyyy/MM/dd HH:mm:ss")', {}, {
        now: () => now,
      })).toBe('2024/04/01 09:05:03')
      expect(evaluateScopedExpression('now()', {}, {
        now: () => now,
      })).toBe(now)
    })
  })

  describe('組み込みフォーマット', () => {
    it('数値カンマ区切り', () => {
      expect(formatValue(12345, '#,##0')).toBe('12,345')
    })

    it('通貨', () => {
      expect(formatValue(12345, '¥#,##0')).toBe('¥12,345')
    })

    it('小数', () => {
      expect(formatValue(3.14159, '#,##0.00')).toBe('3.14')
    })

    it('日付', () => {
      expect(formatValue('2024-04-01', 'yyyy/MM/dd')).toBe('2024/04/01')
    })

    it('nullは空文字', () => {
      expect(formatValue(null, '#,##0')).toBe('')
    })

    it('コールバック内でreport.formatを使用', () => {
      const report = makeReport()
      const expr = (f: Record<string, unknown>, _v: any, _p: any, r: ReportContext) =>
        r.format(f.price, '¥#,##0')
      expect(evaluateExpression(expr, { price: 5000 }, emptyVars, emptyParam, report)).toBe('¥5,000')
    })
  })

  describe('カスタムフォーマッター', () => {
    it('コールバック内でreport.formattersを使用', () => {
      const report = makeReport({
        formatters: {
          currency: (v) => `¥${Number(v).toLocaleString()}`,
        },
      })
      const expr = (_f: any, _v: any, _p: any, r: ReportContext) =>
        r.formatters.currency!(100000)
      expect(evaluateExpression(expr, emptyField, emptyVars, emptyParam, report)).toBe('¥100,000')
    })
  })

  describe('エッジケース', () => {
    const report = makeReport()

    it('空文字列は report のビルトインを参照', () => {
      // Charactercolumnwithout -> report[''] -> undefined.
      
      expect(evaluateExpression('', emptyField, emptyVars, emptyParam, report)).toBeUndefined()
    })

    it('負の数値', () => {
      expect(evaluateExpression('-42', emptyField, emptyVars, emptyParam, report)).toBe(-42)
      expect(evaluateExpression('-3.14', emptyField, emptyVars, emptyParam, report)).toBeCloseTo(-3.14)
    })

    it('ゼロ', () => {
      expect(evaluateExpression('0', emptyField, emptyVars, emptyParam, report)).toBe(0)
    })

    it('空のクォート文字列', () => {
      expect(evaluateExpression("''", emptyField, emptyVars, emptyParam, report)).toBe('')
      expect(evaluateExpression('""', emptyField, emptyVars, emptyParam, report)).toBe('')
    })

    it('16進数リテラルは未対応', () => {
      expect(() => evaluateExpression('0x10', emptyField, emptyVars, emptyParam, report)).toThrow(ExpressionLanguageError)
    })

    it('NaN/Infinity のフォーマット', () => {
      expect(formatValue(NaN, '#,##0')).toBe('NaN')
      expect(formatValue(Infinity, '#,##0')).toBe('Infinity')
      expect(formatValue(-Infinity, '¥#,##0')).toBe('-Infinity')
    })

    it('日付フォーマット: 単一桁M/d', () => {
      // Yyyy/M/d.
      
      expect(formatValue('2024-01-05', 'yyyy/M/d')).toBe('2024/1/5')
      // Date + M/d (Date detect)
      
      expect(formatValue(new Date(2024, 0, 5), 'M/d')).toBe('1/5')
    })

    it('日付フォーマット: 時刻', () => {
      const d = new Date(2024, 0, 15, 9, 5, 3)
      expect(formatValue(d, 'HH:mm:ss')).toBe('09:05:03')
    })

    it('数値フォーマット: 0埋め', () => {
      expect(formatValue(42, '0000')).toBe('0042')
      expect(formatValue(7.2, '0000.00')).toBe('0007.20')
    })

    it('数値フォーマット: 可変小数と接頭辞接尾辞', () => {
      expect(formatValue(1234.5, '#,##0.#')).toBe('1,234.5')
      expect(formatValue(1234, '税込 #,##0 円')).toBe('税込 1,234 円')
      expect(formatValue(-42, '0000')).toBe('-0042')
    })

    it('日付フォーマット: 無効日付は元値を返す', () => {
      expect(formatValue('not-a-date', 'yyyy/MM/dd')).toBe('not-a-date')
    })

    it('日付フォーマット: Dateオブジェクトの複合書式', () => {
      const d = new Date(2024, 10, 9, 7, 8, 9)
      expect(formatValue(d, 'yyyy年MM月dd日 HH:mm:ss')).toBe('2024年11月09日 07:08:09')
    })

    it('深いネストパス', () => {
      const field = { a: { b: { c: { d: { e: 'deep' } } } } }
      expect(evaluateExpression('field.a.b.c.d.e', field, emptyVars, emptyParam, report)).toBe('deep')
    })

    it('コールバックがnullを返す', () => {
      const expr = () => null
      expect(evaluateExpression(expr, emptyField, emptyVars, emptyParam, report)).toBeNull()
    })

    it('コールバックがundefinedを返す', () => {
      const expr = () => undefined
      expect(evaluateExpression(expr, emptyField, emptyVars, emptyParam, report)).toBeUndefined()
    })

    it('継承プロパティは参照できない', () => {
      const inherited = Object.create({ secret: 'hidden' }) as Record<string, unknown>
      inherited.visible = 'ok'
      expect(evaluateExpression('field.visible', inherited, emptyVars, emptyParam, report)).toBe('ok')
      expect(evaluateExpression('field.secret', inherited, emptyVars, emptyParam, report)).toBeUndefined()
    })

    it('未定義値を含むテンプレートリテラル', () => {
      expect(evaluateExpression('`X:${field.missing}`', emptyField, emptyVars, emptyParam, report)).toBe('X:undefined')
    })
  })

  describe('セキュリティ', () => {
    const report = makeReport()

    it('危険な識別子を拒否する', () => {
      const candidates = [
        'field.__proto__',
        'field.constructor',
        'field.prototype',
        '__proto__',
        'constructor',
        'prototype',
      ]
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]!
        expect(() => evaluateExpression(candidate, { safe: true }, emptyVars, emptyParam, report)).toThrow(ExpressionLanguageError)
      }
    })

    it('不正な構文位置を返す', () => {
      const error = validateExpressionSource('field.amount ? "A"')
      expect(error).toBeInstanceOf(ExpressionLanguageError)
      expect(error?.code).toBe('syntax')
      expect(error?.position).toBeGreaterThanOrEqual(0)
    })

    it('危険なネスト参照を拒否する', () => {
      const field = {
        safe: {
          value: 10,
          constructor: { leak: true },
          __proto__: { leak: true },
          prototype: { leak: true },
        },
      }
      expect(() => evaluateExpression('field.safe.constructor.leak', field, emptyVars, emptyParam, report)).toThrow(ExpressionLanguageError)
      expect(() => evaluateExpression('field.safe.__proto__.leak', field, emptyVars, emptyParam, report)).toThrow(ExpressionLanguageError)
      expect(() => evaluateExpression('field.safe.prototype.leak', field, emptyVars, emptyParam, report)).toThrow(ExpressionLanguageError)
    })

    it('ブラケットアクセス構文は許可しない', () => {
      expect(validateExpressionSource('field["name"]')?.code).toBe('syntax')
      expect(validateExpressionSource("field['name']")?.code).toBe('syntax')
    })

    it('過度に深いネスト式を拒否する（スタック枯渇防止）', () => {
      // Deeply nested unary/parentheses would otherwise overflow the parser stack.
      const error = validateExpressionSource('!'.repeat(400) + 'x')
      expect(error).toBeInstanceOf(ExpressionLanguageError)
      expect(error?.code).toBe('security')
    })

    it('妥当な深さのネストは許可する', () => {
      const ok = '('.repeat(20) + 'field.x' + ')'.repeat(20)
      expect(validateExpressionSource(ok)).toBeNull()
    })

    it('未定義の関数呼び出しを拒否する', () => {
      expect(() => evaluateScopedExpression('unknownFn(1)', {})).toThrow(ExpressionLanguageError)
    })

    it('メンバー関数呼び出しを拒否する', () => {
      expect(() => evaluateScopedExpression('field.format()', { field: { format: 'x' } })).toThrow(ExpressionLanguageError)
    })

    it('関数呼び出し構文エラーを拒否する', () => {
      expect(validateExpressionSource('format(')?.code).toBe('syntax')
      expect(validateExpressionSource('round(1,)')?.code).toBe('syntax')
      expect(validateExpressionSource('round(1 2)')?.code).toBe('syntax')
    })

    it('危険な関数名を拒否する', () => {
      expect(() => evaluateScopedExpression('__proto__(1)', {})).toThrow(ExpressionLanguageError)
      expect(() => evaluateScopedExpression('constructor(1)', {})).toThrow(ExpressionLanguageError)
    })

    it('未終了リテラルを拒否する', () => {
      expect(validateExpressionSource('"abc')?.code).toBe('syntax')
      expect(validateExpressionSource('`abc ${field.name}`${')?.code).toBe('syntax')
      expect(validateExpressionSource('(field.name')?.code).toBe('syntax')
    })

    it('generic evaluator でも危険な参照を拒否する', () => {
      expect(() => evaluateScopedExpression('payload.constructor', {
        payload: { constructor: { admin: true } },
      })).toThrow(ExpressionLanguageError)
    })
  })
})
