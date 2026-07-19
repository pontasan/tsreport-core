export type NodeRequire = (id: string) => unknown

export interface NodeRuntimeBridge {
  require: NodeRequire
  execPath: string
  randomFill(bytes: Uint8Array): void
}

const NODE_RUNTIME_KEY = Symbol.for('tsreport-core.node-runtime')

export function installNodeRuntime(runtime: NodeRuntimeBridge): void {
  const globals = globalThis as Record<symbol, NodeRuntimeBridge | undefined>
  globals[NODE_RUNTIME_KEY] = runtime
}

export function getNodeRuntimeBridge(): NodeRuntimeBridge | null {
  return (globalThis as Record<symbol, NodeRuntimeBridge | undefined>)[NODE_RUNTIME_KEY] ?? null
}

export function getNodeModule<T>(specifier: string): T | null {
  const runtime = getNodeRuntimeBridge()
  return runtime === null ? null : runtime.require(specifier) as T
}
