import { describe, expect, it } from 'vitest'
import { adobeCMapResource, ADOBE_CMAP_RESOURCE_COMMIT, ADOBE_CMAP_RESOURCE_NAMES } from '../../src/pdf/adobe-cmap-resources.js'
import { identityPdfCMap, parsePdfCMap, type PdfCMap } from '../../src/pdf/pdf-cmap.js'

describe('Adobe predefined PDF CMaps', () => {
  it('pins and parses every official CMap resource without runtime filesystem access', () => {
    expect(ADOBE_CMAP_RESOURCE_COMMIT).toBe('f5cf3bca7fdfeaceb77aa82847e974f2306c20b4')
    expect(ADOBE_CMAP_RESOURCE_NAMES).toHaveLength(202)
    const cache = new Map<string, PdfCMap>()
    const loading = new Set<string>()
    const resolve = (name: string): PdfCMap => {
      if (name === 'Identity-H') return identityPdfCMap(false)
      if (name === 'Identity-V') return identityPdfCMap(true)
      const cached = cache.get(name)
      if (cached !== undefined) return cached
      expect(loading.has(name)).toBe(false)
      const resource = adobeCMapResource(name)
      expect(resource, name).not.toBeNull()
      loading.add(name)
      const cmap = parsePdfCMap(resource!, null, resolve)
      loading.delete(name)
      cache.set(name, cmap)
      return cmap
    }
    for (const name of ADOBE_CMAP_RESOURCE_NAMES) resolve(name)

    const japanese = resolve('UniJIS-UTF16-H')
    const hiraganaA = japanese.decode(new Uint8Array([0x30, 0x42]))[0]!
    expect(japanese.cid(hiraganaA)).toBeGreaterThan(0)
    expect(japanese.wMode).toBe(0)
    expect(resolve('UniJIS-UTF16-V').wMode).toBe(1)
  }, 30_000)
})
