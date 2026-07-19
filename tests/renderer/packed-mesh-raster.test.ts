import { describe, expect, it } from 'vitest'
import { rasterizePackedMesh } from '../../src/renderer/packed-mesh-raster.js'
import type { MeshGradientPaint } from '../../src/renderer/backend.js'

function joinedCurvedPatches(): Float32Array {
  const points: number[] = []
  const sharedX = [20, 30, 10, 20]
  const sharedY = [0, 13, 27, 40]
  for (let row = 0; row < 4; row++) {
    const ratio = row / 3
    for (let column = 0; column < 4; column++) {
      points.push(sharedX[column]! * ratio, sharedY[column]!)
    }
  }
  for (let row = 0; row < 4; row++) {
    const ratio = row / 3
    for (let column = 0; column < 4; column++) {
      points.push(sharedX[column]! + (100 - sharedX[column]!) * ratio, sharedY[column]!)
    }
  }
  return new Float32Array(points)
}

describe('packed mesh device raster', () => {
  it('covers a curved shared patch edge without grid seams or pinholes', () => {
    const paint: MeshGradientPaint = {
      type: 'mesh-gradient', patches: [], triangles: [],
      packedPatches: {
        points: joinedCurvedPatches(),
        colors: new Uint32Array([
          0x6699cc, 0x6699cc, 0x6699cc, 0x6699cc,
          0x6699cc, 0x6699cc, 0x6699cc, 0x6699cc,
        ]),
      },
    }
    const raster = rasterizePackedMesh(paint, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 101, 41)
    expect(raster).not.toBeNull()
    for (let y = 1; y < 39; y++) {
      for (let x = 1; x < 99; x++) {
        const localX = x - raster!.x
        const localY = y - raster!.y
        expect(raster!.data[(localY * raster!.width + localX) * 4 + 3], `transparent pixel at ${x},${y}`).toBe(255)
      }
    }
  })
})
