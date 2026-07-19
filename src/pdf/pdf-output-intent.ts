import type { PdfRawValueDef } from '../types/template.js'

export interface PdfXRegisteredOutputCondition {
  registryName: string
  outputConditionIdentifier: string
}

/** Supplies the CMYK ICC profile for one exact registered PDF/X condition. */
export type PdfXOutputProfileResolver = (condition: PdfXRegisteredOutputCondition) => Uint8Array

/** Confirms that the identifier is an exact entry in the named registry. */
export type PdfXOutputConditionValidator = (condition: PdfXRegisteredOutputCondition) => boolean

/** Validates the typed entries defined for a PDF 2.0 DestOutputProfileRef dictionary. */
export function validatePdfDestinationProfileReference(entries: Record<string, PdfRawValueDef>, intentIndex: number): void {
  const label = `PDF OutputIntent ${intentIndex + 1} DestOutputProfileRef`
  const checksum = entries.CheckSum
  if (checksum !== undefined && (!isRawString(checksum) || checksum.bytes.length !== 16)) {
    throw new Error(`${label} CheckSum must be a 16-byte MD5 digest`)
  }
  const colorants = entries.ColorantTable
  if (colorants !== undefined && (!isRawArray(colorants) || !colorants.items.every(function (value) {
    return typeof value === 'object' && value !== null && value.kind === 'name'
  }))) {
    throw new Error(`${label} ColorantTable must be an array of names`)
  }
  const fixedByteStrings: [string, PdfRawValueDef | undefined][] = [
    ['ICCVersion', entries.ICCVersion], ['ProfileCS', entries.ProfileCS],
  ]
  for (let i = 0; i < fixedByteStrings.length; i++) {
    const [key, value] = fixedByteStrings[i]!
    if (value !== undefined && (!isRawString(value) || value.bytes.length !== 4)) {
      throw new Error(`${label} ${key} must be a four-byte string`)
    }
  }
  if (entries.ProfileName !== undefined && !isRawString(entries.ProfileName)) {
    throw new Error(`${label} ProfileName must be a text string`)
  }
  const urls = entries.URLs
  if (urls !== undefined && (!isRawArray(urls) || urls.items.length === 0 || !urls.items.every(function (value) {
    return typeof value === 'object' && value !== null && (value.kind === 'string' || value.kind === 'dictionary')
  }))) {
    throw new Error(`${label} URLs must be a non-empty array of file specifications`)
  }
}

function isRawString(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'string' }> {
  return typeof value === 'object' && value !== null && value.kind === 'string'
}

function isRawArray(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'array' }> {
  return typeof value === 'object' && value !== null && value.kind === 'array'
}
