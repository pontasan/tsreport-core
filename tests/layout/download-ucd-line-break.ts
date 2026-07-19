/**
 * UAX#14 conformance test data download script.
 * Called from vitest globalSetup. Fetches the official Unicode 17.0 line break
 * conformance suite once into tests/fixtures/ucd/; the conformance test skips
 * when it is absent (offline environments).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { get as httpsGet } from 'node:https'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const UCD_DIR = resolve(SCRIPT_DIR, '../fixtures/ucd')
const LINE_BREAK_TEST = {
  file: 'LineBreakTest.txt',
  url: 'https://www.unicode.org/Public/17.0.0/ucd/auxiliary/LineBreakTest.txt',
}

export async function setup(): Promise<void> {
  mkdirSync(UCD_DIR, { recursive: true })
  const dest = resolve(UCD_DIR, LINE_BREAK_TEST.file)
  if (existsSync(dest)) return
  try {
    await download(LINE_BREAK_TEST.url, dest)
  } catch (error) {
    // Offline: the conformance test skips via it.skipIf on the file.
    console.warn(`[download-ucd-line-break] Skipped ${LINE_BREAK_TEST.file}: ${String(error)}`)
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
        console.log(`[download-ucd-line-break] Saved ${dest.split('/').pop()}`)
        resolve()
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}
