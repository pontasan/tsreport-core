export function hybridSigningPdf(): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  let offset = 0
  const push = function (value: Uint8Array): number {
    const result = offset
    parts.push(value)
    offset += value.length
    return result
  }
  push(encoder.encode('%PDF-1.7\n%\x80\x81\x82\x83\n'))
  const offsets = new Map<number, number>()
  offsets.set(1, push(encoder.encode('1 0 obj\n<< /Type /Catalog /Pages 2 0 R /CompressedMetadata 5 0 R >>\nendobj\n')))
  offsets.set(2, push(encoder.encode('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')))
  offsets.set(3, push(encoder.encode('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>\nendobj\n')))
  offsets.set(4, push(encoder.encode('4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n')))
  const objectStreamData = encoder.encode('5 0 << /Preserved true >>')
  offsets.set(6, push(encoder.encode(`6 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length ${objectStreamData.length} >>\nstream\n`)))
  push(objectStreamData)
  push(encoder.encode('\nendstream\nendobj\n'))
  const xrefStreamData = new Uint8Array([2, 6, 0])
  offsets.set(7, push(encoder.encode('7 0 obj\n<< /Type /XRef /Size 8 /Index [5 1] /W [1 1 1] /Length 3 >>\nstream\n')))
  push(xrefStreamData)
  push(encoder.encode('\nendstream\nendobj\n'))
  const xref = offset
  let table = 'xref\n0 8\n0000000000 65535 f \n'
  for (let number = 1; number < 8; number++) {
    const objectOffset = offsets.get(number)
    table += objectOffset === undefined
      ? '0000000000 00000 f \n'
      : `${String(objectOffset).padStart(10, '0')} 00000 n \n`
  }
  table += `trailer\n<< /Size 8 /Root 1 0 R /XRefStm ${offsets.get(7)} >>\nstartxref\n${xref}\n%%EOF\n`
  push(encoder.encode(table))
  const output = new Uint8Array(offset)
  let position = 0
  for (let i = 0; i < parts.length; i++) {
    output.set(parts[i]!, position)
    position += parts[i]!.length
  }
  return output
}
