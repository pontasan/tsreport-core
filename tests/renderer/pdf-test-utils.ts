/**
 * PDF test utilities.
 * Inflates FlateDecode-compressed streams and returns a text representation.
 * Objects inside ObjStm streams are also expanded into individual "N 0 obj ... endobj" blocks.
 */
import { zlibInflate } from '../../src/compression/inflate.js'

/**
 * Expands every stream in a PDF binary and returns a text representation.
 * FlateDecode-compressed streams are inflated automatically.
 * ObjStm streams are decomposed into their individual objects after inflation.
 * The ObjStm wrapper object itself is excluded from the output.
 */
export function pdfToText(bytes: Uint8Array): string {
  const raw = new TextDecoder('latin1').decode(bytes)
  const result: string[] = []
  let pos = 0
  while (pos < raw.length) {
    // Look for the ">>\nstream\n" pattern (excludes false "stream" matches inside binary data)
    const streamMarker = raw.indexOf('>>\nstream\n', pos)
    if (streamMarker < 0) {
      result.push(raw.substring(pos))
      break
    }
    const dictEnd = streamMarker + 2 // just past ">>"
    // Scan the dictionary that precedes ">>"
    const dictStart = raw.lastIndexOf('<<', streamMarker)
    const dictStr = dictStart >= pos ? raw.substring(dictStart, dictEnd) : ''
    const isFlate = dictStr.indexOf('/Filter /FlateDecode') >= 0
    const isObjStm = dictStr.indexOf('/Type /ObjStm') >= 0
    const lenMatch = dictStr.match(/\/Length (\d+)/)
    const streamLen = lenMatch ? parseInt(lenMatch[1]!, 10) : 0

    const dataStart = streamMarker + '>>\nstream\n'.length
    const dataEnd = dataStart + streamLen

    if (isObjStm) {
      // ObjStm: drop the wrapper object and emit only the contained objects

      // Locate the start of the ObjStm's "N 0 obj\n" line.
      // dictStart points at "<<"; the newline just before it follows "obj",
      // and the newline before that immediately precedes the "N 0 obj" line.
      const afterObjNl = raw.lastIndexOf('\n', dictStart - 1)
      let beforeObjNl = raw.lastIndexOf('\n', afterObjNl - 1)
      if (beforeObjNl < pos) beforeObjNl = pos - 1
      // Push raw text up to (but not including) the ObjStm "N 0 obj" line
      result.push(raw.substring(pos, beforeObjNl + 1))

      // Inflate the stream data
      let content: string
      if (isFlate && streamLen > 0) {
        try {
          const inflated = zlibInflate(bytes.subarray(dataStart, dataEnd))
          content = new TextDecoder('latin1').decode(inflated)
        } catch {
          content = raw.substring(dataStart, dataEnd)
        }
      } else {
        content = raw.substring(dataStart, dataEnd)
      }

      // Parse the ObjStm header "id1 off1 id2 off2 ..." and split the body into individual objects
      const nMatch = dictStr.match(/\/N (\d+)/)
      const firstMatch = dictStr.match(/\/First (\d+)/)
      if (nMatch && firstMatch) {
        const n = parseInt(nMatch[1]!, 10)
        const first = parseInt(firstMatch[1]!, 10)
        const header = content.substring(0, first)
        const body = content.substring(first)
        const tokens = header.trim().split(/\s+/)
        for (let i = 0; i < n; i++) {
          const objId = tokens[i * 2]
          const objOff = parseInt(tokens[i * 2 + 1] ?? '0', 10)
          const nextOff = i + 1 < n ? parseInt(tokens[(i + 1) * 2 + 1] ?? '0', 10) : body.length
          const objContent = body.substring(objOff, nextOff).trim()
          result.push(`${objId} 0 obj\n${objContent}\nendobj\n\n`)
        }
      }

      // Skip past the ObjStm's endstream + endobj
      const endStream = raw.indexOf('\nendstream\n', dataEnd)
      if (endStream >= 0) {
        const afterEndStream = endStream + '\nendstream\n'.length
        const endObj = raw.indexOf('endobj', afterEndStream)
        if (endObj >= 0) {
          pos = endObj + 'endobj'.length
          // Skip trailing newlines
          while (pos < raw.length && raw[pos] === '\n') pos++
        } else {
          pos = afterEndStream
        }
      } else {
        pos = dataEnd
      }
    } else {
      // Regular stream: standard handling
      result.push(raw.substring(pos, dataStart))
      if (isFlate && streamLen > 0) {
        try {
          const inflated = zlibInflate(bytes.subarray(dataStart, dataEnd))
          result.push(new TextDecoder('latin1').decode(inflated))
        } catch {
          result.push(raw.substring(dataStart, dataEnd))
        }
      } else {
        result.push(raw.substring(dataStart, dataEnd))
      }
      // Include \nendstream\n in output and advance past it
      const endStream = raw.indexOf('\nendstream\n', dataEnd)
      if (endStream >= 0) {
        result.push(raw.substring(dataEnd, endStream + '\nendstream\n'.length))
        pos = endStream + '\nendstream\n'.length
      } else {
        pos = dataEnd
      }
    }
  }
  return result.join('')
}
