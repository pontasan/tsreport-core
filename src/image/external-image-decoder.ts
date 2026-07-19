import { detectImageFormat, type ImageFormat } from './image-utils.js'
import { getNodeModule, getNodeRuntimeBridge } from '../node-runtime-bridge.js'

const COLOR_TYPE_L8 = 0
const COLOR_TYPE_LA8 = 1
const COLOR_TYPE_RGB8 = 2
const COLOR_TYPE_RGBA8 = 3
const COLOR_TYPE_L16 = 4
const COLOR_TYPE_LA16 = 5
const COLOR_TYPE_RGB16 = 6
const COLOR_TYPE_RGBA16 = 7
const COLOR_TYPE_RGB32F = 8
const COLOR_TYPE_RGBA32F = 9

type JsColorType = number

interface SharpInfo {
  width: number
  height: number
  channels: number
  hasAlpha: boolean
  format: string
  depth: string
  rawChannels?: number
}

type SpawnSyncFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => {
  status: number | null
  stdout: Uint8Array
  stderr: Uint8Array
  error?: { message?: string }
}

export interface ExternalRasterInfo {
  width: number
  height: number
  bitDepth: number
  channels: number
  hasAlpha: boolean
  format: string
  colorType: JsColorType
}

export interface ExternalDecodedImage extends ExternalRasterInfo {
  pixels: Uint8Array
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

let cachedSpawnSync: SpawnSyncFn | null = null
function getSpawnSync(): SpawnSyncFn {
  if (cachedSpawnSync) return cachedSpawnSync

  const loaded = getNodeModule<{ spawnSync: SpawnSyncFn }>('node:child_process')
  if (loaded === null) {
    throw new Error('Image: external decoder module is available only in Node.js runtime')
  }
  cachedSpawnSync = loaded.spawnSync
  return loaded.spawnSync
}

function getNodeExecPath(): string {
  const runtime = getNodeRuntimeBridge()
  if (runtime === null) throw new Error('Image: process.execPath is unavailable')
  return runtime.execPath
}

function validateExpectedFormat(data: Uint8Array, expectedFormat?: Exclude<ImageFormat, 'svg' | 'unknown'>): void {
  if (!expectedFormat) return
  const actual = detectImageFormat(data)
  if (actual !== expectedFormat) {
    throw new Error(`Image: expected ${expectedFormat} but got ${actual}`)
  }
}

function decodeAscii(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!)
  return out
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}

function runSharp(mode: 'meta' | 'decode', data: Uint8Array): { info: SharpInfo, raw: Uint8Array } {
  const spawnSync = getSpawnSync()
  const nodeExecPath = getNodeExecPath()
  const result = spawnSync(
    nodeExecPath,
    ['-e', SHARP_CHILD_SCRIPT, mode],
    {
      input: data,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 512 * 1024 * 1024,
      encoding: 'buffer',
      windowsHide: true,
    },
  )

  if (result.error) {
    throw new Error(`Image: failed to execute sharp decoder: ${result.error.message ?? 'unknown error'}`)
  }
  if (result.status !== 0) {
    const stderr = decodeAscii(result.stderr)
    throw new Error(`Image: sharp decoder failed: ${stderr.trim() || 'no stderr output'}`)
  }

  const stdout = result.stdout
  if (stdout.length < 8) throw new Error('Image: invalid sharp decoder output')

  const jsonLen = readU32BE(stdout, 0)
  const rawLen = readU32BE(stdout, 4)
  if (stdout.length !== 8 + jsonLen + rawLen) {
    throw new Error('Image: corrupt sharp decoder payload')
  }

  const jsonStart = 8
  const jsonEnd = jsonStart + jsonLen
  const jsonText = decodeAscii(stdout.subarray(jsonStart, jsonEnd))
  const info = JSON.parse(jsonText) as SharpInfo
  const raw = stdout.subarray(jsonEnd, jsonEnd + rawLen)
  return { info, raw }
}

function depthToBitDepth(depth: string): number {
  if (depth === 'uchar' || depth === 'char') return 8
  if (depth === 'ushort' || depth === 'short') return 16
  if (depth === 'float') return 32
  if (depth === 'double') return 64
  return 8
}

function inferColorType(channels: number, hasAlpha: boolean, bitDepth: number): JsColorType {
  if (bitDepth <= 8) {
    if (channels === 1 && !hasAlpha) return COLOR_TYPE_L8
    if (channels === 2 || (channels === 1 && hasAlpha)) return COLOR_TYPE_LA8
    if (channels === 3 && !hasAlpha) return COLOR_TYPE_RGB8
    return COLOR_TYPE_RGBA8
  }
  if (bitDepth <= 16) {
    if (channels === 1 && !hasAlpha) return COLOR_TYPE_L16
    if (channels === 2 || (channels === 1 && hasAlpha)) return COLOR_TYPE_LA16
    if (channels === 3 && !hasAlpha) return COLOR_TYPE_RGB16
    return COLOR_TYPE_RGBA16
  }
  if (channels === 3 && !hasAlpha) return COLOR_TYPE_RGB32F
  return COLOR_TYPE_RGBA32F
}

function clamp8(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return value & 0xFF
}

function readU16(raw: Uint8Array, byteOffset: number): number {
  if (LITTLE_ENDIAN) {
    return raw[byteOffset]! | (raw[byteOffset + 1]! << 8)
  }
  return raw[byteOffset + 1]! | (raw[byteOffset]! << 8)
}

function readF32(byteOffset: number, view: DataView): number {
  return view.getFloat32(byteOffset, LITTLE_ENDIAN)
}

function readF64(byteOffset: number, view: DataView): number {
  return view.getFloat64(byteOffset, LITTLE_ENDIAN)
}

export function convertRawToRgba8(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bitDepth: number,
): Uint8Array {
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  if (bitDepth <= 8) {
    if (channels === 4) {
      if (raw.length !== pixelCount * 4) throw new Error('Image: invalid raw payload length')
      rgba.set(raw)
      return rgba
    }
    if (channels === 3) {
      if (raw.length !== pixelCount * 3) throw new Error('Image: invalid raw payload length')
      for (let i = 0; i < pixelCount; i++) {
        const si = i * 3
        const di = i * 4
        rgba[di] = raw[si]!
        rgba[di + 1] = raw[si + 1]!
        rgba[di + 2] = raw[si + 2]!
        rgba[di + 3] = 255
      }
      return rgba
    }
    if (channels === 2) {
      if (raw.length !== pixelCount * 2) throw new Error('Image: invalid raw payload length')
      for (let i = 0; i < pixelCount; i++) {
        const si = i * 2
        const di = i * 4
        const v = raw[si]!
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = raw[si + 1]!
      }
      return rgba
    }
    if (channels === 1) {
      if (raw.length !== pixelCount) throw new Error('Image: invalid raw payload length')
      for (let i = 0; i < pixelCount; i++) {
        const v = raw[i]!
        const di = i * 4
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = 255
      }
      return rgba
    }
    throw new Error(`Image: unsupported channel count ${channels}`)
  }

  if (bitDepth <= 16) {
    const bytesPerPixel = channels * 2
    if (raw.length !== pixelCount * bytesPerPixel) throw new Error('Image: invalid raw payload length')
    for (let i = 0; i < pixelCount; i++) {
      const si = i * bytesPerPixel
      const di = i * 4
      if (channels === 4 || channels === 3) {
        rgba[di] = (readU16(raw, si) + 128) >> 8
        rgba[di + 1] = (readU16(raw, si + 2) + 128) >> 8
        rgba[di + 2] = (readU16(raw, si + 4) + 128) >> 8
        rgba[di + 3] = channels === 4 ? (readU16(raw, si + 6) + 128) >> 8 : 255
      } else if (channels === 2 || channels === 1) {
        const v = (readU16(raw, si) + 128) >> 8
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = channels === 2 ? (readU16(raw, si + 2) + 128) >> 8 : 255
      } else {
        throw new Error(`Image: unsupported channel count ${channels}`)
      }
    }
    return rgba
  }

  if (bitDepth <= 32) {
    const bytesPerPixel = channels * 4
    if (raw.length !== pixelCount * bytesPerPixel) throw new Error('Image: invalid raw payload length')
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    for (let i = 0; i < pixelCount; i++) {
      const si = i * bytesPerPixel
      const di = i * 4
      if (channels === 4 || channels === 3) {
        rgba[di] = clamp8(Math.round(readF32(si, view) * 255))
        rgba[di + 1] = clamp8(Math.round(readF32(si + 4, view) * 255))
        rgba[di + 2] = clamp8(Math.round(readF32(si + 8, view) * 255))
        rgba[di + 3] = channels === 4 ? clamp8(Math.round(readF32(si + 12, view) * 255)) : 255
      } else if (channels === 2 || channels === 1) {
        const v = clamp8(Math.round(readF32(si, view) * 255))
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = channels === 2 ? clamp8(Math.round(readF32(si + 4, view) * 255)) : 255
      } else {
        throw new Error(`Image: unsupported channel count ${channels}`)
      }
    }
    return rgba
  }

  if (bitDepth <= 64) {
    const bytesPerPixel = channels * 8
    if (raw.length !== pixelCount * bytesPerPixel) throw new Error('Image: invalid raw payload length')
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    for (let i = 0; i < pixelCount; i++) {
      const si = i * bytesPerPixel
      const di = i * 4
      if (channels === 4 || channels === 3) {
        rgba[di] = clamp8(Math.round(readF64(si, view) * 255))
        rgba[di + 1] = clamp8(Math.round(readF64(si + 8, view) * 255))
        rgba[di + 2] = clamp8(Math.round(readF64(si + 16, view) * 255))
        rgba[di + 3] = channels === 4 ? clamp8(Math.round(readF64(si + 24, view) * 255)) : 255
      } else if (channels === 2 || channels === 1) {
        const v = clamp8(Math.round(readF64(si, view) * 255))
        rgba[di] = v
        rgba[di + 1] = v
        rgba[di + 2] = v
        rgba[di + 3] = channels === 2 ? clamp8(Math.round(readF64(si + 8, view) * 255)) : 255
      } else {
        throw new Error(`Image: unsupported channel count ${channels}`)
      }
    }
    return rgba
  }

  throw new Error(`Image: unsupported bit depth ${bitDepth}`)
}

function buildExternalInfo(info: SharpInfo): ExternalRasterInfo {
  const width = info.width | 0
  const height = info.height | 0
  if (width <= 0 || height <= 0) throw new Error('Image: invalid raster dimensions')
  const bitDepth = depthToBitDepth(info.depth)
  const channels = info.channels | 0
  if (channels <= 0) throw new Error('Image: invalid channel count')
  return {
    width,
    height,
    bitDepth,
    channels,
    hasAlpha: !!info.hasAlpha,
    format: info.format || 'unknown',
    colorType: inferColorType(channels, !!info.hasAlpha, bitDepth),
  }
}

export function readRasterInfoWithExternalDecoder(
  data: Uint8Array,
  expectedFormat?: Exclude<ImageFormat, 'svg' | 'unknown'>,
): ExternalRasterInfo {
  validateExpectedFormat(data, expectedFormat)
  const { info } = runSharp('meta', data)
  return buildExternalInfo(info)
}

export function decodeRasterWithExternalDecoder(
  data: Uint8Array,
  expectedFormat?: Exclude<ImageFormat, 'svg' | 'unknown'>,
): ExternalDecodedImage {
  validateExpectedFormat(data, expectedFormat)
  const { info, raw } = runSharp('decode', data)
  const externalInfo = buildExternalInfo(info)
  const rawChannels = info.rawChannels ?? externalInfo.channels
  const pixels = convertRawToRgba8(raw, externalInfo.width, externalInfo.height, rawChannels, externalInfo.bitDepth)
  return {
    ...externalInfo,
    pixels,
  }
}

const SHARP_CHILD_SCRIPT = String.raw`
const fs = require('node:fs');

function writePayload(info, raw) {
  const json = Buffer.from(JSON.stringify(info), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(json.length >>> 0, 0);
  header.writeUInt32BE(raw.length >>> 0, 4);
  process.stdout.write(header);
  process.stdout.write(json);
  if (raw.length > 0) process.stdout.write(raw);
}

function depthName(metadataDepth, infoDepth) {
  if (typeof metadataDepth === 'string' && metadataDepth.length > 0) return metadataDepth;
  if (typeof infoDepth === 'string' && infoDepth.length > 0) return infoDepth;
  return 'uchar';
}

// Upper bound on decoded pixels. Generous for legitimate report imagery
// (~14000x14000) while keeping sharp's decompression-bomb protection: a tiny
// image declaring enormous dimensions is rejected instead of exhausting memory.
const MAX_INPUT_PIXELS = 200000000;

async function main() {
  const sharp = require('sharp');
  const mode = process.argv[1] || 'decode';
  const input = fs.readFileSync(0);

  const meta = await sharp(input, { animated: false, pages: 1, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!meta || !meta.width || !meta.height) {
    throw new Error('sharp metadata missing dimensions');
  }

  if (mode === 'meta') {
    writePayload({
      width: meta.width | 0,
      height: meta.height | 0,
      channels: (meta.channels || 4) | 0,
      hasAlpha: !!meta.hasAlpha,
      format: String(meta.format || ''),
      depth: depthName(meta.depth, ''),
    }, Buffer.alloc(0));
    return;
  }

  const decoded = await sharp(input, { animated: false, pages: 1, limitInputPixels: MAX_INPUT_PIXELS })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!decoded || !decoded.info || !decoded.info.width || !decoded.info.height) {
    throw new Error('sharp raw decode failed');
  }

  writePayload({
    width: decoded.info.width | 0,
    height: decoded.info.height | 0,
    channels: (meta.channels || decoded.info.channels || 4) | 0,
    rawChannels: (decoded.info.channels || 4) | 0,
    hasAlpha: !!meta.hasAlpha,
    format: String(meta.format || ''),
    depth: depthName(decoded.info.depth, meta.depth),
  }, decoded.data);
}

main().catch((err) => {
  process.stderr.write(String((err && err.stack) || (err && err.message) || err));
  process.exit(1);
});
`
