import { buildSvgPathD } from '../svg/svg-path-builder.js'
import type { PathDef, PdfSourceVectorDef } from '../types/template.js'

export interface MaterializedPdfSourceVector {
  commands: Uint8Array
  coords: Float32Array
  d: string
}

/** Expands shared PDF-source definitions into one ordinary local path. */
export function materializePdfSourceVector(source: PdfSourceVectorDef): MaterializedPdfSourceVector {
  let commandCount = 0
  let coordinateCount = 0
  for (let i = 0; i < source.instances.length; i++) {
    const definition = source.definitions[source.instances[i]!.definitionIndex]
    if (definition === undefined) throw new Error(`PDF source vector definition ${source.instances[i]!.definitionIndex} is missing`)
    commandCount += definition.commands.length
    coordinateCount += definition.coords.length
  }

  const commands = new Uint8Array(commandCount)
  const coords = new Float32Array(coordinateCount)
  let commandOffset = 0
  let coordinateOffset = 0
  for (let i = 0; i < source.instances.length; i++) {
    const instance = source.instances[i]!
    const definition = source.definitions[instance.definitionIndex]!
    commands.set(definition.commands, commandOffset)
    commandOffset += definition.commands.length
    const matrix = instance.matrix
    for (let c = 0; c < definition.coords.length; c += 2) {
      const x = definition.coords[c]!
      const y = definition.coords[c + 1]!
      coords[coordinateOffset++] = matrix[0] * x + matrix[2] * y + matrix[4]
      coords[coordinateOffset++] = matrix[1] * x + matrix[3] * y + matrix[5]
    }
  }
  return { commands, coords, d: buildSvgPathD(commands, coords) }
}

/** Materializes an immutable source-backed path for explicit editor unlock. */
export function materializePdfSourceVectorPath(path: PathDef): PathDef {
  if (path.pdfSourceVector === undefined) return path
  const materialized = materializePdfSourceVector(path.pdfSourceVector)
  const { pdfSourceVector: _source, ...ordinaryPath } = path
  return { ...ordinaryPath, d: materialized.d }
}
