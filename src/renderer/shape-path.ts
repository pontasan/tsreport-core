import { resolveRectCornerRadii, type RectCornerRadii } from './backend.js'

const KAPPA = 0.5522847498307936

export interface PathArrays {
  commands: Uint8Array
  coords: Float32Array
}

export function rectToPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius?: number,
  cornerRadii?: RectCornerRadii,
): PathArrays {
  const radii = resolveRectCornerRadii(width, height, { radius, cornerRadii })
  const cmds: number[] = []
  const coords: number[] = []
  const right = x + width
  const bottom = y + height

  cmds.push(0)
  coords.push(x + radii.topLeft, y)

  cmds.push(1)
  coords.push(right - radii.topRight, y)
  appendCorner(cmds, coords, right - radii.topRight, y + radii.topRight, radii.topRight, 0)

  cmds.push(1)
  coords.push(right, bottom - radii.bottomRight)
  appendCorner(cmds, coords, right - radii.bottomRight, bottom - radii.bottomRight, radii.bottomRight, 1)

  cmds.push(1)
  coords.push(x + radii.bottomLeft, bottom)
  appendCorner(cmds, coords, x + radii.bottomLeft, bottom - radii.bottomLeft, radii.bottomLeft, 2)

  cmds.push(1)
  coords.push(x, y + radii.topLeft)
  appendCorner(cmds, coords, x + radii.topLeft, y + radii.topLeft, radii.topLeft, 3)

  cmds.push(3)
  return { commands: new Uint8Array(cmds), coords: new Float32Array(coords) }
}

export function ellipseToPath(cx: number, cy: number, rx: number, ry: number): PathArrays {
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  return {
    commands: new Uint8Array([0, 2, 2, 2, 2, 3]),
    coords: new Float32Array([
      cx + rx, cy,
      cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry,
      cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy,
      cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry,
      cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy,
    ]),
  }
}

function appendCorner(cmds: number[], coords: number[], cx: number, cy: number, r: number, corner: number): void {
  if (r <= 0) return
  const k = r * KAPPA
  cmds.push(2)
  if (corner === 0) {
    coords.push(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
  } else if (corner === 1) {
    coords.push(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
  } else if (corner === 2) {
    coords.push(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
  } else {
    coords.push(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
  }
}
