/**
 * Markup parser (HTML subset + styled text)
 *
 * Rich text support: parses the <b>, <i>, <u>, <s>, <font>, <br>, <sup>, <sub> tags and
 * the styled-text <style> tag
 * (forecolor, size, fontName, isBold, isItalic, isUnderline, isStrikeThrough),
 * returning an array of styled text runs.
 */

export interface StyledRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontFamily?: string
  fontSize?: number
  color?: string
  superscript?: boolean
  subscript?: boolean
}

/**
 * Parses HTML markup and returns an array of StyledRun
 */
export function parseMarkup(html: string): StyledRun[] {
  const runs: StyledRun[] = []
  const styleStack: Partial<StyledRun>[] = [{}]

  let pos = 0
  while (pos < html.length) {
    if (html[pos] === '<') {
      const tagEnd = html.indexOf('>', pos)
      if (tagEnd === -1) {
        // Incomplete tag → treat as text
        runs.push({ ...currentStyle(styleStack), text: html.slice(pos) })
        break
      }

      const tagContent = html.slice(pos + 1, tagEnd).trim()
      pos = tagEnd + 1

      if (tagContent.startsWith('/')) {
        // Closing tag
        const tagName = tagContent.slice(1).trim().toLowerCase()
        popStyle(styleStack, tagName)
      } else if (/^br\s*\/?$/i.test(tagContent)) {
        // <br> → newline
        runs.push({ ...currentStyle(styleStack), text: '\n' })
      } else {
        // Opening tag
        const style = parseOpenTag(tagContent)
        if (style) {
          styleStack.push(style)
        }
      }
    } else {
      // Text portion
      const nextTag = html.indexOf('<', pos)
      const textEnd = nextTag === -1 ? html.length : nextTag
      const text = decodeEntities(html.slice(pos, textEnd))
      if (text.length > 0) {
        runs.push({ ...currentStyle(styleStack), text })
      }
      pos = textEnd
    }
  }

  return runs
}

function currentStyle(stack: Partial<StyledRun>[]): Partial<StyledRun> {
  const merged: Partial<StyledRun> = {}
  for (const style of stack) {
    if (style.bold !== undefined) merged.bold = style.bold
    if (style.italic !== undefined) merged.italic = style.italic
    if (style.underline !== undefined) merged.underline = style.underline
    if (style.strikethrough !== undefined) merged.strikethrough = style.strikethrough
    if (style.fontFamily !== undefined) merged.fontFamily = style.fontFamily
    if (style.fontSize !== undefined) merged.fontSize = style.fontSize
    if (style.color !== undefined) merged.color = style.color
    if (style.superscript !== undefined) merged.superscript = style.superscript
    if (style.subscript !== undefined) merged.subscript = style.subscript
  }
  return merged
}

function popStyle(stack: Partial<StyledRun>[], tagName: string): void {
  // Find and remove the matching style (search from the back)
  for (let i = stack.length - 1; i >= 1; i--) {
    const style = stack[i]!
    if (matchesTag(style, tagName)) {
      stack.splice(i, 1)
      return
    }
  }
}

function matchesTag(style: Partial<StyledRun>, tagName: string): boolean {
  switch (tagName) {
    case 'b': case 'strong': return style.bold === true
    case 'i': case 'em': return style.italic === true
    case 'u': return style.underline === true
    case 's': case 'strike': case 'del': return style.strikethrough === true
    case 'font': return style.fontFamily !== undefined || style.fontSize !== undefined || style.color !== undefined
    case 'style': return style.fontFamily !== undefined || style.fontSize !== undefined || style.color !== undefined
      || style.bold !== undefined || style.italic !== undefined || style.underline !== undefined
      || style.strikethrough !== undefined
    case 'sup': return style.superscript === true
    case 'sub': return style.subscript === true
    default: return false
  }
}

function parseOpenTag(tagContent: string): Partial<StyledRun> | null {
  // Extract the tag name
  const spaceIdx = tagContent.indexOf(' ')
  const tagName = (spaceIdx === -1 ? tagContent : tagContent.slice(0, spaceIdx)).toLowerCase()
  const attrs = spaceIdx === -1 ? '' : tagContent.slice(spaceIdx + 1)

  switch (tagName) {
    case 'b': case 'strong':
      return { bold: true }
    case 'i': case 'em':
      return { italic: true }
    case 'u':
      return { underline: true }
    case 's': case 'strike': case 'del':
      return { strikethrough: true }
    case 'sup':
      return { superscript: true }
    case 'sub':
      return { subscript: true }
    case 'font': {
      const style: Partial<StyledRun> = {}
      const face = extractAttr(attrs, 'face')
      if (face) style.fontFamily = face
      const size = extractAttr(attrs, 'size')
      if (size) style.fontSize = parseFloat(size)
      const color = extractAttr(attrs, 'color')
      if (color) style.color = color
      // Do not push onto the stack when there are no attributes (matchesTag would fail to find the matching closing tag)
      if (Object.keys(style).length === 0) return null
      return style
    }
    case 'style': {
      // styled-text <style> tag
      const style: Partial<StyledRun> = {}
      const fontName = extractAttr(attrs, 'fontName')
      if (fontName) style.fontFamily = fontName
      const size = extractAttr(attrs, 'size')
      if (size) style.fontSize = parseFloat(size)
      const forecolor = extractAttr(attrs, 'forecolor')
      if (forecolor) style.color = forecolor
      const isBold = extractAttr(attrs, 'isBold')
      if (isBold !== null) style.bold = isBold === 'true'
      const isItalic = extractAttr(attrs, 'isItalic')
      if (isItalic !== null) style.italic = isItalic === 'true'
      const isUnderline = extractAttr(attrs, 'isUnderline')
      if (isUnderline !== null) style.underline = isUnderline === 'true'
      const isStrikeThrough = extractAttr(attrs, 'isStrikeThrough')
      if (isStrikeThrough !== null) style.strikethrough = isStrikeThrough === 'true'
      if (Object.keys(style).length === 0) return null
      return style
    }
    default:
      return null
  }
}

function extractAttr(attrs: string, name: string): string | null {
  // name="value" or name='value'
  const regex = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = attrs.match(regex)
  return match ? match[1]! : null
}

function decodeEntities(text: string): string {
  // Process &amp; last (decoding it first would double-decode &amp;lt; → &lt; → <)
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&')
}
