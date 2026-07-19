import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseAndVerifyOcspResponse,
  parseAndVerifyX509Crl,
  verifyX509CertificateChain,
} from '../../src/pdf/x509-validation.js'

const OPENSSL_AVAILABLE = spawnSync('openssl', ['version']).status === 0

function bytes(path: string): Uint8Array {
  const value = readFileSync(path)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

describe('X.509 path and revocation validation', () => {
  it.skipIf(!OPENSSL_AVAILABLE)('verifies an independently issued chain, OCSP response, and CRL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-x509-validation-'))
    try {
      const rootKey = join(directory, 'root.key')
      const rootPem = join(directory, 'root.pem')
      const rootDer = join(directory, 'root.der')
      const leafKey = join(directory, 'leaf.key')
      const leafCsr = join(directory, 'leaf.csr')
      const leafPem = join(directory, 'leaf.pem')
      const leafDer = join(directory, 'leaf.der')
      const crlPem = join(directory, 'ca.crl')
      const crlDer = join(directory, 'ca.crl.der')
      const ocspDer = join(directory, 'ocsp.der')
      const config = join(directory, 'ca.cnf')
      mkdirSync(join(directory, 'newcerts'))
      writeFileSync(join(directory, 'index.txt'), '')
      writeFileSync(join(directory, 'serial'), '01\n')
      writeFileSync(join(directory, 'crlnumber'), '01\n')
      writeFileSync(config, [
        '[ca]', 'default_ca = local_ca', '[local_ca]', `database = ${join(directory, 'index.txt')}`,
        `new_certs_dir = ${join(directory, 'newcerts')}`, `certificate = ${rootPem}`, `private_key = ${rootKey}`,
        `serial = ${join(directory, 'serial')}`, `crlnumber = ${join(directory, 'crlnumber')}`,
        'default_md = sha256', 'default_days = 2', 'default_crl_days = 2', 'policy = policy_any',
        'x509_extensions = leaf_extensions', '[policy_any]', 'commonName = supplied', '[leaf_extensions]',
        'basicConstraints = critical,CA:false', 'keyUsage = critical,digitalSignature',
        'subjectKeyIdentifier = hash', 'authorityKeyIdentifier = keyid,issuer',
      ].join('\n'))
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
        '-keyout', rootKey, '-out', rootPem, '-subj', '/CN=Validation Root',
        '-addext', 'basicConstraints=critical,CA:true', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' })
      execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKey,
        '-out', leafCsr, '-subj', '/CN=Validation Leaf'], { stdio: 'ignore' })
      execFileSync('openssl', ['ca', '-batch', '-config', config, '-in', leafCsr, '-out', leafPem], { stdio: 'ignore' })
      execFileSync('openssl', ['x509', '-in', rootPem, '-outform', 'DER', '-out', rootDer])
      execFileSync('openssl', ['x509', '-in', leafPem, '-outform', 'DER', '-out', leafDer])
      execFileSync('openssl', ['ca', '-config', config, '-gencrl', '-out', crlPem], { stdio: 'ignore' })
      execFileSync('openssl', ['crl', '-in', crlPem, '-outform', 'DER', '-out', crlDer])
      execFileSync('openssl', ['ocsp', '-index', join(directory, 'index.txt'), '-rsigner', rootPem,
        '-rkey', rootKey, '-CA', rootPem, '-issuer', rootPem, '-cert', leafPem,
        '-respout', ocspDer, '-ndays', '1'], { stdio: 'ignore' })

      const root = bytes(rootDer)
      const leaf = bytes(leafDer)
      const crl = bytes(crlDer)
      const ocsp = bytes(ocspDer)
      const now = new Date()
      expect(parseAndVerifyX509Crl(crl, root).revokedSerialNumbers).toEqual([])
      expect(parseAndVerifyOcspResponse(ocsp, leaf, root, now).status).toBe('good')
      const viaCrl = verifyX509CertificateChain({
        certificate: leaf, trustAnchors: [root], validationTime: now, crls: [crl],
      })
      expect(viaCrl.valid).toBe(true)
      expect(viaCrl.revocation).toEqual(['good'])
      const viaOcsp = verifyX509CertificateChain({
        certificate: leaf, trustAnchors: [root], validationTime: now, ocspResponses: [ocsp],
      })
      expect(viaOcsp.valid).toBe(true)
      expect(viaOcsp.revocation).toEqual(['good'])

      execFileSync('openssl', ['ca', '-config', config, '-revoke', leafPem], { stdio: 'ignore' })
      execFileSync('openssl', ['ca', '-config', config, '-gencrl', '-out', crlPem], { stdio: 'ignore' })
      execFileSync('openssl', ['crl', '-in', crlPem, '-outform', 'DER', '-out', crlDer])
      const revokedValidationTime = new Date()
      const revoked = verifyX509CertificateChain({
        certificate: leaf, trustAnchors: [root], validationTime: revokedValidationTime, crls: [bytes(crlDer)],
      })
      expect(revoked.valid).toBe(false)
      expect(revoked.revocation).toEqual(['revoked'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
