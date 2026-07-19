// JPEG 2000 decoder against OpenJPEG-encoded oracles: lossless 5/3 streams
// must reproduce the source pixels exactly (gray, RGB+RCT, odd sizes,
// multiple decomposition levels); irreversible 9/7 within a tight error
// bound. Fixtures generated with opj_compress (see fixtures/jpx).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeJpx } from '../../src/compression/jpx-decoder.js'

const DIR = join(__dirname, '..', 'fixtures', 'jpx')
const OPENJPEG_AVAILABLE = spawnSync('opj_compress', ['-h']).error === undefined &&
  spawnSync('opj_decompress', ['-h']).error === undefined
if (process.env.TSREPORT_CONFORMANCE === '1' && !OPENJPEG_AVAILABLE) {
  throw new Error('JPX conformance requires opj_compress')
}

function readPnm(name: string): { width: number, height: number, channels: number, pixels: Uint8Array } {
  return readPnmFile(join(DIR, name))
}

function readPnmFile(path: string): { width: number, height: number, channels: number, pixels: Uint8Array } {
  const bytes = readFileSync(path)
  let position = 0
  const token = (): string => {
    while (position < bytes.length) {
      if (bytes[position] === 0x23) {
        while (position < bytes.length && bytes[position] !== 0x0a) position++
      } else if (bytes[position]! <= 0x20) position++
      else break
    }
    const start = position
    while (position < bytes.length && bytes[position]! > 0x20 && bytes[position] !== 0x23) position++
    return bytes.subarray(start, position).toString('ascii')
  }
  const magic = token()
  if (magic !== 'P5' && magic !== 'P6') throw new Error('bad pnm')
  const channels = magic === 'P6' ? 3 : 1
  const width = Number(token())
  const height = Number(token())
  const maximum = Number(token())
  if (!Number.isInteger(width) || !Number.isInteger(height) || maximum !== 255) throw new Error('bad pnm')
  if (bytes[position] === 0x0d && bytes[position + 1] === 0x0a) position += 2
  else if (bytes[position]! <= 0x20) position++
  else throw new Error('bad pnm')
  return { width, height, channels, pixels: new Uint8Array(bytes.subarray(position)) }
}

function jp2Box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length, false)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  return out
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce(function (sum, part) { return sum + part.length }, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

function indexedJpxMarker(marker: number, index: number, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(5 + payload.length)
  result[0] = marker >> 8
  result[1] = marker & 0xff
  new DataView(result.buffer).setUint16(2, 3 + payload.length, false)
  result[4] = index
  result.set(payload, 5)
  return result
}

function moveSinglePacketHeader(codestream: Uint8Array, target: 'PPM' | 'PPT', headerLength: number): Uint8Array {
  const sot = findJpxMarker(codestream, 0xff90, 2, codestream.length)
  const sod = findJpxMarker(codestream, 0xff93, sot, codestream.length)
  const tilePartLength = new DataView(codestream.buffer, codestream.byteOffset + sot + 6, 4).getUint32(0, false)
  const header = codestream.slice(sod + 2, sod + 2 + headerLength)
  if (target === 'PPT') {
    const first = indexedJpxMarker(0xff61, 0, header.slice(0, 1))
    const second = indexedJpxMarker(0xff61, 1, header.slice(1))
    const markers = joinBytes([first, second])
    const result = joinBytes([
      codestream.slice(0, sod), markers, codestream.slice(sod, sod + 2), codestream.slice(sod + 2 + headerLength),
    ])
    new DataView(result.buffer).setUint32(sot + 6, tilePartLength + markers.length - headerLength, false)
    return result
  }
  const packed = new Uint8Array(4 + header.length)
  new DataView(packed.buffer).setUint32(0, header.length, false)
  packed.set(header, 4)
  const first = indexedJpxMarker(0xff60, 0, packed.slice(0, 2))
  const second = indexedJpxMarker(0xff60, 1, packed.slice(2))
  const markers = joinBytes([first, second])
  const result = joinBytes([
    codestream.slice(0, sot), markers, codestream.slice(sot, sod + 2), codestream.slice(sod + 2 + headerLength),
  ])
  new DataView(result.buffer).setUint32(sot + markers.length + 6, tilePartLength - headerLength, false)
  return result
}

function paletteJp2(codestream: Uint8Array, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(14)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, height, false)
  ihdrView.setUint32(4, width, false)
  ihdrView.setUint16(8, 1, false)
  ihdr[10] = 7
  ihdr[11] = 7
  const palette = new Uint8Array(3 + 4 + 256 * 4)
  const paletteView = new DataView(palette.buffer)
  paletteView.setUint16(0, 256, false)
  palette[2] = 4
  palette.fill(7, 3, 7)
  for (let index = 0; index < 256; index++) {
    palette[7 + index * 4] = index
    palette[8 + index * 4] = 255 - index
    palette[9 + index * 4] = index ^ 0x55
    palette[10 + index * 4] = index
  }
  const cmap = new Uint8Array(16)
  for (let channel = 0; channel < 4; channel++) {
    cmap[channel * 4 + 2] = 1
    cmap[channel * 4 + 3] = channel
  }
  const cdef = new Uint8Array(26)
  const cdefView = new DataView(cdef.buffer)
  cdefView.setUint16(0, 4, false)
  for (let channel = 0; channel < 4; channel++) {
    const offset = 2 + channel * 6
    cdefView.setUint16(offset, channel, false)
    cdefView.setUint16(offset + 2, channel === 3 ? 1 : 0, false)
    cdefView.setUint16(offset + 4, channel === 3 ? 0 : channel + 1, false)
  }
  const colr = Uint8Array.from([1, 0, 0, 0, 0, 0, 16])
  const jp2h = jp2Box('jp2h', joinBytes([
    jp2Box('ihdr', ihdr), jp2Box('colr', colr), jp2Box('pclr', palette),
    jp2Box('cmap', cmap), jp2Box('cdef', cdef),
  ]))
  return joinBytes([
    jp2Box('jP  ', Uint8Array.from([0x0d, 0x0a, 0x87, 0x0a])),
    jp2Box('ftyp', Uint8Array.from([0x6a, 0x70, 0x32, 0x20, 0, 0, 0, 0, 0x6a, 0x70, 0x32, 0x20])),
    jp2h,
    jp2Box('jp2c', codestream),
  ])
}

describe('JPX decoder (OpenJPEG oracles)', () => {
  it('decodes a lossless gray codestream exactly', () => {
    const src = readPnm('gray8.pgm')
    const img = decodeJpx(new Uint8Array(readFileSync(join(DIR, 'gray8-lossless.j2k'))))
    expect(img.width).toBe(src.width)
    expect(img.height).toBe(src.height)
    expect(img.componentCount).toBe(1)
    expect(Array.from(img.data)).toEqual(Array.from(src.pixels))
  })

  it('decodes a lossless RGB JP2 (RCT) exactly', () => {
    const src = readPnm('rgb16.ppm')
    const img = decodeJpx(new Uint8Array(readFileSync(join(DIR, 'rgb16-lossless.jp2'))))
    expect(img.width).toBe(src.width)
    expect(img.height).toBe(src.height)
    expect(img.componentCount).toBe(3)
    expect(Array.from(img.data)).toEqual(Array.from(src.pixels))
  })

  it('decodes odd-size noise with 3 decomposition levels exactly', () => {
    const src = readPnm('noise33.pgm')
    const img = decodeJpx(new Uint8Array(readFileSync(join(DIR, 'noise33-lossless.j2k'))))
    expect(img.width).toBe(33)
    expect(img.height).toBe(17)
    expect(Array.from(img.data)).toEqual(Array.from(src.pixels))
  })

  it('decodes an irreversible 9/7 (ICT) stream within tolerance', () => {
    const src = readPnm('rgb16.ppm')
    const img = decodeJpx(new Uint8Array(readFileSync(join(DIR, 'rgb16-irrev-hq.j2k'))))
    expect(img.width).toBe(src.width)
    let maxError = 0
    for (let i = 0; i < src.pixels.length; i++) {
      maxError = Math.max(maxError, Math.abs(img.data[i]! - src.pixels[i]!))
    }
    // Near-lossless rate: only float rounding and quantization remain
    expect(maxError).toBeLessThanOrEqual(6)
  })

  it('applies JP2 palette, component mapping, colour association, and alpha definitions', function () {
    const source = readPnm('gray8.pgm')
    const codestream = Uint8Array.from(readFileSync(join(DIR, 'gray8-lossless.j2k')))
    const image = decodeJpx(paletteJp2(codestream, source.width, source.height))
    expect(image.componentCount).toBe(4)
    expect(image.colorSpace).toBe('rgb')
    expect(image.colorChannels).toEqual([0, 1, 2])
    expect(image.alphaChannel).toBe(3)
    expect(image.premultipliedAlpha).toBe(false)
    expect(image.componentBitDepths).toEqual([8, 8, 8, 8])
    for (let pixel = 0; pixel < source.pixels.length; pixel++) {
      const index = source.pixels[pixel]!
      expect(Array.from(image.data.slice(pixel * 4, pixel * 4 + 4))).toEqual([index, 255 - index, index ^ 0x55, index])
    }
  })
})

describe.skipIf(!OPENJPEG_AVAILABLE)('JPX OpenJPEG generated precision and subsampling oracles', function () {
  let directory = ''

  beforeAll(function () {
    directory = mkdtempSync(join(tmpdir(), 'tsreport-jpx-openjpeg-'))
  })

  afterAll(function () {
    rmSync(directory, { recursive: true, force: true })
  })

  it('maps independently subsampled component grids to the reference grid', function () {
    const rawPath = join(directory, 'subsample.raw')
    const j2kPath = join(directory, 'subsample.j2k')
    writeFileSync(rawPath, Uint8Array.from([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      20, 30, 40, 50,
      100, 110, 120, 130,
    ]))
    execFileSync('opj_compress', [
      '-i', rawPath,
      '-o', j2kPath,
      '-F', '4,4,3,8,u@1x1:2x2:2x2',
      '-n', '1',
      '-mct', '0',
    ], { stdio: 'ignore' })

    const image = decodeJpx(Uint8Array.from(readFileSync(j2kPath)))
    expect(image.componentBitDepths).toEqual([8, 8, 8])
    expect(image.data).toBeInstanceOf(Uint8Array)
    const expected: number[] = []
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expected.push(
          y * 4 + x,
          [20, 30, 40, 50][Math.floor(y / 2) * 2 + Math.floor(x / 2)]!,
          [100, 110, 120, 130][Math.floor(y / 2) * 2 + Math.floor(x / 2)]!,
        )
      }
    }
    expect(Array.from(image.data)).toEqual(expected)
  })

  it('preserves 12-bit samples without normalizing them to 8-bit', function () {
    const pgxPath = join(directory, 'precision12.pgx')
    const j2kPath = join(directory, 'precision12.j2k')
    const header = new TextEncoder().encode('PG ML + 12 3 1\n')
    const bytes = new Uint8Array(header.length + 6)
    bytes.set(header)
    bytes.set([0x00, 0x00, 0x08, 0x00, 0x0f, 0xff], header.length)
    writeFileSync(pgxPath, bytes)
    execFileSync('opj_compress', ['-i', pgxPath, '-o', j2kPath, '-n', '1'], { stdio: 'ignore' })

    const image = decodeJpx(Uint8Array.from(readFileSync(j2kPath)))
    expect(image.bitDepth).toBe(12)
    expect(image.componentBitDepths).toEqual([12])
    expect(image.data).toBeInstanceOf(Uint16Array)
    expect(Array.from(image.data)).toEqual([0, 2048, 4095])
  })

  it('preserves signed component samples and their declared precision', function () {
    const rawPath = join(directory, 'signed8.raw')
    const j2kPath = join(directory, 'signed8.j2k')
    writeFileSync(rawPath, Uint8Array.from([0x80, 0x00, 0x7f]))
    execFileSync('opj_compress', ['-i', rawPath, '-o', j2kPath, '-F', '3,1,1,8,s', '-n', '1'], { stdio: 'ignore' })
    const image = decodeJpx(Uint8Array.from(readFileSync(j2kPath)))
    expect(image.componentSigned).toEqual([true])
    expect(image.componentBitDepths).toEqual([8])
    expect(image.data).toBeInstanceOf(Float64Array)
    expect(Array.from(image.data)).toEqual([-128, 0, 127])
  })

  it('preserves component samples wider than 16 bits', function () {
    const pgxPath = join(directory, 'precision20.pgx')
    const j2kPath = join(directory, 'precision20.j2k')
    const header = new TextEncoder().encode('PG ML + 20 3 1\n')
    const bytes = new Uint8Array(header.length + 12)
    bytes.set(header)
    bytes.set([
      0, 0, 0, 0,
      0, 8, 0, 0,
      0, 15, 255, 255,
    ], header.length)
    writeFileSync(pgxPath, bytes)
    execFileSync('opj_compress', ['-i', pgxPath, '-o', j2kPath, '-n', '1'], { stdio: 'ignore' })
    const image = decodeJpx(Uint8Array.from(readFileSync(j2kPath)))
    expect(image.componentBitDepths).toEqual([20])
    expect(image.data).toBeInstanceOf(Float64Array)
    expect(Array.from(image.data)).toEqual([0, 0x80000, 0xfffff])
  })

  it('applies a tile-part POC progression change across resolutions and layers', function () {
    const j2kPath = join(directory, 'poc.j2k')
    execFileSync('opj_compress', [
      '-i', join(DIR, 'rgb16.ppm'),
      '-o', j2kPath,
      '-n', '2',
      '-r', '2,1',
      '-POC', 'T0=0,0,2,2,3,CPRL',
    ], { stdio: 'ignore' })

    const source = readPnm('rgb16.ppm')
    const image = decodeJpx(Uint8Array.from(readFileSync(j2kPath)))
    expect(Array.from(image.data)).toEqual(Array.from(source.pixels))
  })

  it.each(['LRCP', 'RLCP', 'RPCL', 'PCRL', 'CPRL'])(
    'decodes the %s progression order with two quality layers',
    function (progression) {
      const j2kPath = join(directory, `progression-${progression}.j2k`)
      execFileSync('opj_compress', [
        '-i', join(DIR, 'rgb16.ppm'),
        '-o', j2kPath,
        '-n', '2',
        '-r', '2,1',
        '-p', progression,
      ], { stdio: 'ignore' })
      const source = readPnm('rgb16.ppm')
      expect(Array.from(decodeJpx(Uint8Array.from(readFileSync(j2kPath))).data)).toEqual(Array.from(source.pixels))
    },
  )

  it.each(['R', 'L', 'C'])(
    'decodes packet data split into %s tile-parts',
    function (tilePartDimension) {
      const j2kPath = join(directory, `tile-parts-${tilePartDimension}.j2k`)
      execFileSync('opj_compress', [
        '-i', join(DIR, 'rgb16.ppm'),
        '-o', j2kPath,
        '-n', '3',
        '-r', '4,2,1',
        '-TP', tilePartDimension,
      ], { stdio: 'ignore' })
      const source = readPnm('rgb16.ppm')
      expect(Array.from(decodeJpx(Uint8Array.from(readFileSync(j2kPath))).data)).toEqual(Array.from(source.pixels))
    },
  )

  it('retains tile-part COD/COC/QCD/QCC state across later tile-parts', function () {
    const sourcePath = join(DIR, 'rgb16.ppm')
    const originalPath = join(directory, 'tile-header-state.j2k')
    execFileSync('opj_compress', [
      '-i', sourcePath, '-o', originalPath,
      '-n', '2', '-r', '2,1', '-TP', 'L',
    ], { stdio: 'ignore' })
    const original = Uint8Array.from(readFileSync(originalPath))
    const firstSot = findJpxMarker(original, 0xff90, 2, original.length)
    const firstPsot = new DataView(original.buffer, original.byteOffset + firstSot + 6, 4).getUint32(0, false)
    const secondSot = firstSot + firstPsot
    expect((original[secondSot]! << 8) | original[secondSot + 1]!).toBe(0xff90)

    const codStart = findJpxMarker(original, 0xff52, 2, firstSot)
    const qcdStart = findJpxMarker(original, 0xff5c, 2, firstSot)
    const codLength = (original[codStart + 2]! << 8) | original[codStart + 3]!
    const qcdLength = (original[qcdStart + 2]! << 8) | original[qcdStart + 3]!
    const cod = original.slice(codStart, codStart + 2 + codLength)
    const qcd = original.slice(qcdStart, qcdStart + 2 + qcdLength)
    const spcod = cod.slice(9)
    const sqcd = qcd.slice(4)
    const cocPayload = Uint8Array.from([1, cod[4]! & 1, ...spcod])
    const qccPayload = Uint8Array.from([1, ...sqcd])
    const coc = Uint8Array.from([0xff, 0x53, 0, cocPayload.length + 2, ...cocPayload])
    const qcc = Uint8Array.from([0xff, 0x5d, 0, qccPayload.length + 2, ...qccPayload])
    const injected = joinBytes([cod, coc, qcd, qcc])

    let sod = secondSot + 12
    while (((original[sod]! << 8) | original[sod + 1]!) !== 0xff93) {
      sod += 2 + ((original[sod + 2]! << 8) | original[sod + 3]!)
    }
    const mutated = new Uint8Array(original.length + injected.length)
    mutated.set(original.subarray(0, sod), 0)
    mutated.set(injected, sod)
    mutated.set(original.subarray(sod), sod + injected.length)
    const mutatedView = new DataView(mutated.buffer)
    mutatedView.setUint32(secondSot + 6, mutatedView.getUint32(secondSot + 6, false) + injected.length, false)

    const expected = readPnm('rgb16.ppm')
    const oracleInput = join(directory, 'tile-header-state-mutated.j2k')
    const oracleOutput = join(directory, 'tile-header-state-openjpeg.ppm')
    writeFileSync(oracleInput, mutated)
    execFileSync('opj_decompress', ['-i', oracleInput, '-o', oracleOutput], { stdio: 'ignore' })
    expect(Array.from(readPnmFile(oracleOutput).pixels)).toEqual(Array.from(expected.pixels))
    expect(Array.from(decodeJpx(mutated).data)).toEqual(Array.from(expected.pixels))
  })

  it.each([1, 2, 4, 8, 16, 32, 3, 5, 7, 12, 20, 36, 63])(
    'decodes code-block style mode %i',
    function (mode) {
      const j2kPath = join(directory, `style-${mode}.j2k`)
      execFileSync('opj_compress', [
        '-i', join(DIR, 'noise33.pgm'),
        '-o', j2kPath,
        '-n', '3',
        '-M', String(mode),
      ], { stdio: 'ignore' })
      const source = readPnm('noise33.pgm')
      expect(Array.from(decodeJpx(Uint8Array.from(readFileSync(j2kPath))).data)).toEqual(Array.from(source.pixels))
    },
  )

  it.each(['LRCP', 'RLCP', 'RPCL', 'PCRL', 'CPRL'])(
    'decodes explicit precinct partitions in %s order',
    function (progression) {
      const j2kPath = join(directory, `precinct-${progression}.j2k`)
      execFileSync('opj_compress', [
        '-i', join(DIR, 'noise33.pgm'),
        '-o', j2kPath,
        '-n', '3',
        '-c', '[16,16],[8,8],[4,4]',
        '-p', progression,
      ], { stdio: 'ignore' })
      const source = readPnm('noise33.pgm')
      expect(Array.from(decodeJpx(Uint8Array.from(readFileSync(j2kPath))).data)).toEqual(Array.from(source.pixels))
    },
  )

  it('reverses an RGN Maxshift component upshift', function () {
    const j2kPath = join(directory, 'rgn.j2k')
    execFileSync('opj_compress', [
      '-i', join(DIR, 'gray8.pgm'),
      '-o', j2kPath,
      '-n', '1',
      '-ROI', 'c=0,U=3',
    ], { stdio: 'ignore' })
    const source = readPnm('gray8.pgm')
    expect(Array.from(decodeJpx(Uint8Array.from(readFileSync(j2kPath))).data)).toEqual(Array.from(source.pixels))
  })

  it.each(['PPM', 'PPT'] as const)(
    'decodes packet headers moved into split %s marker segments',
    function (target) {
      const j2kPath = join(directory, `packed-header-${target}.j2k`)
      execFileSync('opj_compress', [
        '-i', join(DIR, 'gray8.pgm'), '-o', j2kPath, '-n', '1',
      ], { stdio: 'ignore' })
      const source = readPnm('gray8.pgm')
      const original = Uint8Array.from(readFileSync(j2kPath))
      const packed = moveSinglePacketHeader(original, target, 3)
      expect(Array.from(decodeJpx(packed).data)).toEqual(Array.from(source.pixels))
    },
  )

  it('validates SOP packet sequence numbers and EPH packet-header terminators', function () {
    const j2kPath = join(directory, 'sop-eph.j2k')
    execFileSync('opj_compress', [
      '-i', join(DIR, 'noise33.pgm'), '-o', j2kPath, '-n', '3', '-SOP', '-EPH',
    ], { stdio: 'ignore' })
    const source = readPnm('noise33.pgm')
    const encoded = Uint8Array.from(readFileSync(j2kPath))
    expect(Array.from(decodeJpx(encoded).data)).toEqual(Array.from(source.pixels))
    const sop = findJpxMarker(encoded, 0xff91, 2, encoded.length)
    const invalidSequence = encoded.slice()
    invalidSequence[sop + 5]! ^= 1
    expect(() => decodeJpx(invalidSequence)).toThrow('SOP packet sequence is out of order')
    const eph = findJpxMarker(encoded, 0xff92, sop + 6, encoded.length)
    const missingEph = encoded.slice()
    missingEph[eph + 1] = 0x90
    expect(() => decodeJpx(missingEph)).toThrow('missing EPH marker')
  })
})

function findJpxMarker(data: Uint8Array, marker: number, start: number, end: number): number {
  for (let position = start; position + 1 < end; position++) {
    if (((data[position]! << 8) | data[position + 1]!) === marker) return position
  }
  throw new Error(`JPX test marker 0x${marker.toString(16)} not found`)
}

describe('PDF /JPXDecode integration', () => {
  it('imports a JPX image XObject through the page importer', async () => {
    const { PdfImporter } = await import('../../src/index.js')
    const jpx = new Uint8Array(readFileSync(join(DIR, 'rgb16-lossless.jp2')))
    const src = readPnm('rgb16.ppm')
    // Hand-built PDF with a JPXDecode image
    const binary = Array.from(jpx, b => String.fromCharCode(b)).join('')
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      '4 0 obj\n<< /Length 30 >>\nstream\nq 64 0 0 48 10 10 cm /Im0 Do Q\nendstream\nendobj\n',
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 16 /Height 12 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Length ${binary.length} >>\nstream\n${binary}\nendstream\nendobj\n`,
    ]
    let offset = '%PDF-1.7\n'.length
    const offsets: number[] = [0]
    let body = ''
    for (const object of objects) {
      offsets.push(offset)
      body += object
      offset += object.length
    }
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
    const pdfText = `%PDF-1.7\n${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    const pdf = new Uint8Array(pdfText.length)
    for (let i = 0; i < pdfText.length; i++) pdf[i] = pdfText.charCodeAt(i) & 0xFF

    const page = PdfImporter.open(pdf).importPage(0)
    const image = page.elements.find(el => el.type === 'image')
    expect(image).toBeDefined()
    const png = page.images[(image as { source: string }).source]!
    // Decode the PNG and compare with the source pixels
    const { decodePng } = await import('../../src/image/png-parser.js')
    const decoded = decodePng(png)
    expect(decoded.width).toBe(16)
    expect(decoded.height).toBe(12)
    expect(decoded.pixels[0]).toBe(src.pixels[0])
    expect(decoded.pixels[1]).toBe(src.pixels[1])
    expect(decoded.pixels[2]).toBe(src.pixels[2])
  }, 20000)
})
