import type { PDFRegion } from './types'

/**
 * Comparator for reading order used in the tree display and PDF export.
 *
 * Priority:
 *   1. Explicit readingOrder field (set by drag-reorder in TreeEditor)
 *   2. Page number
 *   3. Column-aware positional sort:
 *      - If two regions overlap vertically they are on the same horizontal
 *        band (adjacent columns) → sort left-to-right.
 *      - Otherwise sort top-to-bottom.
 */
export function compareReadingOrder(a: PDFRegion, b: PDFRegion): number {
  if (a.readingOrder !== undefined && b.readingOrder !== undefined) return a.readingOrder - b.readingOrder
  if (a.readingOrder !== undefined) return -1
  if (b.readingOrder !== undefined) return 1
  if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber
  // Column-aware: overlapping vertically → same row → sort left-to-right
  const aBot = a.bbox.y + a.bbox.height
  const bBot = b.bbox.y + b.bbox.height
  if (a.bbox.y < bBot && b.bbox.y < aBot) return a.bbox.x - b.bbox.x
  return a.bbox.y - b.bbox.y
}
