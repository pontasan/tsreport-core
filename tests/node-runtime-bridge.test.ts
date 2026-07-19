import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { randomFillSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getNodeModule, installNodeRuntime, type NodeRuntimeBridge } from '../src/node-runtime-bridge.js'
import { randomBytes } from '../src/renderer/pdf-encryption.js'
import { createReportFromFile } from '../src/layout/create-report-from-file.js'
import { createReport } from '../src/layout/engine.js'
import type { RenderNode } from '../src/types/render.js'

const RUNTIME_KEY = Symbol.for('tsreport-core.node-runtime')

function containsImage(nodes: RenderNode[], imageId: string): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'image' && node.imageId === imageId) return true
    if (node.type === 'group' && containsImage(node.children, imageId)) return true
  }
  return false
}

function createRuntime(): NodeRuntimeBridge {
  return {
    require: createRequire(import.meta.url),
    execPath: process.execPath,
    randomFill(bytes): void {
      randomFillSync(bytes)
    },
  }
}

describe('Node runtime bridge', () => {
  it('未設定状態をキャッシュせず、後から登録したランタイムを使用する', () => {
    const globals = globalThis as Record<symbol, NodeRuntimeBridge | undefined>
    const previous = globals[RUNTIME_KEY]
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-runtime-'))
    const templatePath = join(dir, 'report.json')
    writeFileSync(templatePath, JSON.stringify({
      page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: { details: [] },
    }))
    try {
      delete globals[RUNTIME_KEY]
      expect(getNodeModule('node:path')).toBeNull()
      const browserDocument = createReport({
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'image', x: 0, y: 0, width: 20, height: 20, source: 'logical-image' }] }] },
      }, { rows: [{}] })
      expect(containsImage(browserDocument.pages[0]!.children, 'logical-image')).toBe(true)
      expect(() => createReportFromFile(templatePath, { rows: [] }))
        .toThrow('Local file resolution is available only in Node.js runtime')

      installNodeRuntime(createRuntime())
      expect(getNodeModule<{ sep: string }>('node:path')?.sep).toBeTruthy()
      expect(createReportFromFile(templatePath, { rows: [] }).pages).toHaveLength(1)
    } finally {
      if (previous !== undefined) installNodeRuntime(previous)
      else delete globals[RUNTIME_KEY]
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Web Crypto がないNode環境ではブリッジの安全乱数を使用する', () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
    try {
      const bytes = randomBytes(32)
      expect(bytes).toHaveLength(32)
      expect(bytes.some(value => value !== 0)).toBe(true)
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
      else delete (globalThis as { crypto?: Crypto }).crypto
    }
  })
})
