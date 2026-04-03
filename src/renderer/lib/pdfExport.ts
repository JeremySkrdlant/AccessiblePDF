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
function toStructType(role: string): string {
  const map: Record<string, string> = {
    H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5', H6: 'H6',
    P: 'P',
    Figure: 'Figure',
    Caption: 'Caption',
    Table: 'Table',
    List: 'L',      // PDF/UA uses /L for list container
    Column: 'Div',
    ListItem: 'LI', // PDF/UA uses /LI for list item
    Artifact: 'Artifact'
  }
  return map[role] || 'Div'
}

// ---------------------------------------------------------------------------
// Logical structure node (used to group ListItems under a List parent)
// ---------------------------------------------------------------------------
interface StructNode {
  tag: string
  region?: PDFRegion       // undefined for abstract groups
  children?: StructNode[]
}

function buildStructNodes(regions: PDFRegion[]): StructNode[] {
  const childrenMap = new Map<string, PDFRegion[]>()
  const roots: PDFRegion[] = []

  for (const r of regions) {
    if (r.parentId) {
      if (!childrenMap.has(r.parentId)) childrenMap.set(r.parentId, [])
      childrenMap.get(r.parentId)!.push(r)
    } else {
      roots.push(r)
    }
  }

  function resolveNode(r: PDFRegion): StructNode {
    const children = childrenMap.get(r.id) || []
    const childNodes = children.map(resolveNode)
    return {
      tag: r.tag || 'Div',
      region: r.type === 'group' ? undefined : r,
      children: childNodes.length > 0 ? childNodes : undefined
    }
  }

  return roots.map(resolveNode)
}

// ---------------------------------------------------------------------------
// PDF/UA-1 XMP metadata
// Required by PDF/UA-1 (ISO 14289-1 §6.7.11) — checkers look for pdfuaid:part
// ---------------------------------------------------------------------------
function buildXmpMetadata(title: string, language: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const now = new Date().toISOString() // e.g. 2026-04-02T14:30:00.000Z
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${esc(title)}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:language>
        <rdf:Bag>
          <rdf:li>${esc(language)}</rdf:li>
        </rdf:Bag>
      </dc:language>
      <pdf:Producer>PDF Accessibility Tagger</pdf:Producer>
      <pdf:PDFVersion>1.7</pdf:PDFVersion>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
      <xmp:MetadataDate>${now}</xmp:MetadataDate>
      <xmp:CreatorTool>PDF Accessibility Tagger</xmp:CreatorTool>
      <pdfuaid:part>1</pdfuaid:part>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
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
  let srcDoc: PDFDocument
  try {
    pdfDoc = await PDFDocument.load(rawBytes, { updateMetadata: false })
    srcDoc = await PDFDocument.load(rawBytes)
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
  const language = docLanguage || 'en-US'
  pdfDoc.setLanguage(language)

  // MarkInfo: tells viewers this PDF has structure tags
  catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }))

  // PDF/UA-1 XMP metadata — required for pdfuaid:part identifier
  const xmpBytes = new TextEncoder().encode(buildXmpMetadata(title, language))
  const xmpStream = context.stream(xmpBytes, { Type: 'Metadata', Subtype: 'XML' })
  const xmpRef = context.register(xmpStream)
  catalog.set(PDFName.of('Metadata'), xmpRef)

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
  // Step 5: Assign MCIDs per page to all non-Artifact leaf regions
  // ------------------------------------------------------------------
  const mcidMap = new Map<string, number>()  // regionId → MCID
  const pageMcidCounters = new Map<number, number>()

  function assignMcids(nodes: StructNode[]) {
    for (const node of nodes) {
      if (node.children) {
        assignMcids(node.children)
      } else if (node.region && node.tag !== 'Artifact') {
        const pageNum = node.region.pageNumber
        const nextMcid = pageMcidCounters.get(pageNum) || 0
        mcidMap.set(node.region.id, nextMcid)
        pageMcidCounters.set(pageNum, nextMcid + 1)
      }
    }
  }
  assignMcids(structNodes)

  // ------------------------------------------------------------------
  // Step 6: Build per-page invisible text content streams
  // ------------------------------------------------------------------
  const pdfPages = pdfDoc.getPages()
  const embeddedPages = await pdfDoc.embedPages(srcDoc.getPages())

  for (let pageIdx = 0; pageIdx < pdfPages.length; pageIdx++) {
    const page = pdfPages[pageIdx]
    const pageNum = pageIdx + 1
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(pageIdx))
    page.node.set(PDFName.of('Tabs'), PDFName.of('S'))
    const { width: pageW, height: pageH } = page.getSize()

    // Clear existing contents so we can completely rebuild them cleanly in one stream
    page.node.set(PDFName.of('Contents'), context.obj([]))

    const regionsOnPage = allTaggedRegions.filter((r) => r.pageNumber === pageNum)

    const resources = page.node.Resources() || context.obj({}) as PDFDict
    if (!page.node.Resources()) {
      page.node.set(PDFName.of('Resources'), resources)
    }

    // Embed the original page as a Form XObject and insert it into /XObject resources
    let xobjDict = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjDict) {
      xobjDict = context.obj({}) as PDFDict
      resources.set(PDFName.of('XObject'), xobjDict)
    }
    const embedName = `OriginalPg${pageNum}`
    xobjDict.set(PDFName.of(embedName), embeddedPages[pageIdx].ref)

    // Add invisible text font to resources
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

    // Build the content stream operators
    const operators: PDFOperator[] = []

    // 1. Draw the Original encapsulated visual page, wrapped safely in Artifact!
    operators.push(beginMarkedContentArtifact())
    operators.push(pushGraphicsState())
    // 1 0 0 1 0 0 cm (identity matrix)
    operators.push(op(PDFOperatorNames.DrawObject, embedName))
    operators.push(popGraphicsState())
    operators.push(endMarkedContent())

    // 2. Draw our invisible screen-reader tagging text!
    if (regionsOnPage.length > 0) {
      operators.push(pushGraphicsState())
      operators.push(beginText())
      operators.push(setTextRenderingMode(3)) // invalid visual rendering mode 3

      for (const region of regionsOnPage) {
        if (region.tag === 'Artifact') {
          operators.push(beginMarkedContentArtifact())
          operators.push(endMarkedContent())
          continue
        }

        const mcid = mcidMap.get(region.id)
        if (mcid === undefined) continue

        const propName = `MC${mcid}`
        const structType = toStructType(region.tag as string)

        operators.push(beginMarkedContentProps(structType, propName))

        const pdfX = region.bbox.x * pageW
        const pdfY = pageH - (region.bbox.y + region.bbox.height) * pageH
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
    }

    // Create a NEW content stream and append it to the page
    const streamBytes = operators.map((o) => o.toString()).join('\n')
    const stream = context.flateStream(new TextEncoder().encode(streamBytes))
    const streamRef = context.register(stream)
    page.node.addContentStream(streamRef)
  }

  // ------------------------------------------------------------------
  // Step 7: Build StructElement indirect refs and populate ParentTree map
  // ------------------------------------------------------------------
  const structTreeRootRef = context.nextRef()
  const documentElemRef = context.nextRef()

  const pageElemsMap = new Map<number, (PDFRef | null)[]>()

  function registerElemForPage(pageNum: number, mcid: number, ref: PDFRef) {
    if (!pageElemsMap.has(pageNum)) {
      pageElemsMap.set(pageNum, [])
    }
    const arr = pageElemsMap.get(pageNum)!
    arr[mcid] = ref
  }

  interface BuiltElem {
    ref: PDFRef
  }

  function buildElemRefs(nodes: StructNode[], parentRef: PDFRef): BuiltElem[] {
    const results: BuiltElem[] = []
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        // Group container (can be any tag: List, Div, Sect, etc.)
        const groupRef = context.nextRef()
        const childRefs = buildElemRefs(node.children, groupRef)
        const kArr = context.obj(childRefs.map((c) => c.ref)) as PDFArray
        
        let structType = toStructType(node.tag)
        const groupDict = context.obj({
          Type: 'StructElem',
          S: structType,
          P: parentRef,
          K: kArr
        }) as PDFDict
        
        context.assign(groupRef, groupDict)
        results.push({ ref: groupRef })
      } else if (node.region && node.region.type !== 'group') {
        if (node.tag === 'Artifact') continue

        const region = node.region
        const elemRef = context.nextRef()
        const pageIdx = region.pageNumber - 1
        const pageRef = pdfPages[pageIdx]?.ref

        const elemDict = context.obj({
          Type: 'StructElem',
          S: toStructType(node.tag),
          P: parentRef,
          Pg: pageRef
        }) as PDFDict

        const isListItem = node.tag === 'ListItem'
        const isTable = node.tag === 'Table'
        let targetRef = elemRef

        if (isListItem) {
          const lbodyRef = context.nextRef()
          context.assign(lbodyRef, context.obj({ Type: 'StructElem', S: 'LBody', P: elemRef, Pg: pageRef }))
          elemDict.set(PDFName.of('K'), lbodyRef)
          targetRef = lbodyRef
        } else if (isTable) {
          const trRef = context.nextRef()
          const tdRef = context.nextRef()
          context.assign(trRef, context.obj({ Type: 'StructElem', S: 'TR', P: elemRef, Pg: pageRef }))
          context.assign(tdRef, context.obj({ Type: 'StructElem', S: 'TD', P: trRef, Pg: pageRef }))
          elemDict.set(PDFName.of('K'), trRef)
          ;(context.lookup(trRef) as PDFDict).set(PDFName.of('K'), tdRef)
          targetRef = tdRef
        }

        const mcid = mcidMap.get(region.id)
        if (mcid !== undefined) {
          if (targetRef === elemRef) {
             elemDict.set(PDFName.of('K'), PDFNumber.of(mcid))
          } else {
             const targetDict = context.lookup(targetRef) as PDFDict
             targetDict.set(PDFName.of('K'), PDFNumber.of(mcid))
          }
          registerElemForPage(region.pageNumber, mcid, targetRef)
        }

        if (node.tag === 'Figure') {
          if (region.altText) {
            elemDict.set(PDFName.of('Alt'), PDFString.of(region.altText))
          }
          if (pdfPages[pageIdx]) {
            const { width: pageW, height: pageH } = pdfPages[pageIdx].getSize()
            const pdfX = region.bbox.x * pageW
            const pdfY = pageH - (region.bbox.y + region.bbox.height) * pageH
            elemDict.set(PDFName.of('BBox'), context.obj([pdfX, pdfY, pdfX + region.bbox.width * pageW, pdfY + region.bbox.height * pageH]))
          }
        }

        context.assign(elemRef, elemDict)
        results.push({ ref: elemRef })
      }
    }
    return results
  }

  const builtElems = buildElemRefs(structNodes, documentElemRef)

  // ------------------------------------------------------------------
  // Step 8: Build the Document StructElement
  // ------------------------------------------------------------------
  const kArray = context.obj(builtElems.map((e) => e.ref)) as PDFArray
  const documentElemDict = context.obj({
    Type: 'StructElem',
    S: 'Document',
    P: structTreeRootRef,
    K: kArray,
    T: PDFString.of(title)
  }) as PDFDict
  context.assign(documentElemRef, documentElemDict)

  // ------------------------------------------------------------------
  // Step 9: Build the ParentTree (StructParents → StructElements array)
  // ParentTree is a number tree mapping a Page's StructParents int to an 
  // array of StructElement refs sequentially indexed by their MCID.
  // ------------------------------------------------------------------
  const numsArray = context.obj([]) as PDFArray
  for (let pageIdx = 0; pageIdx < pdfPages.length; pageIdx++) {
    const pageNum = pageIdx + 1
    const elems = pageElemsMap.get(pageNum) || []
    
    const pageArray = context.obj([]) as PDFArray
    for (let i = 0; i < elems.length; i++) {
      if (elems[i]) {
        pageArray.push(elems[i]!)
      } else {
        pageArray.push(documentElemRef)
      }
    }
    numsArray.push(PDFNumber.of(pageIdx))
    numsArray.push(context.register(pageArray))
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
    ParentTreeNextKey: pdfPages.length
  }) as PDFDict
  context.assign(structTreeRootRef, structTreeRootDict)

  catalog.set(PDFName.of('StructTreeRoot'), structTreeRootRef)

  // ------------------------------------------------------------------
  // Save and return
  // ------------------------------------------------------------------
  return pdfDoc.save()
}
