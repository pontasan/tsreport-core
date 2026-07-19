import { BinaryWriter } from '../binary/writer.js'
import { getTableReader } from '../parsers/sfnt-parser.js'
import type { SfntTableManager } from '../parsers/ttf-parser.js'
import type { SfntData } from '../types/index.js'
import { buildCompactMathTable, type MathTable } from '../parsers/tables/math.js'
import { buildCompactBaseTable, type BaseTable } from '../parsers/tables/base.js'
import { buildCompactJstfTable, type JstfTable } from '../parsers/tables/jstf.js'

/** Rebuilds glyph-indexed device tables and copies glyph-independent standard tables. */
export function buildStandardSubsetTables(
  sfnt: SfntData,
  manager: SfntTableManager,
  oldToNew: ReadonlyMap<number, number>,
): Map<string, Uint8Array> {
  const tables = new Map<string, Uint8Array>()
  for (const tag of ['gasp', 'VDMX', 'meta', 'PCLT']) {
    const reader = getTableReader(sfnt, tag)
    if (reader !== null) tables.set(tag, bakeMvarMetrics(tag, copyReader(reader), manager))
  }
  const mathReader = getTableReader(sfnt, 'MATH')
  if (mathReader !== null) tables.set('MATH', buildCompactMathTable(
    mathReader,
    oldToNew,
    manager.normalizedCoords !== null && manager.gdef !== null
      ? { coords: manager.normalizedCoords, gdef: manager.gdef }
      : undefined,
  ))
  const baseReader = getTableReader(sfnt, 'BASE')
  if (baseReader !== null) {
    tables.set('BASE', buildCompactBaseTable(
      baseReader, oldToNew, manager.fvar?.axes.length, manager.normalizedCoords ?? undefined,
    ))
  }
  const jstfReader = getTableReader(sfnt, 'JSTF')
  if (jstfReader !== null) tables.set('JSTF', buildCompactJstfTable(
    jstfReader,
    oldToNew,
    manager.normalizedCoords !== null && manager.gdef !== null
      ? { coords: manager.normalizedCoords, gdef: manager.gdef }
      : undefined,
  ))

  const ltsh = manager.ltsh
  const sourceLtsh = getTableReader(sfnt, 'LTSH')
  if (ltsh !== null && sourceLtsh !== null) {
    const writer = new BinaryWriter(4 + oldToNew.size)
    writer.writeUint16(sourceLtsh.getUint16At(0))
    writer.writeUint16(oldToNew.size)
    for (const [oldGlyphId] of sortedMappings(oldToNew)) writer.writeUint8(ltsh.getLinearThreshold(oldGlyphId))
    tables.set('LTSH', writer.toUint8Array())
  }

  const hdmx = manager.hdmx
  const sourceHdmx = getTableReader(sfnt, 'hdmx')
  if (hdmx !== null && sourceHdmx !== null) {
    const mappings = sortedMappings(oldToNew)
    const recordSize = (2 + mappings.length + 3) & ~3
    const writer = new BinaryWriter(8 + hdmx.availablePpems.length * recordSize)
    writer.writeUint16(sourceHdmx.getUint16At(0))
    writer.writeUint16(hdmx.availablePpems.length)
    writer.writeUint32(recordSize)
    for (let ppemIndex = 0; ppemIndex < hdmx.availablePpems.length; ppemIndex++) {
      const ppem = hdmx.availablePpems[ppemIndex]!
      const widths = new Uint8Array(mappings.length)
      let maximumWidth = 0
      for (let glyphIndex = 0; glyphIndex < mappings.length; glyphIndex++) {
        const width = hdmx.getWidth(ppem, mappings[glyphIndex]![0])!
        widths[glyphIndex] = width
        if (width > maximumWidth) maximumWidth = width
      }
      writer.writeUint8(ppem)
      writer.writeUint8(maximumWidth)
      writer.writeBytes(widths)
      while ((writer.position - 8) % recordSize !== 0) writer.writeUint8(0)
    }
    tables.set('hdmx', writer.toUint8Array())
  }
  return tables
}

/** Materializes registered MVAR values into the table fields they vary. */
export function bakeMvarMetrics(tag: string, data: Uint8Array, manager: SfntTableManager): Uint8Array {
  const coords = manager.normalizedCoords
  if (coords === null) return data
  const mvar = manager.mvar
  if (mvar === null) return data
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (tag === 'hhea' || tag === 'vhea') {
    const prefix = tag === 'hhea' ? 'h' : 'v'
    addInt16(view, 4, mvar.getMetricDelta(`${prefix}asc`, coords))
    addInt16(view, 6, mvar.getMetricDelta(`${prefix}dsc`, coords))
    addInt16(view, 8, mvar.getMetricDelta(`${prefix}lgp`, coords))
    addInt16(view, 18, mvar.getMetricDelta(`${prefix}crs`, coords))
    addInt16(view, 20, mvar.getMetricDelta(`${prefix}crn`, coords))
    addInt16(view, 22, mvar.getMetricDelta(`${prefix}cof`, coords))
    return data
  }
  if (tag === 'OS/2') {
    addInt16(view, 10, mvar.getMetricDelta('sbxs', coords))
    addInt16(view, 12, mvar.getMetricDelta('sbys', coords))
    addInt16(view, 14, mvar.getMetricDelta('sbxo', coords))
    addInt16(view, 16, mvar.getMetricDelta('sbyo', coords))
    addInt16(view, 18, mvar.getMetricDelta('spxs', coords))
    addInt16(view, 20, mvar.getMetricDelta('spys', coords))
    addInt16(view, 22, mvar.getMetricDelta('spxo', coords))
    addInt16(view, 24, mvar.getMetricDelta('spyo', coords))
    addInt16(view, 26, mvar.getMetricDelta('strs', coords))
    addInt16(view, 28, mvar.getMetricDelta('stro', coords))
    if (data.length >= 78) {
      addUint16(view, 74, mvar.getMetricDelta('hcla', coords))
      addUint16(view, 76, mvar.getMetricDelta('hcld', coords))
    }
    if (view.getUint16(0, false) >= 2 && data.length >= 90) {
      addInt16(view, 86, mvar.getMetricDelta('xhgt', coords))
      addInt16(view, 88, mvar.getMetricDelta('cpht', coords))
    }
    return data
  }
  if (tag === 'post') {
    addInt16(view, 8, mvar.getMetricDelta('undo', coords))
    addInt16(view, 10, mvar.getMetricDelta('unds', coords))
    return data
  }
  if (tag === 'gasp') {
    const rangeCount = view.getUint16(2, false)
    for (let i = 0; i < rangeCount && i < 10 && i + 1 < rangeCount; i++) {
      addUint16(view, 4 + i * 4, mvar.getMetricDelta(`gsp${i}`, coords))
    }
  }
  return data
}

function addInt16(view: DataView, offset: number, delta: number): void {
  view.setInt16(offset, Math.max(-0x8000, Math.min(0x7FFF, Math.round(view.getInt16(offset, false) + delta))), false)
}

function addUint16(view: DataView, offset: number, delta: number): void {
  view.setUint16(offset, Math.max(0, Math.min(0xFFFF, Math.round(view.getUint16(offset, false) + delta))), false)
}

/** Expands a subset through every glyph referenced by MATH coverage and construction data. */
export function collectMathGlyphReferences(math: MathTable | null, glyphIds: Set<number>): void {
  if (math === null) return
  for (const glyphId of math.subsetData.referencedGlyphIds) glyphIds.add(glyphId)
}

/** Expands a subset through BASE format-2 control-point reference glyphs. */
export function collectBaseGlyphReferences(base: BaseTable | null, glyphIds: Set<number>): void {
  if (base === null) return
  for (const glyphId of base.subsetData.referencedGlyphIds) glyphIds.add(glyphId)
}

/** Expands a subset through JSTF extenders and embedded maximum-positioning lookups. */
export function collectJstfGlyphReferences(jstf: JstfTable | null, glyphIds: Set<number>): void {
  if (jstf === null) return
  for (const glyphId of jstf.subsetData.referencedGlyphIds) glyphIds.add(glyphId)
}

/** Rebuilds VORG records using compact glyph IDs. */
export function buildVorgSubsetTable(manager: SfntTableManager, oldToNew: ReadonlyMap<number, number>): Uint8Array | null {
  const vorg = manager.vorg
  if (vorg === null) return null
  const records: Array<readonly [number, number]> = []
  const coordinates = manager.normalizedCoords
  const vvar = coordinates === null ? null : manager.vvar
  for (const [oldGlyphId, newGlyphId] of oldToNew) {
    const origin = vorg.getVertOriginY(oldGlyphId)
      + (vvar !== null && vvar.hasVOrgMapping ? Math.round(vvar.getVOrgDelta(oldGlyphId, coordinates!)) : 0)
    if (origin !== vorg.defaultVertOriginY) records.push([newGlyphId, origin])
  }
  records.sort(function (left, right) { return left[0] - right[0] })
  const writer = new BinaryWriter(8 + records.length * 4)
  writer.writeUint16(1)
  writer.writeUint16(0)
  writer.writeInt16(vorg.defaultVertOriginY)
  writer.writeUint16(records.length)
  for (let i = 0; i < records.length; i++) {
    writer.writeUint16(records[i]![0])
    writer.writeInt16(records[i]![1])
  }
  return writer.toUint8Array()
}

/** Rebuilds vhea/vmtx with compact glyph IDs and selected variation metrics. */
export function buildVerticalMetricsSubsetTables(
  sfnt: SfntData,
  manager: SfntTableManager,
  oldToNew: ReadonlyMap<number, number>,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  const vhea = manager.vhea
  const vmtx = manager.vmtx
  const sourceVhea = getTableReader(sfnt, 'vhea')
  if (vhea === null || vmtx === null || sourceVhea === null) return result
  const coordinates = manager.normalizedCoords
  const vvar = coordinates === null ? null : manager.vvar
  const mappings = sortedMappings(oldToNew)
  const writer = new BinaryWriter(mappings.length * 4)
  let advanceHeightMax = 0
  let minTopSideBearing = 0
  let minBottomSideBearing = 0
  let yMaxExtent = 0
  let initialized = false
  for (let i = 0; i < mappings.length; i++) {
    const oldGlyphId = mappings[i]![0]
    let advanceHeight = vmtx.getAdvanceHeight(oldGlyphId)
    let topSideBearing = vmtx.getTopSideBearing(oldGlyphId)
    if (vvar !== null && coordinates !== null) {
      advanceHeight += Math.round(vvar.getAdvanceHeightDelta(oldGlyphId, coordinates))
      if (vvar.hasTsbMapping) topSideBearing += Math.round(vvar.getTsbDelta(oldGlyphId, coordinates))
    }
    writer.writeUint16(Math.max(0, Math.min(0xFFFF, advanceHeight)))
    writer.writeInt16(topSideBearing)
    const glyph = manager.getGlyphOutline(oldGlyphId)
    const extent = Math.ceil(glyph.yMax) - Math.floor(glyph.yMin)
    const bottomSideBearing = advanceHeight - topSideBearing - extent
    const glyphYMaxExtent = topSideBearing + extent
    if (!initialized) {
      advanceHeightMax = advanceHeight
      minTopSideBearing = topSideBearing
      minBottomSideBearing = bottomSideBearing
      yMaxExtent = glyphYMaxExtent
      initialized = true
    } else {
      if (advanceHeight > advanceHeightMax) advanceHeightMax = advanceHeight
      if (topSideBearing < minTopSideBearing) minTopSideBearing = topSideBearing
      if (bottomSideBearing < minBottomSideBearing) minBottomSideBearing = bottomSideBearing
      if (glyphYMaxExtent > yMaxExtent) yMaxExtent = glyphYMaxExtent
    }
  }
  const vheaData = copyReader(sourceVhea)
  const view = new DataView(vheaData.buffer, vheaData.byteOffset, vheaData.byteLength)
  view.setUint16(10, advanceHeightMax, false)
  view.setInt16(12, minTopSideBearing, false)
  view.setInt16(14, minBottomSideBearing, false)
  view.setInt16(16, yMaxExtent, false)
  view.setUint16(34, mappings.length, false)
  bakeMvarMetrics('vhea', vheaData, manager)
  result.set('vhea', vheaData)
  result.set('vmtx', writer.toUint8Array())
  return result
}

function sortedMappings(oldToNew: ReadonlyMap<number, number>): Array<readonly [number, number]> {
  return [...oldToNew.entries()].sort(function (left, right) { return left[1] - right[1] })
}

function copyReader(reader: { readonly length: number, getUint8At(offset: number): number }): Uint8Array {
  const data = new Uint8Array(reader.length)
  for (let i = 0; i < data.length; i++) data[i] = reader.getUint8At(i)
  return data
}
