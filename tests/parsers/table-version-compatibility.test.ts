import { describe, expect, it } from 'vitest'
import { SfntTableManager } from '../../src/parsers/ttf-parser.js'

function managerFor(tag: string, bytes: Uint8Array, sfntVersion = 0x00010000): SfntTableManager {
  return new SfntTableManager({
    format: sfntVersion === 0x4F54544F ? 'otf' : 'ttf',
    sfntVersion,
    tableDirectory: new Map([[tag, { tag, checksum: 0, offset: 0, length: bytes.byteLength }]]),
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    offsetInBuffer: 0,
  })
}

describe('table major-version dispatch', () => {
  it('treats an optional table with an unknown major version as absent', () => {
    const manager = managerFor('GPOS', new Uint8Array([0, 2, 0, 0]))
    expect(manager.gpos).toBeNull()
  })

  it('reports a required table with an unknown major version as missing', () => {
    const manager = managerFor('head', new Uint8Array([0, 2, 0, 0]))
    expect(() => manager.head).toThrow("Required table 'head' not found")
  })

  it('does not select an unknown CFF2 major version as an outline source', () => {
    const manager = managerFor('CFF2', new Uint8Array([3, 0, 5, 0, 0]), 0x4F54544F)
    expect(manager.isCff2).toBe(false)
    expect(manager.cff2).toBeNull()
  })

  it('ignores a custom table while parsing a standard table', () => {
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 1)
    view.setUint16(2, 0)
    view.setUint16(4, 10)
    view.setUint16(6, 12)
    view.setUint16(8, 14)
    const manager = managerFor('GPOS', bytes)
    manager.sfnt.tableDirectory.set('XTSR', { tag: 'XTSR', checksum: 0, offset: 16, length: 4 })
    expect(manager.gpos).not.toBeNull()
    expect(manager.sfnt.tableDirectory.has('XTSR')).toBe(true)
  })
})
