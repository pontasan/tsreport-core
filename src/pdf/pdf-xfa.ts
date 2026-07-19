import { parseXmlDocument } from '../xml/xml-parser.js'

/** Complete XDP document stored in a single AcroForm /XFA stream. */
export interface PdfXfaDocument {
  kind: 'document'
  data: Uint8Array
}

/** One named packet in an AcroForm /XFA packet array. */
export interface PdfXfaPacket {
  name: string
  data: Uint8Array
}

/** Packetized XDP document stored as alternating packet names and streams. */
export interface PdfXfaPacketArray {
  kind: 'packets'
  packets: PdfXfaPacket[]
}

export type PdfXfa = PdfXfaDocument | PdfXfaPacketArray

/** Decodes the XML encodings admitted at the PDF/XFA boundary. */
export function decodePdfXfaXml(data: Uint8Array): string {
  if (data.length === 0) throw new Error('PDF XFA error: XML data must not be empty')
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return decodeUtf16(data.subarray(2), false)
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return decodeUtf16(data.subarray(2), true)
  }
  if (data.length >= 4 && data[0] === 0x00 && data[1] === 0x3c && data[2] === 0x00 && data[3] === 0x3f) {
    return decodeUtf16(data, false)
  }
  if (data.length >= 4 && data[0] === 0x3c && data[1] === 0x00 && data[2] === 0x3f && data[3] === 0x00) {
    return decodeUtf16(data, true)
  }
  const offset = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(offset))
  } catch {
    throw new Error('PDF XFA error: XML data is not valid UTF-8 or UTF-16')
  }
}

/** Validates the XDP document assembled from the PDF /XFA representation. */
export function validatePdfXfa(xfa: PdfXfa): void {
  if (xfa.kind === 'document') {
    validateXdpXml(decodePdfXfaXml(xfa.data))
    return
  }
  if (xfa.packets.length === 0) throw new Error('PDF XFA error: packet array must not be empty')
  const names = new Set<string>()
  let xml = ''
  for (let i = 0; i < xfa.packets.length; i++) {
    const packet = xfa.packets[i]!
    if (packet.name.length === 0 || packet.name.includes('\u0000')) {
      throw new Error(`PDF XFA error: packet ${i + 1} has an invalid name`)
    }
    if (names.has(packet.name)) throw new Error(`PDF XFA error: duplicate packet name ${packet.name}`)
    names.add(packet.name)
    xml += decodePdfXfaXml(packet.data)
  }
  validateXdpXml(xml)
}

function validateXdpXml(xml: string): void {
  const root = parseXmlDocument(xml)
  const localName = root.name.includes(':') ? root.name.slice(root.name.indexOf(':') + 1) : root.name
  if (localName !== 'xdp') throw new Error('PDF XFA error: assembled XML root must be xdp')
  const namespace = root.attributes['xmlns:xdp'] ?? (root.name === 'xdp' ? root.attributes.xmlns : undefined)
  if (namespace !== 'http://ns.adobe.com/xdp/') {
    throw new Error('PDF XFA error: xdp root must use the http://ns.adobe.com/xdp/ namespace')
  }
}

function decodeUtf16(data: Uint8Array, littleEndian: boolean): string {
  if ((data.length & 1) !== 0) throw new Error('PDF XFA error: UTF-16 XML has an odd byte length')
  let result = ''
  for (let i = 0; i < data.length; i += 2) {
    const unit = littleEndian ? data[i]! | data[i + 1]! << 8 : data[i]! << 8 | data[i + 1]!
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (i + 3 >= data.length) throw new Error('PDF XFA error: UTF-16 XML has an unpaired high surrogate')
      const low = littleEndian ? data[i + 2]! | data[i + 3]! << 8 : data[i + 2]! << 8 | data[i + 3]!
      if (low < 0xdc00 || low > 0xdfff) throw new Error('PDF XFA error: UTF-16 XML has an unpaired high surrogate')
      result += String.fromCodePoint(0x10000 + (unit - 0xd800) * 0x400 + low - 0xdc00)
      i += 2
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('PDF XFA error: UTF-16 XML has an unpaired low surrogate')
    } else {
      result += String.fromCharCode(unit)
    }
  }
  return result.charCodeAt(0) === 0xfeff ? result.slice(1) : result
}
