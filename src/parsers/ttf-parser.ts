import { BinaryReader } from '../binary/reader.js'
import type { Glyph, SfntData, ParsedTables, HeadTable } from '../types/index.js'
import { getTableReader } from './sfnt-parser.js'
import { parseHead } from './tables/head.js'
import { parseHhea } from './tables/hhea.js'
import { parseMaxp } from './tables/maxp.js'
import { parseHmtx } from './tables/hmtx.js'
import { parseOs2, syntheticOs2 } from './tables/os2.js'
import { parseName } from './tables/name.js'
import { parsePost } from './tables/post.js'
import { parseCmap } from './tables/cmap.js'
import { parseLoca } from './tables/loca.js'
import { composeGlyphPoints, composedGlyphToOutline, type GlyphPhantomPointProvider } from './tables/glyf.js'
import { parseCff, parseCffGlyph, type CffData } from './cff-parser.js'
import { parseCff2, parseCff2Glyph, type Cff2Data } from './cff2-parser.js'
import { parseKern } from './tables/kern.js'
import { parseGpos, type GposTable } from './tables/gpos.js'
import { parseGsub, type GsubTable } from './tables/gsub.js'
import { parseGdef, type GdefTable } from './tables/gdef.js'
import { parseVhea, type VheaTable } from './tables/vhea.js'
import { parseVmtx, type VmtxTable } from './tables/vmtx.js'
import { parseVorg, type VorgTable } from './tables/vorg.js'
import { parseColr, type ColrTable } from './tables/colr.js'
import { parseCpal, type CpalTable } from './tables/cpal.js'
import { parseFvar, type FvarTable } from './tables/fvar.js'
import { parseAvar, type AvarTable } from './tables/avar.js'
import { parseStat, type StatTable } from './tables/stat.js'
import { parseGvar, type GvarTable } from './tables/gvar.js'
import { parseCvar, type CvarTable } from './tables/cvar.js'
import { parseHvar, type HvarTable } from './tables/hvar.js'
import { parseVvar, type VvarTable } from './tables/vvar.js'
import { parseMvar, type MvarTable } from './tables/mvar.js'
import { parseMeta, type MetaTable } from './tables/meta.js'
import { parseSbix, type SbixTable } from './tables/sbix.js'
import { parseCbdt, type CbdtTable } from './tables/cbdt.js'
import { parseEbdt, type EbdtTable } from './tables/ebdt.js'
import { parseBase, type BaseTable } from './tables/base.js'
import { parseMath, type MathTable } from './tables/math.js'
import { parseSvg, type SvgTable } from './tables/svg.js'
import { parseDsig, type DsigTable } from './tables/dsig.js'
import { parseMerg, type MergTable } from './tables/merg.js'
import { parseJstf, type JstfTable } from './tables/jstf.js'
import { parseGasp, type GaspTable } from './tables/gasp.js'
import { parseLtsh, type LtshTable } from './tables/ltsh.js'
import { parseHdmx, type HdmxTable } from './tables/hdmx.js'
import { parsePclt, type PcltTable } from './tables/pclt.js'
import { parseVdmx, type VdmxTable } from './tables/vdmx.js'
import { parseCvt, type CvtTable } from './tables/cvt.js'
import { parseFpgm, type FpgmTable } from './tables/fpgm.js'
import { parsePrep, type PrepTable } from './tables/prep.js'
import { parseFeat, type FeatTable } from './tables/feat.js'
import { parseTrak, type TrakTable } from './tables/trak.js'
import { parseOpbd, type OpbdTable } from './tables/opbd.js'
import { parseEbsc, type EbscTable } from './tables/ebsc.js'
import { parseMorx, type MorxTable } from './tables/morx.js'
import { parseMort, type MortTable } from './tables/mort.js'
import { parseKerx, type KerxTable } from './tables/kerx.js'
import { parseAnkr, type AnkrTable } from './tables/ankr.js'
import { parseBsln, type BslnTable } from './tables/bsln.js'
import { parseJust, type JustTable } from './tables/just.js'
import { parseLcar, type LcarTable } from './tables/lcar.js'
import { parseLtag, type LtagTable } from './tables/ltag.js'
import { parseProp, type PropTable } from './tables/prop.js'
import { parseAcnt, type AcntTable } from './tables/acnt.js'
import { parseFdsc, type FdscTable } from './tables/fdsc.js'
import { parseFmtx, type FmtxTable } from './tables/fmtx.js'
import { parseGcid, type GcidTable } from './tables/gcid.js'
import { parseZapf, type ZapfTable } from './tables/zapf.js'
import { parseSilf, parseGloc, parseGlat, parseSill, parseGraphiteFeat, type SilfTable, type GlocTable, type GlatTable, type SillTable, type GraphiteFeatTable } from './tables/graphite.js'

/**
 * Manager that lazily parses SFNT font tables
 * Supports both TTF (glyf) and OTF (CFF)
 */
export class SfntTableManager {
  readonly sfnt: SfntData
  private readonly tables: ParsedTables = {}
  private cffData: CffData | null | undefined = undefined // undefined = not yet parsed, null = no CFF
  private cff2Data: Cff2Data | null | undefined = undefined // undefined = not yet parsed, null = no CFF2
  private _normalizedCoords: number[] | null = null
  readonly glyphPhantomPointProvider: GlyphPhantomPointProvider = {
    getAdvanceWidth: (glyphId: number) => this.hmtx.getAdvanceWidth(glyphId),
    getLeftSideBearing: (glyphId: number) => this.hmtx.getLsb(glyphId),
    getAdvanceHeight: (glyphId: number) => this.vmtx?.getAdvanceHeight(glyphId) ?? this.head.unitsPerEm,
    getTopSideBearing: (glyphId: number) => this.vmtx?.getTopSideBearing(glyphId) ?? 0,
  }

  constructor(sfnt: SfntData) {
    this.sfnt = sfnt
  }

  /** Sets the normalized axis coordinates */
  setNormalizedCoords(coords: number[] | null): void {
    this._normalizedCoords = coords
  }

  /** Gets the normalized axis coordinates */
  get normalizedCoords(): number[] | null {
    return this._normalizedCoords
  }

  /** Whether this is a CFF-based font (CFF1 or CFF2) */
  get isCff(): boolean {
    return this.sfnt.sfntVersion === 0x4F54544F // 'OTTO'
  }

  /** Whether the font has a CFF2 table */
  get isCff2(): boolean {
    return this.getVersionedReader('CFF2', [2], 8) !== null
  }

  private getReader(tag: string): BinaryReader {
    const reader = getTableReader(this.sfnt, tag)
    if (!reader) {
      throw new Error(`Required table '${tag}' not found`)
    }
    return reader
  }

  /** Returns a versioned table only when its major version is understood. */
  private getVersionedReader(tag: string, supportedMajorVersions: readonly number[], majorWidth: 8 | 16 = 16): BinaryReader | null {
    const reader = getTableReader(this.sfnt, tag)
    if (reader === null || reader.length < (majorWidth === 8 ? 1 : 2)) return null
    const majorVersion = majorWidth === 8 ? reader.getUint8At(0) : reader.getUint16At(0)
    return supportedMajorVersions.includes(majorVersion) ? reader : null
  }

  /** Returns a required versioned table, treating an unknown major as absent. */
  private getRequiredVersionedReader(tag: string, supportedMajorVersions: readonly number[]): BinaryReader {
    const reader = this.getVersionedReader(tag, supportedMajorVersions)
    if (reader === null) throw new Error(`Required table '${tag}' not found`)
    return reader
  }

  get head() {
    if (!this.tables.head) {
      // Bitmap-only fonts (e.g. macOS NISC18030) carry the font header in 'bhed'
      // — structurally identical to 'head' — instead of 'head'.
      const headReader = this.getVersionedReader('head', [1])
      if (headReader) {
        this.tables.head = parseHead(headReader)
      } else {
        const bhedReader = this.getVersionedReader('bhed', [1])
        if (!bhedReader) {
          throw new Error("Required table 'head' not found")
        }
        this.tables.head = parseHead(bhedReader, true)
      }
    }
    return this.tables.head
  }

  /** Whether the font carries a 'cmap' table (embedded PDF subsets often omit it). */
  get hasCmap(): boolean {
    return this.sfnt.tableDirectory.has('cmap')
  }

  /** Whether the font provides horizontal metrics ('hhea' + 'hmtx'). */
  get hasHorizontalMetrics(): boolean {
    return this.sfnt.tableDirectory.has('hhea') && this.sfnt.tableDirectory.has('hmtx')
  }

  get hhea() {
    if (!this.tables.hhea) {
      this.tables.hhea = parseHhea(this.getRequiredVersionedReader('hhea', [1]))
    }
    return this.tables.hhea
  }

  get maxp() {
    if (!this.tables.maxp) {
      this.tables.maxp = parseMaxp(this.getRequiredVersionedReader('maxp', [0, 1]))
    }
    return this.tables.maxp
  }

  get hmtx() {
    if (!this.tables.hmtx) {
      this.tables.hmtx = parseHmtx(
        this.getReader('hmtx'),
        this.hhea.numberOfHMetrics,
        this.maxp.numGlyphs,
      )
    }
    return this.tables.hmtx
  }

  get os2() {
    if (!this.tables.os2) {
      const reader = getTableReader(this.sfnt, 'OS/2')
      // Some shipping fonts (e.g. Courier, AppleGothic) omit OS/2 entirely; a
      // synthetic table lets metrics fall back to hhea and derived defaults so
      // the font still measures, embeds and renders.
      this.tables.os2 = reader ? parseOs2(reader) : syntheticOs2(this.head.macStyle)
    }
    return this.tables.os2
  }

  get name() {
    if (!this.tables.name) {
      this.tables.name = parseName(this.getReader('name'), this.cmap)
    }
    return this.tables.name
  }

  get post() {
    if (!this.tables.post) {
      const outlineKind = this.sfnt.tableDirectory.has('CFF ')
        ? 'cff1'
        : this.sfnt.tableDirectory.has('CFF2')
          ? 'cff2'
          : 'truetype'
      this.tables.post = parsePost(this.getReader('post'), {
        expectedGlyphCount: this.maxp.numGlyphs,
        outlineKind,
      })
    }
    return this.tables.post
  }

  /** PostScript name (nameId=6) */
  get postScriptName(): string {
    return this.name.getName(6) ?? ''
  }

  get cmap() {
    if (!this.tables.cmap) {
      this.tables.cmap = parseCmap(this.getReader('cmap'))
    }
    return this.tables.cmap
  }

  get loca() {
    if (!this.tables.loca) {
      const loca = parseLoca(
        this.getReader('loca'),
        this.maxp.numGlyphs,
        this.head.indexToLocFormat,
      )
      const glyf = getTableReader(this.sfnt, 'glyf')
      if (glyf !== null && loca.getOffset(loca.numGlyphs) > glyf.length) {
        throw new Error(`loca terminal offset ${loca.getOffset(loca.numGlyphs)} exceeds glyf length ${glyf.length}`)
      }
      this.tables.loca = loca
    }
    return this.tables.loca
  }

  /** kern table (optional) */
  get kern() {
    if (this.tables.kern === undefined) {
      const reader = this.getVersionedReader('kern', [0, 1])
      this.tables.kern = reader ? parseKern(reader, this.maxp.numGlyphs) : null
    }
    return this.tables.kern
  }

  private gposData: GposTable | null | undefined = undefined

  /** GPOS table (optional) */
  get gpos(): GposTable | null {
    if (this.gposData === undefined) {
      const reader = this.getVersionedReader('GPOS', [1])
      const hasFeatureVariations = reader !== null
        && reader.length >= 14
        && reader.getUint16At(0) === 1
        && reader.getUint16At(2) >= 1
        && reader.getUint32At(10) !== 0
      this.gposData = reader ? parseGpos(reader, hasFeatureVariations ? this.fvar?.axes.length : undefined) : null
    }
    return this.gposData
  }

  private gsubData: GsubTable | null | undefined = undefined

  /** GSUB table (optional) */
  get gsub(): GsubTable | null {
    if (this.gsubData === undefined) {
      const reader = this.getVersionedReader('GSUB', [1])
      const hasFeatureVariations = reader !== null
        && reader.length >= 14
        && reader.getUint16At(0) === 1
        && reader.getUint16At(2) >= 1
        && reader.getUint32At(10) !== 0
      this.gsubData = reader ? parseGsub(reader, hasFeatureVariations ? this.fvar?.axes.length : undefined) : null
    }
    return this.gsubData
  }

  private gdefData: GdefTable | null | undefined = undefined

  /** GDEF table (optional) */
  get gdef(): GdefTable | null {
    if (this.gdefData === undefined) {
      const reader = this.getVersionedReader('GDEF', [1])
      if (!reader) {
        this.gdefData = null
        return this.gdefData
      }
      const hasItemVariationStore = reader.length >= 18
        && reader.getUint16At(0) === 1
        && reader.getUint16At(2) >= 3
        && reader.getUint32At(14) !== 0
      this.gdefData = parseGdef(reader, hasItemVariationStore ? this.fvar?.axes.length : undefined)
    }
    return this.gdefData
  }

  private vheaData: VheaTable | null | undefined = undefined

  /** vhea table (optional) */
  get vhea(): VheaTable | null {
    if (this.vheaData === undefined) {
      const reader = this.getVersionedReader('vhea', [1])
      this.vheaData = reader ? parseVhea(reader) : null
    }
    return this.vheaData
  }

  private vmtxData: VmtxTable | null | undefined = undefined

  /** vmtx table (optional, requires vhea) */
  get vmtx(): VmtxTable | null {
    if (this.vmtxData === undefined) {
      const vhea = this.vhea
      if (!vhea) { this.vmtxData = null; return null }
      const reader = getTableReader(this.sfnt, 'vmtx')
      this.vmtxData = reader
        ? parseVmtx(reader, vhea.numberOfVMetrics, this.maxp.numGlyphs)
        : null
    }
    return this.vmtxData
  }

  private vorgData: VorgTable | null | undefined = undefined

  /** VORG table (optional, for CFF fonts) */
  get vorg(): VorgTable | null {
    if (this.vorgData === undefined) {
      const reader = this.getVersionedReader('VORG', [1])
      if (!reader || (!this.isCff && !this.isCff2)) {
        this.vorgData = null
      } else {
        this.vorgData = parseVorg(reader, this.maxp.numGlyphs)
      }
    }
    return this.vorgData
  }

  private colrData: ColrTable | null | undefined = undefined

  /** COLR table (optional) */
  get colr(): ColrTable | null {
    if (this.colrData === undefined) {
      const reader = getTableReader(this.sfnt, 'COLR')
      this.colrData = reader ? parseColr(reader) : null
    }
    return this.colrData
  }

  private cpalData: CpalTable | null | undefined = undefined

  /** CPAL table (optional) */
  get cpal(): CpalTable | null {
    if (this.cpalData === undefined) {
      const reader = getTableReader(this.sfnt, 'CPAL')
      this.cpalData = reader ? parseCpal(reader) : null
    }
    return this.cpalData
  }

  private fvarData: FvarTable | null | undefined = undefined

  /** fvar table (optional, Variable Fonts) */
  get fvar(): FvarTable | null {
    if (this.fvarData === undefined) {
      const reader = this.getVersionedReader('fvar', [1])
      this.fvarData = reader ? parseFvar(reader) : null
    }
    return this.fvarData
  }

  private avarData: AvarTable | null | undefined = undefined

  /** avar table (optional) */
  get avar(): AvarTable | null {
    if (this.avarData === undefined) {
      const reader = this.getVersionedReader('avar', [1])
      if (!reader) {
        this.avarData = null
        return this.avarData
      }
      const fvar = this.fvar
      if (!fvar) throw new Error("Optional table 'avar' requires table 'fvar'")
      this.avarData = parseAvar(reader, fvar.axes.length)
    }
    return this.avarData
  }

  private statData: StatTable | null | undefined = undefined

  /** STAT table (optional) */
  get stat(): StatTable | null {
    if (this.statData === undefined) {
      const reader = this.getVersionedReader('STAT', [1])
      if (!reader) {
        this.statData = null
        return this.statData
      }
      this.statData = parseStat(reader, this.fvar?.axes.length)
    }
    return this.statData
  }

  private gvarData: GvarTable | null | undefined = undefined

  /** gvar table (optional, TrueType Variable Fonts) */
  get gvar(): GvarTable | null {
    if (this.gvarData === undefined) {
      const reader = this.getVersionedReader('gvar', [1])
      if (!reader) {
        this.gvarData = null
        return this.gvarData
      }
      const fvar = this.fvar
      if (!fvar) throw new Error("Optional table 'gvar' requires table 'fvar'")
      this.gvarData = parseGvar(reader, fvar.axes.length, this.maxp.numGlyphs)
    }
    return this.gvarData
  }

  private cvarData: CvarTable | null | undefined = undefined

  /** cvar table (optional, CVT variations for TrueType variable fonts; requires fvar) */
  get cvar(): CvarTable | null {
    if (this.cvarData === undefined) {
      const reader = this.getVersionedReader('cvar', [1])
      if (!reader) {
        this.cvarData = null
        return this.cvarData
      }
      const fvar = this.fvar
      if (!fvar) throw new Error("Optional table 'cvar' requires table 'fvar'")
      this.cvarData = parseCvar(reader, fvar.axes.length)
    }
    return this.cvarData
  }

  private hvarData: HvarTable | null | undefined = undefined

  /** HVAR table (optional) */
  get hvar(): HvarTable | null {
    if (this.hvarData === undefined) {
      const reader = this.getVersionedReader('HVAR', [1])
      if (!reader) {
        this.hvarData = null
        return this.hvarData
      }
      const fvar = this.fvar
      if (!fvar) throw new Error("Optional table 'HVAR' requires table 'fvar'")
      this.hvarData = parseHvar(reader, fvar.axes.length, this.maxp.numGlyphs)
    }
    return this.hvarData
  }

  private vvarData: VvarTable | null | undefined = undefined

  /** VVAR table (optional) */
  get vvar(): VvarTable | null {
    if (this.vvarData === undefined) {
      const reader = this.getVersionedReader('VVAR', [1])
      if (!reader) {
        this.vvarData = null
        return this.vvarData
      }
      const fvar = this.fvar
      if (!fvar) throw new Error("Optional table 'VVAR' requires table 'fvar'")
      this.vvarData = parseVvar(reader, fvar.axes.length, this.maxp.numGlyphs)
    }
    return this.vvarData
  }

  private mvarData: MvarTable | null | undefined = undefined

  /** MVAR table (optional) */
  get mvar(): MvarTable | null {
    if (this.mvarData === undefined) {
      const reader = this.getVersionedReader('MVAR', [1])
      if (!reader) {
        this.mvarData = null
        return this.mvarData
      }
      const fvar = this.fvar
      if (!fvar) throw new Error("Optional table 'MVAR' requires table 'fvar'")
      this.mvarData = parseMvar(reader, fvar.axes.length)
    }
    return this.mvarData
  }

  private metaData: MetaTable | null | undefined = undefined

  /** meta table (optional) */
  get meta(): MetaTable | null {
    if (this.metaData === undefined) {
      const reader = getTableReader(this.sfnt, 'meta')
      this.metaData = reader ? parseMeta(reader) : null
    }
    return this.metaData
  }

  private gaspData: GaspTable | null | undefined = undefined

  /** gasp table (optional) */
  get gasp(): GaspTable | null {
    if (this.gaspData === undefined) {
      const reader = getTableReader(this.sfnt, 'gasp')
      this.gaspData = reader ? parseGasp(reader) : null
    }
    return this.gaspData
  }

  private ltshData: LtshTable | null | undefined = undefined

  /** LTSH table (optional) */
  get ltsh(): LtshTable | null {
    if (this.ltshData === undefined) {
      const reader = getTableReader(this.sfnt, 'LTSH')
      this.ltshData = reader ? parseLtsh(reader, this.maxp.numGlyphs) : null
    }
    return this.ltshData
  }

  private hdmxData: HdmxTable | null | undefined = undefined

  /** hdmx table (optional) */
  get hdmx(): HdmxTable | null {
    if (this.hdmxData === undefined) {
      const reader = getTableReader(this.sfnt, 'hdmx')
      this.hdmxData = reader ? parseHdmx(reader, this.maxp.numGlyphs) : null
    }
    return this.hdmxData
  }

  private pcltData: PcltTable | null | undefined = undefined

  /** PCLT table (optional) */
  get pclt(): PcltTable | null {
    if (this.pcltData === undefined) {
      const reader = this.getVersionedReader('PCLT', [1])
      this.pcltData = reader ? parsePclt(reader) : null
    }
    return this.pcltData
  }

  private vdmxData: VdmxTable | null | undefined = undefined

  /** VDMX table (optional) */
  get vdmx(): VdmxTable | null {
    if (this.vdmxData === undefined) {
      const reader = getTableReader(this.sfnt, 'VDMX')
      this.vdmxData = reader ? parseVdmx(reader) : null
    }
    return this.vdmxData
  }

  private sbixData: SbixTable | null | undefined = undefined

  /** sbix table (optional, Apple bitmap) */
  get sbix(): SbixTable | null {
    if (this.sbixData === undefined) {
      const reader = getTableReader(this.sfnt, 'sbix')
      this.sbixData = reader ? parseSbix(reader, this.maxp.numGlyphs) : null
    }
    return this.sbixData
  }

  private cbdtData: CbdtTable | null | undefined = undefined

  /** CBDT/CBLC table (optional, Google bitmap) */
  get cbdt(): CbdtTable | null {
    if (this.cbdtData === undefined) {
      const cblcReader = this.getVersionedReader('CBLC', [3])
      const cbdtReader = this.getVersionedReader('CBDT', [3])
      this.cbdtData = (cblcReader && cbdtReader) ? parseCbdt(cblcReader, cbdtReader) : null
    }
    return this.cbdtData
  }

  private ebdtData: EbdtTable | null | undefined = undefined

  /** EBDT/EBLC table (optional, legacy bitmap) */
  get ebdt(): EbdtTable | null {
    if (this.ebdtData === undefined) {
      const eblcReader = this.getVersionedReader('EBLC', [2])
      const ebdtReader = this.getVersionedReader('EBDT', [2])
      this.ebdtData = (eblcReader && ebdtReader) ? parseEbdt(eblcReader, ebdtReader) : null
    }
    return this.ebdtData
  }

  private baseData: BaseTable | null | undefined = undefined

  /** BASE table (optional) */
  get base(): BaseTable | null {
    if (this.baseData === undefined) {
      const reader = this.getVersionedReader('BASE', [1])
      if (!reader) {
        this.baseData = null
        return this.baseData
      }
      const hasItemVariationStore = reader.length >= 12
        && reader.getUint16At(0) === 1
        && reader.getUint16At(2) >= 1
        && reader.getUint32At(8) !== 0
      this.baseData = parseBase(reader, hasItemVariationStore ? this.fvar?.axes.length : undefined)
    }
    return this.baseData
  }

  private mathData: MathTable | null | undefined = undefined

  /** MATH table (optional) */
  get math(): MathTable | null {
    if (this.mathData === undefined) {
      const reader = this.getVersionedReader('MATH', [1])
      this.mathData = reader ? parseMath(reader) : null
    }
    return this.mathData
  }

  private svgData: SvgTable | null | undefined = undefined

  /** SVG table (optional) */
  get svg(): SvgTable | null {
    if (this.svgData === undefined) {
      const reader = getTableReader(this.sfnt, 'SVG ')
      this.svgData = reader ? parseSvg(reader) : null
    }
    return this.svgData
  }

  private dsigData: DsigTable | null | undefined = undefined

  /** DSIG table (optional) */
  get dsig(): DsigTable | null {
    if (this.dsigData === undefined) {
      const reader = getTableReader(this.sfnt, 'DSIG')
      this.dsigData = reader ? parseDsig(reader) : null
    }
    return this.dsigData
  }

  private mergData: MergTable | null | undefined = undefined

  /** MERG table (optional) */
  get merg(): MergTable | null {
    if (this.mergData === undefined) {
      const reader = getTableReader(this.sfnt, 'MERG')
      this.mergData = reader ? parseMerg(reader, this.maxp.numGlyphs) : null
    }
    return this.mergData
  }

  private jstfData: JstfTable | null | undefined = undefined

  /** JSTF table (optional) */
  get jstf(): JstfTable | null {
    if (this.jstfData === undefined) {
      const reader = this.getVersionedReader('JSTF', [1])
      this.jstfData = reader ? parseJstf(reader) : null
    }
    return this.jstfData
  }

  private cvtData: CvtTable | null | undefined = undefined

  /** cvt table (optional) */
  get cvt(): CvtTable | null {
    if (this.cvtData === undefined) {
      const reader = getTableReader(this.sfnt, 'cvt ')
      this.cvtData = reader ? parseCvt(reader) : null
    }
    return this.cvtData
  }

  private fpgmData: FpgmTable | null | undefined = undefined

  /** fpgm table (optional) */
  get fpgm(): FpgmTable | null {
    if (this.fpgmData === undefined) {
      const reader = getTableReader(this.sfnt, 'fpgm')
      this.fpgmData = reader ? parseFpgm(reader) : null
    }
    return this.fpgmData
  }

  private prepData: PrepTable | null | undefined = undefined

  /** prep table (optional) */
  get prep(): PrepTable | null {
    if (this.prepData === undefined) {
      const reader = getTableReader(this.sfnt, 'prep')
      this.prepData = reader ? parsePrep(reader) : null
    }
    return this.prepData
  }

  private featData: FeatTable | null | undefined = undefined

  /** feat table (optional, Apple AAT Feature Names) */
  get feat(): FeatTable | null {
    if (this.featData === undefined) {
      const reader = getTableReader(this.sfnt, 'feat')
      this.featData = reader ? parseFeat(reader) : null
    }
    return this.featData
  }

  private trakData: TrakTable | null | undefined = undefined

  /** trak table (optional, Apple AAT Tracking) */
  get trak(): TrakTable | null {
    if (this.trakData === undefined) {
      const reader = getTableReader(this.sfnt, 'trak')
      this.trakData = reader ? parseTrak(reader) : null
    }
    return this.trakData
  }

  private opbdData: OpbdTable | null | undefined = undefined

  /** opbd table (optional, Apple AAT Optical Bounds) */
  get opbd(): OpbdTable | null {
    if (this.opbdData === undefined) {
      const reader = getTableReader(this.sfnt, 'opbd')
      this.opbdData = reader ? parseOpbd(reader, this.maxp.numGlyphs) : null
    }
    return this.opbdData
  }

  private ebscData: EbscTable | null | undefined = undefined

  /** EBSC table (optional, Embedded Bitmap Scaling) */
  get ebsc(): EbscTable | null {
    if (this.ebscData === undefined) {
      const reader = this.getVersionedReader('EBSC', [2])
      this.ebscData = reader ? parseEbsc(reader) : null
    }
    return this.ebscData
  }

  private morxData: MorxTable | null | undefined = undefined

  /** morx table (optional, Apple AAT Extended Glyph Metamorphosis) */
  get morx(): MorxTable | null {
    if (this.morxData === undefined) {
      const reader = getTableReader(this.sfnt, 'morx')
      this.morxData = reader ? parseMorx(reader, this.maxp.numGlyphs) : null
    }
    return this.morxData
  }

  private mortData: MortTable | null | undefined = undefined

  /** mort table (optional, Apple AAT Legacy Glyph Metamorphosis) */
  get mort(): MortTable | null {
    if (this.mortData === undefined) {
      const reader = getTableReader(this.sfnt, 'mort')
      this.mortData = reader ? parseMort(reader, this.maxp.numGlyphs) : null
    }
    return this.mortData
  }

  private kerxData: KerxTable | null | undefined = undefined

  /** kerx table (optional, Apple AAT Extended Kerning) */
  get kerx(): KerxTable | null {
    if (this.kerxData === undefined) {
      const reader = getTableReader(this.sfnt, 'kerx')
      this.kerxData = reader ? parseKerx(reader, this.maxp.numGlyphs) : null
    }
    return this.kerxData
  }

  private ankrData: AnkrTable | null | undefined = undefined

  /** ankr table (optional, Apple AAT Anchor Points) */
  get ankr(): AnkrTable | null {
    if (this.ankrData === undefined) {
      const reader = getTableReader(this.sfnt, 'ankr')
      this.ankrData = reader ? parseAnkr(reader, this.maxp.numGlyphs) : null
    }
    return this.ankrData
  }

  private bslnData: BslnTable | null | undefined = undefined

  /** bsln table (optional, Apple AAT Baseline) */
  get bsln(): BslnTable | null {
    if (this.bslnData === undefined) {
      const reader = getTableReader(this.sfnt, 'bsln')
      this.bslnData = reader ? parseBsln(reader, this.maxp.numGlyphs) : null
    }
    return this.bslnData
  }

  private justData: JustTable | null | undefined = undefined

  /** just table (optional, Apple AAT Justification) */
  get just(): JustTable | null {
    if (this.justData === undefined) {
      const reader = getTableReader(this.sfnt, 'just')
      this.justData = reader ? parseJust(reader, this.maxp.numGlyphs) : null
    }
    return this.justData
  }

  private lcarData: LcarTable | null | undefined = undefined

  /** lcar table (optional, Apple AAT Ligature Caret) */
  get lcar(): LcarTable | null {
    if (this.lcarData === undefined) {
      const reader = getTableReader(this.sfnt, 'lcar')
      this.lcarData = reader ? parseLcar(reader, this.maxp.numGlyphs) : null
    }
    return this.lcarData
  }

  private ltagData: LtagTable | null | undefined = undefined

  /** ltag table (optional, Apple AAT Language Tags) */
  get ltag(): LtagTable | null {
    if (this.ltagData === undefined) {
      const reader = getTableReader(this.sfnt, 'ltag')
      this.ltagData = reader ? parseLtag(reader) : null
    }
    return this.ltagData
  }

  private propData: PropTable | null | undefined = undefined

  /** prop table (optional, Apple AAT Glyph Properties) */
  get prop(): PropTable | null {
    if (this.propData === undefined) {
      const reader = getTableReader(this.sfnt, 'prop')
      this.propData = reader ? parseProp(reader, this.maxp.numGlyphs) : null
    }
    return this.propData
  }

  private acntData: AcntTable | null | undefined = undefined

  /** acnt table (optional, Apple AAT Accent Attachment) */
  get acnt(): AcntTable | null {
    if (this.acntData === undefined) {
      const reader = getTableReader(this.sfnt, 'acnt')
      this.acntData = reader ? parseAcnt(reader) : null
    }
    return this.acntData
  }

  private bdatData: EbdtTable | null | undefined = undefined

  /** bdat/bloc tables (optional, Apple bitmap; same structure as EBDT/EBLC) */
  get bdat(): EbdtTable | null {
    if (this.bdatData === undefined) {
      const blocReader = getTableReader(this.sfnt, 'bloc')
      const bdatReader = getTableReader(this.sfnt, 'bdat')
      this.bdatData = (blocReader && bdatReader) ? parseEbdt(blocReader, bdatReader, true) : null
    }
    return this.bdatData
  }

  private bhedData: HeadTable | null | undefined = undefined

  /** bhed table (optional, Apple bitmap font header; same structure as head, used in place of head in bitmap-only fonts) */
  get bhed(): HeadTable | null {
    if (this.bhedData === undefined) {
      const reader = getTableReader(this.sfnt, 'bhed')
      this.bhedData = reader ? parseHead(reader, true) : null
    }
    return this.bhedData
  }

  private fdscData: FdscTable | null | undefined = undefined

  /** fdsc table (optional, Apple AAT Font Descriptors) */
  get fdsc(): FdscTable | null {
    if (this.fdscData === undefined) {
      const reader = getTableReader(this.sfnt, 'fdsc')
      this.fdscData = reader ? parseFdsc(reader) : null
    }
    return this.fdscData
  }

  private fmtxData: FmtxTable | null | undefined = undefined

  /** fmtx table (optional, Apple AAT Font Metrics) */
  get fmtx(): FmtxTable | null {
    if (this.fmtxData === undefined) {
      const reader = getTableReader(this.sfnt, 'fmtx')
      this.fmtxData = reader ? parseFmtx(reader, this.maxp.numGlyphs) : null
    }
    return this.fmtxData
  }

  private gcidData: GcidTable | null | undefined = undefined

  /** gcid table (optional, Apple AAT Glyph to CID Mapping) */
  get gcid(): GcidTable | null {
    if (this.gcidData === undefined) {
      const reader = getTableReader(this.sfnt, 'gcid')
      this.gcidData = reader ? parseGcid(reader, this.maxp.numGlyphs) : null
    }
    return this.gcidData
  }

  private zapfData: ZapfTable | null | undefined = undefined

  /** Zapf table (optional, Apple AAT Glyph Reference Information) */
  get zapf(): ZapfTable | null {
    if (this.zapfData === undefined) {
      const reader = getTableReader(this.sfnt, 'Zapf')
      this.zapfData = reader ? parseZapf(reader, this.maxp.numGlyphs) : null
    }
    return this.zapfData
  }

  private silfData: SilfTable | null | undefined = undefined

  /** Silf table (optional, SIL Graphite rules and actions) */
  get silf(): SilfTable | null {
    if (this.silfData === undefined) {
      const reader = getTableReader(this.sfnt, 'Silf')
      this.silfData = reader ? parseSilf(reader) : null
    }
    return this.silfData
  }

  private glocData: GlocTable | null | undefined = undefined

  /** Gloc table (optional, SIL Graphite glyph attribute locations) */
  get gloc(): GlocTable | null {
    if (this.glocData === undefined) {
      const reader = getTableReader(this.sfnt, 'Gloc')
      this.glocData = reader ? parseGloc(reader) : null
    }
    return this.glocData
  }

  private glatData: GlatTable | null | undefined = undefined

  /** Glat table (optional, SIL Graphite glyph attributes; requires Gloc) */
  get glat(): GlatTable | null {
    if (this.glatData === undefined) {
      const gloc = this.gloc
      if (!gloc) { this.glatData = null; return null }
      const reader = getTableReader(this.sfnt, 'Glat')
      this.glatData = reader ? parseGlat(reader, gloc) : null
    }
    return this.glatData
  }

  private sillData: SillTable | null | undefined = undefined

  /** Sill table (optional, SIL Graphite language to feature settings) */
  get sill(): SillTable | null {
    if (this.sillData === undefined) {
      const reader = getTableReader(this.sfnt, 'Sill')
      this.sillData = reader ? parseSill(reader) : null
    }
    return this.sillData
  }

  private graphiteFeatData: GraphiteFeatTable | null | undefined = undefined

  /** Feat table (optional, SIL Graphite features; tag 'Feat', distinct from the AAT 'feat') */
  get graphiteFeat(): GraphiteFeatTable | null {
    if (this.graphiteFeatData === undefined) {
      const reader = getTableReader(this.sfnt, 'Feat')
      this.graphiteFeatData = reader ? parseGraphiteFeat(reader) : null
    }
    return this.graphiteFeatData
  }

  /** Lazily parses CFF data */
  get cff(): CffData | null {
    if (this.cffData === undefined) {
      const reader = this.getVersionedReader('CFF ', [1], 8)
      if (reader) {
        this.cffData = parseCff(reader)
      } else {
        this.cffData = null
      }
    }
    return this.cffData
  }

  /** Lazily parses CFF2 data */
  get cff2(): Cff2Data | null {
    if (this.cff2Data === undefined) {
      const reader = this.getVersionedReader('CFF2', [2], 8)
      if (reader) {
        this.cff2Data = parseCff2(reader, this.fvar?.axes.length)
      } else {
        this.cff2Data = null
      }
    }
    return this.cff2Data
  }

  /**
   * Parses a glyph outline (auto-detects TTF/CFF/CFF2)
   */
  getGlyphOutline(glyphId: number): Glyph {
    if (this.isCff) {
      if (this.isCff2) {
        return this.getCff2Glyph(glyphId)
      }
      return this.getCffGlyph(glyphId)
    }
    return this.getTtfGlyph(glyphId)
  }

  private getTtfGlyph(glyphId: number): Glyph {
    const glyfReader = getTableReader(this.sfnt, 'glyf')
    if (!glyfReader) {
      throw new Error("Required table 'glyf' not found")
    }

    // Variable Font: gvar deltas are applied inside composeGlyphPoints
    // (per-point for simple glyphs, per-component offset for composites)
    const gvar = this._normalizedCoords ? this.gvar : null
    const composed = composeGlyphPoints(
      glyfReader, this.loca, glyphId, gvar, this._normalizedCoords, this.glyphPhantomPointProvider,
    )

    // USE_MY_METRICS redirects metricsGlyphId to a component glyph
    const advanceWidth = this.hmtx.getAdvanceWidth(composed.metricsGlyphId)
      + Math.round(composed.advanceWidthDelta)
    const lsb = this.hmtx.getLsb(composed.metricsGlyphId) + Math.round(composed.lsbDelta)

    const outline = composedGlyphToOutline(composed)
    return this.buildGlyph(glyphId, outline, advanceWidth, lsb)
  }

  private getCffGlyph(glyphId: number): Glyph {
    const cff = this.cff
    if (!cff) {
      throw new Error("CFF table not found in OTF font")
    }

    const { outline, width } = parseCffGlyph(cff, glyphId)
    const advanceWidth = this.hmtx.getAdvanceWidth(glyphId)
    const lsb = this.hmtx.getLsb(glyphId)
    return this.buildGlyph(glyphId, outline, advanceWidth, lsb)
  }

  private getCff2Glyph(glyphId: number): Glyph {
    const cff2 = this.cff2
    if (!cff2) {
      throw new Error("CFF2 table not found in OTF font")
    }

    const { outline, width } = parseCff2Glyph(cff2, glyphId, this._normalizedCoords)
    const advanceWidth = this.hmtx.getAdvanceWidth(glyphId)
    const lsb = this.hmtx.getLsb(glyphId)
    return this.buildGlyph(glyphId, outline, advanceWidth, lsb)
  }

  private buildGlyph(glyphId: number, outline: import('../types/index.js').GlyphOutline, advanceWidth: number, lsb: number): Glyph {
    const bounds = tightOutlineBounds(outline)
    return { glyphId, outline, advanceWidth, lsb, ...bounds }
  }
}

function tightOutlineBounds(outline: import('../types/index.js').GlyphOutline): {
  xMin: number, yMin: number, xMax: number, yMax: number
} {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  let x = 0
  let y = 0
  let coordinateIndex = 0
  const include = function (pointX: number, pointY: number): void {
    if (pointX < xMin) xMin = pointX
    if (pointX > xMax) xMax = pointX
    if (pointY < yMin) yMin = pointY
    if (pointY > yMax) yMax = pointY
  }
  for (let commandIndex = 0; commandIndex < outline.commands.length; commandIndex++) {
    const command = outline.commands[commandIndex]!
    if (command === 0 || command === 1) {
      x = outline.coords[coordinateIndex++]!
      y = outline.coords[coordinateIndex++]!
      include(x, y)
    } else if (command === 2) {
      const x1 = outline.coords[coordinateIndex++]!
      const y1 = outline.coords[coordinateIndex++]!
      const x2 = outline.coords[coordinateIndex++]!
      const y2 = outline.coords[coordinateIndex++]!
      const x3 = outline.coords[coordinateIndex++]!
      const y3 = outline.coords[coordinateIndex++]!
      const xParameters = cubicExtremaParameters(x, x1, x2, x3)
      const yParameters = cubicExtremaParameters(y, y1, y2, y3)
      for (let i = 0; i < xParameters.length; i++) {
        const parameter = xParameters[i]!
        include(cubicCoordinate(x, x1, x2, x3, parameter), cubicCoordinate(y, y1, y2, y3, parameter))
      }
      for (let i = 0; i < yParameters.length; i++) {
        const parameter = yParameters[i]!
        include(cubicCoordinate(x, x1, x2, x3, parameter), cubicCoordinate(y, y1, y2, y3, parameter))
      }
      include(x3, y3)
      x = x3
      y = y3
    }
  }
  return xMin === Infinity
    ? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
    : { xMin, yMin, xMax, yMax }
}

function cubicExtremaParameters(start: number, control1: number, control2: number, end: number): number[] {
  const a = -start + 3 * control1 - 3 * control2 + end
  const b = 2 * (start - 2 * control1 + control2)
  const c = control1 - start
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return []
    const parameter = -c / b
    return parameter > 0 && parameter < 1 ? [parameter] : []
  }
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  const first = (-b + root) / (2 * a)
  const second = (-b - root) / (2 * a)
  const result: number[] = []
  if (first > 0 && first < 1) result.push(first)
  if (second > 0 && second < 1 && Math.abs(second - first) > 1e-12) result.push(second)
  return result
}

function cubicCoordinate(start: number, control1: number, control2: number, end: number, parameter: number): number {
  const inverse = 1 - parameter
  return inverse * inverse * inverse * start
    + 3 * inverse * inverse * parameter * control1
    + 3 * inverse * parameter * parameter * control2
    + parameter * parameter * parameter * end
}

// Alias for backward compatibility
export { SfntTableManager as TtfTableManager }
