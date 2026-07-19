import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseSvg } from '../../../src/parsers/tables/svg.js'
import { gzipSync } from 'node:zlib'

/**
 * Build a synthetic SVG table
 */
function buildSvgTable(
  entries: { startGlyphID: number; endGlyphID: number; svgDoc: string | Uint8Array }[],
): ArrayBuffer {
  const encoder = new TextEncoder()
  const encodedDocs = entries.map(e => typeof e.svgDoc === 'string' ? encoder.encode(e.svgDoc) : e.svgDoc)

  // Header: version(2) + svgDocumentListOffset(4) + reserved(4) = 10
  // SVGDocumentList: numEntries(2) + entries(10 each) + data
  const headerSize = 10
  const docListStart = headerSize
  const numEntries = entries.length
  const entriesSize = numEntries * 12 // startGlyphID(2) + endGlyphID(2) + svgDocOffset(4) + svgDocLength(4)
  const dataStart = 2 + entriesSize // relative to docListStart

  let totalDataSize = 0
  for (const doc of encodedDocs) totalDataSize += doc.length

  const totalSize = docListStart + 2 + entriesSize + totalDataSize
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  // Header
  view.setUint16(pos, 0); pos += 2 // version
  view.setUint32(pos, docListStart); pos += 4
  view.setUint32(pos, 0); pos += 4

  // SVGDocumentList
  view.setUint16(pos, numEntries); pos += 2

  let dataOffset = dataStart
  for (let i = 0; i < numEntries; i++) {
    view.setUint16(pos, entries[i]!.startGlyphID); pos += 2
    view.setUint16(pos, entries[i]!.endGlyphID); pos += 2
    view.setUint32(pos, dataOffset); pos += 4
    view.setUint32(pos, encodedDocs[i]!.length); pos += 4
    dataOffset += encodedDocs[i]!.length
  }

  // SVG document data
  for (const doc of encodedDocs) {
    new Uint8Array(buf).set(doc, pos)
    pos += doc.length
  }

  return buf
}

describe('SVG table parser', () => {
  it('should parse a single SVG document', () => {
    const svgDoc = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
    const buf = buildSvgTable([{ startGlyphID: 10, endGlyphID: 10, svgDoc }])
    const svg = parseSvg(new BinaryReader(buf))

    expect(svg.hasSvgDocument(10)).toBe(true)
    expect(svg.getSvgDocument(10)).toBe(svgDoc)
  })

  it('should handle glyph range', () => {
    const svgDoc = '<svg><rect/></svg>'
    const buf = buildSvgTable([{ startGlyphID: 5, endGlyphID: 10, svgDoc }])
    const svg = parseSvg(new BinaryReader(buf))

    expect(svg.hasSvgDocument(5)).toBe(true)
    expect(svg.hasSvgDocument(7)).toBe(true)
    expect(svg.hasSvgDocument(10)).toBe(true)
    expect(svg.getSvgDocument(7)).toBe(svgDoc)
  })

  it('should return null for glyphs without SVG', () => {
    const buf = buildSvgTable([{ startGlyphID: 10, endGlyphID: 10, svgDoc: '<svg/>' }])
    const svg = parseSvg(new BinaryReader(buf))

    expect(svg.hasSvgDocument(9)).toBe(false)
    expect(svg.hasSvgDocument(11)).toBe(false)
    expect(svg.getSvgDocument(99)).toBeNull()
  })

  it('should handle multiple entries', () => {
    const buf = buildSvgTable([
      { startGlyphID: 1, endGlyphID: 5, svgDoc: '<svg id="a"/>' },
      { startGlyphID: 10, endGlyphID: 15, svgDoc: '<svg id="b"/>' },
    ])
    const svg = parseSvg(new BinaryReader(buf))

    expect(svg.getSvgDocument(3)).toBe('<svg id="a"/>')
    expect(svg.getSvgDocument(12)).toBe('<svg id="b"/>')
    expect(svg.getSvgDocument(7)).toBeNull()
  })

  it('rejects a document list with zero records', () => {
    const buf = buildSvgTable([])
    expect(() => parseSvg(new BinaryReader(buf))).toThrow(/at least one/)
  })

  it('should handle UTF-8 content', () => {
    const svgDoc = '<svg><text>日本語テスト</text></svg>'
    const buf = buildSvgTable([{ startGlyphID: 1, endGlyphID: 1, svgDoc }])
    const svg = parseSvg(new BinaryReader(buf))

    expect(svg.getSvgDocument(1)).toBe(svgDoc)
  })

  it('decodes a gzip SVG document with validated RFC 1952 framing', function () {
    const text = '<svg><path d="M0 0L1 1"/></svg>'
    const buf = buildSvgTable([{ startGlyphID: 2, endGlyphID: 2, svgDoc: Uint8Array.from(gzipSync(text)) }])
    expect(parseSvg(new BinaryReader(buf)).getSvgDocument(2)).toBe(text)
    const corrupt = new Uint8Array(buf.slice(0))
    corrupt[corrupt.length - 8] ^= 1
    expect(() => parseSvg(new BinaryReader(corrupt.buffer)).getSvgDocument(2)).toThrow('gzip data CRC')
  })

  it('rejects malformed headers, ranges, and record ordering', function () {
    const version = new Uint8Array(buildSvgTable([{ startGlyphID: 1, endGlyphID: 1, svgDoc: '<svg/>' }]))
    new DataView(version.buffer).setUint16(0, 1, false)
    new DataView(version.buffer).setUint32(6, 1, false)
    expect(parseSvg(new BinaryReader(version.buffer)).getSvgDocument(1)).toBe('<svg/>')
    const reserved = new Uint8Array(buildSvgTable([{ startGlyphID: 1, endGlyphID: 1, svgDoc: '<svg/>' }]))
    new DataView(reserved.buffer).setUint32(6, 1, false)
    expect(() => parseSvg(new BinaryReader(reserved.buffer))).toThrow('reserved')
    expect(() => parseSvg(new BinaryReader(buildSvgTable([
      { startGlyphID: 5, endGlyphID: 8, svgDoc: '<svg/>' },
      { startGlyphID: 8, endGlyphID: 9, svgDoc: '<svg/>' },
    ])))).toThrow('overlaps')
    const range = new Uint8Array(buildSvgTable([{ startGlyphID: 1, endGlyphID: 1, svgDoc: '<svg/>' }]))
    new DataView(range.buffer).setUint32(10 + 2 + 8, 0xffffffff, false)
    expect(() => parseSvg(new BinaryReader(range.buffer))).toThrow('out of bounds')
  })
})
