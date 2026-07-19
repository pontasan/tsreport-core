import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PDF_FIXED_CONTENT_OPERATOR_ARITY,
  PDF_INLINE_IMAGE_OPERATORS,
  PDF_VARIABLE_CONTENT_OPERATORS,
} from '../../src/pdf/content-interpreter.js'

interface OperatorGroup {
  clause: string
  topic: string
  operators: string[]
}

interface OperatorCoverage {
  groups: OperatorGroup[]
}

describe('ISO 32000-2 content operator coverage', () => {
  it('keeps every Annex A operator connected to the interpreter or inline-image lexer', () => {
    const coverage = JSON.parse(readFileSync(
      join(__dirname, '..', '..', 'conformance', 'pdf-content-operators.json'),
      'utf8',
    )) as OperatorCoverage
    const inventoried = coverage.groups.flatMap(group => group.operators)
    const connected = [
      ...PDF_FIXED_CONTENT_OPERATOR_ARITY.keys(),
      ...PDF_VARIABLE_CONTENT_OPERATORS,
      ...PDF_INLINE_IMAGE_OPERATORS,
    ]

    expect(new Set(inventoried).size).toBe(inventoried.length)
    expect([...inventoried].sort()).toEqual([...connected].sort())
    expect(coverage.groups.every(group => group.clause.length > 0 && group.topic.length > 0)).toBe(true)
  })
})
