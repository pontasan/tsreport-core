import { BinaryWriter } from '../binary/writer.js'
import type { BinaryReader } from '../binary/reader.js'
import type { ClipBox, ColorLine, ColrTable, PaintColrLayers, PaintNode } from '../parsers/tables/colr.js'
import {
  parseDeltaSetIndexMap,
  parseItemVariationStore,
  type DeltaSetIndexMap,
  type ItemVariationData,
  type ItemVariationStore,
} from '../parsers/tables/variation-common.js'

interface BasePaint { glyphId: number, paint: PaintNode }
interface V0Base { glyphId: number, layers: Array<{ glyphId: number, paletteIndex: number }> }
interface LayerRange { first: number, count: number }

export function collectColrGlyphReferences(colr: ColrTable | null, included: Set<number>): void {
  if (colr === null) return
  const pending = [...included]
  const visited = new Set<number>()
  while (pending.length > 0) {
    const glyphId = pending.pop()!
    if (visited.has(glyphId)) continue
    visited.add(glyphId)
    const before = included.size
    const layers = colr.getColorLayers(glyphId)
    if (layers !== null) for (let i = 0; i < layers.length; i++) included.add(layers[i]!.glyphId)
    const paint = colr.getPaintTree(glyphId)
    if (paint !== null) collectPaintGlyphIds(paint, included)
    if (included.size !== before) for (const referenced of included) if (!visited.has(referenced)) pending.push(referenced)
  }
}

export function collectColrPaletteIndices(colr: ColrTable | null, included: ReadonlySet<number>, target: Set<number>): void {
  if (colr === null) return
  for (const glyphId of included) {
    const layers = colr.getColorLayers(glyphId)
    if (layers !== null) {
      for (let i = 0; i < layers.length; i++) if (layers[i]!.paletteIndex !== 0xFFFF) target.add(layers[i]!.paletteIndex)
    }
    const paint = colr.getPaintTree(glyphId)
    if (paint !== null) collectPaintPaletteIndices(paint, target)
  }
}

function collectPaintPaletteIndices(node: PaintNode, target: Set<number>): void {
  switch (node.type) {
    case 'Solid': if (node.paletteIndex !== 0xFFFF) target.add(node.paletteIndex); return
    case 'LinearGradient': case 'RadialGradient': case 'SweepGradient':
      for (let i = 0; i < node.colorLine.stops.length; i++) {
        const index = node.colorLine.stops[i]!.paletteIndex
        if (index !== 0xFFFF) target.add(index)
      }
      return
    case 'Glyph': case 'Transform': case 'Translate': case 'Scale': case 'ScaleAroundCenter': case 'ScaleUniform':
    case 'ScaleUniformAroundCenter': case 'Rotate': case 'RotateAroundCenter': case 'Skew': case 'SkewAroundCenter':
      collectPaintPaletteIndices(node.paint, target); return
    case 'ColrLayers': for (let i = 0; i < node.layers.length; i++) collectPaintPaletteIndices(node.layers[i]!, target); return
    case 'Composite': collectPaintPaletteIndices(node.source, target); collectPaintPaletteIndices(node.backdrop, target); return
  }
}

function collectPaintGlyphIds(node: PaintNode, included: Set<number>): void {
  switch (node.type) {
    case 'Glyph': included.add(node.glyphId); collectPaintGlyphIds(node.paint, included); return
    case 'ColrGlyph': included.add(node.glyphId); return
    case 'ColrLayers': for (let i = 0; i < node.layers.length; i++) collectPaintGlyphIds(node.layers[i]!, included); return
    case 'Transform': case 'Translate': case 'Scale': case 'ScaleAroundCenter': case 'ScaleUniform':
    case 'ScaleUniformAroundCenter': case 'Rotate': case 'RotateAroundCenter': case 'Skew': case 'SkewAroundCenter':
      collectPaintGlyphIds(node.paint, included); return
    case 'Composite': collectPaintGlyphIds(node.source, included); collectPaintGlyphIds(node.backdrop, included); return
  }
}

function remapGlyphId(glyphId: number, oldToNew?: ReadonlyMap<number, number>): number {
  if (oldToNew === undefined) return glyphId
  const mapped = oldToNew.get(glyphId)
  if (mapped === undefined) throw new Error(`COLR subset omitted referenced glyph ${glyphId}`)
  return mapped
}

function remapPaintGlyphIds(node: PaintNode, oldToNew?: ReadonlyMap<number, number>): PaintNode {
  if (oldToNew === undefined) return node
  switch (node.type) {
    case 'Glyph': return { ...node, glyphId: remapGlyphId(node.glyphId, oldToNew), paint: remapPaintGlyphIds(node.paint, oldToNew) }
    case 'ColrGlyph': return { ...node, glyphId: remapGlyphId(node.glyphId, oldToNew) }
    case 'ColrLayers': return { ...node, layers: node.layers.map(function (paint) { return remapPaintGlyphIds(paint, oldToNew) }) }
    case 'Transform': case 'Translate': case 'Scale': case 'ScaleAroundCenter': case 'ScaleUniform':
    case 'ScaleUniformAroundCenter': case 'Rotate': case 'RotateAroundCenter': case 'Skew': case 'SkewAroundCenter':
      return { ...node, paint: remapPaintGlyphIds(node.paint, oldToNew) } as PaintNode
    case 'Composite': return { ...node, source: remapPaintGlyphIds(node.source, oldToNew), backdrop: remapPaintGlyphIds(node.backdrop, oldToNew) }
    default: return node
  }
}

function remapPaletteIndex(index: number, paletteEntryMap?: ReadonlyMap<number, number>): number {
  if (index === 0xFFFF || paletteEntryMap === undefined) return index
  const mapped = paletteEntryMap.get(index)
  if (mapped === undefined) throw new Error(`COLR subset omitted referenced CPAL entry ${index}`)
  return mapped
}

function remapPaintPaletteIndices(node: PaintNode, paletteEntryMap?: ReadonlyMap<number, number>): PaintNode {
  if (paletteEntryMap === undefined) return node
  switch (node.type) {
    case 'Solid': return { ...node, paletteIndex: remapPaletteIndex(node.paletteIndex, paletteEntryMap) }
    case 'LinearGradient': case 'RadialGradient': case 'SweepGradient': {
      const stops = new Array(node.colorLine.stops.length)
      for (let i = 0; i < stops.length; i++) {
        const stop = node.colorLine.stops[i]!
        stops[i] = { ...stop, paletteIndex: remapPaletteIndex(stop.paletteIndex, paletteEntryMap) }
      }
      return { ...node, colorLine: { ...node.colorLine, stops } } as PaintNode
    }
    case 'Glyph': return { ...node, paint: remapPaintPaletteIndices(node.paint, paletteEntryMap) }
    case 'ColrLayers': {
      const layers: PaintNode[] = new Array(node.layers.length)
      for (let i = 0; i < layers.length; i++) layers[i] = remapPaintPaletteIndices(node.layers[i]!, paletteEntryMap)
      return { ...node, layers }
    }
    case 'Transform': case 'Translate': case 'Scale': case 'ScaleAroundCenter': case 'ScaleUniform':
    case 'ScaleUniformAroundCenter': case 'Rotate': case 'RotateAroundCenter': case 'Skew': case 'SkewAroundCenter':
      return { ...node, paint: remapPaintPaletteIndices(node.paint, paletteEntryMap) } as PaintNode
    case 'Composite': return {
      ...node,
      source: remapPaintPaletteIndices(node.source, paletteEntryMap),
      backdrop: remapPaintPaletteIndices(node.backdrop, paletteEntryMap),
    }
    default: return node
  }
}

/** Rebuilds a COLR table while retaining only stable-GID color programs. */
export function subsetColrTable(
  reader: BinaryReader,
  colr: ColrTable,
  included: Set<number>,
  oldToNew?: ReadonlyMap<number, number>,
  paletteEntryMap?: ReadonlyMap<number, number>,
  bakeCoords?: number[],
): Uint8Array {
  if (colr.version === 0) return subsetColrV0(reader, included, oldToNew, paletteEntryMap)

  const glyphIds = [...included]
  glyphIds.sort(function (a, b) { return a - b })
  const basePaints: BasePaint[] = []
  for (let i = 0; i < glyphIds.length; i++) {
    const sourcePaint = colr.getPaintTree(glyphIds[i]!, bakeCoords)
    const paint = sourcePaint === null || bakeCoords === undefined ? sourcePaint : makePaintStatic(sourcePaint)
    if (paint !== null) basePaints.push({
      glyphId: remapGlyphId(glyphIds[i]!, oldToNew),
      paint: remapPaintPaletteIndices(remapPaintGlyphIds(paint, oldToNew), paletteEntryMap),
    })
  }
  const v0Bases = collectV0Bases(reader, included, oldToNew, paletteEntryMap)
  const layerRanges = new Map<PaintColrLayers, LayerRange>()
  const layerPaints: PaintNode[] = []
  for (let i = 0; i < basePaints.length; i++) collectLayerPaints(basePaints[i]!.paint, layerRanges, layerPaints)

  const writer = new BinaryWriter(reader.length)
  writer.writeUint16(1)
  writer.writeUint16(v0Bases.length)
  const v0BaseOffsetPosition = writer.position; writer.writeUint32(0)
  const v0LayerOffsetPosition = writer.position; writer.writeUint32(0)
  let v0LayerCount = 0
  for (let i = 0; i < v0Bases.length; i++) v0LayerCount += v0Bases[i]!.layers.length
  writer.writeUint16(v0LayerCount)
  const baseGlyphListOffsetPosition = writer.position; writer.writeUint32(0)
  const layerListOffsetPosition = writer.position; writer.writeUint32(0)
  const clipListOffsetPosition = writer.position; writer.writeUint32(0)
  const varIndexMapOffsetPosition = writer.position; writer.writeUint32(0)
  const itemVariationStoreOffsetPosition = writer.position; writer.writeUint32(0)

  writeV0Data(writer, v0Bases, v0BaseOffsetPosition, v0LayerOffsetPosition)
  const baseGlyphListOffset = writer.position
  patchUint32(writer, baseGlyphListOffsetPosition, baseGlyphListOffset)
  writer.writeUint32(basePaints.length)
  const basePaintOffsetPositions: number[] = new Array(basePaints.length)
  for (let i = 0; i < basePaints.length; i++) {
    writer.writeUint16(basePaints[i]!.glyphId)
    basePaintOffsetPositions[i] = writer.position
    writer.writeUint32(0)
  }
  for (let i = 0; i < basePaints.length; i++) {
    patchUint32(writer, basePaintOffsetPositions[i]!, writer.position - baseGlyphListOffset)
    writePaint(writer, basePaints[i]!.paint, layerRanges)
  }

  if (layerPaints.length > 0) {
    const layerListOffset = writer.position
    patchUint32(writer, layerListOffsetPosition, layerListOffset)
    writer.writeUint32(layerPaints.length)
    const layerOffsetPositions: number[] = new Array(layerPaints.length)
    for (let i = 0; i < layerPaints.length; i++) {
      layerOffsetPositions[i] = writer.position
      writer.writeUint32(0)
    }
    for (let i = 0; i < layerPaints.length; i++) {
      patchUint32(writer, layerOffsetPositions[i]!, writer.position - layerListOffset)
      writePaint(writer, layerPaints[i]!, layerRanges)
    }
  }

  writeClipList(writer, colr, glyphIds, clipListOffsetPosition, oldToNew, bakeCoords)
  if (bakeCoords === undefined) {
    writeVariationData(writer, reader, varIndexMapOffsetPosition, itemVariationStoreOffsetPosition)
  }
  return new Uint8Array(writer.toArrayBuffer())
}

function makeColorLineStatic(line: ColorLine): ColorLine {
  const stops = new Array(line.stops.length)
  for (let i = 0; i < stops.length; i++) {
    const stop = line.stops[i]!
    stops[i] = { stopOffset: stop.stopOffset, paletteIndex: stop.paletteIndex, alpha: stop.alpha }
  }
  return { extend: line.extend, stops }
}

/** Converts resolved PaintVar records to their non-variable record forms. */
function makePaintStatic(node: PaintNode): PaintNode {
  switch (node.type) {
    case 'ColrLayers': {
      const layers = new Array<PaintNode>(node.layers.length)
      for (let i = 0; i < layers.length; i++) layers[i] = makePaintStatic(node.layers[i]!)
      return { type: 'ColrLayers', format: 1, layers }
    }
    case 'Solid': return { type: 'Solid', format: 2, paletteIndex: node.paletteIndex, alpha: node.alpha }
    case 'LinearGradient': return {
      type: 'LinearGradient', format: 4, colorLine: makeColorLineStatic(node.colorLine),
      x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2,
    }
    case 'RadialGradient': return {
      type: 'RadialGradient', format: 6, colorLine: makeColorLineStatic(node.colorLine),
      x0: node.x0, y0: node.y0, r0: node.r0, x1: node.x1, y1: node.y1, r1: node.r1,
    }
    case 'SweepGradient': return {
      type: 'SweepGradient', format: 8, colorLine: makeColorLineStatic(node.colorLine),
      centerX: node.centerX, centerY: node.centerY, startAngle: node.startAngle, endAngle: node.endAngle,
    }
    case 'Glyph': return { type: 'Glyph', format: 10, glyphId: node.glyphId, paint: makePaintStatic(node.paint) }
    case 'ColrGlyph': return node
    case 'Transform': return { type: 'Transform', format: 12, transform: node.transform, paint: makePaintStatic(node.paint) }
    case 'Translate': return { type: 'Translate', format: 14, dx: node.dx, dy: node.dy, paint: makePaintStatic(node.paint) }
    case 'Scale': return { type: 'Scale', format: 16, scaleX: node.scaleX, scaleY: node.scaleY, paint: makePaintStatic(node.paint) }
    case 'ScaleAroundCenter': return {
      type: 'ScaleAroundCenter', format: 18, scaleX: node.scaleX, scaleY: node.scaleY,
      centerX: node.centerX, centerY: node.centerY, paint: makePaintStatic(node.paint),
    }
    case 'ScaleUniform': return { type: 'ScaleUniform', format: 20, scale: node.scale, paint: makePaintStatic(node.paint) }
    case 'ScaleUniformAroundCenter': return {
      type: 'ScaleUniformAroundCenter', format: 22, scale: node.scale,
      centerX: node.centerX, centerY: node.centerY, paint: makePaintStatic(node.paint),
    }
    case 'Rotate': return { type: 'Rotate', format: 24, angle: node.angle, paint: makePaintStatic(node.paint) }
    case 'RotateAroundCenter': return {
      type: 'RotateAroundCenter', format: 26, angle: node.angle,
      centerX: node.centerX, centerY: node.centerY, paint: makePaintStatic(node.paint),
    }
    case 'Skew': return {
      type: 'Skew', format: 28, xSkewAngle: node.xSkewAngle, ySkewAngle: node.ySkewAngle,
      paint: makePaintStatic(node.paint),
    }
    case 'SkewAroundCenter': return {
      type: 'SkewAroundCenter', format: 30, xSkewAngle: node.xSkewAngle, ySkewAngle: node.ySkewAngle,
      centerX: node.centerX, centerY: node.centerY, paint: makePaintStatic(node.paint),
    }
    case 'Composite': return {
      type: 'Composite', format: 32, compositeMode: node.compositeMode,
      source: makePaintStatic(node.source), backdrop: makePaintStatic(node.backdrop),
    }
  }
}

function collectV0Bases(
  reader: BinaryReader,
  included: Set<number>,
  oldToNew?: ReadonlyMap<number, number>,
  paletteEntryMap?: ReadonlyMap<number, number>,
): V0Base[] {
  const numBaseGlyphRecords = reader.getUint16At(2)
  const baseGlyphRecordsOffset = reader.getUint32At(4)
  const layerRecordsOffset = reader.getUint32At(8)
  const result: V0Base[] = []
  for (let i = 0; i < numBaseGlyphRecords; i++) {
    const recordOffset = baseGlyphRecordsOffset + i * 6
    const glyphId = reader.getUint16At(recordOffset)
    if (!included.has(glyphId)) continue
    const firstLayerIndex = reader.getUint16At(recordOffset + 2)
    const numLayers = reader.getUint16At(recordOffset + 4)
    const layers: Array<{ glyphId: number, paletteIndex: number }> = new Array(numLayers)
    for (let layer = 0; layer < numLayers; layer++) {
      const offset = layerRecordsOffset + (firstLayerIndex + layer) * 4
      layers[layer] = {
        glyphId: remapGlyphId(reader.getUint16At(offset), oldToNew),
        paletteIndex: remapPaletteIndex(reader.getUint16At(offset + 2), paletteEntryMap),
      }
    }
    result.push({ glyphId: remapGlyphId(glyphId, oldToNew), layers })
  }
  return result
}

function writeV0Data(writer: BinaryWriter, bases: V0Base[], basePos: number, layerPos: number): void {
  if (bases.length === 0) return
  patchUint32(writer, basePos, writer.position)
  let firstLayerIndex = 0
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i]!
    writer.writeUint16(base.glyphId); writer.writeUint16(firstLayerIndex); writer.writeUint16(base.layers.length)
    firstLayerIndex += base.layers.length
  }
  patchUint32(writer, layerPos, writer.position)
  for (let i = 0; i < bases.length; i++) {
    const layers = bases[i]!.layers
    for (let layer = 0; layer < layers.length; layer++) {
      writer.writeUint16(layers[layer]!.glyphId); writer.writeUint16(layers[layer]!.paletteIndex)
    }
  }
}

function collectLayerPaints(node: PaintNode, ranges: Map<PaintColrLayers, LayerRange>, paints: PaintNode[]): void {
  switch (node.type) {
    case 'ColrLayers': {
      if (!ranges.has(node)) {
        const first = paints.length
        for (let i = 0; i < node.layers.length; i++) paints.push(node.layers[i]!)
        ranges.set(node, { first, count: node.layers.length })
        for (let i = 0; i < node.layers.length; i++) collectLayerPaints(node.layers[i]!, ranges, paints)
      }
      return
    }
    case 'Glyph': case 'Transform': case 'Translate': case 'Scale': case 'ScaleAroundCenter':
    case 'ScaleUniform': case 'ScaleUniformAroundCenter': case 'Rotate': case 'RotateAroundCenter':
    case 'Skew': case 'SkewAroundCenter':
      collectLayerPaints(node.paint, ranges, paints); return
    case 'Composite':
      collectLayerPaints(node.source, ranges, paints); collectLayerPaints(node.backdrop, ranges, paints); return
  }
}

function writePaint(writer: BinaryWriter, node: PaintNode, ranges: Map<PaintColrLayers, LayerRange>): void {
  const start = writer.position
  writer.writeUint8(node.format)
  switch (node.type) {
    case 'ColrLayers': { const range = ranges.get(node)!; writer.writeUint8(range.count); writer.writeUint32(range.first); return }
    case 'Solid':
      writer.writeUint16(node.paletteIndex); writeF2Dot14(writer, node.alpha)
      if (node.format === 3) writer.writeUint32(node.varIndexBase!); return
    case 'LinearGradient': {
      const pos = offset24Placeholder(writer)
      writer.writeInt16(node.x0); writer.writeInt16(node.y0); writer.writeInt16(node.x1)
      writer.writeInt16(node.y1); writer.writeInt16(node.x2); writer.writeInt16(node.y2)
      if (node.format === 5) writer.writeUint32(node.varIndexBase!)
      patchOffset24(writer, pos, writer.position - start); writeColorLine(writer, node.colorLine, node.format === 5); return
    }
    case 'RadialGradient': {
      const pos = offset24Placeholder(writer)
      writer.writeInt16(node.x0); writer.writeInt16(node.y0); writer.writeUint16(node.r0)
      writer.writeInt16(node.x1); writer.writeInt16(node.y1); writer.writeUint16(node.r1)
      if (node.format === 7) writer.writeUint32(node.varIndexBase!)
      patchOffset24(writer, pos, writer.position - start); writeColorLine(writer, node.colorLine, node.format === 7); return
    }
    case 'SweepGradient': {
      const pos = offset24Placeholder(writer)
      writer.writeInt16(node.centerX); writer.writeInt16(node.centerY)
      writeF2Dot14(writer, node.startAngle); writeF2Dot14(writer, node.endAngle)
      if (node.format === 9) writer.writeUint32(node.varIndexBase!)
      patchOffset24(writer, pos, writer.position - start); writeColorLine(writer, node.colorLine, node.format === 9); return
    }
    case 'Glyph': {
      const pos = offset24Placeholder(writer); writer.writeUint16(node.glyphId)
      writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'ColrGlyph': writer.writeUint16(node.glyphId); return
    case 'Transform': {
      const childPos = offset24Placeholder(writer); const transformPos = offset24Placeholder(writer)
      patchOffset24(writer, transformPos, writer.position - start)
      writeFixed(writer, node.transform.xx); writeFixed(writer, node.transform.yx); writeFixed(writer, node.transform.xy)
      writeFixed(writer, node.transform.yy); writeFixed(writer, node.transform.dx); writeFixed(writer, node.transform.dy)
      if (node.format === 13) writer.writeUint32(node.varIndexBase!)
      writeChild(writer, start, childPos, node.paint, ranges); return
    }
    case 'Translate': {
      const pos = offset24Placeholder(writer); writer.writeInt16(node.dx); writer.writeInt16(node.dy)
      if (node.format === 15) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'Scale': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.scaleX); writeF2Dot14(writer, node.scaleY)
      if (node.format === 17) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'ScaleAroundCenter': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.scaleX); writeF2Dot14(writer, node.scaleY)
      writer.writeInt16(node.centerX); writer.writeInt16(node.centerY)
      if (node.format === 19) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'ScaleUniform': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.scale)
      if (node.format === 21) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'ScaleUniformAroundCenter': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.scale); writer.writeInt16(node.centerX); writer.writeInt16(node.centerY)
      if (node.format === 23) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'Rotate': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.angle)
      if (node.format === 25) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'RotateAroundCenter': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.angle); writer.writeInt16(node.centerX); writer.writeInt16(node.centerY)
      if (node.format === 27) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'Skew': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.xSkewAngle); writeF2Dot14(writer, node.ySkewAngle)
      if (node.format === 29) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'SkewAroundCenter': {
      const pos = offset24Placeholder(writer); writeF2Dot14(writer, node.xSkewAngle); writeF2Dot14(writer, node.ySkewAngle)
      writer.writeInt16(node.centerX); writer.writeInt16(node.centerY)
      if (node.format === 31) writer.writeUint32(node.varIndexBase!); writeChild(writer, start, pos, node.paint, ranges); return
    }
    case 'Composite': {
      const sourcePos = offset24Placeholder(writer); writer.writeUint8(node.compositeMode); const backdropPos = offset24Placeholder(writer)
      patchOffset24(writer, sourcePos, writer.position - start); writePaint(writer, node.source, ranges)
      patchOffset24(writer, backdropPos, writer.position - start); writePaint(writer, node.backdrop, ranges); return
    }
  }
}

function writeChild(writer: BinaryWriter, start: number, pos: number, paint: PaintNode, ranges: Map<PaintColrLayers, LayerRange>): void {
  patchOffset24(writer, pos, writer.position - start); writePaint(writer, paint, ranges)
}

function writeColorLine(writer: BinaryWriter, line: ColorLine, variable: boolean): void {
  writer.writeUint8(line.extend); writer.writeUint16(line.stops.length)
  for (let i = 0; i < line.stops.length; i++) {
    const stop = line.stops[i]!
    writeF2Dot14(writer, stop.stopOffset); writer.writeUint16(stop.paletteIndex); writeF2Dot14(writer, stop.alpha)
    if (variable) writer.writeUint32(stop.varIndexBase!)
  }
}

function writeClipList(
  writer: BinaryWriter,
  colr: ColrTable,
  glyphIds: number[],
  offsetPos: number,
  oldToNew?: ReadonlyMap<number, number>,
  bakeCoords?: number[],
): void {
  const clips: Array<{ glyphId: number, box: ClipBox }> = []
  for (let i = 0; i < glyphIds.length; i++) {
    const box = colr.getClipBox(glyphIds[i]!, bakeCoords)
    if (box !== null) clips.push({
      glyphId: remapGlyphId(glyphIds[i]!, oldToNew),
      box: bakeCoords === undefined
        ? box
        : { format: 1, xMin: box.xMin, yMin: box.yMin, xMax: box.xMax, yMax: box.yMax },
    })
  }
  clips.sort(function (a, b) { return a.glyphId - b.glyphId })
  if (clips.length === 0) return
  const start = writer.position; patchUint32(writer, offsetPos, start)
  writer.writeUint8(1); writer.writeUint32(clips.length)
  const positions: number[] = new Array(clips.length)
  for (let i = 0; i < clips.length; i++) {
    writer.writeUint16(clips[i]!.glyphId); writer.writeUint16(clips[i]!.glyphId); positions[i] = offset24Placeholder(writer)
  }
  for (let i = 0; i < clips.length; i++) {
    patchOffset24(writer, positions[i]!, writer.position - start)
    const box = clips[i]!.box
    writer.writeUint8(box.format); writer.writeInt16(box.xMin); writer.writeInt16(box.yMin)
    writer.writeInt16(box.xMax); writer.writeInt16(box.yMax)
    if (box.format === 2) writer.writeUint32(box.varIndexBase!)
  }
}

function writeVariationData(writer: BinaryWriter, reader: BinaryReader, mapPos: number, storePos: number): void {
  const mapOffset = reader.getUint32At(26); const storeOffset = reader.getUint32At(30)
  if (mapOffset !== 0) { patchUint32(writer, mapPos, writer.position); writeDeltaSetIndexMap(writer, parseDeltaSetIndexMap(reader, mapOffset)) }
  if (storeOffset !== 0) { patchUint32(writer, storePos, writer.position); writeItemVariationStore(writer, parseItemVariationStore(reader, storeOffset)) }
}

function writeDeltaSetIndexMap(writer: BinaryWriter, map: DeltaSetIndexMap): void {
  let maxInner = 0
  for (let i = 0; i < map.entries.length; i++) maxInner = Math.max(maxInner, map.entries[i]!.inner)
  const innerBits = Math.max(1, bitLength(maxInner)); let maxBits = 1
  for (let i = 0; i < map.entries.length; i++) maxBits = Math.max(maxBits, bitLength(map.entries[i]!.outer * 2 ** innerBits + map.entries[i]!.inner))
  const entrySize = Math.max(1, Math.ceil(maxBits / 8)); const format = map.entries.length <= 0xFFFF ? 0 : 1
  writer.writeUint8(format); writer.writeUint8(((entrySize - 1) << 4) | (innerBits - 1))
  if (format === 0) writer.writeUint16(map.entries.length); else writer.writeUint32(map.entries.length)
  for (let i = 0; i < map.entries.length; i++) {
    let value = map.entries[i]!.outer * 2 ** innerBits + map.entries[i]!.inner
    const bytes = new Array<number>(entrySize)
    for (let b = entrySize - 1; b >= 0; b--) { bytes[b] = value & 0xFF; value = Math.floor(value / 256) }
    for (let b = 0; b < bytes.length; b++) writer.writeUint8(bytes[b]!)
  }
}

function writeItemVariationStore(writer: BinaryWriter, store: ItemVariationStore): void {
  const start = writer.position; writer.writeUint16(1)
  const regionPos = writer.position; writer.writeUint32(0); writer.writeUint16(store.data.length)
  const dataPositions: number[] = new Array(store.data.length)
  for (let i = 0; i < store.data.length; i++) { dataPositions[i] = writer.position; writer.writeUint32(0) }
  patchUint32(writer, regionPos, writer.position - start)
  const axisCount = store.axisCount ?? store.regions[0]!.axes.length
  writer.writeUint16(axisCount); writer.writeUint16(store.regions.length)
  for (let r = 0; r < store.regions.length; r++) for (let a = 0; a < axisCount; a++) {
    const axis = store.regions[r]!.axes[a]!
    writeF2Dot14(writer, axis.startCoord); writeF2Dot14(writer, axis.peakCoord); writeF2Dot14(writer, axis.endCoord)
  }
  for (let i = 0; i < store.data.length; i++) {
    patchUint32(writer, dataPositions[i]!, writer.position - start); writeItemVariationData(writer, store.data[i]!)
  }
}

function writeItemVariationData(writer: BinaryWriter, data: ItemVariationData): void {
  let longWords = false
  for (let i = 0; i < data.deltaSets.length; i++) for (let r = 0; r < data.deltaSets[i]!.length; r++) {
    const delta = data.deltaSets[i]![r]!; if (delta < -0x8000 || delta > 0x7FFF) longWords = true
  }
  let wordCount = 0
  for (let r = 0; r < data.regionIndices.length; r++) for (let i = 0; i < data.deltaSets.length; i++) {
    const delta = data.deltaSets[i]![r]!
    if (longWords ? delta < -0x8000 || delta > 0x7FFF : delta < -0x80 || delta > 0x7F) { wordCount = r + 1; break }
  }
  writer.writeUint16(data.deltaSets.length); writer.writeUint16((longWords ? 0x8000 : 0) | wordCount)
  writer.writeUint16(data.regionIndices.length)
  for (let i = 0; i < data.regionIndices.length; i++) writer.writeUint16(data.regionIndices[i]!)
  for (let i = 0; i < data.deltaSets.length; i++) for (let r = 0; r < data.deltaSets[i]!.length; r++) {
    const delta = data.deltaSets[i]![r]!
    if (longWords) { if (r < wordCount) writer.writeInt32(delta); else writer.writeInt16(delta) }
    else if (r < wordCount) writer.writeInt16(delta)
    else writer.writeUint8(delta & 0xFF)
  }
}

function subsetColrV0(
  reader: BinaryReader,
  included: Set<number>,
  oldToNew?: ReadonlyMap<number, number>,
  paletteEntryMap?: ReadonlyMap<number, number>,
): Uint8Array {
  const selected = collectV0Bases(reader, included, oldToNew, paletteEntryMap); let numLayers = 0
  for (let i = 0; i < selected.length; i++) numLayers += selected[i]!.layers.length
  const baseOffset = 14; const layerOffset = baseOffset + selected.length * 6; const writer = new BinaryWriter(layerOffset + numLayers * 4)
  writer.writeUint16(0); writer.writeUint16(selected.length); writer.writeUint32(baseOffset); writer.writeUint32(layerOffset); writer.writeUint16(numLayers)
  let first = 0
  for (let i = 0; i < selected.length; i++) { writer.writeUint16(selected[i]!.glyphId); writer.writeUint16(first); writer.writeUint16(selected[i]!.layers.length); first += selected[i]!.layers.length }
  for (let i = 0; i < selected.length; i++) for (let j = 0; j < selected[i]!.layers.length; j++) {
    writer.writeUint16(selected[i]!.layers[j]!.glyphId); writer.writeUint16(selected[i]!.layers[j]!.paletteIndex)
  }
  return new Uint8Array(writer.toArrayBuffer())
}

function offset24Placeholder(writer: BinaryWriter): number { const pos = writer.position; writer.writeUint8(0); writer.writeUint8(0); writer.writeUint8(0); return pos }
function patchOffset24(writer: BinaryWriter, position: number, value: number): void {
  if (value > 0xFFFFFF) throw new Error(`COLR subset offset exceeds Offset24 range: ${value}`)
  const end = writer.position; writer.position = position
  writer.writeUint8((value >>> 16) & 0xFF); writer.writeUint8((value >>> 8) & 0xFF); writer.writeUint8(value & 0xFF); writer.position = end
}
function patchUint32(writer: BinaryWriter, position: number, value: number): void { const end = writer.position; writer.position = position; writer.writeUint32(value); writer.position = end }
function writeF2Dot14(writer: BinaryWriter, value: number): void { writer.writeInt16(Math.round(value * 16384)) }
function writeFixed(writer: BinaryWriter, value: number): void { writer.writeInt32(Math.round(value * 65536)) }
function bitLength(value: number): number { return value === 0 ? 1 : Math.floor(Math.log2(value)) + 1 }
