import { createRequire } from 'node:module'
import { randomFillSync } from 'node:crypto'
import { installNodeRuntime } from './node-runtime-bridge.js'

installNodeRuntime({
  require: createRequire(process.execPath),
  execPath: process.execPath,
  randomFill(bytes): void {
    randomFillSync(bytes)
  },
})

export * from './index.js'
