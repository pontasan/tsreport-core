export function currentWorkingDirectory(): string {
  const runtime = globalThis as { process?: { cwd?: () => string } }
  return typeof runtime.process?.cwd === 'function' ? runtime.process.cwd() : '.'
}
