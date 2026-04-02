import { useState } from 'react'
import { useTagStore } from '../hooks/useTagStore'
import { exportTaggedPDF } from '../lib/pdfExport'

export function ExportButton() {
  const { document, rawPdfBytes } = useTagStore()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (!document || !rawPdfBytes) return null

  // Count tagged regions to show in UI
  const taggedCount = document.pages.flatMap((p) => p.regions).filter((r) => r.tag !== null).length
  const totalCount = document.pages.flatMap((p) => p.regions).length

  async function handleExport() {
    if (!document || !rawPdfBytes) return
    setIsExporting(true)
    setError(null)
    setSuccess(false)

    try {
      const bytes = await exportTaggedPDF(rawPdfBytes, document)
      const defaultName = document.fileName.replace(/\.pdf$/i, '') + '-accessible.pdf'
      const savedPath = await window.electronAPI.saveFile(defaultName, bytes)
      if (savedPath) setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleExport}
        disabled={isExporting || taggedCount === 0}
        className={`
          px-4 py-2 rounded-lg text-sm font-semibold transition-colors
          ${taggedCount === 0
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : isExporting
              ? 'bg-blue-400 text-white cursor-wait'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
          }
        `}
      >
        {isExporting ? 'Exporting…' : `Export Accessible PDF (${taggedCount}/${totalCount} tagged)`}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {success && <p className="text-xs text-green-600">Saved successfully.</p>}
    </div>
  )
}
