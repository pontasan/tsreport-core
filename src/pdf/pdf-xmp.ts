import { isXmlNcName } from './xml-name.js'
import { parseXmlDocument, xmlChildElements, xmlTextContent, type XmlElement } from '../xml/xml-parser.js'
import { validateBcp47LanguageTag } from './language-tag.js'

export type PdfXmpPropertyValue =
  | string
  | number
  | boolean
  | Date
  | { kind: 'bag' | 'seq', items: string[] }
  | { kind: 'alt', items: Record<string, string> }

export interface PdfXmpProperty {
  namespaceUri: string
  prefix: string
  name: string
  value: PdfXmpPropertyValue
}

export interface PdfXmpExtensionProperty {
  name: string
  valueType: string
  category: 'internal' | 'external'
  description: string
}

export interface PdfXmpExtensionSchema {
  schema: string
  namespaceUri: string
  prefix: string
  properties: PdfXmpExtensionProperty[]
}

export interface PdfXmpMetadata {
  /** Additional typed XMP properties outside the synchronized Info fields. */
  properties?: PdfXmpProperty[]
  /** PDF/A extension-schema declarations for custom properties. */
  extensionSchemas?: PdfXmpExtensionSchema[]
  /** Exact UTF-8 XMP packet retained by import. Mutually exclusive with structured additions. */
  rawPacket?: Uint8Array
}

export interface ParsedPdfXmpMetadata {
  rawPacket: Uint8Array
  title?: string
  author?: string
  /** Number of rdf:li entries in dc:creator. */
  authorEntryCount: number
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modDate?: Date
  trapped?: boolean | 'unknown'
}

export interface PdfXmpSynchronizedFields {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modDate?: Date
  trapped?: boolean | 'unknown'
  xmp?: PdfXmpMetadata
}

const NS_DC = 'http://purl.org/dc/elements/1.1/'
const NS_XMP = 'http://ns.adobe.com/xap/1.0/'
const NS_PDF = 'http://ns.adobe.com/pdf/1.3/'
const NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const NS_PDFA_ID = 'http://www.aiim.org/pdfa/ns/id/'
const NS_PDFA_EXTENSION = 'http://www.aiim.org/pdfa/ns/extension/'
const NS_PDFA_SCHEMA = 'http://www.aiim.org/pdfa/ns/schema#'
const NS_PDFA_PROPERTY = 'http://www.aiim.org/pdfa/ns/property#'
const NS_PDFA_TYPE = 'http://www.aiim.org/pdfa/ns/type#'
const NS_PDFA_FIELD = 'http://www.aiim.org/pdfa/ns/field#'

export function buildPdfXmpPacket(
  metadata: PdfXmpSynchronizedFields,
  pdfaPart?: 1 | 2 | 3,
  pdfxVersion?: string,
): Uint8Array {
  const raw = metadata.xmp?.rawPacket
  if (raw !== undefined) {
    if (metadata.xmp?.properties !== undefined || metadata.xmp?.extensionSchemas !== undefined) {
      throw new Error('PDF XMP rawPacket is mutually exclusive with structured XMP additions')
    }
    const parsed = parsePdfXmpPacket(raw)
    validatePdfXmpSynchronization(metadata, parsed)
    return raw.slice()
  }

  validateStructuredXmp(metadata.xmp, pdfaPart)
  const lines: string[] = []
  lines.push('<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>')
  lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/">')
  lines.push(`<rdf:RDF xmlns:rdf="${NS_RDF}">`)
  const namespaceDeclarations = new Map<string, string>([
    ['dc', NS_DC], ['xmp', NS_XMP], ['pdf', NS_PDF],
    ['pdfaid', 'http://www.aiim.org/pdfa/ns/id/'],
    ['pdfxid', 'http://www.npes.org/pdfx/ns/id/'],
  ])
  const properties = metadata.xmp?.properties ?? []
  const schemas = metadata.xmp?.extensionSchemas ?? []
  for (let i = 0; i < properties.length; i++) addXmpNamespace(namespaceDeclarations, properties[i]!.prefix, properties[i]!.namespaceUri)
  if (schemas.length > 0) {
    namespaceDeclarations.set('pdfaExtension', 'http://www.aiim.org/pdfa/ns/extension/')
    namespaceDeclarations.set('pdfaSchema', 'http://www.aiim.org/pdfa/ns/schema#')
    namespaceDeclarations.set('pdfaProperty', 'http://www.aiim.org/pdfa/ns/property#')
    for (let i = 0; i < schemas.length; i++) addXmpNamespace(namespaceDeclarations, schemas[i]!.prefix, schemas[i]!.namespaceUri)
  }
  lines.push('<rdf:Description rdf:about=""')
  for (const [prefix, uri] of namespaceDeclarations) lines.push(`  xmlns:${prefix}="${xmlEscape(uri)}"`)
  lines[lines.length - 1] += '>'
  if (metadata.title !== undefined) lines.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.title)}</rdf:li></rdf:Alt></dc:title>`)
  if (metadata.author !== undefined) lines.push(`<dc:creator><rdf:Seq><rdf:li>${xmlEscape(metadata.author)}</rdf:li></rdf:Seq></dc:creator>`)
  if (metadata.subject !== undefined) lines.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.subject)}</rdf:li></rdf:Alt></dc:description>`)
  if (metadata.keywords !== undefined) lines.push(`<pdf:Keywords>${xmlEscape(metadata.keywords)}</pdf:Keywords>`)
  if (metadata.creator !== undefined) lines.push(`<xmp:CreatorTool>${xmlEscape(metadata.creator)}</xmp:CreatorTool>`)
  if (metadata.producer !== undefined) lines.push(`<pdf:Producer>${xmlEscape(metadata.producer)}</pdf:Producer>`)
  if (metadata.creationDate !== undefined) lines.push(`<xmp:CreateDate>${metadata.creationDate.toISOString()}</xmp:CreateDate>`)
  if (metadata.modDate !== undefined) lines.push(`<xmp:ModifyDate>${metadata.modDate.toISOString()}</xmp:ModifyDate>`)
  if (metadata.trapped !== undefined) lines.push(`<pdf:Trapped>${metadata.trapped === true ? 'True' : metadata.trapped === false ? 'False' : 'Unknown'}</pdf:Trapped>`)
  for (let i = 0; i < properties.length; i++) lines.push(xmpPropertyXml(properties[i]!))
  if (pdfaPart !== undefined) {
    lines.push(`<pdfaid:part>${pdfaPart}</pdfaid:part>`)
    lines.push('<pdfaid:conformance>B</pdfaid:conformance>')
  }
  if (pdfxVersion !== undefined) lines.push(`<pdfxid:GTS_PDFXVersion>${xmlEscape(pdfxVersion)}</pdfxid:GTS_PDFXVersion>`)
  if (schemas.length > 0) appendExtensionSchemas(lines, schemas)
  lines.push('</rdf:Description>')
  lines.push('</rdf:RDF>')
  lines.push('</x:xmpmeta>')
  for (let i = 0; i < 20; i++) lines.push('                                                                                ')
  lines.push('<?xpacket end="w"?>')
  return new TextEncoder().encode(lines.join('\n'))
}

export function parsePdfXmpPacket(bytes: Uint8Array): ParsedPdfXmpMetadata {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  parseXmlDocument(xml)
  if (!xml.includes('<?xpacket') || !/<[^>]*xmpmeta\b/.test(xml) || !/<[^>]*RDF\b/.test(xml)) {
    throw new Error('PDF XMP metadata must be a UTF-8 XMP packet containing RDF')
  }
  const namespaces = parseNamespacePrefixes(xml)
  const rdfPrefix = requireNamespacePrefix(namespaces, NS_RDF, 'RDF')
  const result: ParsedPdfXmpMetadata = { rawPacket: bytes.slice(), authorEntryCount: 0 }
  const dcPrefix = namespacePrefix(namespaces, NS_DC)
  const xmpPrefix = namespacePrefix(namespaces, NS_XMP)
  const pdfPrefix = namespacePrefix(namespaces, NS_PDF)
  if (dcPrefix !== undefined) {
    result.title = xmpAltValue(xml, dcPrefix, 'title', rdfPrefix)
    const author = xmpSequenceValue(xml, dcPrefix, 'creator', rdfPrefix)
    result.author = author.value
    result.authorEntryCount = author.count
    result.subject = xmpAltValue(xml, dcPrefix, 'description', rdfPrefix)
  }
  if (xmpPrefix !== undefined) {
    result.creator = xmpSimpleValue(xml, xmpPrefix, 'CreatorTool')
    result.creationDate = xmpDateValue(xml, xmpPrefix, 'CreateDate')
    result.modDate = xmpDateValue(xml, xmpPrefix, 'ModifyDate')
  }
  if (pdfPrefix !== undefined) {
    result.keywords = xmpSimpleValue(xml, pdfPrefix, 'Keywords')
    result.producer = xmpSimpleValue(xml, pdfPrefix, 'Producer')
    const trapped = xmpSimpleValue(xml, pdfPrefix, 'Trapped')
    if (trapped !== undefined) {
      if (trapped !== 'True' && trapped !== 'False' && trapped !== 'Unknown') throw new Error('PDF XMP pdf:Trapped has an invalid value')
      result.trapped = trapped === 'True' ? true : trapped === 'False' ? false : 'unknown'
    }
  }
  return result
}

/** Validates the PDF/A identification and extension-schema vocabulary in an XMP packet. */
export function validatePdfAXmpPacket(bytes: Uint8Array, part: 1 | 2 | 3): void {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const root = parseXmlDocument(xml)
  const namespaces = parseNamespacePrefixes(xml)
  if (namespaces.get('pdfaid') !== NS_PDFA_ID) {
    throw new Error(`PDF/A-${part} XMP identification requires the pdfaid prefix`)
  }
  const extensionElements = findXmlElements(root, 'pdfaExtension:schemas')
  const customNamespaces = collectCustomXmpNamespaces(root, namespaces)
  if (extensionElements.length === 0) {
    if (customNamespaces.size > 0) {
      throw new Error(`PDF/A-${part} custom XMP properties require an extension schema`)
    }
    return
  }
  if (extensionElements.length !== 1
    || namespaces.get('pdfaExtension') !== NS_PDFA_EXTENSION
    || namespaces.get('pdfaSchema') !== NS_PDFA_SCHEMA
    || namespaces.get('pdfaProperty') !== NS_PDFA_PROPERTY) {
    throw new Error(`PDF/A-${part} XMP extension schema uses invalid required prefixes`)
  }
  const declared = validatePdfAExtensionSchemaContainer(extensionElements[0]!, namespaces, part)
  for (const namespace of customNamespaces) {
    if (!declared.has(namespace)) {
      throw new Error(`PDF/A-${part} XMP namespace ${namespace} is missing from the extension schema`)
    }
  }
}

function validatePdfAExtensionSchemaContainer(
  container: XmlElement,
  namespaces: ReadonlyMap<string, string>,
  part: 1 | 2 | 3,
): Set<string> {
  const children = xmlChildElements(container)
  if (children.length !== 1 || children[0]!.name !== 'rdf:Bag') {
    throw new Error(`PDF/A-${part} pdfaExtension:schemas must contain one rdf:Bag`)
  }
  const schemas = xmlChildElements(children[0]!)
  if (schemas.length === 0) throw new Error(`PDF/A-${part} extension schema bag must not be empty`)
  const declared = new Set<string>()
  for (let index = 0; index < schemas.length; index++) {
    const resource = schemas[index]!
    if (resource.name !== 'rdf:li' || resource.attributes['rdf:parseType'] !== 'Resource') {
      throw new Error(`PDF/A-${part} extension schemas must be rdf:li resources`)
    }
    const fields = uniquePdfAXmpFields(resource, new Set([
      'pdfaSchema:schema', 'pdfaSchema:namespaceURI', 'pdfaSchema:prefix',
      'pdfaSchema:property', 'pdfaSchema:valueType',
    ]), `PDF/A-${part} extension schema`)
    const schemaName = requiredPdfAXmpText(fields, 'pdfaSchema:schema', part)
    const namespaceUri = requiredPdfAXmpText(fields, 'pdfaSchema:namespaceURI', part)
    const prefix = requiredPdfAXmpText(fields, 'pdfaSchema:prefix', part)
    if (schemaName === '' || namespaceUri === '' || !isXmlNcName(prefix) || namespaces.get(prefix) !== namespaceUri) {
      throw new Error(`PDF/A-${part} extension schema has invalid schema, namespaceURI, or prefix fields`)
    }
    if (declared.has(namespaceUri)) throw new Error(`PDF/A-${part} extension schema repeats namespace ${namespaceUri}`)
    declared.add(namespaceUri)
    const property = fields.get('pdfaSchema:property')
    if (property !== undefined) validatePdfAExtensionProperties(property, part)
    const valueType = fields.get('pdfaSchema:valueType')
    if (valueType !== undefined) validatePdfAExtensionValueTypes(valueType, namespaces, part)
  }
  return declared
}

function validatePdfAExtensionProperties(container: XmlElement, part: 1 | 2 | 3): void {
  const children = xmlChildElements(container)
  if (children.length !== 1 || children[0]!.name !== 'rdf:Seq') {
    throw new Error(`PDF/A-${part} pdfaSchema:property must contain one rdf:Seq`)
  }
  const names = new Set<string>()
  for (const resource of xmlChildElements(children[0]!)) {
    if (resource.name !== 'rdf:li' || resource.attributes['rdf:parseType'] !== 'Resource') {
      throw new Error(`PDF/A-${part} extension properties must be rdf:li resources`)
    }
    const fields = uniquePdfAXmpFields(resource, new Set([
      'pdfaProperty:name', 'pdfaProperty:valueType', 'pdfaProperty:category', 'pdfaProperty:description',
    ]), `PDF/A-${part} extension property`)
    const name = requiredPdfAXmpText(fields, 'pdfaProperty:name', part)
    const valueType = requiredPdfAXmpText(fields, 'pdfaProperty:valueType', part)
    const category = requiredPdfAXmpText(fields, 'pdfaProperty:category', part)
    const description = requiredPdfAXmpText(fields, 'pdfaProperty:description', part)
    if (!isXmlNcName(name) || valueType === '' || description === '' || category !== 'internal' && category !== 'external') {
      throw new Error(`PDF/A-${part} extension property has invalid required fields`)
    }
    if (names.has(name)) throw new Error(`PDF/A-${part} extension schema repeats property ${name}`)
    names.add(name)
  }
}

function validatePdfAExtensionValueTypes(
  container: XmlElement,
  namespaces: ReadonlyMap<string, string>,
  part: 1 | 2 | 3,
): void {
  if (namespaces.get('pdfaType') !== NS_PDFA_TYPE) {
    throw new Error(`PDF/A-${part} extension value types require the pdfaType prefix`)
  }
  const children = xmlChildElements(container)
  if (children.length !== 1 || children[0]!.name !== 'rdf:Seq') {
    throw new Error(`PDF/A-${part} pdfaSchema:valueType must contain one rdf:Seq`)
  }
  for (const resource of xmlChildElements(children[0]!)) {
    const fields = uniquePdfAXmpFields(resource, new Set([
      'pdfaType:type', 'pdfaType:namespaceURI', 'pdfaType:prefix', 'pdfaType:description', 'pdfaType:field',
    ]), `PDF/A-${part} extension value type`)
    const namespaceUri = requiredPdfAXmpText(fields, 'pdfaType:namespaceURI', part)
    const prefix = requiredPdfAXmpText(fields, 'pdfaType:prefix', part)
    if (requiredPdfAXmpText(fields, 'pdfaType:type', part) === ''
      || requiredPdfAXmpText(fields, 'pdfaType:description', part) === ''
      || !isXmlNcName(prefix) || namespaces.get(prefix) !== namespaceUri) {
      throw new Error(`PDF/A-${part} extension value type has invalid required fields`)
    }
    const field = fields.get('pdfaType:field')
    if (field !== undefined) validatePdfAExtensionFields(field, namespaces, part)
  }
}

function validatePdfAExtensionFields(
  container: XmlElement,
  namespaces: ReadonlyMap<string, string>,
  part: 1 | 2 | 3,
): void {
  if (namespaces.get('pdfaField') !== NS_PDFA_FIELD) {
    throw new Error(`PDF/A-${part} extension fields require the pdfaField prefix`)
  }
  const children = xmlChildElements(container)
  if (children.length !== 1 || children[0]!.name !== 'rdf:Seq') {
    throw new Error(`PDF/A-${part} pdfaType:field must contain one rdf:Seq`)
  }
  for (const resource of xmlChildElements(children[0]!)) {
    const fields = uniquePdfAXmpFields(resource, new Set([
      'pdfaField:name', 'pdfaField:valueType', 'pdfaField:description',
    ]), `PDF/A-${part} extension field`)
    if (!isXmlNcName(requiredPdfAXmpText(fields, 'pdfaField:name', part))
      || requiredPdfAXmpText(fields, 'pdfaField:valueType', part) === ''
      || requiredPdfAXmpText(fields, 'pdfaField:description', part) === '') {
      throw new Error(`PDF/A-${part} extension field has invalid required fields`)
    }
  }
}

function uniquePdfAXmpFields(element: XmlElement, allowed: ReadonlySet<string>, context: string): Map<string, XmlElement> {
  const fields = new Map<string, XmlElement>()
  for (const child of xmlChildElements(element)) {
    if (!allowed.has(child.name)) throw new Error(`${context} contains undefined field ${child.name}`)
    if (fields.has(child.name)) throw new Error(`${context} repeats field ${child.name}`)
    fields.set(child.name, child)
  }
  return fields
}

function requiredPdfAXmpText(fields: ReadonlyMap<string, XmlElement>, name: string, part: 1 | 2 | 3): string {
  const element = fields.get(name)
  if (element === undefined || xmlChildElements(element).length !== 0) {
    throw new Error(`PDF/A-${part} extension schema requires text field ${name}`)
  }
  return xmlTextContent(element).trim()
}

function collectCustomXmpNamespaces(root: XmlElement, namespaces: ReadonlyMap<string, string>): Set<string> {
  const result = new Set<string>()
  const visit = function (element: XmlElement): void {
    const separator = element.name.indexOf(':')
    if (separator > 0) addCustomXmpNamespace(result, namespaces.get(element.name.slice(0, separator)))
    for (const name of Object.keys(element.attributes)) {
      const attributeSeparator = name.indexOf(':')
      if (attributeSeparator > 0 && !name.startsWith('xmlns:')) {
        addCustomXmpNamespace(result, namespaces.get(name.slice(0, attributeSeparator)))
      }
    }
    for (const child of xmlChildElements(element)) visit(child)
  }
  visit(root)
  return result
}

function addCustomXmpNamespace(result: Set<string>, namespace: string | undefined): void {
  if (namespace === undefined || isPredefinedXmpNamespace(namespace)) return
  result.add(namespace)
}

function isPredefinedXmpNamespace(namespace: string): boolean {
  return namespace === NS_RDF || namespace === NS_DC || namespace === NS_XMP || namespace === NS_PDF
    || namespace === NS_PDFA_ID || namespace === NS_PDFA_EXTENSION || namespace === NS_PDFA_SCHEMA
    || namespace === NS_PDFA_PROPERTY || namespace === NS_PDFA_TYPE || namespace === NS_PDFA_FIELD
    || namespace === 'adobe:ns:meta/' || namespace === 'http://www.w3.org/XML/1998/namespace'
    || namespace.startsWith('http://ns.adobe.com/') || namespace.startsWith('http://www.npes.org/pdfx/ns/')
    || namespace.startsWith('http://iptc.org/std/')
}

function findXmlElements(root: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = []
  const visit = function (element: XmlElement): void {
    if (element.name === name) result.push(element)
    for (const child of xmlChildElements(element)) visit(child)
  }
  visit(root)
  return result
}

export function validatePdfXmpSynchronization(metadata: PdfXmpSynchronizedFields, xmp: ParsedPdfXmpMetadata): void {
  compareSynchronizedString('Title', metadata.title, xmp.title)
  compareSynchronizedString('Author', metadata.author, xmp.author)
  compareSynchronizedString('Subject', metadata.subject, xmp.subject)
  compareSynchronizedString('Keywords', metadata.keywords, xmp.keywords)
  compareSynchronizedString('Creator', metadata.creator, xmp.creator)
  compareSynchronizedString('Producer', metadata.producer, xmp.producer)
  compareSynchronizedDate('CreationDate', metadata.creationDate, xmp.creationDate)
  compareSynchronizedDate('ModDate', metadata.modDate, xmp.modDate)
  if (metadata.trapped !== undefined && (xmp.trapped === undefined || metadata.trapped !== xmp.trapped)) {
    throw new Error('PDF Info Trapped and XMP pdf:Trapped are not synchronized')
  }
}

function validateStructuredXmp(xmp: PdfXmpMetadata | undefined, pdfaPart: 1 | 2 | 3 | undefined): void {
  if (xmp === undefined) return
  const properties = xmp.properties ?? []
  const schemas = xmp.extensionSchemas ?? []
  const schemaUris = new Set<string>()
  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i]!
    validateXmpNamespace(schema.prefix, schema.namespaceUri)
    if (schema.schema === '' || schema.properties.length === 0) throw new Error('PDF XMP extension schema requires a name and properties')
    if (schemaUris.has(schema.namespaceUri)) throw new Error(`Duplicate PDF XMP extension schema namespace: ${schema.namespaceUri}`)
    schemaUris.add(schema.namespaceUri)
    const propertyNames = new Set<string>()
    for (let k = 0; k < schema.properties.length; k++) {
      const property = schema.properties[k]!
      if (!isXmlNcName(property.name) || property.valueType === '' || property.description === '') throw new Error('Invalid PDF XMP extension property definition')
      if (propertyNames.has(property.name)) throw new Error(`Duplicate PDF XMP extension property: ${property.name}`)
      propertyNames.add(property.name)
    }
  }
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i]!
    validateXmpNamespace(property.prefix, property.namespaceUri)
    if (!isXmlNcName(property.name)) throw new Error(`Invalid PDF XMP property name: ${property.name}`)
    if (pdfaPart !== undefined && !isStandardXmpNamespace(property.namespaceUri) && !schemaUris.has(property.namespaceUri)) {
      throw new Error(`PDF/A-${pdfaPart} custom XMP property requires an extension schema: ${property.prefix}:${property.name}`)
    }
  }
}

function validateXmpNamespace(prefix: string, namespaceUri: string): void {
  if (!isXmlNcName(prefix) || prefix === 'xml' || prefix === 'xmlns') throw new Error(`Invalid PDF XMP namespace prefix: ${prefix}`)
  if (namespaceUri === '') throw new Error('PDF XMP namespace URI must not be empty')
}

function isStandardXmpNamespace(uri: string): boolean {
  return uri === NS_DC || uri === NS_XMP || uri === NS_PDF
}

function addXmpNamespace(namespaces: Map<string, string>, prefix: string, uri: string): void {
  const existing = namespaces.get(prefix)
  if (existing !== undefined && existing !== uri) throw new Error(`PDF XMP prefix ${prefix} maps to two namespaces`)
  namespaces.set(prefix, uri)
}

function xmpPropertyXml(property: PdfXmpProperty): string {
  const name = `${property.prefix}:${property.name}`
  const value = property.value
  if (typeof value === 'string') return `<${name}>${xmlEscape(value)}</${name}>`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`PDF XMP property ${name} number must be finite`)
    return `<${name}>${value}</${name}>`
  }
  if (typeof value === 'boolean') return `<${name}>${value ? 'True' : 'False'}</${name}>`
  if (value instanceof Date) return `<${name}>${value.toISOString()}</${name}>`
  if (value.kind === 'bag' || value.kind === 'seq') {
    const container = value.kind === 'bag' ? 'Bag' : 'Seq'
    return `<${name}><rdf:${container}>${value.items.map(function (item) { return `<rdf:li>${xmlEscape(item)}</rdf:li>` }).join('')}</rdf:${container}></${name}>`
  }
  const alternatives = value.items as Record<string, string>
  const languages = Object.keys(alternatives)
  if (languages.length === 0) throw new Error(`PDF XMP property ${name} language alternative must not be empty`)
  for (let i = 0; i < languages.length; i++) validateBcp47LanguageTag(languages[i]!, `PDF XMP property ${name} xml:lang`)
  return `<${name}><rdf:Alt>${languages.map(function (language) { return `<rdf:li xml:lang="${xmlEscape(language)}">${xmlEscape(alternatives[language]!)}</rdf:li>` }).join('')}</rdf:Alt></${name}>`
}

function appendExtensionSchemas(lines: string[], schemas: PdfXmpExtensionSchema[]): void {
  lines.push('<pdfaExtension:schemas><rdf:Bag>')
  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i]!
    lines.push('<rdf:li rdf:parseType="Resource">')
    lines.push(`<pdfaSchema:schema>${xmlEscape(schema.schema)}</pdfaSchema:schema>`)
    lines.push(`<pdfaSchema:namespaceURI>${xmlEscape(schema.namespaceUri)}</pdfaSchema:namespaceURI>`)
    lines.push(`<pdfaSchema:prefix>${xmlEscape(schema.prefix)}</pdfaSchema:prefix>`)
    lines.push('<pdfaSchema:property><rdf:Seq>')
    for (let k = 0; k < schema.properties.length; k++) {
      const property = schema.properties[k]!
      lines.push('<rdf:li rdf:parseType="Resource">')
      lines.push(`<pdfaProperty:name>${xmlEscape(property.name)}</pdfaProperty:name>`)
      lines.push(`<pdfaProperty:valueType>${xmlEscape(property.valueType)}</pdfaProperty:valueType>`)
      lines.push(`<pdfaProperty:category>${property.category}</pdfaProperty:category>`)
      lines.push(`<pdfaProperty:description>${xmlEscape(property.description)}</pdfaProperty:description>`)
      lines.push('</rdf:li>')
    }
    lines.push('</rdf:Seq></pdfaSchema:property>')
    lines.push('</rdf:li>')
  }
  lines.push('</rdf:Bag></pdfaExtension:schemas>')
}

function parseNamespacePrefixes(xml: string): Map<string, string> {
  const result = new Map<string, string>()
  const pattern = /\bxmlns:([A-Za-z_][A-Za-z0-9._-]*)\s*=\s*(["'])(.*?)\2/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const prefix = match[1]!
    const uri = decodeXmlEntities(match[3]!)
    const existing = result.get(prefix)
    if (existing !== undefined && existing !== uri) throw new Error(`PDF XMP prefix ${prefix} maps to two namespaces`)
    result.set(prefix, uri)
  }
  return result
}

function requireNamespacePrefix(namespaces: Map<string, string>, uri: string, label: string): string {
  const prefix = namespacePrefix(namespaces, uri)
  if (prefix === undefined) throw new Error(`PDF XMP metadata is missing the ${label} namespace`)
  return prefix
}

function namespacePrefix(namespaces: Map<string, string>, uri: string): string | undefined {
  for (const [prefix, value] of namespaces) if (value === uri) return prefix
  return undefined
}

function xmpSimpleValue(xml: string, prefix: string, localName: string): string | undefined {
  const body = xmpElementBody(xml, prefix, localName)
  if (body === undefined) return undefined
  if (/<[A-Za-z_]/.test(body)) throw new Error(`PDF XMP ${prefix}:${localName} must be a simple value`)
  return decodeXmlEntities(body.trim())
}

function xmpAltValue(xml: string, prefix: string, localName: string, rdfPrefix: string): string | undefined {
  const body = xmpElementBody(xml, prefix, localName)
  if (body === undefined) return undefined
  const liPattern = new RegExp(`<${escapeRegex(rdfPrefix)}:li\\b([^>]*)>([\\s\\S]*?)<\\/${escapeRegex(rdfPrefix)}:li>`, 'g')
  let first: string | undefined
  let match: RegExpExecArray | null
  while ((match = liPattern.exec(body)) !== null) {
    const value = decodeXmlEntities(match[2]!.trim())
    if (first === undefined) first = value
    if (/\bxml:lang\s*=\s*(["'])x-default\1/.test(match[1]!)) return value
  }
  return first
}

function xmpSequenceValue(
  xml: string,
  prefix: string,
  localName: string,
  rdfPrefix: string,
): { value: string | undefined; count: number } {
  const body = xmpElementBody(xml, prefix, localName)
  if (body === undefined) return { value: undefined, count: 0 }
  const pattern = new RegExp(`<${escapeRegex(rdfPrefix)}:li\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(rdfPrefix)}:li>`, 'g')
  let value: string | undefined
  let count = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    if (value === undefined) value = decodeXmlEntities(match[1]!.trim())
    count++
  }
  return { value, count }
}

function xmpDateValue(xml: string, prefix: string, localName: string): Date | undefined {
  const value = xmpSimpleValue(xml, prefix, localName)
  if (value === undefined) return undefined
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})$/.test(value)) throw new Error(`PDF XMP ${prefix}:${localName} is not an ISO 8601 date`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`PDF XMP ${prefix}:${localName} is not a valid date`)
  return date
}

function xmpElementBody(xml: string, prefix: string, localName: string): string | undefined {
  const qualifiedName = `${escapeRegex(prefix)}:${escapeRegex(localName)}`
  const pattern = new RegExp(`<${qualifiedName}\\b[^>]*>([\\s\\S]*?)<\\/${qualifiedName}>`, 'g')
  const first = pattern.exec(xml)
  if (first === null) return undefined
  if (pattern.exec(xml) !== null) throw new Error(`PDF XMP property ${prefix}:${localName} occurs more than once`)
  return first[1]!
}

function compareSynchronizedString(label: string, info: string | undefined, xmp: string | undefined): void {
  if (info !== undefined && (xmp === undefined || info !== xmp)) throw new Error(`PDF Info ${label} and XMP are not synchronized`)
}

function compareSynchronizedDate(label: string, info: Date | undefined, xmp: Date | undefined): void {
  if (info !== undefined && (xmp === undefined || Math.trunc(info.getTime() / 1000) !== Math.trunc(xmp.getTime() / 1000))) {
    throw new Error(`PDF Info ${label} and XMP are not synchronized`)
  }
}

function decodeXmlEntities(value: string): string {
  if (/&(?!#x[0-9a-fA-F]+;|#[0-9]+;|amp;|lt;|gt;|quot;|apos;)/.test(value)) throw new Error('PDF XMP metadata contains a malformed entity')
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (_match, entity: string) {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const codePoint = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    if (codePoint === 0 || codePoint > 0x10FFFF || codePoint >= 0xD800 && codePoint <= 0xDFFF) throw new Error('PDF XMP metadata contains an invalid character reference')
    return String.fromCodePoint(codePoint)
  })
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
