import { parseXmlDocument, xmlChildElements, xmlTextContent, type XmlElement } from '../xml/xml-parser.js'
import { validateBcp47LanguageTag } from './language-tag.js'

const PLS_NAMESPACE = 'http://www.w3.org/2005/01/pronunciation-lexicon'

export interface PdfPronunciation {
  value: string
  alphabet: string
}

export interface PdfPronunciationLexeme {
  graphemes: string[]
  pronunciations: PdfPronunciation[]
  aliases: string[]
}

export interface PdfPronunciationLexicon {
  language: string
  alphabet: string
  lexemes: PdfPronunciationLexeme[]
}

export interface PdfResolvedPronunciation {
  lexiconIndex: number
  language: string
  grapheme: string
  phoneme?: string
  alphabet?: string
  alias?: string
}

function localName(name: string): string {
  const separator = name.indexOf(':')
  return separator < 0 ? name : name.slice(separator + 1)
}

function namespacePrefix(name: string): string {
  const separator = name.indexOf(':')
  return separator < 0 ? '' : name.slice(0, separator)
}

function requirePlsNamespace(root: XmlElement): string {
  const prefix = namespacePrefix(root.name)
  const declaration = prefix === '' ? root.attributes.xmlns : root.attributes[`xmlns:${prefix}`]
  if (declaration !== PLS_NAMESPACE) throw new Error(`PDF pronunciation lexicon requires the PLS 1.0 namespace ${PLS_NAMESPACE}`)
  return prefix
}

function requirePlsElement(element: XmlElement, prefix: string, expected: string): void {
  if (localName(element.name) !== expected || namespacePrefix(element.name) !== prefix) {
    throw new Error(`PDF pronunciation lexicon expected PLS ${expected}, found ${element.name}`)
  }
}

function requireCharacterData(element: XmlElement): string {
  if (xmlChildElements(element).length !== 0) throw new Error(`PDF pronunciation lexicon ${element.name} only permits character data`)
  const value = xmlTextContent(element)
  if (value === '') throw new Error(`PDF pronunciation lexicon ${element.name} must not be empty`)
  return value
}

function validateAttributes(element: XmlElement, allowed: Set<string>): void {
  for (const name of Object.keys(element.attributes)) {
    if (!allowed.has(name)) throw new Error(`PDF pronunciation lexicon attribute ${name} is not permitted on ${element.name}`)
  }
}

/** Parses and validates a W3C Pronunciation Lexicon Specification 1.0 document. */
export function parsePdfPronunciationLexicon(data: Uint8Array): PdfPronunciationLexicon {
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    throw new Error('PDF pronunciation lexicon must be UTF-8 XML')
  }
  const declaration = xml.match(/^\ufeff?<\?xml\s+([^?]+)\?>/)
  if (declaration !== null) {
    const encoding = declaration[1]!.match(/(?:^|\s)encoding\s*=\s*(["'])([^"']+)\1/i)
    if (encoding !== null && encoding[2]!.toLowerCase() !== 'utf-8') throw new Error('PDF pronunciation lexicon XML encoding must be UTF-8')
  }
  const root = parseXmlDocument(xml)
  if (localName(root.name) !== 'lexicon') throw new Error('PDF pronunciation lexicon root must be lexicon')
  const prefix = requirePlsNamespace(root)
  const namespaceAttribute = prefix === '' ? 'xmlns' : `xmlns:${prefix}`
  validateAttributes(root, new Set([namespaceAttribute, 'version', 'alphabet', 'xml:lang', 'xml:base']))
  if (root.attributes.version !== '1.0') throw new Error('PDF pronunciation lexicon version must be 1.0')
  const language = root.attributes['xml:lang']
  if (language === undefined || language === '') throw new Error('PDF pronunciation lexicon requires xml:lang')
  validateBcp47LanguageTag(language, 'PDF pronunciation lexicon xml:lang')
  const alphabet = root.attributes.alphabet ?? 'ipa'
  if (alphabet === '') throw new Error('PDF pronunciation lexicon alphabet must not be empty')
  const lexemes: PdfPronunciationLexeme[] = []
  let sawLexeme = false
  const children = xmlChildElements(root)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    const name = localName(child.name)
    if (name === 'meta') {
      if (sawLexeme) throw new Error('PDF pronunciation lexicon meta elements must precede lexemes')
      requirePlsElement(child, prefix, 'meta')
      validateAttributes(child, new Set(['name', 'content']))
      if (child.attributes.name === undefined || child.attributes.content === undefined || child.children.length !== 0) {
        throw new Error('PDF pronunciation lexicon meta requires name/content and no content')
      }
      continue
    }
    if (name === 'metadata') {
      if (sawLexeme) throw new Error('PDF pronunciation lexicon metadata must precede lexemes')
      requirePlsElement(child, prefix, 'metadata')
      continue
    }
    requirePlsElement(child, prefix, 'lexeme')
    sawLexeme = true
    validateAttributes(child, new Set())
    const graphemes: string[] = []
    const pronunciations: PdfPronunciation[] = []
    const aliases: string[] = []
    let phase: 'grapheme' | 'pronunciation' = 'grapheme'
    const lexemeChildren = xmlChildElements(child)
    for (let c = 0; c < lexemeChildren.length; c++) {
      const item = lexemeChildren[c]!
      const itemName = localName(item.name)
      if (itemName === 'grapheme') {
        if (phase !== 'grapheme') throw new Error('PDF pronunciation lexicon graphemes must precede pronunciations')
        requirePlsElement(item, prefix, 'grapheme')
        validateAttributes(item, new Set())
        graphemes.push(requireCharacterData(item))
      } else if (itemName === 'phoneme') {
        phase = 'pronunciation'
        requirePlsElement(item, prefix, 'phoneme')
        validateAttributes(item, new Set(['ph', 'alphabet']))
        const value = item.attributes.ph
        if (value === undefined || value === '' || item.children.some(function (content) { return typeof content !== 'string' || content.trim() !== '' })) {
          throw new Error('PDF pronunciation lexicon phoneme requires ph and no content')
        }
        pronunciations.push({ value, alphabet: item.attributes.alphabet ?? alphabet })
      } else if (itemName === 'alias') {
        phase = 'pronunciation'
        requirePlsElement(item, prefix, 'alias')
        validateAttributes(item, new Set())
        aliases.push(requireCharacterData(item))
      } else {
        throw new Error(`PDF pronunciation lexicon ${item.name} is not permitted in lexeme`)
      }
    }
    if (graphemes.length === 0 || pronunciations.length + aliases.length === 0 || pronunciations.length > 0 && aliases.length > 0) {
      throw new Error('PDF pronunciation lexicon lexeme requires graphemes and either phonemes or aliases')
    }
    lexemes.push({ graphemes, pronunciations, aliases })
  }
  if (lexemes.length === 0) throw new Error('PDF pronunciation lexicon requires at least one lexeme')
  return { language, alphabet, lexemes }
}

/** Resolves a grapheme in document lexicon order, as required by PDF 2.0. */
export function resolvePdfPronunciation(
  lexicons: PdfPronunciationLexicon[],
  grapheme: string,
  language?: string,
): PdfResolvedPronunciation | null {
  for (let i = 0; i < lexicons.length; i++) {
    const lexicon = lexicons[i]!
    if (language !== undefined && lexicon.language.toLowerCase() !== language.toLowerCase()) continue
    for (let l = 0; l < lexicon.lexemes.length; l++) {
      const lexeme = lexicon.lexemes[l]!
      if (!lexeme.graphemes.includes(grapheme)) continue
      if (lexeme.pronunciations.length > 0) {
        return {
          lexiconIndex: i, language: lexicon.language, grapheme,
          phoneme: lexeme.pronunciations[0]!.value, alphabet: lexeme.pronunciations[0]!.alphabet,
        }
      }
      return { lexiconIndex: i, language: lexicon.language, grapheme, alias: lexeme.aliases[0]! }
    }
  }
  return null
}
