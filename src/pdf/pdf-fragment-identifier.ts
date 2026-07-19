import type { PdfDestinationDef, PdfDestinationFitDef } from '../types/template.js'

export type PdfFragmentObjectParameter =
  | { name: 'page', pageNumber: number }
  | { name: 'nameddest', destinationName: string }
  | { name: 'structelem', structureId: Uint8Array }
  | { name: 'comment', annotationName: string }
  | { name: 'ef', embeddedFileName: string }

export type PdfFragmentOpenParameter =
  | { name: 'zoom', scale: number, left?: number, top?: number }
  | { name: 'view', fit: PdfDestinationFitDef, parameters: (number | null)[] }
  | { name: 'viewrect', left: number, top: number, width: number, height: number }
  | { name: 'highlight', left: number, right: number, top: number, bottom: number }
  | { name: 'search', words: string[] }
  | { name: 'fdf', uri: string }

export type PdfFragmentParameter = PdfFragmentObjectParameter | PdfFragmentOpenParameter

/** Ordered ISO 32000-2 Annex O fragment parameters. */
export interface PdfFragmentIdentifier {
  parameters: PdfFragmentParameter[]
  /** Media-type-specific fragment following ef; it is not interpreted as PDF. */
  embeddedFragment?: string
}

export interface PdfFragmentResolutionContext {
  pageCount: number
  namedDestinations?: readonly { name: string, destination: PdfDestinationDef }[]
  structureElements?: readonly { id: Uint8Array, index: number, pageIndex?: number }[]
  annotations?: readonly { name: string, index: number, pageIndex: number }[]
  embeddedFiles?: readonly { name: string, index: number }[]
}

export interface PdfResolvedFragmentIdentifier {
  pageIndex?: number
  destination?: PdfDestinationDef
  structureElementIndex?: number
  annotationIndex?: number
  embeddedFileIndex?: number
  zoom?: Extract<PdfFragmentOpenParameter, { name: 'zoom' }>
  view?: Extract<PdfFragmentOpenParameter, { name: 'view' }>
  viewRectangle?: Extract<PdfFragmentOpenParameter, { name: 'viewrect' }>
  highlight?: Extract<PdfFragmentOpenParameter, { name: 'highlight' }>
  searchWords?: string[]
  fdfUri?: string
  embeddedFragment?: string
}

const FIT_PARAMETER_COUNTS: Readonly<Record<PdfDestinationFitDef, number>> = {
  XYZ: 3,
  Fit: 0,
  FitH: 1,
  FitV: 1,
  FitR: 4,
  FitB: 0,
  FitBH: 1,
  FitBV: 1,
}

/** Parse the complete standardized PDF fragment-identifier parameter set. */
export function parsePdfFragmentIdentifier(value: string): PdfFragmentIdentifier {
  const fragment = value.startsWith('#') ? value.slice(1) : value
  const parameters: PdfFragmentParameter[] = []
  let offset = 0
  while (offset < fragment.length) {
    const delimiter = nextDelimiter(fragment, offset)
    const field = fragment.slice(offset, delimiter)
    const equals = field.indexOf('=')
    if (equals <= 0) throw new Error('PDF fragment identifier parameter requires name=value syntax')
    const name = field.slice(0, equals)
    const rawValue = field.slice(equals + 1)
    const parameter = parseParameter(name, rawValue)
    parameters.push(parameter)
    if (parameter.name === 'ef' && delimiter < fragment.length) {
      return { parameters, embeddedFragment: fragment.slice(delimiter + 1) }
    }
    if (parameter.name === 'fdf' && delimiter < fragment.length) {
      throw new Error('PDF fragment identifier fdf parameter shall be last')
    }
    offset = delimiter + 1
  }
  return { parameters }
}

/** Serialize without a leading NUMBER SIGN so the result can be appended to a URI. */
export function serializePdfFragmentIdentifier(fragment: PdfFragmentIdentifier): string {
  const fields: string[] = []
  for (let i = 0; i < fragment.parameters.length; i++) {
    const parameter = fragment.parameters[i]!
    if (parameter.name === 'ef' && i !== fragment.parameters.length - 1) {
      throw new Error('PDF fragment identifier ef parameter shall be the final PDF parameter')
    }
    if (parameter.name === 'fdf' && (i !== fragment.parameters.length - 1 || fragment.embeddedFragment !== undefined)) {
      throw new Error('PDF fragment identifier fdf parameter shall be last')
    }
    fields.push(serializeParameter(parameter))
  }
  if (fragment.embeddedFragment !== undefined) {
    if (fragment.parameters.length === 0 || fragment.parameters[fragment.parameters.length - 1]!.name !== 'ef') {
      throw new Error('PDF embedded fragment requires an ef parameter')
    }
    fields.push(fragment.embeddedFragment)
  }
  return fields.join('&')
}

/** Resolve object identifiers in left-to-right order against a parsed PDF model. */
export function resolvePdfFragmentIdentifier(
  fragment: PdfFragmentIdentifier,
  context: PdfFragmentResolutionContext,
): PdfResolvedFragmentIdentifier {
  const result: PdfResolvedFragmentIdentifier = {}
  for (let i = 0; i < fragment.parameters.length; i++) {
    const parameter = fragment.parameters[i]!
    if (parameter.name === 'page') {
      if (parameter.pageNumber > context.pageCount) throw new Error(`PDF fragment page ${parameter.pageNumber} is out of range`)
      result.pageIndex = parameter.pageNumber - 1
      result.destination = pageDestination(result.pageIndex)
    } else if (parameter.name === 'nameddest') {
      const destination = findNamedDestination(context.namedDestinations, parameter.destinationName)
      result.destination = destination.destination
      if (destination.destination.kind === 'explicit' && destination.destination.page.kind === 'local') {
        result.pageIndex = destination.destination.page.pageIndex
      }
    } else if (parameter.name === 'structelem') {
      const structure = findStructureElement(context.structureElements, parameter.structureId)
      result.structureElementIndex = structure.index
      if (structure.pageIndex !== undefined) result.pageIndex = structure.pageIndex
    } else if (parameter.name === 'comment') {
      const pageIndex = result.pageIndex ?? 0
      const annotation = findAnnotation(context.annotations, parameter.annotationName, pageIndex)
      result.annotationIndex = annotation.index
      result.pageIndex = pageIndex
    } else if (parameter.name === 'ef') {
      result.embeddedFileIndex = findEmbeddedFile(context.embeddedFiles, parameter.embeddedFileName).index
    } else if (parameter.name === 'zoom') {
      result.zoom = parameter
      if (result.pageIndex !== undefined) {
        result.destination = {
          kind: 'explicit',
          page: { kind: 'local', pageIndex: result.pageIndex },
          fit: 'XYZ',
          parameters: [parameter.left ?? null, parameter.top ?? null, parameter.scale / 100],
        }
      }
    } else if (parameter.name === 'view') {
      result.view = parameter
      if (result.pageIndex !== undefined) {
        result.destination = {
          kind: 'explicit',
          page: { kind: 'local', pageIndex: result.pageIndex },
          fit: parameter.fit,
          parameters: parameter.parameters.slice(),
        }
      }
    } else if (parameter.name === 'viewrect') {
      result.viewRectangle = parameter
    } else if (parameter.name === 'highlight') {
      result.highlight = parameter
    } else if (parameter.name === 'search') {
      result.searchWords = parameter.words.slice()
    } else {
      result.fdfUri = parameter.uri
    }
  }
  if (fragment.embeddedFragment !== undefined) result.embeddedFragment = fragment.embeddedFragment
  return result
}

function parseParameter(name: string, value: string): PdfFragmentParameter {
  if (name === 'page') return { name, pageNumber: positiveInteger(value, 'page') }
  if (name === 'nameddest') return { name, destinationName: textValue(value, name) }
  if (name === 'structelem') return { name, structureId: byteValue(value) }
  if (name === 'comment') return { name, annotationName: textValue(value, name) }
  if (name === 'ef') return { name, embeddedFileName: textValue(value, name) }
  if (name === 'zoom') return parseZoom(value)
  if (name === 'view') return parseView(value)
  if (name === 'viewrect') {
    const values = numberList(value, name, 4, false)
    if (values[2]! <= 0 || values[3]! <= 0) throw new Error('PDF fragment viewrect width and height shall be positive')
    return { name, left: values[0]!, top: values[1]!, width: values[2]!, height: values[3]! }
  }
  if (name === 'highlight') {
    const values = numberList(value, name, 4, false)
    return { name, left: values[0]!, right: values[1]!, top: values[2]!, bottom: values[3]! }
  }
  if (name === 'search') return { name, words: searchWords(textValue(value, name)) }
  if (name === 'fdf') return { name, uri: textValue(value, name) }
  throw new Error(`Unknown PDF fragment identifier parameter ${name}`)
}

function parseZoom(value: string): Extract<PdfFragmentOpenParameter, { name: 'zoom' }> {
  const values = value.split(',')
  if (values.length !== 1 && values.length !== 3) throw new Error('PDF fragment zoom requires scale or scale,left,top')
  const scale = finiteNumber(values[0]!, 'zoom scale')
  if (scale <= 0) throw new Error('PDF fragment zoom scale shall be positive')
  if (values.length === 1) return { name: 'zoom', scale }
  return { name: 'zoom', scale, left: finiteNumber(values[1]!, 'zoom left'), top: finiteNumber(values[2]!, 'zoom top') }
}

function parseView(value: string): Extract<PdfFragmentOpenParameter, { name: 'view' }> {
  const values = value.split(',')
  const fit = values[0] as PdfDestinationFitDef
  const count = FIT_PARAMETER_COUNTS[fit]
  if (count === undefined) throw new Error(`PDF fragment view has unknown destination keyword ${values[0]}`)
  if (values.length !== count + 1) throw new Error(`PDF fragment view ${fit} requires ${count} position values`)
  const parameters: (number | null)[] = []
  for (let i = 1; i < values.length; i++) parameters.push(values[i] === '' ? null : finiteNumber(values[i]!, `view ${fit}`))
  return { name: 'view', fit, parameters }
}

function searchWords(value: string): string[] {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') {
    throw new Error('PDF fragment search word list shall be enclosed in quotation marks')
  }
  const body = value.slice(1, -1)
  if (body.length === 0) throw new Error('PDF fragment search word list shall not be empty')
  const words = body.split(' ')
  for (let i = 0; i < words.length; i++) if (words[i]!.length === 0) throw new Error('PDF fragment search words shall be separated by one space')
  return words
}

function serializeParameter(parameter: PdfFragmentParameter): string {
  if (parameter.name === 'page') return `page=${parameter.pageNumber}`
  if (parameter.name === 'nameddest') return `nameddest=${encodeURIComponent(parameter.destinationName)}`
  if (parameter.name === 'structelem') return `structelem=${encodeBytes(parameter.structureId)}`
  if (parameter.name === 'comment') return `comment=${encodeURIComponent(parameter.annotationName)}`
  if (parameter.name === 'ef') return `ef=${encodeURIComponent(parameter.embeddedFileName)}`
  if (parameter.name === 'zoom') {
    if ((parameter.left === undefined) !== (parameter.top === undefined)) throw new Error('PDF fragment zoom left and top shall be specified together')
    return parameter.left === undefined
      ? `zoom=${parameter.scale}`
      : `zoom=${parameter.scale},${parameter.left},${parameter.top}`
  }
  if (parameter.name === 'view') {
    const count = FIT_PARAMETER_COUNTS[parameter.fit]
    if (parameter.parameters.length !== count) throw new Error(`PDF fragment view ${parameter.fit} requires ${count} position values`)
    let value = parameter.fit
    for (let i = 0; i < parameter.parameters.length; i++) value += `,${parameter.parameters[i] ?? ''}`
    return `view=${value}`
  }
  if (parameter.name === 'viewrect') return `viewrect=${parameter.left},${parameter.top},${parameter.width},${parameter.height}`
  if (parameter.name === 'highlight') return `highlight=${parameter.left},${parameter.right},${parameter.top},${parameter.bottom}`
  if (parameter.name === 'search') return `search=${encodeURIComponent(`"${parameter.words.join(' ')}"`)}`
  return `fdf=${encodeURIComponent(parameter.uri)}`
}

function nextDelimiter(value: string, offset: number): number {
  for (let i = offset; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x26 || code === 0x23) return i
  }
  return value.length
}

function positiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`PDF fragment ${label} shall be a positive integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`PDF fragment ${label} exceeds the safe integer range`)
  return number
}

function finiteNumber(value: string, label: string): number {
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) throw new Error(`PDF fragment ${label} shall be a decimal number`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`PDF fragment ${label} shall be finite`)
  return number
}

function numberList(value: string, label: string, count: number, nullable: boolean): number[] {
  const fields = value.split(',')
  if (fields.length !== count) throw new Error(`PDF fragment ${label} requires ${count} values`)
  const result: number[] = []
  for (let i = 0; i < fields.length; i++) {
    if (!nullable && fields[i]!.length === 0) throw new Error(`PDF fragment ${label} values shall not be empty`)
    result.push(finiteNumber(fields[i]!, label))
  }
  return result
}

function textValue(value: string, label: string): string {
  const bytes = byteValue(value)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.length === 0) throw new Error(`PDF fragment ${label} shall not be empty`)
  return text
}

function byteValue(value: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x25) {
      if (i + 2 >= value.length || !/^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
        throw new Error('PDF fragment contains an invalid percent escape')
      }
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      if (code > 0x7F) throw new Error('PDF fragment non-ASCII bytes shall use percent encoding')
      bytes.push(code)
    }
  }
  if (bytes.length === 0) throw new Error('PDF fragment parameter value shall not be empty')
  return Uint8Array.from(bytes)
}

function encodeBytes(value: Uint8Array): string {
  if (value.length === 0) throw new Error('PDF fragment structure ID shall not be empty')
  let result = ''
  for (let i = 0; i < value.length; i++) {
    const byte = value[i]!
    if ((byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x30 && byte <= 0x39)
      || byte === 0x2D || byte === 0x2E || byte === 0x5F || byte === 0x7E) result += String.fromCharCode(byte)
    else result += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return result
}

function pageDestination(pageIndex: number): PdfDestinationDef {
  return { kind: 'explicit', page: { kind: 'local', pageIndex }, fit: 'Fit', parameters: [] }
}

function findNamedDestination(
  destinations: PdfFragmentResolutionContext['namedDestinations'],
  name: string,
): { name: string, destination: PdfDestinationDef } {
  if (destinations !== undefined) {
    for (let i = 0; i < destinations.length; i++) if (destinations[i]!.name === name) return destinations[i]!
  }
  throw new Error(`PDF fragment named destination ${name} does not exist`)
}

function findStructureElement(
  elements: PdfFragmentResolutionContext['structureElements'],
  id: Uint8Array,
): { id: Uint8Array, index: number, pageIndex?: number } {
  if (elements !== undefined) {
    for (let i = 0; i < elements.length; i++) if (equalBytes(elements[i]!.id, id)) return elements[i]!
  }
  throw new Error('PDF fragment structure element does not exist')
}

function findAnnotation(
  annotations: PdfFragmentResolutionContext['annotations'],
  name: string,
  pageIndex: number,
): { name: string, index: number, pageIndex: number } {
  if (annotations !== undefined) {
    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i]!
      if (annotation.pageIndex === pageIndex && annotation.name === name) return annotation
    }
  }
  throw new Error(`PDF fragment annotation ${name} does not exist on page ${pageIndex + 1}`)
}

function findEmbeddedFile(
  files: PdfFragmentResolutionContext['embeddedFiles'],
  name: string,
): { name: string, index: number } {
  if (files !== undefined) {
    for (let i = 0; i < files.length; i++) if (files[i]!.name === name) return files[i]!
  }
  throw new Error(`PDF fragment embedded file ${name} does not exist`)
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
