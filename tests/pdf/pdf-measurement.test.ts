import { describe, expect, it } from 'vitest'
import {
  PdfBackend,
  PdfImporter,
  collectPdfPages,
  convertPdfMeasurementPointToPage,
  convertPdfPagePointToMeasurement,
  extractPdfPointDataCoordinates,
  formatPdfMeasurement,
  measurePdfAngle,
  measurePdfArea,
  measurePdfPolyline,
  measurePdfSlope,
  parsePdf,
  pdfMeasurementViewportFromRaw,
  pdfMeasurementViewportToRaw,
  selectPdfMeasurementViewport,
  type PdfMeasurementViewport,
  type PdfPointData,
} from '../../src/index.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'

function rectilinearViewport(): PdfMeasurementViewport {
  return {
    bbox: [0, 0, 100, 100],
    name: 'Scale 1:10',
    measure: {
      kind: 'rectilinear',
      scaleRatio: '1 cm = 1 m',
      x: [{ unit: 'm', conversionFactor: 0.1 }],
      distance: [{ unit: 'm', conversionFactor: 1 }],
      area: [{ unit: 'm²', conversionFactor: 1 }],
      angle: [{ unit: '°', conversionFactor: 1, precision: 10 }],
      slope: [{ unit: '%', conversionFactor: 100, precision: 10 }],
    },
  }
}

function geospatialViewport(): PdfMeasurementViewport {
  return {
    bbox: [10, 20, 210, 120],
    name: 'Registered map',
    measure: {
      kind: 'geospatial',
      dimension: 2,
      coordinateSystem: { kind: 'geographic', epsg: 4326, wkt: 'GEOGCS["WGS 84"]' },
      displayCoordinateSystem: { kind: 'geographic', epsg: 4326 },
      preferredDisplayUnits: { linear: 'M', area: 'SQM', angular: 'DEG' },
      bounds: [[0, 0], [0, 1], [1, 1], [1, 0]],
      localPoints: [[0, 0], [1, 0], [1, 1], [0, 1]],
      geographicPoints: [[10, 20], [10, 30], [20, 30], [20, 20]],
    },
    pointData: [{
      names: ['LAT', 'LON', 'ALT', 'LABEL'],
      rows: [
        [10, 20, 15, { kind: 'string', bytes: new Uint8Array([0x41]) }],
        [20, 30, 25, { kind: 'string', bytes: new Uint8Array([0x42]) }],
      ],
    }],
  }
}

describe('PDF measurement and geospatial semantics', () => {
  it('implements the number-format-array algorithm for compound, decimal, rounded, and truncated units', () => {
    const distance = formatPdfMeasurement(1.4505, [
      { unit: 'mi', conversionFactor: 1 },
      { unit: 'ft', conversionFactor: 5280 },
      { unit: 'in', conversionFactor: 12, mode: 'F', precision: 8 },
    ])
    expect(distance.trim()).toBe('1 mi 2,378 ft 7 5/8 in')
    expect(formatPdfMeasurement(1234.5, [{
      unit: 'm', conversionFactor: 1, mode: 'D', precision: 100,
      fixedDenominator: true, thousandsSeparator: '.', decimalSeparator: ',',
      labelPosition: 'P', labelPrefix: '', labelSuffix: ' ',
    }])).toBe('m 1.234,50')
    expect(formatPdfMeasurement(2.6, [{ unit: 'u', conversionFactor: 1, mode: 'R', labelPrefix: '', labelSuffix: '' }])).toBe('3u')
    expect(formatPdfMeasurement(2.6, [{ unit: 'u', conversionFactor: 1, mode: 'T', labelPrefix: '', labelSuffix: '' }])).toBe('2u')
  })

  it('round-trips every RL number-format and coordinate field through raw PDF values', () => {
    const viewport = rectilinearViewport()
    const raw = pdfMeasurementViewportToRaw(viewport)
    const parsed = pdfMeasurementViewportFromRaw(raw)
    expect(parsed).toEqual(viewport)
    expect(convertPdfPagePointToMeasurement(parsed, [30, 40])).toEqual({
      kind: 'rectilinear', x: 3, y: 4, formattedX: '3 m ', formattedY: '4 m ',
    })
  })

  it('measures RL distance, area, angle, and slope with the authored axis conversions', () => {
    const viewport = rectilinearViewport()
    expect(measurePdfPolyline(viewport, [[0, 0], [30, 40]])).toEqual({ value: 5, formatted: '5 m ' })
    expect(measurePdfArea(viewport, [[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual({ value: 1, formatted: '1 m² ' })
    expect(measurePdfAngle(viewport, [0, 0], [10, 10])).toEqual({ value: 45, formatted: '45 ° ' })
    expect(measurePdfSlope(viewport, [0, 0], [10, 10])).toEqual({ value: 100, formatted: '100 % ' })

    const differingAxes: PdfMeasurementViewport = {
      bbox: [0, 0, 100, 100],
      measure: {
        kind: 'rectilinear', scaleRatio: 'independent axes',
        x: [{ unit: 'm', conversionFactor: 1 }],
        y: [{ unit: 'ft', conversionFactor: 1 }], yToX: 0.3048,
        distance: [{ unit: 'm', conversionFactor: 1 }],
        area: [{ unit: 'm²', conversionFactor: 1 }],
      },
    }
    expect(measurePdfPolyline(differingAxes, [[0, 0], [0, 10]]).value).toBeCloseTo(3.048, 12)
  })

  it('uses reverse drawing order when overlapping viewports are selected', () => {
    const first = rectilinearViewport()
    const second = { ...rectilinearViewport(), bbox: [25, 25, 75, 75] as [number, number, number, number] }
    expect(selectPdfMeasurementViewport([first, second], [50, 50])).toBe(second)
    expect(selectPdfMeasurementViewport([first, second], [90, 90])).toBe(first)
    expect(selectPdfMeasurementViewport([first, second], [200, 200])).toBeNull()
  })

  it('maps GEO control points and intermediate positions in both directions', () => {
    const viewport = geospatialViewport()
    const coordinate = convertPdfPagePointToMeasurement(viewport, [110, 70])
    expect(coordinate.kind).toBe('geospatial')
    if (coordinate.kind !== 'geospatial') throw new Error('expected geospatial coordinate')
    expect(coordinate.point[0]).toBeCloseTo(15, 10)
    expect(coordinate.point[1]).toBeCloseTo(25, 10)
    const page = convertPdfMeasurementPointToPage(viewport, [15, 25])
    expect(page[0]).toBeCloseTo(110, 8)
    expect(page[1]).toBeCloseTo(70, 8)
  })

  it('gives PCSM priority for projected coordinates and supports its inverse', () => {
    const viewport: PdfMeasurementViewport = {
      bbox: [0, 0, 100, 100],
      measure: {
        kind: 'geospatial',
        coordinateSystem: { kind: 'projected', epsg: 3857 },
        localPoints: [[0, 0], [1, 0], [0, 1]],
        geographicPoints: [[0, 0], [1, 0], [0, 1]],
        projectedCoordinateSystemMatrix: [2, 0, 0, 0, 3, 0, 0, 0, 1, 100, 200, 0],
      },
    }
    const coordinate = convertPdfPagePointToMeasurement(viewport, [50, 50])
    if (coordinate.kind !== 'geospatial') throw new Error('expected geospatial coordinate')
    expect(coordinate.point).toEqual([101, 201.5])
    expect(convertPdfMeasurementPointToPage(viewport, [101, 201.5])).toEqual([50, 50])
  })

  it('applies the full 3D PCSM row-order affine transformation', () => {
    const viewport: PdfMeasurementViewport = {
      bbox: [0, 0, 100, 100],
      measure: {
        kind: 'geospatial', dimension: 3,
        coordinateSystem: { kind: 'projected', epsg: 4978 },
        localPoints: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
        geographicPoints: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
        projectedCoordinateSystemMatrix: [2, 0, 0, 0, 3, 0, 0, 0, 4, 100, 200, 300],
      },
    }
    const coordinate = convertPdfPagePointToMeasurement(viewport, [50, 50], 0.25)
    if (coordinate.kind !== 'geospatial') throw new Error('expected geospatial coordinate')
    expect(coordinate.point).toEqual([101, 201.5, 301])
    expect(convertPdfMeasurementPointToPage(viewport, [101, 201.5, 301])).toEqual([50, 50, 0.25])
    expect(pdfMeasurementViewportFromRaw(pdfMeasurementViewportToRaw(viewport), 3)).toEqual(viewport)
  })

  it('round-trips point data and extracts standard LAT/LON/ALT columns', () => {
    const viewport = geospatialViewport()
    const parsed = pdfMeasurementViewportFromRaw(pdfMeasurementViewportToRaw(viewport))
    expect(parsed).toEqual(viewport)
    expect(extractPdfPointDataCoordinates(parsed.pointData![0]!)).toEqual([
      { latitude: 10, longitude: 20, altitude: 15 },
      { latitude: 20, longitude: 30, altitude: 25 },
    ])
  })

  it('connects typed viewports to PDF output and importer coordinate APIs', () => {
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(240, 140, { viewports: [geospatialViewport()] })
    backend.endPage()
    backend.endDocument()
    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')

    const doc = parsePdf(bytes)
    const page = collectPdfPages(doc)[0]!.dict
    const viewports = doc.resolve(page.get('VP') ?? null) as unknown[]
    const viewport = doc.resolve(viewports[0] as never) as Map<string, unknown>
    const measure = doc.resolve(viewport.get('Measure') as never) as Map<string, unknown>
    expect(measure.get('Subtype')).toMatchObject({ name: 'GEO' })
    expect(doc.resolve(measure.get('PCSM') ?? null)).toBeNull()

    const properties = PdfImporter.open(bytes).importPageProperties(0)
    expect(properties.measurementViewports).toHaveLength(1)
    const converted = convertPdfPagePointToMeasurement(properties.measurementViewports![0]!, [110, 70])
    if (converted.kind !== 'geospatial') throw new Error('expected geospatial coordinate')
    expect(converted.point[0]).toBeCloseTo(15, 10)
    expect(converted.point[1]).toBeCloseTo(25, 10)
  })

  it('round-trips Measure and PtData on Form XObjects through rendered frames', () => {
    const source = geospatialViewport()
    const backend = new PdfBackend({ fonts: {} })
    backend.beginDocument()
    backend.beginPage(240, 140)
    backend.beginPdfForm({
      bbox: [0, 0, 200, 100], matrix: [1, 0, 0, 1, 10, 20], invocationMatrix: [1, 0, 0, 1, 0, 0],
      measure: source.measure, pointData: source.pointData,
    })
    backend.endPdfForm()
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const imported = PdfImporter.open(bytes).importPage(0)
    const frame = imported.elements.find(function (element) { return element.type === 'frame' })
    expect(frame?.type).toBe('frame')
    if (frame?.type !== 'frame' || frame.pdfForm === undefined) throw new Error('expected imported Form XObject frame')
    expect(frame.pdfForm.measure).toEqual(source.measure)
    expect(frame.pdfForm.pointData).toEqual(source.pointData)
  })

  it('round-trips Measure and PtData on Image XObjects through image elements', () => {
    const source = geospatialViewport()
    const png = encodePngRgba(1, 1, new Uint8Array([0, 128, 255, 255]))
    const backend = new PdfBackend({ fonts: {}, images: { map: png } })
    backend.beginDocument()
    backend.beginPage(240, 140)
    backend.drawImage(10, 20, 200, 100, 'map', { measure: source.measure, pointData: source.pointData })
    backend.endPage()
    backend.endDocument()

    const bytes = backend.toUint8Array()
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    const imported = PdfImporter.open(bytes).importPage(0)
    const image = imported.elements.find(function (element) { return element.type === 'image' })
    expect(image?.type).toBe('image')
    if (image?.type !== 'image') throw new Error('expected imported Image XObject')
    expect(image.measure).toEqual(source.measure)
    expect(image.pointData).toEqual(source.pointData)
  })

  it('rejects malformed coordinate systems, point arrays, display units, and bounds', () => {
    const raw = pdfMeasurementViewportToRaw(geospatialViewport())
    const measure = (raw.Measure as { kind: 'dictionary', entries: Record<string, unknown> }).entries
    delete measure.GCS
    expect(() => pdfMeasurementViewportFromRaw(raw)).toThrow(/GCS/)

    const invalid = geospatialViewport()
    const geo = invalid.measure!
    if (geo.kind !== 'geospatial') throw new Error('expected geospatial measure')
    geo.preferredDisplayUnits = { linear: 'M', area: 'SQM', angular: 'RAD' as 'DEG' }
    expect(() => pdfMeasurementViewportToRaw(invalid)).toThrow(/PDU/)

    const outside = geospatialViewport()
    expect(() => convertPdfPagePointToMeasurement(outside, [500, 500])).toThrow(/Bounds/)
  })

  it('preserves custom point-data values while enforcing numeric predefined columns', () => {
    const valid: PdfPointData = { names: ['LAT', 'LON', 'ID'], rows: [[1, 2, { kind: 'name', value: 'A' }]] }
    expect(extractPdfPointDataCoordinates(valid)).toEqual([{ latitude: 1, longitude: 2 }])
    const invalid: PdfPointData = {
      names: ['LAT', 'LON'],
      rows: [[{ kind: 'name', value: 'north' }, 2]],
    }
    expect(() => extractPdfPointDataCoordinates(invalid)).toThrow(/LAT values must be numbers/)
  })
})
