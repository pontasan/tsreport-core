import { getComplementOffset } from '../parsers/tables/prop.js'
import type { SfntTableManager } from '../parsers/ttf-parser.js'
import { BinaryWriter } from '../binary/writer.js'
import type { AatStateEntry, AatStateTable } from '../parsers/tables/aat-common.js'
import type { JustDirectionData, JustPostcompAction, JustWidthDeltaPair } from '../parsers/tables/just.js'
import type {
  KerxFormat0Data, KerxFormat1Data, KerxFormat2Data, KerxFormat4Data, KerxFormat6Data, KerxSubtableInfo,
} from '../parsers/tables/kerx.js'
import type { MorxChain, MorxSubtable } from '../parsers/tables/morx.js'
import type { MortChain, MortSubtable } from '../parsers/tables/mort.js'

const COMPLEMENT_MASK = 0x0F00

export type AatSubsetTables = Map<string, Uint8Array>

/** Expands a physical glyph subset through every glyph-valued AAT edge. */
export function collectAatGlyphReferences(manager: SfntTableManager, included: Set<number>): void {
  const numGlyphs = manager.maxp.numGlyphs
  const add = function (glyphId: number): void {
    if (glyphId >= 0 && glyphId < numGlyphs) included.add(glyphId)
  }

  let previousSize = -1
  while (previousSize !== included.size) {
    previousSize = included.size
    collectMorxReachableReferences(manager.morx, included, add)
    collectMortReachableReferences(manager.mort, included, add)

    const bsln = manager.bsln
    if (bsln?.stdGlyph !== null && bsln?.stdGlyph !== undefined) add(bsln.stdGlyph)
    const fmtx = manager.fmtx
    if (fmtx !== null) add(fmtx.glyphIndex)

    const sources = [...included]
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const glyphId = sources[sourceIndex]!
      const attachment = manager.acnt?.getAttachment(glyphId)
      if (attachment !== null && attachment !== undefined) {
        add(attachment.primaryGlyphIndex)
        for (let i = 0; i < attachment.components.length; i++) add(attachment.components[i]!.secondaryGlyphIndex)
      }

      const properties = manager.prop?.getProperties(glyphId)
      if (properties !== undefined) {
        const complement = getComplementOffset(properties)
        if (complement !== 0) add(glyphId + complement)
      }

      collectJustificationReferences(manager.just?.horizontal ?? null, glyphId, add)
      collectJustificationReferences(manager.just?.vertical ?? null, glyphId, add)

      const info = manager.zapf?.getGlyphInfo(glyphId)
      if (info !== null && info !== undefined) {
        for (let groupIndex = 0; groupIndex < info.groups.length; groupIndex++) {
          const subgroups = info.groups[groupIndex]!.subgroups
          for (let subgroupIndex = 0; subgroupIndex < subgroups.length; subgroupIndex++) {
            const glyphs = subgroups[subgroupIndex]!.glyphs
            for (let i = 0; i < glyphs.length; i++) add(glyphs[i]!)
          }
        }
      }
    }
  }
}

function reachableStateEntries(stateTable: AatStateTable, included: ReadonlySet<number>): AatStateEntry[] {
  const classes = new Set<number>([0, 2, 3])
  for (const glyphId of included) classes.add(stateTable.getClass(glyphId))
  const pending = [0, 1]
  const visited = new Set<number>()
  const entries: AatStateEntry[] = []
  const seenEntries = new Set<AatStateEntry>()
  while (pending.length > 0) {
    const state = pending.pop()!
    if (visited.has(state)) continue
    visited.add(state)
    for (const cls of classes) {
      const entry = stateTable.getEntry(state, cls)
      if (!seenEntries.has(entry)) {
        seenEntries.add(entry)
        entries.push(entry)
      }
      if (!visited.has(entry.newState)) pending.push(entry.newState)
    }
  }
  return entries
}

function collectMorxReachableReferences(
  table: SfntTableManager['morx'],
  included: ReadonlySet<number>,
  add: (glyphId: number) => void,
): void {
  if (table === null) return
  for (let chainIndex = 0; chainIndex < table.chains.length; chainIndex++) {
    const subtables = table.chains[chainIndex]!.subtables
    for (let subtableIndex = 0; subtableIndex < subtables.length; subtableIndex++) {
      const data = subtables[subtableIndex]!.subsetData
      if (data.type === 1) {
        for (const lookup of data.lookups.values()) {
          for (const glyphId of included) {
            const replacement = lookup.get(glyphId)
            if (replacement !== undefined) add(replacement)
          }
        }
      } else if (data.type === 2) {
        const entries = reachableStateEntries(data.stateTable, included)
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
          if ((entries[entryIndex]!.flags & 0x2000) === 0) continue
          let actionIndex = entries[entryIndex]!.extra[0]!
          let sums = new Set<number>([0])
          let last = false
          while (!last) {
            const action = data.ligatureActions[actionIndex]
            if (action === undefined) throw new Error('morx subset ligature action exceeds action table')
            actionIndex++
            last = (action & 0x80000000) !== 0
            const store = (action & 0x40000000) !== 0
            let addend = action & 0x3FFFFFFF
            if ((addend & 0x20000000) !== 0) addend -= 0x40000000
            const contributions = new Set<number>()
            for (const glyphId of included) {
              const componentIndex = glyphId + addend
              if (componentIndex >= 0 && componentIndex < data.components.length) contributions.add(data.components[componentIndex]!)
            }
            const next = new Set<number>()
            for (const sum of sums) for (const contribution of contributions) next.add(sum + contribution)
            sums = next
            if (store || last) {
              for (const ligatureIndex of sums) {
                if (ligatureIndex >= 0 && ligatureIndex < data.ligatures.length) add(data.ligatures[ligatureIndex]!)
              }
              sums = new Set<number>([0])
            }
          }
        }
      } else if (data.type === 4) {
        for (const glyphId of included) {
          const replacement = data.lookup.get(glyphId)
          if (replacement !== undefined) add(replacement)
        }
      } else if (data.type === 5) {
        const entries = reachableStateEntries(data.stateTable, included)
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
          const entry = entries[entryIndex]!
          const ranges = [
            { index: entry.extra[0]!, count: (entry.flags >>> 5) & 0x1F },
            { index: entry.extra[1]!, count: entry.flags & 0x1F },
          ]
          for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
            const range = ranges[rangeIndex]!
            if (range.count === 0 || range.index === 0xFFFF) continue
            for (let i = 0; i < range.count; i++) add(data.insertionGlyphs[range.index + i]!)
          }
        }
      }
    }
  }
}

function collectMortReachableReferences(
  table: SfntTableManager['mort'],
  included: ReadonlySet<number>,
  add: (glyphId: number) => void,
): void {
  if (table === null) return
  for (let chainIndex = 0; chainIndex < table.chains.length; chainIndex++) {
    const subtables = table.chains[chainIndex]!.subtables
    for (let subtableIndex = 0; subtableIndex < subtables.length; subtableIndex++) {
      const data = subtables[subtableIndex]!.subsetData
      if (data.type === 1) {
        for (const substitutions of data.substitutions.values()) {
          for (const glyphId of included) {
            const replacement = substitutions.get(glyphId)
            if (replacement !== undefined) add(replacement)
          }
        }
      } else if (data.type === 2) {
        const entries = reachableStateEntries(data.stateTable, included)
        const actionStart = data.componentOffset - data.ligatureActions.length * 4
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
          const start = entries[entryIndex]!.flags & 0x3FFF
          if (start === 0) continue
          let actionIndex = (start - actionStart) >>> 2
          let sums = new Set<number>([0])
          let last = false
          while (!last) {
            const action = data.ligatureActions[actionIndex]
            if (action === undefined) throw new Error('mort subset ligature action exceeds action table')
            actionIndex++
            last = (action & 0x80000000) !== 0
            const store = (action & 0x40000000) !== 0
            let addend = action & 0x3FFFFFFF
            if ((addend & 0x20000000) !== 0) addend -= 0x40000000
            const contributions = new Set<number>()
            for (const glyphId of included) {
              const componentIndex = addend + glyphId - (data.componentOffset >>> 1)
              if (componentIndex >= 0 && componentIndex < data.components.length) contributions.add(data.components[componentIndex]!)
            }
            const next = new Set<number>()
            for (const sum of sums) for (const contribution of contributions) next.add(sum + contribution)
            sums = next
            if (store || last) {
              for (const offset of sums) {
                const ligatureIndex = (offset - data.ligatureOffset) >> 1
                if (ligatureIndex >= 0 && ligatureIndex < data.ligatures.length) add(data.ligatures[ligatureIndex]!)
              }
              sums = new Set<number>([0])
            }
          }
        }
      } else if (data.type === 4) {
        for (const glyphId of included) {
          const replacement = data.lookup.get(glyphId)
          if (replacement !== undefined && replacement !== 0) add(replacement)
        }
      } else if (data.type === 5) {
        const entries = reachableStateEntries(data.stateTable, included)
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
          const entry = entries[entryIndex]!
          const counts = [(entry.flags >>> 5) & 0x1F, entry.flags & 0x1F]
          for (let extra = 0; extra < 2; extra++) {
            if (counts[extra] === 0 || entry.extra[extra] === 0) continue
            const values = data.insertionLists.get(entry.extra[extra]!)
            if (values === undefined) throw new Error('mort subset lost insertion list')
            for (let i = 0; i < counts[extra]!; i++) add(values[i]!)
          }
        }
      }
    }
  }
}

/** Rebuilds directly glyph-indexed AAT tables with compact glyph IDs. */
export function buildDirectAatSubsetTables(
  manager: SfntTableManager,
  oldToNew: ReadonlyMap<number, number>,
): AatSubsetTables {
  const tables: AatSubsetTables = new Map()
  const byNew = [...oldToNew.entries()].sort(function (left, right) { return left[1] - right[1] })

  const ankr = manager.ankr
  if (ankr !== null) tables.set('ankr', buildAnkr(ankr, byNew))
  const acnt = manager.acnt
  if (acnt !== null) {
    const data = buildAcnt(acnt, byNew, oldToNew)
    if (data !== null) tables.set('acnt', data)
  }
  const bsln = manager.bsln
  if (bsln !== null) tables.set('bsln', buildBsln(bsln, byNew, oldToNew))
  const fmtx = manager.fmtx
  if (fmtx !== null) tables.set('fmtx', buildFmtx(fmtx, oldToNew))
  const gcid = manager.gcid
  if (gcid !== null) tables.set('gcid', buildGcid(gcid, byNew))
  const lcar = manager.lcar
  if (lcar !== null) tables.set('lcar', buildLcar(lcar, byNew))
  const just = manager.just
  if (just !== null) tables.set('just', buildJust(just, byNew, oldToNew))
  const normalizedCoords = manager.normalizedCoords
  const gvar = manager.gvar
  const tupleScalars = normalizedCoords !== null && normalizedCoords !== undefined && gvar !== null && gvar !== undefined
    ? gvar.getSharedTupleScalars(normalizedCoords)
    : undefined
  const kern = manager.kern
  if (kern !== null) {
    const data = buildKern(kern, byNew, oldToNew, tupleScalars)
    if (data !== null) tables.set('kern', data)
  }
  const kerx = manager.kerx
  if (kerx !== null) {
    const data = buildKerx(kerx, byNew, oldToNew)
    if (data !== null) tables.set('kerx', data)
  }
  const morx = manager.morx
  if (morx !== null && morx !== undefined) tables.set('morx', buildMorx(morx.version, morx.chains, byNew, oldToNew))
  const mort = manager.mort
  if (mort !== null && mort !== undefined) tables.set('mort', buildMort(mort.chains, byNew, oldToNew))
  const opbd = manager.opbd
  if (opbd !== null) tables.set('opbd', buildOpbd(opbd, byNew))
  const prop = manager.prop
  if (prop !== null) tables.set('prop', buildProp(prop, byNew, oldToNew))
  const zapf = manager.zapf
  if (zapf !== null && zapf !== undefined) {
    const data = buildZapf(zapf, byNew, oldToNew)
    if (data !== null) tables.set('Zapf', data)
  }
  const merg = manager.merg
  if (merg !== null) tables.set('MERG', buildMerg(merg, byNew))
  return tables
}

function collectJustificationReferences(
  direction: NonNullable<SfntTableManager['just']>['horizontal'],
  glyphId: number,
  add: (glyphId: number) => void,
): void {
  const actions = direction?.getPostcompActions(glyphId)
  if (actions === null || actions === undefined) return
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
    const action = actions[actionIndex]!
    if (action.actionType === 0) {
      for (let i = 0; i < action.glyphs.length; i++) add(action.glyphs[i]!)
    } else if (action.actionType === 1) {
      add(action.addGlyph)
    } else if (action.actionType === 2) {
      add(action.addGlyph)
      add(action.substGlyph)
    } else if (action.actionType === 5) {
      add(action.glyph)
    }
  }
}

interface LookupEntry {
  glyphId: number
  value: number
}

function buildLookup6(entries: readonly LookupEntry[], valueSize: 2 | 4): Uint8Array {
  const unitSize = 2 + valueSize
  let power = 1
  let selector = 0
  while (power * 2 <= entries.length) {
    power *= 2
    selector++
  }
  const searchRange = entries.length === 0 ? 0 : power * unitSize
  const writer = new BinaryWriter(12 + entries.length * unitSize)
  writer.writeUint16(6)
  writer.writeUint16(unitSize)
  writer.writeUint16(entries.length)
  writer.writeUint16(searchRange)
  writer.writeUint16(entries.length === 0 ? 0 : selector)
  writer.writeUint16(entries.length * unitSize - searchRange)
  for (let i = 0; i < entries.length; i++) {
    writer.writeUint16(entries[i]!.glyphId)
    if (valueSize === 2) writer.writeUint16(entries[i]!.value)
    else writer.writeUint32(entries[i]!.value)
  }
  return writer.toUint8Array()
}

function mappedGlyph(oldToNew: ReadonlyMap<number, number>, oldGlyphId: number, table: string): number {
  const glyphId = oldToNew.get(oldGlyphId)
  if (glyphId === undefined) throw new Error(`${table} subset lost referenced glyph ${oldGlyphId}`)
  return glyphId
}

function buildAnkr(
  table: NonNullable<SfntTableManager['ankr']>,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const data = new BinaryWriter()
  const entries: LookupEntry[] = []
  for (let i = 0; i < byNew.length; i++) {
    const points = table.getAnchorPoints(byNew[i]![0])
    if (points === null) continue
    if (data.position > 0xFFFF) throw new Error('ankr compact subset glyph data exceeds 16-bit lookup offsets')
    entries.push({ glyphId: byNew[i]![1], value: data.position })
    data.writeUint32(points.length)
    for (let point = 0; point < points.length; point++) {
      data.writeInt16(points[point]!.x)
      data.writeInt16(points[point]!.y)
    }
  }
  const lookup = buildLookup6(entries, 2)
  const writer = new BinaryWriter(12 + lookup.length + data.position)
  writer.writeUint16(table.version)
  writer.writeUint16(table.flags)
  writer.writeUint32(12)
  writer.writeUint32(12 + lookup.length)
  writer.writeBytes(lookup)
  writer.writeBytes(data.toUint8Array())
  return writer.toUint8Array()
}

function buildAcnt(
  table: NonNullable<SfntTableManager['acnt']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array | null {
  const accented: Array<{
    glyphId: number
    primaryGlyph: number
    components: Array<{ primaryPoint: number, secondaryGlyph: number, secondaryPoint: number }>
  }> = []
  for (let i = 0; i < byNew.length; i++) {
    const attachment = table.getAttachment(byNew[i]![0])
    if (attachment === null) continue
    const components = new Array<{ primaryPoint: number, secondaryGlyph: number, secondaryPoint: number }>(attachment.components.length)
    for (let component = 0; component < attachment.components.length; component++) {
      const source = attachment.components[component]!
      components[component] = {
        primaryPoint: source.primaryAttachmentPoint,
        secondaryGlyph: mappedGlyph(oldToNew, source.secondaryGlyphIndex, 'acnt'),
        secondaryPoint: source.secondaryGlyphAttachmentNumber,
      }
    }
    accented.push({
      glyphId: byNew[i]![1],
      primaryGlyph: mappedGlyph(oldToNew, attachment.primaryGlyphIndex, 'acnt'),
      components,
    })
  }
  if (accented.length === 0) return null
  for (let i = 1; i < accented.length; i++) {
    if (accented[i]!.glyphId !== accented[i - 1]!.glyphId + 1) {
      throw new Error('acnt compact subset accented glyph range is not contiguous')
    }
  }

  const secondary: Array<{ glyphId: number, point: number }> = []
  const secondaryIndex = new Map<string, number>()
  const addSecondary = function (glyphId: number, point: number): number {
    const key = `${glyphId}:${point}`
    const existing = secondaryIndex.get(key)
    if (existing !== undefined) return existing
    const index = secondary.length
    secondary.push({ glyphId, point })
    secondaryIndex.set(key, index)
    return index
  }
  for (let i = 0; i < accented.length; i++) {
    if (accented[i]!.components.length <= 1) continue
    for (let component = 0; component < accented[i]!.components.length; component++) {
      const value = accented[i]!.components[component]!
      if (addSecondary(value.secondaryGlyph, value.secondaryPoint) > 0x7F) {
        throw new Error('acnt compact subset multi-accent secondary index exceeds seven bits')
      }
    }
  }
  for (let i = 0; i < accented.length; i++) {
    if (accented[i]!.components.length !== 1) continue
    const value = accented[i]!.components[0]!
    if (addSecondary(value.secondaryGlyph, value.secondaryPoint) > 0xFF) {
      throw new Error('acnt compact subset secondary index exceeds eight bits')
    }
  }

  const descriptions = new BinaryWriter(accented.length * 4)
  const extensions = new BinaryWriter()
  for (let i = 0; i < accented.length; i++) {
    const item = accented[i]!
    if (item.primaryGlyph > 0x7FFF) throw new Error('acnt compact subset primary glyph exceeds 15 bits')
    if (item.components.length === 1) {
      const component = item.components[0]!
      const index = secondaryIndex.get(`${component.secondaryGlyph}:${component.secondaryPoint}`)!
      descriptions.writeUint32((item.primaryGlyph << 16) | (component.primaryPoint << 8) | index)
    } else {
      if (extensions.position > 0xFFFF) throw new Error('acnt compact subset extension offset exceeds 16 bits')
      descriptions.writeUint32(0x80000000 | (item.primaryGlyph << 16) | extensions.position)
      for (let componentIndex = 0; componentIndex < item.components.length; componentIndex++) {
        const component = item.components[componentIndex]!
        const index = secondaryIndex.get(`${component.secondaryGlyph}:${component.secondaryPoint}`)!
        extensions.writeUint16((componentIndex === item.components.length - 1 ? 0x8000 : 0) | (index << 8) | component.primaryPoint)
      }
    }
  }
  const descriptionOffset = 20
  const extensionOffset = extensions.position === 0 ? 0 : descriptionOffset + descriptions.position
  const secondaryOffset = descriptionOffset + descriptions.position + extensions.position
  const writer = new BinaryWriter(secondaryOffset + secondary.length * 3)
  writer.writeUint32(0x00010000)
  writer.writeUint16(accented[0]!.glyphId)
  writer.writeUint16(accented[accented.length - 1]!.glyphId)
  writer.writeUint32(descriptionOffset)
  writer.writeUint32(extensionOffset)
  writer.writeUint32(secondaryOffset)
  writer.writeBytes(descriptions.toUint8Array())
  writer.writeBytes(extensions.toUint8Array())
  for (let i = 0; i < secondary.length; i++) {
    writer.writeUint16(secondary[i]!.glyphId)
    writer.writeUint8(secondary[i]!.point)
  }
  return writer.toUint8Array()
}

function buildBsln(
  table: NonNullable<SfntTableManager['bsln']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint32(0x00010000)
  writer.writeUint16(table.format)
  writer.writeUint16(table.defaultBaseline)
  if (table.deltas !== null) {
    for (let i = 0; i < table.deltas.length; i++) writer.writeInt16(table.deltas[i]!)
  } else {
    writer.writeUint16(mappedGlyph(oldToNew, table.stdGlyph!, 'bsln'))
    for (let i = 0; i < table.ctlPoints!.length; i++) writer.writeUint16(table.ctlPoints![i]!)
  }
  if (table.format === 1 || table.format === 3) {
    const entries: LookupEntry[] = []
    for (let i = 0; i < byNew.length; i++) {
      const baseline = table.getBaselineClass(byNew[i]![0])
      if (baseline !== table.defaultBaseline) entries.push({ glyphId: byNew[i]![1], value: baseline })
    }
    writer.writeBytes(buildLookup6(entries, 2))
  }
  return writer.toUint8Array()
}

function buildFmtx(
  table: NonNullable<SfntTableManager['fmtx']>,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const writer = new BinaryWriter(16)
  writer.writeUint32(0x00020000)
  writer.writeUint32(mappedGlyph(oldToNew, table.glyphIndex, 'fmtx'))
  writer.writeUint8(table.horizontalBefore)
  writer.writeUint8(table.horizontalAfter)
  writer.writeUint8(table.horizontalCaretHead)
  writer.writeUint8(table.horizontalCaretBase)
  writer.writeUint8(table.verticalBefore)
  writer.writeUint8(table.verticalAfter)
  writer.writeUint8(table.verticalCaretHead)
  writer.writeUint8(table.verticalCaretBase)
  return writer.toUint8Array()
}

function writePaddedAscii(writer: BinaryWriter, value: string): void {
  for (let i = 0; i < 64; i++) writer.writeUint8(i < value.length ? value.charCodeAt(i) : 0)
}

function buildGcid(
  table: NonNullable<SfntTableManager['gcid']>,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const writer = new BinaryWriter(144 + byNew.length * 2)
  writer.writeUint16(table.version)
  writer.writeUint16(table.format)
  writer.writeUint32(144 + byNew.length * 2)
  writer.writeUint16(table.registry)
  writePaddedAscii(writer, table.registryName)
  writer.writeUint16(table.order)
  writePaddedAscii(writer, table.orderName)
  writer.writeUint16(table.supplementVersion)
  writer.writeUint16(byNew.length)
  for (let i = 0; i < byNew.length; i++) writer.writeUint16(table.getCid(byNew[i]![0]) ?? 0xFFFF)
  return writer.toUint8Array()
}

function buildLcar(
  table: NonNullable<SfntTableManager['lcar']>,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const data = new BinaryWriter()
  const selected: Array<{ glyphId: number, values: readonly number[] }> = []
  for (let i = 0; i < byNew.length; i++) {
    const values = table.getCaretValues(byNew[i]![0])
    if (values !== null) selected.push({ glyphId: byNew[i]![1], values })
  }
  const lookupLength = 12 + selected.length * 4
  for (let i = 0; i < selected.length; i++) {
    data.writeUint16(selected[i]!.values.length)
    for (let value = 0; value < selected[i]!.values.length; value++) data.writeInt16(selected[i]!.values[value]!)
  }
  const entries: LookupEntry[] = []
  let offset = 6 + lookupLength
  for (let i = 0; i < selected.length; i++) {
    entries.push({ glyphId: selected[i]!.glyphId, value: offset })
    offset += 2 + selected[i]!.values.length * 2
  }
  const writer = new BinaryWriter(offset)
  writer.writeUint32(0x00010000)
  writer.writeUint16(table.format)
  writer.writeBytes(buildLookup6(entries, 2))
  writer.writeBytes(data.toUint8Array())
  return writer.toUint8Array()
}

function buildClassicStateTable(
  table: AatStateTable,
  byNew: readonly (readonly [number, number])[],
  transformFlags?: (flags: number) => number,
  transformEntry?: (entry: { newState: number, flags: number, extra: readonly number[] }) => { flags: number, extra: readonly number[] },
  extraHeader = new Uint8Array(0),
): Uint8Array {
  const states = table.stateIndices
  if (states === undefined) throw new Error('AAT state table does not expose reachable states for rebuilding')
  const stateMap = new Map<number, number>()
  for (let i = 0; i < states.length; i++) stateMap.set(states[i]!, i)
  const entries: Array<{ newState: number, flags: number, extra: readonly number[] }> = []
  const entryMap = new Map<string, number>()
  const rows: number[][] = []
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    const row = new Array<number>(table.nClasses)
    for (let classIndex = 0; classIndex < table.nClasses; classIndex++) {
      const source = table.getEntry(states[stateIndex]!, classIndex)
      const newState = stateMap.get(source.newState)
      if (newState === undefined) throw new Error(`AAT state table lost target state ${source.newState}`)
      const flags = transformFlags === undefined ? source.flags : transformFlags(source.flags)
      const transformed = transformEntry?.({ newState, flags, extra: source.extra }) ?? { flags, extra: source.extra }
      const key = `${newState}:${transformed.flags}:${transformed.extra.join(',')}`
      let entryIndex = entryMap.get(key)
      if (entryIndex === undefined) {
        entryIndex = entries.length
        if (entryIndex > 0xFF) throw new Error('classic AAT state table exceeds 256 distinct entries after rebuilding')
        entries.push({ newState, flags: transformed.flags, extra: transformed.extra })
        entryMap.set(key, entryIndex)
      }
      row[classIndex] = entryIndex
    }
    rows.push(row)
  }
  const glyphCount = byNew.length
  const classTableOffset = 8 + extraHeader.length
  const classTableLength = 4 + glyphCount
  const stateArrayOffset = (classTableOffset + classTableLength + 1) & ~1
  const stateArrayLength = rows.length * table.nClasses
  const entryTableOffset = (stateArrayOffset + stateArrayLength + 1) & ~1
  const extraCount = entries[0]?.extra.length ?? 0
  const writer = new BinaryWriter(entryTableOffset + entries.length * (4 + extraCount * 2))
  writer.writeUint16(table.nClasses)
  writer.writeUint16(classTableOffset)
  writer.writeUint16(stateArrayOffset)
  writer.writeUint16(entryTableOffset)
  writer.writeBytes(extraHeader)
  writer.writeUint16(0)
  writer.writeUint16(glyphCount)
  for (let i = 0; i < byNew.length; i++) writer.writeUint8(table.getClass(byNew[i]![0]))
  writer.position = stateArrayOffset
  for (let state = 0; state < rows.length; state++) {
    for (let cls = 0; cls < rows[state]!.length; cls++) writer.writeUint8(rows[state]![cls]!)
  }
  writer.position = entryTableOffset
  for (let i = 0; i < entries.length; i++) {
    writer.writeUint16(stateArrayOffset + entries[i]!.newState * table.nClasses)
    writer.writeUint16(entries[i]!.flags)
    for (let extra = 0; extra < entries[i]!.extra.length; extra++) writer.writeUint16(entries[i]!.extra[extra]!)
  }
  return writer.toUint8Array()
}

function buildExtendedStateTable(
  table: AatStateTable,
  byNew: readonly (readonly [number, number])[],
  extraHeader: Uint8Array,
  transformEntry?: (entry: { newState: number, flags: number, extra: readonly number[] }) => { flags: number, extra: readonly number[] },
): Uint8Array {
  const states = table.stateIndices
  if (states === undefined) throw new Error('AAT extended state table does not expose reachable states for rebuilding')
  const stateMap = new Map<number, number>()
  for (let i = 0; i < states.length; i++) stateMap.set(states[i]!, i)
  const entries: Array<{ newState: number, flags: number, extra: readonly number[] }> = []
  const entryMap = new Map<string, number>()
  const rows: number[][] = []
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    const row = new Array<number>(table.nClasses)
    for (let classIndex = 0; classIndex < table.nClasses; classIndex++) {
      const source = table.getEntry(states[stateIndex]!, classIndex)
      const newState = stateMap.get(source.newState)
      if (newState === undefined) throw new Error(`AAT extended state table lost target state ${source.newState}`)
      const transformed = transformEntry?.({ newState, flags: source.flags, extra: source.extra })
        ?? { flags: source.flags, extra: source.extra }
      const key = `${newState}:${transformed.flags}:${transformed.extra.join(',')}`
      let entryIndex = entryMap.get(key)
      if (entryIndex === undefined) {
        entryIndex = entries.length
        entries.push({ newState, flags: transformed.flags, extra: transformed.extra })
        entryMap.set(key, entryIndex)
      }
      row[classIndex] = entryIndex
    }
    rows.push(row)
  }
  const classEntries: LookupEntry[] = []
  for (let i = 0; i < byNew.length; i++) {
    const cls = table.getClass(byNew[i]![0])
    if (cls !== 1) classEntries.push({ glyphId: byNew[i]![1], value: cls })
  }
  const classLookup = buildLookup6(classEntries, 2)
  const classTableOffset = 16 + extraHeader.length
  const stateArrayOffset = (classTableOffset + classLookup.length + 1) & ~1
  const stateArrayLength = rows.length * table.nClasses * 2
  const entryTableOffset = stateArrayOffset + stateArrayLength
  const extraCount = entries[0]?.extra.length ?? 0
  const writer = new BinaryWriter(entryTableOffset + entries.length * (4 + extraCount * 2))
  writer.writeUint32(table.nClasses)
  writer.writeUint32(classTableOffset)
  writer.writeUint32(stateArrayOffset)
  writer.writeUint32(entryTableOffset)
  writer.writeBytes(extraHeader)
  writer.writeBytes(classLookup)
  writer.position = stateArrayOffset
  for (let state = 0; state < rows.length; state++) {
    for (let cls = 0; cls < rows[state]!.length; cls++) writer.writeUint16(rows[state]![cls]!)
  }
  writer.position = entryTableOffset
  for (let i = 0; i < entries.length; i++) {
    writer.writeUint16(entries[i]!.newState)
    writer.writeUint16(entries[i]!.flags)
    for (let extra = 0; extra < entries[i]!.extra.length; extra++) writer.writeUint16(entries[i]!.extra[extra]!)
  }
  return writer.toUint8Array()
}

function writeFixed(writer: BinaryWriter, value: number): void {
  writer.writeInt32(Math.round(value * 65536))
}

function buildWidthDeltaCluster(pairs: readonly JustWidthDeltaPair[]): Uint8Array {
  const writer = new BinaryWriter(4 + pairs.length * 24)
  writer.writeUint32(pairs.length)
  for (let i = 0; i < pairs.length; i++) {
    writer.writeUint32(pairs[i]!.justClass)
    writeFixed(writer, pairs[i]!.beforeGrowLimit)
    writeFixed(writer, pairs[i]!.beforeShrinkLimit)
    writeFixed(writer, pairs[i]!.afterGrowLimit)
    writeFixed(writer, pairs[i]!.afterShrinkLimit)
    writer.writeUint16(pairs[i]!.growFlags)
    writer.writeUint16(pairs[i]!.shrinkFlags)
  }
  return writer.toUint8Array()
}

function buildPostcompRecord(actions: readonly JustPostcompAction[], oldToNew: ReadonlyMap<number, number>): Uint8Array {
  const mapActionGlyph = function (glyphId: number): number {
    return glyphId === 0xFFFF ? 0xFFFF : mappedGlyph(oldToNew, glyphId, 'just')
  }
  const writer = new BinaryWriter()
  writer.writeUint32(actions.length)
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!
    writer.writeUint16(action.actionClass)
    writer.writeUint16(action.actionType)
    if (action.actionType === 0) {
      const length = (20 + action.glyphs.length * 2 + 3) & ~3
      writer.writeUint32(length)
      writeFixed(writer, action.lowerLimit)
      writeFixed(writer, action.upperLimit)
      writer.writeUint16(action.order)
      writer.writeUint16(action.glyphs.length)
      for (let glyph = 0; glyph < action.glyphs.length; glyph++) writer.writeUint16(mapActionGlyph(action.glyphs[glyph]!))
      while ((writer.position & 3) !== 0) writer.writeUint8(0)
    } else if (action.actionType === 1) {
      writer.writeUint32(12)
      writer.writeUint16(mapActionGlyph(action.addGlyph))
      writer.writeUint16(0)
    } else if (action.actionType === 2) {
      writer.writeUint32(16)
      writeFixed(writer, action.substThreshold)
      writer.writeUint16(mapActionGlyph(action.addGlyph))
      writer.writeUint16(mapActionGlyph(action.substGlyph))
    } else if (action.actionType === 3) {
      writer.writeUint32(8)
    } else if (action.actionType === 4) {
      writer.writeUint32(24)
      writer.writeTag(action.variationAxis)
      writeFixed(writer, action.minimumLimit)
      writeFixed(writer, action.noStretchValue)
      writeFixed(writer, action.maximumLimit)
    } else {
      writer.writeUint32(12)
      writer.writeUint16(action.flags)
      writer.writeUint16(mapActionGlyph(action.glyph))
    }
  }
  return writer.toUint8Array()
}

function align4(value: number): number {
  return (value + 3) & ~3
}

function buildJustDirection(
  direction: JustDirectionData,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
  base: number,
): Uint8Array {
  const widthRecords: Uint8Array[] = []
  const widthRecordIndex = new Map<object, number>()
  const widthMappings: Array<{ glyphId: number, record: number }> = []
  const postRecords: Uint8Array[] = []
  const postRecordIndex = new Map<object, number>()
  const postMappings: Array<{ glyphId: number, record: number }> = []
  for (let i = 0; i < byNew.length; i++) {
    const pairs = direction.getWidthDeltaPairs(byNew[i]![0])
    if (pairs !== null) {
      let record = widthRecordIndex.get(pairs as object)
      if (record === undefined) {
        record = widthRecords.length
        widthRecordIndex.set(pairs as object, record)
        widthRecords.push(buildWidthDeltaCluster(pairs))
      }
      widthMappings.push({ glyphId: byNew[i]![1], record })
    }
    const actions = direction.getPostcompActions(byNew[i]![0])
    if (actions !== null) {
      let record = postRecordIndex.get(actions as object)
      if (record === undefined) {
        record = postRecords.length
        postRecordIndex.set(actions as object, record)
        postRecords.push(buildPostcompRecord(actions, oldToNew))
      }
      postMappings.push({ glyphId: byNew[i]![1], record })
    }
  }
  const widthLookupLength = 12 + widthMappings.length * 4
  const wdcAbsolute = align4(base + 6 + widthLookupLength)
  let position = wdcAbsolute
  const widthOffsets = new Array<number>(widthRecords.length)
  for (let i = 0; i < widthRecords.length; i++) {
    widthOffsets[i] = position - wdcAbsolute
    position += widthRecords[i]!.length
  }
  const widthEntries: LookupEntry[] = []
  for (let i = 0; i < widthMappings.length; i++) {
    widthEntries.push({ glyphId: widthMappings[i]!.glyphId, value: widthOffsets[widthMappings[i]!.record]! })
  }
  const pcAbsolute = postRecords.length === 0 ? 0 : align4(position)
  const postLookupLength = 12 + postMappings.length * 4
  position = pcAbsolute === 0 ? position : align4(pcAbsolute + postLookupLength)
  const postOffsets = new Array<number>(postRecords.length)
  for (let i = 0; i < postRecords.length; i++) {
    position = align4(position)
    postOffsets[i] = position - pcAbsolute
    position += postRecords[i]!.length
  }
  const postEntries: LookupEntry[] = []
  for (let i = 0; i < postMappings.length; i++) {
    postEntries.push({ glyphId: postMappings[i]!.glyphId, value: postOffsets[postMappings[i]!.record]! })
  }
  const classAbsolute = direction.classTable === null ? 0 : align4(position)
  let classData: Uint8Array | null = null
  if (direction.classTable !== null) {
    const state = buildClassicStateTable(direction.classTable.stateTable, byNew)
    const classWriter = new BinaryWriter(8 + state.length)
    classWriter.writeUint16(8 + state.length)
    classWriter.writeUint16(direction.classTable.coverage)
    classWriter.writeUint32(direction.classTable.subFeatureFlags)
    classWriter.writeBytes(state)
    classData = classWriter.toUint8Array()
    position = classAbsolute + classData.length
  }
  for (const offset of [wdcAbsolute, pcAbsolute, classAbsolute]) {
    if (offset > 0xFFFF) throw new Error('just compact subset table offset exceeds 16 bits')
  }
  const writer = new BinaryWriter(position - base)
  writer.writeUint16(classAbsolute)
  writer.writeUint16(wdcAbsolute)
  writer.writeUint16(pcAbsolute)
  writer.writeBytes(buildLookup6(widthEntries, 2))
  writer.position = wdcAbsolute - base
  for (let i = 0; i < widthRecords.length; i++) writer.writeBytes(widthRecords[i]!)
  if (pcAbsolute !== 0) {
    writer.position = pcAbsolute - base
    writer.writeBytes(buildLookup6(postEntries, 2))
    for (let i = 0; i < postRecords.length; i++) {
      writer.position = pcAbsolute + postOffsets[i]! - base
      writer.writeBytes(postRecords[i]!)
    }
  }
  if (classData !== null) {
    writer.position = classAbsolute - base
    writer.writeBytes(classData)
  }
  return writer.toUint8Array()
}

function buildJust(
  table: NonNullable<SfntTableManager['just']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const horizontalOffset = table.horizontal === null ? 0 : 12
  const horizontal = table.horizontal === null ? null : buildJustDirection(table.horizontal, byNew, oldToNew, horizontalOffset)
  const verticalOffset = table.vertical === null ? 0 : 12 + (horizontal?.length ?? 0)
  const vertical = table.vertical === null ? null : buildJustDirection(table.vertical, byNew, oldToNew, verticalOffset)
  const writer = new BinaryWriter(12 + (horizontal?.length ?? 0) + (vertical?.length ?? 0))
  writer.writeUint32(0x00010000)
  writer.writeUint16(0)
  writer.writeUint16(horizontalOffset)
  writer.writeUint16(verticalOffset)
  writer.writeUint16(0)
  if (horizontal !== null) writer.writeBytes(horizontal)
  if (vertical !== null) writer.writeBytes(vertical)
  return writer.toUint8Array()
}

function kernSearchValues(count: number): { searchRange: number, entrySelector: number, rangeShift: number } {
  if (count === 0) return { searchRange: 0, entrySelector: 0, rangeShift: 0 }
  let power = 1
  let selector = 0
  while (power * 2 <= count) {
    power *= 2
    selector++
  }
  return { searchRange: power * 6, entrySelector: selector, rangeShift: (count - power) * 6 }
}

function remappedKernPairs(
  pairs: ReadonlyMap<number, number>,
  oldToNew: ReadonlyMap<number, number>,
  scalar: number,
): Array<{ left: number, right: number, value: number }> {
  const result: Array<{ left: number, right: number, value: number }> = []
  for (const [key, value] of pairs) {
    const left = oldToNew.get((key >>> 16) & 0xFFFF)
    const right = oldToNew.get(key & 0xFFFF)
    if (left !== undefined && right !== undefined) result.push({ left, right, value: Math.trunc(value * scalar) })
  }
  result.sort(function (left, right) { return left.left - right.left || left.right - right.right })
  return result
}

function writeKernFormat0(writer: BinaryWriter, pairs: readonly { left: number, right: number, value: number }[]): void {
  const search = kernSearchValues(pairs.length)
  writer.writeUint16(pairs.length)
  writer.writeUint16(search.searchRange)
  writer.writeUint16(search.entrySelector)
  writer.writeUint16(search.rangeShift)
  for (let i = 0; i < pairs.length; i++) {
    writer.writeUint16(pairs[i]!.left)
    writer.writeUint16(pairs[i]!.right)
    writer.writeInt16(pairs[i]!.value)
  }
}

function buildKernClassSubtable(
  source: NonNullable<SfntTableManager['kern']>['subsetData']['pairSubtables'][number],
  pairs: readonly { left: number, right: number, value: number }[],
  glyphCount: number,
  flavor: 'microsoft' | 'apple',
  bakeVariation: boolean,
): Uint8Array | null {
  const values = new Map<number, number>()
  for (let i = 0; i < pairs.length; i++) values.set((pairs[i]!.left << 16) | pairs[i]!.right, pairs[i]!.value)
  const rows: number[][] = []
  const rowIndex = new Map<string, number>()
  const leftClasses = new Uint16Array(glyphCount)
  for (let left = 0; left < glyphCount; left++) {
    const row = new Array<number>(glyphCount)
    for (let right = 0; right < glyphCount; right++) row[right] = values.get((left << 16) | right) ?? 0
    const key = row.join(',')
    let index = rowIndex.get(key)
    if (index === undefined) {
      index = rows.length
      rowIndex.set(key, index)
      rows.push(row)
    }
    leftClasses[left] = index
  }
  const columns: number[][] = []
  const columnIndex = new Map<string, number>()
  const rightClasses = new Uint16Array(glyphCount)
  for (let right = 0; right < glyphCount; right++) {
    const column = new Array<number>(rows.length)
    for (let row = 0; row < rows.length; row++) column[row] = rows[row]![right]!
    const key = column.join(',')
    let index = columnIndex.get(key)
    if (index === undefined) {
      index = columns.length
      columnIndex.set(key, index)
      columns.push(column)
    }
    rightClasses[right] = index
  }
  const outerHeader = flavor === 'microsoft' ? 6 : 8
  const formatHeader = 8
  const leftOffset = outerHeader + formatHeader
  const leftLength = 4 + glyphCount * 2
  const rightOffset = leftOffset + leftLength
  const rightLength = 4 + glyphCount * 2
  const matrixOffset = rightOffset + rightLength
  const rowWidth = columns.length * 2
  const length = matrixOffset + rows.length * rowWidth
  if (rowWidth > 0xFFFF || matrixOffset > 0xFFFF || length > (flavor === 'microsoft' ? 0xFFFF : 0xFFFFFFFF)) return null
  if (flavor === 'apple' && matrixOffset + (rows.length - 1) * rowWidth > 0xFFFF) return null
  const writer = new BinaryWriter(length)
  if (flavor === 'microsoft') {
    writer.writeUint16(0)
    writer.writeUint16(length)
    let coverage = 2 << 8
    if (!source.vertical) coverage |= 1
    if (source.minimum) coverage |= 2
    if (source.crossStream) coverage |= 4
    if (source.override) coverage |= 8
    writer.writeUint16(coverage)
  } else {
    writer.writeUint32(length)
    let coverage = 2
    if (source.vertical) coverage |= 0x8000
    if (source.crossStream) coverage |= 0x4000
    if (source.variation && !bakeVariation) coverage |= 0x2000
    writer.writeUint16(coverage)
    writer.writeUint16(source.tupleIndex)
  }
  writer.writeUint16(rowWidth)
  writer.writeUint16(leftOffset)
  writer.writeUint16(rightOffset)
  writer.writeUint16(matrixOffset)
  writer.writeUint16(0)
  writer.writeUint16(glyphCount)
  for (let glyph = 0; glyph < glyphCount; glyph++) {
    const value = flavor === 'apple'
      ? matrixOffset + leftClasses[glyph]! * rowWidth
      : leftClasses[glyph]! * rowWidth
    writer.writeUint16(value)
  }
  writer.writeUint16(0)
  writer.writeUint16(glyphCount)
  for (let glyph = 0; glyph < glyphCount; glyph++) writer.writeUint16(rightClasses[glyph]! * 2)
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < columns.length; column++) writer.writeInt16(columns[column]![row]!)
  }
  return writer.toUint8Array()
}

function buildKern(
  table: NonNullable<SfntTableManager['kern']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
  tupleScalars: readonly number[] | undefined,
): Uint8Array | null {
  const pairTables: Array<{ source: (typeof table.subsetData.pairSubtables)[number], pairs: Array<{ left: number, right: number, value: number }> }> = []
  for (let i = 0; i < table.subsetData.pairSubtables.length; i++) {
    const source = table.subsetData.pairSubtables[i]!
    if (source.variation && tupleScalars !== undefined && source.tupleIndex >= tupleScalars.length) {
      throw new Error(`kern variation tuple index ${source.tupleIndex} out of range ${tupleScalars.length}`)
    }
    const scalar = source.variation && tupleScalars !== undefined ? tupleScalars[source.tupleIndex]! : 1
    const pairs = remappedKernPairs(source.pairs, oldToNew, scalar)
    if (pairs.length !== 0) pairTables.push({ source, pairs })
  }
  const contextual = table.subsetData.contextualSubtables
  if (pairTables.length === 0 && contextual.length === 0) return null
  const classSubtables: Uint8Array[] = []
  const uncompressedPairTables: typeof pairTables = []
  for (let i = 0; i < pairTables.length; i++) {
    const rebuilt = buildKernClassSubtable(
      pairTables[i]!.source,
      pairTables[i]!.pairs,
      byNew.length,
      table.subsetData.flavor,
      tupleScalars !== undefined,
    )
    if (rebuilt === null) uncompressedPairTables.push(pairTables[i]!)
    else classSubtables.push(rebuilt)
  }
  const pairChunks: Array<{ source: (typeof table.subsetData.pairSubtables)[number], pairs: Array<{ left: number, right: number, value: number }> }> = []
  const pairChunkSize = table.subsetData.flavor === 'microsoft' ? 10920 : 0x3FFF
  for (let i = 0; i < uncompressedPairTables.length; i++) {
    for (let start = 0; start < uncompressedPairTables[i]!.pairs.length; start += pairChunkSize) {
      pairChunks.push({
        source: uncompressedPairTables[i]!.source,
        pairs: uncompressedPairTables[i]!.pairs.slice(start, start + pairChunkSize),
      })
    }
  }

  if (table.subsetData.flavor === 'microsoft') {
    const writer = new BinaryWriter()
    writer.writeUint16(0)
    writer.writeUint16(classSubtables.length + pairChunks.length)
    for (let i = 0; i < classSubtables.length; i++) writer.writeBytes(classSubtables[i]!)
    for (let i = 0; i < pairChunks.length; i++) {
      const item = pairChunks[i]!
      writer.writeUint16(0)
      writer.writeUint16(14 + item.pairs.length * 6)
      let coverage = item.source.vertical ? 0 : 1
      if (item.source.minimum) coverage |= 2
      if (item.source.crossStream) coverage |= 4
      if (item.source.override) coverage |= 8
      writer.writeUint16(coverage)
      writeKernFormat0(writer, item.pairs)
    }
    return writer.toUint8Array()
  }

  const subtables: Uint8Array[] = classSubtables.slice()
  for (let i = 0; i < pairChunks.length; i++) {
    const item = pairChunks[i]!
    const writer = new BinaryWriter(16 + item.pairs.length * 6)
    writer.writeUint32(16 + item.pairs.length * 6)
    let coverage = 0
    if (item.source.vertical) coverage |= 0x8000
    if (item.source.crossStream) coverage |= 0x4000
    if (item.source.variation && tupleScalars === undefined) coverage |= 0x2000
    writer.writeUint16(coverage)
    writer.writeUint16(item.source.tupleIndex)
    writeKernFormat0(writer, item.pairs)
    subtables.push(writer.toUint8Array())
  }
  for (let i = 0; i < contextual.length; i++) {
    const source = contextual[i]!
    if (source.variation && tupleScalars !== undefined && source.tupleIndex >= tupleScalars.length) {
      throw new Error(`kern variation tuple index ${source.tupleIndex} out of range ${tupleScalars.length}`)
    }
    const scalar = source.variation && tupleScalars !== undefined ? tupleScalars[source.tupleIndex]! : 1
    const placeholder = buildClassicStateTable(source.stateTable, byNew)
    const offsets = new Map<number, number>()
    let valueOffset = placeholder.length
    for (const [oldOffset, values] of source.valueLists) {
      offsets.set(oldOffset, valueOffset)
      valueOffset += values.length * 2
    }
    const state = buildClassicStateTable(source.stateTable, byNew, function (flags) {
      const oldOffset = flags & 0x3FFF
      if (oldOffset === 0) return flags
      const mappedOffset = offsets.get(oldOffset)
      if (mappedOffset === undefined) throw new Error(`kern subset lost value list ${oldOffset}`)
      if (mappedOffset > 0x3FFF) throw new Error('kern compact subset value-list offset exceeds 14 bits')
      return (flags & 0xC000) | mappedOffset
    })
    if (state.length !== placeholder.length) throw new Error('kern state-table rebuild changed size after value offset assignment')
    const writer = new BinaryWriter(8 + valueOffset)
    writer.writeUint32(8 + valueOffset)
    let coverage = 1
    if (source.vertical) coverage |= 0x8000
    if (source.crossStream) coverage |= 0x4000
    if (source.variation && tupleScalars === undefined) coverage |= 0x2000
    writer.writeUint16(coverage)
    writer.writeUint16(source.tupleIndex)
    writer.writeBytes(state)
    for (const values of source.valueLists.values()) {
      for (let value = 0; value < values.length; value++) writer.writeInt16(Math.trunc(values[value]! * scalar))
    }
    subtables.push(writer.toUint8Array())
  }
  const writer = new BinaryWriter()
  writer.writeUint16(1)
  writer.writeUint16(0)
  writer.writeUint32(subtables.length)
  for (let i = 0; i < subtables.length; i++) writer.writeBytes(subtables[i]!)
  return writer.toUint8Array()
}

function kerxCoverage(info: KerxSubtableInfo): number {
  let coverage = info.format
  if (info.vertical) coverage |= 0x80000000
  if (info.crossStream) coverage |= 0x40000000
  if (info.variation) coverage |= 0x20000000
  if (info.processBackwards) coverage |= 0x10000000
  return coverage >>> 0
}

function beginKerxSubtable(writer: BinaryWriter, length: number, info: KerxSubtableInfo): void {
  writer.writeUint32(length)
  writer.writeUint32(kerxCoverage(info))
  writer.writeUint32(info.tupleCount)
}

function buildKerxFormat0(
  data: KerxFormat0Data,
  info: KerxSubtableInfo,
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array | null {
  const selected: Array<{ oldKey: number, left: number, right: number, value: number }> = []
  for (const [oldKey, value] of data.pairs) {
    const left = oldToNew.get((oldKey >>> 16) & 0xFFFF)
    const right = oldToNew.get(oldKey & 0xFFFF)
    if (left !== undefined && right !== undefined) selected.push({ oldKey, left, right, value })
  }
  selected.sort(function (left, right) { return left.left - right.left || left.right - right.right })
  const pairs = selected
  if (pairs.length === 0) return null
  const vectorStart = 28 + pairs.length * 6
  const length = vectorStart + (info.tupleCount === 0 ? 0 : pairs.length * info.tupleCount * 2)
  const search = kernSearchValues(pairs.length)
  const writer = new BinaryWriter(length)
  beginKerxSubtable(writer, length, info)
  writer.writeUint32(pairs.length)
  writer.writeUint32(search.searchRange)
  writer.writeUint32(search.entrySelector)
  writer.writeUint32(search.rangeShift)
  for (let i = 0; i < pairs.length; i++) {
    writer.writeUint16(pairs[i]!.left)
    writer.writeUint16(pairs[i]!.right)
    if (info.tupleCount === 0) writer.writeInt16(pairs[i]!.value)
    else {
      const offset = vectorStart + i * info.tupleCount * 2
      if (offset > 0xFFFF) throw new Error('kerx format 0 compact tuple-vector offset exceeds 16 bits')
      writer.writeUint16(offset)
    }
  }
  if (info.tupleCount > 0) {
    for (let pairIndex = 0; pairIndex < selected.length; pairIndex++) {
      const vector = data.tupleVectors.get(selected[pairIndex]!.oldKey)
      if (vector === undefined) throw new Error('kerx format 0 subset lost tuple vector')
      for (let value = 0; value < vector.length; value++) writer.writeInt16(vector[value]!)
    }
  }
  return writer.toUint8Array()
}

function uint32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function buildKerxFormat1(
  data: KerxFormat1Data,
  info: KerxSubtableInfo,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const placeholder = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(0))
  const state = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(placeholder.length))
  if (state.length !== placeholder.length) throw new Error('kerx format 1 state-table size changed after offset assignment')
  const length = 12 + state.length + data.valueData.length
  const writer = new BinaryWriter(length)
  beginKerxSubtable(writer, length, info)
  writer.writeBytes(state)
  writer.writeBytes(data.valueData)
  return writer.toUint8Array()
}

function selectedLookup(
  mapping: ReadonlyMap<number, number>,
  byNew: readonly (readonly [number, number])[],
): { entries: LookupEntry[], maximum: number } {
  const entries: LookupEntry[] = []
  let maximum = 0
  for (let i = 0; i < byNew.length; i++) {
    const value = mapping.get(byNew[i]![0]) ?? 0
    if (value !== 0) entries.push({ glyphId: byNew[i]![1], value })
    if (value > maximum) maximum = value
  }
  return { entries, maximum }
}

function buildKerxFormat2(
  data: KerxFormat2Data,
  info: KerxSubtableInfo,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const left = selectedLookup(data.leftClasses, byNew)
  const right = selectedLookup(data.rightClasses, byNew)
  const leftLookup = buildLookup6(left.entries, 2)
  const rightLookup = buildLookup6(right.entries, 2)
  const arrayCount = left.maximum + right.maximum + 1
  const arrayLength = arrayCount * 2
  const sourceArrayOffset = data.arrayStart - data.subtableStart
  const headerLength = 28
  const leftOffset = headerLength
  const rightOffset = leftOffset + leftLookup.length
  const arrayOffset = rightOffset + rightLookup.length
  const array = new Uint8Array(arrayLength)
  array.set(data.arrayData.subarray(0, Math.min(array.length, data.arrayData.length)))
  const vectors = new BinaryWriter()
  if (info.tupleCount > 0) {
    const view = new DataView(array.buffer)
    const sourceView = new DataView(data.arrayData.buffer, data.arrayData.byteOffset, data.arrayData.byteLength)
    const vectorOffsets = new Map<number, number>()
    for (let cell = 0; cell < arrayLength; cell += 2) {
      const oldOffset = cell + 2 <= data.arrayData.length ? sourceView.getUint16(cell, false) : -1
      let newOffset = vectorOffsets.get(oldOffset)
      if (newOffset === undefined) {
        const sourcePosition = oldOffset - sourceArrayOffset
        newOffset = arrayOffset + array.length + vectors.position
        if (newOffset > 0xFFFF) throw new Error('kerx format 2 tuple-vector offset exceeds 16 bits')
        vectorOffsets.set(oldOffset, newOffset)
        if (sourcePosition < 0 || sourcePosition + info.tupleCount * 2 > data.arrayData.length) {
          for (let value = 0; value < info.tupleCount; value++) vectors.writeInt16(0)
        } else vectors.writeBytes(data.arrayData.subarray(sourcePosition, sourcePosition + info.tupleCount * 2))
      }
      view.setUint16(cell, newOffset, false)
    }
  }
  const length = arrayOffset + array.length + vectors.position
  const writer = new BinaryWriter(length)
  beginKerxSubtable(writer, length, info)
  writer.writeUint32((right.maximum + 1) * 2)
  writer.writeUint32(leftOffset)
  writer.writeUint32(rightOffset)
  writer.writeUint32(arrayOffset)
  writer.writeBytes(leftLookup)
  writer.writeBytes(rightLookup)
  writer.writeBytes(array)
  writer.writeBytes(vectors.toUint8Array())
  return writer.toUint8Array()
}

function buildKerxFormat4(
  data: KerxFormat4Data,
  info: KerxSubtableInfo,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const placeholder = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(data.actionType << 30))
  const flags = ((data.actionType << 30) | placeholder.length) >>> 0
  const state = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(flags))
  if (state.length !== placeholder.length) throw new Error('kerx format 4 state-table size changed after offset assignment')
  const length = 12 + state.length + data.controlData.length
  const writer = new BinaryWriter(length)
  beginKerxSubtable(writer, length, info)
  writer.writeBytes(state)
  writer.writeBytes(data.controlData)
  return writer.toUint8Array()
}

function buildKerxFormat6(
  data: KerxFormat6Data,
  info: KerxSubtableInfo,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const valueSize: 2 | 4 = data.valuesAreLong ? 4 : 2
  const rows = selectedLookup(data.rowIndices, byNew)
  const columns = selectedLookup(data.columnIndices, byNew)
  const rowLookup = buildLookup6(rows.entries, valueSize)
  const columnLookup = buildLookup6(columns.entries, valueSize)
  const headerLength = info.tupleCount > 0 ? 36 : 32
  const rowOffset = headerLength
  const columnOffset = rowOffset + rowLookup.length
  const arrayOffset = columnOffset + columnLookup.length
  const vectorOffset = info.tupleCount > 0 ? arrayOffset + data.arrayData.length : 0
  const length = arrayOffset + data.arrayData.length + data.vectorData.length
  const writer = new BinaryWriter(length)
  beginKerxSubtable(writer, length, info)
  writer.writeUint32(data.valuesAreLong ? 1 : 0)
  writer.writeUint16(data.rowCount)
  writer.writeUint16(data.columnCount)
  writer.writeUint32(rowOffset)
  writer.writeUint32(columnOffset)
  writer.writeUint32(arrayOffset)
  if (info.tupleCount > 0) writer.writeUint32(vectorOffset)
  writer.writeBytes(rowLookup)
  writer.writeBytes(columnLookup)
  writer.writeBytes(data.arrayData)
  writer.writeBytes(data.vectorData)
  return writer.toUint8Array()
}

function buildKerx(
  table: NonNullable<SfntTableManager['kerx']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array | null {
  const rebuilt: Array<{ sourceIndex: number, data: Uint8Array }> = []
  for (let i = 0; i < table.subsetData.length; i++) {
    const source = table.subsetData[i]!
    const info = table.subtables[source.subtableIndex]!
    let data: Uint8Array | null
    if (info.format === 0) data = buildKerxFormat0(source as KerxFormat0Data, info, oldToNew)
    else if (info.format === 1) data = buildKerxFormat1(source as KerxFormat1Data, info, byNew)
    else if (info.format === 2) data = buildKerxFormat2(source as KerxFormat2Data, info, byNew)
    else if (info.format === 4) data = buildKerxFormat4(source as KerxFormat4Data, info, byNew)
    else data = buildKerxFormat6(source as KerxFormat6Data, info, byNew)
    if (data !== null) rebuilt.push({ sourceIndex: source.subtableIndex, data })
  }
  if (rebuilt.length === 0) return null
  const writer = new BinaryWriter()
  writer.writeUint16(table.version)
  writer.writeUint16(0)
  writer.writeUint32(rebuilt.length)
  for (let i = 0; i < rebuilt.length; i++) writer.writeBytes(rebuilt[i]!.data)
  if (table.version >= 3) {
    const coverageStart = writer.position
    const bitfieldLength = (byNew.length + 7) >>> 3
    const paddedLength = align4(bitfieldLength)
    const bitfields: Array<Uint8Array | null> = []
    let nextOffset = rebuilt.length * 4
    for (let i = 0; i < rebuilt.length; i++) {
      const sourceCoverage = table.subsetGlyphCoverage[rebuilt[i]!.sourceIndex]
      if (sourceCoverage === null || sourceCoverage === undefined) {
        writer.writeUint32(0xFFFFFFFF)
        bitfields.push(null)
        continue
      }
      writer.writeUint32(nextOffset)
      const bits = new Uint8Array(paddedLength)
      for (let glyph = 0; glyph < byNew.length; glyph++) {
        const oldGlyph = byNew[glyph]![0]
        if ((sourceCoverage[oldGlyph >>> 3]! & (1 << (oldGlyph & 7))) !== 0) {
          bits[glyph >>> 3] = bits[glyph >>> 3]! | (1 << (glyph & 7))
        }
      }
      bitfields.push(bits)
      nextOffset += paddedLength
    }
    for (let i = 0; i < bitfields.length; i++) if (bitfields[i] !== null) writer.writeBytes(bitfields[i]!)
    if (writer.position < coverageStart + nextOffset) writer.position = coverageStart + nextOffset
  }
  return writer.toUint8Array()
}

function buildMappedGlyphLookup(
  mapping: ReadonlyMap<number, number>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
  sourceNumGlyphs?: number,
): Uint8Array {
  const entries: LookupEntry[] = []
  for (let i = 0; i < byNew.length; i++) {
    const replacement = mapping.get(byNew[i]![0])
    if (replacement === undefined) continue
    const mapped = oldToNew.get(replacement)
    if (mapped !== undefined) entries.push({ glyphId: byNew[i]![1], value: mapped })
    else if (sourceNumGlyphs !== undefined && replacement < sourceNumGlyphs) {
      throw new Error(`morx subset lost referenced glyph ${replacement}`)
    } else entries.push({ glyphId: byNew[i]![1], value: replacement })
  }
  return buildLookup6(entries, 2)
}

function buildMorxSubtableData(
  subtable: MorxSubtable,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const data = subtable.subsetData
  if (data.type === 0) return buildExtendedStateTable(data.stateTable, byNew, new Uint8Array(0))
  if (data.type === 1) {
    let maximumIndex = -1
    for (const index of data.lookups.keys()) if (index > maximumIndex) maximumIndex = index
    const lookups = new Array<Uint8Array | null>(maximumIndex + 1).fill(null)
    let lookupDataLength = Math.max(4, (maximumIndex + 1) * 4)
    for (const [index, lookup] of data.lookups) {
      const rebuilt = buildMappedGlyphLookup(lookup, byNew, oldToNew, data.sourceNumGlyphs)
      lookups[index] = rebuilt
      lookupDataLength += rebuilt.length
    }
    const placeholder = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(0))
    const state = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(placeholder.length))
    if (state.length !== placeholder.length) throw new Error('morx contextual state-table size changed after offset assignment')
    const writer = new BinaryWriter(state.length + lookupDataLength)
    writer.writeBytes(state)
    let offset = (maximumIndex + 1) * 4
    for (let i = 0; i < lookups.length; i++) {
      writer.writeUint32(lookups[i] === null ? 0 : offset)
      if (lookups[i] !== null) offset += lookups[i]!.length
    }
    for (let i = 0; i < lookups.length; i++) if (lookups[i] !== null) writer.writeBytes(lookups[i]!)
    if (writer.position < state.length + lookupDataLength) writer.position = state.length + lookupDataLength
    return writer.toUint8Array()
  }
  if (data.type === 2) {
    const actions = new Uint32Array(data.ligatureActions.length)
    const addendBlocks = new Map<number, number>()
    const sourceAddends = new Int32Array(data.ligatureActions.length)
    for (let actionIndex = 0; actionIndex < data.ligatureActions.length; actionIndex++) {
      let sourceAddend = data.ligatureActions[actionIndex]! & 0x3FFFFFFF
      if ((sourceAddend & 0x20000000) !== 0) sourceAddend -= 0x40000000
      sourceAddends[actionIndex] = sourceAddend
      if (!addendBlocks.has(sourceAddend)) addendBlocks.set(sourceAddend, addendBlocks.size)
    }
    const componentValues: number[] = []
    const rebuiltAddends = new Map<number, number>()
    const sharedBlocks = new Map<string, number>()
    for (const sourceAddend of addendBlocks.keys()) {
      let minimumGlyph = Number.POSITIVE_INFINITY
      let maximumGlyph = -1
      const values = new Map<number, number>()
      for (let glyph = 0; glyph < byNew.length; glyph++) {
        const sourceIndex = byNew[glyph]![0] + sourceAddend
        if (sourceIndex < 0 || sourceIndex >= data.components.length) continue
        const newGlyph = byNew[glyph]![1]
        values.set(newGlyph, data.components[sourceIndex]!)
        if (newGlyph < minimumGlyph) minimumGlyph = newGlyph
        if (newGlyph > maximumGlyph) maximumGlyph = newGlyph
      }
      if (maximumGlyph < 0) {
        minimumGlyph = 0
        maximumGlyph = 0
      }
      const block = new Array<number>(maximumGlyph - minimumGlyph + 1).fill(0)
      for (const [glyph, value] of values) block[glyph - minimumGlyph] = value
      const key = `${minimumGlyph}:${block.join(',')}`
      let blockStart = sharedBlocks.get(key)
      if (blockStart === undefined) {
        blockStart = componentValues.length
        sharedBlocks.set(key, blockStart)
        componentValues.push(...block)
      }
      rebuiltAddends.set(sourceAddend, blockStart - minimumGlyph)
    }
    const components = Uint16Array.from(componentValues)
    for (let actionIndex = 0; actionIndex < data.ligatureActions.length; actionIndex++) {
      const sourceAction = data.ligatureActions[actionIndex]!
      const componentAddend = rebuiltAddends.get(sourceAddends[actionIndex]!)!
      if (componentAddend < -0x20000000 || componentAddend > 0x1FFFFFFF) {
        throw new Error('morx compact ligature component addend exceeds signed 30 bits')
      }
      actions[actionIndex] = (sourceAction & 0xC0000000) | (componentAddend & 0x3FFFFFFF)
    }
    const ligatures = new Uint16Array(data.ligatures.length)
    for (let i = 0; i < data.ligatures.length; i++) {
      const sourceGlyph = data.ligatures[i]!
      const mapped = oldToNew.get(sourceGlyph)
      if (mapped !== undefined) ligatures[i] = mapped
      else ligatures[i] = sourceGlyph
    }
    const placeholder = buildExtendedStateTable(data.stateTable, byNew, new Uint8Array(12))
    const actionOffset = placeholder.length
    const componentOffset = actionOffset + actions.length * 4
    const ligatureOffset = componentOffset + components.length * 2
    const header = new BinaryWriter(12)
    header.writeUint32(actionOffset)
    header.writeUint32(componentOffset)
    header.writeUint32(ligatureOffset)
    const state = buildExtendedStateTable(data.stateTable, byNew, header.toUint8Array())
    if (state.length !== placeholder.length) throw new Error('morx ligature state-table size changed after offset assignment')
    const writer = new BinaryWriter(ligatureOffset + ligatures.length * 2)
    writer.writeBytes(state)
    for (let i = 0; i < actions.length; i++) writer.writeUint32(actions[i]!)
    for (let i = 0; i < components.length; i++) writer.writeUint16(components[i]!)
    for (let i = 0; i < ligatures.length; i++) writer.writeUint16(ligatures[i]!)
    return writer.toUint8Array()
  }
  if (data.type === 4) return buildMappedGlyphLookup(data.lookup, byNew, oldToNew, data.sourceNumGlyphs)

  const insertionGlyphs = new Uint16Array(data.insertionGlyphs.length)
  for (let i = 0; i < data.insertionGlyphs.length; i++) {
    if (data.insertionUsed[i] === 0) continue
    const sourceGlyph = data.insertionGlyphs[i]!
    const mapped = oldToNew.get(sourceGlyph)
    if (mapped !== undefined) insertionGlyphs[i] = mapped
    else insertionGlyphs[i] = sourceGlyph
  }
  const placeholder = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(0))
  const state = buildExtendedStateTable(data.stateTable, byNew, uint32Bytes(placeholder.length))
  if (state.length !== placeholder.length) throw new Error('morx insertion state-table size changed after offset assignment')
  const writer = new BinaryWriter(state.length + insertionGlyphs.length * 2)
  writer.writeBytes(state)
  for (let i = 0; i < insertionGlyphs.length; i++) writer.writeUint16(insertionGlyphs[i]!)
  return writer.toUint8Array()
}

function morxSubtableCoverage(subtable: MorxSubtable): number {
  let coverage = subtable.type
  if (subtable.vertical) coverage |= 0x80000000
  if (subtable.descending) coverage |= 0x40000000
  if (subtable.allDirections) coverage |= 0x20000000
  if (subtable.logical) coverage |= 0x10000000
  return coverage >>> 0
}

function buildMorxChain(
  version: number,
  chain: MorxChain,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const subtables: Uint8Array[] = []
  for (let i = 0; i < chain.subtables.length; i++) {
    const source = chain.subtables[i]!
    const body = buildMorxSubtableData(source, byNew, oldToNew)
    const writer = new BinaryWriter(align4(12 + body.length))
    writer.writeUint32(align4(12 + body.length))
    writer.writeUint32(morxSubtableCoverage(source))
    writer.writeUint32(source.subFeatureFlags)
    writer.writeBytes(body)
    writer.pad4()
    subtables.push(writer.toUint8Array())
  }
  const baseLength = 16 + chain.features.length * 12 + subtables.reduce(function (sum, data) { return sum + data.length }, 0)
  const coverageArrayLength = version >= 3 ? subtables.length * 4 : 0
  const bitfieldLength = (byNew.length + 7) >>> 3
  const paddedBitfieldLength = align4(bitfieldLength)
  let coverageLength = coverageArrayLength
  if (version >= 3) {
    for (let i = 0; i < chain.subtables.length; i++) if (chain.subtables[i]!.glyphCoverage !== null) coverageLength += paddedBitfieldLength
  }
  const chainLength = baseLength + coverageLength
  const writer = new BinaryWriter(chainLength)
  writer.writeUint32(chain.defaultFlags)
  writer.writeUint32(chainLength)
  writer.writeUint32(chain.features.length)
  writer.writeUint32(subtables.length)
  for (let i = 0; i < chain.features.length; i++) {
    writer.writeUint16(chain.features[i]!.featureType)
    writer.writeUint16(chain.features[i]!.featureSetting)
    writer.writeUint32(chain.features[i]!.enableFlags)
    writer.writeUint32(chain.features[i]!.disableFlags)
  }
  for (let i = 0; i < subtables.length; i++) writer.writeBytes(subtables[i]!)
  if (version >= 3) {
    let offset = coverageArrayLength
    const bitfields: Array<Uint8Array | null> = []
    for (let i = 0; i < chain.subtables.length; i++) {
      const source = chain.subtables[i]!.glyphCoverage
      if (source === null) {
        writer.writeUint32(0)
        bitfields.push(null)
        continue
      }
      writer.writeUint32(offset)
      const bits = new Uint8Array(paddedBitfieldLength)
      for (let glyph = 0; glyph < byNew.length; glyph++) {
        const oldGlyph = byNew[glyph]![0]
        if ((source[oldGlyph >>> 3]! & (1 << (oldGlyph & 7))) !== 0) bits[glyph >>> 3] = bits[glyph >>> 3]! | (1 << (glyph & 7))
      }
      bitfields.push(bits)
      offset += paddedBitfieldLength
    }
    for (let i = 0; i < bitfields.length; i++) if (bitfields[i] !== null) writer.writeBytes(bitfields[i]!)
  }
  return writer.toUint8Array()
}

function buildMorx(
  version: number,
  chains: readonly MorxChain[],
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const rebuilt = new Array<Uint8Array>(chains.length)
  let length = 8
  for (let i = 0; i < chains.length; i++) {
    rebuilt[i] = buildMorxChain(version, chains[i]!, byNew, oldToNew)
    length += rebuilt[i]!.length
  }
  const writer = new BinaryWriter(length)
  writer.writeUint16(version)
  writer.writeUint16(0)
  writer.writeUint32(chains.length)
  for (let i = 0; i < rebuilt.length; i++) writer.writeBytes(rebuilt[i]!)
  return writer.toUint8Array()
}

function uint16Bytes(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const writer = new BinaryWriter(values.length * 2)
  for (let i = 0; i < values.length; i++) writer.writeUint16(values[i]!)
  return new Uint8Array(writer.toArrayBuffer())
}

function buildMortType1(
  subtable: Extract<MortSubtable['subsetData'], { type: 1 }>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const placeholder = buildClassicStateTable(subtable.stateTable, byNew, undefined, undefined, uint16Bytes([0]))
  const blockOffsets = new Map<number, number>()
  let position = placeholder.length
  for (const oldOffset of subtable.substitutions.keys()) {
    if ((position & 1) !== 0) position++
    const wordOffset = position >>> 1
    if (wordOffset > 0x7FFF) throw new Error('mort contextual substitution offset exceeds positive signed 16-bit range')
    blockOffsets.set(oldOffset, wordOffset)
    position += byNew.length * 2
  }
  const state = buildClassicStateTable(
    subtable.stateTable,
    byNew,
    undefined,
    function (entry) {
      const extra = entry.extra.slice()
      for (let i = 0; i < extra.length; i++) {
        if (extra[i] === 0xFFFF) continue
        const mapped = blockOffsets.get(extra[i]!)
        if (mapped === undefined) throw new Error(`mort contextual subset lost substitution block ${extra[i]}`)
        extra[i] = mapped
      }
      return { flags: entry.flags, extra }
    },
    uint16Bytes([placeholder.length]),
  )
  if (state.length !== placeholder.length) throw new Error('mort contextual state-table size changed after offset assignment')
  const writer = new BinaryWriter(position)
  writer.writeBytes(state)
  for (const [oldOffset, substitutions] of subtable.substitutions) {
    writer.position = blockOffsets.get(oldOffset)! * 2
    for (let i = 0; i < byNew.length; i++) {
      const replacement = substitutions.get(byNew[i]![0]) ?? 0
      writer.writeUint16(replacement === 0 ? 0 : mappedGlyph(oldToNew, replacement, 'mort contextual'))
    }
  }
  return writer.toUint8Array()
}

function buildMortType2(
  subtable: Extract<MortSubtable['subsetData'], { type: 2 }>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const starts = new Set<number>()
  const states = subtable.stateTable.stateIndices!
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    for (let cls = 0; cls < subtable.stateTable.nClasses; cls++) {
      const offset = subtable.stateTable.getEntry(states[stateIndex]!, cls).flags & 0x3FFF
      if (offset !== 0) starts.add(offset)
    }
  }
  const sequences = new Map<number, Array<{ sourceIndex: number, action: number }>>()
  for (const start of starts) {
    const startIndex = (start - (subtable.componentOffset - subtable.ligatureActions.length * 4)) >>> 2
    if (startIndex < 0 || startIndex >= subtable.ligatureActions.length) throw new Error('mort ligature action start exceeds action table')
    const sequence: Array<{ sourceIndex: number, action: number }> = []
    let index = startIndex
    let last = false
    while (!last) {
      const action = subtable.ligatureActions[index]
      if (action === undefined) throw new Error('mort ligature action sequence exceeds action table')
      sequence.push({ sourceIndex: index, action })
      last = (action & 0x80000000) !== 0
      index++
    }
    sequences.set(start, sequence)
  }
  const placeholder = buildClassicStateTable(subtable.stateTable, byNew, undefined, undefined, new Uint8Array(6))
  const actionStart = align4(placeholder.length)
  const remappedStarts = new Map<number, number>()
  let actionCount = 0
  for (const [oldStart, sequence] of sequences) {
    remappedStarts.set(oldStart, actionStart + actionCount * 4)
    actionCount += sequence.length
  }
  const flattened: Array<{ action: number, oldAddend: number, first: boolean }> = []
  const componentBlocks = new Map<string, number>()
  for (const sequence of sequences.values()) {
    for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex++) {
      const action = sequence[sequenceIndex]!.action
      let oldAddend = action & 0x3FFFFFFF
      if ((oldAddend & 0x20000000) !== 0) oldAddend -= 0x40000000
      const first = sequenceIndex === 0
      const key = `${oldAddend}:${first ? 1 : 0}`
      if (!componentBlocks.has(key)) componentBlocks.set(key, componentBlocks.size)
      flattened.push({ action, oldAddend, first })
    }
  }
  const componentOffset = actionStart + actionCount * 4
  const componentCount = componentBlocks.size * byNew.length
  const ligatureOffset = componentOffset + componentCount * 2
  const state = buildClassicStateTable(
    subtable.stateTable,
    byNew,
    function (flags) {
      const oldStart = flags & 0x3FFF
      if (oldStart === 0) return flags
      const mapped = remappedStarts.get(oldStart)
      if (mapped === undefined || mapped > 0x3FFF) throw new Error('mort compact ligature action offset exceeds 14 bits')
      return (flags & 0xC000) | mapped
    },
    undefined,
    uint16Bytes([actionStart, componentOffset, ligatureOffset]),
  )
  if (state.length !== placeholder.length) throw new Error('mort ligature state-table size changed after offset assignment')
  const delta = ligatureOffset - subtable.ligatureOffset
  const actions = new Uint32Array(actionCount)
  const components = new Uint16Array(componentCount)
  for (let newActionIndex = 0; newActionIndex < flattened.length; newActionIndex++) {
    const source = flattened[newActionIndex]!
    const block = componentBlocks.get(`${source.oldAddend}:${source.first ? 1 : 0}`)!
    const newAddend = (componentOffset >>> 1) + block * byNew.length
    if (newAddend > 0x1FFFFFFF) throw new Error('mort compact ligature component offset exceeds signed 30 bits')
    actions[newActionIndex] = (source.action & 0xC0000000) | newAddend
  }
  for (const [key, block] of componentBlocks) {
    const split = key.lastIndexOf(':')
    const oldAddend = Number(key.slice(0, split))
    const first = key.slice(split + 1) === '1'
    for (let glyph = 0; glyph < byNew.length; glyph++) {
      const sourceComponentIndex = oldAddend + byNew[glyph]![0] - (subtable.componentOffset >>> 1)
      let value = sourceComponentIndex >= 0 && sourceComponentIndex < subtable.components.length
        ? subtable.components[sourceComponentIndex]!
        : 0
      if (first) value += delta
      if (value < 0 || value > 0xFFFF) throw new Error('mort compact ligature component value exceeds 16 bits')
      components[block * byNew.length + glyph] = value
    }
  }
  const ligatures = new Uint16Array(subtable.ligatures.length)
  for (let i = 0; i < subtable.ligatures.length; i++) {
    const glyph = subtable.ligatures[i]!
    ligatures[i] = oldToNew.get(glyph) ?? glyph
  }
  const writer = new BinaryWriter(ligatureOffset + ligatures.length * 2)
  writer.writeBytes(state)
  writer.position = actionStart
  for (let i = 0; i < actions.length; i++) writer.writeUint32(actions[i]!)
  for (let i = 0; i < components.length; i++) writer.writeUint16(components[i]!)
  for (let i = 0; i < ligatures.length; i++) writer.writeUint16(ligatures[i]!)
  return writer.toUint8Array()
}

function buildMortSubtableData(
  subtable: MortSubtable,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const data = subtable.subsetData
  if (data.type === 0) return buildClassicStateTable(data.stateTable, byNew)
  if (data.type === 1) return buildMortType1(data, byNew, oldToNew)
  if (data.type === 2) return buildMortType2(data, byNew, oldToNew)
  if (data.type === 4) return buildMappedGlyphLookup(data.lookup, byNew, oldToNew)

  const placeholder = buildClassicStateTable(data.stateTable, byNew)
  const offsets = new Map<number, number>()
  let position = placeholder.length
  for (const [oldOffset, values] of data.insertionLists) {
    offsets.set(oldOffset, position)
    position += values.length * 2
  }
  const state = buildClassicStateTable(data.stateTable, byNew, undefined, function (entry) {
    const extra = entry.extra.slice()
    for (let i = 0; i < extra.length; i++) {
      if (extra[i] === 0) continue
      const mapped = offsets.get(extra[i]!)
      if (mapped === undefined || mapped > 0xFFFF) throw new Error('mort compact insertion offset exceeds 16 bits')
      extra[i] = mapped
    }
    return { flags: entry.flags, extra }
  })
  if (state.length !== placeholder.length) throw new Error('mort insertion state-table size changed after offset assignment')
  const writer = new BinaryWriter(position)
  writer.writeBytes(state)
  for (const [oldOffset, values] of data.insertionLists) {
    writer.position = offsets.get(oldOffset)!
    for (let i = 0; i < values.length; i++) writer.writeUint16(oldToNew.get(values[i]!) ?? values[i]!)
  }
  return writer.toUint8Array()
}

function mortCoverage(subtable: MortSubtable): number {
  let coverage = subtable.type
  if (subtable.vertical) coverage |= 0x8000
  if (subtable.descending) coverage |= 0x4000
  if (subtable.allDirections) coverage |= 0x2000
  return coverage
}

function buildMort(
  chains: readonly MortChain[],
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  const chainData: Uint8Array[] = []
  for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
    const chain = chains[chainIndex]!
    const subtables: Uint8Array[] = []
    for (let subtableIndex = 0; subtableIndex < chain.subtables.length; subtableIndex++) {
      const source = chain.subtables[subtableIndex]!
      const body = buildMortSubtableData(source, byNew, oldToNew)
      const length = align4(8 + body.length)
      if (length > 0xFFFF) throw new Error('mort compact subtable length exceeds 16 bits')
      const writer = new BinaryWriter(length)
      writer.writeUint16(length)
      writer.writeUint16(mortCoverage(source))
      writer.writeUint32(source.subFeatureFlags)
      writer.writeBytes(body)
      writer.pad4()
      subtables.push(writer.toUint8Array())
    }
    const length = 12 + chain.features.length * 12 + subtables.reduce(function (sum, value) { return sum + value.length }, 0)
    const writer = new BinaryWriter(length)
    writer.writeUint32(chain.defaultFlags)
    writer.writeUint32(length)
    writer.writeUint16(chain.features.length)
    writer.writeUint16(subtables.length)
    for (let i = 0; i < chain.features.length; i++) {
      writer.writeUint16(chain.features[i]!.featureType)
      writer.writeUint16(chain.features[i]!.featureSetting)
      writer.writeUint32(chain.features[i]!.enableFlags)
      writer.writeUint32(chain.features[i]!.disableFlags)
    }
    for (let i = 0; i < subtables.length; i++) writer.writeBytes(subtables[i]!)
    chainData.push(writer.toUint8Array())
  }
  const writer = new BinaryWriter()
  writer.writeUint32(0x00010000)
  writer.writeUint32(chainData.length)
  for (let i = 0; i < chainData.length; i++) writer.writeBytes(chainData[i]!)
  return writer.toUint8Array()
}

function buildOpbd(
  table: NonNullable<SfntTableManager['opbd']>,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const selected: Array<{ glyphId: number, bounds: NonNullable<ReturnType<typeof table.getOpticalBounds>> }> = []
  for (let i = 0; i < byNew.length; i++) {
    const bounds = table.getOpticalBounds(byNew[i]![0])
    if (bounds !== null) selected.push({ glyphId: byNew[i]![1], bounds })
  }
  const lookupLength = 12 + selected.length * 4
  const entries: LookupEntry[] = []
  for (let i = 0; i < selected.length; i++) entries.push({ glyphId: selected[i]!.glyphId, value: 6 + lookupLength + i * 8 })
  const writer = new BinaryWriter(6 + lookupLength + selected.length * 8)
  writer.writeUint32(0x00010000)
  writer.writeUint16(table.format)
  writer.writeBytes(buildLookup6(entries, 2))
  for (let i = 0; i < selected.length; i++) {
    const bounds = selected[i]!.bounds
    writer.writeInt16(bounds.left)
    writer.writeInt16(bounds.top)
    writer.writeInt16(bounds.right)
    writer.writeInt16(bounds.bottom)
  }
  return writer.toUint8Array()
}

function buildProp(
  table: NonNullable<SfntTableManager['prop']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array {
  if (table.format === 0) {
    const writer = new BinaryWriter(8)
    writer.writeUint32(table.version * 65536)
    writer.writeUint16(0)
    writer.writeUint16(table.defaultProperties)
    return writer.toUint8Array()
  }
  const entries: LookupEntry[] = []
  for (let i = 0; i < byNew.length; i++) {
    const oldGlyph = byNew[i]![0]
    const newGlyph = byNew[i]![1]
    let properties = table.getProperties(oldGlyph)
    const complement = getComplementOffset(properties)
    if (complement !== 0) {
      const mappedComplement = mappedGlyph(oldToNew, oldGlyph + complement, 'prop')
      const mappedOffset = mappedComplement - newGlyph
      if (mappedOffset < -8 || mappedOffset > 7) throw new Error('prop compact subset complement offset exceeds signed four-bit range')
      properties = (properties & ~COMPLEMENT_MASK) | ((mappedOffset & 0x0F) << 8)
    }
    if (properties !== table.defaultProperties) entries.push({ glyphId: newGlyph, value: properties })
  }
  const writer = new BinaryWriter()
  writer.writeUint32(table.version * 65536)
  writer.writeUint16(1)
  writer.writeUint16(table.defaultProperties)
  writer.writeBytes(buildLookup6(entries, 2))
  return writer.toUint8Array()
}

function writeZapfGroup(
  writer: BinaryWriter,
  group: NonNullable<ReturnType<NonNullable<SfntTableManager['zapf']>['getGlyphInfo']>>['groups'][number],
  oldToNew: ReadonlyMap<number, number>,
): void {
  let hasFlags = false
  for (let i = 0; i < group.subgroups.length; i++) if (group.subgroups[i]!.flags !== null) hasFlags = true
  writer.writeUint16((hasFlags ? 0x8000 : 0) | group.subgroups.length)
  for (let i = 0; i < group.subgroups.length; i++) {
    const subgroup = group.subgroups[i]!
    if (hasFlags) writer.writeUint16(subgroup.flags ?? 0)
    writer.writeUint16(subgroup.nameIndex)
    writer.writeUint16(subgroup.glyphs.length)
    for (let glyph = 0; glyph < subgroup.glyphs.length; glyph++) {
      writer.writeUint16(mappedGlyph(oldToNew, subgroup.glyphs[glyph]!, 'Zapf group'))
    }
    if (hasFlags && ((subgroup.flags ?? 0) & 0x8000) !== 0) writer.pad4()
  }
}

function writeZapfFeature(
  writer: BinaryWriter,
  feature: NonNullable<NonNullable<ReturnType<NonNullable<SfntTableManager['zapf']>['getGlyphInfo']>>['feature']>,
): void {
  writer.writeUint16(feature.context)
  writer.writeUint16(feature.aatFeatures.length)
  for (let i = 0; i < feature.aatFeatures.length; i++) {
    writer.writeUint16(feature.aatFeatures[i]!.featureType)
    writer.writeUint16(feature.aatFeatures[i]!.featureSetting)
  }
  writer.writeUint16(feature.otTags.length)
  for (let i = 0; i < feature.otTags.length; i++) writer.writeTag(feature.otTags[i]!)
}

function buildZapfGlyphInfo(
  info: NonNullable<ReturnType<NonNullable<SfntTableManager['zapf']>['getGlyphInfo']>>,
  groupOffset: number,
  featureOffset: number,
): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint32(groupOffset)
  writer.writeUint32(featureOffset)
  writer.writeUint8(info.flags)
  writer.writeUint8(info.unicodes.length)
  for (let i = 0; i < info.unicodes.length; i++) writer.writeUint16(info.unicodes[i]!)
  writer.writeUint16(info.identifiers.length)
  const encoder = new TextEncoder()
  for (let i = 0; i < info.identifiers.length; i++) {
    const identifier = info.identifiers[i]!
    writer.writeUint8(identifier.kind)
    if (identifier.name !== null) {
      const bytes = encoder.encode(identifier.name)
      if (bytes.length > 0xFF) throw new Error('Zapf compact subset identifier exceeds Pascal-string length')
      writer.writeUint8(bytes.length)
      writer.writeBytes(bytes)
    } else writer.writeUint16(identifier.value!)
  }
  return writer.toUint8Array()
}

function buildZapf(
  table: NonNullable<SfntTableManager['zapf']>,
  byNew: readonly (readonly [number, number])[],
  oldToNew: ReadonlyMap<number, number>,
): Uint8Array | null {
  type GlyphInfo = NonNullable<ReturnType<typeof table.getGlyphInfo>>
  const selected: Array<{ glyphId: number, info: GlyphInfo }> = []
  for (let i = 0; i < byNew.length; i++) {
    const info = table.getGlyphInfo(byNew[i]![0])
    if (info !== null) selected.push({ glyphId: byNew[i]![1], info })
  }
  if (selected.length === 0) return null

  const extra = new BinaryWriter()
  const groupOffsets = new Map<number, number>()
  const groupObjects = new Map<number, GlyphInfo['groups'][number]>()
  for (let i = 0; i < selected.length; i++) {
    for (let group = 0; group < selected[i]!.info.groups.length; group++) {
      const value = selected[i]!.info.groups[group]!
      groupObjects.set(value.offset, value)
    }
  }
  for (const [oldOffset, group] of groupObjects) {
    groupOffsets.set(oldOffset, extra.position)
    writeZapfGroup(extra, group, oldToNew)
  }
  const featureOffsets = new Map<GlyphInfo['feature'], number>()
  for (let i = 0; i < selected.length; i++) {
    const feature = selected[i]!.info.feature
    if (feature === null || featureOffsets.has(feature)) continue
    featureOffsets.set(feature, extra.position)
    writeZapfFeature(extra, feature)
  }
  const rootOffsets = new Map<GlyphInfo, number>()
  for (let i = 0; i < selected.length; i++) {
    const info = selected[i]!.info
    if (rootOffsets.has(info) || info.groupReferences.length === 0) continue
    if (info.groupReferences.length === 1) {
      const direct = info.groupReferences[0]
      const mapped = direct === null || direct === undefined ? undefined : groupOffsets.get(direct)
      if (mapped !== undefined) {
        rootOffsets.set(info, mapped)
        continue
      }
    }
    const rootOffset = extra.position
    rootOffsets.set(info, rootOffset)
    extra.writeUint16(0x4000 | info.groupReferences.length)
    extra.writeUint16(0)
    for (let reference = 0; reference < info.groupReferences.length; reference++) {
      const oldOffset = info.groupReferences[reference]
      if (oldOffset === null || oldOffset === undefined) extra.writeUint32(0xFFFFFFFF)
      else extra.writeUint32(groupOffsets.get(oldOffset) ?? rootOffset)
    }
  }

  const records: Uint8Array[] = []
  let recordsLength = 0
  for (let i = 0; i < selected.length; i++) {
    const info = selected[i]!.info
    const record = buildZapfGlyphInfo(
      info,
      rootOffsets.get(info) ?? 0xFFFFFFFF,
      info.feature === null ? 0xFFFFFFFF : featureOffsets.get(info.feature)!,
    )
    records.push(record)
    recordsLength += record.length
  }
  const lookupLength = 12 + selected.length * 6
  const recordsStart = 8 + lookupLength
  const extraInfoOffset = align4(recordsStart + recordsLength)
  const entries: LookupEntry[] = []
  let recordOffset = recordsStart
  for (let i = 0; i < selected.length; i++) {
    entries.push({ glyphId: selected[i]!.glyphId, value: recordOffset })
    recordOffset += records[i]!.length
  }
  const writer = new BinaryWriter(extraInfoOffset + extra.position)
  writer.writeUint16(2)
  writer.writeUint16(0)
  writer.writeUint32(extraInfoOffset)
  writer.writeBytes(buildLookup6(entries, 4))
  for (let i = 0; i < records.length; i++) writer.writeBytes(records[i]!)
  writer.position = extraInfoOffset
  writer.writeBytes(extra.toUint8Array())
  return writer.toUint8Array()
}

function buildMerg(
  table: NonNullable<SfntTableManager['merg']>,
  byNew: readonly (readonly [number, number])[],
): Uint8Array {
  const ranges: Array<{ start: number, end: number, classId: number }> = []
  for (let i = 0; i < byNew.length; i++) {
    const glyphId = byNew[i]![1]
    const classId = table.getMergeClass(byNew[i]![0])
    if (classId === 0) continue
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && previous.classId === classId && previous.end + 1 === glyphId) previous.end = glyphId
    else ranges.push({ start: glyphId, end: glyphId, classId })
  }
  const classDefOffset = 12
  const classDefLength = 4 + ranges.length * 6
  const mergeDataOffset = classDefOffset + classDefLength
  const writer = new BinaryWriter(mergeDataOffset + table.mergeClassCount * table.mergeClassCount)
  writer.writeUint16(table.version)
  writer.writeUint16(table.mergeClassCount)
  writer.writeUint16(mergeDataOffset)
  writer.writeUint16(1)
  writer.writeUint16(10)
  writer.writeUint16(classDefOffset)
  writer.writeUint16(2)
  writer.writeUint16(ranges.length)
  for (let i = 0; i < ranges.length; i++) {
    writer.writeUint16(ranges[i]!.start)
    writer.writeUint16(ranges[i]!.end)
    writer.writeUint16(ranges[i]!.classId)
  }
  for (let left = 0; left < table.mergeClassCount; left++) {
    for (let right = 0; right < table.mergeClassCount; right++) writer.writeUint8(table.getMergeActionByClass(left, right))
  }
  return writer.toUint8Array()
}
