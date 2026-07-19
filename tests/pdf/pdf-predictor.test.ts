import { describe, expect, it } from 'vitest'
import { zlibDeflate } from '../../src/compression/deflate.js'
import { parsePdf, PdfStream } from '../../src/pdf/pdf-parser.js'

const encoder = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (let i = 0; i < parts.length; i++) length += parts[i]!.length
  const out = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i]!, offset)
    offset += parts[i]!.length
  }
  return out
}

function decodeFilter(filter: 'FlateDecode' | 'LZWDecode', data: Uint8Array, parms: string): Uint8Array {
  const header = encoder.encode('%PDF-2.0\n')
  const object = concat(
    encoder.encode(`1 0 obj\n<< /Length ${data.length} /Filter /${filter} /DecodeParms ${parms} >>\nstream\n`),
    data,
    encoder.encode('\nendstream\nendobj\n'),
  )
  const xrefOffset = header.length + object.length
  const xref = encoder.encode(
    `xref\n0 2\n0000000000 65535 f \n${String(header.length).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size 2 >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )
  const document = parsePdf(concat(header, object, xref))
  return document.decodeStream(document.getObject(1) as PdfStream)
}

function writeBits(out: Uint8Array, bitOffset: number, value: number, bitLength: number): void {
  for (let bit = bitLength - 1; bit >= 0; bit--) {
    if (((value >> bit) & 1) !== 0) out[bitOffset >> 3]! |= 1 << (7 - (bitOffset & 7))
    bitOffset++
  }
}

function packSampleRows(rows: number[][], colors: number, bits: number, columns: number): Uint8Array {
  const components = colors * columns
  const rowBytes = Math.ceil(components * bits / 8)
  const out = new Uint8Array(rows.length * rowBytes)
  for (let row = 0; row < rows.length; row++) {
    for (let component = 0; component < components; component++) {
      writeBits(out, row * rowBytes * 8 + component * bits, rows[row]![component]!, bits)
    }
  }
  return out
}

function encodeTiffRows(rows: number[][], colors: number, bits: number, columns: number): Uint8Array {
  const modulus = 2 ** bits
  const encoded: number[][] = []
  const components = colors * columns
  for (let row = 0; row < rows.length; row++) {
    const values = new Array<number>(components)
    for (let component = 0; component < components; component++) {
      const left = component >= colors ? rows[row]![component - colors]! : 0
      values[component] = (rows[row]![component]! - left + modulus) % modulus
    }
    encoded.push(values)
  }
  return packSampleRows(encoded, colors, bits, columns)
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
}

function encodePngRows(rows: Uint8Array[], tag: number, bytesPerPixel: number): Uint8Array {
  const rowBytes = rows[0]!.length
  const out = new Uint8Array(rows.length * (rowBytes + 1))
  const zero = new Uint8Array(rowBytes)
  for (let row = 0; row < rows.length; row++) {
    const current = rows[row]!
    const previous = row > 0 ? rows[row - 1]! : zero
    const offset = row * (rowBytes + 1)
    out[offset] = tag
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bytesPerPixel ? current[i - bytesPerPixel]! : 0
      const up = previous[i]!
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0
      const prediction = tag === 0 ? 0
        : tag === 1 ? left
          : tag === 2 ? up
            : tag === 3 ? (left + up) >> 1
              : paeth(left, up, upLeft)
      out[offset + 1 + i] = (current[i]! - prediction + 256) & 0xFF
    }
  }
  return out
}

function lzwLiteral(data: Uint8Array): Uint8Array {
  const codes = [256, ...data, 257]
  const out = new Uint8Array(Math.ceil(codes.length * 9 / 8))
  let position = 0
  for (let i = 0; i < codes.length; i++) {
    for (let bit = 8; bit >= 0; bit--) {
      if (((codes[i]! >> bit) & 1) !== 0) out[position >> 3]! |= 1 << (7 - (position & 7))
      position++
    }
  }
  return out
}

describe('PDF LZW/Flate predictor parameter matrix', () => {
  it('decodes TIFF Predictor 2 for every component depth, color count, and row packing boundary', () => {
    for (const bits of [1, 2, 4, 8, 16]) {
      const modulus = 2 ** bits
      for (const colors of [1, 2, 3, 5]) {
        for (const columns of [1, 3, 7]) {
          const components = colors * columns
          const rows = [0, 1].map(row => Array.from(
            { length: components },
            (_, component) => (row * 11 + component * 7 + 1) % modulus,
          ))
          const encoded = encodeTiffRows(rows, colors, bits, columns)
          const actual = decodeFilter('FlateDecode', zlibDeflate(encoded),
            `<< /Predictor 2 /Colors ${colors} /BitsPerComponent ${bits} /Columns ${columns} >>`)
          expect(actual).toEqual(packSampleRows(rows, colors, bits, columns))
        }
      }
    }
  })

  it('decodes every PNG row tag for every predictor code and parameter packing class', () => {
    let predictor = 10
    for (const bits of [1, 2, 4, 8, 16]) {
      for (const colors of [1, 2, 3, 5]) {
        for (const columns of [1, 3, 7]) {
          const rowBytes = Math.ceil(colors * bits * columns / 8)
          const bytesPerPixel = Math.max(1, Math.ceil(colors * bits / 8))
          const rows = [0, 1].map(row => Uint8Array.from(
            { length: rowBytes },
            (_, i) => (row * 71 + i * 29 + colors * 13 + bits) & 0xFF,
          ))
          for (let tag = 0; tag <= 4; tag++) {
            const encoded = encodePngRows(rows, tag, bytesPerPixel)
            const actual = decodeFilter('FlateDecode', zlibDeflate(encoded),
              `<< /Predictor ${predictor} /Colors ${colors} /BitsPerComponent ${bits} /Columns ${columns} >>`)
            expect(actual).toEqual(concat(...rows))
            predictor = predictor === 15 ? 10 : predictor + 1
          }
        }
      }
    }
  })

  it('uses the same predictor semantics after LZWDecode', () => {
    const predicted = new Uint8Array([10, 10, 10])
    expect(decodeFilter('LZWDecode', lzwLiteral(predicted),
      '<< /Predictor 2 /Colors 1 /BitsPerComponent 8 /Columns 3 >>'))
      .toEqual(new Uint8Array([10, 20, 30]))
  })

  it('passes Predictor 1 data through without consulting predictor-only parameters', () => {
    const raw = new Uint8Array([1, 2, 3])
    expect(decodeFilter('FlateDecode', zlibDeflate(raw),
      '<< /Predictor 1 /Colors /Unused /BitsPerComponent /Unused /Columns /Unused >>')).toEqual(raw)
  })

  it('rejects invalid parameter types, values, tags, and both TIFF/PNG partial rows', () => {
    const compressed = zlibDeflate(new Uint8Array([0]))
    const invalid = [
      '<< /Predictor /Two >>',
      '<< /Predictor 3 >>',
      '<< /Predictor 2 /Colors /One >>',
      '<< /Predictor 2 /Colors 0 >>',
      '<< /Predictor 2 /BitsPerComponent 3 >>',
      '<< /Predictor 2 /Columns 0 >>',
    ]
    for (let i = 0; i < invalid.length; i++) {
      expect(() => decodeFilter('FlateDecode', compressed, invalid[i]!)).toThrow(/predictor|Predictor/)
    }
    expect(() => decodeFilter('FlateDecode', zlibDeflate(new Uint8Array([0, 1])),
      '<< /Predictor 2 /Columns 3 >>')).toThrow(/TIFF predictor data contains a partial row/)
    expect(() => decodeFilter('FlateDecode', zlibDeflate(new Uint8Array([0, 1, 2])),
      '<< /Predictor 15 /Columns 3 >>')).toThrow(/PNG predictor data contains a partial row/)
    expect(() => decodeFilter('FlateDecode', zlibDeflate(new Uint8Array([5, 1, 2, 3])),
      '<< /Predictor 15 /Columns 3 >>')).toThrow(/invalid PNG predictor filter type 5/)
  })
})
