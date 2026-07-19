import type { PdfRawValueDef } from '../types/template.js'

export type PdfSpecificationVersion = '1.0' | '1.1' | '1.2' | '1.3' | '1.4' | '1.5' | '1.6' | '1.7' | '2.0'

/** One entry in a Catalog /Extensions developer-prefix dictionary. */
export interface PdfDeveloperExtension {
  /** PDF specification version extended by this entry. */
  baseVersion: PdfSpecificationVersion
  /** Developer-defined, monotonically increasing level for a given base version. */
  extensionLevel: number
  /** Revision identifier used by ISO extension specifications. */
  extensionRevision?: string
  /** Public documentation URL for the extension. */
  url?: string
  /** Extension-specific entries not owned by the standard dictionary model. */
  entries?: Record<string, PdfRawValueDef>
}

/** Prefix name to one extension, or the ISO_ array of standardized extensions. */
export type PdfDeveloperExtensions = Record<string, PdfDeveloperExtension | PdfDeveloperExtension[]>

export type PdfNameClass = 'first' | 'second' | 'third'

/** Classifies a PDF name according to Annex E's reserved prefix syntax. */
export function classifyPdfName(name: string): PdfNameClass {
  validatePdfNameText(name, 'PDF extension name')
  if (name.startsWith('XX')) return 'third'
  if ((name.length > 3 && (name[3] === '_' || name[3] === ':'))
    || (name.length > 4 && (name[4] === '_' || name[4] === ':'))) return 'second'
  return 'first'
}

/** Validates a second-class name against the registered prefix that owns it. */
export function validatePdfSecondClassName(name: string, registeredPrefix: string): void {
  validatePdfDeveloperPrefix(registeredPrefix)
  const prefix = normalizedDeveloperPrefix(registeredPrefix)
  if (prefix.length !== 3 && prefix.length !== 4) {
    throw new Error('PDF second-class registered prefixes must contain three or four characters')
  }
  if (name !== `${prefix}_${name.slice(prefix.length + 1)}` && name !== `${prefix}:${name.slice(prefix.length + 1)}`) {
    throw new Error(`PDF second-class name must begin with ${prefix}_ or ${prefix}:`)
  }
  if (name.length === prefix.length + 1 || classifyPdfName(name) !== 'second') {
    throw new Error(`PDF second-class name requires content after its registered prefix: ${name}`)
  }
}

/** Validates the Annex E prefix reserved for third-class internal data. */
export function validatePdfThirdClassName(name: string): void {
  validatePdfNameText(name, 'PDF third-class name')
  if (name.length === 2 || !name.startsWith('XX') || classifyPdfName(name) !== 'third') {
    throw new Error(`PDF third-class names must begin with XX and contain a suffix: ${name}`)
  }
}

export function validatePdfDeveloperExtensions(extensions: PdfDeveloperExtensions): void {
  const prefixes = Object.keys(extensions)
  if (prefixes.length === 0) throw new Error('PDF Extensions dictionary must contain at least one developer prefix')
  for (let p = 0; p < prefixes.length; p++) {
    const prefix = prefixes[p]!
    validatePdfDeveloperPrefix(prefix)
    const value = extensions[prefix]!
    const records = Array.isArray(value) ? value : [value]
    if (records.length === 0) throw new Error(`PDF developer extension ${prefix} must not be an empty array`)
    if (Array.isArray(value) && prefix !== 'ISO_') {
      throw new Error('PDF arrays of developer extensions are reserved for the ISO_ prefix')
    }
    const previousLevels = new Map<PdfSpecificationVersion, number>()
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      validatePdfDeveloperExtensionRecord(prefix, record)
      const previous = previousLevels.get(record.baseVersion)
      if (previous !== undefined && record.extensionLevel <= previous) {
        throw new Error(`PDF developer extension levels for ${prefix} base ${record.baseVersion} must increase`)
      }
      previousLevels.set(record.baseVersion, record.extensionLevel)
    }
  }
}

export function requiredPdfVersionForExtensions(extensions: PdfDeveloperExtensions | undefined): PdfSpecificationVersion {
  if (extensions === undefined) return '1.0'
  validatePdfDeveloperExtensions(extensions)
  let version: PdfSpecificationVersion = '1.0'
  const prefixes = Object.keys(extensions)
  for (let p = 0; p < prefixes.length; p++) {
    const value = extensions[prefixes[p]!]!
    const records = Array.isArray(value) ? value : [value]
    for (let i = 0; i < records.length; i++) {
      if (comparePdfSpecificationVersions(records[i]!.baseVersion, version) > 0) version = records[i]!.baseVersion
    }
  }
  return version
}

export function comparePdfSpecificationVersions(a: string, b: string): number {
  const av = parsePdfSpecificationVersion(a)
  const bv = parsePdfSpecificationVersion(b)
  return av[0] === bv[0] ? av[1] - bv[1] : av[0] - bv[0]
}

function validatePdfDeveloperExtensionRecord(prefix: string, record: PdfDeveloperExtension): void {
  parsePdfSpecificationVersion(record.baseVersion)
  if (!Number.isSafeInteger(record.extensionLevel) || record.extensionLevel < 0) {
    throw new Error(`PDF developer extension ${prefix} ExtensionLevel must be a non-negative safe integer`)
  }
  if (record.entries !== undefined) {
    const reserved = ['Type', 'BaseVersion', 'ExtensionLevel', 'ExtensionRevision', 'URL']
    for (let i = 0; i < reserved.length; i++) {
      if (record.entries[reserved[i]!] !== undefined) {
        throw new Error(`PDF developer extension custom entries must not redefine /${reserved[i]}`)
      }
    }
  }
  if (prefix === 'ISO_') {
    if (record.baseVersion !== '2.0') throw new Error('PDF ISO_ extensions require BaseVersion 2.0')
    if (record.extensionLevel === 0) throw new Error('PDF ISO_ ExtensionLevel must be an ISO document number')
    if (record.extensionRevision === undefined || !/^\d*:\d{4}$/.test(record.extensionRevision)) {
      throw new Error('PDF ISO_ ExtensionRevision must have the form <part>:<year> or :<year>')
    }
    if (record.url === undefined || !/^https:\/\/www\.iso\.org\//.test(record.url)) {
      throw new Error('PDF ISO_ extension URL must identify a page on https://www.iso.org/')
    }
  }
}

function validatePdfDeveloperPrefix(prefix: string): void {
  validatePdfNameText(prefix, 'PDF developer extension prefix')
  if (prefix === 'Type') throw new Error('PDF developer extension prefix must not be Type')
  const normalized = normalizedDeveloperPrefix(prefix)
  if (!/^[A-Za-z0-9]{2,4}$/.test(normalized)) {
    throw new Error(`PDF developer extension prefix must be a two-to-four character registered prefix: ${prefix}`)
  }
  if (prefix !== normalized && prefix !== `${normalized}_`) {
    throw new Error(`PDF developer extension prefix has invalid syntax: ${prefix}`)
  }
}

function normalizedDeveloperPrefix(prefix: string): string {
  return prefix.endsWith('_') ? prefix.slice(0, -1) : prefix
}

function validatePdfNameText(name: string, label: string): void {
  if (name.length === 0 || name.includes('\0')) throw new Error(`${label} must be a non-empty PDF name`)
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xff) throw new Error(`${label} must contain only PDF name bytes`)
  }
}

function parsePdfSpecificationVersion(version: string): [number, number] {
  const match = /^(\d+)\.(\d+)$/.exec(version)
  if (match === null) throw new Error(`Invalid PDF specification version: ${version}`)
  const major = Number(match[1])
  const minor = Number(match[2])
  if ((major === 1 && minor >= 0 && minor <= 7) || (major === 2 && minor === 0)) return [major, minor]
  throw new Error(`Unsupported PDF specification version: ${version}`)
}
