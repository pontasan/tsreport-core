import type { Glyph, FontMetrics } from '../types/index.js'
import type {
  GlatTable, GraphiteFeatTable, SilfClassMap, SilfPass, SilfSubtable, SilfTable, SillTable,
} from '../parsers/tables/graphite.js'

export interface GraphiteFontSource {
  readonly silf: SilfTable | null
  readonly glat: GlatTable | null
  readonly sill: SillTable | null
  readonly graphiteFeatures: GraphiteFeatTable | null
  readonly metrics: FontMetrics
  getGlyphId(codePoint: number): number
  getGlyph(glyphId: number): Glyph
  getGlyphBoundingBox(glyphId: number): { xMin: number, yMin: number, xMax: number, yMax: number }
  getAdvanceWidth(glyphId: number): number
}

export interface GraphiteShapeOptions {
  language: string | null
  rightToLeft: boolean
  features?: ReadonlyMap<number, number>
  justification?: GraphiteJustificationOptions
}

/** Graphite line-justification parameters, expressed in font design units. */
export interface GraphiteJustificationOptions {
  width: number
  /** The shaped range starts inside an existing line. */
  startInline?: boolean
  /** The shaped range ends inside an existing line. */
  endInline?: boolean
  /** First input code-point index included in width distribution. */
  firstCodePoint?: number
  /** Last input code-point index included in width distribution. */
  lastCodePoint?: number
}

export interface GraphiteShapedGlyph {
  glyphId: number
  cluster: number
  xOffset: number
  yOffset: number
  xAdvance: number
  yAdvance: number
  componentCount: number
  graphite: GraphiteGlyphMetadata
}

export interface GraphiteGlyphMetadata {
  original: number
  sourceStart: number
  /** Exclusive input code-point boundary. */
  sourceEnd: number
  associationBefore: number
  associationAfter: number
  breakWeight: number
  insertBefore: boolean
  bidiLevel: number
  attachmentParent: number
  pseudoGlyphId: number | null
  substituted: boolean
  justification: number
  userAttributes: readonly number[]
}

interface GraphiteSlot {
  gid: number
  realGid: number
  substituted: boolean
  original: number
  before: number
  after: number
  advanceX: number
  advanceY: number
  shiftX: number
  shiftY: number
  collisionShiftX: number
  collisionShiftY: number
  attachX: number
  attachY: number
  withX: number
  withY: number
  attachLevel: number
  parent: GraphiteSlot | null
  insertBefore: boolean
  bidiLevel: number
  justification: number
  justificationParams: Int16Array | null
  userAttrs: Int16Array
  attrs: Float32Array
}

interface GraphiteRun {
  font: GraphiteFontSource
  subtable: SilfSubtable
  slots: GraphiteSlot[]
  features: Int16Array[]
  codePoints: readonly number[]
  breakWeights: Int16Array
  rightToLeft: boolean
  currentDirection: number
  positions: Map<GraphiteSlot, CollisionPoint>
}

interface RuleMatch {
  map: Array<GraphiteSlot | null>
  context: number
  rule: number
}

interface VmState {
  run: GraphiteRun
  map: Array<GraphiteSlot | null>
  mapPointer: number
  mapBase: number
  current: GraphiteSlot | null
  deletedNext: GraphiteSlot | null
  deletedPrevious: Map<GraphiteSlot, GraphiteSlot | null>
  deletedFollowing: Map<GraphiteSlot, GraphiteSlot | null>
  copiedSlots: Set<GraphiteSlot>
  tempCopyOffsets: ReadonlySet<number>
  constraint: boolean
  positioned: boolean
  stack: number[]
}

const OP_PARAM_SIZE = Uint8Array.from([
  0, 1, 1, 2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 3, 1, 0,
  0, 0xff, 2, 1, 1, 1, 1, 2, 2, 2, 3, 2, 2, 3, 3, 0,
  0, 0, 0, 2, 2, 2, 1, 0, 5, 0, 0, 2, 3, 3, 0, 0,
  0, 4, 2,
])

function signed8(value: number): number {
  return value & 0x80 ? value - 0x100 : value
}

function signed16(value: number): number {
  return value & 0x8000 ? value - 0x10000 : value
}

function readUint16(code: Uint8Array, offset: number): number {
  return (code[offset]! << 8) | code[offset + 1]!
}

function readInt32(code: Uint8Array, offset: number): number {
  return ((code[offset]! << 24) | (code[offset + 1]! << 16) | (code[offset + 2]! << 8) | code[offset + 3]!) | 0
}

function getGlyphAttr(run: GraphiteRun, slot: GraphiteSlot, attribute: number): number {
  return run.font.glat!.getAttr(slot.gid, attribute)
}

function setSlotGlyph(run: GraphiteRun, slot: GraphiteSlot, glyphId: number): void {
  slot.gid = glyphId
  const pseudo = getGlyphAttr(run, slot, run.subtable.attrPseudo)
  slot.realGid = pseudo > 0 ? pseudo : glyphId
  slot.advanceX = run.font.getAdvanceWidth(slot.realGid)
  slot.advanceY = 0
  slot.substituted = true
}

function findClassIndex(classMap: SilfClassMap, classId: number, glyphId: number): number {
  if (classId < classMap.numLinear) return classMap.linearClasses[classId]!.indexOf(glyphId)
  const lookup = classMap.lookupClasses[classId - classMap.numLinear]
  if (lookup === undefined) return -1
  let low = 0
  let high = lookup.glyphIds.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const value = lookup.glyphIds[middle]!
    if (value === glyphId) return lookup.indices[middle]!
    if (value < glyphId) low = middle + 1
    else high = middle - 1
  }
  return -1
}

function getClassGlyph(classMap: SilfClassMap, classId: number, index: number): number {
  if (classId < classMap.numLinear) return classMap.linearClasses[classId]![index] ?? 0
  const lookup = classMap.lookupClasses[classId - classMap.numLinear]
  if (lookup === undefined) return 0
  for (let i = 0; i < lookup.indices.length; i++) {
    if (lookup.indices[i] === index) return lookup.glyphIds[i]!
  }
  return 0
}

function passColumn(pass: SilfPass, glyphId: number): number {
  let low = 0
  let high = pass.ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const range = pass.ranges[middle]!
    if (glyphId < range.firstId) high = middle - 1
    else if (glyphId > range.lastId) low = middle + 1
    else return range.colId
  }
  return -1
}

function collectRuleCandidates(pass: SilfPass, slotIndex: number, slots: GraphiteSlot[]): { map: Array<GraphiteSlot | null>, context: number, start: number, rules: number[] } | null {
  let start = slotIndex
  let context = 0
  while (context < pass.maxRulePreContext && start > 0) {
    start--
    context++
  }
  if (context < pass.minRulePreContext) return null
  const startIndex = pass.maxRulePreContext - context
  let state = pass.startStates[startIndex]!
  const successStart = pass.numRows - pass.numSuccess
  const rules: number[] = []
  const seen = new Set<number>()
  const map: Array<GraphiteSlot | null> = []
  let position = start
  while (position <= slots.length) {
    const slot = position < slots.length ? slots[position]! : null
    map.push(slot)
    if (slot === null || state >= pass.numTransitional) break
    const column = passColumn(pass, slot.gid)
    if (column < 0) break
    state = pass.stateTransitions[state * pass.numColumns + column]!
    if (state >= successStart) {
      const success = state - successStart
      const first = pass.oRuleMap[success]!
      const last = pass.oRuleMap[success + 1]!
      for (let i = first; i < last; i++) {
        const rule = pass.ruleMap[i]!
        if (!seen.has(rule)) { seen.add(rule); rules.push(rule) }
      }
    }
    position++
    if (state === 0) break
  }
  if (map[map.length - 1] !== null) map.push(null)
  rules.sort(function (left, right) {
    const lengthDifference = pass.ruleSortKeys[right]! - pass.ruleSortKeys[left]!
    return lengthDifference !== 0 ? lengthDifference : left - right
  })
  return { map, context, start, rules }
}

function slotAt(state: VmState, offset: number): GraphiteSlot | null {
  const index = state.mapPointer + offset
  if (index < -1 || index >= state.map.length) throw new Error('Graphite VM slot offset is out of bounds')
  return index < 0 ? null : state.map[index]!
}

function pop(state: VmState): number {
  const value = state.stack.pop()
  if (value === undefined) throw new Error('Graphite VM stack underflow')
  return value
}

function push(state: VmState, value: number): void {
  if (state.stack.length >= 1024) throw new Error('Graphite VM stack overflow')
  state.stack.push(value | 0)
}

function glyphMetric(run: GraphiteRun, slot: GraphiteSlot, metric: number): number {
  const glyph = run.font.getGlyphBoundingBox(slot.gid)
  const glyphAdvance = run.font.getAdvanceWidth(slot.gid)
  switch (metric) {
    case 0: return glyph.xMin
    case 1: return glyphAdvance - glyph.xMax
    case 2: return glyph.yMax
    case 3: return glyph.yMin
    case 4: return glyph.xMin
    case 5: return glyph.xMax
    case 6: return glyph.yMax - glyph.yMin
    case 7: return glyph.xMax - glyph.xMin
    case 8: return glyphAdvance
    case 9: return 0
    case 10: return run.font.metrics.ascender
    case 11: return run.font.metrics.descender
    default: return 0
  }
}

function getJustificationParam(
  run: GraphiteRun, slot: GraphiteSlot, level: number, subindex: number,
): number {
  if (level !== 0 && level >= run.subtable.jLevels.length) return 0
  if (slot.justificationParams !== null) {
    return slot.justificationParams[level * 5 + subindex] ?? 0
  }
  if (level >= run.subtable.jLevels.length) return 0
  const attributes = run.subtable.jLevels[level]!
  switch (subindex) {
    case 0: return getGlyphAttr(run, slot, attributes.attrStretch)
    case 1: return getGlyphAttr(run, slot, attributes.attrShrink)
    case 2: return getGlyphAttr(run, slot, attributes.attrStep)
    case 3: return getGlyphAttr(run, slot, attributes.attrWeight)
    default: return 0
  }
}

function setJustificationParam(
  run: GraphiteRun, slot: GraphiteSlot, level: number, subindex: number, value: number,
): void {
  if (level !== 0 && level >= run.subtable.jLevels.length) return
  if (slot.justificationParams === null) {
    const count = Math.max(1, run.subtable.jLevels.length)
    const params = new Int16Array(count * 5)
    for (let i = 0; i < run.subtable.jLevels.length; i++) {
      const attributes = run.subtable.jLevels[i]!
      params[i * 5] = getGlyphAttr(run, slot, attributes.attrStretch)
      params[i * 5 + 1] = getGlyphAttr(run, slot, attributes.attrShrink)
      params[i * 5 + 2] = getGlyphAttr(run, slot, attributes.attrStep)
      params[i * 5 + 3] = getGlyphAttr(run, slot, attributes.attrWeight)
    }
    slot.justificationParams = params
  }
  slot.justificationParams[level * 5 + subindex] = signed16(value & 0xffff)
}

function getSlotAttr(run: GraphiteRun, slot: GraphiteSlot, attribute: number, subindex: number): number {
  if (attribute >= 24 && attribute < 44 && attribute !== 29) {
    return getJustificationParam(run, slot, Math.trunc((attribute - 24) / 5), (attribute - 24) % 5)
  }
  switch (attribute) {
    case 0: return slot.advanceX
    case 1: return slot.advanceY
    case 2: return slot.parent === null ? 0 : 1
    case 3: return slot.attachX
    case 4: return slot.attachY
    case 6:
    case 7:
    case 10:
    case 11: return 0
    case 8: return slot.withX
    case 9: return slot.withY
    case 13: return slot.attachLevel
    case 14: return run.breakWeights[slot.original] ?? 0
    case 16: return run.rightToLeft ? 1 : 0
    case 17: return slot.insertBefore ? 1 : 0
    case 18: return run.positions.get(slot)?.x ?? 0
    case 19: return run.positions.get(slot)?.y ?? 0
    case 20: return slot.shiftX
    case 21: return slot.shiftY
    case 22: return slot.userAttrs[0] ?? 0
    case 29: return slot.justification
    case 55: return slot.userAttrs[subindex] ?? 0
    case 56: return slot.bidiLevel
    default: return slot.attrs[attribute] ?? 0
  }
}

function setSlotAttr(state: VmState, slot: GraphiteSlot, attribute: number, subindex: number, value: number, slotReference: boolean): void {
  const run = state.run
  if (slotReference && attribute === 2) {
    const targetIndex = value + state.mapPointer
    const parent = targetIndex >= 0 && targetIndex < state.map.length ? state.map[targetIndex]! : null
    if (parent === slot || parent === slot.parent || parent !== null && state.copiedSlots.has(parent)) return
    slot.parent = null
    if (parent === null) return
    let ancestor: GraphiteSlot | null = parent
    let depth = 0
    let cyclic = false
    while (ancestor !== null) {
      depth++
      if (ancestor === slot) cyclic = true
      ancestor = ancestor.parent
    }
    if (cyclic || depth >= 100) return
    slot.parent = parent
    if ((run.currentDirection !== 0) !== (targetIndex > state.mapPointer)) slot.withX = slot.advanceX
    else slot.attachX = parent.advanceX
    return
  }
  if (attribute >= 24 && attribute < 44 && attribute !== 29) {
    setJustificationParam(run, slot, Math.trunc((attribute - 24) / 5), (attribute - 24) % 5, value)
    return
  }
  switch (attribute) {
    case 0: slot.advanceX = signed16(value & 0xffff); break
    case 1: slot.advanceY = signed16(value & 0xffff); break
    case 3: slot.attachX = signed16(value & 0xffff); break
    case 4: slot.attachY = signed16(value & 0xffff); break
    case 8: slot.withX = signed16(value & 0xffff); break
    case 9: slot.withY = signed16(value & 0xffff); break
    case 13: slot.attachLevel = value & 0xff; break
    case 14: if (slot.original < run.breakWeights.length) run.breakWeights[slot.original] = value; break
    case 17: slot.insertBefore = value !== 0; break
    case 20: slot.shiftX = signed16(value & 0xffff); break
    case 21: slot.shiftY = signed16(value & 0xffff); break
    case 22: if (slot.userAttrs.length > 0) slot.userAttrs[0] = value; break
    case 29: slot.justification = signed16(value & 0xffff); break
    case 55: if (subindex < slot.userAttrs.length) slot.userAttrs[subindex] = value; break
    case 56: slot.bidiLevel = value & 0xff; break
    case 62:
    case 63: break
    default: if (attribute < slot.attrs.length) slot.attrs[attribute] = value; break
  }
  void run
}

function copySlot(target: GraphiteSlot, source: GraphiteSlot): void {
  target.gid = source.gid
  target.realGid = source.realGid
  target.substituted = source.substituted
  target.original = source.original
  target.before = source.before
  target.after = source.after
  target.advanceX = source.advanceX
  target.advanceY = source.advanceY
  target.shiftX = source.shiftX
  target.shiftY = source.shiftY
  target.collisionShiftX = source.collisionShiftX
  target.collisionShiftY = source.collisionShiftY
  target.attachX = source.attachX
  target.attachY = source.attachY
  target.withX = source.withX
  target.withY = source.withY
  target.attachLevel = source.attachLevel
  target.parent = source.parent
  target.insertBefore = source.insertBefore
  target.bidiLevel = source.bidiLevel
  target.justification = source.justification
  target.justificationParams = source.justificationParams === null ? null : new Int16Array(source.justificationParams)
  target.userAttrs.set(source.userAttrs)
  target.attrs.set(source.attrs)
}

function cloneSlot(source: GraphiteSlot): GraphiteSlot {
  return {
    ...source,
    justificationParams: source.justificationParams === null ? null : new Int16Array(source.justificationParams),
    userAttrs: new Int16Array(source.userAttrs),
    attrs: new Float32Array(source.attrs),
  }
}

function prepareActionMap(code: Uint8Array, candidate: RuleMatch): { map: Array<GraphiteSlot | null>, copiedSlots: Set<GraphiteSlot>, tempCopyOffsets: ReadonlySet<number> } {
  const contexts = new Map<number, { changed: boolean, referenced: boolean, offset: number }>()
  let slotReference = 0
  contexts.set(0, { changed: false, referenced: false, offset: 0 })
  for (let instruction = 0; instruction < code.length;) {
    const opcode = code[instruction]!
    instruction++
    const parameterStart = instruction
    let parameterSize = OP_PARAM_SIZE[opcode]!
    if (parameterSize === 0xff) parameterSize = 1 + code[instruction]!
    switch (opcode) {
      case 0x19:
      case 0x1b:
        slotReference++
        if (!contexts.has(slotReference)) contexts.set(slotReference, { changed: false, referenced: false, offset: instruction + parameterSize })
        break
      case 0x1f: if (slotReference >= 0) slotReference--; break
      case 0x1c:
      case 0x1d:
      case 0x21:
      case 0x38:
      case 0x3b: {
        const context = contexts.get(slotReference)
        if (context !== undefined) context.changed = true
        break
      }
    }
    if (opcode === 0x1d || opcode === 0x1e || opcode === 0x38) {
      const source = signed8(code[parameterStart]!)
      const referenced = contexts.get(slotReference + source)
      if (referenced !== undefined) referenced.referenced = true
      if (opcode === 0x1e && source !== 0) {
        const context = contexts.get(slotReference)
        if (context !== undefined) context.changed = true
      }
    } else if (opcode >= 0x28 && opcode <= 0x2e) {
      const referenced = contexts.get(slotReference + signed8(code[parameterStart + 1]!))
      if (referenced !== undefined) referenced.referenced = true
    } else if (opcode === 0x3c || opcode === 0x3d) {
      const referenced = contexts.get(slotReference + signed8(code[parameterStart + 2]!))
      if (referenced !== undefined) referenced.referenced = true
    } else if (opcode === 0x42) {
      const referenced = contexts.get(slotReference + signed8(code[parameterStart + 1]!))
      if (referenced !== undefined) referenced.referenced = true
    }
    instruction += parameterSize
  }
  const map = [...candidate.map]
  const copiedSlots = new Set<GraphiteSlot>()
  const tempCopyOffsets = new Set<number>()
  for (const context of contexts.values()) {
    if (context.changed && context.referenced) tempCopyOffsets.add(context.offset)
  }
  return { map, copiedSlots, tempCopyOffsets }
}

function ensureVmPositions(state: VmState, attribute: number): void {
  if (state.positioned || attribute !== 18 && attribute !== 19) return
  let start = -1
  let end = -1
  for (let i = 0; i < state.map.length; i++) {
    const slot = state.map[i]
    if (slot === null || slot === undefined) continue
    const index = state.run.slots.indexOf(slot)
    if (index < 0) continue
    if (start < 0 || index < start) start = index
    if (index > end) end = index
  }
  if (start >= 0) positionGraphiteSlots(state.run, true, start, end)
  state.positioned = true
}

function executeCode(code: Uint8Array, state: VmState): number {
  let instruction = 0
  while (instruction < code.length) {
    if (state.tempCopyOffsets.has(instruction)) {
      const source = state.map[state.mapPointer]
      if (source !== null && source !== undefined) {
        const copy = cloneSlot(source)
        state.map[state.mapPointer] = copy
        state.copiedSlots.add(copy)
      }
    }
    const opcode = code[instruction]!
    instruction++
    if (opcode >= OP_PARAM_SIZE.length || OP_PARAM_SIZE[opcode] === undefined) throw new Error(`Unsupported Graphite opcode 0x${opcode.toString(16)}`)
    const current = state.current
    switch (opcode) {
      case 0x00: break
      case 0x01: push(state, signed8(code[instruction]!)); instruction++; break
      case 0x02: push(state, code[instruction]!); instruction++; break
      case 0x03: push(state, signed16(readUint16(code, instruction))); instruction += 2; break
      case 0x04: push(state, readUint16(code, instruction)); instruction += 2; break
      case 0x05: push(state, readInt32(code, instruction)); instruction += 4; break
      case 0x06: { const right = pop(state); push(state, (pop(state) + right) | 0); break }
      case 0x07: { const right = pop(state); push(state, (pop(state) - right) | 0); break }
      case 0x08: { const right = pop(state); push(state, Math.imul(pop(state), right)); break }
      case 0x09: { const right = pop(state); const left = pop(state); if (right === 0 || left === -2147483648 && right === -1) throw new Error('Graphite VM invalid division'); push(state, Math.trunc(left / right)); break }
      case 0x0A: { const right = pop(state); push(state, Math.min(pop(state), right)); break }
      case 0x0B: { const right = pop(state); push(state, Math.max(pop(state), right)); break }
      case 0x0C: push(state, -pop(state)); break
      case 0x0D: push(state, pop(state) & 0xff); break
      case 0x0E: push(state, pop(state) & 0xffff); break
      case 0x0F: { const falseValue = pop(state); const trueValue = pop(state); push(state, pop(state) !== 0 ? trueValue : falseValue); break }
      case 0x10: { const right = pop(state); push(state, pop(state) !== 0 && right !== 0 ? 1 : 0); break }
      case 0x11: { const right = pop(state); push(state, pop(state) !== 0 || right !== 0 ? 1 : 0); break }
      case 0x12: push(state, pop(state) === 0 ? 1 : 0); break
      case 0x13: { const right = pop(state); push(state, pop(state) === right ? 1 : 0); break }
      case 0x14: { const right = pop(state); push(state, pop(state) !== right ? 1 : 0); break }
      case 0x15: { const right = pop(state); push(state, pop(state) < right ? 1 : 0); break }
      case 0x16: { const right = pop(state); push(state, pop(state) > right ? 1 : 0); break }
      case 0x17: { const right = pop(state); push(state, pop(state) <= right ? 1 : 0); break }
      case 0x18: { const right = pop(state); push(state, pop(state) >= right ? 1 : 0); break }
      case 0x19:
      case 0x1B: {
        if (state.current === null && state.deletedNext !== null) {
          state.current = state.deletedNext
          state.deletedNext = null
        } else if (state.current !== null) {
          const currentIndex = state.run.slots.indexOf(state.current)
          state.current = currentIndex >= 0 && currentIndex + 1 < state.run.slots.length
            ? state.run.slots[currentIndex + 1]!
            : null
        }
        state.mapPointer++
        break
      }
      case 0x1A: throw new Error('Graphite NEXT_N opcode is not implemented by the Graphite specification')
      case 0x1C:
        if (current === null) throw new Error('Graphite PUT_GLYPH has no current slot')
        setSlotGlyph(state.run, current, getClassGlyph(state.run.subtable.classMap, code[instruction]!, 0)); instruction++; break
      case 0x1D: {
        if (current === null) throw new Error('Graphite PUT_SUBS has no current slot')
        const source = slotAt(state, signed8(code[instruction]!))
        const inputClass = code[instruction + 1]!
        const outputClass = code[instruction + 2]!
        instruction += 3
        if (source !== null) setSlotGlyph(state.run, current, getClassGlyph(state.run.subtable.classMap, outputClass, findClassIndex(state.run.subtable.classMap, inputClass, source.gid)))
        break
      }
      case 0x1E: {
        const source = slotAt(state, signed8(code[instruction]!)); instruction++
        if (current !== null && source !== null && current !== source) copySlot(current, source)
        break
      }
      case 0x1F: {
        const index = current === null ? state.run.slots.length : state.run.slots.indexOf(current)
        const origin = current?.original ?? (state.run.slots[index - 1]?.original ?? 0)
        const inserted = createSlot(state.run, 0, origin)
        state.run.slots.splice(index, 0, inserted)
        state.current = inserted
        if (state.mapPointer >= 0) state.mapPointer--
        break
      }
      case 0x20: {
        if (current === null) throw new Error('Graphite DELETE has no current slot')
        const index = state.run.slots.indexOf(current)
        const previous = index > 0 ? state.run.slots[index - 1]! : null
        const next = index + 1 < state.run.slots.length ? state.run.slots[index + 1]! : null
        state.deletedPrevious.set(current, previous)
        state.deletedFollowing.set(current, next)
        state.run.slots.splice(index, 1)
        state.current = previous
        state.deletedNext = index === 0 ? next : null
        break
      }
      case 0x21: {
        if (current === null) throw new Error('Graphite ASSOC has no current slot')
        const count = code[instruction]!
        instruction++
        let before = Number.MAX_SAFE_INTEGER
        let after = -1
        for (let i = 0; i < count; i++) {
          const source = slotAt(state, signed8(code[instruction + i]!))
          if (source !== null) { before = Math.min(before, source.before); after = Math.max(after, source.after) }
        }
        instruction += count
        if (after >= 0) { current.before = before; current.after = after }
        break
      }
      case 0x22: {
        const offset = signed8(code[instruction]!)
        const count = code[instruction + 1]!
        instruction += 2
        if (state.mapPointer !== state.mapBase + offset) { instruction += count; push(state, 1) }
        break
      }
      case 0x23:
      case 0x24:
      case 0x25: {
        if (current === null) throw new Error('Graphite attribute opcode has no current slot')
        const attribute = code[instruction]!
        instruction++
        const value = pop(state)
        if (opcode !== 0x23) ensureVmPositions(state, attribute)
        const previous = getSlotAttr(state.run, current, attribute, 0)
        setSlotAttr(state, current, attribute, 0, opcode === 0x23 ? value : opcode === 0x24 ? previous + value : previous - value, false)
        break
      }
      case 0x26:
      case 0x27: {
        if (current === null) throw new Error('Graphite slot-reference opcode has no current slot')
        const attribute = code[instruction]!
        const subindex = opcode === 0x27 ? code[instruction + 1]! : 0
        instruction += opcode === 0x27 ? 2 : 1
        setSlotAttr(state, current, attribute, subindex, pop(state), true)
        break
      }
      case 0x28: {
        const attribute = code[instruction]!
        const source = slotAt(state, signed8(code[instruction + 1]!))
        instruction += 2
        ensureVmPositions(state, attribute)
        if (source !== null) push(state, getSlotAttr(state.run, source, attribute, 0))
        break
      }
      case 0x29:
      case 0x2C: {
        const attribute = code[instruction]!
        let source = slotAt(state, signed8(code[instruction + 1]!))
        instruction += 2
        if (opcode === 0x2C && source !== null && source.parent !== null) source = source.parent
        if (source !== null) push(state, getGlyphAttr(state.run, source, attribute))
        break
      }
      case 0x2A:
      case 0x2D: {
        const metric = code[instruction]!
        let source = slotAt(state, signed8(code[instruction + 1]!))
        instruction += 3
        if (opcode === 0x2D && source !== null && source.parent !== null) source = source.parent
        if (source !== null) push(state, glyphMetric(state.run, source, metric))
        break
      }
      case 0x2B: {
        const feature = code[instruction]!
        const source = slotAt(state, signed8(code[instruction + 1]!))
        instruction += 2
        if (source !== null) push(state, state.run.features[source.original]?.[feature] ?? 0)
        break
      }
      case 0x2E: {
        const attribute = code[instruction]!
        const source = slotAt(state, signed8(code[instruction + 1]!))
        const subindex = code[instruction + 2]!
        instruction += 3
        ensureVmPositions(state, attribute)
        if (source !== null) push(state, getSlotAttr(state.run, source, attribute, subindex))
        break
      }
      case 0x2F: throw new Error('Graphite PUSH_IGLYPH_ATTR opcode is not implemented by the Graphite specification')
      case 0x30: {
        const result = pop(state)
        if (state.stack.length !== 0) throw new Error('Graphite VM stack is not empty at return')
        return result
      }
      case 0x31:
      case 0x32:
        if (state.stack.length !== 0) throw new Error('Graphite VM stack is not empty at return')
        return opcode === 0x31 ? 0 : 1
      case 0x33:
      case 0x34:
      case 0x35: {
        if (current === null) throw new Error('Graphite indexed attribute opcode has no current slot')
        const attribute = code[instruction]!
        const subindex = code[instruction + 1]!
        instruction += 2
        const value = pop(state)
        if (opcode !== 0x33) ensureVmPositions(state, attribute)
        const previous = getSlotAttr(state.run, current, attribute, subindex)
        setSlotAttr(state, current, attribute, subindex, opcode === 0x33 ? value : opcode === 0x34 ? previous + value : previous - value, false)
        break
      }
      case 0x36: instruction++; push(state, 1); break
      case 0x37: push(state, 0x00030000); break
      case 0x38: {
        if (current === null) throw new Error('Graphite PUT_SUBS has no current slot')
        const source = slotAt(state, signed8(code[instruction]!))
        const inputClass = readUint16(code, instruction + 1)
        const outputClass = readUint16(code, instruction + 3)
        instruction += 5
        if (source !== null) setSlotGlyph(state.run, current, getClassGlyph(state.run.subtable.classMap, outputClass, findClassIndex(state.run.subtable.classMap, inputClass, source.gid)))
        break
      }
      case 0x39:
      case 0x3A: throw new Error('Graphite PUT_SUBS2/PUT_SUBS3 opcodes are not implemented by the Graphite specification')
      case 0x3B:
        if (current === null) throw new Error('Graphite PUT_GLYPH has no current slot')
        setSlotGlyph(state.run, current, getClassGlyph(state.run.subtable.classMap, readUint16(code, instruction), 0)); instruction += 2; break
      case 0x3C:
      case 0x3D: {
        const attribute = readUint16(code, instruction)
        let source = slotAt(state, signed8(code[instruction + 2]!))
        instruction += 3
        if (opcode === 0x3D && source !== null && source.parent !== null) source = source.parent
        if (source !== null) push(state, getGlyphAttr(state.run, source, attribute))
        break
      }
      case 0x3E: { const right = pop(state); push(state, pop(state) | right); break }
      case 0x3F: { const right = pop(state); push(state, pop(state) & right); break }
      case 0x40: push(state, ~pop(state)); break
      case 0x41: { const mask = readUint16(code, instruction); const value = readUint16(code, instruction + 2); instruction += 4; push(state, (pop(state) & ~mask) | value); break }
      case 0x42: {
        const feature = code[instruction]!
        const source = slotAt(state, signed8(code[instruction + 1]!))
        instruction += 2
        if (source !== null) state.run.features[source.original]![feature] = pop(state)
        break
      }
      default: throw new Error(`Unsupported Graphite opcode 0x${opcode.toString(16)}`)
    }
  }
  if (code.length !== 0) throw new Error('Graphite VM program is missing a return opcode')
  return 0
}

function codeSlice(block: Uint8Array, offsets: Uint16Array, rule: number): Uint8Array {
  const start = offsets[rule]!
  const end = offsets[rule + 1]!
  return block.subarray(start, end)
}

function constraintCodeSlice(block: Uint8Array, offsets: Uint16Array, rule: number): Uint8Array {
  const start = offsets[rule]!
  let nextRule = rule + 1
  while (nextRule + 1 < offsets.length && offsets[nextRule] === 0) nextRule++
  return block.subarray(start, offsets[nextRule]!)
}

function testRuleConstraint(run: GraphiteRun, pass: SilfPass, candidate: RuleMatch): boolean {
  const sort = pass.ruleSortKeys[candidate.rule]!
  const preContext = pass.rulePreContext[candidate.rule]!
  const start = candidate.context - preContext
  if (start < 0 || start + sort > candidate.map.length || candidate.map[start + sort - 1] === null) return false
  const code = pass.oConstraints[candidate.rule] === 0
    ? pass.ruleConstraints.subarray(0, 0)
    : constraintCodeSlice(pass.ruleConstraints, pass.oConstraints, candidate.rule)
  if (code.length === 0) return true
  for (let position = 0; position < sort; position++) {
    const mapPointer = start + position
    const slot = candidate.map[mapPointer] ?? null
    if (slot === null) continue
    const result = executeCode(code, {
      run, map: candidate.map, mapPointer, mapBase: candidate.context, current: slot, deletedNext: null,
      deletedPrevious: new Map(), deletedFollowing: new Map(), copiedSlots: new Set(), tempCopyOffsets: new Set(), constraint: true, positioned: false, stack: [],
    })
    if (result === 0) return false
  }
  return true
}

function adjustRuleCursor(state: VmState, delta: number): GraphiteSlot | null {
  let slot = state.map[state.mapPointer] ?? null
  if (slot !== null && !state.run.slots.includes(slot)) {
    slot = state.deletedPrevious.get(slot) ?? state.deletedFollowing.get(slot) ?? null
  }
  if (slot === null) {
    if (delta < 0) {
      slot = state.run.slots[state.run.slots.length - 1] ?? null
      delta++
    } else if (delta > 0) {
      slot = state.run.slots[0] ?? null
      delta--
    }
  }
  if (slot === null) return null
  let index = state.run.slots.indexOf(slot)
  if (index < 0) return null
  index += delta
  return index >= 0 && index < state.run.slots.length ? state.run.slots[index]! : null
}

function applyRule(run: GraphiteRun, pass: SilfPass, candidate: RuleMatch): GraphiteSlot | null {
  const code = codeSlice(pass.actions, pass.oActions, candidate.rule)
  const prepared = prepareActionMap(code, candidate)
  const state: VmState = {
    run, map: prepared.map, mapPointer: candidate.context, mapBase: candidate.context,
    current: candidate.map[candidate.context]!, deletedNext: null,
    deletedPrevious: new Map(), deletedFollowing: new Map(), copiedSlots: prepared.copiedSlots, tempCopyOffsets: prepared.tempCopyOffsets, constraint: false, positioned: false, stack: [],
  }
  const advance = executeCode(code, state)
  return adjustRuleCursor(state, advance)
}

function runPass(run: GraphiteRun, pass: SilfPass): void {
  if (pass.passConstraints.length > 0 && run.slots.length > 0) {
    const map: Array<GraphiteSlot | null> = [run.slots[0]!, null]
    const accepted = executeCode(pass.passConstraints, {
      run, map, mapPointer: 0, mapBase: 0, current: run.slots[0]!, deletedNext: null,
      deletedPrevious: new Map(), deletedFollowing: new Map(), copiedSlots: new Set(), tempCopyOffsets: new Set(), constraint: true, positioned: false, stack: [],
    })
    if (accepted === 0) return
  }
  let cursorSlot: GraphiteSlot | null = run.slots[0] ?? null
  let highwater: GraphiteSlot | null = run.slots[1] ?? null
  let loop = pass.maxRuleLoop || 1
  while (cursorSlot !== null) {
    const cursor = run.slots.indexOf(cursorSlot)
    if (cursor < 0) {
      cursorSlot = highwater
      continue
    }
    const collected = collectRuleCandidates(pass, cursor, run.slots)
    let applied = false
    if (collected !== null) {
      for (let i = 0; i < collected.rules.length; i++) {
        const candidate: RuleMatch = { map: collected.map, context: collected.context, rule: collected.rules[i]! }
        if (!testRuleConstraint(run, pass, candidate)) continue
        const highwaterIndexBefore: number = highwater === null ? -1 : run.slots.indexOf(highwater)
        const highwaterFollowing: GraphiteSlot | null = highwaterIndexBefore >= 0 && highwaterIndexBefore + 1 < run.slots.length
          ? run.slots[highwaterIndexBefore + 1]!
          : null
        cursorSlot = applyRule(run, pass, candidate)
        if (highwater !== null && !run.slots.includes(highwater)) highwater = highwaterFollowing
        applied = true
        break
      }
    }
    if (!applied) {
      const nextIndex = cursor + 1
      cursorSlot = nextIndex >= 0 && nextIndex < run.slots.length ? run.slots[nextIndex]! : null
    }
    if (cursorSlot !== null) {
      const cursorIndex = run.slots.indexOf(cursorSlot)
      const highwaterIndex = highwater === null ? -1 : run.slots.indexOf(highwater)
      const passedHighwater = highwaterIndex >= 0 && cursorIndex > highwaterIndex
      if (cursorSlot !== highwater && !passedHighwater) loop--
      if (cursorSlot === highwater || passedHighwater || loop === 0) {
        if (loop === 0) cursorSlot = highwater
        loop = pass.maxRuleLoop || 1
        if (cursorSlot !== null) {
          const highwaterIndex = run.slots.indexOf(cursorSlot)
          highwater = highwaterIndex >= 0 && highwaterIndex + 1 < run.slots.length
            ? run.slots[highwaterIndex + 1]!
            : null
        }
      }
    }
  }
  const collisionOrigins = (pass.flags & 31) !== 0 ? positionGraphiteSlots(run, true).positions : null
  if ((pass.flags & 7) !== 0) runCollisionShifting(run, pass.flags & 7, pass.collisionThreshold, collisionOrigins!)
  if (((pass.flags >>> 3) & 3) !== 0) runCollisionKerning(run, (pass.flags >>> 3) & 3, collisionOrigins!)
  if ((pass.flags & 31) !== 0) finishCollisions(run)
}

interface GraphiteBox {
  left: number
  bottom: number
  right: number
  top: number
  sumMin: number
  diffMin: number
  sumMax: number
  diffMax: number
}

interface CollisionPoint { x: number, y: number }
interface CollisionRect { left: number, bottom: number, right: number, top: number }

interface ZoneExclusion {
  x: number
  xm: number
  c: number
  sm: number
  smx: number
  open: boolean
}

class CollisionZones {
  private exclusions: ZoneExclusion[] = []
  private marginLength = 0
  private marginWeight = 0
  private minimum = 0
  private maximum = 0

  initialize(minimum: number, maximum: number, marginLength: number, marginWeight: number, anchor: number, diagonal: boolean): void {
    this.marginLength = marginLength
    this.marginWeight = marginWeight
    this.minimum = minimum
    this.maximum = maximum
    this.exclusions = [this.weightedExclusion(minimum, maximum, 1, anchor, 0, 0, 0, 0, false, diagonal)]
    this.exclusions[0]!.open = true
  }

  private weightedExclusion(x: number, xm: number, f: number, a0: number, m: number, xi: number, ai: number, c: number, negative: boolean, diagonal: boolean): ZoneExclusion {
    if (!diagonal) return { x, xm, sm: m + f, smx: m * xi, c: m * xi * xi + f * a0 * a0 + c, open: false }
    const xia = negative ? xi - ai : xi + ai
    return { x, xm, sm: 0.25 * (m + 2 * f), smx: 0.25 * m * xia, c: 0.25 * (m * xia * xia + 2 * f * a0 * a0) + c, open: false }
  }

  weighted(axis: number, xmin: number, xmax: number, f: number, a0: number, m: number, xi: number, ai: number, c: number, negative: boolean): void {
    this.insert(this.weightedExclusion(xmin, xmax, f, a0, m, xi, ai, c, negative, axis >= 2))
  }

  exclude(xmin: number, xmax: number): void { this.remove(xmin, xmax) }

  excludeWithMargins(xmin: number, xmax: number, axis: number): void {
    this.remove(xmin, xmax)
    this.weighted(axis, xmin - this.marginLength, xmin, 0, 0, this.marginWeight, xmin - this.marginLength, 0, 0, false)
    this.weighted(axis, xmax, xmax + this.marginLength, 0, 0, this.marginWeight, xmax + this.marginLength, 0, 0, false)
  }

  private outcode(exclusion: ZoneExclusion, value: number): number {
    return (value - exclusion.xm >= 0 ? 2 : 0) | (exclusion.x - value > 0 ? 1 : 0)
  }

  private insert(source: ZoneExclusion): void {
    const e = { ...source, x: Math.max(source.x, this.minimum), xm: Math.min(source.xm, this.maximum) }
    if (e.x >= e.xm) return
    const result: ZoneExclusion[] = []
    for (let i = 0; i < this.exclusions.length; i++) {
      const current = this.exclusions[i]!
      const overlapStart = Math.max(current.x, e.x)
      const overlapEnd = Math.min(current.xm, e.xm)
      if (overlapStart >= overlapEnd) { result.push(current); continue }
      if (current.x < overlapStart) result.push({ ...current, xm: overlapStart })
      result.push({
        x: overlapStart, xm: overlapEnd,
        c: current.c + e.c, sm: current.sm + e.sm, smx: current.smx + e.smx, open: false,
      })
      if (overlapEnd < current.xm) result.push({ ...current, x: overlapEnd })
    }
    this.exclusions = result
  }

  private remove(sourceX: number, sourceXm: number): void {
    const x = Math.max(sourceX, this.minimum)
    const xm = Math.min(sourceXm, this.maximum)
    if (x >= xm) return
    const result: ZoneExclusion[] = []
    for (let i = 0; i < this.exclusions.length; i++) {
      const current = this.exclusions[i]!
      if (current.x >= xm || current.xm <= x) { result.push(current); continue }
      if (current.x < x) result.push({ ...current, xm: x })
      if (current.xm > xm) result.push({ ...current, x: xm })
    }
    this.exclusions = result
  }

  closest(origin: number): { position: number, cost: number } {
    let start = 0
    while (start < this.exclusions.length && this.outcode(this.exclusions[start]!, origin) >= 2) start++
    let bestCost = Number.MAX_VALUE
    let bestPosition = 0
    const track = (exclusion: ZoneExclusion): boolean => {
      let position: number
      if (exclusion.sm < 0) {
        position = exclusion.x
        let cost = this.cost(exclusion, position)
        if (exclusion.x < origin && exclusion.xm > origin && this.cost(exclusion, origin) < cost) {
          position = origin
          cost = this.cost(exclusion, origin)
        }
        if (cost > this.cost(exclusion, exclusion.xm)) position = exclusion.xm
      } else {
        const zero = exclusion.smx / exclusion.sm + origin
        position = Math.max(exclusion.x, Math.min(exclusion.xm, zero))
      }
      const local = this.cost(exclusion, position - origin)
      if (exclusion.open && local > bestCost) return true
      if (local < bestCost) { bestCost = local; bestPosition = position }
      return false
    }
    for (let i = start; i < this.exclusions.length; i++) if (track(this.exclusions[i]!)) break
    for (let i = start - 1; i >= 0; i--) if (track(this.exclusions[i]!)) break
    return { position: bestPosition, cost: bestCost === Number.MAX_VALUE ? -1 : bestCost }
  }

  private cost(exclusion: ZoneExclusion, position: number): number {
    return (exclusion.sm * position - 2 * exclusion.smx) * position + exclusion.c
  }
}

function scaleOctaboxByte(value: number, minimum: number, maximum: number): number {
  return Math.fround(minimum + Math.fround(value * Math.fround(maximum - minimum)) / 255)
}

function glyphCollisionBoxes(run: GraphiteRun, slot: GraphiteSlot): GraphiteBox[] {
  const glyph = run.font.getGlyphBoundingBox(slot.gid)
  const attrs = run.font.glat!.getGlyphAttrs(slot.gid)
  const octabox = attrs.octabox
  const left = Math.floor(glyph.xMin)
  const bottom = Math.floor(glyph.yMin)
  const right = Math.ceil(glyph.xMax)
  const top = Math.ceil(glyph.yMax)
  const sumMin = left + bottom
  const sumMax = right + top
  const diffMin = left - top
  const diffMax = right - bottom
  if (octabox === null) {
    return [{
      left, bottom, right, top,
      sumMin, diffMin, sumMax, diffMax,
    }]
  }
  if (octabox.subboxes.length === 0) {
    const box = {
      left, bottom, right, top,
      sumMin: scaleOctaboxByte(octabox.diagNegMin, sumMin, sumMax),
      diffMin: scaleOctaboxByte(octabox.diagPosMin, diffMin, diffMax),
      sumMax: scaleOctaboxByte(octabox.diagNegMax, sumMin, sumMax),
      diffMax: scaleOctaboxByte(octabox.diagPosMax, diffMin, diffMax),
    }
    return [box]
  }
  const boxes: GraphiteBox[] = []
  for (let i = 0; i < octabox.subboxes.length; i++) {
    const subbox = octabox.subboxes[i]!
    boxes.push({
      left: scaleOctaboxByte(subbox.left, left, right),
      bottom: scaleOctaboxByte(subbox.bottom, bottom, top),
      right: scaleOctaboxByte(subbox.right, left, right),
      top: scaleOctaboxByte(subbox.top, bottom, top),
      sumMin: scaleOctaboxByte(subbox.diagNegMin, sumMin, sumMax),
      diffMin: scaleOctaboxByte(subbox.diagPosMin, diffMin, diffMax),
      sumMax: scaleOctaboxByte(subbox.diagNegMax, sumMin, sumMax),
      diffMax: scaleOctaboxByte(subbox.diagPosMax, diffMin, diffMax),
    })
  }
  return boxes
}

function glyphMainCollisionBox(run: GraphiteRun, slot: GraphiteSlot): GraphiteBox {
  const glyph = run.font.getGlyphBoundingBox(slot.gid)
  const left = Math.floor(glyph.xMin)
  const bottom = Math.floor(glyph.yMin)
  const right = Math.ceil(glyph.xMax)
  const top = Math.ceil(glyph.yMax)
  const sumMin = left + bottom
  const sumMax = right + top
  const diffMin = left - top
  const diffMax = right - bottom
  const octabox = run.font.glat!.getGlyphAttrs(slot.gid).octabox
  return {
    left, bottom, right, top,
    sumMin: octabox === null ? sumMin : scaleOctaboxByte(octabox.diagNegMin, sumMin, sumMax),
    diffMin: octabox === null ? diffMin : scaleOctaboxByte(octabox.diagPosMin, diffMin, diffMax),
    sumMax: octabox === null ? sumMax : scaleOctaboxByte(octabox.diagNegMax, sumMin, sumMax),
    diffMax: octabox === null ? diffMax : scaleOctaboxByte(octabox.diagPosMax, diffMin, diffMax),
  }
}

const INVERSE_SQRT_2 = 0.707106781

class GraphiteShiftCollider {
  private readonly ranges = [new CollisionZones(), new CollisionZones(), new CollisionZones(), new CollisionZones()]
  private target!: GraphiteSlot
  private limit!: CollisionRect
  private currentOffset!: CollisionPoint
  private currentShift!: CollisionPoint
  private origin!: CollisionPoint
  private margin = 0
  private marginWeight = 0
  private seqClass = 0
  private seqProxClass = 0
  private seqOrder = 0

  initialize(run: GraphiteRun, slot: GraphiteSlot, origins: Map<GraphiteSlot, CollisionPoint>): void {
    const box = glyphMainCollisionBox(run, slot)
    const offset = { x: slot.attrs[62]!, y: slot.attrs[63]! }
    const shift = { x: slot.collisionShiftX, y: slot.collisionShiftY }
    const rawLimit = { left: slot.attrs[58]!, bottom: slot.attrs[59]!, right: slot.attrs[60]!, top: slot.attrs[61]! }
    this.limit = {
      left: rawLimit.left - offset.x, bottom: rawLimit.bottom - offset.y,
      right: rawLimit.right - offset.x, top: rawLimit.top - offset.y,
    }
    this.ranges[0]!.initialize(rawLimit.left, rawLimit.right, slot.attrs[64]!, slot.attrs[65]!, offset.y + shift.y, false)
    this.ranges[1]!.initialize(rawLimit.bottom, rawLimit.top, slot.attrs[64]!, slot.attrs[65]!, offset.x + shift.x, false)
    let combined = offset.x + offset.y + shift.x + shift.y
    let minimum = -2 * Math.min(shift.x - this.limit.left, shift.y - this.limit.bottom) + combined
    let maximum = 2 * Math.min(this.limit.right - shift.x, this.limit.top - shift.y) + combined
    this.ranges[2]!.initialize(minimum, maximum, slot.attrs[64]! / INVERSE_SQRT_2, slot.attrs[65]!, offset.x - offset.y + shift.x - shift.y, true)
    combined = offset.x - offset.y + shift.x - shift.y
    minimum = -2 * Math.min(shift.x - this.limit.left, this.limit.top - shift.y) + combined
    maximum = 2 * Math.min(this.limit.right - shift.x, shift.y - this.limit.bottom) + combined
    this.ranges[3]!.initialize(minimum, maximum, slot.attrs[64]! / INVERSE_SQRT_2, slot.attrs[65]!, offset.x + offset.y + shift.x + shift.y, true)
    this.target = slot
    this.currentOffset = offset
    this.currentShift = shift
    const positioned = origins.get(slot)!
    this.origin = { x: positioned.x - offset.x, y: positioned.y - offset.y }
    this.margin = slot.attrs[64]!
    this.marginWeight = slot.attrs[65]!
    this.seqClass = slot.attrs[69]!
    this.seqProxClass = slot.attrs[70]!
    this.seqOrder = slot.attrs[71]!
    void box
  }

  merge(run: GraphiteRun, slot: GraphiteSlot, origins: Map<GraphiteSlot, CollisionPoint>, isAfter: boolean, sameCluster: boolean, exclusion = false): boolean {
    const positioned = origins.get(slot)!
    const sx = positioned.x - this.origin.x + slot.collisionShiftX
    const sy = positioned.y - this.origin.y + slot.collisionShiftY
    const sd = sx - sy
    const ss = sx + sy
    const neighbor = glyphMainCollisionBox(run, slot)
    const target = glyphMainCollisionBox(run, this.target)
    let orderFlags = 0
    const sameClass = this.seqProxClass === 0 && slot.attrs[69]! === this.seqClass
    if (sameCluster && this.seqClass !== 0 && (sameClass || (this.seqProxClass !== 0 && slot.attrs[69]! === this.seqProxClass))) orderFlags = this.seqOrder
    if (isAfter) {
      orderFlags ^= sameClass ? 0x3f : 3
      orderFlags ^= (((orderFlags >>> 1) & orderFlags) & 0x15) * 3
    }
    const inRange = orderFlags !== 0
      || sx + neighbor.right + this.margin >= this.limit.left && sx + neighbor.left - this.margin <= this.limit.right
      || sy + neighbor.top + this.margin >= this.limit.bottom && sy + neighbor.bottom - this.margin <= this.limit.top
    let collided = false
    if (inRange) {
      const tx = this.currentOffset.x + this.currentShift.x
      const ty = this.currentOffset.y + this.currentShift.y
      const td = tx - ty
      const ts = tx + ty
      const subboxes = run.font.glat!.getGlyphAttrs(slot.gid).octabox?.subboxes.length ? glyphCollisionBoxes(run, slot) : []
      for (let axis = 0; axis < 4; axis++) {
        let values = this.collisionValues(axis, neighbor, target, sx, sy, sd, ss, tx, ty, td, ts)
        const margin = axis < 2 ? this.margin : this.margin / INVERSE_SQRT_2
        if (orderFlags !== 0) this.applySequenceOrder(axis, orderFlags, slot, neighbor, target, sx, sy, tx, ty)
        if (values.vmax < values.cmin - margin || values.vmin > values.cmax + margin || values.omax < values.otmin - margin || values.omin > values.otmax + margin) continue
        if (subboxes.length > 0) {
          let hit = false
          for (let i = 0; i < subboxes.length; i++) {
            values = this.collisionValues(axis, subboxes[i]!, target, sx, sy, sd, ss, tx, ty, td, ts)
            if (values.vmax < values.cmin - margin || values.vmin > values.cmax + margin || values.omax < values.otmin - margin || values.omin > values.otmax + margin) continue
            this.excludeCollision(axis, values, margin)
            hit = true
          }
          collided ||= hit
        } else {
          this.excludeCollision(axis, values, margin)
          collided = true
        }
      }
    }
    const exclusionGlyph = slot.attrs[66]!
    if (exclusionGlyph > 0 && !exclusion) {
      const fake = createSlot(run, exclusionGlyph, slot.original)
      fake.attrs[57] = 0
      fake.attrs[62] = 0
      fake.attrs[63] = 0
      fake.attrs[69] = 0
      origins.set(fake, { x: positioned.x + slot.attrs[67]!, y: positioned.y + slot.attrs[68]! })
      const exclusionCollision = this.merge(run, fake, origins, isAfter, sameCluster, true)
      collided = collided || exclusionCollision
      origins.delete(fake)
    }
    return collided
  }

  private collisionValues(axis: number, box: GraphiteBox, target: GraphiteBox, sx: number, sy: number, sd: number, ss: number, tx: number, ty: number, td: number, ts: number): { vmin: number, vmax: number, omin: number, omax: number, otmin: number, otmax: number, cmin: number, cmax: number } {
    switch (axis) {
      case 0: return {
        vmin: Math.max(box.left - target.right + sx, box.diffMin - target.diffMax + ty + sd, box.sumMin - target.sumMax - ty + ss),
        vmax: Math.min(box.right - target.left + sx, box.diffMax - target.diffMin + ty + sd, box.sumMax - target.sumMin - ty + ss),
        otmin: target.bottom + ty, otmax: target.top + ty, omin: box.bottom + sy, omax: box.top + sy,
        cmin: this.limit.left + this.currentOffset.x,
        cmax: this.limit.right - target.left + target.right + this.currentOffset.x,
      }
      case 1: return {
        vmin: Math.max(box.bottom - target.top + sy, target.diffMin - box.diffMax + tx - sd, box.sumMin - target.sumMax - tx + ss),
        vmax: Math.min(box.top - target.bottom + sy, target.diffMax - box.diffMin + tx - sd, box.sumMax - target.sumMin - tx + ss),
        otmin: target.left + tx, otmax: target.right + tx, omin: box.left + sx, omax: box.right + sx,
        cmin: this.limit.bottom + this.currentOffset.y,
        cmax: this.limit.top - target.bottom + target.top + this.currentOffset.y,
      }
      case 2: return {
        vmin: Math.max(box.sumMin - target.sumMax + ss, 2 * (box.bottom - target.top + sy) + td, 2 * (box.left - target.right + sx) - td),
        vmax: Math.min(box.sumMax - target.sumMin + ss, 2 * (box.top - target.bottom + sy) + td, 2 * (box.right - target.left + sx) - td),
        otmin: target.diffMin + td, otmax: target.diffMax + td, omin: box.diffMin + sd, omax: box.diffMax + sd,
        cmin: this.limit.left + this.limit.bottom + this.currentOffset.x + this.currentOffset.y,
        cmax: this.limit.right + this.limit.top - target.sumMin + target.sumMax + this.currentOffset.x + this.currentOffset.y,
      }
      default: return {
        vmin: Math.max(box.diffMin - target.diffMax + sd, 2 * (box.left - target.right + sx) - ts, -2 * (box.top - target.bottom + sy) + ts),
        vmax: Math.min(box.diffMax - target.diffMin + sd, 2 * (box.right - target.left + sx) - ts, -2 * (box.bottom - target.top + sy) + ts),
        otmin: target.sumMin + ts, otmax: target.sumMax + ts, omin: box.sumMin + ss, omax: box.sumMax + ss,
        cmin: this.limit.left - this.limit.top + this.currentOffset.x - this.currentOffset.y,
        cmax: this.limit.right - this.limit.bottom - target.diffMin + target.diffMax + this.currentOffset.x - this.currentOffset.y,
      }
    }
  }

  private excludeCollision(axis: number, values: { vmin: number, vmax: number, omin: number, omax: number, otmin: number, otmax: number }, margin: number): void {
    if (values.omin > values.otmax) {
      this.ranges[axis]!.weighted(axis, values.vmin - margin, values.vmax + margin, 0, 0, 0, 0, 0, (margin - values.omin + values.otmax) ** 2 * this.marginWeight, false)
    } else if (values.omax < values.otmin) {
      this.ranges[axis]!.weighted(axis, values.vmin - margin, values.vmax + margin, 0, 0, 0, 0, 0, (margin - values.otmin + values.omax) ** 2 * this.marginWeight, false)
    } else this.ranges[axis]!.excludeWithMargins(values.vmin, values.vmax, axis)
  }

  private applySequenceOrder(axis: number, flags: number, slot: GraphiteSlot, box: GraphiteBox, target: GraphiteBox, sx: number, sy: number, tx: number, ty: number): void {
    const xmin = this.limit.left + this.currentOffset.x + target.left
    const xmax = this.limit.right + this.currentOffset.x + target.right
    const ymin = this.limit.bottom + this.currentOffset.y + target.bottom
    const ymax = this.limit.top + this.currentOffset.y + target.top
    const origin = { x: tx, y: ty }
    const aboveWeight = slot.attrs[73]!
    const belowWeight = slot.attrs[75]!
    const alignWeight = slot.attrs[77]!
    const middleY = (box.bottom + box.top) / 2 + sy
    if (flags === 2) {
      const upperX = slot.attrs[72]! + (box.left + box.right) / 2 + sx
      const lowerX = slot.attrs[74]! + box.right + sx + (target.right - target.left) / 2
      this.addSlope(axis, true, { left: xmin, bottom: middleY, right: upperX, top: ymax }, target, origin, 0, aboveWeight, true)
      this.removeSlope(axis, { left: xmin, bottom: ymin, right: lowerX, top: middleY }, target, origin)
      this.addSlope(axis, true, { left: lowerX, bottom: ymin, right: xmax, top: middleY - slot.attrs[76]! }, target, origin, belowWeight, 0, true)
      this.addSlope(axis, false, { left: sx + box.left, bottom: middleY, right: xmax, top: middleY + slot.attrs[76]! }, target, origin, 0, alignWeight, true)
      this.addSlope(axis, false, { left: sx + box.left, bottom: middleY - slot.attrs[76]!, right: xmax, top: middleY }, target, origin, belowWeight, alignWeight, false)
    } else if (flags === 1) {
      const upperX = (box.left + box.right) / 2 + slot.attrs[72]! + sx
      const lowerX = box.left - slot.attrs[74]! + sx - (target.right - target.left) / 2
      this.addSlope(axis, true, { left: upperX, bottom: ymin, right: xmax, top: middleY }, target, origin, 0, aboveWeight, false)
      this.removeSlope(axis, { left: lowerX, bottom: middleY, right: xmax, top: ymax }, target, origin)
      this.addSlope(axis, true, { left: xmin, bottom: middleY - slot.attrs[76]!, right: lowerX, top: ymax }, target, origin, belowWeight, 0, false)
      this.addSlope(axis, false, { left: xmin, bottom: middleY, right: sx + box.right, top: middleY + slot.attrs[76]! }, target, origin, 0, alignWeight, true)
      this.addSlope(axis, false, { left: xmin, bottom: middleY - slot.attrs[76]!, right: sx + box.right, top: middleY }, target, origin, belowWeight, alignWeight, false)
    } else if (flags === 4) this.removeSlope(axis, { left: box.left - target.right + sx, bottom: sy + box.top, right: box.right - target.left + sx, top: ymax }, target, origin)
    else if (flags === 8) this.removeSlope(axis, { left: box.left - target.right + sx, bottom: ymin, right: box.right - target.left + sx, top: sy + box.bottom }, target, origin)
    else if (flags === 16) this.removeSlope(axis, { left: xmin, bottom: box.bottom - target.top + sy, right: box.left - target.right + sx, top: box.top - target.bottom + sy }, target, origin)
    else if (flags === 32) this.removeSlope(axis, { left: box.right - target.left + sx, bottom: box.bottom - target.top + sy, right: xmax, top: box.top - target.bottom + sy }, target, origin)
  }

  private addSlope(axis: number, isX: boolean, rect: CollisionRect, box: GraphiteBox, origin: CollisionPoint, weight: number, m: number, minimumRight: boolean): void {
    let anchor: number
    let center: number
    if (axis === 0 && rect.bottom < origin.y + box.top && rect.top > origin.y + box.bottom && rect.right > rect.left) {
      anchor = origin.y + (box.bottom + box.top) / 2; center = (box.left + box.right) / 2
      if (isX) this.ranges[axis]!.weighted(axis, rect.left - center, rect.right - center, weight, anchor, m, (minimumRight ? rect.right : rect.left) - center, anchor, 0, false)
      else this.ranges[axis]!.weighted(axis, rect.left - center, rect.right - center, weight, anchor, 0, 0, origin.y, m * (anchor * anchor + ((minimumRight ? rect.top : rect.bottom) - (box.bottom + box.top) / 2) ** 2), false)
    } else if (axis === 1 && rect.left < origin.x + box.right && rect.right > origin.x + box.left && rect.top > rect.bottom) {
      anchor = origin.x + (box.left + box.right) / 2; center = (box.bottom + box.top) / 2
      if (isX) this.ranges[axis]!.weighted(axis, rect.bottom - center, rect.top - center, weight, anchor, 0, 0, origin.x, m * (anchor * anchor + ((minimumRight ? rect.right : rect.left) - (box.left + box.right) / 2) ** 2), false)
      else this.ranges[axis]!.weighted(axis, rect.bottom - center, rect.top - center, weight, anchor, m, (minimumRight ? rect.top : rect.bottom) - center, anchor, 0, false)
    } else if (axis === 2 && rect.left - rect.top < origin.x - origin.y + box.diffMax && rect.right - rect.bottom > origin.x - origin.y + box.diffMin) {
      const diagonal = origin.x - origin.y + (box.diffMin + box.diffMax) / 2
      center = (box.sumMin + box.sumMax) / 2
      const maximum = Math.min(2 * rect.right - diagonal, 2 * rect.top + diagonal)
      const minimum = Math.max(2 * rect.left - diagonal, 2 * rect.bottom + diagonal)
      if (minimum > maximum) return
      const xi = isX ? 2 * (minimumRight ? rect.right : rect.left) - diagonal : 2 * (minimumRight ? rect.top : rect.bottom) + diagonal
      this.ranges[axis]!.weighted(axis, minimum - center, maximum - center, weight / 2, diagonal, m / 2, xi, 0, 0, isX)
    } else if (axis === 3 && rect.left + rect.bottom < origin.x + origin.y + box.sumMax && rect.right + rect.top > origin.x + origin.y + box.sumMin) {
      const sum = origin.x + origin.y + (box.sumMin + box.sumMax) / 2
      center = (box.diffMin + box.diffMax) / 2
      const maximum = Math.min(2 * rect.right - sum, sum - 2 * rect.bottom)
      const minimum = Math.max(2 * rect.left - sum, sum - 2 * rect.top)
      if (minimum > maximum) return
      const xi = isX ? 2 * (minimumRight ? rect.right : rect.left) - sum : 2 * (minimumRight ? rect.top : rect.bottom) + sum
      this.ranges[axis]!.weighted(axis, minimum - center, maximum - center, weight / 2, sum, m / 2, xi, 0, 0, !isX)
    }
  }

  private removeSlope(axis: number, rect: CollisionRect, box: GraphiteBox, origin: CollisionPoint): void {
    if (axis === 0 && rect.bottom < origin.y + box.top && rect.top > origin.y + box.bottom && rect.right > rect.left) {
      const center = (box.left + box.right) / 2
      this.ranges[axis]!.exclude(rect.left - center, rect.right - center)
    } else if (axis === 1 && rect.left < origin.x + box.right && rect.right > origin.x + box.left && rect.top > rect.bottom) {
      const center = (box.bottom + box.top) / 2
      this.ranges[axis]!.exclude(rect.bottom - center, rect.top - center)
    } else if (axis === 2 && rect.left - rect.top < origin.x - origin.y + box.diffMax && rect.right - rect.bottom > origin.x - origin.y + box.diffMin && rect.right > rect.left && rect.top > rect.bottom) {
      const minimum = slantDistance(box.diffMax + origin.x - origin.y, box.diffMin + origin.x - origin.y, rect.left, rect.bottom, Math.min)
      const maximum = slantDistance(box.diffMin + origin.x - origin.y, box.diffMax + origin.x - origin.y, rect.right, rect.top, Math.max)
      this.ranges[axis]!.exclude(minimum - (box.sumMin + box.sumMax) / 2, maximum - (box.sumMin + box.sumMax) / 2)
    } else if (axis === 3 && rect.left + rect.bottom < origin.x + origin.y + box.sumMax && rect.right + rect.top > origin.x + origin.y + box.sumMin && rect.right > rect.left && rect.top > rect.bottom) {
      const minimum = slantDistance(box.sumMax + origin.x + origin.y, box.sumMin + origin.x + origin.y, rect.left, -rect.top, Math.min)
      const maximum = slantDistance(box.sumMin + origin.x + origin.y, box.sumMax + origin.x + origin.y, rect.right, -rect.bottom, Math.max)
      this.ranges[axis]!.exclude(minimum - (box.diffMin + box.diffMax) / 2, maximum - (box.diffMin + box.diffMax) / 2)
    }
  }

  resolve(): { shift: CollisionPoint, collides: boolean } {
    let totalCost = Number.MAX_VALUE / 2
    let result = { x: 0, y: 0 }
    let collides = true
    for (let axis = 0; axis < 4; axis++) {
      const base = axis === 0 ? this.currentOffset.x : axis === 1 ? this.currentOffset.y : axis === 2 ? this.currentOffset.x + this.currentOffset.y : this.currentOffset.x - this.currentOffset.y
      const closest = this.ranges[axis]!.closest(0)
      const position = closest.position - base
      if (closest.cost < 0) continue
      collides = false
      let candidate: CollisionPoint
      if (axis === 0) candidate = { x: position, y: this.currentShift.y }
      else if (axis === 1) candidate = { x: this.currentShift.x, y: position }
      else if (axis === 2) candidate = { x: (this.currentShift.x - this.currentShift.y + position) / 2, y: (this.currentShift.y - this.currentShift.x + position) / 2 }
      else candidate = { x: (this.currentShift.x + this.currentShift.y + position) / 2, y: (this.currentShift.x + this.currentShift.y - position) / 2 }
      if (closest.cost < totalCost - 0.01) { totalCost = closest.cost; result = candidate }
    }
    return { shift: result, collides }
  }
}

function slantDistance(minimum: number, maximum: number, x: number, y: number, compare: (left: number, right: number) => number): number {
  let result = 2 * x - minimum
  if (compare(result, minimum + 2 * y) === result) {
    result = maximum + 2 * y
    if (compare(result, 2 * x - maximum) === result) result = x + y
  }
  return result
}

function localMaximum(aLower: number, aUpper: number, bLower: number, bUpper: number, value: number): number {
  if (aLower < bLower) {
    if (aUpper < bUpper) return aUpper < value ? aUpper : value
  } else if (aUpper > bUpper) return bLower < value ? bLower : value
  return value
}

function localMinimum(aLower: number, aUpper: number, bLower: number, bUpper: number, value: number): number {
  if (bLower > aLower) {
    if (bUpper > aUpper) return bLower > value ? bLower : value
  } else if (aUpper > bUpper) return aLower > value ? aLower : value
  return value
}

function collisionEdge(
  run: GraphiteRun, slot: GraphiteSlot, originX: number, originY: number,
  y: number, width: number, margin: number, rightEdge: boolean,
): number {
  const boxes = glyphCollisionBoxes(run, slot)
  let result = rightEdge ? -1e38 : 1e38
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!
    if (originY + box.bottom - margin > y + width / 2 || originY + box.top + margin < y - width / 2) continue
    const difference = originX - originY + y
    const sum = originX + originY - y
    if (rightEdge) {
      let x = originX + box.right + margin
      x = localMaximum(
        difference + box.diffMax + margin - width / 2, difference + box.diffMax + margin + width / 2,
        sum + box.sumMax + margin - width / 2, sum + box.sumMax + margin + width / 2, x,
      )
      if (x > result) result = x
    } else {
      let x = originX + box.left - margin
      x = localMinimum(
        difference + box.diffMin - margin - width / 2, difference + box.diffMin - margin + width / 2,
        sum + box.sumMin - margin - width / 2, sum + box.sumMin - margin + width / 2, x,
      )
      if (x < result) result = x
    }
  }
  return result
}

function collisionOrigins(run: GraphiteRun): Map<GraphiteSlot, { x: number, y: number }> {
  const origins = new Map<GraphiteSlot, { x: number, y: number }>()
  let x = 0
  if (run.currentDirection !== 0) {
    for (let i = run.slots.length - 1; i >= 0; i--) {
      const slot = run.slots[i]!
      origins.set(slot, { x, y: slot.shiftY })
      x += slot.parent === null ? slot.advanceX : 0
    }
  } else {
    for (let i = 0; i < run.slots.length; i++) {
      const slot = run.slots[i]!
      origins.set(slot, { x, y: slot.shiftY })
      x += slot.parent === null ? slot.advanceX : 0
    }
  }
  return origins
}

function isChildOf(slot: GraphiteSlot, ancestor: GraphiteSlot): boolean {
  let parent = slot.parent
  while (parent !== null) {
    if (parent === ancestor) return true
    parent = parent.parent
  }
  return false
}

function inKernCluster(slot: GraphiteSlot): boolean {
  let current: GraphiteSlot | null = slot
  while (current !== null) {
    if ((current.attrs[57]! & 16) !== 0) return true
    current = current.parent
  }
  return false
}

function repositionCollisionChildren(
  run: GraphiteRun, parent: GraphiteSlot, parentOrigin: CollisionPoint,
  origins: Map<GraphiteSlot, CollisionPoint>, depth: number,
): void {
  if (depth > 100) throw new Error('Graphite attachment tree exceeds the maximum depth')
  for (let i = 0; i < run.slots.length; i++) {
    const child = run.slots[i]!
    if (child.parent !== parent) continue
    const x = Math.fround(Math.fround(parentOrigin.x + (run.currentDirection !== 0 ? -child.shiftX : child.shiftX))
      + Math.fround(child.attachX - child.withX))
    const y = Math.fround(Math.fround(parentOrigin.y + child.shiftY) + Math.fround(child.attachY - child.withY))
    const origin = { x, y }
    origins.set(child, origin)
    repositionCollisionChildren(run, child, origin, origins, depth + 1)
  }
}

function resolveCollisionShift(
  run: GraphiteRun, target: GraphiteSlot, startIndex: number, reverse: boolean, threshold: number,
  origins: Map<GraphiteSlot, CollisionPoint>,
): { moved: boolean, collided: boolean } {
  const collider = new GraphiteShiftCollider()
  collider.initialize(run, target, origins)
  let base = target
  while (base.parent !== null) base = base.parent
  let collisions = false
  let ignoreForKern = !reverse
  const targetIndex = run.slots.indexOf(target)
  for (let index = startIndex; index >= 0 && index < run.slots.length; index += reverse ? -1 : 1) {
    const neighbor = run.slots[index]!
    const flags = neighbor.attrs[57]!
    const sameCluster = isChildOf(neighbor, base)
    if (neighbor !== target
      && (flags & 2) === 0
      && (neighbor === base || sameCluster || !inKernCluster(neighbor))
      && (!reverse || (flags & 1) === 0 || ((flags & 16) !== 0 && !sameCluster) || (flags & 32) !== 0)) {
      const neighborCollision = collider.merge(run, neighbor, origins, !ignoreForKern, sameCluster)
      collisions = collisions || neighborCollision
    } else if (neighbor === target) ignoreForKern = !ignoreForKern
    if (index !== startIndex && (flags & (reverse ? 4 : 8)) !== 0) break
  }
  let stillColliding = false
  let moved = false
  if (collisions || target.collisionShiftX !== 0 || target.collisionShiftY !== 0) {
    const resolved = collider.resolve()
    stillColliding = resolved.collides
    if (Math.abs(resolved.shift.x) < 1e38 && Math.abs(resolved.shift.y) < 1e38) {
      const dx = resolved.shift.x - target.collisionShiftX
      const dy = resolved.shift.y - target.collisionShiftY
      moved = dx * dx + dy * dy >= threshold * threshold
      target.collisionShiftX = Math.fround(resolved.shift.x)
      target.collisionShiftY = Math.fround(resolved.shift.y)
      const targetOrigin = origins.get(target)!
      repositionCollisionChildren(run, target, {
        x: Math.fround(targetOrigin.x + target.collisionShiftX),
        y: Math.fround(targetOrigin.y + target.collisionShiftY),
      }, origins, 0)
    }
  }
  target.attrs[57] = stillColliding
    ? target.attrs[57]! | 32 | 64
    : (target.attrs[57]! & ~32) | 64
  return { moved, collided: stillColliding }
}

function runCollisionShifting(
  run: GraphiteRun, loops: number, threshold: number,
  origins: Map<GraphiteSlot, CollisionPoint>,
): void {
  let startIndex = 0
  while (startIndex < run.slots.length) {
    let endIndex = run.slots.length
    let moved = false
    let hasCollisions = false
    for (let index = startIndex; index < run.slots.length; index++) {
      const slot = run.slots[index]!
      if ((slot.attrs[57]! & 17) === 1) {
        const result = resolveCollisionShift(run, slot, startIndex, false, threshold, origins)
        moved = moved || result.moved
        hasCollisions = hasCollisions || result.collided
      }
      if (index !== startIndex && (slot.attrs[57]! & 8) !== 0) { endIndex = index + 1; break }
    }
    for (let loop = 0; loop < loops - 1 && (hasCollisions || moved); loop++) {
      if (hasCollisions) {
        hasCollisions = false
        const reverseStart = endIndex - 1
        for (let index = reverseStart; index >= startIndex; index--) {
          const slot = run.slots[index]!
          if ((slot.attrs[57]! & (1 | 16 | 32)) === (1 | 32)) {
            const result = resolveCollisionShift(run, slot, reverseStart, true, threshold, origins)
            moved = moved || result.moved
            hasCollisions = hasCollisions || result.collided
            slot.attrs[57] = slot.attrs[57]! | 256
          }
        }
      }
      if (moved) {
        moved = false
        for (let index = startIndex; index < endIndex; index++) {
          const slot = run.slots[index]!
          if ((slot.attrs[57]! & (1 | 16 | 256)) === 1) {
            const result = resolveCollisionShift(run, slot, startIndex, false, threshold, origins)
            moved = moved || result.moved
            hasCollisions = hasCollisions || result.collided
          } else if ((slot.attrs[57]! & 256) !== 0) slot.attrs[57] = slot.attrs[57]! & ~256
        }
      }
    }
    if (endIndex >= run.slots.length) break
    startIndex = -1
    for (let index = endIndex - 1; index < run.slots.length; index++) {
      if ((run.slots[index]!.attrs[57]! & 4) !== 0) { startIndex = index; break }
    }
    if (startIndex < 0) break
  }
}

function finishCollisions(run: GraphiteRun): void {
  for (let i = 0; i < run.slots.length; i++) {
    const slot = run.slots[i]!
    if (slot.collisionShiftX === 0 && slot.collisionShiftY === 0) continue
    slot.attrs[62] = slot.attrs[62]! + slot.collisionShiftX
    slot.attrs[63] = slot.attrs[63]! + slot.collisionShiftY
    slot.collisionShiftX = 0
    slot.collisionShiftY = 0
  }
}

function resolveCollisionKern(
  run: GraphiteRun, slotIndex: number, origins: Map<GraphiteSlot, { x: number, y: number }>,
  minimumY: number, maximumY: number, mode: number,
): number {
  const slot = run.slots[slotIndex]!
  let base = slot
  while (base.parent !== null) base = base.parent
  if (base !== slot) {
    base.attrs[57] = base.attrs[57]! | 17
    return 0
  }
  for (let targetIndex = slotIndex + 1; targetIndex < run.slots.length; targetIndex++) {
    const target = run.slots[targetIndex]!
    if (!isChildOf(target, slot)) break
    const targetOrigin = origins.get(target)!
    const glyph = run.font.getGlyphBoundingBox(target.gid)
    minimumY = Math.min(minimumY, targetOrigin.y + target.collisionShiftY + glyph.yMin)
    maximumY = Math.max(maximumY, targetOrigin.y + target.collisionShiftY + glyph.yMax)
  }
  const margin = Math.max(10, slot.attrs[64]!)
  const sliceWidth = margin / 1.5
  const minY = minimumY - margin
  const maxY = maximumY + margin
  const count = Math.trunc((maxY - minY + 2) / (sliceWidth / 1.5) + 1)
  const rtl = run.currentDirection !== 0
  const edges = new Float64Array(count)
  edges.fill(rtl ? 1e38 : -1e38)
  let xBound = rtl ? 1e38 : -1e38
  for (let targetCursor = -1; targetCursor < run.slots.length; targetCursor++) {
    const targetIndex = targetCursor < 0 ? slotIndex : targetCursor
    if (targetCursor >= 0 && targetIndex === slotIndex) continue
    const target = run.slots[targetIndex]!
    if (target !== slot && !isChildOf(target, slot)) continue
    const targetOrigin = origins.get(target)!
    const shiftedX = targetOrigin.x + target.collisionShiftX
    const shiftedY = targetOrigin.y + target.collisionShiftY
    const glyph = run.font.getGlyphBoundingBox(target.gid)
    const preliminaryEdge = shiftedX + (rtl ? glyph.xMin : glyph.xMax)
    const firstSlice = Math.max(0, Math.trunc((Math.floor(glyph.yMin) + shiftedY - minY + 1) / sliceWidth))
    const lastSlice = Math.min(count - 1, Math.trunc((Math.ceil(glyph.yMax) + shiftedY - minY + 1) / sliceWidth + 1))
    for (let i = firstSlice; i <= lastSlice; i++) {
      if (rtl ? preliminaryEdge >= edges[i]! : preliminaryEdge <= edges[i]!) continue
      const y = minY - 1 + (i + 0.5) * sliceWidth
      const edge = collisionEdge(run, target, shiftedX, shiftedY, y, sliceWidth, margin, !rtl)
      if (rtl ? edge < edges[i]! : edge > edges[i]!) {
        edges[i] = edge
        xBound = rtl ? Math.min(xBound, edge) : Math.max(xBound, edge)
      }
    }
  }
  let minimumGap = 1e37
  let hit = false
  let collisionCandidate = false
  let currentSpace = 0
  let spaceCount = 0
  let seenEnd = (slot.attrs[57]! & 8) !== 0
  for (let neighborIndex = slotIndex + 1; neighborIndex < run.slots.length; neighborIndex++) {
    const neighbor = run.slots[neighborIndex]!
    let ancestor = neighbor.parent
    let sameCluster = false
    while (ancestor !== null) {
      if (ancestor === slot) { sameCluster = true; break }
      ancestor = ancestor.parent
    }
    if (sameCluster) {
      const neighborOrigin = origins.get(neighbor)!
      const glyph = run.font.getGlyphBoundingBox(neighbor.gid)
      minimumY = Math.min(minimumY, neighborOrigin.y + neighbor.collisionShiftY + Math.floor(glyph.yMin))
      maximumY = Math.max(maximumY, neighborOrigin.y + neighbor.collisionShiftY + Math.ceil(glyph.yMax))
      continue
    }
    const flags = neighbor.attrs[57]!
    const glyph = run.font.getGlyphBoundingBox(neighbor.gid)
    if ((glyph.yMin === 0 && glyph.yMax === 0) || (flags & 128) !== 0) {
      if (mode === 2) break
      currentSpace += neighbor.advanceX
      spaceCount++
    } else {
      spaceCount = 0
      if ((flags & 2) === 0) {
        seenEnd = true
        const neighborOrigin = origins.get(neighbor)!
        const neighborX = neighborOrigin.x + neighbor.collisionShiftX
        const neighborY = neighborOrigin.y + neighbor.collisionShiftY
        const direction = rtl ? 1 : -1
        const nearX = (neighborX + (rtl ? Math.ceil(glyph.xMax) : Math.floor(glyph.xMin))) * direction
        if (!hit || nearX >= direction * (xBound - minimumGap - currentSpace)) {
          const first = Math.max(0, Math.max(1, Math.trunc((Math.floor(glyph.yMin) + (1 - minY + neighborY)) / sliceWidth + 1)) - 1)
          const last = Math.min(count - 1, Math.min(count - 2, Math.trunc((Math.ceil(glyph.yMax) + (1 - minY + neighborY)) / sliceWidth + 1)) + 1)
          let collided = false
          let noOverlap = true
          for (let i = first; i <= last; i++) {
            const here = edges[i]! * direction
            if (here > 9e37) continue
              if (!hit || nearX > here - minimumGap - currentSpace) {
                const y = minY - 1 + (i + 0.5) * sliceWidth
              const neighborEdge = collisionEdge(run, neighbor, neighborX, neighborY, y, sliceWidth, 0, rtl) * direction + 2 * currentSpace
              if (neighborEdge < -8e37) continue
              noOverlap = false
              const gap = here - neighborEdge
              if (gap < minimumGap || (!hit && !collided)) {
                minimumGap = gap
                collided = true
              }
            } else noOverlap = false
          }
          if (noOverlap) minimumGap = Math.max(minimumGap, xBound - direction * (currentSpace + margin + nearX))
          collisionCandidate ||= collided || noOverlap
          if (collided && !noOverlap) hit = true
        }
      }
    }
    if ((flags & 8) !== 0) {
      if (seenEnd && spaceCount < 2) break
      seenEnd = true
    }
  }
  if (!collisionCandidate) return 0
  const needed = (rtl ? -1 : 1) * minimumGap
  const movement = Math.min(slot.attrs[60]! - slot.attrs[62]!, Math.max(needed, slot.attrs[58]! - slot.attrs[62]!))
  return movement
}

function runCollisionKerning(
  run: GraphiteRun, mode: number, origins: Map<GraphiteSlot, CollisionPoint>,
): void {
  let minimumY = 1e38
  let maximumY = -1e38
  let active = true
  for (let i = 0; i < run.slots.length; i++) {
    const slot = run.slots[i]!
    const origin = origins.get(slot)!
    const glyph = run.font.getGlyphBoundingBox(slot.gid)
    if ((slot.attrs[57]! & 128) === 0) {
      minimumY = Math.min(minimumY, origin.y + slot.collisionShiftY + Math.floor(glyph.yMin))
      maximumY = Math.max(maximumY, origin.y + slot.collisionShiftY + Math.ceil(glyph.yMax))
    }
    if (active && (slot.attrs[57]! & 17) === 17) {
      const movement = resolveCollisionKern(run, i, origins, minimumY, maximumY, mode)
      if (movement !== 0) {
        slot.advanceX = Math.fround(slot.advanceX + movement - slot.collisionShiftX)
        slot.collisionShiftX = Math.fround(movement)
      }
    }
    if ((slot.attrs[57]! & 8) !== 0) active = false
    if ((slot.attrs[57]! & 4) !== 0) active = true
  }
}

function initializeCollisionAttributes(run: GraphiteRun): void {
  const first = run.subtable.attCollisions
  for (let slotIndex = 0; slotIndex < run.slots.length; slotIndex++) {
    const slot = run.slots[slotIndex]!
    slot.attrs[57] = getGlyphAttr(run, slot, first)
    for (let i = 1; i <= 4; i++) slot.attrs[57 + i] = signed16(getGlyphAttr(run, slot, first + i) & 0xffff)
    slot.attrs[64] = getGlyphAttr(run, slot, first + 5)
    slot.attrs[65] = getGlyphAttr(run, slot, first + 6)
    for (let i = 0; i < 9; i++) slot.attrs[69 + i] = getGlyphAttr(run, slot, first + 7 + i)
  }
}

function createSlot(run: GraphiteRun, glyphId: number, original: number): GraphiteSlot {
  const slot: GraphiteSlot = {
    gid: glyphId, realGid: glyphId, substituted: false, original, before: original, after: original,
    advanceX: 0, advanceY: 0, shiftX: 0, shiftY: 0, collisionShiftX: 0, collisionShiftY: 0,
    attachX: 0, attachY: 0, withX: 0, withY: 0, attachLevel: 0,
    parent: null, insertBefore: true, bidiLevel: run.rightToLeft ? 1 : 0,
    justification: 0, justificationParams: null,
    userAttrs: new Int16Array(run.subtable.numUserDefn), attrs: new Float32Array(80),
  }
  setSlotGlyph(run, slot, glyphId)
  slot.substituted = false
  return slot
}

function buildFeatureValues(feat: GraphiteFeatTable, sill: SillTable | null, language: string | null, requested: ReadonlyMap<number, number> | undefined): Int16Array {
  const values = new Int16Array(feat.features.length)
  for (let i = 0; i < feat.features.length; i++) values[i] = feat.features[i]!.settings[0]?.value ?? 0
  if (language !== null && sill !== null) {
    const languageSettings = sill.getFeatures(language) ?? sill.getFeatures(language.slice(0, 4))
    if (languageSettings !== null) {
      for (let i = 0; i < languageSettings.length; i++) {
        const index = feat.features.findIndex(function (feature) { return feature.id === languageSettings[i]!.featureId })
        if (index >= 0) values[index] = languageSettings[i]!.value
      }
    }
  }
  if (requested !== undefined) {
    for (const [featureId, value] of requested) {
      const index = feat.features.findIndex(function (feature) { return feature.id === featureId })
      if (index >= 0) values[index] = value
    }
  }
  return values
}

interface PositionedGraphiteRun {
  positions: Map<GraphiteSlot, { x: number, y: number }>
  totalAdvance: number
}

function positionGraphiteSlots(
  run: GraphiteRun, isFinal = true, startIndex = 0, endIndex = run.slots.length - 1,
): PositionedGraphiteRun {
  const positions = run.positions
  const children = new Map<GraphiteSlot, GraphiteSlot[]>()
  for (let i = 0; i < run.slots.length; i++) {
    const slot = run.slots[i]!
    if (slot.parent === null) continue
    let list = children.get(slot.parent)
    if (list === undefined) { list = []; children.set(slot.parent, list) }
    list.push(slot)
  }
  const roots = run.slots.slice(startIndex, endIndex + 1).filter(function (slot) { return slot.parent === null })
  if (run.currentDirection !== 0) roots.reverse()
  let base = 0

  function positionSlot(slot: GraphiteSlot, parentX: number, parentY: number, cluster: GraphiteSlot[], depth: number): number {
    if (depth > 100) throw new Error('Graphite attachment tree exceeds the maximum depth')
    const applyCollisionOffset = isFinal && (run.currentDirection !== 0 || (slot.attrs[57]! & 16) === 0)
    const collisionOffsetX = applyCollisionOffset ? slot.attrs[62]! : 0
    const collisionOffsetY = applyCollisionOffset ? slot.attrs[63]! : 0
    const shiftX = Math.fround(
      (run.currentDirection !== 0 ? -slot.shiftX : slot.shiftX) + slot.justification + collisionOffsetX,
    )
    const shiftY = Math.fround(slot.shiftY + collisionOffsetY)
    let x = Math.fround(parentX + shiftX)
    let y = Math.fround(parentY + shiftY)
    let extent: number
    if (slot.parent === null) {
      extent = Math.fround(parentX + Math.fround(slot.advanceX + slot.justification))
    } else {
      x = Math.fround(x + Math.fround(slot.attachX - slot.withX))
      y = Math.fround(y + Math.fround(slot.attachY - slot.withY))
      const advance = Math.fround(slot.advanceX + slot.justification)
      extent = slot.advanceX >= 0.5 ? Math.fround(Math.fround(x + advance) - shiftX) : 0
    }
    positions.set(slot, { x, y })
    cluster.push(slot)
    const attached = children.get(slot)
    if (attached !== undefined) {
      for (let i = 0; i < attached.length; i++) {
        const childExtent = positionSlot(attached[i]!, x, y, cluster, depth + 1)
        if (slot.parent === null || slot.advanceX >= 0.5) extent = Math.max(extent, childExtent)
      }
    }
    return extent
  }

  for (let i = 0; i < roots.length; i++) {
    const cluster: GraphiteSlot[] = []
    let extent = positionSlot(roots[i]!, base, 0, cluster, 0)
    const rootPosition = positions.get(roots[i]!)!
    let minimum = rootPosition.x
    for (let j = 0; j < cluster.length; j++) {
      const member = cluster[j]!
      const memberPosition = positions.get(member)!
      if (member === roots[i] || member.advanceX >= 0.5 || memberPosition.x < 0) {
        minimum = Math.min(minimum, memberPosition.x)
      }
    }
    if (minimum < base) {
      const adjustment = Math.fround(rootPosition.x - minimum)
      for (let j = 0; j < cluster.length; j++) {
        const position = positions.get(cluster[j]!)!
        position.x = Math.fround(position.x + adjustment)
      }
      extent = Math.fround(extent + adjustment)
    }
    base = extent
  }
  return { positions, totalAdvance: base }
}

interface GraphiteOutputCluster {
  baseChar: number
  numChars: number
  baseGlyph: number
  numGlyphs: number
  advance: number
}

interface ClusteredGraphiteSlot {
  slot: GraphiteSlot
  cluster: number
  advance: number
  componentCount: number
  sourceCount: number
}

function clusterGraphiteSlots(run: GraphiteRun, positioned: PositionedGraphiteRun, backward: boolean): ClusteredGraphiteSlot[] {
  if (run.slots.length === 0) return []
  const firstAdvance = backward ? Math.trunc(positioned.positions.get(run.slots[0]!)!.x) : 0
  const clusters: GraphiteOutputCluster[] = [{
    baseChar: 0, numChars: 0, baseGlyph: 0, numGlyphs: 0,
    advance: backward ? Math.trunc(positioned.totalAdvance - firstAdvance) : 0,
  }]
  let clusterIndex = 0
  let currentAdvance = firstAdvance
  for (let slotIndex = 0; slotIndex < run.slots.length; slotIndex++) {
    const slot = run.slots[slotIndex]!
    while (clusters[clusterIndex]!.baseChar > slot.before && clusterIndex > 0) {
      const source = clusters[clusterIndex]!
      const target = clusters[clusterIndex - 1]!
      target.numChars += source.numChars
      target.numGlyphs += source.numGlyphs
      target.advance = Math.trunc(target.advance + source.advance)
      clusters.pop()
      clusterIndex--
    }
    const current = clusters[clusterIndex]!
    if (slot.insertBefore && current.numChars !== 0 && slot.before >= current.baseChar + current.numChars) {
      const origin = positioned.positions.get(slot)!.x
      const next: GraphiteOutputCluster = {
        baseChar: current.baseChar + current.numChars,
        numChars: slot.before - (current.baseChar + current.numChars),
        baseGlyph: slotIndex,
        numGlyphs: 0,
        advance: 0,
      }
      if (backward) {
        next.advance = Math.trunc(currentAdvance - origin)
        currentAdvance -= next.advance
      } else {
        current.advance = Math.trunc(current.advance + origin - currentAdvance)
        currentAdvance = Math.trunc(origin)
      }
      clusters.push(next)
      clusterIndex++
    }
    const active = clusters[clusterIndex]!
    active.numGlyphs++
    if (active.baseChar + active.numChars < slot.after + 1) active.numChars = slot.after + 1 - active.baseChar
  }
  if (backward) clusters[clusterIndex]!.advance = Math.trunc(clusters[clusterIndex]!.advance + currentAdvance)
  else clusters[clusterIndex]!.advance = Math.trunc(clusters[clusterIndex]!.advance + positioned.totalAdvance - currentAdvance)

  const result: ClusteredGraphiteSlot[] = new Array(run.slots.length)
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]!
    for (let glyph = 0; glyph < cluster.numGlyphs; glyph++) {
      result[cluster.baseGlyph + glyph] = {
        slot: run.slots[cluster.baseGlyph + glyph]!,
        cluster: cluster.baseChar,
        advance: cluster.advance,
        componentCount: glyph === 0 ? cluster.numChars : 0,
        sourceCount: cluster.numChars,
      }
    }
  }
  return result
}

function reverseGraphiteClusters(slots: ClusteredGraphiteSlot[]): ClusteredGraphiteSlot[] {
  const groups: ClusteredGraphiteSlot[][] = []
  for (let i = 0; i < slots.length;) {
    let end = i + 1
    while (end < slots.length && slots[end]!.cluster === slots[i]!.cluster) end++
    groups.push(slots.slice(i, end))
    i = end
  }
  groups.reverse()
  const result: ClusteredGraphiteSlot[] = []
  for (let i = 0; i < groups.length; i++) result.push(...groups[i]!)
  return result
}

function truncateGraphitePosition(value: number): number {
  const result = Math.trunc(value)
  return result === 0 ? 0 : result
}

function isGraphiteWhitespace(codePoint: number): boolean {
  return codePoint >= 0x0009 && codePoint <= 0x000d
    || codePoint === 0x0020
    || codePoint === 0x0085
    || codePoint === 0x00a0
    || codePoint === 0x1680
    || codePoint === 0x180e
    || codePoint >= 0x2000 && codePoint <= 0x200a
    || codePoint === 0x2028
    || codePoint === 0x2029
    || codePoint === 0x202f
    || codePoint === 0x205f
    || codePoint === 0x3000
}

function graphiteRoot(slot: GraphiteSlot): GraphiteSlot {
  let root = slot
  while (root.parent !== null) root = root.parent
  return root
}

function graphiteSiblingRoots(run: GraphiteRun): GraphiteSlot[] {
  const roots = run.slots.filter(function (slot) { return slot.parent === null })
  if (run.rightToLeft) roots.reverse()
  return roots
}

function findJustificationRoot(
  roots: readonly GraphiteSlot[], codePoint: number, fromEnd: boolean,
): number {
  if (fromEnd) {
    for (let i = roots.length - 1; i >= 0; i--) {
      const slot = roots[i]!
      if (slot.before <= codePoint && slot.after >= codePoint) return i
    }
  } else {
    for (let i = 0; i < roots.length; i++) {
      const slot = roots[i]!
      if (slot.before <= codePoint && slot.after >= codePoint) return i
    }
  }
  throw new RangeError(`Graphite justification code-point index ${codePoint} is not associated with a slot`)
}

function addGraphiteLineEnd(run: GraphiteRun, index: number): GraphiteSlot {
  const next = run.slots[index]
  const previous = index > 0 ? run.slots[index - 1]! : null
  const original = next?.original ?? previous?.original ?? 0
  const slot = createSlot(run, run.subtable.lbGID, original)
  if (next !== undefined) {
    slot.before = next.before
    slot.after = previous?.after ?? next.before
  } else if (previous !== null) {
    slot.before = previous.after
    slot.after = previous.after
  }
  run.slots.splice(index, 0, slot)
  return slot
}

function justifyGraphiteRun(
  run: GraphiteRun, options: GraphiteJustificationOptions,
): PositionedGraphiteRun {
  if (run.slots.length === 0) return positionGraphiteSlots(run, true)
  const lineStartSlot = run.slots[0]!
  let reversed = false
  if (run.rightToLeft !== ((run.subtable.direction & 1) !== 0)
    && run.subtable.iBidi !== run.subtable.numPasses) {
    reverseGraphiteSlots(run)
    run.currentDirection ^= 1
    reversed = true
  }

  positionGraphiteSlots(run, true)
  const roots = graphiteSiblingRoots(run)
  const firstCodePoint = options.firstCodePoint ?? 0
  const lastCodePoint = options.lastCodePoint ?? run.codePoints.length - 1
  if (firstCodePoint < 0 || lastCodePoint >= run.codePoints.length || firstCodePoint > lastCodePoint) {
    throw new RangeError('Invalid Graphite justification code-point range')
  }
  const firstRoot = findJustificationRoot(roots, firstCodePoint, false)
  let lastRoot = findJustificationRoot(roots, lastCodePoint, true)
  if (!options.endInline) {
    while (lastRoot !== firstRoot) {
      const box = run.font.getGlyphBoundingBox(roots[lastRoot]!.realGid)
      if (box.xMin !== 0 || box.yMin !== 0 || box.xMax !== 0 || box.yMax === 0) break
      lastRoot--
    }
  }

  const base = Math.fround(run.positions.get(roots[firstRoot]!)!.x)
  const distributionStart = firstRoot + 1
  let levelCount = run.subtable.jLevels.length
  if (levelCount === 0) {
    let whitespaceCount = 0
    for (let i = 0; i <= lastRoot; i++) {
      const slot = roots[i]!
      if (isGraphiteWhitespace(run.codePoints[slot.before]!)) {
        setJustificationParam(run, slot, 0, 3, 1)
        setJustificationParam(run, slot, 0, 2, 1)
        setJustificationParam(run, slot, 0, 0, -1)
        whitespaceCount++
      }
    }
    if (whitespaceCount === 0) {
      for (let i = 0; i <= lastRoot; i++) {
        const slot = roots[i]!
        setJustificationParam(run, slot, 0, 3, 1)
        setJustificationParam(run, slot, 0, 2, 1)
        setJustificationParam(run, slot, 0, 0, -1)
      }
    }
    levelCount = 1
  }

  let currentWidth = Math.fround(0)
  const weights = new Int32Array(levelCount)
  for (let i = distributionStart; i <= lastRoot; i++) {
    const slot = roots[i]!
    const origin = run.positions.get(slot)!.x
    const width = Math.fround(Math.fround(origin + slot.advanceX) - base)
    if (width > currentWidth) currentWidth = width
    for (let level = 0; level < levelCount; level++) {
      weights[level] = (weights[level]! + getJustificationParam(run, slot, level, 3)) | 0
    }
    slot.justification = 0
  }

  const targetWidth = Math.fround(options.width)
  for (let level = targetWidth < 0 ? -1 : levelCount - 1; level >= 0; level--) {
    let totalWeight = weights[level]!
    if (totalWeight === 0) continue
    let error: number
    do {
      error = Math.fround(0)
      const difference = Math.fround(targetWidth - currentWidth)
      const differencePerWeight = Math.fround(difference / totalWeight)
      totalWeight = 0
      for (let i = distributionStart; i <= lastRoot; i++) {
        const slot = roots[i]!
        const weight = getJustificationParam(run, slot, level, 3)
        let preferred = Math.fround(Math.fround(differencePerWeight * weight) + error)
        let step = getJustificationParam(run, slot, level, 2)
        if (step === 0) step = 1
        if (preferred > 0) {
          let maximum = getJustificationParam(run, slot, level, 0) & 0xffff
          if (level === 0) maximum -= slot.justification
          if (preferred > maximum) preferred = maximum
          else totalWeight = (totalWeight + weight) | 0
        } else {
          let maximum = getJustificationParam(run, slot, level, 1) & 0xffff
          if (level === 0) maximum += slot.justification
          if (-preferred > maximum) preferred = -maximum
          else totalWeight = (totalWeight + weight) | 0
        }
        const actual = Math.trunc(preferred / step) * step
        if (actual !== 0) {
          error = Math.fround(error + Math.fround(Math.fround(differencePerWeight * weight) - actual))
          if (level === 0) slot.justification = Math.fround(slot.justification + actual)
          else setJustificationParam(run, slot, level, 4, actual)
        }
      }
      currentWidth = Math.fround(currentWidth + Math.fround(difference - error))
    } while (level === 0 && Math.trunc(Math.abs(error)) > 0 && totalWeight !== 0)
  }

  let firstLineEnd: GraphiteSlot | null = null
  let lastLineEnd: GraphiteSlot | null = null
  let positionStart = run.slots.indexOf(lineStartSlot)
  let positionEnd = run.slots.indexOf(roots[lastRoot]!)
  if ((run.subtable.flags & 1) !== 0) {
    const firstRootSlotIndex = run.slots.indexOf(roots[0]!)
    const afterLastRoot = lastRoot + 1 < roots.length ? run.slots.indexOf(roots[lastRoot + 1]!) : run.slots.length
    firstLineEnd = addGraphiteLineEnd(run, firstRootSlotIndex)
    const adjustedAfterLastRoot = afterLastRoot + 1
    lastLineEnd = addGraphiteLineEnd(run, adjustedAfterLastRoot)
    positionStart = run.slots.indexOf(firstLineEnd)
    positionEnd = run.slots.indexOf(lastLineEnd)
  }

  if (run.subtable.iJust !== run.subtable.iPos
    && (targetWidth >= 0 || (run.subtable.flags & 1) !== 0)) {
    for (let passIndex = run.subtable.iJust; passIndex < run.subtable.iPos; passIndex++) {
      runPass(run, run.subtable.passes[passIndex]!)
    }
  }
  const positioned = positionGraphiteSlots(run, true, positionStart, positionEnd)
  if (firstLineEnd !== null && lastLineEnd !== null) {
    const lastIndex = run.slots.indexOf(lastLineEnd)
    run.slots.splice(lastIndex, 1)
    const firstIndex = run.slots.indexOf(firstLineEnd)
    run.slots.splice(firstIndex, 1)
  }
  if (reversed) {
    reverseGraphiteSlots(run)
    run.currentDirection ^= 1
  }
  return positioned
}

function reverseGraphiteSlots(run: GraphiteRun): void {
  let prefixLength = 0
  while (prefixLength < run.slots.length
    && getGlyphAttr(run, run.slots[prefixLength]!, run.subtable.attrDirectionality) === 16) prefixLength++
  if (prefixLength === run.slots.length) return
  const groups: GraphiteSlot[][] = []
  for (let index = prefixLength; index < run.slots.length;) {
    let end = index + 1
    while (end < run.slots.length
      && getGlyphAttr(run, run.slots[end]!, run.subtable.attrDirectionality) === 16) end++
    groups.push(run.slots.slice(index, end))
    index = end
  }
  const reversed = run.slots.slice(0, prefixLength)
  for (let group = groups.length - 1; group >= 0; group--) reversed.push(...groups[group]!)
  run.slots = reversed
}

export function shapeGraphite(
  font: GraphiteFontSource,
  codePoints: readonly number[],
  options: GraphiteShapeOptions,
): GraphiteShapedGlyph[] {
  const silf = font.silf
  const glat = font.glat
  const feat = font.graphiteFeatures
  if (silf === null || glat === null || feat === null || silf.subtables.length === 0) {
    throw new Error('Graphite shaping requires Silf, Glat, Gloc, and Feat tables')
  }
  const subtable = silf.subtables[0]!
  const run: GraphiteRun = {
    font, subtable, slots: [], features: [], codePoints, breakWeights: new Int16Array(codePoints.length), rightToLeft: options.rightToLeft,
    currentDirection: options.rightToLeft ? 1 : 0, positions: new Map(),
  }
  const featureValues = buildFeatureValues(feat, font.sill, options.language, options.features)
  for (let i = 0; i < codePoints.length; i++) {
    const codePoint = codePoints[i]!
    let glyphId = font.getGlyphId(codePoint)
    if (glyphId === 0) {
      let low = 0
      let high = subtable.pseudoMaps.length - 1
      while (low <= high) {
        const middle = (low + high) >>> 1
        const pseudo = subtable.pseudoMaps[middle]!
        if (pseudo.unicode === codePoint) { glyphId = pseudo.pseudoGlyph; break }
        if (pseudo.unicode < codePoint) low = middle + 1
        else high = middle - 1
      }
    }
    const slot = createSlot(run, glyphId, i)
    run.breakWeights[i] = getGlyphAttr(run, slot, subtable.attrBreakWeight)
    run.slots.push(slot)
    run.features.push(new Int16Array(featureValues))
  }
  for (let passIndex = 0; passIndex < subtable.passes.length; passIndex++) {
    if (passIndex === subtable.iBidi && run.currentDirection !== (subtable.direction & 1)) {
      reverseGraphiteSlots(run)
      run.currentDirection ^= 1
    }
    const pass = subtable.passes[passIndex]!
    if (passIndex === subtable.iPos && (subtable.flags & 0x20) !== 0) initializeCollisionAttributes(run)
    const passDirection = (subtable.direction & 1) ^ ((pass.flags >>> 5) & 1)
    if (run.currentDirection !== passDirection) {
      reverseGraphiteSlots(run)
      run.currentDirection ^= 1
    }
    runPass(run, pass)
  }
  const positioned = options.justification === undefined
    ? positionGraphiteSlots(run, true)
    : justifyGraphiteRun(run, options.justification)
  const result: GraphiteShapedGlyph[] = []
  const resultBySlot = new Map<GraphiteSlot, GraphiteShapedGlyph>()
  const positions = positioned.positions
  const backward = options.rightToLeft
  let outputSlots = clusterGraphiteSlots(run, positioned, backward)
  let currentCluster = -1
  let pen = backward ? Math.trunc(positioned.totalAdvance) : 0
  for (let i = 0; i < outputSlots.length; i++) {
    const entry = outputSlots[i]!
    const slot = entry.slot
    const position = positions.get(slot)!
    let advance = 0
    if (entry.cluster !== currentCluster) {
      advance = entry.advance
      if (backward) pen -= advance
      currentCluster = entry.cluster
    }
    const xOffset = backward
      ? position.x - entry.advance - pen + advance
      : position.x - pen
    if (!backward) pen += advance
    const glyph: GraphiteShapedGlyph = {
      glyphId: slot.realGid,
      cluster: entry.cluster,
      xOffset: truncateGraphitePosition(xOffset),
      yOffset: truncateGraphitePosition(position.y),
      xAdvance: truncateGraphitePosition(advance),
      yAdvance: truncateGraphitePosition(slot.advanceY),
      componentCount: entry.componentCount,
      graphite: {
        original: slot.original,
        sourceStart: entry.cluster,
        sourceEnd: entry.cluster + entry.sourceCount,
        associationBefore: slot.before,
        associationAfter: slot.after,
        breakWeight: run.breakWeights[slot.original] ?? 0,
        insertBefore: slot.insertBefore,
        bidiLevel: slot.bidiLevel,
        attachmentParent: slot.parent === null ? -1 : run.slots.indexOf(slot.parent),
        pseudoGlyphId: slot.gid === slot.realGid ? null : slot.gid,
        substituted: slot.substituted,
        justification: slot.justification,
        userAttributes: Array.from(slot.userAttrs),
      },
    }
    result.push(glyph)
    resultBySlot.set(slot, glyph)
  }
  if (!backward) return result
  outputSlots = reverseGraphiteClusters(outputSlots)
  return outputSlots.map(function (entry) { return resultBySlot.get(entry.slot)! })
}
