/**
 * sRGB ICC profile generation
 *
 * Programmatically generates a minimal ICC v2.4 compliant sRGB IEC61966-2.1 profile.
 * Required for the PDF/A compliant OutputIntent.
 *
 * Structure:
 * - Header (128 bytes): mntr/RGB/XYZ, v2.4
 * - Tags: desc, wtpt, rXYZ, gXYZ, bXYZ, rTRC/gTRC/bTRC (shared curv), cprt
 * - D50 adapted sRGB primaries
 * - TRC: 256-entry IEC 61966-2-1 transfer curve
 */

/**
 * Generate a minimal sRGB ICC v2.4 profile
 *
 * @returns sRGB ICC profile binary
 */
export function generateSRGBIccProfile(): Uint8Array {
  const descText = 'sRGB IEC61966-2.1'
  const cprtText = 'No copyright, use freely'

  // textDescriptionType size: sig(4) + reserved(4) + asciiLen(4) + ascii + unicodeLang(4) + unicodeLen(4) + scriptCode(2) + scriptLen(1) + scriptData(67)
  const descDataLen = 4 + 4 + 4 + (descText.length + 1) + 4 + 4 + 2 + 1 + 67
  const descPadded = align4(descDataLen)

  // textType: sig(4) + reserved(4) + text (NUL terminated)
  const cprtDataLen = 4 + 4 + cprtText.length + 1
  const cprtPadded = align4(cprtDataLen)

  const xyzDataLen = 20 // XYZType: sig(4) + reserved(4) + XYZNumber(12)
  const curvEntries = 256
  const curvDataLen = 12 + curvEntries * 2
  const curvPadded = align4(curvDataLen)

  const tagCount = 9
  const tagTableSize = 4 + tagCount * 12

  const dataStart = 128 + tagTableSize
  let offset = dataStart
  const descOffset = offset; offset += descPadded
  const wtptOffset = offset; offset += xyzDataLen
  const rXYZOffset = offset; offset += xyzDataLen
  const gXYZOffset = offset; offset += xyzDataLen
  const bXYZOffset = offset; offset += xyzDataLen
  const curvOffset = offset; offset += curvPadded
  const cprtOffset = offset; offset += cprtPadded

  const profileSize = offset

  const buf = new ArrayBuffer(profileSize)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  // ─── Header (128 bytes) ───
  view.setUint32(0, profileSize)                // Profile size
  // 4-7: Preferred CMM type = 0
  view.setUint32(8, 0x02400000)                 // Version 2.4.0.0
  writeAscii4(view, 12, 'mntr')                 // Profile/Device class: monitor
  writeAscii4(view, 16, 'RGB ')                 // Color space: RGB
  writeAscii4(view, 20, 'XYZ ')                 // PCS: XYZ
  // 24-35: Creation date/time (zeroed = epoch)
  writeAscii4(view, 36, 'acsp')                 // File signature
  // 40-43: Primary platform = 0
  // 44-67: flags, manufacturer, model, attributes, rendering intent = 0
  // PCS illuminant D50 (s15Fixed16Number)
  writeS15Fixed16(view, 68, 0.9642)
  writeS15Fixed16(view, 72, 1.0)
  writeS15Fixed16(view, 76, 0.8249)
  // 80-127: creator, profile ID, reserved = 0

  // ─── Tag table ───
  view.setUint32(128, tagCount)
  let ti = 132

  // Tag entries: signature(4) + offset(4) + size(4)
  writeTagEntry(view, ti, 'desc', descOffset, descPadded); ti += 12
  writeTagEntry(view, ti, 'wtpt', wtptOffset, xyzDataLen); ti += 12
  writeTagEntry(view, ti, 'rXYZ', rXYZOffset, xyzDataLen); ti += 12
  writeTagEntry(view, ti, 'gXYZ', gXYZOffset, xyzDataLen); ti += 12
  writeTagEntry(view, ti, 'bXYZ', bXYZOffset, xyzDataLen); ti += 12
  writeTagEntry(view, ti, 'rTRC', curvOffset, curvPadded); ti += 12
  writeTagEntry(view, ti, 'gTRC', curvOffset, curvPadded); ti += 12  // shared
  writeTagEntry(view, ti, 'bTRC', curvOffset, curvPadded); ti += 12  // shared
  writeTagEntry(view, ti, 'cprt', cprtOffset, cprtPadded)

  // ─── Tag data ───

  // desc (textDescriptionType)
  writeAscii4(view, descOffset, 'desc')
  // reserved = 0 (already zeroed)
  view.setUint32(descOffset + 8, descText.length + 1) // ASCII count (including NUL)
  writeAsciiStr(bytes, descOffset + 12, descText)
  // Unicode language code = 0, Unicode count = 0, ScriptCode = 0 (already zeroed)

  // wtpt (XYZType) — D50 PCS illuminant
  writeAscii4(view, wtptOffset, 'XYZ ')
  writeS15Fixed16(view, wtptOffset + 8, 0.9642)
  writeS15Fixed16(view, wtptOffset + 12, 1.0)
  writeS15Fixed16(view, wtptOffset + 16, 0.8249)

  // rXYZ — D50 adapted sRGB red primary
  writeAscii4(view, rXYZOffset, 'XYZ ')
  writeS15Fixed16(view, rXYZOffset + 8, 0.4360747)
  writeS15Fixed16(view, rXYZOffset + 12, 0.2225045)
  writeS15Fixed16(view, rXYZOffset + 16, 0.0139322)

  // gXYZ — D50 adapted sRGB green primary
  writeAscii4(view, gXYZOffset, 'XYZ ')
  writeS15Fixed16(view, gXYZOffset + 8, 0.3850649)
  writeS15Fixed16(view, gXYZOffset + 12, 0.7168786)
  writeS15Fixed16(view, gXYZOffset + 16, 0.0971045)

  // bXYZ — D50 adapted sRGB blue primary
  writeAscii4(view, bXYZOffset, 'XYZ ')
  writeS15Fixed16(view, bXYZOffset + 8, 0.1430804)
  writeS15Fixed16(view, bXYZOffset + 12, 0.0606169)
  writeS15Fixed16(view, bXYZOffset + 16, 0.7141733)

  // curv (curvType) — exact IEC 61966-2-1 encoded-to-linear transfer curve.
  writeAscii4(view, curvOffset, 'curv')
  view.setUint32(curvOffset + 8, curvEntries)
  for (let index = 0; index < curvEntries; index++) {
    const encoded = index / (curvEntries - 1)
    const linear = encoded <= 0.04045
      ? encoded / 12.92
      : Math.pow((encoded + 0.055) / 1.055, 2.4)
    view.setUint16(curvOffset + 12 + index * 2, Math.round(linear * 65535))
  }

  // cprt (textType)
  writeAscii4(view, cprtOffset, 'text')
  writeAsciiStr(bytes, cprtOffset + 8, cprtText)

  return bytes
}

/**
 * Generate a minimal CMYK output (prtr) ICC v2.4 profile for the PDF/X
 * OutputIntent. A2B0 maps CMYK to PCSLab and B2A0 maps PCSLab to CMYK using
 * sampled ICC LUTs. The grids preserve neutral paper, process primaries, and
 * tonal transitions under the profile's multilinear interpolation.
 */
export function generateCmykIccProfile(): Uint8Array {
  const descText = 'tsreport CMYK output profile'
  const cprtText = 'No copyright, use freely'

  const descDataLen = 4 + 4 + 4 + (descText.length + 1) + 4 + 4 + 2 + 1 + 67
  const descPadded = align4(descDataLen)
  const cprtDataLen = 4 + 4 + cprtText.length + 1
  const cprtPadded = align4(cprtDataLen)
  const xyzDataLen = 20

  // mft1 (lut8): sig(4)+reserved(4)+in(1)+out(1)+grid(1)+pad(1)+matrix(36)
  //             +inputTables(in*256)+clut(grid^in*out)+outputTables(out*256)
  const A2B_IN = 4
  const A2B_OUT = 3
  const A2B_GRID = 9
  const a2bLen = 4 + 4 + 4 + 36 + A2B_IN * 256 + Math.pow(A2B_GRID, A2B_IN) * A2B_OUT + A2B_OUT * 256
  const a2bPadded = align4(a2bLen)
  const B2A_IN = 3
  const B2A_OUT = 4
  const B2A_GRID = 17
  const b2aLen = 4 + 4 + 4 + 36 + B2A_IN * 256 + Math.pow(B2A_GRID, B2A_IN) * B2A_OUT + B2A_OUT * 256
  const b2aPadded = align4(b2aLen)

  const tagCount = 5
  const tagTableSize = 4 + tagCount * 12
  const dataStart = 128 + tagTableSize
  let offset = dataStart
  const descOffset = offset; offset += descPadded
  const wtptOffset = offset; offset += xyzDataLen
  const a2bOffset = offset; offset += a2bPadded
  const b2aOffset = offset; offset += b2aPadded
  const cprtOffset = offset; offset += cprtPadded
  const profileSize = offset

  const buf = new ArrayBuffer(profileSize)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  view.setUint32(0, profileSize)
  view.setUint32(8, 0x02400000)
  writeAscii4(view, 12, 'prtr')
  writeAscii4(view, 16, 'CMYK')
  writeAscii4(view, 20, 'Lab ')
  writeAscii4(view, 36, 'acsp')
  writeS15Fixed16(view, 68, 0.9642)
  writeS15Fixed16(view, 72, 1.0)
  writeS15Fixed16(view, 76, 0.8249)

  view.setUint32(128, tagCount)
  let ti = 132
  writeTagEntry(view, ti, 'desc', descOffset, descPadded); ti += 12
  writeTagEntry(view, ti, 'wtpt', wtptOffset, xyzDataLen); ti += 12
  writeTagEntry(view, ti, 'A2B0', a2bOffset, a2bPadded); ti += 12
  writeTagEntry(view, ti, 'B2A0', b2aOffset, b2aPadded); ti += 12
  writeTagEntry(view, ti, 'cprt', cprtOffset, cprtPadded)

  writeAscii4(view, descOffset, 'desc')
  view.setUint32(descOffset + 8, descText.length + 1)
  writeAsciiStr(bytes, descOffset + 12, descText)

  writeAscii4(view, wtptOffset, 'XYZ ')
  writeS15Fixed16(view, wtptOffset + 8, 0.9642)
  writeS15Fixed16(view, wtptOffset + 12, 1.0)
  writeS15Fixed16(view, wtptOffset + 16, 0.8249)

  // A2B0: CMYK -> Lab
  writeLut8Header(view, bytes, a2bOffset, A2B_IN, A2B_OUT, A2B_GRID)
  {
    let clut = a2bOffset + 4 + 4 + 4 + 36 + A2B_IN * 256
    for (let c = 0; c < A2B_GRID; c++) {
      for (let m = 0; m < A2B_GRID; m++) {
        for (let y = 0; y < A2B_GRID; y++) {
          for (let k = 0; k < A2B_GRID; k++) {
            const denominator = A2B_GRID - 1
            const lab = cmykToLab8(c / denominator, m / denominator, y / denominator, k / denominator)
            bytes[clut++] = lab[0]
            bytes[clut++] = lab[1]
            bytes[clut++] = lab[2]
          }
        }
      }
    }
  }

  // B2A0: Lab -> process CMYK
  writeLut8Header(view, bytes, b2aOffset, B2A_IN, B2A_OUT, B2A_GRID)
  {
    let clut = b2aOffset + 4 + 4 + 4 + 36 + B2A_IN * 256
    for (let l = 0; l < B2A_GRID; l++) {
      for (let a = 0; a < B2A_GRID; a++) {
        for (let b = 0; b < B2A_GRID; b++) {
          const denominator = B2A_GRID - 1
          const cmyk = lab8ToCmyk(
            l / denominator * 255,
            a / denominator * 255,
            b / denominator * 255,
          )
          bytes[clut++] = cmyk[0]
          bytes[clut++] = cmyk[1]
          bytes[clut++] = cmyk[2]
          bytes[clut++] = cmyk[3]
        }
      }
    }
  }

  writeAscii4(view, cprtOffset, 'text')
  writeAsciiStr(bytes, cprtOffset + 8, cprtText)

  return bytes
}

/** mft1 header with identity matrix and identity 256-entry input/output tables. */
function writeLut8Header(view: DataView, bytes: Uint8Array, offset: number, inCh: number, outCh: number, grid: number): void {
  writeAscii4(view, offset, 'mft1')
  view.setUint8(offset + 8, inCh)
  view.setUint8(offset + 9, outCh)
  view.setUint8(offset + 10, grid)
  // Identity matrix (s15Fixed16, 3x3)
  const matrixOffset = offset + 12
  writeS15Fixed16(view, matrixOffset, 1)
  writeS15Fixed16(view, matrixOffset + 16, 1)
  writeS15Fixed16(view, matrixOffset + 32, 1)
  // Identity input tables
  let p = offset + 4 + 4 + 4 + 36
  for (let ch = 0; ch < inCh; ch++) {
    for (let i = 0; i < 256; i++) bytes[p++] = i
  }
  // Output tables follow the CLUT
  p += Math.pow(grid, inCh) * outCh
  for (let ch = 0; ch < outCh; ch++) {
    for (let i = 0; i < 256; i++) bytes[p++] = i
  }
}

/** Process CMYK sample (0..1 per channel) to lut8 PCSLab encoding. */
function cmykToLab8(c: number, m: number, y: number, k: number): [number, number, number] {
  const r = (1 - c) * (1 - k)
  const g = (1 - m) * (1 - k)
  const b = (1 - y) * (1 - k)
  return rgbToLab8(r, g, b)
}

function lab8ToCmyk(l8: number, a8: number, b8: number): [number, number, number, number] {
  // Lab -> XYZ -> linear-light sRGB, then under-colour removal to process CMYK.
  const L = (l8 / 255) * 100
  const A = a8 - 128
  const B = b8 - 128
  const fy = (L + 16) / 116
  const fx = fy + A / 500
  const fz = fy - B / 200
  const finv = function (t: number): number {
    const t3 = t * t * t
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787
  }
  const x = finv(fx) * 0.9642
  const yv = finv(fy) * 1.0
  const z = finv(fz) * 0.8249
  let r = 3.1338561 * x - 1.6168667 * yv - 0.4906146 * z
  let g = -0.9787684 * x + 1.9161415 * yv + 0.033454 * z
  let bb = 0.0719453 * x - 0.2289914 * yv + 1.4052427 * z
  r = Math.max(0, Math.min(1, r))
  g = Math.max(0, Math.min(1, g))
  bb = Math.max(0, Math.min(1, bb))
  const k = 1 - Math.max(r, g, bb)
  if (k >= 1) return [0, 0, 0, 255]
  const c = (1 - r - k) / (1 - k)
  const m = (1 - g - k) / (1 - k)
  const yy = (1 - bb - k) / (1 - k)
  const to8 = function (v: number): number { return Math.max(0, Math.min(255, Math.round(v * 255))) }
  return [to8(c), to8(m), to8(yy), to8(k)]
}

function rgbToLab8(r: number, g: number, b: number): [number, number, number] {
  // Linear sRGB -> XYZ (D50) -> Lab -> lut8 encoding
  const x = 0.4360747 * r + 0.3850649 * g + 0.1430804 * b
  const y = 0.2225045 * r + 0.7168786 * g + 0.0606169 * b
  const z = 0.0139322 * r + 0.0971045 * g + 0.7141733 * b
  const f = function (t: number): number {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
  }
  const fx = f(x / 0.9642)
  const fy = f(y / 1.0)
  const fz = f(z / 0.8249)
  const L = 116 * fy - 16
  const A = 500 * (fx - fy)
  const B = 200 * (fy - fz)
  const clamp8 = function (v: number): number { return Math.max(0, Math.min(255, Math.round(v))) }
  return [clamp8(L / 100 * 255), clamp8(A + 128), clamp8(B + 128)]
}

// ─── Utility functions ───

function align4(n: number): number {
  return (n + 3) & ~3
}

function writeAscii4(view: DataView, offset: number, tag: string): void {
  view.setUint8(offset, tag.charCodeAt(0))
  view.setUint8(offset + 1, tag.charCodeAt(1))
  view.setUint8(offset + 2, tag.charCodeAt(2))
  view.setUint8(offset + 3, tag.charCodeAt(3))
}

function writeAsciiStr(bytes: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    bytes[offset + i] = s.charCodeAt(i)
  }
  // NUL terminator already zeroed
}

function writeTagEntry(view: DataView, offset: number, sig: string, dataOffset: number, dataSize: number): void {
  writeAscii4(view, offset, sig)
  view.setUint32(offset + 4, dataOffset)
  view.setUint32(offset + 8, dataSize)
}

function writeS15Fixed16(view: DataView, offset: number, value: number): void {
  const fixed = Math.round(value * 65536)
  view.setInt32(offset, fixed)
}
