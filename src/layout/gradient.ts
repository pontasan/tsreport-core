import type { FillDef, GradientDef, MeshGradientDef, TileGraphicDef, TilingPatternDef } from '../types/template.js'
import type { GradientPaint, MeshGradientPaint, PaintValue, TileGraphic, TilingPatternPaint } from '../renderer/backend.js'
import { multiplyPaintMatrix, transformMeshPaint, type PaintMatrix } from '../renderer/complex-paint.js'
import { parseSvgPath } from '../svg/svg-path-parser.js'

const IDENTITY: PaintMatrix = [1, 0, 0, 1, 0, 0]

export function resolveFillPaint(def: FillDef | undefined, x: number, y: number, width: number, height: number): PaintValue | undefined {
  if (def === undefined) return undefined
  if (typeof def === 'string') return def
  if (def.type === 'pdfSpecialColor') return def
  if (def.type === 'meshGradient') return resolveMeshPaint(def, x, y)
  if (def.type === 'tilingPattern') return resolveTilingPaint(def, x, y)
  if (def.type === 'functionShading') {
    if ('sampled' in def) {
      return {
        type: 'function-shading',
        domain: [def.domain[0], def.domain[1], def.domain[2], def.domain[3]],
        matrix: multiplyPaintMatrix([1, 0, 0, 1, x, y], def.matrix ?? IDENTITY),
        background: def.background === undefined ? undefined : [def.background[0], def.background[1], def.background[2]],
        bbox: def.bbox === undefined ? undefined : [def.bbox[0], def.bbox[1], def.bbox[2], def.bbox[3]],
        antiAlias: def.antiAlias,
        paintOperator: def.paintOperator,
        sampled: {
          size: [def.sampled.size[0], def.sampled.size[1]],
          bitsPerSample: def.sampled.bitsPerSample,
          range: [
            def.sampled.range[0], def.sampled.range[1],
            def.sampled.range[2], def.sampled.range[3],
            def.sampled.range[4], def.sampled.range[5],
          ],
          samples: def.sampled.samples.slice(),
          encode: def.sampled.encode === undefined ? undefined : [
            def.sampled.encode[0], def.sampled.encode[1], def.sampled.encode[2], def.sampled.encode[3],
          ],
          decode: def.sampled.decode === undefined ? undefined : [
            def.sampled.decode[0], def.sampled.decode[1],
            def.sampled.decode[2], def.sampled.decode[3],
            def.sampled.decode[4], def.sampled.decode[5],
          ],
        },
      }
    }
    return {
      type: 'function-shading',
      domain: [def.domain[0], def.domain[1], def.domain[2], def.domain[3]],
      matrix: multiplyPaintMatrix([1, 0, 0, 1, x, y], def.matrix ?? IDENTITY),
      background: def.background === undefined ? undefined : [def.background[0], def.background[1], def.background[2]],
      bbox: def.bbox === undefined ? undefined : [def.bbox[0], def.bbox[1], def.bbox[2], def.bbox[3]],
      antiAlias: def.antiAlias,
      paintOperator: def.paintOperator,
      expression: def.expression,
    }
  }
  return resolveGradientPaint(def, x, y, width, height)
}

export function resolveGradientPaint(def: GradientDef, x: number, y: number, width: number, height: number): GradientPaint {
  if (def.type === 'linearGradient') {
    return {
      type: 'linear-gradient',
      x1: x + (def.x1 ?? 0) * width,
      y1: y + (def.y1 ?? 0) * height,
      x2: x + (def.x2 ?? 1) * width,
      y2: y + (def.y2 ?? 0) * height,
      stops: def.stops,
      spreadMethod: def.spreadMethod,
      pdfShading: translateGradientShading(def.pdfShading, x, y),
    }
  }
  return {
    type: 'radial-gradient',
    cx: x + (def.cx ?? 0.5) * width,
    cy: y + (def.cy ?? 0.5) * height,
    r: (def.r ?? 0.5) * Math.max(width, height),
    fx: x + (def.fx ?? def.cx ?? 0.5) * width,
    fy: y + (def.fy ?? def.cy ?? 0.5) * height,
    fr: (def.fr ?? 0) * Math.max(width, height),
    stops: def.stops,
    spreadMethod: def.spreadMethod,
    pdfShading: translateGradientShading(def.pdfShading, x, y),
  }
}

function translateGradientShading(
  shading: import('../types/template.js').PdfAxialRadialShadingDef | undefined,
  x: number,
  y: number,
): import('../types/template.js').PdfAxialRadialShadingDef | undefined {
  if (shading?.native === undefined) return shading
  return {
    ...shading,
    native: {
      ...shading.native,
      patternMatrix: multiplyPaintMatrix([1, 0, 0, 1, x, y], shading.native.patternMatrix),
    },
  }
}

/** Mesh geometry is element-local pt: shifting to the element position is enough. */
function resolveMeshPaint(def: MeshGradientDef, x: number, y: number): MeshGradientPaint {
  return transformMeshPaint(
    {
      type: 'mesh-gradient',
      patches: def.patches ?? [],
      triangles: def.triangles ?? [],
      packedPatches: def.packedPatches,
      packedTriangles: def.packedTriangles,
      lattice: def.lattice,
      pdfShading: def.pdfShading,
    },
    [1, 0, 0, 1, x, y],
  )
}

/** Tile graphics stay in pattern space; the matrix carries them onto the page. */
function resolveTilingPaint(def: TilingPatternDef, x: number, y: number): TilingPatternPaint {
  const bbox = def.bbox
  return {
    type: 'tiling-pattern',
    tilingType: def.tilingType,
    paintType: def.paintType,
    color: def.color,
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    xStep: def.xStep,
    yStep: def.yStep,
    matrix: multiplyPaintMatrix([1, 0, 0, 1, x, y], def.matrix ?? IDENTITY),
    graphics: def.graphics.map(function (graphic) { return resolveTileGraphic(graphic, bbox) }),
  }
}

function resolveTileGraphic(def: TileGraphicDef, bbox: [number, number, number, number]): TileGraphic {
  if (def.kind === 'group') {
    return {
      kind: 'group',
      x: def.x,
      y: def.y,
      width: def.width,
      height: def.height,
      affineTransform: def.affineTransform,
      clipPath: def.clipPath === undefined ? undefined : { ...parseSvgPath(def.clipPath.d), fillRule: def.clipPath.fillRule },
      opacity: def.opacity,
      blendMode: def.blendMode,
      overprintFill: def.overprintFill,
      overprintStroke: def.overprintStroke,
      overprintMode: def.overprintMode,
      renderingIntent: def.renderingIntent,
      alphaIsShape: def.alphaIsShape,
      textKnockout: def.textKnockout,
      optionalContent: def.optionalContent === undefined ? undefined : { ...def.optionalContent },
      transparencyGroup: def.transparencyGroup,
      isolated: def.isolated,
      knockout: def.knockout,
      deviceParams: def.deviceParams,
      pdfForm: def.pdfForm,
      softMask: def.softMask === undefined ? undefined : {
        type: def.softMask.type,
        colorSpace: def.softMask.colorSpace,
        isolated: def.softMask.isolated,
        knockout: def.softMask.knockout,
        backdrop: def.softMask.backdrop,
        transferFunction: def.softMask.transferFunction,
        graphics: def.softMask.graphics.map(function (graphic) { return resolveTileGraphic(graphic, bbox) }),
      },
      graphics: def.graphics.map(function (graphic) { return resolveTileGraphic(graphic, bbox) }),
    }
  }
  if (def.kind === 'image') {
    return { kind: 'image', x: def.x, y: def.y, width: def.width, height: def.height, imageId: def.source }
  }
  if (def.kind === 'text') {
    return { kind: 'text', x: def.x, y: def.y, text: def.text, fontId: def.fontFamily, fontSize: def.fontSize, color: def.color }
  }
  const path = parseSvgPath(def.d)
  const dx = def.x ?? 0
  const dy = def.y ?? 0
  let coords = path.coords
  if (dx !== 0 || dy !== 0) {
    coords = new Float32Array(path.coords.length)
    for (let i = 0; i < path.coords.length; i += 2) {
      coords[i] = path.coords[i]! + dx
      coords[i + 1] = path.coords[i + 1]! + dy
    }
  }
  return {
    kind: 'path',
    commands: path.commands,
    coords,
    fill: resolveTilePaint(def.fill, bbox),
    stroke: resolveTilePaint(def.stroke, bbox),
    strokeWidth: def.strokeWidth,
    fillRule: def.fillRule,
  }
}

function resolveTilePaint(def: FillDef | undefined, bbox: [number, number, number, number]): PaintValue | undefined {
  return resolveFillPaint(def, bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1])
}

export function offsetPaintValue(paint: PaintValue | undefined, dx: number, dy: number): PaintValue | undefined {
  if (paint === undefined || typeof paint === 'string') return paint
  if (paint.type === 'pdfSpecialColor') return paint
  if (paint.type === 'mesh-gradient') return transformMeshPaint(paint, [1, 0, 0, 1, dx, dy])
  if (paint.type === 'tiling-pattern' || paint.type === 'function-shading') {
    const m = paint.matrix
    return { ...paint, matrix: [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy] }
  }
  return offsetGradientPaint(paint, dx, dy)
}

export function offsetGradientPaint(paint: GradientPaint, dx: number, dy: number): GradientPaint {
  if (paint.type === 'linear-gradient') {
    return {
      ...paint,
      x1: paint.x1 + dx,
      y1: paint.y1 + dy,
      x2: paint.x2 + dx,
      y2: paint.y2 + dy,
    }
  }
  return {
    ...paint,
    cx: paint.cx + dx,
    cy: paint.cy + dy,
    fx: paint.fx === undefined ? undefined : paint.fx + dx,
    fy: paint.fy === undefined ? undefined : paint.fy + dy,
  }
}

export function scalePaintY(paint: PaintValue | undefined, originY: number, scaleY: number): PaintValue | undefined {
  if (paint === undefined || typeof paint === 'string') return paint
  if (paint.type === 'pdfSpecialColor') return paint
  if (paint.type === 'mesh-gradient') {
    // y' = originY + (y - originY) * scaleY as an affine map
    return transformMeshPaint(paint, [1, 0, 0, scaleY, 0, originY * (1 - scaleY)])
  }
  if (paint.type === 'tiling-pattern' || paint.type === 'function-shading') {
    return { ...paint, matrix: multiplyPaintMatrix([1, 0, 0, scaleY, 0, originY * (1 - scaleY)], paint.matrix) }
  }
  if (paint.type === 'linear-gradient') {
    return {
      ...paint,
      y1: originY + (paint.y1 - originY) * scaleY,
      y2: originY + (paint.y2 - originY) * scaleY,
    }
  }
  return {
    ...paint,
    cy: originY + (paint.cy - originY) * scaleY,
    fy: paint.fy === undefined ? undefined : originY + (paint.fy - originY) * scaleY,
    r: paint.r * Math.abs(scaleY),
    fr: paint.fr === undefined ? undefined : paint.fr * Math.abs(scaleY),
  }
}
