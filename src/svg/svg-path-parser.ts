/**
 * SVG path d attribute parser
 *
 * Parses all SVG path data commands (M/L/H/V/C/S/Q/T/A/Z plus their
 * lowercase relative variants) into PathCommand (MoveTo/LineTo/CubicTo/Close).
 * Quadratic Beziers (Q/T) are promoted to cubic; elliptical arcs (A) are
 * approximated with cubic Beziers.
 *
 * Output: Uint8Array (commands) + Float32Array (coords)
 * PathCommand: 0=MoveTo, 1=LineTo, 2=CubicTo, 3=Close
 */

/** Parse result */
export interface SvgPathData {
  commands: Uint8Array
  coords: Float32Array
}

/**
 * Parses an SVG path d attribute string into a PathCommand sequence
 */
export function parseSvgPath(d: string): SvgPathData {
  const cmds: number[] = []
  const cds: number[] = []

  let i = 0
  const len = d.length
  let curX = 0
  let curY = 0
  let startX = 0
  let startY = 0
  // Previous control point (for S/T commands)
  let prevCp2x = 0
  let prevCp2y = 0
  let prevCmd = ''

  while (i < len) {
    // Skip whitespace and commas
    i = skipWsp(d, i, len)
    if (i >= len) break

    let cc = d.charCodeAt(i)

    // Detect command character
    let cmd = ''
    if (isCommand(cc)) {
      cmd = d[i]!
      i++
    } else {
      // Implicit command repetition is only meaningful when a coordinate
      // (digit/sign) follows a previous coordinate-consuming command. A stray
      // character, or a coordinate right after a closepath (prevCmd cleared),
      // cannot be consumed by any command, so skip it: this guarantees the
      // scanner always advances and never spins on input like "Z5" or "L@".
      if (prevCmd === '' || !isDigitOrSign(cc)) {
        i++
        continue
      }
      if (prevCmd === 'M') cmd = 'L'
      else if (prevCmd === 'm') cmd = 'l'
      else cmd = prevCmd
    }

    switch (cmd) {
      case 'M': {
        const x = readNumber(d, i, len)
        i = x.end
        const y = readNumber(d, i, len)
        i = y.end
        curX = x.value
        curY = y.value
        startX = curX
        startY = curY
        cmds.push(0) // MoveTo
        cds.push(curX, curY)
        prevCmd = 'M'
        // Implicit coordinates after M are treated as L
        i = skipWspComma(d, i, len)
        while (i < len && isDigitOrSign(d.charCodeAt(i))) {
          const nx = readNumber(d, i, len)
          i = nx.end
          const ny = readNumber(d, i, len)
          i = ny.end
          curX = nx.value
          curY = ny.value
          cmds.push(1) // LineTo
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        }
        break
      }
      case 'm': {
        const x = readNumber(d, i, len)
        i = x.end
        const y = readNumber(d, i, len)
        i = y.end
        curX += x.value
        curY += y.value
        startX = curX
        startY = curY
        cmds.push(0)
        cds.push(curX, curY)
        prevCmd = 'm'
        i = skipWspComma(d, i, len)
        while (i < len && isDigitOrSign(d.charCodeAt(i))) {
          const nx = readNumber(d, i, len)
          i = nx.end
          const ny = readNumber(d, i, len)
          i = ny.end
          curX += nx.value
          curY += ny.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        }
        break
      }
      case 'L': {
        do {
          const x = readNumber(d, i, len)
          i = x.end
          const y = readNumber(d, i, len)
          i = y.end
          curX = x.value
          curY = y.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'L'
        break
      }
      case 'l': {
        do {
          const dx = readNumber(d, i, len)
          i = dx.end
          const dy = readNumber(d, i, len)
          i = dy.end
          curX += dx.value
          curY += dy.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'l'
        break
      }
      case 'H': {
        do {
          const x = readNumber(d, i, len)
          i = x.end
          curX = x.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'H'
        break
      }
      case 'h': {
        do {
          const dx = readNumber(d, i, len)
          i = dx.end
          curX += dx.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'h'
        break
      }
      case 'V': {
        do {
          const y = readNumber(d, i, len)
          i = y.end
          curY = y.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'V'
        break
      }
      case 'v': {
        do {
          const dy = readNumber(d, i, len)
          i = dy.end
          curY += dy.value
          cmds.push(1)
          cds.push(curX, curY)
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'v'
        break
      }
      case 'C': {
        do {
          const x1 = readNumber(d, i, len); i = x1.end
          const y1 = readNumber(d, i, len); i = y1.end
          const x2 = readNumber(d, i, len); i = x2.end
          const y2 = readNumber(d, i, len); i = y2.end
          const x = readNumber(d, i, len); i = x.end
          const y = readNumber(d, i, len); i = y.end
          cmds.push(2)
          cds.push(x1.value, y1.value, x2.value, y2.value, x.value, y.value)
          prevCp2x = x2.value
          prevCp2y = y2.value
          curX = x.value
          curY = y.value
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'C'
        break
      }
      case 'c': {
        do {
          const dx1 = readNumber(d, i, len); i = dx1.end
          const dy1 = readNumber(d, i, len); i = dy1.end
          const dx2 = readNumber(d, i, len); i = dx2.end
          const dy2 = readNumber(d, i, len); i = dy2.end
          const dx = readNumber(d, i, len); i = dx.end
          const dy = readNumber(d, i, len); i = dy.end
          const cp1x = curX + dx1.value
          const cp1y = curY + dy1.value
          const cp2x = curX + dx2.value
          const cp2y = curY + dy2.value
          curX += dx.value
          curY += dy.value
          cmds.push(2)
          cds.push(cp1x, cp1y, cp2x, cp2y, curX, curY)
          prevCp2x = cp2x
          prevCp2y = cp2y
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'c'
        break
      }
      case 'S': {
        do {
          // Reflect the previous second control point
          let cp1x: number, cp1y: number
          if (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's') {
            cp1x = 2 * curX - prevCp2x
            cp1y = 2 * curY - prevCp2y
          } else {
            cp1x = curX
            cp1y = curY
          }
          const x2 = readNumber(d, i, len); i = x2.end
          const y2 = readNumber(d, i, len); i = y2.end
          const x = readNumber(d, i, len); i = x.end
          const y = readNumber(d, i, len); i = y.end
          cmds.push(2)
          cds.push(cp1x, cp1y, x2.value, y2.value, x.value, y.value)
          prevCp2x = x2.value
          prevCp2y = y2.value
          curX = x.value
          curY = y.value
          prevCmd = 'S'
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        break
      }
      case 's': {
        do {
          let cp1x: number, cp1y: number
          if (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's') {
            cp1x = 2 * curX - prevCp2x
            cp1y = 2 * curY - prevCp2y
          } else {
            cp1x = curX
            cp1y = curY
          }
          const dx2 = readNumber(d, i, len); i = dx2.end
          const dy2 = readNumber(d, i, len); i = dy2.end
          const dx = readNumber(d, i, len); i = dx.end
          const dy = readNumber(d, i, len); i = dy.end
          const cp2x = curX + dx2.value
          const cp2y = curY + dy2.value
          curX += dx.value
          curY += dy.value
          cmds.push(2)
          cds.push(cp1x, cp1y, cp2x, cp2y, curX, curY)
          prevCp2x = cp2x
          prevCp2y = cp2y
          prevCmd = 's'
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        break
      }
      case 'Q': {
        do {
          const qx = readNumber(d, i, len); i = qx.end
          const qy = readNumber(d, i, len); i = qy.end
          const x = readNumber(d, i, len); i = x.end
          const y = readNumber(d, i, len); i = y.end
          // Promote quadratic to cubic Bezier
          const cp1x = curX + 2 / 3 * (qx.value - curX)
          const cp1y = curY + 2 / 3 * (qy.value - curY)
          const cp2x = x.value + 2 / 3 * (qx.value - x.value)
          const cp2y = y.value + 2 / 3 * (qy.value - y.value)
          cmds.push(2)
          cds.push(cp1x, cp1y, cp2x, cp2y, x.value, y.value)
          prevCp2x = qx.value
          prevCp2y = qy.value
          curX = x.value
          curY = y.value
          prevCmd = 'Q'
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        break
      }
      case 'q': {
        do {
          const dqx = readNumber(d, i, len); i = dqx.end
          const dqy = readNumber(d, i, len); i = dqy.end
          const dx = readNumber(d, i, len); i = dx.end
          const dy = readNumber(d, i, len); i = dy.end
          const qx = curX + dqx.value
          const qy = curY + dqy.value
          const ex = curX + dx.value
          const ey = curY + dy.value
          const cp1x = curX + 2 / 3 * (qx - curX)
          const cp1y = curY + 2 / 3 * (qy - curY)
          const cp2x = ex + 2 / 3 * (qx - ex)
          const cp2y = ey + 2 / 3 * (qy - ey)
          cmds.push(2)
          cds.push(cp1x, cp1y, cp2x, cp2y, ex, ey)
          prevCp2x = qx
          prevCp2y = qy
          curX = ex
          curY = ey
          prevCmd = 'q'
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        break
      }
      case 'T': {
        do {
          let qx: number, qy: number
          if (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't') {
            qx = 2 * curX - prevCp2x
            qy = 2 * curY - prevCp2y
          } else {
            qx = curX
            qy = curY
          }
          const x = readNumber(d, i, len); i = x.end
          const y = readNumber(d, i, len); i = y.end
          const cp1x = curX + 2 / 3 * (qx - curX)
          const cp1y = curY + 2 / 3 * (qy - curY)
          const cp2x = x.value + 2 / 3 * (qx - x.value)
          const cp2y = y.value + 2 / 3 * (qy - y.value)
          cmds.push(2)
          cds.push(cp1x, cp1y, cp2x, cp2y, x.value, y.value)
          prevCp2x = qx
          prevCp2y = qy
          curX = x.value
          curY = y.value
          prevCmd = 'T'
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        break
      }
      case 't': {
        do {
          let qx: number, qy: number
          if (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't') {
            qx = 2 * curX - prevCp2x
            qy = 2 * curY - prevCp2y
          } else {
            qx = curX
            qy = curY
          }
          const dx = readNumber(d, i, len); i = dx.end
          const dy = readNumber(d, i, len); i = dy.end
          const ex = curX + dx.value
          const ey = curY + dy.value
          const cp1x = curX + 2 / 3 * (qx - curX)
          const cp1y = curY + 2 / 3 * (qy - curY)
          const cp2x = ex + 2 / 3 * (qx - ex)
          const cp2y = ey + 2 / 3 * (qy - ey)
          cmds.push(2)
          cds.push(cp1x, cp1y, cp2x, cp2y, ex, ey)
          prevCp2x = qx
          prevCp2y = qy
          curX = ex
          curY = ey
          prevCmd = 't'
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        break
      }
      case 'A': {
        do {
          const rx = readNumber(d, i, len); i = rx.end
          const ry = readNumber(d, i, len); i = ry.end
          const rotation = readNumber(d, i, len); i = rotation.end
          i = skipWspComma(d, i, len)
          const largeArc = readFlag(d, i); i = largeArc.end
          i = skipWspComma(d, i, len)
          const sweep = readFlag(d, i); i = sweep.end
          const x = readNumber(d, i, len); i = x.end
          const y = readNumber(d, i, len); i = y.end
          arcToCubic(cmds, cds, curX, curY, rx.value, ry.value,
            rotation.value, largeArc.value, sweep.value, x.value, y.value)
          curX = x.value
          curY = y.value
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'A'
        break
      }
      case 'a': {
        do {
          const rx = readNumber(d, i, len); i = rx.end
          const ry = readNumber(d, i, len); i = ry.end
          const rotation = readNumber(d, i, len); i = rotation.end
          i = skipWspComma(d, i, len)
          const largeArc = readFlag(d, i); i = largeArc.end
          i = skipWspComma(d, i, len)
          const sweep = readFlag(d, i); i = sweep.end
          const dx = readNumber(d, i, len); i = dx.end
          const dy = readNumber(d, i, len); i = dy.end
          const ex = curX + dx.value
          const ey = curY + dy.value
          arcToCubic(cmds, cds, curX, curY, rx.value, ry.value,
            rotation.value, largeArc.value, sweep.value, ex, ey)
          curX = ex
          curY = ey
          i = skipWspComma(d, i, len)
        } while (i < len && isDigitOrSign(d.charCodeAt(i)))
        prevCmd = 'a'
        break
      }
      case 'Z':
      case 'z':
        cmds.push(3) // Close
        curX = startX
        curY = startY
        // Closepath takes no coordinates and has no implicit repetition; clear
        // prevCmd so a following bare number is skipped rather than re-dispatched.
        prevCmd = ''
        break
      default:
        // Skip unknown commands
        i++
        break
    }
  }

  return {
    commands: new Uint8Array(cmds),
    // Keep freshly parsed coordinates in double precision to suppress tiny
    // junction gaps in SVG. The return type is kept as-is for compatibility
    // with the existing type.
    coords: new Float64Array(cds) as unknown as Float32Array,
  }
}

// ─── Utilities ───

function skipWsp(s: string, i: number, len: number): number {
  while (i < len) {
    const c = s.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) i++
    else break
  }
  return i
}

function skipWspComma(s: string, i: number, len: number): number {
  i = skipWsp(s, i, len)
  if (i < len && s.charCodeAt(i) === 0x2C) { // comma
    i++
    i = skipWsp(s, i, len)
  }
  return i
}

function isCommand(c: number): boolean {
  // A-Z (65-90), a-z (97-122), excluding digits/sign
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

function isDigitOrSign(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || c === 0x2D || c === 0x2B || c === 0x2E
}

interface NumberResult {
  value: number
  end: number
}

function readNumber(s: string, i: number, len: number): NumberResult {
  i = skipWspComma(s, i, len)
  const start = i
  // sign
  if (i < len && (s.charCodeAt(i) === 0x2D || s.charCodeAt(i) === 0x2B)) i++
  // integer part
  while (i < len && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++
  // decimal
  if (i < len && s.charCodeAt(i) === 0x2E) {
    i++
    while (i < len && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++
  }
  // exponent
  if (i < len && (s.charCodeAt(i) === 0x65 || s.charCodeAt(i) === 0x45)) {
    i++
    if (i < len && (s.charCodeAt(i) === 0x2D || s.charCodeAt(i) === 0x2B)) i++
    while (i < len && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++
  }
  return { value: parseFloat(s.substring(start, i)), end: i }
}

interface FlagResult {
  value: number
  end: number
}

function readFlag(s: string, i: number): FlagResult {
  // skip whitespace/comma before flag
  while (i < s.length) {
    const c = s.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D || c === 0x2C) i++
    else break
  }
  const v = s.charCodeAt(i) === 0x31 ? 1 : 0
  return { value: v, end: i + 1 }
}

// ─── Arc → cubic Bezier approximation ───

function arcToCubic(
  cmds: number[], cds: number[],
  x1: number, y1: number,
  rxIn: number, ryIn: number,
  angleDeg: number, largeArcFlag: number, sweepFlag: number,
  x2: number, y2: number,
): void {
  // Degenerate cases
  if (rxIn === 0 || ryIn === 0) {
    cmds.push(1) // LineTo
    cds.push(x2, y2)
    return
  }
  if (x1 === x2 && y1 === y2) return

  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  const phi = angleDeg * Math.PI / 180

  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // Step 1: (x1', y1')
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  // Radii correction
  const x1p2 = x1p * x1p
  const y1p2 = y1p * y1p
  let rx2 = rx * rx
  let ry2 = ry * ry
  const lambda = x1p2 / rx2 + y1p2 / ry2
  if (lambda > 1) {
    const sqrtL = Math.sqrt(lambda)
    rx *= sqrtL
    ry *= sqrtL
    rx2 = rx * rx
    ry2 = ry * ry
  }

  // Step 2: (cx', cy')
  let sq = (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2)
  if (sq < 0) sq = 0
  let root = Math.sqrt(sq)
  if (largeArcFlag === sweepFlag) root = -root
  const cxp = root * rx * y1p / ry
  const cyp = -root * ry * x1p / rx

  // Step 3: (cx, cy)
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  // Step 4: θ1 and dθ
  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dtheta = vectorAngle(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry,
  )

  if (sweepFlag === 0 && dtheta > 0) dtheta -= 2 * Math.PI
  if (sweepFlag === 1 && dtheta < 0) dtheta += 2 * Math.PI

  // Split into segments of at most 90 degrees and approximate with cubic Beziers
  const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2))
  const delta = dtheta / segments

  for (let s = 0; s < segments; s++) {
    const t1 = theta1 + delta * s
    const t2 = t1 + delta
    const alpha = 4 / 3 * Math.tan(delta / 4)

    const cos1 = Math.cos(t1)
    const sin1 = Math.sin(t1)
    const cos2 = Math.cos(t2)
    const sin2 = Math.sin(t2)

    // Control points (in ellipse coordinate space)
    const ep1x = rx * cos1
    const ep1y = ry * sin1
    const ep2x = rx * cos2
    const ep2y = ry * sin2

    const cp1x = ep1x - alpha * rx * sin1
    const cp1y = ep1y + alpha * ry * cos1
    const cp2x = ep2x + alpha * rx * sin2
    const cp2y = ep2y - alpha * ry * cos2

    // Rotate + translate (convert to world coordinates)
    cmds.push(2) // CubicTo
    cds.push(
      cosPhi * cp1x - sinPhi * cp1y + cx,
      sinPhi * cp1x + cosPhi * cp1y + cy,
      cosPhi * cp2x - sinPhi * cp2y + cx,
      sinPhi * cp2x + cosPhi * cp2y + cy,
      cosPhi * ep2x - sinPhi * ep2y + cx,
      sinPhi * ep2x + cosPhi * ep2y + cy,
    )
  }
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const n = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy)
  if (n === 0) return 0
  let c = (ux * vx + uy * vy) / n
  if (c < -1) c = -1
  if (c > 1) c = 1
  const angle = Math.acos(c)
  return (ux * vy - uy * vx < 0) ? -angle : angle
}
