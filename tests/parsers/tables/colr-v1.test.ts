import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseColr } from '../../../src/parsers/tables/colr.js'
import { subsetColrTable } from '../../../src/subset/colr-subset.js'
import type {
  PaintSolid,
  PaintGlyph,
  PaintColrLayers,
  PaintLinearGradient,
  PaintRadialGradient,
  PaintSweepGradient,
  PaintTransform,
  PaintTranslate,
  PaintScale,
  PaintScaleAroundCenter,
  PaintRotate,
  PaintRotateAroundCenter,
  PaintSkew,
  PaintComposite,
  PaintColrGlyph,
  PaintScaleUniform,
  PaintSkewAroundCenter,
} from '../../../src/parsers/tables/colr.js'

/** Helper: write Offset24 (big-endian) into a DataView */
function writeOffset24(view: DataView, pos: number, value: number): void {
  view.setUint8(pos, (value >> 16) & 0xFF)
  view.setUint8(pos + 1, (value >> 8) & 0xFF)
  view.setUint8(pos + 2, value & 0xFF)
}

/** Helper: write F2Dot14 */
function writeF2Dot14(view: DataView, pos: number, value: number): void {
  const raw = Math.round(value * (1 << 14))
  view.setInt16(pos, raw)
}

/** Helper: write Fixed (16.16) */
function writeFixed(view: DataView, pos: number, value: number): void {
  const raw = Math.round(value * (1 << 16))
  view.setInt32(pos, raw)
}

/**
 * Build a minimal COLR v0 table
 */
function buildColrV0(
  baseGlyphs: { glyphId: number, firstLayerIndex: number, numLayers: number }[],
  layers: { glyphId: number, paletteIndex: number }[],
): ArrayBuffer {
  // Header: 14 bytes
  const headerSize = 14
  const baseGlyphRecordsOffset = headerSize
  const baseGlyphRecordSize = 6 // uint16 * 3
  const layerRecordsOffset = baseGlyphRecordsOffset + baseGlyphs.length * baseGlyphRecordSize
  const layerRecordSize = 4 // uint16 * 2
  const totalSize = layerRecordsOffset + layers.length * layerRecordSize

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, 0); pos += 2 // version
  view.setUint16(pos, baseGlyphs.length); pos += 2
  view.setUint32(pos, baseGlyphRecordsOffset); pos += 4
  view.setUint32(pos, layerRecordsOffset); pos += 4
  view.setUint16(pos, layers.length); pos += 2

  for (const bg of baseGlyphs) {
    view.setUint16(pos, bg.glyphId); pos += 2
    view.setUint16(pos, bg.firstLayerIndex); pos += 2
    view.setUint16(pos, bg.numLayers); pos += 2
  }

  for (const layer of layers) {
    view.setUint16(pos, layer.glyphId); pos += 2
    view.setUint16(pos, layer.paletteIndex); pos += 2
  }

  return buf
}

/**
 * Build a COLR v1 table with specific paint structure.
 * Paint data is written at specified offsets within paintArea.
 */
function buildColrV1(opts: {
  v0BaseGlyphs?: { glyphId: number, firstLayerIndex: number, numLayers: number }[]
  v0Layers?: { glyphId: number, paletteIndex: number }[]
  baseGlyphPaintRecords: { glyphId: number, paintOffset: number }[]
  layerPaintOffsets?: number[]
  clipRecords?: { startGlyphID: number, endGlyphID: number, clipBoxOffset: number }[]
  /** Raw bytes for paint area, appended after the structural data */
  paintAreaWriter?: (view: DataView, paintAreaStart: number) => void
  /** Raw bytes for clip box area */
  clipAreaWriter?: (view: DataView, clipAreaStart: number) => void
}): ArrayBuffer {
  const buf = new ArrayBuffer(4096)
  const view = new DataView(buf)
  let pos = 0

  const v0BaseGlyphs = opts.v0BaseGlyphs ?? []
  const v0Layers = opts.v0Layers ?? []

  // v0 header (14 bytes)
  view.setUint16(pos, 1); pos += 2 // version = 1
  view.setUint16(pos, v0BaseGlyphs.length); pos += 2

  const baseGlyphRecordsOffsetPos = pos; pos += 4
  const layerRecordsOffsetPos = pos; pos += 4
  view.setUint16(pos, v0Layers.length); pos += 2

  // v1 header extension (5 * uint32 = 20 bytes)
  const baseGlyphListOffsetPos = pos; pos += 4
  const layerListOffsetPos = pos; pos += 4
  const clipListOffsetPos = pos; pos += 4
  pos += 4 // varIndexMapOffset = 0
  pos += 4 // itemVariationStoreOffset = 0

  // v0 BaseGlyphRecords
  if (v0BaseGlyphs.length > 0) {
    view.setUint32(baseGlyphRecordsOffsetPos, pos)
    for (const bg of v0BaseGlyphs) {
      view.setUint16(pos, bg.glyphId); pos += 2
      view.setUint16(pos, bg.firstLayerIndex); pos += 2
      view.setUint16(pos, bg.numLayers); pos += 2
    }
  }

  // v0 LayerRecords
  if (v0Layers.length > 0) {
    view.setUint32(layerRecordsOffsetPos, pos)
    for (const layer of v0Layers) {
      view.setUint16(pos, layer.glyphId); pos += 2
      view.setUint16(pos, layer.paletteIndex); pos += 2
    }
  }

  // BaseGlyphList
  const baseGlyphListStart = pos
  view.setUint32(baseGlyphListOffsetPos, baseGlyphListStart)
  view.setUint32(pos, opts.baseGlyphPaintRecords.length); pos += 4
  for (const rec of opts.baseGlyphPaintRecords) {
    view.setUint16(pos, rec.glyphId); pos += 2
    view.setUint32(pos, rec.paintOffset); pos += 4
  }

  // LayerList (optional)
  if (opts.layerPaintOffsets && opts.layerPaintOffsets.length > 0) {
    const layerListStart = pos
    view.setUint32(layerListOffsetPos, layerListStart)
    view.setUint32(pos, opts.layerPaintOffsets.length); pos += 4
    for (const off of opts.layerPaintOffsets) {
      view.setUint32(pos, off); pos += 4
    }
  }

  // ClipList (optional)
  if (opts.clipRecords && opts.clipRecords.length > 0) {
    const clipListStart = pos
    view.setUint32(clipListOffsetPos, clipListStart)
    view.setUint8(pos++, 1) // format = 1
    view.setUint32(pos, opts.clipRecords.length); pos += 4
    for (const clip of opts.clipRecords) {
      view.setUint16(pos, clip.startGlyphID); pos += 2
      view.setUint16(pos, clip.endGlyphID); pos += 2
      writeOffset24(view, pos, clip.clipBoxOffset); pos += 3
    }
    if (opts.clipAreaWriter) {
      opts.clipAreaWriter(view, clipListStart)
    }
  }

  // Paint area
  if (opts.paintAreaWriter) {
    opts.paintAreaWriter(view, baseGlyphListStart)
  }

  return buf.slice(0, Math.max(pos, 256))
}

describe('COLR v0', () => {
  // Verifies that a version-0 table exposes layer records via getColorLayers and that getPaintTree stays null (no v1 data).
  it('should parse v0 color layers', () => {
    const buf = buildColrV0(
      [{ glyphId: 10, firstLayerIndex: 0, numLayers: 2 }],
      [
        { glyphId: 11, paletteIndex: 0 },
        { glyphId: 12, paletteIndex: 1 },
      ],
    )
    const table = parseColr(new BinaryReader(buf))

    expect(table.version).toBe(0)
    const layers = table.getColorLayers(10)
    expect(layers).toEqual([
      { glyphId: 11, paletteIndex: 0 },
      { glyphId: 12, paletteIndex: 1 },
    ])
    expect(table.getColorLayers(99)).toBeNull()
    expect(table.getPaintTree(10)).toBeNull()
  })
})

describe('COLR v1', () => {
  // Verifies that a BaseGlyphList record resolves to a PaintSolid leaf with its paletteIndex and F2Dot14 alpha decoded.
  it('should parse PaintSolid (format 2)', () => {
    // BaseGlyphList starts at some offset. Paint at offset X from BaseGlyphList.
    // We need to calculate offsets carefully.
    // After v0 header (14) + v1 extension (20) = 34 bytes for headers
    // BaseGlyphList at 34: numRecords(4) + record(2+4) = 10 bytes, so paint data at 34+10 = 44
    // Paint offset from BaseGlyphList = 10 (after the single record)
    const paintOffsetFromBGL = 10 // 4(numRecords) + 6(one record)

    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    // v0 header
    view.setUint16(pos, 1); pos += 2 // version = 1
    view.setUint16(pos, 0); pos += 2 // numBaseGlyphRecords = 0
    view.setUint32(pos, 0); pos += 4 // baseGlyphRecordsOffset = 0
    view.setUint32(pos, 0); pos += 4 // layerRecordsOffset = 0
    view.setUint16(pos, 0); pos += 2 // numLayerRecords = 0

    // v1 extension
    const bglOffsetPos = pos
    view.setUint32(pos, 0); pos += 4 // baseGlyphListOffset (filled later)
    view.setUint32(pos, 0); pos += 4 // layerListOffset = 0
    view.setUint32(pos, 0); pos += 4 // clipListOffset = 0
    view.setUint32(pos, 0); pos += 4 // varIndexMapOffset = 0
    view.setUint32(pos, 0); pos += 4 // itemVariationStoreOffset = 0

    // BaseGlyphList
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    view.setUint32(pos, 1); pos += 4 // numRecords = 1
    view.setUint16(pos, 5); pos += 2 // glyphId = 5
    view.setUint32(pos, paintOffsetFromBGL); pos += 4 // paintOffset

    // PaintSolid (format 2) at bglStart + paintOffsetFromBGL
    const paintStart = bglStart + paintOffsetFromBGL
    expect(paintStart).toBe(pos) // should line up
    view.setUint8(pos++, 2) // format = 2
    view.setUint16(pos, 3); pos += 2 // paletteIndex = 3
    writeF2Dot14(view, pos, 0.75); pos += 2 // alpha = 0.75

    const table = parseColr(new BinaryReader(buf))
    expect(table.version).toBe(1)

    const tree = table.getPaintTree(5)
    expect(tree).not.toBeNull()
    expect(tree!.type).toBe('Solid')
    const solid = tree as PaintSolid
    expect(solid.format).toBe(2)
    expect(solid.paletteIndex).toBe(3)
    expect(Math.abs(solid.alpha - 0.75)).toBeLessThan(0.001)

    expect(table.getPaintTree(99)).toBeNull()
  })

  // Verifies that PaintGlyph resolves its Offset24 child paint (a PaintSolid) relative to the paint table start.
  it('should parse PaintGlyph (format 10) → PaintSolid', () => {
    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    // v0 header (14 bytes)
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2

    // v1 extension (20 bytes)
    const bglOffsetPos = pos
    view.setUint32(pos, 0); pos += 4 // baseGlyphListOffset
    view.setUint32(pos, 0); pos += 4 // layerListOffset
    view.setUint32(pos, 0); pos += 4 // clipListOffset
    view.setUint32(pos, 0); pos += 4 // varIndexMapOffset
    view.setUint32(pos, 0); pos += 4 // itemVariationStoreOffset

    // BaseGlyphList at pos
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6 // numRecords(4) + one record(6)
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 7); pos += 2 // glyphId = 7
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintGlyph (format 10) at bglStart + paintOffsetFromBGL
    const paintGlyphStart = pos
    view.setUint8(pos++, 10) // format = 10
    // Offset24 to child paint (PaintSolid) — relative to this paint table
    const childOffset = 6 // format(1) + offset24(3) + glyphId(2) = 6 bytes later
    writeOffset24(view, pos, childOffset); pos += 3
    view.setUint16(pos, 42); pos += 2 // glyphId = 42

    // PaintSolid (format 2) at paintGlyphStart + childOffset
    view.setUint8(pos++, 2) // format = 2
    view.setUint16(pos, 1); pos += 2 // paletteIndex = 1
    writeF2Dot14(view, pos, 1.0); pos += 2 // alpha = 1.0

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(7)
    expect(tree).not.toBeNull()
    expect(tree!.type).toBe('Glyph')
    const glyph = tree as PaintGlyph
    expect(glyph.glyphId).toBe(42)
    expect(glyph.paint.type).toBe('Solid')
    const childSolid = glyph.paint as PaintSolid
    expect(childSolid.paletteIndex).toBe(1)
  })

  // Verifies that PaintColrLayers resolves numLayers/firstLayerIndex through the shared LayerList into child paints.
  it('should parse PaintColrLayers (format 1) via LayerList', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    // v0 header
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2

    // v1 extension
    const bglOffsetPos = pos; pos += 4
    const llOffsetPos = pos; pos += 4
    pos += 4 // clipListOffset = 0
    pos += 4 // varIndexMapOffset = 0
    pos += 4 // itemVariationStoreOffset = 0

    // LayerList with 2 PaintSolid entries
    const llStart = pos
    view.setUint32(llOffsetPos, llStart)
    view.setUint32(pos, 2); pos += 4 // numLayers = 2

    // Each layer paint offset (Offset32 from LayerList start)
    const layer0OffsetPos = pos; pos += 4
    const layer1OffsetPos = pos; pos += 4

    // Layer 0: PaintSolid
    const layer0Start = pos - llStart
    view.setUint32(layer0OffsetPos, layer0Start)
    view.setUint8(pos++, 2) // format = 2 (PaintSolid)
    view.setUint16(pos, 0); pos += 2 // paletteIndex = 0
    writeF2Dot14(view, pos, 1.0); pos += 2 // alpha = 1.0

    // Layer 1: PaintSolid
    const layer1Start = pos - llStart
    view.setUint32(layer1OffsetPos, layer1Start)
    view.setUint8(pos++, 2) // format = 2 (PaintSolid)
    view.setUint16(pos, 2); pos += 2 // paletteIndex = 2
    writeF2Dot14(view, pos, 0.5); pos += 2 // alpha = 0.5

    // BaseGlyphList
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 3); pos += 2 // glyphId = 3
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintColrLayers (format 1)
    view.setUint8(pos++, 1) // format = 1
    view.setUint8(pos++, 2) // numLayers = 2
    view.setUint32(pos, 0); pos += 4 // firstLayerIndex = 0

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(3)
    expect(tree).not.toBeNull()
    expect(tree!.type).toBe('ColrLayers')
    const colrLayers = tree as PaintColrLayers
    expect(colrLayers.layers.length).toBe(2)
    expect(colrLayers.layers[0]!.type).toBe('Solid')
    expect((colrLayers.layers[0] as PaintSolid).paletteIndex).toBe(0)
    expect(colrLayers.layers[1]!.type).toBe('Solid')
    expect((colrLayers.layers[1] as PaintSolid).paletteIndex).toBe(2)

    const rebuilt = subsetColrTable(new BinaryReader(buf), table, new Set([3]))
    const rebuiltTree = parseColr(new BinaryReader(rebuilt.buffer)).getPaintTree(3) as PaintColrLayers
    expect(rebuiltTree.layers.map(function (layer) { return (layer as PaintSolid).paletteIndex })).toEqual([0, 2])
    expect(rebuilt.byteLength).toBeLessThan(buf.byteLength)
  })

  // Verifies that PaintLinearGradient decodes the three gradient points and its ColorLine (extend mode + stops).
  it('should parse PaintLinearGradient (format 4)', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    // v0 header
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2

    // v1 extension
    const bglOffsetPos = pos; pos += 4
    pos += 4 // layerListOffset = 0
    pos += 4 // clipListOffset = 0
    pos += 4 // varIndexMapOffset = 0
    pos += 4 // itemVariationStoreOffset = 0

    // BaseGlyphList
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 1); pos += 2 // glyphId = 1
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintLinearGradient (format 4)
    const paintStart = pos
    view.setUint8(pos++, 4) // format = 4
    // Offset24 to ColorLine — 16 bytes from paint start:
    // format(1) + colorLineOff(3) + x0(2) + y0(2) + x1(2) + y1(2) + x2(2) + y2(2) = 16
    writeOffset24(view, pos, 16); pos += 3
    view.setInt16(pos, 0); pos += 2 // x0
    view.setInt16(pos, 0); pos += 2 // y0
    view.setInt16(pos, 100); pos += 2 // x1
    view.setInt16(pos, 0); pos += 2 // y1
    view.setInt16(pos, 0); pos += 2 // x2
    view.setInt16(pos, 100); pos += 2 // y2

    // ColorLine at paintStart + 16
    view.setUint8(pos++, 0) // extend = PAD
    view.setUint16(pos, 2); pos += 2 // numStops = 2
    // Stop 0: offset=0.0, paletteIndex=0, alpha=1.0
    writeF2Dot14(view, pos, 0.0); pos += 2
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2
    // Stop 1: offset=1.0, paletteIndex=1, alpha=1.0
    writeF2Dot14(view, pos, 1.0); pos += 2
    view.setUint16(pos, 1); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(1)
    expect(tree).not.toBeNull()
    expect(tree!.type).toBe('LinearGradient')
    const lg = tree as PaintLinearGradient
    expect(lg.x0).toBe(0)
    expect(lg.y0).toBe(0)
    expect(lg.x1).toBe(100)
    expect(lg.y1).toBe(0)
    expect(lg.colorLine.extend).toBe(0) // PAD
    expect(lg.colorLine.stops.length).toBe(2)
    expect(lg.colorLine.stops[0]!.paletteIndex).toBe(0)
    expect(lg.colorLine.stops[1]!.paletteIndex).toBe(1)
  })

  // Verifies that PaintTransform reads the Affine2x3 matrix (Fixed 16.16 fields) via its own Offset24 and wraps the child paint.
  it('should parse PaintTransform (format 12) with Affine2x3', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    // v0 header
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2

    // v1 extension
    const bglOffsetPos = pos; pos += 4
    pos += 16 // other v1 offsets = 0

    // BaseGlyphList
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 2); pos += 2 // glyphId = 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintTransform (format 12)
    const paintStart = pos
    view.setUint8(pos++, 12) // format = 12
    // Offset24 to child paint: format(1) + paintOff(3) + transformOff(3) = 7
    // Child PaintSolid is after the Affine2x3: 7 + 24 = 31
    writeOffset24(view, pos, 31); pos += 3
    // Offset24 to Affine2x3: 7 bytes from paint start
    writeOffset24(view, pos, 7); pos += 3

    // Affine2x3 at paintStart + 7 (24 bytes)
    writeFixed(view, pos, 1.0); pos += 4 // xx = 1.0
    writeFixed(view, pos, 0.0); pos += 4 // yx = 0.0
    writeFixed(view, pos, 0.0); pos += 4 // xy = 0.0
    writeFixed(view, pos, 1.0); pos += 4 // yy = 1.0
    writeFixed(view, pos, 10.0); pos += 4 // dx = 10.0
    writeFixed(view, pos, 20.0); pos += 4 // dy = 20.0

    // Child PaintSolid at paintStart + 31
    view.setUint8(pos++, 2) // format = 2
    view.setUint16(pos, 5); pos += 2 // paletteIndex = 5
    writeF2Dot14(view, pos, 1.0); pos += 2 // alpha = 1.0

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(2)
    expect(tree).not.toBeNull()
    expect(tree!.type).toBe('Transform')
    const xform = tree as PaintTransform
    expect(Math.abs(xform.transform.xx - 1.0)).toBeLessThan(0.001)
    expect(Math.abs(xform.transform.yy - 1.0)).toBeLessThan(0.001)
    expect(Math.abs(xform.transform.dx - 10.0)).toBeLessThan(0.001)
    expect(Math.abs(xform.transform.dy - 20.0)).toBeLessThan(0.001)
    expect(xform.paint.type).toBe('Solid')
  })

  // Verifies that PaintTranslate reads signed dx/dy (including negative values) and its child paint.
  it('should parse PaintTranslate (format 14)', () => {
    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    // v0+v1 header
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    // BaseGlyphList
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 4); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintTranslate (format 14)
    const paintStart = pos
    view.setUint8(pos++, 14) // format = 14
    // Child paint at: format(1) + off24(3) + dx(2) + dy(2) = 8
    writeOffset24(view, pos, 8); pos += 3
    view.setInt16(pos, 50); pos += 2 // dx = 50
    view.setInt16(pos, -30); pos += 2 // dy = -30

    // Child PaintSolid
    view.setUint8(pos++, 2)
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(4)
    expect(tree).not.toBeNull()
    expect(tree!.type).toBe('Translate')
    const tr = tree as PaintTranslate
    expect(tr.dx).toBe(50)
    expect(tr.dy).toBe(-30)
    expect(tr.paint.type).toBe('Solid')
  })

  // Verifies that PaintScale decodes independent scaleX/scaleY F2Dot14 factors.
  it('should parse PaintScale (format 16)', () => {
    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    // v0+v1 header
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 6); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintScale (format 16)
    const paintStart = pos
    view.setUint8(pos++, 16)
    // Child at: 1 + 3 + 2 + 2 = 8
    writeOffset24(view, pos, 8); pos += 3
    writeF2Dot14(view, pos, 1.5); pos += 2 // scaleX
    writeF2Dot14(view, pos, 0.5); pos += 2 // scaleY

    // Child PaintSolid
    view.setUint8(pos++, 2)
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(6)
    expect(tree!.type).toBe('Scale')
    const sc = tree as PaintScale
    expect(Math.abs(sc.scaleX - 1.5)).toBeLessThan(0.01)
    expect(Math.abs(sc.scaleY - 0.5)).toBeLessThan(0.01)
  })

  // Verifies that PaintRotateAroundCenter decodes the F2Dot14 angle plus the int16 center point.
  it('should parse PaintRotateAroundCenter (format 26)', () => {
    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 8); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintRotateAroundCenter (format 26)
    view.setUint8(pos++, 26)
    // Child at: 1 + 3 + 2 + 2 + 2 = 10
    writeOffset24(view, pos, 10); pos += 3
    writeF2Dot14(view, pos, 0.25); pos += 2 // angle = 0.25 (90 degrees in turns)
    view.setInt16(pos, 500); pos += 2 // centerX
    view.setInt16(pos, 500); pos += 2 // centerY

    // Child PaintSolid
    view.setUint8(pos++, 2)
    view.setUint16(pos, 2); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(8)
    expect(tree!.type).toBe('RotateAroundCenter')
    const rot = tree as PaintRotateAroundCenter
    expect(Math.abs(rot.angle - 0.25)).toBeLessThan(0.01)
    expect(rot.centerX).toBe(500)
    expect(rot.centerY).toBe(500)
  })

  // Verifies that PaintComposite resolves both source and backdrop subtrees and keeps the composite mode (SRC_OVER).
  it('should parse PaintComposite (format 32)', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 9); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintComposite (format 32)
    const paintStart = pos
    view.setUint8(pos++, 32)
    // sourceOff (Offset24): format(1) + sourceOff(3) + mode(1) + backdropOff(3) = 8
    // Source PaintSolid at paintStart + 8
    writeOffset24(view, pos, 8); pos += 3
    view.setUint8(pos++, 3) // compositeMode = SRC_OVER
    // backdropOff: backdrop PaintSolid at paintStart + 8 + 5 = paintStart + 13
    writeOffset24(view, pos, 13); pos += 3

    // Source PaintSolid
    view.setUint8(pos++, 2)
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    // Backdrop PaintSolid
    view.setUint8(pos++, 2)
    view.setUint16(pos, 1); pos += 2
    writeF2Dot14(view, pos, 0.5); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(9)
    expect(tree!.type).toBe('Composite')
    const comp = tree as PaintComposite
    expect(comp.compositeMode).toBe(3) // SRC_OVER
    expect(comp.source.type).toBe('Solid')
    expect((comp.source as PaintSolid).paletteIndex).toBe(0)
    expect(comp.backdrop.type).toBe('Solid')
    expect((comp.backdrop as PaintSolid).paletteIndex).toBe(1)
  })

  // Verifies that getClipBox returns the format-1 box for every glyph in a clip record's [start, end] range and null outside it.
  it('should parse ClipList with ClipBox format 1', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    // v0 header
    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2

    // v1 extension
    const bglOffsetPos = pos; pos += 4
    pos += 4 // layerListOffset = 0
    const clipListOffsetPos = pos; pos += 4
    pos += 4 // varIndexMapOffset = 0
    pos += 4 // itemVariationStoreOffset = 0

    // BaseGlyphList (needed for valid v1 table)
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 10); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintSolid for glyphId 10
    view.setUint8(pos++, 2)
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    // ClipList
    const clipListStart = pos
    view.setUint32(clipListOffsetPos, clipListStart)
    view.setUint8(pos++, 1) // format = 1
    view.setUint32(pos, 1); pos += 4 // numClips = 1
    view.setUint16(pos, 10); pos += 2 // startGlyphID
    view.setUint16(pos, 12); pos += 2 // endGlyphID
    // clipBoxOffset (Offset24 from clipListStart)
    const clipBoxOffset = pos + 3 - clipListStart
    writeOffset24(view, pos, clipBoxOffset); pos += 3

    // ClipBox format 1
    view.setUint8(pos++, 1) // format = 1
    view.setInt16(pos, -100); pos += 2 // xMin
    view.setInt16(pos, -200); pos += 2 // yMin
    view.setInt16(pos, 800); pos += 2 // xMax
    view.setInt16(pos, 900); pos += 2 // yMax

    const table = parseColr(new BinaryReader(buf))

    const clip10 = table.getClipBox(10)
    expect(clip10).not.toBeNull()
    expect(clip10!.xMin).toBe(-100)
    expect(clip10!.yMin).toBe(-200)
    expect(clip10!.xMax).toBe(800)
    expect(clip10!.yMax).toBe(900)

    // glyphId 11 is in the same range
    const clip11 = table.getClipBox(11)
    expect(clip11).not.toBeNull()
    expect(clip11!.xMin).toBe(-100)

    // glyphId 13 is outside
    expect(table.getClipBox(13)).toBeNull()
  })

  // Verifies that PaintColrGlyph keeps the referenced base glyph ID as an indirection (resolved later by the renderer).
  it('should parse PaintColrGlyph (format 11)', () => {
    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 20); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintColrGlyph (format 11)
    view.setUint8(pos++, 11)
    view.setUint16(pos, 30); pos += 2 // glyphId = 30

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(20)
    expect(tree!.type).toBe('ColrGlyph')
    expect((tree as PaintColrGlyph).glyphId).toBe(30)
  })

  // Verifies that PaintSkew decodes xSkewAngle/ySkewAngle as F2Dot14 values.
  it('should parse PaintSkew (format 28)', () => {
    const buf = new ArrayBuffer(256)
    const view = new DataView(buf)
    let pos = 0

    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 15); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintSkew (format 28)
    view.setUint8(pos++, 28)
    // Child at: 1 + 3 + 2 + 2 = 8
    writeOffset24(view, pos, 8); pos += 3
    writeF2Dot14(view, pos, 0.125); pos += 2 // xSkewAngle
    writeF2Dot14(view, pos, 0.0); pos += 2 // ySkewAngle

    // Child PaintSolid
    view.setUint8(pos++, 2)
    view.setUint16(pos, 3); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(15)
    expect(tree!.type).toBe('Skew')
    const skew = tree as PaintSkew
    expect(Math.abs(skew.xSkewAngle - 0.125)).toBeLessThan(0.01)
    expect(Math.abs(skew.ySkewAngle)).toBeLessThan(0.01)
  })

  // Verifies that PaintRadialGradient decodes both circles (center + radius each) and a REPEAT-extend ColorLine.
  it('should parse PaintRadialGradient (format 6)', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 11); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintRadialGradient (format 6)
    const paintStart = pos
    view.setUint8(pos++, 6)
    // ColorLine offset: 1 + 3 + 2*4 + 2*2 = 16 bytes from paint start
    writeOffset24(view, pos, 16); pos += 3
    view.setInt16(pos, 100); pos += 2 // x0
    view.setInt16(pos, 100); pos += 2 // y0
    view.setUint16(pos, 10); pos += 2 // r0
    view.setInt16(pos, 200); pos += 2 // x1
    view.setInt16(pos, 200); pos += 2 // y1
    view.setUint16(pos, 50); pos += 2 // r1

    // ColorLine
    view.setUint8(pos++, 1) // extend = REPEAT
    view.setUint16(pos, 2); pos += 2
    writeF2Dot14(view, pos, 0.0); pos += 2
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2
    view.setUint16(pos, 1); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(11)
    expect(tree!.type).toBe('RadialGradient')
    const rg = tree as PaintRadialGradient
    expect(rg.x0).toBe(100)
    expect(rg.r0).toBe(10)
    expect(rg.r1).toBe(50)
    expect(rg.colorLine.extend).toBe(1) // REPEAT
    expect(rg.colorLine.stops.length).toBe(2)
  })

  // Verifies that PaintSweepGradient decodes the center, start/end angles, and a REFLECT-extend ColorLine.
  it('should parse PaintSweepGradient (format 8)', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    view.setUint16(pos, 1); pos += 2
    view.setUint16(pos, 0); pos += 2
    view.setUint32(pos, 0); pos += 4
    view.setUint32(pos, 0); pos += 4
    view.setUint16(pos, 0); pos += 2
    const bglOffsetPos = pos; pos += 4
    pos += 16

    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 13); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintSweepGradient (format 8)
    const paintStart = pos
    view.setUint8(pos++, 8)
    // ColorLine at: 1 + 3 + 2 + 2 + 2 + 2 = 12
    writeOffset24(view, pos, 12); pos += 3
    view.setInt16(pos, 300); pos += 2 // centerX
    view.setInt16(pos, 300); pos += 2 // centerY
    writeF2Dot14(view, pos, 0.0); pos += 2 // startAngle
    writeF2Dot14(view, pos, 1.0); pos += 2 // endAngle

    // ColorLine
    view.setUint8(pos++, 2) // extend = REFLECT
    view.setUint16(pos, 1); pos += 2
    writeF2Dot14(view, pos, 0.5); pos += 2
    view.setUint16(pos, 0); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))
    const tree = table.getPaintTree(13)
    expect(tree!.type).toBe('SweepGradient')
    const sg = tree as PaintSweepGradient
    expect(sg.centerX).toBe(300)
    expect(sg.centerY).toBe(300)
    expect(sg.colorLine.extend).toBe(2) // REFLECT
  })

  // Verifies that a version-1 table keeps v0 layer records and v1 paint trees independent: each lookup only hits its own record set.
  it('should coexist v0 and v1 data', () => {
    const buf = new ArrayBuffer(512)
    const view = new DataView(buf)
    let pos = 0

    // v0 header with some v0 data
    view.setUint16(pos, 1); pos += 2 // version = 1
    view.setUint16(pos, 1); pos += 2 // numBaseGlyphRecords = 1

    const v0BaseRecOffsetPos = pos; pos += 4
    const v0LayerRecOffsetPos = pos; pos += 4
    view.setUint16(pos, 2); pos += 2 // numLayerRecords = 2

    // v1 extension
    const bglOffsetPos = pos; pos += 4
    pos += 16

    // v0 BaseGlyphRecords
    view.setUint32(v0BaseRecOffsetPos, pos)
    view.setUint16(pos, 100); pos += 2 // glyphId
    view.setUint16(pos, 0); pos += 2 // firstLayerIndex
    view.setUint16(pos, 2); pos += 2 // numLayers

    // v0 LayerRecords
    view.setUint32(v0LayerRecOffsetPos, pos)
    view.setUint16(pos, 101); pos += 2; view.setUint16(pos, 0); pos += 2
    view.setUint16(pos, 102); pos += 2; view.setUint16(pos, 1); pos += 2

    // BaseGlyphList (v1)
    const bglStart = pos
    view.setUint32(bglOffsetPos, bglStart)
    const paintOffsetFromBGL = 4 + 6
    view.setUint32(pos, 1); pos += 4
    view.setUint16(pos, 200); pos += 2
    view.setUint32(pos, paintOffsetFromBGL); pos += 4

    // PaintSolid for v1 glyphId 200
    view.setUint8(pos++, 2)
    view.setUint16(pos, 5); pos += 2
    writeF2Dot14(view, pos, 1.0); pos += 2

    const table = parseColr(new BinaryReader(buf))

    // v0 access
    const v0layers = table.getColorLayers(100)
    expect(v0layers).not.toBeNull()
    expect(v0layers!.length).toBe(2)
    expect(v0layers![0]!.glyphId).toBe(101)

    // v1 access
    const v1tree = table.getPaintTree(200)
    expect(v1tree).not.toBeNull()
    expect(v1tree!.type).toBe('Solid')

    // Cross: v0 glyph not in v1
    expect(table.getPaintTree(100)).toBeNull()
    // v1 glyph not in v0
    expect(table.getColorLayers(200)).toBeNull()
  })
})
