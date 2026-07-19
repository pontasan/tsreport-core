import { describe, expect, it } from 'vitest'
import { identityPdfCMap, parsePdfCMap } from '../../src/pdf/pdf-cmap.js'

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('PDF CMap execution', () => {
  it('executes 1-to-4-byte code spaces, CID mappings, notdef mappings, Unicode mappings, and WMode', () => {
    const cmap = parsePdfCMap(encode(`
      /WMode 1 def
      4 begincodespacerange
      <00> <7F>
      <8100> <81FF>
      <820000> <82FFFF>
      <83000000> <83FFFFFF>
      endcodespacerange
      1 begincidchar <41> 5 endcidchar
      1 begincidrange <8100> <8101> 10 endcidrange
      1 beginnotdefchar <820001> 99 endnotdefchar
      1 beginnotdefrange <83000000> <830000FF> 77 endnotdefrange
      2 beginbfchar <41> <0041> <820001> <03A9> endbfchar
      2 beginbfrange
      <8100> <8101> <0061>
      <83000000> <83000001> [<0063> <0064>]
      endbfrange
    `))

    const bytes = new Uint8Array([0x41, 0x81, 0x00, 0x81, 0x01, 0x82, 0x00, 0x01, 0x83, 0, 0, 1])
    const codes = cmap.decode(bytes)
    expect(codes.map(code => code.length)).toEqual([1, 2, 2, 3, 4])
    expect(codes.map(code => cmap.cid(code))).toEqual([5, 10, 11, 99, 77])
    expect(codes.map(code => cmap.unicode(code))).toEqual(['A', 'a', 'b', 'Ω', 'd'])
    expect(cmap.wMode).toBe(1)
  })

  it('inherits mappings and lets a child CMap override them', () => {
    const parent = parsePdfCMap(encode(`
      1 begincodespacerange <00> <FF> endcodespacerange
      1 begincidchar <41> 1 endcidchar
      1 beginbfchar <41> <0041> endbfchar
    `))
    const child = parsePdfCMap(encode(`
      1 begincidchar <41> 2 endcidchar
      1 beginbfchar <41> <0042> endbfchar
    `), parent)
    const code = child.decode(new Uint8Array([0x41]))[0]!
    expect(child.cid(code)).toBe(2)
    expect(child.unicode(code)).toBe('B')
  })

  it('resolves an in-stream usecmap base by name', () => {
    const child = parsePdfCMap(encode(`
      /Identity-H usecmap
      1 begincidchar <0041> 7 endcidchar
    `), null, name => {
      expect(name).toBe('Identity-H')
      return identityPdfCMap(false)
    })
    const code = child.decode(new Uint8Array([0, 0x41]))[0]!
    expect(child.cid(code)).toBe(7)
  })

  it('rejects malformed code spaces and byte sequences outside them', () => {
    expect(() => parsePdfCMap(encode('1 begincodespacerange <00> <FF>'))).toThrow(/endcodespacerange/)
    expect(() => parsePdfCMap(encode(`
      2 begincodespacerange <00> <7F> <70> <FF> endcodespacerange
    `))).toThrow(/overlapping code-space/)
    expect(() => identityPdfCMap(false).decode(new Uint8Array([0x00]))).toThrow(/outside every code-space/)
  })
})
