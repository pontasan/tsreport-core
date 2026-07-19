/**
 * Automatic Table of Contents generation
 *
 * Reads bookmark information from a RenderDocument,
 * generates TOC pages, and inserts them at the front of the document.
 *
 * Equivalent to the common TOC approach (Report Parts + evaluationTime="Report").
 * Provided as a post-processing utility applied after createReport().
 */

import type {
  RenderDocument, RenderPage, RenderNode,
  RenderGroup, RenderText, RenderBookmark,
} from '../types/render.js'
import { flowLayout } from './flow-layout.js'
import type { FlowBlock } from './flow-layout.js'

// ─── Public types ───

export interface TocOptions {
  /** TOC title (default: "Table of Contents") */
  title?: string
  /** Font ID for the title */
  titleFontId?: string
  /** Title font size (default: 16) */
  titleFontSize?: number
  /** Font ID for entries */
  entryFontId?: string
  /** Entry font size (default: 9) */
  entryFontSize?: number
  /** Whether to show page numbers (default: true) */
  showPageNumbers?: boolean
  /** Whether to show dot leaders (default: true) */
  showDotLeader?: boolean
  /** Indent per level in pt (default: 15) */
  indentPerLevel?: number
  /** Spacing between entries in pt (default: 4) */
  entrySpacing?: number
  /** Maximum level to display (default: 6) */
  maxLevel?: number
}

// ─── Main function ───

/**
 * Inserts TOC pages into a document.
 *
 * Reads doc.bookmarks, generates TOC pages, and inserts them at the front of the document.
 * Returns doc unchanged if there are no bookmarks.
 *
 * @param doc - RenderDocument produced by the layout engine
 * @param pageSettings - Page settings for the TOC pages
 * @param fontId - Default font ID (shared by title and entries)
 * @param options - TOC options
 * @returns A new RenderDocument with TOC pages inserted at the front
 */
export function insertTableOfContents(
  doc: RenderDocument,
  pageSettings: {
    width: number
    height: number
    marginTop?: number
    marginBottom?: number
    marginLeft?: number
    marginRight?: number
  },
  fontId: string,
  options?: TocOptions,
): RenderDocument {
  const bookmarks = doc.bookmarks
  if (!bookmarks || bookmarks.length === 0) return doc

  const title = options?.title ?? 'Table of Contents'
  const titleFontId = options?.titleFontId ?? fontId
  const titleFontSize = options?.titleFontSize ?? 16
  const entryFontId = options?.entryFontId ?? fontId
  const entryFontSize = options?.entryFontSize ?? 9
  const showPageNumbers = options?.showPageNumbers ?? true
  const showDotLeader = options?.showDotLeader ?? true
  const indentPerLevel = options?.indentPerLevel ?? 15
  const entrySpacing = options?.entrySpacing ?? 4
  const maxLevel = options?.maxLevel ?? 6

  const ml = pageSettings.marginLeft ?? 0
  const mr = pageSettings.marginRight ?? 0
  const contentWidth = pageSettings.width - ml - mr

  // ─── Block generation ───

  const blocks: FlowBlock[] = []

  // Title block
  const titleHeight = titleFontSize + 8
  const titleBlock: FlowBlock = {
    height: titleHeight,
    children: [{
      type: 'text',
      x: 0,
      y: 0,
      text: title,
      fontId: titleFontId,
      fontSize: titleFontSize,
      color: '#000000',
      bold: true,
    } as RenderText],
  }
  blocks.push(titleBlock)

  // Initial layout: run flowLayout with tocPageCount tentatively set to 0
  // → TOC page count is determined → finalize page numbers and re-layout

  // First pass determines the page count
  const entryBlocks = buildEntryBlocks(
    bookmarks, 0, contentWidth,
    entryFontId, entryFontSize, showPageNumbers, showDotLeader,
    indentPerLevel, entrySpacing, maxLevel,
  )
  const firstPassBlocks = [titleBlock, ...entryBlocks]
  const firstPass = flowLayout(firstPassBlocks, pageSettings)
  const tocPageCount = firstPass.pages.length

  // Second pass: recompute page numbers with the determined tocPageCount
  const finalEntryBlocks = buildEntryBlocks(
    bookmarks, tocPageCount, contentWidth,
    entryFontId, entryFontSize, showPageNumbers, showDotLeader,
    indentPerLevel, entrySpacing, maxLevel,
  )
  const finalBlocks = [titleBlock, ...finalEntryBlocks]
  const tocDoc = flowLayout(finalBlocks, pageSettings)

  // Recompute if the page count changed (rare, but for safety)
  if (tocDoc.pages.length !== tocPageCount) {
    const retryEntryBlocks = buildEntryBlocks(
      bookmarks, tocDoc.pages.length, contentWidth,
      entryFontId, entryFontSize, showPageNumbers, showDotLeader,
      indentPerLevel, entrySpacing, maxLevel,
    )
    const retryBlocks = [titleBlock, ...retryEntryBlocks]
    const retryDoc = flowLayout(retryBlocks, pageSettings)
    return mergeDocuments(retryDoc.pages, doc, retryDoc.pages.length)
  }

  return mergeDocuments(tocDoc.pages, doc, tocPageCount)
}

// ─── Entry block generation ───

function buildEntryBlocks(
  bookmarks: RenderBookmark[],
  tocPageCount: number,
  contentWidth: number,
  entryFontId: string,
  entryFontSize: number,
  showPageNumbers: boolean,
  showDotLeader: boolean,
  indentPerLevel: number,
  entrySpacing: number,
  maxLevel: number,
): FlowBlock[] {
  const blocks: FlowBlock[] = []
  const entryHeight = entryFontSize + entrySpacing

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i]!
    if (bm.level > maxLevel) continue

    const indent = (bm.level - 1) * indentPerLevel
    const pageNum = bm.pageIndex + tocPageCount + 1 // 1-origin
    const children: RenderNode[] = []

    // Label
    const labelX = indent
    const isBold = bm.level === 1
    children.push({
      type: 'text',
      x: labelX,
      y: 0,
      text: bm.label,
      fontId: entryFontId,
      fontSize: entryFontSize,
      color: '#000000',
      bold: isBold,
    } as RenderText)

    if (showPageNumbers) {
      // Page number (right-aligned)
      const pageNumStr = String(pageNum)
      const pageNumWidth = 30
      const pageNumX = contentWidth - pageNumWidth

      children.push({
        type: 'text',
        x: pageNumX,
        y: 0,
        text: pageNumStr,
        fontId: entryFontId,
        fontSize: entryFontSize,
        color: '#000000',
        hAlign: 'right',
        width: pageNumWidth,
      } as RenderText)

      if (showDotLeader) {
        // Dot leader: fill from the end of the label to just before the page number with '.'
        // Dot count is approximated (not exact widths, but visually sufficient)
        const dotWidth = entryFontSize * 0.4  // Approximate width of one dot
        const leaderStartX = labelX + bm.label.length * entryFontSize * 0.5 + 4
        const leaderEndX = pageNumX - 4
        const leaderLen = leaderEndX - leaderStartX
        if (leaderLen > dotWidth * 2) {
          const dotCount = Math.floor(leaderLen / dotWidth)
          const dots = '.'.repeat(dotCount)
          children.push({
            type: 'text',
            x: leaderStartX,
            y: 0,
            text: dots,
            fontId: entryFontId,
            fontSize: entryFontSize,
            color: '#999999',
          } as RenderText)
        }
      }
    }

    // Hyperlink (page jump)
    const linkGroup: RenderGroup = {
      type: 'group',
      x: 0,
      y: 0,
      width: contentWidth,
      height: entryHeight,
      children,
      link: {
        type: 'localPage',
        target: String(bm.pageIndex + tocPageCount),
      },
    }

    blocks.push({
      height: entryHeight,
      children: [linkGroup],
    })
  }

  return blocks
}

// ─── Document merging ───

function mergeDocuments(
  tocPages: RenderPage[],
  originalDoc: RenderDocument,
  tocPageCount: number,
): RenderDocument {
  // Concatenate pages
  const pages: RenderPage[] = [...tocPages, ...originalDoc.pages]

  // Shift bookmark pageIndex by tocPageCount
  let bookmarks: RenderBookmark[] | undefined
  if (originalDoc.bookmarks) {
    bookmarks = []
    for (let i = 0; i < originalDoc.bookmarks.length; i++) {
      const bm = originalDoc.bookmarks[i]!
      bookmarks.push({
        label: bm.label,
        level: bm.level,
        pageIndex: bm.pageIndex + tocPageCount,
        y: bm.y,
      })
    }
  }

  // Shift anchor pageIndex
  let anchors: Map<string, { pageIndex: number; y: number }> | undefined
  if (originalDoc.anchors) {
    anchors = new Map()
    for (const [name, entry] of originalDoc.anchors) {
      anchors.set(name, {
        pageIndex: entry.pageIndex + tocPageCount,
        y: entry.y,
      })
    }
  }

  const result: RenderDocument = { pages }
  if (bookmarks) result.bookmarks = bookmarks
  if (anchors) result.anchors = anchors
  if (originalDoc.images) result.images = originalDoc.images
  if (originalDoc.tagged) result.tagged = originalDoc.tagged
  if (originalDoc.lang) result.lang = originalDoc.lang

  return result
}
