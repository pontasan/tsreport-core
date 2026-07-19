import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { getPdfPageCount, importPdfPage } from '../../src/index.js'

interface CorpusFile {
  path: string
  label: string
}

const corpusFiles = collectCorpusFiles()
const corpusPasswords = parsePasswordMap(process.env.TSREPORT_PDF_CORPUS_PASSWORDS ?? '')
const maxFiles = positiveInt(process.env.TSREPORT_PDF_CORPUS_MAX_FILES)
const maxPagesPerFile = positiveInt(process.env.TSREPORT_PDF_CORPUS_MAX_PAGES_PER_FILE)
const selectedFiles = maxFiles === null ? corpusFiles : corpusFiles.slice(0, maxFiles)

describe('PDF standard corpus runner', () => {
  if (corpusFiles.length === 0) {
    it('is gated by TSREPORT_PDF_CORPUS or TSREPORT_PDF_CORPUS_DIRS', () => {
      expect(process.env.TSREPORT_PDF_CORPUS ?? process.env.TSREPORT_PDF_CORPUS_DIRS ?? '').toBe('')
    })
    return
  }

  it(`imports ${selectedFiles.length} configured corpus PDF file(s)`, () => {
    expect(selectedFiles.length).toBeGreaterThan(0)
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]!
      const bytes = readFileSync(file.path)
      const password = corpusPasswords.get(file.path) ?? corpusPasswords.get(file.label)
      const options = password === undefined ? undefined : { password }
      const pageCount = getPdfPageCount(bytes, options)
      expect(pageCount, file.label).toBeGreaterThan(0)
      const pageLimit = maxPagesPerFile === null ? pageCount : Math.min(pageCount, maxPagesPerFile)
      for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
        const page = importPdfPage(bytes, pageIndex, {
          ...options,
          imageIdPrefix: `corpus_${i}_${pageIndex}`,
        })
        expect(Number.isFinite(page.width), `${file.label} page ${pageIndex + 1} width`).toBe(true)
        expect(Number.isFinite(page.height), `${file.label} page ${pageIndex + 1} height`).toBe(true)
        expect(page.width, `${file.label} page ${pageIndex + 1} width`).toBeGreaterThan(0)
        expect(page.height, `${file.label} page ${pageIndex + 1} height`).toBeGreaterThan(0)
      }
    }
  })
})

function collectCorpusFiles(): CorpusFile[] {
  const env = process.env.TSREPORT_PDF_CORPUS_DIRS ?? process.env.TSREPORT_PDF_CORPUS ?? ''
  if (env.trim() === '') return []
  const roots = env.split(delimiter).map(s => s.trim()).filter(Boolean)
  const files: CorpusFile[] = []
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]!
    if (!existsSync(root)) throw new Error(`PDF corpus path does not exist: ${root}`)
    collectPdfFiles(root, root, files)
  }
  files.sort((a, b) => a.label < b.label ? -1 : (a.label > b.label ? 1 : 0))
  return files
}

function collectPdfFiles(root: string, current: string, out: CorpusFile[]): void {
  const info = statSync(current)
  if (info.isFile()) {
    if (current.toLowerCase().endsWith('.pdf')) out.push({ path: current, label: current.substring(root.length + 1) || current })
    return
  }
  if (!info.isDirectory()) return
  const entries = readdirSync(current).sort()
  for (let i = 0; i < entries.length; i++) {
    collectPdfFiles(root, join(current, entries[i]!), out)
  }
}

function parsePasswordMap(value: string): Map<string, string> {
  const out = new Map<string, string>()
  if (value.trim() === '') return out
  const entries = value.split(delimiter)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const eq = entry.indexOf('=')
    if (eq <= 0) throw new Error('TSREPORT_PDF_CORPUS_PASSWORDS entries must be path=password')
    out.set(entry.substring(0, eq), entry.substring(eq + 1))
  }
  return out
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected positive integer, got ${value}`)
  return parsed
}
