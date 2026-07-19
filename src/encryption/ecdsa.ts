/**
 * ECDSA signature verification (FIPS 186-4, Section 6.4) over the NIST
 * NIST P and Brainpool curves permitted by ISO/TS 32002, using native BigInt
 * arithmetic. Used for verifying
 * PDF digital signatures; never used to produce signatures.
 *
 * Curve constants are the SEC 2 / FIPS 186-4 domain parameters (extracted
 * verbatim from `openssl ecparam -param_enc explicit`).
 */

export interface EcCurve {
  p: bigint
  a: bigint
  b: bigint
  gx: bigint
  gy: bigint
  n: bigint
  /** Field size in bytes (coordinate length in the uncompressed point) */
  size: number
}

export const EC_CURVES: Record<string, EcCurve> = {
  // P-256 / prime256v1 / secp256r1 (OID 1.2.840.10045.3.1.7)
  '1.2.840.10045.3.1.7': {
    p: 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn,
    a: 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFCn,
    b: 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604Bn,
    gx: 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296n,
    gy: 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5n,
    n: 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,
    size: 32,
  },
  // P-384 / secp384r1 (OID 1.3.132.0.34)
  '1.3.132.0.34': {
    p: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFFn,
    a: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFCn,
    b: 0xB3312FA7E23EE7E4988E056BE3F82D19181D9C6EFE8141120314088F5013875AC656398D8A2ED19D2A85C8EDD3EC2AEFn,
    gx: 0xAA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7n,
    gy: 0x3617DE4A96262C6F5D9E98BF9292DC29F8F41DBD289A147CE9DA3113B5F0B8C00A60B1CE1D7E819D7A431D7C90EA0E5Fn,
    n: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973n,
    size: 48,
  },
  // P-521 / secp521r1 (OID 1.3.132.0.35)
  '1.3.132.0.35': {
    p: 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn,
    a: 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFCn,
    b: 0x051953EB9618E1C9A1F929A21A0B68540EEA2DA725B99B315F3B8B489918EF109E156193951EC7E937B1652C0BD3BB1BF073573DF883D2C34F1EF451FD46B503F00n,
    gx: 0x0C6858E06B70404E9CD9E3ECB662395B4429C648139053FB521F828AF606B4D3DBAA14B5E77EFE75928FE1DC127A2FFA8DE3348B3C1856A429BF97E7E31C2E5BD66n,
    gy: 0x11839296A789A3BC0045C8A5FB42C7D1BD998F54449579B446817AFBD17273E662C97EE72995EF42640C550B9013FAD0761353C7086A272C24088BE94769FD16650n,
    n: 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA51868783BF2F966B7FCC0148F709A5D03BB5C9B8899C47AEBB6FB71E91386409n,
    size: 66,
  },
  // brainpoolP256r1 (OID 1.3.36.3.3.2.8.1.1.7)
  '1.3.36.3.3.2.8.1.1.7': {
    p: 0xA9FB57DBA1EEA9BC3E660A909D838D726E3BF623D52620282013481D1F6E5377n,
    a: 0x7D5A0975FC2C3057EEF67530417AFFE7FB8055C126DC5C6CE94A4B44F330B5D9n,
    b: 0x26DC5C6CE94A4B44F330B5D9BBD77CBF958416295CF7E1CE6BCCDC18FF8C07B6n,
    gx: 0x8BD2AEB9CB7E57CB2C4B482FFC81B7AFB9DE27E1E3BD23C23A4453BD9ACE3262n,
    gy: 0x547EF835C3DAC4FD97F8461A14611DC9C27745132DED8E545C1D54C72F046997n,
    n: 0xA9FB57DBA1EEA9BC3E660A909D838D718C397AA3B561A6F7901E0E82974856A7n,
    size: 32,
  },
  // brainpoolP384r1 (OID 1.3.36.3.3.2.8.1.1.11)
  '1.3.36.3.3.2.8.1.1.11': {
    p: 0x8CB91E82A3386D280F5D6F7E50E641DF152F7109ED5456B412B1DA197FB71123ACD3A729901D1A71874700133107EC53n,
    a: 0x7BC382C63D8C150C3C72080ACE05AFA0C2BEA28E4FB22787139165EFBA91F90F8AA5814A503AD4EB04A8C7DD22CE2826n,
    b: 0x04A8C7DD22CE28268B39B55416F0447C2FB77DE107DCD2A62E880EA53EEB62D57CB4390295DBC9943AB78696FA504C11n,
    gx: 0x1D1C64F068CF45FFA2A63A81B7C13F6B8847A3E77EF14FE3DB7FCAFE0CBD10E8E826E03436D646AAEF87B2E247D4AF1En,
    gy: 0x8ABE1D7520F9C2A45CB1EB8E95CFD55262B70B29FEEC5864E19C054FF99129280E4646217791811142820341263C5315n,
    n: 0x8CB91E82A3386D280F5D6F7E50E641DF152F7109ED5456B31F166E6CAC0425A7CF3AB6AF6B7FC3103B883202E9046565n,
    size: 48,
  },
  // brainpoolP512r1 (OID 1.3.36.3.3.2.8.1.1.13)
  '1.3.36.3.3.2.8.1.1.13': {
    p: 0xAADD9DB8DBE9C48B3FD4E6AE33C9FC07CB308DB3B3C9D20ED6639CCA703308717D4D9B009BC66842AECDA12AE6A380E62881FF2F2D82C68528AA6056583A48F3n,
    a: 0x7830A3318B603B89E2327145AC234CC594CBDD8D3DF91610A83441CAEA9863BC2DED5D5AA8253AA10A2EF1C98B9AC8B57F1117A72BF2C7B9E7C1AC4D77FC94CAn,
    b: 0x3DF91610A83441CAEA9863BC2DED5D5AA8253AA10A2EF1C98B9AC8B57F1117A72BF2C7B9E7C1AC4D77FC94CADC083E67984050B75EBAE5DD2809BD638016F723n,
    gx: 0x81AEE4BDD82ED9645A21322E9C4C6A9385ED9F70B5D916C1B43B62EEF4D0098EFF3B1F78E2D0D48D50D1687B93B97D5F7C6D5047406A5E688B352209BCB9F822n,
    gy: 0x7DDE385D566332ECC0EABFA9CF7822FDF209F70024A57B1AA000C55B881F8111B2DCDE494A5F485E5BCA4BD88A2763AED1CA2B2FA8F0540678CD1E0F3AD80892n,
    n: 0xAADD9DB8DBE9C48B3FD4E6AE33C9FC07CB308DB3B3C9D20ED6639CCA70330870553E5C414CA92619418661197FAC10471DB1D381085DDADDB58796829CA90069n,
    size: 64,
  },
}

interface EcPoint {
  x: bigint
  y: bigint
  /** Point at infinity flag */
  infinity: boolean
}

function mod(value: bigint, m: bigint): bigint {
  const r = value % m
  return r < 0n ? r + m : r
}

/** Modular inverse via the extended Euclidean algorithm. */
function modInverse(value: bigint, m: bigint): bigint {
  let t = 0n
  let newT = 1n
  let r = m
  let newR = mod(value, m)
  while (newR !== 0n) {
    const q = r / newR
    const tmpT = t - q * newT
    t = newT
    newT = tmpT
    const tmpR = r - q * newR
    r = newR
    newR = tmpR
  }
  if (r !== 1n) throw new Error('PDF signature error: value is not invertible')
  return mod(t, m)
}

function pointDouble(curve: EcCurve, pt: EcPoint): EcPoint {
  if (pt.infinity || pt.y === 0n) return { x: 0n, y: 0n, infinity: true }
  const lambda = mod((3n * pt.x * pt.x + curve.a) * modInverse(2n * pt.y, curve.p), curve.p)
  const x = mod(lambda * lambda - 2n * pt.x, curve.p)
  const y = mod(lambda * (pt.x - x) - pt.y, curve.p)
  return { x, y, infinity: false }
}

function pointAdd(curve: EcCurve, a: EcPoint, b: EcPoint): EcPoint {
  if (a.infinity) return b
  if (b.infinity) return a
  if (a.x === b.x) {
    if (mod(a.y + b.y, curve.p) === 0n) return { x: 0n, y: 0n, infinity: true }
    return pointDouble(curve, a)
  }
  const lambda = mod((b.y - a.y) * modInverse(b.x - a.x, curve.p), curve.p)
  const x = mod(lambda * lambda - a.x - b.x, curve.p)
  const y = mod(lambda * (a.x - x) - a.y, curve.p)
  return { x, y, infinity: false }
}

function pointMultiply(curve: EcCurve, k: bigint, pt: EcPoint): EcPoint {
  let result: EcPoint = { x: 0n, y: 0n, infinity: true }
  let addend = pt
  let scalar = k
  while (scalar > 0n) {
    if (scalar & 1n) result = pointAdd(curve, result, addend)
    addend = pointDouble(curve, addend)
    scalar >>= 1n
  }
  return result
}

/** True when (x, y) satisfies the curve equation y² = x³ + ax + b. */
function isOnCurve(curve: EcCurve, x: bigint, y: bigint): boolean {
  return mod(y * y - (x * x * x + curve.a * x + curve.b), curve.p) === 0n
}

/**
 * Verify an ECDSA signature (FIPS 186-4 6.4.2). `digest` is truncated to the
 * bit length of the curve order per the standard; `publicKey` is the
 * uncompressed point coordinates.
 */
export function verifyEcdsa(curve: EcCurve, publicX: bigint, publicY: bigint, r: bigint, s: bigint, digest: Uint8Array): boolean {
  if (r <= 0n || r >= curve.n || s <= 0n || s >= curve.n) return false
  if (!isOnCurve(curve, publicX, publicY)) return false
  // Leftmost bits of the digest, truncated to the order's bit length
  let e = 0n
  for (let i = 0; i < digest.length; i++) e = (e << 8n) | BigInt(digest[i]!)
  const digestBits = digest.length * 8
  const orderBits = curve.n.toString(2).length
  if (digestBits > orderBits) e >>= BigInt(digestBits - orderBits)
  const w = modInverse(s, curve.n)
  const u1 = mod(e * w, curve.n)
  const u2 = mod(r * w, curve.n)
  const g: EcPoint = { x: curve.gx, y: curve.gy, infinity: false }
  const q: EcPoint = { x: publicX, y: publicY, infinity: false }
  const point = pointAdd(curve, pointMultiply(curve, u1, g), pointMultiply(curve, u2, q))
  if (point.infinity) return false
  return mod(point.x, curve.n) === r
}

/**
 * Computes an ECDSA signature from an explicitly supplied nonce. Nonce
 * derivation belongs to the calling signature profile; this primitive keeps
 * the curve operation independent from a particular hash construction.
 */
export function signEcdsa(curve: EcCurve, privateScalar: bigint, digest: Uint8Array, nonce: bigint): { r: bigint, s: bigint } | null {
  if (privateScalar <= 0n || privateScalar >= curve.n) throw new Error('ECDSA private scalar is outside the curve order')
  if (nonce <= 0n || nonce >= curve.n) throw new Error('ECDSA nonce is outside the curve order')
  let e = 0n
  for (let i = 0; i < digest.length; i++) e = (e << 8n) | BigInt(digest[i]!)
  const digestBits = digest.length * 8
  const orderBits = curve.n.toString(2).length
  if (digestBits > orderBits) e >>= BigInt(digestBits - orderBits)
  const point = pointMultiply(curve, nonce, { x: curve.gx, y: curve.gy, infinity: false })
  if (point.infinity) throw new Error('ECDSA nonce produced the point at infinity')
  const r = mod(point.x, curve.n)
  if (r === 0n) return null
  const s = mod(modInverse(nonce, curve.n) * (e + r * privateScalar), curve.n)
  if (s === 0n) return null
  return { r, s }
}

/**
 * ECDH shared secret (SEC 1 / X9.63): the X coordinate of privateScalar·peer,
 * left-padded to the curve's field size. Used to derive the key-encryption key
 * for ECDH (KeyAgreeRecipientInfo) recipients in public-key-encrypted PDFs.
 */
export function ecdhSharedSecretX(curve: EcCurve, privateScalar: bigint, peerX: bigint, peerY: bigint): Uint8Array {
  if (!isOnCurve(curve, peerX, peerY)) throw new Error('PDF PubSec error: ECDH peer point is not on the curve')
  const shared = pointMultiply(curve, privateScalar, { x: peerX, y: peerY, infinity: false })
  if (shared.infinity) throw new Error('PDF PubSec error: ECDH produced the point at infinity')
  const out = new Uint8Array(curve.size)
  let value = shared.x
  for (let i = curve.size - 1; i >= 0; i--) { out[i] = Number(value & 0xFFn); value >>= 8n }
  return out
}

/** Derives the affine public point privateScalar·G for an EC key pair. */
export function deriveEcPublicPoint(curve: EcCurve, privateScalar: bigint): { x: bigint, y: bigint } {
  if (privateScalar <= 0n || privateScalar >= curve.n) throw new Error('EC private scalar is outside the curve order')
  const point = pointMultiply(curve, privateScalar, { x: curve.gx, y: curve.gy, infinity: false })
  if (point.infinity) throw new Error('EC private scalar produced the point at infinity')
  return { x: point.x, y: point.y }
}
