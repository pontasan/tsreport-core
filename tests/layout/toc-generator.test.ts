import { describe, it, expect } from 'vitest'
import { insertTableOfContents } from '../../src/layout/toc-generator.js'
import type { RenderDocument, RenderBookmark, RenderGroup, RenderText } from '../../src/types/render.js'

const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 36

const pageSettings = {
  width: PAGE_W,
  height: PAGE_H,
  marginTop: MARGIN,
  marginBottom: MARGIN,
  marginLeft: MARGIN,
  marginRight: MARGIN,
}

function makeDoc(bookmarks: RenderBookmark[], pageCount = 3): RenderDocument {
  const pages = []
  for (let i = 0; i < pageCount; i++) {
    pages.push({
      width: PAGE_W,
      height: PAGE_H,
      children: [
        {
          type: 'text' as const,
          x: 36,
          y: 36,
          text: `Page ${i + 1} content`,
          fontId: 'default',
          fontSize: 12,
          color: '#000000',
        },
      ],
    })
  }
  return { pages, bookmarks }
}

describe('insertTableOfContents', () => {
  it('returns doc unchanged when no bookmarks', () => {
    const doc = makeDoc([], 2)
    const result = insertTableOfContents(doc, pageSettings, 'default')
    expect(result).toBe(doc)
    expect(result.pages.length).toBe(2)
  })

  it('returns doc unchanged when bookmarks is undefined', () => {
    const doc: RenderDocument = {
      pages: [{ width: PAGE_W, height: PAGE_H, children: [] }],
    }
    const result = insertTableOfContents(doc, pageSettings, 'default')
    expect(result).toBe(doc)
  })

  it('inserts TOC pages at the beginning', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Chapter 1', level: 1, pageIndex: 0, y: 36 },
      { label: 'Chapter 2', level: 1, pageIndex: 1, y: 36 },
      { label: 'Chapter 3', level: 1, pageIndex: 2, y: 36 },
    ]
    const doc = makeDoc(bookmarks)
    const result = insertTableOfContents(doc, pageSettings, 'default')

    // TOC should add at least 1 page
    expect(result.pages.length).toBeGreaterThan(doc.pages.length)
    // Original pages should come after TOC pages
    const tocPageCount = result.pages.length - doc.pages.length
    expect(tocPageCount).toBeGreaterThanOrEqual(1)
  })

  it('shifts bookmark pageIndex by TOC page count', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Section A', level: 1, pageIndex: 0, y: 36 },
      { label: 'Section B', level: 1, pageIndex: 2, y: 100 },
    ]
    const doc = makeDoc(bookmarks, 5)
    const result = insertTableOfContents(doc, pageSettings, 'default')

    const tocPageCount = result.pages.length - 5
    expect(result.bookmarks).toBeDefined()
    expect(result.bookmarks![0]!.pageIndex).toBe(0 + tocPageCount)
    expect(result.bookmarks![1]!.pageIndex).toBe(2 + tocPageCount)
    // Labels preserved
    expect(result.bookmarks![0]!.label).toBe('Section A')
    expect(result.bookmarks![1]!.label).toBe('Section B')
  })

  it('shifts anchor pageIndex by TOC page count', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Ch1', level: 1, pageIndex: 0, y: 36 },
    ]
    const doc = makeDoc(bookmarks, 2)
    doc.anchors = new Map([
      ['anchor1', { pageIndex: 0, y: 50 }],
      ['anchor2', { pageIndex: 1, y: 100 }],
    ])
    const result = insertTableOfContents(doc, pageSettings, 'default')

    const tocPageCount = result.pages.length - 2
    expect(result.anchors).toBeDefined()
    expect(result.anchors!.get('anchor1')!.pageIndex).toBe(0 + tocPageCount)
    expect(result.anchors!.get('anchor2')!.pageIndex).toBe(1 + tocPageCount)
  })

  it('preserves images, tagged, lang', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'A', level: 1, pageIndex: 0, y: 36 },
    ]
    const doc = makeDoc(bookmarks, 1)
    doc.images = { img1: 'base64data' }
    doc.tagged = true
    doc.lang = 'ja'

    const result = insertTableOfContents(doc, pageSettings, 'default')
    expect(result.images).toBe(doc.images)
    expect(result.tagged).toBe(true)
    expect(result.lang).toBe('ja')
  })

  it('uses custom title', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Part 1', level: 1, pageIndex: 0, y: 36 },
    ]
    const doc = makeDoc(bookmarks)
    const result = insertTableOfContents(doc, pageSettings, 'default', {
      title: '目次',
    })

    // Find the title text in TOC pages
    const tocPage = result.pages[0]!
    const found = findTextInPage(tocPage.children, '目次')
    expect(found).toBe(true)
  })

  it('respects maxLevel option', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Level 1', level: 1, pageIndex: 0, y: 36 },
      { label: 'Level 2', level: 2, pageIndex: 0, y: 100 },
      { label: 'Level 3', level: 3, pageIndex: 1, y: 36 },
    ]
    const doc = makeDoc(bookmarks)

    // maxLevel=1: only level 1 entries
    const result = insertTableOfContents(doc, pageSettings, 'default', { maxLevel: 1 })
    const tocPage = result.pages[0]!
    expect(findTextInPage(tocPage.children, 'Level 1')).toBe(true)
    expect(findTextInPage(tocPage.children, 'Level 2')).toBe(false)
    expect(findTextInPage(tocPage.children, 'Level 3')).toBe(false)
  })

  it('adds hyperlinks to entries', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Target Section', level: 1, pageIndex: 2, y: 36 },
    ]
    const doc = makeDoc(bookmarks, 5)
    const result = insertTableOfContents(doc, pageSettings, 'default')

    // Find link in TOC page
    const tocPage = result.pages[0]!
    const linkGroup = findLinkInPage(tocPage.children)
    expect(linkGroup).not.toBeNull()
    expect(linkGroup!.link!.type).toBe('localPage')
  })

  it('generates correct page numbers (1-origin, offset by TOC pages)', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'First', level: 1, pageIndex: 0, y: 36 },
      { label: 'Second', level: 1, pageIndex: 4, y: 36 },
    ]
    const doc = makeDoc(bookmarks, 5)
    const result = insertTableOfContents(doc, pageSettings, 'default')

    const tocPageCount = result.pages.length - 5
    // Page numbers in TOC entries should be pageIndex + tocPageCount + 1
    const expectedPage1 = 0 + tocPageCount + 1
    const expectedPage2 = 4 + tocPageCount + 1
    const tocPage = result.pages[0]!
    expect(findTextInPage(tocPage.children, String(expectedPage1))).toBe(true)
    expect(findTextInPage(tocPage.children, String(expectedPage2))).toBe(true)
  })

  it('handles hierarchical bookmarks with indentation', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'Chapter 1', level: 1, pageIndex: 0, y: 36 },
      { label: 'Section 1.1', level: 2, pageIndex: 0, y: 200 },
      { label: 'Section 1.2', level: 2, pageIndex: 1, y: 36 },
      { label: 'Chapter 2', level: 1, pageIndex: 2, y: 36 },
    ]
    const doc = makeDoc(bookmarks, 3)
    const result = insertTableOfContents(doc, pageSettings, 'default')

    // All entries should be present
    const tocPage = result.pages[0]!
    expect(findTextInPage(tocPage.children, 'Chapter 1')).toBe(true)
    expect(findTextInPage(tocPage.children, 'Section 1.1')).toBe(true)
    expect(findTextInPage(tocPage.children, 'Chapter 2')).toBe(true)
  })

  it('hides page numbers when showPageNumbers=false', () => {
    const bookmarks: RenderBookmark[] = [
      { label: 'OnlyLabel', level: 1, pageIndex: 0, y: 36 },
    ]
    const doc = makeDoc(bookmarks)
    const result = insertTableOfContents(doc, pageSettings, 'default', {
      showPageNumbers: false,
    })

    const tocPage = result.pages[0]!
    expect(findTextInPage(tocPage.children, 'OnlyLabel')).toBe(true)
    // No page number text (just the label + title)
    const allTexts = collectTexts(tocPage.children)
    // Should not contain just a number that would be a page number
    const pageNumTexts = allTexts.filter(t => /^\d+$/.test(t.trim()))
    expect(pageNumTexts.length).toBe(0)
  })

  it('handles many bookmarks spanning multiple TOC pages', () => {
    const bookmarks: RenderBookmark[] = []
    for (let i = 0; i < 100; i++) {
      bookmarks.push({ label: `Entry ${i + 1}`, level: 1, pageIndex: i % 10, y: 36 })
    }
    const doc = makeDoc(bookmarks, 10)
    const result = insertTableOfContents(doc, pageSettings, 'default')

    // Should have multiple TOC pages + original 10
    expect(result.pages.length).toBeGreaterThan(11)
  })
})

// Helpers.

function findTextInPage(nodes: RenderNode[], text: string): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text' && (node as RenderText).text === text) return true
    if (node.type === 'group') {
      if (findTextInPage((node as RenderGroup).children, text)) return true
    }
  }
  return false
}

function findLinkInPage(nodes: RenderNode[]): RenderGroup | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'group') {
      const g = node as RenderGroup
      if (g.link) return g
      const found = findLinkInPage(g.children)
      if (found) return found
    }
  }
  return null
}

function collectTexts(nodes: RenderNode[]): string[] {
  const result: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text') result.push((node as RenderText).text)
    if (node.type === 'group') {
      result.push(...collectTexts((node as RenderGroup).children))
    }
  }
  return result
}

type RenderNode = import('../../src/types/render.js').RenderNode
