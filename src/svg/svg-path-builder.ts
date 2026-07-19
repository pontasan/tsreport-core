/** Serialize a command/coordinate path (0=MoveTo,1=LineTo,2=CubicTo,3=Close) to SVG path data. */
export function buildSvgPathD(commands: Uint8Array, coords: Float32Array): string {
  const parts: string[] = []
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0:
        parts.push(`M${fmt(coords[ci]!)} ${fmt(coords[ci + 1]!)}`)
        ci += 2
        break
      case 1:
        parts.push(`L${fmt(coords[ci]!)} ${fmt(coords[ci + 1]!)}`)
        ci += 2
        break
      case 2:
        parts.push(
          `C${fmt(coords[ci]!)} ${fmt(coords[ci + 1]!)} ${fmt(coords[ci + 2]!)} ${fmt(coords[ci + 3]!)} ${fmt(coords[ci + 4]!)} ${fmt(coords[ci + 5]!)}`,
        )
        ci += 6
        break
      case 3:
        parts.push('Z')
        break
    }
  }
  return parts.join('')
}

function fmt(n: number): string {
  if (Math.abs(n) < 1e-9) return '0'
  const s = n.toFixed(4)
  return s.replace(/\.?0+$/, '')
}
