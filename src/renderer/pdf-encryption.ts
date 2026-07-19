/**
 * PDF encryption
 *
 * RC4 128-bit (V=2, R=3): PDF Reference 1.7, Section 3.5
 * AES-128 (V=4, R=4): PDF Reference 1.7, Crypt Filter
 * AES-256 (V=5, R=6): ISO 32000-2, Section 7.6.4
 *
 * User password: restricts viewing
 * Owner password: restricts permissions (print/copy/edit)
 */
import { aesCbcEncrypt, aesCbcDecrypt, aesCbcDecryptNoPadding } from '../encryption/aes.js'
import { sha256 } from '../encryption/sha256.js'
import { sha384, sha512 } from '../encryption/sha512.js'
import { saslprep } from '../encryption/saslprep.js'
import { getNodeRuntimeBridge } from '../node-runtime-bridge.js'

const EMPTY_BYTES = new Uint8Array(0)

/**
 * ISO 32000-2 Algorithm 2.B: the hardened password hash for AES-256 (R6). An
 * initial SHA-256 is refined by ≥64 rounds of AES-128-CBC over a repeated
 * (password‖K‖udata) buffer, re-hashing with SHA-256/384/512 selected by the
 * result mod 3, until the round count and last byte satisfy the stop rule.
 * `udata` is the 48-byte /U value when hashing the owner entry, else empty.
 */
function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha256(concatBytes(password, salt, udata))
  let round = 0
  let lastByte = 0
  do {
    const seq = concatBytes(password, k, udata)
    const k1 = new Uint8Array(seq.length * 64)
    for (let i = 0; i < 64; i++) k1.set(seq, i * seq.length)
    const e = aesCbcEncryptNoPad(k1, k.subarray(0, 16), k.subarray(16, 32))
    // First 16 bytes of E as a 128-bit big-endian integer mod 3 (256 ≡ 1 mod 3,
    // so this equals the byte sum mod 3).
    let mod = 0
    for (let i = 0; i < 16; i++) mod = (mod + e[i]!) % 3
    k = mod === 0 ? sha256(e) : mod === 1 ? sha384(e) : sha512(e)
    lastByte = e[e.length - 1]!
    round++
  } while (round < 64 || lastByte > round - 32)
  return k.subarray(0, 32)
}

/**
 * ISO 32000-1 extension level 3 Algorithm 2.A: the deprecated AES-256 (R5)
 * password hash — a single SHA-256 of (password‖salt‖udata), without the R6
 * hardening rounds. Retained to read pre-standardization AES-256 documents.
 */
function hash2A(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  return sha256(concatBytes(password, salt, udata))
}

// ─── Public interface ───

export interface PdfEncryptionOptions {
  /** User password (empty string = viewable without a password) */
  userPassword?: string
  /** Owner password (empty string = same as user password) */
  ownerPassword?: string
  /** Permission flags */
  permissions?: PdfPermissions
  /** Encryption method (default: 'rc4-128') */
  method?: 'rc4-40' | 'rc4-128' | 'aes-128' | 'aes-256-r5' | 'aes-256'
  /**
   * RC4 key length in bits for method 'rc4-128' (V=2, R=3): 40-128 in multiples
   * of 8. Default 128. Ignored by 'rc4-40' (fixed V=1/R=2/40-bit) and AES.
   */
  rc4KeyBits?: number
  /**
   * Whether to encrypt the document metadata stream (default true). Setting
   * false leaves the XMP /Metadata readable and emits /EncryptMetadata false;
   * requires a crypt-filter method (aes-128 / aes-256, V≥4).
   */
  encryptMetadata?: boolean
}

export interface PdfPermissions {
  /** Allow printing (default: true) */
  print?: boolean
  /** Allow high-quality printing (default: true) */
  printHighQuality?: boolean
  /** Allow copying content (default: true) */
  copy?: boolean
  /** Allow adding/modifying annotations and form fields (default: true) */
  annotate?: boolean
  /** Allow modifying the document (default: true) */
  modify?: boolean
  /** Allow filling in form fields (default: true) */
  fillForms?: boolean
  /** Allow text extraction for accessibility (default: true) */
  extractForAccessibility?: boolean
  /** Allow document assembly (page insertion/rotation/deletion) (default: true) */
  assemble?: boolean
}

/** Encryption context (used during PDF generation) */
export interface EncryptionContext {
  /** Contents of the /Encrypt dictionary */
  encryptDict: string[]
  /** Encrypt stream data */
  encryptStream(objNum: number, genNum: number, data: Uint8Array): Uint8Array
  /** Encrypt a string */
  encryptString(objNum: number, genNum: number, str: string): Uint8Array
  /** File identifier (hex) */
  fileId: string
  /** PDF version ('1.7' or '2.0') */
  pdfVersion: string
  /** Whether the document metadata stream is encrypted (/EncryptMetadata). */
  encryptMetadata: boolean
}

export type StandardSecurityCipher = 'none' | 'rc4' | 'aesv2' | 'aesv3'

export interface StandardSecurityParams {
  version: number
  revision: number
  lengthBits: number
  oValue: Uint8Array
  uValue: Uint8Array
  pValue: number
  fileId: Uint8Array
  cipher: StandardSecurityCipher
  stringCipher?: StandardSecurityCipher
  embeddedFileCipher?: StandardSecurityCipher
  cryptFilters?: ReadonlyMap<string, StandardSecurityCipher>
  encryptMetadata: boolean
  ueValue?: Uint8Array
  oeValue?: Uint8Array
  permsValue?: Uint8Array
}

export interface DecryptionContext {
  readonly encryptMetadata: boolean
  decryptStream(objNum: number, genNum: number, data: Uint8Array, embeddedFile?: boolean): Uint8Array
  decryptString(objNum: number, genNum: number, data: Uint8Array): Uint8Array
  decryptCryptFilter(objNum: number, genNum: number, data: Uint8Array, name: string): Uint8Array
}

// ─── Constants ───

/** PDF password padding (32 bytes) */
const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
  0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
  0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
])

// ─── Encryption context creation ───

export function createEncryptionContext(
  options: PdfEncryptionOptions,
): EncryptionContext {
  const method = options.method ?? 'rc4-128'
  if (method === 'aes-256' || method === 'aes-256-r5') {
    return createAes256Context(options, method === 'aes-256-r5' ? 5 : 6)
  }
  return createRc4OrAes128Context(options, method)
}

export function createDecryptionContext(
  params: StandardSecurityParams,
  password: string,
): DecryptionContext {
  // AES-256 covers both R6 (ISO 32000-2) and the deprecated R5 (Adobe extension).
  const fileKey = params.revision >= 5
    ? authenticateAes256(params, password)
    : authenticateRc4OrAes128(params, password)
  return buildDecryptionContext(params, fileKey)
}

/**
 * Build a decryption context from an already-derived file key. Used by the
 * public-key security handler, whose file key comes from a recipient's
 * private key rather than a password.
 */
export function createDecryptionContextWithKey(
  params: StandardSecurityParams,
  fileKey: Uint8Array,
): DecryptionContext {
  return buildDecryptionContext(params, fileKey)
}

function buildDecryptionContext(params: StandardSecurityParams, fileKey: Uint8Array): DecryptionContext {
  return {
    encryptMetadata: params.encryptMetadata,
    decryptStream(objNum: number, genNum: number, data: Uint8Array, embeddedFile = false): Uint8Array {
      const cipher = embeddedFile ? (params.embeddedFileCipher ?? params.cipher) : params.cipher
      return decryptObjectData(cipher, fileKey, objNum, genNum, data)
    },
    decryptString(objNum: number, genNum: number, data: Uint8Array): Uint8Array {
      return decryptObjectData(params.stringCipher ?? params.cipher, fileKey, objNum, genNum, data)
    },
    decryptCryptFilter(objNum: number, genNum: number, data: Uint8Array, name: string): Uint8Array {
      if (name === 'Identity') return data
      const cipher = params.cryptFilters?.get(name)
      if (cipher === undefined) {
        throw new Error(`PDF parse error: unsupported Crypt filter /${name}`)
      }
      return decryptObjectData(cipher, fileKey, objNum, genNum, data)
    },
  }
}

/** RC4-40 (V=1, R=2) / RC4-128 (V=2, R=3) / AES-128 (V=4, R=4) */
function createRc4OrAes128Context(
  options: PdfEncryptionOptions,
  method: 'rc4-40' | 'rc4-128' | 'aes-128',
): EncryptionContext {
  const userPwd = options.userPassword ?? ''
  const ownerPwd = options.ownerPassword ?? userPwd
  const permFlags = computePermFlags(options.permissions ?? {})

  const isRc4_40 = method === 'rc4-40'
  const revision = isRc4_40 ? 2 : method === 'aes-128' ? 4 : 3
  let keyLength = isRc4_40 ? 5 : 16
  if (method === 'rc4-128' && options.rc4KeyBits !== undefined) {
    const bits = options.rc4KeyBits
    if (bits < 40 || bits > 128 || bits % 8 !== 0) {
      throw new Error(`RC4 key length must be 40-128 bits in multiples of 8, got ${bits}`)
    }
    keyLength = bits >> 3
  }
  const rc4Bits = keyLength << 3
  const encryptMetadata = options.encryptMetadata ?? true
  // /EncryptMetadata is only meaningful for crypt-filter handlers (V≥4).
  if (!encryptMetadata && method !== 'aes-128') {
    throw new Error('encryptMetadata:false requires a crypt-filter method (aes-128 or aes-256)')
  }

  // Generate file ID (random 16 bytes)
  const fileIdBytes = randomBytes(16)
  const fileId = bytesToHex(fileIdBytes)

  // Compute O value (Owner password hash)
  const oValue = computeOValue(ownerPwd, userPwd, revision, keyLength)

  // Compute encryption key (Algorithm 3.2 step 6 appends 0xFFFFFFFF when
  // metadata is not encrypted, for R≥4).
  const encKey = computeEncryptionKey(userPwd, oValue, permFlags, fileIdBytes, revision, keyLength, encryptMetadata)

  // Compute U value (User password hash): Algorithm 3.4 for R2, else 3.5.
  const uValue = isRc4_40 ? computeUValueR2(encKey) : computeUValue(encKey, fileIdBytes)

  const oHex = bytesToHex(oValue)
  const uHex = bytesToHex(uValue)

  const isAes = method === 'aes-128'

  const encryptDict: string[] = isAes
    ? [
        '/Type /Encrypt',
        '/Filter /Standard',
        '/V 4',
        '/R 4',
        '/Length 128',
        `/O <${oHex}>`,
        `/U <${uHex}>`,
        `/P ${permFlags}`,
        '/CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >>',
        '/StmF /StdCF',
        '/StrF /StdCF',
        '/EFF /StdCF',
        ...(encryptMetadata ? [] : ['/EncryptMetadata false']),
      ]
    : isRc4_40
      ? [
          '/Type /Encrypt',
          '/Filter /Standard',
          '/V 1',
          '/R 2',
          '/Length 40',
          `/O <${oHex}>`,
          `/U <${uHex}>`,
          `/P ${permFlags}`,
        ]
      : [
          '/Type /Encrypt',
          '/Filter /Standard',
          '/V 2',
          '/R 3',
          `/Length ${rc4Bits}`,
          `/O <${oHex}>`,
          `/U <${uHex}>`,
          `/P ${permFlags}`,
        ]

  if (isAes) {
    return {
      encryptDict,
      fileId,
      pdfVersion: '1.7',
      encryptMetadata,
      encryptStream(objNum: number, genNum: number, data: Uint8Array): Uint8Array {
        const objKey = deriveObjectKeyAes(encKey, objNum, genNum)
        const iv = randomBytes(16)
        const encrypted = aesCbcEncrypt(data, objKey, iv)
        // AES: IV (16 bytes) + encrypted data
        const result = new Uint8Array(16 + encrypted.length)
        result.set(iv)
        result.set(encrypted, 16)
        return result
      },
      encryptString(objNum: number, genNum: number, str: string): Uint8Array {
        const bytes = new Uint8Array(str.length)
        for (let i = 0; i < str.length; i++) {
          bytes[i] = str.charCodeAt(i) & 0xFF
        }
        const objKey = deriveObjectKeyAes(encKey, objNum, genNum)
        const iv = randomBytes(16)
        const encrypted = aesCbcEncrypt(bytes, objKey, iv)
        const result = new Uint8Array(16 + encrypted.length)
        result.set(iv)
        result.set(encrypted, 16)
        return result
      },
    }
  }

  return {
    encryptDict,
    fileId,
    pdfVersion: '1.7',
    encryptMetadata,
    encryptStream(objNum: number, genNum: number, data: Uint8Array): Uint8Array {
      const objKey = deriveObjectKey(encKey, objNum, genNum)
      return rc4(objKey, data)
    },
    encryptString(objNum: number, genNum: number, str: string): Uint8Array {
      const bytes = new Uint8Array(str.length)
      for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF
      }
      const objKey = deriveObjectKey(encKey, objNum, genNum)
      return rc4(objKey, bytes)
    },
  }
}

function authenticateRc4OrAes128(params: StandardSecurityParams, password: string): Uint8Array {
  const keyLength = params.lengthBits >> 3
  const padded = padPassword(password)
  let key = computeEncryptionKeyFromPadded(
    padded,
    params.oValue,
    params.pValue,
    params.fileId,
    keyLength,
    params.revision,
    params.encryptMetadata,
  )
  if (matchesUserValue(params, key)) return key

  const ownerUserPadded = decryptOwnerPassword(params, password, keyLength)
  key = computeEncryptionKeyFromPadded(
    ownerUserPadded,
    params.oValue,
    params.pValue,
    params.fileId,
    keyLength,
    params.revision,
    params.encryptMetadata,
  )
  if (matchesUserValue(params, key)) return key

  throw new Error('Encrypted PDF /Encrypt password authentication failed')
}

function authenticateAes256(params: StandardSecurityParams, password: string): Uint8Array {
  const uValue = requireBytes(params.uValue, 48, '/U')
  const oValue = requireBytes(params.oValue, 48, '/O')
  const ueValue = requireBytes(params.ueValue, 32, '/UE')
  const oeValue = requireBytes(params.oeValue, 32, '/OE')
  const passwordBytes = encodeAes256Password(password)
  // R6 uses the hardened Algorithm 2.B hash; the deprecated R5 uses the plain
  // single-SHA-256 Algorithm 2.A. Both share the same salt layout and AES-256
  // file-key unwrap.
  const hash = params.revision === 6 ? hash2B : hash2A

  const uValidationSalt = uValue.subarray(32, 40)
  const uHash = hash(passwordBytes, uValidationSalt, EMPTY_BYTES)
  if (bytesEqual(uHash, uValue.subarray(0, 32))) {
    const uKeySalt = uValue.subarray(40, 48)
    const key = hash(passwordBytes, uKeySalt, EMPTY_BYTES)
    const fileKey = aesCbcDecryptNoPadding(ueValue, key, new Uint8Array(16))
    validateAes256Permissions(params, fileKey)
    return fileKey
  }

  const oValidationSalt = oValue.subarray(32, 40)
  const oHash = hash(passwordBytes, oValidationSalt, uValue)
  if (bytesEqual(oHash, oValue.subarray(0, 32))) {
    const oKeySalt = oValue.subarray(40, 48)
    const key = hash(passwordBytes, oKeySalt, uValue)
    const fileKey = aesCbcDecryptNoPadding(oeValue, key, new Uint8Array(16))
    validateAes256Permissions(params, fileKey)
    return fileKey
  }

  throw new Error('Encrypted PDF /Encrypt password authentication failed')
}

function validateAes256Permissions(params: StandardSecurityParams, fileKey: Uint8Array): void {
  const encrypted = requireBytes(params.permsValue, 16, '/Perms')
  const perms = aesCbcDecryptNoPadding(encrypted, fileKey, new Uint8Array(16))
  const permissionValue = (perms[0]! | (perms[1]! << 8) | (perms[2]! << 16) | (perms[3]! << 24)) | 0
  const metadataByte = params.encryptMetadata ? 0x54 : 0x46
  if (permissionValue !== params.pValue
      || perms[4] !== 0xFF || perms[5] !== 0xFF || perms[6] !== 0xFF || perms[7] !== 0xFF
      || perms[8] !== metadataByte || perms[9] !== 0x61 || perms[10] !== 0x64 || perms[11] !== 0x62) {
    throw new Error('Encrypted PDF /Perms validation failed')
  }
}

function decryptObjectData(
  cipher: StandardSecurityCipher,
  fileKey: Uint8Array,
  objNum: number,
  genNum: number,
  data: Uint8Array,
): Uint8Array {
  if (cipher === 'none') return data
  if (cipher === 'rc4') {
    return rc4(deriveObjectKey(fileKey, objNum, genNum), data)
  }
  if (data.length < 16 || ((data.length - 16) & 15) !== 0) {
    throw new Error('PDF parse error: AES encrypted object data has invalid length')
  }
  const iv = data.subarray(0, 16)
  const encrypted = data.subarray(16)
  if (cipher === 'aesv2') {
    return aesCbcDecrypt(encrypted, deriveObjectKeyAes(fileKey, objNum, genNum), iv)
  }
  return aesCbcDecrypt(encrypted, fileKey, iv)
}

function decryptOwnerPassword(
  params: StandardSecurityParams,
  password: string,
  keyLength: number,
): Uint8Array {
  const key = computeOwnerKey(password, keyLength, params.revision)
  if (params.revision <= 2) return rc4(key, params.oValue)
  let data = params.oValue
  for (let round = 19; round >= 0; round--) {
    const roundKey = new Uint8Array(keyLength)
    for (let i = 0; i < keyLength; i++) roundKey[i] = key[i]! ^ round
    data = rc4(roundKey, data)
  }
  return data
}

function computeOwnerKey(password: string, keyLength: number, revision: number): Uint8Array {
  let hash = md5(padPassword(password))
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash)
  }
  return hash.subarray(0, keyLength)
}

function computeEncryptionKeyFromPadded(
  padded: Uint8Array,
  oValue: Uint8Array,
  permFlags: number,
  fileId: Uint8Array,
  keyLength: number,
  revision: number,
  encryptMetadata: boolean,
): Uint8Array {
  const permBytes = new Uint8Array(4)
  permBytes[0] = permFlags & 0xFF
  permBytes[1] = (permFlags >> 8) & 0xFF
  permBytes[2] = (permFlags >> 16) & 0xFF
  permBytes[3] = (permFlags >> 24) & 0xFF
  const metadataBytes = revision >= 4 && !encryptMetadata
    ? new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])
    : new Uint8Array(0)
  let hash = md5(concatBytes(padded, oValue, permBytes, fileId, metadataBytes))
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, keyLength))
  }
  return hash.subarray(0, keyLength)
}

function matchesUserValue(params: StandardSecurityParams, key: Uint8Array): boolean {
  if (params.revision <= 2) {
    return bytesEqual(rc4(key, PASSWORD_PADDING), params.uValue)
  }
  return bytesEqual(computeUValue(key, params.fileId).subarray(0, 16), params.uValue.subarray(0, 16))
}

function requireBytes(value: Uint8Array | undefined, length: number, label: string): Uint8Array {
  // The AES-256 /O /U /UE /OE values have fixed spec lengths, but some producers
  // zero-pad them beyond that. Accept any value at least that long and use the
  // defined prefix; only a genuinely short value is rejected.
  if (!value || value.length < length) {
    throw new Error(`PDF parse error: encrypted PDF ${label} must be at least ${length} bytes`)
  }
  return value.length === length ? value : value.subarray(0, length)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** AES-256 (V=5, R=5/R=6) — Adobe extension level 3 / ISO 32000-2 §7.6.4 */
function createAes256Context(options: PdfEncryptionOptions, revision: 5 | 6): EncryptionContext {
  const userPwd = options.userPassword ?? ''
  const ownerPwd = options.ownerPassword ?? userPwd
  const permFlags = computePermFlags(options.permissions ?? {})
  const encryptMetadata = options.encryptMetadata ?? true

  // File encryption key (32 bytes, random)
  const fileEncKey = randomBytes(32)

  // Generate file ID
  const fileIdBytes = randomBytes(16)
  const fileId = bytesToHex(fileIdBytes)

  // U (48 bytes): hash(32) + validationSalt(8) + keySalt(8)
  const uValidationSalt = randomBytes(8)
  const uKeySalt = randomBytes(8)
  const hash = revision === 5 ? hash2A : hash2B
  const userPassword = encodeAes256Password(userPwd)
  const ownerPassword = encodeAes256Password(ownerPwd)
  const uHash = hash(userPassword, uValidationSalt, EMPTY_BYTES)
  const uValue = new Uint8Array(48)
  uValue.set(uHash, 0)
  uValue.set(uValidationSalt, 32)
  uValue.set(uKeySalt, 40)

  // UE (32 bytes): AES-256-CBC(fileEncKey, key=Algorithm2B(pwd+keySalt), iv=0)
  const ueKey = hash(userPassword, uKeySalt, EMPTY_BYTES)
  const zeroIv = new Uint8Array(16)
  const ueValue = aesCbcEncryptNoPad(fileEncKey, ueKey, zeroIv)

  // O (48 bytes): hash(32) + validationSalt(8) + keySalt(8)
  const oValidationSalt = randomBytes(8)
  const oKeySalt = randomBytes(8)
  const oHash = hash(ownerPassword, oValidationSalt, uValue)
  const oValue = new Uint8Array(48)
  oValue.set(oHash, 0)
  oValue.set(oValidationSalt, 32)
  oValue.set(oKeySalt, 40)

  // OE (32 bytes): AES-256-CBC(fileEncKey, key=Algorithm2B(pwd+keySalt+U), iv=0)
  const oeKey = hash(ownerPassword, oKeySalt, uValue)
  const oeValue = aesCbcEncryptNoPad(fileEncKey, oeKey, zeroIv)

  // Perms (16 bytes): AES-256-ECB(permData, fileEncKey)
  const permsData = new Uint8Array(16)
  permsData[0] = permFlags & 0xFF
  permsData[1] = (permFlags >> 8) & 0xFF
  permsData[2] = (permFlags >> 16) & 0xFF
  permsData[3] = (permFlags >> 24) & 0xFF
  permsData[4] = 0xFF; permsData[5] = 0xFF; permsData[6] = 0xFF; permsData[7] = 0xFF
  permsData[8] = encryptMetadata ? 0x54 : 0x46  // 'T'/'F' (EncryptMetadata)
  permsData[9] = 0x61; permsData[10] = 0x64; permsData[11] = 0x62  // "adb"
  // bytes 12-15: random
  permsData.set(randomBytes(4), 12)
  const permsValue = aesCbcEncryptNoPad(permsData, fileEncKey, zeroIv)

  const encryptDict = [
    '/Type /Encrypt',
    '/Filter /Standard',
    '/V 5',
    `/R ${revision}`,
    '/Length 256',
    `/O <${bytesToHex(oValue)}>`,
    `/U <${bytesToHex(uValue)}>`,
    `/OE <${bytesToHex(oeValue)}>`,
    `/UE <${bytesToHex(ueValue)}>`,
    `/Perms <${bytesToHex(permsValue)}>`,
    `/P ${permFlags}`,
    '/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >>',
    '/StmF /StdCF',
    '/StrF /StdCF',
    '/EFF /StdCF',
    ...(encryptMetadata ? [] : ['/EncryptMetadata false']),
  ]

  return {
    encryptDict,
    fileId,
    pdfVersion: revision === 6 ? '2.0' : '1.7',
    encryptMetadata,
    encryptStream(_objNum: number, _genNum: number, data: Uint8Array): Uint8Array {
      // AES-256: use the file encryption key directly (no object key derivation)
      const iv = randomBytes(16)
      const encrypted = aesCbcEncrypt(data, fileEncKey, iv)
      const result = new Uint8Array(16 + encrypted.length)
      result.set(iv)
      result.set(encrypted, 16)
      return result
    },
    encryptString(_objNum: number, _genNum: number, str: string): Uint8Array {
      const bytes = new Uint8Array(str.length)
      for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF
      }
      const iv = randomBytes(16)
      const encrypted = aesCbcEncrypt(bytes, fileEncKey, iv)
      const result = new Uint8Array(16 + encrypted.length)
      result.set(iv)
      result.set(encrypted, 16)
      return result
    },
  }
}

/** Compute permission flags */
export function computePermFlags(perms: PdfPermissions): number {
  let permFlags = -3904 // bits 7,8 are reserved (1), the rest follow the PDF spec
  if (perms.print !== false) permFlags |= 4        // bit 3
  if (perms.modify !== false) permFlags |= 8       // bit 4
  if (perms.copy !== false) permFlags |= 16        // bit 5
  if (perms.annotate !== false) permFlags |= 32    // bit 6
  if (perms.fillForms !== false) permFlags |= 256  // bit 9
  if (perms.extractForAccessibility !== false) permFlags |= 512 // bit 10
  if (perms.assemble !== false) permFlags |= 1024  // bit 11
  if (perms.printHighQuality !== false) permFlags |= 2048 // bit 12
  return permFlags
}

/** SASLprep, UTF-8, and the 127-byte R5/R6 password limit. */
function encodeAes256Password(password: string): Uint8Array {
  return new TextEncoder().encode(saslprep(password)).subarray(0, 127)
}

/** AES-CBC encryption (no padding, input is a multiple of 16) */
function aesCbcEncryptNoPad(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  // Encrypt without PKCS#7 padding (assumes data is exactly a multiple of 16 bytes)
  // aesCbcEncrypt appends PKCS#7 padding, so implement manually here
  // However, if data is not a multiple of 16, zero-pad it
  const blockCount = Math.ceil(data.length / 16)
  const padded = new Uint8Array(blockCount * 16)
  padded.set(data)
  // aesCbcEncrypt cannot be used because it adds PKCS#7
  // Instead: encrypt each block with XOR + AES-ECB
  const result = new Uint8Array(blockCount * 16)
  let prev = iv
  for (let i = 0; i < blockCount; i++) {
    const block = new Uint8Array(16)
    for (let j = 0; j < 16; j++) {
      block[j] = padded[i * 16 + j]! ^ prev[j]!
    }
    // AES-ECB encrypt: use aesCbcEncrypt with zero IV on exactly one block
    // Actually, we need a raw ECB encrypt. Let's use aesCbcEncrypt trick:
    // aesCbcEncrypt(block, key, zeroIv) returns encrypted block + PKCS#7 padding block
    const zeroIv = new Uint8Array(16)
    const enc = aesCbcEncrypt(block, key, zeroIv)
    // First 16 bytes is the encrypted block (PKCS#7 adds a second block of padding)
    result.set(enc.subarray(0, 16), i * 16)
    prev = result.subarray(i * 16, i * 16 + 16)
  }
  return result
}

/** Generate random bytes */
export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  const crypto = globalThis.crypto
  if (crypto !== undefined) {
    crypto.getRandomValues(bytes)
    return bytes
  }
  const runtime = getNodeRuntimeBridge()
  if (runtime === null) throw new Error('Secure random generation requires a cryptographic runtime')
  runtime.randomFill(bytes)
  return bytes
}

// ─── Internal: password/key computation ───

/** Pad a password to 32 bytes */
function padPassword(pwd: string): Uint8Array {
  const password = encodePdfDocPassword(pwd)
  const result = new Uint8Array(32)
  const len = Math.min(password.length, 32)
  result.set(password.subarray(0, len))
  for (let i = len; i < 32; i++) {
    result[i] = PASSWORD_PADDING[i - len]!
  }
  return result
}

const PDF_DOC_PASSWORD_BYTES = new Map<number, number>([
  [0x02D8, 0x18], [0x02C7, 0x19], [0x02C6, 0x1A], [0x02D9, 0x1B],
  [0x02DD, 0x1C], [0x02DB, 0x1D], [0x02DA, 0x1E], [0x02DC, 0x1F],
  [0x2022, 0x80], [0x2020, 0x81], [0x2021, 0x82], [0x2026, 0x83],
  [0x2014, 0x84], [0x2013, 0x85], [0x0192, 0x86], [0x2044, 0x87],
  [0x2039, 0x88], [0x203A, 0x89], [0x2212, 0x8A], [0x2030, 0x8B],
  [0x201E, 0x8C], [0x201C, 0x8D], [0x201D, 0x8E], [0x2018, 0x8F],
  [0x2019, 0x90], [0x201A, 0x91], [0x2122, 0x92], [0xFB01, 0x93],
  [0xFB02, 0x94], [0x0141, 0x95], [0x0152, 0x96], [0x0160, 0x97],
  [0x0178, 0x98], [0x017D, 0x99], [0x0131, 0x9A], [0x0142, 0x9B],
  [0x0153, 0x9C], [0x0161, 0x9D], [0x017E, 0x9E], [0x20AC, 0xA0],
])

function encodePdfDocPassword(password: string): Uint8Array {
  const bytes: number[] = []
  for (const character of password) {
    const codePoint = character.codePointAt(0)!
    const direct = (codePoint >= 0x20 && codePoint <= 0x7E)
      || (codePoint >= 0xA1 && codePoint <= 0xFF && codePoint !== 0xAD)
    const byte = direct ? codePoint : PDF_DOC_PASSWORD_BYTES.get(codePoint)
    if (byte === undefined) {
      throw new Error(`PDF Standard security revisions 2-4 require PDFDocEncoding passwords; U+${codePoint.toString(16).toUpperCase()} is not representable`)
    }
    bytes.push(byte)
  }
  return new Uint8Array(bytes)
}

/** Compute the O value (Algorithm 3.3). keyLength/revision select R2 vs R3+. */
function computeOValue(ownerPwd: string, userPwd: string, revision: number, keyLength: number): Uint8Array {
  // Step 1: MD5(padded owner password)
  const ownerPadded = padPassword(ownerPwd)
  let hash = md5(ownerPadded)

  // Step 2: 50 additional hash rounds (Rev >= 3)
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash)
  }

  // Step 3: RC4 key = first keyLength bytes of hash (5 for R2, 16 for R3-128)
  const rc4Key = hash.subarray(0, keyLength)

  // Step 4: encrypt with RC4(padded user password)
  const userPadded = padPassword(userPwd)
  let result = rc4(rc4Key, userPadded)

  // Step 5: 19 additional RC4 rounds (Rev >= 3)
  if (revision >= 3) {
    for (let i = 1; i <= 19; i++) {
      const tmpKey = new Uint8Array(keyLength)
      for (let j = 0; j < keyLength; j++) tmpKey[j] = rc4Key[j]! ^ i
      result = rc4(tmpKey, result)
    }
  }

  return result
}

/** Compute the encryption key (Algorithm 3.2). */
function computeEncryptionKey(
  userPwd: string,
  oValue: Uint8Array,
  permFlags: number,
  fileId: Uint8Array,
  revision: number,
  keyLength: number,
  encryptMetadata = true,
): Uint8Array {
  // Step 1-4: MD5(padded password + O + P + fileID)
  const padded = padPassword(userPwd)
  const permBytes = new Uint8Array(4)
  permBytes[0] = permFlags & 0xFF
  permBytes[1] = (permFlags >> 8) & 0xFF
  permBytes[2] = (permFlags >> 16) & 0xFF
  permBytes[3] = (permFlags >> 24) & 0xFF

  // Step 6 (R≥4): if metadata is not encrypted, hash 4 bytes of 0xFF.
  const input = revision >= 4 && !encryptMetadata
    ? concatBytes(padded, oValue, permBytes, fileId, new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]))
    : concatBytes(padded, oValue, permBytes, fileId)
  let hash = md5(input)

  // Step 5: 50 additional hash rounds (Rev >= 3)
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, keyLength))
  }

  return hash.subarray(0, keyLength)
}

/** Compute the U value for Rev 2 (Algorithm 3.4): RC4 of the padding string. */
function computeUValueR2(encKey: Uint8Array): Uint8Array {
  return rc4(encKey, PASSWORD_PADDING)
}

/** Compute the U value (Algorithm 3.5, Rev 3) */
function computeUValue(encKey: Uint8Array, fileId: Uint8Array): Uint8Array {
  // Step 1: MD5(password padding + fileID)
  const input = concatBytes(PASSWORD_PADDING, fileId)
  const hash = md5(input)

  // Step 2: encrypt with RC4
  let result = rc4(encKey, hash)

  // Step 3: 19 additional RC4 rounds
  for (let i = 1; i <= 19; i++) {
    const tmpKey = new Uint8Array(16)
    for (let j = 0; j < 16; j++) {
      tmpKey[j] = encKey[j]! ^ i
    }
    result = rc4(tmpKey, result)
  }

  // Pad to 32 bytes (the remaining 16 bytes are arbitrary)
  const uValue = new Uint8Array(32)
  uValue.set(result.subarray(0, 16))
  return uValue
}

/** Derive the object-specific key — RC4 (Algorithm 3.1) */
export function deriveObjectKey(
  encKey: Uint8Array,
  objNum: number,
  genNum: number,
): Uint8Array {
  // encKey + objNum (3 bytes LE) + genNum (2 bytes LE)
  const input = new Uint8Array(encKey.length + 5)
  input.set(encKey)
  const off = encKey.length
  input[off] = objNum & 0xFF
  input[off + 1] = (objNum >> 8) & 0xFF
  input[off + 2] = (objNum >> 16) & 0xFF
  input[off + 3] = genNum & 0xFF
  input[off + 4] = (genNum >> 8) & 0xFF

  const hash = md5(input)
  const keyLen = Math.min(encKey.length + 5, 16)
  return hash.subarray(0, keyLen)
}

/** Derive the object-specific key — AES-128 (V=4, R=4) */
export function deriveObjectKeyAes(
  encKey: Uint8Array,
  objNum: number,
  genNum: number,
): Uint8Array {
  // encKey + objNum (3 bytes LE) + genNum (2 bytes LE) + "sAlT" (4 bytes)
  const input = new Uint8Array(encKey.length + 9)
  input.set(encKey)
  const off = encKey.length
  input[off] = objNum & 0xFF
  input[off + 1] = (objNum >> 8) & 0xFF
  input[off + 2] = (objNum >> 16) & 0xFF
  input[off + 3] = genNum & 0xFF
  input[off + 4] = (genNum >> 8) & 0xFF
  // "sAlT" marker for AES
  input[off + 5] = 0x73  // 's'
  input[off + 6] = 0x41  // 'A'
  input[off + 7] = 0x6C  // 'l'
  input[off + 8] = 0x54  // 'T'

  const hash = md5(input)
  // AES-128: always a 16-byte key
  return hash.subarray(0, 16)
}

// ─── RC4 cipher ───

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  // KSA (Key-Scheduling Algorithm)
  const S = new Uint8Array(256)
  for (let i = 0; i < 256; i++) S[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xFF
    const tmp = S[i]!; S[i] = S[j]!; S[j] = tmp
  }

  // PRGA (Pseudo-Random Generation Algorithm)
  const result = new Uint8Array(data.length)
  let ii = 0, jj = 0
  for (let k = 0; k < data.length; k++) {
    ii = (ii + 1) & 0xFF
    jj = (jj + S[ii]!) & 0xFF
    const tmp = S[ii]!; S[ii] = S[jj]!; S[jj] = tmp
    result[k] = data[k]! ^ S[(S[ii]! + S[jj]!) & 0xFF]!
  }
  return result
}

// ─── MD5 hash ───

/** MD5 hash (RFC 1321) — pure TypeScript implementation */
export function md5(data: Uint8Array): Uint8Array {
  // Pre-processing: adding padding bits
  const bitLen = data.length * 8
  const padLen = ((55 - data.length) % 64 + 64) % 64 + 1
  const totalLen = data.length + padLen + 8
  const buf = new Uint8Array(totalLen)
  buf.set(data)
  buf[data.length] = 0x80

  // Append length in bits as 64-bit LE
  const view = new DataView(buf.buffer)
  view.setUint32(totalLen - 8, bitLen >>> 0, true)
  view.setUint32(totalLen - 4, 0, true) // high 32 bits (always 0 is sufficient)

  // Initialize hash values
  let a0 = 0x67452301
  let b0 = 0xEFCDAB89
  let c0 = 0x98BADCFE
  let d0 = 0x10325476

  // Process each 512-bit block
  const M = new Uint32Array(16)
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(offset + i * 4, true)
    }

    let A = a0, B = b0, C = c0, D = d0

    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }

      F = (F + A + MD5_K[i]! + M[g]!) | 0
      A = D
      D = C
      C = B
      B = (B + ((F << MD5_S[i]!) | (F >>> (32 - MD5_S[i]!)))) | 0
    }

    a0 = (a0 + A) | 0
    b0 = (b0 + B) | 0
    c0 = (c0 + C) | 0
    d0 = (d0 + D) | 0
  }

  // Produce the final hash value
  const result = new Uint8Array(16)
  const rv = new DataView(result.buffer)
  rv.setUint32(0, a0, true)
  rv.setUint32(4, b0, true)
  rv.setUint32(8, c0, true)
  rv.setUint32(12, d0, true)
  return result
}

// MD5 constants
const MD5_S = new Uint8Array([
  7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
  5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
  4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
  6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
])

const MD5_K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
])

// ─── Utilities ───

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0
  for (let i = 0; i < arrays.length; i++) totalLen += arrays[i]!.length
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (let i = 0; i < arrays.length; i++) {
    result.set(arrays[i]!, offset)
    offset += arrays[i]!.length
  }
  return result
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0').toUpperCase()
  }
  return hex
}
