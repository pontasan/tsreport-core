/**
 * SVG parser
 *
 * Parses an SVG XML string / Uint8Array into an SvgDocument.
 * No external dependencies. A lightweight XML parser extracts the elements
 * and attributes needed for SVG.
 *
 * Supported elements: svg, g, path, rect, circle, ellipse, line, polyline, polygon,
 *           text, tspan, image, defs, use, clipPath, linearGradient,
 *           radialGradient, stop, style
 */

import type {
  SvgDocument, SvgNode, SvgDefs, SvgStyle, SvgPaint, SvgColor,
  SvgMatrix, SvgGradient, SvgGradientStop, SvgClipPath, SvgFilter,
  SvgDropShadowFilter, SvgFilterGraph, SvgFilterPrimitive,
  SvgGroup, SvgPath, SvgRect, SvgCircle, SvgEllipse,
  SvgLine, SvgPolyline, SvgPolygon, SvgText, SvgImage, SvgPattern,
} from './svg-types.js'
import { parseSvgPath } from './svg-path-parser.js'

// ─── Public API ───

/**
 * Parses SVG into an SvgDocument
 * @param input SVG string or UTF-8 Uint8Array
 */
export function parseSvg(input: string | Uint8Array): SvgDocument {
  const xml = typeof input === 'string' ? input : new TextDecoder().decode(input)
  const root = parseXml(xml)
  const svgEl = findElement(root, 'svg')
  if (!svgEl) throw new Error('SVG: <svg> element not found')

  const defs: SvgDefs = {
    gradients: new Map(),
    clipPaths: new Map(),
    patterns: new Map(),
    masks: new Map(),
    markers: new Map(),
    filters: new Map(),
    references: new Map(),
  }

  // Parse CSS <style> elements first
  const styleRules = parseStyleElements(svgEl)

  // viewBox / width / height
  const vb = parseViewBox(svgEl.attrs.get('viewBox') ?? '')
  const w = parseLengthAttr(svgEl.attrs.get('width'), vb?.width ?? 300)
  const h = parseLengthAttr(svgEl.attrs.get('height'), vb?.height ?? 150)
  const viewBox = vb ?? { x: 0, y: 0, width: w, height: h }
  const preserveAspectRatio = (svgEl.attrs.get('preserveAspectRatio') ?? 'xMidYMid meet').trim() || 'xMidYMid meet'
  const viewport = { width: viewBox.width, height: viewBox.height }
  const rootStyle = resolveStyle(svgEl, styleRules)

  // Build a map of all IDs for use elements
  const idMap = new Map<string, XmlElement>()
  buildIdMap(svgEl, idMap)

  // Parse definitions after all fragment targets are known.
  collectDefs(svgEl, defs, styleRules, idMap, viewport)
  collectGraphicalReferences(idMap, defs, styleRules, viewport)

  const children = parseChildren(svgEl, defs, styleRules, idMap, viewport)

  return {
    rootId: svgEl.attrs.get('id'),
    width: w,
    height: h,
    hasExplicitWidth: svgEl.attrs.has('width'),
    hasExplicitHeight: svgEl.attrs.has('height'),
    widthPercentage: parseRootPercentage(svgEl.attrs.get('width')),
    heightPercentage: parseRootPercentage(svgEl.attrs.get('height')),
    viewBox,
    hasExplicitViewBox: vb !== null,
    preserveAspectRatio,
    rootStyle,
    children,
    defs,
  }
}

function parseRootPercentage(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim().endsWith('%')) return undefined
  const percentage = Number.parseFloat(value)
  if (!Number.isFinite(percentage) || percentage < 0) throw new Error(`Invalid SVG root percentage length "${value}"`)
  return percentage / 100
}

/** Parses the restricted SVG 1.1 profile used by the OpenType SVG table. */
export function parseOpenTypeSvg(input: string | Uint8Array): SvgDocument {
  const xml = typeof input === 'string' ? input : new TextDecoder().decode(input)
  const root = parseXml(xml)
  const svg = findElement(root, 'svg')
  if (!svg || svg.attrs.get('xmlns') !== 'http://www.w3.org/2000/svg') {
    throw new Error('OpenType SVG document must declare the SVG namespace as the default namespace')
  }
  validateOpenTypeSvgNamespaces(svg, svg)
  stripRestrictedOpenTypeElements(svg)
  return parseSvg(serializeXmlElement(svg))
}

/** Rewrites designated glyph element IDs for compact OpenType subsetting. */
export function remapOpenTypeSvgGlyphIds(
  input: string,
  oldToNew: ReadonlyMap<number, number>,
  paletteEntryMap?: ReadonlyMap<number, number>,
): Uint8Array {
  const root = parseXml(input)
  const svg = findElement(root, 'svg')
  if (!svg) throw new Error('OpenType SVG document does not contain an svg root element')
  pruneUnreferencedOpenTypeGlyphElements(svg, oldToNew)
  remapOpenTypeSvgElement(svg, oldToNew)
  if (paletteEntryMap !== undefined) remapOpenTypeSvgPaletteVariables(svg, paletteEntryMap)
  return new TextEncoder().encode(serializeXmlElement(svg))
}

function remapOpenTypeSvgPaletteVariables(element: XmlElement, paletteEntryMap: ReadonlyMap<number, number>): void {
  for (const [name, value] of element.attrs) element.attrs.set(name, remapSvgPaletteVariables(value, paletteEntryMap))
  if (element.text.length > 0) element.text = remapSvgPaletteVariables(element.text, paletteEntryMap)
  for (let i = 0; i < element.children.length; i++) remapOpenTypeSvgPaletteVariables(element.children[i]!, paletteEntryMap)
}

function remapSvgPaletteVariables(value: string, paletteEntryMap: ReadonlyMap<number, number>): string {
  return value.replace(/--color([0-9]+)/g, function (match, digits: string) {
    const mapped = paletteEntryMap.get(Number.parseInt(digits, 10))
    if (mapped === undefined) throw new Error(`OpenType SVG references omitted CPAL entry ${digits}`)
    return `--color${mapped}`
  })
}

function pruneUnreferencedOpenTypeGlyphElements(
  svg: XmlElement,
  oldToNew: ReadonlyMap<number, number>,
): void {
  const elementsById = new Map<string, XmlElement>()
  const selected: XmlElement[] = []
  let hasDesignatedGlyphs = false
  collectOpenTypeSvgElements(svg, oldToNew, elementsById, selected, function () { hasDesignatedGlyphs = true })
  if (!hasDesignatedGlyphs) return

  const retained = new Set<XmlElement>()
  const pending = selected.slice()
  while (pending.length > 0) {
    const element = pending.pop()!
    if (retained.has(element)) continue
    retained.add(element)
    for (let i = 0; i < element.children.length; i++) pending.push(element.children[i]!)
    for (const value of element.attrs.values()) {
      const references = extractSvgFragmentReferences(value)
      for (let i = 0; i < references.length; i++) {
        const target = elementsById.get(references[i]!)
        if (target !== undefined && !retained.has(target)) pending.push(target)
      }
    }
  }
  pruneOpenTypeGlyphChildren(svg, retained)
}

function collectOpenTypeSvgElements(
  element: XmlElement,
  oldToNew: ReadonlyMap<number, number>,
  elementsById: Map<string, XmlElement>,
  selected: XmlElement[],
  markDesignated: () => void,
): void {
  const id = element.attrs.get('id')
  if (id !== undefined) {
    elementsById.set(id, element)
    const glyphId = parseGlyphElementId(id)
    if (glyphId !== null) {
      markDesignated()
      if (oldToNew.has(glyphId)) selected.push(element)
    }
  }
  for (let i = 0; i < element.children.length; i++) {
    collectOpenTypeSvgElements(element.children[i]!, oldToNew, elementsById, selected, markDesignated)
  }
}

function extractSvgFragmentReferences(value: string): string[] {
  const references: string[] = []
  if (value.charCodeAt(0) === 35 && value.length > 1) references.push(value.slice(1))
  let offset = 0
  while (offset < value.length) {
    const start = value.indexOf('url(', offset)
    if (start < 0) break
    let cursor = start + 4
    while (cursor < value.length && /\s/.test(value[cursor]!)) cursor++
    const quote = value[cursor] === '"' || value[cursor] === "'" ? value[cursor++] : ''
    if (value[cursor] === '#') {
      const idStart = ++cursor
      while (cursor < value.length && value[cursor] !== ')' && (!quote || value[cursor] !== quote)) cursor++
      if (cursor > idStart) references.push(value.slice(idStart, cursor))
    }
    const end = value.indexOf(')', cursor)
    offset = end < 0 ? value.length : end + 1
  }
  return references
}

function pruneOpenTypeGlyphChildren(element: XmlElement, retained: ReadonlySet<XmlElement>): void {
  let write = 0
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]!
    const id = child.attrs.get('id')
    const glyphId = id === undefined ? null : parseGlyphElementId(id)
    if (glyphId !== null && !retained.has(child)) continue
    pruneOpenTypeGlyphChildren(child, retained)
    element.children[write++] = child
  }
  element.children.length = write
}

function remapOpenTypeSvgElement(element: XmlElement, oldToNew: ReadonlyMap<number, number>): void {
  const id = element.attrs.get('id')
  if (id) {
    const glyphId = parseGlyphElementId(id)
    const mapped = glyphId === null ? undefined : oldToNew.get(glyphId)
    if (glyphId !== null) element.attrs.set('id', mapped !== undefined ? `glyph${mapped}` : `unmappedGlyph${glyphId}`)
  }
  for (const attribute of ['href', 'xlink:href']) {
    const href = element.attrs.get(attribute)
    if (!href || href.charCodeAt(0) !== 35) continue
    const glyphId = parseGlyphElementId(href.slice(1))
    const mapped = glyphId === null ? undefined : oldToNew.get(glyphId)
    if (glyphId !== null) element.attrs.set(attribute, mapped !== undefined ? `#glyph${mapped}` : `#unmappedGlyph${glyphId}`)
  }
  for (let i = 0; i < element.children.length; i++) remapOpenTypeSvgElement(element.children[i]!, oldToNew)
}

function parseGlyphElementId(value: string): number | null {
  if (!value.startsWith('glyph') || value.length === 5) return null
  let result = 0
  for (let i = 5; i < value.length; i++) {
    const code = value.charCodeAt(i) - 48
    if (code < 0 || code > 9) return null
    result = result * 10 + code
  }
  return result
}

function serializeXmlElement(element: XmlElement): string {
  let output = `<${element.tag}`
  for (const [name, value] of element.attrs) output += ` ${name}="${escapeXmlAttribute(value)}"`
  if (element.children.length === 0 && element.text.length === 0) return `${output}/>`
  output += '>'
  if (element.text.length > 0) output += escapeXmlText(element.text)
  for (let i = 0; i < element.children.length; i++) output += serializeXmlElement(element.children[i]!)
  return `${output}</${element.tag}>`
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const RESTRICTED_OPEN_TYPE_SVG_ELEMENTS = new Set([
  'a',
  'color-profile',
  'desc',
  'font',
  'font-face',
  'font-face-format',
  'font-face-name',
  'font-face-src',
  'font-face-uri',
  'foreignObject',
  'glyph',
  'hkern',
  'metadata',
  'missing-glyph',
  'script',
  'switch',
  'text',
  'textPath',
  'title',
  'tref',
  'tspan',
  'view',
  'vkern',
])

const OPEN_TYPE_PROHIBITED_SYSTEM_COLORS = new Set([
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonface', 'buttonhighlight',
  'buttonshadow', 'buttontext', 'captiontext', 'graytext', 'highlight', 'highlighttext',
  'inactiveborder', 'inactivecaption', 'inactivecaptiontext', 'infobackground', 'infotext', 'menu',
  'menutext', 'scrollbar', 'threeddarkshadow', 'threedface', 'threedhighlight', 'threedlightshadow',
  'threedshadow', 'window', 'windowframe', 'windowtext',
])

function stripRestrictedOpenTypeElements(element: XmlElement): void {
  validateOpenTypeSvgUnits(element)
  let write = 0
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]!
    if (RESTRICTED_OPEN_TYPE_SVG_ELEMENTS.has(child.tag)) continue
    if (child.tag === 'image') {
      const href = child.attrs.get('href') ?? child.attrs.get('xlink:href') ?? ''
      if (!isOpenTypeRasterImage(href)) continue
    }
    stripRestrictedOpenTypeElements(child)
    element.children[write++] = child
  }
  element.children.length = write
}

function validateOpenTypeSvgNamespaces(element: XmlElement, root: XmlElement): void {
  for (const [name, value] of element.attrs) {
    if (name === 'xmlns') {
      if (element !== root || value !== 'http://www.w3.org/2000/svg') throw new Error('OpenType SVG document contains an unsupported namespace declaration')
    } else if (name.startsWith('xmlns:')) {
      if (element !== root || name !== 'xmlns:xlink' || value !== 'http://www.w3.org/1999/xlink') {
        throw new Error('OpenType SVG document contains an unsupported namespace declaration')
      }
    } else if (name.startsWith('xlink:') && name !== 'xlink:href') {
      throw new Error(`OpenType SVG document contains prohibited XLink attribute "${name}"`)
    } else if (name === 'xlink:href' && root.attrs.get('xmlns:xlink') !== 'http://www.w3.org/1999/xlink') {
      throw new Error('OpenType SVG document uses xlink:href without declaring the XLink namespace')
    }
  }
  for (let i = 0; i < element.children.length; i++) validateOpenTypeSvgNamespaces(element.children[i]!, root)
}

function validateOpenTypeSvgUnits(element: XmlElement): void {
  for (const [name, value] of element.attrs) {
    if (name === 'contentStyleType') throw new Error('OpenType SVG document must not use contentStyleType')
    if (name === 'color-profile') throw new Error('OpenType SVG document must not use the color-profile property')
    if (/(?:^|[^a-zA-Z])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:em|ex)(?:$|[^a-zA-Z])/i.test(value)) {
      throw new Error(`OpenType SVG document must not use em/ex units in attribute "${name}"`)
    }
    validateOpenTypeSvgColorSyntax(value, name)
  }
  if (element.tag === 'style') validateOpenTypeSvgColorSyntax(element.text, 'style element')
}

function validateOpenTypeSvgColorSyntax(value: string, location: string): void {
  if (/(?:rgba|hsla?|icc-color)\s*\(/i.test(value) || /#[0-9a-f]{4}(?:[^0-9a-f]|$)|#[0-9a-f]{8}(?:[^0-9a-f]|$)/i.test(value)) {
    throw new Error(`OpenType SVG document uses a prohibited color syntax in ${location}`)
  }
  if (/@color-profile\b/i.test(value) || /(?:^|[;{])\s*color-profile\s*:/i.test(value)) {
    throw new Error(`OpenType SVG document uses the prohibited color-profile facility in ${location}`)
  }
  const rgbFunctions = value.matchAll(/\brgb(a?)\s*\(([^)]*)\)/gi)
  for (const match of rgbFunctions) {
    if (match[1] || match[2]!.includes('/') || (match[2]!.match(/,/g)?.length ?? 0) !== 2) {
      throw new Error(`OpenType SVG document uses a prohibited color syntax in ${location}`)
    }
  }
  const declarations = value.includes(':') ? value.split(';') : [value]
  for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {
    const declaration = declarations[declarationIndex]!
    const colorValue = declaration.includes(':') ? declaration.slice(declaration.indexOf(':') + 1) : declaration
    const words = colorValue.toLowerCase().match(/[a-z][a-z0-9-]*/g)
    if (!words) continue
    for (let i = 0; i < words.length; i++) {
      if (OPEN_TYPE_PROHIBITED_SYSTEM_COLORS.has(words[i]!)) throw new Error(`OpenType SVG document uses prohibited system color "${words[i]}"`)
    }
  }
}

function isOpenTypeRasterImage(href: string): boolean {
  const normalized = href.trim().toLowerCase()
  if (normalized.startsWith('data:image/svg+xml') || normalized.startsWith('#')) return false
  const path = normalized.split(/[?#]/, 1)[0]!
  return !path.endsWith('.svg') && !path.endsWith('.svgz')
}

// ─── Lightweight XML parser ───

interface XmlElement {
  tag: string
  attrs: Map<string, string>
  children: XmlElement[]
  text: string
  parent?: XmlElement
}

interface CssRule {
  selector: string
  declarations: string
  specificity: number
  order: number
}

function parseXml(xml: string): XmlElement {
  const entityData = extractXmlEntities(xml)
  xml = entityData.xml
  const entities = entityData.entities
  const root: XmlElement = { tag: '', attrs: new Map(), children: [], text: '' }
  const stack: XmlElement[] = [root]
  let i = 0
  const len = xml.length

  while (i < len) {
    if (xml.charCodeAt(i) === 0x3C) { // <
      if (i + 1 < len && xml.charCodeAt(i + 1) === 0x21) {
        // Comment or CDATA
        if (xml.substring(i, i + 4) === '<!--') {
          const end = xml.indexOf('-->', i + 4)
          i = end < 0 ? len : end + 3
          continue
        }
        if (xml.substring(i, i + 9) === '<![CDATA[') {
          const end = xml.indexOf(']]>', i + 9)
          const cdata = end < 0 ? xml.substring(i + 9) : xml.substring(i + 9, end)
          stack[stack.length - 1]!.text += cdata
          i = end < 0 ? len : end + 3
          continue
        }
        // Skip DOCTYPE etc.
        const end = xml.indexOf('>', i)
        i = end < 0 ? len : end + 1
        continue
      }
      if (i + 1 < len && xml.charCodeAt(i + 1) === 0x3F) {
        // <?xml ...?>
        const end = xml.indexOf('?>', i)
        i = end < 0 ? len : end + 2
        continue
      }
      if (i + 1 < len && xml.charCodeAt(i + 1) === 0x2F) {
        // Closing tag </tag>
        const end = xml.indexOf('>', i)
        i = end < 0 ? len : end + 1
        if (stack.length > 1) stack.pop()
        continue
      }

      // Opening tag
      const tagEnd = findTagEnd(xml, i + 1, len)
      let tagContent = xml.substring(i + 1, tagEnd.pos)
      const selfClose = tagEnd.selfClose
      if (selfClose) {
        tagContent = tagContent.replace(/\/\s*$/, '')
      }

      const firstSpace = findFirstSpace(tagContent)
      const tagName = firstSpace < 0 ? tagContent : tagContent.substring(0, firstSpace)
      const attrStr = firstSpace < 0 ? '' : tagContent.substring(firstSpace)

      const el: XmlElement = {
        tag: stripNs(tagName),
        attrs: parseAttrs(attrStr, entities),
        children: [],
        text: '',
        parent: stack[stack.length - 1],
      }

      stack[stack.length - 1]!.children.push(el)

      if (!selfClose) {
        stack.push(el)
      }

      i = tagEnd.pos + 1
    } else {
      // Text node
      const next = xml.indexOf('<', i)
      const textEnd = next < 0 ? len : next
      const text = xml.substring(i, textEnd)
      if (text.trim()) {
        stack[stack.length - 1]!.text += decodeEntities(text, entities)
      }
      i = textEnd
    }
  }

  return root
}

function findTagEnd(s: string, start: number, len: number): { pos: number, selfClose: boolean } {
  let inQuote = 0 // 0=none, 1=single, 2=double
  for (let i = start; i < len; i++) {
    const c = s.charCodeAt(i)
    if (inQuote === 0) {
      if (c === 0x27) inQuote = 1      // '
      else if (c === 0x22) inQuote = 2  // "
      else if (c === 0x3E) {            // >
        const selfClose = i > start && s.charCodeAt(i - 1) === 0x2F // /
        return { pos: i, selfClose }
      }
    } else if (inQuote === 1 && c === 0x27) {
      inQuote = 0
    } else if (inQuote === 2 && c === 0x22) {
      inQuote = 0
    }
  }
  return { pos: len, selfClose: false }
}

function findFirstSpace(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) return i
  }
  return -1
}

function stripNs(tag: string): string {
  const colon = tag.indexOf(':')
  return colon >= 0 ? tag.substring(colon + 1) : tag
}

function parseAttrs(s: string, entities: ReadonlyMap<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  let i = 0
  const len = s.length

  while (i < len) {
    // skip whitespace
    while (i < len && isWhitespace(s.charCodeAt(i))) i++
    if (i >= len) break

    // attribute name
    const nameStart = i
    while (i < len && s.charCodeAt(i) !== 0x3D && !isWhitespace(s.charCodeAt(i)) && s.charCodeAt(i) !== 0x2F) i++
    const name = s.substring(nameStart, i).trim()
    if (!name) { i++; continue }

    // skip whitespace
    while (i < len && isWhitespace(s.charCodeAt(i))) i++

    if (i >= len || s.charCodeAt(i) !== 0x3D) {
      // boolean attribute
      map.set(name, '')
      continue
    }
    i++ // skip =

    // skip whitespace
    while (i < len && isWhitespace(s.charCodeAt(i))) i++

    if (i >= len) break

    const quote = s.charCodeAt(i)
    if (quote === 0x22 || quote === 0x27) {
      i++
      const valStart = i
      while (i < len && s.charCodeAt(i) !== quote) i++
      map.set(name, decodeEntities(s.substring(valStart, i), entities))
      i++ // skip closing quote
    } else {
      const valStart = i
      while (i < len && !isWhitespace(s.charCodeAt(i))) i++
      map.set(name, decodeEntities(s.substring(valStart, i), entities))
    }
  }

  return map
}

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D
}

function extractXmlEntities(xml: string): { xml: string, entities: Map<string, string> } {
  const entities = new Map<string, string>()
  const start = xml.search(/<!DOCTYPE\b/i)
  if (start < 0) return { xml, entities }
  let squareDepth = 0
  let quote = 0
  let end = start
  for (; end < xml.length; end++) {
    const code = xml.charCodeAt(end)
    if (quote === 0) {
      if (code === 0x22 || code === 0x27) quote = code
      else if (code === 0x5B) squareDepth++
      else if (code === 0x5D) squareDepth--
      else if (code === 0x3E && squareDepth === 0) break
    } else if (code === quote) quote = 0
  }
  if (end >= xml.length) throw new Error('SVG XML has an unterminated DOCTYPE declaration')
  const declaration = xml.slice(start, end + 1)
  if (/\b(?:SYSTEM|PUBLIC)\b/i.test(declaration) || /<!ENTITY\s+%/i.test(declaration)) {
    throw new Error('SVG XML external and parameter entities are not supported')
  }
  const entityPattern = /<!ENTITY\s+([A-Za-z_:][\w:.-]*)\s+(["'])([\s\S]*?)\2\s*>/g
  for (const match of declaration.matchAll(entityPattern)) entities.set(match[1]!, match[3]!)
  return { xml: xml.slice(0, start) + xml.slice(end + 1), entities }
}

function decodeEntities(s: string, entities: ReadonlyMap<string, string>, visiting: Set<string> = new Set()): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_:][\w:.-]*);/g, function (_match, name: string) {
    if (name.charCodeAt(0) === 0x23) {
      const codePoint = name.charCodeAt(1) === 0x78 || name.charCodeAt(1) === 0x58
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10)
      return String.fromCodePoint(codePoint)
    }
    if (name === 'amp') return '&'
    if (name === 'lt') return '<'
    if (name === 'gt') return '>'
    if (name === 'quot') return '"'
    if (name === 'apos') return "'"
    const value = entities.get(name)
    if (value === undefined) throw new Error(`SVG XML references undeclared entity "${name}"`)
    if (visiting.has(name)) throw new Error(`SVG XML entity cycle at "${name}"`)
    visiting.add(name)
    const resolved = decodeEntities(value, entities, visiting)
    visiting.delete(name)
    return resolved
  })
}

function findElement(parent: XmlElement, tag: string): XmlElement | null {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]!
    if (child.tag === tag) return child
    const found = findElement(child, tag)
    if (found) return found
  }
  return null
}

// ─── defs collection ───

function collectDefs(
  el: XmlElement,
  defs: SvgDefs,
  styleRules: CssRule[],
  idMap: Map<string, XmlElement>,
  viewport: { width: number, height: number },
): void {
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i]!
    if (child.tag === 'defs') {
      parseDefs(child, defs, styleRules, idMap, viewport)
    }
    collectDefs(child, defs, styleRules, idMap, viewport)
  }
}

interface BaseGradientMeta {
  hasGradientUnits: boolean
  hasGradientTransform: boolean
  hasSpreadMethod: boolean
  hasStops: boolean
}

interface LinearGradientMeta extends BaseGradientMeta {
  type: 'linearGradient'
  hasX1: boolean
  hasY1: boolean
  hasX2: boolean
  hasY2: boolean
}

interface RadialGradientMeta extends BaseGradientMeta {
  type: 'radialGradient'
  hasCx: boolean
  hasCy: boolean
  hasR: boolean
  hasFx: boolean
  hasFy: boolean
}

type GradientMeta = LinearGradientMeta | RadialGradientMeta

interface PatternMeta {
  hasX: boolean
  hasY: boolean
  hasWidth: boolean
  hasHeight: boolean
  hasPatternUnits: boolean
  hasPatternContentUnits: boolean
  hasPatternTransform: boolean
  hasViewBox: boolean
  hasPreserveAspectRatio: boolean
  hasChildren: boolean
}

function parseDefs(
  defsEl: XmlElement,
  defs: SvgDefs,
  styleRules: CssRule[],
  idMap: Map<string, XmlElement>,
  viewport: { width: number, height: number },
): void {
  const gradientMeta = new Map<string, GradientMeta>()
  const patternMeta = new Map<string, PatternMeta>()
  const filterElements = new Map<string, XmlElement>()
  for (let i = 0; i < defsEl.children.length; i++) {
    const child = defsEl.children[i]!
    if (child.tag === 'filter') filterElements.set(child.attrs.get('id') ?? '', child)
  }

  for (let i = 0; i < defsEl.children.length; i++) {
    const child = defsEl.children[i]!
    const id = child.attrs.get('id') ?? ''

    if (child.tag === 'linearGradient') {
      const href = child.attrs.get('href') ?? child.attrs.get('xlink:href') ?? ''
      const parsed = parseLinearGradient(child, id, href, viewport)
      defs.gradients.set(id, parsed.gradient)
      gradientMeta.set(id, parsed.meta)
    } else if (child.tag === 'radialGradient') {
      const href = child.attrs.get('href') ?? child.attrs.get('xlink:href') ?? ''
      const parsed = parseRadialGradient(child, id, href, viewport)
      defs.gradients.set(id, parsed.gradient)
      gradientMeta.set(id, parsed.meta)
    } else if (child.tag === 'clipPath') {
      const clipPathUnits = (child.attrs.get('clipPathUnits') ?? 'userSpaceOnUse') as 'userSpaceOnUse' | 'objectBoundingBox'
      const clipStyle = resolveStyle(child, styleRules)
      const clipChildren = parseChildren(child, defs, styleRules, idMap, viewport)
      defs.clipPaths.set(id, { id, children: clipChildren, clipPathUnits, clipRule: clipStyle.clipRule })
    } else if (child.tag === 'pattern') {
      const href = child.attrs.get('href') ?? child.attrs.get('xlink:href') ?? ''
      const hasPatternUnits = child.attrs.has('patternUnits')
      const hasPatternContentUnits = child.attrs.has('patternContentUnits')
      const hasPatternTransform = child.attrs.has('patternTransform')
      const hasX = child.attrs.has('x')
      const hasY = child.attrs.has('y')
      const hasWidth = child.attrs.has('width')
      const hasHeight = child.attrs.has('height')
      const hasViewBox = child.attrs.has('viewBox')
      const hasPreserveAspectRatio = child.attrs.has('preserveAspectRatio')
      const patternUnits = parseGradientUnits(child.attrs.get('patternUnits'))
      const patternContentUnits = parseGradientUnits(child.attrs.get('patternContentUnits'))
      const patternTransform = child.attrs.get('patternTransform')
      const x = parseLengthInUnits(child.attrs.get('x'), patternUnits, 'x', viewport, 0)
      const y = parseLengthInUnits(child.attrs.get('y'), patternUnits, 'y', viewport, 0)
      const width = parseLengthInUnits(child.attrs.get('width'), patternUnits, 'x', viewport, 0)
      const height = parseLengthInUnits(child.attrs.get('height'), patternUnits, 'y', viewport, 0)
      const vb = parseViewBox(child.attrs.get('viewBox') ?? '')
      const preserveAspectRatio = (child.attrs.get('preserveAspectRatio') ?? 'xMidYMid meet').trim() || 'xMidYMid meet'
      const children = parseChildren(child, defs, styleRules, idMap, viewport)
      defs.patterns.set(id, {
        id,
        children,
        x,
        y,
        width,
        height,
        patternUnits,
        patternContentUnits,
        patternTransform: patternTransform ? parseTransform(patternTransform) : undefined,
        viewBox: vb ?? undefined,
        preserveAspectRatio,
        href: href || undefined,
      })
      patternMeta.set(id, {
        hasX,
        hasY,
        hasWidth,
        hasHeight,
        hasPatternUnits,
        hasPatternContentUnits,
        hasPatternTransform,
        hasViewBox,
        hasPreserveAspectRatio,
        hasChildren: children.length > 0,
      })
    } else if (child.tag === 'mask') {
      const maskUnits = (child.attrs.get('maskUnits') ?? 'objectBoundingBox') as 'userSpaceOnUse' | 'objectBoundingBox'
      const maskContentUnits = (child.attrs.get('maskContentUnits') ?? 'userSpaceOnUse') as 'userSpaceOnUse' | 'objectBoundingBox'
      const x = parseLengthInUnits(child.attrs.get('x'), maskUnits, 'x', viewport, maskUnits === 'objectBoundingBox' ? -0.1 : 0)
      const y = parseLengthInUnits(child.attrs.get('y'), maskUnits, 'y', viewport, maskUnits === 'objectBoundingBox' ? -0.1 : 0)
      const width = parseLengthInUnits(child.attrs.get('width'), maskUnits, 'x', viewport, maskUnits === 'objectBoundingBox' ? 1.2 : viewport.width)
      const height = parseLengthInUnits(child.attrs.get('height'), maskUnits, 'y', viewport, maskUnits === 'objectBoundingBox' ? 1.2 : viewport.height)
      const maskTypeRaw = (child.attrs.get('mask-type') ?? '').trim().toLowerCase()
      const maskType = maskTypeRaw === 'alpha' ? 'alpha' : 'luminance'
      const children = parseChildren(child, defs, styleRules, idMap, viewport)
      defs.masks.set(id, {
        id,
        children,
        x,
        y,
        width,
        height,
        maskUnits,
        maskContentUnits,
        maskType,
      })
    } else if (child.tag === 'marker') {
      const markerUnits = (child.attrs.get('markerUnits') ?? 'strokeWidth') as 'strokeWidth' | 'userSpaceOnUse'
      const markerWidth = parseLengthInViewport(child.attrs.get('markerWidth'), 'x', viewport, 3)
      const markerHeight = parseLengthInViewport(child.attrs.get('markerHeight'), 'y', viewport, 3)
      const refX = parseLengthInViewport(child.attrs.get('refX'), 'x', viewport, 0)
      const refY = parseLengthInViewport(child.attrs.get('refY'), 'y', viewport, 0)
      const orientRaw = (child.attrs.get('orient') ?? '0').trim()
      const orient = orientRaw === 'auto' || orientRaw === 'auto-start-reverse'
        ? orientRaw
        : parseFloat(orientRaw)
      const vb = parseViewBox(child.attrs.get('viewBox') ?? '')
      const preserveAspectRatio = (child.attrs.get('preserveAspectRatio') ?? 'xMidYMid meet').trim() || 'xMidYMid meet'
      const children = parseChildren(child, defs, styleRules, idMap, viewport)
      defs.markers.set(id, {
        id,
        children,
        markerUnits,
        markerWidth,
        markerHeight,
        refX,
        refY,
        orient: orient === 'auto' || orient === 'auto-start-reverse' || (typeof orient === 'number' && Number.isFinite(orient))
          ? orient
          : 'auto',
        viewBox: vb ?? undefined,
        preserveAspectRatio,
        overflow: resolveStyle(child, styleRules).overflow === 'visible' ? 'visible' : 'hidden',
      })
    } else if (child.tag === 'filter') {
      defs.filters.set(id, parseFilterDef(resolveFilterElement(child, filterElements, new Set()), id, viewport, styleRules))
    }
  }

  // Resolve gradient href inheritance (inherits not only stops but also coordinates/units/spread/transform)
  for (const [id] of defs.gradients) {
    resolveGradientInheritance(id, defs.gradients, gradientMeta, new Set())
  }
  for (const [id] of defs.patterns) {
    resolvePatternInheritance(id, defs.patterns, patternMeta, new Set())
  }
}

function collectGraphicalReferences(
  idMap: Map<string, XmlElement>,
  defs: SvgDefs,
  styleRules: CssRule[],
  viewport: { width: number, height: number },
): void {
  for (const [id, element] of idMap) {
    const stack = new Set<string>()
    stack.add(id)
    let node: SvgNode | null
    if (element.tag === 'symbol') {
      node = {
        type: 'g',
        id,
        children: parseChildren(element, defs, styleRules, idMap, viewport, stack),
        style: resolveStyle(element, styleRules),
      }
    } else {
      node = parseNode(element, defs, styleRules, idMap, viewport, stack)
    }
    if (node !== null) defs.references.set(id, node)
  }
}

const SVG_FILTER_PRIMITIVES = new Set([
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDropShadow', 'feFlood', 'feGaussianBlur',
  'feImage', 'feMerge', 'feMorphology', 'feOffset', 'feSpecularLighting', 'feTile', 'feTurbulence',
])

function resolveFilterElement(
  element: XmlElement,
  filters: Map<string, XmlElement>,
  visiting: Set<string>,
): XmlElement {
  const href = element.attrs.get('href') ?? element.attrs.get('xlink:href')
  if (!href) return element
  const referenceId = href.replace(/^#/, '')
  if (visiting.has(referenceId)) throw new Error('SVG filter reference cycle')
  const referenced = filters.get(referenceId)
  if (!referenced) return element
  visiting.add(referenceId)
  const parent = resolveFilterElement(referenced, filters, visiting)
  visiting.delete(referenceId)
  const attrs = new Map(parent.attrs)
  for (const [name, value] of element.attrs) attrs.set(name, value)
  const hasPrimitives = element.children.some(child => SVG_FILTER_PRIMITIVES.has(child.tag))
  return {
    tag: element.tag,
    attrs,
    children: hasPrimitives ? element.children : parent.children,
    text: element.text,
  }
}

function parseLinearGradient(
  el: XmlElement,
  id: string,
  href: string,
  viewport: { width: number, height: number },
): { gradient: SvgGradient, meta: LinearGradientMeta } {
  const hasGradientUnits = el.attrs.has('gradientUnits')
  const hasSpreadMethod = el.attrs.has('spreadMethod')
  const hasGradientTransform = el.attrs.has('gradientTransform')
  const hasX1 = el.attrs.has('x1')
  const hasY1 = el.attrs.has('y1')
  const hasX2 = el.attrs.has('x2')
  const hasY2 = el.attrs.has('y2')
  const units = parseGradientUnits(el.attrs.get('gradientUnits'))
  const spreadMethod = parseSpreadMethod(el.attrs.get('spreadMethod'))
  const gradientTransform = el.attrs.get('gradientTransform')
  const stops = parseStops(el)
  return {
    gradient: {
      type: 'linearGradient',
      id,
      x1: parseGradientCoord(el.attrs.get('x1'), 0, units, 'x', viewport),
      y1: parseGradientCoord(el.attrs.get('y1'), 0, units, 'y', viewport),
      x2: parseGradientCoord(el.attrs.get('x2'), 1, units, 'x', viewport),
      y2: parseGradientCoord(el.attrs.get('y2'), 0, units, 'y', viewport),
      stops,
      gradientUnits: units,
      gradientTransform: gradientTransform ? parseTransform(gradientTransform) : undefined,
      spreadMethod,
      href: href || undefined,
    },
    meta: {
      type: 'linearGradient',
      hasGradientUnits,
      hasGradientTransform,
      hasSpreadMethod,
      hasStops: stops.length > 0,
      hasX1,
      hasY1,
      hasX2,
      hasY2,
    },
  }
}

function parseRadialGradient(
  el: XmlElement,
  id: string,
  href: string,
  viewport: { width: number, height: number },
): { gradient: SvgGradient, meta: RadialGradientMeta } {
  const hasGradientUnits = el.attrs.has('gradientUnits')
  const hasSpreadMethod = el.attrs.has('spreadMethod')
  const hasGradientTransform = el.attrs.has('gradientTransform')
  const hasCx = el.attrs.has('cx')
  const hasCy = el.attrs.has('cy')
  const hasR = el.attrs.has('r')
  const hasFx = el.attrs.has('fx')
  const hasFy = el.attrs.has('fy')
  const units = parseGradientUnits(el.attrs.get('gradientUnits'))
  const spreadMethod = parseSpreadMethod(el.attrs.get('spreadMethod'))
  const cx = parseGradientCoord(el.attrs.get('cx'), 0.5, units, 'x', viewport)
  const cy = parseGradientCoord(el.attrs.get('cy'), 0.5, units, 'y', viewport)
  const r = parseGradientCoord(el.attrs.get('r'), 0.5, units, 'other', viewport)
  const fx = parseGradientCoord(el.attrs.get('fx'), cx, units, 'x', viewport)
  const fy = parseGradientCoord(el.attrs.get('fy'), cy, units, 'y', viewport)
  const gradientTransform = el.attrs.get('gradientTransform')
  const stops = parseStops(el)
  return {
    gradient: {
      type: 'radialGradient',
      id,
      cx, cy, r, fx, fy,
      stops,
      gradientUnits: units,
      gradientTransform: gradientTransform ? parseTransform(gradientTransform) : undefined,
      spreadMethod,
      href: href || undefined,
    },
    meta: {
      type: 'radialGradient',
      hasGradientUnits,
      hasGradientTransform,
      hasSpreadMethod,
      hasStops: stops.length > 0,
      hasCx,
      hasCy,
      hasR,
      hasFx,
      hasFy,
    },
  }
}

function parseGradientUnits(raw: string | undefined): 'userSpaceOnUse' | 'objectBoundingBox' {
  return raw === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox'
}

function parseSpreadMethod(raw: string | undefined): 'pad' | 'reflect' | 'repeat' {
  return raw === 'reflect' || raw === 'repeat' ? raw : 'pad'
}

function parseStops(gradEl: XmlElement): SvgGradientStop[] {
  const stops: SvgGradientStop[] = []
  for (let i = 0; i < gradEl.children.length; i++) {
    const child = gradEl.children[i]!
    if (child.tag !== 'stop') continue

    let offset = parseFloat(child.attrs.get('offset') ?? '0')
    const offsetStr = child.attrs.get('offset') ?? '0'
    if (offsetStr.endsWith('%')) offset = parseFloat(offsetStr) / 100

    // stop-color and stop-opacity come from attributes or style
    const style = child.attrs.get('style') ?? ''
    const styleMap = parseInlineStyle(style)

    const colorStrRaw = child.attrs.get('stop-color') ?? styleMap.get('stop-color') ?? '#000000'
    const stopCurrentColor = child.attrs.get('color') ?? styleMap.get('color') ?? gradEl.attrs.get('color') ?? '#000000'
    const colorStr = colorStrRaw.trim().toLowerCase() === 'currentcolor'
      ? stopCurrentColor
      : colorStrRaw
    const opacityStr = child.attrs.get('stop-opacity') ?? styleMap.get('stop-opacity') ?? '1'

    const variable = parsePaletteColorVariable(colorStr)
    const stopColor = variable ? variable.fallback : colorStr
    stops.push({
      offset,
      color: parseCssColor(stopColor),
      opacity: parseFloat(opacityStr),
      paletteIndex: variable?.index,
    })
  }
  return stops
}

function resolveGradientInheritance(
  id: string,
  gradients: Map<string, SvgGradient>,
  metas: Map<string, GradientMeta>,
  visiting: Set<string>,
): void {
  if (visiting.has(id)) return
  const grad = gradients.get(id)
  const meta = metas.get(id)
  if (!grad || !meta || !grad.href) return

  const refId = grad.href.replace(/^#/, '')
  if (!refId) return
  visiting.add(id)
  resolveGradientInheritance(refId, gradients, metas, visiting)
  visiting.delete(id)

  const parent = gradients.get(refId)
  if (!parent) return

  if (grad.type === 'linearGradient' && parent.type === 'linearGradient' && meta.type === 'linearGradient') {
    if (!meta.hasStops && grad.stops.length === 0) grad.stops = parent.stops
    if (!meta.hasGradientUnits) grad.gradientUnits = parent.gradientUnits
    if (!meta.hasSpreadMethod) grad.spreadMethod = parent.spreadMethod
    if (!meta.hasGradientTransform) grad.gradientTransform = parent.gradientTransform
    if (!meta.hasX1) grad.x1 = parent.x1
    if (!meta.hasY1) grad.y1 = parent.y1
    if (!meta.hasX2) grad.x2 = parent.x2
    if (!meta.hasY2) grad.y2 = parent.y2
    return
  }

  if (grad.type === 'radialGradient' && parent.type === 'radialGradient' && meta.type === 'radialGradient') {
    if (!meta.hasStops && grad.stops.length === 0) grad.stops = parent.stops
    if (!meta.hasGradientUnits) grad.gradientUnits = parent.gradientUnits
    if (!meta.hasSpreadMethod) grad.spreadMethod = parent.spreadMethod
    if (!meta.hasGradientTransform) grad.gradientTransform = parent.gradientTransform
    if (!meta.hasCx) grad.cx = parent.cx
    if (!meta.hasCy) grad.cy = parent.cy
    if (!meta.hasR) grad.r = parent.r
    if (!meta.hasFx) grad.fx = parent.fx
    if (!meta.hasFy) grad.fy = parent.fy
  }
}

function resolvePatternInheritance(
  id: string,
  patterns: Map<string, SvgPattern>,
  metas: Map<string, PatternMeta>,
  visiting: Set<string>,
): void {
  if (visiting.has(id)) return
  const pattern = patterns.get(id)
  const meta = metas.get(id)
  if (!pattern || !meta || !pattern.href) return

  const refId = pattern.href.replace(/^#/, '')
  if (!refId) return
  visiting.add(id)
  resolvePatternInheritance(refId, patterns, metas, visiting)
  visiting.delete(id)

  const parent = patterns.get(refId)
  if (!parent) return

  if (!meta.hasChildren && pattern.children.length === 0) pattern.children = parent.children
  if (!meta.hasPatternUnits) pattern.patternUnits = parent.patternUnits
  if (!meta.hasPatternContentUnits) pattern.patternContentUnits = parent.patternContentUnits
  if (!meta.hasPatternTransform) pattern.patternTransform = parent.patternTransform
  if (!meta.hasX) pattern.x = parent.x
  if (!meta.hasY) pattern.y = parent.y
  if (!meta.hasWidth) pattern.width = parent.width
  if (!meta.hasHeight) pattern.height = parent.height
  if (!meta.hasViewBox) pattern.viewBox = parent.viewBox
  if (!meta.hasPreserveAspectRatio) pattern.preserveAspectRatio = parent.preserveAspectRatio
}

function parseFilterDef(
  filterEl: XmlElement,
  id: string,
  viewport: { width: number, height: number },
  styleRules: CssRule[],
): SvgFilter {
  filterEl = resolveFilterCssElement(filterEl, styleRules)
  const primitives = filterEl.children.filter(child => SVG_FILTER_PRIMITIVES.has(child.tag))

  const filterUnitsRaw = (filterEl.attrs.get('filterUnits') ?? 'objectBoundingBox').trim()
  const filterUnits: 'userSpaceOnUse' | 'objectBoundingBox'
    = filterUnitsRaw === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox'
  const primitiveUnitsRaw = (filterEl.attrs.get('primitiveUnits') ?? 'userSpaceOnUse').trim()
  const primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox'
    = primitiveUnitsRaw === 'objectBoundingBox' ? 'objectBoundingBox' : 'userSpaceOnUse'
  const defaults = defaultFilterRegion(filterUnits, viewport)
  const x = parseLengthInUnits(filterEl.attrs.get('x'), filterUnits, 'x', viewport, defaults.x)
  const y = parseLengthInUnits(filterEl.attrs.get('y'), filterUnits, 'y', viewport, defaults.y)
  const width = parseLengthInUnits(filterEl.attrs.get('width'), filterUnits, 'x', viewport, defaults.width)
  const height = parseLengthInUnits(filterEl.attrs.get('height'), filterUnits, 'y', viewport, defaults.height)

  const graph = parseFilterGraph(primitives, id, filterUnits, primitiveUnits, x, y, width, height)
  for (const [name, value] of filterEl.attrs) graph.attributes[name] = value
  if (primitives.length === 0) return graph

  if (primitives.length === 1 && primitives[0]!.tag === 'feDropShadow') {
    return parseFeDropShadowFilter(primitives[0]!, id, filterUnits, primitiveUnits, x, y, width, height)
  }

  const shadow = parseDropShadowChainFilter(primitives, id, filterUnits, primitiveUnits, x, y, width, height)
  return shadow.type === 'drop-shadow' ? shadow : graph
}

function resolveFilterCssElement(element: XmlElement, styleRules: CssRule[]): XmlElement {
  const attrs = new Map(element.attrs)
  const matching: CssRule[] = []
  for (let i = 0; i < styleRules.length; i++) {
    if (matchesCssSelector(element, styleRules[i]!.selector)) matching.push(styleRules[i]!)
  }
  matching.sort(compareCssRules)
  for (let i = 0; i < matching.length; i++) applyCssTextToAttributes(attrs, matching[i]!.declarations)
  const inline = element.attrs.get('style')
  if (inline !== undefined) applyCssTextToAttributes(attrs, inline)
  const children = new Array<XmlElement>(element.children.length)
  for (let i = 0; i < children.length; i++) children[i] = resolveFilterCssElement(element.children[i]!, styleRules)
  return { tag: element.tag, attrs, children, text: element.text, parent: element.parent }
}

function applyCssTextToAttributes(attributes: Map<string, string>, cssText: string): void {
  const declarations = parseInlineStyle(cssText)
  for (const [name, value] of declarations) attributes.set(name, value.replace(/\s*!important\s*$/i, '').trim())
}

function parseFilterGraph(
  primitives: XmlElement[],
  id: string,
  filterUnits: 'userSpaceOnUse' | 'objectBoundingBox',
  primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox',
  x: number,
  y: number,
  width: number,
  height: number,
): SvgFilterGraph {
  const attributes: Record<string, string> = {}
  // Filter-level properties participate in inheritance and color processing.
  // Preserve them alongside the typed geometry fields.

  const parsed = new Array<SvgFilterPrimitive>(primitives.length)
  for (let i = 0; i < primitives.length; i++) parsed[i] = parseFilterPrimitive(primitives[i]!)
  return { type: 'graph', id, filterUnits, primitiveUnits, x, y, width, height, attributes, primitives: parsed }
}

function parseFilterPrimitive(element: XmlElement): SvgFilterPrimitive {
  const attributes: Record<string, string> = {}
  const inlineStyle = parseInlineStyle(element.attrs.get('style') ?? '')
  for (const [name, value] of inlineStyle) attributes[name] = value
  for (const [name, value] of element.attrs) attributes[name] = value
  const children = new Array<SvgFilterPrimitive>(element.children.length)
  for (let i = 0; i < element.children.length; i++) children[i] = parseFilterPrimitive(element.children[i]!)
  return { type: element.tag, attributes, children }
}

function parseFeDropShadowFilter(
  el: XmlElement,
  id: string,
  filterUnits: 'userSpaceOnUse' | 'objectBoundingBox',
  primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox',
  x: number,
  y: number,
  width: number,
  height: number,
): SvgFilter {
  const std = parseStdDeviation(el.attrs.get('stdDeviation'))
  const dx = parseNumberOr(el.attrs.get('dx'), 0)
  const dy = parseNumberOr(el.attrs.get('dy'), 0)
  const floodColor = el.attrs.get('flood-color')
  const floodOpacity = el.attrs.get('flood-opacity')
  const color = floodColor ? parseCssColor(floodColor) : undefined
  const opacity = floodOpacity != null ? clamp01(parseFloat(floodOpacity)) : 1

  return {
    type: 'drop-shadow',
    id,
    filterUnits,
    primitiveUnits,
    x,
    y,
    width,
    height,
    includeSourceGraphic: true,
    dx,
    dy,
    stdDeviation: Math.max(0, (std.x + std.y) * 0.5),
    stdDeviationX: Math.max(0, std.x),
    stdDeviationY: Math.max(0, std.y),
    opacity,
    color,
    blendMode: 'normal',
  }
}

function parseDropShadowChainFilter(
  primitives: XmlElement[],
  id: string,
  filterUnits: 'userSpaceOnUse' | 'objectBoundingBox',
  primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox',
  x: number,
  y: number,
  width: number,
  height: number,
): SvgDropShadowFilter | { type: 'unsupported', id: string } {
  type FilterValueKind = 'shadow' | 'flood' | 'source' | 'other'

  let stdDeviationX = 0
  let stdDeviationY = 0
  let dx = 0
  let dy = 0
  let opacity = 1
  let color: SvgColor | undefined
  let hasBlur = false
  let hasOffset = false
  let includeSourceGraphic = false
  let blendMode: 'normal' | 'multiply' | 'screen' | 'darken' | 'lighten' = 'normal'

  const values = new Map<string, FilterValueKind>()
  values.set('SourceAlpha', 'shadow')
  values.set('SourceGraphic', 'source')

  let previousResult = 'SourceGraphic'

  const resolveInput = (raw: string | undefined): string => {
    const v = (raw ?? '').trim()
    return v || previousResult
  }
  const getKind = (name: string): FilterValueKind => values.get(name) ?? 'other'
  const setResultKind = (el: XmlElement, index: number, kind: FilterValueKind): void => {
    const result = (el.attrs.get('result') ?? '').trim() || `__filter_result_${index}`
    values.set(result, kind)
    previousResult = result
  }

  for (let i = 0; i < primitives.length; i++) {
    const child = primitives[i]!
    if (child.tag === 'feGaussianBlur') {
      const input = resolveInput(child.attrs.get('in'))
      if (getKind(input) !== 'shadow') {
        return { type: 'unsupported', id }
      }
      const sd = parseStdDeviation(child.attrs.get('stdDeviation'))
      stdDeviationX = sd.x
      stdDeviationY = sd.y
      hasBlur = true
      setResultKind(child, i, 'shadow')
    } else if (child.tag === 'feOffset') {
      const input = resolveInput(child.attrs.get('in'))
      if (getKind(input) !== 'shadow') {
        return { type: 'unsupported', id }
      }
      dx = parseNumberOr(child.attrs.get('dx'), 0)
      dy = parseNumberOr(child.attrs.get('dy'), 0)
      hasOffset = true
      setResultKind(child, i, 'shadow')
    } else if (child.tag === 'feFlood') {
      const floodColor = child.attrs.get('flood-color')
      const floodOpacity = child.attrs.get('flood-opacity')
      if (floodColor) color = parseCssColor(floodColor)
      if (floodOpacity != null) opacity *= clamp01(parseFloat(floodOpacity))
      setResultKind(child, i, 'flood')
    } else if (child.tag === 'feComposite') {
      const op = (child.attrs.get('operator') ?? 'over').trim()
      if (op !== 'in' && op !== 'over') {
        return { type: 'unsupported', id }
      }
      const in1 = resolveInput(child.attrs.get('in'))
      const in2 = resolveInput(child.attrs.get('in2'))
      const k1 = getKind(in1)
      const k2 = getKind(in2)

      if (op === 'in') {
        const floodAndShadow = (k1 === 'flood' && k2 === 'shadow') || (k1 === 'shadow' && k2 === 'flood')
        if (!floodAndShadow) return { type: 'unsupported', id }
        setResultKind(child, i, 'shadow')
      } else {
        const mergesShadowAndSource = (k1 === 'shadow' && k2 === 'source') || (k1 === 'source' && k2 === 'shadow')
        if (mergesShadowAndSource) {
          includeSourceGraphic = true
          setResultKind(child, i, 'shadow')
        } else if (k1 === 'shadow' && k2 === 'shadow') {
          setResultKind(child, i, 'shadow')
        } else {
          return { type: 'unsupported', id }
        }
      }
    } else if (child.tag === 'feComponentTransfer') {
      const input = resolveInput(child.attrs.get('in'))
      if (getKind(input) !== 'shadow') {
        return { type: 'unsupported', id }
      }
      for (let j = 0; j < child.children.length; j++) {
        const fn = child.children[j]!
        if (fn.tag !== 'feFuncA') {
          return { type: 'unsupported', id }
        }
        const type = (fn.attrs.get('type') ?? '').trim()
        if (type && type !== 'linear') {
          return { type: 'unsupported', id }
        }
        const intercept = parseNumberOr(fn.attrs.get('intercept'), 0)
        if (Math.abs(intercept) > 1e-9) {
          return { type: 'unsupported', id }
        }
        const slope = parseNumberOr(fn.attrs.get('slope'), 1)
        opacity *= slope
      }
      setResultKind(child, i, 'shadow')
    } else if (child.tag === 'feColorMatrix') {
      const input = resolveInput(child.attrs.get('in'))
      if (getKind(input) !== 'shadow') {
        return { type: 'unsupported', id }
      }
      const type = (child.attrs.get('type') ?? 'matrix').trim()
      if (type === 'matrix') {
        const values = (child.attrs.get('values') ?? '')
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(v => parseFloat(v))
        if (values.length === 20) {
          const alphaScale = values[18]!
          const alphaBias = values[19]!
          if (!Number.isFinite(alphaScale) || !Number.isFinite(alphaBias)) {
            return { type: 'unsupported', id }
          }
          if (Math.abs(alphaBias) > 1e-9) {
            return { type: 'unsupported', id }
          }
          opacity *= alphaScale
        } else if (values.length !== 0) {
          return { type: 'unsupported', id }
        }
      } else if (type === 'saturate' || type === 'hueRotate' || type === 'luminanceToAlpha') {
        // For drop-shadow detection, treat as still viable on the alpha path.
      } else {
        return { type: 'unsupported', id }
      }
      setResultKind(child, i, 'shadow')
    } else if (child.tag === 'feBlend') {
      const mode = (child.attrs.get('mode') ?? 'normal').trim()
      if (
        mode !== 'normal' &&
        mode !== 'multiply' &&
        mode !== 'screen' &&
        mode !== 'darken' &&
        mode !== 'lighten'
      ) {
        return { type: 'unsupported', id }
      }
      const in1 = resolveInput(child.attrs.get('in'))
      const in2 = resolveInput(child.attrs.get('in2'))
      const k1 = getKind(in1)
      const k2 = getKind(in2)
      const hasShadow = k1 === 'shadow' || k2 === 'shadow'
      if (!hasShadow) return { type: 'unsupported', id }
      const hasSource = k1 === 'source' || k2 === 'source'
      if (hasSource) {
        includeSourceGraphic = true
        blendMode = mode as 'normal' | 'multiply' | 'screen' | 'darken' | 'lighten'
      }
      setResultKind(child, i, 'shadow')
    } else if (child.tag === 'feMerge') {
      if (child.children.length === 0) {
        return { type: 'unsupported', id }
      }
      let hasShadowInput = false
      let includesSource = false
      for (let j = 0; j < child.children.length; j++) {
        const mn = child.children[j]!
        if (mn.tag !== 'feMergeNode') {
          return { type: 'unsupported', id }
        }
        const input = resolveInput(mn.attrs.get('in'))
        const kind = getKind(input)
        if (kind === 'shadow') hasShadowInput = true
        else if (kind === 'source') includesSource = true
        else return { type: 'unsupported', id }
      }
      if (!hasShadowInput) return { type: 'unsupported', id }
      includeSourceGraphic = includeSourceGraphic || includesSource
      setResultKind(child, i, 'shadow')
    } else {
      return { type: 'unsupported', id }
    }
  }

  if (!hasBlur || !hasOffset) {
    return { type: 'unsupported', id }
  }

  return {
    type: 'drop-shadow',
    id,
    filterUnits,
    primitiveUnits,
    x,
    y,
    width,
    height,
    includeSourceGraphic,
    dx,
    dy,
    stdDeviation: Math.max(0, (stdDeviationX + stdDeviationY) * 0.5),
    stdDeviationX: Math.max(0, stdDeviationX),
    stdDeviationY: Math.max(0, stdDeviationY),
    opacity: Math.max(0, Math.min(1, opacity)),
    color,
    blendMode,
  }
}

function parseStdDeviation(raw: string | undefined): { x: number, y: number } {
  const sd = (raw ?? '0').trim()
  const parts = sd.split(/[\s,]+/).filter(Boolean)
  const sx = parseNumberOr(parts[0], 0)
  const sy = parseNumberOr(parts[1] ?? parts[0], sx)
  return { x: sx, y: sy }
}

function parseNumberOr(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function defaultFilterRegion(
  units: 'userSpaceOnUse' | 'objectBoundingBox',
  viewport: { width: number, height: number },
): { x: number, y: number, width: number, height: number } {
  if (units === 'objectBoundingBox') {
    return { x: -0.1, y: -0.1, width: 1.2, height: 1.2 }
  }
  return {
    x: -0.1 * viewport.width,
    y: -0.1 * viewport.height,
    width: 1.2 * viewport.width,
    height: 1.2 * viewport.height,
  }
}

// ─── CSS <style> parser ───

function parseStyleElements(svgEl: XmlElement): CssRule[] {
  const rules: CssRule[] = []
  parseStyleElementsRecursive(svgEl, rules)
  return rules
}

function parseStyleElementsRecursive(el: XmlElement, rules: CssRule[]): void {
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i]!
    if (child.tag === 'style') {
      parseCssRules(child.text, rules)
    }
    parseStyleElementsRecursive(child, rules)
  }
}

function parseCssRules(css: string, rules: CssRule[]): void {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  const len = css.length
  while (i < len) {
    while (i < len && isWhitespace(css.charCodeAt(i))) i++
    if (i >= len) break
    const headerStart = i
    while (i < len && css.charCodeAt(i) !== 0x7B && css.charCodeAt(i) !== 0x3B) i++
    if (i >= len) break
    if (css.charCodeAt(i) === 0x3B) {
      i++
      continue
    }
    const header = css.substring(headerStart, i).trim()
    const bodyStart = ++i
    let depth = 1
    while (i < len && depth > 0) {
      const code = css.charCodeAt(i)
      if (code === 0x7B) depth++
      else if (code === 0x7D) depth--
      i++
    }
    const body = css.substring(bodyStart, depth === 0 ? i - 1 : i).trim()
    if (header.toLowerCase().startsWith('@media')) {
      if (matchesPrintMedia(header.slice(6))) parseCssRules(body, rules)
      continue
    }
    if (header.charCodeAt(0) === 0x40) continue
    const selectors = splitCssSelectorList(header)
    for (let s = 0; s < selectors.length; s++) {
      const sel = selectors[s]!.trim()
      if (sel) rules.push({ selector: sel, declarations: body, specificity: cssSpecificity(sel), order: rules.length })
    }
  }
}

function matchesPrintMedia(query: string): boolean {
  const alternatives = query.toLowerCase().split(',')
  for (let i = 0; i < alternatives.length; i++) {
    const value = alternatives[i]!.trim()
    if (value.startsWith('not ')) continue
    if (/^(?:only\s+)?(?:all|print)(?:\s|$)/.test(value)) return true
  }
  return false
}

function splitCssSelectorList(value: string): string[] {
  const result: string[] = []
  let start = 0
  let squareDepth = 0
  let roundDepth = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x5B) squareDepth++
    else if (code === 0x5D) squareDepth--
    else if (code === 0x28) roundDepth++
    else if (code === 0x29) roundDepth--
    else if (code === 0x2C && squareDepth === 0 && roundDepth === 0) {
      result.push(value.slice(start, i))
      start = i + 1
    }
  }
  result.push(value.slice(start))
  return result
}

function cssSpecificity(selector: string): number {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)?.length ?? 0
  const types = selector.match(/(?:^|[\s>+~])(?:[a-zA-Z_][\w-]*)/g)?.length ?? 0
  return ids * 100 + classes * 10 + types
}

function compareCssRules(a: CssRule, b: CssRule): number {
  return a.specificity - b.specificity || a.order - b.order
}

function matchesCssSelector(element: XmlElement, selector: string): boolean {
  const relation = findRightmostCssCombinator(selector)
  if (relation === null) return matchesCssCompound(element, selector.trim())
  if (!matchesCssCompound(element, relation.right)) return false
  if (relation.combinator === '>') return element.parent !== undefined && matchesCssSelector(element.parent, relation.left)
  if (relation.combinator === '+') {
    const parent = element.parent
    if (parent === undefined) return false
    const index = parent.children.indexOf(element)
    return index > 0 && matchesCssSelector(parent.children[index - 1]!, relation.left)
  }
  let ancestor = element.parent
  while (ancestor !== undefined) {
    if (matchesCssSelector(ancestor, relation.left)) return true
    ancestor = ancestor.parent
  }
  return false
}

function findRightmostCssCombinator(selector: string): { left: string, right: string, combinator: ' ' | '>' | '+' } | null {
  let squareDepth = 0
  let roundDepth = 0
  for (let i = selector.length - 1; i >= 0; i--) {
    const code = selector.charCodeAt(i)
    if (code === 0x5D) squareDepth++
    else if (code === 0x5B) squareDepth--
    else if (code === 0x29) roundDepth++
    else if (code === 0x28) roundDepth--
    else if (squareDepth === 0 && roundDepth === 0 && (code === 0x3E || code === 0x2B)) {
      const left = selector.slice(0, i).trim()
      const right = selector.slice(i + 1).trim()
      if (left && right) return { left, right, combinator: code === 0x3E ? '>' : '+' }
    } else if (squareDepth === 0 && roundDepth === 0 && isWhitespace(code)) {
      let start = i
      while (start > 0 && isWhitespace(selector.charCodeAt(start - 1))) start--
      const left = selector.slice(0, start).trim()
      const right = selector.slice(i + 1).trim()
      if (left.endsWith('>') || left.endsWith('+') || right.startsWith('>') || right.startsWith('+')) {
        i = start
        continue
      }
      if (left && right) return { left, right, combinator: ' ' }
      i = start
    }
  }
  return null
}

function matchesCssCompound(element: XmlElement, compound: string): boolean {
  let i = 0
  const type = /^(\*|[a-zA-Z_][\w-]*)/.exec(compound)
  if (type !== null) {
    if (type[1] !== '*' && type[1] !== element.tag) return false
    i = type[0].length
  }
  while (i < compound.length) {
    const code = compound.charCodeAt(i)
    if (code === 0x23 || code === 0x2E) {
      const start = ++i
      while (i < compound.length && /[\w-]/.test(compound[i]!)) i++
      const value = compound.slice(start, i)
      if (code === 0x23) {
        if (element.attrs.get('id') !== value) return false
      } else if (!(element.attrs.get('class') ?? '').split(/\s+/).includes(value)) return false
      continue
    }
    if (code === 0x5B) {
      const end = compound.indexOf(']', i + 1)
      if (end < 0 || !matchesCssAttribute(element, compound.slice(i + 1, end))) return false
      i = end + 1
      continue
    }
    if (code === 0x3A) {
      const pseudo = compound.slice(i + 1)
      if (!matchesCssPseudo(element, pseudo)) return false
      return true
    }
    return false
  }
  return true
}

function matchesCssAttribute(element: XmlElement, expression: string): boolean {
  const match = /^\s*([\w:-]+)\s*(?:(~=|\|=|\^=|\$=|\*=|=)\s*["']?([^"']*?)["']?\s*)?$/.exec(expression)
  if (match === null) return false
  const actual = element.attrs.get(match[1]!)
  if (actual === undefined) return false
  const operator = match[2]
  if (operator === undefined) return true
  const expected = match[3] ?? ''
  if (operator === '=') return actual === expected
  if (operator === '~=') return actual.split(/\s+/).includes(expected)
  if (operator === '|=') return actual === expected || actual.startsWith(`${expected}-`)
  if (operator === '^=') return actual.startsWith(expected)
  if (operator === '$=') return actual.endsWith(expected)
  return actual.includes(expected)
}

function matchesCssPseudo(element: XmlElement, pseudo: string): boolean {
  if (pseudo === 'root') return element.parent?.tag === ''
  if (pseudo === 'empty') return element.children.length === 0 && element.text.trim().length === 0
  const parent = element.parent
  if (parent === undefined) return false
  const index = parent.children.indexOf(element)
  if (pseudo === 'first-child') return index === 0
  if (pseudo === 'last-child') return index === parent.children.length - 1
  if (pseudo === 'only-child') return parent.children.length === 1
  if (pseudo.startsWith('not(') && pseudo.endsWith(')')) return !matchesCssCompound(element, pseudo.slice(4, -1).trim())
  return false
}

// ─── ID map construction ───

function buildIdMap(el: XmlElement, map: Map<string, XmlElement>): void {
  const id = el.attrs.get('id')
  if (id) map.set(id, el)
  for (let i = 0; i < el.children.length; i++) {
    buildIdMap(el.children[i]!, map)
  }
}

// ─── Child element parsing ───

function parseChildren(
  parent: XmlElement,
  defs: SvgDefs,
  styleRules: CssRule[],
  idMap: Map<string, XmlElement>,
  viewport: { width: number, height: number },
  referenceStack: Set<string> = new Set(),
): SvgNode[] {
  const result: SvgNode[] = []
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]!
    if (child.tag === 'defs' || child.tag === 'style') continue

    const node = parseNode(child, defs, styleRules, idMap, viewport, referenceStack)
    if (node) result.push(node)
  }
  return result
}

function parseNode(
  el: XmlElement,
  defs: SvgDefs,
  styleRules: CssRule[],
  idMap: Map<string, XmlElement>,
  viewport: { width: number, height: number },
  referenceStack: Set<string> = new Set(),
): SvgNode | null {
  const style = resolveStyle(el, styleRules)
  const transform = el.attrs.has('transform') ? parseTransform(el.attrs.get('transform')!) : undefined
  const clipPathId = parseUrlRef(el.attrs.get('clip-path') ?? '')
  const maskId = parseUrlRef(el.attrs.get('mask') ?? '')
  const filterId = parseUrlRef(el.attrs.get('filter') ?? '')

  // Display: none.
  
  if (style.display === 'none') return null

  const base = {
    id: el.attrs.get('id') || undefined,
    style,
    transform,
    clipPathId: clipPathId || undefined,
    maskId: maskId || undefined,
    filterId: filterId || undefined,
  }

  switch (el.tag) {
    case 'g': {
      const children = parseChildren(el, defs, styleRules, idMap, viewport, referenceStack)
      return { type: 'g', children, ...base } as SvgGroup
    }
    case 'svg': {
      const x = parseLengthInViewport(el.attrs.get('x'), 'x', viewport, 0)
      const y = parseLengthInViewport(el.attrs.get('y'), 'y', viewport, 0)
      const width = parseLengthInViewport(el.attrs.get('width'), 'x', viewport, viewport.width)
      const height = parseLengthInViewport(el.attrs.get('height'), 'y', viewport, viewport.height)
      if (!(width > 0) || !(height > 0)) return null
      const viewBox = parseViewBox(el.attrs.get('viewBox') ?? '')
      const childViewport = viewBox ? { width: viewBox.width, height: viewBox.height } : { width, height }
      let viewportTransform: SvgMatrix = [1, 0, 0, 1, x, y]
      let viewportClip = { x: 0, y: 0, width, height }
      if (viewBox) {
        const fit = computeViewBoxTransformForParser(viewBox, width, height, el.attrs.get('preserveAspectRatio') ?? 'xMidYMid meet')
        viewportTransform = multiplyMatrix(viewportTransform, fit)
        const inverse = invertParserMatrix(fit)
        const p0 = applyParserMatrix(inverse, 0, 0)
        const p1 = applyParserMatrix(inverse, width, height)
        viewportClip = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), width: Math.abs(p1.x - p0.x), height: Math.abs(p1.y - p0.y) }
      }
      if (transform) viewportTransform = multiplyMatrix(transform, viewportTransform)
      return {
        type: 'g',
        children: parseChildren(el, defs, styleRules, idMap, childViewport, referenceStack),
        ...base,
        transform: viewportTransform,
        viewportClip: style.overflow === 'visible' ? undefined : viewportClip,
      } as SvgGroup
    }
    case 'path': {
      const d = el.attrs.get('d') ?? ''
      const pathData = parseSvgPath(d)
      return { type: 'path', d, commands: pathData.commands, coords: pathData.coords, ...base } as SvgPath
    }
    case 'rect': {
      const x = parseLengthInViewport(el.attrs.get('x'), 'x', viewport, 0)
      const y = parseLengthInViewport(el.attrs.get('y'), 'y', viewport, 0)
      const w = parseLengthInViewport(el.attrs.get('width'), 'x', viewport, 0)
      const h = parseLengthInViewport(el.attrs.get('height'), 'y', viewport, 0)
      const rx = parseLengthInViewport(el.attrs.get('rx'), 'x', viewport, 0)
      const ry = parseLengthInViewport(el.attrs.get('ry'), 'y', viewport, rx)
      return { type: 'rect', x, y, width: w, height: h, rx, ry, ...base } as SvgRect
    }
    case 'circle': {
      const cx = parseLengthInViewport(el.attrs.get('cx'), 'x', viewport, 0)
      const cy = parseLengthInViewport(el.attrs.get('cy'), 'y', viewport, 0)
      const r = parseLengthInViewport(el.attrs.get('r'), 'other', viewport, 0)
      return { type: 'circle', cx, cy, r, ...base } as SvgCircle
    }
    case 'ellipse': {
      const cx = parseLengthInViewport(el.attrs.get('cx'), 'x', viewport, 0)
      const cy = parseLengthInViewport(el.attrs.get('cy'), 'y', viewport, 0)
      const rx = parseLengthInViewport(el.attrs.get('rx'), 'x', viewport, 0)
      const ry = parseLengthInViewport(el.attrs.get('ry'), 'y', viewport, 0)
      return { type: 'ellipse', cx, cy, rx, ry, ...base } as SvgEllipse
    }
    case 'line': {
      const x1 = parseLengthInViewport(el.attrs.get('x1'), 'x', viewport, 0)
      const y1 = parseLengthInViewport(el.attrs.get('y1'), 'y', viewport, 0)
      const x2 = parseLengthInViewport(el.attrs.get('x2'), 'x', viewport, 0)
      const y2 = parseLengthInViewport(el.attrs.get('y2'), 'y', viewport, 0)
      return { type: 'line', x1, y1, x2, y2, ...base } as SvgLine
    }
    case 'polyline': {
      const pts = parsePoints(el.attrs.get('points') ?? '')
      return { type: 'polyline', points: pts, ...base } as SvgPolyline
    }
    case 'polygon': {
      const pts = parsePoints(el.attrs.get('points') ?? '')
      return { type: 'polygon', points: pts, ...base } as SvgPolygon
    }
    case 'text': {
      const x = parseLengthInViewport(el.attrs.get('x'), 'x', viewport, 0)
      const y = parseLengthInViewport(el.attrs.get('y'), 'y', viewport, 0)
      // Text content collect (tspan)
      
      let content = el.text
      for (let ci = 0; ci < el.children.length; ci++) {
        const c = el.children[ci]!
        if (c.tag === 'tspan') content += c.text
      }
      return { type: 'text', x, y, content, ...base } as SvgText
    }
    case 'image': {
      const x = parseLengthInViewport(el.attrs.get('x'), 'x', viewport, 0)
      const y = parseLengthInViewport(el.attrs.get('y'), 'y', viewport, 0)
      const w = parseLengthInViewport(el.attrs.get('width'), 'x', viewport, 0)
      const h = parseLengthInViewport(el.attrs.get('height'), 'y', viewport, 0)
      const href = el.attrs.get('href') ?? el.attrs.get('xlink:href') ?? ''
      const preserveAspectRatio = (el.attrs.get('preserveAspectRatio') ?? 'xMidYMid meet').trim() || 'xMidYMid meet'
      return { type: 'image', x, y, width: w, height: h, href, preserveAspectRatio, ...base } as SvgImage
    }
    case 'use': {
      const href = el.attrs.get('href') ?? el.attrs.get('xlink:href') ?? ''
      const refId = href.replace(/^#/, '')
      const refEl = idMap.get(refId)
      if (!refEl) return null
      if (referenceStack.has(refId)) throw new Error(`SVG fragment reference cycle at "${refId}"`)
      referenceStack.add(refId)

      const useX = parseLengthInViewport(el.attrs.get('x'), 'x', viewport, 0)
      const useY = parseLengthInViewport(el.attrs.get('y'), 'y', viewport, 0)

      // Use transform translate(x,y) add.
      
      let useTransform: SvgMatrix = [1, 0, 0, 1, useX, useY]
      if (transform) {
        useTransform = multiplyMatrix(transform, useTransform)
      }

      if (refEl.tag === 'symbol') {
        const symbolViewBox = parseViewBox(refEl.attrs.get('viewBox') ?? '')
        if (symbolViewBox) {
          const useWidth = parseLengthInViewport(el.attrs.get('width') ?? refEl.attrs.get('width'), 'x', viewport, viewport.width)
          const useHeight = parseLengthInViewport(el.attrs.get('height') ?? refEl.attrs.get('height'), 'y', viewport, viewport.height)
          if (!(useWidth > 0) || !(useHeight > 0)) {
            referenceStack.delete(refId)
            return null
          }
          const fit = computeViewBoxTransformForParser(
            symbolViewBox,
            useWidth,
            useHeight,
            refEl.attrs.get('preserveAspectRatio') ?? 'xMidYMid meet',
          )
          useTransform = multiplyMatrix(useTransform, fit)
        }
        const symbol = {
          type: 'g' as const,
          children: parseChildren(refEl, defs, styleRules, idMap, viewport, referenceStack),
          style: resolveStyle(refEl, styleRules),
        }
        const referencedSymbol: SvgGroup = {
          type: 'g',
          children: [symbol],
          style: base.style,
          transform: useTransform,
          clipPathId: clipPathId || undefined,
          maskId: maskId || undefined,
          filterId: filterId || undefined,
        }
        referenceStack.delete(refId)
        return referencedSymbol
      }

      const refNode = parseNode(refEl, defs, styleRules, idMap, viewport, referenceStack)
      referenceStack.delete(refId)
      if (!refNode) return null

      // G with transform apply.
      
      return {
        type: 'g',
        children: [refNode],
        style: base.style,
        transform: useTransform,
        clipPathId: clipPathId || undefined,
        maskId: maskId || undefined,
        filterId: filterId || undefined,
      } as SvgGroup
    }
    case 'symbol':
      return null
    default:
      // Supportelement: childelementgroup as process.
      
      if (el.children.length > 0) {
        const children = parseChildren(el, defs, styleRules, idMap, viewport, referenceStack)
        if (children.length > 0) {
          return { type: 'g', children, ...base } as SvgGroup
        }
      }
      return null
  }
}

function computeViewBoxTransformForParser(
  viewBox: { x: number, y: number, width: number, height: number },
  viewportWidth: number,
  viewportHeight: number,
  preserveAspectRatio: string,
): SvgMatrix {
  const parts = preserveAspectRatio.trim().split(/\s+/)
  const align = parts[0] ?? 'xMidYMid'
  let scaleX = viewportWidth / viewBox.width
  let scaleY = viewportHeight / viewBox.height
  if (align !== 'none') {
    const scale = parts[1] === 'slice' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
    scaleX = scale
    scaleY = scale
  }
  let translateX = -viewBox.x * scaleX
  let translateY = -viewBox.y * scaleY
  if (align.includes('xMid')) translateX += (viewportWidth - viewBox.width * scaleX) * 0.5
  else if (align.includes('xMax')) translateX += viewportWidth - viewBox.width * scaleX
  if (align.includes('YMid')) translateY += (viewportHeight - viewBox.height * scaleY) * 0.5
  else if (align.includes('YMax')) translateY += viewportHeight - viewBox.height * scaleY
  return [scaleX, 0, 0, scaleY, translateX, translateY]
}

function invertParserMatrix(matrix: SvgMatrix): SvgMatrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (Math.abs(determinant) <= 1e-12) throw new Error('SVG viewport transform is singular')
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ]
}

function applyParserMatrix(matrix: SvgMatrix, x: number, y: number): { x: number, y: number } {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }
}

// Style resolution.


function resolveStyle(el: XmlElement, styleRules: CssRule[]): SvgStyle {
  const style: SvgStyle = {}
  applyPresentationAttrs(style, el.attrs)
  if (styleRules.length > 0) {
    const matching: CssRule[] = []
    for (let i = 0; i < styleRules.length; i++) {
      if (matchesCssSelector(el, styleRules[i]!.selector)) matching.push(styleRules[i]!)
    }
    matching.sort(compareCssRules)
    for (let i = 0; i < matching.length; i++) applyInlineStyle(style, matching[i]!.declarations)
  }
  const inlineStyle = el.attrs.get('style')
  if (inlineStyle) applyInlineStyle(style, inlineStyle)
  return style
}

function applyPresentationAttrs(style: SvgStyle, attrs: Map<string, string>): void {
  const color = attrs.get('color')
  if (color != null) style.color = parseCssColor(color)

  const fill = attrs.get('fill')
  if (fill != null) style.fill = parsePaint(fill)

  const fillOpacity = attrs.get('fill-opacity')
  if (fillOpacity != null) style.fillOpacity = parseFloat(fillOpacity)

  const stroke = attrs.get('stroke')
  if (stroke != null) style.stroke = parsePaint(stroke)

  const strokeOpacity = attrs.get('stroke-opacity')
  if (strokeOpacity != null) style.strokeOpacity = parseFloat(strokeOpacity)

  const sw = attrs.get('stroke-width')
  if (sw != null) style.strokeWidth = parseAbsoluteLength(sw, 1)

  const slc = attrs.get('stroke-linecap')
  if (slc != null) style.strokeLinecap = slc as 'butt' | 'round' | 'square'

  const slj = attrs.get('stroke-linejoin')
  if (slj != null) style.strokeLinejoin = slj as 'miter' | 'round' | 'bevel'

  const sml = attrs.get('stroke-miterlimit')
  if (sml != null) style.strokeMiterLimit = parseAbsoluteLength(sml, 4)

  const sda = attrs.get('stroke-dasharray')
  if (sda != null && sda !== 'none') {
    style.strokeDasharray = sda
      .split(/[\s,]+/)
      .map(v => parseAbsoluteLength(v, NaN))
      .filter(v => Number.isFinite(v))
  }

  const sdo = attrs.get('stroke-dashoffset')
  if (sdo != null) style.strokeDashoffset = parseAbsoluteLength(sdo, 0)

  const vectorEffect = attrs.get('vector-effect')
  if (vectorEffect != null) style.vectorEffect = parseVectorEffect(vectorEffect)

  const opacity = attrs.get('opacity')
  if (opacity != null) style.opacity = parseFloat(opacity)

  const fillRule = attrs.get('fill-rule')
  if (fillRule != null) style.fillRule = fillRule as 'nonzero' | 'evenodd'

  const clipRule = attrs.get('clip-rule')
  if (clipRule != null) style.clipRule = clipRule as 'nonzero' | 'evenodd'

  const markerStart = attrs.get('marker-start')
  if (markerStart != null) style.markerStart = parseUrlRef(markerStart) ?? undefined
  const markerMid = attrs.get('marker-mid')
  if (markerMid != null) style.markerMid = parseUrlRef(markerMid) ?? undefined
  const markerEnd = attrs.get('marker-end')
  if (markerEnd != null) style.markerEnd = parseUrlRef(markerEnd) ?? undefined

  const fontSize = attrs.get('font-size')
  if (fontSize != null) style.fontSize = parseAbsoluteLength(fontSize, 16)

  const fontFamily = attrs.get('font-family')
  if (fontFamily != null) style.fontFamily = fontFamily

  const fontWeight = attrs.get('font-weight')
  if (fontWeight != null) style.fontWeight = fontWeight

  const fontStyle = attrs.get('font-style')
  if (fontStyle != null) style.fontStyle = fontStyle

  const textAnchor = attrs.get('text-anchor')
  if (textAnchor != null) style.textAnchor = textAnchor as 'start' | 'middle' | 'end'

  const letterSpacing = attrs.get('letter-spacing')
  if (letterSpacing != null) style.letterSpacing = parseAbsoluteLength(letterSpacing, 0)

  const display = attrs.get('display')
  if (display != null) style.display = display

  const visibility = attrs.get('visibility')
  if (visibility != null) style.visibility = visibility

  const enableBackground = attrs.get('enable-background')
  if (enableBackground != null) style.enableBackground = enableBackground

  const overflow = attrs.get('overflow')
  if (overflow != null) style.overflow = overflow
}

function applyInlineStyle(style: SvgStyle, cssText: string): void {
  const pairs = cssText.split(';')
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!
    const colon = pair.indexOf(':')
    if (colon < 0) continue
    const prop = pair.substring(0, colon).trim()
    const val = pair.substring(colon + 1).trim()

    switch (prop) {
      case 'color': style.color = parseCssColor(val); break
      case 'fill': style.fill = parsePaint(val); break
      case 'fill-opacity': style.fillOpacity = parseFloat(val); break
      case 'stroke': style.stroke = parsePaint(val); break
      case 'stroke-opacity': style.strokeOpacity = parseFloat(val); break
      case 'stroke-width': style.strokeWidth = parseAbsoluteLength(val, 1); break
      case 'stroke-linecap': style.strokeLinecap = val as 'butt' | 'round' | 'square'; break
      case 'stroke-linejoin': style.strokeLinejoin = val as 'miter' | 'round' | 'bevel'; break
      case 'stroke-miterlimit': style.strokeMiterLimit = parseAbsoluteLength(val, 4); break
      case 'stroke-dasharray':
        if (val !== 'none') {
          style.strokeDasharray = val
            .split(/[\s,]+/)
            .map(v => parseAbsoluteLength(v, NaN))
            .filter(v => Number.isFinite(v))
        }
        break
      case 'stroke-dashoffset': style.strokeDashoffset = parseAbsoluteLength(val, 0); break
      case 'vector-effect': style.vectorEffect = parseVectorEffect(val); break
      case 'opacity': style.opacity = parseFloat(val); break
      case 'fill-rule': style.fillRule = val as 'nonzero' | 'evenodd'; break
      case 'clip-rule': style.clipRule = val as 'nonzero' | 'evenodd'; break
      case 'marker-start': style.markerStart = parseUrlRef(val) ?? undefined; break
      case 'marker-mid': style.markerMid = parseUrlRef(val) ?? undefined; break
      case 'marker-end': style.markerEnd = parseUrlRef(val) ?? undefined; break
      case 'font-size': style.fontSize = parseAbsoluteLength(val, 16); break
      case 'font-family': style.fontFamily = val; break
      case 'font-weight': style.fontWeight = val; break
      case 'font-style': style.fontStyle = val; break
      case 'text-anchor': style.textAnchor = val as 'start' | 'middle' | 'end'; break
      case 'letter-spacing': style.letterSpacing = parseAbsoluteLength(val, 0); break
      case 'display': style.display = val; break
      case 'visibility': style.visibility = val; break
      case 'enable-background': style.enableBackground = val; break
      case 'overflow': style.overflow = val; break
    }
  }
}

function parseVectorEffect(value: string): 'none' | 'non-scaling-stroke' {
  const v = value.trim().toLowerCase()
  return v === 'non-scaling-stroke' ? 'non-scaling-stroke' : 'none'
}

function parseInlineStyle(s: string): Map<string, string> {
  const map = new Map<string, string>()
  const pairs = s.split(';')
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!
    const colon = pair.indexOf(':')
    if (colon < 0) continue
    map.set(pair.substring(0, colon).trim(), pair.substring(colon + 1).trim())
  }
  return map
}

// / color.


function parsePaint(value: string): SvgPaint {
  const v = value.trim()
  const variable = parsePaletteColorVariable(v)
  if (variable) {
    const fallback = variable.fallback.trim()
    if (fallback.toLowerCase() === 'currentcolor') return { type: 'currentColor', opacity: 1, paletteIndex: variable.index }
    const color = parseCssColor(fallback)
    return {
      type: 'color',
      color: { r: color.r, g: color.g, b: color.b },
      opacity: color.a ?? 1,
      paletteIndex: variable.index,
    }
  }
  if (v === 'none') return { type: 'none' }
  if (v.toLowerCase() === 'currentcolor') return { type: 'currentColor', opacity: 1 }
  if (v.startsWith('url(')) {
    const urlMatch = v.match(/^url\(\s*#([^)]+?)\s*\)\s*(.*)$/i)
    const url = urlMatch?.[1]
    const fallback = (urlMatch?.[2] ?? '').trim()
    if (fallback) {
      if (fallback === 'none') return { type: 'url', url: url || undefined, opacity: 1 }
      if (fallback.toLowerCase() === 'currentcolor') {
        return {
          type: 'url',
          url: url || undefined,
          opacity: 1,
          fallbackCurrentColor: true,
        }
      }
      const color = parseCssColor(fallback)
      const opacity = color.a ?? 1
      return {
        type: 'url',
        url: url || undefined,
        color: { r: color.r, g: color.g, b: color.b },
        opacity,
      }
    }
    return { type: 'url', url: url || undefined, opacity: 1 }
  }
  const color = parseCssColor(v)
  const opacity = color.a ?? 1
  return { type: 'color', color: { r: color.r, g: color.g, b: color.b }, opacity }
}

function parsePaletteColorVariable(value: string): { index: number, fallback: string } | null {
  const match = /^var\(\s*--color(\d+)\s*(?:,\s*([^)]*))?\)$/i.exec(value.trim())
  if (!match) return null
  const index = Number(match[1])
  if (!Number.isSafeInteger(index)) return null
  return { index, fallback: (match[2] ?? '#000000').trim() }
}

function parseUrlRef(s: string): string | null {
  if (!s) return null
  const match = s.match(/url\(\s*['"]?#([^)'" ]+?)['"]?\s*\)/i)
  return match ? match[1]! : null
}

/* Convert a CSS color string to RGB. */

export function parseCssColor(s: string): SvgColor {
  const v = s.trim().toLowerCase()
  if (!v) return { r: 0, g: 0, b: 0 }

  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  // Previouscolor.
  
  const named = CSS_COLORS[v]
  if (named) return { r: named[0], g: named[1], b: named[2] }

  // #RGB, #RRGGBB
  if (v.charCodeAt(0) === 0x23) { // #
    if (v.length === 4) {
      const r = parseInt(v[1]! + v[1]!, 16)
      const g = parseInt(v[2]! + v[2]!, 16)
      const b = parseInt(v[3]! + v[3]!, 16)
      return { r, g, b }
    }
    if (v.length === 5) {
      const r = parseInt(v[1]! + v[1]!, 16)
      const g = parseInt(v[2]! + v[2]!, 16)
      const b = parseInt(v[3]! + v[3]!, 16)
      const a = parseInt(v[4]! + v[4]!, 16) / 255
      return { r, g, b, a }
    }
    if (v.length === 7) {
      return { r: parseInt(v.substring(1, 3), 16), g: parseInt(v.substring(3, 5), 16), b: parseInt(v.substring(5, 7), 16) }
    }
    if (v.length === 9) {
      return {
        r: parseInt(v.substring(1, 3), 16),
        g: parseInt(v.substring(3, 5), 16),
        b: parseInt(v.substring(5, 7), 16),
        a: parseInt(v.substring(7, 9), 16) / 255,
      }
    }
  }

  if (v.startsWith('rgb(') || v.startsWith('rgba(')) {
    const rgb = parseRgbFunction(v)
    if (rgb) return rgb
  }
  if (v.startsWith('hsl(') || v.startsWith('hsla(')) {
    const rgb = parseHslFunction(v)
    if (rgb) return rgb
  }

  return { r: 0, g: 0, b: 0 }
}

function parseRgbFunction(v: string): SvgColor | null {
  const open = v.indexOf('(')
  const close = v.lastIndexOf(')')
  if (open < 0 || close <= open) return null
  const raw = v.substring(open + 1, close).trim()
  if (!raw) return null

  let colorPart = raw
  let alphaPart: string | undefined
  const slash = raw.indexOf('/')
  if (slash >= 0) {
    colorPart = raw.substring(0, slash).trim()
    alphaPart = raw.substring(slash + 1).trim()
  }

  let comps: string[]
  if (colorPart.includes(',')) {
    comps = colorPart.split(',').map(p => p.trim()).filter(Boolean)
  } else {
    comps = colorPart.split(/\s+/).map(p => p.trim()).filter(Boolean)
  }
  if (comps.length < 3) return null

  const r = parseRgbChannel(comps[0]!)
  const g = parseRgbChannel(comps[1]!)
  const b = parseRgbChannel(comps[2]!)
  if (r == null || g == null || b == null) return null

  if (!alphaPart && comps.length >= 4) {
    alphaPart = comps[3]
  }
  const a = alphaPart != null ? parseAlphaChannel(alphaPart) : undefined
  return a == null
    ? { r, g, b }
    : { r, g, b, a }
}

function parseHslFunction(v: string): SvgColor | null {
  const open = v.indexOf('(')
  const close = v.lastIndexOf(')')
  if (open < 0 || close <= open) return null
  const raw = v.substring(open + 1, close).trim()
  if (!raw) return null

  let colorPart = raw
  let alphaPart: string | undefined
  const slash = raw.indexOf('/')
  if (slash >= 0) {
    colorPart = raw.substring(0, slash).trim()
    alphaPart = raw.substring(slash + 1).trim()
  }

  let comps: string[]
  if (colorPart.includes(',')) {
    comps = colorPart.split(',').map(p => p.trim()).filter(Boolean)
  } else {
    comps = colorPart.split(/\s+/).map(p => p.trim()).filter(Boolean)
  }
  if (comps.length < 3) return null

  const h = parseHue(comps[0]!)
  const s = parsePercent01(comps[1]!)
  const l = parsePercent01(comps[2]!)
  if (h == null || s == null || l == null) return null

  const rgb = hslToRgb(h, s, l)
  if (!alphaPart && comps.length >= 4) {
    alphaPart = comps[3]
  }
  const a = alphaPart != null ? parseAlphaChannel(alphaPart) : undefined
  return a == null
    ? rgb
    : { ...rgb, a }
}

function parseRgbChannel(token: string): number | null {
  const t = token.trim()
  if (!t) return null
  if (t.endsWith('%')) {
    const n = parseFloat(t.slice(0, -1))
    if (!Number.isFinite(n)) return null
    return Math.round(clamp01(n / 100) * 255)
  }
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.min(255, Math.max(0, n)))
}

function parseAlphaChannel(token: string): number | null {
  const t = token.trim()
  if (!t) return null
  if (t.endsWith('%')) {
    const n = parseFloat(t.slice(0, -1))
    if (!Number.isFinite(n)) return null
    return clamp01(n / 100)
  }
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return clamp01(n)
}

function parsePercent01(token: string): number | null {
  const t = token.trim()
  if (!t.endsWith('%')) return null
  const n = parseFloat(t.slice(0, -1))
  if (!Number.isFinite(n)) return null
  return clamp01(n / 100)
}

function parseHue(token: string): number | null {
  const t = token.trim()
  if (!t) return null
  let value = 0
  if (t.endsWith('deg')) {
    value = parseFloat(t.slice(0, -3))
  } else if (t.endsWith('grad')) {
    value = parseFloat(t.slice(0, -4)) * 0.9
  } else if (t.endsWith('rad')) {
    value = parseFloat(t.slice(0, -3)) * 180 / Math.PI
  } else if (t.endsWith('turn')) {
    value = parseFloat(t.slice(0, -4)) * 360
  } else {
    value = parseFloat(t)
  }
  if (!Number.isFinite(value)) return null
  const h = value % 360
  return h < 0 ? h + 360 : h
}

function hslToRgb(hDeg: number, s: number, l: number): SvgColor {
  const h = ((hDeg % 360) + 360) % 360 / 360
  if (s <= 1e-9) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hueToRgb(p, q, h + 1 / 3)
  const g = hueToRgb(p, q, h)
  const b = hueToRgb(p, q, h - 1 / 3)
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  }
}

function hueToRgb(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

// Transform parser.

/** Convert an SVG transform attribute string into a matrix. */
export function parseTransform(s: string): SvgMatrix {
  let result: SvgMatrix = [1, 0, 0, 1, 0, 0]
  let i = 0
  const len = s.length

  while (i < len) {
    while (i < len && isWhitespace(s.charCodeAt(i))) i++
    if (i >= len) break

    // Function.
    
    const fnStart = i
    while (i < len && s.charCodeAt(i) !== 0x28) i++ // (
    const fn = s.substring(fnStart, i).trim()
    i++ // skip (
    const argsStart = i
    while (i < len && s.charCodeAt(i) !== 0x29) i++ // )
    const argsStr = s.substring(argsStart, i)
    i++ // skip )

    const args = argsStr.split(/[\s,]+/).map(Number)

    let m: SvgMatrix
    switch (fn) {
      case 'translate':
        m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]
        break
      case 'scale': {
        const sx = args[0] ?? 1
        const sy = args[1] ?? sx
        m = [sx, 0, 0, sy, 0, 0]
        break
      }
      case 'rotate': {
        const angle = (args[0] ?? 0) * Math.PI / 180
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        if (args.length >= 3) {
          const cx = args[1] ?? 0
          const cy = args[2] ?? 0
          // rotate(angle, cx, cy) = translate(cx,cy) * rotate(angle) * translate(-cx,-cy)
          m = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]
        } else {
          m = [cos, sin, -sin, cos, 0, 0]
        }
        break
      }
      case 'skewX': {
        const angle = (args[0] ?? 0) * Math.PI / 180
        m = [1, 0, Math.tan(angle), 1, 0, 0]
        break
      }
      case 'skewY': {
        const angle = (args[0] ?? 0) * Math.PI / 180
        m = [1, Math.tan(angle), 0, 1, 0, 0]
        break
      }
      case 'matrix':
        m = [args[0] ?? 1, args[1] ?? 0, args[2] ?? 0, args[3] ?? 1, args[4] ?? 0, args[5] ?? 0]
        break
      default:
        continue
    }

    result = multiplyMatrix(result, m)

    // Skip separators between transform functions.
    while (i < len && (isWhitespace(s.charCodeAt(i)) || s.charCodeAt(i) === 0x2C)) i++
  }

  return result
}

/* Rowcolumn. */

export function multiplyMatrix(a: SvgMatrix, b: SvgMatrix): SvgMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

// Utilities.


function parseViewBox(s: string): { x: number, y: number, width: number, height: number } | null {
  if (!s) return null
  const parts = s.trim().split(/[\s,]+/)
  if (parts.length < 4) return null
  return {
    x: parseFloat(parts[0]!),
    y: parseFloat(parts[1]!),
    width: parseFloat(parts[2]!),
    height: parseFloat(parts[3]!),
  }
}

function parseLengthAttr(s: string | undefined, fallback: number): number {
  if (!s) return fallback
  return parseAbsoluteLength(s, fallback)
}

function parseLengthInViewport(
  s: string | undefined,
  axis: 'x' | 'y' | 'other',
  viewport: { width: number, height: number },
  fallback: number,
): number {
  if (!s) return fallback
  const v = s.trim()
  if (!v) return fallback
  const base = axis === 'x' ? viewport.width : axis === 'y' ? viewport.height : Math.min(viewport.width, viewport.height)
  if (v.startsWith('calc(') && v.endsWith(')')) return parseCalculatedLength(v, base, fallback)
  if (v.endsWith('%')) {
    const ratio = parseFloat(v.slice(0, -1))
    if (!Number.isFinite(ratio)) return fallback
    return base * ratio / 100
  }
  return parseAbsoluteLength(v, fallback)
}

function parseLengthInUnits(
  s: string | undefined,
  units: 'userSpaceOnUse' | 'objectBoundingBox',
  axis: 'x' | 'y' | 'other',
  viewport: { width: number, height: number },
  fallback: number,
): number {
  if (!s) return fallback
  const v = s.trim()
  if (!v) return fallback
  const base = units === 'objectBoundingBox'
    ? 1
    : axis === 'x' ? viewport.width : axis === 'y' ? viewport.height : Math.min(viewport.width, viewport.height)
  if (v.startsWith('calc(') && v.endsWith(')')) return parseCalculatedLength(v, base, fallback)
  if (v.endsWith('%')) {
    const ratio = parseFloat(v.slice(0, -1))
    if (!Number.isFinite(ratio)) return fallback
    if (units === 'objectBoundingBox') return ratio / 100
    const base = axis === 'x'
      ? viewport.width
      : axis === 'y'
        ? viewport.height
        : Math.min(viewport.width, viewport.height)
    return base * ratio / 100
  }
  return parseAbsoluteLength(v, fallback)
}

function parseGradientCoord(
  s: string | undefined,
  fallback: number,
  units: 'userSpaceOnUse' | 'objectBoundingBox',
  axis: 'x' | 'y' | 'other',
  viewport: { width: number, height: number },
): number {
  if (!s) return fallback
  const v = s.trim()
  if (!v) return fallback
  if (v.endsWith('%')) {
    const p = parseFloat(v.slice(0, -1))
    if (!Number.isFinite(p)) return fallback
    if (units === 'objectBoundingBox') return p / 100
    const base = axis === 'x'
      ? viewport.width
      : axis === 'y'
        ? viewport.height
        : Math.min(viewport.width, viewport.height)
    return base * p / 100
  }
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function parseAbsoluteLength(s: string, fallback: number): number {
  const v = s.trim()
  if (!v) return fallback
  if (v.startsWith('calc(') && v.endsWith(')')) return parseCalculatedLength(v, undefined, fallback)
  return parseSingleAbsoluteLength(v, fallback)
}

function parseSingleAbsoluteLength(v: string, fallback: number): number {
  const m = v.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([a-z%]*)$/)
  if (!m) return fallback
  const value = parseFloat(m[1]!)
  if (!Number.isFinite(value)) return fallback
  const unit = (m[2] ?? '').toLowerCase()
  switch (unit) {
    case '':
    case 'px':
      return value
    case 'pt':
      return value * (96 / 72)
    case 'pc':
      return value * 16
    case 'in':
      return value * 96
    case 'cm':
      return value * (96 / 2.54)
    case 'mm':
      return value * (96 / 25.4)
    case 'q':
      return value * (96 / 101.6)
    default:
      return value
  }
}

interface CalcLengthState {
  source: string
  offset: number
  percentageBase?: number
}

interface CalcLengthValue {
  value: number
  dimension: 'number' | 'length'
}

function parseCalculatedLength(value: string, percentageBase: number | undefined, fallback: number): number {
  const state: CalcLengthState = { source: value.slice(5, -1), offset: 0, percentageBase }
  const result = parseCalcSum(state)
  skipCalcWhitespace(state)
  return state.offset === state.source.length && result.dimension === 'length' && Number.isFinite(result.value)
    ? result.value
    : fallback
}

function parseCalcSum(state: CalcLengthState): CalcLengthValue {
  let result = parseCalcProduct(state)
  while (true) {
    skipCalcWhitespace(state)
    const operator = state.source[state.offset]
    if (operator !== '+' && operator !== '-') return result
    state.offset++
    const right = parseCalcProduct(state)
    if (right.dimension !== result.dimension) return { value: Number.NaN, dimension: 'length' }
    result = { value: operator === '+' ? result.value + right.value : result.value - right.value, dimension: result.dimension }
  }
}

function parseCalcProduct(state: CalcLengthState): CalcLengthValue {
  let result = parseCalcFactor(state)
  while (true) {
    skipCalcWhitespace(state)
    const operator = state.source[state.offset]
    if (operator !== '*' && operator !== '/') return result
    state.offset++
    const right = parseCalcFactor(state)
    if (operator === '*') {
      if (result.dimension === 'length' && right.dimension === 'length') return { value: Number.NaN, dimension: 'length' }
      result = { value: result.value * right.value, dimension: result.dimension === 'length' || right.dimension === 'length' ? 'length' : 'number' }
    } else {
      if (right.dimension !== 'number' || right.value === 0) return { value: Number.NaN, dimension: 'length' }
      result = { value: result.value / right.value, dimension: result.dimension }
    }
  }
}

function parseCalcFactor(state: CalcLengthState): CalcLengthValue {
  skipCalcWhitespace(state)
  if (state.source[state.offset] === '(') {
    state.offset++
    const value = parseCalcSum(state)
    skipCalcWhitespace(state)
    if (state.source[state.offset] !== ')') return { value: Number.NaN, dimension: 'length' }
    state.offset++
    return value
  }
  const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:[a-zA-Z%]+)?/.exec(state.source.slice(state.offset))
  if (match === null) return { value: Number.NaN, dimension: 'length' }
  state.offset += match[0].length
  const unit = /[a-zA-Z%]+$/.exec(match[0])?.[0]?.toLowerCase() ?? ''
  const numeric = Number.parseFloat(match[0])
  if (unit === '') return { value: numeric, dimension: 'number' }
  if (unit === '%') {
    if (state.percentageBase === undefined) return { value: Number.NaN, dimension: 'length' }
    return { value: numeric * state.percentageBase / 100, dimension: 'length' }
  }
  return { value: parseSingleAbsoluteLength(match[0], Number.NaN), dimension: 'length' }
}

function skipCalcWhitespace(state: CalcLengthState): void {
  while (state.offset < state.source.length && isWhitespace(state.source.charCodeAt(state.offset))) state.offset++
}

function parsePoints(s: string): Float32Array {
  const parts = s.trim().split(/[\s,]+/)
  const result = new Float32Array(parts.length)
  for (let i = 0; i < parts.length; i++) {
    result[i] = parseFloat(parts[i]!)
  }
  return result
}

/* CSS previouscolortable () */

const CSS_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  aqua: [0, 255, 255],
  fuchsia: [255, 0, 255],
  lime: [0, 255, 0],
  coral: [255, 127, 80],
  salmon: [250, 128, 114],
  gold: [255, 215, 0],
  khaki: [240, 230, 140],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  plum: [221, 160, 221],
  tan: [210, 180, 140],
  crimson: [220, 20, 60],
  turquoise: [64, 224, 208],
  tomato: [255, 99, 71],
  sienna: [160, 82, 45],
  peru: [205, 133, 63],
  orchid: [218, 112, 214],
  linen: [250, 240, 230],
  ivory: [255, 255, 240],
  honeydew: [240, 255, 240],
  gainsboro: [220, 220, 220],
  firebrick: [178, 34, 34],
  chocolate: [210, 105, 30],
  chartreuse: [127, 255, 0],
  beige: [245, 245, 220],
  azure: [240, 255, 255],
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aquamarine: [127, 255, 212],
  bisque: [255, 228, 196],
  blanchedalmond: [255, 235, 205],
  blueviolet: [138, 43, 226],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  ghostwhite: [248, 248, 255],
  goldenrod: [218, 165, 32],
  greenyellow: [173, 255, 47],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  limegreen: [50, 205, 50],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 111, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  oldlace: [253, 245, 230],
  olivedrab: [107, 142, 35],
  orangered: [255, 69, 0],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  powderblue: [176, 224, 230],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  thistle: [216, 191, 216],
  wheat: [245, 222, 179],
  whitesmoke: [245, 245, 245],
  yellowgreen: [154, 205, 50],
}
