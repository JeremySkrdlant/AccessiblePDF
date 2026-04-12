import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PDFPage, PDFRegion, TagRole } from './types'

// ---------------------------------------------------------------------------
// PDF struct type → app TagRole
// ---------------------------------------------------------------------------
function fromStructType(s: string): TagRole {
  const map: Record<string, TagRole> = {
    H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5', H6: 'H6',
    P: 'P', Figure: 'Figure', Caption: 'Caption',
    Table: 'Table', L: 'List', LI: 'ListItem',
  }
  return map[s] ?? null
}

// ---------------------------------------------------------------------------
// Walk the PDF.js struct tree and build a map:
//   "p{pageIdx}_mc{mcid}" → { role, altText }
// ---------------------------------------------------------------------------
interface StructInfo { role: string; altText?: string }

function extractStructInfo(node: unknown, parentRole: string): Map<string, StructInfo> {
  const result = new Map<string, StructInfo>()

  function walk(n: unknown, role: string) {
    if (!n || typeof n !== 'object') return
    const obj = n as Record<string, unknown>

    const nodeRole = (typeof obj.role === 'string' ? obj.role : null) ?? role
    const altText = typeof obj.alt === 'string' ? obj.alt : undefined

    // Leaf content node — id looks like "p0_mc3"
    if (obj.type === 'content' && typeof obj.id === 'string') {
      result.set(obj.id, { role, altText })
      return
    }

    if (Array.isArray(obj.children)) {
      for (const child of obj.children) walk(child, nodeRole)
    }
  }

  walk(node, parentRole)
  return result
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function importStructuredPDF(
  pdfDoc: PDFDocumentProxy,
  pageCount: number,
  onProgress?: (fraction: number) => void
): Promise<PDFPage[] | null> {
  // Only proceed if the PDF declares itself tagged
  let markInfo: { Marked?: boolean } | null = null
  try {
    markInfo = await pdfDoc.getMarkInfo()
  } catch {
    return null
  }
  if (!markInfo?.Marked) return null

  const pages: PDFPage[] = []

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    const pageNum = pageIdx + 1
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    const pageW = viewport.width
    const pageH = viewport.height

    // Build MCID → struct info from the page's structure tree
    let mcidInfoMap = new Map<string, StructInfo>()
    try {
      const tree = await page.getStructTree()
      if (tree) mcidInfoMap = extractStructInfo(tree, 'P')
    } catch { /* non-fatal */ }

    // Get text content with marked content boundaries
    let textItems: unknown[] = []
    try {
      // includeMarkedContent is available in PDF.js 4.x
      const tc = await page.getTextContent({ includeMarkedContent: true } as Parameters<typeof page.getTextContent>[0])
      textItems = tc.items
    } catch {
      try {
        const tc = await page.getTextContent()
        textItems = tc.items
      } catch { /* ignore */ }
    }

    // -----------------------------------------------------------------------
    // Parse the flat list of items into regions by tracking BDC/EMC boundaries
    // -----------------------------------------------------------------------
    const regions: PDFRegion[] = []

    // Active marked-content tracking
    let currentStructType: string | null = null
    let currentPropKey: string | null = null   // e.g. "MC3"
    let currentTexts: string[] = []
    let currentBbox: { x1: number; y1: number; x2: number; y2: number } | null = null

    function flush() {
      const structType = currentStructType
      const propKey = currentPropKey
      const texts = currentTexts
      const bbox = currentBbox

      currentStructType = null
      currentPropKey = null
      currentTexts = []
      currentBbox = null

      if (!structType || structType === 'Artifact') return

      const tag = fromStructType(structType)
      if (!tag) return

      // Look up alt text from struct tree (for Figure elements)
      let altText: string | undefined
      if (propKey) {
        // Our export uses prop keys like "MC{n}" where n === MCID
        const m = propKey.match(/MC(\d+)/i)
        if (m) {
          const mcid = parseInt(m[1])
          const info = mcidInfoMap.get(`p${pageIdx}_mc${mcid}`)
          altText = info?.altText
        }
      }

      // We need at least a bbox to place the region
      if (!bbox) return

      // Convert PDF coordinate space (origin bottom-left) to normalised (origin top-left)
      const x = bbox.x1 / pageW
      const rawY = 1 - bbox.y2 / pageH
      const w = (bbox.x2 - bbox.x1) / pageW
      const h = (bbox.y2 - bbox.y1) / pageH

      regions.push({
        id: `page-${pageNum}-imported-${regions.length}`,
        pageNumber: pageNum,
        bbox: {
          x: Math.max(0, Math.min(0.999, x)),
          y: Math.max(0, Math.min(0.999, rawY)),
          width: Math.max(0.005, Math.min(1, w)),
          height: Math.max(0.005, Math.min(1, h)),
        },
        type: tag === 'Figure' ? 'image' : 'text',
        ocrText: texts.length > 0 ? texts.join(' ') : undefined,
        altText,
        tag,
      })
    }

    for (const item of textItems) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>

      if (obj.type === 'beginMarkedContent') {
        // Starting a new marked content sequence — flush any open one first
        if (currentStructType !== null) flush()
        currentStructType = typeof obj.tag === 'string' ? obj.tag : null
        currentPropKey = typeof obj.id === 'string' ? obj.id : null
      } else if (obj.type === 'endMarkedContent') {
        flush()
      } else if (currentStructType && typeof obj.str === 'string' && obj.str.trim()) {
        // Regular text item inside a tagged sequence
        currentTexts.push(obj.str)

        const transform = obj.transform as number[] | undefined
        if (transform && transform.length >= 6) {
          const tx = transform[4]
          const ty = transform[5]
          const tw = typeof obj.width === 'number' ? obj.width : 0
          const th = typeof obj.height === 'number' ? obj.height : 0

          const x1 = tx
          const y1 = ty
          const x2 = tx + tw
          const y2 = ty + Math.max(th, 2) // ensure non-zero height

          if (!currentBbox) {
            currentBbox = { x1, y1, x2, y2 }
          } else {
            currentBbox.x1 = Math.min(currentBbox.x1, x1)
            currentBbox.y1 = Math.min(currentBbox.y1, y1)
            currentBbox.x2 = Math.max(currentBbox.x2, x2)
            currentBbox.y2 = Math.max(currentBbox.y2, y2)
          }
        }
      }
    }

    // Flush any unclosed sequence
    flush()

    pages.push({ pageNumber: pageNum, width: pageW, height: pageH, regions })
    page.cleanup()

    onProgress?.((pageIdx + 1) / pageCount)
  }

  // If we found zero regions across all pages the struct tree wasn't useful —
  // fall back to OCR so the user still gets something to work with.
  const totalRegions = pages.reduce((sum, p) => sum + p.regions.length, 0)
  if (totalRegions === 0) return null

  return pages
}
