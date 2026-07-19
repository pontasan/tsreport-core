import { fastLog2 } from './fast-log.js'

/** Estimates the coding cost of each byte using the RFC encoder's sliding window model. */
export function estimateLiteralCosts(data: Uint8Array, position: number, length: number): Float32Array {
  const costs = new Float32Array(length)
  const histogram = new Uint32Array(256)
  const windowHalf = 2000
  let inWindow = Math.min(windowHalf, length)

  for (let index = 0; index < inWindow; index++) {
    const symbol = data[position + index]!
    histogram[symbol] = histogram[symbol]! + 1
  }

  for (let index = 0; index < length; index++) {
    if (index >= windowHalf) {
      const symbol = data[position + index - windowHalf]!
      histogram[symbol] = histogram[symbol]! - 1
      inWindow--
    }
    if (index + windowHalf < length) {
      const symbol = data[position + index + windowHalf]!
      histogram[symbol] = histogram[symbol]! + 1
      inWindow++
    }

    const count = Math.max(1, histogram[data[position + index]!]!)
    let cost = fastLog2(inWindow) - fastLog2(count) + 0.029
    if (cost < 1) cost = cost * 0.5 + 0.5
    costs[index] = cost
  }

  return costs
}
