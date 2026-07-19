import { describe, it, expect } from 'vitest'
import {
  derSequence, derInteger, derIntegerFromNumber, derOid, derOctetString,
  derNull, derSetOfSorted, derUtcTime, derContext,
} from '../../src/pdf/der-encoder.js'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

describe('DER encoder', () => {
  it('encodes INTEGER with the DER sign-bit rule', () => {
    expect(hex(derInteger(0n))).toBe('020100')
    expect(hex(derIntegerFromNumber(127))).toBe('02017f')
    expect(hex(derIntegerFromNumber(128))).toBe('02020080') // leading 0x00
    expect(hex(derIntegerFromNumber(256))).toBe('02020100')
    expect(hex(derInteger(0x0102030405n))).toBe('02050102030405')
  })

  it('encodes OBJECT IDENTIFIER from dotted decimal', () => {
    expect(hex(derOid('1.2.840.113549.1.7.2'))).toBe('06092a864886f70d010702') // signedData
    expect(hex(derOid('2.5.4.3'))).toBe('0603550403') // commonName
    expect(hex(derOid('1.2.840.113549.1.1.11'))).toBe('06092a864886f70d01010b') // sha256WithRSA
  })

  it('encodes NULL, OCTET STRING, and long definite lengths', () => {
    expect(hex(derNull())).toBe('0500')
    expect(hex(derOctetString(new Uint8Array([0xde, 0xad])))).toBe('0402dead')
    // 200-byte content uses the 0x81 <len> long form.
    expect(hex(derOctetString(new Uint8Array(200)).subarray(0, 3))).toBe('0481c8')
  })

  it('encodes SEQUENCE and context-tagged wrappers', () => {
    expect(hex(derSequence(derIntegerFromNumber(1), derIntegerFromNumber(2)))).toBe('3006020101020102')
    expect(hex(derContext(0, derNull()))).toBe('a0020500')
  })

  it('sorts SET OF members by their full DER encoding (CMS SignedAttributes)', () => {
    const so = derSetOfSorted([
      new Uint8Array([0x03, 0x01, 0x05]),
      new Uint8Array([0x02, 0x01, 0x01]),
    ])
    expect(hex(so)).toBe('3106020101030105')
  })

  it('encodes UTCTime as YYMMDDHHMMSSZ', () => {
    const t = derUtcTime(new Date(Date.UTC(2026, 6, 11, 1, 2, 3)))
    expect(hex(t)).toBe('170d' + Buffer.from('260711010203Z', 'ascii').toString('hex'))
  })
})
