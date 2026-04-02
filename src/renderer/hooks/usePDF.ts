import { useState, useEffect, useRef } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

// Set worker source once at module level
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface RenderedPage {
  canvas: HTMLCanvasElement
  scale: number
  widthPt: number
  heightPt: number
  pdfJsPage: PDFPageProxy
}

interface UsePDFResult {
  pdfDoc: PDFDocumentProxy | null
  pageCount: number
  isLoading: boolean
  error: string | null
  renderPage: (pageNum: number, containerWidth: number) => Promise<RenderedPage>
}

export function usePDF(pdfBytes: ArrayBuffer | null): UsePDFResult {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadingTaskRef = useRef<ReturnType<typeof pdfjs.getDocument> | null>(null)

  useEffect(() => {
    if (!pdfBytes) {
      setPdfDoc(null)
      setPageCount(0)
      return
    }

    setIsLoading(true)
    setError(null)

    // Slice to give PDF.js ownership of this copy
    const task = pdfjs.getDocument({ data: pdfBytes.slice(0) })
    loadingTaskRef.current = task

    task.promise
      .then((doc) => {
        setPdfDoc(doc)
        setPageCount(doc.numPages)
        setIsLoading(false)
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortException') {
          setError(err.message)
          setIsLoading(false)
        }
      })

    return () => {
      loadingTaskRef.current?.destroy()
    }
  }, [pdfBytes])

  async function renderPage(pageNum: number, containerWidth: number): Promise<RenderedPage> {
    if (!pdfDoc) throw new Error('No PDF loaded')

    const page = await pdfDoc.getPage(pageNum)
    const naturalViewport = page.getViewport({ scale: 1 })
    const scale = containerWidth / naturalViewport.width
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get canvas context')

    await page.render({ canvasContext: ctx, viewport }).promise

    return {
      canvas,
      scale,
      widthPt: naturalViewport.width,
      heightPt: naturalViewport.height,
      pdfJsPage: page
    }
  }

  return { pdfDoc, pageCount, isLoading, error, renderPage }
}
