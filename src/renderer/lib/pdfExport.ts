import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFString,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  PDFOperator,
  PDFOperatorNames,
  showText,
} from 'pdf-lib'
import type { PDFDocumentMeta, PDFRegion, TagRole } from './types'

// ---------------------------------------------------------------------------
// Tag role → PDF structure type mapping
// ---------------------------------------------------------------------------
function toStructType(role: NonNullable<TagRole>): string {
  const map: Record<NonNullable<TagRole>, string> = {
    H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5', H6: 'H6',
    P: 'P',
    Figure: 'Figure',
    Caption: 'Caption',
    Table: 'Table',
    List: 'L',      // PDF/UA uses /L for list container
    ListItem: 'LI', // PDF/UA uses /LI for list item
    Artifact: 'Artifact'
  }
  return map[role]
}

// ---------------------------------------------------------------------------
// Logical structure node (used to group ListItems under a List parent)
// ---------------------------------------------------------------------------
interface StructNode {
  tag: NonNullable<TagRole>
  region?: PDFRegion       // undefined for synthetic List containers
  children?: StructNode[]  // only for List containers
}

function buildStructNodes(regions: PDFRegion[]): StructNode[] {
  const nodes: StructNode[] = []
  let i = 0
  while (i < regions.length) {
    const r = regions[i]
    if (r.tag === 'ListItem') {
      // Collect consecutive ListItems under a synthetic List node
      const listNode: StructNode = { tag: 'List', children: [] }
      while (i < regions.length && regions[i].tag === 'ListItem') {
        listNode.children!.push({ tag: 'ListItem', region: regions[i] })
        i++
      }
      nodes.push(listNode)
    } else if (r.tag !== null) {
      nodes.push({ tag: r.tag as NonNullable<TagRole>, region: r })
      i++
    } else {
      i++ // skip untagged
    }
  }
  return nodes
}

// ---------------------------------------------------------------------------
// Raw PDF operator helpers (pdf-lib doesn't expose all operators we need)
// ---------------------------------------------------------------------------
function op(name: PDFOperatorNames, ...args: Array<string | number>): PDFOperator {
  return PDFOperator.of(
    name,
    args.map((a) => (typeof a === 'number' ? PDFNumber.of(a) : PDFName.of(a))) as never
  )
}

function beginText(): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.BeginText)
}
function endText(): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.EndText)
}
function setTextRenderingMode(mode: number): PDFOperator {
  return op(PDFOperatorNames.SetTextRenderingMode, mode)
}
function setFont(fontKey: string, size: number): PDFOperator {
  return op(PDFOperatorNames.SetFontAndSize, fontKey, size)
}
function setTextMatrix(a: number, b: number, c: number, d: number, e: number, f: number): PDFOperator {
  return op(PDFOperatorNames.SetTextMatrix, a, b, c, d, e, f)
}
// BDC with named properties dict: /StructType /PropName BDC
function beginMarkedContentProps(structType: string, propName: string): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of(structType), PDFName.of(propName)] as never)
}
// BMC for artifacts (no properties dict)
function beginMarkedContentArtifact(): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of('Artifact')] as never)
}
function endMarkedContent(): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.EndMarkedContent)
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------
export async function exportTaggedPDF(
  rawBytes: ArrayBuffer,
  appDoc: PDFDocumentMeta,
  docTitle: string,
  docLanguage: string
): Promise<Uint8Array> {
  // ------------------------------------------------------------------
  // Step 1: Load and configure document metadata
  // ------------------------------------------------------------------
  let pdfDoc: PDFDocument
  try {
    pdfDoc = await PDFDocument.load(rawBytes, { updateMetadata: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('password') || msg.includes('encrypt')) {
      throw new Error('This PDF is password-protected. Remove encryption before exporting.')
    }
    throw err
  }

  const { context } = pdfDoc
  const catalog = pdfDoc.catalog

  // Remove any existing structure tree / mark info to start fresh
  catalog.delete(PDFName.of('StructTreeRoot'))
  catalog.delete(PDFName.of('MarkInfo'))

  // Set document-level accessibility metadata
  const title = docTitle.trim() || appDoc.fileName.replace(/\.pdf$/i, '') || 'Accessible Document'
  pdfDoc.setTitle(title, { showInWindowTitleBar: true })
  pdfDoc.setLanguage(docLanguage || 'en-US')

  // MarkInfo: tells viewers this PDF has structure tags
  catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }))

  // ------------------------------------------------------------------
  // Step 2: Embed the invisible text font
  // ------------------------------------------------------------------
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const FONT_KEY = 'AccessF'

  // ------------------------------------------------------------------
  // Step 3: Collect and sort all tagged regions
  // ------------------------------------------------------------------
  const allTaggedRegions: PDFRegion[] = appDoc.pages
    .flatMap((page) => page.regions)
    .filter((r) => r.tag !== null)
    .sort((a, b) => {
      // Respect explicit readingOrder if set
      if (a.readingOrder !== undefined && b.readingOrder !== undefined) {
        return a.readingOrder - b.readingOrder
      }
      if (a.readingOrder !== undefined) return -1
      if (b.readingOrder !== undefined) return 1
      // Default: page order, top-to-bottom, left-to-right
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber
      return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x
    })

  // ------------------------------------------------------------------
  // Step 4: Build logical structure nodes (handles List/ListItem nesting)
  // ------------------------------------------------------------------
  const structNodes = buildStructNodes(allTaggedRegions)

  // ------------------------------------------------------------------
  // Step 5: Assign MCIDs to all non-Artifact leaf regions
  // ------------------------------------------------------------------
  const mcidMap = new Map<string, number>()  // regionId → MCID
  let nextMcid = 0

  function assignMcids(nodes: StructNode[]) {
    for (const node of nodes) {
      if (node.children) {
        assignMcids(node.children)
      } else if (node.region && node.tag !== 'Artifact') {
        mcidMap.set(node.region.id, nextMcid++)
      }
    }
  }
  assignMcids(structNodes)

  // ------------------------------------------------------------------
  // Step 6: Build per-page invisible text content streams
  // ------------------------------------------------------------------
  const pdfPages = pdfDoc.getPages()

  for (let pageIdx = 0; pageIdx < pdfPages.length; pageIdx++) {
    const page = pdfPages[pageIdx]
    const pageNum = pageIdx + 1
    const { width: pageW, height: pageH } = page.getSize()

    const regionsOnPage = allTaggedRegions.filter((r) => r.pageNumber === pageNum)
    if (regionsOnPage.length === 0) continue

    // Add font resource to this page
    const resources = page.node.Resources()
    if (resources) {
      let fontDict = resources.lookupMaybe(PDFName.Font, PDFDict)
      if (!fontDict) {
        fontDict = context.obj({}) as PDFDict
        resources.set(PDFName.Font, fontDict)
      }
      fontDict.set(PDFName.of(FONT_KEY), font.ref)

      // Add Properties dict for named MCID references
      let propsDict = resources.lookupMaybe(PDFName.of('Properties'), PDFDict)
      if (!propsDict) {
        propsDict = context.obj({}) as PDFDict
        resources.set(PDFName.of('Properties'), propsDict)
      }

      // Register a property entry for each MCID on this page
      for (const region of regionsOnPage) {
        if (region.tag === 'Artifact') continue
        const mcid = mcidMap.get(region.id)
        if (mcid === undefined) continue
        const propKey = `MC${mcid}`
        propsDict.set(PDFName.of(propKey), context.obj({ MCID: mcid }))
      }
    }

    // Build the content stream operators
    const operators: PDFOperator[] = []
    operators.push(pushGraphicsState())
    operators.push(beginText())
    operators.push(setTextRenderingMode(3)) // invisible — visual rendering mode 3

    for (const region of regionsOnPage) {
      if (region.tag === 'Artifact') {
        // Artifact: mark as /Artifact, no MCID
        operators.push(beginMarkedContentArtifact())
        operators.push(endMarkedContent())
        continue
      }

      const mcid = mcidMap.get(region.id)
      if (mcid === undefined) continue

      const propName = `MC${mcid}`
      const structType = toStructType(region.tag as NonNullable<TagRole>)

      operators.push(beginMarkedContentProps(structType, propName))

      // Position text at the region bbox
      // bbox is screen-normalized (top-left origin); convert to PDF space (bottom-left origin)
      const pdfX = region.bbox.x * pageW
      const pdfY = pageH - (region.bbox.y + region.bbox.height) * pageH
      // Font size scales with region height, min 6pt
      const fontSize = Math.max(Math.round(region.bbox.height * pageH), 6)

      operators.push(setFont(FONT_KEY, fontSize))
      operators.push(setTextMatrix(1, 0, 0, 1, pdfX, pdfY))

      const textContent =
        region.type === 'text'
          ? (region.ocrText ?? '')
          : region.type === 'image' && region.altText
            ? region.altText
            : ''

      if (textContent) {
        operators.push(showText(font.encodeText(textContent)))
      }

      operators.push(endMarkedContent())
    }

    operators.push(endText())
    operators.push(popGraphicsState())

    // Create a new content stream and append it to the page
    const streamBytes = operators.map((o) => o.toString()).join('\n')
    const stream = context.flateStream(new TextEncoder().encode(streamBytes))
    const streamRef = context.register(stream)
    page.node.addContentStream(streamRef)
  }

  // ------------------------------------------------------------------
  // Step 7: Build StructElement indirect refs
  // ------------------------------------------------------------------
  const structTreeRootRef = context.nextRef()
  const documentElemRef = context.nextRef()

  interface BuiltElem {
    ref: PDFRef
    mcid?: number
    pageRef?: PDFRef
  }

  function buildElemRefs(nodes: StructNode[]): BuiltElem[] {
    const results: BuiltElem[] = []
    for (const node of nodes) {
      if (node.children) {
        // List container
        const listRef = context.nextRef()
        const childRefs = buildElemRefs(node.children)
        const kArr = context.obj(childRefs.map((c) => c.ref)) as PDFArray
        const listDict = context.obj({
          Type: 'StructElem',
          S: 'L',
          P: documentElemRef,
          K: kArr
        }) as PDFDict
        // Update children's parent pointer
        for (const child of childRefs) {
          const childDict = context.lookup(child.ref) as PDFDict
          childDict.set(PDFName.of('P'), listRef)
        }
        context.assign(listRef, listDict)
        results.push({ ref: listRef })
      } else if (node.region) {
        const region = node.region
        const elemRef = context.nextRef()
        const pageIdx = region.pageNumber - 1
        const pageRef = pdfPages[pageIdx]?.ref

        const elemDict = context.obj({
          Type: 'StructElem',
          S: toStructType(node.tag),
          P: documentElemRef,
          Pg: pageRef
        }) as PDFDict

        if (node.tag === 'Artifact') {
          // Artifacts are not in the structure tree — skip
          continue
        }

        const mcid = mcidMap.get(region.id)
        if (mcid !== undefined) {
          elemDict.set(PDFName.of('K'), PDFNumber.of(mcid))
        }

        // Alt text goes directly on the Figure StructElement (PDF spec §14.9.3)
        if (node.tag === 'Figure' && region.altText) {
          elemDict.set(PDFName.of('Alt'), PDFString.of(region.altText))
        }

        context.assign(elemRef, elemDict)
        results.push({ ref: elemRef, mcid, pageRef })
      }
    }
    return results
  }

  const builtElems = buildElemRefs(structNodes)

  // ------------------------------------------------------------------
  // Step 8: Build the Document StructElement
  // ------------------------------------------------------------------
  const kArray = context.obj(builtElems.map((e) => e.ref)) as PDFArray
  const documentElemDict = context.obj({
    Type: 'StructElem',
    S: 'Document',
    P: structTreeRootRef,
    K: kArray
  }) as PDFDict
  context.assign(documentElemRef, documentElemDict)

  // ------------------------------------------------------------------
  // Step 9: Build the ParentTree (MCID → StructElement reverse lookup)
  // ParentTree is a number tree mapping MCID int → StructElement ref.
  // Screen readers use this to go from a BDC MCID back to the struct element.
  // ------------------------------------------------------------------
  const numsArray = context.obj([]) as PDFArray

  // Collect all leaf elements with MCIDs
  function collectLeafElems(nodes: StructNode[], refs: BuiltElem[]) {
    // refs are already in order from buildElemRefs
  }
  void collectLeafElems // prevent lint warning

  // Re-walk to pair MCID integers with their struct element refs
  const mcidToElemRef = new Map<number, PDFRef>()

  function collectMcidRefs(nodes: StructNode[], elemRefs: BuiltElem[], idx: { n: number }) {
    for (const node of nodes) {
      if (node.children) {
        // The list container ref holds children; look inside
        const listBuilt = elemRefs[idx.n++]
        if (!listBuilt) continue
        const listDict = context.lookup(listBuilt.ref) as PDFDict
        const childK = listDict.lookup(PDFName.of('K'))
        if (childK instanceof PDFArray) {
          childK.asArray().forEach((childRef) => {
            if (childRef instanceof PDFRef) {
              const childDict = context.lookup(childRef) as PDFDict
              const kVal = childDict.lookup(PDFName.of('K'))
              if (kVal instanceof PDFNumber) {
                mcidToElemRef.set(kVal.asNumber(), childRef)
              }
            }
          })
        }
      } else if (node.region && node.tag !== 'Artifact') {
        const built = elemRefs[idx.n++]
        if (built && built.mcid !== undefined) {
          mcidToElemRef.set(built.mcid, built.ref)
        }
      } else {
        idx.n++
      }
    }
  }
  collectMcidRefs(structNodes, builtElems, { n: 0 })

  // Build a sorted Nums array: [0 ref0 1 ref1 ...]
  const sortedMcids = Array.from(mcidToElemRef.keys()).sort((a, b) => a - b)
  for (const mcid of sortedMcids) {
    const ref = mcidToElemRef.get(mcid)!
    numsArray.push(PDFNumber.of(mcid))
    numsArray.push(ref)
  }

  const parentTreeRef = context.nextRef()
  const parentTreeDict = context.obj({ Nums: numsArray })
  context.assign(parentTreeRef, parentTreeDict)

  // ------------------------------------------------------------------
  // Step 10: Build the StructTreeRoot and attach to catalog
  // ------------------------------------------------------------------
  const structTreeRootDict = context.obj({
    Type: 'StructTreeRoot',
    K: documentElemRef,
    ParentTree: parentTreeRef,
    ParentTreeNextKey: nextMcid
  }) as PDFDict
  context.assign(structTreeRootRef, structTreeRootDict)

  catalog.set(PDFName.of('StructTreeRoot'), structTreeRootRef)

  // ------------------------------------------------------------------
  // Save and return
  // ------------------------------------------------------------------
  return pdfDoc.save()
}
