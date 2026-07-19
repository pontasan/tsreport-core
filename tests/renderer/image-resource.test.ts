import { describe, expect, it } from 'vitest'
import { resolveImageResource } from '../../src/renderer/image-resource.js'
import { BackendImageResources, copyImageResourceMap, mergeImageResourceMaps } from '../../src/image-resource-map.js'

describe('image resource URL classification', function () {
  it.each([
    'http://example.test/image.png',
    'https://example.test/image.png',
    'blob:https://example.test/id',
  ])('classifies supported external URL %s', function (source) {
    expect(resolveImageResource({ image: source }, 'image')).toEqual({ kind: 'external-url', url: source })
  })

  it.each(['httpx', 'httpsx', 'blobx'])('does not classify prefix-only value %s as an external URL', function (source) {
    expect(resolveImageResource({ image: source }, 'image').kind).toBe('unsupported')
  })
})

describe('image resource map ownership', function () {
  it('copies a supplied map instead of retaining the caller-owned object', function () {
    const source = { image: new Uint8Array([1]) }
    const copy = copyImageResourceMap(source)
    copy.generated = new Uint8Array([2])
    expect(copy).not.toBe(source)
    expect(Object.keys(source)).toEqual(['image'])
  })

  it('returns an owned map when only one merge side is present', function () {
    const documentImages = { image: new Uint8Array([1]) }
    const merged = mergeImageResourceMaps(documentImages, undefined)
    merged.generated = new Uint8Array([2])
    expect(merged).not.toBe(documentImages)
    expect(Object.keys(documentImages)).toEqual(['image'])
  })

  it('shares one constructor, document, and page lifecycle across render backends', function () {
    const suppliedImages = { shared: new Uint8Array([1]), supplied: new Uint8Array([2]) }
    const documentImages = { shared: new Uint8Array([3]), document: new Uint8Array([4]) }
    const resources = new BackendImageResources(suppliedImages)

    resources.beginDocument()
    resources.setDocumentImages(documentImages)
    expect(resources.images.shared).toBe(suppliedImages.shared)
    expect(resources.images.document).toBe(documentImages.document)
    resources.images.generated = new Uint8Array([5])
    expect(Object.keys(suppliedImages)).toEqual(['shared', 'supplied'])
    expect(Object.keys(documentImages)).toEqual(['shared', 'document'])

    resources.beginPage()
    expect(() => resources.setDocumentImages(documentImages)).toThrow(
      'Image resources must be set before the first page begins',
    )

    resources.beginDocument()
    expect(Object.keys(resources.images).sort()).toEqual(['shared', 'supplied'])
  })
})
