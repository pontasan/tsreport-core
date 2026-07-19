/**
 * DataView-based binary reader
 * No dependency on Node.js Buffer; works in both browsers and Node.js
 * Can create zero-copy sub-readers
 */
export class BinaryReader {
  private readonly view: DataView
  private readonly baseOffset: number
  private readonly byteLength: number
  private pos: number

  constructor(buffer: ArrayBuffer, offset = 0, length?: number) {
    this.baseOffset = offset
    this.byteLength = length ?? buffer.byteLength - offset
    this.view = new DataView(buffer, offset, this.byteLength)
    this.pos = 0
  }

  /** Current read position */
  get position(): number {
    return this.pos
  }

  /** Set the read position */
  set position(value: number) {
    this.pos = value
  }

  /** Length of the data */
  get length(): number {
    return this.byteLength
  }

  /** The underlying ArrayBuffer */
  get buffer(): ArrayBuffer {
    return this.view.buffer as ArrayBuffer
  }

  /** Absolute offset within the underlying ArrayBuffer */
  get absoluteOffset(): number {
    return this.baseOffset
  }

  /** Number of remaining bytes */
  get remaining(): number {
    return this.byteLength - this.pos
  }

  /**
   * Create a zero-copy sub-reader
   * Shares the underlying ArrayBuffer and reads the specified range
   */
  subReader(offset: number, length: number): BinaryReader {
    return new BinaryReader(this.view.buffer as ArrayBuffer, this.baseOffset + offset, length)
  }

  /** Move the read position */
  seek(offset: number): void {
    this.pos = offset
  }

  /** Move the read position relatively */
  skip(bytes: number): void {
    this.pos += bytes
  }

  // --- Unsigned integers ---

  readUint8(): number {
    const val = this.view.getUint8(this.pos)
    this.pos += 1
    return val
  }

  readUint16(): number {
    const val = this.view.getUint16(this.pos, false) // big-endian
    this.pos += 2
    return val
  }

  readUint32(): number {
    const val = this.view.getUint32(this.pos, false)
    this.pos += 4
    return val
  }

  // --- Signed integers ---

  readInt8(): number {
    const val = this.view.getInt8(this.pos)
    this.pos += 1
    return val
  }

  readInt16(): number {
    const val = this.view.getInt16(this.pos, false)
    this.pos += 2
    return val
  }

  readInt32(): number {
    const val = this.view.getInt32(this.pos, false)
    this.pos += 4
    return val
  }

  // --- 64bit ---

  readInt64(): bigint {
    const val = this.view.getBigInt64(this.pos, false)
    this.pos += 8
    return val
  }

  readUint64(): bigint {
    const val = this.view.getBigUint64(this.pos, false)
    this.pos += 8
    return val
  }

  // --- OpenType-specific types ---

  /** Fixed (16.16 fixed-point) */
  readFixed(): number {
    const val = this.readInt32()
    return val / 65536
  }

  /** F2DOT14 (2.14 fixed-point) */
  readF2Dot14(): number {
    const val = this.readInt16()
    return val / 16384
  }

  /** FWord (Int16) */
  readFWord(): number {
    return this.readInt16()
  }

  /** UFWord (Uint16) */
  readUFWord(): number {
    return this.readUint16()
  }

  /** LONGDATETIME (Int64, seconds since 1904-01-01) */
  readLongDateTime(): bigint {
    return this.readInt64()
  }

  /** Tag (4-byte ASCII string) */
  readTag(): string {
    const a = this.readUint8()
    const b = this.readUint8()
    const c = this.readUint8()
    const d = this.readUint8()
    return String.fromCharCode(a, b, c, d)
  }

  // --- Byte sequence reading ---

  /** Read the specified number of bytes as a Uint8Array (copy) */
  readBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this.baseOffset + this.pos, length)
    const copy = new Uint8Array(length)
    copy.set(bytes)
    this.pos += length
    return copy
  }

  /** Read the specified number of elements as a Uint16Array (big-endian → native) */
  readUint16Array(count: number): Uint16Array {
    const arr = new Uint16Array(count)
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUint16()
    }
    return arr
  }

  /** Read the specified number of elements as an Int16Array (big-endian → native) */
  readInt16Array(count: number): Int16Array {
    const arr = new Int16Array(count)
    for (let i = 0; i < count; i++) {
      arr[i] = this.readInt16()
    }
    return arr
  }

  /** Read the specified number of elements as a Uint32Array (big-endian → native) */
  readUint32Array(count: number): Uint32Array {
    const arr = new Uint32Array(count)
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUint32()
    }
    return arr
  }

  /** Read at a given offset (does not change the position) */
  getUint8At(offset: number): number {
    return this.view.getUint8(offset)
  }

  getUint16At(offset: number): number {
    return this.view.getUint16(offset, false)
  }

  getUint32At(offset: number): number {
    return this.view.getUint32(offset, false)
  }

  getInt16At(offset: number): number {
    return this.view.getInt16(offset, false)
  }

  getInt32At(offset: number): number {
    return this.view.getInt32(offset, false)
  }

  /**
   * Read an ASCII string
   */
  readAscii(length: number): string {
    let result = ''
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.readUint8())
    }
    return result
  }

  /**
   * Read a UTF-16BE string
   */
  readUtf16Be(byteLength: number): string {
    let result = ''
    const count = byteLength >> 1
    for (let i = 0; i < count; i++) {
      result += String.fromCharCode(this.readUint16())
    }
    return result
  }
}
