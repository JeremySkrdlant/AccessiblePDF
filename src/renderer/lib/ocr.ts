import { createWorker } from 'tesseract.js'
import { groupWordsIntoRegions, detectImageRegions, type TesseractWord } from './regionDetect'
import type { PDFRegion } from './types'

export interface OCRPageResult {
  regions: PDFRegion[]
}

/**
 * OCR a single page canvas and return detected regions.
 * Creates and terminates the Tesseract worker per-call to avoid memory leaks.
 */
export async function ocrPage(
  pageCanvas: HTMLCanvasElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfJsPage: any,
  pageNum: number,
  pageWidthPt: number,
  pageHeightPt: number,
  onProgress?: (p: number) => void
): Promise<OCRPageResult> {
  const canvasWidth = pageCanvas.width
  const canvasHeight = pageCanvas.height

  // In a packaged app, resourcesPath points to our bundled tessdata.
  // In dev mode it points inside node_modules/electron/dist/... which has nothing useful.
  // Detect packaged by checking the path doesn't contain 'node_modules'.
  const workerOptions: Record<string, string> = {}
  if (window.electronAPI) {
    try {
      const resourcesPath = await window.electronAPI.getResourcesPath()
      const isPackaged = resourcesPath && !resourcesPath.includes('node_modules')
      if (isPackaged) {
        workerOptions.workerPath = `${resourcesPath}/tesseract-worker.min.js`
        workerOptions.langPath = `${resourcesPath}/tessdata`
        workerOptions.corePath = `${resourcesPath}/tesseract-core-simd-lstm.wasm`
      }
    } catch {
      // Fall through to default loading
    }
  }

  const worker = await createWorker('eng', 1, {
    ...workerOptions,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress)
      }
    }
  })

  try {
    const result = await worker.recognize(pageCanvas)
    const words = result.data.words as TesseractWord[]
    const textRegions = groupWordsIntoRegions(words, pageNum, canvasWidth, canvasHeight)

    // Also detect image regions from the PDF operator list
    const imageRegions = await detectImageRegions(pdfJsPage, pageNum, pageWidthPt, pageHeightPt)

    // Re-index all regions so IDs are unique and sequential
    const allRegions = [...textRegions, ...imageRegions].map((r, idx) => ({
      ...r,
      id: `page-${pageNum}-region-${idx}`
    }))

    return { regions: allRegions }
  } finally {
    await worker.terminate()
  }
}
