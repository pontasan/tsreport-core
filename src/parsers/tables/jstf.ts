import { BinaryReader } from '../../binary/reader.js'
import { BinaryWriter } from '../../binary/writer.js'
import {
  buildCompactJstfMaxGposTable,
  collectJstfMaxGposGlyphIds,
  parseJstfMaxGposLookups,
  type JstfMaxTable,
} from './gpos.js'
import type { GdefTable } from './gdef.js'

/**
 * JSTF Priority: justification priority
 */
export interface JstfPriority {
  /** GSUB shrinkage enable lookup indices */
  readonly gsubShrinkageEnableLookups: readonly number[]
  /** GSUB shrinkage disable lookup indices */
  readonly gsubShrinkageDisableLookups: readonly number[]
  /** GPOS shrinkage enable lookup indices */
  readonly gposShrinkageEnableLookups: readonly number[]
  /** GPOS shrinkage disable lookup indices */
  readonly gposShrinkageDisableLookups: readonly number[]
  /** GSUB extension enable lookup indices */
  readonly gsubExtensionEnableLookups: readonly number[]
  /** GSUB extension disable lookup indices */
  readonly gsubExtensionDisableLookups: readonly number[]
  /** GPOS extension enable lookup indices */
  readonly gposExtensionEnableLookups: readonly number[]
  /** GPOS extension disable lookup indices */
  readonly gposExtensionDisableLookups: readonly number[]
  /** Executable maximum shrinkage positioning lookups. */
  readonly shrinkageJstfMax: JstfMaxTable | null
  /** Executable maximum extension positioning lookups. */
  readonly extensionJstfMax: JstfMaxTable | null
  /** Absolute source offset of the shrinkage JstfMax table. */
  readonly shrinkageJstfMaxOffset: number
  /** Absolute source offset of the extension JstfMax table. */
  readonly extensionJstfMaxOffset: number
}

/**
 * JSTF table: Justification
 */
export interface JstfTable {
  /** Parsed scripts and glyph closure used for compact rebuilding. */
  readonly subsetData: JstfSubsetData
  /** Get the list of justification priorities for the given script and language */
  getPriorities(script: string, lang?: string): readonly JstfPriority[]
  /** Get the list of extender glyphs for the given script */
  getExtenderGlyphs(script: string): readonly number[]
}

export interface JstfSubsetData {
  readonly majorVersion: number
  readonly minorVersion: number
  readonly scripts: ReadonlyMap<string, JstfSubsetScript>
  readonly referencedGlyphIds: ReadonlySet<number>
}

export interface JstfSubsetScript {
  readonly extenderGlyphs: readonly number[]
  readonly defaultPriorities: readonly JstfPriority[]
  readonly langSystems: ReadonlyMap<string, readonly JstfPriority[]>
}

interface JstfScriptRecord {
  readonly tag: string
  readonly offset: number
}

interface ParsedJstfScript {
  readonly extenderGlyphs: readonly number[]
  readonly defaultPriorities: readonly JstfPriority[]
  readonly langSystems: ReadonlyMap<string, readonly JstfPriority[]>
}

/**
 * Parse the JSTF table.
 * https://learn.microsoft.com/en-us/typography/opentype/spec/jstf
 */
export function parseJstf(reader: BinaryReader): JstfTable {
  validateRange(reader, 0, 6, 'JSTF header')
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== 1) {
    throw new Error(`Unsupported JSTF table version: ${majorVersion}.${minorVersion}`)
  }

  const jstfScriptCount = reader.readUint16()
  const recordsEnd = 6 + jstfScriptCount * 6
  validateRange(reader, 0, recordsEnd, 'JSTF script records')

  const scriptRecords: JstfScriptRecord[] = []
  let previousScriptTag = ''
  for (let i = 0; i < jstfScriptCount; i++) {
    const tag = reader.readTag()
    validateTag(tag, `JSTF script tag ${i}`)
    if (i > 0 && tag <= previousScriptTag) {
      throw new Error(`JSTF script records must be in alphabetical order: ${previousScriptTag} before ${tag}`)
    }
    const offset = reader.readUint16()
    validateSubtableOffset(reader, offset, recordsEnd, `JSTF script offset ${i}`)
    scriptRecords.push({ tag, offset })
    previousScriptTag = tag
  }

  const scripts = new Map<string, ParsedJstfScript>()
  for (const record of scriptRecords) {
    scripts.set(record.tag, parseJstfScript(reader, record.offset))
  }
  const referencedGlyphIds = new Set<number>()
  for (const script of scripts.values()) {
    for (let i = 0; i < script.extenderGlyphs.length; i++) referencedGlyphIds.add(script.extenderGlyphs[i]!)
    collectPriorityGlyphIds(reader, script.defaultPriorities, referencedGlyphIds)
    for (const priorities of script.langSystems.values()) collectPriorityGlyphIds(reader, priorities, referencedGlyphIds)
  }

  return {
    subsetData: { majorVersion, minorVersion, scripts, referencedGlyphIds },
    getPriorities(script: string, lang?: string): readonly JstfPriority[] {
      const data = scripts.get(script)
      if (!data) return []
      if (lang) {
        const priorities = data.langSystems.get(lang)
        if (priorities) return priorities
      }
      return data.defaultPriorities
    },
    getExtenderGlyphs(script: string): readonly number[] {
      return scripts.get(script)?.extenderGlyphs ?? []
    },
  }
}

function parseJstfScript(reader: BinaryReader, scriptOffset: number): ParsedJstfScript {
  validateRange(reader, scriptOffset, 6, 'JSTF JstfScript header')
  reader.seek(scriptOffset)
  const extenderGlyphOffset = reader.readUint16()
  const defaultLangSysOffset = reader.readUint16()
  const langSysCount = reader.readUint16()
  const recordsEnd = scriptOffset + 6 + langSysCount * 6
  validateRange(reader, scriptOffset, 6 + langSysCount * 6, 'JSTF JstfScript records')

  const langRecords: JstfScriptRecord[] = []
  let previousLangTag = ''
  for (let i = 0; i < langSysCount; i++) {
    const tag = reader.readTag()
    validateTag(tag, `JSTF LangSys tag ${i}`)
    if (i > 0 && tag <= previousLangTag) {
      throw new Error(`JSTF LangSys records must be in alphabetical order: ${previousLangTag} before ${tag}`)
    }
    const offset = reader.readUint16()
    validateSubtableOffset(reader, scriptOffset + offset, recordsEnd, `JSTF LangSys offset ${i}`)
    langRecords.push({ tag, offset })
    previousLangTag = tag
  }

  const extenderGlyphs = extenderGlyphOffset === 0
    ? []
    : parseExtenderGlyphs(reader, scriptOffset + extenderGlyphOffset, recordsEnd)
  const defaultPriorities = defaultLangSysOffset === 0
    ? []
    : parseJstfLangSys(reader, scriptOffset + defaultLangSysOffset, recordsEnd)
  const langSystems = new Map<string, readonly JstfPriority[]>()
  for (const record of langRecords) {
    langSystems.set(record.tag, parseJstfLangSys(reader, scriptOffset + record.offset, recordsEnd))
  }

  return { extenderGlyphs, defaultPriorities, langSystems }
}

function parseExtenderGlyphs(reader: BinaryReader, offset: number, minimumOffset: number): number[] {
  validateSubtableOffset(reader, offset, minimumOffset, 'JSTF ExtenderGlyph offset')
  validateRange(reader, offset, 2, 'JSTF ExtenderGlyph header')
  reader.seek(offset)
  const glyphCount = reader.readUint16()
  validateRange(reader, offset, 2 + glyphCount * 2, 'JSTF ExtenderGlyph array')

  const glyphs: number[] = []
  let previousGlyph = -1
  for (let i = 0; i < glyphCount; i++) {
    const glyph = reader.readUint16()
    if (glyph <= previousGlyph) {
      throw new Error(`JSTF ExtenderGlyph entries must be in increasing order at index ${i}`)
    }
    glyphs.push(glyph)
    previousGlyph = glyph
  }
  return glyphs
}

function parseJstfLangSys(reader: BinaryReader, offset: number, minimumOffset: number): JstfPriority[] {
  validateSubtableOffset(reader, offset, minimumOffset, 'JSTF JstfLangSys offset')
  validateRange(reader, offset, 2, 'JSTF JstfLangSys header')
  reader.seek(offset)
  const priorityCount = reader.readUint16()
  const priorityOffsetsEnd = offset + 2 + priorityCount * 2
  validateRange(reader, offset, 2 + priorityCount * 2, 'JSTF JstfLangSys priority offsets')

  const priorityOffsets: number[] = []
  for (let i = 0; i < priorityCount; i++) {
    const priorityOffset = reader.readUint16()
    validateSubtableOffset(reader, offset + priorityOffset, priorityOffsetsEnd, `JSTF priority offset ${i}`)
    priorityOffsets.push(priorityOffset)
  }

  const priorities: JstfPriority[] = []
  for (let i = 0; i < priorityOffsets.length; i++) {
    priorities.push(parsePriority(reader, offset + priorityOffsets[i]!))
  }
  return priorities
}

function parsePriority(reader: BinaryReader, offset: number): JstfPriority {
  validateRange(reader, offset, 20, 'JSTF JstfPriority header')
  reader.seek(offset)
  const gsubShrinkEnableOffset = reader.readUint16()
  const gsubShrinkDisableOffset = reader.readUint16()
  const gposShrinkEnableOffset = reader.readUint16()
  const gposShrinkDisableOffset = reader.readUint16()
  const shrinkJstfMaxOffset = reader.readUint16()
  const gsubExtendEnableOffset = reader.readUint16()
  const gsubExtendDisableOffset = reader.readUint16()
  const gposExtendEnableOffset = reader.readUint16()
  const gposExtendDisableOffset = reader.readUint16()
  const extendJstfMaxOffset = reader.readUint16()
  const shrinkageJstfMaxOffset = shrinkJstfMaxOffset === 0 ? 0 : offset + shrinkJstfMaxOffset
  const extensionJstfMaxOffset = extendJstfMaxOffset === 0 ? 0 : offset + extendJstfMaxOffset

  return {
    gsubShrinkageEnableLookups: parseJstfModList(reader, offset, gsubShrinkEnableOffset, 'JSTF GSUB shrinkage enable list'),
    gsubShrinkageDisableLookups: parseJstfModList(reader, offset, gsubShrinkDisableOffset, 'JSTF GSUB shrinkage disable list'),
    gposShrinkageEnableLookups: parseJstfModList(reader, offset, gposShrinkEnableOffset, 'JSTF GPOS shrinkage enable list'),
    gposShrinkageDisableLookups: parseJstfModList(reader, offset, gposShrinkDisableOffset, 'JSTF GPOS shrinkage disable list'),
    shrinkageJstfMax: parseJstfMax(reader, offset, shrinkJstfMaxOffset, 'JSTF shrinkage JstfMax'),
    gsubExtensionEnableLookups: parseJstfModList(reader, offset, gsubExtendEnableOffset, 'JSTF GSUB extension enable list'),
    gsubExtensionDisableLookups: parseJstfModList(reader, offset, gsubExtendDisableOffset, 'JSTF GSUB extension disable list'),
    gposExtensionEnableLookups: parseJstfModList(reader, offset, gposExtendEnableOffset, 'JSTF GPOS extension enable list'),
    gposExtensionDisableLookups: parseJstfModList(reader, offset, gposExtendDisableOffset, 'JSTF GPOS extension disable list'),
    extensionJstfMax: parseJstfMax(reader, offset, extendJstfMaxOffset, 'JSTF extension JstfMax'),
    shrinkageJstfMaxOffset,
    extensionJstfMaxOffset,
  }
}

function parseJstfModList(reader: BinaryReader, priorityOffset: number, relativeOffset: number, label: string): number[] {
  if (relativeOffset === 0) return []
  const offset = priorityOffset + relativeOffset
  validateSubtableOffset(reader, offset, priorityOffset + 20, `${label} offset`)
  validateRange(reader, offset, 2, `${label} header`)
  reader.seek(offset)
  const count = reader.readUint16()
  validateRange(reader, offset, 2 + count * 2, `${label} lookup indices`)

  const indices: number[] = []
  let previousIndex = -1
  for (let i = 0; i < count; i++) {
    const index = reader.readUint16()
    if (index <= previousIndex) {
      throw new Error(`${label} lookup indices must be in increasing order at index ${i}`)
    }
    indices.push(index)
    previousIndex = index
  }
  return indices
}

function parseJstfMax(reader: BinaryReader, priorityOffset: number, relativeOffset: number, label: string): JstfMaxTable | null {
  if (relativeOffset === 0) return null
  const offset = priorityOffset + relativeOffset
  validateSubtableOffset(reader, offset, priorityOffset + 20, `${label} offset`)
  validateRange(reader, offset, 2, `${label} header`)
  reader.seek(offset)
  const lookupCount = reader.readUint16()
  const lookupOffsetsEnd = offset + 2 + lookupCount * 2
  validateRange(reader, offset, 2 + lookupCount * 2, `${label} lookup offset array`)

  const lookupOffsets: number[] = []
  for (let i = 0; i < lookupCount; i++) {
    const lookupOffset = reader.readUint16()
    validateSubtableOffset(reader, offset + lookupOffset, lookupOffsetsEnd, `${label} lookup offset ${i}`)
    lookupOffsets.push(lookupOffset)
  }

  const lookupStarts = lookupOffsets.map(lookupOffset => offset + lookupOffset)
  return parseJstfMaxGposLookups(reader, lookupStarts, label)
}

/** Rebuilds JSTF extender glyphs and embedded JstfMax GPOS lookups for compact GIDs. */
export function buildCompactJstfTable(
  reader: BinaryReader,
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable },
): Uint8Array {
  const jstf = parseJstf(reader)
  const scripts = [...jstf.subsetData.scripts].sort(compareTaggedRecords)
  const writer = new BinaryWriter()
  writer.writeUint16(jstf.subsetData.majorVersion)
  writer.writeUint16(jstf.subsetData.minorVersion)
  writer.writeUint16(scripts.length)
  const offsetsPosition = writer.position
  for (let i = 0; i < scripts.length; i++) {
    writer.writeTag(scripts[i]![0])
    writer.writeUint16(0)
  }
  for (let i = 0; i < scripts.length; i++) {
    patchJstfOffset16(writer, offsetsPosition + i * 6 + 4, writer.position, 'script')
    writer.writeBytes(serializeJstfScript(reader, scripts[i]![1], oldToNew, variation))
  }
  return writer.toUint8Array()
}

function collectPriorityGlyphIds(
  reader: BinaryReader,
  priorities: readonly JstfPriority[],
  out: Set<number>,
): void {
  for (let i = 0; i < priorities.length; i++) {
    const priority = priorities[i]!
    if (priority.shrinkageJstfMaxOffset !== 0) {
      collectJstfMaxGposGlyphIds(reader, priority.shrinkageJstfMaxOffset, out)
    }
    if (priority.extensionJstfMaxOffset !== 0) {
      collectJstfMaxGposGlyphIds(reader, priority.extensionJstfMaxOffset, out)
    }
  }
}

function serializeJstfScript(
  reader: BinaryReader,
  script: JstfSubsetScript,
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable },
): Uint8Array {
  const languages = [...script.langSystems].sort(compareTaggedRecords)
  const writer = new BinaryWriter()
  const extenderOffsetPosition = writer.position
  writer.writeUint16(0)
  const defaultOffsetPosition = writer.position
  writer.writeUint16(0)
  writer.writeUint16(languages.length)
  const languageOffsetsPosition = writer.position
  for (let i = 0; i < languages.length; i++) {
    writer.writeTag(languages[i]![0])
    writer.writeUint16(0)
  }
  if (script.extenderGlyphs.length !== 0) {
    patchJstfOffset16(writer, extenderOffsetPosition, writer.position, 'ExtenderGlyph')
    const mapped = new Array<number>(script.extenderGlyphs.length)
    for (let i = 0; i < script.extenderGlyphs.length; i++) {
      const oldGlyphId = script.extenderGlyphs[i]!
      const newGlyphId = oldToNew.get(oldGlyphId)
      if (newGlyphId === undefined) throw new Error(`JSTF compact subset lost extender glyph ${oldGlyphId}`)
      mapped[i] = newGlyphId
    }
    mapped.sort(compareNumbers)
    writer.writeUint16(mapped.length)
    for (let i = 0; i < mapped.length; i++) writer.writeUint16(mapped[i]!)
  }
  if (script.defaultPriorities.length !== 0) {
    patchJstfOffset16(writer, defaultOffsetPosition, writer.position, 'default LangSys')
    writer.writeBytes(serializeJstfLangSys(reader, script.defaultPriorities, oldToNew, variation))
  }
  for (let i = 0; i < languages.length; i++) {
    patchJstfOffset16(writer, languageOffsetsPosition + i * 6 + 4, writer.position, 'LangSys')
    writer.writeBytes(serializeJstfLangSys(reader, languages[i]![1], oldToNew, variation))
  }
  return writer.toUint8Array()
}

function serializeJstfLangSys(
  reader: BinaryReader,
  priorities: readonly JstfPriority[],
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable },
): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint16(priorities.length)
  const offsetsPosition = writer.position
  for (let i = 0; i < priorities.length; i++) writer.writeUint16(0)
  for (let i = 0; i < priorities.length; i++) {
    patchJstfOffset16(writer, offsetsPosition + i * 2, writer.position, 'priority')
    writer.writeBytes(serializeJstfPriority(reader, priorities[i]!, oldToNew, variation))
  }
  return writer.toUint8Array()
}

function serializeJstfPriority(
  reader: BinaryReader,
  priority: JstfPriority,
  oldToNew: ReadonlyMap<number, number>,
  variation?: { readonly coords: number[], readonly gdef: GdefTable },
): Uint8Array {
  const writer = new BinaryWriter()
  for (let i = 0; i < 10; i++) writer.writeUint16(0)
  const lists: readonly (readonly number[])[] = [
    priority.gsubShrinkageEnableLookups,
    priority.gsubShrinkageDisableLookups,
    priority.gposShrinkageEnableLookups,
    priority.gposShrinkageDisableLookups,
    [],
    priority.gsubExtensionEnableLookups,
    priority.gsubExtensionDisableLookups,
    priority.gposExtensionEnableLookups,
    priority.gposExtensionDisableLookups,
    [],
  ]
  for (let i = 0; i < lists.length; i++) {
    if (i === 4 || i === 9 || lists[i]!.length === 0) continue
    patchJstfOffset16(writer, i * 2, writer.position, 'modification list')
    writer.writeUint16(lists[i]!.length)
    for (let index = 0; index < lists[i]!.length; index++) writer.writeUint16(lists[i]![index]!)
  }
  if (priority.shrinkageJstfMaxOffset !== 0) {
    patchJstfOffset16(writer, 8, writer.position, 'shrinkage JstfMax')
    writer.writeBytes(buildCompactJstfMaxGposTable(reader, priority.shrinkageJstfMaxOffset, oldToNew, variation))
  }
  if (priority.extensionJstfMaxOffset !== 0) {
    patchJstfOffset16(writer, 18, writer.position, 'extension JstfMax')
    writer.writeBytes(buildCompactJstfMaxGposTable(reader, priority.extensionJstfMaxOffset, oldToNew, variation))
  }
  return writer.toUint8Array()
}

function patchJstfOffset16(writer: BinaryWriter, position: number, offset: number, label: string): void {
  if (offset > 0xFFFF) throw new Error(`JSTF ${label} offset exceeds Offset16 range: ${offset}`)
  const end = writer.position
  writer.position = position
  writer.writeUint16(offset)
  writer.position = end
}

function compareTaggedRecords<T>(left: readonly [string, T], right: readonly [string, T]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
}

function compareNumbers(left: number, right: number): number {
  return left - right
}

function validateSubtableOffset(reader: BinaryReader, offset: number, minimumOffset: number, label: string): void {
  if (offset === 0) {
    throw new Error(`${label} must be non-zero`)
  }
  if (offset < minimumOffset) {
    throw new Error(`${label} overlaps parent header`)
  }
  if (offset >= reader.length) {
    throw new Error(`${label} exceeds JSTF table length: ${offset}`)
  }
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${label} exceeds JSTF table length: need ${offset + length}, got ${reader.length}`)
  }
}

function validateTag(tag: string, label: string): void {
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i)
    if (code < 0x20 || code > 0x7E) {
      throw new Error(`${label} must contain printable ASCII characters: ${tag}`)
    }
  }
}
