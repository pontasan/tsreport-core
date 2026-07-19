import { describe, expect, it } from 'vitest'
import { parsePdf, PdfStream } from '../../src/pdf/pdf-parser.js'
import { zlibDeflate } from '../../src/compression/deflate.js'

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

function filteredStream(filter: string, data: Uint8Array, decodeParms = ''): Uint8Array {
  const header = encoder.encode('%PDF-2.0\n')
  const filterValue = filter.startsWith('[') ? filter : `/${filter}`
  const object = concat(
    encoder.encode(`1 0 obj\n<< /Length ${data.length} /Filter ${filterValue}${decodeParms} >>\nstream\n`),
    data,
    encoder.encode('\nendstream\nendobj\n'),
  )
  const xrefOffset = header.length + object.length
  const xref = encoder.encode(
    `xref\n0 2\n0000000000 65535 f \n${String(header.length).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size 2 >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )
  return concat(header, object, xref)
}

function ascii85Encode(data: Uint8Array): Uint8Array {
  let text = ''
  for (let offset = 0; offset < data.length; offset += 4) {
    const count = Math.min(4, data.length - offset)
    let value = 0
    for (let byte = 0; byte < 4; byte++) value = value * 256 + (byte < count ? data[offset + byte]! : 0)
    if (count === 4 && value === 0) {
      text += 'z'
      continue
    }
    const group = new Array<string>(5)
    for (let digit = 4; digit >= 0; digit--) {
      group[digit] = String.fromCharCode(value % 85 + 33)
      value = Math.floor(value / 85)
    }
    text += group.slice(0, count + 1).join('')
  }
  return encoder.encode(text + '~>')
}

function runLengthEncode(data: Uint8Array): Uint8Array {
  const output: number[] = []
  let offset = 0
  while (offset < data.length) {
    const count = Math.min(128, data.length - offset)
    output.push(count - 1)
    for (let byte = 0; byte < count; byte++) output.push(data[offset + byte]!)
    offset += count
  }
  output.push(128)
  return new Uint8Array(output)
}

function asciiHexEncode(data: Uint8Array): Uint8Array {
  return encoder.encode(Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('') + '>')
}

function decode(filter: string, data: Uint8Array, decodeParms = ''): Uint8Array {
  const document = parsePdf(filteredStream(filter, data, decodeParms))
  return document.decodeStream(document.getObject(1) as PdfStream)
}

function packNineBitCodes(codes: number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(codes.length * 9 / 8))
  let position = 0
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    for (let bit = 8; bit >= 0; bit--) {
      if (((code >> bit) & 1) !== 0) out[position >> 3]! |= 1 << (7 - (position & 7))
      position++
    }
  }
  return out
}

function packBits(source: string): Uint8Array {
  const bits = source.replace(/\s/g, '')
  const out = new Uint8Array(Math.ceil(bits.length / 8))
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') out[i >> 3]! |= 1 << (7 - (i & 7))
  }
  return out
}

const EOL = '000000000001'
const WHITE_8 = '10011'
const BLACK_8 = '00110101 000101'

describe('PDF standard stream filters', () => {
  it('decodes ASCIIHex whitespace and an odd final digit terminated by EOD', () => {
    expect(Array.from(decode('ASCIIHexDecode', encoder.encode('4 1\n4>ignored')))).toEqual([0x41, 0x40])
  })

  it('rejects ASCIIHex data without its EOD marker', () => {
    expect(() => decode('ASCIIHexDecode', encoder.encode('4142'))).toThrow(/EOD marker is missing/)
  })

  it('rejects every impossible ASCII85 terminal form', () => {
    expect(() => decode('ASCII85Decode', encoder.encode('!~>'))).toThrow(/one character/)
    expect(() => decode('ASCII85Decode', encoder.encode('uuuuu~>'))).toThrow(/exceeds 32 bits/)
    expect(() => decode('ASCII85Decode', encoder.encode('!!!!!'))).toThrow(/EOD marker is missing/)
    expect(() => decode('ASCII85Decode', encoder.encode('!z~>'))).toThrow(/invalid z/)
  })

  it('decodes ASCII85 zero shorthand and a partial terminal group', () => {
    expect(Array.from(decode('ASCII85Decode', encoder.encode('z!!~>')))).toEqual([0, 0, 0, 0, 0])
  })

  it('requires RunLengthDecode EOD after complete runs', () => {
    expect(Array.from(decode('RunLengthDecode', new Uint8Array([2, 1, 2, 3, 253, 9, 128])))).toEqual([1, 2, 3, 9, 9, 9, 9])
    expect(() => decode('RunLengthDecode', new Uint8Array([0, 1]))).toThrow(/EOD marker is missing/)
  })

  it('requires the LZW EOD code and validates EarlyChange', () => {
    expect(Array.from(decode('LZWDecode', packNineBitCodes([256, 65, 257]), ' /DecodeParms << /EarlyChange 0 >>'))).toEqual([65])
    expect(() => decode('LZWDecode', packNineBitCodes([256, 65]))).toThrow(/EOD code is missing/)
    expect(() => decode('LZWDecode', packNineBitCodes([257]), ' /DecodeParms << /EarlyChange 2 >>')).toThrow(/must be 0 or 1/)
    expect(() => decode('LZWDecode', concat(packNineBitCodes([257]), new Uint8Array([0])))).toThrow(/padding after EOD/)
  })

  it('applies every PNG predictor tag after FlateDecode', () => {
    const cases: Array<[number, number[], number[]]> = [
      [0, [10, 20, 30], [10, 20, 30]],
      [1, [10, 10, 10], [10, 20, 30]],
      [2, [10, 20, 30, 5, 5, 5], [10, 20, 30, 15, 25, 35]],
      [3, [10, 15, 20], [10, 20, 30]],
      [4, [10, 10, 10], [10, 20, 30]],
    ]
    for (let i = 0; i < cases.length; i++) {
      const [tag, residuals, expected] = cases[i]!
      const encoded = tag === 2
        ? new Uint8Array([0, ...residuals.slice(0, 3), tag, ...residuals.slice(3)])
        : new Uint8Array([tag, ...residuals])
      expect(Array.from(decode('FlateDecode', zlibDeflate(encoded),
        ' /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns 3 >>'))).toEqual(expected)
    }
  })

  it('applies TIFF Predictor 2 and rejects invalid predictor parameters and partial rows', () => {
    expect(Array.from(decode('FlateDecode', zlibDeflate(new Uint8Array([10, 10, 10])),
      ' /DecodeParms << /Predictor 2 /Colors 1 /BitsPerComponent 8 /Columns 3 >>'))).toEqual([10, 20, 30])
    expect(() => decode('FlateDecode', zlibDeflate(new Uint8Array([1])),
      ' /DecodeParms << /Predictor 3 >>')).toThrow(/unsupported predictor/)
    expect(() => decode('FlateDecode', zlibDeflate(new Uint8Array([1])),
      ' /DecodeParms << /Predictor /Two >>')).toThrow(/Predictor must be an integer/)
    expect(() => decode('FlateDecode', zlibDeflate(new Uint8Array([1, 2])),
      ' /DecodeParms << /Predictor 2 /Columns 3 >>')).toThrow(/partial row/)
  })

  it('validates Crypt decode-parameter Type and defaults Name to Identity', () => {
    expect(Array.from(decode('Crypt', new Uint8Array([1, 2]), ' /DecodeParms << /Type /CryptFilterDecodeParms >>'))).toEqual([1, 2])
    expect(() => decode('Crypt', new Uint8Array([1]), ' /DecodeParms << /Type /Wrong >>')).toThrow(/Crypt filter \/Type/)
  })

  it('decodes a legal arbitrary-order filter chain with index-aligned DecodeParms', () => {
    const expected = encoder.encode('filter-chain-with-distinct-parameters')
    const encoded = ascii85Encode(runLengthEncode(zlibDeflate(expected)))
    expect(decode(
      '[/ASCII85Decode /RunLengthDecode /FlateDecode]',
      encoded,
      ' /DecodeParms [null null << /Predictor 1 >>]',
    )).toEqual(expected)
  })

  it('requires a single Crypt filter in first position and then applies later filters in order', () => {
    const expected = encoder.encode('identity-crypt-before-outer-filters')
    const encoded = asciiHexEncode(zlibDeflate(expected))
    expect(decode(
      '[/Crypt /ASCIIHexDecode /FlateDecode]',
      encoded,
      ' /DecodeParms [<< /Type /CryptFilterDecodeParms /Name /Identity >> null null]',
    )).toEqual(expected)
    expect(() => decode(
      '[/ASCIIHexDecode /Crypt]',
      asciiHexEncode(expected),
      ' /DecodeParms [null << /Name /Identity >>]',
    )).toThrow(/Crypt must be the first/)
    expect(() => decode(
      '[/Crypt /Crypt]',
      expected,
      ' /DecodeParms [<< /Name /Identity >> << /Name /Identity >>]',
    )).toThrow(/only once/)
  })

  it('forbids Crypt on a cross-reference stream', () => {
    const document = parsePdf(filteredStream(
      'Crypt',
      new Uint8Array([1]),
      ' /Type /XRef /DecodeParms << /Name /Identity >>',
    ))
    expect(() => document.decodeStream(document.getObject(1) as PdfStream)).toThrow(/cross-reference stream.*Crypt/)
  })

  it('applies CCITT Columns, Rows, EndOfBlock, and BlackIs1', () => {
    const twoRows = packBits(`${WHITE_8} ${WHITE_8}`)
    expect(Array.from(decode('CCITTFaxDecode', twoRows,
      ' /DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false >>'))).toEqual([0xFF])
    expect(Array.from(decode('CCITTFaxDecode', twoRows,
      ' /DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false /BlackIs1 true >>'))).toEqual([0x00])

    const rtc = packBits(`${WHITE_8} ${WHITE_8} ${EOL.repeat(6)}`)
    expect(Array.from(decode('CCITTFaxDecode', rtc,
      ' /DecodeParms << /Columns 8 /Rows 1 /EndOfBlock true >>'))).toEqual([0xFF, 0xFF])
  })

  it('accepts optional EOL, requires it when requested, and honors EncodedByteAlign', () => {
    const withEol = packBits(`${EOL} ${WHITE_8}`)
    expect(Array.from(decode('CCITTFaxDecode', withEol,
      ' /DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false >>'))).toEqual([0xFF])
    expect(Array.from(decode('CCITTFaxDecode', withEol,
      ' /DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false /EndOfLine true >>'))).toEqual([0xFF])
    expect(() => decode('CCITTFaxDecode', packBits(WHITE_8),
      ' /DecodeParms << /Columns 8 /Rows 1 /EndOfBlock false /EndOfLine true >>')).toThrow(/required.*EOL/)

    expect(Array.from(decode('CCITTFaxDecode', packBits(`${WHITE_8} 000 ${WHITE_8}`),
      ' /DecodeParms << /Columns 8 /Rows 2 /EndOfBlock false /EncodedByteAlign true >>'))).toEqual([0xFF, 0xFF])
  })

  it('uses Group 3 two-dimensional line tags for every positive K value', () => {
    const mixed = packBits(`1 ${WHITE_8} 0 1`)
    expect(Array.from(decode('CCITTFaxDecode', mixed,
      ' /DecodeParms << /K 7 /Columns 8 /Rows 2 /EndOfBlock false >>'))).toEqual([0xFF, 0xFF])

    const rtc = packBits(`1 ${WHITE_8} ${`${EOL} 1 `.repeat(6)}`)
    expect(Array.from(decode('CCITTFaxDecode', rtc,
      ' /DecodeParms << /K 3 /Columns 8 /Rows 0 /EndOfBlock true >>'))).toEqual([0xFF])
  })

  it('recognizes the Group 4 EOFB pattern independently of Rows', () => {
    expect(Array.from(decode('CCITTFaxDecode', packBits(`1 ${EOL} ${EOL}`),
      ' /DecodeParms << /K -1 /Columns 8 /Rows 99 /EndOfBlock true >>'))).toEqual([0xFF])
  })

  it('recovers the allowed number of damaged EOL-delimited rows exactly as specified', () => {
    const damaged = packBits(
      `${EOL} ${BLACK_8} ${EOL} 0000000000000 ${EOL} 0000000000000 ${EOL} ${WHITE_8}`,
    )
    expect(Array.from(decode('CCITTFaxDecode', damaged,
      ' /DecodeParms << /Columns 8 /Rows 4 /EndOfBlock false /EndOfLine true /DamagedRowsBeforeError 2 >>')))
      .toEqual([0x00, 0x00, 0xFF, 0xFF])
    expect(() => decode('CCITTFaxDecode', damaged,
      ' /DecodeParms << /Columns 8 /Rows 4 /EndOfBlock false /EndOfLine true /DamagedRowsBeforeError 1 >>'))
      .toThrow(/CCITTFaxDecode/)
  })

  it('validates every CCITT parameter type and range', () => {
    const data = packBits(WHITE_8)
    expect(() => decode('CCITTFaxDecode', data, ' /DecodeParms << /Columns 0 >>')).toThrow(/Columns must be positive/)
    expect(() => decode('CCITTFaxDecode', data, ' /DecodeParms << /Rows -1 >>')).toThrow(/Rows must be non-negative/)
    expect(() => decode('CCITTFaxDecode', data, ' /DecodeParms << /K 1.5 >>')).toThrow(/K must be an integer/)
    expect(() => decode('CCITTFaxDecode', data, ' /DecodeParms << /EndOfLine 1 >>')).toThrow(/EndOfLine must be a boolean/)
    expect(() => decode('CCITTFaxDecode', data, ' /DecodeParms << /DamagedRowsBeforeError -1 >>')).toThrow(/must be non-negative/)
  })
})
