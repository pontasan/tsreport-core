import { BinaryWriter } from '../binary/writer.js'
import type {
  GlatGlyphAttrs, GlatOctabox, SilfClassMap, SilfPass, SilfPassRange, SilfSubtable, SilfTable,
} from '../parsers/tables/graphite.js'
import type { SfntTableManager } from '../parsers/ttf-parser.js'

export interface GraphiteSubsetTables {
  Glat: Uint8Array
  Gloc: Uint8Array
  Silf: Uint8Array
}

function mappedGlyph(oldToNew: ReadonlyMap<number, number>, glyphId: number, context: string): number {
  const mapped = oldToNew.get(glyphId)
  if (mapped === undefined) throw new Error(`Graphite subset lost ${context} glyph ${glyphId}`)
  return mapped
}

function addGraphiteGlyph(included: Set<number>, glyphId: number, graphiteGlyphCount: number): void {
  if (glyphId !== 0xffff && glyphId >= 0 && glyphId < graphiteGlyphCount) included.add(glyphId)
}

function collectGraphiteReferencedIds(manager: SfntTableManager, physicalSeeds: ReadonlySet<number>): Set<number> {
  const silf = manager.silf
  const glat = manager.glat
  const gloc = manager.gloc
  const included = new Set<number>(physicalSeeds)
  if (silf === null || glat === null || gloc === null) return included
  const glyphCount = gloc.numGlyphs
  for (let subIndex = 0; subIndex < silf.subtables.length; subIndex++) {
    const subtable = silf.subtables[subIndex]!
    addGraphiteGlyph(included, subtable.lbGID, glyphCount)
    for (let i = 0; i < subtable.pseudoMaps.length; i++) {
      addGraphiteGlyph(included, subtable.pseudoMaps[i]!.pseudoGlyph, glyphCount)
    }
    for (let i = 0; i < subtable.classMap.linearClasses.length; i++) {
      const glyphs = subtable.classMap.linearClasses[i]!
      for (let j = 0; j < glyphs.length; j++) addGraphiteGlyph(included, glyphs[j]!, glyphCount)
    }
    for (let i = 0; i < subtable.classMap.lookupClasses.length; i++) {
      const glyphs = subtable.classMap.lookupClasses[i]!.glyphIds
      for (let j = 0; j < glyphs.length; j++) addGraphiteGlyph(included, glyphs[j]!, glyphCount)
    }
    for (let i = 0; i < subtable.passes.length; i++) {
      const firstRange = subtable.passes[i]!.ranges[0]
      if (firstRange !== undefined) addGraphiteGlyph(included, firstRange.firstId, glyphCount)
    }
  }

  let previousSize = -1
  while (previousSize !== included.size) {
    previousSize = included.size
    const glyphs = [...included]
    for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex++) {
      const glyphId = glyphs[glyphIndex]!
      if (glyphId >= gloc.numGlyphs) continue
      for (let subIndex = 0; subIndex < silf.subtables.length; subIndex++) {
        const subtable = silf.subtables[subIndex]!
        const pseudo = glat.getAttr(glyphId, subtable.attrPseudo) & 0xffff
        const mirror = glat.getAttr(glyphId, subtable.attrMirroring) & 0xffff
        if (pseudo !== 0) addGraphiteGlyph(included, pseudo, glyphCount)
        if (mirror !== 0) addGraphiteGlyph(included, mirror, glyphCount)
      }
    }
  }
  return included
}

/** Expands a physical-outline subset through every glyph-valued Graphite edge. */
export function collectGraphiteGlyphReferences(manager: SfntTableManager, included: Set<number>): void {
  const referenced = collectGraphiteReferencedIds(manager, included)
  const physicalGlyphCount = manager.maxp.numGlyphs
  for (const glyphId of referenced) {
    if (glyphId < physicalGlyphCount) included.add(glyphId)
  }
}

function writeOctabox(writer: BinaryWriter, octabox: GlatOctabox | null): void {
  if (octabox === null) {
    writer.writeUint16(0)
    writer.writeUint8(0)
    writer.writeUint8(0)
    writer.writeUint8(0)
    writer.writeUint8(0)
    return
  }
  writer.writeUint16(octabox.subboxBitmap)
  writer.writeUint8(octabox.diagNegMin)
  writer.writeUint8(octabox.diagNegMax)
  writer.writeUint8(octabox.diagPosMin)
  writer.writeUint8(octabox.diagPosMax)
  for (let i = 0; i < octabox.subboxes.length; i++) {
    const box = octabox.subboxes[i]!
    writer.writeUint8(box.left)
    writer.writeUint8(box.right)
    writer.writeUint8(box.bottom)
    writer.writeUint8(box.top)
    writer.writeUint8(box.diagNegMin)
    writer.writeUint8(box.diagNegMax)
    writer.writeUint8(box.diagPosMin)
    writer.writeUint8(box.diagPosMax)
  }
}

function glyphReferenceAttributes(silf: SilfTable): Set<number> {
  const result = new Set<number>()
  for (let i = 0; i < silf.subtables.length; i++) {
    result.add(silf.subtables[i]!.attrPseudo)
    result.add(silf.subtables[i]!.attrMirroring)
  }
  return result
}

function writeGlatGlyph(
  writer: BinaryWriter,
  attrs: GlatGlyphAttrs,
  version: number,
  referenceAttributes: ReadonlySet<number>,
  oldToNew: ReadonlyMap<number, number>,
): void {
  if (version >= 0x00030000) writeOctabox(writer, attrs.octabox)
  const wide = version >= 0x00020000
  for (let runIndex = 0; runIndex < attrs.runs.length; runIndex++) {
    const run = attrs.runs[runIndex]!
    if (wide) {
      writer.writeUint16(run.firstAttr)
      writer.writeUint16(run.values.length)
    } else {
      writer.writeUint8(run.firstAttr)
      writer.writeUint8(run.values.length)
    }
    for (let valueIndex = 0; valueIndex < run.values.length; valueIndex++) {
      const attribute = run.firstAttr + valueIndex
      let value = run.values[valueIndex]!
      if (referenceAttributes.has(attribute) && value !== 0) {
        const mapped = mappedGlyph(oldToNew, value & 0xffff, `attribute ${attribute}`)
        value = mapped > 0x7fff ? mapped - 0x10000 : mapped
      }
      writer.writeInt16(value)
    }
  }
}

function buildGlatAndGloc(
  manager: SfntTableManager,
  silf: SilfTable,
  oldToNew: ReadonlyMap<number, number>,
): Pick<GraphiteSubsetTables, 'Glat' | 'Gloc'> {
  const glat = manager.glat!
  const gloc = manager.gloc!
  const byNew = [...oldToNew.entries()].sort(function (left, right) { return left[1] - right[1] })
  const glatWriter = new BinaryWriter()
  glatWriter.writeUint32(glat.version)
  if (glat.version >= 0x00030000) glatWriter.writeUint32(1)
  const locations: number[] = [glatWriter.position]
  const references = glyphReferenceAttributes(silf)
  for (let i = 0; i < byNew.length; i++) {
    writeGlatGlyph(glatWriter, glat.getGlyphAttrs(byNew[i]![0]), glat.version, references, oldToNew)
    locations.push(glatWriter.position)
  }
  const longLocations = gloc.isLongFormat || locations[locations.length - 1]! > 0xffff
  const glocWriter = new BinaryWriter()
  glocWriter.writeUint32(gloc.version)
  glocWriter.writeUint16((gloc.flags & ~1) | (longLocations ? 1 : 0))
  glocWriter.writeUint16(gloc.numAttribs)
  for (let i = 0; i < locations.length; i++) {
    if (longLocations) glocWriter.writeUint32(locations[i]!)
    else glocWriter.writeUint16(locations[i]!)
  }
  if (gloc.attribIds !== null) {
    for (let i = 0; i < gloc.attribIds.length; i++) glocWriter.writeUint16(gloc.attribIds[i]!)
  }
  return { Glat: glatWriter.toUint8Array(), Gloc: glocWriter.toUint8Array() }
}

function writeSearchHeader(writer: BinaryWriter, count: number): void {
  if (count === 0) {
    writer.writeUint16(0)
    writer.writeUint16(0)
    writer.writeUint16(0)
    return
  }
  let power = 1
  let selector = 0
  while (power * 2 <= count) {
    power *= 2
    selector++
  }
  writer.writeUint16(power)
  writer.writeUint16(selector)
  writer.writeUint16(count - power)
}

function buildClassMap(classMap: SilfClassMap, version: number, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const offsetWidth = version >= 0x00040000 ? 4 : 2
  const headerSize = 4 + offsetWidth * (classMap.numClass + 1)
  const classData: Uint8Array[] = []
  const offsets: number[] = [headerSize]
  for (let i = 0; i < classMap.linearClasses.length; i++) {
    const source = classMap.linearClasses[i]!
    const writer = new BinaryWriter(source.length * 2)
    for (let j = 0; j < source.length; j++) {
      writer.writeUint16(mappedGlyph(oldToNew, source[j]!, `linear class ${i}`))
    }
    classData.push(writer.toUint8Array())
    offsets.push(offsets[offsets.length - 1]! + writer.position)
  }
  for (let i = 0; i < classMap.lookupClasses.length; i++) {
    const source = classMap.lookupClasses[i]!
    const pairs: Array<{ glyphId: number, index: number }> = []
    for (let j = 0; j < source.glyphIds.length; j++) {
      pairs.push({
        glyphId: mappedGlyph(oldToNew, source.glyphIds[j]!, `lookup class ${i}`),
        index: source.indices[j]!,
      })
    }
    pairs.sort(function (left, right) { return left.glyphId - right.glyphId })
    const writer = new BinaryWriter(8 + pairs.length * 4)
    writer.writeUint16(pairs.length)
    writeSearchHeader(writer, pairs.length)
    for (let j = 0; j < pairs.length; j++) {
      writer.writeUint16(pairs[j]!.glyphId)
      writer.writeUint16(pairs[j]!.index)
    }
    classData.push(writer.toUint8Array())
    offsets.push(offsets[offsets.length - 1]! + writer.position)
  }
  const writer = new BinaryWriter(offsets[offsets.length - 1]!)
  writer.writeUint16(classMap.numClass)
  writer.writeUint16(classMap.numLinear)
  for (let i = 0; i < offsets.length; i++) {
    if (offsetWidth === 4) writer.writeUint32(offsets[i]!)
    else writer.writeUint16(offsets[i]!)
  }
  for (let i = 0; i < classData.length; i++) writer.writeBytes(classData[i]!)
  return writer.toUint8Array()
}

function rangeColumn(ranges: readonly SilfPassRange[], glyphId: number): number {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const range = ranges[middle]!
    if (glyphId < range.firstId) high = middle - 1
    else if (glyphId > range.lastId) low = middle + 1
    else return range.colId
  }
  return -1
}

function remapRanges(pass: SilfPass, oldToNew: ReadonlyMap<number, number>): SilfPassRange[] {
  const byNew = [...oldToNew.entries()].sort(function (left, right) { return left[1] - right[1] })
  const ranges: SilfPassRange[] = []
  for (let i = 0; i < byNew.length; i++) {
    const column = rangeColumn(pass.ranges, byNew[i]![0])
    if (column < 0) continue
    const glyphId = byNew[i]![1]
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && previous.colId === column && previous.lastId + 1 === glyphId) {
      previous.lastId = glyphId
    } else {
      ranges.push({ firstId: glyphId, lastId: glyphId, colId: column })
    }
  }
  if (pass.numRules !== 0 && ranges.length === 0) {
    throw new Error('Graphite subset produced a rule pass without a reachable glyph range')
  }
  return ranges
}

function writeUint16Array(writer: BinaryWriter, values: ArrayLike<number>): void {
  for (let i = 0; i < values.length; i++) writer.writeUint16(values[i]!)
}

function buildPass(pass: SilfPass, subtableOffset: number, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const ranges = remapRanges(pass, oldToNew)
  const body = new BinaryWriter()
  body.writeUint16(pass.numRows)
  body.writeUint16(pass.numTransitional)
  body.writeUint16(pass.numSuccess)
  body.writeUint16(pass.numColumns)
  body.writeUint16(ranges.length)
  writeSearchHeader(body, ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    body.writeUint16(ranges[i]!.firstId)
    body.writeUint16(ranges[i]!.lastId)
    body.writeUint16(ranges[i]!.colId)
  }
  writeUint16Array(body, pass.oRuleMap)
  writeUint16Array(body, pass.ruleMap)
  body.writeUint8(pass.minRulePreContext)
  body.writeUint8(pass.maxRulePreContext)
  writeUint16Array(body, pass.startStates)
  writeUint16Array(body, pass.ruleSortKeys)
  body.writeBytes(pass.rulePreContext)
  body.writeUint8(pass.collisionThreshold === 10 ? 0 : pass.collisionThreshold)
  body.writeUint16(pass.passConstraints.length)
  writeUint16Array(body, pass.oConstraints)
  writeUint16Array(body, pass.oActions)
  writeUint16Array(body, pass.stateTransitions)
  body.writeUint8(0)

  const pcCode = subtableOffset + 24 + body.position
  const rcCode = pcCode + pass.passConstraints.length
  const aCode = rcCode + pass.ruleConstraints.length
  const oDebug = pass.debug === null ? 0 : aCode + pass.actions.length
  const writer = new BinaryWriter(24 + body.position + pass.passConstraints.length + pass.ruleConstraints.length + pass.actions.length)
  writer.writeUint8(pass.flags)
  writer.writeUint8(pass.maxRuleLoop)
  writer.writeUint8(pass.maxRuleContext)
  writer.writeUint8(pass.maxBackup)
  writer.writeUint16(pass.numRules)
  writer.writeUint16(24)
  writer.writeUint32(pcCode)
  writer.writeUint32(rcCode)
  writer.writeUint32(aCode)
  writer.writeUint32(oDebug)
  writer.writeBytes(body.toUint8Array())
  writer.writeBytes(pass.passConstraints)
  writer.writeBytes(pass.ruleConstraints)
  writer.writeBytes(pass.actions)
  if (pass.debug !== null) {
    writeUint16Array(writer, pass.debug.dActions)
    writeUint16Array(writer, pass.debug.dStates)
    writeUint16Array(writer, pass.debug.dCols)
  }
  return writer.toUint8Array()
}

function buildSubtable(
  subtable: SilfSubtable,
  version: number,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const numPasses = subtable.passes.length
  const version3 = version >= 0x00030000
  const headerSize = (version3 ? 8 : 0)
    + 20
    + subtable.jLevels.length * 8
    + 10
    + subtable.critFeatures.length * 2
    + 2
    + subtable.scriptTags.length * 4
    + 2
    + (numPasses + 1) * 4
    + 8
    + subtable.pseudoMaps.length * 6
  const classMap = buildClassMap(subtable.classMap, version, oldToNew)
  const passOffsets: number[] = [headerSize + classMap.length]
  const passes: Uint8Array[] = []
  for (let i = 0; i < numPasses; i++) {
    const bytes = buildPass(subtable.passes[i]!, passOffsets[i]!, oldToNew)
    passes.push(bytes)
    passOffsets.push(passOffsets[i]! + bytes.length)
  }

  const writer = new BinaryWriter(passOffsets[numPasses]!)
  if (version3) {
    writer.writeUint32(subtable.ruleVersion)
    writer.writeUint16(subtable.passOffset)
    writer.writeUint16(subtable.pseudosOffset)
  }
  writer.writeUint16(oldToNew.size - 1)
  writer.writeInt16(subtable.extraAscent)
  writer.writeInt16(subtable.extraDescent)
  writer.writeUint8(numPasses)
  writer.writeUint8(subtable.iSubst)
  writer.writeUint8(subtable.iPos)
  writer.writeUint8(subtable.iJust)
  writer.writeUint8(subtable.iBidi)
  writer.writeUint8(subtable.flags)
  writer.writeUint8(subtable.maxPreContext)
  writer.writeUint8(subtable.maxPostContext)
  writer.writeUint8(subtable.attrPseudo)
  writer.writeUint8(subtable.attrBreakWeight)
  writer.writeUint8(subtable.attrDirectionality)
  writer.writeUint8(subtable.attrMirroring)
  writer.writeUint8(subtable.attrSkipPasses)
  writer.writeUint8(subtable.jLevels.length)
  for (let i = 0; i < subtable.jLevels.length; i++) {
    const level = subtable.jLevels[i]!
    writer.writeUint8(level.attrStretch)
    writer.writeUint8(level.attrShrink)
    writer.writeUint8(level.attrStep)
    writer.writeUint8(level.attrWeight)
    writer.writeUint8(level.runto)
    writer.writeUint8(0)
    writer.writeUint8(0)
    writer.writeUint8(0)
  }
  writer.writeUint16(subtable.numLigComp)
  writer.writeUint8(subtable.numUserDefn)
  writer.writeUint8(subtable.maxCompPerLig)
  writer.writeUint8(subtable.direction + 1)
  writer.writeUint8(subtable.attCollisions)
  writer.writeUint8(0)
  writer.writeUint8(0)
  writer.writeUint8(0)
  writer.writeUint8(subtable.critFeatures.length)
  writeUint16Array(writer, subtable.critFeatures)
  writer.writeUint8(0)
  writer.writeUint8(subtable.scriptTags.length)
  for (let i = 0; i < subtable.scriptTags.length; i++) writer.writeTag(subtable.scriptTags[i]!)
  const lineEnd = subtable.lbGID === 0xffff
    ? 0xffff
    : mappedGlyph(oldToNew, subtable.lbGID, 'line-end')
  writer.writeUint16(lineEnd)
  for (let i = 0; i < passOffsets.length; i++) writer.writeUint32(passOffsets[i]!)
  writer.writeUint16(subtable.pseudoMaps.length)
  writer.writeUint16(subtable.searchPseudo)
  writer.writeUint16(subtable.pseudoSelector)
  writer.writeUint16(subtable.pseudoShift)
  for (let i = 0; i < subtable.pseudoMaps.length; i++) {
    writer.writeUint32(subtable.pseudoMaps[i]!.unicode)
    writer.writeUint16(mappedGlyph(oldToNew, subtable.pseudoMaps[i]!.pseudoGlyph, 'pseudo'))
  }
  if (writer.position !== headerSize) {
    throw new Error(`Graphite Silf subset header size mismatch (${writer.position} != ${headerSize}; passes=${numPasses}, just=${subtable.jLevels.length}, crit=${subtable.critFeatures.length}, scripts=${subtable.scriptTags.length}, pseudos=${subtable.pseudoMaps.length})`)
  }
  writer.writeBytes(classMap)
  for (let i = 0; i < passes.length; i++) writer.writeBytes(passes[i]!)
  return writer.toUint8Array()
}

function buildSilf(silf: SilfTable, oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const headerSize = (silf.version >= 0x00030000 ? 8 : 4) + 4 + silf.subtables.length * 4
  const subtables: Uint8Array[] = []
  const offsets: number[] = []
  let offset = headerSize
  for (let i = 0; i < silf.subtables.length; i++) {
    offsets.push(offset)
    const bytes = buildSubtable(silf.subtables[i]!, silf.version, oldToNew)
    subtables.push(bytes)
    offset += bytes.length
  }
  const writer = new BinaryWriter(offset)
  writer.writeUint32(silf.version)
  if (silf.version >= 0x00030000) writer.writeUint32(silf.compilerVersion)
  writer.writeUint16(silf.subtables.length)
  writer.writeUint16(0)
  for (let i = 0; i < offsets.length; i++) writer.writeUint32(offsets[i]!)
  for (let i = 0; i < subtables.length; i++) writer.writeBytes(subtables[i]!)
  return writer.toUint8Array()
}

/** Reorders and remaps all glyph-indexed Graphite tables for a compact subset. */
export function buildGraphiteSubsetTables(
  manager: SfntTableManager,
  oldToNew: ReadonlyMap<number, number>,
): GraphiteSubsetTables | null {
  const silf = manager.silf
  if (silf === null || manager.glat === null || manager.gloc === null) return null
  const extendedMapping = new Map<number, number>(oldToNew)
  const referenced = collectGraphiteReferencedIds(manager, new Set(oldToNew.keys()))
  const virtualGlyphs = [...referenced].filter(function (glyphId) {
    return glyphId >= manager.maxp.numGlyphs
  }).sort(function (left, right) { return left - right })
  for (let i = 0; i < virtualGlyphs.length; i++) {
    extendedMapping.set(virtualGlyphs[i]!, extendedMapping.size)
  }
  const attributes = buildGlatAndGloc(manager, silf, extendedMapping)
  return { ...attributes, Silf: buildSilf(silf, extendedMapping) }
}
