/** RFC 8018 PBES2 decryption for password-protected PKCS#8 private keys. */

import { aesCbcDecryptNoPadding } from './aes.js'
import { tripleDesCbcDecrypt } from './des.js'
import { pbkdf2, type Pbkdf2Prf } from './pbkdf2.js'

interface DerValue {
  tag: number
  content: Uint8Array
  raw: Uint8Array
}

const OID_PBES2 = '1.2.840.113549.1.5.13'
const OID_PBKDF2 = '1.2.840.113549.1.5.12'

const PRF_OIDS: Record<string, Pbkdf2Prf> = {
  '1.2.840.113549.2.7': 'HMAC-SHA-1',
  '1.2.840.113549.2.8': 'HMAC-SHA-224',
  '1.2.840.113549.2.9': 'HMAC-SHA-256',
  '1.2.840.113549.2.10': 'HMAC-SHA-384',
  '1.2.840.113549.2.11': 'HMAC-SHA-512',
  '1.2.840.113549.2.12': 'HMAC-SHA-512/224',
  '1.2.840.113549.2.13': 'HMAC-SHA-512/256',
}

const AES_CBC_OIDS: Record<string, number> = {
  '2.16.840.1.101.3.4.1.2': 16,
  '2.16.840.1.101.3.4.1.22': 24,
  '2.16.840.1.101.3.4.1.42': 32,
}

function readDer(data: Uint8Array, offset: number): { value: DerValue, next: number } {
  if (offset + 2 > data.length) throw new Error('PKCS#8: truncated DER')
  const start = offset
  const tag = data[offset++]!
  let length = data[offset++]!
  if ((length & 0x80) !== 0) {
    const count = length & 0x7f
    if (count === 0 || count > 4 || offset + count > data.length || data[offset] === 0) throw new Error('PKCS#8: invalid DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + data[offset++]!
    if (length < 128) throw new Error('PKCS#8: non-minimal DER length')
  }
  const end = offset + length
  if (end > data.length) throw new Error('PKCS#8: truncated DER value')
  return { value: { tag, content: data.subarray(offset, end), raw: data.subarray(start, end) }, next: end }
}

function children(value: DerValue): DerValue[] {
  const result: DerValue[] = []
  let offset = 0
  while (offset < value.content.length) {
    const child = readDer(value.content, offset)
    result.push(child.value)
    offset = child.next
  }
  return result
}

function decodeOid(value: DerValue): string {
  if (value.tag !== 0x06 || value.content.length === 0) throw new Error('PKCS#8: expected OBJECT IDENTIFIER')
  const result = [Math.trunc(value.content[0]! / 40), value.content[0]! % 40]
  let component = 0
  for (let i = 1; i < value.content.length; i++) {
    component = component * 128 + (value.content[i]! & 0x7f)
    if ((value.content[i]! & 0x80) === 0) {
      result.push(component)
      component = 0
    }
  }
  if ((value.content[value.content.length - 1]! & 0x80) !== 0) throw new Error('PKCS#8: truncated OBJECT IDENTIFIER')
  return result.join('.')
}

function positiveInteger(value: DerValue, label: string): number {
  if (value.tag !== 0x02 || value.content.length === 0 || (value.content[0]! & 0x80) !== 0) throw new Error(`PKCS#8: ${label} must be a positive INTEGER`)
  let result = 0
  for (let i = 0; i < value.content.length; i++) result = result * 256 + value.content[i]!
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`PKCS#8: ${label} must be a positive safe integer`)
  return result
}

function algorithmIdentifier(value: DerValue, label: string): DerValue[] {
  if (value.tag !== 0x30) throw new Error(`PKCS#8: ${label} AlgorithmIdentifier must be a SEQUENCE`)
  const fields = children(value)
  if (fields.length < 1 || fields.length > 2) throw new Error(`PKCS#8: malformed ${label} AlgorithmIdentifier`)
  return fields
}

function removePkcs7Padding(value: Uint8Array, blockLength: number): Uint8Array {
  if (value.length === 0 || value.length % blockLength !== 0) throw new Error('PKCS#8: invalid encrypted-data block length')
  const paddingLength = value[value.length - 1]!
  if (paddingLength === 0 || paddingLength > blockLength) throw new Error('PKCS#8: invalid password or PKCS#7 padding')
  for (let i = value.length - paddingLength; i < value.length; i++) {
    if (value[i] !== paddingLength) throw new Error('PKCS#8: invalid password or PKCS#7 padding')
  }
  return value.subarray(0, value.length - paddingLength)
}

export function decryptPkcs8PrivateKey(
  encryptedPrivateKeyInfo: Uint8Array,
  password: string | Uint8Array,
): Uint8Array {
  const rootRead = readDer(encryptedPrivateKeyInfo, 0)
  if (rootRead.next !== encryptedPrivateKeyInfo.length || rootRead.value.tag !== 0x30) throw new Error('PKCS#8: EncryptedPrivateKeyInfo must be one DER SEQUENCE')
  const root = children(rootRead.value)
  if (root.length !== 2 || root[1]!.tag !== 0x04) throw new Error('PKCS#8: malformed EncryptedPrivateKeyInfo')
  const encryptionAlgorithm = algorithmIdentifier(root[0]!, 'encryption')
  if (decodeOid(encryptionAlgorithm[0]!) !== OID_PBES2 || encryptionAlgorithm.length !== 2) throw new Error('PKCS#8: only RFC 8018 PBES2 encryption is supported')
  const pbes2 = children(encryptionAlgorithm[1]!)
  if (encryptionAlgorithm[1]!.tag !== 0x30 || pbes2.length !== 2) throw new Error('PKCS#8: malformed PBES2 parameters')

  const kdf = algorithmIdentifier(pbes2[0]!, 'key derivation')
  if (decodeOid(kdf[0]!) !== OID_PBKDF2 || kdf.length !== 2 || kdf[1]!.tag !== 0x30) throw new Error('PKCS#8: PBES2 requires PBKDF2 parameters')
  const parameters = children(kdf[1]!)
  if (parameters.length < 2 || parameters.length > 4 || parameters[0]!.tag !== 0x04) throw new Error('PKCS#8: malformed PBKDF2 parameters')
  const salt = parameters[0]!.content
  const iterations = positiveInteger(parameters[1]!, 'PBKDF2 iteration count')
  let parameterIndex = 2
  let declaredKeyLength: number | null = null
  if (parameterIndex < parameters.length && parameters[parameterIndex]!.tag === 0x02) {
    declaredKeyLength = positiveInteger(parameters[parameterIndex++]!, 'PBKDF2 key length')
  }
  let prf: Pbkdf2Prf = 'HMAC-SHA-1'
  if (parameterIndex < parameters.length) {
    const prfAlgorithm = algorithmIdentifier(parameters[parameterIndex++]!, 'PBKDF2 PRF')
    const prfOid = decodeOid(prfAlgorithm[0]!)
    const selected = PRF_OIDS[prfOid]
    if (selected === undefined) throw new Error(`PKCS#8: unsupported PBKDF2 PRF ${prfOid}`)
    if (prfAlgorithm.length === 2 && (prfAlgorithm[1]!.tag !== 0x05 || prfAlgorithm[1]!.content.length !== 0)) {
      throw new Error('PKCS#8: PBKDF2 PRF parameters must be NULL or absent')
    }
    prf = selected
  }
  if (parameterIndex !== parameters.length) throw new Error('PKCS#8: unexpected PBKDF2 parameter')

  const cipher = algorithmIdentifier(pbes2[1]!, 'PBES2 encryption scheme')
  if (cipher.length !== 2 || cipher[1]!.tag !== 0x04) throw new Error('PKCS#8: CBC encryption scheme requires an IV OCTET STRING')
  const cipherOid = decodeOid(cipher[0]!)
  const aesKeyLength = AES_CBC_OIDS[cipherOid]
  const tripleDes = cipherOid === '1.2.840.113549.3.7'
  if (aesKeyLength === undefined && !tripleDes) throw new Error(`PKCS#8: unsupported PBES2 encryption scheme ${cipherOid}`)
  const keyLength = aesKeyLength ?? 24
  const blockLength = tripleDes ? 8 : 16
  if (declaredKeyLength !== null && declaredKeyLength !== keyLength) throw new Error('PKCS#8: PBKDF2 key length does not match the encryption scheme')
  if (cipher[1]!.content.length !== blockLength) throw new Error('PKCS#8: encryption-scheme IV has the wrong length')
  const passwordBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password
  const key = pbkdf2(passwordBytes, salt, iterations, keyLength, prf)
  const plainPadded = tripleDes
    ? tripleDesCbcDecrypt(root[1]!.content, key, cipher[1]!.content)
    : aesCbcDecryptNoPadding(root[1]!.content, key, cipher[1]!.content)
  const plain = removePkcs7Padding(plainPadded, blockLength)
  const privateKey = readDer(plain, 0)
  if (privateKey.next !== plain.length || privateKey.value.tag !== 0x30) throw new Error('PKCS#8: invalid password or malformed decrypted PrivateKeyInfo')
  return plain
}
