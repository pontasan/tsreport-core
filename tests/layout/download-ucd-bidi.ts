/**
 * UAX#9 conformance test data download script.
 * Called from vitest globalSetup. Fetches the official Unicode 17.0 bidi
 * conformance suites (BidiTest.txt / BidiCharacterTest.txt) once into
 * tests/fixtures/ucd/; the conformance test skips when they are absent
 * (offline environments) exactly like the font fixtures.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { get as httpsGet } from 'node:https'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const UCD_DIR = resolve(SCRIPT_DIR, '../fixtures/ucd')

const DOWNLOADS: { file: string; url: string }[] = [
  { file: 'BidiTest.txt', url: 'https://www.unicode.org/Public/17.0.0/ucd/BidiTest.txt' },
  { file: 'BidiCharacterTest.txt', url: 'https://www.unicode.org/Public/17.0.0/ucd/BidiCharacterTest.txt' },
]

export async function setup(): Promise<void> {
  mkdirSync(UCD_DIR, { recursive: true })
  for (const target of DOWNLOADS) {
    const dest = resolve(UCD_DIR, target.file)
    if (existsSync(dest)) continue
    try {
      await download(target.url, dest)
    } catch (error) {
      // Offline: the conformance test skips via it.skipIf on the file
      console.warn(`[download-ucd-bidi] Skipped ${target.file}: ${String(error)}`)
    }
  }
}

function download(url: string, dest: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects for ${url}`))
  }
  return new Promise<void>((resolve, reject) => {
    httpsGet(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url)
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`
        }
        res.resume()
        download(redirectUrl, dest, redirectCount + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        writeFileSync(dest, Buffer.concat(chunks))
        console.log(`[download-ucd-bidi] Saved ${dest.split('/').pop()}`)
        resolve()
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}
