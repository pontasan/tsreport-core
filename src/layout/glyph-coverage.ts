/**
 * Glyph coverage check
 *
 * Scans all RenderText nodes in a RenderDocument and
 * detects characters for which the specified font has no glyph.
 */

import type { RenderDocument, RenderNode, RenderText } from '../types/render.js'
import type { Font } from '../font.js'

/** Missing-glyph report */
export interface GlyphCoverageIssue {
  /** Full text */
  text: string
  /** Font ID */
  fontId: string
  /** Array of missing characters (for display) */
  missingChars: string[]
  /** Array of missing code points */
  missingCodePoints: number[]
  /** Page number (1-based) */
  page: number
}

/**
 * Checks all text nodes in a RenderDocument and
 * reports characters for which the font has no glyph.
 *
 * @param doc RenderDocument to check
 * @param fonts Map of fontId → Font
 * @returns List of missing-glyph reports (empty array if there are no issues)
 */
export function checkGlyphCoverage(
  doc: RenderDocument,
  fonts: Record<string, Font>,
): GlyphCoverageIssue[] {
  const issues: GlyphCoverageIssue[] = []

  for (let p = 0; p < doc.pages.length; p++) {
    const page = doc.pages[p]!
    collectFromNodes(page.children, fonts, p + 1, issues)
  }

  return issues
}

function collectFromNodes(
  nodes: RenderNode[],
  fonts: Record<string, Font>,
  page: number,
  issues: GlyphCoverageIssue[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text') {
      checkTextNode(node, fonts, page, issues)
    } else if (node.type === 'group') {
      collectFromNodes(node.children, fonts, page, issues)
    }
  }
}

function checkTextNode(
  node: RenderText,
  fonts: Record<string, Font>,
  page: number,
  issues: GlyphCoverageIssue[],
): void {
  const text = node.text
  if (text === '') return

  const font = fonts[node.fontId]
  if (!font) return // Skip if the font itself is missing (a separate issue)

  const missingChars: string[] = []
  const missingCodePoints: number[] = []

  for (let j = 0; j < text.length; j++) {
    const cp = text.codePointAt(j)!
    // Skip the low surrogate of a surrogate pair
    if (cp > 0xFFFF) j++

    // Skip control characters, newlines, and spaces
    if (cp <= 0x20) continue

    const gid = font.getGlyphId(cp)
    if (gid === 0) {
      const ch = String.fromCodePoint(cp)
      // Deduplicate
      if (missingCodePoints.indexOf(cp) === -1) {
        missingChars.push(ch)
        missingCodePoints.push(cp)
      }
    }
  }

  if (missingChars.length > 0) {
    issues.push({
      text,
      fontId: node.fontId,
      missingChars,
      missingCodePoints,
      page,
    })
  }
}
