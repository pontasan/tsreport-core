declare module 'node:module' {
  export function createRequire(filename: string): (specifier: string) => unknown
}

declare module 'node:crypto' {
  export function randomFillSync(buffer: Uint8Array): Uint8Array
}

declare const process: {
  cwd(): string
  execPath: string
}
