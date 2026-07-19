export type ImageResourceMap = Record<string, string | Uint8Array>

export function copyImageResourceMap(source: ImageResourceMap): ImageResourceMap {
  const copy: ImageResourceMap = {}
  const keys = Object.keys(source)
  for (let imageIndex = 0; imageIndex < keys.length; imageIndex++) {
    const imageId = keys[imageIndex]!
    copy[imageId] = source[imageId]!
  }
  return copy
}

export function mergeImageResourceMaps(
  base: ImageResourceMap,
  overrides: ImageResourceMap | undefined,
): ImageResourceMap {
  const merged: ImageResourceMap = {}
  const baseKeys = Object.keys(base)
  for (let imageIndex = 0; imageIndex < baseKeys.length; imageIndex++) {
    const imageId = baseKeys[imageIndex]!
    merged[imageId] = base[imageId]!
  }
  if (overrides === undefined) return merged
  const overrideKeys = Object.keys(overrides)
  for (let imageIndex = 0; imageIndex < overrideKeys.length; imageIndex++) {
    const imageId = overrideKeys[imageIndex]!
    merged[imageId] = overrides[imageId]!
  }
  return merged
}

export class BackendImageResources {
  private readonly suppliedImages: ImageResourceMap | undefined
  private currentImages: ImageResourceMap
  private drawingStarted = false

  constructor(suppliedImages: ImageResourceMap | undefined) {
    this.suppliedImages = suppliedImages === undefined ? undefined : copyImageResourceMap(suppliedImages)
    this.currentImages = this.copySuppliedImages()
  }

  get images(): ImageResourceMap {
    return this.currentImages
  }

  beginDocument(): void {
    this.currentImages = this.copySuppliedImages()
    this.drawingStarted = false
  }

  beginPage(): void {
    this.drawingStarted = true
  }

  setDocumentImages(images: ImageResourceMap): void {
    if (this.drawingStarted) throw new Error('Image resources must be set before the first page begins')
    this.currentImages = mergeImageResourceMaps(images, this.suppliedImages)
  }

  private copySuppliedImages(): ImageResourceMap {
    if (this.suppliedImages === undefined) return {}
    return copyImageResourceMap(this.suppliedImages)
  }
}
