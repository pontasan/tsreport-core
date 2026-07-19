import type { WoffMetadataContent, WoffMetadataDocument, WoffMetadataElement } from '../types/index.js'

interface MutableElement {
  name: string
  attributes: Record<string, string>
  children: WoffMetadataContent[]
}

function decodeEntities(value: string): string {
  if (/&(?!#x[0-9a-fA-F]+;|#[0-9]+;|amp;|lt;|gt;|quot;|apos;)/.test(value)) {
    throw new Error('WOFF metadata: malformed entity reference')
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (_match, entity: string) {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const codePoint = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff || codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error('WOFF metadata: invalid character reference')
    }
    return String.fromCodePoint(codePoint)
  })
}

function findTagEnd(xml: string, start: number): number {
  let quote = ''
  for (let i = start; i < xml.length; i++) {
    const character = xml[i]!
    if (quote === '') {
      if (character === '"' || character === "'") quote = character
      else if (character === '>') return i
    } else if (character === quote) quote = ''
  }
  throw new Error('WOFF metadata: unterminated tag')
}

function parseAttributes(source: string): { name: string; attributes: Record<string, string>; selfClosing: boolean } {
  const selfClosing = /\/\s*$/.test(source)
  const content = selfClosing ? source.replace(/\/\s*$/, '') : source
  const nameMatch = /^\s*([^\s/>]+)/.exec(content)
  if (nameMatch === null) throw new Error('WOFF metadata: missing element name')
  const name = nameMatch[1]!
  if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(name)) throw new Error(`WOFF metadata: invalid element name ${name}`)
  const attributes: Record<string, string> = {}
  let offset = nameMatch[0].length
  while (offset < content.length) {
    const whitespace = /^\s+/.exec(content.slice(offset))
    if (whitespace === null) throw new Error(`WOFF metadata: malformed attributes on ${name}`)
    offset += whitespace[0].length
    if (offset === content.length) break
    const attribute = /^([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/.exec(content.slice(offset))
    if (attribute === null) throw new Error(`WOFF metadata: malformed attribute on ${name}`)
    const attributeName = attribute[1]!
    if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(attributeName)) throw new Error(`WOFF metadata: invalid attribute name ${attributeName}`)
    if (attribute[3]!.includes('<')) throw new Error(`WOFF metadata: invalid attribute value on ${name}`)
    if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) throw new Error(`WOFF metadata: duplicate attribute ${attributeName}`)
    attributes[attributeName] = decodeEntities(attribute[3]!)
    offset += attribute[0].length
  }
  return { name, attributes, selfClosing }
}

function parseXml(xml: string): WoffMetadataElement {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) throw new Error('WOFF metadata: invalid XML character')
  const container: MutableElement = { name: '', attributes: {}, children: [] }
  const stack: MutableElement[] = [container]
  let offset = xml.charCodeAt(0) === 0xfeff ? 1 : 0
  while (offset < xml.length) {
    const opening = xml.indexOf('<', offset)
    const textEnd = opening < 0 ? xml.length : opening
    if (textEnd > offset) stack[stack.length - 1]!.children.push(decodeEntities(xml.slice(offset, textEnd)))
    if (opening < 0) { offset = xml.length; break }
    if (xml.startsWith('<!--', opening)) {
      const end = xml.indexOf('-->', opening + 4)
      if (end < 0 || xml.slice(opening + 4, end).includes('--')) throw new Error('WOFF metadata: malformed comment')
      offset = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', opening)) {
      const end = xml.indexOf(']]>', opening + 9)
      if (end < 0) throw new Error('WOFF metadata: unterminated CDATA')
      stack[stack.length - 1]!.children.push(xml.slice(opening + 9, end))
      offset = end + 3
      continue
    }
    if (xml.startsWith('<?', opening)) {
      const end = xml.indexOf('?>', opening + 2)
      if (end < 0) throw new Error('WOFF metadata: unterminated processing instruction')
      offset = end + 2
      continue
    }
    if (xml.startsWith('<!', opening)) throw new Error('WOFF metadata: declarations are not permitted')
    const end = findTagEnd(xml, opening + 1)
    if (xml[opening + 1] === '/') {
      const closingName = xml.slice(opening + 2, end).trim()
      if (stack.length === 1 || stack[stack.length - 1]!.name !== closingName) throw new Error('WOFF metadata: mismatched closing tag')
      stack.pop()
    } else {
      const parsed = parseAttributes(xml.slice(opening + 1, end))
      const element: MutableElement = { name: parsed.name, attributes: parsed.attributes, children: [] }
      stack[stack.length - 1]!.children.push(element)
      if (!parsed.selfClosing) stack.push(element)
    }
    offset = end + 1
  }
  if (stack.length !== 1) throw new Error('WOFF metadata: unclosed element')
  const roots = container.children.filter(function (child) { return typeof child !== 'string' || child.trim() !== '' })
  if (roots.length !== 1 || typeof roots[0] === 'string') throw new Error('WOFF metadata: document must contain one root element')
  return roots[0]!
}

function requireAttributes(element: WoffMetadataElement, required: readonly string[], optional: readonly string[]): void {
  for (let i = 0; i < required.length; i++) {
    if (element.attributes[required[i]!] === undefined) throw new Error(`WOFF metadata: ${element.name} requires ${required[i]}`)
  }
  const allowed = new Set([...required, ...optional])
  for (const name of Object.keys(element.attributes)) {
    if (!allowed.has(name)) throw new Error(`WOFF metadata: attribute ${name} is not allowed on ${element.name}`)
  }
  const direction = element.attributes.dir
  if (direction !== undefined && direction !== 'ltr' && direction !== 'rtl') throw new Error(`WOFF metadata: invalid direction on ${element.name}`)
}

function childElements(element: WoffMetadataElement): WoffMetadataElement[] {
  return element.children.filter(function (child): child is WoffMetadataElement { return typeof child !== 'string' })
}

function requireNoText(element: WoffMetadataElement): void {
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]!
    if (typeof child === 'string' && child.trim() === '') continue
    throw new Error(`WOFF metadata: ${element.name} must not contain text or child elements`)
  }
}

function requireNoDirectText(element: WoffMetadataElement): void {
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]!
    if (typeof child === 'string' && child.trim() !== '') {
      throw new Error(`WOFF metadata: direct text is not permitted in ${element.name}`)
    }
  }
}

function validateRichContent(element: WoffMetadataElement, kind: 'text' | 'div' | 'span'): void {
  requireAttributes(element, [], ['xml:lang', 'lang', 'dir', 'class'])
  if (element.attributes['xml:lang'] !== undefined && element.attributes.lang !== undefined) {
    throw new Error('WOFF metadata: text must not specify both lang and xml:lang')
  }
  const children = childElements(element)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (child.name !== 'span' && (child.name !== 'div' || kind === 'span')) throw new Error(`WOFF metadata: ${child.name} is not permitted in ${kind}`)
    validateRichContent(child, child.name as 'div' | 'span')
  }
}

function validatePlainLocalizedContent(element: WoffMetadataElement): void {
  requireAttributes(element, [], ['xml:lang', 'lang', 'dir', 'class'])
  if (element.attributes['xml:lang'] !== undefined && element.attributes.lang !== undefined) {
    throw new Error(`WOFF metadata: ${element.name} must not specify both lang and xml:lang`)
  }
  if (childElements(element).length !== 0) throw new Error(`WOFF metadata: ${element.name} only permits character data`)
}

function validateLocalized(element: WoffMetadataElement, allowEmpty: boolean, optionalAttributes: readonly string[]): void {
  requireAttributes(element, [], optionalAttributes)
  const children = childElements(element)
  if (!allowEmpty && children.length === 0) throw new Error(`WOFF metadata: ${element.name} requires text`)
  for (let i = 0; i < children.length; i++) {
    if (children[i]!.name !== 'text') throw new Error(`WOFF metadata: ${element.name} only permits text children`)
    validateRichContent(children[i]!, 'text')
  }
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]!
    if (typeof child === 'string' && child.trim() !== '') throw new Error(`WOFF metadata: direct text is not permitted in ${element.name}`)
  }
}

function validateExtension(element: WoffMetadataElement): void {
  requireAttributes(element, [], ['id'])
  requireNoDirectText(element)
  const children = childElements(element)
  const items = children.filter(function (child) { return child.name === 'item' })
  if (items.length === 0) throw new Error('WOFF metadata: extension requires an item')
  let sawItem = false
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (child.name === 'name') {
      if (sawItem) throw new Error('WOFF metadata: extension names must precede items')
      validatePlainLocalizedContent(child)
    } else if (child.name === 'item') {
      sawItem = true
      requireAttributes(child, [], ['id'])
      requireNoDirectText(child)
      const itemChildren = childElements(child)
      const names = itemChildren.filter(function (itemChild) { return itemChild.name === 'name' })
      const values = itemChildren.filter(function (itemChild) { return itemChild.name === 'value' })
      if (names.length === 0 || values.length === 0 || names.length + values.length !== itemChildren.length) {
        throw new Error('WOFF metadata: item requires name and value children')
      }
      let sawValue = false
      for (let j = 0; j < itemChildren.length; j++) {
        const itemChild = itemChildren[j]!
        if (itemChild.name === 'value') sawValue = true
        else if (sawValue) throw new Error('WOFF metadata: item names must precede values')
        validatePlainLocalizedContent(itemChild)
      }
    } else {
      throw new Error(`WOFF metadata: ${child.name} is not permitted in extension`)
    }
  }
}

/** Parses and validates the WOFF 1.0 extended metadata schema. */
export function parseWoffMetadata(xml: string): WoffMetadataDocument {
  const declaration = xml.match(/^\ufeff?<\?xml\s+([^?]+)\?>/)
  if (declaration !== null) {
    const encoding = declaration[1]!.match(/(?:^|\s)encoding\s*=\s*(["'])([^"']+)\1/i)
    if (encoding !== null && encoding[2]!.toLowerCase() !== 'utf-8') {
      throw new Error('WOFF metadata: XML encoding must be UTF-8')
    }
  }
  const root = parseXml(xml)
  if (root.name !== 'metadata') throw new Error('WOFF metadata: root element must be metadata')
  requireAttributes(root, ['version'], [])
  if (root.attributes.version !== '1.0') throw new Error('WOFF metadata: version must be 1.0')
  const counts = new Map<string, number>()
  const children = childElements(root)
  const allowed = new Set(['uniqueid', 'vendor', 'credits', 'description', 'license', 'copyright', 'trademark', 'licensee', 'extension'])
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (!allowed.has(child.name)) throw new Error(`WOFF metadata: ${child.name} is not permitted in metadata`)
    const count = (counts.get(child.name) ?? 0) + 1
    counts.set(child.name, count)
    if (child.name !== 'extension' && count > 1) throw new Error(`WOFF metadata: duplicate ${child.name}`)
    switch (child.name) {
      case 'uniqueid': requireAttributes(child, ['id'], []); requireNoText(child); break
      case 'vendor': requireAttributes(child, ['name'], ['url', 'dir', 'class']); requireNoText(child); break
      case 'credits': {
        requireAttributes(child, [], [])
        requireNoDirectText(child)
        const credits = childElements(child)
        if (credits.length === 0) throw new Error('WOFF metadata: credits requires a credit')
        for (let j = 0; j < credits.length; j++) {
          if (credits[j]!.name !== 'credit') throw new Error('WOFF metadata: credits only permits credit children')
          requireAttributes(credits[j]!, ['name'], ['url', 'role', 'dir', 'class'])
          requireNoText(credits[j]!)
        }
        break
      }
      case 'description': validateLocalized(child, false, ['url']); break
      case 'license': validateLocalized(child, true, ['url', 'id']); break
      case 'copyright':
      case 'trademark': validateLocalized(child, false, []); break
      case 'licensee': requireAttributes(child, ['name'], ['dir', 'class']); requireNoText(child); break
      case 'extension': validateExtension(child); break
    }
  }
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!
    if (typeof child === 'string' && child.trim() !== '') throw new Error('WOFF metadata: direct text is not permitted in metadata')
  }
  return { version: '1.0', root }
}

/** Selects localized WOFF metadata content using BCP 47 preference order. */
export function selectWoffMetadataLanguage(elements: readonly WoffMetadataElement[], preferredLanguages: readonly string[]): WoffMetadataElement | null {
  for (let i = 0; i < preferredLanguages.length; i++) {
    const preferred = preferredLanguages[i]!.toLowerCase()
    const exact = elements.find(function (element) { return (element.attributes['xml:lang'] ?? element.attributes.lang ?? '').toLowerCase() === preferred })
    if (exact !== undefined) return exact
    const primary = preferred.split('-')[0]!
    const compatible = elements.find(function (element) {
      const language = (element.attributes['xml:lang'] ?? element.attributes.lang ?? '').toLowerCase()
      return language === primary || language.startsWith(`${primary}-`)
    })
    if (compatible !== undefined) return compatible
  }
  return elements.find(function (element) { return element.attributes['xml:lang'] === undefined && element.attributes.lang === undefined }) ?? elements[0] ?? null
}
