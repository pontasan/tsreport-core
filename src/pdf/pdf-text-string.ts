/**
 * PDFDocEncoding code points that differ from ISO-8859-1 (ISO 32000 Annex D).
 * Bytes outside this map coincide with Latin-1, apart from the undefined bytes
 * rejected by decodePdfTextStringBytes.
 */
const PDF_DOC_ENCODING: Record<number, number> = {
  0x18: 0x02D8, 0x19: 0x02C7, 0x1A: 0x02C6, 0x1B: 0x02D9,
  0x1C: 0x02DD, 0x1D: 0x02DB, 0x1E: 0x02DA, 0x1F: 0x02DC,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026,
  0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
  0x88: 0x2039, 0x89: 0x203A, 0x8A: 0x2212, 0x8B: 0x2030,
  0x8C: 0x201E, 0x8D: 0x201C, 0x8E: 0x201D, 0x8F: 0x2018,
  0x90: 0x2019, 0x91: 0x201A, 0x92: 0x2122, 0x93: 0xFB01,
  0x94: 0xFB02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
  0x98: 0x0178, 0x99: 0x017D, 0x9A: 0x0131, 0x9B: 0x0142,
  0x9C: 0x0153, 0x9D: 0x0161, 0x9E: 0x017E, 0xA0: 0x20AC,
}

/** Decode an ISO 32000 text string from UTF-16BE, PDF 2.0 UTF-8, or PDFDocEncoding. */
export function decodePdfTextStringBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    if ((bytes.length & 1) !== 0) throw new Error('PDF text string error: UTF-16BE text string has an odd byte length')
    let out = ''
    for (let i = 2; i < bytes.length; i += 2) {
      const code = (bytes[i]! << 8) | bytes[i + 1]!
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 3 >= bytes.length) throw new Error('PDF text string error: UTF-16BE text string ends with an unpaired high surrogate')
        const low = (bytes[i + 2]! << 8) | bytes[i + 3]!
        if (low < 0xDC00 || low > 0xDFFF) throw new Error('PDF text string error: UTF-16BE text string contains an unpaired high surrogate')
        out += String.fromCharCode(code, low)
        i += 2
      } else {
        if (code >= 0xDC00 && code <= 0xDFFF) throw new Error('PDF text string error: UTF-16BE text string contains an unpaired low surrogate')
        out += String.fromCharCode(code)
      }
    }
    return out
  }
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b <= 0x08 || b === 0x0B || b === 0x0C || (b >= 0x0E && b <= 0x17)
      || b === 0x7F || b === 0x9F || b === 0xAD) {
      throw new Error(`PDF text string error: undefined PDFDocEncoding byte 0x${b.toString(16).padStart(2, '0')}`)
    }
    const mapped = PDF_DOC_ENCODING[b]
    out += String.fromCharCode(mapped !== undefined ? mapped : b)
  }
  return out
}

/** Encode a text string as UTF-16BE with BOM, valid in PDF 1.2 and later. */
export function encodePdfTextStringBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xFE
  bytes[1] = 0xFF
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = code >>> 8
    bytes[3 + i * 2] = code & 0xFF
  }
  return bytes
}
