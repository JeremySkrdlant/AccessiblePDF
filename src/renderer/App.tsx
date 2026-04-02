import { useCallback } from 'react'
import { usePDF } from './hooks/usePDF'
import { useOCR } from './hooks/useOCR'
import { useTagStore } from './hooks/useTagStore'
import { DropZone } from './components/DropZone'
import { PDFViewer } from './components/PDFViewer'
import { TagPanel } from './components/TagPanel'
import { ExportButton } from './components/ExportButton'

export function App() {
  const {
    document, rawPdfBytes, isOcrRunning, ocrProgress,
    docTitle, docLanguage, setDocTitle, setDocLanguage,
    toolMode, setToolMode,
    setDocument, reset
  } = useTagStore()

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setToolMode(toolMode === 'draw' ? 'select' : 'draw')}
            title={toolMode === 'draw' ? 'Exit draw mode (Esc)' : 'Draw image region'}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${toolMode === 'draw'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }
            `}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
              <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
              <path d="M8 5v6M5 8h6" strokeLinecap="round" />
            </svg>
            {toolMode === 'draw' ? 'Drawing Image…' : 'Draw Image'}
          </button>
          <ExportButton />
        </div>
      </header>

      {/* Document properties bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">
            Document Title
            <span className="text-red-400 ml-0.5">*</span>
          </label>
          <input
            type="text"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder="Required for accessibility"
            className="flex-1 min-w-0 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">Language</label>
          <select
            value={docLanguage}
            onChange={(e) => setDocLanguage(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="es-ES">Spanish</option>
            <option value="fr-FR">French</option>
            <option value="de-DE">German</option>
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="zh-TW">Chinese (Traditional)</option>
            <option value="ja-JP">Japanese</option>
            <option value="ko-KR">Korean</option>
            <option value="ar-SA">Arabic</option>
            <option value="pt-BR">Portuguese (Brazil)</option>
            <option value="ru-RU">Russian</option>
          </select>
        </div>
      </div>

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
