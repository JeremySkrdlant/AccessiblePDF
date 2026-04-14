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
    // Variations PDF.js or other tools may use:
    Lbl: null, LBody: null, Sect: null, Div: null,
    Document: null, Art: null, Part: null, BlockQuote: null,
    TR: null, TD: null, TH: null,
  }
  return (s in map) ? map[s] : null
}

// Roles that become leaf regions (aggregate all content beneath them)
const LEAF_ROLES = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'Caption', 'LI', 'Table', 'Figure'])

// Roles that become group/container regions
const CONTAINER_ROLES = new Set(['L'])

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------
interface RawBbox { x1: number; y1: number; x2: number; y2: number }

/** What we store per MCID from the text content stream */
interface ContentEntry {
  bbox: RawBbox | null
  texts: string[]
  /** The BDC tag (e.g. "H1", "P", "LI") — ground truth for the struct type */
  bdcTag: string
  pageIdx: number
}

interface PageDim { width: number; height: number }

function unionRawBbox(a: RawBbox, b: RawBbox): RawBbox {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  }
}

function normalizeBbox(raw: RawBbox, pageW: number, pageH: number) {
  const x = raw.x1 / pageW
  const y = 1 - raw.y2 / pageH          // flip y: PDF origin is bottom-left
  const w = (raw.x2 - raw.x1) / pageW
  const h = (raw.y2 - raw.y1) / pageH
  return {
    x: Math.max(0, Math.min(0.999, x)),
    y: Math.max(0, Math.min(0.999, y)),
    width: Math.max(0.005, Math.min(1, w)),
    height: Math.max(0.005, Math.min(1, h)),
  }
}

// ---------------------------------------------------------------------------
// Phase 1: build the MCID → content map from the text stream
// Key: "p{pageIdx}_mc{mcid}"
// Stores bbox, text, AND the BDC tag (reliable ground truth for struct type)
// ---------------------------------------------------------------------------
async function buildContentMap(
  pdfDoc: PDFDocumentProxy,
  pageCount: number,
  dims: Map<number, PageDim>,
  onProgress?: (fraction: number) => void
): Promise<Map<string, ContentEntry>> {
  const contentMap = new Map<string, ContentEntry>()

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    const pageNum = pageIdx + 1
    const page = await pdfDoc.getPage(pageNum)
    const vp = page.getViewport({ scale: 1 })
    dims.set(pageIdx, { width: vp.width, height: vp.height })

    try {
      const tc = await page.getTextContent(
        { includeMarkedContent: true } as Parameters<typeof page.getTextContent>[0]
      )

      let activeId: string | null = null
      let activeEntry: ContentEntry | null = null

      const flush = () => {
        if (activeId !== null && activeEntry) {
          contentMap.set(activeId, activeEntry)
        }
        activeId = null
        activeEntry = null
      }

      for (const item of tc.items) {
        if (!item || typeof item !== 'object') continue
        const obj = item as Record<string, unknown>

        if (obj.type === 'beginMarkedContent' || obj.type === 'beginMarkedContentProps') {
          flush()
          // id looks like "MC3" or "p1R_mc3"
          if (typeof obj.id === 'string') {
            const m = obj.id.match(/MC(\d+)/i)
            if (m) {
              activeId = obj.id
              // Store the BDC tag ("H1", "P", "LI", etc.) as ground truth
              activeEntry = {
                bbox: null,
                texts: [],
                bdcTag: typeof obj.tag === 'string' ? obj.tag : '',
                pageIdx: pageIdx
              }
            }
          }
        } else if (obj.type === 'endMarkedContent') {
          flush()
        } else if (activeEntry && typeof obj.str === 'string' && obj.str.trim()) {
          activeEntry.texts.push(obj.str)
          const transform = obj.transform as number[] | undefined
          if (transform && transform.length >= 6) {
            const tx = transform[4]
            const ty = transform[5]
            const tw = typeof obj.width === 'number' ? obj.width : 0
            const th = typeof obj.height === 'number' ? obj.height : 0
            const nb: RawBbox = { x1: tx, y1: ty, x2: tx + tw, y2: ty + Math.max(th, 2) }
            activeEntry.bbox = activeEntry.bbox ? unionRawBbox(activeEntry.bbox, nb) : nb
          }
        }
      }
      flush()
    } catch { /* non-fatal */ }

    page.cleanup()
    onProgress?.((pageIdx + 1) / pageCount)
  }

  return contentMap
}

// ---------------------------------------------------------------------------
// Flat fallback: build regions directly from contentMap (no hierarchy)
// Used when getStructTree() fails or yields nothing useful.
// ---------------------------------------------------------------------------
function buildFlatRegions(
  contentMap: Map<string, ContentEntry>,
  dims: Map<number, PageDim>,
  pageCount: number
): PDFRegion[] {
  let counter = 0
  const regions: PDFRegion[] = []

  for (const [key, entry] of contentMap) {
    if (!entry.bbox) continue
    const pageIdx = entry.pageIdx
    if (pageIdx >= pageCount) continue

    const appTag = fromStructType(entry.bdcTag)
    if (!appTag) continue  // skip Artifact, unknown, etc.

    const dim = dims.get(pageIdx)
    if (!dim) continue

    regions.push({
      id: `imported-flat-${++counter}`,
      pageNumber: pageIdx + 1,
      bbox: normalizeBbox(entry.bbox, dim.width, dim.height),
      type: appTag === 'Figure' ? 'image' : 'text',
      ocrText: entry.texts.join(' ') || undefined,
      tag: appTag,
    })
  }

  return regions
}

// ---------------------------------------------------------------------------
// Phase 2+3: walk the struct tree and emit hierarchical PDFRegion objects
// Uses contentMap for bboxes + bdcTag (ground truth for tag name).
// ---------------------------------------------------------------------------

interface ContentLeaf { pageIdx: number; bbox: RawBbox | null; text: string; bdcTag: string }

/** Recursively collect all content leaf entries under a struct node */
function collectContentLeaves(
  node: unknown,
  contentMap: Map<string, ContentEntry>
): ContentLeaf[] {
  if (!node || typeof node !== 'object') return []
  const obj = node as Record<string, unknown>

  if ((obj.type === 'content' || obj.type === 'annot') && typeof obj.id === 'string') {
    const entry = contentMap.get(obj.id)
    if (!entry) return []
    return [{
      pageIdx: entry.pageIdx,
      bbox: entry.bbox ?? null,
      text: entry.texts.join(' ') ?? '',
      bdcTag: entry.bdcTag ?? '',
    }]
  }

  if (Array.isArray(obj.children)) {
    return (obj.children as unknown[]).flatMap(c => collectContentLeaves(c, contentMap))
  }
  return []
}

let _idCounter = 0
function nextId(prefix: string) { return `${prefix}-${++_idCounter}` }

function walkStructNode(
  node: unknown,
  parentId: string | undefined,
  contentMap: Map<string, ContentEntry>,
  dims: Map<number, PageDim>,
  allRegions: PDFRegion[]
): void {
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>

  if (obj.type === 'content' || obj.type === 'annot') return

  const role = typeof obj.role === 'string' ? obj.role : ''
  const children = Array.isArray(obj.children) ? (obj.children as unknown[]) : []

  if (LEAF_ROLES.has(role)) {
    // Aggregate all content under this struct element into one region
    const leaves = children.flatMap(c => collectContentLeaves(c, contentMap))
    if (leaves.length === 0) return

    const pageIdx = leaves[0].pageIdx
    const dim = dims.get(pageIdx)
    if (!dim) return

    let raw: RawBbox | null = null
    let text = ''
    // Collect the bdcTag from content items — use the first non-empty one
    // as ground truth, falling back to the struct tree role
    let bdcTag = ''
    for (const leaf of leaves) {
      if (leaf.pageIdx === pageIdx && leaf.bbox) {
        raw = raw ? unionRawBbox(raw, leaf.bbox) : { ...leaf.bbox }
      }
      if (leaf.text) text += (text ? ' ' : '') + leaf.text
      if (!bdcTag && leaf.bdcTag) bdcTag = leaf.bdcTag
    }

    if (!raw) return

    // Prefer the BDC tag (ground truth from content stream) over struct tree role
    const tagSource = bdcTag || role
    const appTag = fromStructType(tagSource) ?? fromStructType(role)
    if (!appTag) return

    const altText = typeof (obj as Record<string, unknown>).alt === 'string'
      ? (obj as Record<string, unknown>).alt as string
      : undefined

    allRegions.push({
      id: nextId('imported'),
      pageNumber: pageIdx + 1,
      bbox: normalizeBbox(raw, dim.width, dim.height),
      type: appTag === 'Figure' ? 'image' : 'text',
      ocrText: text || undefined,
      altText,
      tag: appTag,
      parentId,
    })

  } else if (CONTAINER_ROLES.has(role)) {
    // Create a group region; children get this group as parentId
    const groupId = nextId('imported-group')
    const regsBefore = allRegions.length

    for (const child of children) {
      walkStructNode(child, groupId, contentMap, dims, allRegions)
    }

    const childRegions = allRegions.slice(regsBefore)
    if (childRegions.length === 0) return

    const pageNum = childRegions[0].pageNumber
    let gx = childRegions[0].bbox.x
    let gy = childRegions[0].bbox.y
    let gx2 = gx + childRegions[0].bbox.width
    let gy2 = gy + childRegions[0].bbox.height

    for (const cr of childRegions.slice(1)) {
      if (cr.pageNumber !== pageNum) continue
      gx = Math.min(gx, cr.bbox.x)
      gy = Math.min(gy, cr.bbox.y)
      gx2 = Math.max(gx2, cr.bbox.x + cr.bbox.width)
      gy2 = Math.max(gy2, cr.bbox.y + cr.bbox.height)
    }

    allRegions.push({
      id: groupId,
      pageNumber: pageNum,
      bbox: { x: gx, y: gy, width: gx2 - gx, height: gy2 - gy },
      type: 'group',
      tag: fromStructType(role),
      parentId,
      isExpanded: true,
    })

  } else {
    // Passthrough: no region created, children get the same parentId
    for (const child of children) {
      walkStructNode(child, parentId, contentMap, dims, allRegions)
    }
  }
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

  _idCounter = 0

  // ── Phase 1: build MCID → bbox/text/bdcTag map ────────────────────────────
  const dims = new Map<number, PageDim>()
  const contentMap = await buildContentMap(pdfDoc, pageCount, dims,
    (f) => onProgress?.(f * 0.6)
  )
  onProgress?.(0.6)

  // ── Phase 2: attempt struct-tree-based hierarchical import ────────────────
  // PDF.js page.getStructTree() returns the full document structure tree
  // annotated with page-indexed content IDs (e.g. "p0_mc3").
  let allRegions: PDFRegion[] = []

  try {
    const page1 = await pdfDoc.getPage(1)
    const structTree = await page1.getStructTree()

    if (structTree) {
      const rootObj = structTree as Record<string, unknown>
      const rootChildren = Array.isArray(rootObj.children)
        ? (rootObj.children as unknown[])
        : []

      for (const child of rootChildren) {
        walkStructNode(child, undefined, contentMap, dims, allRegions)
      }
    }
  } catch { /* fall through to flat fallback */ }

  // ── Phase 3: flat fallback if struct tree produced nothing ────────────────
  // This handles cases where getStructTree() fails or returns an empty tree.
  // The flat regions use the BDC tags directly — reliable for our own exports.
  if (allRegions.length === 0) {
    allRegions = buildFlatRegions(contentMap, dims, pageCount)
  }

  if (allRegions.length === 0) return null

  onProgress?.(1)

  // ── Phase 4: partition regions into per-page arrays ───────────────────────
  const pageRegionMap = new Map<number, PDFRegion[]>()
  for (let p = 1; p <= pageCount; p++) pageRegionMap.set(p, [])

  for (const region of allRegions) {
    const pn = Math.min(Math.max(region.pageNumber, 1), pageCount)
    pageRegionMap.get(pn)!.push(region)
  }

  const pages: PDFPage[] = []
  for (let p = 1; p <= pageCount; p++) {
    const dim = dims.get(p - 1)
    pages.push({
      pageNumber: p,
      width: dim?.width ?? 612,
      height: dim?.height ?? 792,
      regions: pageRegionMap.get(p) ?? [],
    })
  }

  return pages
}
