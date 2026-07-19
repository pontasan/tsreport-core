/** ISO 32000-2 media rendition semantics. Media playback remains host-owned. */

export type PdfMediaTemporaryFilePermission = 'TEMPNEVER' | 'TEMPEXTRACT' | 'TEMPACCESS' | 'TEMPALWAYS'

export type PdfMediaOffset =
  | { kind: 'time', seconds: number }
  | { kind: 'frame', frame: number }
  | { kind: 'marker', marker: string }

export interface PdfMediaClipSection {
  begin?: PdfMediaOffset
  end?: PdfMediaOffset
  /** Entries in an MH dictionary are mandatory for viability. */
  mustHonorBegin?: boolean
  mustHonorEnd?: boolean
}

export type PdfMediaDuration =
  | { kind: 'intrinsic' }
  | { kind: 'infinite' }
  | { kind: 'time', seconds: number }

/** ISO 32000 fit values 0 through 5. */
export type PdfMediaFit = 0 | 1 | 2 | 3 | 4 | 5

export interface PdfMediaPlayParameters {
  volumePercent?: number
  showController?: boolean
  fit?: PdfMediaFit
  duration?: PdfMediaDuration
  autoPlay?: boolean
  repeatCount?: number
  /** Places supplied play parameters in MH rather than BE. */
  mustHonor?: boolean
}

export interface PdfMediaFloatingWindow {
  width: number
  height: number
  relativeTo?: 0 | 1 | 2 | 3
  position?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  offscreen?: 0 | 1 | 2
  titleBar?: boolean
  closeControl?: boolean
  resize?: 0 | 1 | 2
  title?: string
}

export interface PdfMediaScreenParameters {
  window?: 0 | 1 | 2 | 3
  backgroundRgb?: [number, number, number]
  opacity?: number
  monitor?: number
  floatingWindow?: PdfMediaFloatingWindow
  /** Places supplied screen parameters in MH rather than BE. */
  mustHonor?: boolean
}

export interface PdfMediaDefinition {
  /** Absolute base URL for relative references contained by the media. */
  baseUrl?: string
  baseUrlMustBeHonored?: boolean
  temporaryFilePermission?: PdfMediaTemporaryFilePermission
  alternateText?: Array<{ language: string, text: string }>
  /** Ordered from the media data outward through nested MCS dictionaries. */
  sections?: PdfMediaClipSection[]
  playParameters?: PdfMediaPlayParameters
  screenParameters?: PdfMediaScreenParameters
}

export interface PdfMediaTemporalContext {
  intrinsicDurationSeconds?: number
  frameRate?: number
  markers?: Readonly<Record<string, number>>
  supportsTime?: boolean
  supportsFrames?: boolean
  supportsMarkers?: boolean
}

export interface PdfMediaTemporalSelection {
  viable: boolean
  beginSeconds: number
  endSeconds: number
  empty: boolean
  ignoredOffsets: PdfMediaOffset[]
}

export interface PdfMediaPlacement {
  x: number
  y: number
  width: number
  height: number
  clip: boolean
  scroll: boolean
}

const MIME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function validatePdfMediaMimeType(value: string): void {
  if (value.length === 0 || value.length > 127) throw new Error('PDF media MIME type must be a non-empty ASCII string')
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) throw new Error('PDF media MIME type must contain ASCII graphic characters only')
  }
  const mediaType = value.split(';', 1)[0]!.trim()
  const slash = mediaType.indexOf('/')
  if (slash <= 0 || slash !== mediaType.lastIndexOf('/') || slash === mediaType.length - 1
      || !MIME_TOKEN.test(mediaType.slice(0, slash)) || !MIME_TOKEN.test(mediaType.slice(slash + 1))) {
    throw new Error(`PDF media MIME type is malformed: ${value}`)
  }
}

export function validatePdfMediaBaseUrl(value: string): void {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error(`PDF media base URL must be absolute: ${value}`) }
  if (parsed.protocol === '') throw new Error(`PDF media base URL must be absolute: ${value}`)
}

export function resolvePdfMediaUrl(reference: string, baseUrl?: string, documentUrl?: string): string {
  if (reference === '') throw new Error('PDF media URL must not be empty')
  if (baseUrl !== undefined) validatePdfMediaBaseUrl(baseUrl)
  const base = baseUrl ?? documentUrl
  try {
    return base === undefined ? new URL(reference).href : new URL(reference, base).href
  } catch {
    throw new Error(`PDF media URL cannot be resolved without an absolute base URL: ${reference}`)
  }
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`)
}

export function validatePdfMediaOffset(offset: PdfMediaOffset): void {
  if (offset.kind === 'time') requireFiniteNonNegative(offset.seconds, 'PDF media time offset')
  else if (offset.kind === 'frame') {
    if (!Number.isSafeInteger(offset.frame) || offset.frame < 0) throw new Error('PDF media frame offset must be a non-negative safe integer')
  } else if (offset.marker === '') throw new Error('PDF media marker offset must not be empty')
}

export function validatePdfMediaDefinition(definition: PdfMediaDefinition): void {
  if (definition.baseUrl !== undefined) validatePdfMediaBaseUrl(definition.baseUrl)
  for (const section of definition.sections ?? []) {
    if (section.begin !== undefined) validatePdfMediaOffset(section.begin)
    if (section.end !== undefined) validatePdfMediaOffset(section.end)
  }
  const play = definition.playParameters
  if (play !== undefined) {
    if (play.volumePercent !== undefined) requireFiniteNonNegative(play.volumePercent, 'PDF media volume')
    if (play.repeatCount !== undefined) requireFiniteNonNegative(play.repeatCount, 'PDF media repeat count')
    if (play.duration?.kind === 'time') requireFiniteNonNegative(play.duration.seconds, 'PDF media duration')
  }
  const screen = definition.screenParameters
  if (screen !== undefined) {
    if (screen.backgroundRgb !== undefined && screen.backgroundRgb.some(function (value) {
      return !Number.isFinite(value) || value < 0 || value > 1
    })) throw new Error('PDF media screen background components must be in the range 0 through 1')
    if (screen.opacity !== undefined && (!Number.isFinite(screen.opacity) || screen.opacity < 0 || screen.opacity > 1)) {
      throw new Error('PDF media screen opacity must be in the range 0 through 1')
    }
    if (screen.floatingWindow !== undefined) {
      const floating = screen.floatingWindow
      if (!Number.isSafeInteger(floating.width) || floating.width < 0 || !Number.isSafeInteger(floating.height) || floating.height < 0) {
        throw new Error('PDF media floating-window dimensions must be non-negative integers')
      }
    }
    if (screen.window === 0 && screen.floatingWindow === undefined) {
      throw new Error('PDF media floating window requires floatingWindow parameters')
    }
  }
}

function offsetSeconds(offset: PdfMediaOffset, context: PdfMediaTemporalContext): number | null {
  if (offset.kind === 'time') return context.supportsTime === false ? null : offset.seconds
  if (offset.kind === 'frame') {
    if (context.supportsFrames === false || context.frameRate === undefined || !Number.isFinite(context.frameRate) || context.frameRate <= 0) return null
    return offset.frame / context.frameRate
  }
  if (context.supportsMarkers === false) return null
  return context.markers?.[offset.marker] ?? null
}

/** Resolves nested MCS begin/end selectors using ISO 32000 relative/absolute rules. */
export function resolvePdfMediaTemporalSelection(
  sections: readonly PdfMediaClipSection[],
  context: PdfMediaTemporalContext,
): PdfMediaTemporalSelection {
  let begin = 0
  let end = context.intrinsicDurationSeconds ?? Number.POSITIVE_INFINITY
  const ignoredOffsets: PdfMediaOffset[] = []
  let requireDeeperBegin = false
  let requireDeeperEnd = false
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!
    const beginRequired = requireDeeperBegin || section.mustHonorBegin === true
    const endRequired = requireDeeperEnd || section.mustHonorEnd === true
    if (section.mustHonorBegin === true) requireDeeperBegin = true
    if (section.mustHonorEnd === true) requireDeeperEnd = true
    if (section.begin !== undefined) {
      validatePdfMediaOffset(section.begin)
      const value = offsetSeconds(section.begin, context)
      if (value === null) {
        if (beginRequired) return { viable: false, beginSeconds: begin, endSeconds: end, empty: begin >= end, ignoredOffsets: [...ignoredOffsets, section.begin] }
        ignoredOffsets.push(section.begin)
      } else begin = section.begin.kind === 'marker' ? Math.max(begin, value) : begin + value
    }
    if (section.end !== undefined) {
      validatePdfMediaOffset(section.end)
      const value = offsetSeconds(section.end, context)
      if (value === null) {
        if (endRequired) return { viable: false, beginSeconds: begin, endSeconds: end, empty: begin >= end, ignoredOffsets: [...ignoredOffsets, section.end] }
        ignoredOffsets.push(section.end)
      } else {
        const candidate = section.end.kind === 'marker' ? value : begin + value
        end = Math.min(end, candidate)
      }
    }
  }
  return { viable: true, beginSeconds: begin, endSeconds: end, empty: begin >= end, ignoredOffsets }
}

/** Applies media play-parameter fit semantics to an annotation or window rectangle. */
export function computePdfMediaPlacement(
  mediaWidth: number,
  mediaHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: PdfMediaFit,
): PdfMediaPlacement {
  for (const [value, label] of [[mediaWidth, 'media width'], [mediaHeight, 'media height'], [targetWidth, 'target width'], [targetHeight, 'target height']] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`PDF media ${label} must be positive`)
  }
  if (fit === 2) return { x: 0, y: 0, width: targetWidth, height: targetHeight, clip: false, scroll: false }
  if (fit === 3 || fit === 4 || fit === 5) return {
    x: (targetWidth - mediaWidth) / 2,
    y: (targetHeight - mediaHeight) / 2,
    width: mediaWidth,
    height: mediaHeight,
    clip: fit === 4,
    scroll: fit === 3,
  }
  const scale = fit === 1 ? Math.max(targetWidth / mediaWidth, targetHeight / mediaHeight) : Math.min(targetWidth / mediaWidth, targetHeight / mediaHeight)
  const width = mediaWidth * scale
  const height = mediaHeight * scale
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height, clip: fit === 1, scroll: false }
}
