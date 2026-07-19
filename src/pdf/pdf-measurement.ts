import type { PdfRawValueDef } from '../types/template.js'
import { decodePdfTextStringBytes, encodePdfTextStringBytes } from './pdf-text-string.js'

export type PdfMeasurementPoint = [number, number] | [number, number, number]
export type PdfNumberFormatMode = 'D' | 'F' | 'R' | 'T'
export type PdfNumberFormatLabelPosition = 'S' | 'P'

export interface PdfNumberFormat {
  unit: string
  conversionFactor: number
  mode?: PdfNumberFormatMode
  precision?: number
  fixedDenominator?: boolean
  thousandsSeparator?: string
  decimalSeparator?: string
  labelPrefix?: string
  labelSuffix?: string
  labelPosition?: PdfNumberFormatLabelPosition
}

export interface PdfRectilinearMeasure {
  kind: 'rectilinear'
  scaleRatio: string
  x: PdfNumberFormat[]
  y?: PdfNumberFormat[]
  distance: PdfNumberFormat[]
  area: PdfNumberFormat[]
  angle?: PdfNumberFormat[]
  slope?: PdfNumberFormat[]
  origin?: [number, number]
  yToX?: number
}

export interface PdfGeographicCoordinateSystem {
  kind: 'geographic'
  epsg?: number
  wkt?: string
}

export interface PdfProjectedCoordinateSystem {
  kind: 'projected'
  epsg?: number
  wkt?: string
}

export type PdfGeospatialCoordinateSystem = PdfGeographicCoordinateSystem | PdfProjectedCoordinateSystem
export type PdfLinearDisplayUnit = 'M' | 'KM' | 'FT' | 'USFT' | 'MI' | 'NM'
export type PdfAreaDisplayUnit = 'SQM' | 'HA' | 'SQKM' | 'SQFT' | 'A' | 'SQMI'
export type PdfAngularDisplayUnit = 'DEG' | 'GRD'

export interface PdfPreferredDisplayUnits {
  linear: PdfLinearDisplayUnit
  area: PdfAreaDisplayUnit
  angular: PdfAngularDisplayUnit
}

export interface PdfGeospatialMeasure {
  kind: 'geospatial'
  dimension?: 2 | 3
  bounds?: [number, number][]
  coordinateSystem: PdfGeospatialCoordinateSystem
  displayCoordinateSystem?: PdfGeospatialCoordinateSystem
  preferredDisplayUnits?: PdfPreferredDisplayUnits
  geographicPoints: PdfMeasurementPoint[]
  localPoints: PdfMeasurementPoint[]
  /** Row-order 4x4 affine matrix with the constant fourth column omitted. */
  projectedCoordinateSystemMatrix?: [number, number, number, number, number, number, number, number, number, number, number, number]
}

export type PdfMeasurement = PdfRectilinearMeasure | PdfGeospatialMeasure

export interface PdfPointData {
  names: string[]
  rows: PdfRawValueDef[][]
}

export interface PdfMeasurementViewport {
  bbox: [number, number, number, number]
  name?: string
  measure?: PdfMeasurement
  pointData?: PdfPointData[]
}

/** Distinguish the typed viewport model from a raw PDF dictionary. */
export function isPdfMeasurementViewport(
  value: PdfMeasurementViewport | Record<string, PdfRawValueDef>,
): value is PdfMeasurementViewport {
  return 'bbox' in value && Array.isArray(value.bbox)
}

export interface PdfRectilinearCoordinate {
  kind: 'rectilinear'
  x: number
  y: number
  formattedX: string
  formattedY: string
}

export interface PdfGeospatialCoordinate {
  kind: 'geospatial'
  coordinateSystem: PdfGeospatialCoordinateSystem
  point: PdfMeasurementPoint
}

export type PdfConvertedMeasurementPoint = PdfRectilinearCoordinate | PdfGeospatialCoordinate

export interface PdfFormattedMeasurement {
  value: number
  formatted: string
}

export interface PdfPointDataCoordinate {
  latitude: number
  longitude: number
  altitude?: number
}

const LINEAR_DISPLAY_UNITS = new Set<string>(['M', 'KM', 'FT', 'USFT', 'MI', 'NM'])
const AREA_DISPLAY_UNITS = new Set<string>(['SQM', 'HA', 'SQKM', 'SQFT', 'A', 'SQMI'])
const ANGULAR_DISPLAY_UNITS = new Set<string>(['DEG', 'GRD'])

/** Validate the complete typed viewport before output or coordinate use. */
export function validatePdfMeasurementViewport(viewport: PdfMeasurementViewport): void {
  requireFiniteTuple(viewport.bbox, 4, 'viewport bbox')
  if (viewport.bbox[0] === viewport.bbox[2] || viewport.bbox[1] === viewport.bbox[3]) {
    throw new Error('PDF measurement error: viewport bbox must have non-zero width and height')
  }
  if (viewport.measure !== undefined) validatePdfMeasurement(viewport.measure)
  if (viewport.pointData !== undefined) {
    for (let i = 0; i < viewport.pointData.length; i++) validatePointData(viewport.pointData[i]!, i)
  }
}

/** Convert the semantic viewport model to a raw PDF dictionary. */
export function pdfMeasurementViewportToRaw(viewport: PdfMeasurementViewport): Record<string, PdfRawValueDef> {
  validatePdfMeasurementViewport(viewport)
  const entries: Record<string, PdfRawValueDef> = {
    Type: rawName('Viewport'),
    BBox: rawNumberArray(viewport.bbox),
  }
  if (viewport.name !== undefined) entries.Name = rawText(viewport.name)
  if (viewport.measure !== undefined) entries.Measure = rawDictionary(measurementToRaw(viewport.measure))
  if (viewport.pointData !== undefined) {
    if (viewport.pointData.length === 1) entries.PtData = rawDictionary(pointDataToRaw(viewport.pointData[0]!))
    else entries.PtData = { kind: 'array', items: viewport.pointData.map(pointDataRawValue) }
  }
  return entries
}

/** Parse a resolved raw viewport dictionary into the semantic measurement model. */
export function pdfMeasurementViewportFromRaw(
  entries: Record<string, PdfRawValueDef>,
  dimension: 2 | 3 = 2,
): PdfMeasurementViewport {
  requireOptionalRawName(entries.Type, 'Viewport', 'viewport Type')
  const bbox = rawFixedNumberTuple(entries.BBox, 4, 'viewport BBox') as [number, number, number, number]
  const viewport: PdfMeasurementViewport = { bbox }
  if (entries.Name !== undefined) viewport.name = rawTextValue(entries.Name, 'viewport Name')
  if (entries.Measure !== undefined) viewport.measure = measurementFromRaw(rawDictionaryValue(entries.Measure, 'viewport Measure'), dimension)
  if (entries.PtData !== undefined) viewport.pointData = pointDataArrayFromRaw(entries.PtData)
  validatePdfMeasurementViewport(viewport)
  return viewport
}

/** Convert one semantic measure dictionary to resolved raw PDF entries. */
export function pdfMeasurementToRaw(measure: PdfMeasurement): Record<string, PdfRawValueDef> {
  validatePdfMeasurement(measure)
  return measurementToRaw(measure)
}

/** Parse one resolved raw measure dictionary. */
export function pdfMeasurementFromRaw(
  entries: Record<string, PdfRawValueDef>,
  dimension: 2 | 3 = 2,
): PdfMeasurement {
  const measure = measurementFromRaw(entries, dimension)
  validatePdfMeasurement(measure)
  return measure
}

/** Convert one or more point-data dictionaries to the PDF PtData value. */
export function pdfPointDataToRaw(pointData: readonly PdfPointData[]): PdfRawValueDef {
  if (pointData.length === 0) throw new Error('PDF measurement error: PtData array must not be empty')
  for (let i = 0; i < pointData.length; i++) validatePointData(pointData[i]!, i)
  if (pointData.length === 1) return pointDataRawValue(pointData[0]!)
  return { kind: 'array', items: pointData.map(pointDataRawValue) }
}

/** Parse one or more resolved raw point-data dictionaries. */
export function pdfPointDataFromRaw(value: PdfRawValueDef): PdfPointData[] {
  const pointData = pointDataArrayFromRaw(value)
  for (let i = 0; i < pointData.length; i++) validatePointData(pointData[i]!, i)
  return pointData
}

/** Select the last viewport in drawing order whose BBox contains the page point. */
export function selectPdfMeasurementViewport(
  viewports: readonly PdfMeasurementViewport[],
  point: readonly [number, number],
): PdfMeasurementViewport | null {
  for (let i = viewports.length - 1; i >= 0; i--) {
    const viewport = viewports[i]!
    const minX = Math.min(viewport.bbox[0], viewport.bbox[2])
    const maxX = Math.max(viewport.bbox[0], viewport.bbox[2])
    const minY = Math.min(viewport.bbox[1], viewport.bbox[3])
    const maxY = Math.max(viewport.bbox[1], viewport.bbox[3])
    if (point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY) return viewport
  }
  return null
}

/** Convert a default-user-space point through the viewport's RL or GEO measure. */
export function convertPdfPagePointToMeasurement(
  viewport: PdfMeasurementViewport,
  point: readonly [number, number],
  z = 0,
): PdfConvertedMeasurementPoint {
  validatePdfMeasurementViewport(viewport)
  if (viewport.measure === undefined) throw new Error('PDF measurement error: viewport does not contain a measure dictionary')
  const measure = viewport.measure
  if (measure.kind === 'rectilinear') {
    const origin = measure.origin ?? [viewport.bbox[0], viewport.bbox[1]]
    const xDirection = Math.sign(viewport.bbox[2] - viewport.bbox[0])
    const yDirection = Math.sign(viewport.bbox[3] - viewport.bbox[1])
    const xInput = (point[0] - origin[0]) * xDirection
    const yInput = (point[1] - origin[1]) * yDirection
    const yFormats = measure.y ?? measure.x
    return {
      kind: 'rectilinear',
      x: xInput * measure.x[0]!.conversionFactor,
      y: yInput * yFormats[0]!.conversionFactor,
      formattedX: formatPdfMeasurement(xInput, measure.x),
      formattedY: formatPdfMeasurement(yInput, yFormats),
    }
  }
  const local = pagePointToLocal(viewport.bbox, point, z, measure.dimension ?? 2)
  requireInsideGeospatialBounds(local, measure.bounds)
  const mapped = geospatialForward(measure, local)
  return { kind: 'geospatial', coordinateSystem: measure.coordinateSystem, point: mapped }
}

/** Convert a GEO coordinate back to default user space through the same control model. */
export function convertPdfMeasurementPointToPage(
  viewport: PdfMeasurementViewport,
  point: PdfMeasurementPoint,
): PdfMeasurementPoint {
  validatePdfMeasurementViewport(viewport)
  const measure = viewport.measure
  if (measure === undefined || measure.kind !== 'geospatial') {
    throw new Error('PDF measurement error: inverse coordinate conversion requires a geospatial measure')
  }
  const dimension = measure.dimension ?? 2
  requirePointDimension(point, dimension, 'geospatial point')
  const local = geospatialInverse(measure, point)
  requireInsideGeospatialBounds(local, measure.bounds)
  const x = viewport.bbox[0] + local[0] * (viewport.bbox[2] - viewport.bbox[0])
  const y = viewport.bbox[1] + local[1] * (viewport.bbox[3] - viewport.bbox[1])
  return dimension === 2 ? [x, y] : [x, y, local[2]!]
}

/** Format a canonical measurement using the ISO 32000 number-format-array algorithm. */
export function formatPdfMeasurement(value: number, formats: readonly PdfNumberFormat[]): string {
  if (!Number.isFinite(value)) throw new Error('PDF measurement error: formatted value must be finite')
  validateNumberFormats(formats, 'number format array')
  const negative = value < 0
  let partial = Math.abs(value)
  let result = ''
  for (let i = 0; i < formats.length; i++) {
    const format = formats[i]!
    const converted = partial * format.conversionFactor
    const last = i === formats.length - 1
    let displayed: string
    if (!last && !isIntegerWithinTolerance(converted)) {
      const whole = Math.trunc(converted)
      displayed = groupedInteger(whole, format.thousandsSeparator ?? ',')
      partial = converted - whole
    } else if (!last) {
      displayed = groupedInteger(Math.round(converted), format.thousandsSeparator ?? ',')
      result += decoratedUnit(displayed, format, negative && result === '')
      break
    } else {
      displayed = formattedLastValue(converted, format)
      partial = 0
    }
    result += decoratedUnit(displayed, format, negative && result === '')
    if (partial === 0) break
  }
  return result
}

/** Measure a polyline in an RL viewport, including X/Y/CYX and D conversion. */
export function measurePdfPolyline(
  viewport: PdfMeasurementViewport,
  points: readonly (readonly [number, number])[],
): PdfFormattedMeasurement {
  const measure = rectilinearMeasure(viewport)
  if (points.length < 2) throw new Error('PDF measurement error: a polyline requires at least two points')
  let distance = 0
  for (let i = 1; i < points.length; i++) {
    const delta = rectilinearDelta(viewport, measure, points[i - 1]!, points[i]!, true)
    distance += Math.hypot(delta[0], delta[1])
  }
  return { value: distance * measure.distance[0]!.conversionFactor, formatted: formatPdfMeasurement(distance, measure.distance) }
}

/** Measure polygon area in an RL viewport, including X/Y/CYX and A conversion. */
export function measurePdfArea(
  viewport: PdfMeasurementViewport,
  points: readonly (readonly [number, number])[],
): PdfFormattedMeasurement {
  const measure = rectilinearMeasure(viewport)
  if (points.length < 3) throw new Error('PDF measurement error: an area requires at least three points')
  const origin = points[0]!
  const converted = new Array<[number, number]>(points.length)
  converted[0] = [0, 0]
  for (let i = 1; i < points.length; i++) converted[i] = rectilinearDelta(viewport, measure, origin, points[i]!, true)
  let twiceArea = 0
  for (let i = 0; i < converted.length; i++) {
    const a = converted[i]!
    const b = converted[(i + 1) % converted.length]!
    twiceArea += a[0] * b[1] - b[0] * a[1]
  }
  const area = Math.abs(twiceArea) / 2
  return { value: area * measure.area[0]!.conversionFactor, formatted: formatPdfMeasurement(area, measure.area) }
}

/** Measure a directed line angle in degrees, normalized to [0, 360). */
export function measurePdfAngle(
  viewport: PdfMeasurementViewport,
  start: readonly [number, number],
  end: readonly [number, number],
): PdfFormattedMeasurement {
  const measure = rectilinearMeasure(viewport)
  if (measure.angle === undefined) throw new Error('PDF measurement error: measure dictionary does not define angle formats')
  const delta = rectilinearDelta(viewport, measure, start, end, true)
  let degrees = Math.atan2(delta[1], delta[0]) * 180 / Math.PI
  if (degrees < 0) degrees += 360
  return { value: degrees * measure.angle[0]!.conversionFactor, formatted: formatPdfMeasurement(degrees, measure.angle) }
}

/** Measure line slope using the independently scaled X and Y axes. */
export function measurePdfSlope(
  viewport: PdfMeasurementViewport,
  start: readonly [number, number],
  end: readonly [number, number],
): PdfFormattedMeasurement {
  const measure = rectilinearMeasure(viewport)
  if (measure.slope === undefined) throw new Error('PDF measurement error: measure dictionary does not define slope formats')
  const delta = rectilinearDelta(viewport, measure, start, end, false)
  const slope = delta[1] / delta[0]
  if (!Number.isFinite(slope)) throw new Error('PDF measurement error: vertical line has no finite slope')
  return { value: slope * measure.slope[0]!.conversionFactor, formatted: formatPdfMeasurement(slope, measure.slope) }
}

/** Extract the standard LAT/LON/ALT point-data columns as coordinates. */
export function extractPdfPointDataCoordinates(pointData: PdfPointData): PdfPointDataCoordinate[] {
  validatePointData(pointData, 0)
  const latitudeIndex = pointData.names.indexOf('LAT')
  const longitudeIndex = pointData.names.indexOf('LON')
  const altitudeIndex = pointData.names.indexOf('ALT')
  if (latitudeIndex < 0 || longitudeIndex < 0) throw new Error('PDF measurement error: point data requires LAT and LON columns')
  const coordinates = new Array<PdfPointDataCoordinate>(pointData.rows.length)
  for (let i = 0; i < pointData.rows.length; i++) {
    const row = pointData.rows[i]!
    const latitude = rawNumericPointValue(row[latitudeIndex], `point data row ${i} LAT`)
    const longitude = rawNumericPointValue(row[longitudeIndex], `point data row ${i} LON`)
    const coordinate: PdfPointDataCoordinate = { latitude, longitude }
    if (altitudeIndex >= 0) coordinate.altitude = rawNumericPointValue(row[altitudeIndex], `point data row ${i} ALT`)
    coordinates[i] = coordinate
  }
  return coordinates
}

function validatePdfMeasurement(measure: PdfMeasurement): void {
  if (measure.kind === 'rectilinear') {
    if (measure.scaleRatio.length === 0) throw new Error('PDF measurement error: RL scale ratio must not be empty')
    validateNumberFormats(measure.x, 'RL X')
    if (measure.y !== undefined) validateNumberFormats(measure.y, 'RL Y')
    validateNumberFormats(measure.distance, 'RL D')
    validateNumberFormats(measure.area, 'RL A')
    if (measure.angle !== undefined) validateNumberFormats(measure.angle, 'RL T')
    if (measure.slope !== undefined) validateNumberFormats(measure.slope, 'RL S')
    if (measure.origin !== undefined) requireFiniteTuple(measure.origin, 2, 'RL origin')
    if (measure.yToX !== undefined && (!Number.isFinite(measure.yToX) || measure.yToX === 0)) {
      throw new Error('PDF measurement error: RL CYX must be a finite non-zero number')
    }
    return
  }
  const dimension = measure.dimension ?? 2
  validateCoordinateSystem(measure.coordinateSystem, 'GCS')
  if (measure.displayCoordinateSystem !== undefined) validateCoordinateSystem(measure.displayCoordinateSystem, 'DCS')
  if (measure.geographicPoints.length === 0 || measure.geographicPoints.length !== measure.localPoints.length) {
    throw new Error('PDF measurement error: GEO GPTS and LPTS must contain the same non-zero number of points')
  }
  for (let i = 0; i < measure.geographicPoints.length; i++) {
    requirePointDimension(measure.geographicPoints[i]!, dimension, `GEO GPTS[${i}]`)
    requirePointDimension(measure.localPoints[i]!, dimension, `GEO LPTS[${i}]`)
    if (measure.localPoints[i]![0] < 0 || measure.localPoints[i]![0] > 1
      || measure.localPoints[i]![1] < 0 || measure.localPoints[i]![1] > 1) {
      throw new Error(`PDF measurement error: GEO LPTS[${i}] must be in the unit square`)
    }
  }
  if (measure.bounds !== undefined) {
    if (measure.bounds.length < 3) throw new Error('PDF measurement error: GEO Bounds must contain at least three points')
    for (let i = 0; i < measure.bounds.length; i++) {
      requireFiniteTuple(measure.bounds[i]!, 2, `GEO Bounds[${i}]`)
      if (measure.bounds[i]![0] < 0 || measure.bounds[i]![0] > 1
        || measure.bounds[i]![1] < 0 || measure.bounds[i]![1] > 1) {
        throw new Error(`PDF measurement error: GEO Bounds[${i}] must be in the unit square`)
      }
    }
  }
  if (measure.preferredDisplayUnits !== undefined) {
    if (!LINEAR_DISPLAY_UNITS.has(measure.preferredDisplayUnits.linear)
      || !AREA_DISPLAY_UNITS.has(measure.preferredDisplayUnits.area)
      || !ANGULAR_DISPLAY_UNITS.has(measure.preferredDisplayUnits.angular)) {
      throw new Error('PDF measurement error: GEO PDU contains an undefined display unit')
    }
  }
  if (measure.projectedCoordinateSystemMatrix !== undefined) {
    requireFiniteTuple(measure.projectedCoordinateSystemMatrix, 12, 'GEO PCSM')
    if (measure.coordinateSystem.kind !== 'projected') {
      throw new Error('PDF measurement error: GEO PCSM requires a projected coordinate system')
    }
  }
}

function validateNumberFormats(formats: readonly PdfNumberFormat[], label: string): void {
  if (formats.length === 0) throw new Error(`PDF measurement error: ${label} must contain at least one number format`)
  for (let i = 0; i < formats.length; i++) {
    const format = formats[i]!
    if (format.unit.length === 0) throw new Error(`PDF measurement error: ${label}[${i}] unit must not be empty`)
    if (!Number.isFinite(format.conversionFactor) || format.conversionFactor <= 0) {
      throw new Error(`PDF measurement error: ${label}[${i}] conversion factor must be positive and finite`)
    }
    const mode = format.mode ?? 'D'
    if (mode !== 'D' && mode !== 'F' && mode !== 'R' && mode !== 'T') {
      throw new Error(`PDF measurement error: ${label}[${i}] has an invalid format mode`)
    }
    if (format.precision !== undefined) {
      if (!Number.isInteger(format.precision) || format.precision <= 0) {
        throw new Error(`PDF measurement error: ${label}[${i}] precision must be a positive integer`)
      }
      if (mode === 'D' && format.precision % 10 !== 0) {
        throw new Error(`PDF measurement error: ${label}[${i}] decimal precision must be a multiple of 10`)
      }
    }
  }
}

function validateCoordinateSystem(system: PdfGeospatialCoordinateSystem, label: string): void {
  if (system.epsg === undefined && system.wkt === undefined) {
    throw new Error(`PDF measurement error: ${label} requires EPSG or WKT`)
  }
  if (system.epsg !== undefined && (!Number.isInteger(system.epsg) || system.epsg <= 0)) {
    throw new Error(`PDF measurement error: ${label} EPSG must be a positive integer`)
  }
  if (system.wkt !== undefined && system.wkt.length === 0) throw new Error(`PDF measurement error: ${label} WKT must not be empty`)
}

function validatePointData(pointData: PdfPointData, index: number): void {
  if (pointData.names.length === 0) throw new Error(`PDF measurement error: PtData[${index}] Names must not be empty`)
  const seen = new Set<string>()
  for (let i = 0; i < pointData.names.length; i++) {
    const name = pointData.names[i]!
    if (name.length === 0 || seen.has(name)) throw new Error(`PDF measurement error: PtData[${index}] Names must be unique non-empty names`)
    seen.add(name)
  }
  for (let i = 0; i < pointData.rows.length; i++) {
    if (pointData.rows[i]!.length !== pointData.names.length) {
      throw new Error(`PDF measurement error: PtData[${index}] XPTS[${i}] length must equal Names length`)
    }
    for (let k = 0; k < pointData.names.length; k++) {
      const name = pointData.names[k]!
      if ((name === 'LAT' || name === 'LON' || name === 'ALT') && typeof pointData.rows[i]![k] !== 'number') {
        throw new Error(`PDF measurement error: PtData[${index}] ${name} values must be numbers`)
      }
    }
  }
}

function measurementToRaw(measure: PdfMeasurement): Record<string, PdfRawValueDef> {
  if (measure.kind === 'rectilinear') {
    const entries: Record<string, PdfRawValueDef> = {
      Type: rawName('Measure'), Subtype: rawName('RL'), R: rawText(measure.scaleRatio),
      X: numberFormatsToRaw(measure.x), D: numberFormatsToRaw(measure.distance), A: numberFormatsToRaw(measure.area),
    }
    if (measure.y !== undefined) entries.Y = numberFormatsToRaw(measure.y)
    if (measure.angle !== undefined) entries.T = numberFormatsToRaw(measure.angle)
    if (measure.slope !== undefined) entries.S = numberFormatsToRaw(measure.slope)
    if (measure.origin !== undefined) entries.O = rawNumberArray(measure.origin)
    if (measure.yToX !== undefined) entries.CYX = measure.yToX
    return entries
  }
  const entries: Record<string, PdfRawValueDef> = {
    Type: rawName('Measure'), Subtype: rawName('GEO'),
    GCS: rawDictionary(coordinateSystemToRaw(measure.coordinateSystem)),
    GPTS: rawNumberArray(flattenPoints(measure.geographicPoints)),
    LPTS: rawNumberArray(flattenPoints(measure.localPoints)),
  }
  if (measure.bounds !== undefined) entries.Bounds = rawNumberArray(flattenPoints(measure.bounds))
  if (measure.displayCoordinateSystem !== undefined) entries.DCS = rawDictionary(coordinateSystemToRaw(measure.displayCoordinateSystem))
  if (measure.preferredDisplayUnits !== undefined) {
    entries.PDU = { kind: 'array', items: [
      rawName(measure.preferredDisplayUnits.linear), rawName(measure.preferredDisplayUnits.area), rawName(measure.preferredDisplayUnits.angular),
    ] }
  }
  if (measure.projectedCoordinateSystemMatrix !== undefined) entries.PCSM = rawNumberArray(measure.projectedCoordinateSystemMatrix)
  return entries
}

function measurementFromRaw(entries: Record<string, PdfRawValueDef>, dimension: 2 | 3): PdfMeasurement {
  requireOptionalRawName(entries.Type, 'Measure', 'measure Type')
  const subtype = entries.Subtype === undefined ? 'RL' : rawNameValue(entries.Subtype, 'measure Subtype')
  if (subtype === 'RL') {
    const measure: PdfRectilinearMeasure = {
      kind: 'rectilinear',
      scaleRatio: rawTextValue(entries.R, 'RL R'),
      x: numberFormatsFromRaw(entries.X, 'RL X'),
      distance: numberFormatsFromRaw(entries.D, 'RL D'),
      area: numberFormatsFromRaw(entries.A, 'RL A'),
    }
    if (entries.Y !== undefined) measure.y = numberFormatsFromRaw(entries.Y, 'RL Y')
    if (entries.T !== undefined) measure.angle = numberFormatsFromRaw(entries.T, 'RL T')
    if (entries.S !== undefined) measure.slope = numberFormatsFromRaw(entries.S, 'RL S')
    if (entries.O !== undefined) measure.origin = rawFixedNumberTuple(entries.O, 2, 'RL O') as [number, number]
    if (entries.CYX !== undefined) measure.yToX = rawNumberValue(entries.CYX, 'RL CYX')
    return measure
  }
  if (subtype !== 'GEO') throw new Error(`PDF measurement error: unsupported measure Subtype /${subtype}`)
  const measure: PdfGeospatialMeasure = {
    kind: 'geospatial', dimension,
    coordinateSystem: coordinateSystemFromRaw(rawDictionaryValue(entries.GCS, 'GEO GCS'), 'GCS'),
    geographicPoints: rawPointArray(entries.GPTS, dimension, 'GEO GPTS'),
    localPoints: rawPointArray(entries.LPTS, dimension, 'GEO LPTS'),
  }
  if (entries.Bounds !== undefined) measure.bounds = rawPointArray(entries.Bounds, 2, 'GEO Bounds') as [number, number][]
  if (entries.DCS !== undefined) measure.displayCoordinateSystem = coordinateSystemFromRaw(rawDictionaryValue(entries.DCS, 'GEO DCS'), 'DCS')
  if (entries.PDU !== undefined) {
    const items = rawArrayValue(entries.PDU, 'GEO PDU')
    if (items.length !== 3) throw new Error('PDF measurement error: GEO PDU must contain three names')
    measure.preferredDisplayUnits = {
      linear: rawNameValue(items[0], 'GEO PDU linear') as PdfLinearDisplayUnit,
      area: rawNameValue(items[1], 'GEO PDU area') as PdfAreaDisplayUnit,
      angular: rawNameValue(items[2], 'GEO PDU angular') as PdfAngularDisplayUnit,
    }
  }
  if (entries.PCSM !== undefined) {
    measure.projectedCoordinateSystemMatrix = rawFixedNumberTuple(entries.PCSM, 12, 'GEO PCSM') as PdfGeospatialMeasure['projectedCoordinateSystemMatrix']
  }
  return measure
}

function numberFormatsToRaw(formats: readonly PdfNumberFormat[]): PdfRawValueDef {
  const items = new Array<PdfRawValueDef>(formats.length)
  for (let i = 0; i < formats.length; i++) {
    const format = formats[i]!
    const entries: Record<string, PdfRawValueDef> = {
      Type: rawName('NumberFormat'), U: rawText(format.unit), C: format.conversionFactor,
    }
    if (format.mode !== undefined) entries.F = rawName(format.mode)
    if (format.precision !== undefined) entries.D = format.precision
    if (format.fixedDenominator !== undefined) entries.FD = format.fixedDenominator
    if (format.thousandsSeparator !== undefined) entries.RT = rawText(format.thousandsSeparator)
    if (format.decimalSeparator !== undefined) entries.RD = rawText(format.decimalSeparator)
    if (format.labelPrefix !== undefined) entries.PS = rawText(format.labelPrefix)
    if (format.labelSuffix !== undefined) entries.SS = rawText(format.labelSuffix)
    if (format.labelPosition !== undefined) entries.O = rawName(format.labelPosition)
    items[i] = rawDictionary(entries)
  }
  return { kind: 'array', items }
}

function numberFormatsFromRaw(value: PdfRawValueDef | undefined, label: string): PdfNumberFormat[] {
  const items = rawArrayValue(value, label)
  const formats = new Array<PdfNumberFormat>(items.length)
  for (let i = 0; i < items.length; i++) {
    const entries = rawDictionaryValue(items[i], `${label}[${i}]`)
    requireOptionalRawName(entries.Type, 'NumberFormat', `${label}[${i}] Type`)
    const format: PdfNumberFormat = {
      unit: rawTextValue(entries.U, `${label}[${i}] U`),
      conversionFactor: rawNumberValue(entries.C, `${label}[${i}] C`),
    }
    if (entries.F !== undefined) format.mode = rawNameValue(entries.F, `${label}[${i}] F`) as PdfNumberFormatMode
    if (entries.D !== undefined) format.precision = rawIntegerValue(entries.D, `${label}[${i}] D`)
    if (entries.FD !== undefined) format.fixedDenominator = rawBooleanValue(entries.FD, `${label}[${i}] FD`)
    if (entries.RT !== undefined) format.thousandsSeparator = rawTextValue(entries.RT, `${label}[${i}] RT`)
    if (entries.RD !== undefined) format.decimalSeparator = rawTextValue(entries.RD, `${label}[${i}] RD`)
    if (entries.PS !== undefined) format.labelPrefix = rawTextValue(entries.PS, `${label}[${i}] PS`)
    if (entries.SS !== undefined) format.labelSuffix = rawTextValue(entries.SS, `${label}[${i}] SS`)
    if (entries.O !== undefined) format.labelPosition = rawNameValue(entries.O, `${label}[${i}] O`) as PdfNumberFormatLabelPosition
    formats[i] = format
  }
  return formats
}

function coordinateSystemToRaw(system: PdfGeospatialCoordinateSystem): Record<string, PdfRawValueDef> {
  const entries: Record<string, PdfRawValueDef> = { Type: rawName(system.kind === 'geographic' ? 'GEOGCS' : 'PROJCS') }
  if (system.epsg !== undefined) entries.EPSG = system.epsg
  if (system.wkt !== undefined) entries.WKT = rawText(system.wkt)
  return entries
}

function coordinateSystemFromRaw(entries: Record<string, PdfRawValueDef>, label: string): PdfGeospatialCoordinateSystem {
  const type = rawNameValue(entries.Type, `${label} Type`)
  if (type !== 'GEOGCS' && type !== 'PROJCS') throw new Error(`PDF measurement error: ${label} Type must be /GEOGCS or /PROJCS`)
  const system: PdfGeospatialCoordinateSystem = type === 'GEOGCS' ? { kind: 'geographic' } : { kind: 'projected' }
  if (entries.EPSG !== undefined) system.epsg = rawIntegerValue(entries.EPSG, `${label} EPSG`)
  if (entries.WKT !== undefined) system.wkt = rawTextValue(entries.WKT, `${label} WKT`)
  return system
}

function pointDataToRaw(pointData: PdfPointData): Record<string, PdfRawValueDef> {
  const names = new Array<PdfRawValueDef>(pointData.names.length)
  for (let i = 0; i < pointData.names.length; i++) names[i] = rawName(pointData.names[i]!)
  const rows = new Array<PdfRawValueDef>(pointData.rows.length)
  for (let i = 0; i < pointData.rows.length; i++) rows[i] = { kind: 'array', items: pointData.rows[i]! }
  return {
    Type: rawName('PtData'), Subtype: rawName('Cloud'),
    Names: { kind: 'array', items: names }, XPTS: { kind: 'array', items: rows },
  }
}

function pointDataRawValue(pointData: PdfPointData): PdfRawValueDef {
  return rawDictionary(pointDataToRaw(pointData))
}

function pointDataArrayFromRaw(value: PdfRawValueDef): PdfPointData[] {
  if (isRawDictionary(value)) return [pointDataFromRaw(value.entries, 0)]
  const items = rawArrayValue(value, 'viewport PtData')
  const data = new Array<PdfPointData>(items.length)
  for (let i = 0; i < items.length; i++) data[i] = pointDataFromRaw(rawDictionaryValue(items[i], `viewport PtData[${i}]`), i)
  return data
}

function pointDataFromRaw(entries: Record<string, PdfRawValueDef>, index: number): PdfPointData {
  requireOptionalRawName(entries.Type, 'PtData', `PtData[${index}] Type`)
  const subtype = rawNameValue(entries.Subtype, `PtData[${index}] Subtype`)
  if (subtype !== 'Cloud') throw new Error(`PDF measurement error: PtData[${index}] Subtype must be /Cloud`)
  const nameItems = rawArrayValue(entries.Names, `PtData[${index}] Names`)
  const names = new Array<string>(nameItems.length)
  for (let i = 0; i < nameItems.length; i++) names[i] = rawNameValue(nameItems[i], `PtData[${index}] Names[${i}]`)
  const rowItems = rawArrayValue(entries.XPTS, `PtData[${index}] XPTS`)
  const rows = new Array<PdfRawValueDef[]>(rowItems.length)
  for (let i = 0; i < rowItems.length; i++) rows[i] = rawArrayValue(rowItems[i], `PtData[${index}] XPTS[${i}]`)
  return { names, rows }
}

function geospatialForward(measure: PdfGeospatialMeasure, local: PdfMeasurementPoint): PdfMeasurementPoint {
  if (measure.projectedCoordinateSystemMatrix !== undefined && measure.coordinateSystem.kind === 'projected') {
    return applyProjectedMatrix(measure.projectedCoordinateSystemMatrix, local, measure.dimension ?? 2)
  }
  return radialBasisMap(measure.localPoints, measure.geographicPoints, local, measure.dimension ?? 2)
}

function geospatialInverse(measure: PdfGeospatialMeasure, point: PdfMeasurementPoint): PdfMeasurementPoint {
  if (measure.projectedCoordinateSystemMatrix !== undefined && measure.coordinateSystem.kind === 'projected') {
    return invertProjectedMatrix(measure.projectedCoordinateSystemMatrix, point, measure.dimension ?? 2)
  }
  return radialBasisMap(measure.geographicPoints, measure.localPoints, point, measure.dimension ?? 2)
}

function applyProjectedMatrix(matrix: readonly number[], point: PdfMeasurementPoint, dimension: 2 | 3): PdfMeasurementPoint {
  const z = dimension === 3 ? point[2]! : 0
  const x = point[0] * matrix[0]! + point[1] * matrix[3]! + z * matrix[6]! + matrix[9]!
  const y = point[0] * matrix[1]! + point[1] * matrix[4]! + z * matrix[7]! + matrix[10]!
  const mappedZ = point[0] * matrix[2]! + point[1] * matrix[5]! + z * matrix[8]! + matrix[11]!
  return dimension === 2 ? [x, y] : [x, y, mappedZ]
}

function invertProjectedMatrix(matrix: readonly number[], point: PdfMeasurementPoint, dimension: 2 | 3): PdfMeasurementPoint {
  if (dimension === 2) {
    const solved = solveLinearSystem(
      [[matrix[0]!, matrix[3]!], [matrix[1]!, matrix[4]!]],
      [[point[0] - matrix[9]!, point[1] - matrix[10]!]],
    )[0]!
    return [solved[0]!, solved[1]!]
  }
  const linear = [
    [matrix[0]!, matrix[3]!, matrix[6]!],
    [matrix[1]!, matrix[4]!, matrix[7]!],
    [matrix[2]!, matrix[5]!, matrix[8]!],
  ]
  const solved = solveLinearSystem(linear, [[point[0] - matrix[9]!, point[1] - matrix[10]!, point[2]! - matrix[11]!]])[0]!
  return [solved[0]!, solved[1]!, solved[2]!]
}

/** Exact polyharmonic radial-basis interpolation through all authored controls. */
function radialBasisMap(
  sources: readonly PdfMeasurementPoint[],
  targets: readonly PdfMeasurementPoint[],
  point: PdfMeasurementPoint,
  dimension: 2 | 3,
): PdfMeasurementPoint {
  if (sources.length < dimension + 1) {
    throw new Error(`PDF measurement error: ${dimension}D coordinate conversion requires at least ${dimension + 1} control points`)
  }
  for (let i = 0; i < sources.length; i++) {
    if (pointDistance(sources[i]!, point, dimension) <= 1e-12) return copyPoint(targets[i]!, dimension)
  }
  const n = sources.length
  const size = n + dimension + 1
  const matrix = new Array<number[]>(size)
  for (let row = 0; row < size; row++) matrix[row] = new Array<number>(size).fill(0)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) matrix[row]![col] = radialKernel(pointDistance(sources[row]!, sources[col]!, dimension), dimension)
    matrix[row]![n] = 1
    for (let axis = 0; axis < dimension; axis++) matrix[row]![n + 1 + axis] = sources[row]![axis]!
  }
  for (let col = 0; col < n; col++) {
    matrix[n]![col] = 1
    for (let axis = 0; axis < dimension; axis++) matrix[n + 1 + axis]![col] = sources[col]![axis]!
  }
  const rightSides = new Array<number[]>(dimension)
  for (let output = 0; output < dimension; output++) {
    const rhs = new Array<number>(size).fill(0)
    for (let row = 0; row < n; row++) rhs[row] = targets[row]![output]!
    rightSides[output] = rhs
  }
  const coefficients = solveLinearSystem(matrix, rightSides)
  const mapped = new Array<number>(dimension).fill(0)
  for (let output = 0; output < dimension; output++) {
    const coefficient = coefficients[output]!
    let value = coefficient[n]!
    for (let axis = 0; axis < dimension; axis++) value += coefficient[n + 1 + axis]! * point[axis]!
    for (let i = 0; i < n; i++) value += coefficient[i]! * radialKernel(pointDistance(point, sources[i]!, dimension), dimension)
    mapped[output] = value
  }
  return dimension === 2 ? [mapped[0]!, mapped[1]!] : [mapped[0]!, mapped[1]!, mapped[2]!]
}

function solveLinearSystem(matrixInput: readonly (readonly number[])[], rightSidesInput: readonly (readonly number[])[]): number[][] {
  const n = matrixInput.length
  if (n === 0) throw new Error('PDF measurement error: linear system must not be empty')
  const matrix = new Array<number[]>(n)
  for (let row = 0; row < n; row++) {
    if (matrixInput[row]!.length !== n) throw new Error('PDF measurement error: linear system matrix must be square')
    matrix[row] = Array.from(matrixInput[row]!)
  }
  const rightSides = new Array<number[]>(rightSidesInput.length)
  for (let r = 0; r < rightSidesInput.length; r++) {
    if (rightSidesInput[r]!.length !== n) throw new Error('PDF measurement error: linear system right side has an invalid length')
    rightSides[r] = Array.from(rightSidesInput[r]!)
  }
  for (let pivot = 0; pivot < n; pivot++) {
    let pivotRow = pivot
    let pivotMagnitude = Math.abs(matrix[pivot]![pivot]!)
    for (let row = pivot + 1; row < n; row++) {
      const magnitude = Math.abs(matrix[row]![pivot]!)
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude
        pivotRow = row
      }
    }
    if (pivotMagnitude <= 1e-12) throw new Error('PDF measurement error: control points define a singular coordinate transformation')
    if (pivotRow !== pivot) {
      const matrixRow = matrix[pivot]!
      matrix[pivot] = matrix[pivotRow]!
      matrix[pivotRow] = matrixRow
      for (let r = 0; r < rightSides.length; r++) {
        const value = rightSides[r]![pivot]!
        rightSides[r]![pivot] = rightSides[r]![pivotRow]!
        rightSides[r]![pivotRow] = value
      }
    }
    const divisor = matrix[pivot]![pivot]!
    for (let col = pivot; col < n; col++) matrix[pivot]![col] = matrix[pivot]![col]! / divisor
    for (let r = 0; r < rightSides.length; r++) rightSides[r]![pivot] = rightSides[r]![pivot]! / divisor
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue
      const factor = matrix[row]![pivot]!
      if (factor === 0) continue
      for (let col = pivot; col < n; col++) matrix[row]![col] = matrix[row]![col]! - factor * matrix[pivot]![col]!
      for (let r = 0; r < rightSides.length; r++) rightSides[r]![row] = rightSides[r]![row]! - factor * rightSides[r]![pivot]!
    }
  }
  return rightSides
}

function radialKernel(distance: number, dimension: 2 | 3): number {
  if (distance === 0) return 0
  return dimension === 2 ? distance * distance * Math.log(distance) : distance
}

function pointDistance(a: PdfMeasurementPoint, b: PdfMeasurementPoint, dimension: 2 | 3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  if (dimension === 2) return Math.hypot(dx, dy)
  return Math.hypot(dx, dy, a[2]! - b[2]!)
}

function copyPoint(point: PdfMeasurementPoint, dimension: 2 | 3): PdfMeasurementPoint {
  return dimension === 2 ? [point[0], point[1]] : [point[0], point[1], point[2]!]
}

function pagePointToLocal(
  bbox: readonly [number, number, number, number],
  point: readonly [number, number],
  z: number,
  dimension: 2 | 3,
): PdfMeasurementPoint {
  const x = (point[0] - bbox[0]) / (bbox[2] - bbox[0])
  const y = (point[1] - bbox[1]) / (bbox[3] - bbox[1])
  return dimension === 2 ? [x, y] : [x, y, z]
}

function requireInsideGeospatialBounds(point: PdfMeasurementPoint, bounds: readonly (readonly [number, number])[] | undefined): void {
  const polygon = bounds ?? [[0, 0], [0, 1], [1, 1], [1, 0]]
  if (!pointInPolygonOrBoundary(point[0], point[1], polygon)) {
    throw new Error('PDF measurement error: point lies outside the geospatial Bounds polygon')
  }
}

function pointInPolygonOrBoundary(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, previous = polygon.length - 1; i < polygon.length; previous = i++) {
    const a = polygon[previous]!
    const b = polygon[i]!
    const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])
    if (Math.abs(cross) <= 1e-12
      && x >= Math.min(a[0], b[0]) - 1e-12 && x <= Math.max(a[0], b[0]) + 1e-12
      && y >= Math.min(a[1], b[1]) - 1e-12 && y <= Math.max(a[1], b[1]) + 1e-12) return true
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function rectilinearMeasure(viewport: PdfMeasurementViewport): PdfRectilinearMeasure {
  validatePdfMeasurementViewport(viewport)
  if (viewport.measure === undefined || viewport.measure.kind !== 'rectilinear') {
    throw new Error('PDF measurement error: operation requires a rectilinear measure')
  }
  return viewport.measure
}

function rectilinearDelta(
  viewport: PdfMeasurementViewport,
  measure: PdfRectilinearMeasure,
  start: readonly [number, number],
  end: readonly [number, number],
  commonUnits: boolean,
): [number, number] {
  const xDirection = Math.sign(viewport.bbox[2] - viewport.bbox[0])
  const yDirection = Math.sign(viewport.bbox[3] - viewport.bbox[1])
  const x = (end[0] - start[0]) * xDirection * measure.x[0]!.conversionFactor
  const yFormats = measure.y ?? measure.x
  let y = (end[1] - start[1]) * yDirection * yFormats[0]!.conversionFactor
  if (commonUnits && measure.y !== undefined) {
    if (measure.yToX === undefined) throw new Error('PDF measurement error: RL distance, area, and angle require CYX when Y is present')
    y *= measure.yToX
  }
  return [x, y]
}

function formattedLastValue(value: number, format: PdfNumberFormat): string {
  const mode = format.mode ?? 'D'
  const separator = format.thousandsSeparator ?? ','
  if (mode === 'R') return groupedInteger(Math.round(value), separator)
  if (mode === 'T') return groupedInteger(Math.trunc(value), separator)
  if (mode === 'F') {
    const denominator = format.precision ?? 16
    let whole = Math.trunc(value)
    let numerator = Math.round((value - whole) * denominator)
    if (numerator === denominator) {
      whole++
      numerator = 0
    }
    let shownNumerator = numerator
    let shownDenominator = denominator
    if (!format.fixedDenominator && numerator !== 0) {
      const divisor = greatestCommonDivisor(numerator, denominator)
      shownNumerator /= divisor
      shownDenominator /= divisor
    }
    const wholeText = groupedInteger(whole, separator)
    if (shownNumerator === 0) return wholeText
    return whole === 0 ? `${shownNumerator}/${shownDenominator}` : `${wholeText} ${shownNumerator}/${shownDenominator}`
  }
  const precision = format.precision ?? 100
  const rounded = Math.round(value * precision) / precision
  const decimalDigits = Math.ceil(Math.log10(precision))
  let text = rounded.toFixed(decimalDigits)
  if (!format.fixedDenominator) text = text.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1')
  const parts = text.split('.')
  const integer = groupedInteger(Number(parts[0]!), separator)
  if (parts.length === 1) return integer
  return integer + (format.decimalSeparator ?? '.') + parts[1]
}

function decoratedUnit(value: string, format: PdfNumberFormat, negative: boolean): string {
  const signedValue = negative ? `-${value}` : value
  const label = (format.labelPrefix ?? ' ') + format.unit + (format.labelSuffix ?? ' ')
  return (format.labelPosition ?? 'S') === 'S' ? signedValue + label : label + signedValue
}

function groupedInteger(value: number, separator: string): string {
  const source = Math.abs(value).toString()
  let result = ''
  for (let i = 0; i < source.length; i++) {
    if (i > 0 && (source.length - i) % 3 === 0) result += separator
    result += source[i]
  }
  return value < 0 ? `-${result}` : result
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const remainder = x % y
    x = y
    y = remainder
  }
  return x
}

function isIntegerWithinTolerance(value: number): boolean {
  return Math.abs(value - Math.round(value)) <= 1e-12
}

function flattenPoints(points: readonly (readonly number[])[]): number[] {
  const values: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let k = 0; k < points[i]!.length; k++) values.push(points[i]![k]!)
  }
  return values
}

function rawPointArray(value: PdfRawValueDef | undefined, dimension: 2 | 3, label: string): PdfMeasurementPoint[] {
  const numbers = rawNumberArrayValue(value, label)
  if (numbers.length === 0 || numbers.length % dimension !== 0) {
    throw new Error(`PDF measurement error: ${label} must contain complete ${dimension}D points`)
  }
  const points = new Array<PdfMeasurementPoint>(numbers.length / dimension)
  for (let i = 0; i < points.length; i++) {
    const offset = i * dimension
    points[i] = dimension === 2
      ? [numbers[offset]!, numbers[offset + 1]!]
      : [numbers[offset]!, numbers[offset + 1]!, numbers[offset + 2]!]
  }
  return points
}

function requirePointDimension(point: readonly number[], dimension: 2 | 3, label: string): void {
  requireFiniteTuple(point, dimension, label)
}

function requireFiniteTuple(values: readonly number[], length: number, label: string): void {
  if (values.length !== length) throw new Error(`PDF measurement error: ${label} must contain ${length} numbers`)
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error(`PDF measurement error: ${label}[${i}] must be finite`)
  }
}

function rawName(value: string): PdfRawValueDef {
  return { kind: 'name', value }
}

function rawText(value: string): PdfRawValueDef {
  return { kind: 'string', bytes: encodePdfTextStringBytes(value) }
}

function rawDictionary(entries: Record<string, PdfRawValueDef>): PdfRawValueDef {
  return { kind: 'dictionary', entries }
}

function rawNumberArray(values: readonly number[]): PdfRawValueDef {
  return { kind: 'array', items: Array.from(values) }
}

function isRawDictionary(value: PdfRawValueDef): value is Extract<PdfRawValueDef, { kind: 'dictionary' }> {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'dictionary'
}

function rawDictionaryValue(value: PdfRawValueDef | undefined, label: string): Record<string, PdfRawValueDef> {
  if (value === undefined || !isRawDictionary(value)) throw new Error(`PDF measurement error: ${label} must be a dictionary`)
  return value.entries
}

function rawArrayValue(value: PdfRawValueDef | undefined, label: string): PdfRawValueDef[] {
  if (value === undefined || typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'array') {
    throw new Error(`PDF measurement error: ${label} must be an array`)
  }
  return value.items
}

function rawNumberArrayValue(value: PdfRawValueDef | undefined, label: string): number[] {
  const items = rawArrayValue(value, label)
  const numbers = new Array<number>(items.length)
  for (let i = 0; i < items.length; i++) numbers[i] = rawNumberValue(items[i], `${label}[${i}]`)
  return numbers
}

function rawFixedNumberTuple(value: PdfRawValueDef | undefined, length: number, label: string): number[] {
  const numbers = rawNumberArrayValue(value, label)
  requireFiniteTuple(numbers, length, label)
  return numbers
}

function rawNameValue(value: PdfRawValueDef | undefined, label: string): string {
  if (value === undefined || typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'name') {
    throw new Error(`PDF measurement error: ${label} must be a name`)
  }
  return value.value
}

function requireOptionalRawName(value: PdfRawValueDef | undefined, expected: string, label: string): void {
  if (value !== undefined && rawNameValue(value, label) !== expected) {
    throw new Error(`PDF measurement error: ${label} must be /${expected}`)
  }
}

function rawTextValue(value: PdfRawValueDef | undefined, label: string): string {
  if (value === undefined || typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'string') {
    throw new Error(`PDF measurement error: ${label} must be a text string`)
  }
  return decodePdfTextStringBytes(value.bytes)
}

function rawNumberValue(value: PdfRawValueDef | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`PDF measurement error: ${label} must be a finite number`)
  return value
}

function rawIntegerValue(value: PdfRawValueDef | undefined, label: string): number {
  const number = rawNumberValue(value, label)
  if (!Number.isInteger(number)) throw new Error(`PDF measurement error: ${label} must be an integer`)
  return number
}

function rawBooleanValue(value: PdfRawValueDef | undefined, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`PDF measurement error: ${label} must be a boolean`)
  return value
}

function rawNumericPointValue(value: PdfRawValueDef | undefined, label: string): number {
  return rawNumberValue(value, label)
}
