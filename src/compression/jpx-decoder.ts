/**
 * JPEG 2000 (ISO/IEC 15444-1) decoder for the PDF /JPXDecode filter.
 *
 * Scope: the profile PDF producers emit — JP2 container or raw codestream,
 * reversible 5/3 and irreversible 9/7 wavelets, scalar quantization,
 * LRCP/RLCP/RPCL/PCRL/CPRL progressions, explicit precinct partitions,
 * multiple quality layers, multi-tile grids, RCT/ICT component transforms,
 * Maxshift ROI, progression changes, and all Part 1 code-block style flags.
 */

import { MqDecoder, newMqContext, type MqContext } from './mq-decoder.js'

export interface JpxImage {
  width: number
  height: number
  componentCount: number
  bitDepth: number
  componentBitDepths: readonly number[]
  componentSigned: readonly boolean[]
  colorSpace: 'gray' | 'rgb' | 'sycc' | 'unknown'
  alphaChannel: number | null
  premultipliedAlpha: boolean
  alphaChannels: readonly { channel: number, association: number, premultiplied: boolean }[]
  colorChannels: readonly number[]
  colorProfile: Uint8Array | null
  colorSpecifications: readonly JpxColorSpecification[]
  /** Whether the JP2 header contains a BPCC box. */
  bitsPerComponentBoxPresent: boolean
  /** Component-interleaved unsigned samples at each component's declared precision. */
  data: Uint8Array | Uint16Array | Float64Array
}

export interface JpxColorSpecification {
  method: number
  precedence: number
  approximation: number
  enumeratedColorSpace: number | null
}

// ─── Entry ───

export function decodeJpx(bytes: Uint8Array): JpxImage {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0x4F) return decodeCodestream(bytes)
  const container = parseJp2(bytes)
  return applyJp2ChannelMapping(decodeCodestream(container.codestream), container)
}

interface Jp2Palette {
  entries: number[][]
  depths: number[]
  signed: boolean[]
}

interface Jp2ChannelMap {
  component: number
  type: number
  column: number
}

interface Jp2ChannelDefinition {
  channel: number
  type: number
  association: number
}

interface Jp2Container {
  codestream: Uint8Array
  palette: Jp2Palette | null
  channelMap: Jp2ChannelMap[] | null
  channelDefinitions: Jp2ChannelDefinition[]
  colorSpace: JpxImage['colorSpace']
  colorProfile: Uint8Array | null
  colorSpecifications: JpxColorSpecification[]
  bitsPerComponentBoxPresent: boolean
}

/** Walk the JP2 box structure and parse the image-header channel model. */
function parseJp2(bytes: Uint8Array): Jp2Container {
  let pos = 0
  let codestream: Uint8Array | null = null
  let palette: Jp2Palette | null = null
  let channelMap: Jp2ChannelMap[] | null = null
  const channelDefinitions: Jp2ChannelDefinition[] = []
  const colorSpecifications: JpxColorSpecification[] = []
  let bitsPerComponentBoxPresent = false
  const colorSpecificationValues: Array<{ colorSpace: JpxImage['colorSpace'], colorProfile: Uint8Array | null }> = []
  while (pos + 8 <= bytes.length) {
    let length = readU32(bytes, pos)
    const type = readU32(bytes, pos + 4)
    let header = 8
    if (length === 1) {
      // 64-bit extended length
      if (pos + 16 > bytes.length) throw new Error('JPX error: truncated extended JP2 box header')
      const hi = readU32(bytes, pos + 8)
      const lo = readU32(bytes, pos + 12)
      if (hi !== 0) throw new Error('JPX error: box too large')
      length = lo
      header = 16
    } else if (length === 0) {
      length = bytes.length - pos
    }
    if (length < header || pos + length > bytes.length) throw new Error('JPX error: invalid JP2 box length')
    const bodyStart = pos + header
    const bodyEnd = pos + length
    if (type === 0x6A703263) { // 'jp2c'
      if (codestream !== null) throw new Error('JPX error: multiple contiguous codestream boxes')
      codestream = bytes.subarray(bodyStart, bodyEnd)
    } else if (type === 0x6a703268) { // 'jp2h'
      let child = bodyStart
      while (child + 8 <= bodyEnd) {
        let childLength = readU32(bytes, child)
        const childType = readU32(bytes, child + 4)
        let childHeader = 8
        if (childLength === 1) {
          if (child + 16 > bodyEnd) throw new Error('JPX error: truncated extended JP2 header child box')
          const high = readU32(bytes, child + 8)
          if (high !== 0) throw new Error('JPX error: JP2 header child box is too large')
          childLength = readU32(bytes, child + 12)
          childHeader = 16
        } else if (childLength === 0) {
          childLength = bodyEnd - child
        }
        if (childLength < childHeader || child + childLength > bodyEnd) throw new Error('JPX error: invalid JP2 header child box')
        const start = child + childHeader
        const end = child + childLength
        if (childType === 0x62706363) bitsPerComponentBoxPresent = true // bpcc
        else if (childType === 0x70636c72) palette = parseJp2Palette(bytes, start, end) // pclr
        else if (childType === 0x636d6170) channelMap = parseJp2ChannelMap(bytes, start, end) // cmap
        else if (childType === 0x63646566) channelDefinitions.push(...parseJp2ChannelDefinitions(bytes, start, end)) // cdef
        else if (childType === 0x636f6c72) {
          const specification = parseJp2ColorSpace(bytes, start, end)
          colorSpecifications.push(specification.specification)
          colorSpecificationValues.push({ colorSpace: specification.colorSpace, colorProfile: specification.colorProfile })
        } // colr
        child += childLength
      }
      if (child !== bodyEnd) throw new Error('JPX error: truncated JP2 header child box')
    }
    pos += length
  }
  if (codestream === null) throw new Error('JPX error: no contiguous codestream (jp2c) box found')
  if ((palette === null) !== (channelMap === null)) throw new Error('JPX error: palette and component mapping boxes must occur together')
  const preferred = colorSpecifications.length <= 1 ? 0 : colorSpecifications.findIndex(function (item) { return item.approximation === 1 })
  const selected = colorSpecificationValues[preferred < 0 ? 0 : preferred]
  return {
    codestream, palette, channelMap, channelDefinitions,
    colorSpace: selected?.colorSpace ?? 'unknown',
    colorProfile: selected?.colorProfile ?? null,
    colorSpecifications,
    bitsPerComponentBoxPresent,
  }
}

function parseJp2Palette(bytes: Uint8Array, start: number, end: number): Jp2Palette {
  if (end - start < 3) throw new Error('JPX error: truncated palette box')
  const entryCount = readU16(bytes, start)
  const columnCount = bytes[start + 2]!
  if (entryCount === 0 || columnCount === 0 || start + 3 + columnCount > end) throw new Error('JPX error: invalid palette dimensions')
  const depths: number[] = []
  const signed: boolean[] = []
  let position = start + 3
  for (let column = 0; column < columnCount; column++) {
    const descriptor = bytes[position++]!
    depths.push((descriptor & 0x7f) + 1)
    signed.push((descriptor & 0x80) !== 0)
  }
  const entries: number[][] = []
  for (let entry = 0; entry < entryCount; entry++) {
    const values: number[] = []
    for (let column = 0; column < columnCount; column++) {
      const depth = depths[column]!
      if (depth > 38) throw new Error(`JPX error: palette precision ${depth} exceeds JPEG 2000 limits`)
      const byteCount = Math.ceil(depth / 8)
      if (position + byteCount > end) throw new Error('JPX error: truncated palette entries')
      let value = 0
      for (let i = 0; i < byteCount; i++) value = value * 256 + bytes[position++]!
      value %= Math.pow(2, depth)
      if (signed[column]!) {
        const sign = Math.pow(2, depth - 1)
        if (value >= sign) value -= Math.pow(2, depth)
      }
      values.push(value)
    }
    entries.push(values)
  }
  if (position !== end) throw new Error('JPX error: extraneous palette data')
  return { entries, depths, signed }
}

function parseJp2ChannelMap(bytes: Uint8Array, start: number, end: number): Jp2ChannelMap[] {
  if ((end - start) % 4 !== 0 || start === end) throw new Error('JPX error: invalid component mapping box length')
  const result: Jp2ChannelMap[] = []
  for (let position = start; position < end; position += 4) {
    const type = bytes[position + 2]!
    if (type > 1) throw new Error(`JPX error: invalid component mapping type ${type}`)
    result.push({ component: readU16(bytes, position), type, column: bytes[position + 3]! })
  }
  return result
}

function parseJp2ChannelDefinitions(bytes: Uint8Array, start: number, end: number): Jp2ChannelDefinition[] {
  if (end - start < 2) throw new Error('JPX error: truncated channel definition box')
  const count = readU16(bytes, start)
  if (start + 2 + count * 6 !== end) throw new Error('JPX error: invalid channel definition box length')
  const result: Jp2ChannelDefinition[] = []
  for (let i = 0; i < count; i++) {
    const position = start + 2 + i * 6
    const type = readU16(bytes, position + 2)
    if (type !== 0 && type !== 1 && type !== 2 && type !== 0xffff) throw new Error(`JPX error: invalid channel type ${type}`)
    result.push({ channel: readU16(bytes, position), type, association: readU16(bytes, position + 4) })
  }
  return result
}

function parseJp2ColorSpace(bytes: Uint8Array, start: number, end: number): {
  colorSpace: JpxImage['colorSpace']
  colorProfile: Uint8Array | null
  specification: JpxColorSpecification
} {
  if (end - start < 3) throw new Error('JPX error: truncated colour specification box')
  const method = bytes[start]!
  const precedence = bytes[start + 1]!
  const approximation = bytes[start + 2]!
  if (method === 1) {
    if (end - start !== 7) throw new Error('JPX error: invalid enumerated colour specification box')
    const value = readU32(bytes, start + 3)
    return {
      colorSpace: value === 16 ? 'rgb' : value === 17 ? 'gray' : value === 18 ? 'sycc' : 'unknown',
      colorProfile: null,
      specification: { method, precedence, approximation, enumeratedColorSpace: value },
    }
  }
  if (method === 2 || method === 3) {
    if (end - start <= 3) throw new Error('JPX error: empty ICC colour profile')
    return {
      colorSpace: 'unknown', colorProfile: bytes.slice(start + 3, end),
      specification: { method, precedence, approximation, enumeratedColorSpace: null },
    }
  }
  if (method === 4 || method === 5) {
    return {
      colorSpace: 'unknown', colorProfile: bytes.slice(start + 3, end),
      specification: { method, precedence, approximation, enumeratedColorSpace: null },
    }
  }
  throw new Error(`JPX error: invalid colour specification method ${method}`)
}

function applyJp2ChannelMapping(image: JpxImage, container: Jp2Container): JpxImage {
  const maps = container.channelMap ?? image.componentBitDepths.map(function (_depth, component) {
    return { component, type: 0, column: 0 }
  })
  const palette = container.palette
  const depths: number[] = []
  const signed: boolean[] = []
  for (let channel = 0; channel < maps.length; channel++) {
    const map = maps[channel]!
    if (map.component >= image.componentCount) throw new Error('JPX error: component mapping index is out of range')
    if (map.type === 0) {
      if (map.column !== 0) throw new Error('JPX error: direct component mapping palette column must be zero')
      depths.push(image.componentBitDepths[map.component]!)
      signed.push(image.componentSigned[map.component]!)
    } else {
      if (palette === null || map.column >= palette.depths.length) throw new Error('JPX error: palette column is out of range')
      depths.push(palette.depths[map.column]!)
      signed.push(palette.signed[map.column]!)
    }
  }
  const maxDepth = Math.max(...depths)
  const output: Uint8Array | Uint16Array | Float64Array = signed.some(Boolean)
    ? new Float64Array(image.width * image.height * maps.length)
    : maxDepth <= 8
      ? new Uint8Array(image.width * image.height * maps.length)
      : maxDepth <= 16
        ? new Uint16Array(image.width * image.height * maps.length)
        : new Float64Array(image.width * image.height * maps.length)
  const pixels = image.width * image.height
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let channel = 0; channel < maps.length; channel++) {
      const map = maps[channel]!
      const source = image.data[pixel * image.componentCount + map.component]!
      if (map.type === 0) output[pixel * maps.length + channel] = source
      else {
        if (!Number.isInteger(source) || source < 0 || palette === null || source >= palette.entries.length) {
          throw new Error('JPX error: palette index is out of range')
        }
        output[pixel * maps.length + channel] = palette.entries[source]![map.column]!
      }
    }
  }

  let alphaChannel: number | null = null
  let premultipliedAlpha = false
  const alphaChannels: { channel: number, association: number, premultiplied: boolean }[] = []
  const colorAssociations: { channel: number, association: number }[] = []
  for (const definition of container.channelDefinitions) {
    if (definition.channel >= maps.length) throw new Error('JPX error: channel definition index is out of range')
    if (definition.type === 1 || definition.type === 2) {
      alphaChannels.push({ channel: definition.channel, association: definition.association, premultiplied: definition.type === 2 })
      if (alphaChannel === null || definition.association === 0) {
        alphaChannel = definition.channel
        premultipliedAlpha = definition.type === 2
      }
    } else if (definition.type === 0) {
      colorAssociations.push({ channel: definition.channel, association: definition.association })
    }
  }
  colorAssociations.sort(function (a, b) { return a.association - b.association || a.channel - b.channel })
  const colorChannels = colorAssociations.length > 0
    ? colorAssociations.map(function (item) { return item.channel })
    : maps.map(function (_map, channel) { return channel }).filter(function (channel) { return channel !== alphaChannel })
  return {
    ...image,
    componentCount: maps.length,
    bitDepth: maxDepth,
    componentBitDepths: depths,
    componentSigned: signed,
    data: output,
    colorSpace: container.colorSpace,
    alphaChannel,
    premultipliedAlpha,
    alphaChannels,
    colorChannels,
    colorProfile: container.colorProfile,
    colorSpecifications: container.colorSpecifications,
    bitsPerComponentBoxPresent: container.bitsPerComponentBoxPresent,
  }
}

// ─── Codestream structures ───

interface ComponentInfo {
  depth: number
  signed: boolean
  xSubsampling: number
  ySubsampling: number
}

interface CodingParams {
  progression: number
  layers: number
  mct: number
  levels: number
  cbWidth: number   // log2
  cbHeight: number  // log2
  cbStyle: number
  transform: number // 0 = 9/7, 1 = 5/3
  sop: boolean
  eph: boolean
  precinctWidths: number[]
  precinctHeights: number[]
}

interface QuantParams {
  style: number     // 0 none (reversible), 1 derived, 2 expounded
  guardBits: number
  exponents: number[]
  mantissas: number[]
}

interface ProgressionChange {
  startLayer: number
  endLayer: number
  startResolution: number
  endResolution: number
  startComponent: number
  endComponent: number
  progression: number
}

interface CodeBlock {
  x0: number, y0: number, x1: number, y1: number
  gridX: number, gridY: number
  precinct: number
  included: boolean
  zeroBitPlanes: number
  lBlock: number
  passesTotal: number
  data: { bytes: Uint8Array, start: number, end: number, passes: number, passStart: number, segmentId: number, raw: boolean }[]
}

interface SubbandInfo {
  type: 0 | 1 | 2 | 3  // LL, HL, LH, HH
  x0: number, y0: number, x1: number, y1: number
  blocks: CodeBlock[]
  blocksW: number
  blocksH: number
  exponent: number
  mantissa: number
  /** decoded coefficients (float for 9/7, int for 5/3) */
  coefficients: Float32Array
}

interface ResolutionInfo {
  x0: number, y0: number, x1: number, y1: number
  subbands: SubbandInfo[]
  precincts: PrecinctInfo[]
  precinctsWide: number
  precinctWidth: number
  precinctHeight: number
  scale: number
}

interface PrecinctSubbandInfo {
  blockIndices: number[]
  gridX0: number
  gridY0: number
  inclusionTree: TagTree
  zeroTree: TagTree
}

interface PrecinctInfo {
  x: number
  y: number
  subbands: PrecinctSubbandInfo[]
}

interface TileComponent {
  x0: number, y0: number, x1: number, y1: number
  resolutions: ResolutionInfo[]
  cod: CodingParams
  qcd: QuantParams
  xSubsampling: number
  ySubsampling: number
}

interface TilePartDecode {
  data: Uint8Array
  packetHeaders: Uint8Array | null
  cod: CodingParams
  qcd: QuantParams
  coc: Map<number, CodingParams>
  qcc: Map<number, QuantParams>
  rgn: Map<number, number>
  poc: readonly ProgressionChange[]
}

// ─── Main decode ───

function decodeCodestream(cs: Uint8Array): JpxImage {
  let pos = 0
  const expectMarker = readU16(cs, pos)
  if (expectMarker !== 0xFF4F) throw new Error('JPX error: missing SOC marker')
  pos += 2

  // SIZ
  if (readU16(cs, pos) !== 0xFF51) throw new Error('JPX error: missing SIZ marker')
  if (pos + 42 > cs.length) throw new Error('JPX error: truncated SIZ marker')
  const sizLength = readU16(cs, pos + 2)
  const xsiz = readU32(cs, pos + 6)
  const ysiz = readU32(cs, pos + 10)
  const xosiz = readU32(cs, pos + 14)
  const yosiz = readU32(cs, pos + 18)
  const xtsiz = readU32(cs, pos + 22)
  const ytsiz = readU32(cs, pos + 26)
  const xtosiz = readU32(cs, pos + 30)
  const ytosiz = readU32(cs, pos + 34)
  const csiz = readU16(cs, pos + 38)
  if (csiz === 0 || csiz > 16384 || sizLength !== 38 + csiz * 3 || pos + 2 + sizLength > cs.length) {
    throw new Error('JPX error: invalid SIZ marker length or component count')
  }
  if (xsiz <= xosiz || ysiz <= yosiz || xtsiz === 0 || ytsiz === 0 || xtosiz > xosiz || ytosiz > yosiz) {
    throw new Error('JPX error: invalid SIZ reference grid or tile geometry')
  }
  const components: ComponentInfo[] = []
  for (let c = 0; c < csiz; c++) {
    const ssiz = cs[pos + 40 + c * 3]!
    const xr = cs[pos + 41 + c * 3]!
    const yr = cs[pos + 42 + c * 3]!
    if (xr === 0 || yr === 0) throw new Error('JPX error: component subsampling factor must be non-zero')
    if ((ssiz & 0x7f) >= 38) throw new Error('JPX error: component precision exceeds JPEG 2000 Part 1 limits')
    components.push({
      depth: (ssiz & 0x7F) + 1,
      signed: (ssiz & 0x80) !== 0,
      xSubsampling: xr,
      ySubsampling: yr,
    })
  }
  pos += 2 + readU16(cs, pos + 2)

  let mainCod: CodingParams | null = null
  let mainQcd: QuantParams | null = null
  const mainCoc = new Map<number, CodingParams>()
  const mainQcc = new Map<number, QuantParams>()
  const mainRgn = new Map<number, number>()
  const mainPoc: ProgressionChange[] = []
  const packedMainHeaderSegments = new Map<number, Uint8Array>()
  let packedMainHeaders: Uint8Array[] | null = null
  let packedMainHeaderIndex = 0

  const width = xsiz - xosiz
  const height = ysiz - yosiz
  const tilesX = Math.ceil((xsiz - xtosiz) / xtsiz)
  const tilesY = Math.ceil((ysiz - ytosiz) / ytsiz)
  const maxDepth = Math.max(...components.map(c => c.depth))
  const out = components.some(function (component) { return component.signed })
    ? new Float64Array(width * height * csiz)
    : maxDepth <= 8
      ? new Uint8Array(width * height * csiz)
      : maxDepth <= 16
        ? new Uint16Array(width * height * csiz)
        : new Float64Array(width * height * csiz)

  // Tile-part data accumulated per tile index
  const tileData: TilePartDecode[][] = []
  const tileCod: (CodingParams | null)[] = []
  const tileQcd: (QuantParams | null)[] = []
  const tileCoc: Map<number, CodingParams>[] = []
  const tileQcc: Map<number, QuantParams>[] = []
  const tileRgn: Map<number, number>[] = []
  const tilePoc: ProgressionChange[][] = []
  const nextTilePartIndex = new Uint16Array(tilesX * tilesY)
  const declaredTilePartCount = new Uint16Array(tilesX * tilesY)
  for (let i = 0; i < tilesX * tilesY; i++) tileData.push([])
  for (let i = 0; i < tilesX * tilesY; i++) {
    tileCod.push(null)
    tileQcd.push(null)
    tileCoc.push(new Map())
    tileQcc.push(new Map())
    tileRgn.push(new Map())
    tilePoc.push([])
  }

  while (pos < cs.length) {
    const marker = readU16(cs, pos)
    if (marker === 0xFFD9) break // EOC
    if (marker === 0xFF52) { // COD
      mainCod = parseCod(cs, pos)
      pos += 2 + readU16(cs, pos + 2)
    } else if (marker === 0xFF53) { // COC
      const { comp, params } = parseCoc(cs, pos, csiz, mainCod)
      mainCoc.set(comp, params)
      pos += 2 + readU16(cs, pos + 2)
    } else if (marker === 0xFF5C) { // QCD
      mainQcd = parseQcd(cs, pos)
      pos += 2 + readU16(cs, pos + 2)
    } else if (marker === 0xFF5D) { // QCC
      const { comp, params } = parseQcc(cs, pos, csiz)
      mainQcc.set(comp, params)
      pos += 2 + readU16(cs, pos + 2)
    } else if (marker === 0xFF60) { // PPM
      const length = readMarkerSegmentLength(cs, pos, 'PPM')
      if (length < 3) throw new Error('JPX error: truncated PPM marker')
      const index = cs[pos + 4]!
      if (packedMainHeaderSegments.has(index)) throw new Error(`JPX error: duplicate PPM index ${index}`)
      packedMainHeaderSegments.set(index, cs.slice(pos + 5, pos + 2 + length))
      pos += 2 + length
    } else if (marker === 0xFF90) { // SOT
      if (packedMainHeaders === null && packedMainHeaderSegments.size > 0) {
        packedMainHeaders = parsePackedMainHeaders(packedMainHeaderSegments)
      }
      const tileIndex = readU16(cs, pos + 4)
      let tilePartLength = readU32(cs, pos + 6)
      const sotLength = readU16(cs, pos + 2)
      if (tileIndex >= tilesX * tilesY) throw new Error('JPX error: tile index out of range')
      if (sotLength !== 10 || pos + 12 > cs.length) throw new Error('JPX error: invalid SOT marker length')
      const tilePartIndex = cs[pos + 10]!
      const tilePartCount = cs[pos + 11]!
      if (tilePartIndex !== nextTilePartIndex[tileIndex]) throw new Error('JPX error: tile-parts are not in sequence')
      nextTilePartIndex[tileIndex]++
      if (tilePartCount !== 0) {
        if (tilePartIndex >= tilePartCount) throw new Error('JPX error: tile-part index exceeds declared count')
        if (declaredTilePartCount[tileIndex] !== 0 && declaredTilePartCount[tileIndex] !== tilePartCount) {
          throw new Error('JPX error: inconsistent tile-part count')
        }
        declaredTilePartCount[tileIndex] = tilePartCount
      }
      // Parse the tile-part header. Tile-specific coding and quantization state
      // persists across subsequent tile-parts of the same tile.
      let p = pos + 2 + sotLength
      const packedTileHeaderSegments = new Map<number, Uint8Array>()
      while (readU16(cs, p) !== 0xFF93) {
        const m = readU16(cs, p)
        if (m === 0xFF64 || m === 0xFF58) { // COM, PLT
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF52) { // COD
          tileCod[tileIndex] = parseCod(cs, p)
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF53) { // COC
          const base = tileCod[tileIndex] ?? mainCod
          const parsed = parseCoc(cs, p, csiz, base)
          tileCoc[tileIndex]!.set(parsed.comp, parsed.params)
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF5C) { // QCD
          tileQcd[tileIndex] = parseQcd(cs, p)
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF5D) { // QCC
          const parsed = parseQcc(cs, p, csiz)
          tileQcc[tileIndex]!.set(parsed.comp, parsed.params)
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF5F) { // POC
          const changes = tilePoc[tileIndex]!
          changes.push(...parsePoc(cs, p, csiz, changes.length === 0 ? 0 : changes[changes.length - 1]!.endLayer))
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF5E) {
          const parsed = parseRgn(cs, p, csiz)
          tileRgn[tileIndex]!.set(parsed.comp, parsed.shift)
          p += 2 + readU16(cs, p + 2)
        } else if (m === 0xFF61) { // PPT
          const markerLength = readMarkerSegmentLength(cs, p, 'PPT')
          if (markerLength < 3) throw new Error('JPX error: truncated PPT marker')
          const index = cs[p + 4]!
          if (packedTileHeaderSegments.has(index)) throw new Error(`JPX error: duplicate PPT index ${index}`)
          packedTileHeaderSegments.set(index, cs.slice(p + 5, p + 2 + markerLength))
          p += 2 + markerLength
        } else {
          throw new Error(`JPX error: unsupported tile-part marker 0x${m.toString(16)}`)
        }
      }
      p += 2 // past SOD
      const dataEnd = tilePartLength === 0
        ? cs.length >= 2 && readU16(cs, cs.length - 2) === 0xffd9 ? cs.length - 2 : -1
        : pos + tilePartLength
      if (dataEnd > cs.length || dataEnd < p) throw new Error('JPX error: tile-part length is out of range')
      const effectiveCod = tileCod[tileIndex] ?? mainCod
      const effectiveQcd = tileQcd[tileIndex] ?? mainQcd
      if (effectiveCod === null || effectiveQcd === null) throw new Error('JPX error: tile-part data precedes COD or QCD')
      const effectiveCoc = new Map(mainCoc)
      for (const [component, params] of tileCoc[tileIndex]!) effectiveCoc.set(component, params)
      const effectiveQcc = new Map(mainQcc)
      for (const [component, params] of tileQcc[tileIndex]!) effectiveQcc.set(component, params)
      const effectiveRgn = new Map(mainRgn)
      for (const [component, shift] of tileRgn[tileIndex]!) effectiveRgn.set(component, shift)
      const packedTileHeaders = packedTileHeaderSegments.size === 0
        ? null
        : concatenateIndexedMarkerPayloads(packedTileHeaderSegments, 'PPT')
      const packedMainHeader = packedMainHeaders === null
        ? null
        : packedMainHeaders[packedMainHeaderIndex++] ?? null
      if (packedMainHeaders !== null && packedMainHeader === null) {
        throw new Error('JPX error: PPM does not contain packet headers for every tile-part')
      }
      if (packedMainHeader !== null && packedTileHeaders !== null) {
        throw new Error('JPX error: a tile-part cannot use both PPM and PPT packet headers')
      }
      tileData[tileIndex]!.push({
        data: cs.subarray(p, dataEnd),
        packetHeaders: packedTileHeaders ?? packedMainHeader,
        cod: effectiveCod,
        qcd: effectiveQcd,
        coc: effectiveCoc,
        qcc: effectiveQcc,
        rgn: effectiveRgn,
        poc: tilePoc[tileIndex]!.length === 0 ? mainPoc.slice() : tilePoc[tileIndex]!.slice(),
      })
      pos = dataEnd
    } else if (marker === 0xFF64 || marker === 0xFF63 || marker === 0xFF55 || marker === 0xFF57 || marker === 0xFF58) {
      // COM, CRG, TLM, PLM, PLT
      pos += 2 + readU16(cs, pos + 2)
    } else if (marker === 0xFF5F) { // POC
      const changes = parsePoc(cs, pos, csiz, mainPoc.length === 0 ? 0 : mainPoc[mainPoc.length - 1]!.endLayer)
      mainPoc.push(...changes)
      pos += 2 + readU16(cs, pos + 2)
    } else if (marker === 0xFF5E) { // RGN
      const parsed = parseRgn(cs, pos, csiz)
      mainRgn.set(parsed.comp, parsed.shift)
      pos += 2 + readU16(cs, pos + 2)
    } else {
      throw new Error(`JPX error: unexpected marker 0x${marker.toString(16)}`)
    }
  }
  if (mainCod === null || mainQcd === null) throw new Error('JPX error: missing COD or QCD')
  if (packedMainHeaders !== null && packedMainHeaderIndex !== packedMainHeaders.length) {
    throw new Error('JPX error: PPM contains packet-header data not associated with a tile-part')
  }
  for (let tile = 0; tile < declaredTilePartCount.length; tile++) {
    if (declaredTilePartCount[tile] !== 0 && nextTilePartIndex[tile] !== declaredTilePartCount[tile]) {
      throw new Error(`JPX error: tile ${tile} is missing declared tile-parts`)
    }
  }

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileIndex = ty * tilesX + tx
      const parts = tileData[tileIndex]!
      if (parts.length === 0) throw new Error(`JPX error: tile ${tileIndex} has no tile-part data`)
      const tx0 = Math.max(xtosiz + tx * xtsiz, xosiz)
      const ty0 = Math.max(ytosiz + ty * ytsiz, yosiz)
      const tx1 = Math.min(xtosiz + (tx + 1) * xtsiz, xsiz)
      const ty1 = Math.min(ytosiz + (ty + 1) * ytsiz, ysiz)
      decodeTile(parts, tx0, ty0, tx1, ty1, components,
        out, width, xosiz, yosiz, maxDepth)
    }
  }

  return {
    width,
    height,
    componentCount: csiz,
    bitDepth: maxDepth,
    componentBitDepths: components.map(function (component) { return component.depth }),
    componentSigned: components.map(function (component) { return component.signed }),
    data: out,
    colorSpace: components.length === 1 ? 'gray' : components.length >= 3 ? 'rgb' : 'unknown',
    alphaChannel: null,
    premultipliedAlpha: false,
    alphaChannels: [],
    colorChannels: components.map(function (_component, index) { return index }),
    colorProfile: null,
    colorSpecifications: [],
    bitsPerComponentBoxPresent: false,
  }
}

function parseCod(cs: Uint8Array, pos: number): CodingParams {
  const length = readU16(cs, pos + 2)
  const scod = cs[pos + 4]!
  if ((scod & 0xf8) !== 0) throw new Error(`JPX error: COD reserved style bits 0x${scod.toString(16)}`)
  const progression = cs[pos + 5]!
  const layers = readU16(cs, pos + 6)
  const mct = cs[pos + 8]!
  const levels = cs[pos + 9]!
  const cbWidth = (cs[pos + 10]! & 0x0F) + 2
  const cbHeight = (cs[pos + 11]! & 0x0F) + 2
  const cbStyle = cs[pos + 12]!
  if ((cbStyle & 0xc0) !== 0) throw new Error(`JPX error: reserved code-block style 0x${cbStyle.toString(16)}`)
  const transform = cs[pos + 13]!
  if (length !== 12 + ((scod & 1) !== 0 ? levels + 1 : 0)) throw new Error('JPX error: invalid COD marker length')
  if (progression > 4 || layers === 0 || mct > 1 || levels > 32 || cbWidth > 10 || cbHeight > 10 || cbWidth + cbHeight > 12 || transform > 1) {
    throw new Error('JPX error: invalid COD coding style parameters')
  }
  const precinctWidths: number[] = []
  const precinctHeights: number[] = []
  if ((scod & 1) !== 0) {
    for (let r = 0; r <= levels; r++) {
      const value = cs[pos + 14 + r]!
      precinctWidths.push(value & 0x0f)
      precinctHeights.push(value >> 4)
      if (r > 0 && ((value & 0x0f) === 0 || (value >> 4) === 0)) throw new Error('JPX error: high-resolution precinct exponent must be non-zero')
    }
  } else {
    for (let r = 0; r <= levels; r++) { precinctWidths.push(15); precinctHeights.push(15) }
  }
  return {
    progression, layers, mct, levels, cbWidth, cbHeight, cbStyle, transform,
    sop: (scod & 2) !== 0, eph: (scod & 4) !== 0,
    precinctWidths, precinctHeights,
  }
}

function parseCoc(cs: Uint8Array, pos: number, csiz: number, base: CodingParams | null): { comp: number, params: CodingParams } {
  if (base === null) throw new Error('JPX error: COC before COD')
  const compBytes = csiz < 257 ? 1 : 2
  const length = readU16(cs, pos + 2)
  const comp = compBytes === 1 ? cs[pos + 4]! : readU16(cs, pos + 4)
  if (comp >= csiz) throw new Error('JPX error: COC component index is out of range')
  const scoc = cs[pos + 4 + compBytes]!
  if ((scoc & 0xfe) !== 0) throw new Error(`JPX error: COC reserved style bits 0x${scoc.toString(16)}`)
  const o = pos + 5 + compBytes
  const levels = cs[o]!
  const cbWidth = (cs[o + 1]! & 0x0F) + 2
  const cbHeight = (cs[o + 2]! & 0x0F) + 2
  const cbStyle = cs[o + 3]!
  if ((cbStyle & 0xc0) !== 0) throw new Error(`JPX error: reserved code-block style 0x${cbStyle.toString(16)}`)
  const transform = cs[o + 4]!
  if (length !== 8 + compBytes + ((scoc & 1) !== 0 ? levels + 1 : 0)) throw new Error('JPX error: invalid COC marker length')
  if (levels > 32 || cbWidth > 10 || cbHeight > 10 || cbWidth + cbHeight > 12 || transform > 1) {
    throw new Error('JPX error: invalid COC coding style parameters')
  }
  const precinctWidths: number[] = []
  const precinctHeights: number[] = []
  if ((scoc & 1) !== 0) {
    for (let r = 0; r <= levels; r++) {
      const value = cs[o + 5 + r]!
      precinctWidths.push(value & 0x0f)
      precinctHeights.push(value >> 4)
      if (r > 0 && ((value & 0x0f) === 0 || (value >> 4) === 0)) throw new Error('JPX error: high-resolution precinct exponent must be non-zero')
    }
  } else {
    for (let r = 0; r <= levels; r++) { precinctWidths.push(15); precinctHeights.push(15) }
  }
  return { comp, params: { ...base, levels, cbWidth, cbHeight, cbStyle, transform, precinctWidths, precinctHeights } }
}

function parseQcdBody(cs: Uint8Array, o: number, end: number): QuantParams {
  const sqcd = cs[o]!
  const style = sqcd & 0x1F
  if (style > 2) throw new Error(`JPX error: invalid quantization style ${style}`)
  const guardBits = sqcd >> 5
  const exponents: number[] = []
  const mantissas: number[] = []
  if (style === 0) {
    for (let p = o + 1; p < end; p++) {
      exponents.push(cs[p]! >> 3)
      mantissas.push(0)
    }
  } else {
    for (let p = o + 1; p + 1 < end; p += 2) {
      const v = readU16(cs, p)
      exponents.push(v >> 11)
      mantissas.push(v & 0x7FF)
    }
  }
  return { style: style === 0 ? 0 : style === 1 ? 1 : 2, guardBits, exponents, mantissas }
}

function parseQcd(cs: Uint8Array, pos: number): QuantParams {
  const length = readU16(cs, pos + 2)
  return parseQcdBody(cs, pos + 4, pos + 2 + length)
}

function parseQcc(cs: Uint8Array, pos: number, csiz: number): { comp: number, params: QuantParams } {
  const length = readU16(cs, pos + 2)
  const compBytes = csiz < 257 ? 1 : 2
  const comp = compBytes === 1 ? cs[pos + 4]! : readU16(cs, pos + 4)
  return { comp, params: parseQcdBody(cs, pos + 4 + compBytes, pos + 2 + length) }
}

function parsePoc(cs: Uint8Array, pos: number, csiz: number, initialLayer: number): ProgressionChange[] {
  const length = readU16(cs, pos + 2)
  const componentBytes = csiz < 257 ? 1 : 2
  const recordLength = 5 + componentBytes * 2
  const payloadLength = length - 2
  if (payloadLength <= 0 || payloadLength % recordLength !== 0) throw new Error('JPX error: invalid POC marker length')
  const changes: ProgressionChange[] = []
  let p = pos + 4
  const end = pos + 2 + length
  let startLayer = initialLayer
  while (p < end) {
    const startResolution = cs[p++]!
    const startComponent = componentBytes === 1 ? cs[p++]! : readU16(cs, p)
    if (componentBytes === 2) p += 2
    const endLayer = readU16(cs, p); p += 2
    const endResolution = cs[p++]!
    const endComponent = componentBytes === 1 ? cs[p++]! : readU16(cs, p)
    if (componentBytes === 2) p += 2
    const progression = cs[p++]!
    if (progression > 4) throw new Error(`JPX error: invalid POC progression order ${progression}`)
    if (startResolution >= endResolution || startComponent >= endComponent || endComponent > csiz || startLayer >= endLayer) {
      throw new Error('JPX error: invalid POC progression range')
    }
    changes.push({
      startLayer,
      endLayer,
      startResolution,
      endResolution,
      startComponent,
      endComponent,
      progression,
    })
    startLayer = endLayer
  }
  return changes
}

function parseRgn(cs: Uint8Array, pos: number, csiz: number): { comp: number, shift: number } {
  const length = readU16(cs, pos + 2)
  const componentBytes = csiz < 257 ? 1 : 2
  if (length !== 4 + componentBytes) throw new Error('JPX error: invalid RGN marker length')
  let p = pos + 4
  const comp = componentBytes === 1 ? cs[p++]! : readU16(cs, p)
  if (componentBytes === 2) p += 2
  if (comp >= csiz) throw new Error('JPX error: RGN component index is out of range')
  const style = cs[p++]!
  if (style !== 0) throw new Error(`JPX error: invalid RGN style ${style}`)
  const shift = cs[p]!
  if (shift > 37) throw new Error(`JPX error: invalid RGN shift ${shift}`)
  return { comp, shift }
}

// ─── Helpers ───

function readU16(b: Uint8Array, p: number): number {
  return (b[p]! << 8) | b[p + 1]!
}

function readU32(b: Uint8Array, p: number): number {
  return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
}

function readMarkerSegmentLength(bytes: Uint8Array, position: number, label: string): number {
  if (position + 4 > bytes.length) throw new Error(`JPX error: truncated ${label} marker`)
  const length = readU16(bytes, position + 2)
  if (length < 2 || position + 2 + length > bytes.length) throw new Error(`JPX error: invalid ${label} marker length`)
  return length
}

function concatenateIndexedMarkerPayloads(segments: ReadonlyMap<number, Uint8Array>, label: string): Uint8Array {
  const ordered: Uint8Array[] = []
  let length = 0
  for (let index = 0; index < segments.size; index++) {
    const payload = segments.get(index)
    if (payload === undefined) throw new Error(`JPX error: ${label} indices must be consecutive from zero`)
    ordered.push(payload)
    length += payload.length
  }
  const result = new Uint8Array(length)
  let position = 0
  for (const payload of ordered) {
    result.set(payload, position)
    position += payload.length
  }
  return result
}

function parsePackedMainHeaders(segments: ReadonlyMap<number, Uint8Array>): Uint8Array[] {
  const packed = concatenateIndexedMarkerPayloads(segments, 'PPM')
  const result: Uint8Array[] = []
  let position = 0
  while (position < packed.length) {
    if (position + 4 > packed.length) throw new Error('JPX error: truncated PPM packet-header length')
    const length = readU32(packed, position)
    position += 4
    if (position + length > packed.length) throw new Error('JPX error: truncated PPM packet-header data')
    result.push(packed.slice(position, position + length))
    position += length
  }
  return result
}

// ─── Tag trees (ISO 15444-1 B.10.2) ───

class TagTree {
  private levels: { w: number, h: number, value: Int32Array, state: Int32Array }[] = []

  constructor(width: number, height: number) {
    let w = width
    let h = height
    for (;;) {
      this.levels.push({ w, h, value: new Int32Array(w * h), state: new Int32Array(w * h) })
      if (w === 1 && h === 1) break
      w = Math.ceil(w / 2)
      h = Math.ceil(h / 2)
    }
  }

  /**
   * Decode the tag tree value at (x, y) against `threshold`: returns true
   * when value(x, y) < threshold is decidable as true; consumes bits from
   * the reader while the knowledge is insufficient.
   */
  decode(reader: PacketBitReader, x: number, y: number, threshold: number): boolean {
    // Walk from the root down to the leaf
    const path: { level: number, index: number }[] = []
    let lx = x
    let ly = y
    for (let l = 0; l < this.levels.length; l++) {
      path.push({ level: l, index: ly * this.levels[l]!.w + lx })
      lx >>= 1
      ly >>= 1
    }
    let lower = 0
    for (let i = path.length - 1; i >= 0; i--) {
      const { level, index } = path[i]!
      const lev = this.levels[level]!
      if (lev.state[index]! < lower) lev.state[index] = lower
      while (lev.value[index] === 0 && lev.state[index]! < threshold) {
        if (reader.readBit() === 1) {
          lev.value[index] = lev.state[index]! + 1
        } else {
          lev.state[index] = lev.state[index]! + 1
        }
      }
      if (lev.value[index] === 0) return false // still >= threshold
      if (lev.value[index]! > threshold) return false
      lower = Math.max(lower, lev.value[index]! - 1)
    }
    return true
  }

  /** Fully decode the value at (x, y) (used for zero bit-plane counts). */
  decodeValue(reader: PacketBitReader, x: number, y: number): number {
    let threshold = 1
    while (!this.decode(reader, x, y, threshold)) threshold++
    return threshold - 1
  }
}

/** MSB-first bit reader with JPEG 2000 bit stuffing (after 0xFF skip a bit). */
class PacketBitReader {
  private data: Uint8Array
  pos: number
  private buf = 0
  private count = 0

  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
  }

  readBit(): number {
    if (this.count === 0) {
      const prev = this.buf
      if (this.pos >= this.data.length) throw new Error('JPX error: packet header overrun')
      this.buf = this.data[this.pos++]!
      this.count = prev === 0xFF ? 7 : 8
    }
    this.count--
    return (this.buf >> this.count) & 1
  }

  readBits(n: number): number {
    let v = 0
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit()
    return v
  }

  /** Align to the next byte boundary (end of packet header). */
  align(): void {
    // A stuffed 0 bit after a 0xFF byte must be consumed
    if (this.count === 0 && this.buf === 0xFF) {
      if (this.pos < this.data.length) this.pos++
    }
    this.count = 0
  }
}

// ─── Tile decode ───

function decodeTile(
  parts: readonly TilePartDecode[],
  tx0: number, ty0: number, tx1: number, ty1: number,
  components: ComponentInfo[],
  out: Uint8Array | Uint16Array | Float64Array, imageWidth: number, xosiz: number, yosiz: number, _maxDepth: number,
): void {
  const initial = parts[0]!
  const cod = initial.cod
  // Build per-component resolution/subband/code-block structure
  const tcomps: TileComponent[] = []
  for (let c = 0; c < components.length; c++) {
    const ccod = initial.coc.get(c) ?? cod
    const cqcd = initial.qcc.get(c) ?? initial.qcd
    const component = components[c]!
    tcomps.push(buildTileComponent(
      Math.ceil(tx0 / component.xSubsampling),
      Math.ceil(ty0 / component.ySubsampling),
      Math.ceil(tx1 / component.xSubsampling),
      Math.ceil(ty1 / component.ySubsampling),
      ccod,
      cqcd,
      component.xSubsampling,
      component.ySubsampling,
    ))
  }

  // Decode packets
  const decodedPackets = new Set<string>()
  for (const part of parts) {
    validateTilePartStructure(initial, part, components.length)
    const reader = new PacketReader(part.data, tcomps, part.cod, part.poc, decodedPackets, part.packetHeaders)
    reader.decodeAllPackets()
  }
  let expectedPackets = 0
  for (const component of tcomps) {
    for (const resolution of component.resolutions) expectedPackets += resolution.precincts.length * cod.layers
  }
  if (decodedPackets.size !== expectedPackets) {
    throw new Error(`JPX error: tile-parts contain ${decodedPackets.size} packets, expected ${expectedPackets}`)
  }

  // Tier-1 per code block, then inverse quantize + inverse DWT
  const planes: Float32Array[] = []
  for (let c = 0; c < components.length; c++) {
    const tcomp = tcomps[c]!
    decodeTileComponentCoefficients(tcomp, components[c]!, initial.rgn.get(c) ?? 0)
    planes.push(inverseDwt(tcomp))
  }

  // Multiple component transform
  const w = tx1 - tx0
  const h = ty1 - ty0
  if (cod.mct === 1 && components.length >= 3) {
    if (components[0]!.xSubsampling !== components[1]!.xSubsampling
      || components[0]!.xSubsampling !== components[2]!.xSubsampling
      || components[0]!.ySubsampling !== components[1]!.ySubsampling
      || components[0]!.ySubsampling !== components[2]!.ySubsampling) {
      throw new Error('JPX error: multiple component transform requires matching component dimensions')
    }
    const [c0, c1, c2] = [planes[0]!, planes[1]!, planes[2]!]
    const componentPixels = c0.length
    if (cod.transform === 1) {
      // Inverse RCT
      for (let i = 0; i < componentPixels; i++) {
        const yv = c0[i]!
        const ur = c1[i]!
        const vr = c2[i]!
        const g = yv - Math.floor((ur + vr) / 4)
        c0[i] = vr + g
        c1[i] = g
        c2[i] = ur + g
      }
    } else {
      // Inverse ICT
      for (let i = 0; i < componentPixels; i++) {
        const yv = c0[i]!
        const cb = c1[i]!
        const cr = c2[i]!
        c0[i] = yv + 1.402 * cr
        c1[i] = yv - 0.34413 * cb - 0.71414 * cr
        c2[i] = yv + 1.772 * cb
      }
    }
  }

  // DC level shift, clamp at the component precision, and map each component
  // sample grid back to the reference image grid.
  const csiz = components.length
  for (let c = 0; c < csiz; c++) {
    const comp = components[c]!
    const plane = planes[c]!
    const shift = comp.signed ? 0 : Math.pow(2, comp.depth - 1)
    const minVal = comp.signed ? -Math.pow(2, comp.depth - 1) : 0
    const maxVal = comp.signed ? Math.pow(2, comp.depth - 1) - 1 : Math.pow(2, comp.depth) - 1
    const tcomp = tcomps[c]!
    const planeWidth = tcomp.x1 - tcomp.x0
    const planeHeight = tcomp.y1 - tcomp.y0
    for (let y = 0; y < h; y++) {
      const dstRow = ((ty0 - yosiz + y) * imageWidth + (tx0 - xosiz)) * csiz
      const componentY = Math.max(tcomp.y0, Math.min(tcomp.y1 - 1, Math.floor((ty0 + y) / comp.ySubsampling)))
      for (let x = 0; x < w; x++) {
        const componentX = Math.max(tcomp.x0, Math.min(tcomp.x1 - 1, Math.floor((tx0 + x) / comp.xSubsampling)))
        const sampleIndex = (componentY - tcomp.y0) * planeWidth + componentX - tcomp.x0
        let v = Math.round(plane[sampleIndex]! + shift)
        if (planeWidth === 0 || planeHeight === 0) v = 0
        out[dstRow + x * csiz + c] = v < minVal ? minVal : v > maxVal ? maxVal : v
      }
    }
  }
}

function validateTilePartStructure(initial: TilePartDecode, part: TilePartDecode, componentCount: number): void {
  for (let component = 0; component < componentCount; component++) {
    const a = initial.coc.get(component) ?? initial.cod
    const b = part.coc.get(component) ?? part.cod
    if (a.levels !== b.levels || a.cbWidth !== b.cbWidth || a.cbHeight !== b.cbHeight
      || a.transform !== b.transform || a.precinctWidths.join(',') !== b.precinctWidths.join(',')
      || a.precinctHeights.join(',') !== b.precinctHeights.join(',')) {
      throw new Error('JPX error: tile-part changes the established code-block partition')
    }
  }
}

function buildTileComponent(
  tx0: number, ty0: number, tx1: number, ty1: number,
  cod: CodingParams, qcd: QuantParams,
  xSubsampling: number, ySubsampling: number,
): TileComponent {
  const resolutions: ResolutionInfo[] = []
  const levels = cod.levels
  for (let r = 0; r <= levels; r++) {
    const scale = levels - r
    const rx0 = Math.ceil(tx0 / (1 << scale))
    const ry0 = Math.ceil(ty0 / (1 << scale))
    const rx1 = Math.ceil(tx1 / (1 << scale))
    const ry1 = Math.ceil(ty1 / (1 << scale))
    const ppx = cod.precinctWidths[r]!
    const ppy = cod.precinctHeights[r]!
    const precinctWidth = 1 << ppx
    const precinctHeight = 1 << ppy
    const precinctGridX0 = Math.floor(rx0 / precinctWidth)
    const precinctGridY0 = Math.floor(ry0 / precinctHeight)
    const precinctGridX1 = rx1 > rx0 ? Math.ceil(rx1 / precinctWidth) : precinctGridX0
    const precinctGridY1 = ry1 > ry0 ? Math.ceil(ry1 / precinctHeight) : precinctGridY0
    const precinctsWide = precinctGridX1 - precinctGridX0
    const precinctsHigh = precinctGridY1 - precinctGridY0
    const subbands: SubbandInfo[] = []
    if (r === 0) {
      subbands.push(makeSubband(0, rx0, ry0, rx1, ry1, cod, qcd, 0, levels, ppx, ppy, precinctsWide))
    } else {
      const s = levels - r + 1  // subband scale
      const bx0 = Math.ceil((tx0 - (1 << (s - 1))) / (1 << s))
      const by0 = Math.ceil((ty0 - (1 << (s - 1))) / (1 << s))
      const bx1 = Math.ceil((tx1 - (1 << (s - 1))) / (1 << s))
      const by1 = Math.ceil((ty1 - (1 << (s - 1))) / (1 << s))
      const lx0 = Math.ceil(tx0 / (1 << s))
      const ly0 = Math.ceil(ty0 / (1 << s))
      const lx1 = Math.ceil(tx1 / (1 << s))
      const ly1 = Math.ceil(ty1 / (1 << s))
      // HL: high horizontal, low vertical
      subbands.push(makeSubband(1, bx0, ly0, bx1, ly1, cod, qcd, r, levels, ppx, ppy, precinctsWide))
      // LH
      subbands.push(makeSubband(2, lx0, by0, lx1, by1, cod, qcd, r, levels, ppx, ppy, precinctsWide))
      // HH
      subbands.push(makeSubband(3, bx0, by0, bx1, by1, cod, qcd, r, levels, ppx, ppy, precinctsWide))
    }
    const precincts: PrecinctInfo[] = []
    for (let py = 0; py < precinctsHigh; py++) {
      for (let px = 0; px < precinctsWide; px++) {
        const precinctNumber = py * precinctsWide + px
        const precinctSubbands: PrecinctSubbandInfo[] = []
        for (const sb of subbands) {
          const blockIndices: number[] = []
          let minX = Number.MAX_SAFE_INTEGER
          let minY = Number.MAX_SAFE_INTEGER
          let maxX = Number.MIN_SAFE_INTEGER
          let maxY = Number.MIN_SAFE_INTEGER
          for (let blockIndex = 0; blockIndex < sb.blocks.length; blockIndex++) {
            const block = sb.blocks[blockIndex]!
            if (block.precinct !== precinctNumber) continue
            blockIndices.push(blockIndex)
            minX = Math.min(minX, block.gridX)
            minY = Math.min(minY, block.gridY)
            maxX = Math.max(maxX, block.gridX)
            maxY = Math.max(maxY, block.gridY)
          }
          const treeWidth = blockIndices.length === 0 ? 1 : maxX - minX + 1
          const treeHeight = blockIndices.length === 0 ? 1 : maxY - minY + 1
          precinctSubbands.push({
            blockIndices,
            gridX0: blockIndices.length === 0 ? 0 : minX,
            gridY0: blockIndices.length === 0 ? 0 : minY,
            inclusionTree: new TagTree(treeWidth, treeHeight),
            zeroTree: new TagTree(treeWidth, treeHeight),
          })
        }
        precincts.push({
          x: (precinctGridX0 + px) * precinctWidth,
          y: (precinctGridY0 + py) * precinctHeight,
          subbands: precinctSubbands,
        })
      }
    }
    resolutions.push({
      x0: rx0, y0: ry0, x1: rx1, y1: ry1, subbands,
      precincts, precinctsWide, precinctWidth, precinctHeight, scale,
    })
  }
  return { x0: tx0, y0: ty0, x1: tx1, y1: ty1, resolutions, cod, qcd, xSubsampling, ySubsampling }
}

function makeSubband(
  type: 0 | 1 | 2 | 3,
  x0: number, y0: number, x1: number, y1: number,
  cod: CodingParams, qcd: QuantParams, resolution: number, levels: number,
  ppx: number, ppy: number, precinctsWide: number,
): SubbandInfo {
  // Quantization parameter index: LL=0; per resolution r >= 1: HL, LH, HH
  let qIndex: number
  if (qcd.style === 1) {
    qIndex = 0 // scalar derived: single value
  } else {
    qIndex = resolution === 0 ? 0 : 3 * (resolution - 1) + type
  }
  let exponent = qcd.exponents.length > 0 ? qcd.exponents[Math.min(qIndex, qcd.exponents.length - 1)]! : 0
  const mantissa = qcd.mantissas.length > 0 ? qcd.mantissas[Math.min(qIndex, qcd.mantissas.length - 1)]! : 0
  if (qcd.style === 1 && resolution > 0) {
    exponent = exponent - (levels - resolution)
  }
  // Code-block grid over the subband
  const cbw = 1 << Math.min(cod.cbWidth, ppx - (resolution > 0 ? 1 : 0))
  const cbh = 1 << Math.min(cod.cbHeight, ppy - (resolution > 0 ? 1 : 0))
  const precinctWidthInSubband = 1 << (ppx - (resolution > 0 ? 1 : 0))
  const precinctHeightInSubband = 1 << (ppy - (resolution > 0 ? 1 : 0))
  const blocks: CodeBlock[] = []
  const gx0 = Math.floor(x0 / cbw)
  const gy0 = Math.floor(y0 / cbh)
  const gx1 = x1 > x0 ? Math.ceil(x1 / cbw) : gx0
  const gy1 = y1 > y0 ? Math.ceil(y1 / cbh) : gy0
  const blocksW = Math.max(0, gx1 - gx0)
  const blocksH = Math.max(0, gy1 - gy0)
  for (let by = gy0; by < gy1; by++) {
    for (let bx = gx0; bx < gx1; bx++) {
      blocks.push({
        x0: Math.max(x0, bx * cbw), y0: Math.max(y0, by * cbh),
        x1: Math.min(x1, (bx + 1) * cbw), y1: Math.min(y1, (by + 1) * cbh),
        gridX: bx,
        gridY: by,
        precinct: Math.floor((Math.max(x0, bx * cbw) - x0) / precinctWidthInSubband)
          + Math.floor((Math.max(y0, by * cbh) - y0) / precinctHeightInSubband) * precinctsWide,
        included: false, zeroBitPlanes: 0, lBlock: 3, passesTotal: 0, data: [],
      })
    }
  }
  return {
    type, x0, y0, x1, y1, blocks, blocksW, blocksH, exponent, mantissa,
    coefficients: new Float32Array(Math.max(0, (x1 - x0) * (y1 - y0))),
  }
}

// ─── Packet decoding (Tier-2) ───

class PacketReader {
  private data: Uint8Array
  private pos = 0
  private tcomps: TileComponent[]
  private cod: CodingParams
  private progressionChanges: readonly ProgressionChange[]
  private decodedPackets: Set<string>
  private packetHeaders: Uint8Array | null
  private packetHeaderPosition = 0
  private expectedSop = 0
  private exhausted = false

  constructor(
    data: Uint8Array,
    tcomps: TileComponent[],
    cod: CodingParams,
    progressionChanges: readonly ProgressionChange[],
    decodedPackets: Set<string> = new Set(),
    packetHeaders: Uint8Array | null = null,
  ) {
    this.data = data
    this.tcomps = tcomps
    this.cod = cod
    this.progressionChanges = progressionChanges
    this.decodedPackets = decodedPackets
    this.packetHeaders = packetHeaders
  }

  decodeAllPackets(): void {
    const maxLevels = Math.max(...this.tcomps.map(t => t.cod.levels))
    const comps = this.tcomps.length
    const visit = (l: number, r: number, c: number, p: number): void => {
      if (this.exhausted) return
      const tcomp = this.tcomps[c]!
      if (r > tcomp.cod.levels) return
      const key = `${l}/${r}/${c}/${p}`
      if (this.decodedPackets.has(key)) return
      if (this.packetHeaders === null && this.pos === this.data.length) { this.exhausted = true; return }
      if (this.packetHeaders !== null && this.packetHeaderPosition === this.packetHeaders.length) { this.exhausted = true; return }
      this.decodePacket(tcomp, r, p, l)
      this.decodedPackets.add(key)
    }
    const decodeRange = (change: ProgressionChange): void => {
      const l0 = change.startLayer
      const l1 = Math.min(change.endLayer, this.cod.layers)
      const r0 = change.startResolution
      const r1 = Math.min(change.endResolution, maxLevels + 1)
      const c0 = change.startComponent
      const c1 = Math.min(change.endComponent, comps)
      if (change.progression === 0) { // LRCP
        for (let l = l0; l < l1; l++) {
          for (let r = r0; r < r1; r++) {
            for (let c = c0; c < c1; c++) {
              const resolution = this.tcomps[c]!.resolutions[r]
              if (resolution === undefined) continue
              for (let p = 0; p < resolution.precincts.length; p++) visit(l, r, c, p)
            }
          }
        }
      } else if (change.progression === 1) { // RLCP
        for (let r = r0; r < r1; r++) {
          for (let l = l0; l < l1; l++) {
            for (let c = c0; c < c1; c++) {
              const resolution = this.tcomps[c]!.resolutions[r]
              if (resolution === undefined) continue
              for (let p = 0; p < resolution.precincts.length; p++) visit(l, r, c, p)
            }
          }
        }
      } else if (change.progression === 2) { // RPCL
        for (let r = r0; r < r1; r++) {
          const packets = this.positionPackets(r, r + 1, c0, c1)
          for (const packet of packets) {
            for (let l = l0; l < l1; l++) visit(l, packet.r, packet.c, packet.p)
          }
        }
      } else if (change.progression === 3) { // PCRL
        const packets = this.positionPackets(r0, r1, c0, c1)
        packets.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.c - b.c || a.r - b.r })
        for (const packet of packets) {
          for (let l = l0; l < l1; l++) visit(l, packet.r, packet.c, packet.p)
        }
      } else if (change.progression === 4) { // CPRL
        for (let c = c0; c < c1; c++) {
          const packets = this.positionPackets(r0, r1, c, c + 1)
          packets.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.r - b.r })
          for (const packet of packets) {
            for (let l = l0; l < l1; l++) visit(l, packet.r, packet.c, packet.p)
          }
        }
      } else {
        throw new Error(`JPX error: unknown progression order ${change.progression}`)
      }
    }
    if (this.progressionChanges.length === 0) {
      decodeRange({
        startLayer: 0, endLayer: this.cod.layers,
        startResolution: 0, endResolution: maxLevels + 1,
        startComponent: 0, endComponent: comps,
        progression: this.cod.progression,
      })
    } else {
      for (let i = 0; i < this.progressionChanges.length; i++) decodeRange(this.progressionChanges[i]!)
    }
    if (this.pos !== this.data.length) throw new Error('JPX error: tile-part contains data outside its packet progression')
    if (this.packetHeaders !== null && this.packetHeaderPosition !== this.packetHeaders.length) {
      throw new Error('JPX error: packed packet-header data remains after the tile-part progression')
    }
  }

  private positionPackets(r0: number, r1: number, c0: number, c1: number): { x: number, y: number, r: number, c: number, p: number }[] {
    const packets: { x: number, y: number, r: number, c: number, p: number }[] = []
    for (let c = c0; c < c1; c++) {
      const component = this.tcomps[c]!
      for (let r = r0; r < r1; r++) {
        const resolution = component.resolutions[r]
        if (resolution === undefined) continue
        for (let p = 0; p < resolution.precincts.length; p++) {
          const precinct = resolution.precincts[p]!
          packets.push({
            x: precinct.x * (1 << resolution.scale) * component.xSubsampling,
            y: precinct.y * (1 << resolution.scale) * component.ySubsampling,
            r, c, p,
          })
        }
      }
    }
    packets.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.c - b.c || a.r - b.r })
    return packets
  }

  private decodePacket(tcomp: TileComponent, r: number, precinctNumber: number, layer: number): void {
    const res = tcomp.resolutions[r]!
    const precinct = res.precincts[precinctNumber]!
    // SOP marker segment
    if (this.cod.sop) {
      if (this.pos + 5 >= this.data.length
        || this.data[this.pos] !== 0xFF || this.data[this.pos + 1] !== 0x91
        || readU16(this.data, this.pos + 2) !== 4) {
        throw new Error('JPX error: missing or invalid SOP marker')
      }
      if (readU16(this.data, this.pos + 4) !== this.expectedSop) {
        throw new Error('JPX error: SOP packet sequence is out of order')
      }
      this.expectedSop = (this.expectedSop + 1) & 0xffff
      this.pos += 6
    }
    const headerBytes = this.packetHeaders ?? this.data
    const headerStart = this.packetHeaders === null ? this.pos : this.packetHeaderPosition
    const reader = new PacketBitReader(headerBytes, headerStart)
    const nonEmpty = reader.readBit()
    const contributions: { block: CodeBlock, segments: { passes: number, length: number, passStart: number, segmentId: number, raw: boolean }[] }[] = []
    if (nonEmpty === 1) {
      for (let s = 0; s < res.subbands.length; s++) {
        const sb = res.subbands[s]!
        const precinctSubband = precinct.subbands[s]!
        for (const blockIndex of precinctSubband.blockIndices) {
          const block = sb.blocks[blockIndex]!
          const bx = block.gridX - precinctSubband.gridX0
          const by = block.gridY - precinctSubband.gridY0
          let included: boolean
          if (!block.included) {
            included = precinctSubband.inclusionTree.decode(reader, bx, by, layer + 1)
          } else {
            included = reader.readBit() === 1
          }
          if (!included) continue
          if (!block.included) {
            block.included = true
            block.zeroBitPlanes = precinctSubband.zeroTree.decodeValue(reader, bx, by)
          }
          // Number of coding passes (Table B.4)
          let passes: number
          if (reader.readBit() === 0) passes = 1
          else if (reader.readBit() === 0) passes = 2
          else {
            const v = reader.readBits(2)
            if (v < 3) passes = 3 + v
            else {
              const v2 = reader.readBits(5)
              if (v2 < 31) passes = 6 + v2
              else passes = 37 + reader.readBits(7)
            }
          }
          // Code-block length: Lblock update then length bits
          while (reader.readBit() === 1) block.lBlock++
          const segments = codeBlockPassSegments(tcomp.cod.cbStyle, block.passesTotal, passes)
          for (const segment of segments) {
            const lengthBits = block.lBlock + Math.floor(Math.log2(segment.passes))
            segment.length = reader.readBits(lengthBits)
          }
          contributions.push({ block, segments })
        }
      }
    }
    reader.align()
    if (this.packetHeaders === null) this.pos = reader.pos
    else this.packetHeaderPosition = reader.pos
    // EPH marker
    if (this.cod.eph) {
      let found = false
      if (this.packetHeaders !== null
        && this.packetHeaderPosition + 1 < this.packetHeaders.length
        && this.packetHeaders[this.packetHeaderPosition] === 0xFF
        && this.packetHeaders[this.packetHeaderPosition + 1] === 0x92) {
        this.packetHeaderPosition += 2
        found = true
      } else if (this.pos + 1 < this.data.length
        && this.data[this.pos] === 0xFF && this.data[this.pos + 1] === 0x92) {
        this.pos += 2
        found = true
      }
      if (!found) throw new Error('JPX error: missing EPH marker')
    }
    // Body: code-block data segments in order
    for (const { block, segments } of contributions) {
      for (const segment of segments) {
        if (segment.length < 0 || this.pos + segment.length > this.data.length) {
          throw new Error('JPX error: code-block segment extends past tile-part data')
        }
        block.data.push({
          bytes: this.data,
          start: this.pos,
          end: this.pos + segment.length,
          passes: segment.passes,
          passStart: segment.passStart,
          segmentId: segment.segmentId,
          raw: segment.raw,
        })
        block.passesTotal += segment.passes
        this.pos += segment.length
      }
    }
  }
}

function codeBlockPassSegments(
  style: number,
  firstPass: number,
  passCount: number,
): { passes: number, length: number, passStart: number, segmentId: number, raw: boolean }[] {
  const result: { passes: number, length: number, passStart: number, segmentId: number, raw: boolean }[] = []
  let pass = firstPass
  const end = firstPass + passCount
  while (pass < end) {
    let segmentId = 0
    let segmentEnd = end
    let raw = (style & 0x01) !== 0 && pass >= 10 && (pass - 10) % 3 < 2
    if ((style & 0x04) !== 0) {
      segmentId = pass
      segmentEnd = pass + 1
    } else if ((style & 0x01) !== 0) {
      if (pass < 10) {
        segmentId = 0
        segmentEnd = 10
      } else {
        const cycle = Math.floor((pass - 10) / 3)
        const phase = (pass - 10) % 3
        raw = phase < 2
        segmentId = 1 + cycle * 2 + (raw ? 0 : 1)
        segmentEnd = raw ? 10 + cycle * 3 + 2 : pass + 1
      }
    }
    const passes = Math.min(end, segmentEnd) - pass
    result.push({ passes, length: 0, passStart: pass, segmentId, raw })
    pass += passes
  }
  return result
}

// ─── Tier-1: EBCOT code-block decoding (ISO 15444-1 Annex D) ───

// Context assignment tables for the significance propagation pass.
// Indexed by (sum of significant h, v, d neighbors) per band orientation.
function significanceContext(h: number, v: number, d: number, bandType: number): number {
  // LL and LH bands (vertical high-pass treats h/v swapped for HL)
  if (bandType === 1) { const t = h; h = v; v = t }  // HL: swap
  if (bandType === 3) {
    // HH: diagonal-driven
    if (d >= 3) return 8
    if (d === 2) return h + v >= 1 ? 7 : 6
    if (d === 1) return h + v >= 2 ? 5 : h + v === 1 ? 4 : 3
    return h + v >= 2 ? 2 : h + v === 1 ? 1 : 0
  }
  if (h === 2) return 8
  if (h === 1) return v >= 1 ? 7 : d >= 1 ? 6 : 5
  if (v === 2) return 4
  if (v === 1) return 3
  if (d >= 2) return 2
  return d === 1 ? 1 : 0
}

/** Sign context: [context, xorBit] from h/v neighbor sign contributions. */
function signContext(hc: number, vc: number): [number, number] {
  // hc, vc in -1..1 (net contribution)
  if (hc === 1) {
    if (vc === 1) return [13, 0]
    if (vc === 0) return [12, 0]
    return [11, 0]
  }
  if (hc === 0) {
    if (vc === 1) return [10, 0]
    if (vc === 0) return [9, 0]
    return [10, 1]
  }
  if (vc === 1) return [11, 1]
  if (vc === 0) return [12, 1]
  return [13, 1]
}

const CX_UNIFORM = 18
const CX_RUNLENGTH = 17

function decodeTileComponentCoefficients(tcomp: TileComponent, component: ComponentInfo, roiShift: number): void {
  const reversible = tcomp.cod.transform === 1
  for (let r = 0; r < tcomp.resolutions.length; r++) {
    const res = tcomp.resolutions[r]!
    for (const sb of res.subbands) {
      // Mb: max bit planes (E.1)
      const gainLog2 = sb.type === 0 ? 0 : sb.type === 3 ? 2 : 1
      const mb = sb.exponent + tcomp.qcd.guardBits - 1 + roiShift
      for (const block of sb.blocks) {
        if (block.data.length === 0 || !block.included) continue
        decodeCodeBlock(block, sb, mb, tcomp.cod.cbStyle)
      }
      if (roiShift !== 0) {
        const divisor = Math.pow(2, roiShift)
        for (let i = 0; i < sb.coefficients.length; i++) {
          const value = sb.coefficients[i]!
          if (Math.abs(value) >= divisor) sb.coefficients[i] = Math.trunc(value / divisor)
        }
      }
      // Inverse quantization into coefficients
      if (!reversible) {
        const w = sb.x1 - sb.x0
        const rb = component.depth + gainLog2
        const delta = Math.pow(2, rb - sb.exponent) * (1 + sb.mantissa / 2048)
        const coefficients = sb.coefficients
        for (let i = 0; i < coefficients.length; i++) {
          coefficients[i] = coefficients[i]! * delta
        }
        void w
      }
    }
  }
}

class RawCodeBlockReader {
  private position = 0
  private value = 0
  private bits = 0
  private previous = -1

  constructor(private readonly data: Uint8Array) {}

  readBit(): number {
    if (this.bits === 0) {
      if (this.position >= this.data.length) throw new Error('JPX error: raw code-block segment overrun')
      this.value = this.data[this.position++]!
      this.bits = this.previous === 0xff ? 7 : 8
      this.previous = this.value
    }
    this.bits--
    return (this.value >> this.bits) & 1
  }
}

function decodeCodeBlock(block: CodeBlock, sb: SubbandInfo, mb: number, codeBlockStyle: number): void {
  const w = block.x1 - block.x0
  const h = block.y1 - block.y0
  if (w <= 0 || h <= 0) return
  const grouped = new Map<number, typeof block.data>()
  for (const data of block.data) {
    const entries = grouped.get(data.segmentId) ?? []
    entries.push(data)
    grouped.set(data.segmentId, entries)
  }
  const entropySegments: { startPass: number, endPass: number, mq: MqDecoder | null, raw: RawCodeBlockReader | null }[] = []
  for (const entries of grouped.values()) {
    let total = 0
    let startPass = Number.MAX_SAFE_INTEGER
    let endPass = 0
    for (const entry of entries) {
      total += entry.end - entry.start
      startPass = Math.min(startPass, entry.passStart)
      endPass = Math.max(endPass, entry.passStart + entry.passes)
    }
    const stream = new Uint8Array(total)
    let offset = 0
    for (const entry of entries) {
      stream.set(entry.bytes.subarray(entry.start, entry.end), offset)
      offset += entry.end - entry.start
    }
    entropySegments.push({
      startPass,
      endPass,
      mq: entries[0]!.raw ? null : new MqDecoder(stream),
      raw: entries[0]!.raw ? new RawCodeBlockReader(stream) : null,
    })
  }
  entropySegments.sort(function (a, b) { return a.startPass - b.startPass })
  const contexts: MqContext[] = []
  const resetContexts = (): void => {
    if (contexts.length === 0) for (let i = 0; i < 19; i++) contexts.push(newMqContext(0))
    for (let i = 0; i < contexts.length; i++) { contexts[i]!.index = 0; contexts[i]!.mps = 0 }
    contexts[CX_UNIFORM]!.index = 46
    contexts[CX_RUNLENGTH]!.index = 3
    contexts[0]!.index = 4
  }
  resetContexts()

  const magnitudes = new Int32Array(w * h)
  const signs = new Uint8Array(w * h)
  const significant = new Uint8Array(w * h)
  const firstRefinement = new Uint8Array(w * h)
  const visited = new Uint8Array(w * h)
  /** Bit-plane index of each coefficient's least significant decoded bit */
  const lsbPlane = new Int32Array(w * h)

  const bitPlanes = mb - block.zeroBitPlanes
  let currentPlane = 0
  let passIndex = 0
  const totalPasses = block.passesTotal
  const decodeBit = (context: MqContext): number => {
    const segment = entropySegments.find(function (candidate) {
      return passIndex >= candidate.startPass && passIndex < candidate.endPass
    })
    if (segment === undefined) throw new Error(`JPX error: missing code-block segment for pass ${passIndex}`)
    return segment.raw !== null ? segment.raw.readBit() : segment.mq!.decode(context)
  }
  const rawPass = (): boolean => entropySegments.some(function (segment) {
    return segment.raw !== null && passIndex >= segment.startPass && passIndex < segment.endPass
  })
  const verticalCausal = (codeBlockStyle & 0x08) !== 0
  const sig = (x: number, y: number, causalY = -1): number =>
    verticalCausal && causalY >= 0 && (causalY & 3) === 3 && y === causalY + 1
      ? 0
      : x >= 0 && x < w && y >= 0 && y < h && significant[y * w + x] === 1 ? 1 : 0
  const sgn = (x: number, y: number, causalY = -1): number => {
    if (verticalCausal && causalY >= 0 && (causalY & 3) === 3 && y === causalY + 1) return 0
    if (x < 0 || x >= w || y < 0 || y >= h) return 0
    const i = y * w + x
    if (significant[i] !== 1) return 0
    return signs[i] === 1 ? -1 : 1
  }

  const decodeSignificance = (x: number, y: number): void => {
    const i = y * w + x
    const hh = sig(x - 1, y, y) + sig(x + 1, y, y)
    const vv = sig(x, y - 1, y) + sig(x, y + 1, y)
    const dd = sig(x - 1, y - 1, y) + sig(x + 1, y - 1, y) + sig(x - 1, y + 1, y) + sig(x + 1, y + 1, y)
    const cx = significanceContext(hh, vv, dd, sb.type)
    if (decodeBit(contexts[cx]!) === 1) {
      // Became significant: decode the sign
      const hc = Math.max(-1, Math.min(1, sgn(x - 1, y, y) + sgn(x + 1, y, y)))
      const vc = Math.max(-1, Math.min(1, sgn(x, y - 1, y) + sgn(x, y + 1, y)))
      const [scx, xorBit] = signContext(hc, vc)
      const s = decodeBit(contexts[scx]!) ^ (rawPass() ? 0 : xorBit)
      significant[i] = 1
      signs[i] = s
      magnitudes[i] = 1
      firstRefinement[i] = 1
      lsbPlane[i] = currentPlane
    }
  }

  for (let plane = bitPlanes - 1; plane >= 0 && passIndex < totalPasses; plane--) {
    currentPlane = plane
    // Pass 1: significance propagation (skipped on the first plane)
    if (plane !== bitPlanes - 1 && passIndex < totalPasses) {
      for (let y0 = 0; y0 < h; y0 += 4) {
        for (let x = 0; x < w; x++) {
          for (let y = y0; y < Math.min(y0 + 4, h); y++) {
            const i = y * w + x
            visited[i] = 0
            if (significant[i] === 1) continue
            const hh = sig(x - 1, y, y) + sig(x + 1, y, y)
            const vv = sig(x, y - 1, y) + sig(x, y + 1, y)
            const dd = sig(x - 1, y - 1, y) + sig(x + 1, y - 1, y) + sig(x - 1, y + 1, y) + sig(x + 1, y + 1, y)
            if (hh + vv + dd === 0) continue
            visited[i] = 1
            const before = significant[i]
            decodeSignificance(x, y)
            if (before === 0 && significant[i] === 1) {
              // Newly significant at this plane: magnitude bit is implicit 1
              magnitudes[i] = 1
            }
          }
        }
      }
      passIndex++
      if ((codeBlockStyle & 0x02) !== 0) resetContexts()
    }
    // Pass 2: magnitude refinement
    if (plane !== bitPlanes - 1 && passIndex < totalPasses) {
      for (let y0 = 0; y0 < h; y0 += 4) {
        for (let x = 0; x < w; x++) {
          for (let y = y0; y < Math.min(y0 + 4, h); y++) {
            const i = y * w + x
            if (significant[i] !== 1 || visited[i] === 1) continue
            let cx: number
            if (firstRefinement[i] === 1) {
              const hh = sig(x - 1, y, y) + sig(x + 1, y, y)
              const vv = sig(x, y - 1, y) + sig(x, y + 1, y)
              const dd = sig(x - 1, y - 1, y) + sig(x + 1, y - 1, y) + sig(x - 1, y + 1, y) + sig(x + 1, y + 1, y)
              cx = hh + vv + dd > 0 ? 15 : 14
              firstRefinement[i] = 0
            } else {
              cx = 16
            }
            const bit = decodeBit(contexts[cx]!)
            magnitudes[i] = (magnitudes[i]! << 1) | bit
            lsbPlane[i] = plane
            visited[i] = 1
          }
        }
      }
      passIndex++
      if ((codeBlockStyle & 0x02) !== 0) resetContexts()
    }
    // Pass 3: cleanup
    if (passIndex < totalPasses) {
      for (let y0 = 0; y0 < h; y0 += 4) {
        for (let x = 0; x < w; x++) {
          let y = y0
          const yEnd = Math.min(y0 + 4, h)
          // Run-length mode: full column of 4, all insignificant, no visited,
          // no significant neighbors
          if (yEnd - y0 === 4) {
            let runEligible = true
            for (let yy = y0; yy < yEnd; yy++) {
              const i = yy * w + x
              if (significant[i] === 1 || visited[i] === 1) { runEligible = false; break }
              const hh = sig(x - 1, yy, yy) + sig(x + 1, yy, yy)
              const vv = sig(x, yy - 1, yy) + sig(x, yy + 1, yy)
              const dd = sig(x - 1, yy - 1, yy) + sig(x + 1, yy - 1, yy) + sig(x - 1, yy + 1, yy) + sig(x + 1, yy + 1, yy)
              if (hh + vv + dd !== 0) { runEligible = false; break }
            }
            if (runEligible) {
              if (decodeBit(contexts[CX_RUNLENGTH]!) === 0) {
                // Entire column stays insignificant
                for (let yy = y0; yy < yEnd; yy++) visited[yy * w + x] = 0
                continue
              }
              // First significant position: 2 bits (UNIFORM context)
              const pos = (decodeBit(contexts[CX_UNIFORM]!) << 1) | decodeBit(contexts[CX_UNIFORM]!)
              y = y0 + pos
              // That coefficient becomes significant: sign only
              const i = y * w + x
              const hc = Math.max(-1, Math.min(1, sgn(x - 1, y, y) + sgn(x + 1, y, y)))
              const vc = Math.max(-1, Math.min(1, sgn(x, y - 1, y) + sgn(x, y + 1, y)))
              const [scx, xorBit] = signContext(hc, vc)
              const s = decodeBit(contexts[scx]!) ^ xorBit
              significant[i] = 1
              signs[i] = s
              magnitudes[i] = 1
              firstRefinement[i] = 1
              lsbPlane[i] = plane
              y++
            }
          }
          for (; y < yEnd; y++) {
            const i = y * w + x
            if (visited[i] === 1) { visited[i] = 0; continue }
            if (significant[i] === 1) continue
            decodeSignificance(x, y)
          }
          // Clear visited for the processed column
          for (let yy = y0; yy < yEnd; yy++) visited[yy * w + x] = 0
        }
      }
      if ((codeBlockStyle & 0x20) !== 0) {
        const symbol = (decodeBit(contexts[CX_UNIFORM]!) << 3)
          | (decodeBit(contexts[CX_UNIFORM]!) << 2)
          | (decodeBit(contexts[CX_UNIFORM]!) << 1)
          | decodeBit(contexts[CX_UNIFORM]!)
        if (symbol !== 0x0a) throw new Error('JPX error: invalid code-block segmentation symbol')
      }
      passIndex++
      if ((codeBlockStyle & 0x02) !== 0) resetContexts()
    }
  }

  if ((codeBlockStyle & 0x10) !== 0 && (codeBlockStyle & 0x05) !== 0) {
    for (const segment of entropySegments) {
      if (segment.mq !== null && !segment.mq.predictableTerminationSatisfied()) {
        throw new Error('JPX error: invalid predictable code-block termination')
      }
    }
  }

  // Reconstruct coefficient values into the subband plane. Each
  // coefficient's decoded bits sit at lsbPlane[i]; truncated planes get a
  // midpoint fill (no-op for fully decoded reversible data: lsbPlane == 0).
  const sbw = sb.x1 - sb.x0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (significant[i] !== 1) continue
      let mag = magnitudes[i]!
      const shift = lsbPlane[i]!
      mag <<= shift
      if (shift > 0) mag |= 1 << (shift - 1)
      sb.coefficients[(block.y0 - sb.y0 + y) * sbw + (block.x0 - sb.x0 + x)] = signs[i] === 1 ? -mag : mag
    }
  }
}

// ─── Inverse DWT (ISO 15444-1 Annex F) ───

/**
 * Reconstructs the full-resolution tile-component plane by iteratively
 * composing LL with (HL, LH, HH) via the inverse 2D wavelet transform.
 */
function inverseDwt(tcomp: TileComponent): Float32Array {
  const reversible = tcomp.cod.transform === 1
  // Start from the resolution-0 LL band
  let ll = tcomp.resolutions[0]!.subbands[0]!.coefficients
  let llX0 = tcomp.resolutions[0]!.subbands[0]!.x0
  let llY0 = tcomp.resolutions[0]!.subbands[0]!.y0
  let llX1 = tcomp.resolutions[0]!.subbands[0]!.x1
  let llY1 = tcomp.resolutions[0]!.subbands[0]!.y1

  for (let r = 1; r < tcomp.resolutions.length; r++) {
    const res = tcomp.resolutions[r]!
    const hl = res.subbands[0]!
    const lh = res.subbands[1]!
    const hh = res.subbands[2]!
    // Compose into the resolution grid (u0..u1, v0..v1)
    const u0 = res.x0
    const v0 = res.y0
    const u1 = res.x1
    const v1 = res.y1
    const w = u1 - u0
    const h = v1 - v0
    const a = new Float32Array(w * h)
    // Interleave: even columns/rows from LL, odd from the detail bands
    // (2D synthesis: sample (u, v) draws from the band by parity)
    const llW = llX1 - llX0
    const hlW = hl.x1 - hl.x0
    const lhW = lh.x1 - lh.x0
    const hhW = hh.x1 - hh.x0
    for (let v = v0; v < v1; v++) {
      for (let u = u0; u < u1; u++) {
        const evenU = (u & 1) === 0
        const evenV = (v & 1) === 0
        let value = 0
        if (evenU && evenV) {
          const sx = (u >> 1) - llX0
          const sy = (v >> 1) - llY0
          if (sx >= 0 && sx < llW && sy >= 0 && sy < llY1 - llY0) value = ll[sy * llW + sx]!
        } else if (!evenU && evenV) {
          const sx = (u >> 1) - hl.x0
          const sy = (v >> 1) - hl.y0
          if (sx >= 0 && sx < hlW && sy >= 0 && sy < hl.y1 - hl.y0) value = hl.coefficients[sy * hlW + sx]!
        } else if (evenU && !evenV) {
          const sx = (u >> 1) - lh.x0
          const sy = (v >> 1) - lh.y0
          if (sx >= 0 && sx < lhW && sy >= 0 && sy < lh.y1 - lh.y0) value = lh.coefficients[sy * lhW + sx]!
        } else {
          const sx = (u >> 1) - hh.x0
          const sy = (v >> 1) - hh.y0
          if (sx >= 0 && sx < hhW && sy >= 0 && sy < hh.y1 - hh.y0) value = hh.coefficients[sy * hhW + sx]!
        }
        a[(v - v0) * w + (u - u0)] = value
      }
    }
    // Horizontal synthesis per row, then vertical per column
    const row = new Float32Array(w)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) row[x] = a[y * w + x]!
      inverse1d(row, u0, reversible)
      for (let x = 0; x < w; x++) a[y * w + x] = row[x]!
    }
    const col = new Float32Array(h)
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) col[y] = a[y * w + x]!
      inverse1d(col, v0, reversible)
      for (let y = 0; y < h; y++) a[y * w + x] = col[y]!
    }
    ll = a
    llX0 = u0; llY0 = v0; llX1 = u1; llY1 = v1
  }
  return ll
}

const ALPHA = -1.586134342059924
const BETA = -0.052980118572961
const GAMMA = 0.882911075530934
const DELTA = 0.443506852043971
const K = 1.230174104914001

/**
 * In-place inverse 1D wavelet synthesis on an interleaved signal whose
 * first sample has parity `i0 & 1` (5/3 reversible or 9/7 irreversible),
 * with symmetric boundary extension.
 */
function inverse1d(x: Float32Array, i0: number, reversible: boolean): void {
  const n = x.length
  if (n === 1) {
    // Single sample: pass through (odd-length degenerate case per F.3.7)
    if ((i0 & 1) === 1) x[0] = x[0]! / 2
    return
  }
  // Positions: sample k corresponds to coordinate i0 + k.
  // Even coordinates carry lowpass, odd carry highpass.
  const even = (k: number): boolean => ((i0 + k) & 1) === 0
  const get = (k: number): number => {
    // Symmetric extension
    if (k < 0) k = -k
    if (k >= n) k = 2 * (n - 1) - k
    return x[k]!
  }
  const out = new Float32Array(n)
  if (reversible) {
    // 5/3: first reconstruct even (lowpass) samples, then odd
    for (let k = 0; k < n; k++) {
      if (even(k)) {
        out[k] = get(k) - Math.floor((get(k - 1) + get(k + 1) + 2) / 4)
      }
    }
    const getE = (k: number): number => {
      if (k < 0) k = -k
      if (k >= n) k = 2 * (n - 1) - k
      return even(k) ? out[k]! : x[k]!
    }
    for (let k = 0; k < n; k++) {
      if (!even(k)) {
        out[k] = get(k) + Math.floor((getE(k - 1) + getE(k + 1)) / 2)
      }
    }
  } else {
    // 9/7: scale, then four lifting steps (F.4.8.2, reversed)
    const t = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      t[k] = even(k) ? get(k) * K : get(k) * (1 / K)
    }
    const g = (arr: Float32Array, k: number): number => {
      if (k < 0) k = -k
      if (k >= n) k = 2 * (n - 1) - k
      return arr[k]!
    }
    const s1 = new Float32Array(t)
    for (let k = 0; k < n; k++) {
      if (even(k)) s1[k] = t[k]! - DELTA * (g(t, k - 1) + g(t, k + 1))
    }
    const s2 = new Float32Array(s1)
    for (let k = 0; k < n; k++) {
      if (!even(k)) s2[k] = s1[k]! - GAMMA * (g(s1, k - 1) + g(s1, k + 1))
    }
    const s3 = new Float32Array(s2)
    for (let k = 0; k < n; k++) {
      if (even(k)) s3[k] = s2[k]! - BETA * (g(s2, k - 1) + g(s2, k + 1))
    }
    for (let k = 0; k < n; k++) {
      out[k] = !even(k) ? s3[k]! - ALPHA * (g(s3, k - 1) + g(s3, k + 1)) : s3[k]!
    }
  }
  x.set(out)
}
