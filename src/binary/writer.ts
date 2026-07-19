/**
 * Binary writer (for subset output)
 * Grows the buffer dynamically
 */
export class BinaryWriter {
  private buffer: ArrayBuffer
  private view: DataView
  private pos: number

  constructor(initialCapacity = 1024) {
    this.buffer = new ArrayBuffer(initialCapacity)
    this.view = new DataView(this.buffer)
    this.pos = 0
  }

  /** Current write position */
  get position(): number {
    return this.pos
  }

  /** Set the write position */
  set position(value: number) {
    this.ensureCapacity(value)
    this.pos = value
  }

  /** Get the written data as an ArrayBuffer */
  toArrayBuffer(): ArrayBuffer {
    return this.buffer.slice(0, this.pos)
  }

  /** Get the written data as a Uint8Array */
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.pos)
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.buffer.byteLength) return
    let newSize = this.buffer.byteLength
    while (newSize < needed) {
      newSize *= 2
    }
    const newBuffer = new ArrayBuffer(newSize)
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer))
    this.buffer = newBuffer
    this.view = new DataView(this.buffer)
  }

  // --- Unsigned integers ---

  writeUint8(value: number): void {
    this.ensureCapacity(this.pos + 1)
    this.view.setUint8(this.pos, value)
    this.pos += 1
  }

  writeUint16(value: number): void {
    this.ensureCapacity(this.pos + 2)
    this.view.setUint16(this.pos, value, false) // big-endian
    this.pos += 2
  }

  writeUint32(value: number): void {
    this.ensureCapacity(this.pos + 4)
    this.view.setUint32(this.pos, value, false)
    this.pos += 4
  }

  // --- Signed integers ---

  writeInt16(value: number): void {
    this.ensureCapacity(this.pos + 2)
    this.view.setInt16(this.pos, value, false)
    this.pos += 2
  }

  writeInt32(value: number): void {
    this.ensureCapacity(this.pos + 4)
    this.view.setInt32(this.pos, value, false)
    this.pos += 4
  }

  // --- OpenType-specific types ---

  writeTag(tag: string): void {
    for (let i = 0; i < 4; i++) {
      this.writeUint8(tag.charCodeAt(i))
    }
  }

  // --- Byte sequence writing ---

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(this.pos + bytes.length)
    new Uint8Array(this.buffer, this.pos, bytes.length).set(bytes)
    this.pos += bytes.length
  }

  /** Pad to a 4-byte boundary */
  pad4(): void {
    const remainder = this.pos % 4
    if (remainder !== 0) {
      const padding = 4 - remainder
      for (let i = 0; i < padding; i++) {
        this.writeUint8(0)
      }
    }
  }
}
