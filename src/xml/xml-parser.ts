export type XmlContent = string | XmlElement

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlContent[]
}

interface MutableXmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlContent[]
}

function decodeXmlEntities(value: string): string {
  if (/&(?!#x[0-9a-fA-F]+;|#[0-9]+;|amp;|lt;|gt;|quot;|apos;)/.test(value)) {
    throw new Error('XML parse error: malformed entity reference')
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (_match, entity: string) {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const codePoint = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff || codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error('XML parse error: invalid character reference')
    }
    return String.fromCodePoint(codePoint)
  })
}

function xmlTagEnd(xml: string, start: number): number {
  let quote = ''
  for (let i = start; i < xml.length; i++) {
    const character = xml[i]!
    if (quote === '') {
      if (character === '"' || character === "'") quote = character
      else if (character === '>') return i
    } else if (character === quote) quote = ''
  }
  throw new Error('XML parse error: unterminated tag')
}

function parseXmlStartTag(source: string): { name: string, attributes: Record<string, string>, selfClosing: boolean } {
  const selfClosing = /\/\s*$/.test(source)
  const content = selfClosing ? source.replace(/\/\s*$/, '') : source
  const nameMatch = /^\s*([^\s/>]+)/.exec(content)
  if (nameMatch === null) throw new Error('XML parse error: missing element name')
  const name = nameMatch[1]!
  if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(name)) throw new Error(`XML parse error: invalid element name ${name}`)
  const attributes: Record<string, string> = {}
  let offset = nameMatch[0].length
  while (offset < content.length) {
    const whitespace = /^\s+/.exec(content.slice(offset))
    if (whitespace === null) throw new Error(`XML parse error: malformed attributes on ${name}`)
    offset += whitespace[0].length
    if (offset === content.length) break
    const attribute = /^([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/.exec(content.slice(offset))
    if (attribute === null) throw new Error(`XML parse error: malformed attribute on ${name}`)
    const attributeName = attribute[1]!
    if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(attributeName)) throw new Error(`XML parse error: invalid attribute name ${attributeName}`)
    if (attribute[3]!.includes('<')) throw new Error(`XML parse error: invalid attribute value on ${name}`)
    if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) throw new Error(`XML parse error: duplicate attribute ${attributeName}`)
    attributes[attributeName] = decodeXmlEntities(attribute[3]!)
    offset += attribute[0].length
  }
  return { name, attributes, selfClosing }
}

/** Parses a well-formed XML 1.0 document without resolving external entities or DTDs. */
export function parseXmlDocument(xml: string): XmlElement {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) throw new Error('XML parse error: invalid XML character')
  const container: MutableXmlElement = { name: '', attributes: {}, children: [] }
  const stack: MutableXmlElement[] = [container]
  let offset = xml.charCodeAt(0) === 0xfeff ? 1 : 0
  while (offset < xml.length) {
    const opening = xml.indexOf('<', offset)
    const textEnd = opening < 0 ? xml.length : opening
    if (textEnd > offset) stack[stack.length - 1]!.children.push(decodeXmlEntities(xml.slice(offset, textEnd)))
    if (opening < 0) break
    if (xml.startsWith('<!--', opening)) {
      const end = xml.indexOf('-->', opening + 4)
      if (end < 0 || xml.slice(opening + 4, end).includes('--')) throw new Error('XML parse error: malformed comment')
      offset = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', opening)) {
      const end = xml.indexOf(']]>', opening + 9)
      if (end < 0) throw new Error('XML parse error: unterminated CDATA')
      stack[stack.length - 1]!.children.push(xml.slice(opening + 9, end))
      offset = end + 3
      continue
    }
    if (xml.startsWith('<?', opening)) {
      const end = xml.indexOf('?>', opening + 2)
      if (end < 0) throw new Error('XML parse error: unterminated processing instruction')
      offset = end + 2
      continue
    }
    if (xml.startsWith('<!', opening)) throw new Error('XML parse error: declarations are not permitted')
    const end = xmlTagEnd(xml, opening + 1)
    if (xml[opening + 1] === '/') {
      const closingName = xml.slice(opening + 2, end).trim()
      if (stack.length === 1 || stack[stack.length - 1]!.name !== closingName) throw new Error('XML parse error: mismatched closing tag')
      stack.pop()
    } else {
      const parsed = parseXmlStartTag(xml.slice(opening + 1, end))
      const element: MutableXmlElement = { name: parsed.name, attributes: parsed.attributes, children: [] }
      stack[stack.length - 1]!.children.push(element)
      if (!parsed.selfClosing) stack.push(element)
    }
    offset = end + 1
  }
  if (stack.length !== 1) throw new Error('XML parse error: unclosed element')
  const roots = container.children.filter(function (child) { return typeof child !== 'string' || child.trim() !== '' })
  if (roots.length !== 1 || typeof roots[0] === 'string') throw new Error('XML parse error: document must contain one root element')
  validateXmlNamespaces(roots[0]!, new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]))
  return roots[0]!
}

function validateXmlNamespaces(element: XmlElement, inherited: ReadonlyMap<string, string>): void {
  const namespaces = new Map(inherited)
  for (const [name, value] of Object.entries(element.attributes)) {
    if (name === 'xmlns') {
      namespaces.set('', value)
    } else if (name.startsWith('xmlns:')) {
      const prefix = name.slice(6)
      if (!isXmlNcName(prefix) || prefix === 'xmlns' || value === '') throw new Error('XML parse error: invalid namespace declaration')
      if (prefix === 'xml' && value !== 'http://www.w3.org/XML/1998/namespace') throw new Error('XML parse error: xml prefix has an invalid namespace')
      if (value === 'http://www.w3.org/2000/xmlns/') throw new Error('XML parse error: xmlns namespace cannot be bound')
      namespaces.set(prefix, value)
    }
  }
  validateXmlQName(element.name, namespaces, false)
  const expandedAttributes = new Set<string>()
  for (const name of Object.keys(element.attributes)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue
    const expanded = validateXmlQName(name, namespaces, true)
    if (expandedAttributes.has(expanded)) throw new Error('XML parse error: duplicate expanded attribute name')
    expandedAttributes.add(expanded)
  }
  for (const child of element.children) if (typeof child !== 'string') validateXmlNamespaces(child, namespaces)
}

function validateXmlQName(name: string, namespaces: ReadonlyMap<string, string>, attribute: boolean): string {
  const parts = name.split(':')
  if (parts.length > 2 || parts.some(function (part) { return !isXmlNcName(part) })) throw new Error(`XML parse error: invalid qualified name ${name}`)
  if (parts.length === 1) return `${attribute ? '' : namespaces.get('') ?? ''}|${name}`
  const prefix = parts[0]!
  if (prefix === 'xmlns' || !namespaces.has(prefix)) throw new Error(`XML parse error: undeclared namespace prefix ${prefix}`)
  return `${namespaces.get(prefix)!}|${parts[1]!}`
}

function isXmlNcName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9._-]*$/.test(value)
}

export function xmlChildElements(element: XmlElement): XmlElement[] {
  return element.children.filter(function (child): child is XmlElement { return typeof child !== 'string' })
}

export function xmlTextContent(element: XmlElement): string {
  let result = ''
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]!
    result += typeof child === 'string' ? child : xmlTextContent(child)
  }
  return result
}
