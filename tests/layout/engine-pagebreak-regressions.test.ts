import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderGroup, RenderNode, RenderPage, RenderText } from '../../src/types/render.js'
import { Font } from '../../src/font.js'
import { TextMeasurer } from '../../src/measure/text-measurer.js'
import { readFileSync } from 'node:fs'

// ─── Helpers ───

/** Returns the top-level groups (bands) directly under a page */
function topGroups(page: RenderPage): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (let i = 0; i < page.children.length; i++) {
    const child = page.children[i]!
    if (child.type === 'group') groups.push(child)
  }
  return groups
}

interface AbsText {
  text: string
  absX: number
  absY: number
  /** Top edge of the text is cut off by an enclosing clip group */
  clippedTop: boolean
  /** Bottom edge of the text is cut off by an enclosing clip group */
  clippedBottom: boolean
  /** The text is entirely outside every enclosing clip region (invisible) */
  fullyClipped: boolean
}

/** Collects text nodes with absolute page coordinates and clip visibility info */
function collectAbsTexts(
  nodes: RenderNode[],
  offsetX = 0,
  offsetY = 0,
  clipTop = Number.NEGATIVE_INFINITY,
  clipBottom = Number.POSITIVE_INFINITY,
): AbsText[] {
  const out: AbsText[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'group') {
      const gTop = offsetY + node.y
      const gBottom = gTop + node.height
      const nTop = node.clip ? Math.max(gTop, clipTop) : clipTop
      const nBottom = node.clip ? Math.min(gBottom, clipBottom) : clipBottom
      const sub = collectAbsTexts(node.children, offsetX + node.x, gTop, nTop, nBottom)
      for (let j = 0; j < sub.length; j++) out.push(sub[j]!)
      continue
    }
    if (node.type !== 'text') continue
    const t = node as RenderText
    const top = offsetY + t.y
    const bottom = top + t.fontSize * 1.2
    out.push({
      text: t.text,
      absX: offsetX + t.x,
      absY: top,
      clippedTop: top < clipTop && bottom > clipTop,
      clippedBottom: bottom > clipBottom && top < clipBottom,
      fullyClipped: bottom <= clipTop || top >= clipBottom,
    })
  }
  return out
}

/** Collects only texts that remain (at least partially) visible after clipping */
function visibleTexts(page: RenderPage): AbsText[] {
  return collectAbsTexts(page.children).filter(t => !t.fullyClipped)
}

const robotoBuf = readFileSync('tests/fixtures/fonts/Roboto-Regular.ttf')
const robotoFont = Font.load(robotoBuf.buffer.slice(robotoBuf.byteOffset, robotoBuf.byteOffset + robotoBuf.byteLength) as ArrayBuffer)
const stretchFontMap = new Map([['default', new TextMeasurer(robotoFont)]])

// ─── Tests ───

describe('改ページ回帰テスト', () => {
  // Regression: a break(page) element in the middle of a band must keep the
  // elements above the break on the current page, and start the elements below
  // the break at the top of the next page keeping their Y offset relative to
  // the break position (general banded-report semantics).
  it('バンド途中の break(page) 要素: 上の要素は現ページに残り、下の要素は次ページ先頭に break 相対Yで配置される', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 100,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 40, text: 'Before', fontSize: 8 },
            { type: 'break', x: 0, y: 50, width: 0, height: 0, breakType: 'page' },
            { type: 'staticText', x: 0, y: 60, width: 100, height: 30, text: 'After', fontSize: 8 },
          ],
        }],
      },
    }

    // Two rows to also verify that the cursor position is correct on subsequent pages
    const doc = createReport(template, { rows: [{}, {}] })
    expect(doc.pages).toHaveLength(3)

    // Page 1: only row 1's "Before" (elements above the break stay put)
    const p1 = visibleTexts(doc.pages[0]!)
    expect(p1.map(t => ({ text: t.text, y: t.absY }))).toEqual([{ text: 'Before', y: 0 }])

    // Page 2: row 1's "After" at y = 60 - 50 = 10 (relative Y from the break
    // position preserved), then row 2's "Before" below the continuation band (h=50)
    const p2 = visibleTexts(doc.pages[1]!)
    expect(p2.map(t => ({ text: t.text, y: t.absY }))).toEqual([
      { text: 'After', y: 10 },
      { text: 'Before', y: 50 },
    ])

    // Page 3: row 2's "After", again at the break-relative offset
    const p3 = visibleTexts(doc.pages[2]!)
    expect(p3.map(t => ({ text: t.text, y: t.absY }))).toEqual([{ text: 'After', y: 10 }])
  })

  // Regression: a band taller than a fresh page with splitType=prevent used to
  // be rendered past the page bottom (content lost, overlapping the pageFooter).
  // Expected: prevent only avoids the split on the first attempt; when the band
  // still cannot fit a fresh page it splits and flows, never drawing off-page.
  it('splitType=prevent でフレッシュページに収まらないバンド: ページ外に描画されず分割継続され、pageFooter と重ならない', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 150,
          splitType: 'prevent',
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'Top', fontSize: 8 },
            { type: 'staticText', x: 0, y: 70, width: 100, height: 20, text: 'OverFooter', fontSize: 8 },
            { type: 'staticText', x: 0, y: 120, width: 100, height: 20, text: 'OffPage', fontSize: 8 },
          ],
        }],
        pageFooter: {
          height: 20,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 20, text: 'FOOTER', fontSize: 8 }],
        },
      },
    }

    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages).toHaveLength(2)

    // Page 1: the segment cut snaps to the text line boundary above the
    // footer line, so "OverFooter" (a line straddling the cut) moves to
    // page 2 whole instead of being sliced in half
    const p1Groups = topGroups(doc.pages[0]!)
    const p1Band = p1Groups[0]!
    expect(p1Band.clip).toBe(true)
    expect(p1Band.y).toBe(0)
    expect(p1Band.height).toBe(70) // cut lowered to the "OverFooter" line top

    const p1 = visibleTexts(doc.pages[0]!)
    const p1Top = p1.find(t => t.text === 'Top')!
    expect(p1Top.absY).toBe(0)
    expect(p1.some(t => t.text === 'OverFooter')).toBe(false)
    expect(p1.find(t => t.text === 'FOOTER')!.absY).toBe(80)
    // "OffPage" must not appear (even clipped) below the page bottom on page 1
    expect(p1.some(t => t.text === 'OffPage')).toBe(false)

    // Page 2: the remainder continues from the snapped cut; both texts are
    // fully visible with no mid-line slicing
    const p2 = visibleTexts(doc.pages[1]!)
    const p2Over = p2.find(t => t.text === 'OverFooter')!
    expect(p2Over.absY).toBe(0) // 70 - 70 (snapped split offset)
    expect(p2Over.clippedTop).toBe(false)
    expect(p2Over.clippedBottom).toBe(false)
    const p2Off = p2.find(t => t.text === 'OffPage')!
    expect(p2Off.absY).toBe(50) // 120 - 70
    expect(p2Off.clippedTop).toBe(false)
    expect(p2Off.clippedBottom).toBe(false)
    expect(p2.find(t => t.text === 'FOOTER')!.absY).toBe(80)
  })

  // Regression: with splitType=immediate a stretchWithOverflow text field whose
  // declared box fits the remaining space but whose stretched content does not
  // used to be clipped with no continuation page -> overflowing lines lost.
  it('splitType=immediate + stretchWithOverflow: あふれた行が次ページに継続され全行が可視になる', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Line ${String(i + 1).padStart(2, '0')}`)
    const template: ReportTemplate = {
      page: { width: 180, height: 80, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 20,
          splitType: 'immediate',
          elements: [
            { type: 'textField', x: 0, y: 0, width: 160, height: 14, expression: 'field.body', stretchWithOverflow: true },
          ],
        }],
      },
    }

    const doc = createReport(template, { rows: [{ body: lines.join('\n') }] }, stretchFontMap)
    expect(doc.pages).toHaveLength(2)

    // Every line must be visible (not fully clipped) on at least one page
    const allVisible = doc.pages.flatMap(p => visibleTexts(p)).map(t => t.text)
    for (const line of lines) {
      expect(allVisible.some(v => v.includes(line)), `${line} must be visible`).toBe(true)
    }

    // Page 1 shows the leading lines starting at the band origin. The cut is
    // snapped to a line boundary, so no line is sliced across the pages.
    const p1 = visibleTexts(doc.pages[0]!)
    const p1First = p1.find(t => t.text.includes('Line 01'))!
    expect(p1First.absY).toBe(0)
    expect(p1.some(t => t.text.includes('Line 12'))).toBe(false)

    // Page 2 continues with the overflowed lines inside a clip group starting
    // at y=0; the first continuation line starts exactly at the top, unclipped
    const p2Groups = topGroups(doc.pages[1]!)
    expect(p2Groups[0]!.y).toBe(0)
    expect(p2Groups[0]!.clip).toBe(true)
    const p2 = visibleTexts(doc.pages[1]!)
    for (const line of ['Line 07', 'Line 08', 'Line 09', 'Line 10', 'Line 11', 'Line 12']) {
      expect(p2.some(t => t.text.includes(line)), `${line} must be visible on page 2`).toBe(true)
    }
    const p2First = p2.filter(t => !t.clippedTop).sort((a, b) => a.absY - b.absY)[0]!
    expect(p2First.text).toContain('Line 07')
    expect(p2First.absY).toBe(0)
    // Each line appears on exactly one page (no double-visible partial line)
    const visibleCounts = new Map<string, number>()
    for (const t of doc.pages.flatMap(page => visibleTexts(page))) {
      for (const line of lines) {
        if (t.text.includes(line)) visibleCounts.set(line, (visibleCounts.get(line) ?? 0) + 1)
      }
    }
    for (const line of lines) {
      expect(visibleCounts.get(line), `${line} must be visible exactly once`).toBe(1)
    }
    // Nothing visible past the physical page bottom
    for (const t of p2) {
      expect(t.absY).toBeLessThan(doc.pages[1]!.height)
    }
  })

  // Regression: with splitType=immediate an element straddling the split line
  // used to be moved to the next page at a negative Y inside a clip group,
  // losing its top part. Expected: the moved element is normalized so the
  // topmost moved element starts at y=0, fully visible.
  it('splitType=immediate で分割線を跨ぐ要素: 次ページで負Yにならず y=0 に正規化されて全体が可視になる', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 80,
          splitType: 'immediate',
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'Fits', fontSize: 8 },
            { type: 'staticText', x: 0, y: 5, width: 100, height: 40, text: 'Straddle', fontSize: 8 },
          ],
        }],
      },
    }

    // Row 1 fills 0..80; row 2 has 20pt left: "Fits" (bottom=10) stays,
    // "Straddle" (bottom=45 > 20) moves to the next page
    const doc = createReport(template, { rows: [{}, {}] })
    expect(doc.pages).toHaveLength(2)

    // Page 1: row 1 complete + row 2's first split part containing "Fits" at the split cursor
    const p1 = visibleTexts(doc.pages[0]!)
    expect(p1.filter(t => t.text === 'Fits').map(t => t.absY)).toEqual([0, 80])
    expect(p1.filter(t => t.text === 'Straddle').map(t => t.absY)).toEqual([5])

    // Page 2: "Straddle" fully visible at y=0 (not negative, not clipped)
    const p2 = visibleTexts(doc.pages[1]!)
    const straddle = p2.find(t => t.text === 'Straddle')!
    expect(straddle.absY).toBe(0)
    expect(straddle.clippedTop).toBe(false)
    expect(straddle.fullyClipped).toBe(false)
  })

  // Regression: layout overflow was computed against the regular pageFooter
  // height, so a taller lastPageFooter used to be stamped over content on the
  // final page. Expected: content never overlaps the last page footer; an
  // extra page is produced when needed.
  it('lastPageFooter が pageFooter より高い場合: 最終ページのコンテンツと重ならない（必要なら追加ページ）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 10, expression: 'field.n', fontSize: 8 }],
        }],
        pageFooter: {
          height: 10,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'PF', fontSize: 8 }],
        },
        lastPageFooter: {
          height: 40,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'LPF', fontSize: 8 }],
        },
      },
    }

    // 3 rows fit page 1 against the regular footer (0..90) but the last row
    // would overlap the 40pt lastPageFooter -> an extra last page is required
    const doc = createReport(template, { rows: [{ n: 'row1' }, { n: 'row2' }, { n: 'row3' }] })
    expect(doc.pages).toHaveLength(2)

    // Page 1: all rows + regular pageFooter, no overlap with the footer line (y=90)
    const p1 = visibleTexts(doc.pages[0]!)
    expect(p1.filter(t => t.text.startsWith('row')).map(t => ({ text: t.text, y: t.absY }))).toEqual([
      { text: 'row1', y: 0 },
      { text: 'row2', y: 30 },
      { text: 'row3', y: 60 },
    ])
    expect(p1.find(t => t.text === 'PF')!.absY).toBe(90)
    expect(p1.some(t => t.text === 'LPF')).toBe(false)

    // Page 2 (last): only the lastPageFooter, anchored to the page bottom
    const lastPage = doc.pages[1]!
    const p2 = visibleTexts(lastPage)
    const lpf = p2.find(t => t.text === 'LPF')!
    expect(lpf.absY).toBe(60) // 100 - 40
    const lpfBand = topGroups(lastPage).find(g => g.y === 60)!
    expect(lpfBand.height).toBe(40)
    // No detail content overlaps the lastPageFooter region (y >= 60)
    expect(p2.some(t => t.text.startsWith('row'))).toBe(false)
  })

  // Regression: the columnFooter band used to be rendered only when
  // columnCount > 1. Expected: a report always has at least one column, so the
  // columnFooter prints at the bottom of the column on every page.
  it('単一カラム(columnCount=1)でも columnFooter が毎ページ・カラム下端に描画される', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        columnHeader: {
          height: 10,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'CH', fontSize: 8 }],
        },
        columnFooter: {
          height: 10,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'CF', fontSize: 8 }],
        },
        details: [{
          height: 30,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'Detail', fontSize: 8 }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}, {}] })
    expect(doc.pages).toHaveLength(1)

    const p1 = visibleTexts(doc.pages[0]!)
    expect(p1.map(t => ({ text: t.text, y: t.absY }))).toEqual([
      { text: 'CH', y: 0 },
      { text: 'Detail', y: 10 },
      { text: 'Detail', y: 40 },
      { text: 'CF', y: 90 }, // bottom of the column (no pageFooter -> page bottom)
    ])
  })

  // Regression: group startNewPage used to be gated for the first group
  // instance, so the first group header was placed right below the title.
  // Expected: startNewPage breaks whenever the page is not fresh — including
  // the first group instance after a title band.
  it('最初のグループインスタンスでも startNewPage が機能する（title でページ消費済みの場合に改ページ）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      fields: [{ name: 'g', type: 'string' }],
      groups: [{
        name: 'grp',
        expression: 'field.g',
        startNewPage: true,
        header: {
          height: 20,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'GroupHeader', fontSize: 8 }],
        },
      }],
      bands: {
        title: {
          height: 30,
          elements: [{ type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'Title', fontSize: 8 }],
        },
        details: [{
          height: 20,
          elements: [{ type: 'textField', x: 0, y: 0, width: 100, height: 10, expression: 'field.g', fontSize: 8 }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{ g: 'A' }, { g: 'A' }, { g: 'B' }] })
    expect(doc.pages).toHaveLength(3)

    // Page 1: title only — the first group header must NOT share the title page
    const p1 = visibleTexts(doc.pages[0]!)
    expect(p1.map(t => ({ text: t.text, y: t.absY }))).toEqual([{ text: 'Title', y: 0 }])

    // Page 2: first group (A) starts at the top of a fresh page
    const p2 = visibleTexts(doc.pages[1]!)
    expect(p2.map(t => ({ text: t.text, y: t.absY }))).toEqual([
      { text: 'GroupHeader', y: 0 },
      { text: 'A', y: 20 },
      { text: 'A', y: 40 },
    ])

    // Page 3: second group (B) also starts on a fresh page
    const p3 = visibleTexts(doc.pages[2]!)
    expect(p3.map(t => ({ text: t.text, y: t.absY }))).toEqual([
      { text: 'GroupHeader', y: 0 },
      { text: 'B', y: 20 },
    ])
  })

  // Regression: isRemoveLineWhenBlank only worked for the repeated-value
  // suppression path. Expected: when printWhenExpression=false suppresses the
  // element and removeLineWhenBlank=true, its vertical strip is removed —
  // elements below shift up and the band shrinks accordingly.
  it('printWhenExpression=false + isRemoveLineWhenBlank=true: 空白ストリップが除去され下の要素が詰まりバンド高が縮む', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 40,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 100, height: 10, text: 'A', fontSize: 8 },
            { type: 'staticText', x: 0, y: 10, width: 100, height: 20, text: 'B', fontSize: 8, printWhenExpression: 'false', isRemoveLineWhenBlank: true },
            { type: 'staticText', x: 0, y: 30, width: 100, height: 10, text: 'C', fontSize: 8 },
          ],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages).toHaveLength(1)

    const p1 = visibleTexts(doc.pages[0]!)
    // B is suppressed; its 20pt strip (y=10..30) is removed so C shifts up to y=10
    expect(p1.map(t => ({ text: t.text, y: t.absY }))).toEqual([
      { text: 'A', y: 0 },
      { text: 'C', y: 10 },
    ])
    // The band shrinks from 40 to 20
    const band = topGroups(doc.pages[0]!)[0]!
    expect(band.height).toBe(20)
  })
})

// ─── Pagination float tolerance ───

describe('pagination float tolerance', () => {
  // Bands whose heights exactly fill the page carry ulp-scale float noise
  // (e.g. heights produced by proportional splitting in a designer); that
  // noise alone must never produce a page break.
  it('ページ高さぴったりのバンド構成は浮動小数点誤差で改ページしない', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        pageHeader: { height: 84.2, elements: [] },
        details: [{ height: 673.6, elements: [] }],
        // 5e-7 over the exact remainder: below the pagination tolerance
        pageFooter: { height: 84.2 + 5e-7, elements: [] },
      },
    }
    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages.length).toBe(1)
  })

  it('許容誤差を超える超過は従来どおり改ページする', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        pageHeader: { height: 84.2, elements: [] },
        details: [{ height: 673.6, elements: [] }],
        pageFooter: { height: 84.21, elements: [] },
      },
    }
    const doc = createReport(template, { rows: [{}] })
    expect(doc.pages.length).toBe(2)
  })
})
