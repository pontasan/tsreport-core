/** XML 1.0 Fifth Edition NMTOKEN validation used by PDF name-list namespaces. */
export function isXmlNmToken(value: string): boolean {
  if (value.length === 0) return false
  let offset = 0
  while (offset < value.length) {
    const codePoint = value.codePointAt(offset)!
    if (!isXmlNameCharacter(codePoint)) return false
    offset += codePoint > 0xFFFF ? 2 : 1
  }
  return true
}

/** XML 1.0 Name validation. */
export function isXmlName(value: string): boolean {
  if (value.length === 0) return false
  let offset = 0
  let codePoint = value.codePointAt(offset)!
  if (!isXmlNameStartCharacter(codePoint)) return false
  offset += codePoint > 0xFFFF ? 2 : 1
  while (offset < value.length) {
    codePoint = value.codePointAt(offset)!
    if (!isXmlNameCharacter(codePoint)) return false
    offset += codePoint > 0xFFFF ? 2 : 1
  }
  return true
}

/** XML Namespaces NCName validation. */
export function isXmlNcName(value: string): boolean {
  return !value.includes(':') && isXmlName(value)
}

function isXmlNameStartCharacter(codePoint: number): boolean {
  return codePoint === 0x3A || codePoint === 0x5F
    || (codePoint >= 0x41 && codePoint <= 0x5A)
    || (codePoint >= 0x61 && codePoint <= 0x7A)
    || (codePoint >= 0xC0 && codePoint <= 0xD6)
    || (codePoint >= 0xD8 && codePoint <= 0xF6)
    || (codePoint >= 0xF8 && codePoint <= 0x2FF)
    || (codePoint >= 0x370 && codePoint <= 0x37D)
    || (codePoint >= 0x37F && codePoint <= 0x1FFF)
    || (codePoint >= 0x200C && codePoint <= 0x200D)
    || (codePoint >= 0x2070 && codePoint <= 0x218F)
    || (codePoint >= 0x2C00 && codePoint <= 0x2FEF)
    || (codePoint >= 0x3001 && codePoint <= 0xD7FF)
    || (codePoint >= 0xF900 && codePoint <= 0xFDCF)
    || (codePoint >= 0xFDF0 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0xEFFFF)
}

function isXmlNameCharacter(codePoint: number): boolean {
  return codePoint === 0x2D || codePoint === 0x2E || codePoint === 0x3A || codePoint === 0x5F
    || (codePoint >= 0x30 && codePoint <= 0x39)
    || (codePoint >= 0x41 && codePoint <= 0x5A)
    || (codePoint >= 0x61 && codePoint <= 0x7A)
    || codePoint === 0xB7
    || (codePoint >= 0xC0 && codePoint <= 0xD6)
    || (codePoint >= 0xD8 && codePoint <= 0xF6)
    || (codePoint >= 0xF8 && codePoint <= 0x2FF)
    || (codePoint >= 0x300 && codePoint <= 0x36F)
    || (codePoint >= 0x370 && codePoint <= 0x37D)
    || (codePoint >= 0x37F && codePoint <= 0x1FFF)
    || (codePoint >= 0x200C && codePoint <= 0x200D)
    || (codePoint >= 0x203F && codePoint <= 0x2040)
    || (codePoint >= 0x2070 && codePoint <= 0x218F)
    || (codePoint >= 0x2C00 && codePoint <= 0x2FEF)
    || (codePoint >= 0x3001 && codePoint <= 0xD7FF)
    || (codePoint >= 0xF900 && codePoint <= 0xFDCF)
    || (codePoint >= 0xFDF0 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0xEFFFF)
}
