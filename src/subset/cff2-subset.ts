import { BinaryWriter } from '../binary/writer.js'
import { getCff2IndexEntry, type Cff2Data, type Cff2Index } from '../parsers/cff2-parser.js'
import { encodeDictReal } from './cff-subset.js'

/** Rebuilds CFF2 with stable GIDs while making excluded CharStrings empty. */
export function buildStableCff2Subset(cff2: Cff2Data, includedGlyphIds: ReadonlySet<number>): Uint8Array {
  const charstrings = new Array<Uint8Array>(cff2.charstrings.count)
  for (let glyphId = 0; glyphId < charstrings.length; glyphId++) {
    charstrings[glyphId] = includedGlyphIds.has(glyphId)
      ? copyIndexEntry(cff2.charstrings, glyphId)
      : new Uint8Array(0)
  }
  const globalSubrs = indexItems(cff2.globalSubrs)
  const globalSubrSize = cff2IndexSize(globalSubrs)
  const charstringSize = cff2IndexSize(charstrings)
  const variationStore = cff2.variationStoreReader === null ? null : copyReader(cff2.variationStoreReader)
  const fdSelectSize = cff2.fdArray.length === 1 ? 0 : 1 + cff2.charstrings.count
  const fontDictItems = cff2.fdArray.map(function () { return new Uint8Array(11) })
  const fontDictIndexSize = cff2IndexSize(fontDictItems)

  const topDictSize = (cff2.fontMatrix === null ? 0 : cff2.fontMatrix.reduce(function (size, value) {
    return size + encodeDictReal(value).length
  }, 2)) + 6 + (variationStore === null ? 0 : 6) + 7 + (fdSelectSize === 0 ? 0 : 7)
  const globalSubrOffset = 5 + topDictSize
  const variationStoreOffset = variationStore === null ? 0 : globalSubrOffset + globalSubrSize
  const charstringOffset = globalSubrOffset + globalSubrSize + (variationStore?.length ?? 0)
  const fdSelectOffset = fdSelectSize === 0 ? 0 : charstringOffset + charstringSize
  const fontDictOffset = charstringOffset + charstringSize + fdSelectSize
  let privateOffset = fontDictOffset + fontDictIndexSize

  const privateSections: Uint8Array[] = []
  for (let fdIndex = 0; fdIndex < cff2.fdArray.length; fdIndex++) {
    const fd = cff2.fdArray[fdIndex]!
    const privateDict = copyReader(fd.privateDictReader)
    const subrItems = indexItems(fd.localSubrs)
    const subrOffset = fd.privateDictEntries.get(19)?.[0]
    let sectionLength = privateDict.length
    if (subrOffset !== undefined) sectionLength = Math.max(sectionLength, subrOffset + cff2IndexSize(subrItems))
    const section = new Uint8Array(sectionLength)
    section.set(privateDict)
    if (subrOffset !== undefined) section.set(serializeCff2Index(subrItems), subrOffset)
    privateSections.push(section)

    const fontDict = new BinaryWriter(11)
    fontDict.writeBytes(encodeDictInt32(privateDict.length))
    fontDict.writeBytes(encodeDictInt32(privateDict.length === 0 ? 0 : privateOffset))
    fontDict.writeUint8(18)
    fontDictItems[fdIndex] = fontDict.toUint8Array().slice()
    privateOffset += section.length
  }

  const topDict = new BinaryWriter(topDictSize)
  if (cff2.fontMatrix !== null) {
    for (let i = 0; i < cff2.fontMatrix.length; i++) topDict.writeBytes(encodeDictReal(cff2.fontMatrix[i]!))
    topDict.writeUint8(12)
    topDict.writeUint8(7)
  }
  topDict.writeBytes(encodeDictInt32(charstringOffset))
  topDict.writeUint8(17)
  if (variationStore !== null) {
    topDict.writeBytes(encodeDictInt32(variationStoreOffset))
    topDict.writeUint8(24)
  }
  topDict.writeBytes(encodeDictInt32(fontDictOffset))
  topDict.writeUint8(12)
  topDict.writeUint8(36)
  if (fdSelectSize !== 0) {
    topDict.writeBytes(encodeDictInt32(fdSelectOffset))
    topDict.writeUint8(12)
    topDict.writeUint8(37)
  }

  const writer = new BinaryWriter(privateOffset)
  writer.writeUint8(2)
  writer.writeUint8(0)
  writer.writeUint8(5)
  writer.writeUint16(topDict.position)
  writer.writeBytes(topDict.toUint8Array().slice())
  writer.writeBytes(serializeCff2Index(globalSubrs))
  if (variationStore !== null) writer.writeBytes(variationStore)
  writer.writeBytes(serializeCff2Index(charstrings))
  if (fdSelectSize !== 0) {
    writer.writeUint8(0)
    for (let glyphId = 0; glyphId < cff2.charstrings.count; glyphId++) writer.writeUint8(cff2.fdSelect![glyphId]!)
  }
  writer.writeBytes(serializeCff2Index(fontDictItems))
  for (let i = 0; i < privateSections.length; i++) writer.writeBytes(privateSections[i]!)
  return writer.toUint8Array().slice()
}

function indexItems(index: Cff2Index): Uint8Array[] {
  const items = new Array<Uint8Array>(index.count)
  for (let i = 0; i < index.count; i++) items[i] = copyIndexEntry(index, i)
  return items
}

function copyIndexEntry(index: Cff2Index, itemIndex: number): Uint8Array {
  return copyReader(getCff2IndexEntry(index, itemIndex))
}

function copyReader(reader: { readonly length: number, getUint8At(offset: number): number }): Uint8Array {
  const bytes = new Uint8Array(reader.length)
  for (let i = 0; i < bytes.length; i++) bytes[i] = reader.getUint8At(i)
  return bytes
}

function cff2IndexSize(items: readonly Uint8Array[]): number {
  if (items.length === 0) return 4
  let dataLength = 0
  for (let i = 0; i < items.length; i++) dataLength += items[i]!.length
  const offSize = dataLength + 1 <= 0xFF ? 1 : dataLength + 1 <= 0xFFFF ? 2 : dataLength + 1 <= 0xFFFFFF ? 3 : 4
  return 5 + (items.length + 1) * offSize + dataLength
}

function serializeCff2Index(items: readonly Uint8Array[]): Uint8Array {
  const writer = new BinaryWriter(cff2IndexSize(items))
  writer.writeUint32(items.length)
  if (items.length === 0) return writer.toUint8Array().slice()
  let dataLength = 0
  for (let i = 0; i < items.length; i++) dataLength += items[i]!.length
  const offSize = dataLength + 1 <= 0xFF ? 1 : dataLength + 1 <= 0xFFFF ? 2 : dataLength + 1 <= 0xFFFFFF ? 3 : 4
  writer.writeUint8(offSize)
  let offset = 1
  for (let i = 0; i <= items.length; i++) {
    writeOffset(writer, offset, offSize)
    if (i < items.length) offset += items[i]!.length
  }
  for (let i = 0; i < items.length; i++) writer.writeBytes(items[i]!)
  return writer.toUint8Array().slice()
}

function writeOffset(writer: BinaryWriter, value: number, size: number): void {
  for (let shift = (size - 1) * 8; shift >= 0; shift -= 8) writer.writeUint8(value >>> shift & 0xFF)
}

function encodeDictInt32(value: number): Uint8Array {
  return new Uint8Array([29, value >>> 24 & 0xFF, value >>> 16 & 0xFF, value >>> 8 & 0xFF, value & 0xFF])
}
