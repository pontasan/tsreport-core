/**
  * PDF AES encrypt.
  * RC4-128 (V=2, R=3), AES-128 (V=4, R=4), AES-256 (V=5, R=6)
  * Encryptstructure,, validate.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend, type PdfMetadata } from '../../src/renderer/pdf-backend.js'
import { createEncryptionContext } from '../../src/renderer/pdf-encryption.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument } from '../../src/types/render.js'
import { pdfToText } from './pdf-test-utils.js'
import { parsePdf, PdfString, PdfStream } from '../../src/pdf/pdf-parser.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font

beforeAll(() => {
  const buf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  font = Font.load(buf.buffer as ArrayBuffer)
})

function generateEncryptedPdf(method: 'rc4-40' | 'rc4-128' | 'aes-128' | 'aes-256-r5' | 'aes-256', opts?: {
  userPassword?: string
  ownerPassword?: string
  permissions?: any
  metadata?: PdfMetadata
  encryptMetadata?: boolean
}): { bytes: Uint8Array; text: string; raw: string } {
  const backend = new PdfBackend({
    fonts: { default: font },
    encryption: {
      userPassword: opts?.userPassword ?? 'test',
      ownerPassword: opts?.ownerPassword ?? 'owner',
      method,
      permissions: opts?.permissions,
      encryptMetadata: opts?.encryptMetadata,
    },
    metadata: opts?.metadata,
  })
  const doc: RenderDocument = {
    pages: [{
      width: 595, height: 842,
      children: [{
        type: 'text', x: 72, y: 72, text: 'Encryption Test',
        fontId: 'default', fontSize: 12, color: '#000000',
      }],
    }],
  }
  render(doc, backend)
  const bytes = backend.toUint8Array()
  const text = pdfToText(bytes)
  const raw = new TextDecoder('latin1').decode(bytes)
  return { bytes, text, raw }
}

// ─── RC4-40 (V=1, R=2) ───

describe('RC4-40 encryption (V=1, R=2)', () => {
  it('emits /V 1 /R 2 /Length 40', () => {
    const { raw } = generateEncryptedPdf('rc4-40')
    expect(raw).toContain('/V 1')
    expect(raw).toContain('/R 2')
    expect(raw).toContain('/Length 40')
  })

  it('round-trips: the importer decrypts the document with the user password', () => {
    const { bytes } = generateEncryptedPdf('rc4-40', { userPassword: 'test', ownerPassword: 'owner', metadata: { title: 'Secret RC4-40' } })
    const doc = parsePdf(bytes, { password: 'test' })
    const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
    const title = doc.resolve(info.get('Title') ?? null)
    expect(title).toBeInstanceOf(PdfString)
    let s = ''
    const b = (title as PdfString).bytes
    // UTF-16BE (BOM) or PDFDocEncoding.
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!)
    } else {
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
    }
    expect(s).toBe('Secret RC4-40')
  })

  it('rejects the wrong password', () => {
    const { bytes } = generateEncryptedPdf('rc4-40', { userPassword: 'test', ownerPassword: 'owner' })
    expect(() => parsePdf(bytes, { password: 'wrong' })).toThrow()
  })
})

// ─── Metadata encryption (bug fix) + /EncryptMetadata false ───

describe('metadata stream encryption', () => {
  function metadataStreamText(bytes: Uint8Array, password: string): string {
    const doc = parsePdf(bytes, { password })
    const md = doc.resolve(doc.getCatalog().get('Metadata') ?? null) as PdfStream
    const data = doc.decodeStream(md)
    let s = ''
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]!)
    return s
  }

  it('encrypts the XMP metadata stream by default (not plaintext in the file)', () => {
    const { raw, bytes } = generateEncryptedPdf('aes-128', { metadata: { title: 'SECRET_TITLE_XYZ' } })
    // The XMP title must not appear in cleartext anywhere in the encrypted file.
    expect(raw.includes('SECRET_TITLE_XYZ')).toBe(false)
    // But it round-trips once decrypted with the password.
    expect(metadataStreamText(bytes, 'test')).toContain('SECRET_TITLE_XYZ')
  })

  it('encryptMetadata:false leaves XMP readable and declares /EncryptMetadata false', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'aes-128', encryptMetadata: false },
      metadata: { title: 'OPEN_TITLE_XYZ' },
    })
    render({ pages: [{ width: 200, height: 200, children: [{ type: 'text', x: 10, y: 10, text: 'x', fontId: 'default', fontSize: 10, color: '#000000' }] }] }, backend)
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/EncryptMetadata false')
    expect(raw.includes('OPEN_TITLE_XYZ')).toBe(true) // readable without decryption
    expect(metadataStreamText(bytes, 'test')).toContain('OPEN_TITLE_XYZ')
  })

  it('rejects encryptMetadata:false for non-crypt-filter methods (RC4)', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      encryption: { userPassword: 'test', method: 'rc4-128', encryptMetadata: false },
      metadata: { title: 'x' },
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    expect(() => backend.toUint8Array()).toThrow(/crypt-filter/)
  })
})

describe('per-stream Crypt filter routing', () => {
  it('mixes encrypted streams with Identity metadata and embedded-file streams', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'aes-128' },
      identityCryptFilter: { metadata: true, embeddedFiles: ['public.txt'] },
      metadata: { title: 'PUBLIC_XMP_TITLE' },
      embeddedFiles: [
        { name: 'public.txt', data: new Uint8Array([80, 85, 66, 76, 73, 67]) },
        { name: 'secret.txt', data: new Uint8Array([83, 69, 67, 82, 69, 84]) },
      ],
    })
    render({ pages: [{ width: 100, height: 100, children: [{ type: 'rect', x: 10, y: 10, width: 20, height: 20, fill: '#000000' }] }] }, backend)
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/Filter /Crypt /DecodeParms << /Name /Identity >>')
    expect(raw).toContain('PUBLIC_XMP_TITLE')
    const doc = parsePdf(bytes, { password: 'test' })
    const metadata = doc.resolve(doc.getCatalog().get('Metadata') ?? null) as PdfStream
    expect(new TextDecoder().decode(doc.decodeStream(metadata))).toContain('PUBLIC_XMP_TITLE')
    const files = PdfImporter.open(bytes, { password: 'test' }).importEmbeddedFiles()
    expect(files.find(function (file) { return file.name === 'public.txt' })!.data).toEqual(new Uint8Array([80, 85, 66, 76, 73, 67]))
    expect(files.find(function (file) { return file.name === 'secret.txt' })!.data).toEqual(new Uint8Array([83, 69, 67, 82, 69, 84]))
  })

  it('routes all embedded files through the encryption dictionary /EFF selector', () => {
    const backend = new PdfBackend({
      fonts: {},
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'aes-128' },
      identityCryptFilter: { embeddedFiles: ['public.txt'] },
      embeddedFiles: [{ name: 'public.txt', data: new Uint8Array([80, 85, 66, 76, 73, 67]) }],
    })
    render({ pages: [{ width: 100, height: 100, children: [] }] }, backend)
    const bytes = backend.toUint8Array()
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/EFF /Identity')
    expect(raw).not.toContain('/Type /EmbeddedFile /Filter /Crypt')
    const files = PdfImporter.open(bytes, { password: 'test' }).importEmbeddedFiles()
    expect(files[0]!.data).toEqual(new Uint8Array([80, 85, 66, 76, 73, 67]))
  })
})

// ─── RC4 variable key length (V=2, R=3, /Length 40-128) ───

describe('RC4 variable key length (V=2, R=3)', () => {
  function encryptedWithKeyBits(rc4KeyBits: number): Uint8Array {
    const backend = new PdfBackend({
      fonts: { default: font },
      encryption: { userPassword: 'test', ownerPassword: 'owner', method: 'rc4-128', rc4KeyBits },
      metadata: { title: 'Variable Key' },
    })
    const doc: RenderDocument = {
      pages: [{ width: 595, height: 842, children: [{ type: 'text', x: 72, y: 72, text: 'Hi', fontId: 'default', fontSize: 12, color: '#000000' }] }],
    }
    render(doc, backend)
    return backend.toUint8Array()
  }

  it('emits the requested /Length and round-trips (40, 80, 128 bit)', () => {
    for (const bits of [40, 80, 128]) {
      const bytes = encryptedWithKeyBits(bits)
      expect(new TextDecoder('latin1').decode(bytes)).toContain(`/Length ${bits}`)
      const doc = parsePdf(bytes, { password: 'test' })
      const info = doc.resolve(doc.trailer.get('Info') ?? null) as Map<string, unknown>
      const title = doc.resolve(info.get('Title') ?? null)
      expect(title).toBeInstanceOf(PdfString)
      const b = (title as PdfString).bytes
      let s = ''
      if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
        for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!)
      } else {
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
      }
      expect(s).toBe('Variable Key')
    }
  })

  it('rejects an out-of-range key length', () => {
    expect(() => encryptedWithKeyBits(56.5 as number)).toThrow()
    expect(() => encryptedWithKeyBits(256)).toThrow()
    expect(() => encryptedWithKeyBits(44)).toThrow()
  })
})

// ─── RC4-128 (baseline) ───

describe('RC4-128 encryption (baseline)', () => {
  it('generates valid PDF with /V 2 /R 3', () => {
    const { raw } = generateEncryptedPdf('rc4-128')
    expect(raw).toContain('/V 2')
    expect(raw).toContain('/R 3')
  })

  it('contains /Encrypt reference in trailer', () => {
    const { raw } = generateEncryptedPdf('rc4-128')
    expect(raw).toMatch(/\/Encrypt \d+ 0 R/)
  })
})

// ─── AES-128 (V=4, R=4) ───

describe('AES-128 encryption (V=4, R=4)', () => {
  it('PDF header is %PDF-1.7', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toMatch(/^%PDF-1\.7/)
  })

  it('encrypt dict contains /V 4 /R 4', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toContain('/V 4')
    expect(raw).toContain('/R 4')
  })

  it('encrypt dict contains /CFM /AESV2', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toContain('/CFM /AESV2')
  })

  it('encrypt dict contains /StmF /StdCF /StrF /StdCF', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toContain('/StmF /StdCF')
    expect(raw).toContain('/StrF /StdCF')
  })

  it('encrypt dict contains /Length 128', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toContain('/Length 128')
  })

  it('contains /O hex string (64 hex chars = 32 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    // /O <HEXHEX...> — RC4/AES-128 O value 32 = 64 hex chars.
    
    const oMatch = raw.match(/\/O <([0-9A-Fa-f]+)>/)
    expect(oMatch).not.toBeNull()
    expect(oMatch![1]!.length).toBe(64)
  })

  it('contains /U hex string (64 hex chars = 32 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    const uMatch = raw.match(/\/U <([0-9A-Fa-f]+)>/)
    expect(uMatch).not.toBeNull()
    expect(uMatch![1]!.length).toBe(64)
  })

  it('contains /P (permission flags)', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toMatch(/\/P -?\d+/)
  })

  it('trailer has /ID array', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    expect(raw).toMatch(/\/ID \[<[0-9A-Fa-f]+> <[0-9A-Fa-f]+>\]/)
  })

  it('does not throw during generation', () => {
    expect(() => generateEncryptedPdf('aes-128')).not.toThrow()
  })

  it('encrypts the metadata stream by default (title not in cleartext)', () => {
    const { raw } = generateEncryptedPdf('aes-128', {
      metadata: { title: 'AES128 Encrypted Report', producer: 'tsreport' },
    })
    // /EncryptMetadata defaults to true, so the XMP must not leak in cleartext.
    expect(raw).not.toContain('AES128 Encrypted Report')
  })

  it('permission flags: print=false sets correct /P value', () => {
    const { raw } = generateEncryptedPdf('aes-128', {
      permissions: { print: false },
    })
    const pMatch = raw.match(/\/P (-?\d+)/)
    expect(pMatch).not.toBeNull()
    const p = parseInt(pMatch![1]!, 10)
    // Bit 3 (value 4) print — false with.
    
    expect(p & 4).toBe(0)
  })
})

// ─── AES-256 (V=5, R=6) ───

describe('AES-256 encryption (V=5, R=6)', () => {
  it('uses crypto.getRandomValues instead of Math.random for keys, salts, perms, and IVs', () => {
    const originalRandom = Math.random
    Math.random = function (): number {
      throw new Error('Math.random must not be used for PDF encryption')
    }
    try {
      const ctx = createEncryptionContext({
        method: 'aes-256',
        userPassword: 'test',
        ownerPassword: 'owner',
      })
      expect(ctx.encryptDict.join('\n')).toContain('/R 6')
      expect(ctx.encryptStream(1, 0, new Uint8Array([1, 2, 3, 4])).length).toBe(32)
      expect(ctx.encryptString(1, 0, 'secret').length).toBe(32)
    } finally {
      Math.random = originalRandom
    }
  })

  it('PDF header is %PDF-2.0', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    expect(raw).toMatch(/^%PDF-2\.0/)
  })

  it('encrypt dict contains /V 5 /R 6', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    expect(raw).toContain('/V 5')
    expect(raw).toContain('/R 6')
  })

  it('encrypt dict contains /CFM /AESV3', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    expect(raw).toContain('/CFM /AESV3')
  })

  it('encrypt dict contains /Length 256', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    expect(raw).toContain('/Length 256')
  })

  it('contains /OE hex string (64 hex chars = 32 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    const oeMatch = raw.match(/\/OE <([0-9A-Fa-f]+)>/)
    expect(oeMatch).not.toBeNull()
    expect(oeMatch![1]!.length).toBe(64)
  })

  it('contains /UE hex string (64 hex chars = 32 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    const ueMatch = raw.match(/\/UE <([0-9A-Fa-f]+)>/)
    expect(ueMatch).not.toBeNull()
    expect(ueMatch![1]!.length).toBe(64)
  })

  it('contains /Perms hex string (32 hex chars = 16 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    const permsMatch = raw.match(/\/Perms <([0-9A-Fa-f]+)>/)
    expect(permsMatch).not.toBeNull()
    expect(permsMatch![1]!.length).toBe(32)
  })

  it('contains /O hex string (96 hex chars = 48 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    const oMatch = raw.match(/\/O <([0-9A-Fa-f]+)>/)
    expect(oMatch).not.toBeNull()
    expect(oMatch![1]!.length).toBe(96)
  })

  it('contains /U hex string (96 hex chars = 48 bytes)', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    const uMatch = raw.match(/\/U <([0-9A-Fa-f]+)>/)
    expect(uMatch).not.toBeNull()
    expect(uMatch![1]!.length).toBe(96)
  })

  it('encrypt dict contains /StmF /StdCF /StrF /StdCF', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    expect(raw).toContain('/StmF /StdCF')
    expect(raw).toContain('/StrF /StdCF')
  })

  it('trailer has /ID array', () => {
    const { raw } = generateEncryptedPdf('aes-256')
    expect(raw).toMatch(/\/ID \[<[0-9A-Fa-f]+> <[0-9A-Fa-f]+>\]/)
  })

  it('does not throw during generation', () => {
    expect(() => generateEncryptedPdf('aes-256')).not.toThrow()
  })

  it('encrypts the metadata stream by default (title not in cleartext)', () => {
    const { raw } = generateEncryptedPdf('aes-256', {
      metadata: { title: 'AES256 Encrypted Report', producer: 'tsreport Engine' },
    })
    expect(raw).not.toContain('AES256 Encrypted Report')
  })

  it('with encryptMetadata:false, XMP stays readable and /EncryptMetadata false is set', () => {
    const { raw } = generateEncryptedPdf('aes-256', {
      metadata: { title: 'AES256 Open Report' },
      encryptMetadata: false,
    })
    expect(raw).toContain('/EncryptMetadata false')
    expect(raw).toContain('<?xpacket begin=')
    expect(raw).toContain('AES256 Open Report')
  })
})

describe('AES-256 encryption (V=5, R=5)', () => {
  it('generates and imports the deprecated revision through the public API', () => {
    const { bytes, raw } = generateEncryptedPdf('aes-256-r5', {
      userPassword: 'R5 user',
      ownerPassword: 'R5 owner',
      metadata: { title: 'R5 round trip' },
    })
    expect(raw).toMatch(/^%PDF-1\.7/)
    expect(raw).toContain('/V 5')
    expect(raw).toContain('/R 5')
    const doc = parsePdf(bytes, { password: 'R5 user' })
    expect(doc.getCatalog()).toBeInstanceOf(Map)
    expect(() => parsePdf(bytes, { password: 'wrong' })).toThrow(/authentication/)
  })

  it('uses SASLprep normalization for R5 and R6 Unicode passwords', () => {
    for (const method of ['aes-256-r5', 'aes-256'] as const) {
      const { bytes } = generateEncryptedPdf(method, {
        userPassword: 'p\u00AAss\u00ADword',
        ownerPassword: 'owner',
      })
      expect(() => parsePdf(bytes, { password: 'password' })).not.toThrow()
    }
  })

  it('truncates the prepared UTF-8 password to 127 bytes', () => {
    const prefix = 'a'.repeat(127)
    const { bytes } = generateEncryptedPdf('aes-256-r5', {
      userPassword: `${prefix}first suffix`,
      ownerPassword: 'owner',
    })
    expect(() => parsePdf(bytes, { password: `${prefix}different suffix` })).not.toThrow()
  })

  it('validates /Perms after recovering the R5/R6 file key', () => {
    const { bytes } = generateEncryptedPdf('aes-256', { userPassword: 'test', ownerPassword: 'owner' })
    const raw = new TextDecoder('latin1').decode(bytes)
    const match = /\/Perms <([0-9A-Fa-f]{32})>/.exec(raw)
    expect(match).not.toBeNull()
    const offset = match!.index + match![0].indexOf(match![1]!)
    const tampered = bytes.slice()
    tampered[offset] = tampered[offset] === 0x30 ? 0x31 : 0x30
    expect(() => parsePdf(tampered, { password: 'test' })).toThrow(/Perms validation/)
  })
})

describe('Standard security password encoding', () => {
  it('encodes revisions 2-4 with PDFDocEncoding rather than UTF-16 code-unit truncation', () => {
    for (const method of ['rc4-40', 'rc4-128', 'aes-128'] as const) {
      const { bytes } = generateEncryptedPdf(method, { userPassword: 'bullet\u2022euro\u20AC', ownerPassword: 'owner' })
      expect(() => parsePdf(bytes, { password: 'bullet\u2022euro\u20AC' })).not.toThrow()
    }
  })

  it('rejects a revision 2-4 password outside PDFDocEncoding', () => {
    expect(() => createEncryptionContext({ method: 'aes-128', userPassword: '日本語' })).toThrow(/PDFDocEncoding/)
  })
})

// ─── Encryption with metadata ───

describe('Encryption with metadata', () => {
  it('AES-128 + metadata: encrypt dict present and XMP encrypted by default', () => {
    const { raw } = generateEncryptedPdf('aes-128', {
      metadata: { title: 'AES128 Meta', author: 'Test Author' },
    })
    expect(raw).toContain('/V 4')
    expect(raw).toContain('/R 4')
    expect(raw).toMatch(/\/Encrypt \d+ 0 R/)
    // Metadata encrypted by default: neither the title nor author leak.
    expect(raw).not.toContain('AES128 Meta')
    expect(raw).not.toContain('Test Author')
  })

  it('AES-256 + encryptMetadata:false: XMP readable with title visible', () => {
    const { raw } = generateEncryptedPdf('aes-256', {
      metadata: { title: 'AES256 Meta Title', keywords: 'encrypted, test' },
      encryptMetadata: false,
    })
    expect(raw).toContain('/V 5')
    expect(raw).toContain('/R 6')
    expect(raw).toContain('/EncryptMetadata false')
    expect(raw).toContain('<?xpacket begin=')
    expect(raw).toContain('AES256 Meta Title')
    expect(raw).toContain('pdf:Keywords')
    expect(raw).toContain('encrypted, test')
  })
})

// ─── Permission flags ───

describe('Permission flags', () => {
  it('default permissions: /P is negative (reserved bits set)', () => {
    const { raw } = generateEncryptedPdf('aes-128')
    const pMatch = raw.match(/\/P (-?\d+)/)
    expect(pMatch).not.toBeNull()
    const p = parseInt(pMatch![1]!, 10)
    // Default permissions allow everything: -3904 | 3900 = -4.
    expect(p).toBeLessThan(0)
    expect(p).toBe(-4)
  })

  it('all denied: /P restricts all', () => {
    const { raw } = generateEncryptedPdf('aes-128', {
      permissions: {
        print: false,
        printHighQuality: false,
        copy: false,
        annotate: false,
        modify: false,
        fillForms: false,
        extractForAccessibility: false,
        assemble: false,
      },
    })
    const pMatch = raw.match(/\/P (-?\d+)/)
    expect(pMatch).not.toBeNull()
    const p = parseInt(pMatch![1]!, 10)
    // All permission flags denied: base value -3904.
    expect(p).toBe(-3904)
  })

  it('custom permissions: print allowed, copy denied', () => {
    const { raw } = generateEncryptedPdf('aes-256', {
      permissions: {
        print: true,
        copy: false,
      },
    })
    const pMatch = raw.match(/\/P (-?\d+)/)
    expect(pMatch).not.toBeNull()
    const p = parseInt(pMatch![1]!, 10)
    // Print (bit 3, value 4)
    
    expect(p & 4).toBe(4)
    // Copy (bit 5, value 16)
    
    expect(p & 16).toBe(0)
  })

  it('custom permissions: modify denied, annotate allowed', () => {
    const { raw } = generateEncryptedPdf('aes-128', {
      permissions: {
        modify: false,
        annotate: true,
      },
    })
    const pMatch = raw.match(/\/P (-?\d+)/)
    expect(pMatch).not.toBeNull()
    const p = parseInt(pMatch![1]!, 10)
    // Modify (bit 4, value 8)
    
    expect(p & 8).toBe(0)
    // Annotate (bit 6, value 32)
    
    expect(p & 32).toBe(32)
  })

  it('AES-256 permission flags match AES-128 for same permissions', () => {
    const perms = { print: true, copy: false, modify: false }
    const { raw: raw128 } = generateEncryptedPdf('aes-128', { permissions: perms })
    const { raw: raw256 } = generateEncryptedPdf('aes-256', { permissions: perms })
    const p128 = parseInt(raw128.match(/\/P (-?\d+)/)![1]!, 10)
    const p256 = parseInt(raw256.match(/\/P (-?\d+)/)![1]!, 10)
    expect(p128).toBe(p256)
  })
})
