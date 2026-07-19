import { getImageDimensions, normalizeImageData } from '../image/image-utils.js'
import { NodeLocalFileResolver } from '../node-file-resolver.js'
import { getNodeRuntimeBridge } from '../node-runtime-bridge.js'
import {
  isBlobUrl,
  isColonlessReference,
  isFileUrl,
  isHttpUrl,
  isPosixAbsolutePath,
  isWindowsAbsolutePath,
} from '../resource-reference.js'
import { currentWorkingDirectory } from '../runtime-environment.js'
import { copyImageResourceMap, mergeImageResourceMaps } from '../image-resource-map.js'

export type ResourceImageResolution = string | null

interface ImageAlternateSource {
  source: string
  defaultForPrinting?: boolean
}

interface ResolvedImageAlternate {
  imageId: string
  defaultForPrinting?: boolean
}

class ResourceResolverState {
  /** Shared state contains only results independent of a resolver view's working directory. */
  readonly localFileResolver: NodeLocalFileResolver | undefined
  readonly isolateRelativeLocalImageIds: boolean
  runtimeImages: Record<string, string | Uint8Array> | null = null
  runtimeImageSizes: Record<string, { width: number; height: number }> | null = null
  readonly localImageData = new Map<string, Uint8Array>()
  readonly localImageIds = new Set<string>()
  readonly localImageIdsByPath = new Map<string, string>()
  runtimeImageCounter = 0
  localImageCounter = 0
  readonly resolverViews = new Map<string, ResourceResolver>()

  constructor(
    fileRoot: string | undefined,
    localFileResolver: NodeLocalFileResolver | undefined,
    isolateRelativeLocalImageIds: boolean,
  ) {
    this.isolateRelativeLocalImageIds = isolateRelativeLocalImageIds
    this.localFileResolver = localFileResolver
      ?? (getNodeRuntimeBridge() === null ? undefined : new NodeLocalFileResolver(fileRoot))
  }
}

export interface ReportResources {
  /** Root directory authorized for built-in local-file image resolution. */
  fileRoot?: string

  /**
   * Static image resource map.
   * Keys are the reference IDs returned by source / sourceExpression on the template side.
   */
  images?: Record<string, string | Uint8Array>

  /**
   * Hints for original image sizes (in pt equivalent).
   * Speeds up retainShape / clip / realSize calculations.
   */
  imageSizes?: Record<string, { width: number; height: number }>

  /**
   * Callback that resolves an image reference ID to actual data.
   * Return value: Uint8Array / data URI / base64 string / blob/http URL / null
   */
  resolveImage?: (ref: string) => string | Uint8Array | null

  /**
   * Callback that resolves the original size from an image reference ID.
   * Same purpose as imageSizes, but supports dynamic resolution.
   */
  resolveImageSize?: (ref: string) => { width: number; height: number } | null
}

/**
 * General-purpose ResourceResolver (currently implements image resources)
 *
 * Background:
 * - Previously, the engine itself directly branched on "images / imageResolver / data URI / dynamic Uint8Array".
 * - Left as-is, resolution logic would stay scattered and layout computation would mix with resource concerns, making regressions likely.
 *
 * Design philosophy:
 * - Normalize resource references in the Resolver before the layout engine uses them, centralizing the information needed for rendering.
 * - Absorb differences in acquisition paths in the Resolver so PDF/Canvas can consume the same RenderDocument.
 * - To avoid breaking existing API compatibility, keep the backward-compatible behavior of "passing imageId through as-is" when images is unspecified.
 *
 * Responsibilities handled here:
 * - Determine imageId from the sourceExpression evaluation result (Uint8Array / string)
 * - Determine image data in priority order: images map, imageResolver, data URI
 * - Cache and return image sizes (from imageSizes or header parsing)
 */
export class ResourceResolver {
  private readonly resources: ReportResources | undefined
  private readonly images: Record<string, string | Uint8Array> | undefined
  private readonly imageSizes: Record<string, { width: number; height: number }> | undefined
  private readonly resolveImage: ((ref: string) => string | Uint8Array | null) | undefined
  private readonly resolveImageSize: ((ref: string) => { width: number; height: number } | null) | undefined
  private readonly useDefaultImageResolver: boolean
  private readonly workingDirectory: string
  private readonly resolveBareLocalFiles: boolean
  private readonly state: ResourceResolverState
  private readonly localImageResolutions = new Map<string, string | null>()
  private readonly alternateResolutions = new WeakMap<readonly ImageAlternateSource[], ResolvedImageAlternate[]>()

  constructor(
    resources?: ReportResources,
    workingDirectory?: string,
    resolveBareLocalFiles = false,
    localFileResolver?: NodeLocalFileResolver,
    state?: ResourceResolverState,
  ) {
    this.resources = resources
    this.images = resources?.images
    this.imageSizes = resources?.imageSizes
    this.resolveImage = resources?.resolveImage
    this.resolveImageSize = resources?.resolveImageSize
    this.useDefaultImageResolver = !resources?.images && !resources?.resolveImage
    this.workingDirectory = workingDirectory ?? currentWorkingDirectory()
    this.state = state ?? new ResourceResolverState(resources?.fileRoot, localFileResolver, !resolveBareLocalFiles)
    this.resolveBareLocalFiles = resolveBareLocalFiles && this.state.localFileResolver !== undefined
  }

  forWorkingDirectory(workingDirectory: string, resolveBareLocalFiles: boolean): ResourceResolver {
    const localResolution = resolveBareLocalFiles && this.state.localFileResolver !== undefined
    const key = workingDirectory + '\0' + localResolution
    let resolver = this.state.resolverViews.get(key)
    if (resolver === undefined) {
      resolver = new ResourceResolver(this.resources, workingDirectory, localResolution, undefined, this.state)
      this.state.resolverViews.set(key, resolver)
    }
    return resolver
  }

  /**
   * Converts a sourceExpression evaluation result to an imageId.
   * - Uint8Array: register internally as a runtime image and return a dynamic ID
   * - null/undefined: imageId undetermined (the caller falls back to the static source)
   * - Otherwise: stringify and use as the imageId
   */
  resolveImageIdFromExpression(value: unknown): string | undefined {
    if (value instanceof Uint8Array) {
      const imageId = '__dyn_' + this.state.runtimeImageCounter++
      this.addRuntimeImage(imageId, value)
      return imageId
    }
    if (value == null) return undefined
    return String(value)
  }

  /**
   * Resolves the actual data behind an imageId.
   *
   * Returns the final image ID for available and passthrough references, or null for missing data.
   */
  ensureImageAvailable(imageId: string): ResourceImageResolution {
    if (this.hasNonLocalImage(imageId)) return imageId

    if (isDataUri(imageId)) {
      // Treat a data URI directly as image data
      this.addRuntimeImage(imageId, imageId)
      return imageId
    }

    if (this.resolveImage) {
      const resolved = this.resolveImage(imageId)
      if (resolved) {
        this.addRuntimeImage(imageId, resolved)
        return imageId
      }
      return null
    }

    if (this.useDefaultImageResolver) {
      const resolveLocalReference = shouldResolveLocalFileReference(imageId, this.resolveBareLocalFiles)
      const resolved = resolveImageByDefault(imageId)
      if (resolved) {
        this.addRuntimeImage(imageId, resolved)
        return imageId
      }
      if (resolveLocalReference) {
        return this.resolveLocalImage(imageId)
      }
    }

    // When the images map is explicitly specified, treat nonexistent keys as missing
    if (this.images) return null

    // Backward compatibility: when neither images nor imageResolver exists, pass imageId through as-is
    return imageId
  }

  resolveImageAlternates(alternates: readonly ImageAlternateSource[]): ResolvedImageAlternate[] {
    const cached = this.alternateResolutions.get(alternates)
    if (cached !== undefined) return cached
    const resolved: ResolvedImageAlternate[] = []
    for (let alternateIndex = 0; alternateIndex < alternates.length; alternateIndex++) {
      const alternate = alternates[alternateIndex]!
      const imageId = this.ensureImageAvailable(alternate.source) ?? alternate.source
      resolved.push({ imageId, defaultForPrinting: alternate.defaultForPrinting })
    }
    this.alternateResolutions.set(alternates, resolved)
    return resolved
  }

  /**
   * Returns the original size of an imageId (in pt equivalent), or null if not found.
   * imageSizes takes priority, then image header parsing (PNG/JPEG/WebP/AVIF) fills in.
   */
  getImageSize(imageId: string, referenceId: string): { width: number; height: number } | null {
    const explicit = this.imageSizes?.[referenceId]
    if (explicit) return explicit

    if (this.resolveImageSize) {
      const resolved = this.resolveImageSize(referenceId)
      if (resolved) {
        if (!this.state.runtimeImageSizes) this.state.runtimeImageSizes = {}
        this.state.runtimeImageSizes[imageId] = resolved
        return resolved
      }
    }

    const cached = this.state.runtimeImageSizes?.[imageId]
    if (cached) return cached

    const data = this.getImageData(imageId)
    if (!data) return null

    if (typeof data === 'string' && !isDecodableInlineImage(data)) return null

    const binary = data instanceof Uint8Array ? data : normalizeImageData(data)
    const dims = getImageDimensions(binary)
    if (!dims) return null

    if (!this.state.runtimeImageSizes) this.state.runtimeImageSizes = {}
    this.state.runtimeImageSizes[imageId] = dims
    return dims
  }

  /**
   * Returns the final image map (base + runtime) to pass to the RenderDocument.
   * Returns undefined if neither exists.
   */
  buildMergedImages(): Record<string, string | Uint8Array> | undefined {
    const runtimeImages = this.state.runtimeImages
    if (this.images === undefined) {
      return runtimeImages == null ? undefined : copyImageResourceMap(runtimeImages)
    }
    return mergeImageResourceMaps(this.images, runtimeImages ?? undefined)
  }

  private hasNonLocalImage(imageId: string): boolean {
    if (this.images && imageId in this.images) return true
    if (this.state.runtimeImages && imageId in this.state.runtimeImages) {
      return !this.state.localImageIds.has(imageId)
    }
    return false
  }

  private getImageData(imageId: string): string | Uint8Array | undefined {
    const runtime = this.state.runtimeImages?.[imageId]
    if (runtime !== undefined) return runtime
    return this.images?.[imageId]
  }

  private addRuntimeImage(imageId: string, data: string | Uint8Array): void {
    if (!this.state.runtimeImages) this.state.runtimeImages = {}
    this.state.runtimeImages[imageId] = data
  }

  private resolveLocalImage(imageRef: string): ResourceImageResolution {
    const cached = this.localImageResolutions.get(imageRef)
    if (cached !== undefined) return cached

    const localFileResolver = this.state.localFileResolver
    if (localFileResolver === undefined) return null
    const resolution = localFileResolver.resolve(imageRef, this.workingDirectory, 'image')
    if (resolution.status === 'missing') {
      this.localImageResolutions.set(imageRef, null)
      return null
    }

    const existingImageId = this.state.localImageIdsByPath.get(resolution.path)
    if (existingImageId !== undefined) {
      this.localImageResolutions.set(imageRef, existingImageId)
      return existingImageId
    }

    let data = this.state.localImageData.get(resolution.path)
    if (data === undefined) {
      const loaded = localFileResolver.readBytes(resolution.path)
      if (loaded === null) {
        this.localImageResolutions.set(imageRef, null)
        return null
      }
      data = loaded
      this.state.localImageData.set(resolution.path, data)
    }
    const isolateImageId = this.state.isolateRelativeLocalImageIds && isRelativeColonlessReference(imageRef)
    const imageId = !isolateImageId && !this.state.localImageIds.has(imageRef)
      ? imageRef
      : imageRef + '\0local:' + this.state.localImageCounter++
    this.state.localImageIds.add(imageId)
    this.state.localImageIdsByPath.set(resolution.path, imageId)
    this.addRuntimeImage(imageId, data)
    this.localImageResolutions.set(imageRef, imageId)
    return imageId
  }
}

function isDataUri(value: string): boolean {
  if (value.length <= 5) return false
  if (value.charCodeAt(0) !== 0x64 /* d */) return false
  if (value.substring(0, 5) !== 'data:') return false
  // data:// is a custom scheme normalized via a separate path.
  if (value.length >= 7 && value.charCodeAt(5) === 0x2F /* / */ && value.charCodeAt(6) === 0x2F /* / */) return false
  return value.indexOf(',') !== -1
}

function isDecodableInlineImage(value: string): boolean {
  if (isDataUri(value)) return true
  if (value.length >= 4) {
    const p4 = value.substring(0, 4)
    if (p4 === 'http' || p4 === 'blob' || p4 === 'file') return false
  }
  return true
}

function resolveImageByDefault(
  imageRef: string,
): string | Uint8Array | null {
  if (!imageRef) return null

  if (isDataUri(imageRef)) return imageRef

  if (isDataScheme(imageRef)) {
    return normalizeDataScheme(imageRef)
  }

  if (isHttpUrl(imageRef) || isBlobUrl(imageRef)) {
    return imageRef
  }

  return null
}

function normalizeDataScheme(value: string): string {
  // Normalize data:// to data: so the existing data URI decode path can be reused.
  // Example: data://image/png;base64,AAAA -> data:image/png;base64,AAAA
  return 'data:' + value.substring(7)
}

function isDataScheme(value: string): boolean {
  return value.length > 7
    && value.charCodeAt(0) === 0x64 /* d */
    && value.substring(0, 7) === 'data://'
}

function isRelativeColonlessReference(value: string): boolean {
  return isColonlessReference(value)
    && !isPosixAbsolutePath(value)
    && !isWindowsAbsolutePath(value)
}

function shouldResolveLocalFileReference(value: string, resolveBareLocalFiles: boolean): boolean {
  if (isFileUrl(value) || isWindowsAbsolutePath(value) || isPosixAbsolutePath(value)) return true
  return resolveBareLocalFiles && isColonlessReference(value)
}
