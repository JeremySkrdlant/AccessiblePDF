import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ocrPage } from '../lib/ocr'
import { importStructuredPDF } from '../lib/pdfStructImport'
import { useTagStore } from './useTagStore'
import type { PDFPage } from '../lib/types'

interface UseOCROptions {
  pdfDoc: PDFDocumentProxy | null
  pageCount: number
  renderPage: (pageNum: number, containerWidth: number) => Promise<{
    canvas: HTMLCanvasElement
    widthPt: number
    heightPt: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfJsPage: any
  }>
  containerWidth: number
}

/**
 * Runs OCR on all pages sequentially after pdfDoc is loaded.
 * Calls setDocument with the complete pages array when done.
 */
export function useOCR({ pdfDoc, pageCount, renderPage, containerWidth }: UseOCROptions): void {
  const { document, rawPdfBytes, setOcrRunning, setOcrProgress, setDocument } = useTagStore()
  const runningRef = useRef(false)

  useEffect(() => {
    if (!pdfDoc || pageCount === 0 || runningRef.current) return

    runningRef.current = true
    setOcrRunning(true)

    const savedFileName = document?.fileName ?? ''
    const savedFilePath = document?.filePath ?? ''
    const savedRawBytes = rawPdfBytes

    ;(async () => {
      try {
        // ── Fast path: re-import an already-tagged PDF ──────────────────────
        const importedPages = await importStructuredPDF(pdfDoc, pageCount, (fraction) => {
          setOcrProgress(fraction * 0.5) // use first half of progress bar
        })
        if (importedPages) {
          if (savedRawBytes) {
            setDocument(
              { filePath: savedFilePath, fileName: savedFileName, pageCount, pages: importedPages },
              savedRawBytes
            )
          }
          setOcrProgress(1)
          return
        }

        // ── Slow path: OCR ──────────────────────────────────────────────────
        const pages: PDFPage[] = []
        for (let p = 1; p <= pageCount; p++) {
          const rendered = await renderPage(p, containerWidth)
          const result = await ocrPage(
            rendered.canvas,
            rendered.pdfJsPage,
            p,
            rendered.widthPt,
            rendered.heightPt,
            (progress) => {
              setOcrProgress(((p - 1) + progress) / pageCount)
            }
          )
          pages.push({
            pageNumber: p,
            width: rendered.widthPt,
            height: rendered.heightPt,
            regions: result.regions
          })
        }

        // Always replace with the fully-populated document
        if (savedRawBytes) {
          setDocument(
            { filePath: savedFilePath, fileName: savedFileName, pageCount, pages },
            savedRawBytes
          )
        }
        setOcrProgress(1)
      } finally {
        setOcrRunning(false)
        runningRef.current = false
      }
    })()
    // Only re-run when a new PDF is loaded (pdfDoc identity changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pageCount])
}
