import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../../../src/index.js'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseFvar } from '../../../src/parsers/tables/fvar.js'

const VF_PATH = resolve(__dirname, '../../fixtures/fonts/NotoSans-VariableFont_wdth,wght.ttf')

interface TestAxis {
  tag: string
  min: number
  def: number
  max: number
  flags?: number
  nameId?: number
}

interface TestInstance {
  subfamilyNameId?: number
  flags?: number
  coordinates: number[]
  postScriptNameId?: number
}

function buildFvar(
  axes: TestAxis[],
  instances: TestInstance[],
  options: {
    majorVersion?: number
    minorVersion?: number
    countSizePairs?: number
    axisCount?: number
    axisSize?: number
    instanceCount?: number
    instanceSize?: number
    axesArrayOffset?: number
    extraBytes?: number
  } = {},
): ArrayBuffer {
  const axisSize = options.axisSize ?? 20
  const axisCount = options.axisCount ?? axes.length
  const hasPostScriptName = instances.some(instance => instance.postScriptNameId !== undefined)
  const instanceSize = options.instanceSize ?? (4 + axisCount * 4 + (hasPostScriptName ? 2 : 0))
  const instanceCount = options.instanceCount ?? instances.length
  const axesArrayOffset = options.axesArrayOffset ?? 16
  const size = axesArrayOffset + axes.length * axisSize + instances.length * instanceSize + (options.extraBytes ?? 0)
  const buf = new ArrayBuffer(size)
  const view = new DataView(buf)
  let pos = 0

  view.setUint16(pos, options.majorVersion ?? 1); pos += 2
  view.setUint16(pos, options.minorVersion ?? 0); pos += 2
  view.setUint16(pos, axesArrayOffset); pos += 2
  view.setUint16(pos, options.countSizePairs ?? 2); pos += 2
  view.setUint16(pos, axisCount); pos += 2
  view.setUint16(pos, axisSize); pos += 2
  view.setUint16(pos, instanceCount); pos += 2
  view.setUint16(pos, instanceSize); pos += 2

  pos = axesArrayOffset
  for (const axis of axes) {
    const axisStart = pos
    writeTag(view, pos, axis.tag); pos += 4
    writeFixed(view, pos, axis.min); pos += 4
    writeFixed(view, pos, axis.def); pos += 4
    writeFixed(view, pos, axis.max); pos += 4
    view.setUint16(pos, axis.flags ?? 0); pos += 2
    view.setUint16(pos, axis.nameId ?? 256); pos += 2
    pos = axisStart + axisSize
  }

  for (const instance of instances) {
    const instanceStart = pos
    view.setUint16(pos, instance.subfamilyNameId ?? 258); pos += 2
    view.setUint16(pos, instance.flags ?? 0); pos += 2
    for (const coordinate of instance.coordinates) {
      writeFixed(view, pos, coordinate); pos += 4
    }
    if (instanceSize > 4 + axisCount * 4) {
      view.setUint16(pos, instance.postScriptNameId ?? 262); pos += 2
    }
    pos = instanceStart + instanceSize
  }

  return buf
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i))
}

function writeFixed(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, Math.round(value * 65536))
}

describe('fvar テーブル (Variable Fonts)', () => {
  it('should parse synthetic axes and named instances', () => {
    const table = parseFvar(new BinaryReader(buildFvar(
      [
        { tag: 'wght', min: 100, def: 400, max: 900, flags: 1, nameId: 256 },
        { tag: 'wdth', min: 50, def: 100, max: 150, nameId: 257 },
      ],
      [
        { subfamilyNameId: 258, coordinates: [400, 100], postScriptNameId: 262 },
        { subfamilyNameId: 259, coordinates: [700, 75], postScriptNameId: 263 },
      ],
    )))

    expect(table.axes).toHaveLength(2)
    expect(table.axes[0]).toMatchObject({ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900, flags: 1, axisNameId: 256 })
    expect(table.getAxisIndex('wdth')).toBe(1)
    expect(table.instances).toHaveLength(2)
    expect(table.instances[1]!.coordinates.get('wght')).toBe(700)
    expect(table.instances[1]!.coordinates.get('wdth')).toBe(75)
    expect(table.instances[1]!.postScriptNameId).toBe(263)
  })

  it('should reject malformed fvar headers and record sizes', () => {
    expect(() => parseFvar(new BinaryReader(new ArrayBuffer(15)))).toThrow(/length/)
    expect(() => parseFvar(new BinaryReader(buildFvar([], [], { majorVersion: 2, axisCount: 0 })))).toThrow(/Unsupported fvar/)
    expect(() => parseFvar(new BinaryReader(buildFvar([], [], { minorVersion: 1, axisCount: 0 })))).toThrow(/axisCount/)
    expect(() => parseFvar(new BinaryReader(buildFvar([], [], { countSizePairs: 1, axisCount: 0 })))).toThrow(/countSizePairs/)
    expect(() => parseFvar(new BinaryReader(buildFvar([], [], { axisCount: 0 })))).toThrow(/axisCount/)
    expect(() => parseFvar(new BinaryReader(buildFvar([], [], { axisCount: 1, axisSize: 18 })))).toThrow(/axisSize/)
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: 'wght', min: 100, def: 400, max: 900 }], [], { instanceSize: 7 })))).toThrow(/instanceSize/)
    expect(() => parseFvar(new BinaryReader(buildFvar([], [], { axisCount: 1, axesArrayOffset: 15, extraBytes: 1 })))).toThrow(/axesArrayOffset/)
  })

  it('should reject fvar table length mismatches', () => {
    expect(() => parseFvar(new BinaryReader(buildFvar(
      [{ tag: 'wght', min: 100, def: 400, max: 900 }],
      [],
      { axisCount: 2 },
    )))).toThrow(/axes array/)

    expect(() => parseFvar(new BinaryReader(buildFvar(
      [{ tag: 'wght', min: 100, def: 400, max: 900 }],
      [],
      { extraBytes: 2 },
    )))).toThrow(/table length/)
  })

  it('should reject invalid variation axes', () => {
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: '1ght', min: 100, def: 400, max: 900 }], [])))).toThrow(/begin/)
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: 'w ht', min: 100, def: 400, max: 900 }], [])))).toThrow(/trailing/)
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: 'w-ht', min: 100, def: 400, max: 900 }], [])))).toThrow(/letters/)
    expect(() => parseFvar(new BinaryReader(buildFvar([
      { tag: 'wght', min: 100, def: 400, max: 900 },
      { tag: 'wght', min: 100, def: 400, max: 900 },
    ], [])))).toThrow(/unique/)
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: 'wght', min: 400, def: 100, max: 900 }], [])))).toThrow(/min <= default <= max/)
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: 'wght', min: 100, def: 400, max: 900, flags: 2 }], [])))).toThrow(/reserved bits/)
    expect(() => parseFvar(new BinaryReader(buildFvar([{ tag: 'wght', min: 100, def: 400, max: 900, nameId: 255 }], [])))).toThrow(/axisNameID/)
  })

  it('should reject invalid named instances', () => {
    const axis = { tag: 'wght', min: 100, def: 400, max: 900 }
    expect(() => parseFvar(new BinaryReader(buildFvar([axis], [{ subfamilyNameId: 18, coordinates: [400] }])))).toThrow(/subfamilyNameID/)
    expect(() => parseFvar(new BinaryReader(buildFvar([axis], [{ flags: 1, coordinates: [400] }])))).toThrow(/flags/)
    expect(() => parseFvar(new BinaryReader(buildFvar([axis], [{ coordinates: [950] }])))).toThrow(/coordinate/)
    expect(() => parseFvar(new BinaryReader(buildFvar([axis], [{ coordinates: [400], postScriptNameId: 18 }])))).toThrow(/postScriptNameID/)
  })

  // Verifies that loading a real variable font (fvar table present) sets Font.isVariable to true.
  it.skipIf(!existsSync(VF_PATH))('NotoSans Variable Font は isVariable === true', () => {
    const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)
    expect(font.isVariable).toBe(true)
  })

  // Verifies that variationAxes exposes the wght/wdth axis records with consistent min <= default <= max ranges.
  it.skipIf(!existsSync(VF_PATH))('軸定義を読み取れる', () => {
    const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const axes = font.variationAxes
    expect(axes.length).toBeGreaterThanOrEqual(2)

    // wght axis
    const wghtAxis = axes.find(a => a.tag === 'wght')
    expect(wghtAxis).toBeDefined()
    expect(wghtAxis!.minValue).toBeLessThan(wghtAxis!.maxValue)
    expect(wghtAxis!.defaultValue).toBeGreaterThanOrEqual(wghtAxis!.minValue)
    expect(wghtAxis!.defaultValue).toBeLessThanOrEqual(wghtAxis!.maxValue)
    // Typically wght: min=100, default=400, max=900
    expect(wghtAxis!.minValue).toBeLessThanOrEqual(400)
    expect(wghtAxis!.maxValue).toBeGreaterThanOrEqual(700)

    // wdth axis
    const wdthAxis = axes.find(a => a.tag === 'wdth')
    expect(wdthAxis).toBeDefined()
    expect(wdthAxis!.minValue).toBeLessThan(wdthAxis!.maxValue)
  })

  // Verifies that fvar named instances are exposed, each with axis coordinates and a valid subfamily name ID.
  it.skipIf(!existsSync(VF_PATH))('名前付きインスタンスが存在する', () => {
    const buffer = readFileSync(VF_PATH).buffer as ArrayBuffer
    const font = Font.load(buffer)

    const instances = font.namedInstances
    expect(instances.length).toBeGreaterThan(0)

    // Each instance carries axis coordinate values
    for (const inst of instances) {
      expect(inst.coordinates.size).toBeGreaterThan(0)
      expect(inst.subfamilyNameId).toBeGreaterThan(0)
    }

    const selected = instances[Math.min(2, instances.length - 1)]!
    font.setNamedInstance(Math.min(2, instances.length - 1))
    expect(font.variationCoordinates).toEqual(Object.fromEntries(selected.coordinates))
    expect(font.getNamedInstanceName(0)).not.toBeNull()
    if (instances[0]!.postScriptNameId !== undefined && instances[0]!.postScriptNameId !== 0xFFFF) {
      expect(font.getNamedInstancePostScriptName(0)).not.toBeNull()
    }
    expect(() => font.setNamedInstance(instances.length)).toThrow(/out of range/)
  })

  // Verifies that a static font (no fvar table) reports isVariable=false with empty axes and instances.
  it.skipIf(!existsSync(VF_PATH))('非 Variable Font は isVariable === false', () => {
    const robotoPath = resolve(__dirname, '../../fixtures/fonts/Roboto-Regular.ttf')
    const buffer = readFileSync(robotoPath).buffer as ArrayBuffer
    const font = Font.load(buffer)

    expect(font.isVariable).toBe(false)
    expect(font.variationAxes).toEqual([])
    expect(font.namedInstances).toEqual([])
  })
})
