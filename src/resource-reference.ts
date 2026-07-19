export function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export function isBlobUrl(value: string): boolean {
  return value.startsWith('blob:')
}

export function isExternalImageUrl(value: string): boolean {
  return isHttpUrl(value) || isBlobUrl(value)
}

export function isFileUrl(value: string): boolean {
  return value.length >= 5 && value.substring(0, 5).toLowerCase() === 'file:'
}

export function isWindowsAbsolutePath(value: string): boolean {
  if (value.length < 3) return false
  const drive = value.charCodeAt(0)
  const colon = value.charCodeAt(1)
  const separator = value.charCodeAt(2)
  const isAlpha = (drive >= 0x41 && drive <= 0x5a) || (drive >= 0x61 && drive <= 0x7a)
  return isAlpha && colon === 0x3a && (separator === 0x5c || separator === 0x2f)
}

export function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith('/')
}

export function isColonlessReference(value: string): boolean {
  return value.indexOf(':') === -1
}
