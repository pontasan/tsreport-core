import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

function topGroups(page: import('../../src/types/render.js').RenderPage): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (let i = 0; i < page.children.length; i++) {
    const child = page.children[i]!
    if (child.type === 'group') groups.push(child)
  }
  return groups
}

function findTexts(page: import('../../src/types/render.js').RenderPage): RenderText[] {
  const texts: RenderText[] = []
  function walk(nodes: import('../../src/types/render.js').RenderNode[]) {
    for (const n of nodes) {
      if (n.type === 'text') texts.push(n)
      if (n.type === 'group') walk(n.children)
    }
  }
  walk(page.children)
  return texts
}

// ─── Tests ───

// Group footerPosition placement: normal (inline), stackAtBottom, forceAtBottom, collateAtBottom.
describe('footerPosition', () => {
  const baseTemplate = (footerPosition: 'normal' | 'stackAtBottom' | 'forceAtBottom' | 'collateAtBottom'): ReportTemplate => ({
    page: {
      width: 200, height: 300,
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
    },
    groups: [{
      name: 'g1',
      expression: 'field.group',
      footerPosition,
      header: {
        height: 20,
        elements: [{ type: 'staticText', text: 'GH', x: 0, y: 0, width: 100, height: 20 }],
      },
      footer: {
        height: 30,
        elements: [{ type: 'staticText', text: 'GF', x: 0, y: 0, width: 100, height: 30 }],
      },
    }],
    bands: {
      details: [{
        height: 20,
        elements: [{ type: 'staticText', text: 'D', x: 0, y: 0, width: 100, height: 20 }],
      }],
    },
  })

  // Verifies that footerPosition=normal places the group footer inline right after the last detail.
  it('normal: グループフッターはインライン（通常位置）に配置される', () => {
    const doc = createReport(baseTemplate('normal'), {
      rows: [{ group: 'A' }, { group: 'A' }],
    })
    expect(doc.pages.length).toBe(1)
    const groups = topGroups(doc.pages[0]!)
    // Header(y=10) + Detail1 + Detail2 + Footer (inline)
    // Header y=10, h=20 -> Detail1 y=30 -> Detail2 y=50 -> Footer y=70
    expect(groups[0]!.y).toBe(10) // header
    expect(groups[1]!.y).toBe(30) // detail 1
    expect(groups[2]!.y).toBe(50) // detail 2
    expect(groups[3]!.y).toBe(70) // footer (inline)
  })

  // Verifies that footerPosition=stackAtBottom pushes the group footer to the bottom of the page.
  it('stackAtBottom: グループフッターがページ下部に配置される', () => {
    const doc = createReport(baseTemplate('stackAtBottom'), {
      rows: [{ group: 'A' }, { group: 'A' }],
    })
    expect(doc.pages.length).toBe(1)
    const groups = topGroups(doc.pages[0]!)
    // contentBottom = 300 - 10 = 290
    // Footer (h=30) at bottom: y = 290 - 30 = 260
    const footer = groups[groups.length - 1]!
    expect(footer.y).toBe(260)
  })

  // Verifies that forceAtBottom consumes remaining page space so the next group starts on a new page.
  it('forceAtBottom: フッター後に改ページ発生（一般的な帳票動作）', () => {
    // Single group A -> B: the A footer consumes all remaining space, so B moves to the next page
    const doc = createReport(baseTemplate('forceAtBottom'), {
      rows: [{ group: 'A' }, { group: 'A' }, { group: 'B' }, { group: 'B' }],
    })
    // A: bottom of page 1, B: bottom of page 2
    expect(doc.pages.length).toBe(2)
    const p1Footer = topGroups(doc.pages[0]!).pop()!
    expect(p1Footer.y).toBe(260) // 290 - 30 = 260
    const p2Footer = topGroups(doc.pages[1]!).pop()!
    expect(p2Footer.y).toBe(260)
  })

  // Verifies that an inner forceAtBottom promotes the outer stackAtBottom footer to FORCE, moving it to its own page.
  it('forceAtBottom: ネストされたグループで外側フッターが独立ページに強制移動', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 300,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      groups: [
        {
          name: 'outer',
          expression: 'field.outer',
          footerPosition: 'stackAtBottom',
          header: { height: 20, elements: [{ type: 'staticText', text: 'OH', x: 0, y: 0, width: 100, height: 20 }] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'OF', x: 0, y: 0, width: 100, height: 20 }] },
        },
        {
          name: 'inner',
          expression: 'field.inner',
          footerPosition: 'forceAtBottom',
          header: { height: 20, elements: [] },
          footer: { height: 30, elements: [{ type: 'staticText', text: 'IF', x: 0, y: 0, width: 100, height: 30 }] },
        },
      ],
      bands: {
        details: [{ height: 20, elements: [] }],
      },
    }

    // Per common report behavior: masterFooterPosition=FORCE promotes outer=stackAtBottom to FORCE as well
    // so the outer footer also consumes all space at offsetY=columnFooterOffsetY -> its own page
    const rows = [
      { outer: 'A', inner: 'X' },
      { outer: 'A', inner: 'X' },
    ]
    const doc = createReport(template, { rows })

    // Page 1: inner footer at bottom, page 2: outer footer at bottom (isolated)
    expect(doc.pages.length).toBe(2)

    // Page 1: inner footer is at the bottom of the page
    const p1Texts = findTexts(doc.pages[0]!)
    expect(p1Texts.filter(t => t.text === 'IF').length).toBe(1)

    // Page 2: outer footer only (masterFooterPosition=FORCE consumes all space)
    const p2Texts = findTexts(doc.pages[1]!)
    expect(p2Texts.filter(t => t.text === 'OF').length).toBe(1)
  })

  // Verifies that collateAtBottom with a single group is cancelled (master=NORMAL) and renders inline.
  it('collateAtBottom: 単一グループではインライン配置（一般的な帳票動作: master=NORMAL でキャンセル）', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      groups: [{
        name: 'g1',
        expression: 'field.group',
        footerPosition: 'collateAtBottom',
        header: { height: 20, elements: [] },
        footer: {
          height: 30,
          elements: [{ type: 'staticText', text: 'COLLATE', x: 0, y: 0, width: 100, height: 30 }],
        },
      }],
      bands: {
        details: [{ height: 20, elements: [] }],
      },
    }

    // Per common report behavior: collateAtBottom on a single group leaves master=NORMAL (COLLATE never changes master)
    // -> effective=NORMAL -> inline placement (same behavior as normal)
    const rows = [
      { group: 'A' }, { group: 'A' },
      { group: 'B' }, { group: 'B' },
    ]
    const doc = createReport(template, { rows })

    // Footers appear inline on every page
    expect(doc.pages.length).toBe(1) // all data fits on one page (inline)
    const texts = findTexts(doc.pages[0]!)
    const collateTexts = texts.filter(t => t.text === 'COLLATE')
    expect(collateTexts.length).toBe(2) // A footer + B footer
  })

  // Verifies that a stacked group footer is placed directly above the page footer.
  it('stackAtBottom + pageFooter: グループフッターはページフッターの上に配置', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 300,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      groups: [{
        name: 'g1',
        expression: 'field.group',
        footerPosition: 'stackAtBottom',
        header: { height: 20, elements: [] },
        footer: { height: 30, elements: [] },
      }],
      bands: {
        pageFooter: { height: 20, elements: [] },
        details: [{ height: 20, elements: [] }],
      },
    }

    const doc = createReport(template, { rows: [{ group: 'A' }] })
    const groups = topGroups(doc.pages[0]!)

    // contentBottom = 300, pageFooter h=20 -> pageFooter at y=280
    // groupFooter h=30 -> groupFooter at y=280-30=250
    const groupFooter = groups.find(g => g.y === 250)
    expect(groupFooter).toBeDefined()
    expect(groupFooter!.height).toBe(30)
  })
})

// Master footer position resolution across nested groups (common promotion rules).
describe('masterFooterPosition', () => {
  function findTexts(page: import('../../src/types/render.js').RenderPage): RenderText[] {
    const texts: RenderText[] = []
    function walk(nodes: import('../../src/types/render.js').RenderNode[]) {
      for (const n of nodes) {
        if (n.type === 'text') texts.push(n)
        if (n.type === 'group') walk(n.children)
      }
    }
    walk(page.children)
    return texts
  }

  // Verifies that inner FORCE promotes outer STACK to FORCE, isolating each outer footer on its own page.
  it('inner=FORCE + outer=STACK → outer も FORCE に昇格（独立ページ）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [
        {
          name: 'outer', expression: 'field.outer', footerPosition: 'stackAtBottom',
          header: { height: 20, elements: [{ type: 'staticText', text: 'OH', x: 0, y: 0, width: 100, height: 20 }] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'OF', x: 0, y: 0, width: 100, height: 20 }] },
        },
        {
          name: 'inner', expression: 'field.inner', footerPosition: 'forceAtBottom',
          header: { height: 16, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'IF', x: 0, y: 0, width: 100, height: 20 }] },
        },
      ],
      bands: { details: [{ height: 16, elements: [] }] },
    }
    // East(A×2, B×2), West(C×2, D×2)
    const rows = [
      { outer: 'East', inner: 'A', v: 1 }, { outer: 'East', inner: 'A', v: 2 },
      { outer: 'East', inner: 'B', v: 3 }, { outer: 'East', inner: 'B', v: 4 },
      { outer: 'West', inner: 'C', v: 5 }, { outer: 'West', inner: 'C', v: 6 },
      { outer: 'West', inner: 'D', v: 7 }, { outer: 'West', inner: 'D', v: 8 },
    ]
    const doc = createReport(template, { rows })

    // Per common report behavior: 6 pages
    // P1: East header + A header + A data + InnerFooter[A] at bottom
    // P2: B header + B data + InnerFooter[B] at bottom
    // P3: OuterFooter[East] at bottom only (master=FORCE consumes all space)
    // P4: West header + C header + C data + InnerFooter[C] at bottom
    // P5: D header + D data + InnerFooter[D] at bottom
    // P6: OuterFooter[West] at bottom only
    expect(doc.pages.length).toBe(6)

    // P1: inner footer A
    expect(findTexts(doc.pages[0]!).some(t => t.text === 'IF')).toBe(true)
    expect(findTexts(doc.pages[0]!).some(t => t.text === 'OH')).toBe(true)

    // P3: outer footer East only
    const p3Texts = findTexts(doc.pages[2]!)
    expect(p3Texts.some(t => t.text === 'OF')).toBe(true)
    expect(p3Texts.some(t => t.text === 'OH')).toBe(false)

    // P6: outer footer West only
    const p6Texts = findTexts(doc.pages[5]!)
    expect(p6Texts.some(t => t.text === 'OF')).toBe(true)
    expect(p6Texts.some(t => t.text === 'OH')).toBe(false)
  })

  // Verifies that COLLATE is cancelled when master stays NORMAL, so both footers render inline.
  it('inner=COLLATE + outer=NORMAL → COLLATE キャンセル（両方インライン）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [
        {
          name: 'outer', expression: 'field.outer', footerPosition: 'normal',
          header: { height: 20, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'OF', x: 0, y: 0, width: 100, height: 20 }] },
        },
        {
          name: 'inner', expression: 'field.inner', footerPosition: 'collateAtBottom',
          header: { height: 20, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'CF', x: 0, y: 0, width: 100, height: 20 }] },
        },
      ],
      bands: { details: [{ height: 20, elements: [] }] },
    }
    const rows = [
      { outer: 'A', inner: 'X' }, { outer: 'A', inner: 'X' },
    ]
    const doc = createReport(template, { rows })

    // master=NORMAL (COLLATE does not change master, and neither does NORMAL)
    // -> the COLLATE footer renders inline (same as normal)
    expect(doc.pages.length).toBe(1)

    // Both inner and outer footers are present inline
    const texts = findTexts(doc.pages[0]!)
    expect(texts.some(t => t.text === 'CF')).toBe(true)
    expect(texts.some(t => t.text === 'OF')).toBe(true)
  })

  // Verifies that COLLATE is promoted to STACK when the outer group uses STACK, stacking both footers at the bottom.
  it('inner=COLLATE + outer=STACK → COLLATE が STACK に昇格（協調下部配置）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [
        {
          name: 'outer', expression: 'field.outer', footerPosition: 'stackAtBottom',
          header: { height: 20, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'SF', x: 0, y: 0, width: 100, height: 20 }] },
        },
        {
          name: 'inner', expression: 'field.inner', footerPosition: 'collateAtBottom',
          header: { height: 20, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'CF', x: 0, y: 0, width: 100, height: 20 }] },
        },
      ],
      bands: { details: [{ height: 20, elements: [] }] },
    }
    const rows = [
      { outer: 'A', inner: 'X' }, { outer: 'A', inner: 'X' },
    ]
    const doc = createReport(template, { rows })

    // master=STACK (because outer is STACK)
    // -> the COLLATE footer is promoted to STACK -> bottom placement
    expect(doc.pages.length).toBe(1)

    // Inner footer (COLLATE->STACK) and outer footer (STACK) are both at the page bottom
    const groups = doc.pages[0]!.children.filter((n): n is RenderGroup => n.type === 'group')
    const footerGroups = groups.filter(g => g.y >= 260)
    expect(footerGroups.length).toBe(2) // CF at y=260, SF at y=280
  })

  // Verifies that STACK is not resolved immediately, so both footers land at the same page bottom without a break.
  it('outer=FORCE + inner=STACK → 両フッターが同一ページ下部（STACK は即時解決しない）', () => {
    const template: ReportTemplate = {
      page: { width: 200, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      groups: [
        {
          name: 'outer', expression: 'field.outer', footerPosition: 'forceAtBottom',
          header: { height: 20, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'FF', x: 0, y: 0, width: 100, height: 20 }] },
        },
        {
          name: 'inner', expression: 'field.inner', footerPosition: 'stackAtBottom',
          header: { height: 20, elements: [] },
          footer: { height: 20, elements: [{ type: 'staticText', text: 'SF', x: 0, y: 0, width: 100, height: 20 }] },
        },
      ],
      bands: { details: [{ height: 20, elements: [] }] },
    }
    const rows = [
      { outer: 'A', inner: 'X' }, { outer: 'A', inner: 'X' },
    ]
    const doc = createReport(template, { rows })

    // Per common report behavior:
    // inner=STACK does not resolve immediately -> hasForceInner=false
    // outer=FORCE resolves immediately -> cursorY=bottom
    // Both footers are placed at the bottom of the same page (no page break)
    // post-loop: master=FORCE -> cursorY=bottom
    expect(doc.pages.length).toBe(1)

    // Both footers are at the bottom of the page
    const texts = findTexts(doc.pages[0]!)
    expect(texts.some(t => t.text === 'SF')).toBe(true) // inner STACK footer
    expect(texts.some(t => t.text === 'FF')).toBe(true) // outer FORCE footer

    // inner(STACK) at y=260, outer(FORCE) at y=280
    const groups = doc.pages[0]!.children.filter((n): n is RenderGroup => n.type === 'group')
    const footerGroups = groups.filter(g => g.y >= 260)
    expect(footerGroups.length).toBe(2)
  })
})
