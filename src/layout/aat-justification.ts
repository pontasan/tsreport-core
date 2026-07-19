import type { Font } from '../font.js'
import {
  type JustDirectionData,
  type JustPostcompAction,
  type JustWidthDeltaPair,
} from '../parsers/tables/just.js'
import { PROP_ATTACHES_ON_RIGHT } from '../parsers/tables/prop.js'
import type { RenderGlyphRun } from '../types/render.js'

const JUST_UNLIMITED = 0x1000
const JUST_PRIORITY_MASK = 0x000F

interface JustSlot {
  glyphId: number
  baseAdvance: number
  xOffset: number
  yOffset: number
  cluster: number
  rotation: number
  ancestry: ReadonlySet<string>
  appliedActions: Set<string>
  repeatedGroup: string | null
}

interface JustAssignment {
  before: number
  after: number
  pair: JustWidthDeltaPair | null
}

interface StructuralAction {
  slotIndex: number
  actionIndex: number
  action: JustPostcompAction
  distanceFactor: number
}

export interface AatJustificationResult {
  /** Signed amount by which the glyph run width changed. */
  appliedDelta: number
  /** Signed target delta not consumed by AAT width or postcompensation rules. */
  remainingDelta: number
}

/**
 * Applies an AAT `just` direction table to a shaped run. Width-delta
 * priorities are processed from kashida through null priority, with finite
 * limits exhausted before the next priority and unlimited entries sharing all
 * remaining distance at their priority. Structural postcompensation restarts
 * width allocation against the same target width.
 */
export function applyAatJustification(
  run: RenderGlyphRun,
  font: Font,
  data: JustDirectionData,
  requestedDelta: number,
  fontSize: number,
  horizontalScale: number,
  vertical = false,
): AatJustificationResult {
  const initialWidth = sumAdvances(run.advances)
  const targetWidth = initialWidth + requestedDelta
  const slots = createSlots(run)
  const structuralSignatures = new Set<string>()

  let categories = data.getCategories([], 'line')
  let assignments: JustAssignment[] = []
  while (true) {
    categories = data.getCategories(getSlotGlyphIds(slots), 'line')
    assignments = allocateWidth(slots, categories, data, font, targetWidth - sumSlotBaseAdvances(slots), fontSize, horizontalScale, vertical)
    const structural = selectStructuralAction(slots, categories, assignments, data, fontSize, horizontalScale, vertical)
    if (structural === null) break
    const signature = structuralSignature(slots, structural)
    if (structuralSignatures.has(signature)) {
      throw new Error('just postcompensation actions form a structural cycle')
    }
    structuralSignatures.add(signature)
    applyStructuralAction(
      slots, structural, font, fontSize, horizontalScale, vertical,
      targetWidth - sumSlotBaseAdvances(slots),
    )
  }

  writeRun(run, slots, assignments)
  fitRepeatedAddGlyphs(run, slots, targetWidth)
  applyShapeActions(run, slots, categories, assignments, data, font, fontSize, horizontalScale, vertical)
  const finalWidth = sumAdvances(run.advances)
  return {
    appliedDelta: finalWidth - initialWidth,
    remainingDelta: targetWidth - finalWidth,
  }
}

function createSlots(run: RenderGlyphRun): JustSlot[] {
  const slots = new Array<JustSlot>(run.glyphIds.length)
  for (let i = 0; i < slots.length; i++) {
    slots[i] = {
      glyphId: run.glyphIds[i]!,
      baseAdvance: run.advances[i]!,
      xOffset: run.xOffsets[i]!,
      yOffset: run.yOffsets[i]!,
      cluster: run.clusters[i]!,
      rotation: run.rotations?.[i] ?? 0,
      ancestry: EMPTY_ACTION_ANCESTRY,
      appliedActions: new Set<string>(),
      repeatedGroup: null,
    }
  }
  return slots
}

const EMPTY_ACTION_ANCESTRY: ReadonlySet<string> = new Set<string>()

function getSlotGlyphIds(slots: readonly JustSlot[]): number[] {
  const glyphIds = new Array<number>(slots.length)
  for (let i = 0; i < slots.length; i++) glyphIds[i] = slots[i]!.glyphId
  return glyphIds
}

function allocateWidth(
  slots: readonly JustSlot[],
  categories: Uint8Array,
  data: JustDirectionData,
  font: Font,
  delta: number,
  fontSize: number,
  horizontalScale: number,
  vertical: boolean,
): JustAssignment[] {
  const assignments = new Array<JustAssignment>(slots.length)
  for (let i = 0; i < slots.length; i++) assignments[i] = { before: 0, after: 0, pair: null }
  if (delta === 0) return assignments

  const growing = delta > 0
  const scale = fontSize * (vertical ? 1 : horizontalScale)
  let remaining = delta
  for (let priority = 0; priority <= 3 && remaining !== 0; priority++) {
    const sides: { slot: number, before: boolean, limit: number, unlimited: boolean }[] = []
    let finiteCapacity = 0
    let unlimitedWeight = 0
    for (let i = 0; i < slots.length; i++) {
      const pair = findWidthPair(data.getWidthDeltaPairs(slots[i]!.glyphId), categories[i]!)
      assignments[i]!.pair = pair
      if (pair === null) continue
      const flags = growing ? pair.growFlags : pair.shrinkFlags
      if ((flags & JUST_PRIORITY_MASK) !== priority) continue
      const unlimited = (flags & JUST_UNLIMITED) !== 0
      const properties = font.getAatGlyphProperties(slots[i]!.glyphId) ?? 0
      const previousProperties = i === 0 ? 0 : (font.getAatGlyphProperties(slots[i - 1]!.glyphId) ?? 0)
      const beforeAllowed = i === 0 || (previousProperties & PROP_ATTACHES_ON_RIGHT) === 0
      const afterAllowed = i === slots.length - 1 || (properties & PROP_ATTACHES_ON_RIGHT) === 0
      const beforeLimit = (growing ? pair.beforeGrowLimit : pair.beforeShrinkLimit) * scale
      const afterLimit = (growing ? pair.afterGrowLimit : pair.afterShrinkLimit) * scale
      if (beforeAllowed && beforeLimit !== 0) {
        sides.push({ slot: i, before: true, limit: beforeLimit, unlimited })
        if (unlimited) unlimitedWeight += beforeLimit
        else finiteCapacity += beforeLimit
      }
      if (afterAllowed && afterLimit !== 0) {
        sides.push({ slot: i, before: false, limit: afterLimit, unlimited })
        if (unlimited) unlimitedWeight += afterLimit
        else finiteCapacity += afterLimit
      }
    }

    if (unlimitedWeight !== 0) {
      for (let i = 0; i < sides.length; i++) {
        const side = sides[i]!
        if (!side.unlimited) continue
        addSide(assignments[side.slot]!, side.before, remaining * side.limit / unlimitedWeight)
      }
      remaining = 0
    } else if (finiteCapacity !== 0) {
      const consumed = (growing ? 1 : -1) * Math.min(Math.abs(remaining), Math.abs(finiteCapacity))
      for (let i = 0; i < sides.length; i++) {
        const side = sides[i]!
        if (side.unlimited) continue
        addSide(assignments[side.slot]!, side.before, consumed * side.limit / finiteCapacity)
      }
      remaining -= consumed
    }
  }
  return assignments
}

function findWidthPair(pairs: readonly JustWidthDeltaPair[] | null, category: number): JustWidthDeltaPair | null {
  if (pairs === null) return null
  let lo = 0
  let hi = pairs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const pair = pairs[mid]!
    if (category < pair.justClass) hi = mid - 1
    else if (category > pair.justClass) lo = mid + 1
    else return pair
  }
  return null
}

function addSide(assignment: JustAssignment, before: boolean, value: number): void {
  if (before) assignment.before += value
  else assignment.after += value
}

function selectStructuralAction(
  slots: readonly JustSlot[],
  categories: Uint8Array,
  assignments: readonly JustAssignment[],
  data: JustDirectionData,
  fontSize: number,
  horizontalScale: number,
  vertical: boolean,
): StructuralAction | null {
  let selected: StructuralAction | null = null
  for (let i = 0; i < slots.length; i++) {
    const actions = data.getPostcompActions(slots[i]!.glyphId)
    if (actions === null) continue
    const distanceFactor = (assignments[i]!.before + assignments[i]!.after) / (fontSize * (vertical ? 1 : horizontalScale))
    for (let a = 0; a < actions.length; a++) {
      const action = actions[a]!
      if (action.actionClass !== categories[i]) continue
      const key = actionKey(slots[i]!.glyphId, a, action)
      if (slots[i]!.appliedActions.has(key)) continue
      let applies = false
      if (action.actionType === 0) applies = distanceFactor < action.lowerLimit || distanceFactor > action.upperLimit
      else if (action.actionType === 1 || action.actionType === 2 || action.actionType === 5) applies = distanceFactor > 0
      if (!applies) continue
      const candidate = { slotIndex: i, actionIndex: a, action, distanceFactor }
      if (selected === null || structuralActionPrecedes(candidate, selected)) selected = candidate
    }
  }
  return selected
}

function structuralActionPrecedes(a: StructuralAction, b: StructuralAction): boolean {
  if (a.action.actionType === 0 && b.action.actionType === 0) {
    if (a.action.order !== b.action.order) return a.action.order < b.action.order
  } else if (a.action.actionType === 0) {
    return true
  } else if (b.action.actionType === 0) {
    return false
  }
  if (a.slotIndex !== b.slotIndex) return a.slotIndex < b.slotIndex
  return a.actionIndex < b.actionIndex
}

function applyStructuralAction(
  slots: JustSlot[],
  selected: StructuralAction,
  font: Font,
  fontSize: number,
  horizontalScale: number,
  vertical: boolean,
  remainingLineGap: number,
): void {
  const slot = slots[selected.slotIndex]!
  const action = selected.action
  const key = actionKey(slot.glyphId, selected.actionIndex, action)
  if (slot.ancestry.has(key)) throw new Error(`just postcompensation recursively applies to glyph ${slot.glyphId}`)
  slot.appliedActions.add(key)
  const ancestry = new Set(slot.ancestry)
  ancestry.add(key)
  const scale = fontSize / font.metrics.unitsPerEm * (vertical ? 1 : horizontalScale)

  if (action.actionType === 0) {
    const replacement = new Array<JustSlot>(action.glyphs.length)
    const externalSpacing = slot.baseAdvance - getGlyphAdvance(font, slot.glyphId, vertical) * scale
    for (let i = 0; i < action.glyphs.length; i++) {
      replacement[i] = createInsertedSlot(action.glyphs[i]!, font, scale, i === 0 ? slot.cluster : 0, slot.rotation, ancestry, vertical)
    }
    if (replacement.length > 0) {
      replacement[0]!.baseAdvance += externalSpacing
      replacement[0]!.xOffset = slot.xOffset
      replacement[0]!.yOffset = slot.yOffset
    }
    slots.splice(selected.slotIndex, 1, ...replacement)
    return
  }

  if (action.actionType === 2 && selected.distanceFactor >= action.substThreshold) {
    const externalSpacing = slot.baseAdvance - getGlyphAdvance(font, slot.glyphId, vertical) * scale
    slot.glyphId = action.substGlyph
    slot.baseAdvance = getGlyphAdvance(font, action.substGlyph, vertical) * scale + externalSpacing
  }

  let glyphToAdd: number
  if (action.actionType === 1 || action.actionType === 2) glyphToAdd = action.addGlyph
  else if (action.actionType === 5) glyphToAdd = action.glyph
  else throw new Error(`just action type ${action.actionType} is not structural`)
  if (glyphToAdd === 0xFFFF) return
  const addedAdvance = getGlyphAdvance(font, glyphToAdd, vertical) * scale
  let count = 1
  if (action.actionType === 5) {
    if (addedAdvance <= 0) throw new Error('just repeated-add glyph must have a positive advance')
    count = Math.max(1, Math.ceil(Math.abs(remainingLineGap) / addedAdvance))
  }
  const inserted = new Array<JustSlot>(count)
  for (let i = 0; i < count; i++) {
    inserted[i] = createInsertedSlot(glyphToAdd, font, scale, 0, slot.rotation, ancestry, vertical)
    if (action.actionType === 5) inserted[i]!.repeatedGroup = key
  }
  slots.splice(selected.slotIndex + 1, 0, ...inserted)
}

function createInsertedSlot(
  glyphId: number,
  font: Font,
  scale: number,
  cluster: number,
  rotation: number,
  ancestry: ReadonlySet<string>,
  vertical: boolean,
): JustSlot {
  return {
    glyphId,
    baseAdvance: getGlyphAdvance(font, glyphId, vertical) * scale,
    xOffset: 0,
    yOffset: 0,
    cluster,
    rotation,
    ancestry,
    appliedActions: new Set<string>(),
    repeatedGroup: null,
  }
}

function fitRepeatedAddGlyphs(run: RenderGlyphRun, slots: readonly JustSlot[], targetWidth: number): void {
  const remaining = targetWidth - sumAdvances(run.advances)
  if (remaining === 0) return
  let totalAdvance = 0
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]!.repeatedGroup !== null) totalAdvance += run.advances[i]!
  }
  if (totalAdvance === 0) return
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]!.repeatedGroup !== null) {
      run.advances[i]! += remaining * run.advances[i]! / totalAdvance
    }
  }
}

function writeRun(run: RenderGlyphRun, slots: readonly JustSlot[], assignments: readonly JustAssignment[]): void {
  const glyphIds = new Uint16Array(slots.length)
  const advances = new Float64Array(slots.length)
  const xOffsets = new Float64Array(slots.length)
  const yOffsets = new Float64Array(slots.length)
  const clusters = new Uint16Array(slots.length)
  const rotations = run.rotations === undefined ? undefined : new Uint8Array(slots.length)
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!
    const assignment = assignments[i]!
    glyphIds[i] = slot.glyphId
    advances[i] = slot.baseAdvance + assignment.after
    xOffsets[i] = slot.xOffset
    yOffsets[i] = slot.yOffset
    clusters[i] = slot.cluster
    if (rotations !== undefined) rotations[i] = slot.rotation
  }
  for (let i = 0; i < assignments.length; i++) {
    const before = assignments[i]!.before
    if (i === 0) {
      advances[0]! += before
      xOffsets[0]! += before
    } else {
      advances[i - 1]! += before
    }
  }
  run.glyphIds = glyphIds
  run.advances = advances
  run.xOffsets = xOffsets
  run.yOffsets = yOffsets
  run.clusters = clusters
  run.rotations = rotations
  run.xScales = undefined
  run.yScales = undefined
  run.outlineOverrides = undefined
}

function applyShapeActions(
  run: RenderGlyphRun,
  slots: readonly JustSlot[],
  categories: Uint8Array,
  assignments: readonly JustAssignment[],
  data: JustDirectionData,
  font: Font,
  fontSize: number,
  horizontalScale: number,
  vertical: boolean,
): void {
  let xScales: Float64Array | undefined
  let yScales: Float64Array | undefined
  let outlines: ({ commands: Uint8Array, coords: Float32Array } | null)[] | undefined
  for (let i = 0; i < slots.length; i++) {
    const actions = data.getPostcompActions(slots[i]!.glyphId)
    if (actions === null) continue
    const assigned = assignments[i]!.before + assignments[i]!.after
    const distanceFactor = assigned / (fontSize * (vertical ? 1 : horizontalScale))
    for (let a = 0; a < actions.length; a++) {
      const action = actions[a]!
      if (action.actionClass !== categories[i]) continue
      if (action.actionType === 3 && assigned !== 0) {
        if (slots[i]!.baseAdvance + assigned <= 0) throw new Error('just stretch action produces a non-positive glyph width')
        if (vertical) {
          if (yScales === undefined) {
            yScales = new Float64Array(slots.length)
            yScales.fill(1)
          }
          yScales[i] = (slots[i]!.baseAdvance + assigned) / slots[i]!.baseAdvance
        } else {
          if (xScales === undefined) {
            xScales = new Float64Array(slots.length)
            xScales.fill(1)
          }
          xScales[i] = (slots[i]!.baseAdvance + assigned) / slots[i]!.baseAdvance
        }
        removeAssignedSpacing(run, assignments, i)
        run.advances[i]! += assigned
      } else if (action.actionType === 4 && assigned !== 0) {
        const axis = findVariationAxis(font, action.variationAxis)
        const axisValue = Math.max(action.minimumLimit, Math.min(action.maximumLimit, action.noStretchValue + distanceFactor))
        const current = font.variationCoordinates === null ? {} : { ...font.variationCoordinates }
        current[axis.tag] = axisValue
        const varied = font.getGlyphAtVariation(slots[i]!.glyphId, current)
        if (outlines === undefined) outlines = new Array(slots.length).fill(null)
        outlines[i] = varied.glyph.outline
      }
    }
  }
  run.xScales = xScales
  run.yScales = yScales
  run.outlineOverrides = outlines
}

function getGlyphAdvance(font: Font, glyphId: number, vertical: boolean): number {
  return vertical ? font.getAdvanceHeight(glyphId) : font.getAdvanceWidth(glyphId)
}

function removeAssignedSpacing(run: RenderGlyphRun, assignments: readonly JustAssignment[], index: number): void {
  const assignment = assignments[index]!
  run.advances[index]! -= assignment.after
  if (index === 0) {
    run.advances[0]! -= assignment.before
    run.xOffsets[0]! -= assignment.before
  } else {
    run.advances[index - 1]! -= assignment.before
  }
}

function findVariationAxis(font: Font, tag: string): { tag: string } {
  const axes = font.variationAxes
  for (let i = 0; i < axes.length; i++) {
    if (axes[i]!.tag === tag) return axes[i]!
  }
  throw new Error(`just ductile action references missing variation axis '${tag}'`)
}

function actionKey(glyphId: number, actionIndex: number, action: JustPostcompAction): string {
  return `${glyphId}:${actionIndex}:${action.actionClass}:${action.actionType}`
}

function structuralSignature(slots: readonly JustSlot[], selected: StructuralAction): string {
  let signature = `${selected.slotIndex}:${selected.actionIndex}:${selected.action.actionType}:`
  for (let i = 0; i < slots.length; i++) signature += `${slots[i]!.glyphId},`
  return signature
}

function sumAdvances(advances: Float64Array): number {
  let total = 0
  for (let i = 0; i < advances.length; i++) total += advances[i]!
  return total
}

function sumSlotBaseAdvances(slots: readonly JustSlot[]): number {
  let total = 0
  for (let i = 0; i < slots.length; i++) total += slots[i]!.baseAdvance
  return total
}
