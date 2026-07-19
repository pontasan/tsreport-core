import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const veraPdf = process.env.VERAPDF_BIN
if (veraPdf === undefined || !existsSync(veraPdf)) {
  throw new Error('PDF conformance dependency is required: VERAPDF_BIN must point to the veraPDF CLI')
}
const veraVersion = spawnSync(veraPdf, ['--version'], { encoding: 'utf8' })
if (veraVersion.error !== undefined || veraVersion.status !== 0) {
  throw new Error('PDF conformance dependency is not executable: VERAPDF_BIN')
}
if (!veraVersion.stdout.startsWith('veraPDF 1.30.2\n')) {
  throw new Error('PDF conformance dependency must be veraPDF 1.30.2')
}

const pdfxPreflight = process.env.PDFX_PREFLIGHT_BIN
if (pdfxPreflight === undefined || !existsSync(pdfxPreflight)) {
  throw new Error('PDF conformance dependency is required: PDFX_PREFLIGHT_BIN must point to an independent PDF/X-1a:2003 preflight wrapper')
}
const veraPdfCorpus = process.env.VERAPDF_CORPUS_DIR
if (veraPdfCorpus === undefined || !existsSync(veraPdfCorpus)) {
  throw new Error('PDF conformance dependency is required: VERAPDF_CORPUS_DIR must point to the pinned veraPDF corpus checkout')
}

const dependencies = [
  ['qpdf', ['--version'], [0]],
  ['pdftoppm', ['-v'], [0]],
  ['pdftotext', ['-v'], [0]],
  ['pdffonts', ['-v'], [0]],
  ['gs', ['--version'], [0]],
  ['openssl', ['version'], [0]],
  ['opj_compress', ['-h'], [0, 1]],
  ['opj_decompress', ['-h'], [0, 1]],
  ['jbig2dec', ['--version'], [0]],
  ['djpeg', ['-version'], [0]],
  ['cjpeg', ['-version'], [0]],
  ['jpegtran', ['-version'], [0]],
  ['convert', ['-version'], [0]],
]

for (let i = 0; i < dependencies.length; i++) {
  const [command, args, acceptedStatuses] = dependencies[i]
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined || !acceptedStatuses.includes(result.status)) {
    throw new Error(`PDF conformance dependency is required: ${command}`)
  }
}

const tests = [
  'tests/pdf/pdf-clause-fixture-corpus.test.ts',
  'tests/pdf/pdf-malformed-fuzz-regression.test.ts',
  'tests/pdf/pdf-coverage-matrix.test.ts',
  'tests/pdf/pdf-content-operator-coverage.test.ts',
  'tests/pdf/pdf-ecmascript-boundary.test.ts',
  'tests/pdf/pdf-media.test.ts',
  'tests/pdf/qpdf-oracle.test.ts',
  'tests/pdf/pdftext-oracle.test.ts',
  'tests/pdf/pdffonts-oracle.test.ts',
  'tests/pdf/pdf-signature.test.ts',
  'tests/pdf/pdf-signature-extensions-conformance.test.ts',
  'tests/pdf/pdf-rfc3161.test.ts',
  'tests/pdf/pdf-pubsec.test.ts',
  'tests/encryption/pbkdf2.test.ts',
  'tests/encryption/pkcs8-conformance.test.ts',
  'tests/pdf/icc-conformance.test.ts',
  'tests/pdf/pdf-xml-unicode-conformance.test.ts',
  'tests/pdf/verapdf-oracle.test.ts',
  'tests/pdf/pdfx-preflight-oracle.test.ts',
  'tests/renderer/pdf-production-raster-oracle.test.ts',
  'tests/image/jpeg-decoder.test.ts',
  'tests/compression/jpx-decoder.test.ts',
  'tests/compression/jbig2-decoder.test.ts',
  'tests/compression/ccitt.test.ts',
  'tests/compression/inflate.test.ts',
]
const runner = join(process.cwd(), 'scripts', 'run-conformance.mjs')
const corpusResult = spawnSync(process.execPath, [runner, 'tests/pdf/verapdf-corpus-oracle.test.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, TSREPORT_PDF_CONFORMANCE: '1' },
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  stdio: 'inherit',
})
if (corpusResult.error !== undefined) throw corpusResult.error
if (corpusResult.status !== 0) process.exit(corpusResult.status ?? 1)

const result = spawnSync(process.execPath, [runner, ...tests], {
  cwd: process.cwd(),
  env: { ...process.env, TSREPORT_PDF_CONFORMANCE: '1' },
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
