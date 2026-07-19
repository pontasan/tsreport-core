import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReportFromFile, type ReportTemplate } from '../../src/index.js'
import {
  getNodeRuntimeBridge,
  installNodeRuntime,
  type NodeRuntimeBridge,
} from '../../src/node-runtime-bridge.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'

function makePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33)
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47
  buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A
  buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52
  buf[16] = (width >>> 24) & 0xFF
  buf[17] = (width >>> 16) & 0xFF
  buf[18] = (width >>> 8) & 0xFF
  buf[19] = width & 0xFF
  buf[20] = (height >>> 24) & 0xFF
  buf[21] = (height >>> 16) & 0xFF
  buf[22] = (height >>> 8) & 0xFF
  buf[23] = height & 0xFF
  buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0
  buf[29] = 0; buf[30] = 0; buf[31] = 0; buf[32] = 0
  return buf
}

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

describe('createReportFromFile', () => {
  it('テンプレート配置ディレクトリ基準で相対画像パスを解決する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const templatePath = join(dir, 'main.json')
      const imagePath = join(dir, 'logo.png')
      writeFileSync(imagePath, makePng(200, 100))

      const template: ReportTemplate = {
        page: { width: 200, height: 160, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 120,
            elements: [{
              type: 'image',
              x: 0,
              y: 0,
              width: 100,
              height: 80,
              source: 'logo.png',
              scaleMode: 'retainShape',
            }],
          }],
        },
      }
      writeFileSync(templatePath, JSON.stringify(template), 'utf8')

      const doc = createReportFromFile(templatePath, { rows: [{}] })
      expect(doc.images?.['logo.png']).toBeInstanceOf(Uint8Array)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('サブレポートをファイルから相対解決する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const subDir = join(dir, 'sub')
      const templatePath = join(dir, 'main.json')
      const subTemplatePath = join(subDir, 'sub.json')

      const mainTemplate: ReportTemplate = {
        page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 80,
            elements: [{
              type: 'subreport',
              x: 0,
              y: 0,
              width: 180,
              height: 40,
              templateExpression: "'sub/sub.json'",
            }],
          }],
        },
      }
      const subTemplate: ReportTemplate = {
        page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 30,
            elements: [{
              type: 'textField',
              x: 0,
              y: 0,
              width: 180,
              height: 20,
              expression: "'SUB_OK'",
            }],
          }],
        },
      }

      mkdirSync(subDir, { recursive: true })
      writeFileSync(templatePath, JSON.stringify(mainTemplate), 'utf8')
      writeFileSync(subTemplatePath, JSON.stringify(subTemplate), 'utf8')

      const doc = createReportFromFile(templatePath, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)
      expect(texts).toContain('SUB_OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('メインテンプレートの兄弟ディレクトリにあるサブレポートを解決する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const mainDir = join(dir, 'main')
      const subDir = join(dir, 'sub')
      const templatePath = join(mainDir, 'main.json')
      const subTemplatePath = join(subDir, 'sub.json')
      const mainTemplate: ReportTemplate = {
        page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 40, elements: [{ type: 'subreport', x: 0, y: 0, width: 180, height: 30, templateExpression: "'../sub/sub.json'" }] }] },
      }
      const subTemplate: ReportTemplate = {
        page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'textField', x: 0, y: 0, width: 180, height: 20, expression: "'SIBLING_OK'" }] }] },
      }
      mkdirSync(mainDir, { recursive: true })
      mkdirSync(subDir, { recursive: true })
      writeFileSync(templatePath, JSON.stringify(mainTemplate), 'utf8')
      writeFileSync(subTemplatePath, JSON.stringify(subTemplate), 'utf8')

      const doc = createReportFromFile(templatePath, { rows: [{}] })
      expect(collectTexts(doc.pages[0]!.children).map(t => t.text)).toContain('SIBLING_OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('明示した workingDirectory を画像解決に使用する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const templateDir = join(dir, 'templates')
      const assetDir = join(dir, 'assets')
      const templatePath = join(templateDir, 'main.json')
      mkdirSync(templateDir, { recursive: true })
      mkdirSync(assetDir, { recursive: true })
      const imagePath = join(assetDir, 'logo.png')
      writeFileSync(imagePath, makePng(200, 100))
      const template: ReportTemplate = {
        page: { width: 200, height: 160, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 120, elements: [{ type: 'image', x: 0, y: 0, width: 100, height: 80, source: 'logo.png' }] }] },
      }
      writeFileSync(templatePath, JSON.stringify(template), 'utf8')

      const doc = createReportFromFile(templatePath, { rows: [{}] }, { workingDirectory: assetDir })
      expect(doc.images?.['logo.png']).toBeInstanceOf(Uint8Array)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ネストしたサブレポートも子テンプレート基準で相対解決する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const subDir = join(dir, 'sub')
      const templatePath = join(dir, 'main.json')
      const subTemplatePath = join(subDir, 'sub.json')
      const innerTemplatePath = join(subDir, 'inner.json')

      const mainTemplate: ReportTemplate = {
        page: { width: 200, height: 240, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 120,
            elements: [{
              type: 'subreport',
              x: 0,
              y: 0,
              width: 180,
              height: 50,
              templateExpression: "'sub/sub.json'",
            }],
          }],
        },
      }
      const subTemplate: ReportTemplate = {
        page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 60,
            elements: [{
              type: 'subreport',
              x: 0,
              y: 0,
              width: 180,
              height: 30,
              templateExpression: "'inner.json'",
            }],
          }],
        },
      }
      const innerTemplate: ReportTemplate = {
        page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 20,
            elements: [{
              type: 'textField',
              x: 0,
              y: 0,
              width: 180,
              height: 20,
              expression: "'INNER_OK'",
            }],
          }],
        },
      }

      mkdirSync(subDir, { recursive: true })
      writeFileSync(templatePath, JSON.stringify(mainTemplate), 'utf8')
      writeFileSync(subTemplatePath, JSON.stringify(subTemplate), 'utf8')
      writeFileSync(innerTemplatePath, JSON.stringify(innerTemplate), 'utf8')

      const doc = createReportFromFile(templatePath, { rows: [{}] })
      const texts = collectTexts(doc.pages[0]!.children).map(t => t.text)
      expect(texts).toContain('INNER_OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('既定サブレポート解決はメインテンプレートディレクトリ外を読まない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const root = join(dir, 'root')
      const templatePath = join(root, 'main.json')
      const outsideTemplatePath = join(dir, 'outside.json')
      const mainTemplate: ReportTemplate = {
        page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 80,
            elements: [{
              type: 'subreport',
              x: 0,
              y: 0,
              width: 180,
              height: 40,
              templateExpression: "'../outside.json'",
            }],
          }],
        },
      }
      const outsideTemplate: ReportTemplate = {
        page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [] },
      }

      mkdirSync(root, { recursive: true })
      writeFileSync(templatePath, JSON.stringify(mainTemplate), 'utf8')
      writeFileSync(outsideTemplatePath, JSON.stringify(outsideTemplate), 'utf8')

      expect(() => createReportFromFile(templatePath, { rows: [{}] }, { resources: { fileRoot: root } }))
        .toThrow('path is outside the authorized root')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('既定サブレポート解決はシンボリックリンク経由でルート外を読まない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    try {
      const root = join(dir, 'root')
      const templatePath = join(root, 'main.json')
      const linkedTemplatePath = join(root, 'linked.json')
      const outsideTemplatePath = join(dir, 'outside.json')
      const mainTemplate: ReportTemplate = {
        page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 80,
            elements: [{
              type: 'subreport',
              x: 0,
              y: 0,
              width: 180,
              height: 40,
              templateExpression: "'linked.json'",
            }],
          }],
        },
      }
      const outsideTemplate: ReportTemplate = {
        page: { width: 200, height: 120, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [] },
      }

      mkdirSync(root)
      writeFileSync(templatePath, JSON.stringify(mainTemplate), 'utf8')
      writeFileSync(outsideTemplatePath, JSON.stringify(outsideTemplate), 'utf8')
      symlinkSync(outsideTemplatePath, linkedTemplatePath)

      expect(() => createReportFromFile(templatePath, { rows: [{}] }, { resources: { fileRoot: root } }))
        .toThrow('path is outside the authorized root')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('不正な file URL は TypeError ではなく missing として扱う', () => {
    expect(() => createReportFromFile('file:///%E0%A4%A', { rows: [{}] }))
      .toThrow('Template file not found')
  })

  it('権限エラーのサブレポートをmissingとして無警告スキップしない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    try {
      const mainPath = join(dir, 'main.json')
      const childPath = join(dir, 'child.json')
      const main: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'child.json'" }] }] },
      }
      const child: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [] },
      }
      writeFileSync(mainPath, JSON.stringify(main), 'utf8')
      writeFileSync(childPath, JSON.stringify(child), 'utf8')
      const actualFs = require('node:fs') as typeof import('node:fs')
      const canonicalChildPath = actualFs.realpathSync(childPath)
      const accessError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      const fs = {
        realpathSync(path: string): string { return actualFs.realpathSync(path) },
        statSync(path: string): { isDirectory(): boolean } { return actualFs.statSync(path) },
        readFileSync(path: string, encoding?: 'utf8'): Uint8Array | string {
          if (path === canonicalChildPath) throw accessError
          return encoding === 'utf8' ? actualFs.readFileSync(path, encoding) : actualFs.readFileSync(path)
        },
      }
      const runtime: NodeRuntimeBridge = {
        require(specifier): unknown { return specifier === 'node:fs' ? fs : require(specifier) },
        execPath: process.execPath,
        randomFill(): void {},
      }
      installNodeRuntime(runtime)
      expect(() => createReportFromFile(mainPath, { rows: [{}] })).toThrow('permission denied')
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fileRootをメイン読込と画像resolverで二重canonical化しない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    try {
      const mainPath = join(dir, 'main.json')
      const main: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [] }] },
      }
      writeFileSync(mainPath, JSON.stringify(main), 'utf8')
      const actualFs = require('node:fs') as typeof import('node:fs')
      let rootRealpathCalls = 0
      const fs = {
        realpathSync(path: string): string {
          if (path === dir) rootRealpathCalls++
          return actualFs.realpathSync(path)
        },
        statSync(path: string): { isDirectory(): boolean } { return actualFs.statSync(path) },
        readFileSync(path: string, encoding?: 'utf8'): Uint8Array | string {
          return encoding === 'utf8' ? actualFs.readFileSync(path, encoding) : actualFs.readFileSync(path)
        },
      }
      const runtime: NodeRuntimeBridge = {
        require(specifier): unknown { return specifier === 'node:fs' ? fs : require(specifier) },
        execPath: process.execPath,
        randomFill(): void {},
      }
      installNodeRuntime(runtime)
      createReportFromFile(mainPath, { rows: [{}] }, { resources: { fileRoot: dir } })
      expect(rootRealpathCalls).toBe(1)
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('欠損subreport参照をworkingDirectory修飾で負キャッシュする', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    try {
      const mainPath = join(dir, 'main.json')
      const main: ReportTemplate = {
        page: { width: 100, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'missing.json'" }] }] },
      }
      writeFileSync(mainPath, JSON.stringify(main), 'utf8')
      const actualFs = require('node:fs') as typeof import('node:fs')
      let missingRealpathCalls = 0
      const fs = {
        realpathSync(path: string): string {
          if (path.endsWith('/missing.json')) missingRealpathCalls++
          return actualFs.realpathSync(path)
        },
        statSync(path: string): { isDirectory(): boolean } { return actualFs.statSync(path) },
        readFileSync(path: string, encoding?: 'utf8'): Uint8Array | string {
          return encoding === 'utf8' ? actualFs.readFileSync(path, encoding) : actualFs.readFileSync(path)
        },
      }
      installNodeRuntime({
        require(specifier): unknown { return specifier === 'node:fs' ? fs : require(specifier) },
        execPath: process.execPath,
        randomFill(): void {},
      })
      createReportFromFile(mainPath, { rows: [{}, {}, {}, {}, {}] })
      expect(missingRealpathCalls).toBe(1)
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('解決済みsubreportのworkingDirectoryと返却オブジェクトを行間で再利用する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-create-from-file-'))
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    try {
      const mainPath = join(dir, 'main.json')
      const childPath = join(dir, 'child.json')
      const main: ReportTemplate = {
        page: { width: 100, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [{ height: 20, elements: [{ type: 'subreport', x: 0, y: 0, width: 20, height: 20, templateExpression: "'child.json'" }] }] },
      }
      const child: ReportTemplate = {
        page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: { details: [] },
      }
      writeFileSync(mainPath, JSON.stringify(main), 'utf8')
      writeFileSync(childPath, JSON.stringify(child), 'utf8')
      const actualPath = require('node:path') as typeof import('node:path')
      let dirnameCalls = 0
      const path = {
        dirname(value: string): string {
          dirnameCalls++
          return actualPath.dirname(value)
        },
        isAbsolute(value: string): boolean { return actualPath.isAbsolute(value) },
        relative(from: string, to: string): string { return actualPath.relative(from, to) },
        resolve(...values: string[]): string { return actualPath.resolve(...values) },
        sep: actualPath.sep,
      }
      installNodeRuntime({
        require(specifier): unknown { return specifier === 'node:path' ? path : require(specifier) },
        execPath: process.execPath,
        randomFill(): void {},
      })
      createReportFromFile(mainPath, { rows: [{}, {}, {}, {}, {}] })
      expect(dirnameCalls).toBe(2)
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
