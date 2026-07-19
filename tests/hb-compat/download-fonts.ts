/**
 * Additional test font downloader for the HarfBuzz shaping compatibility suite.
 * Follows the same pattern as tests/download-test-fonts.ts (skip existing files).
 * Used both as a vitest globalSetup entry and from generate-expectations.ts.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const FONTS_DIR = resolve(SCRIPT_DIR, '../fixtures/fonts')

const DOWNLOADS: { file: string; url: string }[] = [
  {
    file: 'NotoSansJavanese-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansJavanese/hinted/ttf/NotoSansJavanese-Regular.ttf',
  },
  {
    file: 'NotoSansBalinese-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBalinese/hinted/ttf/NotoSansBalinese-Regular.ttf',
  },
  {
    file: 'NotoSansCham-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansCham/hinted/ttf/NotoSansCham-Regular.ttf',
  },
  {
    file: 'NotoSansSundanese-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansSundanese/hinted/ttf/NotoSansSundanese-Regular.ttf',
  },
  {
    file: 'NotoSansTaiTham-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansTaiTham/hinted/ttf/NotoSansTaiTham-Regular.ttf',
  },
  {
    file: 'NotoSansBuginese-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBuginese/hinted/ttf/NotoSansBuginese-Regular.ttf',
  },
  {
    file: 'NotoSansMongolian-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansMongolian/hinted/ttf/NotoSansMongolian-Regular.ttf',
  },
  {
    file: 'NotoSansHebrew-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansHebrew/hinted/ttf/NotoSansHebrew-Regular.ttf',
  },
  {
    file: 'NotoSansSyriac-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansSyriac/hinted/ttf/NotoSansSyriac-Regular.ttf',
  },
  {
    file: 'NotoSansNKo-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansNKo/hinted/ttf/NotoSansNKo-Regular.ttf',
  },
  {
    file: 'NotoSansMandaic-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansMandaic/hinted/ttf/NotoSansMandaic-Regular.ttf',
  },
  {
    file: 'NotoSansAdlam-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansAdlam/hinted/ttf/NotoSansAdlam-Regular.ttf',
  },
  {
    file: 'NotoSansDevanagari-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf',
  },
  {
    file: 'NotoSansBengali-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf',
  },
  {
    file: 'NotoSansGurmukhi-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansGurmukhi/hinted/ttf/NotoSansGurmukhi-Regular.ttf',
  },
  {
    file: 'NotoSansGujarati-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansGujarati/hinted/ttf/NotoSansGujarati-Regular.ttf',
  },
  {
    file: 'NotoSansOriya-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansOriya/hinted/ttf/NotoSansOriya-Regular.ttf',
  },
  {
    file: 'NotoSansTamil-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansTamil/hinted/ttf/NotoSansTamil-Regular.ttf',
  },
  {
    file: 'NotoSansTelugu-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansTelugu/hinted/ttf/NotoSansTelugu-Regular.ttf',
  },
  {
    file: 'NotoSansKannada-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansKannada/hinted/ttf/NotoSansKannada-Regular.ttf',
  },
  {
    file: 'NotoSansMalayalam-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansMalayalam/hinted/ttf/NotoSansMalayalam-Regular.ttf',
  },
  {
    file: 'NotoSansSinhala-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansSinhala/hinted/ttf/NotoSansSinhala-Regular.ttf',
  },
  {
    file: 'NotoSansThai-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansThai/hinted/ttf/NotoSansThai-Regular.ttf',
  },
  {
    file: 'NotoSansLao-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansLao/hinted/ttf/NotoSansLao-Regular.ttf',
  },
  {
    file: 'NotoSansKhmer-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansKhmer/hinted/ttf/NotoSansKhmer-Regular.ttf',
  },
  {
    file: 'NotoSansMyanmar-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansMyanmar/hinted/ttf/NotoSansMyanmar-Regular.ttf',
  },
  {
    file: 'NotoSerifTibetan-Regular.ttf',
    url: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSerifTibetan/unhinted/ttf/NotoSerifTibetan-Regular.ttf',
  },
  {
    file: 'NotoSansKR-Regular.otf',
    url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf',
  },
]

/** vitest globalSetup entrypoint. */
export async function setup(): Promise<void> {
  mkdirSync(FONTS_DIR, { recursive: true })
  const tasks: Promise<void>[] = []
  for (const { file, url } of DOWNLOADS) {
    const dest = resolve(FONTS_DIR, file)
    if (existsSync(dest)) continue
    console.log(`[hb-compat/download-fonts] Downloading ${file}...`)
    tasks.push(download(url, dest))
  }
  await Promise.all(tasks)
}

/** HTTP download with redirect support. */
function download(url: string, dest: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects for ${url}`))
  }
  const client = url.startsWith('https:') ? httpsGet : httpGet

  return new Promise<void>((resolve, reject) => {
    client(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Redirect.
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
        console.log(`[hb-compat/download-fonts] Saved ${dest.split('/').pop()}`)
        resolve()
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}
