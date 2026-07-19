import { getNodeModule } from './node-runtime-bridge.js'
import { isFileUrl, isWindowsAbsolutePath } from './resource-reference.js'

interface NodeFs {
  readFileSync(path: string): Uint8Array
  readFileSync(path: string, encoding: 'utf8'): string
  realpathSync(path: string): string
  statSync(path: string): { isDirectory(): boolean }
}

interface NodePath {
  dirname(path: string): string
  isAbsolute(path: string): boolean
  relative(from: string, to: string): string
  resolve(...paths: string[]): string
  sep: string
}

interface NodeUrl {
  fileURLToPath(url: string): string
}

interface NodeFileError extends Error {
  code?: string
}

export interface ResolvedLocalFile {
  status: 'found'
  path: string
}

export interface MissingLocalFile {
  status: 'missing'
}

export type LocalFileResolution = ResolvedLocalFile | MissingLocalFile

export class LocalFileAuthorizationError extends Error {
  constructor(path: string) {
    super(`path is outside the authorized root: ${path}`)
    this.name = 'LocalFileAuthorizationError'
  }
}

export class LocalFileRootConfigurationError extends Error {
  constructor(root: string, detail: string) {
    super(`invalid authorized file root "${root}": ${detail}`)
    this.name = 'LocalFileRootConfigurationError'
  }
}

function getFs(): NodeFs {
  const fs = getNodeModule<NodeFs>('node:fs')
  if (fs === null) throw new Error('Local file resolution is available only in Node.js runtime')
  return fs
}

function getPath(): NodePath {
  const path = getNodeModule<NodePath>('node:path')
  if (path === null) throw new Error('Local file resolution is available only in Node.js runtime')
  return path
}

function getUrl(): NodeUrl {
  const url = getNodeModule<NodeUrl>('node:url')
  if (url === null) throw new Error('Local file resolution is available only in Node.js runtime')
  return url
}

function fileErrorCode(error: unknown): string | undefined {
  return (error as NodeFileError).code
}

function isMissingFileError(error: unknown): boolean {
  const code = fileErrorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function isUnavailableImageError(error: unknown): boolean {
  const code = (error as NodeFileError).code
  return code === 'ENOENT'
    || code === 'ENOTDIR'
    || code === 'EISDIR'
    || code === 'EACCES'
    || code === 'EPERM'
}

function isUnavailableResourceError(error: unknown, image: boolean): boolean {
  return image ? isUnavailableImageError(error) : isMissingFileError(error)
}

function isInsideRoot(path: NodePath, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
}

function resolveReference(reference: string, baseDirectory: string, path: NodePath, url: NodeUrl): string | null {
  if (isFileUrl(reference)) {
    try {
      return url.fileURLToPath(reference)
    } catch (error) {
      if (error instanceof TypeError || error instanceof URIError) return null
      throw error
    }
  }
  if (isWindowsAbsolutePath(reference)) return path.sep === '\\' ? reference : null
  if (path.isAbsolute(reference)) return reference
  if (reference.indexOf(':') !== -1) return null
  return path.resolve(baseDirectory, reference)
}

function canonicalizeUnavailablePath(candidate: string, image: boolean, fs: NodeFs, path: NodePath): string {
  let ancestor = path.dirname(candidate)
  while (true) {
    try {
      const canonicalAncestor = fs.realpathSync(ancestor)
      return path.resolve(canonicalAncestor, path.relative(ancestor, candidate))
    } catch (error) {
      if (!isUnavailableResourceError(error, image)) throw error
      const parent = path.dirname(ancestor)
      if (parent === ancestor) return candidate
      ancestor = parent
    }
  }
}

export class NodeLocalFileResolver {
  private readonly fs: NodeFs
  private readonly path: NodePath
  private readonly url: NodeUrl
  private readonly canonicalRoot: string | undefined

  constructor(authorizedRoot?: string) {
    this.fs = getFs()
    this.path = getPath()
    this.url = getUrl()
    if (authorizedRoot === undefined) return
    const resolvedRoot = this.path.resolve(authorizedRoot)
    try {
      this.canonicalRoot = this.fs.realpathSync(resolvedRoot)
      if (!this.fs.statSync(this.canonicalRoot).isDirectory()) {
        throw new LocalFileRootConfigurationError(authorizedRoot, 'root is not a directory')
      }
    } catch (error) {
      if (error instanceof LocalFileRootConfigurationError) throw error
      const code = (error as NodeFileError).code
      throw new LocalFileRootConfigurationError(
        authorizedRoot,
        code === undefined ? (error as Error).message : `filesystem error ${code}`,
      )
    }
  }

  resolve(reference: string, baseDirectory: string, resourceKind: 'image' | 'template'): LocalFileResolution {
    const resolved = resolveReference(reference, baseDirectory, this.path, this.url)
    if (resolved === null) return { status: 'missing' }
    const candidate = this.path.resolve(resolved)
    let canonicalCandidate: string
    let found = true
    try {
      canonicalCandidate = this.fs.realpathSync(candidate)
    } catch (error) {
      if (!isUnavailableResourceError(error, resourceKind === 'image')) throw error
      if (this.canonicalRoot === undefined) return { status: 'missing' }
      found = false
      canonicalCandidate = canonicalizeUnavailablePath(candidate, resourceKind === 'image', this.fs, this.path)
    }

    if (this.canonicalRoot === undefined) return { status: 'found', path: canonicalCandidate }

    if (!isInsideRoot(this.path, this.canonicalRoot, canonicalCandidate)) {
      throw new LocalFileAuthorizationError(reference)
    }
    return found ? { status: 'found', path: canonicalCandidate } : { status: 'missing' }
  }

  readBytes(path: string): Uint8Array | null {
    try {
      return this.fs.readFileSync(path)
    } catch (error) {
      if (isUnavailableImageError(error)) return null
      throw error
    }
  }

  readText(path: string): string {
    return this.fs.readFileSync(path, 'utf8')
  }

  directory(path: string): string {
    return this.path.dirname(path)
  }
}
