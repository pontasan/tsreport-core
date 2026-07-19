/**
 * Baseline JPEG decoder (pure TypeScript, no dependencies).
 *
 * Decodes sequential, progressive, lossless, and hierarchical JPEG processes
 * with Huffman or arithmetic entropy coding, including grayscale, YCbCr, RGB,
 * CMYK, and Adobe YCCK color, restart markers, and arbitrary subsampling.
 */

export interface DecodedJpeg {
  width: number
  height: number
  bitDepth: number
  rgba: Uint8Array
}

export interface DecodedJpegWithSamples extends DecodedJpeg {
  componentCount: number
  samples: Uint8Array | Uint16Array
}

export interface DecodedJpegSamples {
  width: number
  height: number
  bitDepth: number
  componentCount: number
  samples: Uint8Array | Uint16Array
}

interface JpegComponent {
  id: number
  h: number
  v: number
  quantId: number
  dcTable: number
  acTable: number
  blocksPerLine: number
  blocksPerColumn: number
  blocks: Int16Array
  pred: number
  /** Decoded spatial samples (one per block row of 8) */
  output: Int32Array
  outputWidth: number
  outputHeight: number
}

interface HuffmanTable {
  /** Flat lookup: maxCode/valPtr decoding per bit length */
  codes: Int32Array
  values: Uint8Array
  minCode: Int32Array
  maxCode: Int32Array
  valPtr: Int32Array
}

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])

export function decodeJpegToRgba(data: Uint8Array, decode?: number[], colorTransform?: 0 | 1): DecodedJpeg {
  const result = decodeJpegInternal(data)
  return {
    width: result.width,
    height: result.height,
    bitDepth: result.precision,
    rgba: convertToRgba(result.components, result.width, result.height, result.precision, jpegColorTransform(result.components.length, result.adobeTransform, colorTransform), decode ?? null),
  }
}

export function decodeJpegToRgbaWithSamples(data: Uint8Array, decode?: number[], colorTransform?: 0 | 1): DecodedJpegWithSamples {
  const result = decodeJpegInternal(data)
  const converted = convertToRgbaAndSamples(result.components, result.width, result.height, result.precision, jpegColorTransform(result.components.length, result.adobeTransform, colorTransform), decode ?? null, true)
  return {
    width: result.width,
    height: result.height,
    bitDepth: result.precision,
    rgba: converted.rgba,
    componentCount: result.components.length,
    samples: converted.samples!,
  }
}

export function decodeJpegSamples(data: Uint8Array, colorTransform?: 0 | 1): DecodedJpegSamples {
  const result = decodeJpegInternal(data)
  const transform = jpegColorTransform(result.components.length, result.adobeTransform, colorTransform)
  return {
    width: result.width,
    height: result.height,
    bitDepth: result.precision,
    componentCount: result.components.length,
    samples: extractJpegSamples(result.components, result.width, result.height, result.precision, transform),
  }
}

function jpegColorTransform(componentCount: number, adobeTransform: number, requested: 0 | 1 | undefined): 0 | 1 | 2 {
  if (adobeTransform >= 0) {
    if (adobeTransform !== 0 && adobeTransform !== 1 && adobeTransform !== 2) {
      throw new Error(`JPEG decode error: invalid Adobe color transform ${adobeTransform}`)
    }
    if (adobeTransform === 1 && componentCount !== 3 || adobeTransform === 2 && componentCount !== 4) {
      throw new Error(`JPEG decode error: Adobe color transform ${adobeTransform} does not match the component count`)
    }
    return adobeTransform
  }
  if (requested === 1) {
    if (componentCount <= 2) return 0
    if (componentCount > 4) throw new Error('JPEG decode error: ColorTransform 1 requires at most four components')
    return 1
  }
  if (requested === 0) return 0
  return componentCount === 3 ? 1 : 0
}

interface DecodedJpegInternal {
  width: number
  height: number
  components: JpegComponent[]
  adobeTransform: number
  maxH: number
  maxV: number
  precision: number
}

interface JpegHierarchyDefinition {
  precision: number
  width: number
  height: number
  componentIds: number[]
}

interface JpegHierarchyReference {
  precision: number
  width: number
  height: number
  components: JpegComponent[]
}

type JpegScanState = Map<number, Uint8Array>

function parseJpegHierarchyDefinition(data: Uint8Array, start: number, end: number): JpegHierarchyDefinition {
  if (end - start < 6) throw new Error('JPEG decode error: truncated DHP marker')
  const precision = data[start]!
  const height = (data[start + 1]! << 8) | data[start + 2]!
  const width = (data[start + 3]! << 8) | data[start + 4]!
  const count = data[start + 5]!
  if (precision < 2 || precision > 16 || width === 0 || height === 0 || count === 0) {
    throw new Error('JPEG decode error: invalid DHP parameters')
  }
  if (end - start !== 6 + count * 3) throw new Error('JPEG decode error: invalid DHP component list')
  const componentIds: number[] = []
  for (let i = 0; i < count; i++) {
    const id = data[start + 6 + i * 3]!
    if (componentIds.includes(id)) throw new Error('JPEG decode error: duplicate DHP component id')
    const sampling = data[start + 7 + i * 3]!
    const horizontal = sampling >> 4
    const vertical = sampling & 15
    if (horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4 || data[start + 8 + i * 3]! > 3) {
      throw new Error('JPEG decode error: invalid DHP component parameters')
    }
    componentIds.push(id)
  }
  return { precision, width, height, componentIds }
}

function validateCompletedJpegFrame(components: JpegComponent[], progressive: boolean, scanState: JpegScanState): void {
  if (components.length === 0) throw new Error('JPEG decode error: frame contains no scans')
  for (let i = 0; i < components.length; i++) {
    const state = scanState.get(components[i]!.id)
    if (state === undefined) throw new Error('JPEG decode error: frame component is missing from all scans')
    const coefficientCount = progressive ? 64 : 1
    for (let coefficient = 0; coefficient < coefficientCount; coefficient++) {
      if (state[coefficient] === 0) throw new Error('JPEG decode error: frame scan sequence is incomplete')
    }
  }
}

function recordJpegScan(
  scanState: JpegScanState,
  scanComponents: JpegComponent[],
  progressive: boolean,
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
): void {
  if (!progressive) {
    for (let i = 0; i < scanComponents.length; i++) {
      const id = scanComponents[i]!.id
      if (scanState.has(id)) throw new Error('JPEG decode error: sequential component appears in more than one scan')
      scanState.set(id, Uint8Array.of(1))
    }
    return
  }
  if (successiveHigh !== 0 && successiveHigh !== successiveLow + 1) {
    throw new Error('JPEG decode error: invalid progressive successive approximation')
  }
  for (let component = 0; component < scanComponents.length; component++) {
    const id = scanComponents[component]!.id
    let state = scanState.get(id)
    if (state === undefined) {
      state = new Uint8Array(64)
      scanState.set(id, state)
    }
    for (let coefficient = spectralStart; coefficient <= spectralEnd; coefficient++) {
      if (successiveHigh === 0) {
        if (state[coefficient] !== 0) throw new Error('JPEG decode error: progressive coefficient has duplicate first scan')
      } else if (state[coefficient] !== successiveHigh + 1) {
        throw new Error('JPEG decode error: progressive refinement does not follow the preceding approximation')
      }
      state[coefficient] = successiveLow + 1
    }
  }
}

function commitHierarchicalFrame(
  reference: JpegHierarchyReference | null,
  components: JpegComponent[],
  width: number,
  height: number,
  precision: number,
  lossless: boolean,
  differential: boolean,
  quantTables: Array<Uint16Array | null>,
): JpegHierarchyReference {
  if (components.length === 0) throw new Error('JPEG decode error: hierarchical frame has no components')
  if (!lossless) {
    for (let i = 0; i < components.length; i++) {
      dequantizeAndIdct(components[i]!, quantTables, precision, differential, true)
    }
  }
  cropHierarchicalComponents(components, width, height)
  if (reference === null) {
    if (differential) throw new Error('JPEG decode error: first hierarchical frame must be non-differential')
    return { precision, width, height, components: cloneJpegComponents(components) }
  }
  if (!differential) throw new Error('JPEG decode error: subsequent hierarchical frames must be differential')
  if (reference.components.length !== components.length) {
    throw new Error('JPEG decode error: hierarchical component count changed')
  }
  const maxValue = (1 << precision) - 1
  for (let i = 0; i < components.length; i++) {
    const difference = components[i]!
    const base = reference.components.find(function (component) { return component.id === difference.id })
    if (base === undefined || base.outputWidth !== difference.outputWidth || base.outputHeight !== difference.outputHeight) {
      throw new Error('JPEG decode error: differential component dimensions do not match the reference')
    }
    const merged = new Int32Array(base.output.length)
    for (let sample = 0; sample < merged.length; sample++) {
      const value = base.output[sample]! + difference.output[sample]!
      merged[sample] = value < 0 ? 0 : value > maxValue ? maxValue : value
    }
    base.output = merged
    base.h = difference.h
    base.v = difference.v
  }
  reference.width = width
  reference.height = height
  reference.precision = precision
  return reference
}

function cropHierarchicalComponents(components: JpegComponent[], width: number, height: number): void {
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < components.length; i++) {
    if (components[i]!.h > maxH) maxH = components[i]!.h
    if (components[i]!.v > maxV) maxV = components[i]!.v
  }
  for (let i = 0; i < components.length; i++) {
    const component = components[i]!
    const actualWidth = Math.ceil(width * component.h / maxH)
    const actualHeight = Math.ceil(height * component.v / maxV)
    if (component.outputWidth === actualWidth && component.outputHeight === actualHeight) continue
    const cropped = new Int32Array(actualWidth * actualHeight)
    for (let y = 0; y < actualHeight; y++) {
      cropped.set(component.output.subarray(y * component.outputWidth, y * component.outputWidth + actualWidth), y * actualWidth)
    }
    component.output = cropped
    component.outputWidth = actualWidth
    component.outputHeight = actualHeight
  }
}

function cloneJpegComponents(components: JpegComponent[]): JpegComponent[] {
  return components.map(function (component) {
    return {
      ...component,
      blocks: new Int16Array(component.blocks),
      output: new Int32Array(component.output),
    }
  })
}

function expandHierarchicalReference(reference: JpegHierarchyReference, horizontal: boolean, vertical: boolean): JpegHierarchyReference {
  if (!horizontal && !vertical) return reference
  for (let i = 0; i < reference.components.length; i++) {
    const component = reference.components[i]!
    let output = component.output
    let width = component.outputWidth
    let height = component.outputHeight
    if (horizontal) {
      output = expandHierarchicalPlaneHorizontal(output, width, height)
      width *= 2
    }
    if (vertical) {
      output = expandHierarchicalPlaneVertical(output, width, height)
      height *= 2
    }
    component.output = output
    component.outputWidth = width
    component.outputHeight = height
  }
  if (horizontal) reference.width *= 2
  if (vertical) reference.height *= 2
  return reference
}

function expandHierarchicalPlaneHorizontal(source: Int32Array, width: number, height: number): Int32Array {
  const target = new Int32Array(width * 2 * height)
  for (let y = 0; y < height; y++) {
    expandHierarchicalLine(source, y * width, 1, target, y * width * 2, 1, width)
  }
  return target
}

function expandHierarchicalPlaneVertical(source: Int32Array, width: number, height: number): Int32Array {
  const target = new Int32Array(width * height * 2)
  for (let x = 0; x < width; x++) {
    expandHierarchicalLine(source, x, width, target, x, width, height)
  }
  return target
}

function expandHierarchicalLine(
  source: Int32Array,
  sourceStart: number,
  sourceStep: number,
  target: Int32Array,
  targetStart: number,
  targetStep: number,
  count: number,
): void {
  if (count === 1) {
    target[targetStart] = source[sourceStart]!
    target[targetStart + targetStep] = source[sourceStart]!
    return
  }
  target[targetStart] = source[sourceStart]!
  for (let i = 0; i < count - 1; i++) {
    const first = source[sourceStart + i * sourceStep]!
    const second = source[sourceStart + (i + 1) * sourceStep]!
    target[targetStart + (i * 2 + 1) * targetStep] = (first + second) >> 1
    target[targetStart + (i * 2 + 2) * targetStep] = second
  }
  const last = source[sourceStart + (count - 1) * sourceStep]!
  target[targetStart + (count * 2 - 1) * targetStep] = last
}

function decodeJpegInternal(data: Uint8Array): DecodedJpegInternal {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
    throw new Error('JPEG decode error: missing SOI marker')
  }
  const quantTables: Array<Uint16Array | null> = [null, null, null, null]
  const dcTables: Array<HuffmanTable | null> = [null, null, null, null]
  const acTables: Array<HuffmanTable | null> = [null, null, null, null]
  let components: JpegComponent[] = []
  let width = 0
  let height = 0
  let restartInterval = 0
  let adobeTransform = -1
  let progressive = false
  let arithmetic = false
  let lossless = false
  let differential = false
  let framePrecision = 8
  let frameHasScan = false
  let hierarchy: JpegHierarchyDefinition | null = null
  let hierarchyReference: JpegHierarchyReference | null = null
  let scanState: JpegScanState = new Map()
  // Arithmetic conditioning (DAC marker; ISO 10918-1 defaults L=0, U=1, Kx=5)
  const arithDcL = new Uint8Array(4)
  const arithDcU = new Uint8Array(4).fill(1)
  const arithAcK = new Uint8Array(4).fill(5)
  let pos = 2

  for (;;) {
    if (pos + 1 >= data.length) throw new Error('JPEG decode error: unexpected end of data')
    if (data[pos] !== 0xFF) { pos++; continue }
    // Skip fill bytes: a marker may be preceded by any number of 0xFF bytes
    while (pos + 1 < data.length && data[pos + 1] === 0xFF) pos++
    const marker = data[pos + 1]!
    pos += 2
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue
    if (marker === 0xD9) {
      if (hierarchy !== null && frameHasScan) {
        validateCompletedJpegFrame(components, progressive, scanState)
        hierarchyReference = commitHierarchicalFrame(
          hierarchyReference, components, width, height, framePrecision,
          lossless, differential, quantTables,
        )
        frameHasScan = false
      }
      break
    }
    const length = (data[pos]! << 8) | data[pos + 1]!
    const segStart = pos + 2
    const segEnd = pos + length

    if (marker === 0xEE) {
      // APP14 Adobe marker: last byte is the color transform flag
      if (length >= 14 && data[segStart] === 0x41 && data[segStart + 1] === 0x64 && data[segStart + 2] === 0x6F && data[segStart + 3] === 0x62 && data[segStart + 4] === 0x65) {
        adobeTransform = data[segEnd - 1]!
      }
    } else if (marker === 0xDB) {
      let p = segStart
      while (p < segEnd) {
        const pq = data[p]! >> 4
        const tq = data[p]! & 15
        p++
        const table = new Uint16Array(64)
        for (let i = 0; i < 64; i++) {
          if (pq === 0) { table[ZIGZAG[i]!] = data[p]!; p++ }
          else { table[ZIGZAG[i]!] = (data[p]! << 8) | data[p + 1]!; p += 2 }
        }
        quantTables[tq] = table
      }
    } else if (marker === 0xC4) {
      let p = segStart
      while (p < segEnd) {
        const tc = data[p]! >> 4
        const th = data[p]! & 15
        p++
        const counts = new Uint8Array(16)
        let total = 0
        for (let i = 0; i < 16; i++) { counts[i] = data[p + i]!; total += counts[i]! }
        p += 16
        const values = data.slice(p, p + total)
        p += total
        const table = buildHuffmanTable(counts, values)
        if (tc === 0) dcTables[th] = table
        else acTables[th] = table
      }
      } else if ((marker >= 0xC0 && marker <= 0xC3)
        || (marker >= 0xC5 && marker <= 0xC7)
        || (marker >= 0xC9 && marker <= 0xCB)
        || (marker >= 0xCD && marker <= 0xCF)) {
      if (hierarchy !== null && frameHasScan) {
        validateCompletedJpegFrame(components, progressive, scanState)
        hierarchyReference = commitHierarchicalFrame(
          hierarchyReference, components, width, height, framePrecision,
          lossless, differential, quantTables,
        )
        frameHasScan = false
      } else if (hierarchy === null && components.length !== 0) {
        throw new Error('JPEG decode error: multiple frames require a DHP marker')
      }
      differential = marker === 0xC5 || marker === 0xC6 || marker === 0xC7
        || marker === 0xCD || marker === 0xCE || marker === 0xCF
      progressive = marker === 0xC2 || marker === 0xC6 || marker === 0xCA || marker === 0xCE
      arithmetic = marker === 0xC9 || marker === 0xCA || marker === 0xCB
        || marker === 0xCD || marker === 0xCE || marker === 0xCF
      lossless = marker === 0xC3 || marker === 0xC7 || marker === 0xCB || marker === 0xCF
      if (differential && hierarchy === null) throw new Error('JPEG decode error: differential frame requires a DHP marker')
      framePrecision = data[segStart]!
      // Baseline (SOF0) is 8-bit; extended/progressive DCT allow 8 or 12;
      // lossless allows 2..16 (ISO 10918-1 B.2.2)
      const precisionOk = lossless
        ? framePrecision >= 2 && framePrecision <= 16
        : marker === 0xC0 ? framePrecision === 8 : framePrecision === 8 || framePrecision === 12
      if (!precisionOk) {
        throw new Error(`JPEG decode error: unsupported sample precision ${framePrecision}`)
      }
      height = (data[segStart + 1]! << 8) | data[segStart + 2]!
      width = (data[segStart + 3]! << 8) | data[segStart + 4]!
      const count = data[segStart + 5]!
      if (width === 0 || height === 0 || count === 0 || segEnd - segStart !== 6 + count * 3) {
        throw new Error('JPEG decode error: invalid frame header')
      }
      if (hierarchy !== null && (framePrecision !== hierarchy.precision || count !== hierarchy.componentIds.length)) {
        throw new Error('JPEG decode error: frame does not match the DHP definition')
      }
      components = []
      scanState = new Map()
      for (let i = 0; i < count; i++) {
        const base = segStart + 6 + i * 3
        const id = data[base]!
        const h = data[base + 1]! >> 4
        const v = data[base + 1]! & 15
        const quantId = data[base + 2]!
        if (components.some(function (component) { return component.id === id })) throw new Error('JPEG decode error: duplicate frame component id')
        if (h < 1 || h > 4 || v < 1 || v > 4 || quantId > 3 || lossless && quantId !== 0) {
          throw new Error('JPEG decode error: invalid frame component parameters')
        }
        if (hierarchy !== null && !hierarchy.componentIds.includes(id)) throw new Error('JPEG decode error: frame component is absent from DHP')
        components.push({
          id,
          h,
          v,
          quantId,
          dcTable: 0,
          acTable: 0,
          blocksPerLine: 0,
          blocksPerColumn: 0,
          blocks: new Int16Array(0),
          pred: 0,
          output: new Int32Array(0),
          outputWidth: 0,
          outputHeight: 0,
        })
      }
    } else if (marker === 0xCC) {
      // DAC: arithmetic conditioning. DC (Tc=0): L = low nibble, U = high
      // nibble; AC (Tc=1): Kx.
      for (let p = segStart; p + 1 < segEnd; p += 2) {
        const tc = data[p]! >> 4
        const tb = data[p]! & 15
        const value = data[p + 1]!
        if (tb > 3) throw new Error('JPEG decode error: invalid DAC table id')
        if (tc === 0) {
          const l = value & 15
          const u = value >> 4
          if (l > u) throw new Error('JPEG decode error: invalid DAC DC conditioning')
          arithDcL[tb] = l
          arithDcU[tb] = u
        } else if (tc === 1) {
          if (value < 1 || value > 63) throw new Error('JPEG decode error: invalid DAC AC conditioning')
          arithAcK[tb] = value
        } else {
          throw new Error('JPEG decode error: invalid DAC table class')
        }
      }
    } else if (marker === 0xDD) {
      restartInterval = (data[segStart]! << 8) | data[segStart + 1]!
    } else if (marker === 0xDE) {
      if (hierarchy !== null || components.length !== 0) throw new Error('JPEG decode error: DHP must precede all frames')
      hierarchy = parseJpegHierarchyDefinition(data, segStart, segEnd)
    } else if (marker === 0xDF) {
      if (hierarchy === null || hierarchyReference === null && !frameHasScan) {
        throw new Error('JPEG decode error: EXP requires a decoded hierarchical reference frame')
      }
      if (frameHasScan) {
        validateCompletedJpegFrame(components, progressive, scanState)
        hierarchyReference = commitHierarchicalFrame(
          hierarchyReference, components, width, height, framePrecision,
          lossless, differential, quantTables,
        )
        frameHasScan = false
      }
      if (length !== 3) throw new Error('JPEG decode error: EXP marker length must be 3')
      const expansion = data[segStart]!
      if ((expansion & 0xEE) !== 0) throw new Error('JPEG decode error: EXP factors must be zero or one')
      hierarchyReference = expandHierarchicalReference(hierarchyReference!, (expansion >> 4) !== 0, (expansion & 1) !== 0)
    } else if (marker === 0xDA) {
      const scanCount = data[segStart]!
      if (components.length === 0) throw new Error('JPEG decode error: scan precedes frame header')
      if (scanCount < 1 || scanCount > 4 || scanCount > components.length || segEnd - segStart !== 4 + scanCount * 2) {
        throw new Error('JPEG decode error: invalid scan header')
      }
      const scanComponents: JpegComponent[] = []
      for (let i = 0; i < scanCount; i++) {
        const id = data[segStart + 1 + i * 2]!
        const tables = data[segStart + 2 + i * 2]!
        const component = components.find(function (c) { return c.id === id })
        if (component === undefined) throw new Error('JPEG decode error: scan references an unknown component')
        if (scanComponents.includes(component)) throw new Error('JPEG decode error: duplicate scan component')
        if ((tables >> 4) > 3 || (tables & 15) > 3) throw new Error('JPEG decode error: invalid scan table selector')
        component.dcTable = tables >> 4
        component.acTable = tables & 15
        scanComponents.push(component)
      }
      let scanDataUnits = 0
      for (let i = 0; i < scanComponents.length; i++) scanDataUnits += scanComponents[i]!.h * scanComponents[i]!.v
      if (scanComponents.length > 1 && scanDataUnits > 10) {
        throw new Error('JPEG decode error: interleaved scan has more than ten data units per MCU')
      }
      const spectralStart = data[segStart + 1 + scanCount * 2]!
      const spectralEnd = data[segStart + 2 + scanCount * 2]!
      const successive = data[segStart + 3 + scanCount * 2]!
      if (lossless) {
        if ((successive >> 4) !== 0 || spectralEnd !== 0) throw new Error('JPEG decode error: invalid lossless scan parameters')
        recordJpegScan(scanState, scanComponents, false, 0, 0, 0, 0)
      } else {
        recordJpegScan(scanState, scanComponents, progressive, spectralStart, spectralEnd, successive >> 4, successive & 15)
      }
      if (lossless) {
        // Ss selects the predictor and Al the point transform (ISO 10918-1 H.1)
        pos = arithmetic
          ? decodeArithmeticLosslessScan(
              data, segEnd, components, scanComponents, arithDcL, arithDcU,
              width, height, restartInterval, framePrecision, spectralStart,
              successive & 15, differential, hierarchy !== null,
            )
          : decodeLosslessScan(
              data, segEnd, components, scanComponents, dcTables, width, height,
              restartInterval, framePrecision, spectralStart, successive & 15,
              differential, hierarchy !== null,
            )
        frameHasScan = true
        continue
      }
      allocateComponentBlocks(components, width, height)
      pos = arithmetic
        ? decodeArithmeticScan(data, segEnd, components, scanComponents, arithDcL, arithDcU, arithAcK, width, height, restartInterval, progressive, spectralStart, spectralEnd, successive >> 4, successive & 15, differential)
        : decodeScan(data, segEnd, components, scanComponents, dcTables, acTables, width, height, restartInterval, progressive, spectralStart, spectralEnd, successive >> 4, successive & 15, differential)
      frameHasScan = true
      continue
    }
    pos = segEnd
  }

  if (hierarchy !== null) {
    if (hierarchyReference === null) throw new Error('JPEG decode error: hierarchical stream contains no frames')
    if (hierarchyReference.width !== hierarchy.width || hierarchyReference.height !== hierarchy.height) {
      throw new Error('JPEG decode error: final hierarchical frame dimensions do not match DHP')
    }
    components = hierarchyReference.components
    width = hierarchy.width
    height = hierarchy.height
    framePrecision = hierarchy.precision
  }
  if (hierarchy === null) validateCompletedJpegFrame(components, progressive, scanState)
  if (width === 0 || height === 0 || components.length === 0) {
    throw new Error('JPEG decode error: missing frame header')
  }
  if (hierarchy === null && !lossless) {
    for (let i = 0; i < components.length; i++) {
      dequantizeAndIdct(components[i]!, quantTables, framePrecision)
    }
  }
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < components.length; i++) {
    if (components[i]!.h > maxH) maxH = components[i]!.h
    if (components[i]!.v > maxV) maxV = components[i]!.v
  }
  return { width, height, components, adobeTransform, maxH, maxV, precision: framePrecision }
}

/** Test hook: raw component samples (after IDCT, before color transform) at one pixel */
export function debugJpegRawSamples(data: Uint8Array, x: number, y: number): { samples: number[], adobeTransform: number } {
  const result = decodeJpegInternal(data)
  const out: number[] = []
  for (let i = 0; i < result.components.length; i++) {
    const c = result.components[i]!
    const sx = Math.min(c.outputWidth - 1, Math.trunc(x * c.h / result.maxH))
    const sy = Math.min(c.outputHeight - 1, Math.trunc(y * c.v / result.maxV))
    out.push(c.output[sy * c.outputWidth + sx]!)
  }
  return { samples: out, adobeTransform: result.adobeTransform }
}

function buildHuffmanTable(counts: Uint8Array, values: Uint8Array): HuffmanTable {
  const minCode = new Int32Array(17)
  const maxCode = new Int32Array(17).fill(-1)
  const valPtr = new Int32Array(17)
  let code = 0
  let k = 0
  for (let length = 1; length <= 16; length++) {
    valPtr[length] = k
    minCode[length] = code
    code += counts[length - 1]!
    k += counts[length - 1]!
    maxCode[length] = counts[length - 1]! > 0 ? code - 1 : -1
    code <<= 1
  }
  return { codes: new Int32Array(0), values, minCode, maxCode, valPtr }
}

interface BitReader {
  data: Uint8Array
  pos: number
  end: number
  bitBuffer: number
  bitCount: number
  /** Position after the scan (set when a non-RST marker terminates it) */
  markerPos: number
}

function readBit(reader: BitReader): number {
  if (reader.bitCount === 0) {
    if (reader.pos >= reader.end) throw new Error('JPEG decode error: unexpected end of scan data')
    let byte = reader.data[reader.pos]!
    reader.pos++
    if (byte === 0xFF) {
      const next = reader.data[reader.pos]!
      if (next === 0x00) {
        reader.pos++
      } else {
        // A marker terminates the entropy segment; feed the byte-alignment
        // padding as 1-bits and leave the marker in place for the caller
        reader.pos--
        byte = 0xFF
      }
    }
    reader.bitBuffer = byte
    reader.bitCount = 8
  }
  reader.bitCount--
  return (reader.bitBuffer >> reader.bitCount) & 1
}

function decodeHuffman(reader: BitReader, table: HuffmanTable): number {
  let code = 0
  for (let length = 1; length <= 16; length++) {
    code = (code << 1) | readBit(reader)
    if (table.maxCode[length]! >= code && code >= table.minCode[length]!) {
      return table.values[table.valPtr[length]! + code - table.minCode[length]!]!
    }
  }
  throw new Error('JPEG decode error: invalid Huffman code')
}

function receiveAndExtend(reader: BitReader, bits: number): number {
  if (bits === 0) return 0
  let value = 0
  for (let i = 0; i < bits; i++) value = (value << 1) | readBit(reader)
  return value < (1 << (bits - 1)) ? value - (1 << bits) + 1 : value
}

function receiveBits(reader: BitReader, bits: number): number {
  let value = 0
  for (let i = 0; i < bits; i++) value = (value << 1) | readBit(reader)
  return value
}

/** Allocates coefficient storage for all frame components once, sized to the frame MCU grid. */
function allocateComponentBlocks(components: JpegComponent[], width: number, height: number): void {
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < components.length; i++) {
    if (components[i]!.h > maxH) maxH = components[i]!.h
    if (components[i]!.v > maxV) maxV = components[i]!.v
  }
  const mcusPerLine = Math.ceil(width / (8 * maxH))
  const mcusPerColumn = Math.ceil(height / (8 * maxV))
  for (let i = 0; i < components.length; i++) {
    const c = components[i]!
    const blocksPerLine = mcusPerLine * c.h
    const blocksPerColumn = mcusPerColumn * c.v
    if (c.blocks.length === blocksPerLine * blocksPerColumn * 64) continue
    c.blocksPerLine = blocksPerLine
    c.blocksPerColumn = blocksPerColumn
    c.blocks = new Int16Array(blocksPerLine * blocksPerColumn * 64)
  }
}

function decodeScan(
  data: Uint8Array,
  scanStart: number,
  frameComponents: JpegComponent[],
  scanComponents: JpegComponent[],
  dcTables: Array<HuffmanTable | null>,
  acTables: Array<HuffmanTable | null>,
  width: number,
  height: number,
  restartInterval: number,
  progressive: boolean,
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
  differential = false,
): number {
  if (!progressive && (spectralStart !== 0 || spectralEnd !== 63 || successiveHigh !== 0 || successiveLow !== 0)) {
    throw new Error('JPEG decode error: sequential scan parameters must be Ss=0 Se=63 Ah=0 Al=0')
  }
  if (progressive) {
    if (spectralStart < 0 || spectralStart > 63 || spectralEnd < spectralStart || spectralEnd > 63) {
      throw new Error('JPEG decode error: invalid progressive spectral selection')
    }
    if (successiveHigh < 0 || successiveHigh > 13 || successiveLow < 0 || successiveLow > 13) {
      throw new Error('JPEG decode error: invalid progressive successive approximation')
    }
    if (spectralStart > 0 && scanComponents.length !== 1) {
      throw new Error('JPEG decode error: progressive AC scans must contain one component')
    }
  }
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < frameComponents.length; i++) {
    if (frameComponents[i]!.h > maxH) maxH = frameComponents[i]!.h
    if (frameComponents[i]!.v > maxV) maxV = frameComponents[i]!.v
  }
  const mcusPerLine = Math.ceil(width / (8 * maxH))
  const mcusPerColumn = Math.ceil(height / (8 * maxV))
  for (let i = 0; i < scanComponents.length; i++) scanComponents[i]!.pred = 0

  // Non-interleaved scan (one component): the MCU is a single data unit and
  // the grid is the component's own block grid (JPEG A.2.2)
  const interleaved = scanComponents.length > 1
  const totalMcus = interleaved
    ? mcusPerLine * mcusPerColumn
    : Math.ceil(width * scanComponents[0]!.h / maxH / 8) * Math.ceil(height * scanComponents[0]!.v / maxV / 8)
  const singleBlocksPerLine = interleaved ? 0 : Math.ceil(width * scanComponents[0]!.h / maxH / 8)

  const reader: BitReader = { data, pos: scanStart, end: data.length, bitBuffer: 0, bitCount: 0, markerPos: -1 }
  let mcu = 0
  let eobRun = 0
  let expectedRestart = 0
  while (mcu < totalMcus) {
    const until = restartInterval > 0 ? Math.min(totalMcus, mcu + restartInterval) : totalMcus
    for (; mcu < until; mcu++) {
      if (interleaved) {
        const mcuRow = Math.trunc(mcu / mcusPerLine)
        const mcuCol = mcu % mcusPerLine
        for (let i = 0; i < scanComponents.length; i++) {
          const c = scanComponents[i]!
          const dcTable = dcTables[c.dcTable] ?? null
          const acTable = acTables[c.acTable] ?? null
          if ((!progressive || spectralStart === 0) && dcTable === null) throw new Error('JPEG decode error: missing Huffman table')
          if ((!progressive || spectralStart > 0) && acTable === null) throw new Error('JPEG decode error: missing Huffman table')
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) {
              const blockRow = mcuRow * c.v + v
              const blockCol = mcuCol * c.h + h
              const offset = (blockRow * c.blocksPerLine + blockCol) * 64
              if (progressive) {
                eobRun = decodeProgressiveBlock(reader, c, dcTable, acTable, offset, spectralStart, spectralEnd, successiveHigh, successiveLow, eobRun, differential)
              } else {
                decodeBlock(reader, c, dcTable!, acTable!, offset, differential)
              }
            }
          }
        }
      } else {
        const c = scanComponents[0]!
        const dcTable = dcTables[c.dcTable] ?? null
        const acTable = acTables[c.acTable] ?? null
        if ((!progressive || spectralStart === 0) && dcTable === null) throw new Error('JPEG decode error: missing Huffman table')
        if ((!progressive || spectralStart > 0) && acTable === null) throw new Error('JPEG decode error: missing Huffman table')
        const blockRow = Math.trunc(mcu / singleBlocksPerLine)
        const blockCol = mcu % singleBlocksPerLine
        const offset = (blockRow * c.blocksPerLine + blockCol) * 64
        if (progressive) {
          eobRun = decodeProgressiveBlock(reader, c, dcTable, acTable, offset, spectralStart, spectralEnd, successiveHigh, successiveLow, eobRun, differential)
        } else {
          decodeBlock(reader, c, dcTable!, acTable!, offset, differential)
        }
      }
    }
    if (mcu < totalMcus) {
      // Byte-align and consume the restart marker
      reader.bitCount = 0
      while (reader.pos + 1 < reader.end && !(data[reader.pos] === 0xFF && data[reader.pos + 1]! >= 0xD0 && data[reader.pos + 1]! <= 0xD7)) reader.pos++
      if (reader.pos + 1 >= reader.end) throw new Error('JPEG decode error: missing restart marker')
      if (data[reader.pos + 1] !== 0xD0 + expectedRestart) throw new Error('JPEG decode error: restart markers are out of sequence')
      reader.pos += 2
      expectedRestart = (expectedRestart + 1) & 7
      for (let i = 0; i < scanComponents.length; i++) scanComponents[i]!.pred = 0
      eobRun = 0
    }
  }
  // Skip to the next marker after the scan
  let p = reader.pos
  while (p + 1 < data.length && !(data[p] === 0xFF && data[p + 1] !== 0x00 && !(data[p + 1]! >= 0xD0 && data[p + 1]! <= 0xD7))) p++
  return p
}

function decodeProgressiveBlock(
  reader: BitReader,
  component: JpegComponent,
  dcTable: HuffmanTable | null,
  acTable: HuffmanTable | null,
  offset: number,
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
  eobRun: number,
  differential: boolean,
): number {
  if (spectralStart === 0) {
    if (spectralEnd !== 0) throw new Error('JPEG decode error: progressive DC scan must have Se=0')
    if (dcTable === null) throw new Error('JPEG decode error: missing Huffman table')
    if (successiveHigh === 0) decodeProgressiveDcFirst(reader, component, dcTable, offset, successiveLow, differential)
    else decodeProgressiveDcRefine(reader, component, offset, successiveLow)
    return eobRun
  }
  if (acTable === null) throw new Error('JPEG decode error: missing Huffman table')
  if (successiveHigh === 0) return decodeProgressiveAcFirst(reader, component, acTable, offset, spectralStart, spectralEnd, successiveLow, eobRun)
  return decodeProgressiveAcRefine(reader, component, acTable, offset, spectralStart, spectralEnd, successiveLow, eobRun)
}

function decodeProgressiveDcFirst(reader: BitReader, component: JpegComponent, dcTable: HuffmanTable, offset: number, successiveLow: number, differential: boolean): void {
  const t = decodeHuffman(reader, dcTable)
  const difference = receiveAndExtend(reader, t)
  component.pred = differential ? difference : component.pred + difference
  component.blocks[offset] = component.pred << successiveLow
}

function decodeProgressiveDcRefine(reader: BitReader, component: JpegComponent, offset: number, successiveLow: number): void {
  if (readBit(reader) !== 0) component.blocks[offset] = component.blocks[offset]! | (1 << successiveLow)
}

function decodeProgressiveAcFirst(
  reader: BitReader,
  component: JpegComponent,
  acTable: HuffmanTable,
  offset: number,
  spectralStart: number,
  spectralEnd: number,
  successiveLow: number,
  eobRun: number,
): number {
  if (eobRun > 0) return eobRun - 1
  const blocks = component.blocks
  let k = spectralStart
  while (k <= spectralEnd) {
    const rs = decodeHuffman(reader, acTable)
    const r = rs >> 4
    const s = rs & 15
    if (s === 0) {
      if (r === 15) {
        k += 16
        continue
      }
      return (1 << r) + receiveBits(reader, r) - 1
    }
    k += r
    if (k > spectralEnd) throw new Error('JPEG decode error: progressive AC coefficient index out of range')
    blocks[offset + ZIGZAG[k]!] = receiveAndExtend(reader, s) << successiveLow
    k++
  }
  return 0
}

function decodeProgressiveAcRefine(
  reader: BitReader,
  component: JpegComponent,
  acTable: HuffmanTable,
  offset: number,
  spectralStart: number,
  spectralEnd: number,
  successiveLow: number,
  eobRun: number,
): number {
  const blocks = component.blocks
  const bit = 1 << successiveLow
  let k = spectralStart
  if (eobRun > 0) {
    refineAcCoefficients(reader, blocks, offset, spectralStart, spectralEnd, bit)
    return eobRun - 1
  }
  while (k <= spectralEnd) {
    const rs = decodeHuffman(reader, acTable)
    let r = rs >> 4
    const s = rs & 15
    let newValue = 0
    if (s === 0) {
      if (r < 15) {
        eobRun = (1 << r) + receiveBits(reader, r)
        refineAcCoefficients(reader, blocks, offset, k, spectralEnd, bit)
        return eobRun - 1
      }
    } else {
      if (s !== 1) throw new Error('JPEG decode error: progressive AC refinement coefficient size must be 1')
      newValue = readBit(reader) === 0 ? -bit : bit
    }
    while (k <= spectralEnd) {
      const pos = offset + ZIGZAG[k]!
      const coeff = blocks[pos]!
      if (coeff !== 0) {
        if (readBit(reader) !== 0 && (Math.abs(coeff) & bit) === 0) blocks[pos] = coeff > 0 ? coeff + bit : coeff - bit
      } else {
        if (r === 0) break
        r--
      }
      k++
    }
    if (newValue !== 0) {
      if (k > spectralEnd) throw new Error('JPEG decode error: progressive AC refinement index out of range')
      blocks[offset + ZIGZAG[k]!] = newValue
    }
    k++
  }
  return 0
}

function refineAcCoefficients(reader: BitReader, blocks: Int16Array, offset: number, spectralStart: number, spectralEnd: number, bit: number): void {
  for (let k = spectralStart; k <= spectralEnd; k++) {
    const pos = offset + ZIGZAG[k]!
    const coeff = blocks[pos]!
    if (coeff !== 0 && readBit(reader) !== 0 && (Math.abs(coeff) & bit) === 0) {
      blocks[pos] = coeff > 0 ? coeff + bit : coeff - bit
    }
  }
}

function decodeBlock(reader: BitReader, component: JpegComponent, dcTable: HuffmanTable, acTable: HuffmanTable, offset: number, differential: boolean): void {
  const blocks = component.blocks
  const t = decodeHuffman(reader, dcTable)
  const difference = receiveAndExtend(reader, t)
  component.pred = differential ? difference : component.pred + difference
  blocks[offset] = component.pred
  let k = 1
  while (k < 64) {
    const rs = decodeHuffman(reader, acTable)
    const r = rs >> 4
    const s = rs & 15
    if (s === 0) {
      if (r !== 15) break
      k += 16
      continue
    }
    k += r
    if (k > 63) throw new Error('JPEG decode error: AC coefficient index out of range')
    blocks[offset + ZIGZAG[k]!] = receiveAndExtend(reader, s)
    k++
  }
}

// ---------------------------------------------------------------------------
// Arithmetic entropy decoding (ISO/IEC 10918-1 Annexes D and F, SOF9/SOF10)
// ---------------------------------------------------------------------------

// QM-coder probability estimation state machine (Table D.3). Each entry packs
// (Qe << 16) | (NextIndexMPS << 8) | (SwitchMPS << 7) | NextIndexLPS. Index
// 113 is the permanent near-0.5 state used for sign and refinement bits.
const JPEG_ARITH_QE = new Int32Array([
  0x5A1D0181, 0x2586020E, 0x11140310, 0x80B0412, 0x3D80514, 0x1DA0617, 0xE50719, 0x6F081C,
  0x36091E, 0x1A0A21, 0xD0B23, 0x60C09, 0x30D0A, 0x10D0C, 0x5A7F0F8F, 0x3F251024,
  0x2CF21126, 0x207C1227, 0x17B91328, 0x1182142A, 0xCEF152B, 0x9A1162D, 0x72F172E, 0x55C1830,
  0x4061931, 0x3031A33, 0x2401B34, 0x1B11C36, 0x1441D38, 0xF51E39, 0xB71F3B, 0x8A203C,
  0x68213E, 0x4E223F, 0x3B2320, 0x2C0921, 0x5AE125A5, 0x484C2640, 0x3A0D2741, 0x2EF12843,
  0x261F2944, 0x1F332A45, 0x19A82B46, 0x15182C48, 0x11772D49, 0xE742E4A, 0xBFB2F4B, 0x9F8304D,
  0x861314E, 0x706324F, 0x5CD3330, 0x4DE3432, 0x40F3532, 0x3633633, 0x2D43734, 0x25C3835,
  0x1F83936, 0x1A43A37, 0x1603B38, 0x1253C39, 0xF63D3A, 0xCB3E3B, 0xAB3F3D, 0x8F203D,
  0x5B1241C1, 0x4D044250, 0x412C4351, 0x37D84452, 0x2FE84553, 0x293C4654, 0x23794756, 0x1EDF4857,
  0x1AA94957, 0x174E4A48, 0x14244B48, 0x119C4C4A, 0xF6B4D4A, 0xD514E4B, 0xBB64F4D, 0xA40304D,
  0x583251D0, 0x4D1C5258, 0x438E5359, 0x3BDD545A, 0x34EE555B, 0x2EAE565C, 0x299A575D, 0x25164756,
  0x557059D8, 0x4CA95A5F, 0x44D95B60, 0x3E225C61, 0x38245D63, 0x32B45E63, 0x2E17565D, 0x56A860DF,
  0x4F466165, 0x47E56266, 0x41CF6367, 0x3C3D6468, 0x375E5D63, 0x52316669, 0x4C0F676A, 0x4639686B,
  0x415E6367, 0x56276AE9, 0x50E76B6C, 0x4B85676D, 0x55976D6E, 0x504F6B6F, 0x5A106FEE, 0x55226D70,
  0x59EB6FF0, 0x5A1D7171,
])
interface ArithReader {
  data: Uint8Array
  pos: number
  end: number
  /** Code register (base of the coding interval plus the bit buffer) */
  c: number
  /** Interval size register */
  a: number
  /** Floating cut point between base and buffer bits in C */
  ct: number
  /** Pending marker code (0 = none); zero bytes are stuffed once one is seen */
  marker: number
  /** Offset of the 0xFF that began the pending marker */
  markerAt: number
  /** Offset just past the pending marker code */
  markerEnd: number
}

function arithReadByte(r: ArithReader): number {
  if (r.marker !== 0) return 0
  if (r.pos >= r.end) {
    r.marker = 0xD9
    r.markerAt = r.end
    r.markerEnd = r.end
    return 0
  }
  const byte = r.data[r.pos]!
  if (byte !== 0xFF) {
    r.pos++
    return byte
  }
  const ffStart = r.pos
  let p = r.pos + 1
  while (p < r.end && r.data[p] === 0xFF) p++
  if (p < r.end && r.data[p] === 0x00) {
    r.pos = p + 1
    return 0xFF
  }
  // A marker (or the end of data) terminates the entropy segment; the coder
  // keeps consuming zero bytes until the scan is complete (D.2.6).
  r.marker = p < r.end ? r.data[p]! : 0xD9
  r.markerAt = ffStart
  r.markerEnd = p < r.end ? p + 1 : r.end
  return 0
}

/**
 * Decode one binary decision with the QM-coder (D.2). st[si] holds the
 * statistics bin: MPS sense in bit 7, state machine index in bits 0-6.
 * The floating C cut point scheme keeps CT <= 7 after initialization, so C
 * stays below 2^23 and 32-bit integer operations are exact.
 */
function arithDecode(r: ArithReader, st: Uint8Array, si: number): number {
  // Renormalization and data input (D.2.6); CT = -16 forces the two initial
  // bytes into C on the first call.
  while (r.a < 0x8000) {
    if (--r.ct < 0) {
      r.c = (r.c << 8) | arithReadByte(r)
      if ((r.ct += 8) < 0) {
        r.ct++
        if (r.ct === 0) r.a = 0x8000
      }
    }
    r.a <<= 1
  }
  const sv = st[si]!
  const packed = JPEG_ARITH_QE[sv & 0x7F]!
  const qe = packed >>> 16
  r.a -= qe
  const temp = r.a << r.ct
  if (r.c >= temp) {
    r.c -= temp
    // Conditional LPS exchange (D.2.4/D.2.5)
    if (r.a < qe) {
      r.a = qe
      st[si] = (sv & 0x80) ^ ((packed >>> 8) & 0xFF)
      return sv >> 7
    }
    r.a = qe
    st[si] = (sv & 0x80) ^ (packed & 0xFF)
    return (sv >> 7) ^ 1
  }
  if (r.a < 0x8000) {
    // Conditional MPS exchange
    if (r.a < qe) {
      st[si] = (sv & 0x80) ^ (packed & 0xFF)
      return (sv >> 7) ^ 1
    }
    st[si] = (sv & 0x80) ^ ((packed >>> 8) & 0xFF)
  }
  return sv >> 7
}

interface ArithScanState {
  dcStats: Uint8Array[]
  acStats: Uint8Array[]
  fixedBin: Uint8Array
  lastDc: Int32Array
  dcContext: Int32Array
}

interface ArithLosslessState {
  contexts: Uint8Array[]
  previousRows: Int32Array[]
  leftDifferences: Int32Array[]
}

function classifyArithmeticLosslessDifference(difference: number, lower: number, upper: number): number {
  const magnitude = Math.abs(difference)
  if (magnitude <= ((1 << lower) >> 1)) return 0
  if (magnitude <= (1 << upper)) return difference < 0 ? -1 : 1
  return difference < 0 ? -2 : 2
}

function decodeArithmeticLosslessDifference(
  reader: ArithReader,
  contexts: Uint8Array,
  leftDifference: number,
  aboveDifference: number,
  lower: number,
  upper: number,
): number {
  const signZero = (
    (classifyArithmeticLosslessDifference(leftDifference, lower, upper) + 2) * 5
    + classifyArithmeticLosslessDifference(aboveDifference, lower, upper) + 2
  ) * 4
  if (arithDecode(reader, contexts, signZero) === 0) return 0

  const negative = arithDecode(reader, contexts, signZero + 1) !== 0
  const signContext = signZero + (negative ? 3 : 2)
  let magnitude = 0
  if (arithDecode(reader, contexts, signContext) !== 0) {
    const highMagnitude = Math.abs(aboveDifference) > (1 << upper)
    const magnitudeBase = highMagnitude ? 130 : 100
    let category = 0
    let bit = 2
    while (arithDecode(reader, contexts, magnitudeBase + category) !== 0) {
      bit <<= 1
      category++
      if (category >= 15) throw new Error('JPEG decode error: invalid arithmetic lossless magnitude')
    }
    bit >>= 1
    magnitude = bit
    while ((bit >>= 1) !== 0) {
      if (arithDecode(reader, contexts, magnitudeBase + 15 + category) !== 0) magnitude |= bit
    }
  }
  return negative ? -magnitude - 1 : magnitude + 1
}

function decodeArithmeticScan(
  data: Uint8Array,
  scanStart: number,
  frameComponents: JpegComponent[],
  scanComponents: JpegComponent[],
  arithDcL: Uint8Array,
  arithDcU: Uint8Array,
  arithAcK: Uint8Array,
  width: number,
  height: number,
  restartInterval: number,
  progressive: boolean,
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
  differential = false,
): number {
  if (!progressive && (spectralStart !== 0 || spectralEnd !== 63 || successiveHigh !== 0 || successiveLow !== 0)) {
    throw new Error("JPEG decode error: sequential scan parameters must be Ss=0 Se=63 Ah=0 Al=0")
  }
  if (progressive) {
    if (spectralStart === 0 ? spectralEnd !== 0 : (spectralEnd < spectralStart || spectralEnd > 63)) {
      throw new Error("JPEG decode error: invalid progressive spectral selection")
    }
    if (spectralStart > 0 && scanComponents.length !== 1) {
      throw new Error("JPEG decode error: progressive AC scans must contain one component")
    }
    if (successiveHigh !== 0 && successiveHigh - 1 !== successiveLow) {
      throw new Error("JPEG decode error: invalid progressive successive approximation")
    }
    if (successiveLow > 13) {
      throw new Error("JPEG decode error: invalid progressive successive approximation")
    }
  }
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < frameComponents.length; i++) {
    if (frameComponents[i]!.h > maxH) maxH = frameComponents[i]!.h
    if (frameComponents[i]!.v > maxV) maxV = frameComponents[i]!.v
  }
  const mcusPerLine = Math.ceil(width / (8 * maxH))
  const interleaved = scanComponents.length > 1
  const totalMcus = interleaved
    ? mcusPerLine * Math.ceil(height / (8 * maxV))
    : Math.ceil(width * scanComponents[0]!.h / maxH / 8) * Math.ceil(height * scanComponents[0]!.v / maxV / 8)
  const singleBlocksPerLine = interleaved ? 0 : Math.ceil(width * scanComponents[0]!.h / maxH / 8)

  const r: ArithReader = { data, pos: scanStart, end: data.length, c: 0, a: 0, ct: -16, marker: 0, markerAt: -1, markerEnd: -1 }
  const state: ArithScanState = {
    dcStats: [new Uint8Array(64), new Uint8Array(64), new Uint8Array(64), new Uint8Array(64)],
    acStats: [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)],
    fixedBin: Uint8Array.of(113),
    lastDc: new Int32Array(scanComponents.length),
    dcContext: new Int32Array(scanComponents.length),
  }
  let mcu = 0
  let expectedRestart = 0
  while (mcu < totalMcus) {
    const until = restartInterval > 0 ? Math.min(totalMcus, mcu + restartInterval) : totalMcus
    for (; mcu < until; mcu++) {
      if (interleaved) {
        const mcuRow = Math.trunc(mcu / mcusPerLine)
        const mcuCol = mcu % mcusPerLine
        for (let i = 0; i < scanComponents.length; i++) {
          const c = scanComponents[i]!
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) {
              const offset = ((mcuRow * c.v + v) * c.blocksPerLine + (mcuCol * c.h + h)) * 64
              decodeArithmeticBlock(r, state, c, i, offset, arithDcL, arithDcU, arithAcK, progressive, spectralStart, spectralEnd, successiveHigh, successiveLow, differential)
            }
          }
        }
      } else {
        const c = scanComponents[0]!
        const offset = (Math.trunc(mcu / singleBlocksPerLine) * c.blocksPerLine + (mcu % singleBlocksPerLine)) * 64
        decodeArithmeticBlock(r, state, c, 0, offset, arithDcL, arithDcU, arithAcK, progressive, spectralStart, spectralEnd, successiveHigh, successiveLow, differential)
      }
    }
    if (mcu < totalMcus) {
      arithProcessRestart(r, state, scanComponents, progressive, spectralStart, successiveHigh, expectedRestart)
      expectedRestart = (expectedRestart + 1) & 7
    }
  }
  if (r.marker !== 0) return r.markerAt
  let p = r.pos
  while (p + 1 < data.length && !(data[p] === 0xFF && data[p + 1] !== 0x00 && !(data[p + 1]! >= 0xD0 && data[p + 1]! <= 0xD7))) p++
  return p
}

function decodeArithmeticBlock(
  r: ArithReader,
  s: ArithScanState,
  c: JpegComponent,
  ci: number,
  offset: number,
  arithDcL: Uint8Array,
  arithDcU: Uint8Array,
  arithAcK: Uint8Array,
  progressive: boolean,
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
  differential: boolean,
): void {
  if (!progressive) {
    arithDecodeDcDiff(r, s, c.dcTable, ci, arithDcL[c.dcTable]!, arithDcU[c.dcTable]!, !differential)
    c.blocks[offset] = s.lastDc[ci]!
    const st = s.acStats[c.acTable]!
    const kx = arithAcK[c.acTable]!
    for (let k = 1; k <= 63; k++) {
      let base = 3 * (k - 1)
      if (arithDecode(r, st, base) !== 0) break
      while (arithDecode(r, st, base + 1) === 0) {
        base += 3
        k++
        if (k > 63) throw new Error("JPEG decode error: invalid arithmetic AC data")
      }
      c.blocks[offset + ZIGZAG[k]!] = arithDecodeAcValue(r, s, st, base, k, kx)
    }
    return
  }
  if (spectralStart === 0) {
    if (successiveHigh === 0) {
      // DC first scan (F.2.4.1)
      arithDecodeDcDiff(r, s, c.dcTable, ci, arithDcL[c.dcTable]!, arithDcU[c.dcTable]!, !differential)
      c.blocks[offset] = s.lastDc[ci]! << successiveLow
    } else if (arithDecode(r, s.fixedBin, 0) !== 0) {
      // DC refinement: the next bit of the two's-complement DC value
      c.blocks[offset] = c.blocks[offset]! | (1 << successiveLow)
    }
    return
  }
  const st = s.acStats[c.acTable]!
  if (successiveHigh === 0) {
    // AC first scan (F.2.4.2)
    const kx = arithAcK[c.acTable]!
    for (let k = spectralStart; k <= spectralEnd; k++) {
      let base = 3 * (k - 1)
      if (arithDecode(r, st, base) !== 0) break
      while (arithDecode(r, st, base + 1) === 0) {
        base += 3
        k++
        if (k > spectralEnd) throw new Error("JPEG decode error: invalid arithmetic AC data")
      }
      c.blocks[offset + ZIGZAG[k]!] = arithDecodeAcValue(r, s, st, base, k, kx) << successiveLow
    }
    return
  }
  // AC refinement scan (G.1.3.3)
  const p1 = 1 << successiveLow
  const m1 = -1 << successiveLow
  let kex = spectralEnd
  while (kex > 0 && c.blocks[offset + ZIGZAG[kex]!] === 0) kex--
  for (let k = spectralStart; k <= spectralEnd; k++) {
    let base = 3 * (k - 1)
    if (k > kex && arithDecode(r, st, base) !== 0) break
    for (;;) {
      const pos = offset + ZIGZAG[k]!
      const coeff = c.blocks[pos]!
      if (coeff !== 0) {
        if (arithDecode(r, st, base + 2) !== 0) {
          c.blocks[pos] = coeff + (coeff < 0 ? m1 : p1)
        }
        break
      }
      if (arithDecode(r, st, base + 1) !== 0) {
        c.blocks[pos] = arithDecode(r, s.fixedBin, 0) !== 0 ? m1 : p1
        break
      }
      base += 3
      k++
      if (k > spectralEnd) throw new Error("JPEG decode error: invalid arithmetic AC refinement data")
    }
  }
}

/** Decode a DC difference and accumulate the 16-bit prediction (F.2.4.1). */
function arithDecodeDcDiff(r: ArithReader, s: ArithScanState, tbl: number, ci: number, dcL: number, dcU: number, accumulate: boolean): number {
  const st = s.dcStats[tbl]!
  const base = s.dcContext[ci]!
  if (arithDecode(r, st, base) === 0) {
    s.dcContext[ci] = 0
    if (!accumulate) s.lastDc[ci] = 0
    return 0
  }
  const sign = arithDecode(r, st, base + 1)
  let si = base + 2 + sign
  let m = arithDecode(r, st, si)
  if (m !== 0) {
    // Magnitude category (F.23); X1 = bin 20
    si = 20
    while (arithDecode(r, st, si) !== 0) {
      m <<= 1
      if (m === 0x8000) throw new Error("JPEG decode error: invalid arithmetic DC magnitude")
      si++
    }
  }
  // Conditioning category for the next block (F.1.4.4.1.2)
  if (m < ((1 << dcL) >> 1)) s.dcContext[ci] = 0
  else if (m > ((1 << dcU) >> 1)) s.dcContext[ci] = 12 + sign * 4
  else s.dcContext[ci] = 4 + sign * 4
  let v = m
  si += 14
  m >>= 1
  while (m !== 0) {
    if (arithDecode(r, st, si) !== 0) v |= m
    m >>= 1
  }
  v++
  if (sign !== 0) v = -v
  s.lastDc[ci] = accumulate ? (s.lastDc[ci]! + v) & 0xFFFF : v
  return v
}

/** Decode one nonzero AC coefficient value (F.2.4.2/F.21-F.24). */
function arithDecodeAcValue(r: ArithReader, s: ArithScanState, st: Uint8Array, base: number, k: number, kx: number): number {
  const sign = arithDecode(r, s.fixedBin, 0)
  let si = base + 2
  let m = arithDecode(r, st, si)
  if (m !== 0 && arithDecode(r, st, si) !== 0) {
    // Magnitude category >= 2; X2/X3 areas at bins 189/217 by Kx
    m = 2
    si = k <= kx ? 189 : 217
    while (arithDecode(r, st, si) !== 0) {
      m <<= 1
      if (m === 0x8000) throw new Error("JPEG decode error: invalid arithmetic AC magnitude")
      si++
    }
  }
  let v = m
  si += 14
  m >>= 1
  while (m !== 0) {
    if (arithDecode(r, st, si) !== 0) v |= m
    m >>= 1
  }
  v++
  return sign !== 0 ? -v : v
}

/** Resynchronize at a restart marker: reset the coder and statistics (F.2.4.4). */
function arithProcessRestart(
  r: ArithReader,
  s: ArithScanState,
  scanComponents: JpegComponent[],
  progressive: boolean,
  spectralStart: number,
  successiveHigh: number,
  expectedRestart: number,
): void {
  arithResetReaderAtRestart(r, expectedRestart)
  const resetDc = !progressive || (spectralStart === 0 && successiveHigh === 0)
  const resetAc = !progressive || spectralStart > 0
  for (let i = 0; i < scanComponents.length; i++) {
    const comp = scanComponents[i]!
    if (resetDc) {
      s.dcStats[comp.dcTable]!.fill(0)
      s.lastDc[i] = 0
      s.dcContext[i] = 0
    }
    if (resetAc) s.acStats[comp.acTable]!.fill(0)
  }
}

function arithResetReaderAtRestart(r: ArithReader, expectedRestart: number): void {
  if (r.marker === 0) {
    // The decoder may not have consumed up to the marker; scan ahead for it,
    // skipping stuffed FF00 pairs inside the remaining entropy bytes.
    let p = r.pos
    for (;;) {
      while (p < r.end && r.data[p] !== 0xFF) p++
      let q = p + 1
      while (q < r.end && r.data[q] === 0xFF) q++
      if (q >= r.end) throw new Error("JPEG decode error: missing restart marker")
      if (r.data[q] !== 0x00) {
        r.marker = r.data[q]!
        r.markerAt = p
        r.markerEnd = q + 1
        break
      }
      p = q + 1
    }
  }
  if (r.marker < 0xD0 || r.marker > 0xD7) throw new Error("JPEG decode error: missing restart marker")
  if (r.marker !== 0xD0 + expectedRestart) throw new Error('JPEG decode error: restart markers are out of sequence')
  r.pos = r.markerEnd
  r.marker = 0
  r.markerAt = -1
  r.markerEnd = -1
  r.c = 0
  r.a = 0
  r.ct = -16
}

// ---------------------------------------------------------------------------
// Lossless (SOF3/SOF7/SOF11/SOF15) decoding — ISO/IEC 10918-1 Annex H
// ---------------------------------------------------------------------------

function decodeArithmeticLosslessScan(
  data: Uint8Array,
  scanStart: number,
  frameComponents: JpegComponent[],
  scanComponents: JpegComponent[],
  arithDcL: Uint8Array,
  arithDcU: Uint8Array,
  width: number,
  height: number,
  restartInterval: number,
  precision: number,
  predictor: number,
  pointTransform: number,
  differential: boolean,
  preservePrecision: boolean,
): number {
  if (differential ? predictor !== 0 : predictor < 1 || predictor > 7) {
    throw new Error('JPEG decode error: invalid lossless predictor')
  }
  if (pointTransform >= precision) throw new Error('JPEG decode error: invalid lossless point transform')
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < frameComponents.length; i++) {
    if (frameComponents[i]!.h > maxH) maxH = frameComponents[i]!.h
    if (frameComponents[i]!.v > maxV) maxV = frameComponents[i]!.v
  }
  const interleaved = scanComponents.length > 1
  const mcusPerLine = Math.ceil(width / maxH)
  const mcusPerColumn = Math.ceil(height / maxV)
  const grids: Int32Array[] = []
  const gridWidths: number[] = []
  const resetRows: number[] = []
  for (let i = 0; i < scanComponents.length; i++) {
    const component = scanComponents[i]!
    const gridWidth = interleaved ? mcusPerLine * component.h : Math.ceil(width * component.h / maxH)
    const gridHeight = interleaved ? mcusPerColumn * component.v : Math.ceil(height * component.v / maxV)
    grids.push(new Int32Array(gridWidth * gridHeight))
    gridWidths.push(gridWidth)
    resetRows.push(0)
  }
  const totalMcus = interleaved ? mcusPerLine * mcusPerColumn : grids[0]!.length
  const initial = 1 << (precision - pointTransform - 1)
  const reader: ArithReader = {
    data, pos: scanStart, end: data.length,
    c: 0, a: 0, ct: -16, marker: 0, markerAt: -1, markerEnd: -1,
  }
  const state: ArithLosslessState = {
    contexts: [new Uint8Array(160), new Uint8Array(160), new Uint8Array(160), new Uint8Array(160)],
    previousRows: gridWidths.map((gridWidth) => new Int32Array(gridWidth)),
    leftDifferences: scanComponents.map((component) => new Int32Array(component.v)),
  }
  let mcu = 0
  let expectedRestart = 0
  while (mcu < totalMcus) {
    const until = restartInterval > 0 ? Math.min(totalMcus, mcu + restartInterval) : totalMcus
    for (; mcu < until; mcu++) {
      if (interleaved) {
        const mcuRow = Math.trunc(mcu / mcusPerLine)
        const mcuColumn = mcu % mcusPerLine
        for (let i = 0; i < scanComponents.length; i++) {
          const component = scanComponents[i]!
          if (mcuColumn === 0) state.leftDifferences[i]!.fill(0)
          for (let vertical = 0; vertical < component.v; vertical++) {
            for (let horizontal = 0; horizontal < component.h; horizontal++) {
              const column = mcuColumn * component.h + horizontal
              const rowInMcu = vertical
              const difference = decodeArithmeticLosslessDifference(
                reader, state.contexts[component.dcTable]!, state.leftDifferences[i]![rowInMcu]!,
                state.previousRows[i]![column]!, arithDcL[component.dcTable]!, arithDcU[component.dcTable]!,
              )
              state.leftDifferences[i]![rowInMcu] = difference
              state.previousRows[i]![column] = difference
              storeLosslessDifference(
                grids[i]!, gridWidths[i]!, column,
                mcuRow * component.v + vertical, resetRows[i]!, predictor, initial,
                differential, difference,
              )
            }
          }
        }
      } else {
        const component = scanComponents[0]!
        const gridWidth = gridWidths[0]!
        const column = mcu % gridWidth
        if (column === 0) state.leftDifferences[0]!.fill(0)
        const difference = decodeArithmeticLosslessDifference(
          reader, state.contexts[component.dcTable]!, state.leftDifferences[0]![0]!,
          state.previousRows[0]![column]!, arithDcL[component.dcTable]!, arithDcU[component.dcTable]!,
        )
        state.leftDifferences[0]![0] = difference
        state.previousRows[0]![column] = difference
        storeLosslessDifference(
          grids[0]!, gridWidth, column, Math.trunc(mcu / gridWidth),
          resetRows[0]!, predictor, initial, differential, difference,
        )
      }
    }
    if (mcu < totalMcus) {
      arithResetReaderAtRestart(reader, expectedRestart)
      expectedRestart = (expectedRestart + 1) & 7
      for (let table = 0; table < state.contexts.length; table++) state.contexts[table]!.fill(0)
      for (let i = 0; i < scanComponents.length; i++) {
        const component = scanComponents[i]!
        state.previousRows[i]!.fill(0)
        state.leftDifferences[i]!.fill(0)
        resetRows[i] = interleaved
          ? Math.trunc(mcu / mcusPerLine) * component.v
          : Math.trunc(mcu / gridWidths[i]!)
      }
    }
  }
  for (let i = 0; i < scanComponents.length; i++) {
    const component = scanComponents[i]!
    const grid = grids[i]!
    const output = new Int32Array(grid.length)
    for (let sample = 0; sample < grid.length; sample++) {
      const value = grid[sample]! << pointTransform
      output[sample] = differential || preservePrecision ? value : value & 0xFFFF
    }
    component.output = output
    component.outputWidth = gridWidths[i]!
    component.outputHeight = grid.length / gridWidths[i]!
  }
  if (reader.marker !== 0) return reader.markerAt
  let position = reader.pos
  while (position + 1 < data.length
      && !(data[position] === 0xFF && data[position + 1] !== 0x00
        && !(data[position + 1]! >= 0xD0 && data[position + 1]! <= 0xD7))) position++
  return position
}

/**
 * Decode one lossless scan: Huffman-coded sample differences against one of
 * the seven spatial predictors (Table H.1), reconstructed modulo 2^16 with
 * the point transform applied on output (H.1.2). The first line of the scan
 * (and of each restart interval) uses the horizontal predictor with
 * 2^(P-Pt-1) for its first sample; the first sample of every other line uses
 * the vertical predictor (H.1.2.2). Fills each component with 8-bit output
 * samples (higher precisions are scaled at this boundary — the rendering
 * pipeline is 8-bit RGBA).
 */
function decodeLosslessScan(
  data: Uint8Array,
  scanStart: number,
  frameComponents: JpegComponent[],
  scanComponents: JpegComponent[],
  dcTables: Array<HuffmanTable | null>,
  width: number,
  height: number,
  restartInterval: number,
  precision: number,
  predictor: number,
  pointTransform: number,
  differential = false,
  preservePrecision = false,
): number {
  if (differential ? predictor !== 0 : predictor < 1 || predictor > 7) {
    throw new Error("JPEG decode error: invalid lossless predictor")
  }
  if (pointTransform >= precision) throw new Error("JPEG decode error: invalid lossless point transform")
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < frameComponents.length; i++) {
    if (frameComponents[i]!.h > maxH) maxH = frameComponents[i]!.h
    if (frameComponents[i]!.v > maxV) maxV = frameComponents[i]!.v
  }
  const interleaved = scanComponents.length > 1
  const mcusPerLine = Math.ceil(width / maxH)
  const mcusPerColumn = Math.ceil(height / maxV)
  const grids: Int32Array[] = []
  const gridWidths: number[] = []
  // Row index at which prediction (re)starts for each component: that row is
  // coded with the first-line rules.
  const resetRows: number[] = []
  for (let i = 0; i < scanComponents.length; i++) {
    const c = scanComponents[i]!
    const w = interleaved ? mcusPerLine * c.h : Math.ceil(width * c.h / maxH)
    const h = interleaved ? mcusPerColumn * c.v : Math.ceil(height * c.v / maxV)
    grids.push(new Int32Array(w * h))
    gridWidths.push(w)
    resetRows.push(0)
    if (dcTables[c.dcTable] === null) throw new Error("JPEG decode error: missing Huffman table")
  }
  const totalMcus = interleaved ? mcusPerLine * mcusPerColumn : grids[0]!.length
  const initial = 1 << (precision - pointTransform - 1)

  const reader: BitReader = { data, pos: scanStart, end: data.length, bitBuffer: 0, bitCount: 0, markerPos: -1 }
  let mcu = 0
  let expectedRestart = 0
  while (mcu < totalMcus) {
    const until = restartInterval > 0 ? Math.min(totalMcus, mcu + restartInterval) : totalMcus
    for (; mcu < until; mcu++) {
      if (interleaved) {
        const mcuRow = Math.trunc(mcu / mcusPerLine)
        const mcuCol = mcu % mcusPerLine
        for (let i = 0; i < scanComponents.length; i++) {
          const c = scanComponents[i]!
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) {
              decodeLosslessSample(reader, dcTables[c.dcTable]!, grids[i]!, gridWidths[i]!, mcuCol * c.h + h, mcuRow * c.v + v, resetRows[i]!, predictor, initial, differential)
            }
          }
        }
      } else {
        const w = gridWidths[0]!
        decodeLosslessSample(reader, dcTables[scanComponents[0]!.dcTable]!, grids[0]!, w, mcu % w, Math.trunc(mcu / w), resetRows[0]!, predictor, initial, differential)
      }
    }
    if (mcu < totalMcus) {
      // Byte-align, consume the restart marker, and restart prediction: the
      // next line of each component is coded with the first-line rules.
      reader.bitCount = 0
      while (reader.pos + 1 < reader.end && !(data[reader.pos] === 0xFF && data[reader.pos + 1]! >= 0xD0 && data[reader.pos + 1]! <= 0xD7)) reader.pos++
      if (reader.pos + 1 >= reader.end) throw new Error("JPEG decode error: missing restart marker")
      if (data[reader.pos + 1] !== 0xD0 + expectedRestart) throw new Error('JPEG decode error: restart markers are out of sequence')
      reader.pos += 2
      expectedRestart = (expectedRestart + 1) & 7
      for (let i = 0; i < scanComponents.length; i++) {
        const c = scanComponents[i]!
        resetRows[i] = interleaved ? Math.trunc(mcu / mcusPerLine) * c.v : Math.trunc(mcu / gridWidths[i]!)
      }
    }
  }
  // Apply the point transform while retaining the frame sample precision.
  for (let i = 0; i < scanComponents.length; i++) {
    const c = scanComponents[i]!
    const grid = grids[i]!
    const w = gridWidths[i]!
    const output = new Int32Array(grid.length)
    for (let p = 0; p < grid.length; p++) {
      const value = grid[p]! << pointTransform
      output[p] = differential || preservePrecision ? value : value & 0xFFFF
    }
    c.output = output
    c.outputWidth = w
    c.outputHeight = grid.length / w
  }
  let p = reader.pos
  while (p + 1 < data.length && !(data[p] === 0xFF && data[p + 1] !== 0x00 && !(data[p + 1]! >= 0xD0 && data[p + 1]! <= 0xD7))) p++
  return p
}

function decodeLosslessSample(
  reader: BitReader,
  dcTable: HuffmanTable,
  grid: Int32Array,
  gridWidth: number,
  col: number,
  row: number,
  resetRow: number,
  predictor: number,
  initial: number,
  differential: boolean,
): void {
  const s = decodeHuffman(reader, dcTable)
  // SSSS = 16 codes a difference of 32768 with no additional bits (H.1.2.2)
  const diff = s === 0 ? 0 : s === 16 ? 32768 : receiveAndExtend(reader, s)
  storeLosslessDifference(grid, gridWidth, col, row, resetRow, predictor, initial, differential, diff)
}

function storeLosslessDifference(
  grid: Int32Array,
  gridWidth: number,
  col: number,
  row: number,
  resetRow: number,
  predictor: number,
  initial: number,
  differential: boolean,
  diff: number,
): void {
  if (differential) {
    grid[row * gridWidth + col] = diff
    return
  }
  let prediction: number
  if (row === resetRow) {
    prediction = col === 0 ? initial : grid[row * gridWidth + col - 1]!
  } else if (col === 0) {
    prediction = grid[(row - 1) * gridWidth]!
  } else {
    const ra = grid[row * gridWidth + col - 1]!
    const rb = grid[(row - 1) * gridWidth + col]!
    const rc = grid[(row - 1) * gridWidth + col - 1]!
    switch (predictor) {
      case 1: prediction = ra; break
      case 2: prediction = rb; break
      case 3: prediction = rc; break
      case 4: prediction = ra + rb - rc; break
      case 5: prediction = ra + ((rb - rc) >> 1); break
      case 6: prediction = rb + ((ra - rc) >> 1); break
      default: prediction = (ra + rb) >> 1; break
    }
  }
  grid[row * gridWidth + col] = (prediction + diff) & 0xFFFF
}

function dequantizeAndIdct(
  component: JpegComponent,
  quantTables: Array<Uint16Array | null>,
  precision: number,
  differential = false,
  preservePrecision = false,
): void {
  const quant = quantTables[component.quantId] ?? null
  if (quant === null) throw new Error('JPEG decode error: missing quantization table')
  const outputWidth = component.blocksPerLine * 8
  const outputHeight = component.blocksPerColumn * 8
  const output = new Int32Array(outputWidth * outputHeight)
  // Level shift and clamp at the frame precision (F.1.1.3 / A.3.1).
  const levelShift = 1 << (precision - 1)
  const maxValue = (1 << precision) - 1
  const block = new Float32Array(64)
  for (let blockRow = 0; blockRow < component.blocksPerColumn; blockRow++) {
    for (let blockCol = 0; blockCol < component.blocksPerLine; blockCol++) {
      const offset = (blockRow * component.blocksPerLine + blockCol) * 64
      for (let i = 0; i < 64; i++) block[i] = component.blocks[offset + i]! * quant[i]!
      idct8x8(block)
      const outBase = blockRow * 8 * outputWidth + blockCol * 8
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          let value = Math.round(block[y * 8 + x]! + (differential ? 0 : levelShift))
          if (!differential) value = value < 0 ? 0 : value > maxValue ? maxValue : value
          output[outBase + y * outputWidth + x] = value
        }
      }
    }
  }
  component.output = output
  component.outputWidth = outputWidth
  component.outputHeight = outputHeight
}

const IDCT_C = new Float32Array(8)
for (let i = 0; i < 8; i++) IDCT_C[i] = i === 0 ? Math.SQRT1_2 : 1
const IDCT_COS = new Float32Array(64)
for (let x = 0; x < 8; x++) {
  for (let u = 0; u < 8; u++) {
    IDCT_COS[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  }
}

/** Separable 2D inverse DCT on one 8x8 block (in place) */
function idct8x8(block: Float32Array): void {
  const tmp = new Float32Array(64)
  // Rows
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0
      for (let u = 0; u < 8; u++) {
        sum += IDCT_C[u]! * block[y * 8 + u]! * IDCT_COS[x * 8 + u]!
      }
      tmp[y * 8 + x] = sum / 2
    }
  }
  // Columns
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0
      for (let v = 0; v < 8; v++) {
        sum += IDCT_C[v]! * tmp[v * 8 + x]! * IDCT_COS[y * 8 + v]!
      }
      block[y * 8 + x] = sum / 2
    }
  }
}

function convertToRgba(components: JpegComponent[], width: number, height: number, precision: number, colorTransform: 0 | 1 | 2, decode: number[] | null): Uint8Array {
  return convertToRgbaAndSamples(components, width, height, precision, colorTransform, decode, false).rgba
}

function convertToRgbaAndSamples(
  components: JpegComponent[],
  width: number,
  height: number,
  precision: number,
  colorTransform: 0 | 1 | 2,
  decode: number[] | null,
  captureSamples: boolean,
): { rgba: Uint8Array, samples: Uint8Array | Uint16Array | null } {
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < components.length; i++) {
    if (components[i]!.h > maxH) maxH = components[i]!.h
    if (components[i]!.v > maxV) maxV = components[i]!.v
  }
  const rgba = new Uint8Array(width * height * 4)
  const count = components.length
  const maxValue = Math.pow(2, precision) - 1
  const center = Math.pow(2, precision - 1)
  const sample = new Array<number>(count).fill(0)
  const samples = captureSamples ? extractJpegSamples(components, width, height, precision, colorTransform) : null

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let i = 0; i < count; i++) {
        let value = samples === null
          ? transformedJpegSample(components, x, y, i, maxH, maxV, colorTransform, center, maxValue)
          : samples[(y * width + x) * count + i]!
        if (decode !== null && decode.length >= (i + 1) * 2) {
          // PDF /Decode remaps filter output samples before color-space conversion.
          value = clampSample((decode[i * 2]! + value / maxValue * (decode[i * 2 + 1]! - decode[i * 2]!)) * maxValue, maxValue)
        }
        sample[i] = value
      }
      const pos = (y * width + x) * 4
      if (count === 1) {
        rgba[pos] = toByte(sample[0]!, maxValue)
        rgba[pos + 1] = rgba[pos]!
        rgba[pos + 2] = rgba[pos]!
      } else if (count === 3) {
        rgba[pos] = toByte(sample[0]!, maxValue)
        rgba[pos + 1] = toByte(sample[1]!, maxValue)
        rgba[pos + 2] = toByte(sample[2]!, maxValue)
      } else if (count === 4) {
        const ink0 = sample[0]!
        const ink1 = sample[1]!
        const ink2 = sample[2]!
        const ink3 = sample[3]!
        const k = maxValue - ink3
        rgba[pos] = toByte((maxValue - ink0) * k / maxValue, maxValue)
        rgba[pos + 1] = toByte((maxValue - ink1) * k / maxValue, maxValue)
        rgba[pos + 2] = toByte((maxValue - ink2) * k / maxValue, maxValue)
      } else {
        throw new Error(`JPEG decode error: unsupported component count ${count}`)
      }
      rgba[pos + 3] = 255
    }
  }
  return { rgba, samples }
}

function extractJpegSamples(components: JpegComponent[], width: number, height: number, precision: number, colorTransform: 0 | 1 | 2): Uint8Array | Uint16Array {
  const count = components.length
  if (colorTransform !== 0 && count !== 3 && count !== 4) {
    throw new Error(`JPEG decode error: color transform ${colorTransform} requires three or four components`)
  }
  let maxH = 1
  let maxV = 1
  for (let i = 0; i < count; i++) {
    if (components[i]!.h > maxH) maxH = components[i]!.h
    if (components[i]!.v > maxV) maxV = components[i]!.v
  }
  const maxValue = Math.pow(2, precision) - 1
  const center = Math.pow(2, precision - 1)
  const out = precision <= 8 ? new Uint8Array(width * height * count) : new Uint16Array(width * height * count)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * count
      for (let component = 0; component < count; component++) {
        out[base + component] = transformedJpegSample(components, x, y, component, maxH, maxV, colorTransform, center, maxValue)
      }
    }
  }
  return out
}

function transformedJpegSample(
  components: JpegComponent[], x: number, y: number, component: number,
  maxH: number, maxV: number, colorTransform: 0 | 1 | 2,
  center: number, maxValue: number,
): number {
  const source = components[component]!
  const sx = Math.min(source.outputWidth - 1, Math.trunc(x * source.h / maxH))
  const sy = Math.min(source.outputHeight - 1, Math.trunc(y * source.v / maxV))
  if (colorTransform === 0 || component >= 3) return source.output[sy * source.outputWidth + sx]!
  const first = components[0]!
  const second = components[1]!
  const third = components[2]!
  const firstValue = first.output[Math.min(first.outputHeight - 1, Math.trunc(y * first.v / maxV)) * first.outputWidth + Math.min(first.outputWidth - 1, Math.trunc(x * first.h / maxH))]!
  const secondValue = second.output[Math.min(second.outputHeight - 1, Math.trunc(y * second.v / maxV)) * second.outputWidth + Math.min(second.outputWidth - 1, Math.trunc(x * second.h / maxH))]!
  const thirdValue = third.output[Math.min(third.outputHeight - 1, Math.trunc(y * third.v / maxV)) * third.outputWidth + Math.min(third.outputWidth - 1, Math.trunc(x * third.h / maxH))]!
  let value: number
  if (component === 0) value = firstValue + 1.402 * (thirdValue - center)
  else if (component === 1) value = firstValue - 0.344136 * (secondValue - center) - 0.714136 * (thirdValue - center)
  else value = firstValue + 1.772 * (secondValue - center)
  const transformed = clampSample(value, maxValue)
  return colorTransform === 2 ? maxValue - transformed : transformed
}

function clampSample(value: number, maxValue: number): number {
  const rounded = Math.round(value)
  return rounded < 0 ? 0 : rounded > maxValue ? maxValue : rounded
}

function toByte(value: number, maxValue: number): number {
  return clampByte(value * 255 / maxValue)
}

function clampByte(value: number): number {
  const rounded = Math.round(value)
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded
}
