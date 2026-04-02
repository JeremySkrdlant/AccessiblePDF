import type { PDFRegion, BoundingBox } from './types'

// Tesseract word shape from recognize() result
export interface TesseractWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

// Represents a line cluster during grouping
interface LineCluster {
  words: TesseractWord[]
  top: number
  left: number
  right: number
  bottom: number
}

/**
 * Group Tesseract words into line-level regions.
 * Words on the same baseline (±5px) with small gaps (<20px) are merged.
 * Returns normalized BoundingBoxes in screen space (top-left origin, 0–1).
 */
export function groupWordsIntoRegions(
  words: TesseractWord[],
  pageNum: number,
  canvasWidth: number,
  canvasHeight: number
): PDFRegion[] {
  const confident = words.filter((w) => w.confidence > 30 && w.text.trim() !== '')
  if (confident.length === 0) return []

  // Sort by top then left
  const sorted = [...confident].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)

  const lines: LineCluster[] = []

  for (const word of sorted) {
    const wordTop = word.bbox.y0
    // Find an existing line cluster whose baseline is within 5px
    const cluster = lines.find((l) => Math.abs(l.top - wordTop) <= 5)
    if (cluster) {
      // Check horizontal gap from rightmost word in this line
      const gap = word.bbox.x0 - cluster.right
      if (gap < 20) {
        cluster.words.push(word)
        cluster.right = Math.max(cluster.right, word.bbox.x1)
        cluster.bottom = Math.max(cluster.bottom, word.bbox.y1)
        cluster.left = Math.min(cluster.left, word.bbox.x0)
      } else {
        // Large gap — start a new region on this baseline
        lines.push({
          words: [word],
          top: wordTop,
          left: word.bbox.x0,
          right: word.bbox.x1,
          bottom: word.bbox.y1
        })
      }
    } else {
      lines.push({
        words: [word],
        top: wordTop,
        left: word.bbox.x0,
        right: word.bbox.x1,
        bottom: word.bbox.y1
      })
    }
  }

  return lines.map((line, idx): PDFRegion => {
    const text = line.words.map((w) => w.text).join(' ')
    const bbox: BoundingBox = {
      x: line.left / canvasWidth,
      y: line.top / canvasHeight,
      width: (line.right - line.left) / canvasWidth,
      height: (line.bottom - line.top) / canvasHeight
    }
    return {
      id: `page-${pageNum}-region-${idx}`,
      pageNumber: pageNum,
      bbox,
      type: 'text',
      ocrText: text,
      tag: null
    }
  })
}

// Minimal types for PDF.js operator list
interface OperatorList {
  fnArray: number[]
  argsArray: (number[] | null)[]
}

// PDF.js OPS values for image painting
const OPS_SAVE = 17      // q
const OPS_RESTORE = 18   // Q
const OPS_TRANSFORM = 12 // cm
const OPS_PAINT_IMAGE = 85 // paintImageXObject

/**
 * Detect image regions in a PDF page using the operator list.
 * Returns regions with bboxes normalized to screen space (top-left origin).
 */
export async function detectImageRegions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfPage: any,
  pageNum: number,
  pageWidthPt: number,
  pageHeightPt: number
): Promise<PDFRegion[]> {
  let opList: OperatorList
  try {
    opList = await pdfPage.getOperatorList()
  } catch {
    return []
  }

  // Track the current transformation matrix stack
  // CTM as [a, b, c, d, e, f]
  type CTM = [number, number, number, number, number, number]
  const identity: CTM = [1, 0, 0, 1, 0, 0]
  const ctmStack: CTM[] = [identity]
  let currentCTM: CTM = [...identity]

  function multiplyMatrix(m1: CTM, m2: CTM): CTM {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ]
  }

  const imageRegions: PDFRegion[] = []
  let imageIdx = 0

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]
    const args = opList.argsArray[i]

    if (fn === OPS_SAVE) {
      ctmStack.push([...currentCTM])
    } else if (fn === OPS_RESTORE) {
      const prev = ctmStack.pop()
      if (prev) currentCTM = prev
    } else if (fn === OPS_TRANSFORM && args && args.length === 6) {
      const m: CTM = [args[0], args[1], args[2], args[3], args[4], args[5]]
      currentCTM = multiplyMatrix(currentCTM, m)
    } else if (fn === OPS_PAINT_IMAGE) {
      // The CTM transforms the unit square [0,0]->[1,1] to the image position
      // For axis-aligned images: width=a, height=d, x=e, y=f (in PDF points, y from bottom)
      const [a, , , d, e, f] = currentCTM
      const imgW = Math.abs(a)
      const imgH = Math.abs(d)
      const imgX = e
      // PDF y is from bottom; convert to screen y (from top)
      const screenY = pageHeightPt - f - imgH

      const bbox: BoundingBox = {
        x: imgX / pageWidthPt,
        y: screenY / pageHeightPt,
        width: imgW / pageWidthPt,
        height: imgH / pageHeightPt
      }

      // Clamp to [0, 1]
      bbox.x = Math.max(0, Math.min(1, bbox.x))
      bbox.y = Math.max(0, Math.min(1, bbox.y))
      bbox.width = Math.max(0.01, Math.min(1 - bbox.x, bbox.width))
      bbox.height = Math.max(0.01, Math.min(1 - bbox.y, bbox.height))

      imageRegions.push({
        id: `page-${pageNum}-image-${imageIdx++}`,
        pageNumber: pageNum,
        bbox,
        type: 'image',
        tag: null
      })
    }
  }

  return imageRegions
}
