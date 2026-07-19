/**
 * Longest-match syllable scanner for the complex-script shapers.
 *
 * Each shaper defines its syllable grammar over the shaping-category alphabet
 * (ot-categories.ts) with the combinators below (Thompson construction). The
 * scanner simulates the resulting NFA and returns, per position, the longest
 * token match; ties between token types are broken by registration order.
 * This reproduces the semantics of a scanner-generated DFA (longest match,
 * priority by rule order) without a code generation step.
 */

/** Fragment: NFA piece with one start and one end state (indices). */
export interface Frag {
  start: number
  end: number
}

interface BuildState {
  epsTo: number[]
  edgeCats: number[][]
  edgeTo: number[]
  accept: number
}

/** Compiled scanner (immutable after build). */
export interface SyllableScanner {
  /** Per state: epsilon-closure as a state list. */
  closures: number[][]
  /** Per state: transition category lists, parallel with edgeTo. */
  edgeCats: number[][][]
  edgeTo: number[][]
  /** Per state: token priority (-1 = non-accepting). */
  accept: number[]
  /** Token type per priority (registration order). */
  tokenTypes: number[]
  startState: number
  stateCount: number
}

export class SyllableGrammar {
  private states: BuildState[] = []
  private startState = -1
  private tokenTypes: number[] = []

  private newState(): number {
    this.states.push({ epsTo: [], edgeCats: [], edgeTo: [], accept: -1 })
    return this.states.length - 1
  }

  /** Fragment matching exactly one category out of the given list. */
  cat(cats: readonly number[]): Frag {
    const s = this.newState()
    const e = this.newState()
    this.states[s]!.edgeCats.push([...cats])
    this.states[s]!.edgeTo.push(e)
    return { start: s, end: e }
  }

  /** Concatenation. */
  seq(...frags: Frag[]): Frag {
    if (frags.length === 0) {
      const s = this.newState()
      return { start: s, end: s }
    }
    for (let i = 0; i + 1 < frags.length; i++) {
      this.states[frags[i]!.end]!.epsTo.push(frags[i + 1]!.start)
    }
    return { start: frags[0]!.start, end: frags[frags.length - 1]!.end }
  }

  /** Alternation. */
  alt(...frags: Frag[]): Frag {
    const s = this.newState()
    const e = this.newState()
    for (const f of frags) {
      this.states[s]!.epsTo.push(f.start)
      this.states[f.end]!.epsTo.push(e)
    }
    return { start: s, end: e }
  }

  /** Zero or one. */
  opt(f: Frag): Frag {
    const s = this.newState()
    const e = this.newState()
    this.states[s]!.epsTo.push(f.start, e)
    this.states[f.end]!.epsTo.push(e)
    return { start: s, end: e }
  }

  /** Zero or more. */
  star(f: Frag): Frag {
    const s = this.newState()
    const e = this.newState()
    this.states[s]!.epsTo.push(f.start, e)
    this.states[f.end]!.epsTo.push(f.start, e)
    return { start: s, end: e }
  }

  /** One or more. */
  plus(f: Frag): Frag {
    const e = this.newState()
    this.states[f.end]!.epsTo.push(f.start, e)
    return { start: f.start, end: e }
  }

  /**
   * Register a token: the fragment accepts with the given type. Earlier
   * registrations win length ties (scanner rule priority).
   */
  token(f: Frag, type: number): void {
    if (this.startState < 0) this.startState = this.newState()
    this.states[this.startState]!.epsTo.push(f.start)
    this.states[f.end]!.accept = this.tokenTypes.length
    this.tokenTypes.push(type)
  }

  /** Compile to the runtime scanner form (epsilon closures precomputed). */
  build(): SyllableScanner {
    const n = this.states.length
    const closures: number[][] = new Array(n)
    const visited = new Uint8Array(n)
    const stack: number[] = []
    for (let s = 0; s < n; s++) {
      visited.fill(0)
      stack.length = 0
      stack.push(s)
      visited[s] = 1
      const closure: number[] = []
      while (stack.length > 0) {
        const cur = stack.pop()!
        closure.push(cur)
        for (const t of this.states[cur]!.epsTo) {
          if (visited[t] === 0) {
            visited[t] = 1
            stack.push(t)
          }
        }
      }
      closures[s] = closure
    }
    const edgeCats: number[][][] = new Array(n)
    const edgeTo: number[][] = new Array(n)
    const accept: number[] = new Array(n)
    for (let s = 0; s < n; s++) {
      edgeCats[s] = this.states[s]!.edgeCats
      edgeTo[s] = this.states[s]!.edgeTo
      accept[s] = this.states[s]!.accept
    }
    return {
      closures,
      edgeCats,
      edgeTo,
      accept,
      tokenTypes: [...this.tokenTypes],
      startState: this.startState,
      stateCount: n,
    }
  }
}

/**
 * Longest token match at cats[pos..end).
 * @returns (length << 8) | tokenType, or 0 when nothing matches
 */
export function scanLongest(
  scanner: SyllableScanner,
  cats: number[],
  pos: number,
  end: number,
): number {
  const inSet = new Uint8Array(scanner.stateCount)
  let current: number[] = []
  for (const s of scanner.closures[scanner.startState]!) {
    if (inSet[s] === 0) {
      inSet[s] = 1
      current.push(s)
    }
  }
  let next: number[] = []
  let best = 0
  for (let i = pos; i < end && current.length > 0; i++) {
    const cat = cats[i]!
    next.length = 0
    inSet.fill(0)
    for (const s of current) {
      const stateEdgeCats = scanner.edgeCats[s]!
      const stateEdgeTo = scanner.edgeTo[s]!
      for (let e = 0; e < stateEdgeTo.length; e++) {
        if (stateEdgeCats[e]!.indexOf(cat) < 0) continue
        for (const t of scanner.closures[stateEdgeTo[e]!]!) {
          if (inSet[t] === 0) {
            inSet[t] = 1
            next.push(t)
          }
        }
      }
    }
    const swap = current
    current = next
    next = swap
    // Record the best accept after consuming (i - pos + 1) characters
    // (longest match; ties resolved by lowest priority = registration order).
    let acc = -1
    for (const s of current) {
      const a = scanner.accept[s]!
      if (a >= 0 && (acc < 0 || a < acc)) acc = a
    }
    if (acc >= 0) best = ((i - pos + 1) << 8) | scanner.tokenTypes[acc]!
  }
  return best
}
