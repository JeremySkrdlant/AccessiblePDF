import { useCallback } from 'react'
import { usePDF } from './hooks/usePDF'
import { useOCR } from './hooks/useOCR'
import { useTagStore } from './hooks/useTagStore'
import { DropZone } from './components/DropZone'
import { PDFViewer } from './components/PDFViewer'
import { TagPanel } from './components/TagPanel'
import { ExportButton } from './components/ExportButton'

export function App() {
  const { document, rawPdfBytes, isOcrRunning, ocrProgress, setDocument, reset } = useTagStore()

  // usePDF is driven by the raw bytes stored in state
  const { pdfDoc, pageCount, isLoading, error, renderPage } = usePDF(rawPdfBytes)

  // useOCR runs automatically when pdfDoc becomes available
  useOCR({
    pdfDoc,
    pageCount,
    renderPage,
    containerWidth: 800
  })

  const handlePDFLoaded = useCallback(
    (bytes: ArrayBuffer, fileName: string, filePath: string) => {
      reset()
      // Temporarily set document meta without pages (OCR will populate them)
      setDocument(
        { filePath, fileName, pageCount: 0, pages: [] },
        bytes
      )
    },
    [reset, setDocument]
  )

  // Show drop zone when no document is loaded
  if (!rawPdfBytes) {
    return (
      <div className="h-full">
        <DropZone onPDFLoaded={handlePDFLoaded} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="text-sm text-gray-500 hover:text-gray-700"
            aria-label="Open different file"
          >
            ← Open different file
          </button>
          {document?.fileName && (
            <span className="text-sm text-gray-600 font-medium">{document.fileName}</span>
          )}
        </div>
        <ExportButton />
      </header>

      {/* Loading / error states */}
      {(isLoading || isOcrRunning) && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-3 flex-shrink-0">
          <div className="flex-1 h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${isLoading ? 10 : Math.round(ocrProgress * 100)}%` }}
            />
          </div>
          <span className="text-xs text-blue-600 w-32 text-right">
            {isLoading ? 'Loading PDF…' : `OCR ${Math.round(ocrProgress * 100)}%`}
          </span>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-sm text-red-600 flex-shrink-0">
          {error.includes('password') ? (
            <>This PDF is password-protected. Please remove encryption before tagging.</>
          ) : (
            <>Failed to load PDF: {error}</>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {pdfDoc && pageCount > 0 && (
          <PDFViewer pageCount={pageCount} renderPage={renderPage} />
        )}
        <TagPanel />
      </div>
    </div>
  )
}
