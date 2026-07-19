const GRANDFATHERED_LANGUAGE_TAGS = new Set([
  'art-lojban', 'cel-gaulish', 'en-gb-oed', 'i-ami', 'i-bnn', 'i-default', 'i-enochian',
  'i-hak', 'i-klingon', 'i-lux', 'i-mingo', 'i-navajo', 'i-pwn', 'i-tao', 'i-tay', 'i-tsu',
  'no-bok', 'no-nyn', 'sgn-be-fr', 'sgn-be-nl', 'sgn-ch-de', 'zh-guoyu', 'zh-hakka',
  'zh-min', 'zh-min-nan', 'zh-xiang',
])

const ALPHA = /^[A-Za-z]+$/
const ALNUM = /^[A-Za-z0-9]+$/

/** Validates the complete structural grammar of an RFC 5646 / BCP 47 tag. */
export function validateBcp47LanguageTag(tag: string, label = 'language tag'): void {
  if (tag === 'x-default') return
  const lower = tag.toLowerCase()
  if (GRANDFATHERED_LANGUAGE_TAGS.has(lower)) return
  const subtags = tag.split('-')
  if (subtags.some(function (subtag) { return subtag.length === 0 })) invalid(label, tag)
  let position = 0
  if (subtags[0]!.toLowerCase() === 'x') {
    if (subtags.length === 1) invalid(label, tag)
    for (let i = 1; i < subtags.length; i++) if (!privateUseSubtag(subtags[i]!)) invalid(label, tag)
    return
  }
  const language = subtags[position++]!
  if (!ALPHA.test(language) || language.length < 2 || language.length > 8) invalid(label, tag)
  if (language.length <= 3) {
    let extlangCount = 0
    while (position < subtags.length && subtags[position]!.length === 3 && ALPHA.test(subtags[position]!) && extlangCount < 3) {
      position++
      extlangCount++
    }
  }
  if (position < subtags.length && subtags[position]!.length === 4 && ALPHA.test(subtags[position]!)) position++
  if (position < subtags.length) {
    const region = subtags[position]!
    if (region.length === 2 && ALPHA.test(region) || region.length === 3 && /^\d{3}$/.test(region)) position++
  }
  const variants = new Set<string>()
  while (position < subtags.length && isVariant(subtags[position]!)) {
    const variant = subtags[position++]!.toLowerCase()
    if (variants.has(variant)) invalid(label, tag)
    variants.add(variant)
  }
  const singletons = new Set<string>()
  while (position < subtags.length && isExtensionSingleton(subtags[position]!)) {
    const singleton = subtags[position++]!.toLowerCase()
    if (singletons.has(singleton)) invalid(label, tag)
    singletons.add(singleton)
    const start = position
    while (position < subtags.length && subtags[position]!.length >= 2 && subtags[position]!.length <= 8 && ALNUM.test(subtags[position]!)) position++
    if (position === start) invalid(label, tag)
  }
  if (position < subtags.length && subtags[position]!.toLowerCase() === 'x') {
    position++
    const start = position
    while (position < subtags.length && privateUseSubtag(subtags[position]!)) position++
    if (position === start) invalid(label, tag)
  }
  if (position !== subtags.length) invalid(label, tag)
}

function isVariant(subtag: string): boolean {
  return ALNUM.test(subtag) && (subtag.length >= 5 && subtag.length <= 8 || subtag.length === 4 && /^\d/.test(subtag))
}

function isExtensionSingleton(subtag: string): boolean {
  return subtag.length === 1 && /^[0-9A-WY-Za-wy-z]$/.test(subtag)
}

function privateUseSubtag(subtag: string): boolean {
  return subtag.length >= 1 && subtag.length <= 8 && ALNUM.test(subtag)
}

function invalid(label: string, tag: string): never {
  throw new Error(`${label} is not a valid BCP 47 language tag: ${tag}`)
}
