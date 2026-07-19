import type { PdfOpiMetadataDef, PdfRawValueDef } from '../types/template.js'

/** Validates an OPI 1.3 or 2.0 dictionary before generation or after import. */
export function validatePdfOpiMetadata(metadata: PdfOpiMetadataDef, ownerLabel: string): void {
  const entries = metadata.entries
  const type = entries.Type
  if (type !== undefined && (!isRawName(type) || type.value !== 'OPI')) {
    throw new Error(`PDF ${ownerLabel} OPI Type must be /OPI`)
  }
  const expectedVersion = metadata.version === '1.3' ? 1.3 : 2
  if (entries.Version !== expectedVersion) {
    throw new Error(`PDF ${ownerLabel} OPI ${metadata.version} dictionary has an invalid Version`)
  }
  const file = entries.F
  if (file === undefined || (!isRawString(file) && !isRawDictionary(file))) {
    throw new Error(`PDF ${ownerLabel} OPI ${metadata.version} dictionary requires a file specification F`)
  }
  if (metadata.version === '1.3') validateOpi13(entries, ownerLabel)
  else validateOpi20(entries, ownerLabel)
}

function validateOpi13(entries: Record<string, PdfRawValueDef>, ownerLabel: string): void {
  const size = requireNumberArray(entries.Size, 2, true, ownerLabel, 'Size')
  requireNumberArray(entries.CropRect, 4, true, ownerLabel, 'CropRect')
  const position = requireNumberArray(entries.Position, 8, false, ownerLabel, 'Position')
  if (Math.abs((position[2]! - position[0]!) - (position[4]! - position[6]!)) > 1e-7
    || Math.abs((position[3]! - position[1]!) - (position[5]! - position[7]!)) > 1e-7) {
    throw new Error(`PDF ${ownerLabel} OPI 1.3 Position must define a parallelogram`)
  }
  if (size[0]! <= 0 || size[1]! <= 0) throw new Error(`PDF ${ownerLabel} OPI 1.3 Size values must be positive`)
  optionalNumberArray(entries.CropFixed, 4, false, ownerLabel, 'CropFixed')
  optionalNumberArray(entries.Resolution, 2, false, ownerLabel, 'Resolution')
  optionalBoolean(entries.Overprint, ownerLabel, 'Overprint')
  optionalBoolean(entries.Transparency, ownerLabel, 'Transparency')
  const tint = optionalNumber(entries.Tint, ownerLabel, 'Tint')
  if (tint !== undefined && (tint < 0 || tint > 1)) throw new Error(`PDF ${ownerLabel} OPI 1.3 Tint must be in 0..1`)
  const colorType = entries.ColorType
  if (colorType !== undefined && (!isRawName(colorType) || !['Process', 'Spot', 'Separation'].includes(colorType.value))) {
    throw new Error(`PDF ${ownerLabel} OPI 1.3 ColorType is invalid`)
  }
  const color = entries.Color
  if (color !== undefined) {
    if (!isRawArray(color) || color.items.length !== 5 || !isRawString(color.items[4]!)) {
      throw new Error(`PDF ${ownerLabel} OPI 1.3 Color must contain CMYK and a byte string`)
    }
    for (let i = 0; i < 4; i++) {
      const component = color.items[i]
      if (typeof component !== 'number' || component < 0 || component > 1) {
        throw new Error(`PDF ${ownerLabel} OPI 1.3 Color components must be in 0..1`)
      }
    }
  }
  const imageType = optionalNumberArray(entries.ImageType, 2, true, ownerLabel, 'ImageType')
  if (imageType !== undefined && (imageType[0]! <= 0 || imageType[1]! <= 0)) {
    throw new Error(`PDF ${ownerLabel} OPI 1.3 ImageType values must be positive`)
  }
  validateTags(entries.Tags, false, ownerLabel)
}

function validateOpi20(entries: Record<string, PdfRawValueDef>, ownerLabel: string): void {
  const size = optionalNumberArray(entries.Size, 2, false, ownerLabel, 'Size')
  const crop = optionalNumberArray(entries.CropRect, 4, false, ownerLabel, 'CropRect')
  if ((size === undefined) !== (crop === undefined)) {
    throw new Error(`PDF ${ownerLabel} OPI 2.0 Size and CropRect must both be present or both absent`)
  }
  if (size !== undefined && crop !== undefined && !(0 <= crop[0]! && crop[0]! < crop[2]! && crop[2]! <= size[0]!
    && 0 <= crop[1]! && crop[1]! < crop[3]! && crop[3]! <= size[1]!)) {
    throw new Error(`PDF ${ownerLabel} OPI 2.0 CropRect must lie within Size`)
  }
  optionalBoolean(entries.Overprint, ownerLabel, 'Overprint')
  if (entries.MainImage !== undefined && !isRawString(entries.MainImage)) {
    throw new Error(`PDF ${ownerLabel} OPI 2.0 MainImage must be a byte string`)
  }
  const dimensions = optionalNumberArray(entries.IncludedImageDimensions, 2, true, ownerLabel, 'IncludedImageDimensions')
  if (dimensions !== undefined && (dimensions[0]! <= 0 || dimensions[1]! <= 0)) {
    throw new Error(`PDF ${ownerLabel} OPI 2.0 IncludedImageDimensions must be positive`)
  }
  const quality = optionalNumber(entries.IncludedImageQuality, ownerLabel, 'IncludedImageQuality')
  if (quality !== undefined && quality !== 1 && quality !== 2 && quality !== 3) {
    throw new Error(`PDF ${ownerLabel} OPI 2.0 IncludedImageQuality must be 1, 2, or 3`)
  }
  validateOpi20Inks(entries.Inks, ownerLabel)
  validateTags(entries.Tags, true, ownerLabel)
}

function validateOpi20Inks(value: PdfRawValueDef | undefined, ownerLabel: string): void {
  if (value === undefined) return
  if (isRawName(value)) {
    if (value.value !== 'full_color' && value.value !== 'registration') {
      throw new Error(`PDF ${ownerLabel} OPI 2.0 Inks name is invalid`)
    }
    return
  }
  if (!isRawArray(value) || value.items.length < 3 || value.items.length % 2 === 0
    || !isRawName(value.items[0]!) || value.items[0]!.value !== 'monochrome') {
    throw new Error(`PDF ${ownerLabel} OPI 2.0 Inks array is invalid`)
  }
  for (let i = 1; i < value.items.length; i += 2) {
    const name = value.items[i]!
    const tint = value.items[i + 1]!
    if (!isRawString(name) || typeof tint !== 'number' || tint < 0 || tint > 1) {
      throw new Error(`PDF ${ownerLabel} OPI 2.0 monochrome inks require byte-string names and tints in 0..1`)
    }
  }
}

function validateTags(value: PdfRawValueDef | undefined, allowStringArray: boolean, ownerLabel: string): void {
  if (value === undefined) return
  if (!isRawArray(value) || value.items.length % 2 !== 0) {
    throw new Error(`PDF ${ownerLabel} OPI Tags must contain number/value pairs`)
  }
  for (let i = 0; i < value.items.length; i += 2) {
    if (!Number.isInteger(value.items[i])) throw new Error(`PDF ${ownerLabel} OPI tag number must be an integer`)
    const tagValue = value.items[i + 1]!
    const validArray = allowStringArray && isRawArray(tagValue) && tagValue.items.every(isRawString)
    if (!isRawString(tagValue) && !validArray) {
      throw new Error(`PDF ${ownerLabel} OPI tag value must be a byte string or permitted byte-string array`)
    }
  }
}

function requireNumberArray(
  value: PdfRawValueDef | undefined,
  length: number,
  integer: boolean,
  ownerLabel: string,
  key: string,
): number[] {
  const result = optionalNumberArray(value, length, integer, ownerLabel, key)
  if (result === undefined) throw new Error(`PDF ${ownerLabel} OPI dictionary requires ${key}`)
  return result
}

function optionalNumberArray(
  value: PdfRawValueDef | undefined,
  length: number,
  integer: boolean,
  ownerLabel: string,
  key: string,
): number[] | undefined {
  if (value === undefined) return undefined
  if (!isRawArray(value) || value.items.length !== length) {
    throw new Error(`PDF ${ownerLabel} OPI ${key} must contain ${length} numbers`)
  }
  const result: number[] = []
  for (let i = 0; i < value.items.length; i++) {
    const item = value.items[i]
    if (typeof item !== 'number' || (integer && !Number.isInteger(item))) {
      throw new Error(`PDF ${ownerLabel} OPI ${key} contains an invalid number`)
    }
    result.push(item)
  }
  return result
}

function optionalNumber(value: PdfRawValueDef | undefined, ownerLabel: string, key: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number') throw new Error(`PDF ${ownerLabel} OPI ${key} must be a number`)
  return value
}

function optionalBoolean(value: PdfRawValueDef | undefined, ownerLabel: string, key: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`PDF ${ownerLabel} OPI ${key} must be a boolean`)
}

function isRawName(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'name' }> {
  return typeof value === 'object' && value !== null && value.kind === 'name'
}

function isRawString(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'string' }> {
  return typeof value === 'object' && value !== null && value.kind === 'string'
}

function isRawArray(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'array' }> {
  return typeof value === 'object' && value !== null && value.kind === 'array'
}

function isRawDictionary(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'dictionary' }> {
  return typeof value === 'object' && value !== null && value.kind === 'dictionary'
}
