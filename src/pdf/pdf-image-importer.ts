import { encodePngRgba } from '../image/png-encoder.js'
import { decodePng } from '../image/png-parser.js'
import { decodeJpegSamples, decodeJpegToRgba } from '../image/jpeg-decoder.js'
import { decodeJpx } from '../compression/jpx-decoder.js'
import { parseIccProfile, type IccTransform } from './icc-profile-reader.js'
import { decodeJbig2 } from '../compression/jbig2-decoder.js'
import { parseJpegInfo } from '../image/jpeg-parser.js'
import { PdfDocument, PdfName, PdfRef, PdfStream, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'
import { parsePdfColorSpace, pdfColorSpaceComponents, pdfColorToRgb, type PdfColorSpace } from './pdf-colorspace.js'
import type { PdfOpiMetadataDef, PdfRawValueDef, RenderingIntentDef } from '../types/template.js'
import {
  pdfMeasurementFromRaw,
  pdfPointDataFromRaw,
  type PdfMeasurement,
  type PdfPointData,
} from './pdf-measurement.js'
import { validatePdfOpiMetadata } from './pdf-opi.js'

export interface ImportedPdfImageData {
  bytes: Uint8Array
  extension: 'jpg' | 'png'
  intent: RenderingIntentDef | null
  interpolate: boolean | null
  alternates: ImportedPdfImageAlternate[]
  opi: PdfOpiMetadataDef | null
  measure: PdfMeasurement | null
  pointData: PdfPointData[] | null
}

export interface ImportedPdfImageAlternate {
  image: ImportedPdfImageData
  defaultForPrinting: boolean
}

export function importPdfImageXObject(doc: PdfDocument, stream: PdfStream, fillColor: string, blackPointCompensation = false, deviceCmykTransform?: IccTransform): ImportedPdfImageData {
  return importPdfImage(doc, stream, fillColor, new Set<PdfStream>(), blackPointCompensation, deviceCmykTransform)
}

export function importInlinePdfImage(doc: PdfDocument, dict: PdfDict, data: Uint8Array, fillColor: string, blackPointCompensation = false, deviceCmykTransform?: IccTransform): ImportedPdfImageData {
  return importPdfImage(doc, new PdfStream(normalizeInlineImageDict(dict), data), fillColor, new Set<PdfStream>(), blackPointCompensation, deviceCmykTransform)
}

export function flipImportedPdfImage(image: ImportedPdfImageData, flipX: boolean, flipY: boolean): ImportedPdfImageData {
  if (!flipX && !flipY) return image
  const alternates = image.alternates.map(function (alternate) {
    return { image: flipImportedPdfImage(alternate.image, flipX, flipY), defaultForPrinting: alternate.defaultForPrinting }
  })
  if (image.extension === 'png') {
    const decoded = decodePng(image.bytes)
    const rgba = flipRgba(decoded.pixels, decoded.width, decoded.height, flipX, flipY)
    return { bytes: encodePngRgba(decoded.width, decoded.height, rgba), extension: 'png', intent: image.intent, interpolate: image.interpolate, alternates, opi: image.opi, measure: image.measure, pointData: image.pointData }
  }
  const decoded = decodeJpegToRgba(image.bytes)
  const rgba = flipRgba(decoded.rgba, decoded.width, decoded.height, flipX, flipY)
  return { bytes: encodePngRgba(decoded.width, decoded.height, rgba), extension: 'png', intent: image.intent, interpolate: image.interpolate, alternates, opi: image.opi, measure: image.measure, pointData: image.pointData }
}

function importPdfImage(doc: PdfDocument, stream: PdfStream, fillColor: string, active: Set<PdfStream>, blackPointCompensation: boolean, deviceCmykTransform?: IccTransform): ImportedPdfImageData {
  if (active.has(stream)) throw new Error('PDF import error: circular alternate image reference')
  active.add(stream)
  const dict = stream.dict
  const alternates = readAlternateImages(doc, dict, fillColor, active, blackPointCompensation, deviceCmykTransform)
  const opi = readPdfOpiMetadata(doc, dict, 'image')
  const measureValue = doc.resolve(dict.get('Measure') ?? null)
  let measure: PdfMeasurement | null = null
  if (measureValue !== null) {
    if (!(measureValue instanceof Map)) throw new Error('PDF import error: image Measure must be a dictionary')
    measure = pdfMeasurementFromRaw(rawPdfDictionary(doc, measureValue, new Set<object>()))
  }
  const pointDataValue = doc.resolve(dict.get('PtData') ?? null)
  const pointData = pointDataValue === null ? null : pdfPointDataFromRaw(rawPdfValue(doc, pointDataValue, new Set<object>()))
  active.delete(stream)
  const intent = imageRenderingIntent(doc, dict)
  const interpolate = optionalBoolean(doc, dict, 'Interpolate')
  const filters = readFilters(doc, dict)
  const dctIndex = filters.indexOf('DCTDecode')
  if (dctIndex >= 0) {
    if (dctIndex !== filters.length - 1) {
      throw new Error('PDF import error: DCTDecode image filter must be terminal')
    }
    const jpegBytes = decodeImageFiltersBeforeTerminalDct(doc, stream, filters, dctIndex)
    const jpegDecode = decodeArray(doc, dict)
    const colorTransform = dctColorTransform(doc, dict, dctIndex)
    const maskValue = doc.resolve(dict.get('Mask') ?? null)
    const smaskValue = doc.resolve(dict.get('SMask') ?? null)
    const colorKey = colorKeyMaskRanges(doc, maskValue)
    const info = parseJpegInfo(jpegBytes)
    const declaredWidth = requiredPositiveInteger(doc, dict, 'Width')
    const declaredHeight = requiredPositiveInteger(doc, dict, 'Height')
    if (declaredWidth !== info.width || declaredHeight !== info.height) throw new Error('PDF import error: DCTDecode dimensions do not match the image dictionary')
    const declaredBits = requiredNumber(doc, dict, 'BitsPerComponent')
    if (declaredBits !== info.bitsPerComponent) throw new Error('PDF import error: DCTDecode precision does not match BitsPerComponent')
    if (boolValue(doc.resolve(dict.get('ImageMask') ?? null))) throw new Error('PDF import error: DCTDecode cannot provide a 1-bit image mask')
    const colorSpaceValue = doc.resolve(dict.get('ColorSpace') ?? dict.get('CS') ?? null)
    const directBrowserColor = colorSpaceValue instanceof PdfName
      && ((info.components === 1 && (colorSpaceValue.name === 'DeviceGray' || colorSpaceValue.name === 'G'))
        || (info.components === 3 && (colorSpaceValue.name === 'DeviceRGB' || colorSpaceValue.name === 'RGB')))
    const mustDecode = !directBrowserColor || info.components === 4 || jpegDecode !== null
      || colorTransform !== undefined || colorKey !== null
      || maskValue instanceof PdfStream || smaskValue instanceof PdfStream
    if (mustDecode) {
      const image = decodeJpegSamples(jpegBytes, colorTransform)
      const colorSpace = parseColorSpace(doc, colorSpaceValue)
      if (pdfColorSpaceComponents(colorSpace) !== image.componentCount) {
        throw new Error('PDF import error: DCTDecode component count does not match the image color space')
      }
      const softMask = smaskValue instanceof PdfStream ? decodeSoftMask(doc, smaskValue, image.width, image.height) : null
      const rgba = jpegSamplesToRgba(doc, image.samples, image.width, image.height, image.bitDepth, colorSpace, jpegDecode, intent, softMask, blackPointCompensation, deviceCmykTransform)
      if (!(smaskValue instanceof PdfStream)) {
        if (colorKey !== null) applyColorKeyMask(rgba, image.samples, image.componentCount, image.bitDepth, colorKey)
        if (maskValue instanceof PdfStream) applyExplicitMask(doc, maskValue, rgba, image.width, image.height)
      }
      return imageResult(encodePngRgba(image.width, image.height, rgba), 'png', intent, interpolate, alternates, opi, measure, pointData)
    }
    return imageResult(jpegBytes, 'jpg', intent, interpolate, alternates, opi, measure, pointData)
  }

  const jbig2Index = filters.indexOf('JBIG2Decode')
  if (jbig2Index >= 0) {
    if (jbig2Index !== filters.length - 1) {
      throw new Error('PDF import error: JBIG2Decode image filter must be terminal')
    }
    const jbig2Bytes = decodeImageFiltersBeforeTerminalDct(doc, stream, filters, jbig2Index)
    // /JBIG2Globals from the terminal filter's decode parms
    let globals: Uint8Array | null = null
    const parms = terminalDecodeParms(doc, dict, jbig2Index)
    if (parms instanceof Map) {
      const globalsValue = doc.resolve(parms.get('JBIG2Globals') ?? null)
      if (globalsValue instanceof PdfStream) globals = doc.decodeStream(globalsValue)
    }
    const image = decodeJbig2(jbig2Bytes, globals)
    const width = requiredPositiveInteger(doc, dict, 'Width')
    const height = requiredPositiveInteger(doc, dict, 'Height')
    if (width !== image.width || height !== image.height) throw new Error('PDF import error: JBIG2Decode dimensions do not match the image dictionary')
    const imageMask = boolValue(doc.resolve(dict.get('ImageMask') ?? null))
    const bpcValue = doc.resolve(dict.get('BitsPerComponent') ?? null)
    if (!imageMask && bpcValue !== 1) throw new Error('PDF import error: JBIG2Decode BitsPerComponent must be 1')
    if (imageMask && bpcValue !== null && bpcValue !== 1) throw new Error('PDF import error: image mask BitsPerComponent must be 1')
    const maskValue = doc.resolve(dict.get('Mask') ?? null)
    if (imageMask && maskValue !== null) throw new Error('PDF import error: image masks must not specify Mask')
    const decode = decodeArray(doc, dict)
    if (decode !== null && decode.length !== 2) throw new Error('PDF import error: JBIG2Decode image /Decode must contain two numbers')
    const colorSpaceValue = doc.resolve(dict.get('ColorSpace') ?? null)
    if (imageMask && colorSpaceValue !== null) throw new Error('PDF import error: image masks must not specify ColorSpace')
    const colorSpace = imageMask ? null : parseColorSpace(doc, colorSpaceValue)
    if (colorSpace !== null && pdfColorSpaceComponents(colorSpace) !== 1) throw new Error('PDF import error: JBIG2Decode requires a one-component color space')
    const colorKey = colorKeyMaskRanges(doc, maskValue)
    validateColorKeyMask(colorKey, 1, 1)
    const smaskValue = doc.resolve(dict.get('SMask') ?? null)
    if (imageMask && smaskValue !== null) throw new Error('PDF import error: image masks must not specify SMask')
    const softMask = smaskValue instanceof PdfStream ? decodeSoftMask(doc, smaskValue, image.width, image.height) : null
    const rgba = new Uint8Array(image.width * image.height * 4)
    for (let i = 0; i < image.width * image.height; i++) {
      const sample = image.pixels[i]! === 1 ? 0 : 1
      if (imageMask) {
        const rgb = parseHexColor(fillColor)
        const inverse = imageMaskDecodeInverts(decode)
        rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]
        rgba[i * 4 + 3] = (inverse ? sample === 1 : sample === 0) ? 255 : 0
      } else {
        const value = decode === null ? sample : decode[0]! + sample * (decode[1]! - decode[0]!)
        const values = [value]
        const alpha = applySoftMaskToComponents(values, softMask, i)
        writePdfColor(doc, rgba, i * 4, colorSpace!, values, intent, blackPointCompensation, deviceCmykTransform)
        rgba[i * 4 + 3] = Math.round(alpha * 255)
        if (softMask === null && colorKey !== null && sampleInColorKey([sample], colorKey)) rgba[i * 4 + 3] = 0
      }
    }
    if (!(smaskValue instanceof PdfStream) && maskValue instanceof PdfStream) applyExplicitMask(doc, maskValue, rgba, image.width, image.height)
    return imageResult(encodePngRgba(image.width, image.height, rgba), 'png', intent, interpolate, alternates, opi, measure, pointData)
  }

  const jpxIndex = filters.indexOf('JPXDecode')
  if (jpxIndex >= 0) {
    if (jpxIndex !== filters.length - 1) {
      throw new Error('PDF import error: JPXDecode image filter must be terminal')
    }
    const jpxBytes = decodeImageFiltersBeforeTerminalDct(doc, stream, filters, jpxIndex)
    const image = decodeJpx(jpxBytes)
    const declaredWidth = requiredPositiveInteger(doc, dict, 'Width')
    const declaredHeight = requiredPositiveInteger(doc, dict, 'Height')
    if (declaredWidth !== image.width || declaredHeight !== image.height) throw new Error('PDF import error: JPXDecode dimensions do not match the image dictionary')
    const imageMask = boolValue(doc.resolve(dict.get('ImageMask') ?? null))
    const maskValue = doc.resolve(dict.get('Mask') ?? null)
    if (imageMask && maskValue !== null) throw new Error('PDF import error: image masks must not specify Mask')
    const smaskInDataValue = doc.resolve(dict.get('SMaskInData') ?? null)
    const smaskInData = smaskInDataValue === null ? 0 : smaskInDataValue
    if (smaskInData !== 0 && smaskInData !== 1 && smaskInData !== 2) throw new Error('PDF import error: JPXDecode SMaskInData must be 0, 1, or 2')
    const smaskValue = doc.resolve(dict.get('SMask') ?? null)
    if (smaskInData !== 0 && smaskValue !== null) throw new Error('PDF import error: JPXDecode with SMaskInData must not specify SMask')
    // JPEG 2000 is self-describing: the codestream geometry and component
    // count take precedence over the image dictionary (ISO 32000 7.4.9)
    const rgba = new Uint8Array(image.width * image.height * 4)
    const n = image.componentCount
    const px = image.data
    const toByte = function (sample: number, component: number): number {
      const depth = image.componentBitDepths[component]!
      const min = image.componentSigned[component]! ? -Math.pow(2, depth - 1) : 0
      const max = image.componentSigned[component]! ? Math.pow(2, depth - 1) - 1 : Math.pow(2, depth) - 1
      return Math.round((sample - min) * 255 / (max - min))
    }
    const toUnit = function (sample: number, component: number): number { return toByte(sample, component) / 255 }
    const colors = image.colorChannels
    const alpha = image.alphaChannel
    const dictionaryColorSpaceValue = doc.resolve(dict.get('ColorSpace') ?? null)
    if (imageMask && dictionaryColorSpaceValue !== null) throw new Error('PDF import error: image masks must not specify ColorSpace')
    const dictionaryColorSpace = dictionaryColorSpaceValue === null ? null : parseColorSpace(doc, dictionaryColorSpaceValue)
    if (dictionaryColorSpace !== null && pdfColorSpaceComponents(dictionaryColorSpace) !== colors.length) {
      throw new Error('PDF import error: JPXDecode color channels do not match the image dictionary ColorSpace')
    }
    const icc = dictionaryColorSpace !== null || image.colorProfile === null ? null : parseIccProfile(image.colorProfile)
    if (dictionaryColorSpace === null && image.colorProfile !== null && icc === null) throw new Error('PDF import error: JP2 ICC profile has no supported device-to-PCS transform')
    if (icc !== null && icc.components !== colors.length) throw new Error('PDF import error: JP2 ICC profile component count does not match its colour channels')
    if (imageMask && smaskValue !== null) throw new Error('PDF import error: image masks must not specify SMask')
    const softMask = smaskValue instanceof PdfStream ? decodeSoftMask(doc, smaskValue, image.width, image.height) : null
    const colorKey = colorKeyMaskRanges(doc, maskValue)
    validateJpxColorKeyMask(colorKey, colors, image.componentBitDepths, image.componentSigned)
    const maskDecode = imageMask ? imageMaskDecodeInverts(decodeArray(doc, dict)) : false
    for (let i = 0; i < image.width * image.height; i++) {
      if (imageMask) {
        if (colors.length !== 1 || image.componentBitDepths[colors[0]!] !== 1) throw new Error('PDF import error: JPXDecode image mask must have one 1-bit color channel')
        const rgb = parseHexColor(fillColor)
        const sample = px[i * n + colors[0]!]!
        rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]
        rgba[i * 4 + 3] = (maskDecode ? sample === 1 : sample === 0) ? 255 : 0
        continue
      }
      const values = colors.map(function (channel) { return toUnit(px[i * n + channel]!, channel) })
      let embeddedAlpha = smaskInData === 0 || alpha === null ? 1 : toUnit(px[i * n + alpha]!, alpha)
      if (smaskInData === 2 && image.premultipliedAlpha && embeddedAlpha > 0) {
        for (let component = 0; component < values.length; component++) values[component] = clamp01(values[component]! / embeddedAlpha)
      }
      const externalAlpha = applySoftMaskToComponents(values, softMask, i)
      if (dictionaryColorSpace !== null) {
        const rgb = pdfColorToRgb(doc, dictionaryColorSpace, values, intent ?? undefined, blackPointCompensation, deviceCmykTransform)
        rgba[i * 4] = Math.round(rgb[0] * 255)
        rgba[i * 4 + 1] = Math.round(rgb[1] * 255)
        rgba[i * 4 + 2] = Math.round(rgb[2] * 255)
      } else if (icc !== null) {
        const rgb = icc.toRgb(values, intent ?? undefined, blackPointCompensation)
        rgba[i * 4] = Math.round(rgb[0] * 255)
        rgba[i * 4 + 1] = Math.round(rgb[1] * 255)
        rgba[i * 4 + 2] = Math.round(rgb[2] * 255)
      } else if (colors.length >= 3) {
        if (image.colorSpace === 'sycc') {
          const y = values[0]!
          const cb = values[1]! - 0.5
          const cr = values[2]! - 0.5
          rgba[i * 4] = Math.round(Math.max(0, Math.min(1, y + 1.402 * cr)) * 255)
          rgba[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, y - 0.344136 * cb - 0.714136 * cr)) * 255)
          rgba[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, y + 1.772 * cb)) * 255)
        } else {
          rgba[i * 4] = Math.round(values[0]! * 255)
          rgba[i * 4 + 1] = Math.round(values[1]! * 255)
          rgba[i * 4 + 2] = Math.round(values[2]! * 255)
        }
      } else {
        const g = Math.round(values[0]! * 255)
        rgba[i * 4] = g
        rgba[i * 4 + 1] = g
        rgba[i * 4 + 2] = g
      }
      if (softMask !== null) embeddedAlpha = 1
      rgba[i * 4 + 3] = Math.round(embeddedAlpha * externalAlpha * 255)
      if (softMask === null && smaskInData === 0 && colorKey !== null) {
        let masked = true
        for (let component = 0; component < colors.length; component++) {
          const sample = px[i * n + colors[component]!]!
          if (sample < colorKey[component * 2]! || sample > colorKey[component * 2 + 1]!) { masked = false; break }
        }
        if (masked) rgba[i * 4 + 3] = 0
      }
    }
    if (softMask === null && smaskInData === 0 && maskValue instanceof PdfStream) applyExplicitMask(doc, maskValue, rgba, image.width, image.height)
    return imageResult(encodePngRgba(image.width, image.height, rgba), 'png', intent, interpolate, alternates, opi, measure, pointData)
  }

  const width = requiredPositiveInteger(doc, dict, 'Width')
  const height = requiredPositiveInteger(doc, dict, 'Height')
  const imageMask = boolValue(doc.resolve(dict.get('ImageMask') ?? null))
  const maskValue = doc.resolve(dict.get('Mask') ?? null)
  if (imageMask && maskValue !== null) throw new Error('PDF import error: image masks must not specify /Mask')
  const bpc = imageMask ? 1 : requiredImageBits(doc, dict, 'BitsPerComponent')
  const decoded = filters.length === 0 ? stream.raw : doc.decodeStream(stream)
  const colorKey = colorKeyMaskRanges(doc, maskValue)
  const smaskValue = doc.resolve(dict.get('SMask') ?? null)
  if (imageMask && smaskValue !== null) throw new Error('PDF import error: image masks must not specify SMask')
  const softMask = smaskValue instanceof PdfStream ? decodeSoftMask(doc, smaskValue, width, height) : null
  const rgba = imageMask
    ? decodeImageMask(width, height, decoded, fillColor, decodeArray(doc, dict))
    : decodeSamplesToRgba(doc, dict, decoded, width, height, bpc, smaskValue instanceof PdfStream ? null : colorKey, decodeArray(doc, dict), intent, softMask, blackPointCompensation, deviceCmykTransform)

  if (!(smaskValue instanceof PdfStream) && maskValue instanceof PdfStream) applyExplicitMask(doc, maskValue, rgba, width, height)

  return imageResult(encodePngRgba(width, height, rgba), 'png', intent, interpolate, alternates, opi, measure, pointData)
}

function imageResult(
  bytes: Uint8Array,
  extension: 'jpg' | 'png',
  intent: RenderingIntentDef | null,
  interpolate: boolean | null,
  alternates: ImportedPdfImageAlternate[],
  opi: PdfOpiMetadataDef | null,
  measure: PdfMeasurement | null,
  pointData: PdfPointData[] | null,
): ImportedPdfImageData {
  return { bytes, extension, intent, interpolate, alternates, opi, measure, pointData }
}

function readAlternateImages(doc: PdfDocument, dict: PdfDict, fillColor: string, active: Set<PdfStream>, blackPointCompensation: boolean, deviceCmykTransform?: IccTransform): ImportedPdfImageAlternate[] {
  const value = doc.resolve(dict.get('Alternates') ?? null)
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error('PDF import error: image /Alternates must be an array')
  const alternates: ImportedPdfImageAlternate[] = []
  let printingDefault = false
  for (let i = 0; i < value.length; i++) {
    const alternate = doc.resolve(value[i]!)
    if (!(alternate instanceof Map)) throw new Error('PDF import error: alternate image entry must be a dictionary')
    const image = doc.resolve(alternate.get('Image') ?? null)
    if (!(image instanceof PdfStream)) throw new Error('PDF import error: alternate image dictionary requires an Image stream')
    if (image.dict.has('Alternates')) throw new Error('PDF import error: an alternate image must not contain Alternates')
    const defaultValue = doc.resolve(alternate.get('DefaultForPrinting') ?? null)
    if (defaultValue !== null && typeof defaultValue !== 'boolean') throw new Error('PDF import error: alternate image DefaultForPrinting must be a boolean')
    const defaultForPrinting = defaultValue === true
    if (defaultForPrinting && printingDefault) throw new Error('PDF import error: at most one alternate image may be DefaultForPrinting')
    if (defaultForPrinting) printingDefault = true
    alternates.push({ image: importPdfImage(doc, image, fillColor, active, blackPointCompensation, deviceCmykTransform), defaultForPrinting })
  }
  return alternates
}

export function readPdfOpiMetadata(doc: PdfDocument, ownerDict: PdfDict, ownerLabel: string): PdfOpiMetadataDef | null {
  const versionDict = doc.resolve(ownerDict.get('OPI') ?? null)
  if (versionDict === null) return null
  if (!(versionDict instanceof Map) || versionDict.size !== 1) throw new Error(`PDF import error: ${ownerLabel} OPI must be a single-entry version dictionary`)
  const pair = versionDict.entries().next().value as [string, PdfValue] | undefined
  if (pair === undefined || (pair[0] !== '1.3' && pair[0] !== '2.0')) throw new Error('PDF import error: OPI version key must be /1.3 or /2.0')
  const version = pair[0]
  const dict = doc.resolve(pair[1])
  if (!(dict instanceof Map)) throw new Error('PDF import error: OPI version value must be a dictionary')
  validateOpiCommon(doc, dict, version)
  if (version === '1.3') validateOpi13(doc, dict)
  else validateOpi20(doc, dict)
  const raw = rawPdfDictionary(doc, dict, new Set<object>())
  const metadata: PdfOpiMetadataDef = { version, entries: raw }
  validatePdfOpiMetadata(metadata, `imported ${ownerLabel}`)
  return metadata
}

function validateOpiCommon(doc: PdfDocument, dict: PdfDict, version: '1.3' | '2.0'): void {
  const type = doc.resolve(dict.get('Type') ?? null)
  if (type !== null && (!(type instanceof PdfName) || type.name !== 'OPI')) throw new Error('PDF import error: OPI Type must be /OPI')
  const actualVersion = doc.resolve(dict.get('Version') ?? null)
  if (typeof actualVersion !== 'number' || (version === '1.3' ? actualVersion !== 1.3 : actualVersion !== 2)) {
    throw new Error(`PDF import error: OPI ${version} dictionary has an invalid Version`)
  }
  const file = doc.resolve(dict.get('F') ?? null)
  if (!(file instanceof PdfString) && !(file instanceof Map)) throw new Error(`PDF import error: OPI ${version} dictionary requires a file specification F`)
}

function validateOpi13(doc: PdfDocument, dict: PdfDict): void {
  const size = requiredOpiNumberArray(doc, dict, 'Size', 2, true)
  const crop = requiredOpiNumberArray(doc, dict, 'CropRect', 4, true)
  const position = requiredOpiNumberArray(doc, dict, 'Position', 8, false)
  if (Math.abs((position[2]! - position[0]!) - (position[4]! - position[6]!)) > 1e-7
    || Math.abs((position[3]! - position[1]!) - (position[5]! - position[7]!)) > 1e-7) {
    throw new Error('PDF import error: OPI 1.3 Position must define a parallelogram')
  }
  if (size[0]! <= 0 || size[1]! <= 0) throw new Error('PDF import error: OPI 1.3 Size values must be positive')
  optionalOpiNumberArray(doc, dict, 'CropFixed', 4, false)
  optionalOpiNumberArray(doc, dict, 'Resolution', 2, false)
  optionalOpiBoolean(doc, dict, 'Overprint')
  optionalOpiBoolean(doc, dict, 'Transparency')
  const tint = optionalOpiNumber(doc, dict, 'Tint')
  if (tint !== null && (tint < 0 || tint > 1)) throw new Error('PDF import error: OPI 1.3 Tint must be in 0..1')
  const colorType = doc.resolve(dict.get('ColorType') ?? null)
  if (colorType !== null && (!(colorType instanceof PdfName) || !['Process', 'Spot', 'Separation'].includes(colorType.name))) {
    throw new Error('PDF import error: OPI 1.3 ColorType is invalid')
  }
  const color = doc.resolve(dict.get('Color') ?? null)
  if (color !== null) {
    if (!Array.isArray(color) || color.length !== 5 || !(doc.resolve(color[4]!) instanceof PdfString)) throw new Error('PDF import error: OPI 1.3 Color must contain CMYK and a byte string')
    for (let i = 0; i < 4; i++) {
      const value = doc.resolve(color[i]!)
      if (typeof value !== 'number' || value < 0 || value > 1) throw new Error('PDF import error: OPI 1.3 Color components must be in 0..1')
    }
  }
  const imageType = optionalOpiNumberArray(doc, dict, 'ImageType', 2, true)
  if (imageType !== null && (imageType[0]! <= 0 || imageType[1]! <= 0)) throw new Error('PDF import error: OPI 1.3 ImageType values must be positive')
  validateOpiTags(doc, dict, false)
  void crop
}

function validateOpi20(doc: PdfDocument, dict: PdfDict): void {
  const size = optionalOpiNumberArray(doc, dict, 'Size', 2, false)
  const crop = optionalOpiNumberArray(doc, dict, 'CropRect', 4, false)
  if ((size === null) !== (crop === null)) throw new Error('PDF import error: OPI 2.0 Size and CropRect must both be present or both absent')
  if (size !== null && crop !== null && !(0 <= crop[0]! && crop[0]! < crop[2]! && crop[2]! <= size[0]!
    && 0 <= crop[1]! && crop[1]! < crop[3]! && crop[3]! <= size[1]!)) {
    throw new Error('PDF import error: OPI 2.0 CropRect must lie within Size')
  }
  optionalOpiBoolean(doc, dict, 'Overprint')
  const mainImage = doc.resolve(dict.get('MainImage') ?? null)
  if (mainImage !== null && !(mainImage instanceof PdfString)) throw new Error('PDF import error: OPI 2.0 MainImage must be a byte string')
  const dimensions = optionalOpiNumberArray(doc, dict, 'IncludedImageDimensions', 2, true)
  if (dimensions !== null && (dimensions[0]! <= 0 || dimensions[1]! <= 0)) throw new Error('PDF import error: OPI 2.0 IncludedImageDimensions must be positive')
  const quality = optionalOpiNumber(doc, dict, 'IncludedImageQuality')
  if (quality !== null && quality !== 1 && quality !== 2 && quality !== 3) throw new Error('PDF import error: OPI 2.0 IncludedImageQuality must be 1, 2, or 3')
  validateOpi20Inks(doc, dict)
  validateOpiTags(doc, dict, true)
}

function validateOpi20Inks(doc: PdfDocument, dict: PdfDict): void {
  const inks = doc.resolve(dict.get('Inks') ?? null)
  if (inks === null) return
  if (inks instanceof PdfName) {
    if (inks.name !== 'full_color' && inks.name !== 'registration') throw new Error('PDF import error: OPI 2.0 Inks name is invalid')
    return
  }
  if (!Array.isArray(inks) || inks.length < 3 || inks.length % 2 === 0) throw new Error('PDF import error: OPI 2.0 Inks array is invalid')
  const mode = doc.resolve(inks[0]!)
  if (!(mode instanceof PdfName) || mode.name !== 'monochrome') throw new Error('PDF import error: OPI 2.0 Inks array must start with /monochrome')
  for (let i = 1; i < inks.length; i += 2) {
    const name = doc.resolve(inks[i]!)
    const tint = doc.resolve(inks[i + 1]!)
    if (!(name instanceof PdfString) || typeof tint !== 'number' || tint < 0 || tint > 1) throw new Error('PDF import error: OPI 2.0 monochrome inks require byte-string names and tints in 0..1')
  }
}

function validateOpiTags(doc: PdfDocument, dict: PdfDict, allowStringArray: boolean): void {
  const tags = doc.resolve(dict.get('Tags') ?? null)
  if (tags === null) return
  if (!Array.isArray(tags) || tags.length % 2 !== 0) throw new Error('PDF import error: OPI Tags must contain number/value pairs')
  for (let i = 0; i < tags.length; i += 2) {
    if (!Number.isInteger(doc.resolve(tags[i]!))) throw new Error('PDF import error: OPI tag number must be an integer')
    const value = doc.resolve(tags[i + 1]!)
    const validArray = allowStringArray && Array.isArray(value) && value.every(function (item) { return doc.resolve(item) instanceof PdfString })
    if (!(value instanceof PdfString) && !validArray) throw new Error('PDF import error: OPI tag value must be a byte string or permitted byte-string array')
  }
}

function requiredOpiNumberArray(doc: PdfDocument, dict: PdfDict, key: string, count: number, integer: boolean): number[] {
  const value = optionalOpiNumberArray(doc, dict, key, count, integer)
  if (value === null) throw new Error(`PDF import error: OPI dictionary requires ${key}`)
  return value
}

function optionalOpiNumberArray(doc: PdfDocument, dict: PdfDict, key: string, count: number, integer: boolean): number[] | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (!Array.isArray(value) || value.length !== count) throw new Error(`PDF import error: OPI ${key} must contain ${count} numbers`)
  const result: number[] = []
  for (let i = 0; i < value.length; i++) {
    const item = doc.resolve(value[i]!)
    if (typeof item !== 'number' || (integer && !Number.isInteger(item))) throw new Error(`PDF import error: OPI ${key} contains an invalid number`)
    result.push(item)
  }
  return result
}

function optionalOpiNumber(doc: PdfDocument, dict: PdfDict, key: string): number | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (typeof value !== 'number') throw new Error(`PDF import error: OPI ${key} must be a number`)
  return value
}

function optionalOpiBoolean(doc: PdfDocument, dict: PdfDict, key: string): boolean | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (typeof value !== 'boolean') throw new Error(`PDF import error: OPI ${key} must be a boolean`)
  return value
}

export function rawPdfDictionary(doc: PdfDocument, dict: PdfDict, active: Set<object>): Record<string, PdfRawValueDef> {
  if (active.has(dict)) throw new Error('PDF import error: cyclic preserved PDF dictionary')
  active.add(dict)
  const entries: Record<string, PdfRawValueDef> = {}
  for (const [key, value] of dict) entries[key] = rawPdfValue(doc, value, active)
  active.delete(dict)
  return entries
}

export function rawPdfValue(doc: PdfDocument, value: PdfValue, active: Set<object>): PdfRawValueDef {
  const resolved = doc.resolve(value)
  if (resolved === null) return null
  if (typeof resolved === 'boolean') return resolved
  if (typeof resolved === 'number') return resolved
  if (resolved instanceof PdfName) return { kind: 'name', value: resolved.name }
  if (resolved instanceof PdfString) return { kind: 'string', bytes: resolved.bytes.slice() }
  if (resolved instanceof PdfRef) {
    if (active.has(resolved)) throw new Error('PDF import error: cyclic preserved PDF reference')
    active.add(resolved)
    const result = rawPdfValue(doc, resolved, active)
    active.delete(resolved)
    return result
  }
  if (resolved instanceof PdfStream) {
    return { kind: 'stream', entries: rawPdfDictionary(doc, resolved.dict, active), data: resolved.raw.slice() }
  }
  if (Array.isArray(resolved)) return { kind: 'array', items: resolved.map(function (item) { return rawPdfValue(doc, item, active) }) }
  return { kind: 'dictionary', entries: rawPdfDictionary(doc, resolved, active) }
}

function dctColorTransform(doc: PdfDocument, dict: PdfDict, filterIndex: number): 0 | 1 | undefined {
  const value = terminalDecodeParms(doc, dict, filterIndex)
  if (value === null) return undefined
  const parms = doc.resolve(value)
  if (!(parms instanceof Map)) throw new Error('PDF import error: DCTDecode DecodeParms must be a dictionary or null')
  const transform = doc.resolve(parms.get('ColorTransform') ?? null)
  if (transform === null) return undefined
  if (transform !== 0 && transform !== 1) throw new Error('PDF import error: DCTDecode ColorTransform must be 0 or 1')
  return transform
}

function jpegSamplesToRgba(
  doc: PdfDocument,
  samples: Uint8Array | Uint16Array,
  width: number,
  height: number,
  bitDepth: number,
  colorSpace: PdfColorSpace,
  decode: number[] | null,
  intent: RenderingIntentDef | null,
  softMask: DecodedSoftMask | null,
  blackPointCompensation: boolean,
  deviceCmykTransform?: IccTransform,
): Uint8Array {
  const components = pdfColorSpaceComponents(colorSpace)
  if (decode !== null && decode.length !== components * 2) {
    throw new Error('PDF import error: DCTDecode image /Decode length must be twice the color component count')
  }
  const maxSample = Math.pow(2, bitDepth) - 1
  const rgba = new Uint8Array(width * height * 4)
  const values = new Array<number>(components)
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let component = 0; component < components; component++) {
      const normalized = samples[pixel * components + component]! / maxSample
      if (decode !== null) {
        values[component] = decode[component * 2]! + normalized * (decode[component * 2 + 1]! - decode[component * 2]!)
      } else {
        values[component] = colorSpace.kind === 'indexed' ? normalized * colorSpace.high : normalized
      }
    }
    const alpha = applySoftMaskToComponents(values, softMask, pixel)
    writePdfColor(doc, rgba, pixel * 4, colorSpace, values, intent, blackPointCompensation, deviceCmykTransform)
    rgba[pixel * 4 + 3] = Math.round(alpha * 255)
  }
  return rgba
}

function terminalDecodeParms(doc: PdfDocument, dict: PdfDict, index: number): PdfValue {
  const raw = dict.get('DecodeParms') ?? dict.get('DP') ?? null
  if (raw === null) return null
  const resolved = doc.resolve(raw)
  if (Array.isArray(resolved)) return doc.resolve(resolved[index] ?? null)
  return index === 0 ? resolved : null
}

function decodeImageFiltersBeforeTerminalDct(doc: PdfDocument, stream: PdfStream, filters: string[], terminalIndex: number): Uint8Array {
  if (terminalIndex === 0) return stream.raw
  const dict: PdfDict = new Map(stream.dict)
  const prefixFilters: PdfValue[] = new Array(terminalIndex)
  for (let i = 0; i < terminalIndex; i++) prefixFilters[i] = new PdfName(filters[i]!)
  dict.set('Filter', prefixFilters.length === 1 ? prefixFilters[0]! : prefixFilters)

  const decodeParms = prefixedDecodeParms(doc, stream.dict, terminalIndex)
  if (decodeParms === null) {
    dict.delete('DecodeParms')
    dict.delete('DP')
  } else {
    dict.set('DecodeParms', decodeParms)
    dict.delete('DP')
  }
  return doc.decodeStream(new PdfStream(dict, stream.raw, stream.objNum, stream.genNum))
}

function prefixedDecodeParms(doc: PdfDocument, dict: PdfDict, count: number): PdfValue {
  const raw = dict.get('DecodeParms') ?? dict.get('DP') ?? null
  if (raw === null) return null
  const resolved = doc.resolve(raw)
  if (!Array.isArray(resolved)) return raw
  const out: PdfValue[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = resolved[i] ?? null
  return out
}

function flipRgba(data: Uint8Array, width: number, height: number, flipX: boolean, flipY: boolean): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let y = 0; y < height; y++) {
    const srcY = flipY ? height - 1 - y : y
    for (let x = 0; x < width; x++) {
      const srcX = flipX ? width - 1 - x : x
      const src = (srcY * width + srcX) * 4
      const dst = (y * width + x) * 4
      out[dst] = data[src]!
      out[dst + 1] = data[src + 1]!
      out[dst + 2] = data[src + 2]!
      out[dst + 3] = data[src + 3]!
    }
  }
  return out
}

function decodeSamplesToRgba(doc: PdfDocument, dict: PdfDict, data: Uint8Array, width: number, height: number, bpc: number, colorKey: number[] | null, decode: number[] | null, intent: RenderingIntentDef | null, softMask: DecodedSoftMask | null, blackPointCompensation: boolean, deviceCmykTransform?: IccTransform): Uint8Array {
  const colorSpaceValue = doc.resolve(dict.get('ColorSpace') ?? null)
  const colorSpace = parseColorSpace(doc, colorSpaceValue)
  const components = colorSpaceComponents(colorSpace)
  if (decode !== null && decode.length !== components * 2) {
    throw new Error('PDF import error: image /Decode length must be twice the color component count')
  }
  validateColorKeyMask(colorKey, components, bpc)
  const rgba = new Uint8Array(width * height * 4)
  const rawSamples: number[] = []
  const maxSample = 2 ** bpc - 1
  // Each row starts on a byte boundary (PDF 8.9.5.2)
  const rowBits = Math.ceil(width * components * bpc / 8) * 8
  const requiredBytes = rowBits / 8 * height
  if (data.length < requiredBytes) throw new Error('PDF import error: image sample data is truncated')
  for (let y = 0; y < height; y++) {
    let bitPos = y * rowBits
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      rawSamples.length = 0
      if (colorSpace.kind === 'indexed') {
        let index = readSample(data, bitPos, bpc)
        bitPos += bpc
        rawSamples.push(index)
        if (decode !== null) {
          // /Decode remaps the index range (PDF 8.9.5.2, Table 89)
          index = Math.round(decode[0]! + index * (decode[1]! - decode[0]!) / maxSample)
        }
        if (softMask?.matte !== null && softMask?.matte !== undefined) {
          const normalized = [index / colorSpace.high]
          applySoftMaskToComponents(normalized, softMask, i)
          index = Math.round(normalized[0]! * colorSpace.high)
        }
        writeIndexedColor(doc, rgba, i * 4, colorSpace, index, intent, blackPointCompensation, deviceCmykTransform)
      } else {
        const values: number[] = []
        for (let j = 0; j < components; j++) {
          const sample = readSample(data, bitPos, bpc)
          rawSamples.push(sample)
          let value = normalizeSample(sample, bpc)
          if (decode !== null) {
            value = decode[j * 2]! + value * (decode[j * 2 + 1]! - decode[j * 2]!)
          }
          values.push(value)
          bitPos += bpc
        }
        applySoftMaskToComponents(values, softMask, i)
        writePdfColor(doc, rgba, i * 4, colorSpace, values, intent, blackPointCompensation, deviceCmykTransform)
      }
      if (softMask !== null) rgba[i * 4 + 3] = Math.round(softMask.alpha[i]! * 255)
      // Color-key masking (PDF 8.9.6.4): samples within all ranges are transparent
      if (colorKey !== null && sampleInColorKey(rawSamples, colorKey)) rgba[i * 4 + 3] = 0
    }
  }
  return rgba
}

/** Reads a /Mask color-key range array ([min0 max0 min1 max1 ...] in raw sample values) */
function colorKeyMaskRanges(doc: PdfDocument, mask: PdfValue): number[] | null {
  if (mask === null || mask instanceof PdfStream) return null
  if (!Array.isArray(mask)) throw new Error('PDF import error: image /Mask must be a stream or range array')
  const ranges: number[] = []
  for (let i = 0; i < mask.length; i++) {
    const item = doc.resolve(mask[i]!)
    if (typeof item !== 'number') throw new Error('PDF import error: image /Mask ranges must contain numbers')
    ranges.push(item)
  }
  return ranges
}

function validateColorKeyMask(ranges: number[] | null, components: number, bitsPerComponent: number): void {
  if (ranges === null) return
  if (ranges.length !== components * 2) throw new Error('PDF import error: image /Mask range count must be twice the color component count')
  const maximum = Math.pow(2, bitsPerComponent) - 1
  for (let i = 0; i < ranges.length; i += 2) {
    const minimum = ranges[i]!
    const max = ranges[i + 1]!
    if (!Number.isInteger(minimum) || !Number.isInteger(max) || minimum < 0 || max > maximum || minimum > max) {
      throw new Error('PDF import error: image /Mask ranges must be ordered integers within the raw sample range')
    }
  }
}

function validateJpxColorKeyMask(ranges: number[] | null, channels: readonly number[], bitDepths: readonly number[], signed: readonly boolean[]): void {
  if (ranges === null) return
  if (ranges.length !== channels.length * 2) throw new Error('PDF import error: image /Mask range count must be twice the color component count')
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i]!
    const bits = bitDepths[channel]!
    const minimumSample = signed[channel]! ? -Math.pow(2, bits - 1) : 0
    const maximumSample = signed[channel]! ? Math.pow(2, bits - 1) - 1 : Math.pow(2, bits) - 1
    const minimum = ranges[i * 2]!
    const maximum = ranges[i * 2 + 1]!
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < minimumSample || maximum > maximumSample || minimum > maximum) {
      throw new Error('PDF import error: JPXDecode /Mask ranges must be ordered integers within each raw component range')
    }
  }
}

function sampleInColorKey(samples: number[], ranges: number[]): boolean {
  for (let i = 0; i < samples.length; i++) {
    const min = ranges[i * 2]
    const max = ranges[i * 2 + 1]
    if (min === undefined || max === undefined) return false
    if (samples[i]! < min || samples[i]! > max) return false
  }
  return true
}

function applyColorKeyMask(rgba: Uint8Array, samples: Uint8Array | Uint16Array, components: number, bits: number, ranges: number[]): void {
  validateColorKeyMask(ranges, components, bits)
  const pixelCount = rgba.length / 4
  for (let i = 0; i < pixelCount; i++) {
    let masked = true
    const sampleBase = i * components
    for (let c = 0; c < components; c++) {
      const min = ranges[c * 2]
      const max = ranges[c * 2 + 1]
      if (min === undefined || max === undefined) {
        masked = false
        break
      }
      const sample = samples[sampleBase + c]!
      if (sample < min || sample > max) {
        masked = false
        break
      }
    }
    if (masked) rgba[i * 4 + 3] = 0
  }
}

function decodeImageMask(width: number, height: number, data: Uint8Array, fillColor: string, decode: number[] | null): Uint8Array {
  const rgb = parseHexColor(fillColor)
  const inverse = imageMaskDecodeInverts(decode)
  const rgba = new Uint8Array(width * height * 4)
  // Stencil masking (PDF 8.9.6.2): with the default Decode [0 1], sample 0
  // marks painted areas. Each row starts on a byte boundary.
  const rowBits = Math.ceil(width / 8) * 8
  for (let y = 0; y < height; y++) {
    let bitPos = y * rowBits
    for (let x = 0; x < width; x++) {
      const sample = readSample(data, bitPos, 1)
      bitPos++
      const painted = inverse ? sample === 1 : sample === 0
      const pos = (y * width + x) * 4
      rgba[pos] = rgb[0]
      rgba[pos + 1] = rgb[1]
      rgba[pos + 2] = rgb[2]
      rgba[pos + 3] = painted ? 255 : 0
    }
  }
  return rgba
}

function applyExplicitMask(doc: PdfDocument, mask: PdfStream, rgba: Uint8Array, width: number, height: number): void {
  if (!boolValue(doc.resolve(mask.dict.get('ImageMask') ?? null))) {
    throw new Error('PDF import error: explicit image /Mask stream must be an image mask')
  }
  const bpcValue = doc.resolve(mask.dict.get('BitsPerComponent') ?? null)
  if (bpcValue !== null && bpcValue !== 1) throw new Error('PDF import error: explicit image /Mask stream must use 1 bit per component')
  const maskWidth = requiredPositiveInteger(doc, mask.dict, 'Width')
  const maskHeight = requiredPositiveInteger(doc, mask.dict, 'Height')
  const data = doc.decodeStream(mask)
  const inverse = imageMaskDecodeInverts(decodeArray(doc, mask.dict))
  const interpolate = optionalBoolean(doc, mask.dict, 'Interpolate') ?? false
  const rowBits = Math.ceil(maskWidth / 8) * 8
  if (data.length < rowBits / 8 * maskHeight) throw new Error('PDF import error: explicit image mask data is truncated')
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const opacity = sampleMaskValue(data, rowBits, 1, maskWidth, maskHeight, x, y, width, height, interpolate, !inverse)
      const alpha = (y * width + x) * 4 + 3
      rgba[alpha] = Math.round(rgba[alpha]! * opacity)
    }
  }
}

function imageMaskDecodeInverts(decode: number[] | null): boolean {
  if (decode === null) return false
  if (decode.length !== 2) throw new Error('PDF import error: image mask /Decode must contain two numbers')
  if (decode[0] === 0 && decode[1] === 1) return false
  if (decode[0] === 1 && decode[1] === 0) return true
  throw new Error('PDF import error: image mask /Decode must be [0 1] or [1 0]')
}

interface DecodedSoftMask {
  alpha: Float64Array
  matte: number[] | null
}

function decodeSoftMask(doc: PdfDocument, smask: PdfStream, width: number, height: number): DecodedSoftMask {
  const maskWidth = requiredPositiveInteger(doc, smask.dict, 'Width')
  const maskHeight = requiredPositiveInteger(doc, smask.dict, 'Height')
  const decode = decodeArray(doc, smask.dict)
  if (decode !== null && decode.length !== 2) throw new Error('PDF import error: soft mask /Decode must contain two numbers')
  // A soft mask may itself be image-coded (DCTDecode/JPXDecode). Decode it as an
  // image (its grayscale luminance is the alpha) rather than through the generic
  // stream decoder, which only handles the byte filters. Other filters give raw
  // samples.
  let data: Uint8Array
  let bpc: number
  const filters = readFilters(doc, smask.dict)
  const dctIndex = filters.indexOf('DCTDecode')
  const jpxIndex = filters.indexOf('JPXDecode')
  if (dctIndex >= 0) {
    if (dctIndex !== filters.length - 1) throw new Error('PDF import error: DCTDecode soft mask filter must be terminal')
    const jpegBytes = decodeImageFiltersBeforeTerminalDct(doc, smask, filters, dctIndex)
    const image = decodeJpegToRgba(jpegBytes)
    const gray = new Uint8Array(image.width * image.height)
    for (let i = 0; i < gray.length; i++) gray[i] = image.rgba[i * 4]!
    data = gray
    bpc = 8
  } else if (jpxIndex >= 0) {
    if (jpxIndex !== filters.length - 1) throw new Error('PDF import error: JPXDecode soft mask filter must be terminal')
    const jpxBytes = decodeImageFiltersBeforeTerminalDct(doc, smask, filters, jpxIndex)
    const image = decodeJpx(jpxBytes)
    const gray = new Uint8Array(image.width * image.height)
    const n = image.componentCount
    const channel = image.alphaChannel ?? image.colorChannels[0] ?? 0
    const depth = image.componentBitDepths[channel]!
    const min = image.componentSigned[channel]! ? -Math.pow(2, depth - 1) : 0
    const max = image.componentSigned[channel]! ? Math.pow(2, depth - 1) - 1 : Math.pow(2, depth) - 1
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round((image.data[i * n + channel]! - min) * 255 / (max - min))
    data = gray
    bpc = 8
  } else {
    data = doc.decodeStream(smask)
    bpc = requiredImageBits(doc, smask.dict, 'BitsPerComponent')
  }
  const rowBits = Math.ceil(maskWidth * bpc / 8) * 8
  if (data.length < rowBits / 8 * maskHeight) throw new Error('PDF import error: soft mask sample data is truncated')
  const interpolate = optionalBoolean(doc, smask.dict, 'Interpolate') ?? false
  const alpha = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = sampleMaskValue(data, rowBits, bpc, maskWidth, maskHeight, x, y, width, height, interpolate, false)
      if (decode !== null) value = clamp01(decode[0]! + value * (decode[1]! - decode[0]!))
      alpha[y * width + x] = value
    }
  }
  const matte = decodeArrayKey(doc, smask.dict, 'Matte')
  return { alpha, matte }
}

function sampleMaskValue(
  data: Uint8Array,
  rowBits: number,
  bits: number,
  maskWidth: number,
  maskHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  interpolate: boolean,
  invert: boolean,
): number {
  const sx = (x + 0.5) * maskWidth / width - 0.5
  const sy = (y + 0.5) * maskHeight / height - 0.5
  if (!interpolate) {
    const ix = Math.max(0, Math.min(maskWidth - 1, Math.round(sx)))
    const iy = Math.max(0, Math.min(maskHeight - 1, Math.round(sy)))
    const value = normalizeSample(readSample(data, iy * rowBits + ix * bits, bits), bits)
    return invert ? 1 - value : value
  }
  const clampedX = Math.max(0, Math.min(maskWidth - 1, sx))
  const clampedY = Math.max(0, Math.min(maskHeight - 1, sy))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(maskWidth - 1, x0 + 1)
  const y1 = Math.min(maskHeight - 1, y0 + 1)
  const fx = clampedX - x0
  const fy = clampedY - y0
  const read = function (ix: number, iy: number): number {
    const value = normalizeSample(readSample(data, iy * rowBits + ix * bits, bits), bits)
    return invert ? 1 - value : value
  }
  const top = read(x0, y0) * (1 - fx) + read(x1, y0) * fx
  const bottom = read(x0, y1) * (1 - fx) + read(x1, y1) * fx
  return top * (1 - fy) + bottom * fy
}

function applySoftMaskToComponents(values: number[], mask: DecodedSoftMask | null, pixel: number): number {
  if (mask === null) return 1
  const alpha = mask.alpha[pixel]!
  if (mask.matte !== null) {
    if (mask.matte.length !== values.length) throw new Error('PDF import error: soft mask Matte length must match the parent image color components')
    if (alpha > 0) {
      for (let i = 0; i < values.length; i++) values[i] = clamp01(mask.matte[i]! + (values[i]! - mask.matte[i]!) / alpha)
    }
  }
  return alpha
}

type ColorSpace = PdfColorSpace

function parseColorSpace(doc: PdfDocument, value: PdfValue): ColorSpace {
  return parsePdfColorSpace(doc, value)
}

function colorSpaceComponents(colorSpace: ColorSpace): number {
  return pdfColorSpaceComponents(colorSpace)
}

function writeIndexedColor(doc: PdfDocument, rgba: Uint8Array, pos: number, colorSpace: Extract<ColorSpace, { kind: 'indexed' }>, index: number, intent: RenderingIntentDef | null, blackPointCompensation: boolean, deviceCmykTransform?: IccTransform): void {
  if (index > colorSpace.high) throw new Error('PDF import error: Indexed image sample exceeds high value')
  const components = pdfColorSpaceComponents(colorSpace.base)
  const lookupPos = index * components
  if (lookupPos + components > colorSpace.lookup.length) throw new Error('PDF import error: Indexed color lookup is too short')
  const values = new Array<number>(components)
  for (let i = 0; i < components; i++) values[i] = colorSpace.lookup[lookupPos + i]! / 255
  writePdfColor(doc, rgba, pos, colorSpace.base, values, intent, blackPointCompensation, deviceCmykTransform)
}

function writePdfColor(doc: PdfDocument, rgba: Uint8Array, pos: number, colorSpace: PdfColorSpace, components: number[], intent: RenderingIntentDef | null, blackPointCompensation: boolean, deviceCmykTransform?: IccTransform): void {
  const rgb = pdfColorToRgb(doc, colorSpace, components, intent ?? undefined, blackPointCompensation, deviceCmykTransform)
  rgba[pos] = Math.round(rgb[0] * 255)
  rgba[pos + 1] = Math.round(rgb[1] * 255)
  rgba[pos + 2] = Math.round(rgb[2] * 255)
  rgba[pos + 3] = 255
}

function readSample(data: Uint8Array, bitPos: number, bits: number): number {
  if (bitPos < 0 || bitPos + bits > data.length * 8) throw new Error('PDF import error: image sample data is truncated')
  if (bits === 8 && (bitPos & 7) === 0) return data[bitPos >> 3]!
  if (bits === 16 && (bitPos & 7) === 0) return (data[bitPos >> 3]! << 8) | data[(bitPos >> 3) + 1]!
  let value = 0
  for (let i = 0; i < bits; i++) {
    const byte = data[(bitPos + i) >> 3]!
    const bit = 7 - ((bitPos + i) & 7)
    value = (value << 1) | ((byte >> bit) & 1)
  }
  return value
}

function normalizeSample(sample: number, bits: number): number {
  if (bits === 16) return sample / 65535
  return sample / ((1 << bits) - 1)
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function readFilters(doc: PdfDocument, dict: PdfDict): string[] {
  const value = doc.resolve(dict.get('Filter') ?? dict.get('F') ?? null)
  if (value === null) return []
  if (value instanceof PdfName) return [fullFilterName(value.name)]
  if (Array.isArray(value)) {
    const filters: string[] = []
    for (let i = 0; i < value.length; i++) {
      const item = doc.resolve(value[i]!)
      if (!(item instanceof PdfName)) throw new Error('PDF import error: image filter array must contain names')
      filters.push(fullFilterName(item.name))
    }
    return filters
  }
  throw new Error('PDF import error: image filter must be a name or name array')
}

function fullFilterName(name: string): string {
  if (name === 'DCT') return 'DCTDecode'
  if (name === 'Fl') return 'FlateDecode'
  if (name === 'AHx') return 'ASCIIHexDecode'
  if (name === 'A85') return 'ASCII85Decode'
  if (name === 'RL') return 'RunLengthDecode'
  if (name === 'LZW') return 'LZWDecode'
  return name
}

function normalizeInlineImageDict(dict: PdfDict): PdfDict {
  const out: PdfDict = new Map()
  for (const [key, value] of dict) out.set(fullInlineKey(key), value)
  return out
}

function fullInlineKey(key: string): string {
  if (key === 'W') return 'Width'
  if (key === 'H') return 'Height'
  if (key === 'BPC') return 'BitsPerComponent'
  if (key === 'CS') return 'ColorSpace'
  if (key === 'F') return 'Filter'
  if (key === 'D') return 'Decode'
  if (key === 'DP') return 'DecodeParms'
  if (key === 'IM') return 'ImageMask'
  if (key === 'I') return 'Interpolate'
  return key
}

function requiredNumber(doc: PdfDocument, dict: PdfDict, key: string): number {
  const value = doc.resolve(dict.get(key) ?? null)
  if (typeof value !== 'number') throw new Error(`PDF import error: image /${key} must be a number`)
  return value
}

function requiredPositiveInteger(doc: PdfDocument, dict: PdfDict, key: string): number {
  const value = requiredNumber(doc, dict, key)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`PDF import error: image /${key} must be a positive integer`)
  return value
}

function requiredImageBits(doc: PdfDocument, dict: PdfDict, key: string): 1 | 2 | 4 | 8 | 16 {
  const value = requiredNumber(doc, dict, key)
  if (value !== 1 && value !== 2 && value !== 4 && value !== 8 && value !== 16) {
    throw new Error(`PDF import error: image /${key} must be 1, 2, 4, 8, or 16`)
  }
  return value
}

function boolValue(value: PdfValue): boolean {
  return value === true
}

function optionalBoolean(doc: PdfDocument, dict: PdfDict, key: string): boolean | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (typeof value !== 'boolean') throw new Error(`PDF import error: image /${key} must be a boolean`)
  return value
}

function imageRenderingIntent(doc: PdfDocument, dict: PdfDict): RenderingIntentDef | null {
  const value = doc.resolve(dict.get('Intent') ?? null)
  if (value === null) return null
  if (!(value instanceof PdfName)) throw new Error('PDF import error: image /Intent must be a name')
  if (value.name === 'AbsoluteColorimetric' || value.name === 'RelativeColorimetric' || value.name === 'Saturation' || value.name === 'Perceptual') return value.name
  throw new Error(`PDF import error: unsupported image rendering intent /${value.name}`)
}

function decodeArray(doc: PdfDocument, dict: PdfDict): number[] | null {
  return decodeArrayKey(doc, dict, 'Decode')
}

function decodeArrayKey(doc: PdfDocument, dict: PdfDict, key: string): number[] | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (!Array.isArray(value)) throw new Error(`PDF import error: image /${key} must be an array`)
  const out: number[] = []
  for (let i = 0; i < value.length; i++) {
    const item = doc.resolve(value[i]!)
    if (typeof item !== 'number') throw new Error(`PDF import error: image /${key} array must contain numbers`)
    out.push(item)
  }
  return out
}

function parseHexColor(color: string): [number, number, number] {
  if (!/^#[0-9A-Fa-f]{6}/.test(color)) throw new Error(`PDF import error: unsupported image mask color ${color}`)
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ]
}
