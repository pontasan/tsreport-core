/**
 * Font subsetting API
 * Supports both TTF (glyf) and CFF (OTF)
 * Supports automatic collection of glyphs referenced by GSUB
 */
import type { SfntData } from '../types/index.js'
import { getTableReader, parseSfntDirectory } from '../parsers/sfnt-parser.js'
import { parseGsub } from '../parsers/tables/gsub.js'
import { parseFvar } from '../parsers/tables/fvar.js'
import {
  buildCmapTable,
  buildSfntFromTables,
  collectCompositeReferences,
  collectSubsetCmapVariationSequences,
  subsetTtf,
} from './ttf-subset.js'
import { subsetCff, subsetCffPreservingGlyphIds } from './cff-subset.js'
import { BinaryWriter } from '../binary/writer.js'
import { SfntTableManager } from '../parsers/ttf-parser.js'
import { collectGraphiteGlyphReferences } from './graphite-subset.js'
import { collectAatGlyphReferences } from './aat-subset.js'
import { collectColrGlyphReferences, collectColrPaletteIndices, subsetColrTable } from './colr-subset.js'
import { buildBitmapSubsetTables } from './bitmap-subset.js'
import { buildSvgSubsetTable, collectSvgPaletteIndices } from './svg-subset.js'
import { buildCpalSubsetTable } from './cpal-subset.js'
import { buildStableCff2Subset } from './cff2-subset.js'
import {
  collectBaseGlyphReferences,
  collectJstfGlyphReferences,
  collectMathGlyphReferences,
} from './standard-subset.js'

/** Subset result (font binary + GID mapping) */
export interface SubsetResult {
  /** Subsetted font binary (SFNT-wrapped) */
  buffer: ArrayBuffer
  /** Mapping from old GID to new GID */
  oldToNewGlyphId: Map<number, number>
  /** CID-keyed CFF data (for PDF embedding, CFF fonts only) */
  cidKeyedCff?: Uint8Array
}

/**
 * Subset a font
 * Substitution target glyphs referenced by the GSUB table are also collected automatically
 *
 * @param sfnt SFNT data
 * @param glyphIds Glyph IDs to include in the subset
 * @param codePointToGlyphId Mapping from codepoint to glyphId (for cmap rebuilding)
 * @returns Subset result (font binary + GID mapping)
 */
export function subsetFont(
  sfnt: SfntData,
  glyphIds: Set<number>,
  codePointToGlyphId?: Map<number, number>,
  normalizedCoords?: number[] | null,
): SubsetResult {
  // Automatically collect glyphs referenced by GSUB
  const expandedGlyphIds = collectFontGlyphReferences(sfnt, glyphIds)

  if (sfnt.sfntVersion === 0x4F54544F) {
    // CFF (OTF)
    return subsetCff(sfnt, expandedGlyphIds, codePointToGlyphId)
  }
  // TrueType (TTF)
  return subsetTtf(sfnt, expandedGlyphIds, codePointToGlyphId, normalizedCoords)
}

/** Expands a physical subset through layout, color, AAT, and Graphite glyph references. */
export function collectFontGlyphReferences(sfnt: SfntData, glyphIds: Set<number>): Set<number> {
  const expandedGlyphIds = collectGsubGlyphs(sfnt, glyphIds)
  const manager = new SfntTableManager(sfnt)
  collectGraphiteGlyphReferences(manager, expandedGlyphIds)
  collectAatGlyphReferences(manager, expandedGlyphIds)
  collectColrGlyphReferences(manager.colr, expandedGlyphIds)
  collectMathGlyphReferences(manager.math, expandedGlyphIds)
  collectBaseGlyphReferences(manager.base, expandedGlyphIds)
  collectJstfGlyphReferences(manager.jstf, expandedGlyphIds)
  return expandedGlyphIds
}

/**
 * Collect glyphs referenced by the GSUB table and add them to the subset
 */
export function collectGsubGlyphs(sfnt: SfntData, glyphIds: Set<number>): Set<number> {
  const gsubReader = getTableReader(sfnt, 'GSUB')
  if (!gsubReader) return glyphIds

  const hasFeatureVariations = gsubReader.length >= 14
    && gsubReader.getUint16At(0) === 1
    && gsubReader.getUint16At(2) === 1
    && gsubReader.getUint32At(10) !== 0
  const fvarReader = hasFeatureVariations ? getTableReader(sfnt, 'fvar') : null
  const expectedAxisCount = fvarReader ? parseFvar(fvarReader).axes.length : undefined
  const gsub = parseGsub(gsubReader, expectedAxisCount)
  const expanded = new Set(glyphIds)
  for (const gid of gsub.getReachableSubstitutionGlyphIds(glyphIds)) {
    expanded.add(gid)
  }
  return expanded
}

/**
 * General-purpose subset that keeps original glyph IDs. Keeping IDs stable
 * lets every glyph-indexed OpenType table remain valid (layout, color,
 * variation, vertical metrics, MATH and SVG), while unused outline programs
 * are physically emptied without changing glyph IDs.
 */
export function subsetFontPreservingTables(
  sfnt: SfntData,
  glyphIds: Set<number>,
  codePointToGlyphId?: Map<number, number>,
): SubsetResult {
  const manager = new SfntTableManager(sfnt)
  const included = collectGsubGlyphs(sfnt, new Set<number>([0, ...glyphIds]))
  collectGraphiteGlyphReferences(manager, included)
  collectAatGlyphReferences(manager, included)
  collectColrGlyphReferences(manager.colr, included)
  collectMathGlyphReferences(manager.math, included)
  collectBaseGlyphReferences(manager.base, included)
  collectJstfGlyphReferences(manager.jstf, included)
  const glyf = getTableReader(sfnt, 'glyf')
  if (glyf !== null) {
    for (const gid of [...included]) collectCompositeReferences(glyf, manager.loca, gid, included)
  }
  const cmapEntries: { codePoint: number, newGlyphId: number }[] = []
  const sourceMap = codePointToGlyphId ?? manager.cmap.entries()
  for (const [codePoint, glyphId] of sourceMap) {
    if (included.has(glyphId)) cmapEntries.push({ codePoint, newGlyphId: glyphId })
  }
  cmapEntries.sort(function (a, b) { return a.codePoint - b.codePoint })

  const replacements = new Map<string, Uint8Array>()
  const stableMapping = new Map<number, number>()
  for (const glyphId of included) stableMapping.set(glyphId, glyphId)
  replacements.set('cmap', buildCmapTable(
    cmapEntries,
    collectSubsetCmapVariationSequences(manager.cmap, cmapEntries, stableMapping),
  ))
  const head = copySfntTable(sfnt, 'head')
  new DataView(head.buffer, head.byteOffset, head.byteLength).setUint32(8, 0, false)
  replacements.set('head', head)
  let subsetSvg = buildSvgSubsetTable(sfnt, stableMapping)
  const usedPaletteEntries = new Set<number>()
  collectColrPaletteIndices(manager.colr, included, usedPaletteEntries)
  collectSvgPaletteIndices(subsetSvg, usedPaletteEntries)
  const cpalSubset = buildCpalSubsetTable(manager.cpal, usedPaletteEntries)
  if (manager.cpal !== null && subsetSvg !== null) {
    subsetSvg = buildSvgSubsetTable(sfnt, stableMapping, cpalSubset.oldToNewPaletteEntry)
  }
  if (subsetSvg !== null) replacements.set('SVG ', subsetSvg)
  const colrReader = getTableReader(sfnt, 'COLR')
  if (colrReader !== null && manager.colr !== null) {
    replacements.set('COLR', subsetColrTable(
      colrReader, manager.colr, included, undefined,
      manager.cpal === null ? undefined : cpalSubset.oldToNewPaletteEntry,
    ))
  }
  if (cpalSubset.table !== null) replacements.set('CPAL', cpalSubset.table)
  const bitmapTables = buildBitmapSubsetTables(sfnt, stableMapping, manager.maxp.numGlyphs)
  const removedTables = new Set<string>()
  if (getTableReader(sfnt, 'SVG ') !== null && subsetSvg === null) removedTables.add('SVG ')
  if (getTableReader(sfnt, 'CPAL') !== null && cpalSubset.table === null) removedTables.add('CPAL')
  for (const [tag, data] of bitmapTables) {
    if (data === null) removedTables.add(tag)
    else replacements.set(tag, data)
  }
  if (getTableReader(sfnt, 'CFF ') !== null) {
    const retainedCmap = new Map<number, number>()
    for (let i = 0; i < cmapEntries.length; i++) retainedCmap.set(cmapEntries[i]!.codePoint, cmapEntries[i]!.newGlyphId)
    const cffSubset = subsetCffPreservingGlyphIds(sfnt, included, retainedCmap)
    const rebuilt = parseSfntDirectory(cffSubset.buffer)
    const cffReader = getTableReader(rebuilt, 'CFF ')!
    const cffData = new Uint8Array(cffReader.length)
    for (let i = 0; i < cffData.length; i++) cffData[i] = cffReader.getUint8At(i)
    replacements.set('CFF ', cffData)
  }
  if (getTableReader(sfnt, 'CFF2') !== null) {
    const cff2 = manager.cff2
    if (cff2 === null) throw new Error('CFF2 table disappeared while subsetting')
    replacements.set('CFF2', buildStableCff2Subset(cff2, included))
  }

  if (glyf !== null) {
    const chunks: Uint8Array[] = []
    const offsets: number[] = [0]
    let total = 0
    for (let gid = 0; gid < manager.maxp.numGlyphs; gid++) {
      const length = manager.loca.getLength(gid)
      if (!included.has(gid) || length === 0) {
        chunks.push(new Uint8Array(0))
        offsets.push(total)
        continue
      }
      const offset = manager.loca.getOffset(gid)
      const size = (length + 3) & ~3
      const chunk = new Uint8Array(size)
      const source = new Uint8Array(sfnt.buffer, glyf.absoluteOffset + offset, length)
      chunk.set(source)
      chunks.push(chunk)
      total += size
      offsets.push(total)
    }
    const glyfData = new Uint8Array(total)
    let position = 0
    for (let i = 0; i < chunks.length; i++) { glyfData.set(chunks[i]!, position); position += chunks[i]!.length }
    const loca = new BinaryWriter(offsets.length * 4)
    for (let i = 0; i < offsets.length; i++) loca.writeUint32(offsets[i]!)
    replacements.set('glyf', glyfData)
    replacements.set('loca', new Uint8Array(loca.toArrayBuffer()))
    new DataView(head.buffer, head.byteOffset, head.byteLength).setInt16(50, 1, false)
  }

  const tables: { tag: string, data: Uint8Array }[] = []
  for (const tag of sfnt.tableDirectory.keys()) {
    if (tag === 'DSIG') continue
    if (removedTables.has(tag)) continue
    tables.push({ tag, data: replacements.get(tag) ?? copySfntTable(sfnt, tag) })
  }
  tables.sort(function (a, b) { return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0 })
  return { buffer: buildSfntFromTables(sfnt.sfntVersion, tables), oldToNewGlyphId: stableMapping }
}

function copySfntTable(sfnt: SfntData, tag: string): Uint8Array {
  const reader = getTableReader(sfnt, tag)
  if (reader === null) throw new Error(`Font subset error: table ${tag} disappeared from the directory`)
  const data = new Uint8Array(reader.length)
  for (let i = 0; i < reader.length; i++) data[i] = reader.getUint8At(i)
  return data
}
