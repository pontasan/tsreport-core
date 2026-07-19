import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NodeLocalFileResolver,
} from '../src/node-file-resolver.js'
import {
  getNodeRuntimeBridge,
  installNodeRuntime,
  type NodeRuntimeBridge,
} from '../src/node-runtime-bridge.js'

describe('Node local file resolver', function () {
  it('normalizes the authorized root once and classifies EACCES as unavailable', function () {
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    let rootRealpathCalls = 0
    const accessError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const fs = {
      realpathSync(path: string): string {
        if (path === '/authorized') rootRealpathCalls++
        return path
      },
      statSync(): { isDirectory(): boolean } {
        return { isDirectory() { return true } }
      },
      readFileSync(): never {
        throw accessError
      },
    }
    const runtime: NodeRuntimeBridge = {
      require(specifier): unknown {
        return specifier === 'node:fs' ? fs : require(specifier)
      },
      execPath: process.execPath,
      randomFill(): void {},
    }

    try {
      installNodeRuntime(runtime)
      const resolver = new NodeLocalFileResolver('/authorized')
      expect(resolver.resolve('one.png', '/authorized', 'image')).toEqual({ status: 'found', path: '/authorized/one.png' })
      expect(resolver.resolve('two.png', '/authorized', 'image')).toEqual({ status: 'found', path: '/authorized/two.png' })
      expect(rootRealpathCalls).toBe(1)
      expect(resolver.readBytes('/authorized/one.png')).toBeNull()
      expect(() => resolver.readText('/authorized/template.json')).toThrow('permission denied')
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      else delete (globalThis as Record<symbol, NodeRuntimeBridge | undefined>)[Symbol.for('tsreport-core.node-runtime')]
    }
  })

  it('authorizes a missing file through the canonical form of a symlinked working directory', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-resolver-symlink-'))
    try {
      const canonicalRoot = join(dir, 'canonical')
      const linkedRoot = join(dir, 'linked')
      mkdirSync(canonicalRoot)
      symlinkSync(canonicalRoot, linkedRoot)
      const resolver = new NodeLocalFileResolver(canonicalRoot)
      expect(resolver.resolve('missing.png', linkedRoot, 'image')).toEqual({ status: 'missing' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a POSIX absolute path containing a colon', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tsreport-resolver-colon-'))
    try {
      const timestampDirectory = join(dir, '2026-07-18T12:30:00')
      const file = join(timestampDirectory, 'logo.png')
      mkdirSync(timestampDirectory)
      writeFileSync(file, new Uint8Array([1]))
      const resolver = new NodeLocalFileResolver(dir)
      expect(resolver.resolve(file, dir, 'image')).toEqual({ status: 'found', path: realpathSync(file) })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('classifies a Windows absolute reference as missing under POSIX path semantics', function () {
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    let realpathCalls = 0
    const fs = {
      realpathSync(path: string): string {
        realpathCalls++
        return path
      },
      statSync(): { isDirectory(): boolean } {
        return { isDirectory() { return true } }
      },
      readFileSync(): Uint8Array {
        return new Uint8Array(0)
      },
    }
    try {
      installNodeRuntime({
        require(specifier): unknown {
          if (specifier === 'node:fs') return fs
          if (specifier === 'node:path') return posix
          return require(specifier)
        },
        execPath: process.execPath,
        randomFill(): void {},
      })
      const resolver = new NodeLocalFileResolver('/authorized')
      expect(resolver.resolve('C:/assets/logo.png', '/authorized', 'image')).toEqual({ status: 'missing' })
      expect(realpathCalls).toBe(1)
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      else delete (globalThis as Record<symbol, NodeRuntimeBridge | undefined>)[Symbol.for('tsreport-core.node-runtime')]
    }
  })

  it('does not leak a raw ENOENT when an unavailable Windows drive is outside fileRoot', function () {
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    const unavailable = Object.assign(new Error('drive not found'), { code: 'ENOENT' })
    const fs = {
      realpathSync(path: string): string {
        if (path === 'D:\\authorized') return path
        if (path.startsWith('C:\\')) throw unavailable
        return path
      },
      statSync(): { isDirectory(): boolean } {
        return { isDirectory() { return true } }
      },
      readFileSync(): Uint8Array {
        return new Uint8Array(0)
      },
    }
    try {
      installNodeRuntime({
        require(specifier): unknown {
          if (specifier === 'node:fs') return fs
          if (specifier === 'node:path') return win32
          return require(specifier)
        },
        execPath: process.execPath,
        randomFill(): void {},
      })
      const resolver = new NodeLocalFileResolver('D:\\authorized')
      expect(function (): void {
        resolver.resolve('C:\\assets\\logo.png', 'D:\\authorized', 'image')
      }).toThrow('path is outside the authorized root')
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      else delete (globalThis as Record<symbol, NodeRuntimeBridge | undefined>)[Symbol.for('tsreport-core.node-runtime')]
    }
  })

  it('classifies a realpath permission error only as an unavailable image', function () {
    const previous = getNodeRuntimeBridge()
    const require = createRequire(import.meta.url)
    const accessError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const fs = {
      realpathSync(path: string): string {
        if (path === '/authorized') return path
        if (path === '/authorized/secret') throw accessError
        return '/authorized'
      },
      statSync(): { isDirectory(): boolean } {
        return { isDirectory() { return true } }
      },
      readFileSync(): Uint8Array {
        return new Uint8Array(0)
      },
    }
    const runtime: NodeRuntimeBridge = {
      require(specifier): unknown {
        return specifier === 'node:fs' ? fs : require(specifier)
      },
      execPath: process.execPath,
      randomFill(): void {},
    }

    try {
      installNodeRuntime(runtime)
      const resolver = new NodeLocalFileResolver('/authorized')
      expect(resolver.resolve('secret', '/authorized', 'image')).toEqual({ status: 'missing' })
      expect(() => resolver.resolve('secret', '/authorized', 'template')).toThrow('permission denied')
    } finally {
      if (previous !== null) installNodeRuntime(previous)
      else delete (globalThis as Record<symbol, NodeRuntimeBridge | undefined>)[Symbol.for('tsreport-core.node-runtime')]
    }
  })
})
